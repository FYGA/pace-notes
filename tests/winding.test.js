import test from "node:test";
import assert from "node:assert/strict";

import {
  generateRoundTripWaypoints,
  rankWindingRoutes,
  scoreWindingRoute,
  WINDING_ROUTE_RANKING_NOTICE,
} from "../js/winding.js";

const ORIGIN = [-121.06, 39.22];

function offset(eastMeters, northMeters) {
  const latitudeRadians = (ORIGIN[1] * Math.PI) / 180;
  return [
    ORIGIN[0] + eastMeters / (111_320 * Math.cos(latitudeRadians)),
    ORIGIN[1] + northMeters / 110_540,
  ];
}

function candidate(id, points, overrides = {}) {
  return {
    id,
    coordinates: points.map(([east, north]) => offset(east, north)),
    ...overrides,
  };
}

test("distance-normalized heading change ranks winding geometry above a straight", () => {
  const straight = scoreWindingRoute(
    candidate("straight", [[0, 0], [1_000, 0]]),
  );
  const winding = scoreWindingRoute(
    candidate("winding", [
      [0, 0],
      [180, 0],
      [260, 100],
      [400, 170],
      [500, 80],
      [650, 170],
      [820, 120],
      [1_000, 150],
    ]),
  );

  assert.equal(straight.headingChangeDegreesPerKm, 0);
  assert.ok(winding.headingChangeDegreesPerKm > 100);
  assert.ok(winding.score > straight.score);
  assert.equal(winding.rankingKind, "winding-route-geometry");
  assert.equal(winding.notice, WINDING_ROUTE_RANKING_NOTICE);
});

test("abrupt U-turns and self-crossing loops cannot manufacture a high score", () => {
  const ordinary = scoreWindingRoute(
    candidate("ordinary", [
      [0, 0],
      [180, 0],
      [260, 100],
      [400, 120],
      [520, 30],
      [700, 60],
    ]),
  );
  const artifact = scoreWindingRoute(
    candidate("artifact", [
      [0, 0],
      [300, 300],
      [0, 300],
      [300, 0],
      [10, 0],
      [310, 0],
    ]),
  );

  assert.ok(artifact.absoluteHeadingChangeDegrees > ordinary.absoluteHeadingChangeDegrees);
  assert.ok(artifact.uTurnCount >= 1);
  assert.ok(artifact.loopArtifactCount >= 1);
  assert.ok(artifact.penalties.uTurns > 0);
  assert.ok(artifact.penalties.loopArtifacts > 0);
  assert.ok(artifact.score < ordinary.score);
});

test("ranking penalizes excessive detours relative to the shortest alternative", () => {
  const direct = candidate("direct", [[0, 0], [1_000, 0]], {
    distanceMeters: 1_000,
  });
  const reasonable = candidate(
    "reasonable",
    [
      [0, 0],
      [180, 0],
      [280, 100],
      [420, 30],
      [560, 130],
      [720, 40],
      [1_000, 0],
    ],
    { distanceMeters: 1_280 },
  );
  const excessive = candidate(
    "excessive",
    [
      [0, 0],
      [180, 0],
      [280, 100],
      [420, 30],
      [560, 130],
      [720, 40],
      [1_000, 0],
    ],
    { distanceMeters: 2_600 },
  );

  const ranked = rankWindingRoutes([excessive, direct, reasonable]);
  const reasonableResult = ranked.find((route) => route.id === "reasonable");
  const excessiveResult = ranked.find((route) => route.id === "excessive");

  assert.equal(reasonableResult.detourRatio, 1.28);
  assert.equal(excessiveResult.detourRatio, 2.6);
  assert.equal(reasonableResult.penalties.detour, 0);
  assert.ok(excessiveResult.penalties.detour >= 100);
  assert.ok(reasonableResult.score > excessiveResult.score);
});

test("alternative ranking has deterministic fact-based tie breaking", () => {
  const alpha = candidate("alpha", [[0, 0], [500, 0]]);
  const beta = candidate("beta", [[0, 0], [500, 0]]);

  assert.deepEqual(
    rankWindingRoutes([beta, alpha]).map((route) => route.id),
    ["alpha", "beta"],
  );
  assert.deepEqual(
    rankWindingRoutes([alpha, beta]).map((route) => route.id),
    ["alpha", "beta"],
  );
});

test("seeded round-trip waypoint plans are repeatable and near the target length", () => {
  const input = {
    center: ORIGIN,
    targetLengthMeters: 42_000,
    seed: "sunday-loop",
    waypointCount: 3,
  };
  const first = generateRoundTripWaypoints(input);
  const repeat = generateRoundTripWaypoints(input);
  const different = generateRoundTripWaypoints({ ...input, seed: "sunset-loop" });

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.waypoints, different.waypoints);
  assert.equal(first.kind, "round-trip-waypoint-plan");
  assert.equal(first.rankingKind, "winding-route-geometry");
  assert.equal(first.notice, WINDING_ROUTE_RANKING_NOTICE);
  assert.equal(first.waypoints.length, 3);
  assert.ok(Math.abs(first.estimatedLoopLengthMeters - 42_000) <= 10);

  for (const waypoint of first.waypoints) {
    assert.ok(waypoint.bearingDegrees >= 0 && waypoint.bearingDegrees < 360);
    assert.ok(waypoint.distanceMeters > 0);
    assert.ok(waypoint.coordinates[0] >= -180 && waypoint.coordinates[0] <= 180);
    assert.ok(waypoint.coordinates[1] >= -90 && waypoint.coordinates[1] <= 90);
  }
});

test("round-trip planning validates its provider-neutral inputs", () => {
  assert.throws(
    () => generateRoundTripWaypoints({ center: ORIGIN, targetLengthMeters: 100, seed: "x" }),
    /at least 500 meters/,
  );
  assert.throws(
    () => generateRoundTripWaypoints({ center: ORIGIN, targetLengthMeters: 10_000 }),
    /seed is required/,
  );
  assert.throws(
    () => scoreWindingRoute({ coordinates: [ORIGIN] }),
    /at least two distinct coordinates/,
  );
});
