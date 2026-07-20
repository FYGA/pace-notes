import test from "node:test";
import assert from "node:assert/strict";

import { buildCumulativeDistances, closestRoutePoint } from "../js/utils.js";

const ORIGIN = [-121.06, 39.22];

function offset(eastMeters, northMeters) {
  const latitudeRadians = (ORIGIN[1] * Math.PI) / 180;
  return [
    ORIGIN[0] + eastMeters / (111_320 * Math.cos(latitudeRadians)),
    ORIGIN[1] + northMeters / 110_540,
  ];
}

function route(...points) {
  return points.map(([east, north]) => offset(east, north));
}

test("projects onto sparse route segments and returns fractional progress", () => {
  const coordinates = route([0, 0], [100, 0]);
  const match = closestRoutePoint(offset(37, 8), coordinates, {
    cumulativeDistances: buildCumulativeDistances(coordinates),
  });

  assert.equal(match.segmentIndex, 0);
  assert.ok(match.segmentFraction > 0.35 && match.segmentFraction < 0.39);
  assert.ok(match.distanceAlongRoute > 35 && match.distanceAlongRoute < 39);
  assert.ok(match.distance > 7 && match.distance < 9);
  assert.ok(Array.isArray(match.projectedPosition));
});

test("uses heading to choose the correct branch at a crossing", () => {
  const coordinates = route(
    [-100, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, -100],
  );
  const cumulativeDistances = buildCumulativeDistances(coordinates);
  const crossingPosition = offset(0, 0);

  const eastbound = closestRoutePoint(crossingPosition, coordinates, {
    cumulativeDistances,
    heading: 90,
  });
  const southbound = closestRoutePoint(crossingPosition, coordinates, {
    cumulativeDistances,
    heading: 180,
  });

  assert.equal(eastbound.segmentIndex, 0);
  assert.ok(
    eastbound.distanceAlongRoute > 95 && eastbound.distanceAlongRoute < 105,
  );
  assert.equal(southbound.segmentIndex, 3);
  assert.ok(
    southbound.distanceAlongRoute > 490 && southbound.distanceAlongRoute < 510,
  );
});

test("continuity selects the nearby occurrence when heading is unavailable", () => {
  const coordinates = route(
    [-100, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, -100],
  );
  const cumulativeDistances = buildCumulativeDistances(coordinates);

  const earlyMatch = closestRoutePoint(offset(0, 0), coordinates, {
    cumulativeDistances,
    previousDistanceAlongRoute: 80,
  });
  const lateMatch = closestRoutePoint(offset(0, 0), coordinates, {
    cumulativeDistances,
    previousDistanceAlongRoute: 470,
  });

  assert.equal(earlyMatch.segmentIndex, 0);
  assert.equal(lateMatch.segmentIndex, 3);
});

test("continuity resists jumping to a nearby parallel road later in the route", () => {
  const coordinates = route(
    [-100, 0],
    [100, 0],
    [100, 200],
    [-100, 200],
    [-100, 10],
    [100, 10],
  );
  const cumulativeDistances = buildCumulativeDistances(coordinates);
  const match = closestRoutePoint(offset(0, 8), coordinates, {
    cumulativeDistances,
    previousDistanceAlongRoute: 80,
    heading: 90,
  });

  assert.equal(match.segmentIndex, 0);
  assert.ok(match.distanceAlongRoute > 95 && match.distanceAlongRoute < 105);
  assert.equal(match.reacquired, false);
});

test("small backward GPS jitter does not regress stabilized progress", () => {
  const coordinates = route([0, 0], [200, 0]);
  const match = closestRoutePoint(offset(94, 1), coordinates, {
    previousDistanceAlongRoute: 100,
    backwardToleranceMeters: 10,
  });

  assert.ok(
    match.rawDistanceAlongRoute > 92 && match.rawDistanceAlongRoute < 96,
  );
  assert.equal(match.distanceAlongRoute, 100);
  assert.equal(match.reacquired, false);
});

test("automatically reacquires globally after a large displacement", () => {
  const coordinates = route(
    [0, 0],
    [200, 0],
    [400, 0],
    [600, 0],
    [800, 0],
    [1_000, 0],
  );
  const match = closestRoutePoint(offset(100, 2), coordinates, {
    previousDistanceAlongRoute: 900,
    backwardSearchMeters: 50,
    reacquireDistanceMeters: 100,
    heading: 90,
  });

  assert.equal(match.reacquired, true);
  assert.ok(match.distanceAlongRoute > 95 && match.distanceAlongRoute < 105);
  assert.ok(match.distance < 3);
});

test("forceGlobalSearch explicitly permits immediate reacquisition", () => {
  const coordinates = route([0, 0], [500, 0], [1_000, 0]);
  const match = closestRoutePoint(offset(50, 1), coordinates, {
    previousDistanceAlongRoute: 800,
    forceGlobalSearch: true,
  });

  assert.equal(match.reacquired, true);
  assert.ok(match.distanceAlongRoute > 47 && match.distanceAlongRoute < 53);
});

test("legacy numeric hints still return the original index and distance fields", () => {
  const coordinates = route([0, 0], [100, 0], [200, 0]);
  const match = closestRoutePoint(offset(146, 4), coordinates, 1);

  assert.ok(match.index === 1 || match.index === 2);
  assert.ok(match.distance < 5);
  assert.ok(Number.isFinite(match.distanceAlongRoute));
});
