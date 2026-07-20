export class Recorder {
  static MAX_TRACK_POINTS = 30_000;

  #active = false;
  #startedAt = null;
  #track = [];
  #notes = [];
  #minimumTrackIntervalMs = 250;
  #lastTrackTimeMs = -Infinity;

  get active() {
    return this.#active;
  }

  start() {
    this.#active = true;
    this.#startedAt = Date.now();
    this.#track = [];
    this.#notes = [];
    this.#minimumTrackIntervalMs = 250;
    this.#lastTrackTimeMs = -Infinity;
  }

  addTrackPoint({ position, speedMph, heading, accuracyMeters, timestamp }) {
    if (!this.#active || !position) return;
    const timeMs = Number.isFinite(timestamp)
      ? Math.max(0, timestamp - this.#startedAt)
      : Date.now() - this.#startedAt;
    if (timeMs - this.#lastTrackTimeMs < this.#minimumTrackIntervalMs) return;

    if (this.#track.length >= Recorder.MAX_TRACK_POINTS) {
      this.#track = this.#track.filter((_, index) => index % 2 === 0);
      this.#minimumTrackIntervalMs *= 2;
    }

    this.#track.push({
      position: [...position],
      speedMph,
      heading,
      accuracyMeters,
      timeMs,
    });
    this.#lastTrackTimeMs = timeMs;
  }

  addPaceNote(curve, spokenText) {
    if (!this.#active) return;
    this.#notes.push({
      position: [...curve.position],
      call: curve.call,
      spoken: spokenText,
      severity: curve.severity,
      direction: curve.direction,
      angle: curve.angle,
      radiusMeters: curve.radiusMeters,
      caution: curve.caution || null,
      timeMs: Date.now() - this.#startedAt,
    });
  }

  stop({ routeName = "Route" } = {}) {
    if (!this.#active) return null;

    this.#active = false;
    const exportData = {
      schemaVersion: 2,
      name: `${routeName} · ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - this.#startedAt,
      trackPoints: this.#track.length,
      paceNoteCount: this.#notes.length,
      track: this.#track,
      paceNotes: this.#notes,
    };

    return exportData;
  }

  download(data) {
    if (!data || data.trackPoints < 2) return false;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pace-notes-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  }
}
