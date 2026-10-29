// Plugin screens (apiVersion 14) in the Node kit: screen.mjs against the case table the Kotlin test also reads
// (screen-cases.json: same verdicts, same log lines), run.mjs's `screen` / `screenEvent`, and the manifest's `screen` block.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contract, requiredExports, validateManifest } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { answerFields, checkPanelScreen, checkPanelScreenAnswer, isPanelScreen, panelAnswerFields, checkScreenAnswer, checkScreenForm, checkScreenTimers, checkScreenTree, childNodes, countNodes, countTitles, keepsAddresses, matchesPattern, printScreenTree, titleItems, fakeScreenContext, fakeScreenEvent, resolveResponsive, stepperNormalize, stepperText, unsafePattern } from "../screen.mjs";
import { validate } from "../validate.mjs";
import { SCREEN_EVENT_TRIGGERS, screenEventIsPress } from "../run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const run = join(here, "..", "run.mjs");
const demo = join(here, "screen-demo");
/** Every title's poster in [n], in tree order (the shared table's optional summary.posters). */
const posters = (n) => [...titleItems(n).map((i) => i.poster), ...childNodes(n).flatMap(posters)];
const cases = JSON.parse(readFileSync(join(here, "screen-cases.json"), "utf8"));
/** Every bound field's setting key by field key, in tree order (the shared table's optional summary.binds). */
const binds = (n) => Object.assign(n.field?.bind ? { [n.key]: n.field.bind } : {}, ...childNodes(n).map(binds));
/** Every `settings` node's keys (null: all of them), in tree order (the shared table's optional summary.settingsNodes). */
const settingsNodes = (n) => [...(n.type === "settings" ? [n.keys] : []), ...childNodes(n).flatMap(settingsNodes)];

function kit(args) {
  const r = spawnSync(process.execPath, [run, ...args], { encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

const QUIET = "export async function screen(){return {type:\"col\"}}\nexport async function screenEvent(){return null}\n";

/** A copy of the demo with [manifest] merged over its manifest (undefined removes a field) and [source] (when given) as its entry. */
function variant(manifest, source) {
  const dir = mkdtempSync(join(tmpdir(), "kino-screen-"));
  cpSync(demo, dir, { recursive: true });
  const m = { ...JSON.parse(readFileSync(join(demo, "kino-plugin.json"), "utf8")), ...manifest };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(m));
  if (source !== undefined) writeFileSync(join(dir, "plugin.js"), source);
  return dir;
}

async function withVariant(manifest, source, body) {
  const dir = variant(manifest, source);
  try { return await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- Kino's own components and pop-ups (beyond the shared table) ----------

const homeItem = (i, extra = {}) => ({ id: `t${i}`, ref: `r${i}`, title: `T${i}`, kind: "movie", ...extra });
const rail = (n, from) => ({ type: "titleRail", title: "R", items: Array.from({ length: n }, (_, i) => homeItem(from + i)) });

test("titles: a tree keeps maxTitles in all, logged once, like the app", () => {
  const r = checkScreenTree({ type: "col", children: [rail(500, 0), rail(450, 500), rail(100, 950), rail(5, 2000)] });
  assert.equal(contract.manifest.screen.limits.maxTitles, 1000);
  assert.equal(countTitles(r.tree), 1000);
  assert.deepEqual(r.dropped, ["screen: more than 1000 titles, the rest dropped", "screen: titleRail needs 1 to 500 valid items, dropped"]);
});

test("titleCard: without onTap it opens the title's page; its own onTap wins", () => {
  const card = checkScreenTree({ type: "titleCard", item: homeItem(1, { kind: "series" }) }).tree;
  assert.deepEqual(card.onTap, { ui: [], event: null, go: { title: { ref: "r1", kind: "series", id: "t1" } } });
  assert.equal(card.item.title, "T1");
  assert.equal(card.size, "medium");
  const own = checkScreenTree({ type: "titleCard", item: homeItem(1), onTap: "pick", arg: "1" }).tree;
  assert.deepEqual(own.onTap.event, { name: "pick", arg: "1" });
});

test("popup: open and close are ui operations; a declared menu keeps its items' actions", () => {
  const r = checkScreenTree({ type: "col", children: [
    { type: "button", label: "Más", onTap: { ui: [{ open: "m" }] } },
    { type: "popup", key: "m", kind: "menu", title: "Acciones", items: [{ label: "Compartir", icon: "star", onTap: "share", arg: "x" }, { label: "Ir", onTap: { go: { section: true } } }] },
  ] });
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.tree.children[0].onTap.ui, [{ open: "m" }]);
  const m = r.tree.children[1];
  assert.equal(m.kind, "menu");
  assert.deepEqual(m.items.map((i) => [i.label, i.icon, i.onTap.event?.name ?? null, i.onTap.go]), [["Compartir", "star", "share", null], ["Ir", null, null, { section: true }]]);
});

// ---------- forms (beyond the shared table) ----------

const field = (key, extra = {}) => ({ type: "textInput", key, label: key, ...extra });

test("form: the submit button's tap is the form's submit, its own onTap and the fields' rules as the app keeps them", () => {
  const r = checkScreenTree({ type: "form", key: "f", onSubmit: { event: "send", arg: "1" }, children: [
    field("name", { required: true, minLength: 2, errorText: "Tu nombre", errorTextEn: "Your name" }),
    { type: "chips", key: "c", multiple: true, maxLength: 2, options: [{ value: "x", label: "X" }] },
    { type: "button", key: "go", label: "Enviar", submit: true },
  ] }, "en");
  assert.deepEqual(r.dropped, []);
  const [name, chips, button] = r.tree.children;
  assert.deepEqual(r.tree.onSubmit, { ui: [], event: { name: "send", arg: "1" }, go: null });
  assert.deepEqual(name.field, { required: true, minLength: 2, maxLength: null, pattern: null, errorText: "Your name" });
  assert.deepEqual(chips.field, { required: false, minLength: null, maxLength: 2, pattern: null, errorText: null });
  assert.equal(button.submitsForm, "f");
  assert.deepEqual(button.onTap, { ui: [], event: null, go: null, submit: "f" });
  // A field with no rules prints without them.
  assert.equal(printScreenTree(checkScreenTree(field("q")).tree).field, undefined);
});

test("form: no password kind, in a form or not", () => {
  const r = checkScreenTree({ type: "form", onSubmit: "send", children: [field("pw", { kind: "password", required: true })] });
  assert.deepEqual(r.dropped, ["screen: textInput kind \"password\" is not text, number, email, url, search, dropped"]);
  assert.deepEqual(r.tree.children, []);
  assert.ok(!contract.manifest.screen.inputKinds.includes("password"));
});

test("patterns: the safe subset, matched against the whole value", () => {
  assert.equal(unsafePattern("\\d{3}-\\d{4}"), null);
  assert.ok(matchesPattern("\\d{3}-\\d{4}", "555-1234"));
  assert.ok(!matchesPattern("\\d{3}-\\d{4}", "x555-1234"), "the whole value, not a part");
  assert.ok(!matchesPattern("a|b", "ab"), "alternation is anchored as a whole");
  assert.equal(unsafePattern("(a+)+"), null, "quantifiers nest freely");
  assert.equal(unsafePattern("(a|b)*"), null);
  assert.equal(unsafePattern("(\\d)\\1"), "has a backreference");
  assert.equal(unsafePattern("a{499}"), null, "499 steps and the final match: at the cap");
  assert.equal(unsafePattern("a{500}"), "is too large once expanded (over 500 steps)");
  assert.equal(unsafePattern("a{1001}"), "repeats more than 1000 times");
  assert.ok(!matchesPattern("(\\d)\\1", "11"), "a refused pattern never matches");
});

test("patterns: Kino's own matcher never hangs, not even on shapes that are catastrophic for a backtracking engine", () => {
  const long = (unit, times, then = "") => unit.repeat(times) + then;
  for (const [p, v] of [["(a|a)*", long("a", 1999, "b")], ["(\\d|\\w)*", long("1", 1999, "!")], ["(?:a|ab)*c", long("ab", 999, "a")],
    ["(a|aa){1,50}b", long("a", 2000)], ["\\d*\\d*\\d*\\d*\\d*\\d*!", long("1", 2000)], ["(a+)+b", long("a", 2000)], [".*.*.*.*.*.*.*.*=", long("x", 2000)]]) {
    const started = performance.now();
    assert.equal(matchesPattern(p, v), false, p);
    assert.ok(performance.now() - started < 1000, `${p} took ${performance.now() - started} ms`);
  }
});

test("patterns: a node that costs no step, counted over and over, compiles at once", () => {
  for (const p of ["((((){1000}){1000}){1000}){1000}", "((a{0}){1000}){1000}", "((((?:){1000}){1000}){1000}){1000}", "(((a{0}){1000}){1000}){1000}x"]) {
    const started = performance.now();
    assert.equal(unsafePattern(p), null, p);
    assert.ok(performance.now() - started < 100, `${p} took ${performance.now() - started} ms`);
  }
  assert.equal(unsafePattern("((|){1000}){1000}"), "is too large once expanded (over 500 steps)");
});

test("patterns: a whole submit of 16 fields with a big class in 160 loops on 2000 characters is bounded", () => {
  const members = Array.from({ length: 170 }, (_, i) => String.fromCharCode(0x100 + i)).join("");
  const p = `([^${members}]*){160}`;
  const { tree } = checkScreenTree({ type: "form", key: "f", onSubmit: "s", children: Array.from({ length: 16 }, (_, i) => field(`p${i}`, { pattern: p, value: "a".repeat(2000) })) });
  checkScreenForm(tree, "f"); // warm-up
  const started = performance.now();
  const r = checkScreenForm(tree, "f");
  assert.ok(performance.now() - started < 500, `the whole submit took ${performance.now() - started} ms`);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.dropped, ["screen: a form's patterns took over 4000000 steps, the rest not checked"]);
});

test("checkScreenForm: errors in tree order, values by key; no form, null", () => {
  const { tree } = checkScreenTree({ type: "form", key: "f", onSubmit: "send", children: [
    field("a", { required: true }), field("b", { pattern: "\\d+", value: "x" }), { type: "toggle", key: "t", value: true },
  ] });
  assert.deepEqual(checkScreenForm(tree, "f"), {
    errors: [{ key: "a", check: "required", limit: null }, { key: "b", check: "pattern", limit: null }],
    value: { a: "", b: "x", t: true },
    secrets: [],
    dropped: [],
  });
  assert.equal(checkScreenForm(tree, "nope"), null);
});

test("screen asks: a secret field is checked on its typed text but never in the form's value", () => {
  const { tree, dropped } = checkScreenTree({ type: "Form", key: "f", onSubmitted: "next", children: [
    { type: "TextField", key: "u", value: "ana" }, { type: "TextField", key: "p", obscureText: true, required: true },
  ] });
  assert.deepEqual(dropped, []);
  assert.equal(tree.children[1].secret, true);
  assert.equal(tree.children[1].value, "");
  const r = checkScreenForm(tree, "f");
  assert.deepEqual(r.value, { u: "ana" });
  assert.deepEqual(r.secrets, ["p"]);
  assert.deepEqual(r.errors, [{ key: "p", check: "required", limit: null }]);
});

// ---------- settings in the screen (beyond the shared table) ----------

const SETTINGS = [
  { key: "autoplay", type: "toggle", label: "Auto" },
  { key: "city", type: "text", label: "Ciudad" },
  { key: "quality", type: "select", label: "Calidad", options: [{ value: "hd", label: "HD" }, { value: "sd", label: "SD" }] },
  { key: "token", type: "password", label: "Clave" },
];

test("answer.config: at most maxConfigKeys keys, sorted, the first ones kept, like the app", () => {
  assert.equal(contract.manifest.screen.limits.maxConfigKeys, 32);
  const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${String(i + 1).padStart(2, "0")}`, type: "toggle", label: "K" }));
  const config = Object.fromEntries([...many].reverse().map((s) => [s.key, true]));
  const r = checkScreenAnswer({ config }, "es", { settings: many });
  assert.deepEqual(Object.keys(r.answer.config), many.slice(0, 32).map((s) => s.key));
  assert.deepEqual(r.dropped, ["screen: answer.config has 40 keys, the first 32 kept"]);
  // No settings given: nothing is written.
  assert.equal(checkScreenAnswer({ config: { city: "x" } }).answer.config, null);
});

test("bind: kept on every input that can hold the setting, the field otherwise untouched", () => {
  const r = checkScreenTree({ type: "col", children: [
    { type: "slider", key: "s", bind: "city" },
    { type: "toggle", key: "t", bind: "autoplay", required: true },
    { type: "dropdown", key: "d", bind: "token", options: [{ value: "a", label: "A" }] },
  ] }, "es", undefined, { settings: SETTINGS });
  assert.deepEqual(r.tree.children.map((n) => n.field.bind ?? null), ["city", "autoplay", null]);
  assert.deepEqual(r.tree.children[1].field, { required: true, minLength: null, maxLength: null, pattern: null, errorText: null, bind: "autoplay" });
  assert.deepEqual(r.dropped, ['screen: dropdown bind "token" is a password: only a secret textInput holds it, dropped']);
  assert.deepEqual(contract.manifest.screen.configTypes, ["text", "toggle", "select", "list", "password"]);
  // Screen asks: a secret field holds the password, and only it.
  const s = checkScreenTree({ type: "col", children: [
    { type: "textInput", key: "p", secret: true, bind: "token" }, { type: "textInput", key: "c", secret: true, bind: "city" },
  ] }, "es", undefined, { settings: SETTINGS });
  assert.deepEqual(s.tree.children.map((n) => n.field.bind ?? null), ["token", null]);
  assert.deepEqual(s.dropped, ['screen: textInput bind "city" is of type text: a secret field holds only a password, dropped']);
});

test("the kit's kino.config reads what a screen answer's config wrote, as the app's does", () => {
  const { kino, writeConfig } = createKino({ id: "x", capabilities: ["screen"], hosts: [], apiVersion: 14, settings: SETTINGS }, { config: { city: "Bogotá" } });
  assert.equal(kino.config.get("city"), "Bogotá");
  const { answer } = checkScreenAnswer({ config: { city: "Cali", quality: "sd", token: "x" } }, "es", { settings: SETTINGS });
  writeConfig(answer.config);
  // Screen asks: a password is written too (kept as given), and emptied by null.
  assert.deepEqual(kino.config.all(), { autoplay: false, city: "Cali", quality: "sd", token: "x" });
  writeConfig({ quality: null, city: null, token: null });
  assert.deepEqual(kino.config.all(), { autoplay: false, quality: "hd" });
});

test("a list never gains an address from a screen: entries may go or move, never a new url (the shim as the app)", () => {
  const feeds = { key: "feeds", type: "list", label: "Fuentes", fields: [{ key: "title", type: "text", label: "T" }, { key: "url", type: "url", label: "U" }] };
  const stored = [{ title: "A", url: "https://a.example.com" }, { title: "B", url: "https://b.example.com" }];
  assert.equal(keepsAddresses(feeds, [stored[1], { ...stored[0], title: "A2" }], stored), true);
  assert.equal(keepsAddresses(feeds, [{ title: "C", url: "" }], stored), true);
  assert.equal(keepsAddresses(feeds, [...stored, { title: "LAN", url: "http://192.168.1.1" }], stored), false);
  const { kino, writeConfig } = createKino({ id: "x", capabilities: ["screen"], hosts: [], apiVersion: 14, settings: [feeds, { key: "server", type: "url", label: "S" }] }, { config: { feeds: stored } });
  assert.deepEqual(writeConfig({ feeds: [...stored, { title: "LAN", url: "http://192.168.1.1" }], server: "http://192.168.1.1" }), [
    'screen: setting "feeds" would gain an address the person did not type, not written',
    'screen: setting "server" cannot be written from a screen, not written',
  ]);
  assert.deepEqual(kino.config.get("feeds"), stored);
  assert.equal(kino.config.get("server"), undefined);
  assert.deepEqual(writeConfig({ feeds: [stored[1]] }), []);
  assert.deepEqual(kino.config.get("feeds"), [stored[1]]);
});

test("run.mjs screenEvent: an answer's config is checked against the manifest and said", async () => {
  const src = "export async function screen(){return {type:\"col\"}}\nexport async function screenEvent(){return {config:{city:\"Cali\",token:\"x\"}}}\n";
  await withVariant({ settings: SETTINGS }, src, async (dir) => {
    const r = kit([dir, "screenEvent", "save"]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /Kino writes the setting city = "Cali"/);
    // Screen asks: a password is written, never printed (neither in the line nor in the answer on stdout).
    assert.match(r.err, /Kino writes the setting token = \(a password, never shown\)/);
    assert.doesNotMatch(r.err, /"x"/);
    assert.doesNotMatch(r.out, /"token": "x"/);
  });
});

// ---------- timers, banners, toasts and load more (Task 7f) ----------

test("the manifest's screen.every is read as a root's every: dropped and said, never refused", () => {
  assert.deepEqual(checkScreenTimers({ ms: 5000, event: "clock" }), { every: [{ ms: 5000, event: "clock" }], dropped: [] });
  const r = checkScreenTimers([{ ms: 10, event: "a" }, { ms: 2000, event: "open" }]);
  assert.deepEqual(r.every, [{ ms: 1000, event: "a" }]);
  assert.deepEqual(r.dropped, ["screen: every timer 0 ms 10 is below 1000, raised to 1000", 'screen: every timer 1 event "open" is reserved, dropped']);
  assert.deepEqual(checkScreenTimers("often").dropped, ["screen: every is not a timer or a list of timers, dropped"]);
  const m = validateManifest(JSON.stringify({ id: "demo", name: "Demo", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.org"], capabilities: ["screen"], screen: { label: "x", every: { ms: 500, event: "t" } } }));
  assert.equal(m.ok, true, m.message);
  assert.deepEqual(m.manifest.screen.every, { ms: 500, event: "t" });
  // Any value is kept, so the app (at open) and validate.mjs both say when it is no timer at all.
  const odd = validateManifest(JSON.stringify({ id: "demo", name: "Demo", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.org"], capabilities: ["screen"], screen: { label: "x", every: "often" } }));
  assert.equal(odd.manifest.screen.every, "often");
  assert.deepEqual(checkScreenTimers(odd.manifest.screen.every).dropped, ["screen: every is not a timer or a list of timers, dropped"]);
});

test("a rail or grid drawn all at once keeps its flat cap for load more too", () => {
  const item = { id: "a", ref: "r", title: "T", kind: "movie" };
  const flat = checkScreenTree({ type: "scroll", children: [{ type: "titleGrid", items: [item], onEndReached: { event: "more" } }] });
  assert.equal(flat.tree.children[0].paging.cap, contract.manifest.screen.limits.maxFlatTitles);
  const lazy = checkScreenTree({ type: "titleGrid", items: [item], onEndReached: { event: "more" } });
  assert.equal(lazy.tree.paging.cap, contract.manifest.screen.limits.maxListItems);
});

test("a toast object and a banner read as the app reads them", () => {
  const t = checkScreenAnswer({ toast: { text: "Borrado", role: "success", action: { label: "Deshacer", event: "undo" } } });
  assert.deepEqual(t.answer.toast, { text: "Borrado", role: "success", action: { label: "Deshacer", event: "undo", arg: null }, ms: contract.manifest.screen.limits.toastDefaultMs });
  const b = checkScreenTree({ type: "banner", key: "b", role: "error", text: "Sin red", dismissible: true, action: { label: "Reintentar", onTap: "retry" } });
  assert.equal(b.tree.role, "error");
  assert.equal(b.tree.dismissible, true);
  assert.deepEqual(b.tree.action, { label: "Reintentar", onTap: { ui: [], event: { name: "retry", arg: null }, go: null } });
  assert.ok(contract.manifest.screen.widgets.includes("banner"));
});

// ---------- the shared case table ----------

/** Task 17: each new node's own fields as the shared cases spell them (filled in item by item). */
const task17Node = {
  fab: (x) => ({ fab: { icon: x.icon, label: x.label, position: x.position } }),
  listTile: (x) => ({ tile: { title: x.title, subtitle: x.subtitle, dense: x.dense, leading: x.leading ? x.leading.type : null, trailing: x.trailing ? x.trailing.type : null } }),
  avatar: (x) => ({ avatar: { image: x.image, text: x.text, icon: x.icon, radius: x.radius, background: x.background } }),
  scaffold: (x) => ({ scaffold: { appBar: x.appBar ? x.appBar.key : null, body: x.body ? x.body.type : null, fab: x.fab ? x.fab.key : null, bottomBar: x.bottomBar ? x.bottomBar.key : null } }),
  appBar: (x) => ({ appBar: { title: x.title, leading: x.leading ? x.leading.key : null, actions: x.actions.length, bottom: x.bottom ? x.bottom.type : null, centerTitle: x.centerTitle, background: x.background, ...(x.titleNode ? { titleNode: x.titleNode.type } : {}) } }),
  navigationBar: (x) => ({ nav: { items: x.items.map((i) => i.key), value: x.value, onChange: x.onChange?.event?.name ?? null } }),
  pageView: (x) => ({ pager: { pages: x.pages.length, initialPage: x.initialPage, autoPlayMs: x.autoPlayMs, viewportFraction: x.viewportFraction, padEnds: x.padEnds, onPageChanged: x.onPageChanged?.event?.name ?? null } }),
};

/** Task 15: [x]'s shared properties as the shared cases spell them (null: it sets none). */
function sharedJson(x) {
  const o = {};
  if (x.autofocus) o.autofocus = true;
  if (x.canRequestFocus) o.canRequestFocus = true;
  if (x.selected !== null && x.selected !== undefined) o.selected = x.selected;
  if (x.badge) o.badge = x.badge;
  if (x.style && x.style.maxWidthFraction !== null && x.style.maxWidthFraction !== undefined) o.maxWidthFraction = x.style.maxWidthFraction;
  if (x.style && x.style.corners) o.corners = [x.style.corners.topStart, x.style.corners.topEnd, x.style.corners.bottomStart, x.style.corners.bottomEnd];
  if (x.style && x.style.color) o.color = x.style.color;
  if (x.type === "text" && x.time !== null) { o.time = x.time; o.timeFormat = x.timeFormat; }
  if (x.type === "list" && x.newItemsHint) o.newItemsHint = true;
  if (x.type === "popup" && x.anchor) o.anchor = x.anchor;
  if (x.type === "tabs" && x.tabs.some((t) => t.badge)) o.tabBadges = x.tabs.map((t) => t.badge);
  // Task 17: the box and text properties, the positioned stack, opacity, animate, tooltip and the new nodes.
  const st = x.style || {};
  for (const k of ["alignSelf", "textAlign", "border", "elevation", "background", "opacity", "animate"]) if (st[k] !== null && st[k] !== undefined) o[k] = st[k];
  if (st.positioned) o.positioned = Object.fromEntries(Object.entries(st.positioned).filter(([, v]) => v !== null));
  if (st.minW !== null && st.minW !== undefined) o.minWidth = st.minW;
  if (st.maxW !== null && st.maxW !== undefined) o.maxWidth = st.maxW;
  if (st.maxH !== null && st.maxH !== undefined) o.maxHeight = st.maxH;
  if (x.tooltip) o.tooltip = x.tooltip;
  if (task17Node[x.type]) Object.assign(o, task17Node[x.type](x));
  // Task 18.
  if (x.loading) o.loading = true;
  if (x.onTap && x.onTap.timeoutMs !== undefined) o.timeoutMs = x.onTap.timeoutMs;
  if (x.field && x.field.forceError) o.forceErrorText = x.field.forceError;
  if (x.enabledAt !== undefined) o.enabledAt = x.enabledAt;
  return Object.keys(o).length ? o : null;
}

test("screen-cases.json: the kit gives the app's verdicts and log lines", () => {
  assert.ok(cases.length >= 24);
  const expand = (v) => (typeof v === "string" ? v : v.repeat.repeat(v.times) + (v.then ?? ""));
  for (const c of cases) {
    if (c.kind === "pattern") {
      assert.equal(unsafePattern(c.input), c.expected.why, c.name);
      for (const [v, want] of c.expected.matches) assert.equal(matchesPattern(c.input, expand(v)), want, `${c.name}: ${JSON.stringify(v).slice(0, 60)}`);
      continue;
    }
    const input = typeof c.input === "string" ? JSON.parse(c.input) : c.input;
    const lang = c.lang === "en" ? "en" : "es";
    const { summary, dropped } = c.expected;
    if (c.kind === "tree" || c.kind === "form") {
      const r = checkScreenTree(input, lang, c.widgets, { allowSeries: c.allowSeries !== false, settings: c.settings });
      if (summary.binds !== undefined) assert.deepEqual(r.tree ? binds(r.tree) : {}, summary.binds, c.name);
      if (summary.settingsNodes !== undefined) assert.deepEqual(r.tree ? settingsNodes(r.tree) : [], summary.settingsNodes, c.name);
      // Screen asks: each qr's countdown fields and each steps node's items as read, by key.
      if (summary.qrs !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "qr") got[x.key] = { expiresInMs: x.expiresInMs, expiresAt: x.expiresAt, renewBeforeMs: x.renewBeforeMs, onExpire: x.onExpire?.name ?? null }; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.qrs, c.name);
      }
      if (summary.steps !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "steps") got[x.key] = { onStepTap: x.onStepTap?.name ?? null, items: x.items.map((it) => [it.key, it.state, it.children.length]) }; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.steps, c.name);
      }
      // Screen asks: each settings node's onSaved event name (null: none), by key.
      if (summary.onSaved !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "settings") got[x.key] = x.onSaved?.name ?? null; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.onSaved, c.name);
      }
      // Task 18 (G11): each settings node's autoSave, in tree order.
      if (summary.settingsAutoSave !== undefined) {
        const auto = (n) => [...(n.type === "settings" ? [n.autoSave === true] : []), ...childNodes(n).flatMap(auto)];
        assert.deepEqual(r.tree ? auto(r.tree) : [], summary.settingsAutoSave, c.name);
      }
      if (summary.steppers !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "stepper") got[x.key] = { value: stepperText(x.value, x.decimals), step: stepperText(x.step, x.decimals) }; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.steppers, c.name);
      }
      if (summary.accordionItems !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "accordion") got[x.key] = x.items.length; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.accordionItems, c.name);
      }
      // Tables as drawn (resolved: compact, or each class of tablesAt): column weights and every row's cell spans; or only
      // the row count; rowKeys: every row's key as read.
      const tablesOf = (cls) => {
        const got = {};
        const walk = (x) => { if (x.type === "table") got[x.key] = { columns: x.columns.map((col) => col.weight), spans: x.rows.map((row) => row.cells.map((cell) => cell.colSpan)) }; childNodes(x).forEach(walk); };
        if (r.tree) walk(resolveResponsive(r.tree, "phone", cls));
        return got;
      };
      // Task 8y: every one-line field's trailing icon per width class, [icon, label, event name] or null.
      if (summary.trailingAt !== undefined) for (const cls of Object.keys(summary.trailingAt)) {
        const got = {};
        const walk = (x) => { if (x.type === "textInput") got[x.key] = x.trailing ? [x.trailing.icon, x.trailing.label, x.trailing.onTap.event?.name ?? null] : null; childNodes(x).forEach(walk); };
        if (r.tree) walk(resolveResponsive(r.tree, "phone", cls));
        assert.deepEqual(got, summary.trailingAt[cls], `${c.name} ${cls}`);
      }
      // Task 15: the shared properties as drawn per width class, by key (only nodes that set one).
      if (summary.propsAt !== undefined) for (const cls of Object.keys(summary.propsAt)) {
        const got = {};
        const walk = (x) => { const p = sharedJson(x); if (p !== null) got[x.key] = p; childNodes(x).forEach(walk); };
        if (r.tree) walk(resolveResponsive(r.tree, "phone", cls));
        assert.deepEqual(got, summary.propsAt[cls], `${c.name} ${cls}`);
      }
      if (summary.tables !== undefined) assert.deepEqual(tablesOf("compact"), summary.tables, c.name);
      if (summary.tablesAt !== undefined) for (const cls of Object.keys(summary.tablesAt)) assert.deepEqual(tablesOf(cls), summary.tablesAt[cls], `${c.name} ${cls}`);
      if (summary.tableRows !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "table") got[x.key] = x.rows.length; childNodes(x).forEach(walk); };
        if (r.tree) walk(resolveResponsive(r.tree, "phone", "compact"));
        assert.deepEqual(got, summary.tableRows, c.name);
      }
      if (summary.rowKeys !== undefined) {
        const got = [];
        const walk = (x) => { if (x.type === "table") x.rows.forEach((row) => got.push(row.key)); childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.rowKeys, c.name);
      }
      // The twelve-column layout: [span, offset] of every node that sets either, in tree order.
      if (summary.spans !== undefined) {
        const got = [];
        const walk = (x) => { if (x.style && (x.style.span !== null || x.style.offset !== null)) got.push([x.style.span, x.style.offset]); childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.spans, c.name);
      }
      if (c.kind === "form") {
        const f = checkScreenForm(r.tree, c.form);
        assert.deepEqual(f.errors, c.expected.errors, c.name);
        assert.deepEqual(f.value, c.expected.value, c.name);
        r.dropped.push(...f.dropped);
      }
      assert.equal(r.tree ? r.tree.type : null, summary.root, c.name);
      assert.equal(r.tree ? countNodes(r.tree) : 0, summary.nodes, c.name);
      if (summary.titles !== undefined) assert.equal(r.tree ? countTitles(r.tree) : 0, summary.titles, c.name);
      // Task 7i-2: each declared pop-up's onClose event name (null: none), by key.
      if (summary.onClose !== undefined) {
        const got = {};
        const walk = (x) => { if (x.type === "popup") got[x.key] = x.onClose ? (x.onClose.event ? x.onClose.event.name : "") : null; childNodes(x).forEach(walk); };
        if (r.tree) walk(r.tree);
        assert.deepEqual(got, summary.onClose, c.name);
      }
      if (summary.posters !== undefined) assert.deepEqual(r.tree ? posters(r.tree) : [], summary.posters, c.name);
      if (summary.every !== undefined) assert.deepEqual(r.every, summary.every, c.name);
      // Task 14: the result's layout, and every list's stickToBottom per width class.
      if (summary.layout !== undefined) assert.equal(r.layout, summary.layout, c.name);
      if (summary.stickAt !== undefined) for (const cls of Object.keys(summary.stickAt)) {
        const got = {};
        const walk = (x) => { if (x.type === "list") got[x.key] = x.stickToBottom; childNodes(x).forEach(walk); };
        if (r.tree) walk(resolveResponsive(r.tree, "phone", cls));
        assert.deepEqual(got, summary.stickAt[cls], `${c.name} ${cls}`);
      }
      assert.deepEqual(r.dropped, dropped, c.name);
      assert.equal(r.dropped.length, summary.dropped, c.name);
    } else if (c.kind === "panelScreen") {
      // Task 8i: a `panel` result's format, then (screen format) its drawer parts and its tree with the panel's limits.
      const lines = [];
      const screen = isPanelScreen(input, c.apiVersion, (l) => lines.push(l));
      assert.equal(screen ? "screen" : "legacy", summary.format, c.name);
      if (screen) {
        const r = checkPanelScreen(input, lang);
        lines.push(...r.dropped);
        assert.equal(r.panel ? r.panel.root.type : null, summary.root, c.name);
        assert.equal(r.panel ? countNodes(r.panel.root) : 0, summary.nodes, c.name);
        if (r.panel) {
          assert.equal(r.panel.title, summary.title, c.name);
          assert.deepEqual(r.panel.tabs.map((t) => t.id), summary.tabs, c.name);
          assert.equal(r.panel.tab, summary.tab, c.name);
          assert.equal(r.panel.refreshMs, summary.refreshMs, c.name);
          if (summary.layout !== undefined) assert.equal(r.panel.layout, summary.layout, c.name);
          // Task 15: each drawer tab's badge (null: none).
          if (summary.tabBadges !== undefined) assert.deepEqual(r.panel.tabs.map((t) => t.badge), summary.tabBadges, c.name);
        }
      }
      assert.deepEqual(lines, dropped, c.name);
      assert.equal(lines.length, summary.dropped, c.name);
    } else if (c.kind === "panelAnswer") {
      const r = checkPanelScreenAnswer(input, lang);
      assert.equal(r.answer !== null, summary.answer, c.name);
      assert.deepEqual(r.answer ? panelAnswerFields(r.answer) : [], summary.fields, c.name);
      if (summary.ui !== undefined) assert.equal(r.answer.ui.length, summary.ui, c.name);
      assert.deepEqual(r.dropped, dropped, c.name);
      assert.equal(r.dropped.length, summary.dropped, c.name);
    } else {
      const r = checkScreenAnswer(input, lang, { allowSeries: c.allowSeries !== false, settings: c.settings, timer: c.timer === true, dismiss: c.dismiss === true });
      assert.equal(r.answer !== null, summary.answer, c.name);
      assert.deepEqual(r.answer ? answerFields(r.answer) : [], summary.fields, c.name);
      if (summary.config !== undefined) assert.deepEqual(r.answer.config, summary.config, c.name);
      if (summary.toast !== undefined) assert.deepEqual(r.answer ? r.answer.toast : null, summary.toast, c.name);
      if (summary.go !== undefined) assert.deepEqual(r.answer ? r.answer.go : null, summary.go, c.name);
      // Task 7i-2: the answer's ui operations, as "op:key".
      if (summary.ui !== undefined) assert.deepEqual((r.answer ? r.answer.ui : []).map((o) => { const op = Object.keys(o)[0]; return `${op}:${op === "set" ? o.set.key : o[op]}`; }), summary.ui, c.name);
      assert.deepEqual(r.dropped, dropped, c.name);
      assert.equal(r.dropped.length, summary.dropped, c.name);
    }
  }
});

test("the objects' keys are walked sorted: the log order does not depend on the plugin's key order", () => {
  const a = checkScreenTree({ type: "col", gap: 5, color: "#fff", h: 65 }).dropped;
  const b = checkScreenTree({ h: 65, color: "#fff", type: "col", gap: 5 }).dropped;
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});

test("an answer is read through JSON as the app receives it: undefined and NaN are null", () => {
  assert.deepEqual(checkScreenTree(undefined).dropped, ["screen: the tree is not a JSON object"]);
  assert.equal(checkScreenTree({ type: "progress", value: NaN }).tree.value, null);
  assert.equal(checkScreenAnswer(undefined).answer.state, null);
});

test("more problems than the log cap: the cap's lines and one line counting the rest", () => {
  const cap = contract.output.layout.maxLogLines;
  const r = checkScreenTree({ type: "col", children: Array.from({ length: cap + 4 }, () => ({ type: "marquee" })) });
  assert.equal(r.dropped.length, cap + 1);
  assert.equal(r.dropped.at(-1), "screen: 4 more problems not logged");
});

// ---------- the numbers come from the contract, not from this file ----------

test("depth and node budgets are the contract's, each cut logged once", () => {
  const L = contract.manifest.screen.limits;
  let deep = { type: "text", text: "leaf" };
  for (let i = 0; i < L.maxDepth + 3; i++) deep = { type: "col", children: [deep] };
  const r = checkScreenTree(deep);
  assert.deepEqual(r.dropped, [`screen: deeper than ${L.maxDepth} levels, dropped`]);
  assert.equal(countNodes(r.tree), L.maxDepth);
  const wide = checkScreenTree({ type: "col", children: Array.from({ length: L.maxNodes + 5 }, () => ({ type: "text", text: "x" })) });
  assert.equal(countNodes(wide.tree), L.maxNodes);
  assert.deepEqual(wide.dropped, [`screen: more than ${L.maxNodes} nodes, the rest dropped`]);
});

// ---------- text scale ----------

test("text style: h1 to h5 and p parse, the old names alias to them, an unknown one is p", () => {
  const styles = (names) => checkScreenTree({ type: "col", children: names.map((style) => ({ type: "text", text: "x", style })) });
  const r = styles(["h1", "h2", "h3", "h4", "h5", "p", "display", "title", "subtitle", "body", "caption", "label", "h6"]);
  assert.deepEqual(r.tree.children.map((c) => c.variant), ["h1", "h2", "h3", "h4", "h5", "p", "h1", "h3", "h4", "p", "caption", "label", "p"]);
  assert.equal(r.dropped.length, 1);
  assert.equal(checkScreenTree({ type: "text", text: "x" }).tree.variant, "p");
});

test("text bold is a boolean and the colour a role: bold parses, hex is dropped, onPrimary on a surface falls back", () => {
  const r = checkScreenTree({ type: "col", children: [
    { type: "text", text: "a", bold: true, color: "error" },
    { type: "text", text: "b", color: "#ff0000" },
    { type: "text", text: "c", color: "onPrimary" },
    { type: "text", text: "d", bold: 1 },
  ] });
  const [a, b, c, d] = r.tree.children;
  assert.equal(a.bold, true); assert.equal(a.style.color, "error");
  assert.equal(b.style.color, null);
  assert.equal(c.style.color, null);
  assert.equal(d.bold, false);
  assert.equal(r.dropped.length, 3);
});

// ---------- responsive resolution ----------

test("resolveResponsive: devices and sizes filter, per-size values take the class (or the next smaller), no leftovers", () => {
  const { tree } = checkScreenTree({
    type: "col", children: [
      { type: "text", text: "tv only", devices: ["tv"] },
      { type: "text", text: "wide", sizes: ["expanded"] },
      { type: "text", text: "x", style: { compact: "body", expanded: "title" } },
    ],
  });
  const phone = resolveResponsive(tree, "phone", "compact");
  assert.deepEqual(phone.children.map((c) => c.text), ["x"]);
  assert.equal(phone.children[0].variant, "p");
  const tv = resolveResponsive(tree, "tv", "expanded");
  assert.deepEqual(tv.children.map((c) => c.text), ["tv only", "wide", "x"]);
  assert.equal(tv.children[2].variant, "h3");
  const medium = resolveResponsive(tree, "desktop", "medium");
  assert.equal(medium.children[0].variant, "p");
  assert.equal(medium.devices, null);
  assert.deepEqual(medium.byClass, {});
  // An unknown device counts as phone, an unknown class as compact.
  assert.deepEqual(resolveResponsive(tree, "watch", "huge").children.map((c) => c.text), ["x"]);
});

// ---------- run.mjs ----------

test("run.mjs screen prints the validated tree on stdout and the drops on stderr", () => {
  const r = kit([demo, "screen"]);
  assert.equal(r.status, 0, r.err);
  const tree = r.json();
  assert.equal(tree.type, "col");
  assert.deepEqual(tree.children.map((c) => c.type), ["text", "loading", "list", "text"]);
  assert.match(r.err, /· dropped: screen: unknown widget "marquee", dropped/);
  assert.equal(tree.children[2].items[0].key, "n1");
  assert.deepEqual(tree.children[2].items[0].onTap, { ui: [], event: { name: "read", arg: "1" } });
});

test("run.mjs screen: --context and --state reach the plugin (device, size, lang, state)", () => {
  const r = kit(["--context", '{"device":"tv","size":{"widthClass":"expanded","heightClass":"medium","orientation":"landscape"},"lang":"en"}', "--state", '{"loaded":true}', demo, "screen"]);
  assert.equal(r.status, 0, r.err);
  const tree = r.json();
  assert.deepEqual(tree.children.map((c) => c.type), ["text", "list", "text"]);
  assert.equal(tree.children[2].text, "tv expanded");
  assert.equal(tree.children[1].items[0].children[1].children[0].text, "First story");
});

test("run.mjs screenEvent open (the reserved first call), then an event with its arg", () => {
  const open = kit([demo, "screenEvent", "open"]);
  assert.equal(open.status, 0, open.err);
  assert.deepEqual(open.json(), { state: { loaded: true } });
  const read = kit([demo, "screenEvent", "read", "2"]);
  assert.equal(read.status, 0, read.err);
  const answer = read.json();
  assert.equal(answer.toast.text, "Abierto");
  assert.equal(answer.dialog.title, "Segunda noticia");
  assert.deepEqual(answer.dialog.body.map((n) => n.text), ["Resumen dos"]);
  assert.deepEqual(answer.dialog.buttons.map((b) => b.label), ["Cerrar"]);
});

test("run.mjs screenEvent passes the arg, a value (JSON) and the state to the plugin", async () => {
  const echo = 'export async function screen(){return {type:"col"}}\nexport async function screenEvent(e){return {toast: JSON.stringify(e)}}\n';
  await withVariant({}, echo, (dir) => {
    const r = kit(["--state", '{"inputs":{"q":"hi"}}', dir, "screenEvent", "typed", "arg1", '"hello"']);
    assert.equal(r.status, 0, r.err);
    const sent = JSON.parse(r.json().toast.text);
    assert.deepEqual({ name: sent.name, arg: sent.arg, value: sent.value, inputs: sent.state.inputs }, { name: "typed", arg: "arg1", value: "hello", inputs: { q: "hi" } });
  });
});

test("run.mjs screenEvent --trigger: a tap or submit is the person's press, open and a change never are (Task 8p)", () => {
  assert.deepEqual(SCREEN_EVENT_TRIGGERS, ["tap", "change", "submit"]);
  assert.equal(screenEventIsPress("read"), true);
  assert.equal(screenEventIsPress("read", "tap"), true);
  assert.equal(screenEventIsPress("send", "submit"), true);
  assert.equal(screenEventIsPress("typed", "change"), false);
  assert.equal(screenEventIsPress("open"), false);
  assert.equal(screenEventIsPress("open", "submit"), false);
});

test("run.mjs screenEvent --trigger change: the answer's go.titleByIds and go.url are dropped, as the app does", async () => {
  const go = (g) => `export async function screen(){return {type:"col"}}\nexport async function screenEvent(e){return {go: ${g}, toast: "hi"}}\n`;
  await withVariant({}, go('{titleByIds: {tmdb: 603, kind: "movie", title: "Matrix"}}'), (dir) => {
    const tap = kit([dir, "screenEvent", "pick", "--trigger", "tap"]);
    assert.equal(tap.status, 0, tap.err);
    assert.deepEqual(tap.json().go, { titleByIds: { kind: "movie", tmdb: 603, title: "Matrix" } });
    const change = kit([dir, "screenEvent", "typed", "--trigger", "change"]);
    assert.equal(change.status, 0, change.err);
    assert.equal(change.json().go, undefined);
    assert.equal(change.json().toast.text, "hi");
    assert.match(change.err, /dropped: screen: answer\.go\.titleByIds to "typed" \(a change\) is dropped: only the person's own tap opens a title page/);
  });
  await withVariant({}, go('{url: {href: "https://example.com/a", title: "A"}}'), (dir) => {
    const change = kit([dir, "screenEvent", "typed", "--trigger", "change"]);
    assert.equal(change.status, 0, change.err);
    assert.equal(change.json().go, undefined);
    assert.match(change.err, /answer\.go\.url to "typed" \(a change\) is dropped: only the person's own tap opens a link/);
    assert.doesNotMatch(change.err, /go\.url: Kino asks the person first/);
  });
});

test("run.mjs --trigger: only screenEvent takes it, never with open, and only tap, change or submit", () => {
  const bad = kit([demo, "screenEvent", "read", "--trigger", "press"]);
  assert.equal(bad.status, 2);
  assert.match(bad.err, /--trigger takes tap, change, submit/);
  const open = kit([demo, "screenEvent", "open", "--trigger", "tap"]);
  assert.equal(open.status, 2);
  assert.match(open.err, /--trigger does not apply to open/);
  const screen = kit([demo, "screen", "--trigger", "tap"]);
  assert.equal(screen.status, 2);
  assert.match(screen.err, /--trigger only applies to screenEvent/);
});

test("run.mjs: screen needs the manifest's screen block; a null answer is the empty answer", async () => {
  const r = kit([join(here, "section-demo"), "screen"]);
  assert.equal(r.status, 2);
  assert.match(r.err, /does not declare "screen"/);
  await withVariant({}, QUIET, (dir) => {
    const empty = kit([dir, "screenEvent", "x"]);
    assert.equal(empty.status, 0, empty.err);
    assert.deepEqual(empty.json(), {});
  });
});

test("run.mjs screen: an invalid root means no screen (exit 1)", async () => {
  await withVariant({}, 'export async function screen(){return {type:"marquee"}}\nexport async function screenEvent(){return null}\n', (dir) => {
    const r = kit([dir, "screen"]);
    assert.equal(r.status, 1);
    assert.match(r.err, /✗ the whole screen is invalid/);
  });
});

test("run.mjs screen --raw prints the plugin's answer untouched", () => {
  const r = kit(["--raw", demo, "screen"]);
  assert.equal(r.status, 0);
  assert.equal(r.json().children[1].type, "marquee");
});

test("fakeScreenContext: the shape screen(context) gets, overrides merged", () => {
  const c = fakeScreenContext({ device: "tv" });
  assert.deepEqual(Object.keys(c).sort(), ["device", "lang", "route", "size", "state"]);
  assert.equal(c.device, "tv");
  assert.deepEqual(c.state.inputs, {});
  // The shapes PluginScreenSession sends (PluginScreenSessionTest pins the app side).
  assert.deepEqual(c.route, { name: "main", params: {} });
  assert.deepEqual(c.size, { widthClass: "compact", heightClass: "medium", orientation: "portrait" });
  assert.equal(c.lang, "es");
  assert.deepEqual(Object.keys(fakeScreenEvent("open")).sort(), ["device", "lang", "name", "route", "state"]);
});

// ---------- kino.screen ----------

test("kino.screen reports the widgets Kino draws (the contract's list) and version 1", () => {
  const { kino } = createKino({ id: "x", capabilities: ["screen"], hosts: [], settings: [], apiVersion: 14 });
  assert.deepEqual([...kino.screen.widgets], contract.manifest.screen.widgets);
  assert.equal(kino.screen.version, 1);
  assert.ok(Object.isFrozen(kino.screen));
});

// ---------- the manifest ----------

const base = { id: "sc", name: "Sc", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"], capabilities: ["screen"], screen: { label: "News" } };
const verdict = (over) => validateManifest(JSON.stringify({ ...base, ...over }));

test("manifest screen block: the app's messages, rule by rule", () => {
  assert.equal(verdict({}).ok, true);
  assert.deepEqual(verdict({}).manifest.screen, { label: "News", menuOpens: "screen", adult: false, settingsIn: "both", opensFrom: ["menu"] });
  const bad = (screen, message) => {
    const r = verdict({ screen });
    assert.equal(r.ok, false, JSON.stringify(screen));
    assert.equal(r.field, "screen");
    assert.equal(r.message, message);
  };
  bad("x", 'The "screen" field must be an object with a "label"');
  bad({}, 'The "screen.label" field must be 1 to 20 characters');
  bad({ label: "x".repeat(21) }, 'The "screen.label" field must be 1 to 20 characters');
  bad({ label: "ok", labelEn: "x".repeat(21) }, 'The "screen.labelEn" field must be 1 to 20 characters');
  bad({ label: "ok", labelEn: 3 }, 'The "screen.labelEn" field must be 1 to 20 characters');
  bad({ label: "ok", icon: "list", iconFile: "a.png" }, 'The "screen" field takes an "icon" or an "iconFile", not both');
  bad({ label: "ok", iconFile: "../a.png" }, 'The "screen.iconFile" field must be a relative path to a .png');
  bad({ label: "ok", iconFile: "a.jpg" }, 'The "screen.iconFile" field must be a relative path to a .png');
  bad({ label: "ok", iconFile: 3 }, 'The "screen.iconFile" field must be a relative path to a .png');
  bad({ label: "ok", menuOpens: "nowhere" }, 'The "screen.menuOpens" field must be "section", "screen" or "both"');
  bad({ label: "ok", menuOpens: 1 }, 'The "screen.menuOpens" field must be "section", "screen" or "both"');
  bad({ label: "ok", menuOpens: "section" }, 'The "screen.menuOpens" value "section" or "both" needs the "section" field');
  bad({ label: "ok", menuOpens: "both" }, 'The "screen.menuOpens" value "section" or "both" needs the "section" field');
  bad({ label: "ok", adult: "yes" }, 'The "screen.adult" field must be true or false');
  bad({ label: "ok", settingsIn: "ajustes" }, 'The "screen.settingsIn" field must be "settings", "screen" or "both"');
  bad({ label: "ok", settingsIn: true }, 'The "screen.settingsIn" field must be "settings", "screen" or "both"');
});

test("manifest screen block: settingsIn, and settings only in a screen need a screen entry", () => {
  for (const v of ["settings", "screen", "both"]) assert.equal(verdict({ screen: { label: "News", settingsIn: v } }).manifest.screen.settingsIn, v);
  const withSection = { section: { label: "Sec" }, capabilities: ["screen", "home", "browse", "resolve"] };
  const refused = verdict({ ...withSection, screen: { label: "News", menuOpens: "section", settingsIn: "screen" } });
  assert.equal(refused.ok, false);
  assert.equal(refused.message, 'The "screen.settingsIn" value "screen" needs a screen entry: "screen.menuOpens" "screen" or "both", or "settings" in "screen.opensFrom"');
  // The settings page's button is an entry too.
  assert.equal(verdict({ ...withSection, screen: { label: "News", opensFrom: ["settings"], settingsIn: "screen" } }).ok, true);
  assert.equal(verdict({ ...withSection, screen: { label: "News", menuOpens: "both", settingsIn: "screen" } }).ok, true);
  // No screen at all: the block needs the capability, so "screen" without a screen is refused before.
  assert.equal(verdict({ capabilities: ["search", "resolve"], screen: { label: "News", settingsIn: "screen" } }).message, 'The "screen" field needs the "screen" capability');
});

test("manifest screen block: the default follows the section, menuOpens both is allowed with one, text and flags are kept", () => {
  const withSection = { section: { label: "Sec" }, capabilities: ["screen", "home", "browse", "resolve"] };
  assert.equal(verdict({ ...withSection, screen: { label: "News" } }).manifest.screen.menuOpens, "section");
  assert.equal(verdict({ ...withSection, screen: { label: "News", menuOpens: "both" } }).manifest.screen.menuOpens, "both");
  assert.equal(verdict({ ...withSection, screen: { label: "News", menuOpens: "screen" } }).manifest.screen.menuOpens, "screen");
  const full = verdict({ screen: { label: " News ", labelEn: " News EN ", icon: "star", adult: true } }).manifest.screen;
  assert.deepEqual(full, { label: "News", labelEn: "News EN", icon: "star", menuOpens: "screen", adult: true, settingsIn: "both", opensFrom: ["menu"] });
});

test("manifest screen block: opensFrom (Task 7g), app parity", () => {
  assert.deepEqual(verdict({ screen: { label: "N", opensFrom: ["menu", "settings", "menu"] } }).manifest.screen.opensFrom, ["menu", "settings"]);
  const bad = (screen, message) => {
    const r = verdict({ screen });
    assert.equal(r.ok, false, JSON.stringify(screen));
    assert.equal(r.message, message);
  };
  bad({ label: "N", opensFrom: [] }, 'The "screen.opensFrom" field needs "menu", "settings" or both');
  for (const v of ["menu", ["sidebar"], [1], true]) bad({ label: "N", opensFrom: v }, 'The "screen.opensFrom" field must be a list of "menu" and "settings"');
  // Settings only: no icon needed, and the icon, iconFile and menuOpens are ignored.
  const only = verdict({ screen: { label: "N", opensFrom: ["settings"], iconFile: "screen.png", menuOpens: "both" } }).manifest.screen;
  assert.deepEqual(only, { label: "N", menuOpens: "screen", adult: false, settingsIn: "both", opensFrom: ["settings"] });
  const withSection = { section: { label: "Sec" }, capabilities: ["screen", "home", "browse", "resolve"] };
  assert.equal(verdict({ ...withSection, screen: { label: "N", opensFrom: ["settings"], menuOpens: "screen" } }).manifest.screen.menuOpens, "section");
});

test("manifest screen block: replaces categories needs a catalog (Task 8), app parity", () => {
  const catalog = { capabilities: ["screen", "home", "browse", "resolve"] };
  const ok = verdict({ ...catalog, screen: { label: "N", replaces: ["categories", "categories"] } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.screen.replaces, ["categories"]);
  // Kino's own Categorías for the plugin (the fallback) needs its `categories` export.
  assert.ok(requiredExports(ok.manifest.capabilities, [], ok.manifest).includes("categories"));
  // Nothing replaced: no key, no extra export.
  const none = verdict({ ...catalog, screen: { label: "N", replaces: [] } });
  assert.equal(none.manifest.screen.replaces, undefined);
  assert.ok(!requiredExports(none.manifest.capabilities, [], none.manifest).includes("categories"));
  const noCatalog = verdict({ screen: { label: "N", replaces: ["categories"] } });
  assert.equal(noCatalog.ok, false);
  assert.equal(noCatalog.message, 'The "screen.replaces" value "categories" needs a catalog: the "browse" capability');
  for (const v of [["home"], "categories", [1], {}]) {
    const r = verdict({ ...catalog, screen: { label: "N", replaces: v } });
    assert.equal(r.message, 'The "screen.replaces" field must be a list of "categories"', JSON.stringify(v));
  }
  assert.deepEqual(contract.manifest.screen.replaces, ["categories"]);
});

test("manifest screen block: settingsButton labels are scrubbed and 1 to 40 characters (Task 7g)", () => {
  const b = verdict({ screen: { label: "N", settingsButton: { label: "  Abrir\u0007 panel\u202e ", labelEn: "Open panel" } } }).manifest.screen.settingsButton;
  assert.deepEqual(b, { label: "Abrir panel", labelEn: "Open panel" });
  assert.deepEqual(verdict({ screen: { label: "N", settingsButton: { labelEn: "Go" } } }).manifest.screen.settingsButton, { label: "", labelEn: "Go" });
  assert.equal(verdict({ screen: { label: "N", settingsButton: {} } }).manifest.screen.settingsButton, undefined);
  for (const v of ["Abrir", { label: "x".repeat(41) }, { label: "" }, { labelEn: 5 }, { label: "\u0007" }]) {
    const r = verdict({ screen: { label: "N", settingsButton: v } });
    assert.equal(r.message, 'The "screen.settingsButton" field must be an object whose "label" and "labelEn" are 1 to 40 characters', JSON.stringify(v));
  }
});

test("manifest: the block and the capability need each other; below apiVersion 14 both are unknown", () => {
  const noBlock = verdict({ screen: undefined });
  assert.equal(noBlock.ok, false);
  assert.equal(noBlock.field, "screen");
  assert.equal(noBlock.message, 'The "screen" capability needs a "screen" field with a "label"');
  const noCap = verdict({ capabilities: ["search", "resolve"] });
  assert.equal(noCap.field, "screen");
  assert.equal(noCap.message, 'The "screen" field needs the "screen" capability');
  const old = verdict({ apiVersion: 12 });
  assert.equal(old.field, "capabilities");
  assert.match(old.message, /needs apiVersion 14/);
  assert.equal(verdict({ apiVersion: 12, capabilities: ["search", "resolve"] }).ok, true);
});

test("validate.mjs: the demo passes and prints no consent line; an unknown icon is a note, a missing icon file a problem", async () => {
  const ok = await validate(demo);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.consent, []);
  await withVariant({ screen: { label: "News", icon: "nope" } }, undefined, async (dir) => {
    const r = await validate(dir);
    assert.equal(r.ok, true, r.problems.join("\n"));
    assert.ok(r.notes.some((n) => n.includes('screen.icon "nope" is not a predefined icon')), r.notes.join("\n"));
  });
  await withVariant({ screen: { label: "News", iconFile: "icon.png" } }, undefined, async (dir) => {
    const r = await validate(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("screen icon") && p.includes("icon.png was not found")), r.problems.join("\n"));
  });
});

test("validate.mjs: menuOpens screen without the screen export fails like the app's install", async () => {
  await withVariant({ screen: { label: "News", menuOpens: "screen" } }, "export async function other(){}\n", async (dir) => {
    const r = await validate(dir);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("doesn't export") && p.includes("screen") && p.includes("screenEvent")), r.problems.join("\n"));
  });
});

test("validate.mjs: the screen block below apiVersion 14 is ignored, with a note", async () => {
  const old = "export async function search(){return []}\nexport async function resolve(){return null}\n";
  await withVariant({ apiVersion: 12, capabilities: ["search", "resolve"], screen: { label: "News" } }, old, async (dir) => {
    const r = await validate(dir);
    assert.equal(r.ok, true, r.problems.join("\n"));
    assert.ok(r.notes.some((n) => n.includes('"screen" needs apiVersion 14')), r.notes.join("\n"));
  });
});

test("stepper numbers as the app keeps them: in range, on the decimals' grid, canonical text", () => {
  // Half up of the exact double, as BigDecimal: 1.005 is a hair below it.
  assert.equal(stepperText(1.005, 2), "1.00");
  assert.equal(stepperText(1234567.5, 6), "1234567.500000");
  assert.equal(stepperText(-0.001, 2), "0.00");
  assert.equal(stepperText(-2, 0), "-2");
  assert.equal(stepperNormalize(42, 0, 10, 0), 10);
  assert.equal(stepperNormalize(1.25, 0, 1.25, 1), 1.2, "rounded inside the max");
  assert.equal(stepperNormalize(-3, 0, null, 0), 0);
  // The tree keeps the value as a number; the state holds its text.
  const { tree } = checkScreenTree({ type: "stepper", key: "n", min: 0, max: 5, step: 0.25, decimals: 1, value: 2.26 });
  assert.equal(tree.value, 2.3);
  assert.equal(tree.step, 0.3);
  assert.equal(stepperText(tree.value, tree.decimals), "2.3");
});

test("accordion and qr: children counted, item open state, a qr is never pressable", () => {
  const { tree } = checkScreenTree({ type: "col", children: [
    { type: "accordion", key: "a", items: [{ key: "x", title: "X", open: true, children: [{ type: "text", text: "t" }] }, { key: "y", title: "Y", open: true }] },
    { type: "qr", value: "https://kino.example", onTap: "go" },
  ] });
  const acc = tree.children[0];
  assert.deepEqual(acc.items.map((i) => i.open), [true, false]);
  assert.equal(countNodes(tree), 4);
  assert.deepEqual(childNodes(acc).map((n) => n.type), ["text"]);
  assert.equal(tree.children[1].onTap, null);
  assert.equal(resolveResponsive(tree, "phone", "compact").children[0].items[0].children.length, 1);
});

test("table and twelve columns: cells' children counted and resolved per device, flags and spans per size", () => {
  const { tree, dropped } = checkScreenTree({ type: "col", children: [
    { type: "table", header: { medium: true }, wrap: { expanded: true }, children: [
      { type: "tr", children: [{ type: "td", text: "Nombre" }, { type: "td", children: [{ type: "text", text: "tv", devices: ["tv"] }, { type: "button", label: "Ver", onTap: "see" }] }] },
      { type: "tr", children: [{ type: "td", text: "solo" }] },
    ] },
    { type: "row", wrap: true, stackOnNarrow: true, children: [{ type: "text", text: "a", span: { compact: 12, expanded: 4 }, offset: { expanded: 8 } }] },
  ] });
  assert.deepEqual(dropped, []);
  const table = tree.children[0];
  assert.deepEqual(table.rows.map((r) => r.cells.map((c) => c.colSpan)), [[1, 1], [1]], "the tree holds the rows as read");
  assert.deepEqual(resolveResponsive(tree, "phone", "compact").children[0].rows.map((r) => r.cells.map((c) => c.colSpan)), [[1, 1], [1, 1]], "drawn, a ragged row is padded");
  assert.deepEqual(childNodes(table).map((n) => n.type), ["text", "button"]);
  assert.equal(countNodes(tree), 6);
  const phone = resolveResponsive(tree, "phone", "compact");
  assert.equal(phone.children[0].header, false);
  assert.equal(phone.children[0].wrap, false);
  assert.deepEqual(phone.children[0].rows[0].cells[1].children.map((n) => n.type), ["button"]);
  const tv = resolveResponsive(tree, "tv", "expanded");
  assert.equal(tv.children[0].header, true);
  assert.equal(tv.children[0].wrap, true);
  assert.equal(tv.children[0].rows[0].cells[1].children.length, 2);
  const row = tv.children[1];
  assert.equal(row.wrap, true);
  assert.equal(row.stackOnNarrow, false, "wrap wins over stackOnNarrow");
  assert.deepEqual([row.children[0].style.span, row.children[0].style.offset], [4, 8]);
  assert.deepEqual([phone.children[1].children[0].style.span, phone.children[1].children[0].style.offset], [12, null]);
});
