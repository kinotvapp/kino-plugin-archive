// node --test plugins/sdk/test/kino-services.test.mjs   (Node 18+)
// kino.meta and kino.tmdb (Kino 0.9.53, no new apiVersion): the kit's stand-ins check what the app checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract } from "../contract.mjs";
import { createKino, errorReport, kinoMetaRequest, kinoTmdbRequest, normaliseMetaTitle, pickMetaTitle, signingLane, tokenBucket } from "../kino-shim.mjs";
import { unguardedBrowserNotes, unguardedServiceNotes } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "..", "docs", "plugins", "fixtures", "kino-services");
const MANIFEST = { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search", "resolve"] };
const V3 = "0123456789abcdef0123456789abcdef";
const NO_ENV = {};

/** A clock a test moves by hand. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** A fetch that answers [status] with [body] and records every URL and header set it was asked with. */
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    return { status, arrayBuffer: async () => bytes };
  };
  return { impl, calls };
}

const kinoWith = (opts = {}) => createKino(MANIFEST, { env: NO_ENV, tmdbKey: null, ...opts }).kino;

async function code(promise) {
  try {
    await promise;
  } catch (e) {
    return e.code;
  }
  return "no error";
}

test("contract: kino.meta and kino.tmdb are additive (no new apiVersion) and pinned", () => {
  // apiVersion 9 (Kino 0.9.55) brought kino.meta by title among others; kino.meta and kino.tmdb themselves add none.
  assert.equal(contract.apiVersion, 14);
  assert.deepEqual(contract.apiVersionFromApp, { "6": "0.9.50", "7": "0.9.51", "8": "0.9.54", "9": "0.9.55", "10": "0.9.65", "11": "0.9.66", "12": "0.9.74", "13": "0.9.74", "14": "0.9.74" });
  assert.deepEqual(contract.additiveFromApp, { "kino.meta": "0.9.53", "kino.tmdb": "0.9.53", catalogOnly: "0.9.54", "kino.browser.captureAll": "0.9.54", "fetch.errorHost": "0.9.55", "kino.fetchAnyHost": "0.9.55", "kino.meta.byTitle": "0.9.55", "kino.device": "0.9.55", "kino.seed": "0.9.55", "panel.loading": "0.9.64", "kino.nuvio": "0.9.71", "kino.sync.remoteChanged": "0.9.74", "action.link": "0.9.74", "action.setSettings": "0.9.74" });
  assert.deepEqual(contract.kinoMeta.idKeys, ["imdb", "tmdb", "tvdb", "kitsu", "mal", "anilist"]);
  assert.equal(contract.kinoMeta.perMinute, 30);
  assert.equal(contract.kinoTmdb.perWindow, 40);
  assert.equal(contract.kinoTmdb.kinoKeyPerWindow, 20);
  assert.equal(contract.kinoTmdb.kinoKeyGlobalPerWindow, 60);
  assert.deepEqual(contract.kinoTmdb.keyOrder, ["kino", "setting", "stremioAddon"]);
  assert.deepEqual(contract.kinoTmdb.personKeyOn, [401, 403, 429, "kinoKeyLimit"]);
  assert.equal(contract.kinoTmdb.windowMs, 10000);
  assert.ok(contract.kinoTmdb.errorCodes.includes("no_tmdb_key"));
  assert.equal(contract.kinoTmdb.noKeyUserMessage.es, "Agrega tu llave de TMDB en Ajustes de todos los perfiles ▸ Llaves");
  assert.equal(contract.kinoTmdb.noKeyUserMessage.en, "Add your TMDB key in Settings for all profiles ▸ Keys");
});

test("kino.meta: the query is checked like the app does", () => {
  const bad = (q) => assert.throws(() => kinoMetaRequest(q), (e) => e.code === "invalid_request");
  bad(null);
  bad("tt0133093");
  bad({ type: "show", ids: { imdb: "tt0133093" } });
  bad({ type: "movie" });
  bad({ type: "movie", ids: {} });
  bad({ type: "movie", ids: { imdb: "0133093" } });
  bad({ type: "movie", ids: { tmdb: 0 } });
  bad({ type: "movie", ids: { tmdb: -3 } });
  bad({ type: "movie", ids: { tmdb: 1.5 } });
  bad({ type: "movie", ids: { tmdb: 2147483648 } });
  bad({ type: "movie", ids: { tmdb: "60a" } });
  bad({ type: "movie", ids: { imdb: "tt0133093" }, lang: "español" });
  bad({ type: "movie", ids: { imdb: "tt0133093" }, extra: "x".repeat(contract.kinoMeta.maxRequestChars) });
  assert.deepEqual(kinoMetaRequest({ type: "series", ids: { tmdb: "1399", tvdb: 121361 }, lang: "es-MX" }), { type: "series", ids: { tmdb: 1399, tvdb: 121361 }, lang: "es-MX" });
  // Unknown id keys are ignored, never an error; null/undefined ids are "not known".
  assert.deepEqual(kinoMetaRequest({ type: "movie", ids: { imdb: "tt0133093", trakt: 4, mal: null } }), { type: "movie", ids: { imdb: "tt0133093" } });
});

// These tests read files of the Kino repo itself (docs/plugins/, plugins/archive-org, its .gitignore). A template does
// not carry them, so they are skipped here and run in the Kino repo.
const NEEDS_KINO_REPO = "needs files of the Kino repo that this template does not have";

test("kino.meta: null by default, a fixture's answer when one is given", { skip: NEEDS_KINO_REPO }, async () => {
  assert.equal(await kinoWith().meta({ type: "movie", ids: { imdb: "tt0133093" } }), null);
  const kino = kinoWith({ metaFixture: join(fixtures, "meta.json") });
  assert.equal((await kino.meta({ type: "movie", ids: { imdb: "tt0133093" } })).ids.tmdb, 603);
  assert.equal((await kino.meta({ type: "series", ids: { tmdb: 1399 } })).episodes[0].id, "tt0944947:1:1");
  assert.equal((await kino.meta({ type: "series", ids: { kitsu: "1376" } })).title, "Death Note");
  assert.equal(await kino.meta({ type: "movie", ids: { tmdb: 1 } }), null);
  // An invalid query still rejects (a promise, never a synchronous throw).
  assert.equal(await code(kino.meta({ type: "movie", ids: {} })), "invalid_request");
});

test("kino.meta: 30 calls a minute per plugin, then rate_limited until the bucket refills", async () => {
  const clock = fakeClock();
  const kino = kinoWith({ now: clock.now });
  const q = { type: "movie", ids: { imdb: "tt0133093" } };
  for (let i = 0; i < contract.kinoMeta.perMinute; i++) assert.equal(await kino.meta(q), null);
  assert.equal(await code(kino.meta(q)), "rate_limited");
  clock.advance(60_000 / contract.kinoMeta.perMinute);
  assert.equal(await kino.meta(q), null);
  assert.equal(await code(kino.meta(q)), "rate_limited");
});

test("kino.tmdb: only the allowlisted read paths, never the version or a query string", () => {
  const ok = (p) => assert.equal(kinoTmdbRequest(p).path, p);
  ok("/trending/movie/week");
  ok("/movie/603");
  ok("/tv/1399/season/1");
  ok("/discover/movie");
  ok("/configuration");
  for (const p of ["/account", "/account/1/favorite", "/3/movie/603", "/movie/../account", "/movie//603", "/movie/603?api_key=x", "movie/603", "/movies/603", "/authentication/token/new", "", 5]) {
    assert.throws(() => kinoTmdbRequest(p), (e) => e.code === "invalid_request", String(p));
  }
});

test("kino.tmdb: params are plain, bounded, sorted, and never carry a key", () => {
  assert.equal(kinoTmdbRequest("/discover/movie", { with_genres: 28, "vote_count.gte": 100, language: "es-MX", include_adult: false }).query,
    "include_adult=false&language=es-MX&vote_count.gte=100&with_genres=28");
  const bad = (params) => assert.throws(() => kinoTmdbRequest("/discover/movie", params), (e) => e.code === "invalid_request");
  bad({ api_key: "x" });
  bad({ API_KEY: "x" });
  bad({ session_id: "x" });
  bad({ "with genres": 1 });
  bad({ q: { nested: 1 } });
  bad({ q: Infinity });
  bad({ q: "x".repeat(contract.kinoTmdb.maxParamValueChars + 1) });
  bad(Object.fromEntries(Array.from({ length: contract.kinoTmdb.maxParams + 1 }, (_, i) => ["p" + i, i])));
  bad(["language", "es"]);
});

test("kino.tmdb: no key at all (neither Kino's nor the person's) is no_tmdb_key with Kino's sentence in the person's language", async () => {
  for (const [lang, words] of [["es-CO", contract.kinoTmdb.noKeyUserMessage.es], ["en-US", contract.kinoTmdb.noKeyUserMessage.en]]) {
    const { impl, calls } = fakeFetch(200, {});
    const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: null, lang, fetchImpl: impl }).kino;
    await assert.rejects(kino.tmdb("/movie/603"), (e) => e.code === "no_tmdb_key" && e.userMessage === words);
    assert.equal(calls.length, 0, "nothing goes out without a key");
  }
});

test("kino.tmdb: the key from KINO_TMDB_KEY goes as api_key (v3) or a Bearer header (v4), never in an answer or error", async () => {
  const v3 = fakeFetch(200, { id: 603 });
  const kino = createKino(MANIFEST, { env: { KINO_TMDB_KEY: V3 }, fetchImpl: v3.impl }).kino;
  assert.deepEqual(await kino.tmdb("/movie/603", { language: "es-MX" }), { id: 603 });
  assert.equal(v3.calls[0].url, `${contract.kinoTmdb.base}/movie/603?language=es-MX&api_key=${V3}`);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl";
  const v4 = fakeFetch(200, { id: 1 });
  await createKino(MANIFEST, { env: NO_ENV, tmdbKey: jwt, fetchImpl: v4.impl }).kino.tmdb("/genre/movie/list");
  assert.equal(v4.calls[0].url, `${contract.kinoTmdb.base}/genre/movie/list`);
  assert.equal(v4.calls[0].headers.Authorization, "Bearer " + jwt);
  // A network failure that quotes the URL never hands the key back.
  const leaky = async (url) => { throw new Error("connect failed for " + url); };
  await assert.rejects(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: leaky }).kino.tmdb("/movie/603"),
    (e) => e.code === "network" && !e.message.includes(V3));
});

test("kino.tmdb: TMDB's answers mapped to Kino's codes", async () => {
  const cases = [[401, {}, "unavailable"], [403, {}, "unavailable"], [404, {}, "not_found"], [429, {}, "rate_limited"], [500, {}, "unavailable"], [200, "<html>", "unavailable"],
    [200, Buffer.alloc(contract.kinoTmdb.maxBodyBytes + 1, 32), "too_large"]];
  for (const [status, body, expected] of cases) {
    const { impl } = fakeFetch(status, body);
    assert.equal(await code(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl }).kino.tmdb("/movie/603")), expected, `${status}`);
  }
  // A refused key is the developer's to fix: the message names KINO_TMDB_KEY and never carries the key.
  const { impl } = fakeFetch(401, {});
  await assert.rejects(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl }).kino.tmdb("/movie/603"),
    (e) => e.message.includes("KINO_TMDB_KEY") && !e.message.includes(V3));
});

test("kino.tmdb: on the kit's key (Kino's stand-in) 20 calls per 10 s reach TMDB, then rate_limited; cached answers are free", async () => {
  const clock = fakeClock();
  const { impl, calls } = fakeFetch(200, { results: [] });
  const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl, now: clock.now }).kino;
  for (let i = 0; i < contract.kinoTmdb.kinoKeyPerWindow; i++) await kino.tmdb("/movie/" + (i + 1));
  assert.equal(await code(kino.tmdb("/movie/999")), "rate_limited");
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow);
  await kino.tmdb("/movie/1"); // in the cache: no call, no limit
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow);
  clock.advance(contract.kinoTmdb.windowMs);
  await kino.tmdb("/movie/999");
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow + 1);
});

test("kino.tmdb: an answer is cached 10 minutes by path and params", async () => {
  const clock = fakeClock();
  const { impl, calls } = fakeFetch(200, { results: [] });
  const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl, now: clock.now }).kino;
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  assert.equal(calls.length, 1);
  await kino.tmdb("/trending/movie/week", { language: "en-US" });
  assert.equal(calls.length, 2, "another language is another entry");
  clock.advance(contract.kinoTmdb.cacheTtlMs);
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  assert.equal(calls.length, 3);
});

test("kino.tmdb: 40 calls per 10 s per plugin, then rate_limited", { skip: NEEDS_KINO_REPO }, async () => {
  const clock = fakeClock();
  const kino = kinoWith({ tmdbFixture: join(fixtures, "tmdb.json"), now: clock.now });
  for (let i = 0; i < contract.kinoTmdb.perWindow; i++) await kino.tmdb("/movie/603");
  assert.equal(await code(kino.tmdb("/movie/603")), "rate_limited");
  clock.advance(contract.kinoTmdb.windowMs);
  await kino.tmdb("/movie/603");
});

test("kino.tmdb: a fixture answers offline, by path and sorted params or by path", { skip: NEEDS_KINO_REPO }, async () => {
  const kino = kinoWith({ tmdbFixture: join(fixtures, "tmdb.json") });
  assert.equal((await kino.tmdb("/trending/movie/week", { language: "es-MX" })).results[0].id, 603);
  assert.equal((await kino.tmdb("/movie/603", { language: "es-MX" })).imdb_id, "tt0133093");
  assert.equal(await code(kino.tmdb("/tv/1399")), "not_found");
});

test("tokenBucket refills evenly", () => {
  const clock = fakeClock();
  const b = tokenBucket(2, 1000, clock.now);
  assert.ok(b.take() && b.take());
  assert.equal(b.take(), false);
  clock.advance(500);
  assert.ok(b.take());
  assert.equal(b.take(), false);
});

test("sign() can use neither kino.meta nor kino.tmdb", async () => {
  const lane = signingLane(kinoWith({ tmdbKey: V3 }));
  assert.equal(await code(lane.meta({ type: "movie", ids: { imdb: "tt0133093" } })), "not_allowed");
  assert.equal(await code(lane.tmdb("/movie/603")), "not_allowed");
});

test("validate warns about kino.meta / kino.tmdb used without feature detection", () => {
  assert.equal(unguardedServiceNotes('const r = await kino.tmdb("/movie/603");').length, 1);
  assert.equal(unguardedServiceNotes('if (typeof kino.tmdb === "function") await kino.tmdb("/movie/603");').length, 0);
  assert.equal(unguardedServiceNotes("kino.meta(q); kino.tmdb(p)").length, 2);
  assert.equal(unguardedServiceNotes("kino.fetch(u)").length, 0);
});

test("run.mjs reports an uncaught no_tmdb_key as the sentence Kino shows", async () => {
  const e = await kinoWith().tmdb("/movie/603").catch((x) => x);
  assert.match(errorReport(e, "Demo"), new RegExp(`the person reads: "${contract.kinoTmdb.noKeyUserMessage.es.replace(/[.()]/g, "\\$&")}"`));
});

test("kino.browser.capture: captureAll, alsoMatch, waitForCookie and returnCookiesOnTimeout (Kino 0.9.54) are checked like the app does", async () => {
  const C = contract.browser.captureAll;
  assert.equal(C.feature, "kino.browser.captureAll");
  assert.equal(contract.additiveFromApp[C.feature], "0.9.54");
  assert.equal(C.maxAlsoMatch, 10);
  assert.equal(C.maxRequests, 20);
  assert.equal(C.settleMs, 1000);
  assert.deepEqual(C.answerAdds, ["requests", "cookies", "userAgent", "timedOut"]);
  const k = kinoWith();
  assert.equal(k.browser.captureAll, true);
  const url = "https://example.com/e/1";
  const bad = [
    { alsoMatch: ["key"] },
    { captureAll: true, alsoMatch: [] },
    { captureAll: true, alsoMatch: Array.from({ length: 11 }, (_, i) => "p" + i) },
    { captureAll: true, alsoMatch: ["x".repeat(501)] },
    { captureAll: "yes" },
    { returnCookiesOnTimeout: 1 },
    { waitForCookie: "a b" },
    { waitForCookie: "" },
    { waitForCookie: "cf_clearance", captureAll: true },
  ];
  for (const opts of bad) assert.equal(await code(k.browser.capture(url, opts)), "invalid_request", JSON.stringify(opts));
  // A well-formed request reaches the browser, which the Node kit does not have.
  assert.equal(await code(k.browser.capture(url, { match: "m3u8", captureAll: true, alsoMatch: ["key", /sub/], waitForCookie: "cf_clearance", returnCookiesOnTimeout: true })), "browser_unavailable");
  assert.equal(await code(k.browser.capture(url)), "browser_unavailable");
  // Java regex syntax the app compiles (IGNORE_CASE, inline flags) is never refused by the kit.
  assert.equal(await code(k.browser.capture(url, { match: "(?-i)Master" })), "browser_unavailable");
  assert.equal(await code(k.browser.capture(url, { match: "master", captureAll: true, alsoMatch: ["(?-i)SUB"] })), "browser_unavailable");
  // An old call (pre-0.9.54 options only) with a Java-only pattern answers exactly as before: no browser.
  assert.equal(await code(k.browser.capture(url, { match: "(?i)x" })), "browser_unavailable");
  // The app's messages.
  const msg = async (p) => { try { await p; } catch (e) { return e.message; } return null; };
  assert.equal(await msg(k.browser.capture(url, { match: "x".repeat(501) })), "match must be 1 to 500 characters");
  assert.equal(await msg(k.browser.capture(url, { captureAll: true, alsoMatch: [""] })), "each alsoMatch must be 1 to 500 characters");
  assert.equal(await msg(k.browser.capture(url, { alsoMatch: ["k"] })), "alsoMatch only works with captureAll");
});

test("validate: the new capture options without checking kino.browser.captureAll get a note", () => {
  assert.deepEqual(unguardedBrowserNotes("await kino.browser.capture(u, { match: 'm3u8' })"), []);
  assert.equal(unguardedBrowserNotes("await kino.browser.capture(u, { captureAll: true, alsoMatch: ['key'] })").length, 1);
  assert.equal(unguardedBrowserNotes("await kino.browser.capture(u, { waitForCookie: 'cf_clearance' })").length, 1);
  assert.deepEqual(unguardedBrowserNotes("if (kino.browser.captureAll) await kino.browser.capture(u, { returnCookiesOnTimeout: true })"), []);
  assert.match(unguardedBrowserNotes("kino.browser.capture(u, { captureAll: true })")[0], /0\.9\.54/);
});

// Kino 0.9.55: kino.meta({ type, title, year? }) (contract.kinoMeta.byTitle), the vectors of the app's KinoMetaTest.
test("kino.meta by title: the query is checked like the app does", () => {
  const bad = (q) => assert.throws(() => kinoMetaRequest(q), (e) => e.code === "invalid_request");
  assert.deepEqual(kinoMetaRequest({ type: "movie", title: "  Matrix ", year: 1999 }), { type: "movie", title: "Matrix", year: 1999 });
  assert.deepEqual(kinoMetaRequest({ type: "movie", title: "Matrix", year: "1999", lang: "es" }), { type: "movie", title: "Matrix", year: 1999, lang: "es" });
  assert.deepEqual(kinoMetaRequest({ type: "series", title: "Dark", ids: {} }), { type: "series", title: "Dark" });
  assert.deepEqual(kinoMetaRequest({ type: "movie", title: "Matrix", ids: { tmdb: 603 } }), { type: "movie", ids: { tmdb: 603 } });
  bad({ type: "movie", title: "" });
  bad({ type: "movie", title: "   " });
  bad({ type: "movie", title: 7 });
  bad({ type: "movie", title: "a".repeat(contract.kinoMeta.byTitle.titleMaxChars + 1) });
  for (const year of [1869, 2101, 1999.5, "99"]) bad({ type: "movie", title: "Matrix", year });
  bad({ type: "movie", ids: { tmdb: 603 }, year: 1999 });
  bad({ type: "tv", title: "Matrix" });
  bad({ type: "movie", ids: "x", title: "Matrix" });
});

test("kino.meta by title: Kino's pick - exact, year, ambiguous, kind", () => {
  const hit = (id, title, year, type = "movie", originalTitle = title) => ({ id, type, title, originalTitle, year });
  assert.equal(normaliseMetaTitle("¡Amélie!"), "amelie");
  const amelie = [hit(194, "Amélie", "2001", "movie", "Le Fabuleux Destin d'Amélie Poulain"), hit(5, "Amelia", "2009")];
  assert.equal(pickMetaTitle(amelie, "movie", "amelie"), 194);
  assert.equal(pickMetaTitle(amelie, "movie", "Le fabuleux destin d’Amélie Poulain!"), 194);
  assert.equal(pickMetaTitle(amelie, "movie", "Amél"), null);
  const dune = [hit(10, "Dune", "1984"), hit(438631, "Dune", "2021"), hit(11, "Dune", "2000")];
  assert.equal(pickMetaTitle(dune, "movie", "Dune"), null);
  assert.equal(pickMetaTitle(dune, "movie", "Dune", 2021), 438631);
  assert.equal(pickMetaTitle(dune, "movie", "Dune", 2022), 438631);
  assert.equal(pickMetaTitle(dune, "movie", "Dune", 1985), 10);
  assert.equal(pickMetaTitle(dune, "movie", "Dune", 2010), null);
  assert.equal(pickMetaTitle([hit(1, "Eco", "2000"), hit(2, "Eco", "2002")], "movie", "Eco", 2001), null);
  assert.equal(pickMetaTitle([hit(1, "Eco", "2000"), hit(2, "Eco", "2001")], "movie", "Eco", 2001), 2);
  const office = [hit(1, "The Office", "2005", "tv"), hit(2, "The Office", "2005", "tv")];
  assert.equal(pickMetaTitle(office, "tv", "The Office", 2005), null);
  assert.equal(pickMetaTitle([office[0], office[0]], "tv", "The Office"), 1);
  const fargo = [hit(1, "Fargo", "1996", "movie"), hit(60622, "Fargo", "2014", "tv")];
  assert.equal(pickMetaTitle(fargo, "tv", "Fargo"), 60622);
  assert.equal(pickMetaTitle(fargo, "tv", "Fargo", 1996), null);
});

test("kino.meta by title: the feature flag, and the fixture keyed by normalised title and year", async () => {
  const v9 = (opts = {}) => createKino({ ...MANIFEST, apiVersion: 9 }, { env: NO_ENV, tmdbKey: null, ...opts }).kino;
  assert.equal(v9().meta.byTitle, true);
  assert.equal(await v9().meta({ type: "movie", title: "Matrix" }), null);
  // Below apiVersion 9 there is no flag and a title is an unknown key: the query needs ids, as on an older Kino.
  const v8 = createKino({ ...MANIFEST, apiVersion: 8 }, { env: NO_ENV, tmdbKey: null }).kino;
  assert.equal(v8.meta.byTitle, undefined);
  assert.equal(await code(v8.meta({ type: "movie", title: "Matrix", year: 1999 })), "invalid_request");
  assert.throws(() => kinoMetaRequest({ type: "movie", title: "Matrix" }, 8), (e) => e.code === "invalid_request");
  const answer = { title: "Matrix", ids: { tmdb: 603 }, sources: ["tmdb"] };
  const kino = v9({ metaFixture: { "movie:title:the matrix:1999": answer, "series:title:dark": { title: "Dark", ids: { tmdb: 70523 }, sources: ["tmdb"] } } });
  assert.equal((await kino.meta({ type: "movie", title: "The Matrix!", year: 1999 })).ids.tmdb, 603);
  assert.equal(await kino.meta({ type: "movie", title: "The Matrix", year: 2003 }), null);
  assert.equal((await kino.meta({ type: "series", title: "Dark", year: 2017 })).ids.tmdb, 70523);
  assert.equal(await code(kino.meta({ type: "movie", title: "Eco", year: "dosmil" })), "invalid_request");
});

test("validate notes kino.meta by title without the byTitle check", () => {
  const guarded = 'if (typeof kino.meta === "function" && kino.meta.byTitle === true) await kino.meta({ type: "movie", title: t, year });';
  assert.deepEqual(unguardedServiceNotes(guarded), []);
  const notes = unguardedServiceNotes('if (typeof kino.meta === "function") await kino.meta({ type: "movie", title });');
  assert.deepEqual(notes, ["kino.meta con title (sin ids) existe desde Kino 0.9.55: comprueba kino.meta.byTitle === true antes; en versiones anteriores responde invalid_request"]);
  assert.deepEqual(unguardedServiceNotes('if (typeof kino.meta === "function") await kino.meta({ type: "movie", ids: { tmdb: 603 } });'), []);
});
