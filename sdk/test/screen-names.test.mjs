// Task 8e: the Flutter-style names (contract manifest.screen.aliases) read exactly as the older ones, as the app reads them
// (PluginScreenNamesTest.kt). The pairs live in screen-name-cases.json, which the Kotlin test reads too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { checkScreenAnswer, checkScreenTree, DEVICES, normalizeNode, resolveResponsive, SIZE_CLASSES, WIDGETS } from "../screen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { pairs } = JSON.parse(readFileSync(join(here, "screen-name-cases.json"), "utf8"));
const A = contract.manifest.screen.aliases;

const parse = (tree) => checkScreenTree(tree);

function assertSame(name, flutter, old) {
  const f = parse(flutter);
  const o = parse(old);
  assert.deepEqual(f.dropped, o.dropped, `${name}: log`);
  assert.deepEqual(f.tree, o.tree, `${name}: tree`);
  // As every front end draws it, the desktop included: the same nodes in every size class.
  for (const device of DEVICES) for (const cls of SIZE_CLASSES) {
    assert.deepEqual(f.tree && resolveResponsive(f.tree, device, cls), o.tree && resolveResponsive(o.tree, device, cls), `${name}: ${device} ${cls}`);
  }
}

test("everyFlutterNameParsesToTheSameTreeAsTheOldOne", () => {
  assert.ok(pairs.length >= 20);
  for (const p of pairs) {
    assert.ok(parse(p.flutter).tree, `${p.name} parses`);
    assertSame(p.name, p.flutter, p.old);
  }
  // Every name of the aliases is exercised by some pair (the Kotlin side checks the same).
  const text = pairs.map((p) => JSON.stringify(p.flutter)).join("\n");
  for (const t of Object.keys(A.types)) assert.ok(text.includes(`"type":"${t}"`), `type ${t} has a pair`);
  for (const g of ["props", "buttonProps", "columnProps"]) for (const k of Object.keys(A[g])) assert.ok(text.includes(`"${k}":`), `${g} ${k} has a pair`);
  for (const k of Object.keys(A.implied)) assert.ok(text.includes(`"type":"${k}"`), `implied ${k} has a pair`);
  assert.ok(text.includes('"multiline":true'));
});

test("oldAndNewSpellingsMatchOnProperties", () => {
  const on = {
    width: { type: "col" }, height: { type: "col" }, minHeight: { type: "col" },
    mainAxisAlignment: { type: "row" }, crossAxisAlignment: { type: "row" }, borderRadius: { type: "card" },
    onChanged: { type: "toggle", key: "t" }, onSubmitted: { type: "textInput", key: "q" },
    hintText: { type: "textInput", key: "q" }, hintTextEn: { type: "textInput", key: "q" },
    labelText: { type: "textInput", key: "q" }, labelTextEn: { type: "textInput", key: "q" },
    obscureText: { type: "textInput", key: "q" },
  };
  const values = { width: 96, height: 48, minHeight: 64, mainAxisAlignment: "center", crossAxisAlignment: "end", borderRadius: "large", onChanged: "c", onSubmitted: "s", hintText: "h", hintTextEn: "he", labelText: "l", labelTextEn: "le", obscureText: true };
  for (const [canonical, alias] of Object.entries(A.props)) {
    if (canonical === "flex") continue;
    const f = { ...on[canonical], [canonical]: values[canonical] };
    assert.deepEqual(parse(f).dropped, [], canonical);
    assert.deepEqual(normalizeNode(f, () => assert.fail(canonical)), { ...on[canonical], [alias]: values[canonical] }, canonical);
    assertSame(canonical, f, { ...on[canonical], [alias]: values[canonical] });
  }
  assertSame("flex", { type: "row", children: [{ type: "col", flex: 3 }] }, { type: "row", children: [{ type: "col", weight: 3 }] });
  assertSame("onPressed", { type: "button", label: "a", onPressed: "go" }, { type: "button", label: "a", onTap: "go" });
  assertSame("column flex", { type: "table", columns: [{ flex: 4 }], children: [{ type: "tr", children: [{ type: "td", text: "a" }] }] },
    { type: "table", columns: [{ weight: 4 }], children: [{ type: "tr", children: [{ type: "td", text: "a" }] }] });
  const en = checkScreenTree({ type: "TextField", key: "q", labelText: "Buscar", labelTextEn: "Search", hintText: "t", hintTextEn: "title" }, "en");
  assert.equal(en.tree.label, "Search");
  assert.equal(en.tree.hint, "title");
  assert.deepEqual(en.dropped, []);
});

test("bothSpellingsClashLogged_canonicalWins", () => {
  const f = parse({ type: "Row", width: 96, w: 48, mainAxisAlignment: "end", justify: "start", onChanged: "a", onChange: "b", children: [{ type: "Button", labelText: "Ok", label: "No", onPressed: "yes", onTap: "no" }] });
  assert.deepEqual(f.dropped, [
    "screen: row has both width and w, w ignored",
    "screen: row has both mainAxisAlignment and justify, justify ignored",
    "screen: row has both onChanged and onChange, onChange ignored",
    "screen: button has both labelText and label, label ignored",
    "screen: button has both onPressed and onTap, onTap ignored",
  ]);
  assert.equal(f.tree.style.w, 96);
  assert.equal(f.tree.style.justify, "end");
  assert.equal(f.tree.children[0].label, "Ok");
  assert.equal(f.tree.children[0].onTap.event.name, "yes");
  const n = parse({ type: "col", width: null, w: 48 });
  assert.deepEqual(n.dropped, []);
  assert.equal(n.tree.style.w, 48);
  const t = parse({ type: "DataTable", columns: [{ flex: 2, weight: 5 }], children: [{ type: "TableRow", children: [{ type: "TableCell", text: "a" }] }] });
  assert.deepEqual(t.dropped, ["screen: table column 0 has both flex and weight, weight ignored"]);
  assert.equal(t.tree.columns[0].weight, 2);
});

test("implied variant and kind win; onPressed only on buttons", () => {
  const f = parse({ type: "col", children: [{ type: "ElevatedButton", labelText: "a", variant: "text" }, { type: "AlertDialog", key: "p", title: "T", kind: "menu" }, { type: "card", onPressed: "x" }] });
  assert.deepEqual(f.dropped, [
    'screen: button variant "text" does not match ElevatedButton, "primary" used',
    'screen: popup kind "menu" does not match AlertDialog, "dialog" used',
    "screen: card onPressed works only on a button, ignored",
  ]);
  assert.equal(f.tree.children[0].variant, "primary");
  assert.equal(f.tree.children[1].kind, "dialog");
  assert.equal(f.tree.children[2].onTap, null);
});

test("unknownNameDropped", () => {
  const f = parse({ type: "Column", children: [{ type: "Marquee" }, { type: "Container" }, { type: "Text", text: "ok" }] });
  assert.deepEqual(f.dropped, ['screen: unknown widget "Marquee", dropped', 'screen: unknown widget "Container", dropped']);
  assert.equal(f.tree.children.length, 1);
  assert.deepEqual(parse({ type: "COL" }).dropped, ['screen: unknown widget "COL", dropped']);
});

test("textFieldMultilineMapsToTextArea", () => {
  assert.equal(parse({ type: "TextField", key: "a", maxLines: 3 }).tree.type, "textArea");
  assert.equal(parse({ type: "TextField", key: "a", multiline: true }).tree.type, "textArea");
  const m = parse({ type: "TextField", key: "a", maxLines: { compact: 1, expanded: 4 } });
  assert.equal(m.tree.type, "textArea");
  assert.deepEqual(m.dropped, []);
  for (const one of [{ type: "TextField", key: "a" }, { type: "TextField", key: "a", maxLines: 1 }, { type: "TextField", key: "a", multiline: false }]) {
    const p = parse(one);
    assert.equal(p.tree.type, "textInput", JSON.stringify(one));
    assert.deepEqual(p.dropped, []);
  }
  assert.equal(parse({ type: "textInput", key: "a", maxLines: 3 }).tree.type, "textInput");
});

test("sizedBoxIsSpacerWithSize", () => {
  const s = parse({ type: "SizedBox", width: 32, height: { compact: 16, expanded: 24 } }).tree;
  assert.equal(s.type, "spacer");
  assert.equal(s.style.w, 32);
  assert.equal(s.style.h, 16);
  assert.equal(resolveResponsive(s, "phone", "expanded").style.h, 24);
  assert.deepEqual(parse({ type: "Spacer" }).tree, parse({ type: "spacer" }).tree);
});

test("numberStepperNotStepper", () => {
  const f = parse({ type: "col", children: [{ type: "Stepper", key: "s" }, { type: "NumberStepper", key: "n", min: 0, max: 5 }] });
  assert.deepEqual(f.dropped, ['screen: unknown widget "Stepper", dropped']);
  assert.equal(f.tree.children.length, 1);
  assert.equal(f.tree.children[0].type, "stepper");
});

test("perSizeMapsOnAliasProperties", () => {
  const r = parse({ type: "Row", mainAxisAlignment: { compact: "start", expanded: "spaceBetween" }, width: { medium: 200 }, children: [{ type: "Column", flex: { compact: 1, expanded: 4 } }] }).tree;
  const at = (cls) => resolveResponsive(r, "phone", cls);
  assert.equal(at("compact").style.justify, "start");
  assert.equal(at("medium").style.justify, "start");
  assert.equal(at("expanded").style.justify, "spaceBetween");
  assert.equal(at("compact").style.w, null);
  assert.equal(at("medium").style.w, 200);
  assert.equal(at("compact").children[0].style.weight, 1);
  assert.equal(at("expanded").children[0].style.weight, 4);
  assert.deepEqual(parse({ type: "Column", width: { compact: 96, big: 1 } }).dropped, ["screen: col w mixes size classes with other keys, dropped"]);
});

test("desktopNote", () => {
  // The desktop front end draws the same parsed tree: a Flutter-named screen resolves for `desktop` as the older one does.
  const f = parse({ type: "Column", children: [{ type: "Text", text: "d", devices: ["desktop"] }, { type: "ElevatedButton", labelText: "x", width: { expanded: 120 } }] }).tree;
  const o = parse({ type: "col", children: [{ type: "text", text: "d", devices: ["desktop"] }, { type: "button", variant: "primary", label: "x", w: { expanded: 120 } }] }).tree;
  for (const cls of SIZE_CLASSES) assert.deepEqual(resolveResponsive(f, "desktop", cls), resolveResponsive(o, "desktop", cls), cls);
  assert.equal(resolveResponsive(f, "desktop", "expanded").children.length, 2);
  assert.equal(resolveResponsive(f, "tv", "expanded").children.length, 1);
});

test("an answer's pop-up body takes the Flutter names", () => {
  const a = checkScreenAnswer({ dialog: { title: "T", body: [{ type: "Text", text: "x" }, { type: "TextButton", labelText: "y", onPressed: "z" }] } });
  assert.deepEqual(a.dropped, []);
  assert.equal(a.answer.dialog.body[0].type, "text");
  assert.equal(a.answer.dialog.body[1].variant, "text");
});

test("kino.screen.names lists the documented names; each reaches a widget", () => {
  const { kino } = createKino({ id: "x", capabilities: ["screen"], hosts: [], settings: [], apiVersion: 14 });
  assert.deepEqual([...kino.screen.names], A.names);
  assert.ok(Object.isFrozen(kino.screen.names));
  for (const n of A.names) assert.ok(WIDGETS.includes(A.types[n] ?? n), n);
  assert.ok(!A.names.includes("Stepper") && !("Stepper" in A.types));
});

// ---------- fuzz: random older trees, randomly respelled, read the same ----------

/** mulberry32: a small seeded generator. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (lo, hi) => lo + Math.floor(next() * (hi - lo)), bool: () => next() < 0.5, pick: (xs) => xs[Math.floor(next() * xs.length)] };
}

const reverse = {};
for (const [c, t] of Object.entries(A.types)) (reverse[t] ??= []).push(c);
const clone = (v) => JSON.parse(JSON.stringify(v));

function respell(o, r) {
  const out = clone(o);
  const t = o.type;
  const lines = "maxLines" in o || "multiline" in o;
  const candidates = (reverse[t] ?? []).filter((c) => c !== "TextField" && (!A.implied[c] || Object.entries(A.implied[c]).every(([k, v]) => o[k] === v)));
  if ((t === "textInput" || t === "textArea") && !lines) candidates.push("TextField");
  if (candidates.length && r.int(0, 4) !== 0) {
    const c = r.pick(candidates);
    out.type = c;
    if (A.implied[c] && r.bool()) delete out[Object.keys(A.implied[c])[0]];
    if (c === "TextField" && t === "textArea") { if (r.bool()) out.multiline = true; else out.maxLines = r.int(2, 6); }
  }
  const props = t === "button" ? { ...A.props, ...A.buttonProps } : A.props;
  for (const [canonical, alias] of Object.entries(props)) if (alias in out && !(canonical in out) && r.bool()) { out[canonical] = out[alias]; delete out[alias]; }
  const nodes = (k) => { if (Array.isArray(out[k])) out[k] = out[k].map((x) => (x && typeof x === "object" && !Array.isArray(x) ? respell(x, r) : x)); };
  nodes("children");
  if (t === "list") { nodes("items"); if (out.empty && typeof out.empty === "object") out.empty = respell(out.empty, r); }
  if (t === "heroCard") nodes("buttons");
  if (t === "accordion" && Array.isArray(out.items)) for (const item of out.items) if (item && Array.isArray(item.children)) item.children = item.children.map((x) => (x && typeof x === "object" ? respell(x, r) : x));
  if (t === "table" && Array.isArray(out.columns)) for (const c of out.columns) if (c && "weight" in c && !("flex" in c) && r.bool()) { c.flex = c.weight; delete c.weight; }
  return out;
}

const STYLE_VALUES = [0, 16, 48, 65, 96, 640, 700, "center", "end", "stretch", "spaceAround", "middle", "small", "full", 1, 3, 13, true, null];
const STYLES = ["w", "h", "minH", "justify", "align", "weight", "radius", "onChange", "onSubmit", "hint", "label"];

function randomOld(r) {
  const spice = (o) => {
    if (r.int(0, 3) === 0) {
      const k = r.pick(STYLES);
      o[k] = r.int(0, 4) === 0 ? { [r.pick(SIZE_CLASSES)]: r.pick(STYLE_VALUES) } : r.pick(STYLE_VALUES);
    }
    if (Array.isArray(o.children)) for (const c of o.children) if (c && typeof c === "object" && !["tr", "td"].includes(c.type)) spice(c);
  };
  const kids = [];
  for (let i = r.int(1, 7); i > 0; i--) {
    const p = clone(r.pick(pairs).old);
    spice(p);
    kids.push(p);
  }
  return { type: "col", children: kids };
}

test("500 random older trees respelled at random read the same, and Flutter names never throw", () => {
  const r = rng(20261026);
  for (let i = 0; i < 500; i++) {
    const old = randomOld(r);
    const flutter = respell(old, r);
    assertSame(`case ${i}: ${JSON.stringify(flutter).slice(0, 200)}`, flutter, old);
  }
  const junk = [null, 7, "x", true, [1], { compact: 2 }, { type: "TableCell" }];
  const keys = [...Object.keys(A.props), ...Object.values(A.props), "onPressed", "onTap", "multiline", "maxLines", "variant", "kind", "columns", "children", "key"];
  for (let i = 0; i < 1500; i++) {
    const o = { type: r.pick([...Object.keys(A.types), "Stepper", "", "col"]) };
    for (let k = r.int(0, 8); k > 0; k--) o[r.pick(keys)] = r.pick(junk);
    if (r.bool()) o.children = [{ type: "TableRow", children: [{ type: "TableCell", crossAxisAlignment: r.pick(junk) }] }];
    parse(o);
    parse({ type: "heroCard", title: "t", buttons: [o] });
  }
});
