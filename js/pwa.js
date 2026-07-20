export const PWA_UPDATE_EVENT = "pace-notes:pwa-update";

export function getServiceWorkerUrl(baseUrl = globalThis.document?.baseURI ?? globalThis.location?.href) {
  if (!baseUrl) return null;
  return new URL("sw.js", baseUrl).href;
}

export function activateWaitingWorker(registration) {
  if (!registration?.waiting) return false;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

function announceUpdate(target, registration, onUpdate) {
  onUpdate?.(registration);

  if (typeof target?.dispatchEvent !== "function") return;
  const EventConstructor = target.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventConstructor !== "function") return;

  target.dispatchEvent(new EventConstructor(PWA_UPDATE_EVENT, {
    detail: { registration },
  }));
}

function observeInstallingWorker(registration, serviceWorker, target, onUpdate) {
  registration.addEventListener?.("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener?.("statechange", () => {
      if (installing.state !== "installed" || !serviceWorker.controller) return;
      announceUpdate(target, registration, onUpdate);
    });
  });
}

export async function registerPwa({
  navigatorObject = globalThis.navigator,
  target = globalThis,
  baseUrl = globalThis.document?.baseURI ?? globalThis.location?.href,
  onUpdate,
} = {}) {
  const serviceWorker = navigatorObject?.serviceWorker;
  const scriptUrl = getServiceWorkerUrl(baseUrl);

  if (!serviceWorker?.register || !scriptUrl) {
    return { supported: false, registration: null };
  }

  const registration = await serviceWorker.register(scriptUrl, {
    updateViaCache: "none",
  });

  observeInstallingWorker(registration, serviceWorker, target, onUpdate);

  if (registration.waiting) {
    announceUpdate(target, registration, onUpdate);
  }

  // Check once per page load. Failure is non-fatal because the installed worker
  // and cached shell remain usable while offline.
  registration.update?.().catch?.(() => {});

  return { supported: true, registration };
}
