// node --test plugins/sdk/test/qr-origin.test.mjs   (Node 18+)
// Task 8p: kino.qr.scan from a plugin screen the person tapped. The kit shares the app's origin rule (qr-origin-cases.json,
// run by ScreenQrOriginTest too): a settings action, a panelAction, or a screen's call that follows the person's own tap or
// submit; never a screen's open event, a timer tick, a load-more, a change, a refreshMs or a playerEvent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { kitScreenCall, qrScanOriginAllowed } from "../kit-call.mjs";
import { loadPlugin } from "../sandbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "qr-origin-cases.json"), "utf8")).cases;
const NOT_ALLOWED = "kino.qr.scan only runs from a settings action, panelAction or screenEvent the person pressed";

const manifest = { id: "watch", name: "Watch", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["api.example.com"], capabilities: ["search", "resolve", "qrScan"] };

test("kit parity with the app: where a scan may start (qr-origin-cases.json)", () => {
  assert.ok(CASES.length >= 20);
  for (const c of CASES) {
    const got = qrScanOriginAllowed({ fn: c.function, screen: c.screen === true, press: c.press === true, tick: c.tick === true, interactive: c.interactive !== false, personStarted: c.personStarted !== false });
    assert.equal(got, c.allowed, c.name);
  }
  assert.deepEqual(contract.qr.fromFunctions, ["action", "panelAction", "screenEvent"]);
  assert.deepEqual(contract.qr.screenTriggers, ["press", "submit"]);
});

test("a loaded plugin's screenEvent and screen-mode panelAction scan only after the person's press", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-qr-screen-"));
  try {
    const exports = ["screenEvent", "panelAction", "action", "screen", "panel", "playerEvent"];
    writeFileSync(join(dir, "plugin.js"), exports.map((f) => `export async function ${f}() { try { return { text: await kino.qr.scan({ title: "x" }) }; } catch (e) { return { code: e.code, message: e.message }; } }`).join("\n"));
    let opened = 0;
    const { kino } = createKino(manifest, { qrScan: async () => { opened++; return "ok"; } });
    const { plugin } = await loadPlugin(join(dir, "plugin.js"), kino);
    const plain = (v) => JSON.parse(JSON.stringify(v));
    const refused = { code: "not_allowed", message: NOT_ALLOWED };
    // The person's tap or submit in a root screen, a screen-mode panel or a contributed tab in screen mode.
    assert.equal((await kitScreenCall.run({ press: true, tick: false }, () => plugin.screenEvent())).text, "ok");
    assert.equal((await kitScreenCall.run({ press: true, tick: false }, () => plugin.panelAction())).text, "ok");
    // A legacy panel's press and the settings node's action (it runs as Ajustes does): no screen marks.
    assert.equal((await plugin.panelAction()).text, "ok");
    assert.equal((await plugin.action()).text, "ok");
    assert.equal(opened, 4);
    // Open, load-more, change (no press), a timer tick, and a screenEvent with no screen marks at all.
    for (const marks of [{ press: false, tick: false }, { press: false, tick: true }, { press: true, tick: true }]) {
      assert.deepEqual(plain(await kitScreenCall.run(marks, () => plugin.screenEvent())), refused, JSON.stringify(marks));
      assert.deepEqual(plain(await kitScreenCall.run(marks, () => plugin.panelAction())), refused, JSON.stringify(marks));
    }
    assert.deepEqual(plain(await plugin.screenEvent()), refused);
    // A render, a refreshMs and a playerEvent are never a press.
    for (const f of ["screen", "panel", "playerEvent"]) assert.deepEqual(plain(await kitScreenCall.run({ press: true, tick: false }, () => plugin[f]())), refused, f);
    assert.equal(opened, 4);
    // A TV still says unavailable first, whatever the origin.
    const tv = createKino(manifest, { device: "tv", qrScan: async () => "x" }).kino;
    await assert.rejects(kitScreenCall.run({ press: true, tick: false }, () => tv.qr.scan()), (e) => e.code === "unavailable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
