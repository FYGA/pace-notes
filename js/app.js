import { AudioService } from "./audio.js";
import { analyzeCurves } from "./curves.js";
import { DEMO_ROUTE, DemoRunner } from "./demo.js";
import {
  canConfirmRouteDirection,
  CallScheduler,
  evaluateTelemetryQuality,
  isRouteHeadingCompatible,
} from "./drive.js";
import { MapController } from "./map.js";
import { renderCornerCall, renderLinkedCall } from "./pacenotes.js";
import { Recorder } from "./recording.js";
import { MapboxClient } from "./routing.js";
import { SessionTracker, WakeLockService } from "./session.js";
import {
  loadMapboxToken,
  loadPreferences,
  maskToken,
  saveMapboxToken,
  savePreferences,
} from "./settings.js";
import { createInitialState, Store } from "./state.js";
import { PositionTracker } from "./tracking.js";
import { AppView } from "./ui.js";
import {
  buildCumulativeDistances,
  closestRoutePoint,
  distanceMeters,
} from "./utils.js";

const OFF_ROUTE_METERS = 60;
const BACK_ON_ROUTE_METERS = 35;
const COMPLETE_DISTANCE_METERS = 55;
const MIN_HEADING_CHECK_SPEED_MPH = 8;

export class PaceNotesApp {
  #store;
  #view;
  #map = new MapController();
  #routing = new MapboxClient();
  #positionTracker = new PositionTracker();
  #audio = new AudioService();
  #session = new SessionTracker();
  #recorder = new Recorder();
  #demo = new DemoRunner();
  #wakeLock;
  #scheduler = new CallScheduler();
  #token = "";
  #routeAbortController = null;
  #demoAbortController = null;
  #offRouteLatched = false;
  #callsPaused = false;
  #resyncAwaitingHeading = false;
  #directionConfirmed = false;
  #routeCompleted = false;
  #sessionTimer = null;
  #modeGeneration = 0;
  #stopPromise = null;

  constructor() {
    this.#token = loadMapboxToken();
    const preferences = loadPreferences();
    this.#store = new Store(
      createInitialState({
        hasSavedToken: Boolean(this.#token),
        maskedToken: maskToken(this.#token),
        preferences,
      }),
    );
    this.#view = new AppView(document);
    this.#wakeLock = new WakeLockService((active) => {
      this.#store.update((state) => ({ ...state, wakeLockActive: active }));
    });
    this.#map.setManualMoveHandler?.(() => {
      this.#store.update((state) => ({
        ...state,
        ui: { ...state.ui, followUser: false },
      }));
    });
  }

  start() {
    this.#store.subscribe((state) => this.#view.render(state));
    this.#view.bind({
      onSaveToken: (token) => this.#saveToken(token),
      onUseSavedToken: () => this.#saveToken(this.#token),
      onChangeToken: () => this.#changeToken(),
      onChangePaceNoteProfile: (profile) =>
        this.#changePaceNoteProfile(profile),
      onLoadRoute: (destination) => this.#loadRoute(destination),
      onCloseRoute: () => this.#closeRoute(),
      onStartDriving: () => this.#startTracking(),
      onToggleTracking: () => this.#toggleTracking(),
      onToggleDemo: () => this.#toggleDemo(),
      onOpenRoute: () => this.#openRoute(),
      onToggleRecording: () => this.#toggleRecording(),
      onCenterMap: () => this.#centerMap(),
      onToggleSound: () => this.#toggleSound(),
      onOpenSettings: () => this.#openSettings(),
      onCloseSettings: () => this.#closeSettings(),
      onUserGesture: () => this.#audio.unlock(),
    });
    if (this.#store.getState().ui.settingsOpen) this.#view.focusSettings();

    this.#sessionTimer = setInterval(() => {
      if (!this.#session.active) return;
      this.#checkGpsHeartbeat();
      this.#store.update((state) => ({
        ...state,
        session: this.#session.snapshot(),
      }));
    }, 1_000);

    document.addEventListener("visibilitychange", () => {
      const mode = this.#store.getState().mode;
      if (
        document.visibilityState === "visible" &&
        (mode === "tracking" || mode === "demo")
      ) {
        this.#wakeLock.request();
      }
    });
  }

  async #saveToken(token) {
    if (this.#store.getState().busy) return;
    if (!token) {
      this.#view.showToast("Enter a Mapbox public token.", { tone: "error" });
      return;
    }

    this.#store.update((state) => ({ ...state, busy: true }));
    this.#routing.setToken(token);

    try {
      await this.#routing.validateToken();
      if (this.#map.ready) this.#map.setToken(token);
      else await this.#map.initialize(token);

      this.#token = token;
      saveMapboxToken(token);
      this.#store.update((state) => ({
        ...state,
        initialized: true,
        mapReady: true,
        busy: false,
        hasSavedToken: true,
        maskedToken: maskToken(token),
        ui: {
          ...state.ui,
          settingsOpen: false,
          routeOpen: true,
          showTokenInput: false,
        },
      }));
      this.#view.focusDestination();
      this.#view.showToast("Mapbox connected.", { tone: "success" });
    } catch (error) {
      this.#routing.setToken(this.#token);
      this.#store.update((state) => ({ ...state, busy: false }));
      this.#view.showToast(error.message || "Could not initialize the map.", {
        tone: "error",
        duration: 3_600,
      });
    }
  }

  #changeToken() {
    this.#store.update((state) => ({
      ...state,
      ui: { ...state.ui, showTokenInput: true },
    }));
    this.#view.clearTokenInput();
  }

  #changePaceNoteProfile(profile) {
    const state = this.#store.getState();
    if (state.busy || state.mode !== "idle") return;

    const preferences = savePreferences({ paceNoteProfile: profile });
    const route = state.route.loaded
      ? rematerializeRoute(state.route, preferences.paceNoteProfile)
      : state.route;
    if (route.loaded) {
      this.#scheduler.reset(route.curves);
      this.#map.setRoute(route);
    }
    this.#store.update((current) => ({
      ...current,
      preferences,
      route,
    }));
    this.#view.showToast(
      preferences.paceNoteProfile === "descriptive"
        ? "Descriptive pace-note wording selected."
        : "Numerical pace-note wording selected.",
      { tone: "success" },
    );
  }

  async #loadRoute(destination) {
    if (!destination) {
      this.#view.showToast("Enter a destination.", { tone: "error" });
      return;
    }

    await this.#stopActiveMode();
    this.#routeAbortController?.abort();
    const controller = new AbortController();
    this.#routeAbortController = controller;
    this.#store.update((state) => ({
      ...state,
      busy: true,
      mode: "loading-route",
    }));

    try {
      const destinationResult = await this.#routing.geocode(destination, {
        signal: controller.signal,
      });
      if (!destinationResult) {
        throw new Error("Destination not found. Try a more specific search.");
      }

      const telemetry = await this.#positionTracker.getCurrentPosition();
      this.#map.setUserPosition(telemetry.position, telemetry.heading || 0);
      const result = await this.#routing.directions(
        telemetry.position,
        destinationResult.coordinates,
        { signal: controller.signal },
      );
      if (!result || result.coordinates.length < 8) {
        throw new Error("The route is too short to analyze.");
      }

      if (this.#routeAbortController !== controller) return;
      const route = buildRoute(
        destinationResult.name,
        result,
        this.#store.getState().preferences.paceNoteProfile,
      );
      this.#scheduler.reset(route.curves);
      this.#map.setRoute(route);
      this.#offRouteLatched = false;
      this.#callsPaused = false;
      this.#resyncAwaitingHeading = false;
      this.#directionConfirmed = false;
      this.#routeCompleted = false;
      this.#store.update((state) => ({
        ...state,
        busy: false,
        mode: "idle",
        telemetry: { ...state.telemetry, ...telemetry },
        route,
      }));
      this.#view.showToast(`Route ready · ${route.curves.length} curves`, {
        tone: "success",
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      if (this.#routeAbortController !== controller) return;
      this.#store.update((state) => ({
        ...state,
        busy: false,
        mode: "idle",
      }));
      this.#view.showToast(error.message || "Could not load that route.", {
        tone: "error",
        duration: 3_800,
      });
    } finally {
      if (this.#routeAbortController === controller) {
        this.#routeAbortController = null;
      }
    }
  }

  async #openRoute() {
    await this.#stopActiveMode();
    this.#store.update((state) => ({
      ...state,
      ui: { ...state.ui, routeOpen: true, settingsOpen: false },
    }));
    this.#view.focusDestination();
  }

  #closeRoute() {
    this.#store.update((state) => ({
      ...state,
      ui: { ...state.ui, routeOpen: false },
    }));
    this.#view.focusRouteButton();
  }

  #openSettings() {
    const state = this.#store.getState();
    if (state.busy || state.mode !== "idle") {
      this.#view.showToast("Settings are available after the drive stops.");
      return;
    }
    this.#store.update((state) => ({
      ...state,
      ui: {
        ...state.ui,
        settingsOpen: true,
        routeOpen: false,
        showTokenInput: !state.hasSavedToken,
      },
    }));
    this.#view.focusSettings();
  }

  #closeSettings() {
    if (!this.#store.getState().initialized) return;
    this.#store.update((state) => ({
      ...state,
      ui: { ...state.ui, settingsOpen: false },
    }));
    this.#view.focusSettingsButton();
  }

  #toggleTracking() {
    if (this.#store.getState().mode === "tracking") this.#stopActiveMode();
    else this.#startTracking();
  }

  async #startTracking() {
    if (this.#stopPromise) await this.#stopPromise;
    const state = this.#store.getState();
    if (!state.route.loaded) {
      this.#view.showToast("Load a route first.", { tone: "error" });
      return;
    }

    if (state.mode === "demo") await this.#stopActiveMode();
    const generation = ++this.#modeGeneration;
    this.#positionTracker.stop();
    this.#session.start();
    this.#scheduler.reset(state.route.curves);
    this.#offRouteLatched = false;
    this.#callsPaused = false;
    this.#resyncAwaitingHeading = false;
    this.#directionConfirmed = false;
    this.#routeCompleted = false;
    const route = resetRouteProgress(this.#store.getState().route);

    this.#store.update((current) => ({
      ...current,
      mode: "tracking",
      route,
      session: this.#session.snapshot(),
      telemetry: {
        ...current.telemetry,
        offRoute: false,
        gpsUsable: false,
        gpsStatus: "Waiting for GPS position",
      },
      ui: {
        ...current.ui,
        routeOpen: false,
        settingsOpen: false,
        followUser: true,
      },
    }));

    try {
      this.#positionTracker.start({
        onPosition: (telemetry) => {
          if (generation !== this.#modeGeneration) return;
          this.#handlePosition(telemetry, { demo: false });
        },
        onError: (error) => {
          if (generation !== this.#modeGeneration) return;
          this.#handleTrackingError(error);
        },
      });
    } catch (error) {
      this.#handleTrackingError(error);
      await this.#stopActiveMode();
      return;
    }
    void this.#requestWakeLockFor("tracking", generation);
    this.#view.showToast("GPS tracking started.", { tone: "success" });
  }

  #toggleDemo() {
    const mode = this.#store.getState().mode;
    if (mode === "demo") this.#stopActiveMode();
    else if (mode === "loading-demo") {
      this.#demoAbortController?.abort();
      this.#demoAbortController = null;
      this.#modeGeneration += 1;
      this.#store.update((state) => ({ ...state, busy: false, mode: "idle" }));
    } else this.#startDemo();
  }

  async #startDemo() {
    await this.#stopActiveMode();
    if (
      this.#store.getState().busy ||
      this.#store.getState().mode === "loading-demo"
    ) {
      return;
    }
    const generation = ++this.#modeGeneration;
    const controller = new AbortController();
    this.#demoAbortController = controller;
    this.#store.update((state) => ({
      ...state,
      busy: true,
      mode: "loading-demo",
    }));

    try {
      const result = await this.#routing.directions(
        DEMO_ROUTE.start,
        DEMO_ROUTE.end,
        { signal: controller.signal },
      );
      if (
        generation !== this.#modeGeneration ||
        this.#store.getState().mode !== "loading-demo"
      )
        return;
      if (!result || result.coordinates.length < 8) {
        throw new Error("Demo route could not be loaded.");
      }

      const route = buildRoute(
        DEMO_ROUTE.name,
        result,
        this.#store.getState().preferences.paceNoteProfile,
      );
      this.#map.setRoute(route);
      this.#session.start();
      this.#scheduler.reset(route.curves);
      this.#offRouteLatched = false;
      this.#callsPaused = false;
      this.#resyncAwaitingHeading = false;
      this.#directionConfirmed = true;
      this.#routeCompleted = false;
      this.#store.update((state) => ({
        ...state,
        busy: false,
        mode: "demo",
        route,
        session: this.#session.snapshot(),
        ui: {
          ...state.ui,
          routeOpen: false,
          settingsOpen: false,
          followUser: true,
        },
      }));
      this.#demo.start(route, {
        onPosition: (telemetry) => {
          if (generation !== this.#modeGeneration) return;
          this.#handlePosition(telemetry, { demo: true });
        },
        onLoop: () => {
          if (generation !== this.#modeGeneration) return;
          this.#audio.clear();
          this.#scheduler.reset(route.curves);
          this.#callsPaused = false;
          this.#routeCompleted = false;
          this.#store.update((state) => ({
            ...state,
            route: resetRouteProgress(state.route),
          }));
        },
      });
      void this.#requestWakeLockFor("demo", generation);
      this.#view.showToast("Pikes Peak demo started.", { tone: "success" });
    } catch (error) {
      if (error.name === "AbortError") return;
      if (
        this.#demoAbortController !== controller ||
        generation !== this.#modeGeneration
      )
        return;
      this.#store.update((state) => ({
        ...state,
        busy: false,
        mode: "idle",
      }));
      this.#view.showToast(error.message || "Could not start the demo.", {
        tone: "error",
      });
    } finally {
      if (this.#demoAbortController === controller) {
        this.#demoAbortController = null;
      }
    }
  }

  #stopActiveMode({ completed = false } = {}) {
    if (this.#stopPromise) return this.#stopPromise;
    const mode = this.#store.getState().mode;
    if (mode !== "tracking" && mode !== "demo") return Promise.resolve();
    this.#modeGeneration += 1;
    this.#stopPromise = this.#performStop(mode, { completed }).finally(() => {
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async #performStop(mode, { completed }) {
    this.#store.update((state) => ({ ...state, busy: true, mode: "stopping" }));

    if (mode === "tracking") this.#positionTracker.stop();
    if (mode === "demo") this.#demo.stop();
    let recordingResult = { saved: false, data: null };
    try {
      recordingResult = this.#stopRecording({ notify: false });
    } catch {
      // A failed browser download must not prevent navigation teardown.
    }
    const finalSession = this.#session.stop();
    this.#audio.clear();

    try {
      await this.#wakeLock.release();
    } catch {
      // Wake lock support is optional and teardown must remain recoverable.
    } finally {
      this.#store.update((state) => ({
        ...state,
        busy: false,
        mode: "idle",
        session: { ...finalSession, active: false },
        telemetry: {
          ...state.telemetry,
          speedMph: 0,
          gpsUsable: false,
          gpsStatus: completed ? "Route complete" : null,
        },
      }));
    }

    if (completed) {
      const suffix = recordingResult.saved
        ? " Recording download requested."
        : "";
      this.#view.showToast(`Route complete.${suffix}`, {
        tone: "success",
        duration: 4_000,
      });
    }
  }

  async #requestWakeLockFor(mode, generation) {
    await this.#wakeLock.request();
    if (
      generation !== this.#modeGeneration ||
      this.#store.getState().mode !== mode
    ) {
      await this.#wakeLock.release();
    }
  }

  #handlePosition(telemetry, { demo }) {
    const state = this.#store.getState();
    if ((!demo && state.mode !== "tracking") || (demo && state.mode !== "demo"))
      return;
    if (!state.route.loaded) return;

    const heading = Number.isFinite(telemetry.heading)
      ? telemetry.heading
      : state.telemetry.heading;
    const quality = evaluateTelemetryQuality(telemetry, { demo });
    const match = closestRoutePoint(
      telemetry.position,
      state.route.coordinates,
      {
        cumulativeDistances: state.route.cumulativeDistances,
        previousDistanceAlongRoute: state.route.progressMeters,
        heading,
      },
    );
    let callUsable = quality.usable;
    let gpsStatus = quality.reason;
    const moving = telemetry.speedMph >= MIN_HEADING_CHECK_SPEED_MPH;
    const directionCompatible = canConfirmRouteDirection({
      heading,
      headingDelta: match.headingDelta,
      speedMph: telemetry.speedMph,
    });
    if (!demo && callUsable && !this.#directionConfirmed) {
      if (directionCompatible) {
        this.#directionConfirmed = true;
      } else {
        callUsable = false;
        gpsStatus = "Waiting to confirm direction of travel";
      }
    } else if (!demo && callUsable && moving && !directionCompatible) {
      callUsable = false;
      gpsStatus = Number.isFinite(heading)
        ? "Wrong direction — pace notes paused"
        : "Waiting for direction of travel";
    }

    if (!demo && this.#resyncAwaitingHeading) {
      const directionConfirmed =
        quality.usable && !match.reacquired && directionCompatible;
      if (directionConfirmed) {
        this.#resyncAwaitingHeading = false;
        this.#directionConfirmed = true;
      } else {
        callUsable = false;
        gpsStatus = "Route found — waiting to confirm direction";
      }
    }

    const previousTimestamp = state.telemetry.timestamp;
    const elapsedSeconds = Number.isFinite(previousTimestamp)
      ? Math.max(0, (telemetry.timestamp - previousTimestamp) / 1_000)
      : 0;
    const plausibleProgressDelta = Math.max(
      150,
      elapsedSeconds * 90 + (telemetry.accuracyMeters || 0) * 2,
    );
    const progressJump = Math.abs(
      match.distanceAlongRoute - state.route.progressMeters,
    );
    if (
      !demo &&
      callUsable &&
      !match.reacquired &&
      state.route.progressMeters > 0 &&
      progressJump > plausibleProgressDelta
    ) {
      callUsable = false;
      gpsStatus = "Implausible GPS jump — pace notes paused";
    }

    const accuracyAllowance = Number.isFinite(telemetry.accuracyMeters)
      ? telemetry.accuracyMeters * 1.5
      : 0;
    const offRouteThreshold = Math.max(OFF_ROUTE_METERS, accuracyAllowance);
    const wasOffRoute = this.#offRouteLatched;
    if (!demo) {
      if (
        this.#offRouteLatched &&
        callUsable &&
        match.distance < BACK_ON_ROUTE_METERS
      ) {
        this.#offRouteLatched = false;
      } else if (
        !this.#offRouteLatched &&
        callUsable &&
        match.distance > offRouteThreshold
      ) {
        this.#offRouteLatched = true;
      }
    }
    const offRoute = !demo && this.#offRouteLatched;

    let progressMeters =
      callUsable && !offRoute
        ? match.distanceAlongRoute
        : state.route.progressMeters;
    const resynced =
      !demo &&
      quality.usable &&
      match.reacquired &&
      match.distance <= offRouteThreshold &&
      isRouteHeadingCompatible({
        heading,
        headingDelta: match.headingDelta,
        speedMph: telemetry.speedMph,
      });
    if (resynced) {
      progressMeters = match.distanceAlongRoute;
      callUsable = false;
      this.#resyncAwaitingHeading = true;
      this.#directionConfirmed = false;
      gpsStatus = "Route position reacquired — confirming direction";
      this.#scheduler.rebase(state.route.curves, progressMeters);
      this.#audio.clear();
    }

    if (offRoute && !wasOffRoute) {
      this.#view.showToast("Off route. Pace notes paused.", {
        tone: "error",
        duration: 3_600,
      });
    } else if (wasOffRoute && !offRoute) {
      this.#view.showToast("Back on route. Pace notes resumed.", {
        tone: "success",
      });
    }

    const canAnnounce = callUsable && !offRoute && !resynced;
    if (!canAnnounce && !this.#callsPaused) {
      this.#audio.clear();
      this.#scheduler.rebase(state.route.curves, progressMeters);
      this.#callsPaused = true;
    } else if (canAnnounce && this.#callsPaused) {
      this.#callsPaused = false;
    }

    const schedule = this.#scheduler.update({
      curves: state.route.curves,
      progressMeters,
      speedMph: telemetry.speedMph,
      canAnnounce: canAnnounce && this.#audio.queueDepth < 2,
    });

    let session = this.#session.snapshot();
    if (quality.usable && !offRoute) {
      session = this.#session.update(telemetry.position, telemetry.speedMph, {
        timestamp: telemetry.timestamp,
        accuracyMeters: telemetry.accuracyMeters,
      });
    }

    const announcement = schedule.announcement;
    if (announcement) {
      session = this.#session.incrementTurns();
      if (schedule.linkedCurve) session = this.#session.incrementTurns();
      const generation = this.#modeGeneration;
      const finalCurveDistance =
        schedule.linkedCurve?.distanceFromStart ??
        announcement.distanceFromStart;
      const spokenText = this.#audio.announce(
        announcement,
        schedule.linkedCurve,
        {
          isValid: () => {
            const current = this.#store.getState();
            return (
              generation === this.#modeGeneration &&
              (current.mode === "tracking" || current.mode === "demo") &&
              current.route.progressMeters <= finalCurveDistance + 8
            );
          },
        },
      );
      const announcementGroupId = `${announcement.id}-${Date.now()}`;
      this.#recorder.addPaceNote(announcement, spokenText, {
        groupId: announcementGroupId,
        groupIndex: 0,
      });
      if (schedule.linkedCurve) {
        this.#recorder.addPaceNote(schedule.linkedCurve, spokenText, {
          groupId: announcementGroupId,
          groupIndex: 1,
        });
      }
      this.#view.flashCall();
    }

    if (quality.usable && !offRoute) {
      this.#recorder.addTrackPoint({ ...telemetry, heading });
    }
    const route = {
      ...state.route,
      remainingCurves: schedule.upcoming,
      closestIndex: match.index,
      segmentIndex: match.segmentIndex,
      progressMeters,
    };
    const nextTelemetry = {
      ...telemetry,
      heading,
      offRoute,
      gpsUsable: canAnnounce,
      gpsStatus: offRoute ? "Off route" : gpsStatus,
      routeDistanceMeters: match.distance,
    };
    this.#store.update((current) => ({
      ...current,
      route,
      telemetry: nextTelemetry,
      session,
    }));
    this.#audio.prune();
    this.#map.setUserPosition(telemetry.position, heading || 0, {
      follow: state.ui.followUser,
      animate: true,
    });

    const routeLength = state.route.cumulativeDistances.at(-1) || 0;
    const reachedEnd =
      progressMeters >= Math.max(0, routeLength - 35) &&
      distanceMeters(telemetry.position, state.route.endPoint) <
        COMPLETE_DISTANCE_METERS;
    if (!demo && reachedEnd && !this.#routeCompleted) {
      this.#routeCompleted = true;
      void this.#stopActiveMode({ completed: true });
    }
  }

  #handleTrackingError(error) {
    const state = this.#store.getState();
    this.#audio.clear();
    this.#scheduler.rebase(state.route.curves, state.route.progressMeters);
    this.#callsPaused = true;
    this.#store.update((state) => ({
      ...state,
      telemetry: {
        ...state.telemetry,
        gpsUsable: false,
        gpsStatus: error.message,
      },
    }));
    this.#view.showToast(`${error.message} Pace notes paused.`, {
      tone: "error",
      duration: 3_600,
    });
    if (error.fatal) void this.#stopActiveMode();
  }

  #checkGpsHeartbeat() {
    const state = this.#store.getState();
    if (state.mode !== "tracking" || !state.telemetry.gpsUsable) return;
    const quality = evaluateTelemetryQuality(state.telemetry);
    if (quality.usable) return;

    this.#audio.clear();
    this.#scheduler.rebase(state.route.curves, state.route.progressMeters);
    this.#callsPaused = true;
    this.#store.update((current) => ({
      ...current,
      telemetry: {
        ...current.telemetry,
        gpsUsable: false,
        gpsStatus: quality.reason,
      },
    }));
  }

  #toggleRecording() {
    const state = this.#store.getState();
    if (state.mode !== "tracking" && state.mode !== "demo") return;
    if (this.#recorder.active) {
      this.#stopRecording();
      return;
    }

    this.#recorder.start({
      engineVersion: state.route.engineVersion,
      noteSchemaVersion: state.route.noteSchemaVersion,
      profileId: state.route.profileId,
    });
    this.#store.update((current) => ({
      ...current,
      recording: { active: true },
    }));
    this.#view.showToast("Recording started.", { tone: "success" });
  }

  #stopRecording({ notify = true } = {}) {
    if (!this.#recorder.active) return { saved: false, data: null };
    const state = this.#store.getState();
    const data = this.#recorder.stop({ routeName: state.route.name });
    const saved = this.#recorder.download(data);
    this.#store.update((current) => ({
      ...current,
      recording: { active: false },
    }));

    if (notify) {
      this.#view.showToast(
        saved
          ? `Download requested · ${data.paceNoteCount} pace notes.`
          : "Not enough track data to save.",
        { tone: saved ? "success" : "error" },
      );
    }
    return { saved, data };
  }

  #centerMap() {
    this.#store.update((state) => ({
      ...state,
      ui: { ...state.ui, followUser: true },
    }));
    this.#map.followUser({ animate: true });
  }

  #toggleSound() {
    const enabled = !this.#store.getState().soundEnabled;
    this.#audio.setEnabled(enabled);
    this.#store.update((state) => ({ ...state, soundEnabled: enabled }));
    this.#view.showToast(
      enabled ? "Voice callouts on." : "Voice callouts muted.",
    );
  }
}

export function buildRoute(name, result, profileId = "numerical") {
  const cumulativeDistances = buildCumulativeDistances(result.coordinates);
  const curves = materializeCurves(analyzeCurves(result.coordinates), profileId);
  return {
    loaded: true,
    name,
    coordinates: result.coordinates,
    cumulativeDistances,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    curves,
    engineVersion: "geometry-v2",
    noteSchemaVersion: 2,
    profileId,
    remainingCurves: curves.map((curve) => ({
      ...curve,
      distance: Math.round(curve.distanceFromStart),
      callState: "pending",
    })),
    endPoint: result.coordinates.at(-1),
    closestIndex: 0,
    segmentIndex: 0,
    progressMeters: 0,
  };
}

export function materializeCurves(curves, profileId) {
  const facts = curves.map((curve) => {
    const enriched = {
      ...curve,
      schemaVersion: 2,
      engineVersion: "geometry-v2",
      source: "route-geometry",
      verified: false,
      entryDistanceMeters: curve.startDistance,
      apexDistanceMeters: curve.apexDistance,
      exitDistanceMeters: curve.endDistance,
      profileId,
    };
    const shortLabel = renderCornerCall(
      { ...enriched, modifiers: [], manualAnnotations: [], annotations: [] },
      profileId,
    )
      .replace(/^left /, "L ")
      .replace(/^right /, "R ");
    return {
      ...enriched,
      call: renderCornerCall(enriched, profileId),
      shortLabel,
    };
  });

  return facts.map((curve, index) => {
    const nextCurve = facts[index + 1];
    if (!nextCurve) return { ...curve, linkedCall: curve.call };

    const gapMeters = Math.max(
      0,
      nextCurve.entryDistanceMeters - curve.exitDistanceMeters,
    );
    const connectionToNext =
      gapMeters <= 50
        ? { kind: "and", meters: gapMeters }
        : { kind: "distance", meters: gapMeters };
    return {
      ...curve,
      connectionToNext,
      linkedCall: renderLinkedCall(
        curve,
        nextCurve,
        profileId,
        connectionToNext,
      ),
    };
  });
}

function rematerializeRoute(route, profileId) {
  const curves = materializeCurves(route.curves, profileId);
  const curvesById = new Map(curves.map((curve) => [curve.id, curve]));
  return {
    ...route,
    profileId,
    curves,
    remainingCurves: route.remainingCurves.map((curve) => ({
      ...(curvesById.get(curve.id) || curve),
      distance: curve.distance,
      callState: curve.callState,
    })),
  };
}

function resetRouteProgress(route) {
  return {
    ...route,
    closestIndex: 0,
    segmentIndex: 0,
    progressMeters: 0,
    remainingCurves: route.curves.map((curve) => ({
      ...curve,
      distance: Math.round(curve.distanceFromStart),
      callState: "pending",
    })),
  };
}
