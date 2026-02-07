// ============================
// Curves - Multi-scale analysis, detection, compound curves, cautions
// ============================

// Analyze road geometry using multi-scale curve detection
// Scans at 4 window sizes to catch both tight corners and wide sweepers
function analyzeCurves(coordinates) {
  upcomingCurves = [];
  allRouteCurves = [];
  lastSpokenCurve = null;

  if (coordinates.length < 5) return;

  const detectedCurves = [];

  // Multi-scale: analyze at different segment lengths
  // Smaller windows catch tight turns, larger windows catch gradual sweepers
  const scales = [
    { distance: 50, weight: 0.6 },   // tight hairpins, square corners
    { distance: 150, weight: 1.0 },  // sweet spot for most curves
    { distance: 300, weight: 0.8 },  // long gradual curves
    { distance: 500, weight: 0.5 }   // very wide sweeping turns
  ];

  for (const scale of scales) {
    analyzeCurvesAtScale(coordinates, scale.distance, scale.weight, detectedCurves);
  }

  // Deduplicate curves detected at multiple scales
  upcomingCurves = deduplicateCurves(detectedCurves);
  allRouteCurves = upcomingCurves.map(c => ({ ...c }));

  // Detect "tightens" and "opens" for consecutive curves
  detectCompoundCurves();

  // Detect caution patterns
  detectCautions();

  // Update map markers
  updateCurveMarkers();
  curvesEl.textContent = upcomingCurves.length;
}

// Analyze curves at a specific segment scale
function analyzeCurvesAtScale(coordinates, targetSegmentM, weight, detectedCurves) {
  const minAngleChange = 15;
  let i = 0;

  while (i < coordinates.length - 2) {
    let segmentStart = i;
    let segmentEnd = i;
    let segmentDistance = 0;

    // Find segment of approximately targetSegmentM meters
    while (segmentEnd < coordinates.length - 1 && segmentDistance < targetSegmentM) {
      segmentDistance += getDistance(coordinates[segmentEnd], coordinates[segmentEnd + 1]) * 1000;
      segmentEnd++;
    }

    if (segmentEnd >= coordinates.length - 1) break;

    // Calculate bearing change over this segment
    const bearing1 = getBearing(
      coordinates[segmentStart],
      coordinates[Math.min(segmentStart + 2, coordinates.length - 1)]
    );
    const bearing2 = getBearing(
      coordinates[Math.max(segmentEnd - 2, 0)],
      coordinates[segmentEnd]
    );
    let angleChange = bearing2 - bearing1;

    // Normalize to -180 to 180
    while (angleChange > 180) angleChange -= 360;
    while (angleChange < -180) angleChange += 360;

    const absAngle = Math.abs(angleChange);

    if (absAngle >= minAngleChange) {
      const severity = getSeverityFromAngle(absAngle);
      const isHairpin = absAngle >= 150;
      const isSquare = absAngle >= 85 && absAngle <= 95 && severity === 2;

      const direction = angleChange > 0 ? 'right' : 'left';
      const dirShort = angleChange > 0 ? 'R' : 'L';

      // Use the turn-in point (entry of curve), not the midpoint
      const curveEntryOffset = Math.min(3, Math.floor((segmentEnd - segmentStart) * 0.15));
      const curvePointIdx = segmentStart + curveEntryOffset;
      const distanceFromStart = getRouteDistance(coordinates, 0, curvePointIdx);

      // Build rally call
      let call;
      if (isHairpin) {
        call = `${direction} hairpin`;
      } else if (isSquare) {
        call = `${direction} square`;
      } else {
        call = `${direction} ${severity}`;
      }

      detectedCurves.push({
        position: coordinates[curvePointIdx],
        routeIndex: curvePointIdx,
        severity,
        direction: dirShort,
        angle: Math.round(absAngle),
        distanceFromStart,
        distance: Math.round(distanceFromStart),
        scale: targetSegmentM,
        weight,
        isHairpin,
        isSquare,
        call,
        description: getCurveDescription(severity, absAngle, isHairpin, isSquare)
      });
    }

    // Step forward: use half the segment size for overlap between windows
    const stepSize = Math.max(1, Math.floor((segmentEnd - segmentStart) / 2));
    i = segmentStart + stepSize;
  }
}

// Get severity from angle (1=tightest, 6=fastest)
function getSeverityFromAngle(absAngle) {
  if (absAngle >= 150) return 1; // Hairpin
  if (absAngle >= 110) return 1; // Very tight
  if (absAngle >= 85 && absAngle <= 95) return 2; // Square
  if (absAngle >= 80) return 2;  // Tight
  if (absAngle >= 60) return 3;  // Medium-tight
  if (absAngle >= 40) return 4;  // Medium-open
  if (absAngle >= 25) return 5;  // Fast
  return 6;                       // Very fast
}

// Deduplicate curves detected at multiple scales
function deduplicateCurves(detectedCurves) {
  if (detectedCurves.length === 0) return [];

  // Sort by route distance
  detectedCurves.sort((a, b) => a.distanceFromStart - b.distanceFromStart);

  // Group curves within 100m of each other
  const groups = [];
  for (const curve of detectedCurves) {
    const group = groups.find(g =>
      Math.abs(g.center - curve.distanceFromStart) < 100 &&
      g.direction === curve.direction
    );
    if (group) {
      group.curves.push(curve);
      // Update group center to weighted average
      group.center = group.curves.reduce((s, c) => s + c.distanceFromStart, 0) / group.curves.length;
    } else {
      groups.push({
        center: curve.distanceFromStart,
        direction: curve.direction,
        curves: [curve]
      });
    }
  }

  // For each group, pick the best representation
  // Prefer 150m scale (weight 1.0), then tightest severity
  return groups.map(group => {
    group.curves.sort((a, b) => {
      // Primary: prefer higher weight (150m scale)
      if (b.weight !== a.weight) return b.weight - a.weight;
      // Secondary: prefer tighter severity (lower number = tighter)
      return a.severity - b.severity;
    });
    return group.curves[0];
  });
}

// Detect compound curves (tightens/opens)
function detectCompoundCurves() {
  for (let i = 0; i < upcomingCurves.length - 1; i++) {
    const current = upcomingCurves[i];
    const next = upcomingCurves[i + 1];

    const distBetween = Math.abs(current.distanceFromStart - next.distanceFromStart);
    if (distBetween < 150 && current.direction === next.direction) {
      const dir = current.direction === 'R' ? 'right' : 'left';
      if (next.severity < current.severity) {
        current.modifier = 'tightens';
        current.tightensTo = next.severity;
        current.call = `${dir} ${current.severity} tightens ${next.severity}`;
      } else if (next.severity > current.severity) {
        current.modifier = 'opens';
        current.opensTo = next.severity;
        current.call = `${dir} ${current.severity} opens ${next.severity}`;
      }
    }
  }
}

// Detect caution patterns on curves
function detectCautions() {
  for (let i = 0; i < upcomingCurves.length; i++) {
    const curve = upcomingCurves[i];

    // "Don't cut" - tight inside curves
    if (curve.isHairpin || (curve.severity <= 2 && curve.angle >= 100)) {
      curve.caution = "don't cut";
    }

    // "Sudden" - sharp curve after a long straight
    if (i > 0 && curve.severity <= 3) {
      const gap = curve.distanceFromStart - upcomingCurves[i - 1].distanceFromStart;
      if (gap > 300) {
        curve.caution = 'sudden';
      }
    } else if (i === 0 && curve.severity <= 2 && curve.distanceFromStart > 300) {
      curve.caution = 'sudden';
    }

    // "Long" - curves that span a big angle
    if (curve.angle >= 130 && !curve.isHairpin) {
      curve.caution = 'long';
    }
  }
}

// Get curve description text
function getCurveDescription(severity, angle, isHairpin, isSquare) {
  if (isHairpin) return `Hairpin ${angle}\u00B0 - very slow, may need handbrake`;
  if (isSquare) return `Square ${angle}\u00B0 - 90\u00B0 corner`;
  if (severity === 1) return `${angle}\u00B0 - 1st gear, very tight`;
  if (severity === 2) return `${angle}\u00B0 - 2nd gear, tight`;
  if (severity === 3) return `${angle}\u00B0 - 3rd gear, medium`;
  if (severity === 4) return `${angle}\u00B0 - 4th gear, open`;
  if (severity === 5) return `${angle}\u00B0 - 5th gear, fast`;
  return `${angle}\u00B0 - 6th gear, flat out`;
}

// Update distances to curves using along-route distance
function updateCurveDistances() {
  if (!currentPosition || upcomingCurves.length === 0 || routeCoordinates.length < 2) return;

  // Find closest point on route to current position
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < routeCoordinates.length; i++) {
    const d = getDistance(currentPosition, routeCoordinates[i]);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  // Calculate along-route distance from our position to each curve
  upcomingCurves.forEach(curve => {
    if (curve.routeIndex > closestIdx) {
      curve.distance = Math.round(getRouteDistance(routeCoordinates, closestIdx, curve.routeIndex));
    } else {
      curve.distance = -Math.round(getRouteDistance(routeCoordinates, curve.routeIndex, closestIdx));
    }
  });

  // Sort by distance (nearest first)
  upcomingCurves.sort((a, b) => a.distance - b.distance);

  // Filter out passed curves
  upcomingCurves = upcomingCurves.filter(c => c.distance > -20);

  curvesEl.textContent = upcomingCurves.length;

  // Update UI
  updateUpcomingDisplay();
}

// Check if we should call out a curve
function checkForCallouts() {
  if (!soundEnabled || upcomingCurves.length === 0) return;

  const next = upcomingCurves[0];

  const reactionTime = {
    1: 5.0, 2: 4.5, 3: 4.0, 4: 3.5, 5: 3.0, 6: 2.5
  };

  const speedMs = currentSpeed * 0.447;
  const severityReactionTime = reactionTime[next.severity] || 4;
  const calloutDistance = Math.max(60, speedMs * severityReactionTime);

  if (next.distance <= calloutDistance && next.distance > 10) {
    if (lastSpokenCurve !== next) {
      speakCurve(next);
      lastSpokenCurve = next;
    }
  }
}

// Build rally call text for a curve
function buildCallText(curve) {
  const direction = curve.direction === 'L' ? 'left' : 'right';
  if (curve.isHairpin) return `${direction} hairpin`;
  if (curve.isSquare) return `${direction} square`;
  if (curve.modifier === 'tightens') return `${direction} ${curve.severity} tightens ${curve.tightensTo}`;
  if (curve.modifier === 'opens') return `${direction} ${curve.severity} opens ${curve.opensTo}`;
  return `${direction} ${curve.severity}`;
}
