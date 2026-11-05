// node --test plugins/sdk/test/progress.test.mjs   (Node 18+)
// kino.progress (apiVersion 22): the kit's version, in memory per run, against contract.kinoProgress. The app's twin is
// PluginProgress / PluginProgressStore / PluginProgressBridge (PluginProgressTest and friends).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, validateManifest } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { consentLines } from "../validate.mjs";

const P = contract.kinoProgress;
const manifest = { id: "reader", name: "Reader", version: "1.0.0", apiVersion: 22, entry: "plugin.js", hosts: ["example.org"], capabilities: ["screen", "progress"] };
const make = (opts = {}) => {
  let t = 1_000_000;
  const kino = createKino(manifest, { now: () => t, ...opts }).kino;
  return { kino, tick: (ms = 1000) => { t += ms; } };
};
const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

test("kino.progress exists only for a plugin that declares it, at apiVersion 22", () => {
  assert.equal(createKino({ ...manifest, capabilities: ["screen"] }).kino.progress, undefined);
  assert.equal(typeof make().kino.progress, "object");
  assert.deepEqual(Object.keys(make().kino.progress).sort(), [...P.functions].sort());
});

test("set then get round-trips, with the plugin's own resume handed back as the JSON value", async () => {
  const { kino, tick } = make();
  const resume = { cap: 87, pag: 12, nested: [1, "two", null] };
  assert.equal(await kino.progress.get("ch-1"), null);
  await kino.progress.set({ id: "ch-1", title: "Berserk", fraction: 0.3, label: "Cap. 87", labelEn: "Ch. 87", poster: "https://example.org/c.jpg", resume });
  const got = await kino.progress.get("ch-1");
  assert.deepEqual({ ...got, updatedAtMs: 0 }, { id: "ch-1", fraction: 0.3, title: "Berserk", poster: "https://example.org/c.jpg", label: "Cap. 87", labelEn: "Ch. 87", resume, done: false, updatedAtMs: 0 });
  assert.equal(got.updatedAtMs, 1_000_000);
  assert.notEqual(got.resume, resume, "a copy, not the plugin's own object");
  tick();
  await kino.progress.set({ id: "ch-1", fraction: 0.4 });
  const next = await kino.progress.get("ch-1");
  assert.equal(next.title, "Berserk", "title and poster stay when a later set leaves them out");
  assert.equal(next.fraction, 0.4);
  await kino.progress.clear("ch-1");
  assert.equal(await kino.progress.get("ch-1"), null);
});

test("an identical set changes nothing, not even the activity time", async () => {
  const { kino, tick } = make();
  await kino.progress.set({ id: "a", fraction: 0.2, resume: { p: 1 } });
  const first = (await kino.progress.get("a")).updatedAtMs;
  tick();
  await kino.progress.set({ id: "a", fraction: 0.2, resume: { p: 1 } });
  assert.equal((await kino.progress.get("a")).updatedAtMs, first);
});

test("finished at done or doneAt (default 0.9); a lower fraction reopens it", async () => {
  assert.equal(P.doneAtDefault, 0.9);
  const { kino } = make();
  await kino.progress.set({ id: "a", fraction: 0.89 });
  await kino.progress.set({ id: "b", fraction: 0.9 });
  await kino.progress.set({ id: "c", fraction: 0.5, done: true });
  await kino.progress.set({ id: "d", fraction: 0.5, doneAt: 0.5 });
  await kino.progress.set({ id: "e", fraction: 1, done: false });
  const done = Object.fromEntries((await kino.progress.list()).map((e) => [e.id, e.done]));
  assert.deepEqual(done, { a: false, b: true, c: true, d: true, e: false });
  await kino.progress.set({ id: "b", fraction: 0.1 });
  assert.equal((await kino.progress.get("b")).done, false);
});

test("list: newest first, limit 1..100 (default 50), sinceMs", async () => {
  const { kino, tick } = make();
  for (let i = 0; i < 60; i++) { await kino.progress.set({ id: `e${i}`, fraction: 0.1 }); tick(10); }
  const all = await kino.progress.list();
  assert.equal(all.length, P.listLimitDefault);
  assert.equal(all[0].id, "e59");
  assert.equal(all[49].id, "e10");
  assert.deepEqual((await kino.progress.list({ limit: 3 })).map((e) => e.id), ["e59", "e58", "e57"]);
  assert.equal((await kino.progress.list({ limit: P.listLimitMax })).length, 60);
  const t58 = (await kino.progress.get("e58")).updatedAtMs;
  assert.deepEqual((await kino.progress.list({ sinceMs: t58 })).map((e) => e.id), ["e59", "e58"]);
  for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: "5" }, { sinceMs: -1 }, { sinceMs: "0" }, { sinceMs: Infinity }, 7]) {
    assert.equal(await code(kino.progress.list(bad)), "bad_request", JSON.stringify(bad));
  }
});

test("more than 500 elements: the oldest are dropped", async () => {
  const { kino, tick } = make();
  assert.equal(P.maxElements, 500);
  for (let i = 0; i < 505; i++) { await kino.progress.set({ id: `e${i}`, fraction: 0.1 }); tick(1); }
  assert.equal(await kino.progress.get("e0"), null);
  assert.equal(await kino.progress.get("e4"), null);
  assert.notEqual(await kino.progress.get("e5"), null);
  assert.equal((await kino.progress.list({ limit: 100 })).length, 100);
});

test("bad arguments are bad_request; a resume over the limit is too_large", async () => {
  const { kino } = make();
  const set = (o) => code(kino.progress.set(o));
  assert.equal(await set({ id: "a", fraction: 2 }), "bad_request");
  assert.equal(await set({ id: "a", fraction: -0.1 }), "bad_request");
  assert.equal(await set({ id: "a", fraction: "0.5" }), "bad_request");
  assert.equal(await set({ id: "a", fraction: NaN }), "bad_request");
  assert.equal(await set({ id: "", fraction: 0.5 }), "bad_request");
  assert.equal(await set({ id: "a b", fraction: 0.5 }), "bad_request");
  assert.equal(await set({ id: "x".repeat(129), fraction: 0.5 }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, label: "x".repeat(P.maxLabelChars + 1) }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, labelEn: "x".repeat(P.maxLabelChars + 1) }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, title: 5 }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, done: "yes" }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, doneAt: 1.5 }), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, resume: () => 1 }), "bad_request");
  assert.equal(await set(null), "bad_request");
  assert.equal(await set({ id: "a", fraction: 0.5, label: "x".repeat(P.maxLabelChars) }), null);
  assert.equal(await code(kino.progress.get("not valid!")), "bad_request");
  assert.equal(await code(kino.progress.clear("")), "bad_request");
  // 1024 bytes of serialized JSON: the quotes count.
  assert.equal(await set({ id: "b", fraction: 0.5, resume: "x".repeat(P.maxResumeBytes - 2) }), null);
  assert.equal(await set({ id: "c", fraction: 0.5, resume: "x".repeat(P.maxResumeBytes - 1) }), "too_large");
  assert.equal(await set({ id: "d", fraction: 0.5, resume: { k: "é".repeat(P.maxResumeBytes / 2) } }), "too_large", "UTF-8 bytes, not characters");
  assert.equal(await kino.progress.get("c"), null, "a refused set stores nothing");
});

test("a poster that is not an https image address costs only the poster", async () => {
  const { kino } = make();
  await kino.progress.set({ id: "a", fraction: 0.5, title: "T", poster: "http://example.org/c.jpg" });
  const got = await kino.progress.get("a");
  assert.equal(got.title, "T");
  assert.equal(got.poster, undefined);
});

test("a KinoImageRef poster of the plugin is kept like the app keeps it", async () => {
  const { kino } = make();
  await kino.progress.set({ id: "a", fraction: 0.5, poster: { source: "plugin", handle: "cover:1" } });
  assert.equal(typeof (await kino.progress.get("a")).poster, "string");
  await kino.progress.set({ id: "b", fraction: 0.5, poster: { source: "other", handle: "x" } });
  assert.equal((await kino.progress.get("b")).poster, undefined);
});

test("contract numbers and the capability's place in the lists", () => {
  assert.equal(P.apiVersion, 22);
  assert.equal(P.consentLine, null);
  assert.equal(P.maxResumeBytes, 1024);
  assert.ok(contract.capabilities.declarative.includes("progress"));
  assert.ok(contract.capabilities.standaloneSupplements.includes("progress"));
  assert.ok(!contract.capabilities.needsApproval.includes("progress"));
  assert.ok(contract.kinoJobs.availableApis.includes("kino.progress"), "a job may use it");
  assert.ok(contract.kinoJobs.perProfileRefusedApis.includes("kino.progress"), "but not for a profile that is not in use");
});

test("validate: progress at apiVersion 22 passes with no consent line; at 21 it needs apiVersion 22", () => {
  const text = (apiVersion, capabilities) => JSON.stringify({ ...manifest, apiVersion, capabilities, screen: { label: "Reader" } });
  const ok = validateManifest(text(22, ["screen", "progress"]));
  assert.equal(ok.ok, true);
  assert.deepEqual(consentLines(ok.manifest), [], "no approval line");
  const old = validateManifest(text(21, ["screen", "progress"]));
  assert.equal(old.ok, false);
  assert.match(old.message, /"progress" capability needs apiVersion 22/);
});
