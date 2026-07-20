export const ROUTE_TEMPLATE = String.raw`<section aria-labelledby="route-title" aria-modal="true" class="modal-layer is-hidden" id="route-panel" role="dialog">
<div class="modal-card modal-card--route">
<button aria-label="Close destination setup" class="modal-close" id="close-route-btn" type="button">×</button>
<div class="modal-kicker">Route</div>
<h2 id="route-title">Where are you headed?</h2>
<p class="modal-copy">The route creates a geometry-only draft. It cannot see grip, camber, visibility, surface hazards, or road conditions. Review it before use and obey all road laws.</p>
<div aria-label="Route type" class="route-type-toggle" role="group">
<button aria-pressed="true" class="is-active" id="destination-mode-btn" type="button">Destination</button>
<button aria-pressed="false" id="loop-mode-btn" type="button">Winding loop</button>
</div>
<form class="destination-form" id="route-form">
<label class="sr-only" for="destination-input">Destination</label>
<input autocomplete="street-address" id="destination-input" placeholder="Address, city, or place" required="" type="search"/>
<button class="button button--primary" id="load-route-btn" type="submit">Find route</button>
</form>
<form class="loop-form is-hidden" id="loop-form">
<label for="loop-distance">Approximate loop length</label>
<div>
<select id="loop-distance">
<option value="25">25 miles</option>
<option selected="" value="50">50 miles</option>
<option value="80">80 miles</option>
</select>
<button class="button button--primary" id="load-loop-btn" type="submit">Find loop</button>
</div>
<p>Builds several round-trip candidates from your current position and ranks their road geometry. “Winding” does not mean safer, legal at higher speed, scenic, or suitable for competition.</p>
</form>
<label class="route-preference" for="prefer-winding">
<input checked="" id="prefer-winding" type="checkbox"/>
<span>Prefer a more winding alternative when the detour is reasonable</span>
</label>
<div aria-label="Route candidates" class="route-candidates is-hidden" id="route-candidates" role="radiogroup"></div>
<p class="route-plan-notice is-hidden" id="route-plan-notice"></p>
<div class="route-summary is-hidden" id="route-summary">
<div class="route-summary__header">
<span class="route-ready-mark">✓</span>
<div>
<span>Geometry draft ready</span>
<strong id="route-name">Destination</strong>
</div>
</div>
<div class="route-summary__stats">
<div><strong id="route-distance">—</strong><span>Distance</span></div>
<div><strong id="route-duration">—</strong><span>Drive</span></div>
<div><strong id="route-curves">—</strong><span>Curves</span></div>
<div><strong id="route-style">—</strong><span>Route</span></div>
</div>
<div class="route-summary__actions">
<button class="button button--ghost" id="review-route-btn" type="button">Review notes</button>
<button class="button button--primary" id="start-driving-btn" type="button">Start driving</button>
</div>
</div>
</div>
</section>
<div aria-live="polite" class="toast is-hidden" id="toast" role="status"></div>`;
