// apiVersion 18: price, experience and logo as the kit reads them (AppThemeParser.kt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppThemes } from "../appthemes.mjs";

const author = "a".repeat(64);
const theme = (extra = {}) => [{ id: "aa", name: "Aa", ...extra }];
const shape = { size: [120, 30], paths: [{ d: "M0 0 L120 0 L60 30 Z", fill: "accent" }, { d: "M10 10h20v10z", fill: "#ffcc00" }] };

test("a theme is free unless it declares a price", () => {
  assert.equal(parseAppThemes(theme()).themes[0].price, null);
  assert.deepEqual(parseAppThemes(theme({ price: { kinos: 30, payTo: author } })).themes[0].price, { kinos: 30, payTo: author });
  for (const price of [{ kinos: 0, payTo: author }, { kinos: 1001, payTo: author }, { kinos: 1.5, payTo: author }, { kinos: 30 }, { kinos: 30, payTo: "nobody" }, { kinos: 30, payTo: author, x: 1 }, 30]) {
    assert.equal(parseAppThemes(theme({ price })).ok, false, JSON.stringify(price));
  }
});

test("experience is light or full", () => {
  assert.equal(parseAppThemes(theme({ experience: "full" })).themes[0].experience, "full");
  assert.equal(parseAppThemes(theme()).themes[0].experience, null);
  assert.equal(parseAppThemes(theme({ experience: "medium" })).ok, false);
});

test("a logo is vector only, with the app's limits", () => {
  const r = parseAppThemes(theme({ logo: { wordmark: shape, mark: { size: [30, 30], paths: [{ d: "M0 0h30v30z", fill: "textPrimary" }] } } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.themes[0].logo.wordmark.width, 120);
  assert.equal(r.themes[0].logo.wordmark.paths[1].fill, "#FFCC00");
  assert.equal(parseAppThemes(theme({ logo: { mark: { size: [30, 30], paths: [{ d: "M0 0z", fill: "accent" }] } } })).themes[0].logo.wordmark, null);
  const bad = [
    {}, { image: "logo.png" }, "logo.png", { wordmark: { size: [120, 30], paths: [] } }, { wordmark: { size: [2000, 30], paths: shape.paths } },
    { wordmark: { size: [400, 30], paths: shape.paths } }, { wordmark: { size: [120, 30], paths: [{ d: "M0 0 <script>", fill: "accent" }] } },
    { wordmark: { size: [120, 30], paths: [{ d: "M0 0z", fill: "red" }] } }, { wordmark: { size: [120, 30], paths: [{ d: "M0 0z", fill: "accent", x: 1 }] } },
  ];
  for (const logo of bad) assert.equal(parseAppThemes(theme({ logo })).ok, false, JSON.stringify(logo));
});
