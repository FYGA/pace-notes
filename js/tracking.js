import { bearingDegrees, distanceMeters } from "./utils.js";

const POSITION_HISTORY_LIMIT = 8;

export class PositionTracker {
  #watchId = null;
  #history = [];

  get active() {
    return this.#watchId !== null;
  }

  async getCurrentPosition() {
    if (!navigator.geolocation)
      throw new Error("Geolocation is not supported on this device.");

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(toTelemetry(position, this.#history)),
        (error) => reject(geolocationError(error)),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 2_000 },
      );
    });
  }

  start({ onPosition, onError }) {
    if (!navigator.geolocation) {
      const error = new Error("Geolocation is not supported on this device.");
      error.code = "UNSUPPORTED";
      error.fatal = true;
      throw error;
    }
    this.stop();
    this.#history = [];

    this.#watchId = navigator.geolocation.watchPosition(
      (position) => {
        const telemetry = toTelemetry(position, this.#history);
        this.#history.push({
          position: telemetry.position,
          time: telemetry.timestamp,
        });
        if (this.#history.length > POSITION_HISTORY_LIMIT)
          this.#history.shift();
        onPosition(telemetry);
      },
      (error) => onError(geolocationError(error)),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  stop() {
    if (this.#watchId !== null) {
      navigator.geolocation.clearWatch(this.#watchId);
      this.#watchId = null;
    }
    this.#history = [];
  }
}

function toTelemetry(position, history) {
  const { latitude, longitude, accuracy, heading, speed } = position.coords;
  const coordinate = [longitude, latitude];
  const movementHeading = headingFromHistory(history, coordinate);
  const inferredSpeedMph = speedFromHistory(
    history,
    coordinate,
    position.timestamp,
  );
  const normalizedHeading = Number.isFinite(movementHeading)
    ? movementHeading
    : Number.isFinite(heading)
      ? heading
      : null;

  return {
    position: coordinate,
    speedMph:
      Number.isFinite(speed) && speed >= 0
        ? Math.round(speed * 2.23694)
        : inferredSpeedMph,
    heading: normalizedHeading,
    accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: position.timestamp || Date.now(),
  };
}

function speedFromHistory(history, currentPosition, timestamp) {
  if (!history.length || !Number.isFinite(timestamp)) return 0;
  const anchor = history[Math.max(0, history.length - 3)];
  const elapsedSeconds = (timestamp - anchor.time) / 1000;
  if (elapsedSeconds <= 0) return 0;

  const meters = distanceMeters(anchor.position, currentPosition);
  if (meters < 1) return 0;
  const metersPerSecond = meters / elapsedSeconds;
  if (!Number.isFinite(metersPerSecond) || metersPerSecond > 100) return 0;
  return Math.round(metersPerSecond * 2.23694);
}

function headingFromHistory(history, currentPosition) {
  if (history.length < 2) return null;
  const anchor = history[Math.max(0, history.length - 4)];
  if (distanceMeters(anchor.position, currentPosition) < 5) return null;
  return bearingDegrees(anchor.position, currentPosition);
}

function geolocationError(error) {
  const messages = {
    1: "Location access was denied. Enable it in browser settings.",
    2: "Your current position is unavailable.",
    3: "GPS timed out. Try again with a clearer view of the sky.",
  };
  const normalized = new Error(messages[error.code] || "A GPS error occurred.");
  normalized.code = error.code;
  normalized.fatal = error.code === 1;
  return normalized;
}
