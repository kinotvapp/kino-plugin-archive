import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppThemes } from "../appthemes.mjs";

const theme = (extra = {}) => ({ id: "t1", name: "T", colors: { accent: "#E50914" }, ...extra });
const sha = "a".repeat(64);
const asset = { id: "bg", path: "assets/bg.webp", sha256: sha, bytes: 10 };

test("surfaces, style, layout, assets, image and font parse at 26", () => {
  const r = parseAppThemes([theme({
    assets: [asset],
    style: { gloss: 0.5 },
    layout: { hero: "framed", rail: "floating" },
    background: { image: { asset: "bg", fit: "top", dim: 0.4 } },
    typography: { fontFamily: { regular: "bg" } },
    surfaces: { button: { fill: { type: "solid", color: "#112233" }, stroke: { width: 1, color: "#FFFFFF" }, glow: { color: "#E50914", radius: 8, alpha: 0.5 } } },
  })], 26);
  assert.ok(r.ok, r.message);
  const t = r.themes[0];
  assert.equal(t.gloss, 0.5);
  assert.deepEqual(t.layout, ["framed", "floating"]);
  assert.equal(t.backgroundImage.asset, "bg");
  assert.equal(t.font.regular, "bg");
  assert.equal(t.surfaces.button.stroke.width, 1);
});

test("below 24 the new keys are skipped, and a background image is refused", () => {
  const ok = parseAppThemes([theme({ surfaces: { button: { fill: { type: "solid", color: "#112233" } } }, style: { gloss: 1 } })], 18);
  assert.ok(ok.ok, ok.message);
  assert.deepEqual(ok.themes[0].surfaces, {});
  const img = parseAppThemes([theme({ assets: [asset], background: { image: { asset: "bg" } } })], 18);
  assert.equal(img.ok, false);
});

test("the same refusals as the app", () => {
  const bad = (extra, needle) => { const r = parseAppThemes([theme(extra)], 26); assert.equal(r.ok, false); assert.match(r.message, needle); };
  bad({ surfaces: { banana: {} } }, /unknown token "surfaces.banana"/);
  bad({ surfaces: { button: { shadow: {} } } }, /unknown field: "shadow"/);
  bad({ assets: [{ ...asset, sha256: "xyz" }] }, /sha256 must be 64 hexadecimal/);
  bad({ assets: [asset], background: { image: { asset: "nope" } } }, /does not declare/);
  bad({ layout: { hero: "wide" } }, /hero must be/);
  bad({ surfaces: { button: { stroke: { width: 1 } } } }, /exactly one of/);
});
