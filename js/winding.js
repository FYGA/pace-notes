const EARTH_RADIUS_METERS = 6_371_000;
const MIN_HEADING_SEGMENT_METERS = 8;
const MAX_ARTIFACT_SEGMENTS = 320;

export const WINDING_ROUTE_RANKING_NOTICE =
  "Winding score ranks route geometry only. It is not a speed, difficulty, or safety rating.";

const DEFAULT_SCORING_OPTIONS = Object.freeze({
  fullWindingScoreDegreesPerKm: 240,
  detourToleranceRatio: 1.3,
  excessiveDetourRatio: 1.8,
  detourPenaltyPerRatio: 90,
  excessiveDetourPenaltyPerRatio: 120,
  targetDistancePenaltyPerRatio: 120,
  uTurnPenalty: 28,
  loopArtifactPenalty: 24,
});

/**
 * Analyze and score one provider-neutral route candidate.
 *
 * A candidate needs `{ coordinates: [[longitude, latitude], ...] }` and may
 * include `id` and `distanceMeters`. The score is a geometry-ranking signal;
 * it deliberately makes no claim about speed, difficulty, grip, or safety.
 */
export function scoreWindingRoute(candidate, options = {}) {
  const normalized = normalizeCandidate(candidate);
  const scoring = normalizeScoringOptions(options);
  const referenceDistanceMeters = positiveNumber(
    options.referenceDistanceMeters ?? candidate.referenceDistanceMeters,
  );
  const detourReference = referenceDistanceMeters || normalized.distanceMeters;
  const detourRatio = normalized.distanceMeters / detourReference;
  const targetDistanceMeters = positiveNumber(options.targetDistanceMeters);
  const targetDistanceRatio = targetDistanceMeters
    ? normalized.distanceMeters / targetDistanceMeters
    : 1;

  const headings = segmentHeadings(
    simplifyForHeadingAnalysis(normalized.coordinates),
  );
  const headingDeltas = headings.slice(1).map((heading, index) =>
    normalizeAngleDelta(heading - headings[index]),
  );
  const absoluteHeadingChangeDegrees = headingDeltas.reduce(
    (sum, delta) => sum + Math.abs(delta),
    0,
  );
  const rankingHeadingChangeDegrees = headingDeltas.reduce(
    (sum, delta) => sum + Math.min(120, Math.abs(delta)),
    0,
  );
  const distanceKilometers = normalized.distanceMeters / 1_000;
  const headingChangeDegreesPerKm =
    distanceKilometers > 0 ? rankingHeadingChangeDegrees / distanceKilometers : 0;
  const uTurnCount = headingDeltas.filter(
    (delta) => Math.abs(delta) >= 145,
  ).length;
  const loopArtifactCount = countSelfIntersections(normalized.coordinates);

  const windingComponent =
    100 *
    clamp(
      headingChangeDegreesPerKm / scoring.fullWindingScoreDegreesPerKm,
      0,
      1,
    );
  const ordinaryDetour = Math.max(
    0,
    Math.min(detourRatio, scoring.excessiveDetourRatio) -
      scoring.detourToleranceRatio,
  );
  const excessiveDetour = Math.max(
    0,
    detourRatio - scoring.excessiveDetourRatio,
  );
  const penalties = Object.freeze({
    detour: round(
      ordinaryDetour * scoring.detourPenaltyPerRatio +
        excessiveDetour * scoring.excessiveDetourPenaltyPerRatio,
      3,
    ),
    targetDistance: round(
      targetDistanceMeters
        ? Math.abs(targetDistanceRatio - 1) * scoring.targetDistancePenaltyPerRatio
        : 0,
      3,
    ),
    uTurns: uTurnCount * scoring.uTurnPenalty,
    loopArtifacts: loopArtifactCount * scoring.loopArtifactPenalty,
  });
  const totalPenalty =
    penalties.detour +
    penalties.targetDistance +
    penalties.uTurns +
    penalties.loopArtifacts;

  return Object.freeze({
    id: normalized.id,
    candidate,
    rankingKind: "winding-route-geometry",
    notice: WINDING_ROUTE_RANKING_NOTICE,
    score: round(clamp(windingComponent - totalPenalty, 0, 100), 3),
    distanceMeters: round(normalized.distanceMeters, 3),
    directDistanceMeters: round(normalized.directDistanceMeters, 3),
    detourRatio: round(detourRatio, 4),
    targetDistanceRatio: round(targetDistanceRatio, 4),
    absoluteHeadingChangeDegrees: round(absoluteHeadingChangeDegrees, 3),
    headingChangeDegreesPerKm: round(headingChangeDegreesPerKm, 3),
    uTurnCount,
    loopArtifactCount,
    penalties,
  });
}

/**
 * Rank alternatives using the shortest candidate as the default detour
 * reference. Ties are resolved by route facts and then a stable route id.
 */
export function rankWindingRoutes(candidates, options = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Route candidates must be an array.");
  }
  if (!candidates.length) return [];

  const normalized = candidates.map((candidate) => normalizeCandidate(candidate));
  const suppliedReference = positiveNumber(options.referenceDistanceMeters);
  const referenceDistanceMeters =
    suppliedReference ||
    Math.min(...normalized.map((candidate) => candidate.distanceMeters));
  const scored = candidates.map((candidate, index) => ({
    ...scoreWindingRoute(candidate, { ...options, referenceDistanceMeters }),
    inputIndex: index,
  }));

  scored.sort(compareRankedRoutes);
  return scored.map(({ inputIndex: _inputIndex, ...result }, index) =>
    Object.freeze({ ...result, rank: index + 1 }),
  );
}

/**
 * Generate deterministic provider-neutral waypoint suggestions for a loop.
 * Providers remain responsible for snapping/routing through these points.
 */
export function generateRoundTripWaypoints({
  center,
  targetLengthMeters,
  seed,
  waypointCount = 3,
} = {}) {
  const normalizedCenter = validCoordinate(center, "Round-trip center");
  const normalizedLength = positiveNumber(targetLengthMeters);
  if (!normalizedLength || normalizedLength < 500) {
    throw new RangeError("Round-trip target length must be at least 500 meters.");
  }
  if (!Number.isInteger(waypointCount) || waypointCount < 2 || waypointCount > 6) {
    throw new RangeError("Round-trip waypoint count must be an integer from 2 to 6.");
  }
  if (seed === undefined || seed === null || String(seed).length === 0) {
    throw new TypeError("A deterministic round-trip seed is required.");
  }

  const seedText = String(seed);
  const random = mulberry32(hashSeed(seedText));
  const clockwise = random() >= 0.5;
  const direction = clockwise ? 1 : -1;
  const startBearing = random() * 360;
  const bearingStep = 360 / waypointCount;
  const bearingJitterLimit = Math.min(14, bearingStep * 0.12);
  const radialFactors = Array.from(
    { length: waypointCount },
    () => 0.9 + random() * 0.2,
  );
  const bearings = radialFactors.map((_, index) =>
    normalizeBearing(
      startBearing +
        direction * index * bearingStep +
        (random() * 2 - 1) * bearingJitterLimit,
    ),
  );

  const regularLoopFactor =
    2 + (waypointCount - 1) * 2 * Math.sin(Math.PI / waypointCount);
  let baseRadiusMeters = normalizedLength / regularLoopFactor;
  let draft = buildWaypointDraft(
    normalizedCenter,
    bearings,
    radialFactors,
    baseRadiusMeters,
  );
  const firstEstimate = loopLengthMeters(normalizedCenter, draft);
  if (firstEstimate > 0) {
    baseRadiusMeters *= normalizedLength / firstEstimate;
    draft = buildWaypointDraft(
      normalizedCenter,
      bearings,
      radialFactors,
      baseRadiusMeters,
    );
  }

  const waypoints = draft.map((waypoint, index) =>
    Object.freeze({
      index,
      bearingDegrees: round(waypoint.bearingDegrees, 2),
      distanceMeters: Math.round(waypoint.distanceMeters),
      coordinates: Object.freeze(
        waypoint.coordinates.map((value) => round(value, 7)),
      ),
    }),
  );

  return Object.freeze({
    kind: "round-trip-waypoint-plan",
    rankingKind: "winding-route-geometry",
    notice: WINDING_ROUTE_RANKING_NOTICE,
    center: Object.freeze([...normalizedCenter]),
    targetLengthMeters: normalizedLength,
    estimatedLoopLengthMeters: Math.round(
      loopLengthMeters(normalizedCenter, waypoints),
    ),
    seed: seedText,
    clockwise,
    waypoints: Object.freeze(waypoints),
  });
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("A route candidate is required.");
  }
  if (!Array.isArray(candidate.coordinates)) {
    throw new TypeError("A route candidate needs a coordinates array.");
  }

  const coordinates = [];
  for (const rawCoordinate of candidate.coordinates) {
    const coordinate = validCoordinate(rawCoordinate, "Route coordinate");
    if (
      coordinates.length &&
      distanceMeters(coordinates.at(-1), coordinate) < 0.05
    ) {
      continue;
    }
    coordinates.push(coordinate);
  }
  if (coordinates.length < 2) {
    throw new RangeError("A route candidate needs at least two distinct coordinates.");
  }

  const geometryDistanceMeters = polylineLengthMeters(coordinates);
  const suppliedDistance = positiveNumber(candidate.distanceMeters);
  const distance = suppliedDistance || geometryDistanceMeters;
  if (distance <= 0) throw new RangeError("A route candidate must have positive length.");

  return {
    id: stableCandidateId(candidate, coordinates),
    coordinates,
    distanceMeters: distance,
    directDistanceMeters: distanceMeters(coordinates[0], coordinates.at(-1)),
  };
}

function normalizeScoringOptions(options) {
  const scoring = { ...DEFAULT_SCORING_OPTIONS };
  for (const key of Object.keys(scoring)) {
    if (options[key] !== undefined) {
      const value = positiveNumber(options[key]);
      if (!value) throw new RangeError(`${key} must be a positive number.`);
      scoring[key] = value;
    }
  }
  if (scoring.excessiveDetourRatio < scoring.detourToleranceRatio) {
    throw new RangeError(
      "excessiveDetourRatio cannot be below detourToleranceRatio.",
    );
  }
  return scoring;
}

function simplifyForHeadingAnalysis(coordinates) {
  const simplified = [coordinates[0]];
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    if (distanceMeters(simplified.at(-1), coordinates[index]) >= MIN_HEADING_SEGMENT_METERS) {
      simplified.push(coordinates[index]);
    }
  }
  if (distanceMeters(simplified.at(-1), coordinates.at(-1)) >= 0.05) {
    simplified.push(coordinates.at(-1));
  }
  return simplified;
}

function segmentHeadings(coordinates) {
  const headings = [];
  for (let index = 1; index < coordinates.length; index += 1) {
    headings.push(bearingDegrees(coordinates[index - 1], coordinates[index]));
  }
  return headings;
}

function countSelfIntersections(coordinates) {
  const sampled = sampleCoordinates(coordinates, MAX_ARTIFACT_SEGMENTS + 1);
  if (sampled.length < 4) return 0;
  const points = toLocalMeters(sampled);
  let intersections = 0;

  for (let left = 0; left < points.length - 1; left += 1) {
    for (let right = left + 2; right < points.length - 1; right += 1) {
      if (left === 0 && right === points.length - 2) continue;
      if (
        properSegmentIntersection(
          points[left],
          points[left + 1],
          points[right],
          points[right + 1],
        )
      ) {
        intersections += 1;
      }
    }
  }
  return intersections;
}

function sampleCoordinates(coordinates, maximumPoints) {
  if (coordinates.length <= maximumPoints) return coordinates;
  const sampled = [];
  const lastIndex = coordinates.length - 1;
  for (let index = 0; index < maximumPoints; index += 1) {
    sampled.push(coordinates[Math.round((index / (maximumPoints - 1)) * lastIndex)]);
  }
  return sampled;
}

function toLocalMeters(coordinates) {
  const origin = coordinates[0];
  const latitudeScale = 111_132;
  const longitudeScale = 111_320 * Math.cos(toRadians(origin[1]));
  return coordinates.map((coordinate) => ({
    x: normalizeLongitudeDelta(coordinate[0] - origin[0]) * longitudeScale,
    y: (coordinate[1] - origin[1]) * latitudeScale,
  }));
}

function properSegmentIntersection(a, b, c, d) {
  const first = cross(a, b, c);
  const second = cross(a, b, d);
  const third = cross(c, d, a);
  const fourth = cross(c, d, b);
  const epsilon = 1e-7;
  if (
    Math.abs(first) <= epsilon ||
    Math.abs(second) <= epsilon ||
    Math.abs(third) <= epsilon ||
    Math.abs(fourth) <= epsilon
  ) {
    return false;
  }
  return Math.sign(first) !== Math.sign(second) && Math.sign(third) !== Math.sign(fourth);
}

function cross(a, b, point) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function compareRankedRoutes(left, right) {
  return (
    right.score - left.score ||
    left.detourRatio - right.detourRatio ||
    right.headingChangeDegreesPerKm - left.headingChangeDegreesPerKm ||
    left.uTurnCount + left.loopArtifactCount -
      (right.uTurnCount + right.loopArtifactCount) ||
    left.distanceMeters - right.distanceMeters ||
    compareText(left.id, right.id) ||
    left.inputIndex - right.inputIndex
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableCandidateId(candidate, coordinates) {
  if (candidate.id !== undefined && candidate.id !== null && String(candidate.id)) {
    return String(candidate.id);
  }
  const fingerprint = coordinates
    .map((coordinate) => `${round(coordinate[0], 5)},${round(coordinate[1], 5)}`)
    .join(";");
  return `route-${hashSeed(fingerprint).toString(16).padStart(8, "0")}`;
}

function buildWaypointDraft(center, bearings, radialFactors, baseRadiusMeters) {
  return bearings.map((bearing, index) => {
    const distance = baseRadiusMeters * radialFactors[index];
    return {
      bearingDegrees: bearing,
      distanceMeters: distance,
      coordinates: destinationPoint(center, bearing, distance),
    };
  });
}

function loopLengthMeters(center, waypoints) {
  const coordinates = [
    center,
    ...waypoints.map((waypoint) => waypoint.coordinates),
    center,
  ];
  return polylineLengthMeters(coordinates);
}

function destinationPoint(center, bearingDegreesValue, distance) {
  const angularDistance = distance / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegreesValue);
  const latitude1 = toRadians(center[1]);
  const longitude1 = toRadians(center[0]);
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2),
    );
  return [normalizeLongitude(toDegrees(longitude2)), toDegrees(latitude2)];
}

function polylineLengthMeters(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function distanceMeters(a, b) {
  const latitudeDelta = toRadians(b[1] - a[1]);
  const longitudeDelta = toRadians(normalizeLongitudeDelta(b[0] - a[0]));
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
}

function bearingDegrees(a, b) {
  const longitudeDelta = toRadians(normalizeLongitudeDelta(b[0] - a[0]));
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

function validCoordinate(coordinate, label) {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length < 2 ||
    !Number.isFinite(coordinate[0]) ||
    !Number.isFinite(coordinate[1]) ||
    coordinate[0] < -180 ||
    coordinate[0] > 180 ||
    coordinate[1] < -90 ||
    coordinate[1] > 90
  ) {
    throw new RangeError(`${label} must be a valid [longitude, latitude] pair.`);
  }
  return [Number(coordinate[0]), Number(coordinate[1])];
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function hashSeed(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normalizeAngleDelta(degrees) {
  let normalized = degrees;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function normalizeBearing(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeLongitude(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function normalizeLongitudeDelta(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function round(value, decimalPlaces) {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
