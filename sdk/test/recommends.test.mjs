// Kino 0.9.81: the manifest's "recommends" and the screen argument "installed" (ManifestParser.RECOMMENDS, PluginScreenSession).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, bareRepoOf, validateManifest } from "../contract.mjs";
import { fakeScreenContext, fakeScreenEvent } from "../screen.mjs";
import { screenRequest } from "../run.mjs";

const manifest = (extra = {}, apiVersion = 8) => JSON.stringify({
  id: "rec-demo", name: "Rec demo", version: "1.0.0", apiVersion, entry: "plugin.js", hosts: ["example.com"],
  capabilities: ["resolve", "search"], ...extra,
});
const BAD = { ok: false, field: "recommends", message: 'The "recommends" field must be a list of at most 8 plain GitHub owner/name repositories' };

test("the contract carries the field: 8 at most, additive from Kino 0.9.81, the app's message", () => {
  const r = contract.manifest.recommends;
  assert.equal(r.max, 8);
  assert.equal(r.maxRepoChars, 100);
  assert.equal(r.badMessage, BAD.message);
  assert.equal(contract.additiveFromApp.recommends, "0.9.81");
});

test("a valid list is kept as written, at every apiVersion", () => {
  for (const api of [1, 8, 18, 19]) {
    const v = validateManifest(manifest({ recommends: ["kinotvapp/kino-plugin-archive", "Acme/Other.Plugin"] }, api));
    assert.equal(v.ok, true, `apiVersion ${api}: ${JSON.stringify(v)}`);
    assert.deepEqual(v.manifest.recommends, ["kinotvapp/kino-plugin-archive", "Acme/Other.Plugin"]);
  }
});

test("no field, an empty list or null declare none", () => {
  assert.equal(validateManifest(manifest()).manifest.recommends, undefined);
  assert.equal(validateManifest(manifest({ recommends: [] })).manifest.recommends, undefined);
  assert.equal(validateManifest(manifest({ recommends: null })).ok, true);
});

test("a repeat (ignoring case) collapses, keeping the first", () => {
  const v = validateManifest(manifest({ recommends: ["acme/lyrics", "ACME/Lyrics", "acme/other", "Acme/LYRICS"] }));
  assert.deepEqual(v.manifest.recommends, ["acme/lyrics", "acme/other"]);
});

test("eight are fine, nine are refused", () => {
  const n = (k) => Array.from({ length: k }, (_, i) => `acme/p${i + 1}`);
  assert.equal(validateManifest(manifest({ recommends: n(8) })).ok, true);
  assert.deepEqual(validateManifest(manifest({ recommends: n(9) })), BAD);
  // Nine entries that collapse to fewer are still too many: the app counts the list as written.
  assert.deepEqual(validateManifest(manifest({ recommends: [...n(8), "ACME/P1"] })), BAD);
});

test("anything but an array is refused", () => {
  for (const v of ["acme/p", { "acme/p": true }, 5, true]) assert.deepEqual(validateManifest(manifest({ recommends: v })), BAD, JSON.stringify(v));
});

test("a URL, a sub-path, a @ref, an empty or a non-string entry is refused", () => {
  const entries = ["https://github.com/acme/p", "github.com/acme/p/", "acme/p/dir", "acme/p@v1", "", "  ", "acme", "/p", "acme/", 7, null, ["acme/p"], "a/" + "b".repeat(100)];
  for (const e of entries) assert.deepEqual(validateManifest(manifest({ recommends: ["acme/ok", e] })), BAD, JSON.stringify(e));
});

test("bareRepoOf reads what PluginAddress.bareRepoOf does", () => {
  assert.equal(bareRepoOf("Acme/Plugin"), "Acme/Plugin");
  assert.equal(bareRepoOf("acme/p@HEAD"), "acme/p");
  assert.equal(bareRepoOf("acme/p.git"), "acme/p");
  assert.equal(bareRepoOf("acme/p@v1"), null);
  assert.equal(bareRepoOf("https://x/acme/p"), null);
});

test("screen and screenEvent get installed, {} by default", () => {
  assert.deepEqual(fakeScreenContext().installed, {});
  assert.deepEqual(fakeScreenEvent("tap").installed, {});
  assert.deepEqual(fakeScreenEvent("tap", { installed: { "a/b": true } }).installed, { "a/b": true });
  assert.deepEqual(screenRequest("screen", [], {}).context.installed, {});
  assert.deepEqual(screenRequest("screenEvent", ["tap"], {}).event.installed, {});
});

test("the kit derives installed from the manifest's recommends, all false, --context marks some", () => {
  const recommends = ["kinotvapp/kino-plugin-archive", "Acme/Other"];
  assert.deepEqual(screenRequest("screen", [], { recommends }).context.installed, { "kinotvapp/kino-plugin-archive": false, "Acme/Other": false });
  const ctx = { installed: { "Acme/Other": true } };
  assert.deepEqual(screenRequest("screen", [], { recommends, context: ctx }).context.installed, { "kinotvapp/kino-plugin-archive": false, "Acme/Other": true });
  assert.deepEqual(screenRequest("screenEvent", ["tap"], { recommends, context: ctx }).event.installed, { "kinotvapp/kino-plugin-archive": false, "Acme/Other": true });
});

test("a key the manifest does not recommend is never added", () => {
  const recommends = ["acme/p"];
  assert.throws(() => screenRequest("screen", [], { recommends, context: { installed: { "other/q": true } } }), /not in the manifest's "recommends"/);
  assert.throws(() => screenRequest("screen", [], { context: { installed: { "acme/p": true } } }), /not in the manifest's "recommends"/);
  assert.throws(() => screenRequest("screen", [], { recommends, context: { installed: { "acme/p": "yes" } } }), /true or false/);
  assert.deepEqual(screenRequest("screen", [], { recommends: [] }).context.installed, {});
});
