// apiVersion 19: go.installPlugin as the kit reads it (PluginScreenOutput.installPluginGoOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, installPluginGoOf } from "../contract.mjs";
import { checkPanelScreenAnswer, checkScreenAnswer } from "../screen.mjs";

const read = (v) => { const why = []; return { go: installPluginGoOf(v, (w) => why.push(w)), why }; };
const BAD_REPO = "repo must be a plain owner/name, at most 100 characters";

test("the contract lists the shape, from apiVersion 19, as the sixteenth", () => {
  assert.equal(contract.manifest.screen.goShapes[15], "installPlugin");
  const I = contract.manifest.screen.goInstallPlugin;
  assert.deepEqual(I.fields, ["repo"]);
  assert.equal(I.maxRepoChars, 100);
  assert.equal(I.apiVersion, 19);
});

test("a bare owner/name is read and kept as written", () => {
  assert.deepEqual(read({ repo: "kinotvapp/kino-plugin-archive" }).go, { repo: "kinotvapp/kino-plugin-archive" });
  assert.deepEqual(read({ repo: "MiOrg/Mi.Plugin_X" }).go, { repo: "MiOrg/Mi.Plugin_X" });
});

test("a URL, a sub-path, a @ref, a missing or too long repo is dropped, with the app's reason", () => {
  for (const repo of ["https://github.com/a/b", "a/b/dir", "a/b@v1", "a", "", "/b", "a/", 5, null, undefined, "a/" + "b".repeat(100)]) {
    const r = read({ repo });
    assert.deepEqual(r.why, [BAD_REPO], JSON.stringify(repo));
    assert.equal(r.go, null);
  }
});

test("another field, or a value that is not an object, is dropped", () => {
  assert.deepEqual(read({ repo: "a/b", ref: "x" }).why, ["takes only repo"]);
  for (const v of ["a/b", 1, true, null, ["a/b"]]) assert.deepEqual(read(v).why, ["is not an object"], JSON.stringify(v));
});

test("an answer keeps it at apiVersion 19 and drops it below", () => {
  assert.deepEqual(checkScreenAnswer({ go: { installPlugin: { repo: "a/b" } } }).answer.go, { installPlugin: { repo: "a/b" } });
  const old = checkScreenAnswer({ go: { installPlugin: { repo: "a/b" } } }, "es", { apiVersion: 18 });
  assert.equal(old.answer.go, null);
  assert.ok(old.dropped.includes("screen: answer go.installPlugin needs apiVersion 19, dropped"), old.dropped.join("\n"));
});

test("a panel drops it: only the plugin's own screen may send the person to install", () => {
  const r = checkPanelScreenAnswer({ go: { installPlugin: { repo: "a/b" } } });
  assert.equal(r.answer.go, null);
  assert.ok(r.dropped.includes("panel: go.installPlugin is honoured only on the plugin's own screen, dropped"), r.dropped.join(" | "));
});
