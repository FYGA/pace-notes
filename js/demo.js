import { bearingDegrees, indexAtDistance } from './utils.js';

export const DEMO_ROUTE = Object.freeze({
  name: 'Pikes Peak Hill Climb Demo',
  start: [-105.0675561764574, 38.86176996714182],
  end: [-105.04432838005656, 38.8397878232719],
});

export class DemoRunner {
  #frameId = null;
  #route = null;
  #distance = 0;
  #lastTimestamp = null;
  #onPosition = null;
  #onLoop = null;

  get active() {
    return this.#frameId !== null;
  }

  start(route, { onPosition, onLoop = () => {} }) {
    this.stop();
    this.#route = route;
    this.#distance = 0;
    this.#lastTimestamp = null;
    this.#onPosition = onPosition;
    this.#onLoop = onLoop;
    this.#frameId = requestAnimationFrame((timestamp) => this.#tick(timestamp));
  }

  stop() {
    if (this.#frameId !== null) cancelAnimationFrame(this.#frameId);
    this.#frameId = null;
    this.#route = null;
    this.#lastTimestamp = null;
  }

  #tick(timestamp) {
    if (!this.#route) return;

    if (this.#lastTimestamp === null) this.#lastTimestamp = timestamp;
    const deltaSeconds = Math.min((timestamp - this.#lastTimestamp) / 1000, 0.25);
    this.#lastTimestamp = timestamp;

    const nextCurve = this.#route.curves.find((curve) => curve.distanceFromStart >= this.#distance);
    const distanceToCurve = nextCurve ? nextCurve.distanceFromStart - this.#distance : Infinity;
    const targetSpeed = nextCurve && distanceToCurve < 150
      ? Math.max(18, 48 - (6 - nextCurve.severity) * 6)
      : 48;

    this.#distance += targetSpeed * 0.44704 * deltaSeconds;
    if (this.#distance >= this.#route.distanceMeters) {
      this.#distance = 0;
      this.#onLoop();
    }

    const telemetry = telemetryAtDistance(this.#route, this.#distance, targetSpeed);
    this.#onPosition(telemetry);
    this.#frameId = requestAnimationFrame((nextTimestamp) => this.#tick(nextTimestamp));
  }
}

function telemetryAtDistance(route, distance, speedMph) {
  const index = indexAtDistance(route.cumulativeDistances, distance);
  const nextIndex = Math.min(index + 1, route.coordinates.length - 1);
  const position = route.coordinates[index];
  const heading = index === nextIndex ? 0 : bearingDegrees(position, route.coordinates[nextIndex]);

  return {
    position: [...position],
    speedMph: Math.round(speedMph),
    heading,
    accuracyMeters: 3,
    timestamp: Date.now(),
  };
}
