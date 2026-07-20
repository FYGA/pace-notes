import { collectElements } from "./ui-elements.js";
import { renderState } from "./ui-render.js";

export class AppView {
  #elements;
  #toastTimer = null;

  constructor(root = document) {
    this.#elements = collectElements(root);
  }

  bind(actions) {
    const elements = this.#elements;
    elements.tokenForm.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.onSaveToken(elements.tokenInput.value.trim());
    });
    elements.useSavedTokenButton.addEventListener(
      "click",
      actions.onUseSavedToken,
    );
    elements.changeTokenButton.addEventListener("click", actions.onChangeToken);
    elements.closeSettingsButton.addEventListener(
      "click",
      actions.onCloseSettings,
    );
    elements.settingsPanel.addEventListener("click", (event) => {
      if (event.target === elements.settingsPanel) actions.onCloseSettings();
    });
    elements.paceNoteProfile.addEventListener("change", () => {
      actions.onChangePaceNoteProfile(elements.paceNoteProfile.value);
    });
    elements.routeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.onLoadRoute(elements.destinationInput.value.trim());
    });
    elements.closeRouteButton.addEventListener("click", actions.onCloseRoute);
    elements.routePanel.addEventListener("click", (event) => {
      if (event.target === elements.routePanel) actions.onCloseRoute();
    });
    elements.startDrivingButton.addEventListener("click", actions.onStartDriving);
    elements.startButton.addEventListener("click", actions.onToggleTracking);
    elements.demoButton.addEventListener("click", actions.onToggleDemo);
    elements.routeButton.addEventListener("click", actions.onOpenRoute);
    elements.recordButton.addEventListener("click", actions.onToggleRecording);
    elements.centerButton.addEventListener("click", actions.onCenterMap);
    elements.soundButton.addEventListener("click", actions.onToggleSound);
    elements.settingsButton.addEventListener("click", actions.onOpenSettings);
    document.addEventListener("pointerdown", actions.onUserGesture, {
      passive: true,
    });
    document.addEventListener("keydown", (event) => {
      const panel = !elements.settingsPanel.classList.contains("is-hidden")
        ? elements.settingsPanel
        : !elements.routePanel.classList.contains("is-hidden")
          ? elements.routePanel
          : null;
      if (!panel) return;
      if (event.key === "Escape") {
        if (panel === elements.settingsPanel) actions.onCloseSettings();
        else actions.onCloseRoute();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = this.#focusableElements(panel);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  render(state) {
    renderState(this.#elements, state);
  }

  showToast(message, { tone = "neutral", duration = 2_400 } = {}) {
    clearTimeout(this.#toastTimer);
    this.#elements.toast.textContent = message;
    this.#elements.toast.dataset.tone = tone;
    this.#elements.toast.classList.remove("is-hidden");
    this.#toastTimer = setTimeout(() => {
      this.#elements.toast.classList.add("is-hidden");
    }, duration);
  }

  flashCall() {
    this.#elements.callText.classList.add("is-flashing");
    setTimeout(
      () => this.#elements.callText.classList.remove("is-flashing"),
      190,
    );
  }

  focusDestination() {
    setTimeout(() => this.#elements.destinationInput.focus(), 80);
  }

  clearTokenInput() {
    this.#elements.tokenInput.value = "";
    setTimeout(() => this.#elements.tokenInput.focus(), 40);
  }

  focusSettings() {
    const [first] = this.#focusableElements(this.#elements.settingsPanel);
    first?.focus();
  }

  focusRouteButton() {
    this.#elements.routeButton.focus();
  }

  focusSettingsButton() {
    this.#elements.settingsButton.focus();
  }

  #focusableElements(panel) {
    return [...panel.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
    )].filter(
      (element) =>
        !element.hidden &&
        !element.closest(".is-hidden") &&
        element.getClientRects().length > 0,
    );
  }
}
