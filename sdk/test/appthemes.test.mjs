// appThemes: the kit parses and resolves a theme exactly as the app does (AppThemeParser.kt, AppThemeResolver.kt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppThemes, resolveAppTheme } from "../appthemes.mjs";
import { validateManifest } from "../contract.mjs";
import { contract } from "../contract.mjs";

const example = {
  id: "neon",
  name: { es: "Neón", en: "Neon" },
  colors: { accent: "#00E5FF", onAccent: "#000000", background: "#0A0A14", surface: "#14142A" },
  background: { type: "gradient", colors: ["#0A0A14", "#1A0A2E"], angle: 180 },
  shape: { cardRadius: 14, buttonRadius: 24 },
  typography: { scale: 1.1 },
  elevation: { cardShadow: 0.6 },
  motion: { focusZoom: 1.1 },
  player: { buttonScale: 1.2, buttonShape: "rounded" },
  pluginColors: "respect",
  tv: { typography: { scale: 1.0 } },
  phone: { player: { buttonScale: 1.1 } },
  adjustable: {
    "colors.accent": { swatches: ["#00E5FF", "#7C4DFF", "#FFB300"] },
    "shape.cardRadius": { min: 0, max: 20 },
    "typography.scale": { min: 1.0, max: 1.3 },
    background: true,
  },
};

test("a white surfaceHigh falls back, the same as the app", () => {
  const r = resolveAppTheme({ values: { "colors.surfaceHigh": "#FFFFFF", "colors.surface": "#202020" }, pluginColors: "respect" });
  assert.equal(r.tokens["colors.surfaceHigh"], undefined);
  assert.equal(r.tokens["colors.surface"], "#202020");
  assert.deepEqual(r.warnings, ["colors.surfaceHigh: Kino's text isn't readable on it; Kino's is used"]);
});

test("dim text on a surfaceHigh too light for it falls back", () => {
  const r = resolveAppTheme({ values: { "colors.textPrimary": "#8A8A8A", "colors.textSecondary": "#8A8A8A" }, pluginColors: "respect" });
  assert.equal(r.tokens["colors.textPrimary"], undefined);
  assert.equal(r.tokens["colors.textSecondary"], undefined);
});

test("a default accent on a reddish background is caught, the same as the app", () => {
  const r = resolveAppTheme({ values: { "colors.background": "#700000" }, pluginColors: "respect" });
  assert.equal(r.tokens["colors.background"], undefined);
  assert.deepEqual(r.warnings, ["background: Kino's accent doesn't stand out on it; Kino's is used"]);
  const own = resolveAppTheme({ values: { "colors.background": "#700000", "colors.accent": "#00E5FF", "colors.onAccent": "#000000" }, pluginColors: "respect" });
  assert.equal(own.tokens["colors.background"], "#700000");
  assert.deepEqual(own.warnings, []);
});

test("a field that is not a list reads as the app's message", () => {
  assert.equal(parseAppThemes("x").message, 'The "appThemes" field must be a list of themes');
});

test("a theme that sets no color warns about nothing", () => {
  assert.deepEqual(resolveAppTheme({ values: { "shape.cardRadius": 14 }, pluginColors: "respect" }).warnings, []);
});

const manifest = (themes, extra = {}) => JSON.stringify({
  id: "neon-pack", name: "Neon", version: "1.0.0", apiVersion: 18, entry: "plugin.js", hosts: ["example.com"],
  capabilities: ["search", "resolve"], appThemes: themes, ...extra,
});
const theme = (id, extra = {}) => ({ id, name: "T", ...extra });

test("appThemes: the spec's example parses", () => {
  const r = parseAppThemes([example]);
  assert.equal(r.ok, true);
  const t = r.themes[0];
  assert.equal(t.id, "neon");
  assert.equal(t.nameEs, "Neón");
  assert.equal(t.values["colors.accent"], "#00E5FF");
  assert.deepEqual(t.values.background, { type: "gradient", colors: ["#0A0A14", "#1A0A2E"], angle: 180 });
  assert.equal(t.values["player.buttonShape"], "rounded");
  assert.deepEqual(t.tv, { "typography.scale": 1 });
  assert.deepEqual(t.adjustable["shape.cardRadius"], { min: 0, max: 20 });
  assert.equal(t.adjustable.background, true);
});

test("appThemes: format refusals match the app's", () => {
  const cases = [
    [[theme("aa", { shape: { cornerRadius: 4 } })], /unknown token "shape.cornerRadius"/],
    [[theme("aa", { background: { type: "solid", colors: ["#101010"], dim: 0.5 } })], /unknown token "background.dim"/],
    [[theme("aa", { background: { type: "image", image: "bg.png" } })], /arrives in a later version/],
    [[theme("aa", { shape: { cardRadius: "big" } })], /must be a number/],
    [[theme("aa", { colors: { accent: "red" } })], /must look like #RRGGBB/],
    [[theme("same"), theme("same")], /used twice/],
    [Array.from({ length: 9 }, (_, i) => theme(`t${i}`)), /at most 8 themes/],
    [[{ id: "Bad Id", name: "T" }], /the "id" must be/],
    [[theme("aa", { pluginColors: "maybe" })], /pluginColors/],
    [[theme("aa", { adjustable: { "colors.accent": { min: 0, max: 1 } } })], /cannot take min and max/],
    [[theme("aa", { adjustable: { "shape.cardRadius": { swatches: ["#FFFFFF"] } } })], /cannot take swatches/],
    [[theme("aa", { tv: { adjustable: {} } })], /"tv" has an unknown field/],
  ];
  for (const [themes, pattern] of cases) {
    const r = parseAppThemes(themes);
    assert.equal(r.ok, false, JSON.stringify(themes));
    assert.match(r.message, pattern);
  }
  const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`colors.accent${i}`, true]));
  assert.equal(parseAppThemes([theme("aa", { adjustable: many })]).ok, false);
  const all = Object.fromEntries(Object.keys(contract.manifest.appThemes.tokens).map((k) => [k, true]));
  assert.equal(parseAppThemes([theme("aa", { adjustable: all })]).ok, true);
});

test("appThemes: an out-of-range number parses and the resolver drops it", () => {
  const r = parseAppThemes([theme("aa", { shape: { cardRadius: 99 }, colors: { accent: "#00E5FF", onAccent: "#000000" } })]);
  assert.equal(r.ok, true);
  const out = resolveAppTheme(r.themes[0]);
  assert.deepEqual(out.warnings, ["shape.cardRadius: 99.0 is outside 0.0..32.0; Kino's is used"]);
  assert.equal(out.tokens["shape.cardRadius"], undefined);
  assert.equal(out.tokens["colors.accent"], "#00E5FF");
  assert.equal(out.tokens.accentText, "#00E5FF");
});

test("appThemes: the same warnings as AppThemeResolver, word for word", () => {
  const w = (t, opts) => resolveAppTheme(parseAppThemes([t]).themes[0], opts).warnings;
  assert.deepEqual(w(theme("aa", { colors: { background: "#7A7A7A" } })), ["background: is too light (the background must be dark for now); Kino's is used"]);
  assert.deepEqual(w(theme("aa", { colors: { accent: "#0B1E3F" } })), ["colors.accent: doesn't stand out on the background (at least 3:1); Kino's colors are used for accent and onAccent"]);
  assert.deepEqual(w(theme("aa", { colors: { accent: "#1DB954", onAccent: "#FFFFFF" } })), ["colors.onAccent: isn't readable on the accent (at least 4.5:1); Kino's colors are used for accent and onAccent"]);
  assert.deepEqual(w(theme("aa", { colors: { textPrimary: "#202020" } })), ["colors.textPrimary/textSecondary: not readable (at least 4.5:1) on the background and surface; Kino's text colors are used"]);
  assert.deepEqual(w(theme("aa", { colors: { surface: "#C0C0C0" } })), ["colors.surface: Kino's text isn't readable on it; Kino's is used"]);
  assert.deepEqual(w(theme("aa", { colors: { focus: "#101010", onFocus: "#101010" } })), ["colors.focus/onFocus: not legible (3:1 on the background, 4.5:1 for the text on it); Kino's are used"]);
  assert.deepEqual(w(theme("aa", { typography: { scale: 2 } })), ["typography.scale: 2.0 is outside 0.85..1.3; Kino's is used"]);
  assert.deepEqual(w(theme("aa", { motion: { heroDrift: "maybe" } })), ["motion.heroDrift: not a valid value for this token; Kino's is used"]);
  const adj = (t, adjustments) => resolveAppTheme(parseAppThemes([t]).themes[0], { adjustments });
  assert.equal(resolveAppTheme(parseAppThemes([theme("aa", { shape: { channelRadius: 14 } })]).themes[0]).tokens["shape.channelRadius"], 14);
  assert.deepEqual(adj(example, { "shape.buttonRadius": 4 }).warnings, ["shape.buttonRadius: the theme doesn't allow adjusting it; ignored"]);
  assert.deepEqual(adj(example, { "colors.accent": "#123456" }).warnings, ["colors.accent: not one of the theme's swatches; ignored"]);
});

test("appThemes: resolution order and clamps", () => {
  const t = parseAppThemes([example]).themes[0];
  assert.equal(resolveAppTheme(t, { tv: true }).tokens["typography.scale"], 1);
  assert.equal(resolveAppTheme(t, { tv: false }).tokens["typography.scale"], 1.1);
  assert.equal(resolveAppTheme(t, { tv: false }).tokens["player.buttonScale"], 1.1);
  assert.equal(resolveAppTheme(t, { tv: true }).tokens["player.buttonScale"], 1.2);
  const adjusted = resolveAppTheme(t, { adjustments: { "shape.cardRadius": 30, "colors.accent": "#FFB300" } });
  assert.equal(adjusted.tokens["shape.cardRadius"], 20);
  assert.equal(adjusted.tokens["colors.accent"], "#FFB300");
  assert.deepEqual(adjusted.warnings, []);
  assert.deepEqual(resolveAppTheme(null), { tokens: { pluginColors: "respect", accentText: "#FF6B6B" }, warnings: [] });
});

test("appThemes: the manifest check reads them from apiVersion 18, and they need no capabilities", () => {
  assert.equal(validateManifest(manifest([example])).ok, true);
  assert.equal(validateManifest(manifest([example])).manifest.appThemes.length, 1);
  assert.equal(validateManifest(manifest([example], { apiVersion: 16 })).manifest.appThemes.length, 0);
  assert.equal(validateManifest(manifest([theme("aa", { shape: { nope: 1 } })])).ok, false);
  const bare = validateManifest(manifest([example], { capabilities: undefined }));
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.manifest.capabilities, []);
  const empty = validateManifest(manifest([], { capabilities: undefined }));
  assert.equal(empty.ok, false);
  assert.equal(empty.field, "capabilities");
});

test("appThemes: a themes-only plugin needs no hosts", () => {
  const r = validateManifest(manifest([example], { capabilities: undefined, hosts: [] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.hosts, []);
  assert.equal(validateManifest(manifest([example], { capabilities: [], hosts: [] })).ok, true);
});

test("appThemes: a plugin with capabilities still needs hosts", () => {
  const r = validateManifest(manifest([example], { hosts: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.field, "hosts");
});

test("appThemes: themes is a store category", () => {
  assert.ok(contract.manifest.categories.values.includes("themes"));
  assert.equal(validateManifest(manifest([example], { categories: ["themes"] })).ok, true);
});

test("a theme with a screen and no settings needs no hosts", () => {
  const screen = { label: "Tema", opensFrom: ["settings"] };
  const base = { id: "with-screen", name: "T", version: "1.0.0", apiVersion: 18, entry: "plugin.js", hosts: [], appThemes: [example], capabilities: ["screen"], screen };
  assert.equal(validateManifest(JSON.stringify(base)).ok, true);
  const asks = { ...base, settings: [{ key: "a", label: "A", type: "text" }] };
  assert.equal(validateManifest(JSON.stringify(asks)).ok, false);
});
