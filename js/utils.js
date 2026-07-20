const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;

  const latitudeDelta = toRadians(b[1] - a[1]);
  const longitudeDelta = toRadians(b[0] - a[0]);
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
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function bearingDegrees(a, b) {
  const longitudeDelta = toRadians(b[0] - a[0]);
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function normalizeAngleDelta(degrees) {
  let normalized = degrees;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

export function pointAhead(coordinate, heading, distanceKm) {
  const angularDistance = (distanceKm * 1000) / EARTH_RADIUS_METERS;
  const bearing = toRadians(heading);
  const latitude1 = toRadians(coordinate[1]);
  const longitude1 = toRadians(coordinate[0]);

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

  return [toDegrees(longitude2), toDegrees(latitude2)];
}

export function buildCumulativeDistances(coordinates) {
  if (!coordinates.length) return [];

  const cumulative = new Array(coordinates.length).fill(0);
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative[index] =
      cumulative[index - 1] +
      distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return cumulative;
}

export function routeDistanceBetween(
  cumulativeDistances,
  startIndex,
  endIndex,
) {
  if (!cumulativeDistances.length) return 0;
  const safeStart = Math.max(
    0,
    Math.min(startIndex, cumulativeDistances.length - 1),
  );
  const safeEnd = Math.max(
    0,
    Math.min(endIndex, cumulativeDistances.length - 1),
  );
  return cumulativeDistances[safeEnd] - cumulativeDistances[safeStart];
}

export function indexAtDistance(cumulativeDistances, targetMeters) {
  if (!cumulativeDistances.length) return 0;

  const boundedTarget = Math.max(
    0,
    Math.min(targetMeters, cumulativeDistances.at(-1)),
  );
  let low = 0;
  let high = cumulativeDistances.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulativeDistances[middle] < boundedTarget) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return 0;
  const previousDelta = Math.abs(cumulativeDistances[low - 1] - boundedTarget);
  const currentDelta = Math.abs(cumulativeDistances[low] - boundedTarget);
  return previousDelta <= currentDelta ? low - 1 : low;
}

const ROUTE_MATCH_DEFAULTS = Object.freeze({
  backwardToleranceMeters: 18,
  backwardSearchMeters: 90,
  forwardSearchMeters: 1_200,
  reacquireDistanceMeters: 120,
});

/**
 * Match a GPS position to a route.
 *
 * Passing a numeric third argument remains supported and treats that vertex as
 * the previous progress hint. New callers should pass an options object with a
 * heading and the previous distanceAlongRoute returned by this function.
 */
export function closestRoutePoint(position, coordinates, hintOrOptions = 0) {
  if (!position || !coordinates.length) return emptyRouteMatch();

  const cumulativeDistances =
    Array.isArray(hintOrOptions?.cumulativeDistances) &&
    hintOrOptions.cumulativeDistances.length === coordinates.length
      ? hintOrOptions.cumulativeDistances
      : buildCumulativeDistances(coordinates);
  const totalDistance = cumulativeDistances.at(-1) ?? 0;
  const options = normalizeRouteMatchOptions(
    hintOrOptions,
    cumulativeDistances,
  );

  if (coordinates.length === 1 || totalDistance === 0) {
    return vertexRouteMatch(position, coordinates[0]);
  }

  const hasPreviousProgress = Number.isFinite(
    options.previousDistanceAlongRoute,
  );
  const previousProgress = hasPreviousProgress
    ? clamp(options.previousDistanceAlongRoute, 0, totalDistance)
    : null;
  const forceGlobalSearch = options.forceGlobalSearch === true;

  let match;
  let reacquired = false;

  if (hasPreviousProgress && !forceGlobalSearch) {
    const startDistance = Math.max(
      0,
      previousProgress - options.backwardSearchMeters,
    );
    const endDistance = Math.min(
      totalDistance,
      previousProgress + options.forwardSearchMeters,
    );
    const startSegment = segmentIndexAtDistance(
      cumulativeDistances,
      startDistance,
    );
    const endSegment = segmentIndexAtDistance(cumulativeDistances, endDistance);

    match = bestSegmentMatch(position, coordinates, cumulativeDistances, {
      startSegment,
      endSegment,
      heading: options.heading,
      previousProgress,
      backwardToleranceMeters: options.backwardToleranceMeters,
      applyContinuity: true,
    });

    // Keeping the previous point as a candidate prevents ordinary backward GPS
    // noise from pulling progress back along the route.
    const previousCandidate = matchAtRouteDistance(
      position,
      coordinates,
      cumulativeDistances,
      previousProgress,
    );
    if (!match || previousCandidate.score < match.score)
      match = previousCandidate;

    if (match.distance > options.reacquireDistanceMeters) {
      reacquired = true;
      match = bestSegmentMatch(position, coordinates, cumulativeDistances, {
        startSegment: 0,
        endSegment: coordinates.length - 2,
        heading: options.heading,
        applyContinuity: false,
      });
    }
  } else {
    reacquired = forceGlobalSearch && hasPreviousProgress;
    match = bestSegmentMatch(position, coordinates, cumulativeDistances, {
      startSegment: 0,
      endSegment: coordinates.length - 2,
      heading: options.heading,
      applyContinuity: false,
    });
  }

  if (!match) return emptyRouteMatch();

  const rawDistanceAlongRoute = match.distanceAlongRoute;
  if (
    hasPreviousProgress &&
    !reacquired &&
    rawDistanceAlongRoute < previousProgress &&
    previousProgress - rawDistanceAlongRoute <= options.backwardToleranceMeters
  ) {
    match = matchAtRouteDistance(
      position,
      coordinates,
      cumulativeDistances,
      previousProgress,
    );
  }

  return {
    index:
      match.segmentFraction < 0.5 ? match.segmentIndex : match.segmentIndex + 1,
    segmentIndex: match.segmentIndex,
    segmentFraction: match.segmentFraction,
    projectedPosition: match.projectedPosition,
    distance: match.distance,
    distanceAlongRoute: match.distanceAlongRoute,
    rawDistanceAlongRoute,
    headingDelta: match.headingDelta,
    reacquired,
  };
}

function normalizeRouteMatchOptions(hintOrOptions, cumulativeDistances) {
  if (typeof hintOrOptions === "number") {
    const hintIndex = clamp(
      Math.round(hintOrOptions),
      0,
      cumulativeDistances.length - 1,
    );
    return {
      ...ROUTE_MATCH_DEFAULTS,
      previousDistanceAlongRoute: cumulativeDistances[hintIndex],
      heading: null,
      forceGlobalSearch: false,
    };
  }

  const options =
    hintOrOptions && typeof hintOrOptions === "object" ? hintOrOptions : {};
  const hintProgress = Number.isFinite(options.hintIndex)
    ? cumulativeDistances[
        clamp(Math.round(options.hintIndex), 0, cumulativeDistances.length - 1)
      ]
    : null;

  return {
    backwardToleranceMeters: positiveNumber(
      options.backwardToleranceMeters,
      ROUTE_MATCH_DEFAULTS.backwardToleranceMeters,
    ),
    backwardSearchMeters: positiveNumber(
      options.backwardSearchMeters,
      ROUTE_MATCH_DEFAULTS.backwardSearchMeters,
    ),
    forwardSearchMeters: positiveNumber(
      options.forwardSearchMeters,
      ROUTE_MATCH_DEFAULTS.forwardSearchMeters,
    ),
    reacquireDistanceMeters: positiveNumber(
      options.reacquireDistanceMeters,
      ROUTE_MATCH_DEFAULTS.reacquireDistanceMeters,
    ),
    previousDistanceAlongRoute: Number.isFinite(
      options.previousDistanceAlongRoute,
    )
      ? options.previousDistanceAlongRoute
      : hintProgress,
    heading: Number.isFinite(options.heading)
      ? normalizeHeading(options.heading)
      : null,
    forceGlobalSearch: options.forceGlobalSearch === true,
  };
}

function bestSegmentMatch(
  position,
  coordinates,
  cumulativeDistances,
  {
    startSegment,
    endSegment,
    heading,
    previousProgress = null,
    backwardToleranceMeters = ROUTE_MATCH_DEFAULTS.backwardToleranceMeters,
    applyContinuity,
  },
) {
  let best = null;

  for (
    let segmentIndex = startSegment;
    segmentIndex <= endSegment;
    segmentIndex += 1
  ) {
    const candidate = projectOntoSegment(
      position,
      coordinates[segmentIndex],
      coordinates[segmentIndex + 1],
      segmentIndex,
      cumulativeDistances,
    );
    if (!candidate) continue;

    const headingDelta = Number.isFinite(heading)
      ? Math.abs(normalizeAngleDelta(candidate.segmentHeading - heading))
      : null;
    const headingPenalty = Number.isFinite(headingDelta)
      ? Math.max(0, headingDelta - 18) * 0.38
      : 0;
    let continuityPenalty = 0;

    if (applyContinuity && Number.isFinite(previousProgress)) {
      const progressDelta = candidate.distanceAlongRoute - previousProgress;
      continuityPenalty = Math.abs(progressDelta) * 0.04;
      if (progressDelta < -backwardToleranceMeters) {
        continuityPenalty += 180 + Math.abs(progressDelta) * 1.5;
      }
    }

    candidate.headingDelta = headingDelta;
    candidate.score = candidate.distance + headingPenalty + continuityPenalty;
    if (!best || candidate.score < best.score) best = candidate;
  }

  return best;
}

function projectOntoSegment(
  position,
  start,
  end,
  segmentIndex,
  cumulativeDistances,
) {
  if (!start || !end) return null;

  const referenceLatitude = toRadians(position[1]);
  const metersPerLongitudeRadian =
    EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
  const startX = toRadians(start[0] - position[0]) * metersPerLongitudeRadian;
  const startY = toRadians(start[1] - position[1]) * EARTH_RADIUS_METERS;
  const endX = toRadians(end[0] - position[0]) * metersPerLongitudeRadian;
  const endY = toRadians(end[1] - position[1]) * EARTH_RADIUS_METERS;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX ** 2 + deltaY ** 2;
  if (squaredLength < 0.0001) return null;

  const segmentFraction = clamp(
    -(startX * deltaX + startY * deltaY) / squaredLength,
    0,
    1,
  );
  const projectedX = startX + deltaX * segmentFraction;
  const projectedY = startY + deltaY * segmentFraction;
  const segmentLength =
    cumulativeDistances[segmentIndex + 1] - cumulativeDistances[segmentIndex];

  return {
    segmentIndex,
    segmentFraction,
    projectedPosition: interpolateCoordinate(start, end, segmentFraction),
    distance: Math.hypot(projectedX, projectedY),
    distanceAlongRoute:
      cumulativeDistances[segmentIndex] + segmentLength * segmentFraction,
    segmentHeading: bearingDegrees(start, end),
  };
}

function matchAtRouteDistance(
  position,
  coordinates,
  cumulativeDistances,
  routeDistance,
) {
  const segmentIndex = segmentIndexAtDistance(
    cumulativeDistances,
    routeDistance,
  );
  const segmentStart = cumulativeDistances[segmentIndex];
  const segmentLength = cumulativeDistances[segmentIndex + 1] - segmentStart;
  const segmentFraction =
    segmentLength > 0
      ? clamp((routeDistance - segmentStart) / segmentLength, 0, 1)
      : 0;
  const projectedPosition = interpolateCoordinate(
    coordinates[segmentIndex],
    coordinates[segmentIndex + 1],
    segmentFraction,
  );

  return {
    segmentIndex,
    segmentFraction,
    projectedPosition,
    distance: distanceMeters(position, projectedPosition),
    distanceAlongRoute: routeDistance,
    headingDelta: null,
    score: distanceMeters(position, projectedPosition),
  };
}

function segmentIndexAtDistance(cumulativeDistances, targetMeters) {
  const index = indexAtDistance(cumulativeDistances, targetMeters);
  if (index >= cumulativeDistances.length - 1)
    return cumulativeDistances.length - 2;
  if (cumulativeDistances[index] > targetMeters && index > 0) return index - 1;
  return index;
}

function interpolateCoordinate(start, end, fraction) {
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

function vertexRouteMatch(position, vertex) {
  return {
    index: 0,
    segmentIndex: 0,
    segmentFraction: 0,
    projectedPosition: [...vertex],
    distance: distanceMeters(position, vertex),
    distanceAlongRoute: 0,
    rawDistanceAlongRoute: 0,
    headingDelta: null,
    reacquired: false,
  };
}

function emptyRouteMatch() {
  return {
    index: 0,
    segmentIndex: 0,
    segmentFraction: 0,
    projectedPosition: null,
    distance: Infinity,
    distanceAlongRoute: 0,
    rawDistanceAlongRoute: 0,
    headingDelta: null,
    reacquired: false,
  };
}

function normalizeHeading(heading) {
  return ((heading % 360) + 360) % 360;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

export function compassDirection(heading) {
  if (!Number.isFinite(heading)) return "—";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(heading / 45) % directions.length];
}

export function formatDuration(seconds) {
  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
