import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PACE_NOTE_PROFILE,
  loadPreferences,
  savePreferences,
} from "../js/settings.js";

function withStorage(run) {
  const values = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      },
    },
  });

  try {
    return run(values);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

test("pace-note preferences round trip", () => {
  withStorage(() => {
    assert.deepEqual(savePreferences({
      paceNoteProfile: "descriptive",
      preferWindingRoutes: false,
    }), {
      paceNoteProfile: "descriptive",
      preferWindingRoutes: false,
    });
    assert.deepEqual(loadPreferences(), {
      paceNoteProfile: "descriptive",
      preferWindingRoutes: false,
    });
  });
});

test("unknown and corrupted preferences fall back safely", () => {
  withStorage((values) => {
    values.set(
      "paceNotes.preferences.v1",
      JSON.stringify({ paceNoteProfile: "unknown" }),
    );
    assert.deepEqual(loadPreferences(), {
      paceNoteProfile: DEFAULT_PACE_NOTE_PROFILE,
      preferWindingRoutes: true,
    });

    values.set("paceNotes.preferences.v1", "not-json");
    assert.deepEqual(loadPreferences(), {
      paceNoteProfile: DEFAULT_PACE_NOTE_PROFILE,
      preferWindingRoutes: true,
    });
  });
});

test("blocked browser storage does not prevent startup or in-memory choices", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem() {
        throw new DOMException("blocked", "SecurityError");
      },
    },
  });

  try {
    assert.deepEqual(loadPreferences(), {
      paceNoteProfile: DEFAULT_PACE_NOTE_PROFILE,
      preferWindingRoutes: true,
    });
    assert.deepEqual(savePreferences({ paceNoteProfile: "descriptive" }), {
      paceNoteProfile: "descriptive",
      preferWindingRoutes: true,
    });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
