// The optional export prepare (contract.json prepare, PlayAhead.PREPARE_EXPORT in the app; owner 2026-11-18): what a title
// page asks of a plugin whose resolve must not run for titles nobody plays. Additive (any apiVersion) and optional with
// resolve; its answer is ignored. The kit says what Kino does with it, warns where Kino never calls it, and runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOutput, contract, prepareNote, prepareWarnings, requiredExports, validateManifest } from "../contract.mjs";
import { validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, "..", "run.mjs");
const P = contract.prepare;
const BASE = { id: "warm", name: "Warm", version: "1.0.0", apiVersion: 8, entry: "plugin.js", hosts: ["archive.org"], capabilities: ["search", "resolve"] };
const WITH_PREPARE = "export async function search(){ return [] }\nexport async function resolve(){ return null }\nexport async function prepare(ref){ return { ok: true, ref } }\n";
const WITHOUT = "export async function search(){ return [] }\nexport async function resolve(){ return null }\n";
const BESIDE_RESOLVE_AHEAD = 'prepare: Kino never calls it beside "resolveAhead": true, so Kino resolves ahead instead';
const BESIDE_BROWSER = 'prepare: Kino never calls it beside "browser" (true or "pages"): its hidden pages need a play the person started';

/** The manifest [extra] makes of BASE, as validateManifest reads it. */
function manifest(extra) {
  const r = validateManifest(JSON.stringify({ ...BASE, ...extra }));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.manifest;
}

/** [fn] of a plugin folder whose manifest is BASE with [extra] and whose entry is [script]; the folder goes afterwards. */
async function withPlugin(extra, script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kino-prepare-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify({ ...BASE, ...extra }));
    writeFileSync(join(dir, "plugin.js"), script);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the contract carries the export: additive with no Kino number yet, optional with resolve, the app's numbers", () => {
  assert.equal(contract.additiveFromApp["export.prepare"], "0.9.88");
  assert.equal(P.export, "prepare");
  assert.equal(P.capability, "resolve");
  assert.ok(contract.capabilities.optionalExports.resolve.includes(P.export));
  assert.ok(!requiredExports(["search", "resolve"]).includes(P.export), "never required at install");
  assert.equal(contract.timeoutsMs.prepare, 15000);
  assert.equal(P.dwellMs, 300);
  assert.equal(P.perRefEveryMs, 5 * 60_000);
  assert.equal(P.perMinute, 6);
  assert.deepEqual(P.notCalledBeside, ["resolveAhead", "catalogOnly", "browser"]);
});

test("prepareWarnings: none without the export or where Kino calls it, one naming why where it never does", () => {
  assert.deepEqual(prepareWarnings(false, manifest({ resolveAhead: true })), []);
  assert.deepEqual(prepareWarnings(true, manifest({})), []);
  assert.deepEqual(prepareWarnings(true, manifest({ resolveAhead: false })), []);
  assert.deepEqual(prepareWarnings(true, manifest({ resolveAhead: true })), [BESIDE_RESOLVE_AHEAD]);
  for (const browser of [true, "pages"]) assert.deepEqual(prepareWarnings(true, manifest({ apiVersion: 6, browser })), [BESIDE_BROWSER], String(browser));
  // Beside browser the app drops resolveAhead itself: browser is the reason left.
  assert.deepEqual(prepareWarnings(true, manifest({ apiVersion: 6, browser: true, resolveAhead: true })), [BESIDE_BROWSER]);
  assert.deepEqual(prepareWarnings(true, manifest({ catalogOnly: true, capabilities: ["search", "home"] })),
    ['prepare: Kino never calls it beside "catalogOnly": true, so Kino never calls its resolve']);
  assert.deepEqual(prepareWarnings(true, manifest({ capabilities: ["subtitles"] })), ['prepare: Kino never calls it in a plugin without the "resolve" capability']);
});

test("prepareNote says when Kino calls it, with what, its limits and what an older Kino does", () => {
  const note = prepareNote();
  assert.match(note, /^prepare: Kino 0.9.88 or later calls prepare\(ref\) once the person has stayed about 0.3 s on one of your title pages/);
  assert.match(note, /with the ref resolve gets/);
  assert.match(note, /a background call of 15 s/);
  assert.match(note, /at most once every 5 minutes per ref and 6 a minute/);
  assert.match(note, /its answer is ignored/);
  assert.match(note, /An older Kino never calls it$/);
});

test("checkOutput keeps whatever prepare answers: Kino ignores it", () => {
  const m = manifest({});
  for (const v of [undefined, null, true, "done", { ok: true }, ["x"]]) assert.deepEqual(checkOutput("prepare", v, m).drops, [], JSON.stringify(v));
});

test("validate notes what an exported prepare means, and warns nothing", async () => {
  const r = await withPlugin({}, WITH_PREPARE, (dir) => validate(dir));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.notes.filter((n) => n.startsWith("prepare:")), [prepareNote()]);
  // Not exported: neither a note nor a warning.
  const none = await withPlugin({}, WITHOUT, (dir) => validate(dir));
  assert.equal(none.ok, true, JSON.stringify(none.problems));
  assert.deepEqual(none.warnings, []);
  assert.ok(!none.notes.some((n) => n.startsWith("prepare:")));
});

test("validate warns where Kino never calls it, and still accepts the plugin", async () => {
  const beside = await withPlugin({ resolveAhead: true }, WITH_PREPARE, (dir) => validate(dir));
  assert.equal(beside.ok, true, JSON.stringify(beside.problems));
  assert.deepEqual(beside.warnings, [BESIDE_RESOLVE_AHEAD]);
  assert.ok(!beside.notes.some((n) => n.startsWith("prepare:")), "an export Kino never calls means nothing to note");
  const pages = await withPlugin({ apiVersion: 6, browser: "pages" }, WITH_PREPARE, (dir) => validate(dir));
  assert.equal(pages.ok, true, JSON.stringify(pages.problems));
  assert.deepEqual(pages.warnings, [BESIDE_BROWSER]);
});

test("validate --run prepare runs it like any optional export of resolve", async () => {
  const r = await withPlugin({}, WITH_PREPARE, (dir) => validate(dir, { run: "prepare", args: ["v:m1:1"] }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.output, { ok: true, ref: "v:m1:1" });
});

test("run.mjs runs it: the note or the warning on stderr, the answer as Kino ignores it", async () => {
  await withPlugin({}, WITH_PREPARE, async (dir) => {
    const r = spawnSync(process.execPath, [RUN, dir, "prepare", "v:m1:1"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true, ref: "v:m1:1" });
    assert.ok(r.stderr.includes(`· ${prepareNote()}`), r.stderr);
  });
  await withPlugin({ resolveAhead: true }, WITH_PREPARE, async (dir) => {
    const r = spawnSync(process.execPath, [RUN, dir, "prepare", "v:m1:1"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes(`! ${BESIDE_RESOLVE_AHEAD}`), r.stderr);
    assert.ok(!r.stderr.includes(prepareNote()), r.stderr);
  });
  // A plugin without resolve: the same capability check as for resolve and sign.
  await withPlugin({ capabilities: ["subtitles"] }, "export async function subtitles(){ return [] }\nexport async function prepare(){ return null }\n", async (dir) => {
    const r = spawnSync(process.execPath, [RUN, dir, "prepare", "v:m1:1"], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /the manifest does not declare "resolve" in capabilities/);
  });
});
