export class MapboxClient {
  #token = '';

  setToken(token) {
    this.#token = token.trim();
  }

  get hasToken() {
    return Boolean(this.#token);
  }

  async geocode(query, { signal } = {}) {
    this.#assertToken();
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    url.searchParams.set('access_token', this.#token);
    url.searchParams.set('limit', '1');
    url.searchParams.set('types', 'address,place,poi,locality,neighborhood');

    const data = await fetchJson(url, { signal, label: 'destination search' });
    const feature = data.features?.[0];
    if (!feature) return null;

    return {
      coordinates: feature.geometry.coordinates,
      name: feature.place_name,
    };
  }

  async directions(startPoint, endPoint, { signal } = {}) {
    this.#assertToken();
    const coordinates = `${startPoint[0]},${startPoint[1]};${endPoint[0]},${endPoint[1]}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
    url.searchParams.set('access_token', this.#token);
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'false');

    const data = await fetchJson(url, { signal, label: 'route calculation' });
    const route = data.routes?.[0];
    if (!route) return null;

    return {
      coordinates: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  }

  #assertToken() {
    if (!this.#token) throw new Error('A Mapbox token is required.');
  }
}

async function fetchJson(url, { signal, label }) {
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(`Could not reach Mapbox during ${label}.`);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Preserve the HTTP error below when the body is not JSON.
  }

  if (!response.ok) {
    const detail = data?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Mapbox ${label} failed: ${detail}`);
  }

  return data ?? {};
}
