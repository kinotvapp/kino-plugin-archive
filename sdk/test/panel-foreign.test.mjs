// node --test plugins/sdk/test/panel-foreign.test.mjs   (Node 18+)
// Task 8k: a tab a plugin contributes to the player panel of ANOTHER plugin's title. The kit builds the same foreign context as
// the app's PanelForeign (the shared cases in panel-foreign-cases.json run through both), says what the app drops of such a
// panel's answers, and `run.mjs --foreign` / `validate` show it to the author.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { contributesPanel, foreignAnswerDrops, foreignContext, foreignEventDetail, foreignRef } from "../panel.mjs";
import { panelRequest } from "../run.mjs";
import { validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "panel-foreign-cases.json"), "utf8"));
const RUN = join(here, "..", "run.mjs");

const MANIFEST = {
  id: "watch-party", name: "Watch Party", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"],
  capabilities: ["playerPanelTab"], panel: { contributes: true, icon: "heart" },
};
const SCRIPT = [
  "export async function panel(ctx) { return { title: 'Fiesta', elements: [{ type: 'text', text: JSON.stringify({ ref: ctx.ref, foreign: ctx.foreign, source: ctx.source, label: (ctx.playing || {}).label || null, autoNext: (ctx.player || {}).autoNext || null }) }] }; }",
  "export async function panelAction(event, ctx) { return { player: { seekToMs: 60000, speed: 2 }, go: { title: { ref: 'movie:1' } } }; }",
  "export async function playerEvent(event, ctx) { return { message: 'ok' }; }",
  "",
].join("\n");

function inDir(manifest, script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kino-foreign-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "plugin.js"), script);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("kit parity: the opaque ref is the app's for every shared case", () => {
  assert.ok(cases.refs.length >= 4);
  for (const c of cases.refs) assert.equal(foreignRef(c.contributor, c.owner, c.ref, c.salt), c.expected, JSON.stringify(c));
  // Stable for one contributor on one install; another install (salt) or another plugin gets another id; never the owner's ref.
  const [a, otherInstall, , otherPlugin] = cases.refs;
  assert.equal(foreignRef(a.contributor, a.owner, a.ref, a.salt), foreignRef(a.contributor, a.owner, a.ref, a.salt));
  assert.notEqual(a.expected, otherInstall.expected);
  assert.notEqual(a.expected, otherPlugin.expected);
  for (const c of cases.refs) assert.ok(!c.expected.includes(c.ref));
  assert.match(a.expected, new RegExp(`^${contract.manifest.panel.contributes.foreignRefPrefix}[0-9a-f]{${contract.manifest.panel.contributes.foreignRefHexChars}}$`));
});

test("kit parity: contributedPanelNeverSeesTheOwnersRef (the shared context case)", () => {
  const c = cases.context;
  const got = foreignContext(c.input, c.contributor, c.source, c.salt);
  assert.deepEqual(got, c.expected);
  // An allow-list: a field it does not name (a future one, the owner's server) never reaches the contributed panel.
  assert.ok(!JSON.stringify(got).includes("owner.example"));
  const text = JSON.stringify(got);
  assert.ok(!text.includes(c.input.ref), "the owner's ref never reaches the contributed panel");
  assert.ok(!text.includes("Servidor 2"), "nor the owner's copy label");
  assert.ok(!text.includes("s1e3"), "nor the owner's next ref (autoNext)");
});

test("kit parity: what the app drops of a contributed panel's answer (player only after a press, only a seek; never go.title/play)", () => {
  for (const c of cases.drops) assert.deepEqual(foreignAnswerDrops(c.answer, c.trigger), c.lines, JSON.stringify(c));
  assert.deepEqual(foreignEventDetail("copyChanged", { label: "S2", automatic: true }), { automatic: true });
  assert.deepEqual(foreignEventDetail("paused", { label: "x" }), { label: "x" });
});

test("the manifest: contributes and playerPanelTab need each other; a missing label is the plugin's name", () => {
  const ok = validateManifest(JSON.stringify(MANIFEST));
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.manifest.panel.label, "Watch Party");
  assert.equal(contributesPanel(ok.manifest), true);
  const C = contract.manifest.panel.contributes;
  const noCap = validateManifest(JSON.stringify({ ...MANIFEST, capabilities: ["search", "resolve"] }));
  assert.deepEqual([noCap.ok, noCap.field, noCap.message], [false, "panel", C.needsCapabilityMessage]);
  const noPanel = validateManifest(JSON.stringify({ ...MANIFEST, panel: { label: "Fiesta" } }));
  assert.deepEqual([noPanel.ok, noPanel.field, noPanel.message], [false, "capabilities", C.capabilityNeedsMessage]);
  const bad = validateManifest(JSON.stringify({ ...MANIFEST, panel: { contributes: "yes" } }));
  assert.deepEqual([bad.ok, bad.field, bad.message], [false, "panel", C.badMessage]);
  // Below apiVersion 14 the key is unknown and ignored (and the capability does not exist yet).
  const old = validateManifest(JSON.stringify({ ...MANIFEST, apiVersion: 12, capabilities: ["search", "resolve"], panel: { label: "P", contributes: true } }));
  assert.equal(old.ok, true, old.message);
  assert.equal(old.manifest.panel.contributes, undefined);
});

test("panelRequest --foreign: every call's context is the foreign one", () => {
  const foreign = { contributorId: "watch-party", pluginId: "latino", name: "Latino" };
  const r = panelRequest("panel", ["movie:550"], null, { apiVersion: 14, foreign });
  assert.equal(r.context.ref, foreignRef("watch-party", "latino", "movie:550"));
  assert.equal(r.context.foreign, true);
  assert.deepEqual(r.context.source, { pluginId: "latino", name: "Latino" });
  const e = panelRequest("playerEvent", ["movie:550", "copyChanged", '{"label":"S2","automatic":false}'], null, { apiVersion: 14, foreign });
  assert.deepEqual(e.event, { type: "copyChanged", automatic: false });
  assert.equal(e.context.foreign, true);
  // Without --foreign nothing changes.
  assert.equal(panelRequest("panel", ["movie:550"], null, { apiVersion: 14 }).context.ref, "movie:550");
});

test("run.mjs --foreign: the panel sees an opaque ref and its source; the answer's player and go are reported as the app drops them", () => {
  inDir(MANIFEST, SCRIPT, (dir) => {
    const p = spawnSync(process.execPath, [RUN, "--raw", "--foreign", "latino:Latino", dir, "panel", "movie:550"], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    const text = JSON.parse(JSON.parse(p.stdout).elements[0].text);
    assert.deepEqual(text, { ref: foreignRef("watch-party", "latino", "movie:550"), foreign: true, source: { pluginId: "latino", name: "Latino" }, label: null, autoNext: null });
    const a = spawnSync(process.execPath, [RUN, "--foreign", "latino:Latino", dir, "panelAction", "movie:550", "sync", "change"], { encoding: "utf8" });
    assert.match(a.stderr, /needs the person's press in it or the playerControl capability, dropped/);
    assert.match(a.stderr, /go\.title: a contributed panel never opens a plugin's title, dropped/);
    const press = spawnSync(process.execPath, [RUN, "--foreign", "latino:Latino", dir, "panelAction", "movie:550", "sync", "press"], { encoding: "utf8" });
    assert.match(press.stderr, /a contributed panel only seeks; the playing plugin's player properties are its own, dropped/);
  });
  // A plugin that does not contribute: refused, with why.
  inDir({ ...MANIFEST, capabilities: ["search", "resolve"], apiVersion: 9, panel: { label: "P" } }, SCRIPT + "export async function search(){return []}\nexport async function resolve(){return null}\n", (dir) => {
    const p = spawnSync(process.execPath, [RUN, "--foreign", "latino", dir, "panel", "movie:550"], { encoding: "utf8" });
    assert.equal(p.status, 2);
    assert.match(p.stderr, /does not declare "panel": \{ "contributes": true \}/);
  });
});

test("validate: consentLineAskedAndNeverAutoApproved (the red line, as the app shows it) and the author's note", async () => {
  await inDir(MANIFEST, SCRIPT, async (dir) => {
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    const line = contract.manifest.panel.contributes.consentLine.es;
    assert.ok(r.consent.some((l) => l.text === line && l.danger === true), JSON.stringify(r.consent));
    assert.ok(r.notes.some((n) => n.startsWith("panel.contributes:")), JSON.stringify(r.notes));
  });
  assert.ok(contract.capabilities.needsApproval.includes("playerPanelTab"));
});
