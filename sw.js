const CACHE_PREFIX = "pace-notes-shell-";
const CACHE_VERSION = "v1";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const APP_SHELL_PATHS = Object.freeze([
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/pacenotes-icon.svg",
  "./icons/pacenotes-maskable.svg",
  "./css/accessibility.css",
  "./css/base.css",
  "./css/controls.css",
  "./css/discovery.css",
  "./css/hud.css",
  "./css/modals.css",
  "./css/recce.css",
  "./js/app.js",
  "./js/audio.js",
  "./js/bootstrap.js",
  "./js/curves.js",
  "./js/demo.js",
  "./js/drive.js",
  "./js/main.js",
  "./js/map.js",
  "./js/pacenotes.js",
  "./js/pwa.js",
  "./js/recce.js",
  "./js/recording.js",
  "./js/routing.js",
  "./js/session.js",
  "./js/settings.js",
  "./js/state.js",
  "./js/template-core.js",
  "./js/template-route.js",
  "./js/template-recce.js",
  "./js/template-settings.js",
  "./js/tracking.js",
  "./js/ui-elements.js",
  "./js/ui-render.js",
  "./js/ui.js",
  "./js/utils.js",
  "./js/winding.js",
]);

const STATIC_EXTENSIONS = Object.freeze([
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".png",
  ".svg",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
]);

const workerScope = globalThis.registration?.scope && typeof globalThis.skipWaiting === "function"
  ? globalThis
  : null;

function normalizeScope(scopeHref) {
  const scope = new URL(scopeHref);
  if (!scope.pathname.endsWith("/")) scope.pathname += "/";
  return scope;
}

function createShellUrls(scopeHref) {
  const scope = normalizeScope(scopeHref);
  return APP_SHELL_PATHS.map((path) => new URL(path, scope).href);
}

function isSensitiveOrMapboxUrl(url) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "mapbox.com" || hostname.endsWith(".mapbox.com") || hostname.endsWith(".mapbox.cn")) {
    return true;
  }

  for (const key of url.searchParams.keys()) {
    if (/^(access_token|api_?key|token)$/i.test(key)) return true;
  }

  return /(?:^|\/)api(?:\/|$)/i.test(url.pathname)
    || /(?:^|\/)mapbox(?:\/|$)/i.test(url.pathname);
}

function shouldBypassRequest(request, scopeHref) {
  if (!request || request.method !== "GET") return true;

  const scope = normalizeScope(scopeHref);
  const url = new URL(request.url);
  return url.origin !== scope.origin
    || !url.pathname.startsWith(scope.pathname)
    || isSensitiveOrMapboxUrl(url);
}

function isStaticAppRequest(request, scopeHref) {
  if (shouldBypassRequest(request, scopeHref)) return false;
  const pathname = new URL(request.url).pathname.toLowerCase();
  return STATIC_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

async function installShell(scopeHref, cacheStorage = globalThis.caches) {
  const cache = await cacheStorage.open(CACHE_NAME);
  await cache.addAll(createShellUrls(scopeHref));
}

async function activateShell(cacheStorage = globalThis.caches) {
  const cacheNames = await cacheStorage.keys();
  await Promise.all(cacheNames
    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .map((name) => cacheStorage.delete(name)));
}

async function navigationResponse(request, scopeHref, {
  cacheStorage = globalThis.caches,
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    return await fetchImpl(request);
  } catch {
    const cache = await cacheStorage.open(CACHE_NAME);
    const fallbackUrl = new URL("./index.html", normalizeScope(scopeHref)).href;
    return (await cache.match(fallbackUrl)) ?? Response.error();
  }
}

async function staticResponse(request, {
  cacheStorage = globalThis.caches,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cache = await cacheStorage.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetchImpl(request);
  if (response?.ok && ["basic", "default"].includes(response.type)) {
    await cache.put(request, response.clone());
  }
  return response;
}

if (workerScope) {
  const scopeHref = workerScope.registration.scope;

  workerScope.addEventListener("install", (event) => {
    event.waitUntil(installShell(scopeHref));
  });

  workerScope.addEventListener("activate", (event) => {
    event.waitUntil(activateShell());
  });

  workerScope.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") workerScope.skipWaiting();
  });

  workerScope.addEventListener("fetch", (event) => {
    const request = event.request;
    if (shouldBypassRequest(request, scopeHref)) return;

    if (request.mode === "navigate") {
      event.respondWith(navigationResponse(request, scopeHref));
      return;
    }

    if (isStaticAppRequest(request, scopeHref)) {
      event.respondWith(staticResponse(request));
    }
  });
}

// A small read-only hook keeps the classic worker testable without requiring
// module service-worker support in mobile browsers.
Object.defineProperty(globalThis, "__PACE_NOTES_SW_TEST__", {
  configurable: true,
  value: Object.freeze({
    APP_SHELL_PATHS,
    CACHE_NAME,
    activateShell,
    createShellUrls,
    installShell,
    isStaticAppRequest,
    navigationResponse,
    shouldBypassRequest,
    staticResponse,
  }),
});
