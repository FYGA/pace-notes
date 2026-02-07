// ============================
// Routing - Geocoding, directions, route loading
// ============================

// Geocode an address/place name to coordinates using Mapbox Geocoding API
async function geocodeAddress(query) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&limit=1`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      return {
        coordinates: feature.geometry.coordinates, // [lng, lat]
        name: feature.place_name
      };
    }
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

// Fetch complete route from start to end using Mapbox Directions API
async function fetchFullRoute(startPoint, endPoint) {
  try {
    const coords = `${startPoint[0]},${startPoint[1]};${endPoint[0]},${endPoint[1]}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes[0]) {
      return data.routes[0];
    }
    return null;
  } catch (error) {
    console.error('Directions error:', error);
    return null;
  }
}

// Get current GPS location (one-shot, returns Promise)
function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        resolve([longitude, latitude]);
      },
      (error) => {
        console.error('Geolocation error:', error);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// Main route loading flow: geocode destination → fetch route → analyze curves
async function loadRoute() {
  const destInput = document.getElementById('destination-input');
  const destQuery = destInput.value.trim();

  if (!destQuery) {
    showStatus('Enter a destination');
    setTimeout(hideStatus, 1500);
    return;
  }

  const loadBtn = document.getElementById('load-route-btn');
  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading...';
  showStatus('Finding destination...');

  try {
    // Geocode destination
    const destResult = await geocodeAddress(destQuery);
    if (!destResult) {
      showStatus('Destination not found');
      setTimeout(hideStatus, 2000);
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Route';
      return;
    }

    routeEndPoint = destResult.coordinates;

    // Get current location as start point
    showStatus('Getting your location...');
    const startPoint = await getCurrentLocation();
    if (!startPoint) {
      showStatus('Could not get your location');
      setTimeout(hideStatus, 2000);
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Route';
      return;
    }

    showStatus('Calculating route...');

    // Fetch complete route
    const routeData = await fetchFullRoute(startPoint, routeEndPoint);
    if (!routeData) {
      showStatus('Could not find a route');
      setTimeout(hideStatus, 2000);
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Route';
      return;
    }

    // Store route data
    routeCoordinates = routeData.geometry.coordinates;
    routeMetadata.distance = routeData.distance; // meters
    routeMetadata.duration = routeData.duration; // seconds

    // Analyze ALL curves on the full route upfront
    showStatus('Analyzing curves...');
    analyzeCurves(routeCoordinates);
    updateColoredRoute();

    isRouteLoaded = true;

    // Show route info
    const distMiles = (routeMetadata.distance / 1609.34).toFixed(1);
    const durationMins = Math.round(routeMetadata.duration / 60);
    const routeInfo = document.getElementById('route-info');
    document.getElementById('route-dist-info').textContent = `${distMiles} mi`;
    document.getElementById('route-time-info').textContent = `~${durationMins} min`;
    document.getElementById('route-curves-info').textContent = `${upcomingCurves.length} curves`;
    document.getElementById('route-dest-name').textContent = destResult.name;
    routeInfo.style.display = 'block';

    // Fit map to show entire route
    const bounds = routeCoordinates.reduce(
      (b, coord) => {
        b[0][0] = Math.min(b[0][0], coord[0]);
        b[0][1] = Math.min(b[0][1], coord[1]);
        b[1][0] = Math.max(b[1][0], coord[0]);
        b[1][1] = Math.max(b[1][1], coord[1]);
        return b;
      },
      [[Infinity, Infinity], [-Infinity, -Infinity]]
    );
    map.fitBounds(bounds, { padding: 60, pitch: 0, bearing: 0 });

    showStatus('Route ready!');
    setTimeout(hideStatus, 2000);

  } catch (error) {
    console.error('Route load error:', error);
    showStatus('Error loading route');
    setTimeout(hideStatus, 2000);
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load Route';
  }
}
