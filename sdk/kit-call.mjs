// Which export of the plugin the kit is running right now, as the app's PluginCallTracker knows it: what kino.qr.scan
// checks (only a settings `action`, a `panelAction` or a `screenEvent` the person pressed may open the scanner).
// loadPlugin (sandbox.mjs) runs every export inside kitCall.run(name, …); a test can do the same around its own calls.
import { AsyncLocalStorage } from "node:async_hooks";
import { contract } from "./contract.mjs";

export const kitCall = new AsyncLocalStorage();

/**
 * Task 8p: a plugin screen's call as the app's PluginScreenSession marks it (ScreenPluginCall, PersonPressPluginCall,
 * TickPluginCall): `{ press, tick }`. run.mjs sets it around `screenEvent` (a press unless it is the reserved `open`) and
 * `panelAction --screen` (a press for the triggers in contract.qr.screenTriggers); a test can do the same.
 */
export const kitScreenCall = new AsyncLocalStorage();

/** [plugin] (a loaded entry's exports) with each function run as that export's call ([kitCall]). */
export function trackedExports(plugin) {
  return new Proxy(plugin, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof v !== "function" || typeof key !== "string") return v;
      return function tracked(...args) { return kitCall.run(key, () => v.apply(this, args)); };
    },
  });
}

/**
 * PluginQrScanner.mayScanFrom: whether a call may open the scanner. [fn] the export running; [screen] a plugin screen's
 * call (a root screen, a screen-mode panel, a contributed tab in screen mode); [press] it follows the person's own tap or
 * submit; [tick] a screen timer's tick; [interactive] and [personStarted] false for a background or unattended call. Shared
 * cases: test/qr-origin-cases.json (run by the app too).
 */
export function qrScanOriginAllowed({ fn, screen = false, press = false, tick = false, interactive = true, personStarted = true }) {
  if (!interactive || !personStarted || tick || !contract.qr.fromFunctions.includes(fn)) return false;
  const fromScreen = screen || fn === contract.manifest.screen.exports.event;
  return !fromScreen || (screen && press);
}

/** The origin of the call running now, as the kit knows it: [kitCall]'s export and [kitScreenCall]'s marks. */
export function currentQrOrigin() {
  const marks = kitScreenCall.getStore();
  return { fn: kitCall.getStore(), screen: marks !== undefined, press: marks?.press === true, tick: marks?.tick === true };
}

/**
 * Task 8r: a scheduled job's run as job.mjs marks it: a function that takes one of the run's requests (false past the cap).
 * kino.ai.ask reads it (each ask is one of the run's requests, as in the app's PluginAiBridge).
 */
export const kitJobRequest = new AsyncLocalStorage();

/**
 * PluginAi.mayAskFrom (Task 8r): whether a call may ask Kino's text AI (kino.ai.ask). A plugin job's run ([job]) may, with
 * contract.kinoAi.fromJob as its export; otherwise the person's own action, by the same rule as kino.qr.scan over
 * contract.kinoAi.fromFunctions. Shared cases: test/ai-cases.json (run by the app too).
 */
export function aiOriginAllowed({ fn, screen = false, press = false, tick = false, interactive = true, personStarted = true, job = false }) {
  if (job) return fn === contract.kinoAi.fromJob;
  if (!interactive || !personStarted || tick || !contract.kinoAi.fromFunctions.includes(fn)) return false;
  const fromScreen = screen || fn === contract.manifest.screen.exports.event;
  return !fromScreen || (screen && press);
}
