export const CORE_TEMPLATE=String.raw`<div aria-label="Route map" class="map" id="map"></div>
<div aria-hidden="true" class="approach-glow" id="approach-glow"></div>
<header class="topbar">
<div aria-label="Pace Notes" class="brand-chip">
<span class="brand-mark">PN</span>
<span class="brand-name">Pace Notes</span>
</div>
<div class="status-chips">
<div class="status-chip is-hidden" id="gps-chip">
<span class="status-dot" id="gps-dot"></span>
<span id="gps-text">GPS</span>
</div>
<div class="status-chip is-hidden" id="wake-chip">
<span class="status-dot status-dot--wake"></span>
<span>Awake</span>
</div>
</div>
</header>
<section aria-live="polite" class="pace-card">
<div class="pace-distance" id="distance-to-call">—</div>
<div class="pace-call" id="call-text">Load a route to begin</div>
<div class="pace-description" id="call-description">Destination-based rally-style guidance</div>
<div aria-label="Upcoming pace notes" class="upcoming-strip" id="upcoming-strip"></div>
</section>
<aside aria-label="Session statistics" class="session-panel is-hidden" id="session-panel">
<div><span>Distance</span><strong id="session-distance">0.0 mi</strong></div>
<div><span>Time</span><strong id="session-time">0:00</strong></div>
<div><span>Turns</span><strong id="session-turns">0</strong></div>
<div><span>Top</span><strong id="session-top-speed">0 mph</strong></div>
</aside>
<section aria-label="Driving controls" class="control-dock">
<div class="telemetry-grid">
<div class="telemetry-card">
<strong id="speed-value">0</strong>
<span>MPH</span>
</div>
<div class="telemetry-card">
<strong id="heading-value">—</strong>
<span>Heading</span>
</div>
<div class="telemetry-card">
<strong id="curves-value">0</strong>
<span>Curves ahead</span>
</div>
</div>
<div class="primary-actions">
<button class="button button--primary" disabled="" id="start-btn" type="button">
<span aria-hidden="true" class="button-icon">▶</span>
<span class="button-label">Start</span>
</button>
<button class="button button--demo" disabled="" id="demo-btn" type="button">
<span aria-hidden="true" class="button-icon">◆</span>
<span class="button-label">Demo</span>
</button>
</div>
<div class="utility-actions">
<button aria-label="Choose destination" class="icon-button" id="route-btn" title="Choose destination" type="button">⌖</button>
<button aria-label="Record route" class="icon-button" id="record-btn" title="Record route" type="button">●</button>
<button aria-label="Center map" class="icon-button" id="center-btn" title="Center map" type="button">◎</button>
<button aria-label="Toggle sound" class="icon-button" id="sound-btn" title="Toggle sound" type="button">◖))</button>
<button aria-label="Settings" class="icon-button" id="settings-btn" title="Settings" type="button">⚙</button>
</div>
</section>`;