import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCurves, buildCallText } from "../js/curves.js";

const ORIGIN = [-121.06, 39.22];

function offset(eastMeters, northMeters) {
  const latitudeRadians = (ORIGIN[1] * Math.PI) / 180;
  return [
    ORIGIN[0] + eastMeters / (111_320 * Math.cos(latitudeRadians)),
    ORIGIN[1] + northMeters / 110_540,
  ];
}

function generateMeters(segments, stepMeters = 2) {
  const points = [{ east: 0, north: 0 }];
  let east = 0;
  let north = 0;
  let heading = 0;

  for (const segment of segments) {
    let traveled = 0;
    while (traveled < segment.length - 1e-9) {
      const step = Math.min(stepMeters, segment.length - traveled);
      const midpoint = traveled + step / 2;
      const curvature =
        typeof segment.curvature === "function"
          ? segment.curvature(midpoint, segment.length)
          : segment.curvature || 0;
      const midpointHeading = heading - (curvature * step) / 2;
      east += Math.cos(midpointHeading) * step;
      north += Math.sin(midpointHeading) * step;
      heading -= curvature * step;
      traveled += step;
      points.push({ east, north });
    }
  }
  return points;
}

function route(segments, stepMeters = 2, transform = (point) => point) {
  return generateMeters(segments, stepMeters).map((point, index) => {
    const transformed = transform(point, index);
    return offset(transformed.east, transformed.north);
  });
}

const straight = (length) => ({ length, curvature: 0 });
const constant = (length, radius, direction = "R") => ({
  length,
  curvature: (direction === "R" ? 1 : -1) / radius,
});

test("straight roads do not produce pace notes", () => {
  assert.deepEqual(analyzeCurves(route([straight(600)])), []);
});

test("a constant-radius sweeper becomes one stable long corner", () => {
  const curves = analyzeCurves(
    route([straight(80), constant(120, 80), straight(80)]),
  );

  assert.equal(curves.length, 1);
  const [curve] = curves;
  assert.equal(curve.direction, "R");
  assert.equal(curve.shape, "normal");
  assert.equal(curve.isLong, true);
  assert.equal(curve.modifier, null);
  assert.ok(curve.radiusMeters >= 65 && curve.radiusMeters <= 100);
  assert.ok(curve.angle >= 70 && curve.angle <= 100);
  assert.match(curve.call, /^right \d long$/);
});

test("a ninety-degree bend is classified as a square with semantic bounds", () => {
  const radius = 38;
  const curves = analyzeCurves(
    route([
      straight(80),
      constant((Math.PI / 2) * radius, radius),
      straight(80),
    ]),
  );

  assert.equal(curves.length, 1);
  const [curve] = curves;
  assert.equal(curve.direction, "R");
  assert.equal(curve.shape, "square");
  assert.equal(curve.isSquare, true);
  assert.equal(curve.isHairpin, false);
  assert.ok(curve.angle >= 78 && curve.angle <= 102);
  assert.ok(curve.startDistance < curve.apexDistance);
  assert.ok(curve.apexDistance < curve.endDistance);
  assert.ok(curve.startIndex <= curve.apexIndex);
  assert.ok(curve.apexIndex <= curve.endIndex);
  assert.deepEqual(curve.position, curve.startPosition);
  assert.equal(buildCallText(curve), "right square");
});

test("a near-180-degree bend is classified as a hairpin", () => {
  const radius = 22;
  const curves = analyzeCurves(
    route([
      straight(70),
      constant(Math.PI * radius, radius, "L"),
      straight(70),
    ]),
  );

  assert.equal(curves.length, 1);
  assert.equal(curves[0].direction, "L");
  assert.equal(curves[0].shape, "hairpin");
  assert.equal(curves[0].isHairpin, true);
  assert.ok(curves[0].angle >= 150);
  assert.equal(curves[0].call, "left hairpin");
});

test("an S bend is split on reversal into opposite-direction corners", () => {
  const curves = analyzeCurves(
    route([
      straight(70),
      constant(48, 35, "R"),
      straight(8),
      constant(48, 35, "L"),
      straight(70),
    ]),
  );

  assert.equal(curves.length, 2);
  assert.deepEqual(
    curves.map((curve) => curve.direction),
    ["R", "L"],
  );
  assert.ok(curves[0].endDistance <= curves[1].startDistance);
});

test("progressive tightening does not invent a late apex", () => {
  const tightening = (distance, length) => {
    const progress = distance / length;
    return 1 / (120 - progress * 85);
  };
  const curves = analyzeCurves(
    route([
      straight(80),
      { length: 120, curvature: tightening },
      straight(80),
    ]),
  );

  assert.equal(curves.length, 1);
  const [curve] = curves;
  assert.equal(curve.modifier, "tightens");
  assert.equal(curve.isLate, false);
  assert.ok(curve.entryRadiusMeters > curve.exitRadiusMeters * 1.8);
  assert.match(curve.call, /tightens \d$/);
});

test("late is reserved for tightening concentrated near the corner exit", () => {
  const lateTightening = (distance, length) => {
    const progress = distance / length;
    if (progress < 0.65) return 1 / 110;
    return 1 / (110 - ((progress - 0.65) / 0.35) * 75);
  };
  const [curve] = analyzeCurves(
    route([
      straight(80),
      { length: 120, curvature: lateTightening },
      straight(80),
    ]),
  );
  assert.equal(curve.modifier, "tightens");
  assert.equal(curve.isLate, true);
  assert.match(curve.call, /tightens \d late$/);
});

test("opens comes from falling curvature within one corner", () => {
  const opening = (distance, length) => {
    const progress = distance / length;
    return 1 / (35 + progress * 85);
  };
  const curves = analyzeCurves(
    route([
      straight(80),
      { length: 120, curvature: opening },
      straight(80),
    ]),
  );

  assert.equal(curves.length, 1);
  const [curve] = curves;
  assert.equal(curve.modifier, "opens");
  assert.ok(curve.entryRadiusMeters * 1.8 < curve.exitRadiusMeters);
  assert.match(curve.call, /opens \d$/);
});

test("severity and shape are stable across input sampling densities", () => {
  const segments = [straight(90), constant(95, 52), straight(90)];
  const dense = analyzeCurves(route(segments, 1));
  const sparse = analyzeCurves(route(segments, 12));

  assert.equal(dense.length, 1);
  assert.equal(sparse.length, 1);
  assert.equal(dense[0].direction, sparse[0].direction);
  assert.equal(dense[0].shape, sparse[0].shape);
  assert.ok(Math.abs(dense[0].severity - sparse[0].severity) <= 1);
  assert.ok(Math.abs(dense[0].radiusMeters - sparse[0].radiusMeters) <= 15);
  assert.ok(Math.abs(dense[0].angle - sparse[0].angle) <= 12);
  assert.equal(dense[0].id, sparse[0].id);
});

test("small deterministic geometry noise does not fragment a corner", () => {
  const coordinates = route(
    [straight(80), constant(90, 55), straight(80)],
    2,
    (point, index) => ({
      east: point.east,
      north: point.north + Math.sin(index * 1.73) * 0.55,
    }),
  );
  const curves = analyzeCurves(coordinates);

  assert.equal(curves.length, 1);
  assert.equal(curves[0].direction, "R");
  assert.ok(curves[0].radiusMeters >= 40 && curves[0].radiusMeters <= 75);
});

test("a real straight separates same-direction bends", () => {
  const segments = [
    straight(75),
    constant(50, 35, "R"),
    straight(10),
    constant(50, 55, "R"),
    straight(75),
  ];
  for (const stepMeters of [1, 2, 4, 5, 6, 8, 10, 12, 15]) {
    const curves = analyzeCurves(route(segments, stepMeters));
    assert.equal(curves.length, 2, `source spacing ${stepMeters} m`);
    assert.ok(curves[0].endDistance <= curves[1].startDistance);
    assert.ok(
      curves.every((curve) => curve.modifier === null),
      `source spacing ${stepMeters} m emitted ${curves.map((curve) => curve.call).join(" / ")}`,
    );
  }
});

test("insufficiently dense source geometry is suppressed conservatively", () => {
  const segments = [straight(90), constant(100, 52), straight(90)];
  assert.equal(analyzeCurves(route(segments, 40)).length, 0);
  assert.equal(analyzeCurves(route(segments, 60)).length, 0);
});

test("broad reversals are hairpins but circular loops are not", () => {
  const broad = analyzeCurves(
    route([straight(70), constant(Math.PI * 70, 70), straight(70)]),
  );
  const loop = analyzeCurves(
    route([straight(70), constant(Math.PI * 1.5 * 30, 30), straight(70)]),
  );
  assert.equal(broad[0]?.shape, "hairpin");
  assert.notEqual(loop[0]?.shape, "hairpin");
});

test("geometry-only analysis never invents hazards or cautions", () => {
  const curves = analyzeCurves(
    route([straight(100), constant(80, 28), straight(100)]),
  );
  assert.ok(curves.length > 0);

  for (const curve of curves) {
    assert.equal(curve.caution, undefined);
    assert.doesNotMatch(curve.call, /caution|don't cut|sudden|brake/i);
    assert.doesNotMatch(curve.description, /caution|don't cut|sudden|brake/i);
  }
});

test("corner IDs are spatial and unique without depending on array order", () => {
  const curves = analyzeCurves(
    route([
      straight(70),
      constant(48, 35, "R"),
      straight(25),
      constant(48, 35, "L"),
      straight(70),
    ]),
  );
  assert.equal(new Set(curves.map((curve) => curve.id)).size, curves.length);
  assert.ok(curves.every((curve) => curve.id.startsWith(`corner-${curve.direction}-`)));
});

test("repeated laps receive unique occurrence IDs", () => {
  const halfLap = [straight(100), constant(Math.PI * 30, 30, "R")];
  const curves = analyzeCurves(
    route([
      ...halfLap,
      ...halfLap,
      ...halfLap,
      ...halfLap,
      ...halfLap,
      ...halfLap,
    ]),
  );
  assert.equal(curves.length, 6);
  assert.equal(new Set(curves.map((curve) => curve.id)).size, curves.length);
  assert.ok(curves.some((curve) => curve.id.includes("-occ-")));
});
