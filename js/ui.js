// ============================
// UI - HUD display updates, approach glow, status messages
// ============================

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

  if (next.distance < maxGlowDist && next.distance > 0 && next.severity <= 5) {
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

// Show/hide status messages
function showStatus(text) {
  statusText.textContent = text;
  statusEl.classList.add('visible');
}

function hideStatus() {
  statusEl.classList.remove('visible');
}
