const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

export function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;

  const latitudeDelta = toRadians(b[1] - a[1]);
  const longitudeDelta = toRadians(b[0] - a[0]);
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);

  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function bearingDegrees(a, b) {
  const longitudeDelta = toRadians(b[0] - a[0]);
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);

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
    Math.sin(latitude1) * Math.cos(angularDistance)
      + Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
    Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2),
  );

  return [toDegrees(longitude2), toDegrees(latitude2)];
}

export function buildCumulativeDistances(coordinates) {
  if (!coordinates.length) return [];

  const cumulative = new Array(coordinates.length).fill(0);
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return cumulative;
}

export function routeDistanceBetween(cumulativeDistances, startIndex, endIndex) {
  if (!cumulativeDistances.length) return 0;
  const safeStart = Math.max(0, Math.min(startIndex, cumulativeDistances.length - 1));
  const safeEnd = Math.max(0, Math.min(endIndex, cumulativeDistances.length - 1));
  return cumulativeDistances[safeEnd] - cumulativeDistances[safeStart];
}

export function indexAtDistance(cumulativeDistances, targetMeters) {
  if (!cumulativeDistances.length) return 0;

  const boundedTarget = Math.max(0, Math.min(targetMeters, cumulativeDistances.at(-1)));
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

export function closestRoutePoint(position, coordinates, hintIndex = 0) {
  if (!position || !coordinates.length) return { index: 0, distance: Infinity };

  const searchWindow = 240;
  const start = Math.max(0, hintIndex - searchWindow);
  const end = Math.min(coordinates.length - 1, hintIndex + searchWindow);
  let result = searchRange(position, coordinates, start, end);

  if (result.distance > 250 && (start > 0 || end < coordinates.length - 1)) {
    result = searchRange(position, coordinates, 0, coordinates.length - 1);
  }

  return result;
}

function searchRange(position, coordinates, start, end) {
  let bestIndex = start;
  let bestDistance = Infinity;

  for (let index = start; index <= end; index += 1) {
    const candidateDistance = distanceMeters(position, coordinates[index]);
    if (candidateDistance < bestDistance) {
      bestIndex = index;
      bestDistance = candidateDistance;
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

export function compassDirection(heading) {
  if (!Number.isFinite(heading)) return '—';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
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
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
