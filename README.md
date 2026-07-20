# Pace Notes

A mobile-first browser app that plans driving routes, analyzes their geometry, and delivers rally-style curve callouts while tracking GPS progress.

## Live app

https://nesloma.github.io/pace-notes/

## Current capabilities

- Native ES modules replace shared globals and script load-order dependencies.
- `PaceNotesApp` owns the lifecycle for setup, routing, tracking, demo mode, recording, and teardown.
- The pace-note engine creates conservative numerical or descriptive geometry drafts with stable corner identities and semantic modifiers.
- Destination planning can compare provider alternatives and automatically choose a reasonably sized winding option.
- Winding-loop discovery builds deterministic waypoint candidates around the current position, rejects obvious route artifacts, and ranks the remaining geometry near the requested length.
- Route choices remain explicit previews until the driver selects one and starts tracking.
- Routing is behind a provider-neutral interface; Mapbox is the current provider and can be replaced without coupling route planning to its response format.
- Curve, route-matching, scheduling, routing, session, recording, and winding logic are browser-independent and covered by Node tests.
- Route progress uses cumulative distances and a hinted nearest-point search instead of repeatedly rescanning and resumming the whole route.
- UI behavior is bound with event listeners; there are no inline handlers or inline styles.
- Real GPS and demo telemetry use the same route-progress pipeline.
- Mapbox requests have consistent error handling and cancellation.
- The interface is rebuilt around phone safe areas, larger touch targets, and a stable two-row control dock.

Winding scores describe route geometry only. They are not speed, difficulty, road-condition, or safety ratings.

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

The UI is smoke-tested at compact portrait and landscape phone sizes, including horizontal-overflow, scroll containment, and minimum touch-target checks.

## Structure

- `js/app.js` — application orchestration and lifecycle
- `js/state.js` — centralized store and state shape
- `js/curves.js` — pure multi-scale curve analysis
- `js/utils.js` — geographic math and route indexing
- `js/map.js` — Mapbox rendering and camera behavior
- `js/routing.js` — provider-neutral routing facade and Mapbox adapter
- `js/winding.js` — route-geometry ranking and round-trip waypoint generation
- `js/tracking.js` — browser geolocation adapter
- `js/demo.js` — distance-based demo simulation
- `js/audio.js` — speech, beep, and haptic feedback
- `js/session.js` — session metrics and wake lock
- `js/recording.js` — JSON route recording/export
- `js/ui.js` — DOM binding and rendering
