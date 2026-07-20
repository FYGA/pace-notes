export class Recorder {
  static MAX_TRACK_POINTS = 30_000;

  #active = false;
  #startedAt = null;
  #track = [];
  #notes = [];
  #minimumTrackIntervalMs = 250;
  #lastTrackTimeMs = -Infinity;
  #paceNoteSystem = null;

  get active() {
    return this.#active;
  }

  start({
    engineVersion = "geometry-v2",
    noteSchemaVersion = 2,
    profileId = "numerical",
  } = {}) {
    this.#active = true;
    this.#startedAt = Date.now();
    this.#track = [];
    this.#notes = [];
    this.#minimumTrackIntervalMs = 250;
    this.#lastTrackTimeMs = -Infinity;
    this.#paceNoteSystem = { engineVersion, noteSchemaVersion, profileId };
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

  addPaceNote(curve, spokenText, announcement = {}) {
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
      noteSchemaVersion: curve.schemaVersion ?? 2,
      noteId: curve.id ?? null,
      engineVersion: curve.engineVersion ?? this.#paceNoteSystem.engineVersion,
      profileId: curve.profileId ?? this.#paceNoteSystem.profileId,
      source: curve.source ?? "route-geometry",
      verified: curve.verified === true,
      distanceFromStart: curve.distanceFromStart,
      entryDistanceMeters:
        curve.entryDistanceMeters ?? curve.startDistance ?? curve.distanceFromStart,
      apexDistanceMeters: curve.apexDistanceMeters ?? curve.apexDistance ?? null,
      exitDistanceMeters: curve.exitDistanceMeters ?? curve.endDistance ?? null,
      shape: curve.shape ?? "normal",
      modifiers: cloneValue(curve.modifiers ?? []),
      geometry: cloneValue({
        angleDegrees: curve.totalAngle ?? curve.angle,
        arcLengthMeters: curve.arcLengthMeters ?? null,
        entryRadiusMeters: curve.entryRadiusMeters ?? null,
        peakRadiusMeters: curve.peakRadiusMeters ?? curve.radiusMeters,
        exitRadiusMeters: curve.exitRadiusMeters ?? null,
        sustainedRadiusMeters: curve.radiusMeters,
        entryCurvature: curve.entryCurvature ?? null,
        peakCurvature: curve.peakCurvature ?? null,
        sustainedCurvature: curve.sustainedCurvature ?? null,
        exitCurvature: curve.exitCurvature ?? null,
      }),
      announcementGroupId: announcement.groupId ?? null,
      groupIndex: announcement.groupIndex ?? 0,
    });
  }

  stop({ routeName = "Route" } = {}) {
    if (!this.#active) return null;

    this.#active = false;
    const exportData = {
      schemaVersion: 3,
      name: `${routeName} · ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - this.#startedAt,
      trackPoints: this.#track.length,
      paceNoteCount: this.#notes.length,
      paceNoteSystem: cloneValue(this.#paceNoteSystem),
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

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
