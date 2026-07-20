export class Recorder {
  #active = false;
  #startedAt = null;
  #track = [];
  #notes = [];

  get active() {
    return this.#active;
  }

  start() {
    this.#active = true;
    this.#startedAt = Date.now();
    this.#track = [];
    this.#notes = [];
  }

  addTrackPoint({ position, speedMph, heading, accuracyMeters }) {
    if (!this.#active || !position) return;
    this.#track.push({
      position: [...position],
      speedMph,
      heading,
      accuracyMeters,
      timeMs: Date.now() - this.#startedAt,
    });
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
      timeMds: Date.now() - this.#startedAt,
    });
  }

  stop({ routeName = 'Route' } = {}) {
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

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pace-notes-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  }
}
