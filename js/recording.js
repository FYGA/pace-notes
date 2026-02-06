// ============================
// Recording - Route recording and JSON export
// ============================

// Toggle route recording
function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  isRecording = true;
  recordedTrack = [];
  recordedNotes = [];
  recordingStartTime = Date.now();
  const btn = document.getElementById('record-btn');
  btn.classList.add('recording');
  showStatus('Recording started');
  setTimeout(hideStatus, 1500);
}

function stopRecording() {
  isRecording = false;
  const btn = document.getElementById('record-btn');
  btn.classList.remove('recording');

  if (recordedTrack.length < 2) {
    showStatus('Not enough data to save');
    setTimeout(hideStatus, 1500);
    return;
  }

  // Build exportable pace notes document
  const routeData = {
    name: `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    date: new Date().toISOString(),
    duration: Date.now() - recordingStartTime,
    trackPoints: recordedTrack.length,
    track: recordedTrack,
    paceNotes: recordedNotes
  };

  // Download as JSON
  const blob = new Blob([JSON.stringify(routeData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pace-notes-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus(`Saved ${recordedNotes.length} pace notes`);
  setTimeout(hideStatus, 2000);
}

// Record a GPS point (called from handlePosition)
function recordTrackPoint() {
  if (!isRecording || !currentPosition) return;
  recordedTrack.push({
    position: [...currentPosition],
    speed: currentSpeed,
    heading: currentHeading,
    time: Date.now() - recordingStartTime
  });
}

// Record a pace note (called when a curve is spoken)
function recordPaceNote(curve, spokenText) {
  if (!isRecording) return;
  recordedNotes.push({
    position: [...curve.position],
    call: curve.call,
    spoken: spokenText,
    severity: curve.severity,
    direction: curve.direction,
    angle: curve.angle,
    caution: curve.caution || null,
    time: Date.now() - recordingStartTime
  });
}
