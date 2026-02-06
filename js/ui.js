// ============================
// UI - HUD updates, approach glow, session stats, status, settings
// ============================

// Initialize app with API key
function initializeApp() {
  const keyInput = document.getElementById('api-key-input');
  mapboxToken = keyInput.value.trim();

  if (!mapboxToken) {
    alert('Please enter your Mapbox API key');
    return;
  }

  localStorage.setItem('mapboxToken', mapboxToken);
  document.getElementById('setup-overlay').classList.add('hidden');
  initMap();
}

// Check for saved API key
function checkSavedKey() {
  const saved = localStorage.getItem('mapboxToken');
  if (saved) {
    document.getElementById('saved-key-notice').style.display = 'block';
    document.getElementById('key-input-section').style.display = 'none';
    document.getElementById('masked-key').textContent = maskApiKey(saved);
  }
}

// Use the saved API key
function useSavedKey() {
  const saved = localStorage.getItem('mapboxToken');
  if (saved) {
    mapboxToken = saved;
    document.getElementById('setup-overlay').classList.add('hidden');
    initMap();
  }
}

// Show the key input form to change key
function showKeyInput() {
  document.getElementById('saved-key-notice').style.display = 'none';
  document.getElementById('key-input-section').style.display = 'block';
  document.getElementById('api-key-input').value = '';
  document.getElementById('api-key-input').focus();
}

// Open settings overlay
function openSettings() {
  if (isTracking) {
    stopTracking();
  }

  const saved = localStorage.getItem('mapboxToken');
  if (saved) {
    document.getElementById('saved-key-notice').style.display = 'block';
    document.getElementById('key-input-section').style.display = 'none';
    document.getElementById('masked-key').textContent = maskApiKey(saved);
  } else {
    document.getElementById('saved-key-notice').style.display = 'none';
    document.getElementById('key-input-section').style.display = 'block';
  }

  document.getElementById('setup-overlay').classList.remove('hidden');
}

// Mask API key for display
function maskApiKey(key) {
  if (key.length <= 8) return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  return key.substring(0, 4) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + key.substring(key.length - 4);
}

// Update upcoming curves display
function updateUpcomingDisplay() {
  if (upcomingCurves.length === 0) {
    distanceEl.textContent = '\u2014';
    callTextEl.textContent = 'Clear road ahead';
    callTextEl.className = '';
    callDescEl.textContent = '';
    upcomingEl.innerHTML = '';
    return;
  }

  const next = upcomingCurves[0];

  // Main display
  distanceEl.textContent = `${next.distance}m`;
  callTextEl.textContent = next.call;
  callTextEl.className = `severity-${next.severity}`;
  callDescEl.textContent = next.description;

  // Upcoming strip
  upcomingEl.innerHTML = upcomingCurves.slice(0, 5).map(curve => `
    <div class="upcoming-note">
      <div class="dist">${curve.distance}m</div>
      <div class="severity-${curve.severity}">${curve.call}</div>
    </div>
  `).join('');
}

// Approach glow - screen edges light up on curve approach
function updateApproachGlow() {
  const glow = document.getElementById('approach-glow');
  if (upcomingCurves.length === 0) {
    glow.style.opacity = '0';
    glow.className = '';
    return;
  }

  const next = upcomingCurves[0];
  const maxGlowDist = 150;

  if (next.distance < maxGlowDist && next.distance > 0 && next.severity <= 4) {
    const intensity = Math.max(0, 1 - (next.distance / maxGlowDist));
    const color = getSeverityColor(next.severity);
    glow.style.setProperty('--glow-color', color);
    glow.style.opacity = (intensity * 0.7).toFixed(2);
    glow.className = next.direction === 'L' ? 'left' : 'right';
  } else {
    glow.style.opacity = '0';
    glow.className = '';
  }
}

// === SESSION STATS ===
function startSession() {
  sessionStartTime = Date.now();
  sessionDistance = 0;
  sessionTopSpeed = 0;
  sessionTurnsPassed = 0;
  lastSessionPosition = null;
  document.getElementById('session-stats').classList.add('visible');
  updateSessionDisplay();
}

function stopSession() {
  document.getElementById('session-stats').classList.remove('visible');
}

function updateSessionStats() {
  if (!sessionStartTime || !currentPosition) return;

  // Accumulate distance
  if (lastSessionPosition) {
    const segDist = getDistance(lastSessionPosition, currentPosition); // km
    sessionDistance += segDist * 0.621371; // to miles
  }
  lastSessionPosition = [...currentPosition];

  // Track top speed
  if (currentSpeed > sessionTopSpeed) {
    sessionTopSpeed = currentSpeed;
  }

  updateSessionDisplay();
}

function updateSessionDisplay() {
  if (!sessionStartTime) return;
  const elapsed = Date.now() - sessionStartTime;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);

  document.getElementById('session-dist').textContent = `${sessionDistance.toFixed(1)} mi`;
  document.getElementById('session-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  document.getElementById('session-turns').textContent = sessionTurnsPassed;
  document.getElementById('session-top').textContent = `${sessionTopSpeed} mph`;
}

// === SCREEN WAKE LOCK ===
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.getElementById('wake-lock-indicator').classList.add('active');
      wakeLock.addEventListener('release', () => {
        document.getElementById('wake-lock-indicator').classList.remove('active');
      });
    }
  } catch (err) {
    console.log('Wake lock failed:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Show/hide status messages
function showStatus(text) {
  statusText.textContent = text;
  statusEl.classList.add('visible');
}

function hideStatus() {
  statusEl.classList.remove('visible');
}
