import test from "node:test";
import assert from "node:assert/strict";

import {
  MAPBOX_ROUTING_CAPABILITIES,
  MapboxClient,
  RoutingClient,
  normalizeDirectionsResult,
  normalizeGeocodeResult,
} from "../js/routing.js";

function response(data, overrides = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return data;
    },
    ...overrides,
  };
}

function createFetchMock(...responses) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, requests };
}

test("MapboxClient preserves legacy results while exposing normalized schemas", async () => {
  const mock = createFetchMock(
    response({
      features: [
        {
          id: "place.1",
          place_name: "Sonora Pass, California",
          geometry: { coordinates: [-119.64, 38.33] },
        },
      ],
    }),
    response({
      routes: [
        {
          geometry: {
            coordinates: [
              [-120.1, 38.1],
              [-119.9, 38.2],
            ],
          },
          distance: 12_345,
          duration: 987,
        },
      ],
    }),
  );
  const client = new MapboxClient({
    token: "pk.test",
    fetch: mock.fetch,
    baseUrl: "https://routing.test/api",
  });

  const place = await client.geocode("Sonora Pass");
  assert.deepEqual(place, {
    id: "place.1",
    providerId: "mapbox",
    name: "Sonora Pass, California",
    coordinates: [-119.64, 38.33],
  });

  const result = await client.directions([-120.1, 38.1], [-119.9, 38.2]);
  assert.deepEqual(result.coordinates, [
    [-120.1, 38.1],
    [-119.9, 38.2],
  ]);
  assert.equal(result.distanceMeters, 12_345);
  assert.equal(result.durationSeconds, 987);
  assert.equal(result.primaryRoute, result.routes[0]);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.providerId, "mapbox");

  assert.equal(mock.requests[0].url.origin, "https://routing.test");
  assert.equal(
    mock.requests[0].url.pathname,
    "/api/geocoding/v5/mapbox.places/Sonora%20Pass.json",
  );
  assert.equal(mock.requests[1].url.searchParams.get("overview"), "full");
  assert.equal(mock.requests[1].url.searchParams.has("alternatives"), false);
});

test("alternatives option requests and normalizes every Mapbox route", async () => {
  const mock = createFetchMock(
    response({
      routes: [
        {
          geometry: { coordinates: [[0, 0], [1, 1]] },
          distance: 100,
          duration: 10,
        },
        {
          geometry: { coordinates: [[0, 0], [2, 2]] },
          distance: 140,
          duration: 12,
        },
      ],
    }),
  );
  const client = new MapboxClient({ token: "pk.test", fetch: mock.fetch });
  const result = await client.directions([0, 0], [1, 1], {
    alternatives: true,
  });

  assert.equal(mock.requests[0].url.searchParams.get("alternatives"), "true");
  assert.equal(result.routes.length, 2);
  assert.equal(result.primaryRoute.distanceMeters, 100);
  assert.equal(result.alternatives.length, 1);
  assert.equal(result.alternatives[0].distanceMeters, 140);
  assert.equal(result.alternatives[0].providerId, "mapbox");
});

test("ordered waypoints are inserted between start and end and disable alternatives", async () => {
  const mock = createFetchMock(
    response({
      routes: [
        {
          geometry: { coordinates: [[0, 0], [1, 2], [3, 4], [5, 6]] },
          distance: 200,
          duration: 20,
        },
      ],
    }),
  );
  const client = new MapboxClient({ token: "pk.test", fetch: mock.fetch });
  const result = await client.directions([0, 0], [5, 6], {
    waypoints: [[1, 2], [3, 4]],
    alternatives: true,
  });

  assert.match(
    decodeURIComponent(mock.requests[0].url.pathname),
    /\/0,0;1,2;3,4;5,6$/,
  );
  assert.equal(mock.requests[0].url.searchParams.has("alternatives"), false);
  assert.equal(result.distanceMeters, 200);
  assert.equal(client.capabilities.waypoints, true);
  assert.equal(client.capabilities.maximumCoordinates, 25);
  assert.equal(client.capabilities.alternativesWithWaypoints, false);
});

test("Mapbox waypoint requests validate the total 2–25 coordinate limit", async () => {
  const mock = createFetchMock(
    response({
      routes: [
        {
          geometry: { coordinates: [[0, 0], [24, 0]] },
          distance: 24,
          duration: 2,
        },
      ],
    }),
  );
  const client = new MapboxClient({ token: "pk.test", fetch: mock.fetch });
  const maximumWaypoints = Array.from({ length: 23 }, (_, index) => [
    index + 1,
    0,
  ]);
  const tooManyWaypoints = Array.from({ length: 24 }, (_, index) => [index, 0]);

  assert.equal(
    (
      await client.directions([0, 0], [24, 0], {
        waypoints: maximumWaypoints,
      })
    ).distanceMeters,
    24,
  );
  await assert.rejects(
    () =>
      client.directions([0, 0], [25, 0], {
        waypoints: tooManyWaypoints,
      }),
    /requires 2–25 total coordinates/,
  );
  await assert.rejects(
    () => client.directions([0, 0], [1, 1], { waypoints: "invalid" }),
    /ordered coordinate array/,
  );
  assert.equal(mock.requests.length, 1);
});

test("provider capabilities and generic facade are provider-neutral", async () => {
  const calls = [];
  const provider = {
    id: "fixture",
    capabilities: {
      geocoding: true,
      directions: true,
      alternatives: false,
      waypoints: false,
      profiles: ["car"],
    },
    async geocode(query, options) {
      calls.push(["geocode", query, options]);
      return normalizeGeocodeResult({
        providerId: this.id,
        name: query,
        coordinates: [1, 2],
      });
    },
    async directions(start, end, options) {
      calls.push(["directions", start, end, options]);
      return normalizeDirectionsResult({
        providerId: this.id,
        profile: "car",
        routes: [
          {
            providerId: this.id,
            coordinates: [start, end],
            distanceMeters: 10,
            durationSeconds: 2,
          },
        ],
      });
    },
  };
  const client = new RoutingClient(provider);

  assert.equal(client.providerId, "fixture");
  assert.equal(client.supports("directions"), true);
  assert.equal(client.supports("alternatives"), false);
  assert.equal((await client.geocode("Somewhere")).providerId, "fixture");
  assert.equal((await client.directions([0, 0], [1, 1])).routes.length, 1);
  assert.throws(
    () => client.directions([0, 0], [1, 1], { alternatives: true }),
    /does not support route alternatives/,
  );
  assert.throws(
    () => client.directions([0, 0], [1, 1], { waypoints: [[0.5, 0.5]] }),
    /does not support intermediate waypoints/,
  );
  assert.deepEqual(calls.map(([method]) => method), ["geocode", "directions"]);
  assert.equal(MAPBOX_ROUTING_CAPABILITIES.alternatives, true);
});

test("capabilities permit a provider that intentionally omits geocoding", async () => {
  const client = new RoutingClient({
    id: "directions-only",
    capabilities: {
      geocoding: false,
      directions: true,
      alternatives: false,
      waypoints: false,
      profiles: ["car"],
    },
    async directions(start, end) {
      return normalizeDirectionsResult({
        providerId: this.id,
        profile: "car",
        routes: [
          {
            providerId: this.id,
            coordinates: [start, end],
            distanceMeters: 5,
            durationSeconds: 1,
          },
        ],
      });
    },
  });

  assert.throws(
    () => client.geocode("Unavailable"),
    /does not support geocoding/,
  );
  assert.equal((await client.directions([0, 0], [1, 1])).distanceMeters, 5);
});

test("injected fetch covers validation, HTTP errors, and aborts without live network", async () => {
  const abort = new DOMException("cancelled", "AbortError");
  const mock = createFetchMock(
    response({}),
    response(
      { message: "bad token" },
      { ok: false, status: 401, statusText: "Unauthorized" },
    ),
    abort,
  );
  const client = new MapboxClient({
    token: "pk.test",
    fetch: mock.fetch,
    baseUrl: "https://routing.test/root",
  });

  assert.equal(await client.validateToken(), true);
  assert.equal(
    mock.requests[0].url.pathname,
    "/root/styles/v1/mapbox/navigation-night-v1",
  );
  await assert.rejects(() => client.geocode("Bad"), /bad token/);
  await assert.rejects(
    () => client.directions([0, 0], [1, 1]),
    (error) => error === abort,
  );
});

test("empty provider results and invalid normalized data fail predictably", async () => {
  const mock = createFetchMock(response({ features: [] }), response({ routes: [] }));
  const client = new MapboxClient({ token: "pk.test", fetch: mock.fetch });

  assert.equal(await client.geocode("Nowhere"), null);
  assert.equal(await client.directions([0, 0], [1, 1]), null);
  assert.throws(
    () =>
      normalizeGeocodeResult({
        providerId: "fixture",
        name: "Broken",
        coordinates: [Number.NaN, 1],
      }),
    /valid \[longitude, latitude\]/,
  );
});
