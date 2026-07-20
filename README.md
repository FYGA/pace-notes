# Pace Notes

A mobile-first browser app that calculates a Mapbox driving route, analyzes its geometry, and delivers rally-style curve callouts while tracking GPS progress.

## Live app

https://nesloma.github.io/pace-notes/

## What changed in the refactor

- Native ES modules replace shared globals and script load-order dependencies.
- `PaceNotesApp` owns the lifecycle for setup, routing, tracking, demo mode, recording, and teardown.
- Curve analysis is browser-independent and covered by Node tests.
- Route progress uses cumulative distances and a hinted nearest-point search instead of repeatedly rescanning and resumming the whole route.
- UI behavior is bound with event listeners; there are no inline handlers or inline styles.
- Real GPS and demo telemetry use the same soute-progress pipeline.
- Mapbox requests have consistent error handling and cancellation.
- The interface is rebuilt around phone safe areas, larger touch targets, and a stable two-row control dock.

## Run locally

The app has no build step. Serve the repository over HTTP so browser modules and geolocation work correctly:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`, provide a public Mapbox token, and allow location access.

## Tests

```bash
npm test
```

The refactored UI was also smoke-tested through the full setup → route → tracking flow at 390×844 and 320×568 mobile viewports, including horizontal-overflow and minimum touch-target checks.

## Structure

- `js/app.js` — application orchestration and lifecycle
- `js/state.js` — centralized store and state shape
- `js/curves.js` — pure multi-scale curve analysis
- `js/utils.js` — geographic math and route indexing
- `js/map.js` — Mapbox rendering and camera behavior
- `js/routing.js` — Mapbox geocoding/directions client
- `js/tracking.js` — browser geolocation adapter
- `js/demo.js` — distance-based demo simulation
- `js/audio.js` — speech, beep, and haptic feedback
- `js/session.js` — session metrics and wake lock
- `js/recording.js` — JSON route recording/export
- `js/ui.js` — DOM binding and rendering
