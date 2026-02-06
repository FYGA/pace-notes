// ============================
// Utils - Geo math & coordinate helpers
// ============================

// Haversine distance between two [lng, lat] coordinates, returns km
function getDistance(coord1, coord2) {
  const R = 6371;
  const dLat = toRad(coord2[1] - coord1[1]);
  const dLon = toRad(coord2[0] - coord1[0]);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(coord1[1])) * Math.cos(toRad(coord2[1])) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Along-route distance between two indices, returns meters
function getRouteDistance(coords, startIdx, endIdx) {
  let dist = 0;
  for (let i = startIdx; i < endIdx && i < coords.length - 1; i++) {
    dist += getDistance(coords[i], coords[i + 1]);
  }
  return dist * 1000;
}

// Bearing from coord1 to coord2 in degrees
function getBearing(coord1, coord2) {
  const dLon = toRad(coord2[0] - coord1[0]);
  const lat1 = toRad(coord1[1]);
  const lat2 = toRad(coord2[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Get a point at distance (km) along a bearing from coord
function getPointAhead(coord, bearing, distanceKm) {
  const R = 6371;
  const d = distanceKm / R;
  const brng = toRad(bearing);
  const lat1 = toRad(coord[1]);
  const lon1 = toRad(coord[0]);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return [toDeg(lon2), toDeg(lat2)];
}

// Compass direction from heading degrees
function getCompassDirection(heading) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(heading / 45) % 8];
}

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
