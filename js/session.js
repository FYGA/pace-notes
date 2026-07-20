import { distanceMeters } from "./utils.js";

const METERS_TO_MILES = 0.000621371;

export class SessionTracker {
  #startedAt = null;
  #distanceMiles = 0;
  #topSpeedMph = 0;
  #turns = 0;
  #lastPosition = null;
  #lastTimestamp = null;
  #stoppedSnapshot = null;

  get active() {
    return this.#startedAt !== null;
  }

  start() {
    this.#startedAt = Date.now();
    this.#distanceMiles = 0;
    this.#topSpeedMph = 0;
    this.#turns = 0;
    this.#lastPosition = null;
    this.#lastTimestamp = null;
    this.#stoppedSnapshot = null;
  }

  stop() {
    const snapshot = this.snapshot();
    this.#startedAt = null;
    this.#lastPosition = null;
    this.#lastTimestamp = null;
    this.#stoppedSnapshot = { ...snapshot, active: false };
    return snapshot;
  }

  update(
    position,
    speedMph,
    { timestamp = Date.now(), accuracyMeters = null } = {},
  ) {
    if (!this.active || !position) return this.snapshot();

    const accurate = !Number.isFinite(accuracyMeters) || accuracyMeters <= 50;
    if (this.#lastPosition && accurate) {
      const segmentMeters = distanceMeters(this.#lastPosition, position);
      const elapsedSeconds = this.#lastTimestamp
        ? Math.max(0, (timestamp - this.#lastTimestamp) / 1000)
        : 0;
      const plausibleLimit =
        elapsedSeconds > 0 ? Math.max(40, elapsedSeconds * 90) : 120;
      if (segmentMeters >= 0.5 && segmentMeters <= plausibleLimit) {
        this.#distanceMiles += segmentMeters * METERS_TO_MILES;
      }
    }

    this.#lastPosition = [...position];
    this.#lastTimestamp = timestamp;
    const candidateSpeed = Number(speedMph) || 0;
    if (accurate && candidateSpeed >= 0 && candidateSpeed <= 220) {
      this.#topSpeedMph = Math.max(this.#topSpeedMph, candidateSpeed);
    }
    return this.snapshot();
  }

  incrementTurns() {
    if (this.active) this.#turns += 1;
    return this.snapshot();
  }

  snapshot() {
    if (!this.active && this.#stoppedSnapshot)
      return { ...this.#stoppedSnapshot };
    return {
      active: this.active,
      distanceMiles: this.#distanceMiles,
      elapsedMs: this.active ? Date.now() - this.#startedAt : 0,
      turns: this.#turns,
      topSpeedMph: this.#topSpeedMph,
    };
  }
}

export class WakeLockService {
  #sentinel = null;
  #requestPromise = null;
  #onChange = null;

  constructor(onChange = () => {}) {
    this.#onChange = onChange;
  }

  async request() {
    if (!("wakeLock" in navigator)) return false;
    if (this.#sentinel) return true;
    if (this.#requestPromise) return this.#requestPromise;

    this.#requestPromise = (async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        this.#sentinel = sentinel;
        this.#onChange(true);
        sentinel.addEventListener("release", () => {
          if (this.#sentinel !== sentinel) return;
          this.#sentinel = null;
          this.#onChange(false);
        });
        return true;
      } catch {
        this.#onChange(false);
        return false;
      } finally {
        this.#requestPromise = null;
      }
    })();
    return this.#requestPromise;
  }

  async release() {
    if (this.#requestPromise) await this.#requestPromise;
    if (!this.#sentinel) return;
    const sentinel = this.#sentinel;
    try {
      await sentinel.release();
    } finally {
      if (this.#sentinel === sentinel) {
        this.#sentinel = null;
        this.#onChange(false);
      }
    }
  }
}
