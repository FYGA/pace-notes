import { buildCallText } from './curves.js';

export class AudioService {
  #enabled = true;
  #audioContext = null;
  #unlocked = false;

  get enabled() {
    return this.#enabled;
  }

  setEnabled(enabled) {
    this.#enabled = Boolean(enabled);
    if (!this.#enabled) globalThis.speechSynthesis?.cancel();
  }

  async unlock() {
    if (!this.#audioContext && (globalThis.AudioContext || globalThis.webkitAudioContext)) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#audioContext = new AudioContextClass();
    }

    if (this.#audioContext?.state === 'suspended') {
      try {
        await this.#audioContext.resume();
      } catch {
        // Audio feedback is optional.
      }
    }

    if (!this.#unlocked && 'speechSynthesis' in globalThis) {
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0;
      globalThis.speechSynthesis.speak(utterance);
      this.#unlocked = true;
    }
  }

  announce(curve, nextCurve = null) {
    const text = buildAnnouncement(curve, nextCurve);
    if (!this.#enabled) return text;

    this.#beep(curve.severity);
    this.#vibrate(curve.severity);

    if ('speechSynthesis' in globalThis) {
      globalThis.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.28;
      utterance.pitch = 1;
      utterance.volume = 1;
      globalThis.speechSynthesis.speak(utterance);
    }

    return text;
  }

  #beep(severity) {
    if (!this.#audioContext) return;

    try {
      const oscillator = this.#audioContext.createOscillator();
      const gain = this.#audioContext.createGain();
      oscillator.connect(gain);
      gain.connect(this.#audioContext.destination);

      oscillator.type = 'sine';
      oscillator.frequency.value = severity <= 2 ? 880 : severity <= 4 ? 660 : 520;
      gain.gain.setValueAtTime(0.26, this.#audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.#audioContext.currentTime + 0.15);
      oscillator.start();
      oscillator.stop(this.#audioContext.currentTime + 0.15);
    } catch {
      // Audio feedback is optional.
    }
  }

  #vibrate(severity) {
    if (!navigator.vibrate) return;
    if (severity <= 1) navigator.vibrate([100, 50, 100, 50, 100]);
    else if (severity <= 2) navigator.vibrate([100, 50, 100]);
    else if (severity <= 3) navigator.vibrate(80);
    else if (severity <= 5) navigator.vibrate(40);
  }
}

export function buildAnnouncement(curve, nextCurve = null) {
  let text = buildCallText(curve);
  if (curve.caution) text += `, caution ${curve.caution}`;

  if (nextCurve) {
    const gap = nextCurve.distance - curve.distance;
    if (gap > 20 && gap <= 200) {
      text += `, ${Math.round(gap / 10) * 10}, ${buildCallText(nextCurve)}`;
    }
  }

  return text;
}
