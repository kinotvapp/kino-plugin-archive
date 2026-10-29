// node --test plugins/sdk/test/kino-ai.test.mjs   (Node 18+)
// kino.ai.ask (apiVersion 14, capability "ai", Task 8r): the kit prints the red consent line, refuses a plugin that calls it
// without declaring it, shares the app's origin and request rules (ai-cases.json, run by PluginAiTest too), and its fake text AI
// answers canned replies and errors with the app's shapes, limits and refusals. An ask never throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { aiCut, aiRequestVerdict, createKino, KIT_AI_MODEL, KIT_AI_REPLY, kitAiApi, kitAiDevice, signingLane } from "../kino-shim.mjs";
import { aiOriginAllowed, kitCall, kitScreenCall } from "../kit-call.mjs";
import { consentLines, undeclaredAiProblem } from "../validate.mjs";
import { jobBudget, jobContext, jobKino, runJob } from "../job.mjs";
import { loadPlugin } from "../sandbox.mjs";

const A = contract.kinoAi;
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "ai-cases.json"), "utf8"));
const plain = (v) => JSON.parse(JSON.stringify(v));

const manifest = (extra = {}) => ({
  id: "news", name: "Noticias", version: "1.0.0", apiVersion: 14, entry: "plugin.js",
  hosts: ["news.example"], capabilities: ["screen", "ai"], screen: { label: "Noticias" }, ...extra,
});
const options = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v !== null && typeof v === "object" && "repeat" in v ? v.of.repeat(v.repeat) : v]));
const press = (f) => kitScreenCall.run({ press: true, tick: false }, () => kitCall.run("screenEvent", f));

test("the contract pins kino.ai's limits, codes and lines", () => {
  assert.equal(A.capability, "ai");
  assert.equal(A.apiVersion, 14);
  assert.deepEqual(A.functions, ["ask"]);
  assert.deepEqual(A.answerFields, ["text", "model"]);
  assert.deepEqual(A.errorCodes, ["unavailable", "rate_limited", "too_large", "timeout", "refused"]);
  assert.deepEqual(A.fromFunctions, ["action", "panelAction", "screenEvent"]);
  assert.equal(A.fromJob, contract.kinoJobs.export);
  assert.deepEqual(A.limits, { maxPromptBytes: 8192, maxSystemBytes: 2048, maxChars: 4096, defaultMaxChars: 2048, perMinute: 10, perDay: 100, maxInFlight: 1, timeoutMs: 20000, maxRequestChars: 65536, devicePerDay: 300, deviceMaxInFlight: 2 });
  assert.ok(contract.capabilities.needsApproval.includes("ai"));
  assert.ok(contract.capabilities.declarative.includes("ai"));
  assert.ok(contract.capabilities.standaloneSupplements.includes("ai"));
  assert.ok(!contract.capabilities.standalone.includes("ai"));
  assert.ok(contract.kinoJobs.availableApis.includes("kino.ai"));
  // The prompt-injection note is part of the contract every author reads.
  assert.match(A.$comment, /prompt can be injected/);
});

test("kitPrintsTheConsentLine: the ai line is red and is the app's, word for word; never on its own", () => {
  const checked = validateManifest(JSON.stringify(manifest()));
  assert.equal(checked.ok, true, checked.message);
  const line = consentLines(checked.manifest).find((l) => l.text === A.consentLine.es);
  assert.deepEqual(line, { text: "Podrá enviar texto a un servicio de IA de terceros (Kilo) para que lo resuma o clasifique; lo que envíe sale de tu aparato", danger: true });
  assert.equal(validateManifest(JSON.stringify(manifest({ capabilities: ["ai"], screen: undefined }))).ok, false);
  assert.equal(validateManifest(JSON.stringify(manifest({ apiVersion: 13, capabilities: ["search", "resolve", "ai"], screen: undefined }))).ok, false);
});

test("undeclaredAiProblem: calling kino.ai.ask without the capability is refused", () => {
  assert.match(undeclaredAiProblem({ capabilities: ["screen"] }, "await kino.ai.ask({ prompt: 'x' })"), /does not declare the "ai" capability/);
  assert.equal(undeclaredAiProblem({ capabilities: ["screen", "ai"] }, "await kino.ai.ask({ prompt: 'x' })"), null);
  assert.equal(undeclaredAiProblem({ capabilities: ["screen"] }, "const ai = 1;"), null);
});

test("kit parity with the app: origins and requests (ai-cases.json)", () => {
  assert.ok(CASES.origins.length >= 20);
  for (const c of CASES.origins) {
    const got = aiOriginAllowed({ fn: c.function, screen: c.screen === true, press: c.press === true, tick: c.tick === true, job: c.job === true, interactive: c.interactive !== false, personStarted: c.personStarted !== false });
    assert.equal(got, c.allowed, c.name);
  }
  for (const c of CASES.requests) {
    const v = aiRequestVerdict(options(c.options));
    if (c.result === "ok") {
      assert.equal(v.ok, true, c.name);
      assert.equal(v.request.maxChars, c.maxChars, c.name);
    } else {
      assert.equal(v.error, c.result, c.name);
    }
  }
});

test("askReturnsTextAndModel: a press gets the fake's reply and model; the default is the canned sentence", async () => {
  const seen = [];
  const { kino } = createKino(manifest(), { env: {}, ai: async (q) => { seen.push(q); return { text: "Deportes", model: "test/model" }; } });
  assert.deepEqual(plain(await press(() => kino.ai.ask({ prompt: "Sort: Goal!", system: "You sort news" }))), { ok: true, text: "Deportes", model: "test/model" });
  assert.deepEqual(seen, [{ system: "You sort news", prompt: "Sort: Goal!", json: false, maxChars: A.limits.defaultMaxChars }]);
  const canned = createKino(manifest(), { env: {} }).kino;
  assert.deepEqual(plain(await press(() => canned.ai.ask({ prompt: "x" }))), { ok: true, text: KIT_AI_REPLY, model: KIT_AI_MODEL });
  const fromEnv = createKino(manifest(), { env: { KINO_AI_REPLY: "hola" } }).kino;
  assert.equal((await press(() => fromEnv.ai.ask({ prompt: "x" }))).text, "hola");
});

test("jsonFlagAsksForJsonButNeverTrustsIt: json adds the instruction and the raw reply comes back, parseable or not", async () => {
  const seen = [];
  const { kino } = createKino(manifest(), { env: {}, ai: async (q) => { seen.push(q.system); return "Sure! {\"id\": 1"; } });
  const r = await press(() => kino.ai.ask({ prompt: "x", system: "Sort", json: true }));
  assert.deepEqual(plain(r), { ok: true, text: "Sure! {\"id\": 1", model: KIT_AI_MODEL });
  assert.equal(seen[0], "Sort\n\n" + A.jsonInstruction);
  const bare = createKino(manifest(), { env: {} }).kino;
  assert.equal((await press(() => bare.ai.ask({ prompt: "x", json: true }))).text, "{}");
});

test("promptAndSystemCapped and the reply cut at maxChars, never inside a surrogate pair", async () => {
  const { kino } = createKino(manifest(), { env: {}, ai: async () => "a".repeat(5000) });
  assert.equal((await press(() => kino.ai.ask({ prompt: "a".repeat(8193) }))).error, "too_large");
  assert.equal((await press(() => kino.ai.ask({ prompt: "x", system: "s".repeat(2049) }))).error, "too_large");
  assert.equal((await press(() => kino.ai.ask({ prompt: "x" }))).text.length, A.limits.defaultMaxChars);
  assert.equal((await press(() => kino.ai.ask({ prompt: "x", maxChars: 10 }))).text.length, 10);
  assert.equal(aiCut("ab😀c", 3), "ab");
  assert.equal(aiCut("ab😀c", 4), "ab😀");
});

test("rateAndDailyLimits: 10 a minute, 100 a day (UTC), then rate_limited", async () => {
  let t = Date.UTC(2026, 9, 27, 10, 0, 0);
  const api = kitAiApi(manifest(), { env: {}, now: () => t, origin: () => ({ fn: "action" }), model: async () => "ok" });
  for (let i = 0; i < A.limits.perMinute; i++) assert.equal((await api.ask({ prompt: "x" })).ok, true, `ask ${i}`);
  assert.equal((await api.ask({ prompt: "x" })).error, "rate_limited");
  // A strict sliding window: still refused 59 s later, free at 60 s.
  t += 59_000;
  assert.equal((await api.ask({ prompt: "x" })).error, "rate_limited");
  t += 1_000;
  assert.equal((await api.ask({ prompt: "x" })).ok, true);
  let asked = A.limits.perMinute + 1;
  while (asked < A.limits.perDay) { t += 6_000; if ((await api.ask({ prompt: "x" })).ok) asked++; }
  t += 60_000;
  const over = await api.ask({ prompt: "x" });
  assert.equal(over.error, "rate_limited");
  assert.match(over.message, /a day/);
  t = Date.UTC(2026, 9, 28, 0, 0, 1);
  assert.equal((await api.ask({ prompt: "x" })).ok, true);
});

test("oneInFlight: a second ask while one waits is rate_limited, never queued", async () => {
  let release;
  const api = kitAiApi(manifest(), { env: {}, origin: () => ({ fn: "action" }), model: () => new Promise((r) => { release = r; }) });
  const first = api.ask({ prompt: "x" });
  await new Promise((r) => setImmediate(r));
  const second = await api.ask({ prompt: "y" });
  assert.equal(second.error, "rate_limited");
  release("done");
  assert.equal((await first).text, "done");
});

test("originsRefused: an open, a tick, a render, a playerEvent, a sync call never ask; a revoke or no capability refuses", async () => {
  const { kino } = createKino(manifest(), { env: {}, ai: async () => "x" });
  for (const marks of [{ press: false, tick: false }, { press: false, tick: true }, { press: true, tick: true }]) {
    assert.equal((await kitScreenCall.run(marks, () => kitCall.run("screenEvent", () => kino.ai.ask({ prompt: "x" })))).error, "refused");
  }
  for (const fn of ["screen", "panel", "playerEvent", "home", "search", "resolve"]) {
    assert.equal((await kitScreenCall.run({ press: true, tick: false }, () => kitCall.run(fn, () => kino.ai.ask({ prompt: "x" })))).error, "refused", fn);
  }
  assert.equal((await kitCall.run("action", () => kino.ai.ask({ prompt: "x" }))).ok, true);
  const sync = createKino(manifest(), { env: {}, syncCall: true }).kino;
  assert.equal((await kitCall.run("action", () => sync.ai.ask({ prompt: "x" }))).error, "refused");
  const revoked = createKino(manifest(), { env: { KINO_AI_REVOKED: "1" } }).kino;
  assert.equal((await press(() => revoked.ai.ask({ prompt: "x" }))).error, "refused");
  const undeclared = createKino(manifest({ capabilities: ["screen"] }), { env: {} }).kino;
  assert.equal((await press(() => undeclared.ai.ask({ prompt: "x" }))).error, "refused");
  // Never throws, whatever it gets.
  for (const bad of [undefined, null, "x", 42, [], { prompt: 1 }]) assert.equal((await press(() => kino.ai.ask(bad))).error, "refused");
});

test("unavailableMapsToError: null, a throw, an error code and a slow model", async () => {
  const ask = (model, o = {}) => kitAiApi(manifest(), { env: {}, origin: () => ({ fn: "action" }), model, ...o }).ask({ prompt: "x" });
  assert.equal((await ask(async () => null)).error, "unavailable");
  assert.equal((await ask(async () => { throw new Error("boom"); })).error, "unavailable");
  assert.equal((await ask(async () => ({ error: "timeout" }))).error, "timeout");
  assert.equal((await ask(async () => ({ error: "weird" }))).error, "refused");
  assert.equal((await ask(() => new Promise(() => {}), { timeoutMs: 20 })).error, "timeout");
  const env = createKino(manifest(), { env: { KINO_AI_ERROR: "unavailable" } }).kino;
  assert.equal((await press(() => env.ai.ask({ prompt: "x" }))).error, "unavailable");
});

test("jobsMayAsk: a job's run asks, each ask one of the run's requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-ai-job-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function job() { const out = []; for (let i = 0; i < 12; i++) out.push((await kino.ai.ask({ prompt: 'p' + i })).ok); await kino.storage.set('r', JSON.stringify(out)); }\nexport async function screen() { return { type: 'column', children: [] }; }\nexport async function screenEvent() { return {}; }");
    const m = manifest({ capabilities: ["screen", "ai", "schedule"], jobs: [{ id: "sort", label: { es: "Ordenar" }, everyMin: 60, everyOptions: [60] }] });
    const { kino } = createKino(m, { env: {}, ai: async () => "ok", callFunction: "job" });
    const budget = jobBudget({ maxFetches: 5 });
    const wrapped = jobKino(kino, budget);
    const { plugin } = await loadPlugin(join(dir, "plugin.js"), wrapped);
    let t = 0;
    const api = kitAiApi(m, { env: {}, now: () => (t += 7_000), origin: () => ({ fn: "job", job: true }), model: async () => "ok" });
    assert.equal((await api.ask({ prompt: "x" })).ok, true);
    const r = await runJob(plugin, jobContext("sort"), budget);
    // The 6th ask crosses this run's request cap (5 here): the run is cut (cap_fetches), as a fetch past the cap does.
    assert.equal(r.failure, "cap_fetches");
    assert.equal(budget.fetches, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refused ask never spends a job run's request (one in flight, the minute full)", async () => {
  let release;
  let taken = 0;
  const api = kitAiApi(manifest(), { env: {}, origin: () => ({ fn: "action" }), model: () => new Promise((r) => { release = r; }) });
  const first = api.ask({ prompt: "x" });
  await new Promise((r) => setImmediate(r));
  const jobApi = { ask: (o) => api.ask(o) };
  const jobOrigin = kitAiApi(manifest(), { env: {}, origin: () => ({ fn: "job", job: true, takeRequest: () => { taken++; return true; } }), model: async () => "ok" });
  // The job's own api: its window fills, then the next ask is refused without taking a request.
  for (let i = 0; i < A.limits.perMinute; i++) assert.equal((await jobOrigin.ask({ prompt: "x" })).ok, true);
  assert.equal(taken, A.limits.perMinute);
  assert.equal((await jobOrigin.ask({ prompt: "x" })).error, "rate_limited");
  assert.equal(taken, A.limits.perMinute);
  release("done");
  assert.equal((await first).text, "done");
  assert.ok(jobApi);
});

test("device-wide caps: 300 a day and 2 at once over every plugin together", async () => {
  let t = Date.UTC(2026, 9, 27, 0, 0, 1);
  const device = kitAiDevice();
  const apis = Array.from({ length: 4 }, (_, i) => kitAiApi(manifest({ id: `p${i}` }), { env: {}, now: () => t, device, origin: () => ({ fn: "action" }), model: async () => "ok" }));
  let ok = 0;
  for (let round = 0; ok < A.limits.devicePerDay; round++) {
    for (const api of apis) if (ok < A.limits.devicePerDay && (await api.ask({ prompt: "x" })).ok) ok++;
    t += 6_000;
  }
  const over = await apis[3].ask({ prompt: "x" });
  assert.equal(over.error, "rate_limited");
  assert.match(over.message, /this device's plugins/);
  // Two at once over the device; a third plugin waits its turn.
  const busy = kitAiDevice();
  const releases = [];
  const slow = (id) => kitAiApi(manifest({ id }), { env: {}, device: busy, origin: () => ({ fn: "action" }), model: () => new Promise((r) => releases.push(r)) });
  const a = slow("a").ask({ prompt: "x" });
  const b = slow("b").ask({ prompt: "x" });
  await new Promise((r) => setImmediate(r));
  assert.equal((await slow("c").ask({ prompt: "x" })).error, "rate_limited");
  releases.forEach((r) => r("done"));
  assert.equal((await a).ok && (await b).ok, true);
  const fast = kitAiApi(manifest({ id: "c" }), { env: {}, device: busy, origin: () => ({ fn: "action" }), model: async () => "ok" });
  assert.equal((await fast.ask({ prompt: "x" })).ok, true);
});

test("the signing lane answers its refusal as data", async () => {
  const { kino } = createKino(manifest(), { env: {} });
  const lane = signingLane(kino);
  assert.deepEqual(plain(await lane.ai.ask({ prompt: "x" })), { ok: false, error: "refused", message: "sign() can't use kino.ai: whatever you need must come in signContext" });
});
