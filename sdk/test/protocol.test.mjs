// The plugin protocol (apiVersion 20, contract.json "protocol"): the type language, the manifest blocks, kino.plugins.call
// answered from a provider folder, and `run.mjs --provider`. Mirrors the app's ProtocolSchema / ProtocolManifest / PluginProtocolBroker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { loadPlugin } from "../sandbox.mjs";
import { jobBudget, jobKino } from "../job.mjs";
import { createProtocolCaller, parseConsumes, parseProvides, parseType, protocolBlocks, validateInput, validateOutput } from "../protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "fixtures", "protocol");
const providerDir = join(fixtures, "provider");
const consumerDir = join(fixtures, "consumer");
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
const run = join(here, "..", "run.mjs");

/** A consumer's kino, answered by the fixture provider (or by [overrides] of its exports). */
async function consumerKino({ provider = {}, consumes, apiVersion = 20, now } = {}) {
  const pm = manifestOf(providerDir);
  const loaded = (await loadPlugin(join(providerDir, "plugin.js"), {})).plugin;
  const plugin = new Proxy(loaded, { get: (t, k) => (k in provider ? provider[k] : t[k]) });
  const cm = manifestOf(consumerDir);
  if (consumes) cm.consumes = consumes;
  cm.apiVersion = apiVersion;
  const blocks = protocolBlocks(cm);
  const protocol = createProtocolCaller({ consumes: blocks.consumes, providers: [{ doors: protocolBlocks(pm).provides, plugin }], now });
  const checked = validateManifest(JSON.stringify(cm));
  assert.equal(checked.ok, true, JSON.stringify(checked));
  return createKino(checked.manifest, { protocol }).kino;
}

const codeOf = async (promise) => { try { await promise; } catch (e) { return e.code; } return "no error"; };

test("the contract carries the protocol: apiVersion 20 from Kino 0.9.81, the app's limits and error codes", () => {
  const P = contract.protocol;
  assert.equal(contract.maxApiVersion, 20);
  assert.equal(contract.apiVersionFromApp["20"], "0.9.81");
  assert.deepEqual([P.provides.maxDoors, P.provides.maxCallsPerDoor, P.provides.maxStreamsPerDoor, P.consumes.maxEntries], [4, 16, 8, 8]);
  assert.deepEqual([P.call.timeoutMs, P.call.maxCalls, P.call.windowMs, P.call.maxPayloadBytes], [10000, 30, 10000, 65536]);
  assert.equal(P.provides.streamEverySeconds.min, 30);
  assert.deepEqual(P.errorCodes, ["provider_missing", "not_declared", "bad_input", "bad_output", "rate_limited", "timeout", "provider_failed"]);
  assert.equal(P.streams.maxSubscriptionsPerConsumer, 4);
});

test("the type language: requests are strict, responses are loose, nothing is coerced", () => {
  const names = new Set(["Movie"]);
  const types = { Movie: { id: parseType("number", names), title: parseType("string", names), tag: parseType("string?", names) } };
  const movie = parseType("Movie", names);
  assert.deepEqual(validateInput(movie, types, { id: 1, title: "A" }), { ok: true, value: { id: 1, title: "A" } });
  assert.equal(validateInput(movie, types, { id: 1, title: "A", extra: true }).code, "bad_input");
  assert.equal(validateInput(movie, types, { id: "1", title: "A" }).code, "bad_input");
  assert.equal(validateInput(movie, types, { id: 1 }).code, "bad_input");
  assert.deepEqual(validateOutput(movie, types, { id: 1, title: "A", extra: true, tag: null }), { ok: true, value: { id: 1, title: "A" } });
  assert.equal(validateOutput(movie, types, { id: "1", title: "A" }).code, "bad_output");
  assert.equal(validateOutput(parseType("Movie[]", names), types, [{ id: 1, title: "A" }, { id: 2 }]).code, "bad_output");
  // A call with no argument to an input whose fields are all optional is the empty object.
  const allOptional = parseType({ from: "number?", to: "number?" }, names);
  assert.deepEqual(validateInput(allOptional, types, undefined), { ok: true, value: {} });
  assert.equal(validateInput(parseType({ q: "string" }, names), types, undefined).code, "bad_input");
  assert.throws(() => parseType("Nope", names), /Unknown type "Nope"/);
  assert.equal(validateOutput(parseType("string", names), types, "x".repeat(70000)).code, "bad_output");
});

test("the fixture manifests are read as the app reads them", () => {
  const provided = protocolBlocks(manifestOf(providerDir));
  assert.deepEqual(provided.problems, []);
  const door = provided.provides[0];
  assert.equal(door.name, "movies");
  assert.deepEqual(Object.keys(door.calls), ["byId", "random", "search"]);
  assert.equal(door.streams.trending.everySeconds, 60);
  const used = protocolBlocks(manifestOf(consumerDir));
  assert.deepEqual(used.consumes, [{ alias: "tmdb", repo: "kinotvapp/kino-plugin-tmdb", door: "movies", calls: ["random", "byId"], streams: ["trending"] }]);
});

test("the manifest blocks refuse what the app refuses, with its messages", () => {
  assert.throws(() => parseProvides({ a: {}, b: {}, c: {}, d: {}, e: {} }), /provides: at most 4 doors/);
  assert.throws(() => parseProvides({ "bad name": {} }), /door "bad name" must be letters and digits/);
  assert.throws(() => parseProvides({ d: { calls: { c: { in: {} } } } }), /call "c" needs an "out"/);
  assert.throws(() => parseProvides({ d: { calls: { c: { out: "Nope" } } } }), /call "c".out: Unknown type "Nope"/);
  assert.throws(() => parseProvides({ d: { types: { lower: {} } } }), /type name "lower" must start with a capital letter/);
  assert.throws(() => parseProvides({ d: { calls: { x: { out: "string" } }, streams: { x: { out: "string" } } } }), /a call and a stream share a name/);
  assert.equal(parseProvides({ d: { streams: { s: { out: "string", everySeconds: 5 } } } })[0].streams.s.everySeconds, 30);
  assert.throws(() => parseConsumes({ t: { repo: "https://github.com/a/b", door: "d" } }), /"repo" must be a plain GitHub owner\/name/);
  assert.throws(() => parseConsumes({ t: { repo: "a/b" } }), /needs a "door"/);
  assert.deepEqual(parseConsumes({ t: { repo: " Acme/Tmdb/ ", door: "d" } })[0], { alias: "t", repo: "Acme/Tmdb", door: "d", calls: [], streams: [] });
  // Below apiVersion 20 a plain top-level block is refused; the same block in enhancements["20"] is read by a Kino that knows it.
  const base = { ...manifestOf(consumerDir), apiVersion: 14 };
  assert.match(protocolBlocks(base).problems[0], /The "consumes" block needs apiVersion 20/);
  const enhanced = { ...base, consumes: undefined, enhancements: { 20: { consumes: manifestOf(consumerDir).consumes } } };
  assert.equal(protocolBlocks(enhanced).consumes[0].alias, "tmdb");
});

test("a consumer gets the validated value, without what the provider did not declare", async () => {
  const kino = await consumerKino();
  assert.equal(typeof kino.plugins.call, "function");
  const movie = await kino.plugins.call("tmdb", "random", { fromYear: 1990 });
  assert.equal(movie.title, "The Matrix");
  assert.equal("internalScore" in movie, false, "the provider's undeclared field is dropped");
  assert.deepEqual(await kino.plugins.call("tmdb", "random"), movie);
  assert.equal((await kino.plugins.call("tmdb", "byId", { id: 680 })).director, "Quentin Tarantino");
});

test("not_declared: a call the consumer does not list, an unknown alias, a call the door lacks", async () => {
  const kino = await consumerKino();
  assert.equal(await codeOf(kino.plugins.call("tmdb", "search", { q: "a" })), "not_declared");
  assert.equal(await codeOf(kino.plugins.call("nope", "random", {})), "not_declared");
  const k2 = await consumerKino({ consumes: { tmdb: { repo: "kinotvapp/kino-plugin-tmdb", door: "movies", calls: ["random", "missing"] } } });
  assert.equal(await codeOf(k2.plugins.call("tmdb", "missing", {})), "not_declared");
  const k3 = await consumerKino({ consumes: { tmdb: { repo: "kinotvapp/kino-plugin-tmdb", door: "other", calls: ["random"] } } });
  assert.equal(await codeOf(k3.plugins.call("tmdb", "random", {})), "provider_missing");
});

test("bad_input and bad_output", async () => {
  const kino = await consumerKino();
  assert.equal(await codeOf(kino.plugins.call("tmdb", "byId", { id: "603" })), "bad_input");
  assert.equal(await codeOf(kino.plugins.call("tmdb", "byId", { id: 603, extra: 1 })), "bad_input");
  assert.equal(await codeOf(kino.plugins.call("tmdb", "byId")), "bad_input");
  assert.equal(await codeOf(kino.plugins.call(7, "byId", {})), "bad_input");
  const wrong = await consumerKino({ provider: { proto_movies_byId: async () => ({ id: 1, title: 42 }) } });
  assert.equal(await codeOf(wrong.plugins.call("tmdb", "byId", { id: 1 })), "bad_output");
  const notJson = await consumerKino({ provider: { proto_movies_byId: async () => undefined } });
  assert.equal(await codeOf(notJson.plugins.call("tmdb", "byId", { id: 1 })), "bad_output");
});

test("provider_failed, rate_limited and provider_missing", async () => {
  const kino = await consumerKino();
  assert.equal(await codeOf(kino.plugins.call("tmdb", "byId", { id: 1 })), "provider_failed", "the provider threw");
  const gone = await consumerKino({ provider: { proto_movies_byId: undefined } });
  assert.equal(await codeOf(gone.plugins.call("tmdb", "byId", { id: 603 })), "provider_failed", "the export is missing");
  let t = 0;
  const limited = await consumerKino({ now: () => t });
  for (let i = 0; i < 30; i++) await limited.plugins.call("tmdb", "byId", { id: 603 });
  assert.equal(await codeOf(limited.plugins.call("tmdb", "byId", { id: 603 })), "rate_limited");
  t += 10000;
  assert.equal((await limited.plugins.call("tmdb", "byId", { id: 603 })).id, 603);
  // No provider given to the kit: the door is not there.
  const m = validateManifest(JSON.stringify(manifestOf(consumerDir))).manifest;
  assert.equal(await codeOf(createKino(m).kino.plugins.call("tmdb", "random", {})), "provider_missing");
});

test("kino.plugins exists only from apiVersion 20, and not in a background job", async () => {
  const old = { ...manifestOf(consumerDir), apiVersion: 14 };
  delete old.consumes;
  const m = validateManifest(JSON.stringify(old));
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(createKino(m.manifest).kino.plugins, undefined);
  assert.ok(contract.kinoJobs.forbiddenApis.includes("kino.plugins"));
  const kino = await consumerKino();
  const inJob = jobKino(kino, jobBudget({ maxFetches: 10 }), () => {});
  assert.equal(await codeOf(inJob.plugins.call("tmdb", "random", {})), "not_allowed");
});

test("a stream's poll: items checked against the stream's out, the cursor handed back", async () => {
  const cm = manifestOf(consumerDir);
  const caller = createProtocolCaller({
    consumes: protocolBlocks(cm).consumes,
    providers: [{ doors: protocolBlocks(manifestOf(providerDir)).provides, plugin: (await loadPlugin(join(providerDir, "plugin.js"), {})).plugin }],
  });
  const first = await caller.poll("tmdb", "trending", null);
  assert.equal(first.items.length, 2);
  assert.equal(first.cursor, 2);
  assert.equal((await caller.poll("tmdb", "trending", first.cursor)).items[0].id, 13);
  assert.equal(await codeOf(caller.poll("tmdb", "other", null)), "not_declared");
});

// ---- final review ----

test("a null reads as {} only at the top level of the input: an Opts[] holding null is bad_input", () => {
  const names = new Set(["Opts"]);
  const types = { Opts: { q: parseType("string?", names) } };
  assert.deepEqual(validateInput(parseType("Opts", names), types, null), { ok: true, value: {} });
  assert.equal(validateInput(parseType("Opts[]", names), types, [null]).code, "bad_input");
  assert.equal(validateInput(parseType({ o: { q: "string?" } }, names), types, { o: null }).code, "bad_input");
});

test("a door summary is counted in code points, like the app", () => {
  const emoji = "\u{1F3AC}";
  assert.equal(parseProvides({ d: { summary: emoji.repeat(120) } })[0].summary, emoji.repeat(120));
  assert.throws(() => parseProvides({ d: { summary: emoji.repeat(121) } }), /summary is over 120 characters/);
});

test("the rate limit is per provider door, whatever alias the consumer uses for it (as the app keys it)", async () => {
  let t = 0;
  const twoAliases = {
    a: { repo: "kinotvapp/kino-plugin-tmdb", door: "movies", calls: ["byId"] },
    b: { repo: "kinotvapp/kino-plugin-tmdb", door: "movies", calls: ["byId"] },
  };
  const kino = await consumerKino({ consumes: twoAliases, now: () => t });
  for (let i = 0; i < 15; i++) await kino.plugins.call("a", "byId", { id: 603 });
  for (let i = 0; i < 15; i++) await kino.plugins.call("b", "byId", { id: 603 });
  assert.equal(await codeOf(kino.plugins.call("a", "byId", { id: 603 })), "rate_limited");
  assert.equal(await codeOf(kino.plugins.call("b", "byId", { id: 603 })), "rate_limited");
});

test("kino.plugins.call counts the argument in UTF-8 bytes, like the app", async () => {
  const m = validateManifest(JSON.stringify(manifestOf(consumerDir))).manifest;
  // 40 002 characters, 80 002 bytes: over 64 KB.
  assert.equal(await codeOf(createKino(m).kino.plugins.call("tmdb", "random", "é".repeat(40000))), "bad_input");
  assert.equal(await codeOf(createKino(m).kino.plugins.call("tmdb", "random", "é".repeat(30000))), "provider_missing");
});

test("screenEvent protocol takes alias.stream with a real dot", async () => {
  const { protocolEventArg } = await import("../run.mjs");
  const protocol = { caller: { poll: async () => ({ items: [] }) } };
  await assert.rejects(protocolEventArg(protocol, "tmdbXtrending"), /<alias>\.<stream>/);
  assert.deepEqual(await protocolEventArg(protocol, "tmdb.trending"), { alias: "tmdb", stream: "trending", items: [] });
});

const cli = (...args) => spawnSync(process.execPath, [run, ...args], { encoding: "utf8" });
// The example consumer draws its game only once its provider is installed (its install gate).
const INSTALLED = ["--context", '{"installed":{"kinotvapp/kino-plugin-tmdb":true}}'];

test("run.mjs --provider: a consumer's screenEvent calls the provider folder", () => {
  const r = cli(...INSTALLED, "--provider", providerDir, "--raw", consumerDir, "screenEvent", "play");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).state, { movie: { title: "The Matrix", director: "Lana Wachowski" }, revealed: false, error: null });
});

test("run.mjs without --provider: the call rejects with provider_missing", () => {
  const r = cli(...INSTALLED, "--raw", consumerDir, "screenEvent", "play");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state.error, "provider_missing");
});

test("run.mjs --provider: the protocol event carries the polled items of alias.stream", () => {
  const r = cli(...INSTALLED, "--state", '{"protocol":{"tmdb":{"trending":true}}}', "--provider", providerDir, "--raw", consumerDir, "screenEvent", "protocol", "tmdb.trending");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).state.trending, ["The Matrix", "Pulp Fiction"]);
});

test("run.mjs --provider refuses a folder that is not a provider", () => {
  const r = cli("--provider", consumerDir, consumerDir, "screenEvent", "play");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--provider .* no "provides"/);
});

// providesOnly: a plugin whose only purpose is `provides` needs no host and no capability (contract.json protocol.providesOnly).
test("providesOnly: no hosts and no capabilities is valid, and the consent sheet claims nothing", async () => {
  const { consentLines } = await import("../validate.mjs");
  const only = { id: "tmdb", name: "TMDB", version: "1.0.0", apiVersion: 20, entry: "plugin.js", hosts: [], provides: manifestOf(providerDir).provides };
  const ok = validateManifest(JSON.stringify(only));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.manifest.capabilities, []);
  assert.deepEqual(ok.manifest.hosts, []);
  assert.deepEqual(consentLines(ok.manifest), []);
  assert.equal(validateManifest(JSON.stringify({ ...only, capabilities: [] })).ok, true);
});

test("providesOnly below apiVersion 20 is refused; with other capabilities the ordinary rules stay; an empty manifest is still refused", () => {
  const provides = manifestOf(providerDir).provides;
  const only = { id: "tmdb", name: "TMDB", version: "1.0.0", apiVersion: 20, entry: "plugin.js", hosts: [], provides };
  assert.equal(validateManifest(JSON.stringify({ ...only, apiVersion: 19 })).field, "capabilities");
  assert.equal(validateManifest(JSON.stringify({ ...only, capabilities: ["search", "resolve"] })).field, "hosts");
  assert.equal(validateManifest(JSON.stringify({ ...only, hosts: ["example.com"], capabilities: ["search"] })).field, "capabilities");
  const { provides: _, ...empty } = only;
  assert.equal(validateManifest(JSON.stringify(empty)).field, "capabilities");
  assert.equal(validateManifest(JSON.stringify({ ...only, provides: {} })).field, "capabilities");
  assert.equal(validateManifest(JSON.stringify({ ...empty, hosts: ["example.com"] })).field, "capabilities");
});

test("providesOnly stays refused with any setting or a capabilities field that is not an array", () => {
  const provides = manifestOf(providerDir).provides;
  const only = { id: "tmdb", name: "TMDB", version: "1.0.0", apiVersion: 20, entry: "plugin.js", hosts: [], provides };
  assert.equal(validateManifest(JSON.stringify({ ...only, settings: [{ key: "k", label: "L", type: "text" }] })).field, "capabilities");
  assert.equal(validateManifest(JSON.stringify({ ...only, settings: [] })).ok, true);
  assert.equal(validateManifest(JSON.stringify({ ...only, capabilities: "search" })).field, "capabilities");
  assert.equal(validateManifest(JSON.stringify({ ...only, capabilities: {} })).field, "capabilities");
});
