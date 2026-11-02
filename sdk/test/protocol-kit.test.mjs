// The kit's protocol tooling as an author meets it: the shipped example consumer draws with nothing dropped, run.mjs says
// how to drive the protocol, tries a provider on its own (`proto`) and polls a stream from a given cursor, and validate
// turns the common protocol mistakes into findings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "fixtures", "protocol");
const providerDir = join(fixtures, "provider");
const consumerDir = join(fixtures, "consumer");
const run = join(here, "..", "run.mjs");
const validateCli = join(here, "..", "validate.mjs");
const TMDB = "kinotvapp/kino-plugin-tmdb";
const cli = (...args) => spawnSync(process.execPath, [run, ...args], { encoding: "utf8" });
const installed = (yes) => JSON.stringify({ installed: { [TMDB]: yes } });

/** Every node of a printed tree (objects with a `type`), depth first. */
function nodesOf(tree) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== "object") return;
    if (typeof v.type === "string") out.push(v);
    Object.values(v).forEach(walk);
  };
  walk(tree);
  return out;
}

// ---------- 1. the example consumer draws with nothing dropped ----------

for (const yes of [true, false]) {
  for (const lang of ["es", "en"]) {
    test(`the example consumer's screen (installed ${yes}, ${lang}) draws with nothing dropped`, () => {
      const r = cli("--context", JSON.stringify({ installed: { [TMDB]: yes }, lang }), "--provider", providerDir, consumerDir, "screen");
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /dropped|✗/, r.stderr);
      const tree = JSON.parse(r.stdout);
      const nodes = nodesOf(tree);
      assert.ok(nodes.length >= 4, `an empty-looking tree: ${r.stdout}`);
      assert.ok(tree.appBar, "the Scaffold keeps its AppBar");
      const texts = JSON.stringify(tree);
      if (!yes) assert.match(texts, lang === "es" ? /Instalar TMDB/ : /Install TMDB/);
      else assert.match(texts, lang === "es" ? /Jugar/ : /Play/);
    });
  }
}

test("the example consumer's game view with a question, an error and the stream on draws with nothing dropped", () => {
  const state = { movie: { title: "The Matrix", director: "Lana Wachowski" }, revealed: true, error: "rate_limited", protocol: { tmdb: { trending: true } }, trending: ["The Matrix", "Pulp Fiction"] };
  for (const device of ["phone", "tv"]) {
    const r = cli("--context", JSON.stringify({ installed: { [TMDB]: true }, device }), "--state", JSON.stringify(state), consumerDir, "screen");
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /dropped|✗/, r.stderr);
    const texts = JSON.stringify(JSON.parse(r.stdout));
    for (const want of ["The Matrix", "Lana Wachowski", "Pulp Fiction"]) assert.ok(texts.includes(want), want);
  }
});

test("the example consumer: play asks the provider; the answer keeps only what the door declares", () => {
  const r = cli("--context", installed(true), "--provider", providerDir, "--raw", consumerDir, "screenEvent", "play");
  assert.equal(r.status, 0, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.deepEqual(answer.state.movie, { title: "The Matrix", director: "Lana Wachowski" });
  assert.equal(answer.state.error, null);
});

test("the example consumer: a failed call becomes the error code in its state, never a throw", () => {
  const r = cli("--context", installed(true), "--raw", consumerDir, "screenEvent", "play");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state.error, "provider_missing");
});

test("the example consumer: behind the install gate an event does nothing", () => {
  const r = cli("--context", installed(false), "--provider", providerDir, "--raw", consumerDir, "screenEvent", "play");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout), null);
});

test("the example consumer: the switch turns the stream on through state.protocol", () => {
  const r = cli("--context", installed(true), "--trigger", "change", "--raw", consumerDir, "screenEvent", "trending", "", "true");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).state.protocol, { tmdb: { trending: true } });
});

test("the example consumer: the protocol event lists the polled titles, only while the switch is on", () => {
  const on = cli("--context", installed(true), "--state", '{"protocol":{"tmdb":{"trending":true}}}', "--provider", providerDir, "--raw", consumerDir, "screenEvent", "protocol", "tmdb.trending");
  assert.equal(on.status, 0, on.stderr);
  assert.deepEqual(JSON.parse(on.stdout).state.trending, ["The Matrix", "Pulp Fiction"]);
  const off = cli("--context", installed(true), "--provider", providerDir, "--raw", consumerDir, "screenEvent", "protocol", "tmdb.trending");
  assert.equal(JSON.parse(off.stdout), null);
});

// ---------- 2 / 6. run.mjs: usage, proto, --cursor, --lang ----------

test("run.mjs's usage names --provider, --context installed, screenEvent protocol, proto, --cursor and --lang", () => {
  const r = cli();
  assert.equal(r.status, 2);
  for (const want of ["--provider <folder>", '--context \'{"installed":{"owner/name":true}}\'', "screenEvent protocol <alias>.<stream>", "proto <door>.<call>", "proto <door>.<stream>", "--cursor", "--lang"]) {
    assert.ok(r.stderr.includes(want), `usage lacks ${want}:\n${r.stderr}`);
  }
});

test("proto: a provider's call on its own, its argument and answer checked as the app does", () => {
  const ok = cli(providerDir, "proto", "movies.random", '{"fromYear":1990}');
  assert.equal(ok.status, 0, ok.stderr);
  const movie = JSON.parse(ok.stdout);
  assert.equal(movie.title, "The Matrix");
  assert.equal("internalScore" in movie, false, "an undeclared field is dropped");
  const none = cli(providerDir, "proto", "movies.random");
  assert.equal(none.status, 0, none.stderr);
  const bad = cli(providerDir, "proto", "movies.byId", '{"id":"603"}');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bad_input/);
  const failed = cli(providerDir, "proto", "movies.byId", '{"id":1}');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /provider_failed/);
  assert.match(failed.stderr, /no such movie/, "the provider's own error is shown to its author");
});

test("proto: a stream from null and from a given cursor; the next cursor is said", () => {
  const first = cli(providerDir, "proto", "movies.trending");
  assert.equal(first.status, 0, first.stderr);
  const a = JSON.parse(first.stdout);
  assert.deepEqual(a.items.map((m) => m.title), ["The Matrix", "Pulp Fiction"]);
  assert.equal(a.cursor, 2);
  const next = cli(providerDir, "proto", "movies.trending", "2");
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout).items.map((m) => m.title), ["Forrest Gump", "Fight Club"]);
  assert.match(first.stderr, /proto movies\.trending '2'/);
});

test("proto: an unknown door or call, bad JSON, or a folder that provides nothing is the command's fault", () => {
  const door = cli(providerDir, "proto", "films.random");
  assert.equal(door.status, 2);
  assert.match(door.stderr, /movies/);
  const call = cli(providerDir, "proto", "movies.nope");
  assert.equal(call.status, 2);
  assert.match(call.stderr, /byId, random, search, trending/);
  assert.equal(cli(providerDir, "proto", "movies.random", "{nope").status, 2);
  assert.equal(cli(providerDir, "proto", "moviesrandom").status, 2);
  const notProvider = cli(consumerDir, "proto", "movies.random");
  assert.equal(notProvider.status, 2);
  assert.match(notProvider.stderr, /no "provides"/);
});

test("screenEvent protocol --cursor polls from that cursor (repeated items can be tried)", () => {
  const r = cli("--context", installed(true), "--state", '{"protocol":{"tmdb":{"trending":true}}}', "--provider", providerDir, "--cursor", "2", "--raw", consumerDir, "screenEvent", "protocol", "tmdb.trending");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).state.trending, ["Forrest Gump", "Fight Club"]);
  assert.match(r.stderr, /cursor/);
  assert.equal(cli("--cursor", "{bad", consumerDir, "screen").status, 2);
  const elsewhere = cli("--cursor", "2", "--context", installed(true), consumerDir, "screen");
  assert.equal(elsewhere.status, 2, "--cursor only goes with screenEvent protocol");
});

test("--lang en draws the English texts (the same as --context '{\"lang\":\"en\"}')", () => {
  const en = cli("--lang", "en", "--context", installed(false), consumerDir, "screen");
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /Install TMDB/);
  assert.doesNotMatch(en.stdout, /Instalar TMDB/);
  assert.equal(cli("--lang", "fr", consumerDir, "screen").status, 2);
});

// ---------- 3 / 4. validate's protocol findings ----------

/** A copy of a fixture folder in a temp dir, its manifest changed by [edit] and its plugin.js by [editJs]. */
function variant(from, edit = (m) => m, editJs = (s) => s) {
  const dir = mkdtempSync(join(tmpdir(), "kino-protocol-kit-"));
  cpSync(from, dir, { recursive: true });
  const mf = join(dir, "kino-plugin.json");
  writeFileSync(mf, JSON.stringify(edit(JSON.parse(readFileSync(mf, "utf8"))), null, 2));
  const js = join(dir, "plugin.js");
  writeFileSync(js, editJs(readFileSync(js, "utf8")));
  return dir;
}

test("validate: the example provider and consumer pass with no protocol warning", async () => {
  for (const dir of [providerDir, consumerDir]) {
    const r = await validate(dir);
    assert.deepEqual(r.problems, [], dir);
    assert.deepEqual(r.warnings.filter((w) => /provides|consumes|recommends|everySeconds|providesOnly/.test(w)), [], dir);
  }
});

test("validate: a declared call or stream without its proto_ export fails (exit 1), naming the export", async () => {
  const dir = variant(providerDir, undefined, (s) => s.replace("proto_movies_byId", "proto_movies_byid").replace("export async function proto_movies_trending", "async function proto_movies_trending"));
  try {
    const r = await validate(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("proto_movies_byId") && /provider_failed/.test(p)), JSON.stringify(r.problems));
    assert.ok(r.problems.some((p) => p.includes("proto_movies_trending")), JSON.stringify(r.problems));
    const c = spawnSync(process.execPath, [validateCli, dir], { encoding: "utf8" });
    assert.equal(c.status, 1, c.stderr);
    assert.doesNotMatch(c.stderr, /Kino would accept/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: a consumer whose provider is not in recommends gets a loud warning, and still validates", async () => {
  const dir = variant(consumerDir, ({ recommends, ...m }) => m);
  try {
    const r = await validate(dir);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.ok(r.warnings.some((w) => w.includes(TMDB) && /recommends/.test(w) && /installed/.test(w)), JSON.stringify(r.warnings));
    const c = spawnSync(process.execPath, [validateCli, dir], { encoding: "utf8" });
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stderr, /^! .*recommends/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: everySeconds outside Kino's range warns that Kino changes it", async () => {
  const dir = variant(providerDir, (m) => { m.provides.movies.streams.trending.everySeconds = 5; return m; });
  try {
    const r = await validate(dir);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.ok(r.warnings.some((w) => /trending/.test(w) && /everySeconds 5/.test(w) && /30/.test(w)), JSON.stringify(r.warnings));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const big = variant(providerDir, (m) => { m.provides.movies.streams.trending.everySeconds = 999999; return m; });
  try {
    const r = await validate(big);
    assert.ok(r.warnings.some((w) => /everySeconds 999999/.test(w) && /86400/.test(w)), JSON.stringify(r.warnings));
  } finally { rmSync(big, { recursive: true, force: true }); }
});

test("validate: a literal \"providesOnly\" field is not a manifest field: a warning says the rule is derived", async () => {
  const dir = variant(providerDir, (m) => ({ ...m, providesOnly: true }));
  try {
    const r = await validate(dir);
    assert.ok(r.warnings.some((w) => /"providesOnly"/.test(w) && /ignores/.test(w) && /apiVersion 20/.test(w)), JSON.stringify(r.warnings));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the kit never tells an author to write \"providesOnly\": true", () => {
  const sdk = join(here, "..");
  for (const f of ["validate.mjs", "run.mjs", "init.mjs", "protocol.mjs", "contract.mjs"]) {
    assert.doesNotMatch(readFileSync(join(sdk, f), "utf8"), /"providesOnly"\s*:\s*true/, f);
  }
});
