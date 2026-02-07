// ============================
// Tracking - GPS position tracking along pre-calculated route
// ============================

// Toggle tracking on/off
function toggleTracking() {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

// Start GPS tracking
function startTracking() {
  if (!navigator.geolocation) {
    showStatus('Geolocation not supported');
    return;
  }

  if (!isRouteLoaded) {
    showStatus('Load a route first');
    setTimeout(hideStatus, 2000);
    return;
  }

  // Reset tracking state (but keep the pre-calculated curves)
  positionHistory = [];
  lastSpokenCurve = null;
  offRouteWarningShown = false;

  // Restore all route curves for fresh tracking
  upcomingCurves = allRouteCurves.map(c => ({ ...c }));

  // Hide route setup, show driving UI
  document.getElementById('route-setup-overlay').style.display = 'none';

  requestWakeLock();
  startSession();
  showStatus('Acquiring GPS...');
  gpsAccuracy.style.display = 'flex';

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleError,
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );

  isTracking = true;
  startBtn.className = 'stop';
  startBtn.innerHTML = '<span>\u23F9</span> Stop';
}

// Stop tracking
function stopTracking() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  isTracking = false;
  startBtn.className = 'start';
  startBtn.innerHTML = '<span>\u25B6</span> Start';
  gpsAccuracy.style.display = 'none';
  releaseWakeLock();
  stopSession();
  hideStatus();
}

// Handle GPS position update — no API calls, just track along the route
function handlePosition(position) {
  hideStatus();

  const { latitude, longitude, accuracy, heading, speed } = position.coords;
  currentPosition = [longitude, latitude];
  currentSpeed = speed ? Math.round(speed * 2.237) : 0; // m/s to MPH

  // Track position history for computing heading from movement
  const now = Date.now();
  positionHistory.push({ position: [longitude, latitude], time: now });
  if (positionHistory.length > POSITION_HISTORY_MAX) {
    positionHistory.shift();
  }

  // Compute heading: prefer movement-based heading over GPS heading
  const movementHeading = computeMovementHeading();
  if (movementHeading !== null && currentSpeed > 3) {
    currentHeading = movementHeading;
  } else if (heading !== null && heading !== undefined && !isNaN(heading)) {
    currentHeading = heading;
  }

  // Update accuracy indicator
  updateAccuracyIndicator(accuracy);

  // Update stats
  speedEl.textContent = currentSpeed;
  headingEl.textContent = getCompassDirection(currentHeading);

  // Update user marker
  updateUserMarker(currentPosition, currentHeading);

  // Center map ahead of user (so user appears in lower third)
  const offsetCenter = getPointAhead(currentPosition, currentHeading || 0, 0.15);
  map.easeTo({
    center: offsetCenter,
    bearing: currentHeading || map.getBearing(),
    duration: 500
  });

  // Record GPS breadcrumb
  recordTrackPoint();

  // Update session stats
  updateSessionStats();

  // Update curve distances and check for callouts
  updateCurveDistances();
  checkForCallouts();

  // Check if off-route
  checkOffRoute();

  // Check route completion
  checkRouteCompletion();

  // Visual approach indicator
  updateApproachGlow();
}

// Warn if user has drifted off the route
let offRouteWarningShown = false;
function checkOffRoute() {
  if (routeCoordinates.length < 2 || !currentPosition) return;

  // Find closest route point
  let closestDist = Infinity;
  for (let i = 0; i < routeCoordinates.length; i++) {
    const d = getDistance(currentPosition, routeCoordinates[i]) * 1000; // meters
    if (d < closestDist) closestDist = d;
  }

  if (closestDist > 100 && !offRouteWarningShown) {
    showStatus('Off route — recalculate?');
    offRouteWarningShown = true;
    setTimeout(hideStatus, 3000);
  } else if (closestDist < 50) {
    offRouteWarningShown = false;
  }
}

// Compute heading from recent position history (more reliable than GPS heading)
function computeMovementHeading() {
  if (positionHistory.length < 3) return null;
  const recent = positionHistory[positionHistory.length - 1];
  const older = positionHistory[Math.max(0, positionHistory.length - 4)];
  const dist = getDistance(older.position, recent.position) * 1000;
  if (dist < 5) return null;
  return getBearing(older.position, recent.position);
}

// Update GPS accuracy indicator
function updateAccuracyIndicator(accuracy) {
  accuracyText.textContent = `\u00B1${Math.round(accuracy)}m`;
  gpsDot.className = 'gps-dot ' + (accuracy < 10 ? 'good' : accuracy < 30 ? 'medium' : 'poor');
}

// Center map on user
function centerOnUser() {
  if (currentPosition) {
    const offsetCenter = getPointAhead(currentPosition, currentHeading || 0, 0.15);
    map.flyTo({
      center: offsetCenter,
      zoom: 17,
      pitch: 70,
      bearing: currentHeading || 0
    });
  }
}

// Handle GPS error
function handleError(error) {
  let message = 'GPS Error';
  switch (error.code) {
    case 1: message = 'Location access denied'; break;
    case 2: message = 'Position unavailable'; break;
    case 3: message = 'GPS timeout'; break;
  }
  showStatus(message);
}
