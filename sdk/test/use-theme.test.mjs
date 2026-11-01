// apiVersion 18: go.useTheme as the kit reads it, and the activeTheme a screen is told (PluginScreenOutput.useThemeGoOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, useThemeGoOf } from "../contract.mjs";
import { checkPanelScreenAnswer, checkScreenAnswer, fakeScreenContext, fakeScreenEvent } from "../screen.mjs";
import { screenRequest } from "../run.mjs";

const read = (v) => { const why = []; return { go: useThemeGoOf(v, (w) => why.push(w)), why }; };

test("the contract lists the shape, from apiVersion 18", () => {
  assert.ok(contract.manifest.screen.goShapes.includes("useTheme"));
  assert.deepEqual(contract.manifest.screen.goUseTheme.fields, ["theme"]);
  assert.equal(contract.manifest.screen.goUseTheme.apiVersion, 18);
});

test("a theme id and null are read", () => {
  assert.deepEqual(read({ theme: "neon" }).go, { theme: "neon" });
  assert.deepEqual(read({ theme: null }).go, { theme: null });
});

test("anything else is dropped, with the app's reason", () => {
  assert.deepEqual(read({ theme: "neon", x: 1 }).why, ["takes only theme"]);
  for (const v of [{ theme: 7 }, { theme: true }, { theme: "Not An Id" }, {}]) assert.deepEqual(read(v).why, ["theme must be a theme id or null"]);
  assert.deepEqual(read(true).why, ["is not an object"]);
});

test("an answer keeps it at apiVersion 18 and drops it below", () => {
  assert.deepEqual(checkScreenAnswer({ go: { useTheme: { theme: "neon" } } }).answer.go, { useTheme: { theme: "neon" } });
  const old = checkScreenAnswer({ go: { useTheme: { theme: "neon" } } }, "es", { apiVersion: 16 });
  assert.equal(old.answer.go, null);
  assert.ok(old.dropped.includes("screen: answer go.useTheme needs apiVersion 18, dropped"), old.dropped.join("\n"));
});

test("a timer's and a pop-up's onClose answer drop it", () => {
  const go = { go: { useTheme: { theme: null } } };
  assert.equal(checkScreenAnswer(go, "es", { timer: true }).answer.go, null);
  assert.equal(checkScreenAnswer(go, "es", { dismiss: true }).answer.go, null);
});

test("a screen-format panel drops it", () => {
  const r = checkPanelScreenAnswer({ go: { useTheme: { theme: "neon" } } });
  assert.equal(r.answer.go, null);
  assert.ok(r.dropped.includes("panel: go.useTheme is honoured only on the plugin's own screen, dropped"), r.dropped.join("\n"));
});

test("screen and screenEvent are told activeTheme, null by default", () => {
  assert.equal(fakeScreenContext().activeTheme, null);
  assert.equal(fakeScreenContext({ activeTheme: "neon" }).activeTheme, "neon");
  assert.equal(fakeScreenEvent("tap").activeTheme, null);
  assert.equal(fakeScreenEvent("tap", { activeTheme: "neon" }).activeTheme, "neon");
  assert.equal(screenRequest("screenEvent", ["tap"], { context: { activeTheme: "neon" } }).event.activeTheme, "neon");
});
