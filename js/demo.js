// ============================
// Demo - Pikes Peak demo mode with simulated movement
// ============================

// Toggle demo mode
function toggleDemo() {
  if (isDemoMode) {
    stopDemo();
  } else {
    startDemo();
  }
}

// Start demo mode
async function startDemo() {
  // Stop real tracking if active
  if (isTracking) {
    stopTracking();
  }

  const demoBtn = document.getElementById('demo-btn');
  demoBtn.classList.add('active');
  demoBtn.innerHTML = '<span>\u231B</span> Loading...';

  showStatus('Fetching Pikes Peak route...');

  try {
    // Fetch real route from Mapbox Directions API
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${DEMO_START[0]},${DEMO_START[1]};${DEMO_END[0]},${DEMO_END[1]}?geometries=geojson&overview=full&access_token=${mapboxToken}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || !data.routes[0]) {
      throw new Error('No route found');
    }

    demoRouteData = data.routes[0].geometry.coordinates;

    if (demoRouteData.length < 10) {
      throw new Error('Route too short');
    }

  } catch (error) {
    console.error('Error fetching demo route:', error);
    showStatus('Error loading route');
    demoBtn.classList.remove('active');
    demoBtn.innerHTML = '<span>\uD83C\uDFAC</span> Demo';
    setTimeout(hideStatus, 2000);
    return;
  }

  isDemoMode = true;
  demoIndex = 0;
  positionHistory = [];
  demoBtn.innerHTML = '<span>\u23F9</span> Stop Demo';

  requestWakeLock();
  startSession();

  // Show GPS indicator for demo
  gpsAccuracy.style.display = 'flex';
  accuracyText.textContent = 'DEMO';
  gpsDot.className = 'gps-dot good';

  // Set initial position and center map
  currentPosition = demoRouteData[0];
  routeCoordinates = demoRouteData;

  // Hide route setup if visible
  document.getElementById('route-setup-overlay').style.display = 'none';

  // Analyze curves in demo route, then color-code the route
  analyzeCurves(demoRouteData);
  updateColoredRoute();
  isRouteLoaded = true;

  // Center map ahead of start (so user appears in lower third)
  const startBearing = getBearing(demoRouteData[0], demoRouteData[1]);
  const offsetStart = getPointAhead(demoRouteData[0], startBearing, 0.15);
  map.flyTo({
    center: offsetStart,
    zoom: 17,
    pitch: 70,
    bearing: startBearing
  });

  // Start simulation loop (update every 200ms for smooth animation)
  demoInterval = setInterval(simulateDemoMovement, 200);
  showStatus('Demo: Pikes Peak Hill Climb');
  setTimeout(hideStatus, 2000);
}

// Stop demo mode
function stopDemo() {
  isDemoMode = false;
  isRouteLoaded = false;
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }

  const demoBtn = document.getElementById('demo-btn');
  demoBtn.classList.remove('active');
  demoBtn.innerHTML = '<span>\uD83C\uDFAC</span> Demo';
  gpsAccuracy.style.display = 'none';
  releaseWakeLock();
  stopSession();
  document.getElementById('approach-glow').style.opacity = '0';

  // Reset display
  distanceEl.textContent = '\u2014';
  callTextEl.textContent = 'Demo stopped';
  callTextEl.className = '';
  callDescEl.textContent = '';
  upcomingEl.innerHTML = '';
  speedEl.textContent = '0';
  curvesEl.textContent = '0';
}

// Simulate movement along demo route
function simulateDemoMovement() {
  if (!isDemoMode || demoRouteData.length === 0) return;

  if (demoIndex >= demoRouteData.length - 1) {
    // Loop back to start
    demoIndex = 0;
    lastSpokenCurve = null;
    positionHistory = [];
    analyzeCurves(demoRouteData);
    return;
  }

  // Move to next point
  demoIndex++;
  currentPosition = demoRouteData[demoIndex];

  // Track position history for demo too
  positionHistory.push({ position: [...currentPosition], time: Date.now() });
  if (positionHistory.length > POSITION_HISTORY_MAX) {
    positionHistory.shift();
  }

  // Calculate heading to next point
  if (demoIndex < demoRouteData.length - 1) {
    currentHeading = getBearing(demoRouteData[demoIndex], demoRouteData[demoIndex + 1]);
  }

  // Simulate speed (vary based on curve severity) - in MPH
  const nearestCurve = upcomingCurves[0];
  if (nearestCurve && nearestCurve.distance < 100) {
    demoSpeed = Math.max(20, 45 - (6 - nearestCurve.severity) * 6);
  } else {
    demoSpeed = 45;
  }
  currentSpeed = demoSpeed;

  // Update UI
  speedEl.textContent = currentSpeed;
  headingEl.textContent = getCompassDirection(currentHeading);

  // Update user marker
  updateUserMarker(currentPosition, currentHeading);

  // Center map ahead of user (so user appears in lower third)
  const offsetCenter = getPointAhead(currentPosition, currentHeading, 0.15);
  map.easeTo({
    center: offsetCenter,
    bearing: currentHeading,
    duration: 200
  });

  // Update curve distances and check for callouts
  updateCurveDistances();
  checkForCallouts();
  updateApproachGlow();
}
