// node --test plugins/sdk/test/jobs.test.mjs   (Node 18+)
// Plugin jobs (apiVersion 14, capability "schedule", Task 8q): the kit reads the manifest's jobs as the app does (job-cases.json,
// run by PluginJobsTest too), prints the red consent line, counts a run's budget like JobRunBudget, refuses the forbidden APIs,
// cuts a run at its first cap, and `run.mjs ... job` runs job(ctx) with the context and the caps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { contract, validateManifest } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { consentLines } from "../validate.mjs";
import { jobBudget, jobContext, jobKino, runJob } from "../job.mjs";

const J = contract.kinoJobs;
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "job-cases.json"), "utf8"));

test("kit parity with the app: manifests and budgets (job-cases.json)", () => {
  for (const c of CASES.manifests) {
    const m = { ...CASES.base };
    for (const [k, v] of Object.entries(c.set)) { if (v === null) delete m[k]; else m[k] = v; }
    const r = validateManifest(JSON.stringify(m));
    if (c.ok) {
      assert.equal(r.ok, true, `${c.name}: ${r.message}`);
      // runOn (Task 8q-2) is compared where the case names it.
      assert.deepEqual(r.manifest.jobs.map((j, i) => ({
        id: j.id, everyMin: j.everyMin, everyOptions: j.everyOptions,
        ...(c.jobs[i] && "runOn" in c.jobs[i] ? { runOn: j.runOn } : {}),
        // Task 18 (G2): enabledBy, where the case names it.
        ...(c.jobs[i] && "enabledBy" in c.jobs[i] ? { enabledBy: j.enabledBy } : {}),
      })), c.jobs, c.name);
    } else {
      assert.equal(r.ok, false, c.name);
      assert.equal(r.field, c.field, c.name);
      if (c.message) assert.equal(r.message, J.manifest[c.message] ?? c.message, c.name);
    }
  }
  for (const c of CASES.budgets) {
    const b = jobBudget();
    for (const [op, n] of c.steps) { if (op === "fetch") { if (b.takeFetch()) b.addResponse(n); } else b.takeStorage(n); }
    assert.equal(b.exceeded, c.crossed, c.name);
  }
});

test("kitPrintsTheConsentLine: the schedule line is red and is the app's, word for word", () => {
  const checked = validateManifest(JSON.stringify(CASES.base));
  assert.equal(checked.ok, true, checked.message);
  const line = consentLines(checked.manifest).find((l) => l.text === J.consentLine.es);
  assert.deepEqual(line, { text: "Podrá ejecutarse en segundo plano cada cierto tiempo para actualizar sus datos, usando internet y batería", danger: true });
  // The labels are scrubbed like the app's.
  const scrubbed = validateManifest(JSON.stringify({ ...CASES.base, jobs: [{ id: "a", label: { es: "\u202eNoti\u200bcias" }, everyMin: 15, everyOptions: [15] }] }));
  assert.equal(scrubbed.manifest.jobs[0].label, "Noticias");
  // Below apiVersion 14 the field is unknown (dropped like any other key).
  const old = validateManifest(JSON.stringify({ ...CASES.base, apiVersion: 13, capabilities: ["search", "resolve"], screen: undefined }));
  assert.equal(old.ok, true, old.message);
  assert.equal(old.manifest.jobs, undefined);
});

test("forbiddenApisRefusedInJob: the kit's job kino rejects them with not_allowed and logs the name", async () => {
  const checked = validateManifest(JSON.stringify(CASES.base));
  const { kino } = createKino(checked.manifest, { callFunction: J.export, fetchImpl: async () => new Response("hello", { headers: { "content-type": "text/plain" } }) });
  const logs = [];
  const k = jobKino(kino, jobBudget(), (l) => logs.push(l));
  for (const [name, call] of [["room", () => k.room.state()], ["meta", () => k.meta({ type: "movie", ids: { imdb: "tt0133093" } })], ["tmdb", () => k.tmdb("/movie/603")]]) {
    if (!(name in kino)) continue;
    await assert.rejects(call(), (e) => e.code === "not_allowed", name);
  }
  assert.ok(logs.some((l) => l.includes("kino.room")));
  // Storage and config stay.
  k.storage.set("k", "v");
  assert.equal(k.storage.get("k"), "v");
});

test("capsCutTheRun: the eleventh request is refused, and the run is cut as a failure", async () => {
  const checked = validateManifest(JSON.stringify(CASES.base));
  const { kino } = createKino(checked.manifest, { callFunction: J.export, fetchImpl: async () => new Response("x", { headers: { "content-type": "text/plain" } }) });
  const budget = jobBudget();
  const k = jobKino(kino, budget);
  let made = 0;
  const plugin = {
    async job() {
      for (let i = 0; i < 12; i++) { await k.fetch("https://news.google.com/" + i); made++; }
      await new Promise(() => {});
    },
  };
  const r = await runJob(plugin, jobContext("refresh"), budget);
  assert.equal(r.ok, false);
  assert.equal(r.failure, "cap_fetches");
  assert.equal(made, J.limits.maxFetches);
  // The time limit cuts a run that never answers.
  const slow = await runJob({ job: () => new Promise(() => {}) }, jobContext("refresh"), jobBudget(), 50);
  assert.deepEqual([slow.ok, slow.failure], [false, "timeout"]);
  // A plugin's own error is never shown: Kino's code only.
  const thrown = await runJob({ async job() { throw new Error("secret detail"); } }, jobContext("refresh"), jobBudget());
  assert.deepEqual([thrown.ok, thrown.failure], [false, "plugin_error"]);
});

test("fix round 1: an allow-list, answers capped at what is left, fetches one at a time, storage in UTF-8 bytes", async () => {
  const checked = validateManifest(JSON.stringify(CASES.base));
  const big = "a".repeat(1_500_000);
  let inFlight = 0, peak = 0;
  const { kino } = createKino(checked.manifest, {
    callFunction: J.export,
    fetchImpl: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return new Response(big, { headers: { "content-type": "text/plain" } }); },
  });
  const budget = jobBudget();
  const k = jobKino(kino, budget);
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => k.fetch("https://news.google.com/" + i).then(() => "ok", (e) => e.code)));
  assert.deepEqual(out.filter((x) => x === "ok").length, 1, out.join(","));
  assert.ok(out.filter((x) => x !== "ok").every((x) => x === "too_large"), out.join(","));
  assert.equal(budget.exceeded, "cap_bytes");
  assert.equal(budget.bytes, big.length);
  assert.equal(peak, 1);
  // UTF-8 bytes, like the app: 60 two-byte letters and the key are 121 bytes.
  const small = jobKino(kino, jobBudget({ maxStorage: 120 }));
  assert.throws(() => small.storage.set("k", "ñ".repeat(60)), (e) => e.code === "too_large");
  // Anything not on the allow-list is refused, including an API the job contract never heard of.
  const extended = jobKino({ ...kino, later: { get: async () => 1 }, fresh: async () => 1 }, jobBudget());
  await assert.rejects(extended.later.get("x"), (e) => e.code === "not_allowed");
  await assert.rejects(extended.fresh(), (e) => e.code === "not_allowed");
  assert.equal(extended.apiVersion, kino.apiVersion);
});

test("libraryInJobNeedsItsOwnConsent: a job reads the library only when the manifest declares it", async () => {
  const withLib = validateManifest(JSON.stringify({ ...CASES.base, capabilities: ["screen", "schedule", "library"] })).manifest;
  const lib = createKino(withLib, { callFunction: J.export, libraryFixture: { watched: [{ title: "Matrix", kind: "movie", watchedAtMs: 86400000 * 3 }] } }).kino;
  assert.equal((await jobKino(lib, jobBudget()).library.watched()).length, 1);
  const without = createKino(validateManifest(JSON.stringify(CASES.base)).manifest, { callFunction: J.export }).kino;
  if (without.library) await assert.rejects(without.library.watched(), (e) => e.code === "permission_denied");
});

test("run.mjs job runs job(ctx) with the context and prints what it spent", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-job-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(CASES.base));
    writeFileSync(join(dir, "plugin.js"), [
      "export async function screen() { return { root: { type: 'text', text: 'x' } }; }",
      "export async function screenEvent() { return null; }",
      "export async function job(ctx) { kino.storage.set('ctx', JSON.stringify(ctx)); return 'ignored'; }",
    ].join("\n"));
    const run = spawnSync(process.execPath, [join(HERE, "..", "run.mjs"), "--context", "{\"attempt\":2}", dir, "job", "refresh", "manual"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.deepEqual([out.ok, out.failure, out.fetches], [true, null, 0]);
    assert.ok(out.stored > 0);
    const stored = JSON.parse(readFileSync(join(dir, ".kino-storage.json"), "utf8"));
    const ctx = JSON.parse(Object.values(stored).map((v) => (typeof v === "string" ? v : v.value)).find((v) => typeof v === "string" && v.includes("refresh")));
    assert.deepEqual(ctx, { id: "refresh", reason: "manual", lastRunMs: null, attempt: 2 });
    // A plugin without the capability gets the command's refusal.
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify({ ...CASES.base, capabilities: ["screen"], jobs: undefined }));
    const refused = spawnSync(process.execPath, [join(HERE, "..", "run.mjs"), dir, "job"], { encoding: "utf8" });
    assert.equal(refused.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
