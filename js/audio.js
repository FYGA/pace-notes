// ============================
// Audio - Speech synthesis, beep tones, haptics, iOS unlock
// ============================

// Initialize Web Audio API
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Play a short beep before voice callouts
function playBeep(severity) {
  if (!audioCtx || !soundEnabled) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    // Higher pitch for tighter curves (more urgent)
    const freq = severity <= 2 ? 880 : severity <= 4 ? 660 : 520;
    osc.frequency.value = freq;
    osc.type = 'sine';

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    // Audio context issues are non-critical
  }
}

// Haptic feedback via vibration API
function triggerHaptic(severity) {
  if (!navigator.vibrate) return;
  if (severity <= 1) {
    navigator.vibrate([100, 50, 100, 50, 100]); // triple pulse for hairpin
  } else if (severity <= 2) {
    navigator.vibrate([100, 50, 100]); // double pulse for tight
  } else if (severity <= 3) {
    navigator.vibrate(80); // single pulse for medium
  } else if (severity <= 5) {
    navigator.vibrate(40); // light tap for open curves
  }
}

// Speak curve callout - Rally style with inter-curve distance
function speakCurve(curve) {
  if (!('speechSynthesis' in window)) return;

  // Pre-callout beep and haptics
  playBeep(curve.severity);
  triggerHaptic(curve.severity);

  // Flash the callout text
  callTextEl.classList.add('flash');
  setTimeout(() => callTextEl.classList.remove('flash'), 200);

  window.speechSynthesis.cancel();

  let text = buildCallText(curve);

  // Add caution modifier if present
  if (curve.caution) {
    text += `, caution ${curve.caution}`;
  }

  // Add distance to next curve if it's within 200m (rally style linkage)
  const curveIdx = upcomingCurves.indexOf(curve);
  if (curveIdx >= 0 && curveIdx < upcomingCurves.length - 1) {
    const nextCurve = upcomingCurves[curveIdx + 1];
    const gapDistance = nextCurve.distance - curve.distance;
    if (gapDistance > 20 && gapDistance <= 200) {
      const roundedGap = Math.round(gapDistance / 10) * 10;
      text += `, ${roundedGap}, ${buildCallText(nextCurve)}`;
    }
  }

  // Record the pace note if recording
  recordPaceNote(curve, text);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.3;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
}

// Toggle sound on/off
function toggleSound() {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
  soundBtn.classList.toggle('muted', !soundEnabled);

  if (!soundEnabled) {
    window.speechSynthesis?.cancel();
  }
}

// Unlock speechSynthesis and audio on iOS (requires user gesture)
function unlockSpeech() {
  if (!speechUnlocked && 'speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    speechUnlocked = true;
  }
  // Also init Web Audio on first tap
  initAudio();
}
