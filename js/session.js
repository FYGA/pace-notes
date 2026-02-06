// ============================
// Session - Stats tracking, wake lock
// ============================

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
