// A plugin's app themes (apiVersion 18): the same format checks and guardrails as the app's AppThemeParser.kt and
// AppThemeResolver.kt (numbers and token lists from contract.json, manifest.appThemes). The warnings are the app's, word for word.
//
// A theme as parsed: { id, nameEs, nameEn, values, tv, phone, pluginColors, adjustable }
//   values / tv / phone: { "colors.accent": "#RRGGBB", "shape.cardRadius": 14, "player.buttonShape": "rounded",
//                          "background": "#RRGGBB" | { type: "gradient", colors: [...], angle } }
//   adjustable: { "<token>": true | { swatches: [...] } | { min, max } }
import { contract } from "./contract.mjs";
import { contrast, luminance } from "./palette.mjs";

const A = () => contract.manifest.appThemes;
const re = (p) => new RegExp(p);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hexOf = (v) => (typeof v === "string" && re(contract.manifest.colorPattern).test(v) ? v.toUpperCase() : null);
const cut = (s) => String(s).slice(0, A().nameMaxChars);

const ok = (value) => ({ ok: true, value });
const err = (message) => ({ ok: false, message: `appThemes: ${message}` });

/** Parses the `appThemes` array: { ok: true, themes } or { ok: false, message }. Never throws. */
export function parseAppThemes(arr, api = Infinity) {
  const a = A();
  if (!Array.isArray(arr)) return { ok: false, message: 'The "appThemes" field must be a list of themes' };
  if (arr.length > a.maxThemes) return err(`A plugin may declare at most ${a.maxThemes} themes`);
  const themes = [];
  const ids = new Set();
  for (let i = 0; i < arr.length; i++) {
    if (!isObj(arr[i])) return err(`Theme ${i + 1} must be an object`);
    const r = parseTheme(arr[i], i + 1, api);
    if (!r.ok) return r;
    if (ids.has(r.value.id)) return err(`The theme id "${r.value.id}" is used twice`);
    ids.add(r.value.id);
    themes.push(r.value);
  }
  return { ok: true, themes };
}

function parseTheme(o, n, api) {
  const a = A();
  const newKeys = api >= a.surfaces.apiVersion;
  const top = new Set(["id", "name", "pluginColors", "adjustable", "tv", "phone", "background", "price", "experience", "logo", "surfaces", "style", "layout", "assets", ...a.groups]);
  const unknown = Object.keys(o).filter((k) => !top.has(k)).sort()[0];
  if (unknown !== undefined) return err(`theme ${n} has an unknown field: "${cut(unknown)}"`);
  const id = typeof o.id === "string" ? o.id : "";
  if (!re(a.idPattern).test(id)) return err(`theme ${n}: the "id" must be 2 to 40 characters: a-z, 0-9 and "-"`);
  const names = parseNames(o.name, id);
  if (!names.ok) return names;
  const assets = newKeys && o.assets !== undefined ? parseAssets(o.assets, id) : ok([]);
  if (!assets.ok) return assets;
  const ctx = { newKeys, assetIds: new Set(assets.value.map((x) => x.id)) };
  const values = parseBlock(o, id, "", ctx);
  if (!values.ok) return values;
  let gloss = null;
  if (newKeys && o.style !== undefined) {
    const st = parseStyle(o.style, id);
    if (!st.ok) return st;
    gloss = st.value;
  }
  const form = {};
  const formBlocks = {};
  for (const key of ["tv", "phone"]) {
    if (o[key] === undefined) continue;
    if (!isObj(o[key])) return err(`theme "${id}": "${key}" must be an object`);
    const blockKeys = new Set([...a.groups, "background", ...a.surfaces.blockKeys]);
    const bad = Object.keys(o[key]).filter((k) => !blockKeys.has(k)).sort()[0];
    if (bad !== undefined) return err(`theme "${id}": "${key}" has an unknown field: "${cut(bad)}"`);
    const b = parseBlock(o[key], id, `${key}.`, ctx);
    if (!b.ok) return b;
    form[key] = b.value;
    formBlocks[key] = b;
  }
  let pluginColors = a.pluginColorsDefault;
  if (o.pluginColors !== undefined && o.pluginColors !== null) {
    if (!a.pluginColors.includes(o.pluginColors)) return err(`theme "${id}": "pluginColors" must be "respect" or "override"`);
    pluginColors = o.pluginColors;
  }
  const adjustable = parseAdjustable(o.adjustable, id);
  if (!adjustable.ok) return adjustable;
  const price = parsePrice(o.price, id, "price" in o);
  if (!price.ok) return price;
  let experience = null;
  if (o.experience !== undefined && o.experience !== null) {
    if (!a.experience.includes(o.experience)) return err(`theme "${id}": "experience" must be "light" or "full"`);
    experience = o.experience;
  }
  const logo = parseLogo(o.logo, id, "logo" in o);
  if (!logo.ok) return logo;
  return ok({
    id, nameEs: names.value[0], nameEn: names.value[1], values: values.value, tv: form.tv ?? {}, phone: form.phone ?? {}, pluginColors,
    adjustable: adjustable.value, price: price.value, experience, logo: logo.value,
    surfaces: values.surfaces, gloss, layout: values.layout, assets: assets.value, backgroundImage: values.image, font: values.font,
    tvExtras: formBlocks.tv ? extrasOf(formBlocks.tv) : null, phoneExtras: formBlocks.phone ? extrasOf(formBlocks.phone) : null,
  });
}

// `price`: { kinos: 1 to 1000, payTo: the author's coins account }. Absent = free; the author is paid, so `payTo` is required.
function parsePrice(raw, id, present) {
  if (!present) return ok(null);
  const p = A().price;
  if (!isObj(raw)) return err(`theme "${id}": "price" must be an object { "kinos", "payTo" }`);
  const extra = Object.keys(raw).filter((k) => !p.fields.includes(k)).sort()[0];
  if (extra !== undefined) return err(`theme "${id}": "price" has an unknown field: "${cut(extra)}"`);
  if (!Number.isInteger(raw.kinos) || raw.kinos < p.minKinos || raw.kinos > p.maxKinos) {
    return err(`theme "${id}": "price.kinos" must be a whole number from ${p.minKinos} to ${p.maxKinos}`);
  }
  if (typeof raw.payTo !== "string" || !re(p.accountPattern).test(raw.payTo)) {
    return err(`theme "${id}": "price.payTo" must be the author's coins account: 64 lowercase hexadecimal characters`);
  }
  return ok({ kinos: raw.kinos, payTo: raw.payTo });
}

// `logo`: { wordmark, mark, decor }. wordmark and mark are each { size: [w, h], paths: [{ d, fill }] }; decor is { paths } drawn over
// Kino's own logo in the space of its "o". Vector only, at least one of the three.
function parseLogo(raw, id, present) {
  if (!present) return ok(null);
  const l = A().logo;
  if (!isObj(raw)) return err(`theme "${id}": "logo" must be an object { "wordmark", "mark", "decor" }`);
  const extra = Object.keys(raw).filter((k) => !l.shapes.includes(k) && k !== "decor").sort()[0];
  if (extra !== undefined) return err(`theme "${id}": "logo" has an unknown field: "${cut(extra)}"`);
  if (raw.wordmark === undefined && raw.mark === undefined && raw.decor === undefined) return err(`theme "${id}": "logo" needs a "wordmark", a "mark" or a "decor"`);
  const out = { wordmark: null, mark: null, decor: null };
  if (raw.decor !== undefined) {
    const where = `theme "${id}": "logo.decor"`;
    if (!isObj(raw.decor)) return err(`${where} must be an object { "paths" }`);
    const bad = Object.keys(raw.decor).filter((k) => k !== "paths").sort()[0];
    if (bad !== undefined) return err(`${where} has an unknown field: "${cut(bad)}"`);
    const paths = parseLogoPaths(raw.decor.paths, where, l);
    if (!paths.ok) return paths;
    out.decor = paths.value;
  }
  for (const key of l.shapes) {
    if (raw[key] === undefined) continue;
    const where = `theme "${id}": "logo.${key}"`;
    const s = raw[key];
    if (!isObj(s)) return err(`${where} must be an object { "size", "paths" }`);
    const bad = Object.keys(s).filter((k) => k !== "size" && k !== "paths").sort()[0];
    if (bad !== undefined) return err(`${where} has an unknown field: "${cut(bad)}"`);
    const [w, h] = Array.isArray(s.size) && s.size.length === 2 ? s.size : [];
    const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= l.maxCanvas;
    if (!inRange(w) || !inRange(h)) return err(`${where}.size must be [width, height], whole numbers from 1 to ${l.maxCanvas}`);
    if (w > h * l.maxAspect || h > w * l.maxAspect) return err(`${where}.size is more than ${l.maxAspect} times wider than tall (or the reverse)`);
    const paths = parseLogoPaths(s.paths, where, l);
    if (!paths.ok) return paths;
    out[key] = { width: w, height: h, paths: paths.value };
  }
  return ok(out);
}

// A logo's `paths`: 1 to maxPaths of { d, fill }, shared by the shapes and the decor.
function parseLogoPaths(raw, where, l) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > l.maxPaths) return err(`${where}.paths must be a list of 1 to ${l.maxPaths} paths`);
  const paths = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!isObj(p)) return err(`${where}.paths[${i}] must be an object { "d", "fill" }`);
    const pb = Object.keys(p).filter((k) => k !== "d" && k !== "fill").sort()[0];
    if (pb !== undefined) return err(`${where}.paths[${i}] has an unknown field: "${cut(pb)}"`);
    if (typeof p.d !== "string" || p.d.trim() === "" || p.d.length > l.maxPathChars || !re(l.pathPattern).test(p.d)) {
      return err(`${where}.paths[${i}].d must be SVG path data (M, L, H, V, C, S, Q, T, A, Z and numbers), up to ${l.maxPathChars} characters`);
    }
    const color = hexOf(p.fill);
    if (typeof p.fill !== "string" || (!l.fillTokens.includes(p.fill) && color === null)) {
      return err(`${where}.paths[${i}].fill must be accent, onAccent, textPrimary, textSecondary or a color #RRGGBB`);
    }
    paths.push({ d: p.d, fill: color ?? p.fill });
  }
  return ok(paths);
}

// `name`: { es, en } (one may be missing and falls back to the other) or a plain string for both.
function parseNames(raw, id) {
  const text = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  let es = null;
  let en = null;
  if (typeof raw === "string") es = en = text(raw);
  else if (isObj(raw)) { es = text(raw.es); en = text(raw.en); }
  const esName = es ?? en;
  const enName = en ?? es;
  if (esName === null || enName === null) return err(`theme "${id}": the "name" must be a text or { "es", "en" }`);
  const max = A().nameMaxChars;
  if (esName.length > max || enName.length > max) return err(`theme "${id}": the "name" must be at most ${max} characters`);
  return ok([esName, enName]);
}

function parseBlock(o, id, prefix, ctx) {
  const a = A();
  const out = {};
  let font = null;
  let image = null;
  for (const group of a.groups) {
    if (o[group] === undefined) continue;
    if (!isObj(o[group])) return err(`theme "${id}": "${prefix}${group}" must be an object`);
    for (const key of Object.keys(o[group]).sort()) {
      const path = `${group}.${key}`;
      if (path === "typography.fontFamily") {
        if (ctx.newKeys) {
          const f = parseFont(o[group][key], id, `${prefix}${path}`, ctx);
          if (!f.ok) return f;
          font = f.value;
        }
        continue;
      }
      if (!ctx.newKeys && NEW_TOKENS.has(path)) continue;
      const kind = a.tokens[path];
      if (kind === undefined || kind === "background") return err(`theme "${id}": unknown token "${prefix}${path}"`);
      const v = o[group][key];
      if (kind === "color") {
        const h = hexOf(v);
        if (h === null) return err(`theme "${id}": "${prefix}${path}" must look like #RRGGBB`);
        out[path] = h;
      } else if (kind === "number") {
        if (typeof v !== "number") return err(`theme "${id}": "${prefix}${path}" must be a number`);
        out[path] = v;
      } else {
        if (typeof v !== "string") return err(`theme "${id}": "${prefix}${path}" must be a word, one of ${a.words[path].map((w) => `"${w}"`).join(", ")}`);
        out[path] = v;
      }
    }
  }
  if (o.background !== undefined) {
    const raw = o.background;
    if (isObj(raw) && raw.image !== undefined && ctx.newKeys) {
      const im = parseImage(raw.image, id, prefix, ctx);
      if (!im.ok) return im;
      image = im.value;
    }
    // At 24 a background may be the image alone (colors.background is then the fallback).
    const imageOnly = isObj(raw) && ctx.newKeys && raw.image !== undefined && raw.type === undefined && raw.colors === undefined && raw.angle === undefined;
    if (imageOnly) {
      const stray = Object.keys(raw).filter((k) => k !== "image").sort()[0];
      if (stray !== undefined) return err(`theme "${id}": unknown token "${prefix}background.${cut(stray)}"`);
    } else {
      const b = parseBackground(raw, id, prefix, ctx.newKeys);
      if (!b.ok) return b;
      out.background = b.value;
    }
  }
  let surfaces = {};
  let layout = [null, null];
  if (ctx.newKeys && o.surfaces !== undefined) {
    const sf = parseSurfaces(o.surfaces, id, prefix);
    if (!sf.ok) return sf;
    surfaces = sf.value;
  }
  if (ctx.newKeys && o.layout !== undefined) {
    const l = parseLayout(o.layout, id, prefix);
    if (!l.ok) return l;
    layout = l.value;
  }
  const res = ok(out);
  res.surfaces = surfaces;
  res.layout = layout;
  res.image = image;
  res.font = font;
  return res;
}

function parseBackground(b, id, prefix, newKeys) {
  const a = A();
  if (!isObj(b)) return err(`theme "${id}": "${prefix}background" must be an object`);
  if (b.image !== undefined && !newKeys) return err(`theme "${id}": ${a.imageArrivesLater}`);
  const stray = Object.keys(b).filter((k) => k !== "type" && k !== "colors" && k !== "angle" && k !== "image").sort()[0];
  if (stray !== undefined) return err(`theme "${id}": unknown token "${prefix}background.${cut(stray)}"`);
  if (!a.backgroundTypes.includes(b.type)) return err(`theme "${id}": "${prefix}background.type" must be "solid" or "gradient"`);
  const badColors = `theme "${id}": "${prefix}background.colors" must be a list of #RRGGBB colors`;
  if (!Array.isArray(b.colors)) return err(badColors);
  const colors = [];
  for (const c of b.colors) {
    const h = hexOf(c);
    if (h === null) return err(badColors);
    colors.push(h);
  }
  if (b.type === "solid") {
    if (colors.length !== 1) return err(`theme "${id}": a solid "${prefix}background" takes exactly one color`);
    return ok(colors[0]);
  }
  if (colors.length < 2 || colors.length > a.backgroundMaxColors) return err(`theme "${id}": a gradient "${prefix}background" takes 2 to ${a.backgroundMaxColors} colors`);
  let angle = a.backgroundDefaultAngle;
  if (b.angle !== undefined && b.angle !== null) {
    if (typeof b.angle !== "number" || !Number.isInteger(b.angle)) return err(`theme "${id}": "${prefix}background.angle" must be a whole number of degrees`);
    angle = ((b.angle % 360) + 360) % 360;
  }
  return ok({ type: "gradient", colors, angle });
}

function parseAdjustable(raw, id) {
  const a = A();
  if (raw === undefined || raw === null) return ok({});
  if (!isObj(raw)) return err(`theme "${id}": "adjustable" must be an object`);
  const keys = Object.keys(raw);
  if (keys.length > a.maxAdjustable) return err(`theme "${id}": "adjustable" may list at most ${a.maxAdjustable} tokens`);
  const out = {};
  for (const path of keys.sort()) {
    const kind = a.tokens[path];
    if (kind === undefined) return err(`theme "${id}": "adjustable" names an unknown token "${cut(path)}"`);
    const rule = raw[path];
    if (rule === true) out[path] = true;
    else if (isObj(rule) && rule.swatches !== undefined) {
      if (kind !== "color") return err(`theme "${id}": "adjustable.${path}" cannot take swatches (it is not a color)`);
      const list = Array.isArray(rule.swatches) ? rule.swatches.map(hexOf) : null;
      if (list === null || list.length === 0 || list.includes(null)) return err(`theme "${id}": "adjustable.${path}" swatches must be a list of #RRGGBB colors`);
      out[path] = { swatches: list };
    } else if (isObj(rule)) {
      if (kind !== "number") return err(`theme "${id}": "adjustable.${path}" cannot take min and max (it is not a number)`);
      if (typeof rule.min !== "number" || typeof rule.max !== "number" || rule.min > rule.max) {
        return err(`theme "${id}": "adjustable.${path}" needs numbers min and max, with min not above max`);
      }
      out[path] = { min: rule.min, max: rule.max };
    } else return err(`theme "${id}": "adjustable.${path}" must be true, { "swatches": [...] } or { "min", "max" }`);
  }
  return ok(out);
}

// Kotlin prints a Double with a trailing ".0" when it is whole; the warnings must read the same.
const kt = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

function checked(key, v, warnings) {
  const a = A();
  const kind = a.tokens[key];
  if (kind === undefined) { warnings.push(`${key}: unknown token; ignored`); return undefined; }
  const fits =
    kind === "color" ? hexOf(v) !== null :
    kind === "number" ? typeof v === "number" :
    kind === "word" ? typeof v === "string" && a.words[key].includes(v) :
    hexOf(v) !== null || (isObj(v) && v.type === "gradient" && v.colors.length > 0);
  if (!fits) { warnings.push(`${key}: not a valid value for this token; Kino's is used`); return undefined; }
  if (typeof v === "number") {
    const r = a.ranges[key];
    if (r && (v < r[0] || v > r[1])) { warnings.push(`${key}: ${kt(v)} is outside ${kt(r[0])}..${kt(r[1])}; Kino's is used`); return undefined; }
  }
  return v;
}

const hardClamp = (key, x) => { const r = A().ranges[key]; return r ? Math.min(r[1], Math.max(r[0], x)) : x; };

/**
 * Resolves a parsed theme for one form factor, plus the person's adjustments ({ token: value }), as the app does:
 * { tokens, warnings }. `tokens` holds only what the theme ends up setting (everything else is Kino's value), the
 * pluginColors choice and `accentText`. Never throws.
 */
export function resolveAppTheme(theme, { tv = false, adjustments = {} } = {}) {
  const a = A();
  const D = a.defaults;
  const warnings = [];
  if (!theme) return { tokens: { pluginColors: a.pluginColorsDefault, accentText: D.accentText }, warnings };
  const merged = {};
  for (const layer of [theme.values ?? {}, (tv ? theme.tv : theme.phone) ?? {}]) {
    for (const [key, raw] of Object.entries(layer)) {
      const v = checked(key, raw, warnings);
      if (v !== undefined) merged[key] = v;
    }
  }
  for (const [key, raw] of Object.entries(adjustments)) {
    const rule = theme.adjustable?.[key];
    if (rule === undefined) { warnings.push(`${key}: the theme doesn't allow adjusting it; ignored`); continue; }
    const v = checked(key, raw, warnings);
    if (v === undefined) continue;
    let allowed;
    if (rule === true) allowed = v;
    else if (rule.swatches) {
      if (typeof v === "string" && rule.swatches.includes(v)) allowed = v;
      else { warnings.push(`${key}: not one of the theme's swatches; ignored`); continue; }
    } else if (typeof v === "number") allowed = Math.min(rule.max, Math.max(rule.min, v));
    else { warnings.push(`${key}: expects a number; ignored`); continue; }
    merged[key] = typeof allowed === "number" ? hardClamp(key, allowed) : allowed;
  }

  const eff = (key) => merged[key] ?? D[key];
  const bgStops = () => {
    const b = merged.background ?? merged["colors.background"] ?? D.background;
    return typeof b === "string" ? [b] : b.colors;
  };
  const worst = (c) => Math.min(...bgStops().map((s) => contrast(c, s)));
  const minText = contract.manifest.theme.minTextContrast;
  const minUi = contract.manifest.theme.minUiContrast;
  const reset = (...keys) => { for (const k of keys) delete merged[k]; };
  let accentKept = "colors.accent" in merged;

  // The accent first: when it is Kino's own only the background can give way, and everything below reads the final one.
  if (eff("colors.accent") !== D["colors.accent"] || eff("colors.onAccent") !== D["colors.onAccent"]) {
    const accent = eff("colors.accent");
    const problem =
      worst(accent) < minUi ? "colors.accent: doesn't stand out on the background (at least 3:1)" :
      contrast(eff("colors.onAccent"), accent) < minText ? "colors.onAccent: isn't readable on the accent (at least 4.5:1)" :
      null;
    if (problem) {
      warnings.push(`${problem}; Kino's colors are used for accent and onAccent`);
      reset("colors.accent", "colors.onAccent");
      accentKept = false;
    }
  }
  if (("background" in merged || "colors.background" in merged) && worst(eff("colors.accent")) < minUi) {
    warnings.push("background: Kino's accent doesn't stand out on it; Kino's is used");
    reset("background", "colors.background");
  }

  const textUnreadable = "colors.textPrimary/textSecondary: not readable (at least 4.5:1) on the background and surface; Kino's text colors are used";
  if (eff("colors.textPrimary") !== D["colors.textPrimary"] || eff("colors.textSecondary") !== D["colors.textSecondary"]) {
    const surface = eff("colors.surface");
    const bad = [eff("colors.textPrimary"), eff("colors.textSecondary")].some((c) => worst(c) < minText || contrast(c, surface) < minText);
    if (bad) {
      warnings.push(textUnreadable);
      reset("colors.textPrimary", "colors.textSecondary");
    }
  }
  if (contrast(eff("colors.textPrimary"), eff("colors.surfaceHigh")) < minText) {
    if (eff("colors.surfaceHigh") !== D["colors.surfaceHigh"]) {
      warnings.push("colors.surfaceHigh: Kino's text isn't readable on it; Kino's is used");
      reset("colors.surfaceHigh");
    }
    // Text too dim even for Kino's surfaceHigh: that side gives way too.
    if (contrast(eff("colors.textPrimary"), eff("colors.surfaceHigh")) < minText) {
      warnings.push(textUnreadable);
      reset("colors.textPrimary", "colors.textSecondary");
    }
  }
  if (eff("colors.surface") !== D["colors.surface"] &&
    [eff("colors.textPrimary"), eff("colors.textSecondary")].some((c) => contrast(c, eff("colors.surface")) < minText)) {
    warnings.push("colors.surface: Kino's text isn't readable on it; Kino's is used");
    reset("colors.surface");
  }

  if (eff("colors.focus") !== D["colors.focus"] || eff("colors.onFocus") !== D["colors.onFocus"]) {
    if (worst(eff("colors.focus")) < minUi || contrast(eff("colors.onFocus"), eff("colors.focus")) < minText) {
      warnings.push("colors.focus/onFocus: not legible (3:1 on the background, 4.5:1 for the text on it); Kino's are used");
      reset("colors.focus", "colors.onFocus");
    }
  }

  // A light background is fine when the theme brings its own text that reads on it and on its surfaces (Kino's text is near-white).
  if (bgStops().some((s) => luminance(s) > contract.manifest.theme.maxBackgroundLuminance) &&
    [eff("colors.textPrimary"), eff("colors.textSecondary")].some((c) => worst(c) < minText || contrast(c, eff("colors.surface")) < minText)) {
    warnings.push("background: is light, and Kino's text would not be readable on it; the theme must bring its own readable text colors (colors.textPrimary and colors.textSecondary); Kino's is used");
    reset("background", "colors.background");
    if (worst(eff("colors.accent")) < minUi) {
      reset("colors.accent", "colors.onAccent");
      accentKept = false;
    }
  }

  return { tokens: { ...merged, pluginColors: theme.pluginColors, accentText: accentKept ? merged["colors.accent"] : D.accentText }, warnings };
}

// ---- apiVersion 26: surfaces, style, layout, assets, background image, font (the app's AppThemeParser.kt, format only).

const NEW_TOKENS = new Set(["shape.heroRadius", "shape.railItemRadius"]);
const S = () => A().surfaces;
const unknownField = (o, allowed) => Object.keys(o).filter((k) => !allowed.includes(k)).sort()[0];

function extrasOf(block) {
  const empty = Object.keys(block.surfaces ?? {}).length === 0 && block.layout[0] === null && block.layout[1] === null && block.image === null;
  return empty ? null : { surfaces: block.surfaces, layout: block.layout, backgroundImage: block.image };
}

function parseStyle(raw, id) {
  if (!isObj(raw)) return err(`theme "${id}": "style" must be an object { "gloss" }`);
  const extra = unknownField(raw, ["gloss"]);
  if (extra !== undefined) return err(`theme "${id}": "style" has an unknown field: "${cut(extra)}"`);
  if (typeof raw.gloss !== "number") return err(`theme "${id}": "style.gloss" must be a number`);
  return ok(raw.gloss);
}

function parseLayout(raw, id, prefix) {
  const where = `theme "${id}": "${prefix}layout"`;
  if (!isObj(raw)) return err(`${where} must be an object { "hero", "rail" }`);
  const extra = unknownField(raw, ["hero", "rail"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  if (raw.hero !== undefined && !S().layoutHero.includes(raw.hero)) return err(`${where}.hero must be "fullBleed" or "framed"`);
  if (raw.rail !== undefined && !S().layoutRail.includes(raw.rail)) return err(`${where}.rail must be "strip" or "floating"`);
  return ok([raw.hero ?? null, raw.rail ?? null]);
}

function parseSurfaces(raw, id, prefix) {
  if (!isObj(raw)) return err(`theme "${id}": "${prefix}surfaces" must be an object`);
  const out = {};
  for (const key of Object.keys(raw).sort()) {
    if (!S().elements.includes(key)) return err(`theme "${id}": unknown token "${prefix}surfaces.${cut(key)}"`);
    const where = `theme "${id}": "${prefix}surfaces.${key}"`;
    const e = raw[key];
    if (!isObj(e)) return err(`${where} must be an object { "fill", "stroke", "glow" }`);
    const extra = unknownField(e, S().surfaceFields);
    if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
    const surface = { fill: null, stroke: null, glow: null };
    if (e.fill !== undefined) { const r = parseFill(e.fill, `${where}.fill`); if (!r.ok) return r; surface.fill = r.value; }
    if (e.stroke !== undefined) { const r = parseStroke(e.stroke, `${where}.stroke`); if (!r.ok) return r; surface.stroke = r.value; }
    if (e.glow !== undefined) { const r = parseGlow(e.glow, `${where}.glow`); if (!r.ok) return r; surface.glow = r.value; }
    out[key] = surface;
  }
  return ok(out);
}

function parseFill(f, where) {
  if (!isObj(f)) return err(`${where} must be an object { "type", ... }`);
  const extra = unknownField(f, ["type", "color", "colors", "angle"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  if (f.type === "solid") {
    const c = hexOf(f.color);
    if (c === null) return err(`${where}.color must look like #RRGGBB`);
    return ok({ type: "solid", color: c });
  }
  if (f.type === "gradient") {
    if (!Array.isArray(f.colors)) return err(`${where}.colors must be a list of #RRGGBB colors`);
    const colors = [];
    for (const x of f.colors) { const h = hexOf(x); if (h === null) return err(`${where}.colors must be a list of #RRGGBB colors`); colors.push(h); }
    // Format only: the colour count and the angle are kept as written; the resolver judges their range.
    if (f.angle !== undefined && !Number.isInteger(f.angle)) return err(`${where}.angle must be a whole number of degrees`);
    return ok({ type: "gradient", colors, angle: f.angle ?? 180 });
  }
  return err(`${where}.type must be "solid" or "gradient"`);
}

function parseStroke(s, where) {
  if (!isObj(s)) return err(`${where} must be an object { "width", "color" | "gradient" }`);
  const extra = unknownField(s, ["width", "color", "gradient"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  if (typeof s.width !== "number") return err(`${where}.width must be a number`);
  if ((s.color !== undefined) === (s.gradient !== undefined)) return err(`${where} needs exactly one of "color" and "gradient"`);
  if (s.color !== undefined) {
    const c = hexOf(s.color);
    if (c === null) return err(`${where}.color must look like #RRGGBB`);
    return ok({ width: s.width, fill: { type: "solid", color: c } });
  }
  if (!isObj(s.gradient)) return err(`${where}.gradient must be an object`);
  if (s.gradient.type !== "gradient") return err(`${where}.gradient.type must be "gradient"`);
  const g = parseFill(s.gradient, `${where}.gradient`);
  if (!g.ok) return g;
  return ok({ width: s.width, fill: g.value });
}

function parseGlow(g, where) {
  if (!isObj(g)) return err(`${where} must be an object { "color", "radius", "alpha" }`);
  const extra = unknownField(g, ["color", "radius", "alpha"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  const c = hexOf(g.color);
  if (c === null) return err(`${where}.color must look like #RRGGBB`);
  if (typeof g.radius !== "number") return err(`${where}.radius must be a number`);
  if (typeof g.alpha !== "number") return err(`${where}.alpha must be a number`);
  return ok({ color: c, radius: g.radius, alpha: g.alpha });
}

function parseAssets(raw, id) {
  const s = S();
  if (!Array.isArray(raw)) return err(`theme "${id}": "assets" must be a list`);
  if (raw.length > s.maxAssets) return err(`theme "${id}": "assets" may list at most ${s.maxAssets} files`);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const where = `theme "${id}": "assets[${i}]"`;
    const a = raw[i];
    if (!isObj(a)) return err(`${where} must be an object { "id", "path", "sha256", "bytes" }`);
    const extra = unknownField(a, s.assetFields);
    if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
    if (typeof a.id !== "string" || !re(s.assetIdPattern).test(a.id)) return err(`${where}.id must be 2 to 40 characters: a-z, 0-9 and "-"`);
    if (out.some((x) => x.id === a.id)) return err(`theme "${id}": the asset id "${a.id}" is used twice`);
    const path = typeof a.path === "string" ? a.path.replace(/^\.\//, "") : null;
    if (path === null || path === "" || path.startsWith("/") || path.split("/").some((seg) => seg === ".." || seg === "")) return err(`${where}.path must be a relative path inside the plugin`);
    if (typeof a.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(a.sha256)) return err(`${where}.sha256 must be 64 hexadecimal characters`);
    if (!Number.isInteger(a.bytes) || a.bytes <= 0) return err(`${where}.bytes must be a whole number above 0`);
    out.push({ id: a.id, path, sha256: a.sha256.toLowerCase(), bytes: a.bytes });
  }
  return ok(out);
}

function assetRef(v, where, ctx) {
  if (typeof v !== "string") return err(`${where} must be the id of one of the theme's "assets"`);
  if (!ctx.assetIds.has(v)) return err(`${where} names the asset "${cut(v)}", which the theme's "assets" does not declare`);
  return ok(v);
}

function parseImage(raw, id, prefix, ctx) {
  const where = `theme "${id}": "${prefix}background.image"`;
  if (!isObj(raw)) return err(`${where} must be an object { "asset", "fit", "dim" }`);
  const extra = unknownField(raw, ["asset", "fit", "dim"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  const asset = assetRef(raw.asset, `${where}.asset`, ctx);
  if (!asset.ok) return asset;
  if (raw.fit !== undefined && !S().imageFit.includes(raw.fit)) return err(`${where}.fit must be "cover" or "top"`);
  if (raw.dim !== undefined && typeof raw.dim !== "number") return err(`${where}.dim must be a number`);
  return ok({ asset: asset.value, fit: raw.fit ?? "cover", dim: raw.dim ?? 0 });
}

function parseFont(raw, id, path, ctx) {
  const where = `theme "${id}": "${path}"`;
  if (!isObj(raw)) return err(`${where} must be an object { "regular", "bold" }`);
  const extra = unknownField(raw, ["regular", "bold"]);
  if (extra !== undefined) return err(`${where} has an unknown field: "${cut(extra)}"`);
  const regular = assetRef(raw.regular, `${where}.regular`, ctx);
  if (!regular.ok) return regular;
  let bold = null;
  if (raw.bold !== undefined) { const b = assetRef(raw.bold, `${where}.bold`, ctx); if (!b.ok) return b; bold = b.value; }
  return ok({ regular: regular.value, bold });
}
