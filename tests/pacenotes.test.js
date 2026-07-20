import test from "node:test";
import assert from "node:assert/strict";

import {
  PACENOTE_PROFILES,
  renderCornerCall,
  renderLinkedCall,
  resolvePacenoteProfile,
} from "../js/pacenotes.js";

function corner(overrides = {}) {
  return {
    direction: "L",
    severity: 4,
    distanceFromStart: 100,
    ...overrides,
  };
}

test("the numerical profile preserves existing left/right 1-6 wording", () => {
  assert.equal(renderCornerCall(corner()), "left 4");
  assert.equal(renderCornerCall(corner({ shape: "normal" })), "left 4");
  assert.equal(
    renderCornerCall(corner({ direction: "R", severity: 1 }), "numerical"),
    "right 1",
  );
  assert.equal(
    renderCornerCall(corner({ direction: "R", severity: 6 }), "numeric"),
    "right 6",
  );
  assert.equal(PACENOTE_PROFILES.numerical.id, "numerical");
});

test("the descriptive profile changes language without changing semantics", () => {
  assert.equal(renderCornerCall(corner(), "descriptive"), "left open");
  assert.equal(
    renderCornerCall(corner({ direction: "R", severity: 1 }), "descriptive"),
    "right very tight",
  );
  assert.equal(
    renderCornerCall(corner({ direction: "R", severity: 6 }), "descriptive"),
    "right gentle",
  );
});

test("shapes and ordered modifiers retain their semantic order", () => {
  assert.equal(
    renderCornerCall(
      corner({
        direction: "R",
        shape: "square",
        modifiers: [
          "long",
          { type: "tightens", toSeverity: 2 },
          { type: "opens", toSeverity: 4 },
        ],
      }),
    ),
    "right square long tightens 2 opens 4",
  );
  assert.equal(
    renderCornerCall(
      corner({ modifier: "tightens", modifierSeverity: 3 }),
      "descriptive",
    ),
    "left open tightens medium",
  );
  assert.equal(
    renderCornerCall(
      corner({
        modifiers: ["long", "tightens", "late"],
        modifier: "tightens",
        modifierSeverity: 2,
      }),
    ),
    "left 4 long tightens 2 late",
  );
});

test("custom grade hooks control plus/minus rendering for base and target grades", () => {
  const verbalProfile = resolvePacenoteProfile({
    base: "numerical",
    id: "verbal-adjustments",
    formatGrade({ label, adjustment }) {
      if (adjustment === "+") return `${label} plus`;
      if (adjustment === "-") return `${label} minus`;
      return label;
    },
  });

  assert.equal(
    renderCornerCall(
      corner({
        adjustment: "plus",
        modifiers: [{ type: "tightens", toSeverity: 3, adjustment: "minus" }],
      }),
      verbalProfile,
    ),
    "left 4 plus tightens 3 minus",
  );
});

test("linked calls default to and or a rounded distance, never inferred into", () => {
  const current = corner();
  const close = corner({ direction: "R", severity: 3, distanceFromStart: 112 });
  const distant = corner({ direction: "R", severity: 3, distanceFromStart: 447 });

  assert.equal(renderLinkedCall(current, close), "left 4, and, right 3");
  assert.equal(renderLinkedCall(current, distant), "left 4, 350, right 3");
});

test("canonical entry distances take precedence over mutable display distance", () => {
  const current = corner({ entryDistanceMeters: 100, distance: 40 });
  const next = corner({
    direction: "R",
    severity: 3,
    entryDistanceMeters: 160,
    distance: 45,
  });
  assert.equal(renderLinkedCall(current, next), "left 4, 60, right 3");
});

test("default connectors measure from current exit to next entry", () => {
  const current = corner({
    entryDistanceMeters: 100,
    exitDistanceMeters: 180,
  });
  const next = corner({
    direction: "R",
    severity: 3,
    entryDistanceMeters: 200,
  });
  assert.equal(renderLinkedCall(current, next), "left 4, and, right 3");
});

test("into requires an explicit no-straight semantic connector", () => {
  const current = corner({ connectionToNext: { kind: "no-straight" } });
  const next = corner({ direction: "R", severity: 2, distanceFromStart: 106 });

  assert.equal(renderLinkedCall(current, next), "left 4, into, right 2");
  assert.throws(
    () => renderLinkedCall(corner(), next, "numerical", { kind: "into" }),
    /no-straight/,
  );
});

test("only explicitly manual annotations are rendered", () => {
  assert.equal(
    renderCornerCall(
      corner({
        caution: "don't cut",
        annotations: [
          { text: "slippery", source: "generated" },
          { text: "crest", source: "manual" },
        ],
        manualAnnotations: ["narrows", { text: "don't cut" }],
      }),
    ),
    "left 4, narrows, don't cut, crest",
  );
  assert.equal(renderCornerCall(corner({ caution: "don't cut" })), "left 4");
  assert.equal(
    renderCornerCall(corner({ caution: "don't cut", cautionSource: "manual" })),
    "left 4, don't cut",
  );
});
