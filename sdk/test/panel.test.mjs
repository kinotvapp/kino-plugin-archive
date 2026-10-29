// node --test plugins/sdk/test/panel.test.mjs
// The player panel (apiVersion 9) in the kit: the same validation as the app's PluginPanelOutput, PluginLayout,
// PanelPlayerRules and PanelIconFile, through panel.mjs, run.mjs's three commands and validate.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { requiredExports, validateManifest } from "../contract.mjs";
import { answerOutput, checkPanelOutput, fakeContext, PANEL_EXTRA_ICONS, PANEL_ICONS, panelIconKnown, panelIconProblem, panelOutput, settingsLayout } from "../panel.mjs";
import { validate } from "../validate.mjs";
import { callPanel } from "../run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const run = join(here, "..", "run.mjs");
const demo = join(here, "panel-demo");
const ICON_REFUSAL = "The panel icon must be a 96×96 px PNG with a transparent background, at most 24 KB";

const manifestJson = (extra = {}) => JSON.stringify({
  id: "demo", name: "Demo", version: "1.0.0", apiVersion: 9, entry: "plugin.js",
  hosts: ["example.com"], capabilities: ["search", "resolve"], panel: { label: "Demo" }, ...extra,
});

/** A plugin folder with [source] as its entry; `search`/`resolve` are there so the manifest is valid. */
function plugin(source, manifestExtra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kino-panel-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifestJson(manifestExtra));
  writeFileSync(join(dir, "plugin.js"), `export async function search(){return []}\nexport async function resolve(){return null}\n${source}`);
  return dir;
}

function kit(args) {
  const r = spawnSync(process.execPath, [run, ...args], { encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

/** A PNG with the given size and colour type (8-bit, all-zero pixels): the IHDR is all the app reads. */
function png(width, height, colorType, { pad = 0 } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let r = 0xffffffff; for (const x of b) r = crcTable[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = Buffer.alloc((width * channels + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), ...(pad ? [chunk("tEXt", Buffer.alloc(pad, 65))] : []), chunk("IEND", Buffer.alloc(0))]);
}

const check = (value, over = {}) => {
  const drops = [];
  const panel = panelOutput(value, { log: (d) => drops.push(d), ...over });
  return { panel, drops };
};
const answer = (value, over = {}) => {
  const drops = [];
  const a = answerOutput(value, { log: (d) => drops.push(d), ...over });
  return { a, drops };
};

test("the demo plugin validates, icon included, and its settings layout places every setting", async () => {
  const r = await validate(demo);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.drops, []);
  const m = validateManifest(readFileSync(join(demo, "kino-plugin.json"), "utf8")).manifest;
  assert.deepEqual(m.panel, { label: "Demo", labelEn: "Demo", iconFile: "panel-icon.png" });
  const placed = settingsLayout(m.settingsLayout, m.settings);
  assert.deepEqual(placed.log, []);
  assert.deepEqual(placed.tree.flatMap(function leaves(n) { return n.leaf ? [n.leaf.setting].filter(Boolean) : n.children.flatMap(leaves); }), ["quality", "skipIntro", "nickname"]);
});

test("run panel prints the validated panel with every element type, nothing dropped", () => {
  const main = kit([demo, "panel", "m1"]);
  assert.equal(main.status, 0, main.err);
  assert.equal(main.err, "");
  const types = (nodes) => nodes.flatMap((n) => [n.type, ...(n.children ? types(n.children) : [])]);
  const p = main.json();
  assert.equal(p.presentation, "panel");
  assert.equal(p.tab, "main");
  assert.deepEqual([...new Set(types(p.elements))].sort(), ["button", "card", "col", "row", "section", "select", "status", "text", "text-input", "toggle"]);
  const more = kit([demo, "panel", "m1", "more"]);
  assert.equal(more.status, 0, more.err);
  assert.equal(more.json().tab, "more");
  assert.deepEqual(types(more.json().elements), ["qr", "episodes", "image"]);
});

test("the default fake context is the spec's, plus the tab, and --context merges over it", () => {
  const dir = plugin(`export async function panel(c){ return { elements: [{ type: "text", text: JSON.stringify(c) }] } }`);
  try {
    const seen = (args) => JSON.parse(kit(args).json().elements[0].text);
    assert.deepEqual(seen([dir, "panel", "ref-1"]), {
      kind: "movie", ref: "ref-1", title: "Demo", year: "2024", ids: { tmdb: 550 }, playing: {}, positionMs: 600000, durationMs: 5400000, paused: false,
      seekStepMs: 10000, stats: { width: 1920, height: 1080, videoCodec: "avc1", bitrateKbps: 4200, bufferedMs: 18000, network: "wifi", stallsThisSession: 0 },
      device: "tv", lang: "es-CO", values: { video: {}, plugin: {} }, player: { seekStepMs: 10000, speed: 1, resize: "fit" },
    });
    assert.equal(seen([dir, "panel", "ref-1", "stats"]).tab, "stats");
    const over = seen(["--context", '{"kind":"episode","season":2,"device":"phone"}', dir, "panel", "ref-1"]);
    assert.deepEqual([over.kind, over.season, over.device, over.title], ["episode", 2, "phone", "Demo"]);
    assert.deepEqual(fakeContext("x"), seen([dir, "panel", "x"]));
    assert.equal(kit(["--context", "[1]", dir, "panel", "x"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("41 top-level elements: the 41st is dropped with the app's log text, the panel stays", () => {
  const dir = plugin(`export async function panel(){ return { elements: Array.from({ length: 41 }, (_, i) => ({ type: "text", text: "t" + i })) } }`);
  try {
    const r = kit([dir, "panel", "m"]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /^· dropped: panel: more than 40 top-level elements, the rest dropped$/m);
    assert.equal(r.json().elements.length, 40);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a panel that is not an object is invalid as a whole: exit 1", () => {
  const dir = plugin(`export async function panel(){ return "oops" }`);
  try {
    const r = kit([dir, "panel", "m"]);
    assert.equal(r.status, 1);
    assert.match(r.err, /· dropped: panel: the answer is not a JSON object/);
    assert.equal(r.out, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a 128x128 icon fails validate.mjs with the app's refusal; so do RGB, oversize and a missing file", async () => {
  const bad = { "128x128": png(128, 128, 6), "RGB (no alpha)": png(96, 96, 2), "over 24 KB": png(96, 96, 6, { pad: 24 * 1024 }) };
  for (const [name, bytes] of Object.entries(bad)) {
    const dir = plugin("export async function panel(){ return {} }", { panel: { label: "Demo", iconFile: "i.png" } });
    try {
      writeFileSync(join(dir, "i.png"), bytes);
      const r = await validate(dir);
      assert.equal(r.ok, false, name);
      assert.deepEqual(r.problems, [`i.png: ${ICON_REFUSAL}`], name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const missing = plugin("export async function panel(){ return {} }", { panel: { label: "Demo", iconFile: "i.png" } });
  try {
    assert.deepEqual((await validate(missing)).problems, ["Couldn't download the panel icon. i.png was not found"]);
    const cli = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), missing], { encoding: "utf8" });
    assert.equal(cli.status, 1);
  } finally { rmSync(missing, { recursive: true, force: true }); }
  // The accepted shapes: RGBA and grey + alpha at 96x96.
  assert.equal(panelIconProblem(png(96, 96, 6)), null);
  assert.equal(panelIconProblem(png(96, 96, 4)), null);
  assert.equal(panelIconProblem(png(96, 95, 6)), ICON_REFUSAL);
  assert.equal(panelIconProblem(Buffer.from("not a png at all, not even close to a png")), ICON_REFUSAL);
});

test("a settingsLayout naming an unknown or repeated key fails validate.mjs; hidden and enabled are ignored", async () => {
  const layout = (l) => plugin("export async function panel(){ return {} }", { settings: [{ key: "a", label: "A", type: "text" }], settingsLayout: l });
  const unknown = layout([{ setting: "a" }, { setting: "nope" }]);
  const twice = layout([{ setting: "a" }, { setting: "a" }]);
  const fine = layout([{ type: "row", hidden: true, enabled: false, children: [{ setting: "a" }] }]);
  try {
    assert.deepEqual((await validate(unknown)).problems, ['settingsLayout: unknown setting "nope" ignored']);
    assert.deepEqual((await validate(twice)).problems, ['settingsLayout: "a" placed twice, second ignored']);
    assert.deepEqual((await validate(fine)).problems, []);
    const m = validateManifest(readFileSync(join(fine, "kino-plugin.json"), "utf8")).manifest;
    const t = settingsLayout(m.settingsLayout, m.settings).tree;
    assert.deepEqual([t[0].hidden, t[0].enabled], [false, true]);
    assert.equal(validateManifest(manifestJson({ settingsLayout: { a: 1 } })).message, 'The "settingsLayout" field must be a list');
  } finally { for (const d of [unknown, twice, fine]) rmSync(d, { recursive: true, force: true }); }
});

test("manifest panel: label, labelEn, icon XOR iconFile, a safe .png, apiVersion 9 or ignored with a note", async () => {
  const bad = (panel) => validateManifest(manifestJson({ panel }));
  assert.equal(bad({ label: "" }).message, 'The "panel.label" field must be 1 to 24 characters');
  assert.equal(bad({ label: "x".repeat(25) }).message, 'The "panel.label" field must be 1 to 24 characters');
  assert.equal(bad({ label: "ok", labelEn: "x".repeat(25) }).message, 'The "panel.labelEn" field must be 1 to 24 characters');
  assert.equal(bad({ label: "ok", labelEn: 5 }).message, 'The "panel.labelEn" field must be 1 to 24 characters');
  assert.equal(bad({ label: "ok", icon: "star", iconFile: "a.png" }).message, 'The "panel" field takes "icon" or "iconFile", not both');
  for (const f of ["a.jpg", "../a.png", "/a.png", 7]) assert.equal(bad({ label: "ok", iconFile: f }).message, 'The "panel.iconFile" field must be a relative path to a .png', String(f));
  assert.equal(bad("x").message, 'The "panel" field must be an object with a "label"');
  assert.equal(bad({ label: " Hi ", iconFile: "./a.png" }).manifest.panel.iconFile, "a.png");
  const old = validateManifest(manifestJson({ apiVersion: 8, panel: { label: "" } }));
  assert.equal(old.ok, true);
  assert.equal(old.manifest.panel, null);
  const dir = plugin("", { apiVersion: 8, settingsLayout: [] });
  try {
    const r = await validate(dir);
    assert.ok(r.notes.includes('"panel" needs apiVersion 9 (Kino 0.9.55): at apiVersion 8 Kino ignores it'), r.notes.join("\n"));
    assert.ok(r.notes.includes('"settingsLayout" needs apiVersion 9 (Kino 0.9.55): at apiVersion 8 Kino ignores it'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // An unknown predefined icon draws "tune": a warning, not an error. A declared panel needs the panel export.
  const star = plugin("export async function panel(){ return {} }", { panel: { label: "Demo", icon: "star" } });
  const odd = plugin("", { panel: { label: "Demo", icon: "rocket" } });
  try {
    const ok = await validate(star);
    assert.deepEqual([ok.ok, ok.notes.filter((n) => n.startsWith("panel.icon"))], [true, []]);
    const r = await validate(odd);
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems, ['the plugin doesn\'t export panel: Kino refuses the install ("le falta panel")']);
    assert.ok(r.notes.some((n) => n.startsWith('panel.icon "rocket" is not a predefined icon: Kino draws "tune"')), r.notes.join("\n"));
  } finally { for (const d of [star, odd]) rmSync(d, { recursive: true, force: true }); }
  assert.deepEqual(requiredExports(["search"], [], { panel: { label: "x" } }), ["search", "panel"]);
});

test("Task 8v: the larger icon set (refresh first) is known from apiVersion 14; below it a name of it draws tune", async () => {
  assert.equal(PANEL_EXTRA_ICONS.apiVersion, 14);
  assert.equal(PANEL_EXTRA_ICONS.names[0], "refresh");
  assert.ok(PANEL_EXTRA_ICONS.names.every((n) => PANEL_ICONS.includes(n)));
  assert.ok(PANEL_ICONS.length <= 50 && new Set(PANEL_ICONS).size === PANEL_ICONS.length);
  assert.ok(PANEL_ICONS.every((n) => /^[a-z]+(_[a-z]+)*$/.test(n)), "names are lowercase snake_case");
  for (const n of PANEL_EXTRA_ICONS.names) assert.deepEqual([panelIconKnown(n, 13), panelIconKnown(n, 14)], [false, true], n);
  assert.deepEqual([panelIconKnown("star", 9), panelIconKnown("rocket", 14)], [true, false]);
  const old = plugin("export async function panel(){ return {} }", { panel: { label: "Demo", icon: "refresh" } });
  try {
    const r = await validate(old);
    assert.ok(r.notes.includes('panel.icon "refresh" needs apiVersion 14: at apiVersion 9 Kino draws "tune"'), r.notes.join("\n"));
  } finally { rmSync(old, { recursive: true, force: true }); }
});

test("panelAction gets (event, context): the event's key, trigger, values and value, the context after it", () => {
  const dir = plugin(`export async function panelAction(...args){ const [e, c] = args; return { values: { n: args.length, key: e.key, trigger: e.trigger, hasValue: "value" in e, value: e.value === undefined ? null : e.value, vals: JSON.stringify(e.values), ref: c.ref, tab: c.tab || "" } } }`);
  try {
    const press = kit([dir, "panelAction", "m9", "go", "press"]).json().values;
    assert.deepEqual(press, { n: 2, key: "go", trigger: "press", hasValue: false, value: null, vals: "{}", ref: "m9", tab: "" });
    const change = kit([dir, "panelAction", "m9", "audio", "change", '"es"', '{"audio":"en","x":true}']).json().values;
    assert.deepEqual([change.n, change.hasValue, change.value, change.vals], [2, true, "es", '{"audio":"en","x":true}']);
    assert.equal(kit([dir, "panelAction", "m9", "on", "change", "true"]).json().values.value, true);
    assert.equal(kit([dir, "panelAction", "m9", "go", "tap"]).status, 2);
    assert.equal(kit([dir, "panelAction", "m9", "go", "submit", "not json"]).status, 2);
    assert.equal(kit([dir, "panelAction", "m9", "go", "submit", "1", "[1]"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("playerEvent gets { type, ...detail } and (event, context); a valid message and player pass, a bad one is dropped", () => {
  const dir = plugin(`export async function playerEvent(e, c){ if (e.type === "failed") return { message: "https://evil.example", player: { speed: 3 } }; return { message: JSON.stringify([e, c.ref]).slice(0, 5) === "[{\\"ty" ? "Todo bien aquí" : "no", player: { speed: 1.5 } } }`);
  try {
    const ok = kit([dir, "playerEvent", "m", "copyChanged", '{"label":"HD","automatic":true,"kind":"network"}']);
    assert.equal(ok.status, 0, ok.err);
    assert.deepEqual(ok.json(), { player: { speed: 1.5 }, message: "Todo bien aquí" });
    const failed = kit([dir, "playerEvent", "m", "failed", '{"kind":"network"}']);
    assert.deepEqual(failed.json(), {});
    assert.match(failed.err, /^· dropped: playerEvent: player.speed 3.0 is not one of \[0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0\], dropped$/m);
    assert.match(failed.err, /^· dropped: playerEvent: message fails the userMessage safety rules, dropped$/m);
    assert.equal(kit([dir, "playerEvent", "m", "exploded"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const echo = plugin(`export async function playerEvent(e){ return { message: "Evento " + Object.keys(e).join(" ") } }`);
  try {
    assert.equal(kit([echo, "playerEvent", "m", "failed", '{"kind":"network"}']).json().message, "Evento type kind");
  } finally { rmSync(echo, { recursive: true, force: true }); }
});

test("the player rules: autoNext {enabled:false} without countdownS is accepted; seek, step, speed, resize, markers follow the app", () => {
  const off = answer({ player: { autoNext: { enabled: false } } });
  assert.deepEqual(off.a.player, { autoNext: { enabled: false, countdownS: 0 } });
  assert.deepEqual(off.drops, []);
  const on = answer({ player: { autoNext: { enabled: true } } });
  assert.equal(on.a.player, null);
  assert.deepEqual(on.drops, ["panel: player.autoNext needs a countdownS number, dropped"]);
  const many = answer({ player: { autoNext: { enabled: true, countdownS: 99, nextRef: "n1" } } });
  assert.deepEqual(many.a.player.autoNext, { enabled: true, countdownS: 30, nextRef: "n1" });
  assert.deepEqual(many.drops, ["panel: player.autoNext countdownS 99.0 clamped to 30"]);
  assert.deepEqual(answer({ player: { autoNext: { countdownS: 5 } } }).drops, ["panel: player.autoNext needs enabled true or false, dropped"]);

  const seek = answer({ player: { seekToMs: -5, seekStepMs: 1000, speed: 1.25, resize: "21:9" } });
  assert.deepEqual(seek.a.player, { seekToMs: 0, seekStepMs: 5000, speed: 1.25, resize: "21:9" });
  assert.deepEqual(seek.drops, ["panel: player.seekToMs -5.0 clamped to 0", "panel: player.seekStepMs 1000.0 clamped to 5000 (whole seconds in 5000..120000)"]);
  assert.equal(answer({ player: { seekStepMs: 12500 } }).a.player.seekStepMs, 12000);
  const bad = answer({ player: { speed: "fast", resize: "stretch", skip: { openingEndMs: -1 }, wat: 1, markers: "x" } });
  assert.equal(bad.a.player, null);
  assert.deepEqual(bad.drops, [
    "panel: player.wat is not available in this Kino", "panel: player.speed is not a number, dropped",
    'panel: player.resize "stretch" is not a resize mode, dropped', "panel: player.skip has nothing usable, dropped", "panel: player.markers is not an array, dropped",
  ]);
  assert.deepEqual(answer({ player: { skip: { openingStartMs: 1000, openingEndMs: 90000 } } }).a.player.skip, { openingStartMs: 1000, openingEndMs: 90000, endingStartMs: null });

  const marks = answer({ player: { markers: [{ atMs: 9, label: "b" }, { atMs: 1, label: "a".repeat(30) }, { atMs: -1, label: "x" }, { atMs: 5 }, 7] } });
  assert.deepEqual(marks.a.player.markers, [{ atMs: 1, label: "a".repeat(24) }, { atMs: 9, label: "b" }]);
  assert.deepEqual(marks.drops, ["panel: player.markers #1 label cut to 24", "panel: player.markers #2 out of range, dropped", "panel: player.markers #3 has no label, dropped", "panel: player.markers #4 is not an object, dropped"]);
  const thirtyOne = answer({ player: { markers: Array.from({ length: 31 }, (_, i) => ({ atMs: i, label: "m" })) } });
  assert.equal(thirtyOne.a.player.markers.length, 30);
  assert.deepEqual(thirtyOne.drops, ["panel: player.markers keeps 30, the rest dropped"]);
});

test("the player gate clamps seekToMs and markers again with the real duration, and ignores a seek on live", () => {
  const dir = plugin(`export async function panelAction(){ return { player: { seekToMs: 9e9, markers: [{ atMs: 6000000, label: "late" }, { atMs: 1000, label: "ok" }] } } }`);
  try {
    const r = kit([dir, "panelAction", "m", "k", "press"]);
    assert.deepEqual(r.json().player, { seekToMs: 5400000, markers: [{ atMs: 1000, label: "ok" }] });
    assert.match(r.err, /^· dropped: panel: player.seekToMs 9.0E9 clamped to 5400000$/m);
    assert.match(r.err, /^· dropped: panel: player.markers #1 out of range, dropped$/m);
    const live = kit(["--context", '{"kind":"live"}', dir, "panelAction", "m", "k", "press"]);
    assert.deepEqual(live.json().player, { markers: [{ atMs: 1000, label: "ok" }, { atMs: 6000000, label: "late" }] });
    assert.match(live.err, /^· dropped: panel: player.seekToMs ignored on a live stream$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ai and chat are dropped as 'needs a newer Kino'; unknown types and bad scopes are dropped with the app's lines", () => {
  const r = check({ elements: [
    { type: "ai", prompt: "x" }, { type: "chat" }, { type: "hologram" }, { type: "text", text: "kept" },
    { type: "toggle", key: "t", label: "T", scope: "device" },
  ] });
  assert.deepEqual(r.panel.elements.map((n) => n.leaf.text), ["kept"]);
  assert.deepEqual(r.drops, [
    'panel: element type "ai" needs a newer Kino', 'panel: element type "chat" needs a newer Kino', "panel: unknown element type",
    'panel: toggle scope "device" is not video or plugin, dropped',
  ]);
});

test("element rules: keys, labels, options, text lengths, qr and image urls", () => {
  const leaf = (el, over) => { const r = check({ elements: [el] }, over); return { el: r.panel.elements[0]?.leaf, drops: r.drops }; };
  assert.deepEqual(leaf({ type: "button", key: "b", label: "x".repeat(41) }).drops, ['panel: button "b" needs a label of 1 to 40 characters, dropped']);
  assert.deepEqual(leaf({ type: "text-input", key: "k", label: "L", placeholder: "p".repeat(50), hint: "h".repeat(90) }).el, { type: "text-input", key: "k", label: "L", scope: "plugin", hint: "h".repeat(80), placeholder: "p".repeat(40) });
  assert.deepEqual(leaf({ type: "button", key: "bad key", label: "L" }).drops, ["panel: button needs a valid key, dropped"]);
  assert.deepEqual(leaf({ type: "button", key: "b", label: "L", confirm: "c".repeat(161) }).drops, ["panel: button confirm longer than 160, dropped"]);
  assert.deepEqual(leaf({ type: "button", key: "b", label: "L", labelEn: "Go" }, { lang: "en" }).el.label, "Go");
  const dup = check({ elements: [{ type: "button", key: "a", label: "A" }, { type: "toggle", key: "a", label: "A2" }] });
  assert.equal(dup.panel.elements.length, 1);
  assert.deepEqual(dup.drops, ['panel: toggle duplicate key "a", dropped']);
  const noOptions = leaf({ type: "select", key: "s", label: "S", options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] });
  assert.deepEqual(noOptions.drops, ["panel: select needs 1 to 20 valid, distinct options, dropped"]);
  assert.deepEqual(leaf({ type: "section", title: "" }).drops, ["panel: section needs a title, dropped"]);
  assert.deepEqual(leaf({ type: "status", text: "s".repeat(300) }).el.text.length, 200);
  assert.deepEqual(leaf({ type: "image", url: "https://example.com/a.png", alt: "a".repeat(300) }).el.alt.length, 200);
  assert.deepEqual(leaf({ type: "image", url: "http://example.com/a.png" }).drops, ["panel: image is not https, dropped"]);
  assert.deepEqual(leaf({ type: "image", url: "https://192.168.1.5/a.png" }).drops, ["panel: image is not https, dropped"]);
  assert.deepEqual(leaf({ type: "episodes", ref: "" }).drops, ["panel: episodes needs a valid ref, dropped"]);
  const qrDrop = "panel: qr url is not a public https URL of at most 512 characters, dropped";
  for (const url of ["http://example.com/x", "https://localhost/x", "https://192.168.1.2/x", "https://nas.local/x", "https://[::1]/x", "https://127.0.0.%31/x", "https://%6cocalhost/x", "https://bad%zz.example/x", "https://router/x", "https://nas/", "https://router./x", "https://%72outer/x", "https://intranet:8443/x", `https://example.com/${"a".repeat(512)}`, 5]) {
    assert.deepEqual(leaf({ type: "qr", url }).drops, [qrDrop], String(url).slice(0, 30));
  }
  assert.equal(leaf({ type: "qr", url: "https://8.8.8.8/x", label: "Scan" }).el.label, "Scan");
  assert.equal(leaf({ type: "qr", url: "https://pay.example.com/x", label: "Pay" }).el.url, "https://pay.example.com/x");
});

test("one answer logs at most 10 problems, then one summary line, its parts and layout sharing the count", () => {
  const values = Object.fromEntries(Array.from({ length: 100000 }, (_, i) => [`bad key ${i}`, 1]));
  const flood = answer({ values });
  assert.equal(flood.drops.length, 11);
  assert.equal(flood.drops[10], "panel: 99990 more problems not logged");
  const tabs = Array.from({ length: 8 }, (_, i) => ({ id: `bad id ${i}`, label: "x" }));
  const els = Array.from({ length: 8 }, () => ({ type: "text", text: "" }));
  const player = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`nope${i}`, 1]));
  const mixed = answer({ panel: { title: "T", tabs, elements: els }, save: [1, 2, 3, 4, 5, 6, 7, 8], player });
  assert.equal(mixed.drops.length, 11);
  assert.equal(mixed.drops[10], "panel: 22 more problems not logged");
  assert.equal(check({ elements: [{ type: "text", text: "" }, { type: "rocket" }] }).drops.length, 2);
});

test("validate.mjs fails on every unknown settingsLayout key, also past the 10 lines the app logs", async () => {
  const keys = Array.from({ length: 15 }, (_, i) => ({ setting: `nope${i}` }));
  const dir = plugin("export async function panel(){ return {} }", { settings: [{ key: "a", label: "A", type: "text" }], settingsLayout: keys });
  try {
    const problems = (await validate(dir)).problems;
    assert.equal(problems.length, 15);
    assert.equal(problems[14], 'settingsLayout: unknown setting "nope14" ignored');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("layout rules: 6 children per row, depth 4, col weight 1..12, 120 nodes, log capped at 10 lines", () => {
  const six = check({ elements: [{ type: "row", children: Array.from({ length: 7 }, (_, i) => ({ type: "text", text: `t${i}` })) }] });
  assert.equal(six.panel.elements[0].children.length, 6);
  assert.deepEqual(six.drops, ["layout: a row keeps 6 children, the rest dropped"]);
  const deep = { type: "card", children: [{ type: "card", children: [{ type: "card", children: [{ type: "card", children: [{ type: "card", children: [{ type: "text", text: "x" }] }] }] }] }] };
  assert.deepEqual(check({ elements: [deep] }).drops, ["layout: deeper than 4, dropped"]);
  const weight = check({ elements: [{ type: "col", weight: 13, children: [] }, { type: "col", weight: 12 }] });
  assert.deepEqual(weight.panel.elements.map((n) => n.weight), [1, 12]);
  assert.deepEqual(weight.drops, ["layout: col weight 13 outside 1..12, using 1"]);
  const budget = check({ elements: Array.from({ length: 3 }, () => ({ type: "card", children: Array.from({ length: 6 }, () => ({ type: "row", children: Array.from({ length: 6 }, (_, i) => ({ type: "status", text: `s${i}` })) })) })) });
  assert.ok(budget.drops.includes("layout: more than 120 elements, the rest dropped"), budget.drops.join("\n"));
  const flood = check({ elements: Array.from({ length: 25 }, () => ({ type: "text", text: "" })) });
  assert.equal(flood.drops.length, 11);
  assert.equal(flood.drops[10], "panel: 15 more problems not logged");
  assert.deepEqual(check({ elements: [{ type: "card", title: "t".repeat(70), children: [], style: "filled", hidden: true }] }).panel.elements[0], { type: "card", title: "t".repeat(60), style: "filled", children: [], enabled: true, hidden: true });
});

test("panel fields: tabs, tab, accent, refresh, title, presentation", () => {
  const r = check({
    title: "T".repeat(70), titleEn: "English", presentation: "panel", accent: "#2E7D32", refreshMs: 500,
    tabs: [{ id: "a", label: "x".repeat(30) }, { id: "a", label: "dup" }, { id: "bad id", label: "x" }, { id: "c" }, ...Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, label: "L" }))],
    tab: "zzz", elements: [],
  });
  assert.deepEqual(r.panel.tabs.map((t) => t.id), ["a", "t0", "t1", "t2", "t3", "t4"]);
  assert.equal(r.panel.tabs[0].label.length, 24);
  assert.deepEqual([r.panel.tab, r.panel.title.length, r.panel.presentation, r.panel.refreshMs, r.panel.accent], ["a", 60, "panel", 2000, "#2E7D32"]);
  for (const line of ["panel: tab 2 has an invalid id", "panel: duplicate tab a dropped", "panel: tab c has no label", "panel: tabs beyond 6 dropped", 'panel: tab "zzz" names no tab', "panel: refreshMs 500.0 clamped to 2000"]) assert.ok(r.drops.includes(line), `${line}\n${r.drops.join("\n")}`);
  assert.equal(check({ title: "Hola", titleEn: "Hello", elements: [] }, { lang: "en" }).panel.title, "Hello");
  const bad = check({ accent: "#E50914", refreshMs: "soon", elements: [] });
  assert.deepEqual([bad.panel.accent, bad.panel.refreshMs], [null, null]);
  assert.deepEqual(bad.drops, ['panel: accent "#E50914" fails the theme accent rules, Kino\'s colors used', "panel: refreshMs is not a number, dropped"]);
});

test("answer fields: patch, values, save, focus, message", () => {
  const a = answer({
    patch: { b: { type: "button", key: "b", label: "Go" }, "bad key": { type: "text", text: "x" }, n: 5, dup: { type: "button", key: "b", label: "again" } },
    values: { a: "x".repeat(501), b: true, c: null, d: 4, e: { x: 1 }, "bad key": 1 },
    save: ["a", "a", 5, "bad key"], focus: "b", message: "Todo listo ya",
  });
  assert.deepEqual(Object.keys(a.a.patch), ["b"]);
  assert.deepEqual(a.a.values, { b: true, c: null, d: 4 });
  assert.deepEqual(a.a.save, ["a"]);
  assert.deepEqual([a.a.focus, a.a.message], ["b", "Todo listo ya"]);
  assert.deepEqual(a.drops, [
    "panel: patch key is not a valid key, dropped", 'panel: patch "n" is not an element, dropped', 'panel: button duplicate key "b", dropped',
    'panel: values "a" longer than 500, dropped', 'panel: values "e" is not a string, boolean, number or null, dropped', "panel: values key is not a valid key, dropped",
    "panel: save #2 is not a valid key, dropped", "panel: save #3 is not a valid key, dropped",
  ]);
  assert.deepEqual(answer(null).a, { panel: null, patch: {}, values: {}, save: [], focus: null, message: null, player: null, go: null, pause: false });
  assert.deepEqual(answer("x").drops, ["panel: the action answer is not a JSON object"]);
  assert.deepEqual(answer({ panel: 3, patch: 1, values: [], save: "s", focus: "no good", message: 9 }).drops, [
    "panel: answer.panel is not an object, dropped", "panel: patch is not an object, dropped", "panel: values is not an object, dropped",
    "panel: save is not an array, dropped", "panel: focus is not a valid key, dropped", "panel: message is not a string, dropped",
  ]);
  const caps = answer({ patch: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, { type: "text", text: "t" }])), values: Object.fromEntries(Array.from({ length: 121 }, (_, i) => [`v${i}`, i])), save: Array.from({ length: 51 }, (_, i) => `s${i}`) });
  assert.deepEqual(caps.drops, ["panel: patch keeps 40 keys, the rest dropped", "panel: values keeps 120 keys, the rest dropped", "panel: save keeps 50 keys, the rest dropped"]);
  assert.deepEqual(answer({ message: "visit https://x.example now" }).drops, ["panel: message fails the userMessage safety rules, dropped"]);
  assert.equal(answer({ panel: { elements: [{ type: "text", text: "in answer" }] } }).a.panel.elements.length, 1);
});

test("checkPanelOutput: the three functions, and a too-large answer is refused", () => {
  assert.equal(checkPanelOutput("panel", { elements: [] }).ok, true);
  assert.equal(checkPanelOutput("panel", null).ok, false);
  assert.deepEqual(checkPanelOutput("panelAction", undefined).value, {});
  assert.throws(() => checkPanelOutput("panel", { x: "y".repeat(2_000_001) }), /too large/);
  assert.throws(() => checkPanelOutput("nope", {}), /unknown panel function/);
});

test("a live context has no durationMs, the demo's panelAction and playerEvent run, and a patch is noted", () => {
  assert.equal("durationMs" in fakeContext("x", { kind: "live" }), false);
  assert.equal("durationMs" in fakeContext("x"), true);
  const jump = kit([demo, "panelAction", "m1", "jump", "press"]);
  assert.equal(jump.status, 0, jump.err);
  assert.equal(jump.json().player.seekToMs, 610000);
  assert.equal(jump.err, "");
  const ended = kit([demo, "playerEvent", "m1", "ended"]);
  assert.equal(ended.status, 0, ended.err);
  assert.deepEqual(ended.json().player, { autoNext: { enabled: true, countdownS: 5 } });
  const submit = kit([demo, "panelAction", "m1", "note", "submit", '"hi"']);
  assert.match(submit.err, /^· a patch is applied by Kino only to a key that is on screen/m);
});

test("playerEvent on a plugin without that export says Kino never calls it; a slow export times out", async () => {
  const dir = plugin("");
  try {
    const r = kit([dir, "playerEvent", "m", "started"]);
    assert.equal(r.status, 2);
    assert.match(r.err, /does not export playerEvent\(\): Kino never calls this plugin for player events/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  await assert.rejects(callPanel({ panel: () => new Promise(() => {}) }, "panel", { context: {} }, 20), /panel did not answer within 0.02 s/);
});

test("playerEvent answers relabel the gate's lines as playerEvent:, and a patch keeps its insertion order", () => {
  const dir = plugin(`export async function playerEvent(){ return { player: { seekToMs: -1, markers: [{ atMs: 9e9, label: "x" }] } } }`);
  try {
    const r = kit([dir, "playerEvent", "m", "paused"]);
    assert.match(r.err, /^· dropped: playerEvent: player.seekToMs -1.0 clamped to 0$/m);
    assert.match(r.err, /^· dropped: playerEvent: player.markers #0 out of range, dropped$/m);
    assert.doesNotMatch(r.err, /dropped: panel:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const t = (k) => ({ type: "text", text: k });
  assert.deepEqual(Object.keys(answer({ patch: { zeta: t("z"), alpha: t("a"), mid: t("m") } }).a.patch), ["zeta", "alpha", "mid"]);
});

test("panel go.screen (Task 7g): an answer and a button open this plugin's own screen, nothing else", () => {
  const ok = answer({ go: { screen: { route: "news", args: { id: "7" } } }, pause: true });
  assert.deepEqual(ok.a.go, { route: "news", args: { id: "7" } });
  assert.equal(ok.a.pause, true);
  assert.deepEqual(ok.drops, []);
  assert.equal(answer({ go: { screen: {} } }).a.pause, false);
  const bad = answer({ go: { title: { ref: "r", kind: "movie" } } });
  assert.equal(bad.a.go, null);
  assert.deepEqual(bad.drops, ["panel: answer go must be {screen: {route, args}} or {titleByIds: {...}} or {url: {href, title}} or {copy: {text, label}}, dropped"]);
  const badRoute = answer({ go: { screen: { route: "https://x.example.com" } } });
  assert.deepEqual(badRoute.drops, ["panel: answer go.screen route must be 1 to 64 letters, digits or . _ ~ -, dropped"]);
  const p = check({ title: "P", elements: [
    { type: "button", key: "open", label: "Abrir", go: { screen: { route: "tabs" } }, pause: true },
    { type: "button", key: "plain", label: "Otro", pause: true },
    { type: "button", key: "bad", label: "Malo", go: { url: "https://x.example.com" } },
  ] });
  const buttons = p.panel.elements.map((n) => n.leaf);
  assert.deepEqual(buttons[0], { type: "button", key: "open", label: "Abrir", go: { route: "tabs" }, pause: true });
  assert.deepEqual(buttons[1], { type: "button", key: "plain", label: "Otro" });
  assert.deepEqual(buttons[2], { type: "button", key: "bad", label: "Malo" });
  assert.deepEqual(p.drops, ['panel: button "bad" go must be {screen: {route, args}}, dropped']);
});

test("panel go.titleByIds (Task 8m): an answer opens Kino's own title page by ids, a ref or a bad id drops it", () => {
  const ok = answer({ go: { titleByIds: { tmdb: 603, kind: "movie", title: " Matrix " } } });
  assert.equal(ok.a.go, null);
  assert.deepEqual(ok.a.titleByIds, { kind: "movie", tmdb: 603, title: "Matrix" });
  assert.deepEqual(ok.drops, []);
  const ref = answer({ go: { titleByIds: { tmdb: 603, kind: "movie", ref: "x" } } });
  assert.equal(ref.a.titleByIds, null);
  assert.deepEqual(ref.drops, ["panel: answer go.titleByIds takes only tmdb, imdb, kind, season, episode, title, year, dropped"]);
  const noIds = answer({ go: { titleByIds: { kind: "series" } } });
  assert.deepEqual(noIds.drops, ["panel: answer go.titleByIds needs tmdb or imdb, dropped"]);
  // A button never carries it (a button's go is its own screen only).
  const p = check({ title: "P", elements: [{ type: "button", key: "ids", label: "Abrir", go: { titleByIds: { tmdb: 603, kind: "movie" } } }] });
  assert.deepEqual(p.drops, ['panel: button "ids" go must be {screen: {route, args}}, dropped']);
});

test("panel go.url (Task 8s): an answer asks Kino to open a link, a bad href drops it, a button never carries it", () => {
  const ok = answer({ go: { url: { href: "HTTPS://News.Example.com/n/1?a=b", title: " Ver noticia " } } });
  assert.equal(ok.a.go, null);
  assert.equal(ok.a.titleByIds, null);
  assert.deepEqual(ok.a.url, { href: "https://news.example.com/n/1?a=b", title: "Ver noticia" });
  assert.deepEqual(ok.drops, []);
  const http = answer({ go: { url: { href: "http://news.example.com/" } } });
  assert.equal(http.a.url, null);
  assert.deepEqual(http.drops, ["panel: answer go.url href must be an https address, dropped"]);
  const secret = answer({ go: { url: { href: "https://me:s3cret@news.example.com/private?token=abc" } } });
  assert.deepEqual(secret.drops, ["panel: answer go.url href must not carry a user name or password, dropped"]);
  assert.ok(!secret.drops.join(" ").includes("s3cret") && !secret.drops.join(" ").includes("token"));
  const p = check({ title: "P", elements: [{ type: "button", key: "u", label: "Abrir", go: { url: { href: "https://news.example.com/" } } }] });
  assert.deepEqual(p.drops, ['panel: button "u" go must be {screen: {route, args}}, dropped']);
});

test("panel go.copy (Task 8x): an answer asks Kino to copy a text, a bad one drops it, a button never carries it", () => {
  const ok = answer({ go: { copy: { text: " Sala: luna\n4821 ", label: "Invitación", sensitive: true } } });
  assert.equal(ok.a.go, null);
  assert.deepEqual(ok.a.copy, { text: "Sala: luna\n4821", label: "Invitación", sensitive: true });
  assert.deepEqual(ok.drops, []);
  const empty = answer({ go: { copy: { text: "" } } });
  assert.equal(empty.a.copy, null);
  assert.deepEqual(empty.drops, ["panel: answer go.copy text must be 1 to 500 characters, dropped"]);
  const p = check({ title: "P", elements: [{ type: "button", key: "c", label: "Copiar", go: { copy: { text: "x" } } }] });
  assert.deepEqual(p.drops, ['panel: button "c" go must be {screen: {route, args}}, dropped']);
});