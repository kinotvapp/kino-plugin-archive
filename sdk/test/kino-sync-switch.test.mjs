// node --test plugins/sdk/test/kino-sync-switch.test.mjs   (Node 18+)
// kino.sync.active() / kino.sync.setActive(on) (Kino 0.9.78, additive, capability "syncProvider"): the kit's stand-in has them only for a
// plugin that declares syncProvider, answers booleans like Kino, rejects what Kino rejects, and never reaches a job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";

const manifest = (capabilities) => ({
  id: "sync-demo", name: "Sync demo", version: "1.0.0", apiVersion: 12, entry: "plugin.js", hosts: ["example.com"],
  capabilities, sync: { mode: "poll", pullEveryMs: 300000, maxBlobBytes: 1048576, keySecret: "token" },
});

test("the contract pins it: additive from 0.9.78, syncProvider only, the codes and the tap-only functions", () => {
  const s = contract.kinoSyncSwitch;
  assert.equal(s.fromApp, "0.9.78");
  assert.equal(contract.additiveFromApp["kino.sync.setActive"], s.fromApp);
  assert.equal(s.capability, "syncProvider");
  assert.deepEqual(s.errorCodes, ["busy", "timeout", "unavailable", "invalid_request", "not_allowed"]);
  assert.deepEqual(s.fromFunctions, ["action", "panelAction", "screenEvent"]);
  assert.equal(s.timeoutMs, 120000);
});

test("a syncProvider plugin gets both functions and they answer booleans, off only after on", async () => {
  const { kino } = createKino(manifest(["syncProvider"]), { env: {} });
  assert.equal(typeof kino.sync.active, "function");
  assert.equal(typeof kino.sync.setActive, "function");
  assert.equal(await kino.sync.active(), false);
  assert.equal(await kino.sync.setActive(true), true);
  assert.equal(await kino.sync.active(), true);
  assert.equal(await kino.sync.setActive(true), true, "already on: nothing changes");
  assert.equal(await kino.sync.setActive(false), false);
  assert.equal(await kino.sync.active(), false);
});

test("setActive takes a boolean and nothing else; the rejection comes after an await so a catch attaches in time", async () => {
  const { kino } = createKino(manifest(["syncProvider"]), { env: {} });
  for (const bad of ["yes", 1, undefined, null, {}]) {
    await assert.rejects(() => kino.sync.setActive(bad), { code: "invalid_request" });
  }
});

test("any other plugin has remoteChanged only: the functions are absent, so feature detection works", () => {
  const { kino } = createKino(manifest(["search"]), { env: {} });
  assert.equal(typeof kino.sync.remoteChanged, "function");
  assert.equal(kino.sync.active, undefined);
  assert.equal(kino.sync.setActive, undefined);
});
