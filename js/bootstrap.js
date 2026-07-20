import { CORE_TEMPLATE } from "./template-core.js";
import { RECCE_TEMPLATE } from "./template-recce.js";
import { ROUTE_TEMPLATE } from "./template-route.js";
import { SETTINGS_TEMPLATE } from "./template-settings.js";

document.getElementById("app").innerHTML =
  CORE_TEMPLATE + SETTINGS_TEMPLATE + ROUTE_TEMPLATE + RECCE_TEMPLATE;

await import("./main.js");

const { registerPwa } = await import("./pwa.js");
void registerPwa().catch((error) => {
  console.warn("PWA registration failed:", error);
});
