import { distanceMeters } from './utils.js';

const METERS_TO_MILES = 0.000621371;

export class SessionTracker {
  #startedAt = null;
  #distanceMiles = 0;
  #topSpeedMph = 0;
  #turns = 0;
  #lastPosition = null;

  get active() {
    return this.#startedAt !== null;
  }

  start() {
    this.#startedAt = Date.now();
    this.#distanceMiles = 0;
    this.#topSpeedMph = 0;
    this.#turns = 0;
    this.#lastPosition = null;
  }

  stop() {
    const snapshot = this.snapshot();
    this.#startedAt = null;
    this.#lastPosition = null;
    return snapshot;
  }

  update(position, speedMph) {
    if (!this.active || !position) return this.snapshot();

    if (this.#lastPosition) {
      const segmentMeters = distanceMeters(this.#lastPosition, position);
      if (segmentMeters >= 0.5 && segmentMeters <= 120) {
        this.#distanceMiles += segmentMeters * METERS_TO_MILES;
      }
    }

    this.#lastPosition = [...position];
    this.#topSpeedMph = Math.max(this.#topSpeedMph, Number(speedMph) || 0);
    return this.snapshot();
  }

  incrementTurns() {
    if (this.active) this.#turns += 1;
    return this.snapshot();
  }

  snapshot() {
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
  #onChange = null;

  constructor(onChange = () => {}) {
    this.#onChange = onChange;
  }

  async request() {
    if (!('wakeLock' in navigator)) return false;

    try {
      this.#sentinel = await navigator.wakeLock.request('screen');
      this.#onChange(true);
      this.#sentinel.addEventListener('release', () => {
        this.#sentinel = null;
        this.#onChange(false);
      });
      return true;
    } catch {
      this.#onChange(false);
      return false;
    }
  }

  async release() {
    if (!this.#sentinel) return;
    try {
      await this.#sentinel.release();
    } finally {
      this.#sentinel = null;
      this.#onChange(false);
    }
  }
}
