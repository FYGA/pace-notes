import {
  bearingDegrees,
  buildCumulativeDistances,
  indexAtDistance,
  normalizeAngleDelta,
  toRadians,
} from "./utils.js";

export const SEVERITY_COLORS = Object.freeze({
  1: "#ff5d66",
  2: "#ff8c4b",
  3: "#f5bd45",
  4: "#a5d95b",
  5: "#3ed598",
  6: "#57d4c5",
});

const ANALYSIS_WINDOWS = Object.freeze([
  { meters: 45, step: 16, minimumAngle: 18, weight: 1.15 },
  { meters: 90, step: 30, minimumAngle: 16, weight: 1.0 },
  { meters: 180, step: 55, minimumAngle: 14, weight: 0.86 },
  { meters: 320, step: 90, minimumAngle: 13, weight: 0.68 },
]);

export function analyzeCurves(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 5) return [];

  const cumulativeDistances = buildCumulativeDistances(coordinates);
  const totalDistance = cumulativeDistances.at(-1) ?? 0;
  if (totalDistance < 35) return [];

  const candidates = [];
  for (const analysisWindow of ANALYSIS_WINDOWS) {
    candidates.push(
      ...scanWindow(
        coordinates,
        cumulativeDistances,
        totalDistance,
        analysisWindow,
      ),
    );
  }

  const curves = deduplicateCandidates(candidates)
    .sort((a, b) => a.distanceFromStart - b.distanceFromStart)
    .map((curve, index) => ({
      ...curve,
      id: `curve-${index}-${Math.round(curve.distanceFromStart)}`,
    }));

  return curves;
}

function scanWindow(
  coordinates,
  cumulativeDistances,
  totalDistance,
  analysisWindow,
) {
  const halfWindow = analysisWindow.meters / 2;
  if (totalDistance < analysisWindow.meters) return [];

  const candidates = [];
  for (
    let centerDistance = halfWindow;
    centerDistance <= totalDistance - halfWindow;
    centerDistance += analysisWindow.step
  ) {
    const startIndex = indexAtDistance(
      cumulativeDistances,
      centerDistance - halfWindow,
    );
    const centerIndex = indexAtDistance(cumulativeDistances, centerDistance);
    const endIndex = indexAtDistance(
      cumulativeDistances,
      centerDistance + halfWindow,
    );

    if (startIndex === centerIndex || centerIndex === endIndex) continue;

    const incomingBearing = bearingDegrees(
      coordinates[startIndex],
      coordinates[centerIndex],
    );
    const outgoingBearing = bearingDegrees(
      coordinates[centerIndex],
      coordinates[endIndex],
    );
    const signedAngle = normalizeAngleDelta(outgoingBearing - incomingBearing);
    const absoluteAngle = Math.abs(signedAngle);

    if (absoluteAngle < analysisWindow.minimumAngle) continue;

    const radiusMeters = estimateRadius(analysisWindow.meters, absoluteAngle);
    const severity = severityFromRadius(radiusMeters, absoluteAngle);
    const direction = signedAngle > 0 ? "R" : "L";
    const entryDistance = Math.max(
      0,
      centerDistance - Math.min(analysisWindow.meters * 0.28, 45),
    );
    const entryIndex = indexAtDistance(cumulativeDistances, entryDistance);
    const isHairpin = absoluteAngle >= 135 && radiusMeters < 48;
    const isSquare =
      absoluteAngle >= 76 && absoluteAngle <= 104 && radiusMeters < 55;
    const score = curveScore({
      absoluteAngle,
      radiusMeters,
      weight: analysisWindow.weight,
    });

    candidates.push({
      position: coordinates[entryIndex],
      routeIndex: entryIndex,
      severity,
      direction,
      angle: Math.round(absoluteAngle),
      radiusMeters: Math.round(radiusMeters),
      distanceFromStart: cumulativeDistances[entryIndex],
      distance: Math.round(cumulativeDistances[entryIndex]),
      isHairpin,
      isSquare,
      score,
      call: buildBaseCall({ direction, severity, isHairpin, isSquare }),
      description: describeCurve({
        severity,
        absoluteAngle,
        radiusMeters,
        isHairpin,
        isSquare,
      }),
    });
  }

  return candidates;
}

function estimateRadius(windowMeters, absoluteAngle) {
  const radians = Math.max(toRadians(absoluteAngle), 0.01);
  return windowMeters / radians;
}

function severityFromRadius(radiusMeters, absoluteAngle) {
  if (absoluteAngle >= 150 && radiusMeters < 52) return 1;
  if (radiusMeters < 22) return 1;
  if (radiusMeters < 34) return 2;
  if (radiusMeters < 52) return 3;
  if (radiusMeters < 78) return 4;
  if (radiusMeters < 120) return 5;
  return 6;
}

function curveScore({ absoluteAngle, radiusMeters, weight }) {
  const turnStrength = Math.min(absoluteAngle / 90, 2);
  const radiusStrength = Math.min(65 / Math.max(radiusMeters, 1), 2.5);
  return (turnStrength + radiusStrength) * weight;
}

function deduplicateCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const accepted = [];

  for (const candidate of sorted) {
    const duplicate = accepted.some((curve) => {
      const separation = Math.abs(
        curve.distanceFromStart - candidate.distanceFromStart,
      );
      const threshold = Math.max(
        45,
        Math.min(95, (curve.radiusMeters + candidate.radiusMeters) * 0.55),
      );
      return curve.direction === candidate.direction && separation < threshold;
    });

    if (!duplicate) accepted.push(candidate);
  }

  return accepted;
}

function buildBaseCall({ direction, severity, isHairpin, isSquare }) {
  const word = direction === "L" ? "left" : "right";
  if (isHairpin) return `${word} hairpin`;
  if (isSquare) return `${word} square`;
  return `${word} ${severity}`;
}

export function buildCallText(curve) {
  const direction = curve.direction === "L" ? "left" : "right";
  if (curve.isHairpin) return `${direction} hairpin`;
  if (curve.isSquare) return `${direction} square`;
  if (curve.modifier === "tightens")
    return `${direction} ${curve.severity} tightens ${curve.modifierSeverity}`;
  if (curve.modifier === "opens")
    return `${direction} ${curve.severity} opens ${curve.modifierSeverity}`;
  return `${direction} ${curve.severity}`;
}

function describeCurve({
  severity,
  absoluteAngle,
  radiusMeters,
  isHairpin,
  isSquare,
}) {
  const angle = Math.round(absoluteAngle);
  const radius = Math.round(radiusMeters);
  if (isHairpin) return `${angle}° hairpin · roughly ${radius} m radius`;
  if (isSquare) return `${angle}° square corner · roughly ${radius} m radius`;

  const labels = {
    1: "very tight",
    2: "tight",
    3: "medium",
    4: "open",
    5: "wide-radius",
    6: "gentle",
  };
  return `${angle}° ${labels[severity]} curve · roughly ${radius} m radius`;
}
