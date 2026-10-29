// The player panel (apiVersion 9) as the Node kit sees it: a JS port, rule by rule, of what the app keeps of a plugin's
// `panel`, `panelAction` and `playerEvent` answers (PluginPanelOutput, PluginLayout, PanelPlayerRules, PanelPlayerGate,
// PanelIconFile) and of the manifest's `settingsLayout`. Kino's own Kotlin is authoritative: every limit and every log
// line below is the app's, so `· dropped: <reason>` here is the line the app logs. Nothing throws on a bad answer:
// an invalid element is dropped with a reason, a panel that is not an object is null.
import { createHmac } from "node:crypto";
import { contract, imageVerdict, javaDouble, qrUrl, screenGoOf, skipOf, titleByIdsOf, urlGoOf, copyGoOf } from "./contract.mjs";
import { resolvePalette } from "./palette.mjs";
import { shownSentence } from "./kino-shim.mjs";

/**
 * ScreenLimits.colorHint (screen asks, owner's #8): what a "is not a color role" line adds so the author sees what to write: a
 * role in another case, or a common colour word (contract colorHints; `success` is a banner's and a toast's role) names its
 * closest role. Empty when there is none.
 */
export function colorHint(raw) {
  if (typeof raw !== "string") return "";
  // Kotlin's trim, as the app's line reads it.
  const w = raw.replace(/^[\s\u001C-\u001F]+|[\s\u001C-\u001F]+$/gu, "");
  const lower = w.toLowerCase();
  const role = contract.manifest.screen.colorRoles.find((r) => r.toLowerCase() === lower) ?? contract.manifest.screen.colorHints[lower];
  if (!role) return "";
  const banner = contract.manifest.screen.roles.includes(lower) && !contract.manifest.screen.colorRoles.includes(lower) ? `"${lower}" is a banner and toast role; ` : "";
  return ` (${banner}the closest color role is "${role}")`;
}

// ---------- limits (PluginPanelOutput, PluginLayout, PanelPlayerRules, PluginSettings, PanelIconFile) ----------

export const LAYOUT = contract.output.layout;
export const PANEL = contract.output.panel;
export const PLAYER = contract.output.player;
/** PanelIcons.NAMES: the predefined panel-button icons; any other name draws the default. */
export const PANEL_ICONS = contract.manifest.panel.icons;
export const PANEL_ICON_DEFAULT = contract.manifest.panel.defaultIcon;
/** PanelIcons.EXTRA_NAMES (Task 8v): the larger icon set, `refresh` first, read from its apiVersion (14). */
export const PANEL_EXTRA_ICONS = contract.manifest.panel.extraIcons;
/** PanelIcons.isKnown: whether a plugin on [apiVersion] may use [name]; a name of the larger set below its apiVersion is unknown. */
export function panelIconKnown(name, apiVersion) {
  if (!PANEL_ICONS.includes(name)) return false;
  return !PANEL_EXTRA_ICONS.names.includes(name) || apiVersion >= PANEL_EXTRA_ICONS.apiVersion;
}
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const PLAYER_KEYS = ["seekToMs", "seekStepMs", "speed", "resize", "skip", "markers", "autoNext", "pause"];
const ASPECTS = ["16:9", "2:3", "1:1", "banner"];
const MAX_LONG = 9223372036854775807n;
const MIN_LONG = -9223372036854775808n;

// ---------- org.json-shaped helpers (the answer crosses as JSON; Kotlin reads it with org.json) ----------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** JSONObject.optString: "" when absent, "null" for a JSON null (Android's JSON.toString), else the value as text. */
const optString = (v) => (v === undefined ? "" : typeof v === "string" ? v : v === null ? "null" : String(v));
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Double.toLong(): truncated, saturated at the Long range. */
const longOf = (d) => { const t = BigInt(Math.trunc(d)); return t > MAX_LONG ? MAX_LONG : t < MIN_LONG ? MIN_LONG : t; };
const coerce = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (n) => javaDouble(n);

/** PluginLayout.localized: [key] or, in English, `<key>En` when present. */
function localized(o, key, lang) {
  const es = typeof o[key] === "string" ? o[key].trim() : "";
  const en = typeof o[key + "En"] === "string" ? o[key + "En"].trim() : "";
  return lang === "en" && en !== "" ? en : es;
}

// ---------- layout (PluginLayout): rows, columns and cards around leaves ----------

const gapOf = (o) => (["none", "medium", "large"].includes(optString(o.gap)) ? optString(o.gap) : "small");
const alignOf = (o) => (["center", "end", "stretch"].includes(optString(o.align)) ? optString(o.align) : "start");

const CAPPED = Symbol("problemLog");

/**
 * ProblemLog.capped: [read] gets [log] limited to maxLogLines problems, the rest only counted, then one
 * "<prefix>: N more problems not logged" line. A [log] that is already capped (a reading nested in another one: a
 * layout inside a panel answer) is used as it is, and the outer reading sums up.
 */
export function cappedLog(log, prefix, read) {
  if (log[CAPPED]) return read(log);
  let problems = 0;
  const capped = (line) => { if (++problems <= LAYOUT.maxLogLines) log(line); };
  capped[CAPPED] = true;
  try {
    return read(capped);
  } finally {
    if (problems > LAYOUT.maxLogLines) log(`${prefix}: ${problems - LAYOUT.maxLogLines} more problems not logged`);
  }
}

/**
 * PluginLayout.tree: [arr] to nodes, a leaf being whatever `leaf(object, log)` returns (null drops it). At most
 * maxLogLines problems are logged per call (or per answer, cappedLog), the rest only counted. `{ nodes, ... }` nodes:
 * containers carry `type`, `children`; leaves are `{ leaf, enabled, hidden }`.
 */
export function layoutTree(arr, lang, leaf, log) {
  const budget = [LAYOUT.maxNodes];
  return cappedLog(log, "layout", (capped) => layoutList(Array.isArray(arr) ? arr : [], 1, lang, leaf, capped, budget, false));
}

function layoutList(arr, depth, lang, leaf, log, budget, inRow) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (inRow && out.length >= LAYOUT.maxRowChildren) { log(`layout: a row keeps ${LAYOUT.maxRowChildren} children, the rest dropped`); break; }
    if (budget[0] <= 0) { log(`layout: more than ${LAYOUT.maxNodes} elements, the rest dropped`); break; }
    if (!isObj(arr[i])) continue;
    const n = layoutNode(arr[i], depth, lang, leaf, log, budget);
    if (n) out.push(n);
  }
  return out;
}

function layoutNode(o, depth, lang, leaf, log, budget) {
  const enabled = o.enabled !== false;
  const hidden = o.hidden === true;
  const type = optString(o.type);
  const container = type === "row" || type === "col" || type === "card";
  if (container && depth > LAYOUT.maxDepth) { log(`layout: deeper than ${LAYOUT.maxDepth}, dropped`); return null; }
  budget[0]--;
  const kids = (row) => layoutList(Array.isArray(o.children) ? o.children : [], depth + 1, lang, leaf, log, budget, row);
  if (type === "row") return { type, gap: gapOf(o), align: alignOf(o), stackOnNarrow: o.stackOnNarrow !== false, children: kids(true), enabled, hidden };
  if (type === "col") {
    const w = optIntWeight(o.weight);
    if ("weight" in o && !(w >= 1 && w <= 12)) log(`layout: col weight ${w} outside 1..12, using 1`);
    return { type, weight: w >= 1 && w <= 12 ? w : 1, gap: gapOf(o), align: alignOf(o), children: kids(false), enabled, hidden };
  }
  if (type === "card") {
    const title = localized(o, "title", lang).slice(0, LAYOUT.maxCardTitleChars);
    const style = ["outlined", "filled"].includes(optString(o.style)) ? optString(o.style) : "plain";
    return { type, title, style, children: kids(false), enabled, hidden };
  }
  const value = leaf(o, log);
  if (value === null || value === undefined) { budget[0]++; return null; }
  return { leaf: value, enabled, hidden };
}

/** `o.optInt("weight", 1)`: a number truncated like Number.intValue, a numeric string parsed, else 1. */
function optIntWeight(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(coerce(v, -2147483648, 2147483647));
  if (typeof v === "string") {
    const t = v.trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Math.trunc(coerce(Number(t), -2147483648, 2147483647)) : 1;
  }
  return 1;
}

/** A node as printed: a leaf is its element (with `enabled: false` / `hidden: true` only when set), a container its fields. */
export function printNode(n) {
  const flags = { ...(n.enabled === false ? { enabled: false } : {}), ...(n.hidden ? { hidden: true } : {}) };
  if (n.leaf !== undefined) return { ...n.leaf, ...flags };
  const { children, enabled, hidden, ...own } = n;
  void enabled; void hidden;
  return { ...own, ...flags, children: children.map(printNode) };
}

/** Every leaf element of [nodes], depth first. */
export function leavesOf(nodes) {
  return nodes.flatMap((n) => (n.leaf !== undefined ? [n.leaf] : leavesOf(n.children)));
}

// ---------- settings layout (PluginLayout.settings) ----------

/**
 * Where the manifest's `settingsLayout` puts the settings: `{ tree, log, problems }` (`log` capped as the app's,
 * `problems` every unknown or repeated setting). Settings the layout leaves out are
 * appended in manifest order; "hidden" and "enabled" are ignored. [servers]: the person's typed servers (images).
 */
export function settingsLayout(raw, settings, lang = "es", servers = []) {
  const log = [];
  // Every unknown or repeated setting, never capped: the kit fails validation on any of them.
  const problems = [];
  const all = new Set((settings || []).map((s) => s.key));
  const placed = new Set();
  const arr = Array.isArray(raw) ? raw : [];
  const tree = layoutTree(arr, lang, (o, l) => {
    if ("setting" in o) {
      const key = optString(o.setting);
      if (!all.has(key)) { const m = `settingsLayout: unknown setting "${key.slice(0, 40)}" ignored`; problems.push(m); l(m); return null; }
      if (placed.has(key)) { const m = `settingsLayout: "${key}" placed twice, second ignored`; problems.push(m); l(m); return null; }
      placed.add(key);
      return { setting: key };
    }
    const type = optString(o.type);
    if (type === "text") {
      const text = localized(o, "text", lang).slice(0, LAYOUT.maxTextChars);
      if (text === "") { l("settingsLayout: empty text, dropped"); return null; }
      return { type: "text", text };
    }
    if (type === "image") {
      const url = httpsImage(o, servers);
      if (!url) { l("settingsLayout: image is not https, dropped"); return null; }
      return { type: "image", url, aspect: aspectOf(o) };
    }
    l(`settingsLayout: element type "${type.slice(0, 20)}" ignored`);
    return null;
  }, (line) => log.push(line)).map(visible);
  for (const key of all) if (!placed.has(key)) tree.push({ leaf: { setting: key }, enabled: true, hidden: false });
  return { tree, log, problems };
}

function visible(n) {
  return n.leaf !== undefined ? { ...n, enabled: true, hidden: false } : { ...n, children: n.children.map(visible), enabled: true, hidden: false };
}

/** PluginLayout.httpsImage: an image URL the app shows (imageUrl's rule) that is https; else "". */
export function httpsImage(o, servers = []) {
  const url = imageVerdict(typeof o.url === "string" ? o.url : "", servers).url;
  return url.startsWith("https://") ? url : "";
}

function aspectOf(o) {
  return ASPECTS.includes(optString(o.aspect)) ? optString(o.aspect) : "16:9";
}

// ---------- the panel (PluginPanelOutput.panel) ----------

/**
 * The app's `PluginPanelOutput.panel`: what is kept of a `panel(context)` answer, or null when it is not an object.
 * [log] gets each problem (the app's own English lines); [lang] "es" | "en"; [servers] the person's typed servers.
 */
export function panelOutput(value, { lang = "es", servers = [], log = () => {} } = {}) {
  return cappedLog(log, "panel", (capped) => {
    if (!isObj(value)) { capped("panel: the answer is not a JSON object"); return null; }
    return panelOf(value, lang, servers, capped);
  });
}

function panelOf(o, lang, servers, log) {
  const presentation = optString(o.presentation) === "panel" ? "panel" : "modal";
  const title = localized(o, "title", lang).slice(0, PANEL.maxTitleChars);
  const tabs = panelTabsOf(o.tabs, lang, log);
  const wanted = typeof o.tab === "string" ? o.tab : null;
  const tab = wanted !== null && tabs.some((t) => t.id === wanted) ? wanted : tabs.length ? tabs[0].id : null;
  if (wanted !== null && tab !== wanted) log(`panel: tab "${wanted.slice(0, 40)}" names no tab`);
  const all = Array.isArray(o.elements) ? o.elements : [];
  let top = all;
  if (all.length > PANEL.maxTopElements) {
    log(`panel: more than ${PANEL.maxTopElements} top-level elements, the rest dropped`);
    top = all.slice(0, PANEL.maxTopElements);
  }
  // The keys placed so far are shared by the whole panel: a repeated one drops the later element.
  const keys = new Set();
  const elements = layoutTree(top, lang, (e, l) => element(e, lang, servers, keys, l), log);
  const accent = panelAccentOf(o.accent, log);
  const refreshMs = panelRefreshOf(o.refreshMs, log);
  // Task 8j: the result's own player (a refreshMs tick's): honoured only with the playerControl capability.
  const player = panelPlayerOf(o.player, log);
  return { presentation, title, accent, refreshMs, tabs, tab, elements, ...(player ? { player } : {}) };
}

export function panelAccentOf(raw, log) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") { log("panel: accent is not a string, Kino's colors used"); return null; }
  if (resolvePalette({ accent: raw }).kept.includes("accent")) return raw;
  log(`panel: accent "${raw.slice(0, 20)}" fails the theme accent rules, Kino's colors used`);
  return null;
}

export function panelRefreshOf(raw, log) {
  if (raw === undefined || raw === null) return null;
  const n = finite(raw);
  if (n === null) { log("panel: refreshMs is not a number, dropped"); return null; }
  const ms = coerce(longOf(n), BigInt(PANEL.minRefreshMs), BigInt(PANEL.maxRefreshMs));
  if (Number(ms) !== n) log(`panel: refreshMs ${num(n)} clamped to ${ms}`);
  return Number(ms);
}

export function panelTabsOf(arr, lang, log) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    if (out.length >= PANEL.maxTabs) { log(`panel: tabs beyond ${PANEL.maxTabs} dropped`); break; }
    const t = arr[i];
    if (!isObj(t)) continue;
    const id = optString(t.id);
    if (!ID.test(id)) { log(`panel: tab ${i} has an invalid id`); continue; }
    const label = localized(t, "label", lang).slice(0, PANEL.maxTabLabelChars);
    if (label === "") { log(`panel: tab ${id} has no label`); continue; }
    if (seen.has(id)) { log(`panel: duplicate tab ${id} dropped`); continue; }
    seen.add(id);
    // Task 15: a tab's badge (the shared `badge`), beside its label.
    const badge = t.badge !== undefined && t.badge !== null ? badgeOf(t.badge, lang, `panel: tab ${id}`, log) : null;
    out.push({ id, label, badge });
  }
  return out;
}

/** A plugin value as the app's log lines show it (PluginScreenOutput.fmt): a string quoted and cut to 40, anything else cut to 40. */
function fmtValue(v) {
  if (typeof v === "string") return `"${v.slice(0, 40)}"`;
  if (v === undefined || v === null) return "null";
  const t = typeof v === "number" ? (Number.isInteger(v) ? String(v) : javaDouble(v)) : typeof v === "object" ? JSON.stringify(v).replace(/\//g, "\\/") : String(v);
  return t.slice(0, 40);
}

const SCREEN_SHARED = contract.manifest.screen.sharedProps;

/**
 * PluginScreenOutput.badgeOf (Task 15): the shared `badge`, the Badge node's shape: `"dot"` or `{ text, textEn?, color? }`. A
 * text over sharedProps.badge.maxChars is cut, a colour that is no role takes the default (both logged under [where]);
 * anything else is dropped, logged (null). `{ text: null }` is a dot.
 */
export function badgeOf(raw, lang, where, log) {
  const B = SCREEN_SHARED.badge;
  if (raw === B.dot) return { text: null, color: null };
  const text = isObj(raw) ? localized(raw, "text", lang).trim() : "";
  if (!isObj(raw) || text === "") { log(`${where} badge ${fmtValue(raw)} is not "dot" or { text, textEn?, color? }, dropped`); return null; }
  let cut = text;
  if (text.length > B.maxChars) { cut = text.slice(0, B.maxChars); log(`${where} badge text is over ${B.maxChars} characters, cut`); }
  let color = null;
  const c = raw.color;
  if (c !== undefined && c !== null) {
    if (typeof c === "string" && contract.manifest.screen.colorRoles.includes(c)) color = c;
    else log(`${where} badge color ${fmtValue(c)} is not a color role${colorHint(c)}, the default used`);
  }
  return { text: cut, color };
}

/** One leaf of a panel, or null (logged). [keys] are the keys already placed. */
function element(o, lang, servers, keys, log) {
  const type = optString(o.type);
  const text = (name, max) => localized(o, name, lang).slice(0, max);
  const drop = (why) => { log(`panel: ${type} ${why}, dropped`); return null; };
  const keyed = () => {
    const key = typeof o.key === "string" ? o.key : "";
    if (!ID.test(key)) { drop("needs a valid key"); return null; }
    const label = localized(o, "label", lang);
    if (label === "" || label.length > PANEL.maxLabelChars) { drop(`"${key}" needs a label of 1 to ${PANEL.maxLabelChars} characters`); return null; }
    if (keys.has(key)) { drop(`duplicate key "${key}"`); return null; }
    keys.add(key);
    return { key, label };
  };
  const scope = () => {
    const s = o.scope;
    if (s === undefined || s === null || s === "plugin") return "plugin";
    if (s === "video") return "video";
    log(`panel: ${type} scope "${String(s).slice(0, 20)}" is not video or plugin, dropped`);
    return null;
  };
  switch (type) {
    case "section": {
      const title = text("title", PANEL.maxTitleChars);
      return title !== "" ? { type, title, text: text("text", LAYOUT.maxTextChars) } : drop("needs a title");
    }
    case "text": { const t = text("text", LAYOUT.maxTextChars); return t !== "" ? { type, text: t } : drop("is empty"); }
    case "status": { const t = text("text", PANEL.maxStatusChars); return t !== "" ? { type, text: t } : drop("is empty"); }
    case "image": {
      const url = httpsImage(o, servers);
      return url ? { type, url, aspect: aspectOf(o), alt: text("alt", PANEL.maxAltChars) } : drop("is not https");
    }
    case "button": {
      const confirm = localized(o, "confirm", lang);
      if (confirm.length > PANEL.maxConfirmChars) return drop(`confirm longer than ${PANEL.maxConfirmChars}`);
      const k = keyed();
      if (!k) return null;
      const go = panelGoOf(o.go, `button "${k.key}"`, log);
      return { type, key: k.key, label: k.label, ...(confirm !== "" ? { confirm } : {}), ...(go !== null ? { go, ...(o.pause === true ? { pause: true } : {}) } : {}) };
    }
    case "toggle": case "select": case "text-input": {
      const sc = scope();
      if (sc === null) return null;
      let options = [];
      if (type === "select") {
        options = optionsOf(o.options, lang);
        if (options === null) return drop(`needs 1 to ${PANEL.maxOptions} valid, distinct options`);
      }
      const k = keyed();
      if (!k) return null;
      const hint = text("hint", PANEL.maxHintChars);
      const base = { type, key: k.key, label: k.label, scope: sc, ...(hint !== "" ? { hint } : {}) };
      if (type === "toggle") return { ...base, autoSave: o.autoSave === true };
      if (type === "select") return { ...base, options, autoSave: o.autoSave === true };
      const placeholder = text("placeholder", PANEL.maxPlaceholderChars);
      return { ...base, ...(placeholder !== "" ? { placeholder } : {}) };
    }
    case "qr": {
      const url = qrUrl(o.url);
      return url ? { type, url, label: text("label", PANEL.maxLabelChars) } : drop(`url is not a public https URL of at most ${PANEL.maxQrUrlChars} characters`);
    }
    case "episodes": {
      const ref = typeof o.ref === "string" && o.ref !== "" && o.ref.length <= contract.output.maxRefChars ? o.ref : null;
      return ref !== null ? { type, ref } : drop("needs a valid ref");
    }
    case "ai": case "chat": log(`panel: element type "${type}" needs a newer Kino`); return null;
    default: log("panel: unknown element type"); return null;
  }
}

/** As a settings select: 1..maxOptions options, value and label 1..40, values distinct; null when any is not. */
function optionsOf(arr, lang) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > PANEL.maxOptions) return null;
  const out = [];
  for (const o of arr) {
    if (!isObj(o) || typeof o.value !== "string") return null;
    const label = localized(o, "label", lang);
    if (o.value === "" || o.value.length > PANEL.maxOptionChars) return null;
    if (label === "" || label.length > PANEL.maxOptionChars) return null;
    if (out.some((p) => p.value === o.value)) return null;
    out.push({ value: o.value, label });
  }
  return out;
}

// ---------- the answer of panelAction / playerEvent (PluginPanelOutput.answer) ----------

/**
 * The app's `PluginPanelOutput.answer`: `{ panel, patch, values, save, focus, message, player }`, each null/empty when
 * not asked for or dropped. `null` is the all-empty answer.
 */
export function answerOutput(value, { lang = "es", servers = [], log = () => {} } = {}) {
  return cappedLog(log, "panel", (capped) => answerOf(value, lang, servers, capped));
}

function answerOf(value, lang, servers, log) {
  const empty = { panel: null, patch: {}, values: {}, save: [], focus: null, message: null, player: null, go: null, pause: false };
  if (value === null || value === undefined) return empty;
  if (!isObj(value)) { log("panel: the action answer is not a JSON object"); return empty; }
  let panel = null;
  if (isObj(value.panel)) panel = panelOf(value.panel, lang, servers, log);
  else if (value.panel !== undefined && value.panel !== null) log("panel: answer.panel is not an object, dropped");
  // Evaluated in the app's argument order (patch, values, save, focus, message, player): that is the order of the log lines.
  const patch = patchOf(value.patch, lang, servers, log);
  const values = valuesOf(value.values, log);
  const save = saveOf(value.save, log);
  const focus = focusOf(value.focus, log);
  const message = panelMessageOf(value.message, log);
  const player = panelPlayerOf(value.player, log);
  const go = panelGoOf(value.go, "answer", log, true);
  const byIds = go !== null && "titleByIds" in go ? go.titleByIds : null;
  const url = go !== null && "url" in go ? go.url : null;
  const copy = go !== null && "copy" in go ? go.copy : null;
  return { panel, patch, values, save, focus, message, player, go: byIds === null && url === null && copy === null ? go : null, pause: value.pause === true, titleByIds: byIds, url, copy };
}

/**
 * PluginPanelOutput.goOf (Task 7g): a panel's `go` is only `{ screen: { route?, args? } }`, this plugin's own screen, read as a
 * screen reads it; in an answer ([pressGoesToo]) also `{ titleByIds: {...} }` (Task 8m, returned as `{ titleByIds }`) and
 * `{ url: { href, title? } }` (Task 8s, returned as `{ url }`) and `{ copy: { text, label?, sensitive? } }` (Task 8x, as `{ copy }`), the gos only a press honours. Anything else is dropped,
 * logged under [where].
 */
function panelGoOf(raw, where, log, pressGoesToo = false) {
  if (raw === undefined || raw === null) return null;
  if (pressGoesToo && isObj(raw) && Object.keys(raw).length === 1 && "titleByIds" in raw) {
    const g = titleByIdsOf(raw.titleByIds, (why) => log(`panel: ${where} go.titleByIds ${why}, dropped`));
    return g === null ? null : { titleByIds: g };
  }
  if (pressGoesToo && isObj(raw) && Object.keys(raw).length === 1 && "url" in raw) {
    const g = urlGoOf(raw.url, (why) => log(`panel: ${where} go.url ${why}, dropped`));
    return g === null ? null : { url: g };
  }
  if (pressGoesToo && isObj(raw) && Object.keys(raw).length === 1 && "copy" in raw) {
    const g = copyGoOf(raw.copy, (why) => log(`panel: ${where} go.copy ${why}, dropped`));
    return g === null ? null : { copy: g };
  }
  if (!isObj(raw) || Object.keys(raw).length !== 1 || !("screen" in raw)) {
    log(`panel: ${where} go must be ${pressGoesToo ? "{screen: {route, args}} or {titleByIds: {...}} or {url: {href, title}} or {copy: {text, label}}" : "{screen: {route, args}}"}, dropped`);
    return null;
  }
  return screenGoOf(raw.screen, (why) => log(`panel: ${where} go.screen ${why}, dropped`));
}

function focusOf(raw, log) {
  if (typeof raw !== "string") return null;
  if (ID.test(raw)) return raw;
  log("panel: focus is not a valid key, dropped");
  return null;
}

/** Each key maps to ONE node, validated like a panel element; keys are unique across the whole patch. */
function patchOf(raw, lang, servers, log) {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) { log("panel: patch is not an object, dropped"); return {}; }
  const out = {};
  const keys = new Set();
  for (const k of Object.keys(raw)) {
    if (Object.keys(out).length >= PANEL.maxTopElements) { log(`panel: patch keeps ${PANEL.maxTopElements} keys, the rest dropped`); break; }
    if (!ID.test(k)) { log("panel: patch key is not a valid key, dropped"); continue; }
    if (!isObj(raw[k])) { log(`panel: patch "${k}" is not an element, dropped`); continue; }
    const nodes = layoutTree([raw[k]], lang, (e, l) => element(e, lang, servers, keys, l), log);
    if (nodes.length === 1) out[k] = nodes[0];
  }
  return out;
}

/** Only String (at most maxValueChars), Boolean, finite Number and null, under valid keys. */
function valuesOf(raw, log) {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) { log("panel: values is not an object, dropped"); return {}; }
  const out = {};
  for (const k of Object.keys(raw)) {
    if (Object.keys(out).length >= LAYOUT.maxNodes) { log(`panel: values keeps ${LAYOUT.maxNodes} keys, the rest dropped`); break; }
    if (!ID.test(k)) { log("panel: values key is not a valid key, dropped"); continue; }
    const v = raw[k];
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") { if (Number.isFinite(v)) out[k] = v; else log(`panel: values "${k}" is not a finite number, dropped`); }
    else if (typeof v === "string") { if (v.length <= PANEL.maxValueChars) out[k] = v; else log(`panel: values "${k}" longer than ${PANEL.maxValueChars}, dropped`); }
    else log(`panel: values "${k}" is not a string, boolean, number or null, dropped`);
  }
  return out;
}

function saveOf(raw, log) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { log("panel: save is not an array, dropped"); return []; }
  const out = new Set();
  for (let i = 0; i < raw.length; i++) {
    if (out.size >= PANEL.maxSaveKeys) { log(`panel: save keeps ${PANEL.maxSaveKeys} keys, the rest dropped`); break; }
    const k = raw[i];
    if (typeof k !== "string" || !ID.test(k)) { log(`panel: save #${i} is not a valid key, dropped`); continue; }
    out.add(k);
  }
  return [...out];
}

/** Cut to maxMessageChars, then shown only when the shape rule a plugin's `userMessage` passes accepts it. */
export function panelMessageOf(raw, log) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") { log("panel: message is not a string, dropped"); return null; }
  const s = raw.trim().slice(0, PANEL.maxMessageChars);
  if (s === "") return null;
  const shown = shownSentence({ code: "unavailable", userMessage: s });
  if (shown === null) { log("panel: message fails the userMessage safety rules, dropped"); return null; }
  return shown;
}

// ---------- the `player` part (PluginPanelOutput.playerOf, PanelPlayerRules) ----------

export function panelPlayerOf(raw, log) {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) { log("panel: player is not an object, dropped"); return null; }
  for (const k of Object.keys(raw)) if (!PLAYER_KEYS.includes(k)) log(`panel: player.${k.slice(0, 40)} is not available in this Kino`);
  const has = (k) => k in raw && raw[k] !== null;
  const action = {};
  // Duration and liveness are the player's: here only the static bounds apply; the gate clamps again.
  if (has("seekToMs")) action.seekToMs = seekToMs(raw.seekToMs, null, false, log);
  if (has("seekStepMs")) action.seekStepMs = seekStepMs(raw.seekStepMs, log);
  if (has("speed")) action.speed = speed(raw.speed, log);
  if (has("resize")) action.resize = resizeOf(raw.resize, log);
  if (has("skip")) {
    const s = skipOf(raw.skip, 0);
    if (s === null) log("panel: player.skip has nothing usable, dropped");
    action.skip = s;
  }
  if (has("markers")) action.markers = markers(raw.markers, null, log);
  if (has("autoNext")) action.autoNext = autoNext(raw.autoNext, log);
  // Task 8j: true pauses, false resumes; anything else is dropped (PanelPlayerRules.pause).
  if (has("pause")) {
    if (typeof raw.pause === "boolean") action.pause = raw.pause;
    else log("panel: player.pause is not true or false, dropped");
  }
  const kept = Object.fromEntries(Object.entries(action).filter(([, v]) => v !== null && v !== undefined));
  return Object.keys(kept).length ? kept : null;
}

function resizeOf(raw, log) {
  if (PLAYER.resizes.includes(raw)) return raw;
  log(`panel: player.resize "${String(raw).slice(0, 20)}" is not a resize mode, dropped`);
  return null;
}

/** Clamped to minSeekStepMs..maxSeekStepMs, in whole seconds (rounded down). */
export function seekStepMs(raw, log) {
  const n = finite(raw);
  if (n === null) { log("panel: player.seekStepMs is not a number, dropped"); return null; }
  const ms = coerce(longOf(n), BigInt(PLAYER.minSeekStepMs), BigInt(PLAYER.maxSeekStepMs)) / 1000n * 1000n;
  if (Number(ms) !== n) log(`panel: player.seekStepMs ${num(n)} clamped to ${ms} (whole seconds in ${PLAYER.minSeekStepMs}..${PLAYER.maxSeekStepMs})`);
  return Number(ms);
}

/** Exactly one of the speeds. */
export function speed(raw, log) {
  const n = finite(raw);
  if (n === null) { log("panel: player.speed is not a number, dropped"); return null; }
  const hit = PLAYER.speeds.find((s) => s === n);
  if (hit !== undefined) return hit;
  log(`panel: player.speed ${num(n)} is not one of [${PLAYER.speeds.map(num).join(", ")}], dropped`);
  return null;
}

/** Null for live; otherwise clamped to 0..durationMs (0.. when the duration is unknown). */
export function seekToMs(raw, durationMs, live, log) {
  if (live) { log("panel: player.seekToMs ignored on a live stream"); return null; }
  const n = finite(raw);
  if (n === null) { log("panel: player.seekToMs is not a number, dropped"); return null; }
  const max = durationMs > 0 ? BigInt(Math.trunc(durationMs)) : MAX_LONG;
  const ms = coerce(longOf(n), 0n, max);
  if (Number(ms) !== n) log(`panel: player.seekToMs ${num(n)} clamped to ${ms}`);
  return Number(ms);
}

/**
 * At most maxMarkers `{ atMs, label }`, sorted by time: one outside 0..durationMs (0.. when unknown) or without a label
 * is dropped, a label is cut to maxMarkerLabelChars. Null when [raw] is not an array.
 */
export function markers(raw, durationMs, log) {
  if (!Array.isArray(raw)) { log("panel: player.markers is not an array, dropped"); return null; }
  const max = durationMs > 0 ? durationMs : Number(MAX_LONG);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    if (!isObj(o)) { log(`panel: player.markers #${i} is not an object, dropped`); continue; }
    const at = finite(o.atMs);
    if (at === null || at < 0 || at > max) { log(`panel: player.markers #${i} out of range, dropped`); continue; }
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (label === "") { log(`panel: player.markers #${i} has no label, dropped`); continue; }
    if (label.length > PLAYER.maxMarkerLabelChars) log(`panel: player.markers #${i} label cut to ${PLAYER.maxMarkerLabelChars}`);
    out.push({ atMs: Number(longOf(at)), label: label.slice(0, PLAYER.maxMarkerLabelChars) });
  }
  out.sort((a, b) => a.atMs - b.atMs);
  if (out.length > PLAYER.maxMarkers) log(`panel: player.markers keeps ${PLAYER.maxMarkers}, the rest dropped`);
  return out.slice(0, PLAYER.maxMarkers);
}

/**
 * `{ enabled, countdownS, nextRef? }`: enabled required, countdownS required when enabled (0 when off and left out),
 * clamped to 0..maxCountdownS; a bad nextRef is dropped.
 */
export function autoNext(raw, log) {
  if (!isObj(raw)) { log("panel: player.autoNext is not an object, dropped"); return null; }
  if (typeof raw.enabled !== "boolean") { log("panel: player.autoNext needs enabled true or false, dropped"); return null; }
  let n = finite(raw.countdownS);
  if (n === null) {
    if (!raw.enabled && (!("countdownS" in raw) || raw.countdownS === null)) n = 0;
    else { log("panel: player.autoNext needs a countdownS number, dropped"); return null; }
  }
  const countdown = Number(coerce(longOf(n), 0n, BigInt(PLAYER.maxCountdownS)));
  if (countdown !== n) log(`panel: player.autoNext countdownS ${num(n)} clamped to ${countdown}`);
  const ref = typeof raw.nextRef === "string" && raw.nextRef !== "" ? raw.nextRef : null;
  let nextRef = null;
  if (ref !== null) {
    if (ref.length <= contract.output.maxRefChars) nextRef = ref;
    else log("panel: player.autoNext nextRef too long, dropped");
  }
  return { enabled: raw.enabled, countdownS: countdown, ...(nextRef !== null ? { nextRef } : {}) };
}

/**
 * PanelPlayerGate.check: the last check of a `player` action with the player's real duration and liveness, `seekToMs`
 * and `markers` clamped again. [source] starts the log lines ("panel", "playerEvent"). Null when nothing is left. (The
 * app also drops a seek within one second of the previous one; a single kit call has no previous seek.)
 */
export function gatePlayer(player, context, log, source = "panel") {
  if (!player) return null;
  const say = (line) => log(source === "panel" || !line.startsWith("panel: ") ? line : `${source}: ${line.slice("panel: ".length)}`);
  const live = context.kind === "live";
  const out = { ...player };
  if (out.seekToMs !== undefined) out.seekToMs = seekToMs(out.seekToMs, context.durationMs, live, say);
  if (out.markers !== undefined) out.markers = markers(out.markers, context.durationMs, say);
  const kept = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== undefined));
  return Object.keys(kept).length ? kept : null;
}

// ---------- what the kit prints ----------

/** A panel as printed: layout nodes flattened to readable objects. */
export function printPanel(p) {
  return { ...p, elements: p.elements.map(printNode) };
}

/** An answer as printed: only what is set, patch and panel entries as printed nodes. */
export function printAnswer(a) {
  const out = {};
  if (a.panel) out.panel = printPanel(a.panel);
  if (Object.keys(a.patch).length) out.patch = Object.fromEntries(Object.entries(a.patch).map(([k, n]) => [k, printNode(n)]));
  if (Object.keys(a.values).length) out.values = a.values;
  if (a.save.length) out.save = a.save;
  if (a.focus !== null) out.focus = a.focus;
  if (a.message !== null) out.message = a.message;
  if (a.player) out.player = a.player;
  return out;
}

/**
 * Checks a panel export's [value] the way the app does: `{ value, drops }`, `value` the printable result. [fn]:
 * "panel" (null `value` = the whole panel invalid, `ok` false), "panelAction" (the answer) or "playerEvent" (its
 * `player` and `message`). [context] feeds the player gate (duration, liveness).
 */
export function checkPanelOutput(fn, value, servers = [], { context = {}, lang = "es", apiVersion = 0 } = {}) {
  const drops = [];
  const log = (m) => { drops.push(m); };
  const json = JSON.stringify(value === undefined ? null : value);
  if (json.length > contract.output.maxResultChars) throw new Error("plugin answer too large (over 2 million characters)");
  const parsed = JSON.parse(json);
  if (fn === "panel") {
    const p = panelOutput(parsed, { lang, servers, log });
    return { ok: p !== null, value: p === null ? null : printPanel(p), drops };
  }
  if (fn === "panelAction") {
    const a = answerOutput(parsed, { lang, servers, log });
    return { ok: true, value: printAnswer({ ...a, player: gatePlayer(a.player, context, log) }), drops };
  }
  if (fn === "playerEvent") {
    const a = answerOutput(parsed, { lang, servers, log: (m) => log(m.startsWith("panel: ") ? `playerEvent: ${m.slice("panel: ".length)}` : m) });
    const out = {};
    const player = gatePlayer(a.player, context, log, "playerEvent");
    if (player) out.player = player;
    if (a.message !== null) out.message = a.message;
    // Task 8i: an apiVersion 14 plugin's `panel` (either format) shows in the open panel of the title; below it, ignored as
    // always (the app logs it once). A `state` is never applied.
    const screenPanels = apiVersion >= contract.manifest.screen.apiVersion;
    if (isObj(parsed) && isObj(parsed.panel)) {
      if (screenPanels) out.panel = parsed.panel;
      else drops.push("playerEvent: panel needs apiVersion 14, ignored");
    }
    if (screenPanels && isObj(parsed) && parsed.state !== undefined && parsed.state !== null) {
      drops.push("playerEvent: answer.state is not applied (keep it in your own variables or answer a panel built from it)");
    }
    return { ok: true, value: out, drops };
  }
  throw new Error(`unknown panel function ${fn}`);
}

// ---------- the panel button's icon file (PanelIconFile) ----------

export const ICON = contract.manifest.panel.iconFile;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PanelIconFile.problem: null when [bytes] is an acceptable icon, else the app's refusal. Reads the IHDR chunk only. */
export function panelIconProblem(bytes) {
  if (bytes.length > ICON.maxBytes || bytes.length < 33) return ICON.refusal;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return ICON.refusal;
  if (Buffer.from(bytes.subarray(12, 16)).toString("latin1") !== "IHDR") return ICON.refusal;
  const w = Buffer.from(bytes).readUInt32BE(16);
  const h = Buffer.from(bytes).readUInt32BE(20);
  const colorType = bytes[25];
  if (w !== ICON.sizePx || h !== ICON.sizePx) return ICON.refusal;
  // 6 = RGBA, 4 = grey + alpha: the only types with an alpha channel to draw.
  if (colorType !== 6 && colorType !== 4) return ICON.refusal;
  return null;
}

// ---------- the fake context (spec "panel(context)") ----------

/** The context the kit hands a plugin by default: a movie, 10 min in, on a TV. [over] is merged over it key by key; a live `kind` has no durationMs, as in the app. */
export function fakeContext(ref, over = {}) {
  const context = {
    kind: "movie", ref, title: "Demo", year: "2024", ids: { tmdb: 550 }, playing: {}, positionMs: 600000, durationMs: 5400000, paused: false,
    seekStepMs: 10000, stats: { width: 1920, height: 1080, videoCodec: "avc1", bitrateKbps: 4200, bufferedMs: 18000, network: "wifi", stallsThisSession: 0 },
    device: "tv", lang: "es-CO", values: { video: {}, plugin: {} }, player: { seekStepMs: 10000, speed: 1, resize: "fit" }, ...over,
  };
  // The app sends no durationMs for a live stream.
  if (context.kind === "live") delete context.durationMs;
  return context;
}

/** "es" or "en": the app's effective language from a context `lang` such as "es-CO". */
export function langOf(context) {
  return typeof context.lang === "string" && context.lang.toLowerCase().startsWith("en") ? "en" : "es";
}

/** The `panelAction` event as the app builds it: `{ key, trigger, values, value? }`. */
export function actionEvent(key, trigger, value, values) {
  return { key, trigger, values: values ?? {}, ...(value !== undefined ? { value } : {}) };
}

export const TRIGGERS = ["press", "change", "submit", "tab", "open"];
export const PLAYER_EVENTS = ["started", "paused", "resumed", "ended", "failed", "copyChanged"];

// ---------- Task 8k: a panel contributed to another plugin's title ----------

const CONTRIBUTES = contract.manifest.panel.contributes;

/** The salt `run.mjs --foreign` uses (the app uses its install's own: refs differ there, their shape does not). */
export const KIT_FOREIGN_SALT = "kino-kit";

/**
 * The opaque ref a contributed panel gets for another plugin's title (the app's PanelForeign.opaqueRef): HMAC-SHA256 keyed by
 * the install's [salt] over the contributor, the owner and the ref. The same title gives this contributor the same id on one
 * install; another plugin or another install gets another. Opaque, not secret.
 */
export function foreignRef(contributorId, ownerId, ref, salt = KIT_FOREIGN_SALT) {
  const hex = createHmac("sha256", Buffer.from(salt, "utf8")).update(`kino-panel-foreign:v2\n${contributorId}\n${ownerId}\n${ref}`, "utf8").digest("hex");
  return CONTRIBUTES.foreignRefPrefix + hex.slice(0, CONTRIBUTES.foreignRefHexChars);
}

/**
 * [context] as a contributed panel gets it (the app's PanelForeign.applyTo), from an ALLOW-LIST (contract
 * `manifest.panel.contributes.contextFields`): the ref opaque, `playing` empty (the owner's copy), the player block without
 * autoNext, `foreign: true` and `source: { pluginId, name }` (the plugin providing the stream) added.
 */
export function foreignContext(context, contributorId, source, salt = KIT_FOREIGN_SALT) {
  const out = {};
  for (const k of CONTRIBUTES.contextFields) if (context[k] !== undefined) out[k] = context[k];
  const player = {};
  for (const k of CONTRIBUTES.playerFields) if (context.player && context.player[k] !== undefined) player[k] = context.player[k];
  return {
    ...out, ref: foreignRef(contributorId, source.pluginId, context.ref, salt), playing: {}, player,
    foreign: true, source: { pluginId: source.pluginId, name: source.name },
  };
}

/** A `playerEvent`'s detail as a contributor gets it: a copyChanged's copy label is the owner's. */
export function foreignEventDetail(type, detail) {
  if (type !== "copyChanged") return detail;
  const { label, ...rest } = detail;
  return rest;
}

/**
 * What the app does with a contributed panel's answer [answer] to a `panelAction` whose trigger is [trigger] (null: a
 * `playerEvent`): its `player` only after a press, and only a seek; its `go.title` / `go.play` never. The lines it logs.
 */
export function foreignAnswerDrops(answer, trigger, { control = false } = {}) {
  const out = [];
  if (!answer || typeof answer !== "object") return out;
  const p = answer.player;
  if (p && typeof p === "object") {
    // Task 8j: with playerControl every origin counts, and a seek, a pause and a speed.
    const kept = control ? CONTRIBUTES.playerActionKeptWithControl : CONTRIBUTES.playerActionKept;
    if (!control && !CONTRIBUTES.playerActionsFrom.includes(trigger)) out.push("player: a contributed panel's player action needs the person's press in it or the playerControl capability, dropped");
    else {
      const extra = Object.keys(p).filter((k) => !kept.includes(k));
      if (extra.length) out.push(`player.${extra.join(", player.")}: a contributed panel only ${control ? "seeks, pauses and sets the speed" : "seeks"}; the playing plugin's player properties are its own, dropped`);
    }
  }
  const g = answer.go;
  if (g && typeof g === "object") for (const k of CONTRIBUTES.goDropped) if (g[k] !== undefined) out.push(`go.${k}: a contributed panel never opens a plugin's title, dropped`);
  return out;
}

/** Whether [manifest] contributes a tab to the player panel of other plugins' titles (the merged manifest). */
export function contributesPanel(manifest) {
  return manifest.panel?.contributes === true && (manifest.capabilities || []).includes(CONTRIBUTES.capability);
}

// ---------- Task 11: the player panel on a live channel ----------

const LIVE = contract.kinoLivePanel;

/** The content kinds [manifest]'s contributed tab joins (`panel.kinds`, default ["title"]); empty when it contributes none. */
export function contributedKinds(manifest) {
  if (!contributesPanel(manifest)) return [];
  return Array.isArray(manifest.panel.kinds) ? manifest.panel.kinds : [...CONTRIBUTES.kinds.default];
}

/** Whether [manifest]'s contributed tab joins an En vivo channel's panel (`"kinds"` holds "live"). */
export function contributesLive(manifest) {
  return contributedKinds(manifest).includes(LIVE.kind);
}

/**
 * The context a tab gets on an En vivo channel (the app's PanelContextJson live shape), exactly contract
 * `kinoLivePanel.contextFields`: the channel `{ provider, code, name }`, `foreign: true`, the provider as `source`, and the
 * session's own parts taken from [base] (device, lang, tab, values, features; in screen mode state and size).
 */
export function liveContext(channel, base = {}, sourceName = channel.provider) {
  const out = {
    kind: LIVE.kind, live: true, channel: { provider: channel.provider, code: channel.code, name: channel.name ?? channel.code },
    foreign: true, source: { pluginId: channel.provider, name: sourceName },
    device: base.device ?? "tv", lang: base.lang ?? "es-CO", values: base.values ?? { video: {}, plugin: {} },
  };
  if (base.tab !== undefined) out.tab = base.tab;
  if (base.features !== undefined) out.features = base.features;
  for (const k of LIVE.screenContextAdds) if (base[k] !== undefined) out[k] = base[k];
  return out;
}

/** What the app drops of a live tab's answer [answer]: its whole `player` (live_channel) and, as any contributed tab, go.title/play. */
export function liveAnswerDrops(answer) {
  const out = [];
  if (!answer || typeof answer !== "object") return out;
  if (answer.player !== undefined && answer.player !== null) out.push(LIVE.playerDroppedLog.replace(/^panel: /, ""));
  const g = answer.go;
  if (g && typeof g === "object") for (const k of CONTRIBUTES.goDropped) if (g[k] !== undefined) out.push(`go.${k}: a contributed panel never opens a plugin's title, dropped`);
  return out;
}

// ---------- Task 8j: who may move the player (PlayerControlRules, contract.kinoPlayerControl) ----------

const CONTROL = contract.kinoPlayerControl;
export const PLAYER_CONTROL_LINES = {
  needsControl: "panel: a player action from a panel result or a playerEvent needs the playerControl capability, dropped",
  pauseNeedsPress: "panel: player.pause needs the person's press in the panel or the playerControl capability, dropped",
  contributedNeedsPress: "panel: a contributed panel's player action needs the person's press in it or the playerControl capability, dropped",
  contributedOnlySeeks: "panel: a contributed panel only seeks; the playing plugin's player properties are its own, dropped",
  contributedOnlyControls: "panel: a contributed panel only seeks, pauses and sets the speed; the playing plugin's player properties are its own, dropped",
};

const onlyFields = (a, fields) => Object.fromEntries(Object.entries(a).filter(([k]) => fields.includes(k)));
const sameAction = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const emptyAction = (a) => Object.keys(a).length === 0;

function withoutControl(a, origin, contributed) {
  let kept;
  if (contributed) kept = origin === "press" ? onlyFields(a, CONTROL.contributedWithoutControl) : {};
  else if (origin === "refresh") kept = {};
  else if (origin === "press") kept = { ...a };
  else { kept = { ...a }; delete kept.pause; }
  return emptyAction(kept) ? null : kept;
}

/**
 * PlayerControlRules.sift: what of the checked player action [a] (panelPlayerOf's output) reaches the gate, by [origin]
 * ("press", "change", "submit", "refresh": a panel result's own, "event": a playerEvent answer), [contributed] (a tab given to
 * another plugin's title) and [control] (playerControl granted). `{ action, controlled, announce }` or null; each drop logged.
 */
export function siftPlayer(a, origin, { contributed = false, control = false } = {}, log = () => {}) {
  if (!CONTROL.origins.includes(origin)) throw new Error(`unknown player action origin ${origin}`);
  const plain = withoutControl(a, origin, contributed);
  if (!control) {
    if (contributed && plain === null) log(PLAYER_CONTROL_LINES.contributedNeedsPress);
    else if (contributed && !sameAction(plain, a)) log(PLAYER_CONTROL_LINES.contributedOnlySeeks);
    else if (origin === "refresh") log(PLAYER_CONTROL_LINES.needsControl);
    else if (plain === null || !sameAction(plain, a)) log(PLAYER_CONTROL_LINES.pauseNeedsPress);
    return plain === null ? null : { action: plain, controlled: false, announce: false };
  }
  const kept = contributed ? onlyFields(a, CONTROL.contributedWithControl) : { ...a };
  if (!sameAction(kept, a)) log(PLAYER_CONTROL_LINES.contributedOnlyControls);
  if (emptyAction(kept)) return null;
  const controlled = plain === null || !sameAction(kept, plain);
  return { action: kept, controlled, announce: controlled && CONTROL.announcedOrigins.includes(origin) };
}

/** "1:02:03" or "2:03". */
function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/**
 * PlayerControlRules.notice: the short notice Kino shows for an announced action, in [lang] ("es" / "en"), naming the plugin
 * ([name], qualified when it reads like Kino: [confusable]); null when the action does nothing the person would see.
 */
export function playerNotice(name, a, lang = "es", confusable = false) {
  const parts = CONTROL.noticeParts[lang];
  const what = [];
  if (a.pause !== undefined) what.push(a.pause ? parts.paused : parts.resumed);
  if (a.seekToMs !== undefined) what.push(parts.movedTo.replace("{time}", clock(a.seekToMs)));
  if (a.speed !== undefined) what.push(parts.speed.replace("{speed}", `${a.speed}\u00d7`));
  if (!what.length) return null;
  const who = confusable ? (lang === "en" ? `Plugin \u201c${name}\u201d` : `Plugin \u00ab${name}\u00bb`) : name;
  return CONTROL.notice[lang].replace("{who}", who).replace("{what}", what.join(", "));
}
