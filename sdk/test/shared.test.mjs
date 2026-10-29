// Task 8q-2: kino.shared in the kit, the same rules as the app (PluginShared, PluginSharedValues, PluginSharedBridge); the shared
// cases (shared-cases.json) are run by the app's PluginSharedTest.kitParity too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { createKino, signingLane } from "../kino-shim.mjs";
import { createSharedDevices, createSharedStore, sharedKeyProblem, sharedValueProblem, syncShared } from "../shared.mjs";
import { jobBudget, jobKino } from "../job.mjs";
import { sharedSecretKeyWarnings, undeclaredSharedProblem } from "../validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "shared-cases.json"), "utf8"));
const S = contract.kinoShared;

const manifest = (caps = ["screen", "shared"]) => ({ id: "news", name: "Noticias", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["news.example"], capabilities: caps, screen: { label: "Noticias" } });

test("kit parity with the app: values, keys and two-device scripts (shared-cases.json)", () => {
  for (const c of CASES.values) {
    const text = "repeat" in c ? c.text.replace("{R}", c.unit.repeat(c.repeat)) : c.text;
    const got = sharedValueProblem(text);
    assert.equal(got ? got[0] : null, c.refused, c.name);
  }
  for (const c of CASES.keys) assert.equal(sharedKeyProblem(c.key) === null, c.ok, c.key);
  for (const c of CASES.scripts) {
    let t = 1_000_000;
    const devices = { phone: createSharedStore({ now: () => t }), tv: createSharedStore({ now: () => t }) };
    c.steps.forEach((step, i) => {
      const name = `${c.name} #${i}`;
      const plugin = step.plugin ?? "news";
      switch (step.op) {
        case "wait": t += step.ms; break;
        case "set": {
          const r = devices[step.device].set(plugin, step.key, step.value);
          assert.equal(Array.isArray(r) ? r[0] : r, step.expect, name);
          break;
        }
        case "flush": devices[step.device].flushDue(); break;
        case "sync": syncShared(devices[step.from], devices[step.to]); break;
        case "get": assert.equal(devices[step.device].get(plugin, step.key), step.expect, name); break;
        case "forget": devices[step.device].forget(plugin); break;
        default: throw new Error(`unknown step ${name}`);
      }
    });
  }
});

test("the contract's numbers", () => {
  assert.equal(S.capability, "shared");
  assert.ok(contract.capabilities.declarative.includes("shared"));
  assert.ok(!contract.capabilities.needsApproval.includes("shared"));
  assert.ok(contract.kinoJobs.availableApis.includes("kino.shared"));
  assert.deepEqual(contract.kinoJobs.manifest.runOnValues, ["any", "preferPhone"]);
});

test("two simulated devices: the phone's job writes, the TV's screen reads", async () => {
  let t = 5_000_000;
  const devices = createSharedDevices({ now: () => t });
  const phone = createKino(manifest(["screen", "schedule", "shared"]), { shared: devices.phone, now: () => t, device: "phone" }).kino;
  const tv = createKino(manifest(["screen", "schedule", "shared"]), { shared: devices.tv, now: () => t, device: "tv" }).kino;
  // In a job: kino.shared is on the allow-list.
  const inJob = jobKino(phone, jobBudget());
  assert.equal(inJob.shared.set("cache", { stories: [{ id: 1 }], fetchedAt: 5 }), true);
  assert.equal(inJob.shared.set("cache", { stories: [{ id: 1 }], fetchedAt: 5 }), false, "unchanged: nothing written");
  assert.equal(tv.shared.get("cache"), null, "not synced yet");
  devices.sync();
  assert.deepEqual(tv.shared.get("cache"), { stories: [{ id: 1 }], fetchedAt: 5 });
  // Back the other way, a minute later.
  t += 61_000;
  tv.shared.set("cache", { stories: [], fetchedAt: 6 });
  devices.sync();
  assert.deepEqual(phone.shared.get("cache"), { stories: [], fetchedAt: 6 });
  // null removes.
  t += 61_000;
  phone.shared.set("cache", null);
  devices.sync();
  assert.equal(tv.shared.get("cache"), null);
});

test("the gates: capability, keys, JSON only, secrets, rate", () => {
  let t = 1;
  const kino = createKino(manifest(), { now: () => t }).kino;
  const code = (f) => { try { f(); return "ok"; } catch (e) { return e.code; } };
  assert.equal(code(() => kino.shared.set("token", 1)), "bad_request");
  assert.equal(code(() => kino.shared.set("x", undefined)), "bad_request");
  assert.equal(code(() => kino.shared.set("", 1)), "bad_request");
  assert.equal(code(() => kino.shared.set("x", "a".repeat(70000))), "too_large");
  assert.equal(code(() => kino.shared.set("x", () => 1)), "bad_request");
  for (let i = 1; i < S.limits.writesPerMinute; i++) kino.shared.set("x", i);
  assert.equal(code(() => kino.shared.set("x", 0)), "ok");
  assert.equal(code(() => kino.shared.set("x", 99)), "rate_limited");
  t += 2_000;
  assert.equal(code(() => kino.shared.set("x", 99)), "ok");
  // Without the capability every call is not_allowed.
  const bare = createKino(manifest(["screen"])).kino;
  assert.equal(code(() => bare.shared.get("x")), "not_allowed");
  // The signing lane refuses it.
  assert.equal(code(() => signingLane(kino).shared.get("x")), "not_allowed");
  // Each plugin reaches only its own keys.
  const store = createSharedStore();
  createKino(manifest(), { shared: store }).kino.shared.set("k", 1);
  assert.equal(createKino({ ...manifest(), id: "other" }, { shared: store }).kino.shared.get("k"), null);
});

test("validate: an undeclared kino.shared, and secret-looking keys", () => {
  const source = "export async function screen() { kino.shared.set('authToken', 1); kino.shared.get(\"cache\"); kino.shared.get(`sessionId`); }";
  assert.match(undeclaredSharedProblem(manifest(["screen"]), source), /does not declare the "shared" capability/);
  assert.equal(undeclaredSharedProblem(manifest(), source), null);
  const w = sharedSecretKeyWarnings(source);
  assert.equal(w.length, 2);
  assert.match(w[0], /"authToken" looks like a secret/);
  assert.match(w[1], /"sessionId"/);
});

test("runOn parses like the app", () => {
  const base = { ...manifest(["screen", "schedule"]), jobs: [{ id: "a", label: { es: "A" }, everyMin: 15, everyOptions: [15], runOn: "preferPhone" }] };
  const r = validateManifest(JSON.stringify(base));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.manifest.jobs[0].runOn, "preferPhone");
  const bad = validateManifest(JSON.stringify({ ...base, jobs: [{ ...base.jobs[0], runOn: "tv" }] }));
  assert.equal(bad.ok, false);
  assert.equal(bad.message, contract.kinoJobs.manifest.badRunOn);
});
