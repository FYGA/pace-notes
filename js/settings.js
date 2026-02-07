// ============================
// Settings - API key management, app initialization
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
  showRouteSetup();
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
    showRouteSetup();
  }
}

// Show route setup overlay
function showRouteSetup() {
  if (isTracking) stopTracking();
  if (isDemoMode) stopDemo();

  const overlay = document.getElementById('route-setup-overlay');
  overlay.style.display = 'flex';

  // Reset route info if no route loaded
  if (!isRouteLoaded) {
    document.getElementById('route-info').style.display = 'none';
  }

  // Focus destination input
  setTimeout(() => {
    document.getElementById('destination-input').focus();
  }, 100);
}

// Start driving from loaded route
function startFromRoute() {
  document.getElementById('route-setup-overlay').style.display = 'none';
  toggleTracking();
}

// Show the key input form to change key
function showKeyInput() {
  document.getElementById('saved-key-notice').style.display = 'none';
  document.getElementById('key-input-section').style.display = 'block';
  document.getElementById('api-key-input').value = '';
  document.getElementById('api-key-input').focus();
}

// Open settings overlay (API key)
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

  document.getElementById('route-setup-overlay').style.display = 'none';
  document.getElementById('setup-overlay').classList.remove('hidden');
}

// Mask API key for display
function maskApiKey(key) {
  if (key.length <= 8) return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  return key.substring(0, 4) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + key.substring(key.length - 4);
}
