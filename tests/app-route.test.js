import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRoutePlan,
  canCompleteRoute,
  chooseRouteCandidate,
  materializeCurves,
  shouldHoldRoundTripReacquisition,
} from "../js/app.js";

function detectedCurve(overrides = {}) {
  return {
    id: "corner-R-a-b-c",
    direction: "R",
    severity: 4,
    shape: "normal",
    modifiers: [],
    startDistance: 100,
    apexDistance: 130,
    endDistance: 180,
    position: [1, 2],
    ...overrides,
  };
}

test("materialization uses exit-to-entry gaps without inferring into", () => {
  const notes = materializeCurves(
    [
      detectedCurve(),
      detectedCurve({
        id: "corner-L-d-e-f",
        direction: "L",
        severity: 2,
        startDistance: 190,
        apexDistance: 220,
        endDistance: 250,
      }),
    ],
    "numerical",
  );

  assert.deepEqual(notes[0].connectionToNext, {
    kind: "and",
    meters: 10,
  });
  assert.equal(notes[0].linkedCall, "right 4, and, left 2");
});

test("profile changes alter wording but preserve canonical geometry", () => {
  const detected = [detectedCurve({ radiusMeters: 70 })];
  const numerical = materializeCurves(detected, "numerical")[0];
  const descriptive = materializeCurves(detected, "descriptive")[0];

  assert.equal(numerical.call, "right 4");
  assert.equal(descriptive.call, "right open");
  assert.equal(numerical.id, descriptive.id);
  assert.equal(numerical.entryDistanceMeters, descriptive.entryDistanceMeters);
  assert.equal(numerical.radiusMeters, descriptive.radiusMeters);
});

test("route planning keeps alternatives explicit and selects by preference", () => {
  const direct = {
    id: "direct",
    coordinates: Array.from({ length: 8 }, (_, index) => [
      -121 + index * 0.001,
      39,
    ]),
    distanceMeters: 700,
    durationSeconds: 70,
  };
  const winding = {
    id: "winding",
    coordinates: Array.from({ length: 8 }, (_, index) => [
      -121 + index * 0.0007,
      39 + (index % 2 ? 0.0008 : 0),
    ]),
    distanceMeters: 850,
    durationSeconds: 90,
  };

  assert.equal(chooseRouteCandidate([direct, winding], false).candidate, direct);
  assert.equal(chooseRouteCandidate([direct, winding], true).candidate, winding);

  const plan = buildRoutePlan(
    "Test alternatives",
    [direct, winding],
    "numerical",
    true,
    { routeKind: "destination" },
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.selectedId, "winding");
  assert.match(plan.notice, /not a speed, difficulty, or safety rating/i);
});

test("automatic winding selection keeps excessive destination detours manual", () => {
  const direct = routeCandidate("direct", 1_000, 0);
  const excessive = routeCandidate("excessive", 2_000, 0.0015);
  assert.equal(
    chooseRouteCandidate([direct, excessive], true).candidate,
    direct,
  );
});

test("round-trip planning favors target length and rejects route artifacts", () => {
  const target = routeCandidate("target", 10_000, 0.0008);
  const short = routeCandidate("short", 5_000, 0.0008);
  const plan = buildRoutePlan("Loop", [short, target], "numerical", true, {
    routeKind: "round-trip",
    targetDistanceMeters: 10_000,
  });
  assert.equal(plan.selectedId, "target");

  const crossing = {
    ...routeCandidate("crossing", 10_000, 0),
    coordinates: [
      [0, 0], [0.01, 0.01], [0, 0.01], [0.01, 0],
      [0.02, 0.01], [0.01, 0.02], [0.02, 0.02], [0, 0],
    ],
  };
  assert.throws(
    () => buildRoutePlan("Loop", [crossing], "numerical", true, {
      routeKind: "round-trip",
      targetDistanceMeters: 10_000,
    }),
    /doubled back or crossed/i,
  );
});

test("round trips cannot complete from a start-end reacquisition", () => {
  const base = {
    routeKind: "round-trip",
    progressMeters: 8_000,
    routeLengthMeters: 8_000,
    distanceToEndMeters: 0,
    confirmedHighWaterMeters: 2_000,
  };
  assert.equal(canCompleteRoute({ ...base, reacquired: true }), false);
  assert.equal(
    shouldHoldRoundTripReacquisition({
      routeKind: "round-trip",
      reacquired: true,
      distanceToEndMeters: 0,
      confirmedHighWaterMeters: 2_000,
      routeLengthMeters: 8_000,
    }),
    true,
  );
  const heldProgressMeters = 2_000;
  assert.equal(
    canCompleteRoute({
      ...base,
      progressMeters: heldProgressMeters,
      reacquired: false,
    }),
    false,
  );
  assert.equal(canCompleteRoute({ ...base, reacquired: false }), false);
  assert.equal(
    canCompleteRoute({
      ...base,
      reacquired: false,
      confirmedHighWaterMeters: 7_000,
    }),
    true,
  );
});

function routeCandidate(id, distanceMeters, latitudeAmplitude) {
  return {
    id,
    coordinates: Array.from({ length: 12 }, (_, index) => [
      -121 + index * 0.001,
      39 + (index % 2 ? latitudeAmplitude : 0),
    ]),
    distanceMeters,
    durationSeconds: distanceMeters / 10,
  };
}
