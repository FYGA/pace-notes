export const ROUTE_TEMPLATE=String.raw`<section aria-labelledby="route-title" class="modal-layer is-hidden" id="route-panel">
<div class="modal-card modal-card--route">
<button aria-label="Close destination setup" class="modal-close" id="close-route-btn" type="button">×</button>
<div class="modal-kicker">Route</div>
<h2 id="route-title">Where are you headed?</h2>
<p class="modal-copy">The full route is calculated once, then analyzed for pace notes before you start.</p>
<form class="destination-form" id="route-form">
<label class="sr-only" for="destination-input">Destination</label>
<input autocomplete="street-address" id="destination-input" placeholder="Address, city, or place" required="" type="search"/>
<button class="button button--primary" id="load-route-btn" type="submit">Find route</button>
</form>
<div class="route-summary is-hidden" id="route-summary">
<div class="route-summary__header">
<span class="route-ready-mark">✓</span>
<div>
<span>Route ready</span>
<strong id="route-name">Destination</strong>
</div>
</div>
<div class="route-summary__stats">
<div><strong id="route-distance">—</strong><span>Distance</span></div>
<div><strong id="route-duration">—</strong><span>Drive</span></div>
<div><strong id="route-curves">—</strong><span>Curves</span></div>
</div>
<button class="button button--primary button--full" id="start-driving-btn" type="button">Start driving</button>
</div>
</div>
</section>
<div aria-live="polite" class="toast is-hidden" id="toast" role="status"></div>`;