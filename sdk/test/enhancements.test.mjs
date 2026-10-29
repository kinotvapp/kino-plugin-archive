// node --test plugins/sdk/test/enhancements.test.mjs   (Node 18+)
// Manifest "enhancements" (Task 8c): a plugin keeps its own apiVersion, so an older Kino installs it as before, and adds under
// the apiVersion that brought them the screen and the library only a newer Kino reads. The kit merges them exactly as the app's
// ManifestParser does (the shared cases in enhancement-cases.json run through both).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, featureApiVersion, validateManifest, validateManifestWithoutEnhancements } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "enhancement-cases.json"), "utf8"));

const latino = (extra = {}) => ({ ...fixture.base, ...extra });
const screenAndLibrary = { 14: { capabilities: ["screen", "library"], screen: { label: "Inicio", labelEn: "Home" } } };
const SCRIPT = "export async function search(){ return [] }\nexport async function resolve(){ return null }\nexport async function screen(){ return { type: 'text', text: 'x' } }\nexport async function screenEvent(){ return {} }\n";

test("the shared cases: the kit merges, drops and refuses exactly as the app", () => {
  assert.ok(fixture.cases.length >= 10);
  for (const c of fixture.cases) {
    const r = validateManifest(JSON.stringify(latino(c.manifest)), { exports: c.exports || null });
    if (!c.ok) {
      assert.equal(r.ok, false, c.name);
      assert.equal(r.field, c.field, c.name);
      assert.equal(r.message, c.message, c.name);
      continue;
    }
    assert.equal(r.ok, true, `${c.name}: ${r.message}`);
    const m = r.manifest;
    assert.deepEqual([...m.capabilities].sort(), c.capabilities, c.name);
    assert.equal(m.screen ? m.screen.label : null, c.screen, c.name);
    assert.deepEqual(m.settings.map((s) => s.key), c.settings, c.name);
    assert.deepEqual(m.enhancementsApplied, c.applied, c.name);
    assert.deepEqual(m.enhancementsDropped, c.dropped, c.name);
    // Task 8k: whether the merged panel contributes a tab (absent in a case: false).
    assert.equal(m.panel?.contributes === true, c.panelContributes === true, c.name);
    // Task 18 (G1): the merged jobs' ids, when the case names them.
    if (c.jobs) assert.deepEqual((m.jobs || []).map((j) => j.id), c.jobs, c.name);
    assert.equal(m.apiVersion, latino(c.manifest).apiVersion, c.name);
  }
});

test("an older Kino never reads the key: the manifest without enhancements, whatever their shape", () => {
  const plain = validateManifestWithoutEnhancements(JSON.stringify(latino()));
  assert.equal(plain.ok, true);
  for (const shape of [screenAndLibrary, [1, 2], null, "14", { 99: { x: true } }]) {
    const withIt = validateManifestWithoutEnhancements(JSON.stringify(latino({ enhancements: shape })));
    assert.equal(withIt.ok, true);
    const { enhancements, ...rest } = withIt.manifest;
    assert.deepEqual(rest, plain.manifest, JSON.stringify(shape));
    assert.deepEqual(withIt.manifest.capabilities, ["search", "resolve"]);
  }
});

test("contract.json: what a block may carry, and every capability it may add came with the first Kino that reads them", () => {
  const E = contract.manifest.enhancements;
  assert.deepEqual(E.fields, ["capabilities", "screen", "settings", "panel", "jobs"]);
  assert.deepEqual(E.capabilities, ["screen", "library", "playerPanelTab", "playerControl", "room", "schedule", "shared", "ai"]);
  assert.equal(E.fromApiVersion, 14);
  for (const c of E.capabilities) assert.ok(contract.capabilities.apiVersions[c] >= E.fromApiVersion, c);
  assert.ok(contract.apiVersionFromApp[String(E.fromApiVersion)]);
});

async function inDir(manifest, script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kino-enh-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "plugin.js"), script);
    return await fn(await validate(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("kitValidatesEnhancements: applied ones are noted with the library's red line, dropped ones are problems", async () => {
  await inDir(latino({ enhancements: screenAndLibrary }), SCRIPT, (r) => {
    assert.equal(r.ok, true, r.problems.join("\n"));
    assert.ok(r.consent.some((l) => l.text === contract.kinoLibrary.consentLine.es && l.danger), JSON.stringify(r.consent));
    assert.ok(r.notes.some((n) => n.startsWith(`enhancements 14: read by Kino ${contract.apiVersionFromApp["14"]} or later`) && n.includes("as apiVersion 8")), r.notes.join("\n"));
  });
  // A block the app would drop: the plugin still installs there, but the author is told before publishing.
  await inDir(latino({ enhancements: { 14: { capabilities: ["screen"] } } }), SCRIPT, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('enhancements.14: screen: The "screen" capability needs a "screen" field with a "label"')), r.problems.join("\n"));
  });
  // The enhancement's capabilities need their exports, as a base screen does (the same validators).
  await inDir(latino({ enhancements: screenAndLibrary }), "export async function search(){ return [] }\nexport async function resolve(){ return null }\n", (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /screen/.test(p) && /screenEvent/.test(p)), r.problems.join("\n"));
    // The app never refuses the install over an enhancement's missing exports: it drops the block and runs the plugin as its
    // own manifest says. The kit still fails (the author must see it) but says what Kino really does.
    assert.ok(!r.problems.some((p) => /refuses the install/.test(p)), r.problems.join("\n"));
    assert.ok(r.problems.some((p) => p.includes("Kino ignores this enhancement") && /screenEvent/.test(p)), r.problems.join("\n"));
  });
  // A missing export of the plugin's OWN manifest is still a refusal.
  await inDir(latino({ enhancements: screenAndLibrary }), "export async function search(){ return [] }\n", (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /refuses the install/.test(p) && /resolve/.test(p)), r.problems.join("\n"));
  });
  // Two truths: an apiVersion 14 plugin with a "14" block. The app drops it (never refuses: the plugin would vanish from the
  // list of whoever installed it on an older Kino); the kit fails so the author fixes it.
  await inDir({ ...latino({ apiVersion: 14 }), enhancements: screenAndLibrary }, SCRIPT, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("enhancements.14: the key must be above the plugin's apiVersion (14)")), r.problems.join("\n"));
  });
});

test("an enhancement's settings that leave out one of the manifest's is noted: keep it a superset", async () => {
  const m = latino({
    settings: [{ key: "token", type: "text", label: "Token" }, { key: "region", type: "text", label: "Region" }],
    enhancements: { 14: { settings: [{ key: "token", type: "text", label: "Token" }] } },
  });
  await inDir(m, SCRIPT, (r) => {
    assert.ok(r.notes.some((n) => n.includes('enhancements.14: "settings" leaves out region')), r.notes.join("\n"));
  });
});

test("a top-level screen below apiVersion 14 points the author at enhancements", async () => {
  await inDir(latino({ screen: { label: "Inicio" } }), SCRIPT, (r) => {
    assert.ok(r.notes.some((n) => n.includes('"screen" needs apiVersion 14') && n.includes('"enhancements": { "14"')), r.notes.join("\n"));
  });
});

test("kino.library exists for an enhanced plugin as on the app's apiVersion 14 Kino; the feature level is the newest key", () => {
  const enhanced = validateManifest(JSON.stringify(latino({ enhancements: screenAndLibrary }))).manifest;
  assert.equal(featureApiVersion(enhanced), 14);
  assert.equal(typeof createKino(enhanced, { env: {} }).kino.library, "object");
  const plain = validateManifest(JSON.stringify(latino())).manifest;
  assert.equal(featureApiVersion(plain), 8);
  assert.equal(createKino(plain, { env: {} }).kino.library, undefined);
});
