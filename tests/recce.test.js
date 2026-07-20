import test from "node:test";
import assert from "node:assert/strict";

import {
  MANUAL_RECCE_SOURCE,
  applyRecceOverrides,
  applyRecceOverridesToRoute,
  createRecceReviewLayer,
  markRecceReviewed,
  recceStatusFor,
  revertRecceOverride,
  setRecceOverride,
  validateRecceReviewLayer,
} from "../js/recce.js";

function note(overrides = {}) {
  return {
    id: "corner-L-abc",
    direction: "L",
    severity: 4,
    shape: "normal",
    isHairpin: false,
    isSquare: false,
    modifiers: [],
    startDistance: 100,
    distanceFromStart: 100,
    entryDistanceMeters: 100,
    exitDistanceMeters: 150,
    radiusMeters: 70,
    angle: 65,
    position: [1, 2],
    profileId: "numerical",
    source: "route-geometry",
    verified: false,
    call: "left 4",
    shortLabel: "L 4",
    linkedCall: "left 4",
    ...overrides,
  };
}

test("review edits are keyed by stable note id with manual provenance", () => {
  const empty = createRecceReviewLayer();
  const reviewed = setRecceOverride(
    empty,
    "corner-L-abc",
    {
      direction: "right",
      severity: 2,
      shape: "square",
      adjustment: "plus",
      modifiers: [{ type: "opens", toSeverity: 4 }],
      manualAnnotations: ["narrows"],
      caution: "don't cut",
    },
    { reviewer: "Alex", reviewedAt: "2026-07-20T12:00:00-07:00" },
  );

  assert.deepEqual(empty, createRecceReviewLayer());
  assert.equal(validateRecceReviewLayer(reviewed), true);
  assert.equal(reviewed.overrides["corner-L-abc"].source, MANUAL_RECCE_SOURCE);
  assert.equal(reviewed.overrides["corner-L-abc"].noteId, "corner-L-abc");
  assert.equal(reviewed.overrides["corner-L-abc"].changes.direction, "R");
  assert.equal(reviewed.overrides["corner-L-abc"].changes.adjustment, "+");
  assert.equal(
    reviewed.overrides["corner-L-abc"].reviewedAt,
    "2026-07-20T19:00:00.000Z",
  );
  assert.deepEqual(recceStatusFor(reviewed, "corner-L-abc"), {
    status: "reviewed",
    edited: true,
    source: MANUAL_RECCE_SOURCE,
    reviewer: "Alex",
    reviewedAt: "2026-07-20T19:00:00.000Z",
  });
});

test("applying an override changes semantics but preserves generated geometry", () => {
  const generated = note();
  const layer = setRecceOverride(createRecceReviewLayer(), generated.id, {
    direction: "R",
    severity: 2,
    shape: "square",
    adjustment: "+",
    manualAnnotations: ["narrows"],
    caution: "don't cut",
  });
  const [reviewed] = applyRecceOverrides([generated], layer);

  assert.equal(reviewed.call, "right square, narrows, don't cut");
  assert.equal(reviewed.shortLabel, "R square");
  assert.equal(reviewed.verified, false);
  assert.equal(reviewed.reviewStatus, "reviewed");
  assert.equal(reviewed.reviewSource, MANUAL_RECCE_SOURCE);
  assert.equal(reviewed.source, "route-geometry");
  assert.equal(reviewed.radiusMeters, generated.radiusMeters);
  assert.equal(reviewed.angle, generated.angle);
  assert.equal(reviewed.entryDistanceMeters, generated.entryDistanceMeters);
  assert.deepEqual(reviewed.position, generated.position);
  assert.equal(reviewed.cautionSource, "manual");
  assert.equal(reviewed.cautionManual, true);
  assert.deepEqual(reviewed.manualAnnotations, [
    { text: "narrows", source: "manual", manual: true },
  ]);
  assert.equal(generated.call, "left 4");
  assert.equal(generated.verified, false);
});

test("profile rematerialization reapplies stable edits and rebuilds linked calls", () => {
  const first = note({
    id: "corner-L-first",
    connectionToNext: { kind: "and", meters: 20 },
  });
  const second = note({
    id: "corner-R-second",
    direction: "R",
    severity: 5,
    startDistance: 170,
    distanceFromStart: 170,
    entryDistanceMeters: 170,
    exitDistanceMeters: 220,
  });
  const layer = setRecceOverride(createRecceReviewLayer(), second.id, {
    severity: 2,
    manualAnnotations: ["crest"],
  });

  const reviewed = applyRecceOverrides([first, second], layer, {
    profileId: "descriptive",
  });
  assert.equal(reviewed[0].call, "left open");
  assert.equal(reviewed[1].call, "right tight, crest");
  assert.equal(reviewed[0].linkedCall, "left open, and, right tight, crest");
  assert.equal(reviewed[1].linkedCall, reviewed[1].call);
  assert.equal(reviewed[1].profileId, "descriptive");
  assert.equal(reviewed[1].id, second.id);
});

test("whole-route apply synchronizes remaining notes without losing runtime state", () => {
  const curve = note();
  const route = {
    name: "Recce route",
    profileId: "numerical",
    curves: [curve],
    remainingCurves: [{ ...curve, distance: 43, callState: "spoken" }],
  };
  const layer = setRecceOverride(createRecceReviewLayer(), curve.id, {
    severity: 3,
  });
  const reviewed = applyRecceOverridesToRoute(route, layer, {
    profileId: "descriptive",
  });

  assert.equal(reviewed.profileId, "descriptive");
  assert.equal(reviewed.curves[0].call, "left medium");
  assert.equal(reviewed.remainingCurves[0].call, "left medium");
  assert.equal(reviewed.remainingCurves[0].distance, 43);
  assert.equal(reviewed.remainingCurves[0].callState, "spoken");
  assert.equal(route.curves[0].call, "left 4");
});

test("reviewed-without-edits is explicit and stale review ids are harmless", () => {
  const layer = markRecceReviewed(
    createRecceReviewLayer(),
    "corner-L-abc",
    { reviewer: "Sam" },
  );
  const withStale = setRecceOverride(layer, "corner-no-longer-on-route", {
    severity: 1,
  });
  const [reviewed] = applyRecceOverrides([note()], withStale);

  assert.equal(reviewed.call, "left 4");
  assert.equal(reviewed.verified, false);
  assert.deepEqual(reviewed.manualReview.fields, []);
  assert.deepEqual(recceStatusFor(layer, "unseen-note"), {
    status: "unreviewed",
    edited: false,
    source: null,
  });
});

test("valid persisted aliases normalize again when a JSON layer is applied", () => {
  const persisted = {
    schemaVersion: 1,
    kind: "pace-note-recce-overrides",
    overrides: {
      "corner-L-abc": {
        noteId: "corner-L-abc",
        source: "manual-recce",
        status: "reviewed",
        reviewer: null,
        reviewedAt: null,
        changes: {
          direction: "right",
          adjustment: "plus",
          manualAnnotations: ["crest"],
        },
      },
    },
  };
  const [reviewed] = applyRecceOverrides([note()], persisted);

  assert.equal(reviewed.direction, "R");
  assert.equal(reviewed.adjustment, "+");
  assert.equal(reviewed.call, "right 4+, crest");
});

test("reverting restores generated behavior without mutating prior reviews", () => {
  const edited = setRecceOverride(createRecceReviewLayer(), "corner-L-abc", {
    severity: 1,
  });
  const reverted = revertRecceOverride(edited, "corner-L-abc");
  const [generated] = applyRecceOverrides([note()], reverted);

  assert.equal(generated.call, "left 4");
  assert.equal(generated.verified, false);
  assert.ok(edited.overrides["corner-L-abc"]);
  assert.equal(reverted.overrides["corner-L-abc"], undefined);
});

test("validation rejects geometry edits, invalid semantics, spoofed provenance, and duplicate ids", () => {
  const empty = createRecceReviewLayer();
  assert.throws(
    () => setRecceOverride(empty, "corner", { position: [0, 0] }),
    /cannot override position/,
  );
  assert.throws(
    () => setRecceOverride(empty, "corner", { severity: 0 }),
    /integer from 1 to 6/,
  );
  assert.throws(
    () => setRecceOverride(empty, "corner", { modifiers: ["teleport"] }),
    /Unsupported manual modifier/,
  );
  assert.throws(
    () => setRecceOverride(empty, "corner", { manualAnnotations: ["bad\ntext"] }),
    /printable characters/,
  );

  const spoofed = {
    schemaVersion: 1,
    kind: "pace-note-recce-overrides",
    overrides: {
      corner: {
        noteId: "corner",
        source: "generated",
        status: "reviewed",
        reviewer: null,
        reviewedAt: null,
        changes: {},
      },
    },
  };
  assert.throws(() => validateRecceReviewLayer(spoofed), /manual provenance/);
  assert.throws(
    () => applyRecceOverrides([note(), note()], empty),
    /Duplicate materialized pace-note id/,
  );
});
