// node --test plugins/sdk/test/kino-notifications.test.mjs   (Node 18+)
// kino.notifications (apiVersion 15, capability "notifications"): the kit prints the plain consent line and its stand-in keeps
// the bell's notices with the app's rules (PluginNotifications): fields, go shapes, the calls that may post, the limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract, validateManifest } from "../contract.mjs";
import { createKino, kitCall, signingLane } from "../kino-shim.mjs";
import { kitNotificationsApi } from "../notices.mjs";
import { consentLines } from "../validate.mjs";

const N = contract.kinoNotifications;
const manifest = (extra = {}) => ({
  id: "kino-social", name: "Kino Social", version: "1.0.0", apiVersion: 15, entry: "plugin.js",
  hosts: ["social.example.com"], capabilities: ["screen", "notifications"], screen: { label: "Social" }, ...extra,
});
const screen = (fn) => kitCall.run("screen", fn);

test("the manifest: notifications is apiVersion 15, declarative, approval with a plain line", () => {
  assert.equal(contract.capabilities.apiVersions.notifications, 15);
  assert.ok(contract.capabilities.needsApproval.includes("notifications"));
  assert.ok(contract.capabilities.declarative.includes("notifications"));
  const ok = validateManifest(JSON.stringify(manifest()));
  assert.equal(ok.ok, true, ok.message);
  assert.equal(validateManifest(JSON.stringify(manifest({ apiVersion: 14 }))).ok, false);
  assert.deepEqual(consentLines(ok.manifest).find((l) => l.text === N.consentLine.es), { text: "Podrá mostrarte avisos en la campanita", danger: false });
  assert.equal(N.consentLine.en, "Can show you notices in the bell");
  assert.ok(contract.kinoJobs.availableApis.includes("kino.notifications"));
});

test("post keeps the notice, newest first; the same id replaces it; clear removes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-notices-"));
  const file = join(dir, ".kino-notices.json");
  try {
    let t = 1_000;
    const { kino } = createKino(manifest(), { env: {}, noticesFile: file, now: () => t });
    assert.equal(typeof kino.notifications, "object");
    await screen(() => kino.notifications.post({ id: "a", title: "Beto comentó tu post", go: { screen: { route: "post", args: { id: 1 } } } }));
    t += 1;
    await screen(() => kino.notifications.post({ id: "b", title: "Caro\nte sigue", go: { url: { href: "https://x.example" } } }));
    let list = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(list.map((n) => n.id), ["b", "a"]);
    assert.equal(list[0].title, "Caro te sigue");
    assert.equal(list[0].go, null);
    assert.deepEqual(list[1].go, { screen: { route: "post", args: { id: 1 } } });
    t += 1;
    await screen(() => kino.notifications.post({ id: "a", title: "Beto y 2 más comentaron tu post" }));
    list = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(list.map((n) => n.id), ["a", "b"]);
    await screen(() => kino.notifications.clear("a"));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).map((n) => n.id), ["b"]);
    await screen(() => kino.notifications.clear());
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bad fields are bad_request; a call that is not screen, screenEvent or the job is permission_denied; 20 an hour", async () => {
  const { kino } = createKino(manifest(), { env: {} });
  for (const bad of [{ title: "x" }, { id: "has space", title: "x" }, { id: "a" }, { id: "a", title: "t".repeat(81) }, { id: "a", title: "t", text: "x".repeat(161) }, { id: "a", title: "t", url: "x" }, "nope"]) {
    await assert.rejects(screen(() => kino.notifications.post(bad)), (e) => e.code === "bad_request", JSON.stringify(bad));
  }
  await assert.rejects(kitCall.run("home", () => kino.notifications.post({ id: "a", title: "t" })), (e) => e.code === "permission_denied");
  const revoked = createKino(manifest(), { env: { KINO_NOTIFICATIONS_REVOKED: "1" } }).kino;
  await assert.rejects(screen(() => revoked.notifications.post({ id: "a", title: "t" })), (e) => e.code === "permission_denied");
  let t = 0;
  const api = kitNotificationsApi(manifest(), { now: () => t, origin: () => ({ fn: "job", job: true }), env: {} });
  for (let i = 0; i < N.limits.perHour; i++) await api.post({ id: "n" + i, title: "t" });
  await assert.rejects(api.post({ id: "over", title: "t" }), (e) => e.code === "rate_limited");
  t += 3_600_000;
  for (let i = 0; i < 15; i++) await api.post({ id: "m" + i, title: "t" });
  assert.equal(api.list().length, N.limits.maxKept);
  await assert.rejects(signingLane(kino).notifications.post({ id: "a", title: "t" }), (e) => e.code === "not_allowed");
});
