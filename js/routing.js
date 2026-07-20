export const ROUTING_CAPABILITY_KEYS = Object.freeze({
  geocoding: "geocoding",
  directions: "directions",
  alternatives: "alternatives",
  waypoints: "waypoints",
});

export const MAPBOX_ROUTING_CAPABILITIES = Object.freeze({
  geocoding: true,
  directions: true,
  alternatives: true,
  waypoints: true,
  maximumCoordinates: 25,
  alternativesWithWaypoints: false,
  profiles: Object.freeze([
    "driving",
    "driving-traffic",
    "walking",
    "cycling",
  ]),
});

export const DEFAULT_MAPBOX_ROUTING_CONFIG = Object.freeze({
  baseUrl: "https://api.mapbox.com",
  profile: "driving",
  styleId: "mapbox/navigation-night-v1",
});

/**
 * Provider-neutral routing facade.
 *
 * Providers expose `id`, `capabilities`, `geocode(query, options)`, and
 * `directions(start, end, options)`. Results returned through this facade use
 * the normalized schemas documented by normalizeGeocodeResult and
 * normalizeDirectionsResult below.
 */
export class RoutingClient {
  #provider;

  constructor(provider) {
    assertRoutingProvider(provider);
    this.#provider = provider;
  }

  get providerId() {
    return this.#provider.id;
  }

  get capabilities() {
    return this.#provider.capabilities;
  }

  supports(capability) {
    return this.capabilities?.[capability] === true;
  }

  geocode(query, options = {}) {
    if (!this.supports(ROUTING_CAPABILITY_KEYS.geocoding)) {
      throw new Error(`${this.providerId} does not support geocoding.`);
    }
    return this.#provider.geocode(query, options);
  }

  directions(startPoint, endPoint, options = {}) {
    if (!this.supports(ROUTING_CAPABILITY_KEYS.directions)) {
      throw new Error(`${this.providerId} does not support directions.`);
    }
    if (
      options.alternatives === true &&
      !this.supports(ROUTING_CAPABILITY_KEYS.alternatives)
    ) {
      throw new Error(`${this.providerId} does not support route alternatives.`);
    }
    if (
      Array.isArray(options.waypoints) &&
      options.waypoints.length > 0 &&
      !this.supports(ROUTING_CAPABILITY_KEYS.waypoints)
    ) {
      throw new Error(`${this.providerId} does not support intermediate waypoints.`);
    }
    return this.#provider.directions(startPoint, endPoint, options);
  }
}

/**
 * Mapbox provider adapter. Configuration is injectable so tests and alternate
 * deployments do not need to patch browser globals:
 * `{ fetch, baseUrl, profile, styleId, token }`.
 */
export class MapboxRoutingProvider {
  #token;
  #fetch;
  #baseUrl;
  #profile;
  #styleId;

  constructor({
    token = "",
    fetch: fetchImplementation = globalThis.fetch,
    baseUrl = DEFAULT_MAPBOX_ROUTING_CONFIG.baseUrl,
    profile = DEFAULT_MAPBOX_ROUTING_CONFIG.profile,
    styleId = DEFAULT_MAPBOX_ROUTING_CONFIG.styleId,
  } = {}) {
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A fetch implementation is required for Mapbox routing.");
    }
    this.#token = String(token || "").trim();
    this.#fetch = fetchImplementation;
    this.#baseUrl = normalizeBaseUrl(baseUrl);
    this.#profile = String(profile || "").trim();
    this.#styleId = String(styleId || "").trim();
    if (!this.#profile) throw new TypeError("A Mapbox routing profile is required.");
    if (!this.#styleId) throw new TypeError("A Mapbox style id is required.");
  }

  get id() {
    return "mapbox";
  }

  get capabilities() {
    return MAPBOX_ROUTING_CAPABILITIES;
  }

  setToken(token) {
    this.#token = String(token || "").trim();
  }

  get hasToken() {
    return Boolean(this.#token);
  }

  async validate({ signal } = {}) {
    this.#assertToken();
    const url = this.#url(`/styles/v1/${this.#styleId}`);
    url.searchParams.set("access_token", this.#token);
    await fetchJson(url, {
      signal,
      label: "token validation",
      providerName: "Mapbox",
      fetchImplementation: this.#fetch,
    });
    return true;
  }

  async geocode(query, { signal } = {}) {
    this.#assertToken();
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) throw new TypeError("A geocoding query is required.");

    const url = this.#url(
      `/geocoding/v5/mapbox.places/${encodeURIComponent(normalizedQuery)}.json`,
    );
    url.searchParams.set("access_token", this.#token);
    url.searchParams.set("limit", "1");
    url.searchParams.set("types", "address,place,poi,locality,neighborhood");

    const data = await fetchJson(url, {
      signal,
      label: "destination search",
      providerName: "Mapbox",
      fetchImplementation: this.#fetch,
    });
    const feature = data.features?.[0];
    if (!feature) return null;

    return normalizeGeocodeResult({
      id: feature.id ?? null,
      name: feature.place_name ?? feature.text ?? normalizedQuery,
      coordinates: feature.geometry?.coordinates ?? feature.center,
      providerId: this.id,
    });
  }

  async directions(
    startPoint,
    endPoint,
    { signal, alternatives = false, waypoints = [] } = {},
  ) {
    this.#assertToken();
    if (!Array.isArray(waypoints)) {
      throw new TypeError("Route waypoints must be an ordered coordinate array.");
    }
    const routeCoordinates = [
      normalizeCoordinate(startPoint, "route start"),
      ...waypoints.map((waypoint) =>
        normalizeCoordinate(waypoint, "route waypoint"),
      ),
      normalizeCoordinate(endPoint, "route end"),
    ];
    if (
      routeCoordinates.length < 2 ||
      routeCoordinates.length > MAPBOX_ROUTING_CAPABILITIES.maximumCoordinates
    ) {
      throw new RangeError(
        `Mapbox directions requires 2–${MAPBOX_ROUTING_CAPABILITIES.maximumCoordinates} total coordinates.`,
      );
    }
    const coordinates = routeCoordinates
      .map((coordinate) => `${coordinate[0]},${coordinate[1]}`)
      .join(";");
    const url = this.#url(
      `/directions/v5/mapbox/${encodeURIComponent(this.#profile)}/${coordinates}`,
    );
    url.searchParams.set("access_token", this.#token);
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("steps", "false");
    const canRequestAlternatives =
      alternatives === true &&
      (waypoints.length === 0 ||
        MAPBOX_ROUTING_CAPABILITIES.alternativesWithWaypoints);
    if (canRequestAlternatives) url.searchParams.set("alternatives", "true");

    const data = await fetchJson(url, {
      signal,
      label: "route calculation",
      providerName: "Mapbox",
      fetchImplementation: this.#fetch,
    });
    const routes = Array.isArray(data.routes)
      ? data.routes.map((route, index) =>
          normalizeRoute({
            id: route.id ?? `${this.id}-route-${index}`,
            providerId: this.id,
            coordinates: route.geometry?.coordinates,
            distanceMeters: route.distance,
            durationSeconds: route.duration,
          }),
        )
      : [];

    return routes.length
      ? normalizeDirectionsResult({
          providerId: this.id,
          profile: this.#profile,
          routes,
        })
      : null;
  }

  #url(path) {
    return new URL(path.replace(/^\/+/, ""), `${this.#baseUrl}/`);
  }

  #assertToken() {
    if (!this.#token) throw new Error("A Mapbox token is required.");
  }
}

/**
 * Backwards-compatible Mapbox client used by the app. Its geocode result still
 * has `{ coordinates, name }`, and its directions result still exposes the
 * primary `{ coordinates, distanceMeters, durationSeconds }` at the top level.
 * New callers can additionally consume providerId, primaryRoute, routes, and
 * alternatives from the same normalized result.
 */
export class MapboxClient extends RoutingClient {
  #mapboxProvider;

  constructor(config = {}) {
    const provider = new MapboxRoutingProvider(config);
    super(provider);
    this.#mapboxProvider = provider;
  }

  setToken(token) {
    this.#mapboxProvider.setToken(token);
  }

  get hasToken() {
    return this.#mapboxProvider.hasToken;
  }

  validateToken(options = {}) {
    return this.#mapboxProvider.validate(options);
  }
}

/**
 * Normalized geocode result:
 * `{ id, providerId, name, coordinates: [longitude, latitude] }`.
 */
export function normalizeGeocodeResult({
  id = null,
  providerId,
  name,
  coordinates,
}) {
  if (!providerId) throw new TypeError("A geocode provider id is required.");
  const normalizedName = String(name || "").trim();
  if (!normalizedName) throw new TypeError("A geocode result name is required.");
  return {
    id,
    providerId: String(providerId),
    name: normalizedName,
    coordinates: normalizeCoordinate(coordinates, "geocode result"),
  };
}

/**
 * Normalized route:
 * `{ id, providerId, coordinates, distanceMeters, durationSeconds }`.
 */
export function normalizeRoute({
  id = null,
  providerId,
  coordinates,
  distanceMeters,
  durationSeconds,
}) {
  if (!providerId) throw new TypeError("A route provider id is required.");
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new TypeError("A normalized route requires at least two coordinates.");
  }
  const normalizedDistance = Number(distanceMeters);
  const normalizedDuration = Number(durationSeconds);
  if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0) {
    throw new TypeError("A route distance must be a non-negative number.");
  }
  if (!Number.isFinite(normalizedDuration) || normalizedDuration < 0) {
    throw new TypeError("A route duration must be a non-negative number.");
  }

  return {
    id,
    providerId: String(providerId),
    coordinates: coordinates.map((coordinate) =>
      normalizeCoordinate(coordinate, "route geometry"),
    ),
    distanceMeters: normalizedDistance,
    durationSeconds: normalizedDuration,
  };
}

/**
 * Normalized directions envelope:
 * `{ providerId, profile, primaryRoute, routes, alternatives }`.
 * Primary-route fields are also copied to the envelope for legacy callers.
 */
export function normalizeDirectionsResult({ providerId, profile, routes }) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new TypeError("A directions result requires at least one route.");
  }
  const normalizedRoutes = routes.map((route) => normalizeRoute(route));
  const primaryRoute = normalizedRoutes[0];
  return {
    ...primaryRoute,
    providerId: String(providerId || primaryRoute.providerId),
    profile: String(profile || ""),
    primaryRoute,
    routes: normalizedRoutes,
    alternatives: normalizedRoutes.slice(1),
  };
}

function normalizeCoordinate(coordinate, label) {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length < 2 ||
    !Number.isFinite(Number(coordinate[0])) ||
    !Number.isFinite(Number(coordinate[1]))
  ) {
    throw new TypeError(`A valid [longitude, latitude] ${label} is required.`);
  }
  return [Number(coordinate[0]), Number(coordinate[1])];
}

function normalizeBaseUrl(baseUrl) {
  const url = new URL(String(baseUrl || ""));
  return url.toString().replace(/\/$/, "");
}

function assertRoutingProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("A routing provider is required.");
  }
  if (!provider.id || !provider.capabilities) {
    throw new TypeError("A routing provider must expose id and capabilities.");
  }
  for (const [capability, method] of [
    [ROUTING_CAPABILITY_KEYS.geocoding, "geocode"],
    [ROUTING_CAPABILITY_KEYS.directions, "directions"],
  ]) {
    if (
      provider.capabilities[capability] === true &&
      typeof provider[method] !== "function"
    ) {
      throw new TypeError(`A routing provider must implement ${method}().`);
    }
  }
}

async function fetchJson(
  url,
  { signal, label, providerName, fetchImplementation },
) {
  let response;
  try {
    response = await fetchImplementation(url, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Could not reach ${providerName} during ${label}.`);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Preserve the HTTP error below when the body is not JSON.
  }

  if (!response.ok) {
    const detail = data?.message || `${response.status} ${response.statusText}`;
    throw new Error(`${providerName} ${label} failed: ${detail}`);
  }

  return data ?? {};
}
