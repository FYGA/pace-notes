export const SETTINGS_TEMPLATE = String.raw`<section aria-labelledby="settings-title" aria-modal="true" class="modal-layer" id="settings-panel" role="dialog">
<div class="modal-card">
<div class="modal-kicker">Setup</div>
<h1 id="settings-title">Connect Mapbox</h1>
<p class="modal-copy">Your public Mapbox token stays in this browser and is used for maps, search, and directions.</p>
<div class="saved-token is-hidden" id="saved-token-view">
<div class="saved-token__status"><span>✓</span> Saved token</div>
<code id="masked-token"></code>
<button class="button button--primary button--full" id="use-saved-token-btn" type="button">Continue</button>
<button class="button button--ghost button--full" id="change-token-btn" type="button">Use a different token</button>
</div>
<form class="form-stack" id="token-form">
<label for="token-input">Public access token</label>
<input autocomplete="off" id="token-input" inputmode="text" placeholder="pk.eyJ1..." required="" spellcheck="false" type="text"/>
<button class="button button--primary button--full" id="connect-map-btn" type="submit">Open Pace Notes</button>
</form>
<a class="help-link" href="https://account.mapbox.com/access-tokens/" rel="noreferrer" target="_blank">Create a free Mapbox token ↗</a>
<p class="safety-note">Generated notes are unverified geometry drafts, not safe-speed or hazard advice. Use competition notes only on controlled stages. On public roads, obey every law, drive to visible conditions, and never interact with the screen while moving.</p>
</div>
</section>`;
