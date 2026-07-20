const SEVERITY_LEAD_SECONDS = Object.freeze({
  1: 5,
  2: 4.5,
  3: 4,
  4: 3.5,
  5: 3,
  6: 2.5,
});
const MAX_LINKED_GAP_METERS = 200;
const MAX_SCHEDULING_SPEED_MPH = 180;

export const GPS_LIMITS = Object.freeze({
  maximumAccuracyMeters: 50,
  maximumAgeMs: 10_000,
});

export function isRouteHeadingCompatible(
  { heading, headingDelta, speedMph },
  { minimumSpeedMph = 8, maximumHeadingDelta = 70 } = {},
) {
  if ((Number(speedMph) || 0) < minimumSpeedMph) return true;
  return (
    Number.isFinite(heading) &&
    Number.isFinite(headingDelta) &&
    headingDelta <= maximumHeadingDelta
  );
}

export function canConfirmRouteDirection(values, options) {
  const minimumSpeedMph = options?.minimumSpeedMph ?? 8;
  return (
    (Number(values?.speedMph) || 0) >= minimumSpeedMph &&
    isRouteHeadingCompatible(values, options)
  );
}

export function evaluateTelemetryQuality(
  telemetry,
  { now = Date.now(), demo = false } = {},
) {
  if (demo) return { usable: true, reason: null, ageMs: 0 };
  if (!telemetry?.position) {
    return {
      usable: false,
      reason: "Waiting for GPS position",
      ageMs: Infinity,
    };
  }

  const ageMs = Number.isFinite(telemetry.timestamp)
    ? Math.max(0, now - telemetry.timestamp)
    : Infinity;
  if (ageMs > GPS_LIMITS.maximumAgeMs) {
    return { usable: false, reason: "GPS position is stale", ageMs };
  }

  if (
    !Number.isFinite(telemetry.accuracyMeters) ||
    telemetry.accuracyMeters > GPS_LIMITS.maximumAccuracyMeters
  ) {
    return { usable: false, reason: "GPS accuracy is too low", ageMs };
  }

  return { usable: true, reason: null, ageMs };
}

export function estimateSpeechDurationSeconds(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return words ? Math.max(0.8, words / 2.7) : 0;
}

export function callLookaheadMeters(curve, speedMph, phrase = curve?.call) {
  const boundedSpeedMph = Math.min(
    MAX_SCHEDULING_SPEED_MPH,
    Math.max(0, Number(speedMph) || 0),
  );
  const speedMetersPerSecond = boundedSpeedMph * 0.44704;
  const severityLead = SEVERITY_LEAD_SECONDS[curve?.severity] || 4;
  const speechLead = estimateSpeechDurationSeconds(phrase) + 1.2;
  return Math.max(
    60,
    speedMetersPerSecond * Math.max(severityLead, speechLead),
  );
}

export class CallScheduler {
  #states = new Map();

  reset(curves = []) {
    this.#states = new Map(curves.map((curve) => [curve.id, "pending"]));
  }

  rebase(curves, progressMeters) {
    this.#states = new Map(
      curves.map((curve) => [
        curve.id,
        routeDistance(curve) < progressMeters - 8 ? "passed" : "pending",
      ]),
    );
  }

  stateFor(curveId) {
    return this.#states.get(curveId) || "pending";
  }

  markSpoken(curveId) {
    if (curveId) this.#states.set(curveId, "spoken");
  }

  update({ curves, progressMeters, speedMph = 0, canAnnounce = true }) {
    const positioned = curves
      .map((curve) => {
        if (!this.#states.has(curve.id)) this.#states.set(curve.id, "pending");
        const distance = Math.round(routeDistance(curve) - progressMeters);
        if (distance < -8) this.#states.set(curve.id, "passed");
        return { ...curve, distance, callState: this.stateFor(curve.id) };
      })
      .filter((curve) => curve.callState !== "passed")
      .sort((left, right) => left.distance - right.distance);

    if (!canAnnounce) {
      return { upcoming: positioned, announcement: null, linkedCurve: null };
    }

    const announcementIndex = positioned.findIndex((curve, index) => {
      const nextCurve = positioned[index + 1];
      const gap = nextCurve ? linkGapMeters(curve, nextCurve) : Infinity;
      const phrase =
        nextCurve?.callState === "pending" &&
        gap >= 0 &&
        gap <= MAX_LINKED_GAP_METERS
          ? curve.linkedCall || `${curve.call}, and, ${nextCurve.call}`
          : curve.call;
      return (
        curve.callState === "pending" &&
        curve.distance >= -8 &&
        curve.distance <= callLookaheadMeters(curve, speedMph, phrase)
      );
    });
    const announcement =
      announcementIndex >= 0 ? positioned[announcementIndex] : null;

    let linkedCurve = null;
    if (announcement) {
      this.markSpoken(announcement.id);
      announcement.callState = "spoken";
      const nextCurve = positioned[announcementIndex + 1];
      const gap = nextCurve
        ? linkGapMeters(announcement, nextCurve)
        : Infinity;
      if (
        nextCurve?.callState === "pending" &&
        gap >= 0 &&
        gap <= MAX_LINKED_GAP_METERS
      ) {
        this.markSpoken(nextCurve.id);
        nextCurve.callState = "spoken";
        linkedCurve = nextCurve;
      }
    }

    return {
      upcoming: positioned,
      announcement: announcement || null,
      linkedCurve,
    };
  }
}

function routeDistance(curve) {
  return curve?.entryDistanceMeters ?? curve?.distanceFromStart ?? Infinity;
}

function linkGapMeters(current, next) {
  const currentExit =
    current?.exitDistanceMeters ?? current?.endDistance ?? routeDistance(current);
  return routeDistance(next) - currentExit;
}
