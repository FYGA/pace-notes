// ============================
// Curves - Analysis, detection, compound curves, cautions
// ============================

// Analyze road geometry for curves
function analyzeCurves(coordinates) {
  upcomingCurves = [];
  lastSpokenCurve = null;

  if (coordinates.length < 3) return;

  const minAngleChange = 15; // degrees to count as a curve
  let i = 0;

  while (i < coordinates.length - 2) {
    // Look at segments of ~50m
    let segmentStart = i;
    let segmentEnd = i;

    // Find a segment of approximately 50-100m
    let segmentDistance = 0;
    while (segmentEnd < coordinates.length - 1 && segmentDistance < 100) {
      segmentDistance += getDistance(coordinates[segmentEnd], coordinates[segmentEnd + 1]) * 1000;
      segmentEnd++;
    }

    if (segmentEnd >= coordinates.length - 1) break;

    // Calculate bearing change over this segment
    const bearing1 = getBearing(coordinates[segmentStart], coordinates[Math.min(segmentStart + 2, coordinates.length - 1)]);
    const bearing2 = getBearing(coordinates[Math.max(segmentEnd - 2, 0)], coordinates[segmentEnd]);
    let angleChange = bearing2 - bearing1;

    // Normalize to -180 to 180
    while (angleChange > 180) angleChange -= 360;
    while (angleChange < -180) angleChange += 360;

    const absAngle = Math.abs(angleChange);

    if (absAngle >= minAngleChange) {
      // Rally pace notes: 1-6 scale (1=tightest, 6=fastest)
      let severity;
      let isHairpin = false;
      let isSquare = false;

      if (absAngle >= 150) {
        severity = 1;
        isHairpin = true;
      } else if (absAngle >= 110) {
        severity = 1;
      } else if (absAngle >= 85 && absAngle <= 95) {
        severity = 2;
        isSquare = true;
      } else if (absAngle >= 80) {
        severity = 2;
      } else if (absAngle >= 60) {
        severity = 3;
      } else if (absAngle >= 40) {
        severity = 4;
      } else if (absAngle >= 25) {
        severity = 5;
      } else {
        severity = 6;
      }

      const direction = angleChange > 0 ? 'right' : 'left';
      const dirShort = angleChange > 0 ? 'R' : 'L';
      // Use the turn-in point (entry of curve), not the midpoint
      // segmentStart is where the road is still straight; the curve begins
      // shortly after, so offset a few points in to mark the actual entry
      const curveEntryOffset = Math.min(3, Math.floor((segmentEnd - segmentStart) * 0.15));
      const curvePointIdx = segmentStart + curveEntryOffset;
      const distanceFromStart = getRouteDistance(coordinates, 0, curvePointIdx);

      // Build the call in rally format: Direction first, then severity
      let call;
      if (isHairpin) {
        call = `${direction} hairpin`;
      } else if (isSquare) {
        call = `${direction} square`;
      } else {
        call = `${direction} ${severity}`;
      }

      upcomingCurves.push({
        position: coordinates[curvePointIdx],
        routeIndex: curvePointIdx,
        severity,
        direction: dirShort,
        angle: Math.round(absAngle),
        distanceFromStart,
        distance: Math.round(distanceFromStart),
        isHairpin,
        isSquare,
        call,
        description: getCurveDescription(severity, absAngle, isHairpin, isSquare)
      });
    }

    i = segmentEnd;
  }

  // Detect "tightens" and "opens" for consecutive curves
  detectCompoundCurves();

  // Detect caution patterns
  detectCautions();

  // Update map markers
  updateCurveMarkers();
  curvesEl.textContent = upcomingCurves.length;
}

// Detect compound curves (tightens/opens)
function detectCompoundCurves() {
  for (let i = 0; i < upcomingCurves.length - 1; i++) {
    const current = upcomingCurves[i];
    const next = upcomingCurves[i + 1];

    // If curves are close together and same direction
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

    // "Don't cut" - tight inside curves (hairpins, severity 1-2)
    if (curve.isHairpin || (curve.severity <= 2 && curve.angle >= 100)) {
      curve.caution = "don't cut";
    }

    // "Sudden" - sharp curve after a long straight (>300m gap from previous curve)
    if (i > 0 && curve.severity <= 3) {
      const gap = curve.distanceFromStart - upcomingCurves[i - 1].distanceFromStart;
      if (gap > 300) {
        curve.caution = 'sudden';
      }
    } else if (i === 0 && curve.severity <= 2 && curve.distanceFromStart > 300) {
      curve.caution = 'sudden';
    }

    // "Long" - curves that span a big angle (sustained turning)
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

  // Calculate callout distance based on speed AND severity
  const reactionTime = {
    1: 5.0,
    2: 4.5,
    3: 4.0,
    4: 3.5,
    5: 3.0,
    6: 2.5
  };

  // Convert speed (MPH) to m/s: mph * 0.447
  const speedMs = currentSpeed * 0.447;
  const severityReactionTime = reactionTime[next.severity] || 4;

  // Distance = speed * reaction time, with minimum of 60m
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
