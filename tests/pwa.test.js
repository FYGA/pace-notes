import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activateWaitingWorker,
  getServiceWorkerUrl,
  registerPwa,
} from "../js/pwa.js";

await import(`../sw.js?test=${Date.now()}`);
const worker = globalThis.__PACE_NOTES_SW_TEST__;

test("manifest uses scope-relative URLs for GitHub Pages", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));

  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.every((icon) => !icon.src.startsWith("/")));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("service worker and shell URLs preserve a GitHub Pages subpath", () => {
  assert.equal(
    getServiceWorkerUrl("https://example.test/pace-notes/index.html"),
    "https://example.test/pace-notes/sw.js",
  );

  const shellUrls = worker.createShellUrls("https://example.test/pace-notes/");
  assert.ok(shellUrls.length > 20);
  assert.ok(shellUrls.every((url) => url.startsWith("https://example.test/pace-notes/")));
  assert.ok(shellUrls.includes("https://example.test/pace-notes/index.html"));
});

test("every precached app-shell file exists in the deployed tree", async () => {
  for (const path of worker.APP_SHELL_PATHS) {
    if (path === "./") continue;
    const file = new URL(`../${path.slice(2)}`, import.meta.url);
    const contents = await readFile(file);
    assert.ok(contents.length > 0, `${path} should not be empty`);
  }
});

test("service worker bypasses Mapbox, external, token-bearing, and API requests", () => {
  const scope = "https://example.test/pace-notes/";

  assert.equal(worker.shouldBypassRequest(new Request("https://api.mapbox.com/styles/v1/demo?access_token=secret"), scope), true);
  assert.equal(worker.shouldBypassRequest(new Request("https://cdn.example.net/library.js"), scope), true);
  assert.equal(worker.shouldBypassRequest(new Request("https://example.test/pace-notes/route.json?access_token=secret"), scope), true);
  assert.equal(worker.shouldBypassRequest(new Request("https://example.test/pace-notes/api/routes"), scope), true);
  assert.equal(worker.shouldBypassRequest(new Request("https://example.test/other/app.js"), scope), true);
  assert.equal(worker.shouldBypassRequest(new Request("https://example.test/pace-notes/js/app.js"), scope), false);
});

test("offline navigation falls back to the cached app shell", async () => {
  const fallback = new Response("offline shell", { status: 200 });
  const matchedUrls = [];
  const cacheStorage = {
    async open(name) {
      assert.equal(name, worker.CACHE_NAME);
      return {
        async match(url) {
          matchedUrls.push(url);
          return fallback;
        },
      };
    },
  };

  const response = await worker.navigationResponse(
    new Request("https://example.test/pace-notes/drive/123"),
    "https://example.test/pace-notes/",
    {
      cacheStorage,
      fetchImpl: async () => { throw new TypeError("offline"); },
    },
  );

  assert.equal(await response.text(), "offline shell");
  assert.deepEqual(matchedUrls, ["https://example.test/pace-notes/index.html"]);
});

test("registration requests fresh workers without activating during a drive", async () => {
  const messages = [];
  const calls = [];
  const registration = {
    waiting: { postMessage: (message) => messages.push(message) },
    addEventListener() {},
    update: async () => {},
  };
  const navigatorObject = {
    serviceWorker: {
      controller: {},
      async register(url, options) {
        calls.push({ url, options });
        return registration;
      },
    },
  };

  const result = await registerPwa({
    navigatorObject,
    baseUrl: "https://example.test/pace-notes/",
    target: {},
  });

  assert.equal(result.supported, true);
  assert.deepEqual(calls, [{
    url: "https://example.test/pace-notes/sw.js",
    options: { updateViaCache: "none" },
  }]);
  assert.deepEqual(messages, []);
  assert.equal(activateWaitingWorker(registration), true);
  assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(activateWaitingWorker({}), false);
});

test("registration helper degrades cleanly when service workers are unavailable", async () => {
  assert.deepEqual(
    await registerPwa({ navigatorObject: {}, baseUrl: "https://example.test/pace-notes/" }),
    { supported: false, registration: null },
  );
});
