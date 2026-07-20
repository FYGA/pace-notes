import test from "node:test";
import assert from "node:assert/strict";

import {
  canConfirmRouteDirection,
  CallScheduler,
  callLookaheadMeters,
  evaluateTelemetryQuality,
  isRouteHeadingCompatible,
} from "../js/drive.js";

const curves = [
  { id: "one", distanceFromStart: 100, severity: 3, call: "left three" },
  { id: "two", distanceFromStart: 170, severity: 4, call: "right four" },
];

test("GPS quality rejects stale and inaccurate positions", () => {
  const now = 100_000;
  assert.equal(
    evaluateTelemetryQuality(
      {
        position: [0, 0],
        timestamp: now - 11_000,
        accuracyMeters: 5,
      },
      { now },
    ).usable,
    false,
  );
  assert.equal(
    evaluateTelemetryQuality(
      {
        position: [0, 0],
        timestamp: now,
        accuracyMeters: 80,
      },
      { now },
    ).usable,
    false,
  );
  assert.equal(
    evaluateTelemetryQuality(
      {
        position: [0, 0],
        timestamp: now,
        accuracyMeters: 8,
      },
      { now },
    ).usable,
    true,
  );
});

test("calls remain pending while GPS confidence is insufficient", () => {
  const scheduler = new CallScheduler();
  scheduler.reset(curves);

  const blocked = scheduler.update({
    curves,
    progressMeters: 60,
    speedMph: 30,
    canAnnounce: false,
  });
  assert.equal(blocked.announcement, null);
  assert.equal(scheduler.stateFor("one"), "pending");

  const recovered = scheduler.update({
    curves,
    progressMeters: 70,
    speedMph: 30,
    canAnnounce: true,
  });
  assert.equal(recovered.announcement?.id, "one");
});

test("a GPS update crossing the former ten-meter dead zone still calls", () => {
  const scheduler = new CallScheduler();
  scheduler.reset(curves);
  const result = scheduler.update({
    curves,
    progressMeters: 95,
    speedMph: 30,
    canAnnounce: true,
  });
  assert.equal(result.announcement?.id, "one");
});

test("an expired head note cannot block the following bend", () => {
  const scheduler = new CallScheduler();
  scheduler.reset(curves);
  const result = scheduler.update({
    curves,
    progressMeters: 120,
    speedMph: 30,
    canAnnounce: true,
  });
  assert.equal(scheduler.stateFor("one"), "passed");
  assert.equal(result.announcement?.id, "two");
});

test("lookahead grows with road speed", () => {
  assert.ok(
    callLookaheadMeters(curves[0], 70) > callLookaheadMeters(curves[0], 10),
  );
});

test("reverse-direction travel is not eligible for pace calls", () => {
  assert.equal(
    isRouteHeadingCompatible({
      heading: 270,
      headingDelta: 180,
      speedMph: 30,
    }),
    false,
  );
  assert.equal(
    isRouteHeadingCompatible({
      heading: null,
      headingDelta: null,
      speedMph: 30,
    }),
    false,
  );
  assert.equal(
    isRouteHeadingCompatible({
      heading: null,
      headingDelta: null,
      speedMph: 2,
    }),
    true,
  );
  assert.equal(
    canConfirmRouteDirection({
      heading: 90,
      headingDelta: 70,
      speedMph: 20,
    }),
    true,
  );
  assert.equal(
    canConfirmRouteDirection({
      heading: 90,
      headingDelta: 71,
      speedMph: 20,
    }),
    false,
  );
  assert.equal(
    canConfirmRouteDirection({
      heading: null,
      headingDelta: null,
      speedMph: 0,
    }),
    false,
  );
});

test("linked corners are scheduled atomically and cannot announce twice", () => {
  const scheduler = new CallScheduler();
  scheduler.reset(curves);
  const first = scheduler.update({
    curves,
    progressMeters: 60,
    speedMph: 30,
    canAnnounce: true,
  });

  assert.equal(first.announcement?.id, "one");
  assert.equal(first.linkedCurve?.id, "two");
  assert.equal(scheduler.stateFor("one"), "spoken");
  assert.equal(scheduler.stateFor("two"), "spoken");

  const second = scheduler.update({
    curves,
    progressMeters: 90,
    speedMph: 30,
    canAnnounce: true,
  });
  assert.equal(second.announcement, null);
});

test("rebasing after a pause restores only notes still ahead", () => {
  const scheduler = new CallScheduler();
  scheduler.reset(curves);
  scheduler.markSpoken("one");
  scheduler.markSpoken("two");
  scheduler.rebase(curves, 120);

  assert.equal(scheduler.stateFor("one"), "passed");
  assert.equal(scheduler.stateFor("two"), "pending");
});
