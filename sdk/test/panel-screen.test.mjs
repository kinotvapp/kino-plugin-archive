// Task 8i: the player panel built with the screen kit, in the Node kit. run.mjs `panel` reads both formats as the app does,
// `panelAction --screen` reads a screen-mode answer, validate.mjs `--run panel` checks either format, and the contract file
// carries the numbers the app pins (PluginContractParityTest). The shared verdicts live in screen-cases.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contract } from "../contract.mjs";
import { checkPanelScreen, checkPanelScreenAnswer, isPanelScreen, PANEL_SCREEN } from "../screen.mjs";
import { validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const run = join(here, "..", "run.mjs");

function kit(args) {
  const r = spawnSync(process.execPath, [run, ...args], { encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

/** A panel plugin at [apiVersion] whose panel answers in the screen format when [screen], else the legacy one. */
function plugin(apiVersion, screen = true) {
  const dir = mkdtempSync(join(tmpdir(), "kino-panel-screen-"));
  writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify({
    id: "panel-screen-demo", name: "Panel screen demo", version: "1.0.0", apiVersion, entry: "plugin.js",
    hosts: ["example.com"], capabilities: ["search", "resolve"], panel: { label: "Marcador", icon: "sports" },
  }));
  writeFileSync(join(dir, "plugin.js"), `
export async function search() { return []; }
export async function resolve() { return { url: "https://example.com/v.m3u8" }; }
export async function panel(ctx) {
  ${screen ? "" : "return { title: 'Viejo', elements: [{ type: 'text', text: 'hola' }] };"}
  const goals = (ctx.state && ctx.state.goals) || 0;
  return {
    format: "screen", title: "Marcador", refreshMs: 5000, tabs: [{ id: "live", label: "En vivo" }],
    root: { type: "Column", children: [
      { type: "Text", text: "Goles: " + goals + " / " + ctx.size.widthClass + " / " + ctx.features.join(","), style: "h3" },
      { type: "ElevatedButton", label: "Gol", onPressed: "goal" },
      { type: "popup", key: "p", children: [{ type: "text", text: "no" }] },
    ] },
  };
}
export async function playerEvent(event, ctx) {
  return { panel: { format: "screen", root: { type: "text", text: "pausa" } }, state: { paused: true } };
}
export async function panelAction(event, ctx) {
  if (event.name === "goal") return { state: { goals: ((ctx.state && ctx.state.goals) || 0) + 1 }, toast: "Gol", ui: [{ hide: "x" }], dialog: { title: "no" }, player: { speed: 1.5 } };
  return null;
}
`);
  return dir;
}

test("contract: the panel's formats and the screen-format limits are what the app pins", () => {
  assert.deepEqual(contract.output.panel.formats, ["legacy", "screen"]);
  assert.equal(PANEL_SCREEN.maxDepth, 6);
  assert.equal(PANEL_SCREEN.maxNodes, 200);
  assert.equal(PANEL_SCREEN.apiVersion, contract.manifest.screen.apiVersion);
  assert.deepEqual(PANEL_SCREEN.droppedAnswerFields, ["dialog", "sheet", "menu", "route"]);
  assert.ok(PANEL_SCREEN.answerFields.includes("ui") && PANEL_SCREEN.answerFields.includes("config") && PANEL_SCREEN.answerFields.includes("go"));
  // The panel keeps its one periodic call: no `every` in a screen-format panel.
  assert.ok(!PANEL_SCREEN.resultFields.includes("every"));
});

test("legacyPanelUnchanged: a result without format reads as the legacy panel, its tree untouched", () => {
  const dir = plugin(14, false);
  try {
    const r = kit([dir, "panel", "m1"]);
    assert.equal(r.status, 0, r.err);
    const p = r.json();
    assert.equal(p.title, "Viejo");
    assert.equal(p.elements[0].text, "hola");
    assert.equal(p.format, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("screenFormatPanelRendersScreenNodes: run.mjs panel reads the screen format with the panel's limits", () => {
  const dir = plugin(14);
  try {
    const r = kit([dir, "panel", "m1"]);
    assert.equal(r.status, 0, r.err);
    const p = r.json();
    assert.equal(p.format, "screen");
    assert.equal(p.title, "Marcador");
    assert.equal(p.refreshMs, 5000);
    assert.equal(p.root.type, "col");
    // The fake context of an apiVersion 14 plugin carries the state, the size and the "screen" feature.
    assert.match(p.root.children[0].text, /Goles: 0 \/ compact \/ screen/);
    assert.match(r.err, /popup is not available in the player panel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("below apiVersion 14 the screen format is read as a legacy panel, said", () => {
  const lines = [];
  assert.equal(isPanelScreen({ format: "screen", root: { type: "text", text: "x" } }, 9, (l) => lines.push(l)), false);
  assert.deepEqual(lines, ['panel: format "screen" needs apiVersion 14, read as a legacy panel']);
});

test("panelActionReceivesScreenEvents: --screen sends { trigger, name, values } and reads the screen-mode answer", () => {
  const dir = plugin(14);
  try {
    const r = kit(["--state", '{"goals":2}', "--screen", dir, "panelAction", "m1", "goal", "press"]);
    assert.equal(r.status, 0, r.err);
    const a = r.json();
    assert.deepEqual(a.state, { goals: 3 });
    assert.equal(a.toast.text, "Gol");
    assert.equal(a.ui.length, 1);
    assert.equal(a.player.speed, 1.5);
    assert.equal(a.dialog, undefined);
    assert.match(r.err, /answer\.dialog is not honoured inside the panel, dropped/);
    // A trigger the screen mode never sends is refused by the command.
    assert.equal(kit(["--screen", dir, "panelAction", "m1", "goal", "tab"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate --run panel checks either format", async () => {
  const dir = plugin(14);
  const legacy = plugin(14, false);
  try {
    const r = await validate(dir, { run: "panel", args: ["m1"] });
    assert.ok(r.ok, r.problems.join("; "));
    assert.equal(r.output.format, "screen");
    assert.ok(r.drops.some((d) => /popup is not available in the player panel/.test(d)));
    const l = await validate(legacy, { run: "panel", args: ["m1"] });
    assert.ok(l.ok, l.problems.join("; "));
    assert.equal(l.output.title, "Viejo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  }
});

test("panelScreenLimitsDepth6Nodes200: the screen kind is capped at depth 6 and 200 nodes", () => {
  const deep = (n) => (n === 0 ? { type: "text", text: "x" } : { type: "col", children: [deep(n - 1)] });
  assert.deepEqual(checkPanelScreen({ format: "screen", root: deep(5) }).dropped, []);
  assert.deepEqual(checkPanelScreen({ format: "screen", root: deep(6) }).dropped, ["screen: deeper than 6 levels, dropped"]);
  const wide = (n) => ({ format: "screen", root: { type: "col", children: Array.from({ length: n }, () => ({ type: "text", text: "x" })) } });
  assert.deepEqual(checkPanelScreen(wide(199)).dropped, []);
  assert.deepEqual(checkPanelScreen(wide(200)).dropped, ["screen: more than 200 nodes, the rest dropped"]);
});

test("panelAnswerDropsDialogSheetMenuAndLogs", () => {
  const r = checkPanelScreenAnswer({ dialog: { title: "a" }, sheet: { title: "b" }, menu: { items: [] }, toast: "ok" });
  assert.equal(r.answer.dialog, null);
  assert.equal(r.answer.sheet, null);
  assert.equal(r.answer.menu, null);
  assert.equal(r.answer.toast.text, "ok");
  assert.deepEqual(r.dropped, ["dialog", "menu", "sheet"].map((f) => `panel: answer.${f} is not honoured inside the panel, dropped`));
});

test("playerEvent: an apiVersion 14 plugin's panel is kept for the open panel, its state is said not applied; below 14 the panel is ignored", () => {
  const dir = plugin(14);
  const old = plugin(12);
  try {
    const r = kit([dir, "playerEvent", "m1", "paused"]);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.json().panel.format, "screen");
    assert.match(r.err, /playerEvent: answer\.state is not applied/);
    const o = kit([old, "playerEvent", "m1", "paused"]);
    assert.equal(o.status, 0, o.err);
    assert.equal(o.json().panel, undefined);
    assert.match(o.err, /playerEvent: panel needs apiVersion 14, ignored/);
    assert.doesNotMatch(o.err, /answer\.state is not applied/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
  }
});
