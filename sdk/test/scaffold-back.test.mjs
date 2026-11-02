// apiVersion 19: Scaffold.onBack and AppBar.mergeWithKinoBar as the kit reads them (PluginScreenOutput.scaffoldOnBack, appBarMerge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract } from "../contract.mjs";
import { checkPanelScreen, checkScreenTree } from "../screen.mjs";

const LEADING = { type: "IconButton", icon: "arrow_back", labelText: "Atrás", onPressed: "up" };
const tree = (extra = {}, bar = { type: "AppBar", title: "Buscar", leading: LEADING, mergeWithKinoBar: true }) =>
  ({ type: "Scaffold", ...extra, appBar: bar, body: { type: "Text", text: "cuerpo" } });
const read = (t, opts) => checkScreenTree(t, "es", undefined, opts);

test("the contract names both properties and the apiVersion that brought them", () => {
  const G = contract.manifest.screen.scaffold;
  assert.equal(G.onBackField, "onBack");
  assert.equal(G.mergeField, "mergeWithKinoBar");
  assert.equal(G.backApiVersion, 19);
  assert.equal(contract.additiveFromApp["scaffold.onBack"], "0.9.81");
  assert.equal(contract.additiveFromApp["appBar.mergeWithKinoBar"], "0.9.81");
});

test("onBack as a string, an object and with ui operations", () => {
  const a = read(tree({ onBack: "close_search" }));
  assert.deepEqual(a.dropped, []);
  assert.equal(a.tree.onBack.event.name, "close_search");
  assert.equal(read(tree({ onBack: { event: "close_search", arg: "x" } })).tree.onBack.event.arg, "x");
  const c = read(tree({ onBack: { ui: [{ hide: "q" }], event: "close_search" } })).tree.onBack;
  assert.equal(c.ui.length, 1);
  assert.equal(c.event.name, "close_search");
  assert.equal(read(tree()).tree.onBack, null);
  assert.equal(read(tree({ onBack: null })).tree.onBack, null);
});

test("onBack never navigates: its go is dropped, and a go alone drops the whole onBack", () => {
  const both = read(tree({ onBack: { go: { close: true }, event: "x" } }));
  assert.equal(both.tree.onBack.go, null);
  assert.equal(both.tree.onBack.event.name, "x");
  assert.ok(both.dropped.some((d) => d.includes("has both an event and a go")), both.dropped.join("\n"));
  const alone = read(tree({ onBack: { go: { close: true } } }));
  assert.equal(alone.tree.onBack, null);
  assert.ok(alone.dropped.some((d) => d.includes("scaffold onBack go is not allowed")), alone.dropped.join("\n"));
});

test("a bad onBack is dropped, logged, the screen kept", () => {
  for (const bad of [3, true, [1], {}, "bad name", "open", { event: 3 }]) {
    const r = read(tree({ onBack: bad }));
    assert.ok(r.tree, JSON.stringify(bad));
    assert.equal(r.tree.onBack, null, JSON.stringify(bad));
    assert.ok(r.dropped.length > 0, JSON.stringify(bad));
  }
});

test("both are dropped below apiVersion 19, logged", () => {
  const r = read(tree({ onBack: "close_search" }), { apiVersion: 18 });
  assert.equal(r.tree.onBack, null);
  assert.equal(r.tree.appBar.mergeWithKinoBar, false);
  assert.ok(r.dropped.includes("screen: scaffold onBack needs apiVersion 19, dropped"), r.dropped.join("\n"));
  assert.ok(r.dropped.includes("screen: appBar mergeWithKinoBar needs apiVersion 19, dropped"), r.dropped.join("\n"));
});

test("mergeWithKinoBar needs a leading and the boolean true", () => {
  assert.equal(read(tree()).tree.appBar.mergeWithKinoBar, true);
  const none = read(tree({}, { type: "AppBar", title: "x", mergeWithKinoBar: true }));
  assert.equal(none.tree.appBar.mergeWithKinoBar, false);
  assert.ok(none.dropped.some((d) => d.includes("mergeWithKinoBar needs a leading IconButton, ignored")), none.dropped.join("\n"));
  assert.equal(read(tree({}, { type: "AppBar", title: "x", leading: LEADING })).tree.appBar.mergeWithKinoBar, false);
  for (const bad of ["true", 1, {}, []]) {
    const r = read(tree({}, { type: "AppBar", title: "x", leading: LEADING, mergeWithKinoBar: bad }));
    assert.equal(r.tree.appBar.mergeWithKinoBar, false, JSON.stringify(bad));
    assert.ok(r.dropped.some((d) => d.includes("mergeWithKinoBar") && d.includes("is not true or false")), r.dropped.join("\n"));
  }
});

test("a player panel ignores both, logged", () => {
  const r = checkPanelScreen({ format: "screen", root: tree({ onBack: "close_search" }) }, "es", {});
  assert.ok(r.dropped.includes("screen: scaffold onBack works only on a screen, ignored in a player panel"), r.dropped.join("\n"));
  assert.ok(r.dropped.includes("screen: appBar mergeWithKinoBar works only on a screen, ignored in a player panel"), r.dropped.join("\n"));
});
