// node --test plugins/sdk/test/kino-library.test.mjs   (Node 18+)
// kino.library (apiVersion 14, capability "library", Task 8b): the kit prints the red consent line, refuses a plugin that calls
// kino.library without declaring it, and its stand-in answers a fixture with the app's rules (PluginLibraryBridge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract, validateManifest } from "../contract.mjs";
import { createKino, signingLane } from "../kino-shim.mjs";
import { consentLines, undeclaredLibraryProblem, validate } from "../validate.mjs";

const L = contract.kinoLibrary;
const DAY = L.dayMs;

const manifest = (extra = {}) => ({
  id: "news", name: "News", version: "1.0.0", apiVersion: 14, entry: "plugin.js",
  hosts: ["example.com"], capabilities: ["search", "resolve", "library"], ...extra,
});

const FIXTURE = {
  watched: [
    { title: "Older", kind: "movie", ids: { tmdb: 603, imdb: "tt0133093" }, progress: 1, watchedAtMs: 10 * DAY + 5000 },
    { title: "Newest", kind: "series", ids: { tmdb: 1399 }, progress: 0.4, watchedAtMs: 20 * DAY + 12 * 3600000, streamUrl: "https://x/v.m3u8", ref: "plg1:abc" },
    { title: "Hidden", kind: "movie", watchedAtMs: 30 * DAY, adult: true },
  ],
  saved: [
    { title: "Saved A", year: 1999, kind: "movie", ids: { imdb: "tt0133093" }, savedAtMs: 5 },
    { title: "Saved B", kind: "series", savedAtMs: 9 },
    { title: "Saved adult", kind: "movie", savedAtMs: 10, adult: true },
  ],
};

test("kitPrintsTheConsentLine: the library line is red and is the app's, word for word", () => {
  const checked = validateManifest(JSON.stringify(manifest()));
  assert.equal(checked.ok, true, checked.message);
  const line = consentLines(checked.manifest).find((l) => l.text === L.consentLine.es);
  assert.deepEqual(line, { text: "Podrá leer lo que has visto y guardado en Kino, y enviarlo a sus servicios", danger: true });
  assert.equal(L.consentLine.en, "Can read what you have watched and saved in Kino, and send it to its services");
  // Without the capability, no line.
  const plain = validateManifest(JSON.stringify(manifest({ capabilities: ["search", "resolve"] })));
  assert.ok(!consentLines(plain.manifest).some((l) => l.text === L.consentLine.es));
});

test("the manifest: library is apiVersion 14, declarative, needs approval and may stand beside a screen", () => {
  assert.ok(contract.capabilities.needsApproval.includes("library"));
  assert.ok(contract.capabilities.declarative.includes("library"));
  assert.equal(contract.capabilities.apiVersions.library, 14);
  const old = validateManifest(JSON.stringify(manifest({ apiVersion: 12 })));
  assert.deepEqual({ ok: old.ok, field: old.field, message: old.message }, { ok: false, field: "capabilities", message: 'The "library" capability needs apiVersion 14' });
  assert.equal(validateManifest(JSON.stringify(manifest({ capabilities: ["screen", "library"], screen: { label: "Noticias" } }))).ok, true);
});

test("a plugin that calls kino.library without declaring the capability is refused", async () => {
  const src = "export async function search() { return (await kino.library.watched({ limit: 5 })).map((t) => t.title); }\nexport async function resolve() { return null; }\n";
  assert.match(undeclaredLibraryProblem({ capabilities: ["search", "resolve"] }, src), /does not declare the "library" capability/);
  assert.equal(undeclaredLibraryProblem({ capabilities: ["search", "resolve", "library"] }, src), null);
  assert.equal(undeclaredLibraryProblem({ capabilities: ["search", "resolve"] }, "export async function search() { return []; }"), null);
  const dir = mkdtempSync(join(tmpdir(), "kino-library-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest({ capabilities: ["search", "resolve"] })));
    writeFileSync(join(dir, "plugin.js"), src);
    const r = await validate(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /kino\.library/.test(p)), r.problems.join("\n"));
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest()));
    const ok = await validate(dir);
    assert.ok(!ok.problems.some((p) => /kino\.library/.test(p)), ok.problems.join("\n"));
    assert.ok(ok.consent.some((l) => l.text === L.consentLine.es && l.danger));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the kit's kino.library answers the fixture with the app's rules", async () => {
  const { kino } = createKino(manifest(), { libraryFixture: FIXTURE, env: {} });
  assert.equal(typeof kino.library, "object");
  const watched = await kino.library.watched();
  // Newest first, never an 18+ one, rounded to the day, only the contract's fields (no stream, no ref).
  assert.deepEqual(watched, [
    { title: "Newest", kind: "series", ids: { tmdb: 1399 }, progress: 0.4, watchedAtMs: 20 * DAY },
    { title: "Older", kind: "movie", ids: { tmdb: 603, imdb: "tt0133093" }, progress: 1, watchedAtMs: 10 * DAY },
  ]);
  assert.deepEqual((await kino.library.watched({ kind: "movie" })).map((t) => t.title), ["Older"]);
  assert.deepEqual((await kino.library.watched({ sinceMs: 15 * DAY })).map((t) => t.title), ["Newest"]);
  assert.deepEqual((await kino.library.watched({ limit: 1 })).map((t) => t.title), ["Newest"]);
  assert.deepEqual(await kino.library.saved(), [
    { title: "Saved B", kind: "series", ids: {} },
    { title: "Saved A", year: 1999, kind: "movie", ids: { imdb: "tt0133093" } },
  ]);
  for (const bad of [{ limit: 0 }, { limit: 1.5 }, { kind: "anime" }, "x", [1]]) {
    await assert.rejects(kino.library.watched(bad), (e) => e.code === "bad_request");
  }
  await assert.rejects(kino.library.saved({ sinceMs: 1 }), (e) => e.code === "bad_request");
});

test("limitCappedAt100Default50 and rateLimit30PerMinute in the kit", async () => {
  let t = 1_000_000;
  const many = { watched: Array.from({ length: 150 }, (_, i) => ({ title: `T${i}`, kind: "movie", watchedAtMs: 1000 + i })) };
  const { kino } = createKino(manifest(), { libraryFixture: many, env: {}, now: () => t });
  assert.equal((await kino.library.watched()).length, L.defaultLimit);
  assert.equal((await kino.library.watched({ limit: 500 })).length, L.maxLimit);
  for (let i = 2; i < L.perMinute; i++) await kino.library.saved();
  await assert.rejects(kino.library.watched(), (e) => e.code === "rate_limited");
  t += 60_000;
  assert.equal((await kino.library.watched({ limit: 3 })).length, 3);
});

test("permission_denied: not declared, switched off by the person, a sync call, the signing lane", async () => {
  const undeclared = createKino(manifest({ capabilities: ["search", "resolve"] }), { libraryFixture: FIXTURE, env: {} }).kino;
  await assert.rejects(undeclared.library.watched(), (e) => e.code === "permission_denied");
  const revoked = createKino(manifest(), { libraryFixture: FIXTURE, env: { KINO_LIBRARY_REVOKED: "1" } }).kino;
  await assert.rejects(revoked.library.saved(), (e) => e.code === "permission_denied");
  const sync = createKino(manifest(), { libraryFixture: FIXTURE, env: {}, syncCall: true }).kino;
  await assert.rejects(sync.library.watched(), (e) => e.code === "permission_denied");
  const lane = signingLane(createKino(manifest(), { libraryFixture: FIXTURE, env: {} }).kino);
  await assert.rejects(lane.library.watched(), (e) => e.code === "not_allowed");
  // Below apiVersion 14 there is no kino.library at all, as in the app.
  const old = createKino(manifest({ apiVersion: 12, capabilities: ["search", "resolve"] }), { env: {} }).kino;
  assert.equal(typeof old.library, "undefined");
});

test("sinceMs is rounded down to the day in the kit too: a binary search learns nothing finer", async () => {
  const at = 300 * DAY + 13 * 3600000 + 7777;
  const fixture = { watched: [{ title: "A", kind: "movie", progress: 0.123456, watchedAtMs: at }] };
  const answers = [];
  for (const s of [300 * DAY, at - 1, at, at + 1, 301 * DAY - 1]) {
    const { kino } = createKino(manifest(), { libraryFixture: fixture, env: {} });
    answers.push(JSON.stringify(await kino.library.watched({ sinceMs: s })));
  }
  assert.equal(new Set(answers).size, 1);
  assert.deepEqual(JSON.parse(answers[0]), [{ title: "A", kind: "movie", ids: {}, progress: 0.12, watchedAtMs: 300 * DAY }]);
  const { kino } = createKino(manifest(), { libraryFixture: fixture, env: {} });
  assert.deepEqual(await kino.library.watched({ sinceMs: 301 * DAY }), []);
  for (const bad of [{ limit: NaN }, { sinceMs: Infinity }]) await assert.rejects(kino.library.watched(bad), (e) => e.code === "bad_request");
});

test("the kit refuses reads from exports outside fromFunctions, as the app does", async () => {
  for (const fn of ["resolve", "episodes", "sign", "syncPush"]) {
    const { kino } = createKino(manifest(), { libraryFixture: FIXTURE, env: {}, callFunction: fn });
    await assert.rejects(kino.library.watched(), (e) => e.code === "permission_denied", fn);
  }
  for (const fn of L.fromFunctions) {
    const { kino } = createKino(manifest(), { libraryFixture: FIXTURE, env: {}, callFunction: fn });
    assert.equal((await kino.library.watched()).length, 2, fn);
  }
});
