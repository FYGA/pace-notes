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

const SAMPLE_SPACING_METERS = 5;
const CURVATURE_ENTER = 1 / 210;
const CURVATURE_EXIT = 1 / 360;
const STRAIGHTENING_SAMPLES = 2;
const MINIMUM_CORNER_LENGTH_METERS = 18;
const MINIMUM_CORNER_ANGLE_DEGREES = 15;
const MAXIMUM_CORNER_SOURCE_GAP_METERS = 18;

export function analyzeCurves(coordinates) {
  const cleanCoordinates = removeDuplicateCoordinates(coordinates);
  if (cleanCoordinates.length < 3) return [];

  const sourceDistances = buildCumulativeDistances(cleanCoordinates);
  const totalDistance = sourceDistances.at(-1) ?? 0;
  if (totalDistance < MINIMUM_CORNER_LENGTH_METERS) return [];

  const samples = resampleRoute(
    cleanCoordinates,
    sourceDistances,
    SAMPLE_SPACING_METERS,
  );
  if (samples.length < 5) return [];

  const rawSampleCoordinates = samples.map((sample) => sample.position);
  const smoothedCoordinates = smoothCoordinates(rawSampleCoordinates);
  const curvature = buildCurvatureProfile(samples, smoothedCoordinates);
  const fineCurvature = samples.map((_, index) =>
    curvatureAt(samples, rawSampleCoordinates, index, 1),
  );
  const segments = segmentCorners(samples, curvature, fineCurvature);

  const curves = segments
    .map((segment) =>
      buildCornerEvent({
        segment,
        samples,
        curvature,
        analysisCoordinates: smoothedCoordinates,
        sourceDistances,
      }),
    )
    .filter(Boolean);
  const occurrences = new Map();
  return curves.map((curve) => {
    const baseId = cornerId(curve);
    const occurrence = (occurrences.get(baseId) || 0) + 1;
    occurrences.set(baseId, occurrence);
    return {
      ...curve,
      id: occurrence === 1 ? baseId : `${baseId}-occ-${occurrence}`,
    };
  });
}

function cornerId(curve) {
  const pointKey = (position) =>
    position.map((coordinate) => Math.round(coordinate * 10_000)).join("_");
  return `corner-${curve.direction}-${pointKey(curve.endPosition)}`;
}

function removeDuplicateCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];

  const clean = [];
  for (const coordinate of coordinates) {
    if (
      !Array.isArray(coordinate) ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      continue;
    }

    const previous = clean.at(-1);
    if (
      previous &&
      Math.abs(previous[0] - coordinate[0]) < 1e-10 &&
      Math.abs(previous[1] - coordinate[1]) < 1e-10
    ) {
      continue;
    }
    clean.push([coordinate[0], coordinate[1]]);
  }
  return clean;
}

function resampleRoute(coordinates, cumulativeDistances, spacingMeters) {
  const totalDistance = cumulativeDistances.at(-1) ?? 0;
  const distances = [];
  for (let distance = 0; distance < totalDistance; distance += spacingMeters) {
    distances.push(distance);
  }
  if (!distances.length || totalDistance - distances.at(-1) > 0.05) {
    distances.push(totalDistance);
  }

  let segmentIndex = 0;
  return distances.map((distance) => {
    while (
      segmentIndex < cumulativeDistances.length - 2 &&
      cumulativeDistances[segmentIndex + 1] < distance
    ) {
      segmentIndex += 1;
    }

    const startDistance = cumulativeDistances[segmentIndex];
    const endDistance = cumulativeDistances[segmentIndex + 1];
    const length = endDistance - startDistance;
    const fraction = length > 0 ? (distance - startDistance) / length : 0;
    const start = coordinates[segmentIndex];
    const end = coordinates[segmentIndex + 1];

    return {
      distance,
      sourceGapMeters: length,
      position: [
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ],
    };
  });
}

function smoothCoordinates(coordinates) {
  if (coordinates.length < 3) return coordinates.map((point) => [...point]);

  return coordinates.map((point, index) => {
    if (index === 0 || index === coordinates.length - 1) return [...point];
    const previous = coordinates[index - 1];
    const next = coordinates[index + 1];
    return [
      previous[0] * 0.2 + point[0] * 0.6 + next[0] * 0.2,
      previous[1] * 0.2 + point[1] * 0.6 + next[1] * 0.2,
    ];
  });
}

function buildCurvatureProfile(samples, coordinates) {
  const shortWindow = coordinates.map((_, index) =>
    curvatureAt(samples, coordinates, index, 2),
  );
  const longWindow = coordinates.map((_, index) =>
    curvatureAt(samples, coordinates, index, 4),
  );

  const blended = shortWindow.map((shortValue, index) => {
    const longValue = longWindow[index];
    if (!Number.isFinite(shortValue)) return longValue || 0;
    if (!Number.isFinite(longValue) || Math.sign(shortValue) !== Math.sign(longValue)) {
      return shortValue;
    }

    const shortWeight = Math.abs(shortValue) > Math.abs(longValue) * 1.8 ? 0.8 : 0.65;
    return shortValue * shortWeight + longValue * (1 - shortWeight);
  });

  return smoothCurvature(blended);
}

function curvatureAt(samples, coordinates, index, preferredOffset) {
  const offset = Math.min(
    preferredOffset,
    index,
    coordinates.length - index - 1,
  );
  if (offset < 1) return 0;

  const incoming = bearingDegrees(
    coordinates[index - offset],
    coordinates[index],
  );
  const outgoing = bearingDegrees(
    coordinates[index],
    coordinates[index + offset],
  );
  const angleRadians = toRadians(normalizeAngleDelta(outgoing - incoming));
  const tangentSeparation =
    (samples[index + offset].distance - samples[index - offset].distance) / 2;
  return tangentSeparation > 0 ? angleRadians / tangentSeparation : 0;
}

function smoothCurvature(values) {
  return values.map((value, index) => {
    if (index === 0 || index === values.length - 1) return value;
    const previous = values[index - 1];
    const next = values[index + 1];
    if (
      Math.sign(previous) !== Math.sign(value) ||
      Math.sign(next) !== Math.sign(value)
    ) {
      return value;
    }
    return previous * 0.2 + value * 0.6 + next * 0.2;
  });
}

function segmentCorners(samples, curvature, fineCurvature) {
  const segments = [];
  let index = 0;
  let backtrackFloor = 0;

  while (index < curvature.length) {
    const sign = Math.sign(curvature[index]);
    const isStraightGap =
      Math.abs(fineCurvature[index]) < 1 / 800 &&
      isDenseStableStraightGap(samples, fineCurvature, index, sign);
    if (
      sign === 0 ||
      Math.abs(curvature[index]) < CURVATURE_ENTER ||
      !hasSustainedEntry(curvature, index, sign) ||
      isStraightGap
    ) {
      if (isStraightGap) backtrackFloor = index + 1;
      index += 1;
      continue;
    }

    let startIndex = index;
    while (
      startIndex > backtrackFloor &&
      sign * curvature[startIndex - 1] >= CURVATURE_EXIT
    ) {
      startIndex -= 1;
    }

    let endIndex = index;
    let neutralStart = null;
    let cursor = index + 1;
    for (; cursor < curvature.length; cursor += 1) {
      const signedStrength = sign * curvature[cursor];
      const fineStrength = Math.abs(fineCurvature[cursor]);
      if (
        fineStrength < 1 / 800 &&
        isDenseStableStraightGap(samples, fineCurvature, cursor, sign)
      ) {
        break;
      }
      if (signedStrength >= CURVATURE_EXIT) {
        endIndex = cursor;
        neutralStart = null;
        continue;
      }

      if (
        signedStrength <= -CURVATURE_ENTER &&
        hasSustainedEntry(curvature, cursor, -sign)
      ) {
        break;
      }

      if (neutralStart === null) neutralStart = cursor;
      if (cursor - neutralStart + 1 >= STRAIGHTENING_SAMPLES) break;
    }

    const arcLength =
      samples[endIndex].distance - samples[startIndex].distance;
    if (arcLength >= MINIMUM_CORNER_LENGTH_METERS) {
      segments.push({ startIndex, endIndex, sign });
    }

    index = Math.max(endIndex + 1, neutralStart ?? cursor);
  }

  return segments;
}

function isDenseStableStraightGap(samples, fineCurvature, index, sign) {
  if (index < 1 || index >= fineCurvature.length - 1) return false;
  const localSamples = samples.slice(index - 1, index + 2);
  if (
    localSamples.some(
      (sample) => sample.sourceGapMeters > MAXIMUM_CORNER_SOURCE_GAP_METERS,
    )
  ) {
    return false;
  }

  const previous = sign * fineCurvature[index - 1];
  const next = sign * fineCurvature[index + 1];
  if (previous < CURVATURE_ENTER || next < CURVATURE_ENTER) return false;
  if (Math.max(previous, next) > 1 / 30) return false;
  return Math.max(previous, next) / Math.min(previous, next) <= 2.2;
}

function hasSustainedEntry(curvature, startIndex, sign) {
  let strongSamples = 0;
  const end = Math.min(curvature.length, startIndex + 3);
  for (let index = startIndex; index < end; index += 1) {
    if (sign * curvature[index] >= CURVATURE_ENTER) strongSamples += 1;
  }
  return strongSamples >= 2;
}

function buildCornerEvent({
  segment,
  samples,
  curvature,
  analysisCoordinates,
  sourceDistances,
}) {
  const { startIndex, endIndex, sign } = segment;
  const profile = curvature
    .slice(startIndex, endIndex + 1)
    .map((value) => Math.max(0, sign * value));
  if (!profile.length) return null;

  const startDistance = samples[startIndex].distance;
  const endDistance = samples[endIndex].distance;
  const arcLengthMeters = endDistance - startDistance;
  const totalAngle = totalHeadingChange(
    analysisCoordinates,
    startIndex,
    endIndex,
    sign,
  );
  if (totalAngle < MINIMUM_CORNER_ANGLE_DEGREES) return null;

  const localApexIndex = indexOfMaximum(profile);
  const apexIndex = startIndex + localApexIndex;
  const peakCurvature = profile[localApexIndex];
  const sustainedCurvature = percentile(profile, 0.86);
  const radiusMeters = radiusFromCurvature(sustainedCurvature);
  const entryCurvature = median(profile.slice(0, Math.max(2, Math.ceil(profile.length * 0.3))));
  const exitCurvature = median(
    profile.slice(Math.min(profile.length - 1, Math.floor(profile.length * 0.7))),
  );
  const severity = severityFromRadius(radiusMeters, totalAngle);
  const direction = sign > 0 ? "R" : "L";
  const shape = classifyShape({
    totalAngle,
    radiusMeters,
    arcLengthMeters,
  });
  const routeIndex = indexAtDistance(sourceDistances, startDistance);
  const apexRouteIndex = indexAtDistance(
    sourceDistances,
    samples[apexIndex].distance,
  );
  const endRouteIndex = indexAtDistance(sourceDistances, endDistance);
  const sourceGaps = sourceDistances
    .slice(routeIndex, Math.min(sourceDistances.length, endRouteIndex + 2))
    .slice(1)
    .map((distance, index) => distance - sourceDistances[routeIndex + index]);
  const maximumSourceGapMeters = Math.max(0, ...sourceGaps);
  if (maximumSourceGapMeters > MAXIMUM_CORNER_SOURCE_GAP_METERS) return null;
  const measuredModifiers = classifyModifiers({
    profile,
    entryCurvature,
    exitCurvature,
    localApexIndex,
    arcLengthMeters,
    shape,
  });
  const modifierData =
    maximumSourceGapMeters <= 8
      ? measuredModifiers
      : {
          modifiers: measuredModifiers.isLong ? ["long"] : [],
          modifier: null,
          modifierSeverity: null,
          isLong: measuredModifiers.isLong,
          isLate: false,
        };

  const event = {
    position: [...samples[startIndex].position],
    routeIndex,
    startIndex: routeIndex,
    apexIndex: apexRouteIndex,
    endIndex: endRouteIndex,
    startPosition: [...samples[startIndex].position],
    apexPosition: [...samples[apexIndex].position],
    endPosition: [...samples[endIndex].position],
    startDistance,
    apexDistance: samples[apexIndex].distance,
    endDistance,
    distanceFromStart: startDistance,
    distance: Math.round(startDistance),
    severity,
    direction,
    angle: Math.round(totalAngle),
    totalAngle: Math.round(totalAngle),
    arcLengthMeters: Math.round(arcLengthMeters),
    confidence: Math.max(0.5, 1 - maximumSourceGapMeters / 50),
    maximumSourceGapMeters,
    radiusMeters: Math.round(radiusMeters),
    entryCurvature,
    peakCurvature,
    sustainedCurvature,
    exitCurvature,
    entryRadiusMeters: roundedRadius(entryCurvature),
    peakRadiusMeters: roundedRadius(peakCurvature),
    exitRadiusMeters: roundedRadius(exitCurvature),
    shape,
    isHairpin: shape === "hairpin",
    isSquare: shape === "square",
    ...modifierData,
  };

  event.call = buildCallText(event);
  event.description = describeCurve(event);
  return event;
}

function totalHeadingChange(coordinates, startIndex, endIndex, sign) {
  const firstSegment = Math.max(0, startIndex - 1);
  const lastSegment = Math.min(coordinates.length - 2, endIndex + 1);
  let signedTotal = 0;
  let previousBearing = bearingDegrees(
    coordinates[firstSegment],
    coordinates[firstSegment + 1],
  );

  for (let index = firstSegment + 1; index <= lastSegment; index += 1) {
    const nextBearing = bearingDegrees(
      coordinates[index],
      coordinates[index + 1],
    );
    const delta = normalizeAngleDelta(nextBearing - previousBearing);
    signedTotal += delta;
    previousBearing = nextBearing;
  }
  return Math.max(0, sign * signedTotal);
}

function classifyShape({ totalAngle, radiusMeters, arcLengthMeters }) {
  if (totalAngle >= 135 && totalAngle <= 225 && radiusMeters <= 85) {
    return "hairpin";
  }
  if (
    totalAngle >= 76 &&
    totalAngle <= 108 &&
    radiusMeters <= 62 &&
    arcLengthMeters <= 105
  ) {
    return "square";
  }
  return "normal";
}

function classifyModifiers({
  profile,
  entryCurvature,
  exitCurvature,
  localApexIndex,
  arcLengthMeters,
  shape,
}) {
  const modifiers = [];
  if (arcLengthMeters >= 100) modifiers.push("long");

  let modifier = null;
  let modifierSeverity = null;
  const curvatureDelta = Math.abs(exitCurvature - entryCurvature);
  const ratio =
    Math.max(entryCurvature, exitCurvature) /
    Math.max(Math.min(entryCurvature, exitCurvature), 1 / 1_000);
  const trend = profileTrend(profile);

  if (
    shape === "normal" &&
    curvatureDelta >= 1 / 260 &&
    ratio >= 1.45 &&
    Math.abs(trend) >= 0.35
  ) {
    if (exitCurvature > entryCurvature && trend > 0) {
      modifier = "tightens";
      modifierSeverity = severityFromRadius(
        radiusFromCurvature(exitCurvature),
        0,
      );
    } else if (entryCurvature > exitCurvature && trend < 0) {
      modifier = "opens";
      modifierSeverity = severityFromRadius(
        radiusFromCurvature(exitCurvature),
        0,
      );
    }
  }

  if (modifier) modifiers.push(modifier);
  const apexFraction =
    profile.length > 1 ? localApexIndex / (profile.length - 1) : 0.5;
  const earlyProfile = profile.slice(0, Math.max(2, Math.ceil(profile.length * 0.6)));
  const earlyCurvature = median(earlyProfile);
  const isLate =
    modifier === "tightens" &&
    apexFraction >= 0.68 &&
    earlyCurvature <= entryCurvature * 1.03 &&
    exitCurvature >= earlyCurvature * 1.5;
  if (isLate) modifiers.push("late");

  return {
    modifiers,
    modifier,
    modifierSeverity,
    isLong: modifiers.includes("long"),
    isLate,
  };
}

function profileTrend(profile) {
  if (profile.length < 4) return 0;
  const midpoint = (profile.length - 1) / 2;
  let numerator = 0;
  let xEnergy = 0;
  let yEnergy = 0;
  const average = profile.reduce((sum, value) => sum + value, 0) / profile.length;

  profile.forEach((value, index) => {
    const x = index - midpoint;
    const y = value - average;
    numerator += x * y;
    xEnergy += x * x;
    yEnergy += y * y;
  });

  const denominator = Math.sqrt(xEnergy * yEnergy);
  return denominator > 0 ? numerator / denominator : 0;
}

function severityFromRadius(radiusMeters, totalAngle) {
  if (totalAngle >= 150 && radiusMeters < 55) return 1;
  if (radiusMeters < 22) return 1;
  if (radiusMeters < 34) return 2;
  if (radiusMeters < 52) return 3;
  if (radiusMeters < 78) return 4;
  if (radiusMeters < 120) return 5;
  return 6;
}

function radiusFromCurvature(curvature) {
  if (!Number.isFinite(curvature) || curvature <= 1e-6) return 999;
  return Math.min(999, 1 / curvature);
}

function roundedRadius(curvature) {
  return Math.round(radiusFromCurvature(curvature));
}

function indexOfMaximum(values) {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index];
}

function median(values) {
  return percentile(values, 0.5);
}

export function buildCallText(curve) {
  const direction = curve.direction === "L" ? "left" : "right";
  let text;
  if (curve.isHairpin || curve.shape === "hairpin") text = `${direction} hairpin`;
  else if (curve.isSquare || curve.shape === "square") text = `${direction} square`;
  else text = `${direction} ${curve.severity}`;

  if (curve.isLong || curve.modifiers?.includes("long")) text += " long";
  if (curve.modifier === "tightens") {
    text += ` tightens ${curve.modifierSeverity}`;
    if (curve.isLate || curve.modifiers?.includes("late")) text += " late";
  } else if (curve.modifier === "opens") {
    text += ` opens ${curve.modifierSeverity}`;
  } else if (curve.isLate || curve.modifiers?.includes("late")) {
    text += " late";
  }
  return text;
}

function describeCurve(curve) {
  const labels = {
    1: "very tight",
    2: "tight",
    3: "medium",
    4: "open",
    5: "very open",
    6: "gentle",
  };
  const shape =
    curve.shape === "hairpin"
      ? "hairpin"
      : curve.shape === "square"
        ? "square corner"
        : `${labels[curve.severity]} curve`;
  const modifierText = curve.modifiers?.length
    ? ` · ${curve.modifiers.join(", ")}`
    : "";
  return `${curve.angle}° ${shape} · about ${curve.radiusMeters} m radius${modifierText}`;
}
