import { pointAhead } from "./utils.js";
import { SEVERITY_COLORS } from "./curves.js";

const SOURCE_IDS = Object.freeze({
  route: "pace-route",
  curves: "pace-curves",
});

export class MapController {
  #map = null;
  #userMarker = null;
  #ready = false;
  #lastPosition = null;
  #lastHeading = 0;
  #onManualMove = null;

  setManualMoveHandler(handler) {
    this.#onManualMove = typeof handler === "function" ? handler : null;
  }

  setToken(token) {
    if (globalThis.mapboxgl) globalThis.mapboxgl.accessToken = token;
  }

  async initialize(token) {
    if (!globalThis.mapboxgl) throw new Error("Mapbox GL failed to load.");
    mapboxgl.accessToken = token;

    this.#map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/navigation-night-v1",
      center: [-121.06, 39.22],
      zoom: 10,
      pitch: 52,
      bearing: 0,
      attributionControl: false,
    });

    this.#map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-left",
    );
    this.#map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "top-right",
    );
    this.#map.on("dragstart", () => this.#onManualMove?.());

    try {
      await new Promise((resolve, reject) => {
        this.#map.once("load", resolve);
        this.#map.once("error", (event) =>
          reject(event.error || new Error("Map failed to load.")),
        );
      });
      this.#addSourcesAndLayers();
      this.#ready = true;
    } catch (error) {
      this.#map.remove();
      this.#map = null;
      this.#ready = false;
      throw error;
    }
  }

  get ready() {
    return this.#ready;
  }

  setRoute(route) {
    if (!this.#ready || !route?.coordinates?.length) return;

    this.#source(SOURCE_IDS.route)?.setData(buildRouteGeoJson(route));
    this.#source(SOURCE_IDS.curves)?.setData(buildCurveGeoJson(route.curves));
    this.fitRoute(route.coordinates);
  }

  clearRoute() {
    if (!this.#ready) return;
    this.#source(SOURCE_IDS.route)?.setData(emptyFeatureCollection());
    this.#source(SOURCE_IDS.curves)?.setData(emptyFeatureCollection());
  }

  setUserPosition(
    position,
    heading = 0,
    { follow = false, animate = true } = {},
  ) {
    if (!this.#ready || !position) return;

    this.#lastPosition = position;
    this.#lastHeading = Number.isFinite(heading) ? heading : this.#lastHeading;

    if (!this.#userMarker) {
      const element = document.createElement("div");
      element.className = "user-marker";
      element.innerHTML = `
        <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
          <circle cx="21" cy="21" r="18" fill="#4f8cff" stroke="#ffffff" stroke-width="3"/>
          <path d="M21 7.5 28 30 21 26.2 14 30Z" fill="#ffffff"/>
        </svg>`;

      this.#userMarker = new mapboxgl.Marker({
        element,
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(position)
        .setRotation(this.#lastHeading)
        .addTo(this.#map);
    } else {
      this.#userMarker.setLngLat(position).setRotation(this.#lastHeading);
    }

    if (follow) this.followUser({ animate });
  }

  followUser({ animate = true } = {}) {
    if (!this.#ready || !this.#lastPosition) return;

    const center = pointAhead(this.#lastPosition, this.#lastHeading || 0, 0.13);
    const options = {
      center,
      zoom: Math.max(this.#map.getZoom(), 16.5),
      pitch: 68,
      bearing: this.#lastHeading || this.#map.getBearing(),
      duration: animate ? 420 : 0,
      essential: true,
    };

    this.#map.easeTo(options);
  }

  fitRoute(coordinates) {
    if (!this.#ready || coordinates.length < 2) return;
    const bounds = coordinates.reduce(
      (accumulator, coordinate) => accumulator.extend(coordinate),
      new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]),
    );

    this.#map.fitBounds(bounds, {
      padding: { top: 220, right: 54, bottom: 230, left: 54 },
      maxZoom: 15,
      pitch: 24,
      bearing: 0,
      duration: 650,
    });
  }

  #source(id) {
    return this.#map?.getSource(id);
  }

  #addSourcesAndLayers() {
    this.#map.addSource(SOURCE_IDS.route, {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
    this.#map.addLayer({
      id: "pace-route-shadow",
      type: "line",
      source: SOURCE_IDS.route,
      paint: {
        "line-color": "#020409",
        "line-width": 10,
        "line-opacity": 0.55,
      },
    });
    this.#map.addLayer({
      id: "pace-route-line",
      type: "line",
      source: SOURCE_IDS.route,
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#4f8cff"],
        "line-width": 6,
        "line-opacity": 0.94,
      },
    });

    this.#map.addSource(SOURCE_IDS.curves, {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
    this.#map.addLayer({
      id: "pace-curve-points",
      type: "circle",
      source: SOURCE_IDS.curves,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 10],
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    this.#map.addLayer({
      id: "pace-curve-labels",
      type: "symbol",
      source: SOURCE_IDS.curves,
      minzoom: 12,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });
  }
}

function buildRouteGeoJson(route) {
  const features = [];
  let activeColor = "#4f8cff";
  let activeCoordinates = [route.coordinates[0]];

  for (let index = 1; index < route.coordinates.length; index += 1) {
    const pointDistance = route.cumulativeDistances[index];
    const nearbyCurve = route.curves.find(
      (curve) =>
        pointDistance >= curve.distanceFromStart - 85 &&
        pointDistance <= curve.distanceFromStart + 45,
    );
    const color = nearbyCurve
      ? SEVERITY_COLORS[nearbyCurve.severity]
      : "#4f8cff";

    activeCoordinates.push(route.coordinates[index]);
    if (color !== activeColor) {
      features.push(lineFeature(activeCoordinates, activeColor));
      activeCoordinates = [
        route.coordinates[index - 1],
        route.coordinates[index],
      ];
      activeColor = color;
    }
  }

  if (activeCoordinates.length >= 2)
    features.push(lineFeature(activeCoordinates, activeColor));
  return { type: "FeatureCollection", features };
}

function lineFeature(coordinates, color) {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { color },
  };
}

function buildCurveGeoJson(curves) {
  return {
    type: "FeatureCollection",
    features: curves.map((curve) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: curve.position },
      properties: {
        color: SEVERITY_COLORS[curve.severity],
        label: curve.isHairpin
          ? `${curve.direction}H`
          : curve.isSquare
            ? `${curve.direction}SQ`
            : `${curve.direction}${curve.severity}`,
      },
    })),
  };
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}
