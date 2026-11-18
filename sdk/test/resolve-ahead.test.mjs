// The manifest's "resolveAhead" (contract.json manifest.resolveAhead, ManifestParser.RESOLVE_AHEAD): a hint that lets Kino call
// resolve before the person presses play. Additive (every apiVersion) and never a refusal: what it drops is logged by the app
// and warned here. The shared cases in resolve-ahead-cases.json run through the app's parser too (PluginManifestResolveAheadTest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, resolveAheadOf, validateManifest } from "../contract.mjs";
import { resolveAheadNote, resolveAheadWarnings, validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "resolve-ahead-cases.json"), "utf8"));
const R = contract.manifest.resolveAhead;
const NOT_BOOLEAN = 'The "resolveAhead" field must be true or false; Kino ignores any other value';
const IGNORED = (name) => `The "resolveAhead" field is ignored beside "${name}": Kino never calls this plugin's resolve ahead`;

test("the contract carries the field: additive with no Kino number yet, the app's words, the player's keep times", () => {
  assert.equal(contract.additiveFromApp["manifest.resolveAhead"], "0.9.88");
  assert.equal(R.default, false);
  assert.equal(R.notBooleanMessage, NOT_BOOLEAN);
  assert.equal(R.ignoredMessage.replace("{name}", "browser"), IGNORED("browser"));
  assert.deepEqual(R.ignoredBeside, ["catalogOnly", "browser"]);
  assert.equal(R.maxKeepMs, 20 * 60_000);
  assert.equal(R.expiryMarginMs, 60_000);
  // Valid at every apiVersion, so no enhancement block carries it.
  assert.ok(!contract.manifest.enhancements.fields.includes("resolveAhead"));
});

test("the shared cases: the kit reads, drops and warns exactly as the app reads, drops and logs", () => {
  assert.ok(fixture.cases.length >= 15);
  for (const c of fixture.cases) {
    const raw = { ...fixture.base, ...c.manifest };
    const r = validateManifest(JSON.stringify(raw));
    assert.equal(r.ok, true, `${c.name}: ${r.field}: ${r.message}`);
    assert.equal(r.manifest.resolveAhead, c.resolveAhead, c.name);
    assert.deepEqual(resolveAheadWarnings(raw, r.manifest), c.dropped ? [`resolveAhead: ${c.dropped}`] : [], c.name);
    if (c.enhancementsDropped) assert.deepEqual(r.manifest.enhancementsDropped, c.enhancementsDropped, c.name);
  }
});

test("resolveAheadOf: a value that is no boolean first, then catalogOnly, then browser", () => {
  assert.deepEqual(resolveAheadOf(undefined, false, false), { value: false, dropped: null });
  assert.deepEqual(resolveAheadOf(null, true, true), { value: false, dropped: null });
  assert.deepEqual(resolveAheadOf(false, true, true), { value: false, dropped: null });
  assert.deepEqual(resolveAheadOf(true, false, false), { value: true, dropped: null });
  assert.deepEqual(resolveAheadOf(true, false, true), { value: false, dropped: IGNORED("browser") });
  assert.deepEqual(resolveAheadOf(true, true, true), { value: false, dropped: IGNORED("catalogOnly") });
  for (const v of ["true", "false", 1, 0, {}, [], [true]]) assert.deepEqual(resolveAheadOf(v, true, true), { value: false, dropped: NOT_BOOLEAN }, JSON.stringify(v));
});

const SCRIPT = "export async function search(){ return [] }\nexport async function resolve(){ return null }\n";

/** validate's answer for a plugin with a search and a resolve whose manifest also has [extra]. */
async function validated(extra) {
  const dir = mkdtempSync(join(tmpdir(), "kino-ahead-"));
  try {
    const manifest = { id: "ahead", name: "Ahead", version: "1.0.0", apiVersion: 8, entry: "plugin.js", hosts: ["archive.org"], capabilities: ["search", "resolve"], ...extra };
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "plugin.js"), SCRIPT);
    return await validate(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("validate accepts a plugin whose resolveAhead is no boolean, and warns in the words the app logs", async () => {
  for (const v of ["yes", 1, { titlePage: true }]) {
    const r = await validated({ resolveAhead: v });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.warnings, [`resolveAhead: ${NOT_BOOLEAN}`], JSON.stringify(v));
    assert.ok(!r.notes.some((n) => n.startsWith("resolveAhead:")), "a dropped field means nothing to note");
  }
});

test("validate notes what true means, with the contract's numbers, and warns nothing", async () => {
  const r = await validated({ resolveAhead: true });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.notes.filter((n) => n.startsWith("resolveAhead:")), [resolveAheadNote()]);
  assert.match(resolveAheadNote(), /within 20 minutes, or until 60 s before its expiresInSeconds/);
  assert.match(resolveAheadNote(), /Kino 0.9.88 or later/);
  // Left out or false: neither a note nor a warning.
  for (const extra of [{}, { resolveAhead: false }]) {
    const quiet = await validated(extra);
    assert.deepEqual(quiet.warnings, []);
    assert.ok(!quiet.notes.some((n) => n.startsWith("resolveAhead:")), JSON.stringify(extra));
  }
});

test("validate warns that Kino ignores it beside browser, and still accepts the plugin", async () => {
  for (const browser of [true, "pages"]) {
    const r = await validated({ apiVersion: 6, browser, resolveAhead: true });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.warnings, [`resolveAhead: ${IGNORED("browser")}`], String(browser));
    assert.ok(!r.notes.some((n) => n.startsWith("resolveAhead:")), "an ignored field means nothing to note");
  }
});
