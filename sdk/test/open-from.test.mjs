// node --test plugins/sdk/test/open-from.test.mjs   (Node 18+)
// Manifest "openFrom" (apiVersion 20): the screen routes other plugins' cards may open. Mirrors ManifestParserTest's openFrom cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, validateManifest } from "../contract.mjs";

const O = () => contract.manifest.openFrom;
const base = (api = 20, extra = {}) => ({
  id: "archive-org", name: "Internet Archive", version: "1.0.0", apiVersion: api, entry: "plugin.js",
  hosts: ["archive.org"], capabilities: ["search", "resolve", "screen"], screen: { label: "Inicio", labelEn: "Home" }, ...extra,
});
const check = (m) => validateManifest(JSON.stringify(m));

test("openFrom routes are parsed", () => {
  const r = check(base(20, { openFrom: { routes: ["detail", "chapter"] } }));
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.manifest.openFromRoutes, ["detail", "chapter"]);
  assert.deepEqual(check(base()).manifest.openFromRoutes, []);
});

test("openFrom needs apiVersion 20 at the top level, and is accepted inside enhancements 20", () => {
  const r = check(base(16, { openFrom: { routes: ["detail"] } }));
  assert.equal(r.ok, false);
  assert.equal(r.field, "openFrom");
  assert.equal(r.message, O().needsApiMessage);
  const e = check(base(16, { enhancements: { 20: { openFrom: { routes: ["detail"] } } } }));
  assert.equal(e.ok, true, e.message);
  assert.deepEqual(e.manifest.openFromRoutes, ["detail"]);
});

test("openFrom needs the screen capability", () => {
  const { screen, ...rest } = base(20, { openFrom: { routes: ["detail"] }, capabilities: ["search", "resolve"] });
  const r = check(rest);
  assert.equal(r.ok, false);
  assert.equal(r.field, "openFrom");
  assert.equal(r.message, O().needsScreenMessage);
});

test("openFrom refuses bad route names", () => {
  const bad = [{ routes: [] }, { routes: ["detail", "detail"] }, { routes: ["r".repeat(65)] }, { routes: ["a b"] },
    { routes: Array.from({ length: 17 }, (_, i) => `r${i}`) }, {}];
  for (const b of bad) {
    const r = check(base(20, { openFrom: b }));
    assert.equal(r.ok, false, JSON.stringify(b).slice(0, 60));
    assert.equal(r.field, "openFrom");
    assert.equal(r.message, O().badRoutesMessage);
  }
  assert.equal(check(base(20, { openFrom: "detail" })).message, O().notObjectMessage);
  assert.equal(check(base(20, { openFrom: { routes: ["r".repeat(64)] } })).ok, true);
});
