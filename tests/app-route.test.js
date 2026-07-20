import test from "node:test";
import assert from "node:assert/strict";

import { materializeCurves } from "../js/app.js";

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
