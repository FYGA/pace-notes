import { renderCornerCall, renderLinkedCall } from "./pacenotes.js";

const BEEP_LEAD_MS = 180;

export class AudioService {
  #enabled = true;
  #audioContext = null;
  #unlocked = false;
  #pendingAnnouncements = [];
  #activeAnnouncement = null;
  #speechDelayTimer = null;
  #speechWatchdogTimer = null;
  #watchdogMs = speechWatchdogMs;

  constructor({ watchdogMs } = {}) {
    if (typeof watchdogMs === "function") this.#watchdogMs = watchdogMs;
  }

  get enabled() {
    return this.#enabled;
  }

  get queueDepth() {
    return (
      this.#pendingAnnouncements.length + (this.#activeAnnouncement ? 1 : 0)
    );
  }

  setEnabled(enabled) {
    this.#enabled = Boolean(enabled);
    if (!this.#enabled) this.clear();
  }

  clear() {
    this.#pendingAnnouncements.length = 0;
    this.#activeAnnouncement = null;
    if (this.#speechDelayTimer !== null) {
      globalThis.clearTimeout(this.#speechDelayTimer);
      this.#speechDelayTimer = null;
    }
    if (this.#speechWatchdogTimer !== null) {
      globalThis.clearTimeout(this.#speechWatchdogTimer);
      this.#speechWatchdogTimer = null;
    }
    globalThis.speechSynthesis?.cancel();
  }

  async unlock() {
    if (
      !this.#audioContext &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    ) {
      const AudioContextClass =
        globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#audioContext = new AudioContextClass();
    }

    if (this.#audioContext?.state === "suspended") {
      try {
        await this.#audioContext.resume();
      } catch {
        // Audio feedback is optional.
      }
    }

    if (
      !this.#unlocked &&
      globalThis.speechSynthesis &&
      typeof globalThis.SpeechSynthesisUtterance === "function"
    ) {
      const utterance = new globalThis.SpeechSynthesisUtterance("");
      utterance.volume = 0;
      globalThis.speechSynthesis.speak(utterance);
      this.#unlocked = true;
    }
  }

  announce(curve, nextCurve = null, { isValid = null } = {}) {
    const text = buildAnnouncement(curve, nextCurve);
    if (!this.#enabled) return text;

    this.#pendingAnnouncements.push({
      text,
      severity: curve.severity,
      isValid: typeof isValid === "function" ? isValid : null,
    });
    this.#drainQueue();

    return text;
  }

  #drainQueue() {
    if (
      !this.#enabled ||
      this.#activeAnnouncement ||
      this.#pendingAnnouncements.length === 0
    ) {
      return;
    }

    let announcement = this.#pendingAnnouncements.shift();
    while (announcement && !this.#isValid(announcement)) {
      announcement = this.#pendingAnnouncements.shift();
    }
    if (!announcement) return;
    this.#activeAnnouncement = announcement;
    this.#vibrate(announcement.severity);

    const speechSynthesis = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!speechSynthesis || typeof Utterance !== "function") {
      this.#beep(announcement.severity);
      this.#finishAnnouncement(announcement);
      return;
    }

    const utterance = new Utterance(announcement.text);
    utterance.rate = 1.28;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => this.#finishAnnouncement(announcement);
    utterance.onerror = () => this.#finishAnnouncement(announcement);
    announcement.utterance = utterance;

    const speak = () => {
      this.#speechDelayTimer = null;
      if (!this.#enabled || this.#activeAnnouncement !== announcement) return;

      try {
        speechSynthesis.speak(utterance);
        this.#speechWatchdogTimer = globalThis.setTimeout(() => {
          if (this.#activeAnnouncement !== announcement) return;
          speechSynthesis.cancel?.();
          this.#finishAnnouncement(announcement);
        }, this.#watchdogMs(announcement.text));
      } catch {
        this.#finishAnnouncement(announcement);
      }
    };

    if (this.#beep(announcement.severity)) {
      this.#speechDelayTimer = globalThis.setTimeout(speak, BEEP_LEAD_MS);
    } else {
      speak();
    }
  }

  #finishAnnouncement(announcement) {
    if (this.#activeAnnouncement !== announcement) return;

    if (this.#speechDelayTimer !== null) {
      globalThis.clearTimeout(this.#speechDelayTimer);
      this.#speechDelayTimer = null;
    }
    if (this.#speechWatchdogTimer !== null) {
      globalThis.clearTimeout(this.#speechWatchdogTimer);
      this.#speechWatchdogTimer = null;
    }
    this.#activeAnnouncement = null;
    globalThis.queueMicrotask(() => this.#drainQueue());
  }

  prune() {
    this.#pendingAnnouncements = this.#pendingAnnouncements.filter(
      (announcement) => this.#isValid(announcement),
    );
    if (this.#activeAnnouncement && !this.#isValid(this.#activeAnnouncement)) {
      const announcement = this.#activeAnnouncement;
      globalThis.speechSynthesis?.cancel();
      this.#finishAnnouncement(announcement);
    }
  }

  #isValid(announcement) {
    if (!announcement?.isValid) return true;
    try {
      return announcement.isValid() !== false;
    } catch {
      return false;
    }
  }

  #beep(severity) {
    if (!this.#audioContext) return false;

    try {
      const oscillator = this.#audioContext.createOscillator();
      const gain = this.#audioContext.createGain();
      oscillator.connect(gain);
      gain.connect(this.#audioContext.destination);

      oscillator.type = "sine";
      oscillator.frequency.value =
        severity <= 2 ? 880 : severity <= 4 ? 660 : 520;
      gain.gain.setValueAtTime(0.26, this.#audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        this.#audioContext.currentTime + 0.15,
      );
      oscillator.start();
      oscillator.stop(this.#audioContext.currentTime + 0.15);
      return true;
    } catch {
      // Audio feedback is optional.
      return false;
    }
  }

  #vibrate(severity) {
    if (!globalThis.navigator?.vibrate) return;
    if (severity <= 1) globalThis.navigator.vibrate([100, 50, 100, 50, 100]);
    else if (severity <= 2) globalThis.navigator.vibrate([100, 50, 100]);
    else if (severity <= 3) globalThis.navigator.vibrate(80);
    else if (severity <= 5) globalThis.navigator.vibrate(40);
  }
}

export function buildAnnouncement(curve, nextCurve = null) {
  const profileId = curve?.profileId || "numerical";
  return nextCurve
    ? renderLinkedCall(curve, nextCurve, profileId)
    : renderCornerCall(curve, profileId);
}

function speechWatchdogMs(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(2_500, Math.min(12_000, 2_000 + words * 550));
}
