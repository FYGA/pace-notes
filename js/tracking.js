// ============================
// Tracking - GPS handling, position history, heading, re-fetch
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

  // Reset state for fresh tracking session
  positionHistory = [];
  lastFetchPosition = null;
  lastFetchHeading = null;
  lastFetchTime = 0;
  upcomingCurves = [];
  lastSpokenCurve = null;

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

// Handle GPS position update
async function handlePosition(position) {
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

  // Determine if we should re-fetch road data
  const shouldRefetch = needsRefetch(now);
  if (shouldRefetch) {
    await fetchRoadAhead();
    lastFetchPosition = [...currentPosition];
    lastFetchHeading = currentHeading;
    lastFetchTime = now;
  }

  // Record GPS breadcrumb
  recordTrackPoint();

  // Update session stats
  updateSessionStats();

  // Update curve distances and check for callouts
  updateCurveDistances();
  checkForCallouts();

  // Visual approach indicator
  updateApproachGlow();
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

// Determine if road data needs to be re-fetched
function needsRefetch(now) {
  if (!lastFetchPosition) return true;
  const distMoved = getDistance(lastFetchPosition, currentPosition) * 1000;
  if (distMoved > REFETCH_DISTANCE_M) return true;
  if (lastFetchHeading !== null) {
    let headingDelta = Math.abs(currentHeading - lastFetchHeading);
    if (headingDelta > 180) headingDelta = 360 - headingDelta;
    if (headingDelta > REFETCH_HEADING_DEG) return true;
  }
  if (now - lastFetchTime > REFETCH_INTERVAL_MS) return true;
  return false;
}

// Fetch road geometry ahead using Mapbox Directions
async function fetchRoadAhead() {
  if (!currentPosition) return;

  const heading = currentHeading || 0;
  const aheadPoint = getPointAhead(currentPosition, heading, LOOK_AHEAD_KM);

  // Use a "behind" point to anchor the route to the correct road/direction
  let behindPoint = null;
  if (positionHistory.length >= 3) {
    for (let i = positionHistory.length - 3; i >= 0; i--) {
      const dist = getDistance(positionHistory[i].position, currentPosition) * 1000;
      if (dist > 30) {
        behindPoint = positionHistory[i].position;
        break;
      }
    }
  }
  if (!behindPoint) {
    const reverseHeading = (heading + 180) % 360;
    behindPoint = getPointAhead(currentPosition, reverseHeading, 0.05);
  }

  try {
    // 3 waypoints: behind -> current -> ahead (anchors to correct road)
    const coords = `${behindPoint[0]},${behindPoint[1]};${currentPosition[0]},${currentPosition[1]};${aheadPoint[0]},${aheadPoint[1]}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes[0]) {
      const fullRoute = data.routes[0].geometry.coordinates;

      // Find closest point on route to current position, keep only road ahead
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < fullRoute.length; i++) {
        const d = getDistance(currentPosition, fullRoute[i]);
        if (d < closestDist) {
          closestDist = d;
          closestIdx = i;
        }
      }

      routeCoordinates = fullRoute.slice(Math.max(0, closestIdx - 1));

      // Analyze curves first (so color-coded route has curve data)
      analyzeCurves(routeCoordinates);

      // Update route on map with color-coded segments
      updateColoredRoute();
    }
  } catch (error) {
    console.error('Error fetching road data:', error);
  }
}

// Update GPS accuracy indicator
function updateAccuracyIndicator(accuracy) {
  accuracyText.textContent = `\u00B1${Math.round(accuracy)}m`;
  gpsDot.className = 'gps-dot ' + (accuracy < 10 ? 'good' : accuracy < 30 ? 'medium' : 'poor');
}

// Manual refresh route
async function refreshRoute() {
  if (!currentPosition) {
    showStatus('No GPS position yet');
    setTimeout(hideStatus, 1500);
    return;
  }
  const btn = document.getElementById('refresh-btn');
  btn.style.opacity = '0.5';
  showStatus('Refreshing route...');
  await fetchRoadAhead();
  lastFetchPosition = [...currentPosition];
  lastFetchHeading = currentHeading;
  lastFetchTime = Date.now();
  updateCurveDistances();
  btn.style.opacity = '1';
  hideStatus();
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
