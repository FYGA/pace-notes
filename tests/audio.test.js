import test from "node:test";
import assert from "node:assert/strict";

import { AudioService, buildAnnouncement } from "../js/audio.js";

function curve(overrides = {}) {
  return {
    direction: "L",
    severity: 4,
    distance: 100,
    ...overrides,
  };
}

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

function installSpeechMock() {
  const spoken = [];
  let cancelCount = 0;

  class MockUtterance {
    constructor(text) {
      this.text = text;
    }
  }

  const restoreUtterance = installGlobal(
    "SpeechSynthesisUtterance",
    MockUtterance,
  );
  const restoreSynthesis = installGlobal("speechSynthesis", {
    speak(utterance) {
      spoken.push(utterance);
    },
    cancel() {
      cancelCount += 1;
    },
  });

  return {
    spoken,
    get cancelCount() {
      return cancelCount;
    },
    restore() {
      restoreSynthesis();
      restoreUtterance();
    },
  };
}

test("buildAnnouncement uses conservative and and rounded-distance connectors", () => {
  const first = curve();

  assert.equal(
    buildAnnouncement(
      first,
      curve({ direction: "R", severity: 3, distance: 118 }),
    ),
    "left 4, and, right 3",
  );
  assert.equal(
    buildAnnouncement(
      first,
      curve({ direction: "R", severity: 3, distance: 142 }),
    ),
    "left 4, and, right 3",
  );
  assert.equal(
    buildAnnouncement(
      first,
      curve({ direction: "R", severity: 3, distance: 447 }),
    ),
    "left 4, 350, right 3",
  );
});

test("buildAnnouncement preserves explicit semantic into and profile wording", () => {
  const first = curve({
    profileId: "descriptive",
    shape: "normal",
    connectionToNext: { kind: "no-straight", meters: 8 },
  });
  const next = curve({
    profileId: "descriptive",
    direction: "R",
    severity: 2,
    distance: 108,
    shape: "normal",
  });
  assert.equal(buildAnnouncement(first, next), "left open, into, right tight");
});

test("linked calls are queued as one atomic utterance without cancelling active speech", async () => {
  const speech = installSpeechMock();
  try {
    const audio = new AudioService();
    const linkedText = audio.announce(
      curve(),
      curve({ direction: "R", severity: 2, distance: 115 }),
    );
    audio.announce(curve({ direction: "R", severity: 5, distance: 300 }));

    assert.equal(linkedText, "left 4, and, right 2");
    assert.equal(speech.spoken.length, 1);
    assert.equal(speech.spoken[0].text, linkedText);
    assert.equal(speech.cancelCount, 0);

    speech.spoken[0].onend();
    await Promise.resolve();

    assert.equal(speech.spoken.length, 2);
    assert.equal(speech.spoken[1].text, "right 5");
    assert.equal(speech.cancelCount, 0);
    speech.spoken[1].onend();
  } finally {
    speech.restore();
  }
});

test("speech errors release the queue and duplicate completion events are harmless", async () => {
  const speech = installSpeechMock();
  try {
    const audio = new AudioService();
    audio.announce(curve());
    audio.announce(curve({ direction: "R", distance: 200 }));

    const failedUtterance = speech.spoken[0];
    failedUtterance.onerror(new Error("voice unavailable"));
    await Promise.resolve();

    assert.equal(speech.spoken.length, 2);
    failedUtterance.onend();
    await Promise.resolve();
    assert.equal(speech.spoken.length, 2);
    speech.spoken[1].onend();
  } finally {
    speech.restore();
  }
});

test("beep finishes before speech begins", async () => {
  let oscillatorStoppedAt = null;
  class MockAudioContext {
    state = "running";
    currentTime = 2;
    destination = {};

    createOscillator() {
      return {
        type: "",
        frequency: { value: 0 },
        connect() {},
        start() {},
        stop(time) {
          oscillatorStoppedAt = time;
        },
      };
    }

    createGain() {
      return {
        connect() {},
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
      };
    }
  }

  const restoreAudioContext = installGlobal("AudioContext", MockAudioContext);
  const restoreSpeechSynthesis = installGlobal("speechSynthesis", undefined);
  const restoreUtterance = installGlobal("SpeechSynthesisUtterance", undefined);
  const audio = new AudioService();

  try {
    await audio.unlock();
    restoreSpeechSynthesis();
    restoreUtterance();
    const speech = installSpeechMock();
    try {
      audio.announce(curve());
      assert.equal(oscillatorStoppedAt, 2.15);
      assert.equal(
        speech.spoken.length,
        0,
        "speech should wait for the beep lead-in",
      );

      await new Promise((resolve) => setTimeout(resolve, 220));
      assert.equal(speech.spoken.length, 1);
      speech.spoken[0].onend();
    } finally {
      speech.restore();
    }
  } finally {
    restoreAudioContext();
  }
});

test("invalid queued calls are pruned before they can be spoken", () => {
  const speech = installSpeechMock();
  let firstValid = true;
  let secondValid = true;
  const audio = new AudioService();

  try {
    audio.announce(curve(), null, { isValid: () => firstValid });
    audio.announce(curve({ direction: "R" }), null, {
      isValid: () => secondValid,
    });
    assert.equal(audio.queueDepth, 2);

    secondValid = false;
    audio.prune();
    assert.equal(audio.queueDepth, 1);

    firstValid = false;
    audio.prune();
    assert.equal(audio.queueDepth, 0);
    assert.equal(speech.cancelCount, 1);
  } finally {
    audio.clear();
    speech.restore();
  }
});

test("speech watchdog releases a stalled utterance and advances the queue", async () => {
  const speech = installSpeechMock();
  const audio = new AudioService({ watchdogMs: () => 15 });

  try {
    audio.announce(curve());
    audio.announce(curve({ direction: "R" }));
    assert.equal(speech.spoken.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(speech.cancelCount, 1);
    assert.equal(speech.spoken.length, 2);
    speech.spoken[1].onend();
  } finally {
    audio.clear();
    speech.restore();
  }
});
