export const RECCE_TEMPLATE = String.raw`<section aria-labelledby="recce-title" aria-modal="true" class="modal-layer is-hidden" id="recce-panel" role="dialog">
<div class="modal-card modal-card--recce">
<button aria-label="Close pace-note review" class="modal-close" id="close-recce-btn" type="button">×</button>
<div class="modal-kicker">Parked review</div>
<h2 id="recce-title">Review pace notes</h2>
<p class="modal-copy">Generated notes are geometry drafts. Correct and mark them reviewed only while parked or during a controlled recce. Manual edits cannot make a public road safe for competition.</p>
<div class="recce-progress"><strong id="recce-progress">0 of 0 reviewed</strong><span id="recce-edited">0 edited</span></div>
<label class="recce-field" for="recce-note-select"><span>Pace note</span><select id="recce-note-select"></select></label>
<div class="recce-generated"><span>Generated draft</span><strong id="recce-generated-call">—</strong></div>
<form class="recce-form" id="recce-form">
<div class="recce-form__row">
<label class="recce-field" for="recce-direction"><span>Direction</span><select id="recce-direction"><option value="L">Left</option><option value="R">Right</option></select></label>
<label class="recce-field" for="recce-severity"><span>Grade</span><select id="recce-severity"><option value="1">1 · tightest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6 · gentlest</option></select></label>
</div>
<label class="recce-field" for="recce-shape"><span>Shape</span><select id="recce-shape"><option value="normal">Normal grade</option><option value="square">Square</option><option value="hairpin">Hairpin</option></select></label>
<label class="recce-field" for="recce-annotation"><span>Manual annotation · optional</span><input id="recce-annotation" maxlength="80" placeholder="Driver-entered note" type="text" /></label>
<label class="recce-reviewed" for="recce-reviewed"><input id="recce-reviewed" type="checkbox" /><span>I reviewed this call against actual road conditions</span></label>
<div class="recce-actions"><button class="button button--ghost" id="revert-recce-btn" type="button">Revert note</button><button class="button button--primary" type="submit">Save note</button></div>
</form>
<p class="safety-note">Edits are stored with this route in memory and exported with recordings when called. They are not a substitute for organized recce, a route book, or current road information.</p>
</div>
</section>`;
