// ============================
// State Variables & Constants
// ============================

// Core state
let map = null;
let mapboxToken = '';
let isTracking = false;
let soundEnabled = true;
let watchId = null;
let currentPosition = null;
let currentSpeed = 0;
let currentHeading = 0;
let upcomingCurves = [];
let allRouteCurves = []; // Full set of curves for the loaded route
let lastSpokenCurve = null;
let routeCoordinates = [];
let userMarker = null;
let curveMarkers = [];
let routeLine = null;
let positionHistory = [];
let speechUnlocked = false; // iOS requires user gesture to unlock speechSynthesis
let wakeLock = null; // Screen Wake Lock API
let audioCtx = null; // Web Audio API for beep tones
let sessionStartTime = null;
let sessionDistance = 0; // miles
let sessionTopSpeed = 0;
let sessionTurnsPassed = 0;
let lastSessionPosition = null;
let isRecording = false;
let recordedTrack = []; // GPS breadcrumbs
let recordedNotes = []; // Pace notes encountered during recording
let recordingStartTime = null;

// Routing state
let routeEndPoint = null; // [lng, lat] destination
let isRouteLoaded = false; // Route fetched and curves analyzed
let routeMetadata = { distance: 0, duration: 0 }; // From Directions API

// Constants
const POSITION_HISTORY_MAX = 10;

// Demo mode state
let isDemoMode = false;
let demoInterval = null;
let demoIndex = 0;
let demoSpeed = 45; // MPH
let demoRouteData = []; // Will be populated from Mapbox

// Demo route: Pikes Peak Hill Climb section (Colorado)
const DEMO_START = [-105.0675561764574, 38.86176996714182];
const DEMO_END = [-105.04432838005656, 38.8397878232719];

// DOM elements (initialized after DOM is ready)
let distanceEl, callTextEl, callDescEl, upcomingEl;
let speedEl, headingEl, curvesEl;
let startBtn, soundBtn, statusEl, statusText;
let gpsAccuracy, accuracyText, gpsDot, legend;

function initDOMRefs() {
  distanceEl = document.getElementById('distance-to-call');
  callTextEl = document.getElementById('call-text');
  callDescEl = document.getElementById('call-description');
  upcomingEl = document.getElementById('upcoming-strip');
  speedEl = document.getElementById('speed-value');
  headingEl = document.getElementById('heading-value');
  curvesEl = document.getElementById('curves-value');
  startBtn = document.getElementById('start-btn');
  soundBtn = document.getElementById('sound-btn');
  statusEl = document.getElementById('status');
  statusText = document.getElementById('status-text');
  gpsAccuracy = document.getElementById('gps-accuracy');
  accuracyText = document.getElementById('accuracy-text');
  gpsDot = document.querySelector('.gps-dot');
  legend = document.getElementById('legend');
}
