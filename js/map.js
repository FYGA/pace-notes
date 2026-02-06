// ============================
// Map - Mapbox initialization, route rendering, markers
// ============================

// Initialize Mapbox
function initMap() {
  mapboxgl.accessToken = mapboxToken;

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/navigation-night-v1',
    center: [0, 0],
    zoom: 17,
    pitch: 70,
    bearing: 0
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-left');

  map.on('load', () => {
    // Add route line source
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
        'line-width': 6,
        'line-opacity': 0.8
      }
    });

    // Add curve markers source
    map.addSource('curves', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'curve-points',
      type: 'circle',
      source: 'curves',
      paint: {
        'circle-radius': 12,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff'
      }
    });

    map.addLayer({
      id: 'curve-labels',
      type: 'symbol',
      source: 'curves',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold']
      },
      paint: {
        'text-color': '#fff'
      }
    });

    // Add brake point markers
    map.addSource('brakepoints', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'brakepoint-markers',
      type: 'circle',
      source: 'brakepoints',
      paint: {
        'circle-radius': 6,
        'circle-color': '#ef4444',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fca5a5',
        'circle-opacity': 0.8
      }
    });

    map.addLayer({
      id: 'brakepoint-labels',
      type: 'symbol',
      source: 'brakepoints',
      layout: {
        'text-field': 'B',
        'text-size': 9,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-offset': [0, -1.5]
      },
      paint: {
        'text-color': '#fca5a5'
      }
    });

    legend.classList.add('visible');
    showStatus('Tap Start to begin tracking');
  });
}

// Update user marker on map
function updateUserMarker(coords, heading) {
  if (!userMarker) {
    const el = document.createElement('div');
    el.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="#3b82f6" stroke="white" stroke-width="3"/>
        <path d="M20 8 L26 28 L20 24 L14 28 Z" fill="white"/>
      </svg>
    `;
    el.style.width = '40px';
    el.style.height = '40px';
    userMarker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat(coords)
      .addTo(map);
  } else {
    userMarker.setLngLat(coords);
    userMarker.setRotation(heading || 0);
  }
}

// Update curve markers on map
function updateCurveMarkers() {
  const features = upcomingCurves.map(curve => {
    let label;
    if (curve.isHairpin) {
      label = `${curve.direction}H`;
    } else if (curve.isSquare) {
      label = `${curve.direction}SQ`;
    } else {
      label = `${curve.direction}${curve.severity}`;
    }

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: curve.position },
      properties: {
        label,
        color: curve.isHairpin ? '#dc2626' : getSeverityColor(curve.severity)
      }
    };
  });

  map.getSource('curves').setData({
    type: 'FeatureCollection',
    features
  });

  // Calculate and update brake points
  updateBrakePoints();
}

// Calculate brake point positions on the route before each curve
function updateBrakePoints() {
  if (!routeCoordinates || routeCoordinates.length < 2) return;

  const brakeFeatures = [];

  upcomingCurves.forEach(curve => {
    // Only show brake points for curves severity 1-4 (tight enough to need braking)
    if (curve.severity > 4) return;

    // Brake distance: tighter curves need earlier braking
    // At ~45mph: severity 1 = 80m, severity 2 = 60m, severity 3 = 45m, severity 4 = 30m
    const brakeDistanceM = (5 - curve.severity) * 20 + 20;

    // Walk backwards along route from curve position to find brake point
    const curveIdx = curve.routeIndex;
    let distBack = 0;
    let brakeIdx = curveIdx;

    for (let j = curveIdx; j > 0; j--) {
      distBack += getDistance(routeCoordinates[j], routeCoordinates[j - 1]) * 1000;
      if (distBack >= brakeDistanceM) {
        brakeIdx = j;
        break;
      }
    }

    if (brakeIdx !== curveIdx && brakeIdx < routeCoordinates.length) {
      brakeFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: routeCoordinates[brakeIdx] },
        properties: {}
      });
    }
  });

  map.getSource('brakepoints').setData({
    type: 'FeatureCollection',
    features: brakeFeatures
  });
}

// Get color for severity
function getSeverityColor(severity) {
  const colors = {
    1: '#ef4444', 2: '#f97316', 3: '#eab308',
    4: '#84cc16', 5: '#22c55e', 6: '#34d399'
  };
  return colors[severity] || '#888';
}

// Color-coded route line by curve severity
function updateColoredRoute() {
  if (!routeCoordinates || routeCoordinates.length < 2) return;

  // Build segments colored by proximity to curves
  const segments = [];
  let currentSegment = { coords: [routeCoordinates[0]], color: '#3b82f6' };

  for (let i = 1; i < routeCoordinates.length; i++) {
    // Find nearest curve to this point
    let nearestSeverity = null;
    let nearestDist = Infinity;

    for (const curve of upcomingCurves) {
      const d = Math.abs(i - curve.routeIndex);
      if (d < nearestDist) {
        nearestDist = d;
        nearestSeverity = curve.severity;
      }
    }

    // Color based on proximity to curve (within ~5 route points)
    let color = '#3b82f6'; // default blue
    if (nearestDist <= 5 && nearestSeverity !== null) {
      color = getSeverityColor(nearestSeverity);
    }

    if (color !== currentSegment.color) {
      // Bridge: add the current point to close the old segment
      currentSegment.coords.push(routeCoordinates[i]);
      segments.push(currentSegment);
      currentSegment = { coords: [routeCoordinates[i]], color };
    } else {
      currentSegment.coords.push(routeCoordinates[i]);
    }
  }
  segments.push(currentSegment);

  // Build a GeoJSON FeatureCollection with colored segments
  const features = segments
    .filter(s => s.coords.length >= 2)
    .map(s => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.coords },
      properties: { color: s.color }
    }));

  map.getSource('route').setData({
    type: 'FeatureCollection',
    features
  });
}
