import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCurves, buildCallText } from "../js/curves.js";
import { buildCumulativeDistances, closestRoutePoint } from "../js/utils.js";

const ORIGIN = [-121.06, 39.22];

function offset(eastMeters, northMeters) {
  const latitudeRadians = (ORIGIN[1] * Math.PI) / 180;
  return [
    ORIGIN[0] + eastMeters / (111_320 * Math.cos(latitudeRadians)),
    ORIGIN[1] + northMeters / 110_540,
  ];
}

function line(startEast, startNorth, endEast, endNorth, points = 20) {
  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    return offset(
      startEast + (endEast - startEast) * progress,
      startNorth + (endNorth - startNorth) * progress,
    );
  });
}

test("straight roads do not produce pace notes", () => {
  const coordinates = line(0, 0, 600, 0, 80);
  assert.deepEqual(analyzeCurves(coordinates), []);
});

test("a ninety-degree right corner is detected", () => {
  const coordinates = [
    ...line(0, 0, 180, 0, 30),
    ...line(180, -5, 180, -190, 30),
  ];
  const curves = analyzeCurves(coordinates);
  const rightCurve = curves.find((curve) => curve.direction === "R");

  assert.ok(rightCurve, "expected a right curve");
  assert.ok(
    rightCurve.severity <= 4,
    `expected a meaningful severity, received ${rightCurve.severity}`,
  );
  assert.match(buildCallText(rightCurve), /^right /);
});

test("geometry-only analysis does not invent hazards or driving instructions", () => {
  const coordinates = [
    ...line(0, 0, 420, 0, 70),
    ...line(420, -5, 420, -220, 40),
  ];
  const curves = analyzeCurves(coordinates);

  assert.ok(curves.length > 0, "expected at least one detected curve");
  for (const curve of curves) {
    assert.equal(curve.caution, undefined);
    assert.doesNotMatch(curve.call, /don't cut|sudden/i);
    assert.doesNotMatch(buildCallText(curve), /don't cut|sudden/i);
  }
});

test("opposite-direction curves are not incorrectly deduplicated", () => {
  const coordinates = [
    ...line(0, 0, 120, 0, 22),
    ...line(120, -5, 120, -90, 18),
    ...line(125, -90, 235, -90, 22),
    ...line(235, -85, 235, 10, 18),
  ];
  const curves = analyzeCurves(coordinates);
  const directions = new Set(curves.map((curve) => curve.direction));

  assert.ok(directions.has("L"));
  assert.ok(directions.has("R"));
});

test("route distance indexing and nearest-point lookup remain stable", () => {
  const coordinates = line(0, 0, 500, 0, 51);
  const cumulative = buildCumulativeDistances(coordinates);
  const nearest = closestRoutePoint(offset(247, 4), coordinates, 25);

  assert.ok(cumulative.at(-1) > 490 && cumulative.at(-1) < 510);
  assert.ok(nearest.index >= 23 && nearest.index <= 27);
  assert.ok(nearest.distance < 8);
});
