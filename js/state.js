export const createEmptyRoute = () => ({
  loaded: false,
  name: "",
  coordinates: [],
  cumulativeDistances: [],
  distanceMeters: 0,
  durationSeconds: 0,
  curves: [],
  remainingCurves: [],
  endPoint: null,
  closestIndex: 0,
  segmentIndex: 0,
  progressMeters: 0,
});

export const createInitialState = ({
  hasSavedToken = false,
  maskedToken = "",
} = {}) => ({
  initialized: false,
  mapReady: false,
  mode: "idle",
  busy: false,
  soundEnabled: true,
  wakeLockActive: false,
  hasSavedToken,
  maskedToken,
  telemetry: {
    position: null,
    speedMph: 0,
    heading: null,
    accuracyMeters: null,
    timestamp: null,
    offRoute: false,
    gpsUsable: false,
    gpsStatus: null,
    routeDistanceMeters: null,
  },
  route: createEmptyRoute(),
  session: {
    active: false,
    distanceMiles: 0,
    elapsedMs: 0,
    turns: 0,
    topSpeedMph: 0,
  },
  recording: {
    active: false,
  },
  ui: {
    settingsOpen: true,
    showTokenInput: !hasSavedToken,
    routeOpen: false,
    followUser: true,
  },
});

export class Store {
  #state;
  #subscribers = new Set();

  constructor(initialState) {
    this.#state = initialState;
  }

  getState() {
    return this.#state;
  }

  update(updater) {
    const nextState =
      typeof updater === "function"
        ? updater(this.#state)
        : { ...this.#state, ...updater };

    if (!nextState || nextState === this.#state) return;
    this.#state = nextState;
    this.#subscribers.forEach((subscriber) => subscriber(this.#state));
  }

  subscribe(subscriber) {
    this.#subscribers.add(subscriber);
    subscriber(this.#state);
    return () => this.#subscribers.delete(subscriber);
  }
}
