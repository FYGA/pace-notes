import test from "node:test";
import assert from "node:assert/strict";

import { Recorder } from "../js/recording.js";
import { SessionTracker, WakeLockService } from "../js/session.js";

function installGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test("stopping a session preserves its final elapsed snapshot", () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;

  try {
    const session = new SessionTracker();
    session.start();
    now += 4_500;
    const stopped = session.stop();

    assert.equal(stopped.elapsedMs, 4_500);
    assert.equal(session.snapshot().elapsedMs, 4_500);
    assert.equal(session.snapshot().active, false);
  } finally {
    Date.now = originalNow;
  }
});

test("poor GPS fixes cannot inflate session distance or top speed", () => {
  const session = new SessionTracker();
  session.start();
  session.update([0, 0], 20, { timestamp: 1_000, accuracyMeters: 5 });
  const snapshot = session.update([0.01, 0], 500, {
    timestamp: 2_000,
    accuracyMeters: 100,
  });

  assert.equal(snapshot.distanceMiles, 0);
  assert.equal(snapshot.topSpeedMph, 20);
});

test("recorded notes and track points use the same timeMs field", () => {
  const originalNow = Date.now;
  let now = 50_000;
  Date.now = () => now;

  try {
    const recorder = new Recorder();
    recorder.start();
    recorder.addTrackPoint({
      position: [1, 2],
      speedMph: 10,
      heading: 90,
      accuracyMeters: 4,
      timestamp: now + 300,
    });
    now += 600;
    recorder.addPaceNote(
      {
        position: [1, 2],
        call: "left four",
        severity: 4,
        direction: "L",
        angle: 45,
        radiusMeters: 70,
      },
      "left four",
    );
    const data = recorder.stop({ routeName: "Test route" });

    assert.equal(data.track[0].timeMs, 300);
    assert.equal(data.paceNotes[0].timeMs, 600);
    assert.equal("timeMds" in data.paceNotes[0], false);
  } finally {
    Date.now = originalNow;
  }
});

test("recording schema v3 adds provenance while preserving legacy note fields", () => {
  const recorder = new Recorder();
  recorder.start({
    engineVersion: "geometry-v2",
    noteSchemaVersion: 2,
    profileId: "descriptive",
  });
  const modifiers = ["long", "tightens"];
  recorder.addPaceNote(
    {
      id: "curve-100-R",
      position: [1, 2],
      call: "right open long tightens tight",
      generatedCall: "right medium",
      severity: 4,
      direction: "R",
      angle: 80,
      totalAngle: 81,
      radiusMeters: 70,
      startDistance: 100,
      apexDistance: 135,
      endDistance: 180,
      shape: "normal",
      modifiers,
      source: "route-geometry",
      verified: true,
      reviewed: true,
      reviewSource: "manual-recce",
      reviewStatus: "reviewed",
      manualReview: {
        source: "manual-recce",
        fields: ["severity"],
        changes: { severity: 4 },
      },
      manualAnnotations: [{ text: "keep in", source: "manual" }],
      profileId: "descriptive",
    },
    "right open long tightens tight",
    { groupId: "group-1", groupIndex: 0 },
  );
  modifiers.push("late");
  const data = recorder.stop({ routeName: "Schema test" });
  const note = data.paceNotes[0];

  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.paceNoteSystem, {
    engineVersion: "geometry-v2",
    noteSchemaVersion: 2,
    profileId: "descriptive",
  });
  for (const legacyKey of [
    "position",
    "call",
    "spoken",
    "severity",
    "direction",
    "angle",
    "radiusMeters",
    "caution",
    "timeMs",
  ]) {
    assert.ok(legacyKey in note, `legacy field ${legacyKey} should remain`);
  }
  assert.equal(note.noteId, "curve-100-R");
  assert.equal(note.entryDistanceMeters, 100);
  assert.equal(note.announcementGroupId, "group-1");
  assert.deepEqual(note.modifiers, ["long", "tightens"]);
  assert.equal(note.reviewSource, "manual-recce");
  assert.equal(note.reviewStatus, "reviewed");
  assert.equal(note.reviewed, true);
  assert.equal(note.generatedCall, "right medium");
  assert.deepEqual(note.manualReview.fields, ["severity"]);
  assert.deepEqual(note.manualReview.changes, { severity: 4 });
  assert.deepEqual(note.manualAnnotations, [
    { text: "keep in", source: "manual" },
  ]);
});

test("wake-lock requests are shared and release the matching sentinel", async () => {
  let requestCount = 0;
  const listeners = new Map();
  const sentinel = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    async release() {
      listeners.get("release")?.();
    },
  };
  const restoreNavigator = installGlobal("navigator", {
    wakeLock: {
      async request() {
        requestCount += 1;
        return sentinel;
      },
    },
  });

  try {
    const changes = [];
    const wakeLock = new WakeLockService((active) => changes.push(active));
    const [first, second] = await Promise.all([
      wakeLock.request(),
      wakeLock.request(),
    ]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(requestCount, 1);

    await wakeLock.release();
    assert.deepEqual(changes, [true, false]);
  } finally {
    restoreNavigator();
  }
});
