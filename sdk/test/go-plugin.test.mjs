// apiVersion 20: go.plugin as the kit reads it (PluginScreenOutput.pluginGoOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, pluginGoOf } from "../contract.mjs";
import { checkPanelScreenAnswer, checkScreenAnswer } from "../screen.mjs";

const read = (v) => { const why = []; return { go: pluginGoOf(v, (w) => why.push(w)), why }; };
const BAD_REPO = "repo must be a GitHub owner/name (a sub-path is allowed, a URL or an @ref is not), at most 200 characters";
const BAD_ROUTE = "route must be 1 to 64 letters, digits or . _ ~ -";

test("the contract lists the shape, from apiVersion 20, as the seventeenth", () => {
  assert.equal(contract.manifest.screen.goShapes[16], "plugin");
  const P = contract.manifest.screen.goPlugin;
  assert.deepEqual(P.fields, ["repo", "route", "args", "query"]);
  assert.equal(P.maxRepoChars, 200);
  assert.equal(P.maxQueryChars, 200);
  assert.equal(P.apiVersion, 20);
  assert.equal(contract.additiveFromApp["go.plugin"], "0.9.84");
});

test("a valid go is read; the address is canonical, args stay an object in the kit (the app keeps a JSON string)", () => {
  assert.deepEqual(
    read({ repo: "kinotvapp/kino-plugin-megaplay", route: "detail", args: { id: "x", n: 2 }, query: "Frieren" }).go,
    { address: "kinotvapp/kino-plugin-megaplay", route: "detail", args: { id: "x", n: 2 }, query: "Frieren" },
  );
  assert.deepEqual(read({ repo: "a/b" }).go, { address: "a/b" });
  assert.deepEqual(read({ repo: "a/b", route: null, args: null, query: null }).go, { address: "a/b" });
  assert.deepEqual(read({ repo: "a/b.git/" }).go, { address: "a/b" });
});

test("a sub-path is kept", () => {
  assert.deepEqual(read({ repo: "owner/repo/plugins/x" }).go, { address: "owner/repo/plugins/x" });
});

test("a URL, a @ref, a missing or too long repo is refused", () => {
  for (const repo of ["https://github.com/a/b", "http://x.example.com/kino-plugin.json", "a/b@v2", "a", "", 5, null, undefined, "a/" + "b".repeat(200)]) {
    const r = read({ repo });
    assert.deepEqual(r.why, [BAD_REPO], JSON.stringify(repo));
    assert.equal(r.go, null);
  }
});

test("another field, or a value that is not an object, is refused", () => {
  assert.deepEqual(read({ repo: "a/b", locked: true }).why, ["takes only repo, route, args, query"]);
  for (const v of ["a/b", 1, true, null, ["a/b"]]) assert.deepEqual(read(v).why, ["is not an object"], JSON.stringify(v));
});

test("route follows the go.screen rule", () => {
  for (const route of ["has space", "", 3, "a".repeat(65)]) assert.deepEqual(read({ repo: "a/b", route }).why, [BAD_ROUTE], JSON.stringify(route));
});

test("args must be an object within the cap", () => {
  for (const args of ["x", [1], 3]) assert.deepEqual(read({ repo: "a/b", args }).why, ["args is not an object"], JSON.stringify(args));
  const cap = contract.manifest.screen.limits.maxGoArgsBytes;
  assert.deepEqual(read({ repo: "a/b", args: { k: "x".repeat(cap) } }).why, [`args is over ${cap} bytes`]);
});

test("query is at most 200 characters", () => {
  assert.deepEqual(read({ repo: "a/b", query: "q".repeat(200) }).go, { address: "a/b", query: "q".repeat(200) });
  for (const query of ["q".repeat(201), 4]) assert.deepEqual(read({ repo: "a/b", query }).why, ["query must be a string of at most 200 characters"], JSON.stringify(query));
});

test("an answer keeps it at apiVersion 20 and drops it below", () => {
  assert.deepEqual(checkScreenAnswer({ go: { plugin: { repo: "a/b" } } }, "es", { apiVersion: 20 }).answer.go, { plugin: { address: "a/b" } });
  const old = checkScreenAnswer({ go: { plugin: { repo: "a/b" } } }, "es", { apiVersion: 19 });
  assert.equal(old.answer.go, null);
  assert.ok(old.dropped.includes("screen: answer go.plugin needs apiVersion 20, dropped"), old.dropped.join("\n"));
});

test("a panel drops it: only the plugin's own screen may open another plugin", () => {
  const r = checkPanelScreenAnswer({ go: { plugin: { repo: "a/b" } } }, "es", { apiVersion: 20 });
  assert.equal(r.answer.go, null);
  assert.ok(r.dropped.includes("panel: go.plugin is honoured only on the plugin's own screen, dropped"), r.dropped.join(" | "));
});
