import { SEVERITY_COLORS as t } from "./curves.js";
import {
  compassDirection as e,
  formatDuration as o,
  formatElapsed as n,
} from "./utils.js";
export function renderState(s, i) {
  ((s.app.dataset.mode = i.mode),
    s.settingsPanel.classList.toggle("is-hidden", !i.ui.settingsOpen),
    s.closeSettingsButton.classList.toggle("is-hidden", !i.initialized),
    setBackgroundInert(s, i.ui.settingsOpen, i.ui.routeOpen),
    s.routePanel.classList.toggle("is-hidden", !i.ui.routeOpen));
  const a = i.hasSavedToken && !i.ui.showTokenInput;
  const selectedPlanCandidate = i.routePlan.candidates.find(
    (candidate) => candidate.id === i.routePlan.selectedId,
  );
  const summaryRoute =
    selectedPlanCandidate?.route ||
    (i.routePlan.status === "loading" ? { loaded: false } : i.route);
  (s.savedTokenView.classList.toggle("is-hidden", !a),
    s.tokenForm.classList.toggle("is-hidden", a),
    (s.maskedToken.textContent = i.maskedToken),
    (s.paceNoteProfile.value = i.preferences.paceNoteProfile),
    (s.preferWinding.checked = i.preferences.preferWindingRoutes),
    s.routeForm.classList.toggle("is-hidden", i.ui.routeMode !== "destination"),
    s.loopForm.classList.toggle("is-hidden", i.ui.routeMode !== "loop"),
    s.destinationModeButton.classList.toggle(
      "is-active",
      i.ui.routeMode === "destination",
    ),
    s.loopModeButton.classList.toggle("is-active", i.ui.routeMode === "loop"),
    s.destinationModeButton.setAttribute(
      "aria-pressed",
      String(i.ui.routeMode === "destination"),
    ),
    s.loopModeButton.setAttribute(
      "aria-pressed",
      String(i.ui.routeMode === "loop"),
    ),
    renderRouteCandidates(s, i),
    s.routeSummary.classList.toggle("is-hidden", !summaryRoute.loaded),
    (s.routeName.textContent = summaryRoute.name || "Destination"),
    (s.routeDistance.textContent = summaryRoute.loaded
      ? `${(summaryRoute.distanceMeters / 1609.344).toFixed(1)} mi`
      : "—"),
    (s.routeDuration.textContent = summaryRoute.loaded
      ? o(summaryRoute.durationSeconds)
      : "—"),
    (s.routeCurves.textContent = summaryRoute.loaded
      ? String(summaryRoute.curves.length)
      : "—"),
    (s.routeStyle.textContent = summaryRoute.loaded
      ? summaryRoute.styleLabel || "Direct"
      : "—"),
    (function (t, e) {
      const o = "tracking" === e.mode,
        n = "demo" === e.mode,
        s = "loading-demo" === e.mode;
      ((t.startDrivingButton.disabled =
        (!e.route.loaded && !e.routePlan.selectedId) || e.busy || o || n),
        (t.connectMapButton.disabled = e.busy),
        (t.useSavedTokenButton.disabled = e.busy),
        (t.changeTokenButton.disabled = e.busy),
        (t.tokenInput.disabled = e.busy),
        (t.paceNoteProfile.disabled = e.busy || e.mode !== "idle"),
        (t.loadRouteButton.disabled = e.busy),
        (t.loadLoopButton.disabled = e.busy),
        (t.loopDistance.disabled = e.busy),
        (t.destinationModeButton.disabled = e.busy),
        (t.loopModeButton.disabled = e.busy),
        (t.preferWinding.disabled = e.busy),
        (t.startButton.disabled = !e.route.loaded || e.busy || n),
        t.startButton.classList.toggle("button--primary", !o),
        t.startButton.classList.toggle("button--danger", o),
        (t.startButton.querySelector(".button-icon").textContent = o
          ? "■"
          : "▶"),
        (t.startButton.querySelector(".button-label").textContent = o
          ? "Stop"
          : "Start"),
        (t.demoButton.disabled = !e.initialized || (e.busy && !s)),
        (t.demoButton.querySelector(".button-icon").textContent = n
          ? "■"
          : "◆"),
        (t.demoButton.querySelector(".button-label").textContent = s
          ? "Loading…"
          : n
            ? "Stop demo"
            : "Demo"),
        (t.routeButton.disabled =
          !e.initialized || e.busy || e.mode !== "idle"),
        (t.settingsButton.disabled = e.busy || e.mode !== "idle"),
        (t.centerButton.disabled = !e.telemetry.position),
        (t.recordButton.disabled = !o && !n),
        t.recordButton.classList.toggle("is-recording", e.recording.active),
        t.centerButton.classList.toggle("is-active", e.ui.followUser),
        t.soundButton.classList.toggle("is-active", e.soundEnabled),
        t.recordButton.setAttribute("aria-pressed", String(e.recording.active)),
        t.centerButton.setAttribute("aria-pressed", String(e.ui.followUser)),
        t.soundButton.setAttribute("aria-pressed", String(e.soundEnabled)),
        (t.soundButton.textContent = e.soundEnabled ? "◖))" : "◖×"));
    })(s, i),
    (function (t, o) {
      ((t.speed.textContent = String(Math.round(o.telemetry.speedMph || 0))),
        (t.heading.textContent = e(o.telemetry.heading)),
        (t.curves.textContent = String(o.route.remainingCurves.length)));
    })(s, i),
    (function (t, e) {
      const o = e.route.remainingCurves[0];
      const n = "tracking" === e.mode && !e.telemetry.gpsUsable;
      ((t.callText.className = "pace-call"),
        e.telemetry.offRoute
          ? ((t.distance.textContent = "!"),
            setText(t.callText, "Off route"),
            (t.callDescription.textContent =
              "Pace notes paused until the route match is reliable"))
          : n
            ? ((t.distance.textContent = "—"),
              setText(t.callText, "GPS uncertain"),
              (t.callDescription.textContent =
                e.telemetry.gpsStatus || "Pace notes paused"))
            : o
              ? ((t.distance.textContent = `${Math.max(0, Math.round(o.distance))}m`),
                setText(t.callText, o.call),
                t.callText.classList.add(`severity-${o.severity}`),
                (t.callDescription.textContent = `Generated geometry draft · ${o.description}`))
              : e.busy && "loading-route" === e.mode
                ? ((t.distance.textContent = "…"),
                  setText(t.callText, "Building pace notes"),
                  (t.callDescription.textContent =
                    "Calculating the route and analyzing road geometry"))
                : e.route.loaded
                  ? ((t.distance.textContent = "—"),
                    setText(t.callText, "Clear road ahead"),
                    (t.callDescription.textContent = e.telemetry.offRoute
                      ? "You appear to be off the loaded route"
                      : e.route.name))
                  : ((t.distance.textContent = "—"),
                    setText(t.callText, "Load a route to begin"),
                    (t.callDescription.textContent =
                      "Destination-based rally-style guidance")));
      const upcomingNotes = e.route.remainingCurves.slice(0, 4).map((t) => {
        const e = document.createElement("div");
        e.className = "upcoming-note";
        const o = document.createElement("span");
        ((o.className = "upcoming-note__distance"),
          (o.textContent = `${Math.max(0, Math.round(t.distance))} m`));
        const n = document.createElement("span");
        return (
          (n.className = `upcoming-note__call severity-${t.severity}`),
          (n.textContent = t.call),
          e.append(o, n),
          e
        );
      });
      t.upcoming.replaceChildren(...upcomingNotes);
    })(s, i),
    (function (t, e) {
      const showCompleted =
        e.telemetry.gpsStatus === "Route complete" && e.session.elapsedMs > 0;
      (t.sessionPanel.classList.toggle(
        "is-hidden",
        !e.session.active && !showCompleted,
      ),
        (t.sessionDistance.textContent = `${e.session.distanceMiles.toFixed(1)} mi`),
        (t.sessionTime.textContent = n(e.session.elapsedMs)),
        (t.sessionTurns.textContent = String(e.session.turns)),
        (t.sessionTopSpeed.textContent = `${Math.round(e.session.topSpeedMph)} mph`));
    })(s, i),
    (function (t, e) {
      const o = "tracking" === e.mode || "demo" === e.mode;
      if (
        (t.gpsChip.classList.toggle("is-hidden", !o),
        t.wakeChip.classList.toggle("is-hidden", !e.wakeLockActive),
        !o)
      )
        return;
      if ("demo" === e.mode)
        return (
          (t.gpsText.textContent = "DEMO"),
          void (t.gpsDot.className = "status-dot")
        );
      const n = e.telemetry.accuracyMeters;
      ((t.gpsText.textContent = Number.isFinite(n)
        ? `±${Math.round(n)}m`
        : "GPS"),
        (t.gpsDot.className = "status-dot"),
        !e.telemetry.gpsUsable
          ? t.gpsDot.classList.add("is-poor")
          : n >= 30
            ? t.gpsDot.classList.add("is-poor")
            : n >= 12 && t.gpsDot.classList.add("is-medium"));
    })(s, i),
    (function (e, o) {
      const n = o.route.remainingCurves[0];
      if (
        o.telemetry.offRoute ||
        ("tracking" === o.mode && !o.telemetry.gpsUsable) ||
        !n ||
        n.distance <= 0 ||
        n.distance >= 150 ||
        n.severity > 5
      )
        return (
          (e.approachGlow.style.opacity = "0"),
          void e.approachGlow.removeAttribute("data-direction")
        );
      const s = 0.72 * Math.max(0, 1 - n.distance / 150);
      ((e.approachGlow.dataset.direction = n.direction),
        e.approachGlow.style.setProperty("--glow-color", t[n.severity]),
        (e.approachGlow.style.opacity = s.toFixed(2)));
    })(s, i));
}

function setBackgroundInert(elements, settingsOpen, routeOpen) {
  const activePanel = settingsOpen
    ? elements.settingsPanel
    : routeOpen
      ? elements.routePanel
      : null;
  activePanel?.removeAttribute("inert");
  for (const child of elements.app.children) {
    if (child !== activePanel) {
      child.toggleAttribute("inert", Boolean(activePanel));
    }
  }
}

function renderRouteCandidates(elements, state) {
  const cards = state.routePlan.candidates.map((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-candidate";
    button.dataset.candidateId = candidate.id;
    button.setAttribute("role", "radio");
    button.setAttribute(
      "aria-checked",
      String(candidate.id === state.routePlan.selectedId),
    );
    button.tabIndex = candidate.id === state.routePlan.selectedId ? 0 : -1;

    const label = document.createElement("strong");
    label.textContent = candidate.label;
    const score = document.createElement("span");
    score.textContent = Number.isFinite(candidate.score)
      ? `Winding estimate ${Math.round(candidate.score)}/100`
      : "Provider route";
    const facts = document.createElement("span");
    facts.textContent = `${(candidate.route.distanceMeters / 1609.344).toFixed(1)} mi · ${o(candidate.route.durationSeconds)} · ${candidate.route.curves.length} curves`;
    button.append(label, score, facts);
    return button;
  });
  elements.routeCandidates.replaceChildren(...cards);
  elements.routeCandidates.classList.toggle("is-hidden", cards.length < 2);

  const notice = state.routePlan.error || state.routePlan.notice || "";
  elements.routePlanNotice.textContent = notice;
  elements.routePlanNotice.classList.toggle("is-hidden", !notice);
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}
