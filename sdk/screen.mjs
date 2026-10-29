// Plugin screens (apiVersion 14, capability "screen") as the Node kit sees them: a JS port, rule by rule, of what the app
// keeps of a plugin's `screen` tree and `screenEvent` answers (PluginScreenOutput, PluginScreenTree, PluginScreenDecl).
// Kino's own Kotlin is authoritative: every limit comes from docs/plugins/contract.json (manifest.screen) and every log
// line below is the app's, so `· dropped: <reason>` here is the line the app logs. Nothing throws on a bad answer: an
// invalid node, style value, action or field is dropped with a reason. Like panel.mjs it reads the answer the way org.json
// does (the answer crosses to Kino as JSON), and like the Kotlin it walks a JSON object's keys SORTED wherever the walk
// can log, so the lines come out in the same order. plugins/sdk/test/screen-cases.json is the case table both sides share.
import { contract, isUserServer, javaDouble, screenGoOf, screenItems, titleByIdsOf, urlGoOf, copyGoOf, liveChannelGoOf } from "./contract.mjs";
import { badgeOf, cappedLog, colorHint, httpsImage, panelAccentOf, panelMessageOf, panelPlayerOf, panelRefreshOf, panelTabsOf } from "./panel.mjs";

// ---------- limits and name tables (ScreenLimits, ScreenWidgets; numbers come from the contract file) ----------

const S = contract.manifest.screen;
export const SCREEN = S;
export const LIMITS = S.limits;
export const WIDGETS = S.widgets;
export const INPUTS = S.inputs;
export const DEVICES = S.devices;
export const SIZE_CLASSES = S.sizeClasses;
/** PanelIcons.NAMES. */
const ICONS = contract.manifest.panel.icons;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;
const AUTO = "auto-";
const RESERVED_EVENT = "open";
const GO_KEYS = contract.manifest.screen.goShapes;
/** Why a `go.title` / `go.play` `id` is dropped (PluginScreenOutput.GO_BAD_ID). */
const GO_BAD_ID = "id must be 1 to 128 of A-Z a-z 0-9 . _ ~ -";
const ACTION_KEYS = ["ui", "event", "arg", "go", "timeoutMs"];
/** Task 18 (G6): the action fields that are a press of the person's, where an action's own timeoutMs is read. */
const PRESS_FIELDS = ["onTap", "onLongPress", "onSubmit", "onTrailingTap"];
/** Every field a screen answer may carry (ScreenLimits.ANSWER_FIELDS); `ui` since Task 7i-2. */
const ANSWER_KEYS = S.answerFields;
/** A declared pop-up's `onClose` (Task 7i-2): ScreenLimits.POPUP_ON_CLOSE. */
const POPUP_ON_CLOSE = S.declaredPopups.dismissAction;
/** What an onClose and its event's answer never carry (fix round 1): ScreenLimits.DISMISS_DROPPED_OPS / _FIELDS. */
const DISMISS_DROPPED_OPS = S.declaredPopups.dismissDroppedOps;
const DISMISS_DROPPED_FIELDS = S.declaredPopups.dismissDroppedFields;
const POPUP = "popup";
const FORM = "form";
const SETTINGS = "settings";
const ACCORDION = "accordion";
/** Screen asks: Kino's own setup flow (PluginScreenOutput's STEPS). */
const STEPS = "steps";
const STEPPER = "stepper";
const TABLE = "table";
/** A table's parts (`tr`, `td`): read only inside one. */
const TABLE_PARTS = S.tableParts;
/** What a table cell never holds, at any depth: a list, a scroll or another table. */
const NOT_IN_TABLE_CELL = S.notInTableCell;
/** What an image's fallback may hold, at any depth (Task 7i-1): ScreenWidgets.FALLBACK_WIDGETS. */
const FALLBACK_WIDGETS = S.fallbackWidgets.widgets;
/** A table cell's `align`: across its width only. */
const CELL_ALIGNS = ["start", "center", "end"];
/** The twelve-column layout's columns (a wrapping row's line). */
const GRID_COLUMNS = LIMITS.gridColumns;
/** PluginSettings.KEY: a setting's key. */
const SETTING_KEY = new RegExp(contract.settings.keyPattern);
/** The form rules a field may carry, in the order they are read (and logged). */
const FIELD_RULES = ["required", "minLength", "maxLength", "pattern", "errorText"];
/** A title grid's `columns` when it sets none. */
const TITLE_GRID_COLUMNS = 3;
// The enums of PluginScreenTree.kt / PluginLayout.kt, by wire name.
const CARD_VARIANTS = ["plain", "outlined", "filled"];
const DIRECTIONS = ["vertical", "horizontal"];
const TEXT_STYLES = ["h1", "h2", "h3", "h4", "h5", "p", "caption", "label"];
// The earlier names of the text scale, still accepted (and read as the scale's own) so earlier samples parse.
const TEXT_STYLE_ALIASES = { display: "h1", title: "h3", subtitle: "h4", body: "p" };
const BUTTON_VARIANTS = ["primary", "secondary", "text", "icon"];
const ASPECTS = ["16:9", "2:3", "1:1", "banner"];
const ALIGNS = ["start", "center", "end", "stretch"];
const JUSTIFIES = ["start", "center", "end", "spaceBetween", "spaceAround"];
const INT_MAX = 2147483647;

// ---------- Flutter-style names (Task 8e, ScreenNames; contract manifest.screen.aliases) ----------

const ALIASES = S.aliases;
const BUTTON = "button";
const TEXT_FIELD = "TextField";
/** What only chooses between a one-line and a multiline TextField: dropped from it once read. */
const TEXT_FIELD_ONLY = ["multiline", "maxLines"];

/** ScreenNames.multiline: `multiline: true`, or a `maxLines` above 1 (in some size class when it is a per-size map). */
function multiline(o) {
  if (opt(o, "multiline") === true) return true;
  const above = (v) => typeof v === "number" && v > 1;
  const m = opt(o, "maxLines");
  return isObj(m) ? Object.keys(m).some((k) => above(m[k])) : above(m);
}

/** ScreenNames.move: [canonical]'s value moved under [alias]; the canonical one wins a clash (logged); a canonical null counts as absent. */
function moveProp(copy, canonical, alias, name, log) {
  if (!has(copy, canonical)) return;
  const v = copy[canonical];
  delete copy[canonical];
  if (v === null) { if (!has(copy, alias)) copy[alias] = null; return; }
  if (present(copy, alias)) log(`screen: ${name} has both ${canonical} and ${alias}, ${alias} ignored`);
  copy[alias] = v;
}

function columnList(list, log) {
  const touches = (c) => isObj(c) && Object.keys(ALIASES.columnProps).some((k) => has(c, k));
  if (!list.some(touches)) return null;
  return list.map((c, i) => {
    if (!touches(c)) return c;
    const copy = { ...c };
    for (const [canonical, alias] of Object.entries(ALIASES.columnProps)) moveProp(copy, canonical, alias, `table column ${i}`, log);
    return copy;
  });
}

function aliasColumns(raw, log) {
  if (Array.isArray(raw)) return columnList(raw, log);
  if (!isObj(raw)) return null;
  let out = null;
  for (const k of Object.keys(raw).sort()) {
    if (!Array.isArray(raw[k])) continue;
    const fixed = columnList(raw[k], log);
    if (fixed === null) continue;
    (out ??= { ...raw })[k] = fixed;
  }
  return out;
}

function aliasParts(raw, log) {
  if (!Array.isArray(raw)) return null;
  let changed = false;
  const out = raw.map((p) => {
    const fixed = isObj(p) ? normalizeNode(p, log) : p;
    if (fixed !== p) changed = true;
    return fixed;
  });
  return changed ? out : null;
}

/**
 * ScreenNames.normalize: [o] as Kino reads it: [o] itself when it uses none of the documented names, else a shallow copy with
 * each of them rewritten into the older one (a table's columns, rows and cells too). Never throws; clashes and a property
 * out of place are logged with the older names.
 */
export function normalizeNode(o, log) {
  const written = typeof opt(o, "type") === "string" ? o.type : null;
  const mapped = written !== null && has(ALIASES.types, written) ? ALIASES.types[written] : null;
  const type = mapped === null ? written : written === TEXT_FIELD && multiline(o) ? ALIASES.textFieldMultiline : mapped;
  const touches = mapped !== null || type === TABLE || type === "tr"
    || Object.keys(ALIASES.props).some((k) => has(o, k)) || Object.keys(ALIASES.buttonProps).some((k) => has(o, k));
  if (!touches) return o;
  const copy = { ...o };
  const name = type === null ? "" : type.slice(0, 40);
  if (mapped !== null) {
    copy.type = type;
    if (written === TEXT_FIELD) for (const k of TEXT_FIELD_ONLY) delete copy[k];
    const implied = has(ALIASES.implied, written) ? ALIASES.implied[written] : null;
    if (implied !== null) {
      const [prop, value] = Object.entries(implied)[0];
      const given = opt(o, prop);
      if (!absent(given) && given !== value) log(`screen: ${name} ${prop} ${fmt(given)} does not match ${written}, "${value}" used`);
      copy[prop] = value;
    }
  }
  for (const [canonical, alias] of Object.entries(ALIASES.props)) moveProp(copy, canonical, alias, name, log);
  if ((ALIASES.buttonPropTypes ?? [BUTTON]).includes(type)) for (const [canonical, alias] of Object.entries(ALIASES.buttonProps)) moveProp(copy, canonical, alias, name, log);
  else for (const canonical of Object.keys(ALIASES.buttonProps)) if (present(copy, canonical)) log(`screen: ${name} ${canonical} works only on a button, ignored`);
  if (type === TABLE) {
    const cols = aliasColumns(opt(copy, "columns"), log);
    if (cols !== null) copy.columns = cols;
    const rows = aliasParts(opt(copy, "children"), log);
    if (rows !== null) copy.children = rows;
  } else if (type === "tr") {
    const cells = aliasParts(opt(copy, "children"), log);
    if (cells !== null) copy.children = cells;
  }
  return copy;
}

/** ScreenWidgets.responsive: every property of [type] that takes a per-size map (the one table the reader uses). */
export function responsive(type) {
  return new Set([...S.styleProps, ...(S.layoutProps[type] || [])]);
}

// ---------- org.json-shaped helpers ----------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** JSONObject.opt: the value of an own key, else undefined (a JSON null is `null`: org.json's JSONObject.NULL). */
const opt = (o, k) => (has(o, k) ? o[k] : undefined);
const absent = (v) => v === undefined || v === null;
const present = (o, k) => has(o, k) && o[k] !== null;
/** Android's JSONObject.toString: compact, and "/" escaped as "\/". */
const androidJson = (v) => JSON.stringify(v).replace(/\//g, "\\/");
const bytes = (o) => Buffer.byteLength(androidJson(o), "utf8");
/** A JSON number as org.json prints it (Int/Long when whole, Double otherwise). */
const numText = (n) => (Number.isInteger(n) ? String(n) : javaDouble(n));
/** A plugin value as a log line shows it: a string quoted and cut to 40, anything else cut to 40. */
function fmt(v) {
  if (typeof v === "string") return `"${v.slice(0, 40)}"`;
  if (absent(v)) return "null";
  const t = typeof v === "number" ? numText(v) : typeof v === "object" ? androidJson(v) : String(v);
  return t.slice(0, 40);
}

/** PluginLayout.localized: [key] or, in English, `<key>En` when present. */
function localized(o, key, lang) {
  const es = typeof o[key] === "string" ? o[key].trim() : "";
  const en = typeof o[key + "En"] === "string" ? o[key + "En"].trim() : "";
  return lang === "en" && en !== "" ? en : es;
}

/** The answer as the app receives it: through JSON (undefined and functions are null, NaN is null, keys are own). */
function wire(value) {
  const s = JSON.stringify(value);
  return s === undefined ? null : JSON.parse(s);
}

const fits = (o) => bytes(o) <= LIMITS.maxStateBytes;

// ---------- Kotlin's whitespace (Char.isWhitespace: Java's isWhitespace or isSpaceChar), not JS's trim ----------

const KOTLIN_SPACE = /[\p{Zs}\p{Zl}\p{Zp}\t\n\u000B\f\r\u001C-\u001F]/u;
/** Kotlin's String.trim(): Kotlin's whitespace at both ends (U+FEFF is not one; U+001C..U+001F are). */
function kotlinTrim(s) {
  let a = 0;
  let b = s.length;
  while (a < b && KOTLIN_SPACE.test(s[a])) a++;
  while (b > a && KOTLIN_SPACE.test(s[b - 1])) b--;
  return s.slice(a, b);
}
/** Kotlin's String.isBlank(). */
const kotlinBlank = (s) => kotlinTrim(s) === "";

// ---------- the plugin's settings, as a screen reads and writes them (ScreenConfig) ----------

/**
 * The manifest's `settings` as the screen checks see them (the app's parsed PluginSetting): key, type, required, the
 * options' values, a list's fields and its `max`. Null when [raw] is not a list (settings unknown).
 */
function settingsModel(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isObj).map((s) => ({
    key: s.key, type: s.type, required: s.required === true,
    options: Array.isArray(s.options) ? s.options.filter(isObj).map((o) => o.value) : [],
    fields: Array.isArray(s.fields) ? s.fields.filter(isObj).map((f) => ({ key: f.key, type: f.type, required: f.required === true })) : [],
    max: Number.isInteger(s.max) ? s.max : contract.settings.list.defaultMaxEntries,
    // apiVersion 14 `unlockWith` (SettingLocks): the lock and the value it starts at (a toggle without a default is off, a
    // select at its first option).
    unlockWith: typeof s.unlockWith === "string" ? s.unlockWith : null,
    start: s.default !== undefined && s.default !== null ? s.default
      : s.type === "toggle" ? false : s.type === "select" && Array.isArray(s.options) && isObj(s.options[0]) ? s.options[0].value : null,
  }));
}

/** ScreenConfig.lockedWhy: why a `config` write moving a locked setting away from its default is refused. */
const lockedWhy = (s) => contract.settings.unlockWith.lockedWhy.replace("{value}", s.unlockWith);

const maxChars = (type) => contract.settings.types[type]?.maxChars ?? 0;

/** ScreenConfig.value: an answer's `config` value for setting [s] (a writable one): `{ value }` or `{ why }`; [note] a line that refuses nothing. */
function configValue(s, raw, note) {
  const emptied = () => (s.required ? { why: "is required, it cannot be emptied" } : { value: null });
  if (absent(raw)) return emptied();
  // A locked setting moves away from its default only through Kino's form, after the code (SettingLocks.refusesPluginWrite).
  if (s.unlockWith && raw !== s.start) return { why: lockedWhy(s) };
  switch (s.type) {
    case "toggle": return typeof raw === "boolean" ? { value: raw } : { why: "is not true or false" };
    case "select": return typeof raw === "string" && s.options.includes(raw) ? { value: raw } : { why: "is not one of its options" };
    case "text": {
      // Trimmed (Kotlin's trim) as Ajustes' save and an action's setSettings trim it, then checked.
      if (typeof raw !== "string") return { why: "is not text" };
      const v = kotlinTrim(raw);
      if (v === "") return emptied();
      if (v.length > maxChars(s.type)) return { why: `is longer than ${maxChars(s.type)} characters` };
      return { value: v };
    }
    case "list": {
      if (!Array.isArray(raw)) return { why: "is not a list of records" };
      const entries = [];
      for (let i = 0; i < raw.length; i++) {
        const o = raw[i];
        if (!isObj(o)) return { why: `entry ${i + 1} is not a record` };
        for (const k of Object.keys(o).sort()) if (!s.fields.some((f) => f.key === k)) note(`entry ${i + 1} field "${k.slice(0, 40)}" is not one of the list's fields, ignored`);
        const entry = {};
        for (const f of s.fields) {
          const v = opt(o, f.key);
          if (absent(v)) entry[f.key] = "";
          else if (typeof v === "string") entry[f.key] = kotlinTrim(v);
          else return { why: `entry ${i + 1} field "${f.key}" is not text` };
        }
        if (Object.values(entry).some((v) => !kotlinBlank(v))) entries.push(entry);
      }
      if (entries.length === 0) return emptied();
      if (entries.length > s.max) return { why: `has more than ${s.max} entries` };
      for (let i = 0; i < entries.length; i++) {
        for (const f of s.fields) {
          const v = entries[i][f.key];
          if (kotlinBlank(v)) {
            if (f.required) return { why: `entry ${i + 1} needs its field "${f.key}"` };
            continue;
          }
          if (v.length > maxChars(f.type)) return { why: `entry ${i + 1} field "${f.key}" is longer than ${maxChars(f.type)} characters` };
          if (f.type === "url" && !isUserServer(v)) return { why: `entry ${i + 1} field "${f.key}" is not a valid address` };
        }
      }
      return { value: entries };
    }
    case "password": {
      // Screen asks: kept exactly as given (never trimmed, as Ajustes keeps a typed password); blank empties it.
      if (typeof raw !== "string") return { why: "is not text" };
      if (kotlinBlank(raw)) return emptied();
      if (raw.length > maxChars(s.type)) return { why: `is longer than ${maxChars(s.type)} characters` };
      return { value: raw };
    }
    default: return { why: `is of type ${s.type}, never written from a screen` };
  }
}

/**
 * ScreenConfig.keepsAddresses: whether list value [wanted] for setting [s] adds no address: every non-blank value of its url
 * fields is already in [stored] (the list as stored now) for that field. The app checks it when it writes; the kit's shim too.
 */
export function keepsAddresses(s, wanted, stored) {
  const urlFields = (s.fields || []).filter((f) => f.type === "url").map((f) => f.key);
  if (urlFields.length === 0) return true;
  const now = Array.isArray(stored) ? stored : [];
  const next = Array.isArray(wanted) ? wanted : [];
  return next.every((e) => urlFields.every((f) => kotlinBlank(String(e?.[f] ?? "")) || now.some((x) => kotlinTrim(String(x?.[f] ?? "")) === kotlinTrim(String(e[f])))));
}

/** ScreenConfig.bindProblem: why a field of widget [type] cannot be bound to setting [s] (null when it can). [secret]: a masked text field. */
function bindProblem(type, multiple, key, s, secret = false) {
  const k = key.slice(0, 40);
  if (!s) return `bind "${k}" is not one of this plugin's settings`;
  if (!S.configTypes.includes(s.type)) return `bind "${k}" is of type ${s.type}, never written from a screen`;
  // A locked setting is changed only in Kino's own form (a settings node), which asks the code.
  if (s.unlockWith) return contract.settings.unlockWith.lockedBind.replace("{key}", k).replace("{value}", s.unlockWith);
  // A secret field holds only a password, and a password only a secret field.
  if (secret) return S.secretBindHolds.includes(s.type) ? null : `bind "${k}" is of type ${s.type}: a secret field holds only a password`;
  if (s.type === "password") return `bind "${k}" is a password: only a secret textInput holds it`;
  const holds = type === "chips" && multiple ? [] : S.bindHolds[type] || [];
  return holds.includes(s.type) ? null : `bind "${k}" is of type ${s.type}, which this field cannot hold`;
}

// ---------- the reader (PluginScreenOutput.Reader) ----------

const REFUSED = Symbol("refused");

// ---------- the stepper's numbers (ScreenStepper) ----------

/**
 * ScreenStepper.bounded: [v] within ±maxStepperAbs (NaN is 0), so no press overflows and toFixed never takes an exponent.
 * Whole numbers are exact up to it; decimals are not (6 exact decimals hold only up to about 1e9).
 */
function stepperBounded(v) {
  if (Number.isNaN(v)) return 0;
  return Math.min(LIMITS.maxStepperAbs, Math.max(-LIMITS.maxStepperAbs, v));
}

/** [v] rounded to [d] places, half away from zero (BigDecimal's HALF_UP on the exact double: toFixed). Never throws. */
function stepperRound(v, d) {
  const r = Number(stepperBounded(v).toFixed(d));
  return r === 0 ? 0 : r;
}

/** ScreenStepper.normalize: [v] within [min]..[max] and on the [d] grid (rounded toward the inside at a bound). */
export function stepperNormalize(v, min, max, d) {
  let x = stepperBounded(v);
  if (min !== null && x < min) x = min;
  if (max !== null && x > max) x = max;
  x = stepperBounded(x);
  const unit = 10 ** -d;
  let r = stepperRound(x, d);
  if (max !== null && r > max) r = stepperRound(r - unit, d);
  if (min !== null && r < min) r = stepperRound(r + unit, d);
  if ((max !== null && r > max) || (min !== null && r < min)) r = x;
  return r === 0 ? 0 : r;
}

/** ScreenStepper.text: the canonical text the state holds (a `.` for decimals, no grouping, exactly [d] places). */
export function stepperText(v, d) {
  return stepperBounded(v).toFixed(d).replace(/^-(0\.?0*)$/, "$1");
}

/** A row's `wrap`: true, or a per-size map (only size classes: a mixed one is dropped) with true in some class. */
const wrapsAnywhere = (raw) => raw === true || (isObj(raw) && Object.keys(raw).every((k) => SIZE_CLASSES.includes(k)) && Object.values(raw).includes(true));
/** Whether [raw] is a per-size map (an object with a size class among its keys). */
const isSizeMap = (raw) => isObj(raw) && Object.keys(raw).some((k) => SIZE_CLASSES.includes(k));
/** TABLE_CELL_PROPS / TABLE_COLUMN_PROPS (the contract's): a cell's and a column's properties that take per-size maps. */
const TABLE_CELL_PROPS = S.tableCellProps;
const TABLE_COLUMN_PROPS = S.tableColumnProps;
/** PluginScreenOutput.tableHasMaps: whether a table's columns' weights or its cells' colSpan/align hold per-size maps. */
function tableHasMaps(o) {
  const cols = opt(o, "columns");
  if (Array.isArray(cols)) for (const c of cols.slice(0, LIMITS.maxTableColumns)) if (isObj(c) && TABLE_COLUMN_PROPS.some((p) => isSizeMap(opt(c, p)))) return true;
  const rows = opt(o, "children");
  if (!Array.isArray(rows)) return false;
  for (const r of rows.slice(0, LIMITS.maxTableRows)) {
    const cells = isObj(r) ? opt(r, "children") : undefined;
    if (!Array.isArray(cells)) continue;
    for (const td of cells) if (isObj(td) && TABLE_CELL_PROPS.some((p) => isSizeMap(opt(td, p)))) return true;
  }
  return false;
}

/**
 * ScreenTableFit.fit: a row's cells within [count] columns: a cell past the last column cut (cuts: [index, span left]), the
 * cells after it dropped, the row padded with empty cells.
 */
export function fitTableRow(cells, count) {
  const n = Math.max(1, count);
  let used = 0;
  const kept = [];
  const cuts = [];
  let dropped = false;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (used >= n) { dropped = true; break; }
    const span = Math.max(1, c.colSpan);
    if (used + span > n) { cuts.push([i, n - used]); kept.push({ ...c, colSpan: n - used }); used = n; }
    else { kept.push(span === c.colSpan ? c : { ...c, colSpan: span }); used += span; }
  }
  for (; used < n; used++) kept.push({ text: "", children: [], align: null, colSpan: 1 });
  return { cells: kept, cuts, dropped };
}

/** One reading (a tree, or an answer's dialog): the node budget, the key set and the once-only cut logs. */
class Reader {
  // [limits]: the tree's depth and node limits (the screen's, or the player panel's: Task 8i) and whether it is read for the
  // panel (its notDrawn widgets dropped).
  constructor(lang, widgets, log, allowSeries = true, settings = null, { maxDepth = LIMITS.maxDepth, maxNodes = LIMITS.maxNodes, inPanel = false } = {}) {
    this.maxDepth = maxDepth;
    this.maxNodes = maxNodes;
    this.inPanel = inPanel;
    this.allowSeries = allowSeries;
    // The plugin's declared settings (settingsModel; null: unknown), the keys a `settings` node already shows, and whether one
    // showed them all while they were unknown.
    this.settings = settings;
    this.shownSettings = new Set();
    this.allSettingsShown = false;
    // How many ancestors being read draw their content all at once (a scroll, a list, a pop-up's body): a title grid
    // there is drawn flat. `across`: of those, scrolls that may scroll across, where a rail is drawn flat.
    this.flat = 0;
    this.across = 0;
    this.lang = lang;
    this.widgets = widgets;
    this.log = log;
    this.budget = maxNodes;
    this.accepted = 0;
    this.keys = new Set();
    this.depthLogged = false;
    this.nodesLogged = false;
    // Titles left (maxTitles) and whether running out was logged; items already read, by their JSON (the same array
    // or object in every size pass): read and counted once.
    this.titles = LIMITS.maxTitles;
    this.titlesLogged = false;
    this.itemCache = new Map();
    // The key of the form whose children are being read (a pop-up's body is outside it), and how many answer pop-up
    // bodies are being read (a form there is dropped).
    this.formKey = null;
    this.answerBody = 0;
    // How many table cells are being read: a list, a scroll or a table there is dropped.
    this.inCell = 0;
    // How many image fallbacks are being read: only FALLBACK_WIDGETS are kept there.
    this.inFallback = 0;
    // The row whose own fields are being read wraps in some class; the depth of the wrapping row's children being read
    // (they take span and offset); the size class of the pass reading a node's own fields (null: one pass for all).
    this.rowWraps = false;
    this.wrapChildDepth = -1;
    this.passClass = null;
  }

  inPass(cls, read) {
    const outer = this.passClass;
    this.passClass = cls;
    try { return read(); } finally { this.passClass = outer; }
  }

  /** [read] with the children at [depth] placed by span and offset (when [wraps]). */
  wrapChildren(wraps, depth, read) {
    const outer = this.wrapChildDepth;
    this.wrapChildDepth = wraps ? depth : -1;
    try { return read(); } finally { this.wrapChildDepth = outer; }
  }

  /**
   * PluginScreenOutput.pick: a table part's property as this pass sees it: a plain value as it is; a per-size map resolved for
   * passClass (the next smaller class present, else absent); a map mixing size classes with other keys dropped (logged).
   */
  pick(raw, where, name) {
    if (!isSizeMap(raw)) return raw;
    if (Object.keys(raw).some((k) => !SIZE_CLASSES.includes(k))) { this.log(`${where} ${name} mixes size classes with other keys, dropped`); return null; }
    const upTo = SIZE_CLASSES.indexOf(this.passClass ?? SIZE_CLASSES[0]);
    for (let i = upTo; i >= 0; i--) { const c = SIZE_CLASSES[i]; if (has(raw, c) && raw[c] !== null) return raw[c]; }
    return null;
  }

  /** [read] with [key] as the form around it (null: outside any form, as in a pop-up's body). */
  inForm(key, read) {
    const outer = this.formKey;
    this.formKey = key;
    try { return read(); } finally { this.formKey = outer; }
  }

  text(o, name) { return localized(o, name, this.lang).slice(0, LIMITS.maxTextChars); }

  /**
   * PluginScreenOutput.node (Task 17): `childOf` is the type of the node whose `children` (or a list's `items`) are being read,
   * else null; `parentType` the one of the node whose own fields are being read (a child's alignSelf and positioned read it).
   */
  node(written, depth) {
    const parent = this.childOf ?? null;
    this.childOf = null;
    const outerParent = this.parentType ?? null;
    // Task 17 item G: the Scaffold slot whose node is being read.
    const slot = this.slotOf ?? null;
    this.slotOf = null;
    const outerSlot = this.mySlot ?? null;
    try {
      this.parentType = parent;
      this.mySlot = slot;
      return this.nodeIn(written, depth);
    } finally {
      this.childOf = parent;
      this.parentType = outerParent;
      this.slotOf = slot;
      this.mySlot = outerSlot;
    }
  }

  /** PluginScreenOutput.scaffoldSlot (Task 17 item G): one of a Scaffold's slots, read as that slot. */
  scaffoldSlot(o, slot, depth) {
    const raw = opt(o, slot);
    if (absent(raw)) return null;
    if (!isObj(raw)) { this.log(`screen: scaffold ${slot} is not a node, dropped`); return null; }
    const want = S.scaffold.slotTypes[slot] ?? null;
    const written = typeof raw.type === "string" ? raw.type : null;
    const type = written !== null && has(ALIASES.types, written) ? ALIASES.types[written] : written;
    if (want !== null && type !== want) {
      const flutter = Object.entries(ALIASES.types).find(([, v]) => v === want)[0];
      this.log(`screen: scaffold ${slot} must be ${flutter}, dropped`);
      return null;
    }
    this.slotOf = slot;
    try { return this.node(raw, depth + 1); } finally { this.slotOf = null; }
  }

  /** PluginScreenOutput.barButton (Task 17 item G): an AppBar's leading or action: an IconButton with a labelText. */
  barButton(raw, where, depth) {
    if (absent(raw)) return null;
    const j = isObj(raw) ? normalizeNode(raw, () => {}) : null;
    if (j === null || opt(j, "type") !== "button" || opt(j, "variant") !== "icon") { this.log(`screen: appBar ${where} must be an IconButton, dropped`); return null; }
    if (this.text(j, "label") === "") { this.log(`screen: appBar ${where} needs a labelText (what a screen reader says), dropped`); return null; }
    return this.node(raw, depth + 1);
  }

  /** PluginScreenOutput.navItems (Task 17 item G): a NavigationBar's items. */
  navItems(raw) {
    if (!Array.isArray(raw)) return [];
    const G = S.scaffold;
    let n = raw.length;
    if (n > G.maxNavItems) { n = G.maxNavItems; this.log(`screen: navigationBar keeps ${G.maxNavItems} items, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = isObj(raw[i]) ? normalizeNode(raw[i], () => {}) : null;
      const key = e !== null && typeof e.key === "string" && ID.test(e.key) ? e.key : null;
      const icon = e !== null && typeof e.icon === "string" && ICONS.includes(e.icon) ? e.icon : null;
      const label = e !== null ? this.text(e, "label") : "";
      if (e === null || key === null || icon === null || label === "") { this.log(`screen: navigationBar item ${i} needs a key, an icon and a label, dropped`); continue; }
      if (out.some((x) => x.key === key)) { this.log(`screen: navigationBar item ${i} repeats key "${key}", dropped`); continue; }
      const badge = present(e, "badge") ? badgeOf(e.badge, this.lang, `screen: navigationBar item ${i}`, this.log) : null;
      out.push({ key, icon, label, badge });
    }
    return out;
  }

  nodeIn(written, depth) {
    if (depth > this.maxDepth) {
      if (!this.depthLogged) { this.depthLogged = true; this.log(`screen: deeper than ${this.maxDepth} levels, dropped`); }
      return null;
    }
    if (this.budget <= 0) {
      if (!this.nodesLogged) { this.nodesLogged = true; this.log(`screen: more than ${this.maxNodes} nodes, the rest dropped`); }
      return null;
    }
    // The Flutter-style names (Task 8e) read as the older ones: everything below sees only those.
    const o = normalizeNode(written, this.log);
    const type = typeof opt(o, "type") === "string" ? o.type : "";
    if (TABLE_PARTS.includes(type)) { this.log(`screen: ${type} outside a table, dropped`); return null; }
    if (!WIDGETS.includes(type)) { this.log(`screen: unknown widget "${type.slice(0, 40)}", dropped`); return null; }
    if (!this.widgets.has(type)) { this.log(`screen: widget "${type}" is not drawn by this Kino, dropped`); return null; }
    // Task 15: an anchored pop-up is drawn in the panel after all (a popover inside the drawer).
    const anchoredHere = (PANEL_SCREEN.drawnWhenAnchored ?? []).includes(type) && typeof opt(o, "anchor") === "string" && ID.test(o.anchor);
    if (this.inPanel && PANEL_SCREEN.notDrawn.includes(type) && !anchoredHere) { this.log(`screen: ${type} is not available in the player panel, dropped`); return null; }
    const drop = (why) => { this.log(`screen: ${type} ${why}, dropped`); return null; };
    if (type === FORM && this.formKey !== null) return drop("inside a form (forms do not nest)");
    if (type === FORM && this.answerBody > 0) return drop("in an answer's pop-up");
    // Its open items live in `state.ui.open`, which an answer's pop-up does not hold.
    if (type === ACCORDION && this.answerBody > 0) return drop("in an answer's pop-up");
    // A cell is a slot of a table's grid: nothing in it scrolls, and tables do not nest.
    if (this.inCell > 0 && NOT_IN_TABLE_CELL.includes(type)) return drop("inside a table cell");
    // A placeholder to look at: nothing in an image's fallback takes focus or holds a value.
    if (this.inFallback > 0 && !FALLBACK_WIDGETS.includes(type)) return drop("inside an image's fallback");

    const rawKey = opt(o, "key");
    const given = typeof rawKey === "string" && ID.test(rawKey) && !rawKey.startsWith(AUTO) ? rawKey : null;
    // An input's value, a pop-up's opening and an accordion's open items are addressed by key: all need the plugin's own.
    if (INPUTS.includes(type) || type === POPUP || type === ACCORDION) {
      if (given === null) return drop("needs a valid key");
      if (this.keys.has(given)) return drop(`duplicate key "${given}"`);
    }
    const devices = this.filterOf(o, type, "devices", DEVICES);
    if (devices === REFUSED) return null;
    const sizes = this.filterOf(o, type, "sizes", SIZE_CLASSES);
    if (sizes === REFUSED) return null;

    // The node's own fields, once, or once per width class when it has per-size maps; a problem the passes share is
    // logged once. Children are read only after the node is counted.
    // A scroll across in any size class (read here, from the node itself: a pass sees one class's value). Its children
    // are read once for all classes.
    if (type === "scroll") { const d = opt(o, "direction"); this.scrollCrosses = d === "horizontal" || (isObj(d) && Object.values(d).includes("horizontal")); }
    // A wrapping row's children (it wraps in any size class): read now, the children come later.
    if (type === "row") this.rowWraps = wrapsAnywhere(opt(o, "wrap"));
    // A table whose cells or columns hold per-size values is read once per class, like any node with a map.
    const maps = this.sizeMaps(o, type) ?? (type === TABLE && tableHasMaps(o) ? new Map() : null);
    const outer = this.log;
    const seen = new Set();
    this.log = (line) => { if (!seen.has(line)) { seen.add(line); outer(line); } };
    let passes;
    try {
      passes = maps === null
        ? [[null, this.own(o, type, depth, drop)]]
        : SIZE_CLASSES.map((cls) => [cls, this.inPass(cls, () => this.own(this.forClass(o, maps, cls), type, depth, drop))]);
    } finally {
      this.log = outer;
    }
    if (passes.some((p) => p[1] === null)) return null;

    // Accepted: count it, give it its key, then read its children (pre-order, so `auto-<n>` is stable).
    const index = this.accepted++;
    this.budget--;
    let key;
    if (given !== null && !this.keys.has(given)) {
      this.keys.add(given);
      key = given;
    } else {
      if (rawKey !== undefined && rawKey !== null) {
        this.log(given !== null ? `screen: ${type} key "${given}" is used twice, a generated key used` : `screen: ${type} key is not a valid key, a generated key used`);
      }
      key = `${AUTO}${index}`;
      this.keys.add(key);
    }
    const enabled = opt(o, "enabled") !== false;
    const t = opt(o, "testKey");
    const testKey = typeof t === "string" && t !== "" && t.length <= LIMITS.maxTestKeyChars ? t : null;
    if (testKey === null && present(o, "testKey")) this.log(`screen: ${type} testKey is not a string of 1 to ${LIMITS.maxTestKeyChars} characters, dropped`);
    // Task 17: Flutter's `visible: false` hides it as `hidden: true` does.
    let visible = true;
    if (present(o, "visible")) {
      if (typeof o.visible === "boolean") visible = o.visible;
      else this.log(`screen: ${type} visible ${fmt(o.visible)} is not true or false, ignored`);
    }
    const hidden = opt(o, "hidden") === true || !visible;
    // Task 15: the properties a family of nodes shares (never per size: a map there was dropped above, logged).
    const shared = this.sharedProps(o, type, passes[0][1], maps);
    // Task 17: at most maxAnimated animating nodes a screen; the rest drop their animate.
    let still = false;
    if (passes.some((p) => p[1].style.animate !== null)) {
      this.animated = this.animated ?? 0;
      if (this.animated < S.motion.maxAnimated) this.animated++;
      else {
        still = true;
        if (!this.animatedLogged) { this.animatedLogged = true; this.log(`screen: more than ${S.motion.maxAnimated} animating nodes, the rest drop their animate`); }
      }
    }
    const common = (p, byClass) => ({ key, enabled, hidden, style: still ? { ...p.style, animate: null } : p.style, onTap: p.onTap, onLongPress: p.onLongPress, devices, sizes, testKey, byClass, ...shared });
    const byClass = {};
    if (maps !== null) for (const [cls, p] of passes) byClass[cls] = node(type, p.build(false, key), common(p, {}));
    const base = passes[0][1];
    return node(type, base.build(true, key), common(base, byClass));
  }

  /**
   * PluginScreenOutput.sharedProps (Task 15): `autofocus` (a node that takes focus: sharedProps.focusableWidgets, or any node
   * with an onTap or an onLongPress; never a QR), `selected` and `badge` (a button, a card with an onTap), read once from the
   * node ([base] is its first pass: its actions). A value on a node that does not take it, or not of its shape, is ignored,
   * logged. A per-size map on one of them was already dropped, logged ([maps]).
   */
  sharedProps(o, type, base, maps) {
    const SH = S.sharedProps;
    const given = (name) => present(o, name) && !(maps !== null && maps.has(name));
    // Task 17: a FloatingActionButton too, and a ListTile with an onTap.
    const pressable = type === "button" || type === "fab" || ((type === "card" || type === "listTile") && base.onTap !== null);
    let autofocus = false;
    if (given("autofocus")) {
      const v = o.autofocus;
      if (typeof v !== "boolean") this.log(`screen: ${type} autofocus ${fmt(v)} is not true or false, ignored`);
      else {
        const focusable = type !== "qr" && (SH.focusableWidgets.includes(type) || base.onTap !== null || base.onLongPress !== null);
        if (v && !focusable) this.log(`screen: ${type} autofocus works only on a node that takes focus, ignored`);
        else autofocus = v;
      }
    }
    const onPressable = (name) => {
      if (pressable) return true;
      if (type === "chips" || type === "tabs") this.log(`screen: ${type} ${name} is not read: its value says which is picked, ignored`);
      else if (type === "card" || type === "listTile") this.log(`screen: ${type} ${name} needs an onTap, ignored`);
      else this.log(`screen: ${type} ${name} works only on a button or a card with onTap, ignored`);
      return false;
    };
    let selected = null;
    if (given("selected")) {
      const v = o.selected;
      if (typeof v !== "boolean") this.log(`screen: ${type} selected ${fmt(v)} is not true or false, ignored`);
      else if (onPressable("selected")) selected = v;
    }
    let badge = null;
    if (given("badge") && onPressable("badge")) badge = badgeOf(o.badge, this.lang, `screen: ${type}`, this.log);
    // Task 17: `tooltip` (and `tooltipEn`) on a node that does something: Kino's hint, never essential information.
    let tooltip = null;
    const TT = S.tooltip;
    if (given(TT.field)) {
      const raw = o[TT.field];
      const text = kotlinTrim(localized(o, TT.field, this.lang));
      const actionable = type !== "qr" && (SH.focusableWidgets.includes(type) || base.onTap !== null || base.onLongPress !== null);
      if (typeof raw !== "string") this.log(`screen: ${type} tooltip ${fmt(raw)} is not a text, ignored`);
      else if (text === "") { /* none */ }
      else if (!actionable) this.log(`screen: ${type} tooltip works only on a node that does something (a press or a field), ignored`);
      else if (text.length > TT.maxChars) { this.log(`screen: ${type} tooltip is over ${TT.maxChars} characters, cut`); tooltip = text.slice(0, TT.maxChars); }
      else tooltip = text;
    }
    // Task 18 (G7): loading on a pressable: Kino's busy look, no press (kept on the node only when true).
    let loading = false;
    if (given(S.pressBudget.loadingField)) {
      const v = o[S.pressBudget.loadingField];
      if (typeof v !== "boolean") this.log(`screen: ${type} loading ${fmt(v)} is not true or false, ignored`);
      else if (onPressable(S.pressBudget.loadingField)) loading = v;
    }
    // Task 18 (G10): enabledAt on a pressable: off until that time (kept on the node only when given).
    let enabledAt = null;
    if (given(S.enabledAt.field)) {
      const v = o[S.enabledAt.field];
      if (!(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= S.textTime.maxMs)) this.log(`screen: ${type} enabledAt ${fmt(v)} is not a time in ms since 1970, ignored`);
      else if (onPressable(S.enabledAt.field)) enabledAt = v;
    }
    // Task 22: canRequestFocus on any node: a TV read stop (kept on the node only when true).
    let canRequestFocus = false;
    if (given(S.canRequestFocus.field)) {
      const v = o[S.canRequestFocus.field];
      if (typeof v !== "boolean") this.log(`screen: ${type} canRequestFocus ${fmt(v)} is not true or false, ignored`);
      else canRequestFocus = v;
    }
    return { autofocus, selected, badge, tooltip, ...(loading ? { loading } : {}), ...(enabledAt !== null ? { enabledAt } : {}), ...(canRequestFocus ? { canRequestFocus } : {}) };
  }

  /** What one pass over a node's own fields read: the style, the actions and the widget's builder. */
  own(o, type, depth, drop) {
    let style = this.style(o, type, depth);
    // A text is drawn on Kino's surfaces: `onPrimary` (the text on a red fill) does not read there, the default is used.
    if (type === "text" && style.color === "onPrimary") {
      this.log('screen: text color "onPrimary" does not read on a surface, the default used');
      style = { ...style, color: null };
    }
    // Only a wrapping row's own children are placed by span and offset: anywhere else they would do nothing unseen.
    if ((style.span !== null || style.offset !== null) && depth !== this.wrapChildDepth) {
      this.log(`screen: ${type} span and offset work only in a row with wrap, ignored`);
      style = { ...style, span: null, offset: null };
    }
    // An image's fallback is never pressed: the image (or what holds it) takes the press.
    // Task 17: nor is a ListTile's leading or trailing: the tile takes the press.
    if (!(this.inFallback > 0) && this.inSlot > 0 && (present(o, "onTap") || present(o, "onLongPress"))) {
      this.log(`screen: ${type} actions inside a ListTile's leading or trailing, ignored (the tile takes the press)`);
      const plain = this.widget(o, type, depth, drop);
      return plain === null ? null : { style, onTap: null, onLongPress: null, build: plain };
    }
    if (this.inFallback > 0 && (present(o, "onTap") || present(o, "onLongPress"))) {
      this.log(`screen: ${type} actions inside an image's fallback, ignored`);
      const plain = this.widget(o, type, depth, drop);
      return plain === null ? null : { style, onTap: null, onLongPress: null, build: plain };
    }
    const onTap = this.actions(opt(o, "onTap"), o, type, "onTap");
    const onLongPress = this.actions(opt(o, "onLongPress"), o, type, "onLongPress");
    const build = this.widget(o, type, depth, drop);
    if (build === null) return null;
    return { style, onTap, onLongPress, build };
  }

  /** `devices` / `sizes`: absent (null, everywhere) or a non-empty array of [names]; anything else drops the node (logged). */
  filterOf(o, type, field, names) {
    const raw = opt(o, field);
    if (absent(raw)) return null;
    if (!Array.isArray(raw) || raw.length === 0) { this.log(`screen: ${type} ${field} is not a list of ${names.join(", ")}, dropped`); return REFUSED; }
    const out = [];
    for (const v of raw) {
      if (typeof v !== "string" || !names.includes(v)) { this.log(`screen: ${type} ${field} names an unknown ${field.slice(0, -1)} ${fmt(v)}, dropped`); return REFUSED; }
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  /**
   * The node's properties given as per-size maps (an object whose keys are all size classes), or null when it has none.
   * A map on a property that takes none, or one mixing size classes with other keys, is logged and the property left
   * out (forClass).
   */
  sizeMaps(o, type) {
    const allowed = responsive(type);
    let out = null;
    for (const k of Object.keys(o).sort()) {
      const v = o[k];
      if (!isObj(v)) continue;
      const names = Object.keys(v);
      const classes = names.filter((n) => SIZE_CLASSES.includes(n)).length;
      if (classes === 0) continue;
      const pure = classes === names.length;
      let map;
      if (allowed.has(k) && pure) map = v;
      else if (allowed.has(k)) { this.log(`screen: ${type} ${k} mixes size classes with other keys, dropped`); map = null; }
      else if (pure) { this.log(`screen: ${type} ${k} does not take per-size values, dropped`); map = null; }
      else continue;
      (out ||= new Map()).set(k, map);
    }
    return out;
  }

  /** [o] with each of [maps] replaced by its value for [cls] (or the next smaller class present; else left out). */
  forClass(o, maps, cls) {
    const copy = {};
    for (const k of Object.keys(o)) if (!maps.has(k)) copy[k] = o[k];
    const upTo = SIZE_CLASSES.indexOf(cls);
    for (const [k, m] of maps) {
      if (m === null) continue;
      let found;
      for (let i = upTo; i >= 0 && found === undefined; i--) {
        const c = SIZE_CLASSES[i];
        if (has(m, c) && m[c] !== null) found = m[c];
      }
      if (found !== undefined) copy[k] = found;
    }
    return copy;
  }

  /** [who]: the name its log lines give the owner (else its `type`). */
  children(o, depth, field = "children", cap = Infinity, who = null) {
    const raw = opt(o, field);
    if (absent(raw)) return [];
    if (!Array.isArray(raw)) { this.log(`screen: ${who ?? fmtType(opt(o, "type"))} ${field} is not an array, dropped`); return []; }
    let n = raw.length;
    if (n > cap) { n = cap; this.log(`screen: a list keeps ${cap} items, the rest dropped`); }
    const out = [];
    const outer = this.childOf ?? null;
    // A node's own children (an accordion item's or a cell's are not a Row's or a Column's).
    this.childOf = who === null && typeof opt(o, "type") === "string" ? o.type : null;
    try {
      for (let i = 0; i < n; i++) {
        if (!isObj(raw[i])) { this.log("screen: a child is not an object, dropped"); continue; }
        const c = this.node(raw[i], depth + 1);
        if (c !== null) out.push(c);
      }
    } finally {
      this.childOf = outer;
    }
    return out;
  }

  /** The widget's own fields, read before the node is counted; null (logged by [drop]) when they make it invalid. */
  widget(o, type, depth, drop) {
    const t = (name) => this.text(o, name);
    const fail = (why) => { drop(why); return null; };
    const kids = (read) => (read ? this.children(o, depth) : []);
    const label = t("label");
    const hint = t("hint");
    switch (type) {
      case "col": case "box": return (k) => ({ children: kids(k) });
      case "row": {
        const stack = opt(o, "stackOnNarrow") === true;
        // The twelve-column layout: each child placed by its own span and offset (stackOnNarrow then unused).
        const wrap = opt(o, "wrap") === true;
        const wrapsSomewhere = this.rowWraps;
        return (k) => ({ children: this.wrapChildren(wrapsSomewhere, depth + 1, () => kids(k)), stackOnNarrow: stack && !wrap, wrap });
      }
      case "card": {
        const variant = this.enumOf(o, type, "variant", CARD_VARIANTS, "plain");
        const flush = this.flag(o, type, "flush");
        return (k) => ({ children: kids(k), variant, flush });
      }
      case "spacer": case "divider": return () => ({});
      case "scroll": {
        const horizontal = this.enumOf(o, type, "direction", DIRECTIONS, "vertical") === "horizontal";
        const mayCross = this.scrollCrosses;
        return (k) => ({ children: this.flatWhile(mayCross, () => kids(k)), horizontal });
      }
      case "grid": { const columns = this.int(o, type, "columns", 1, LIMITS.maxGridColumns, 2); return (k) => ({ children: kids(k), columns }); }
      case "text": {
        // Task 15: a time Kino writes itself; with one, the text is only its prefix (it may be empty).
        const TT = S.textTime;
        let time = null;
        if (present(o, TT.field)) {
          const v = o[TT.field];
          if (typeof v === "number" && Number.isFinite(v) && v === Math.floor(v) && v >= 0 && v <= TT.maxMs) time = v;
          else this.log(`screen: text time ${fmt(v)} is not a time in ms since 1970, dropped`);
        }
        const text = t("text");
        if (text === "" && time === null) return fail("is empty");
        const styleName = this.enumOf(o, type, "style", [...TEXT_STYLES, ...Object.keys(TEXT_STYLE_ALIASES)], "p", TEXT_STYLES);
        const variant = TEXT_STYLE_ALIASES[styleName] ?? styleName;
        const maxLines = has(o, "maxLines") ? this.intOrNull(o, type, "maxLines", 1, INT_MAX) : null;
        let bold = false;
        if (present(o, "bold")) {
          if (typeof o.bold === "boolean") bold = o.bold;
          else this.log(`screen: text bold ${fmt(o.bold)} is not true or false, ignored`);
        }
        const timeFormat = this.enumOf(o, type, TT.formatField, TT.formats, TT.formats[0]);
        if (time === null && present(o, TT.formatField)) this.log("screen: text timeFormat without a time, ignored");
        return () => ({ text, variant, maxLines, bold, time, timeFormat });
      }
      case "image": {
        // With a fallback (Task 7i-1) an image with no url Kino may load is kept: it draws the fallback.
        const fallbackJson = opt(o, "fallback");
        const hasFallback = isObj(fallbackJson);
        if (!absent(fallbackJson) && !hasFallback) this.log("screen: image fallback is not a node, dropped");
        let url = httpsImage(o, []);
        if (!url) {
          if (!hasFallback) return fail("url is not https on a public host");
          if (present(o, "url")) this.log("screen: image url is not https on a public host, its fallback drawn");
          url = "";
        }
        let aspect = null;
        if (present(o, "aspect")) {
          if (ASPECTS.includes(o.aspect)) aspect = o.aspect;
          else this.log(`screen: image aspect ${fmt(o.aspect)} is not 16:9, 2:3, 1:1 or banner, dropped`);
        }
        const alt = t("alt");
        return (k) => {
          let fallback = null;
          if (k && hasFallback) {
            this.inFallback++;
            try { fallback = this.node(fallbackJson, depth + 1); } finally { this.inFallback--; }
          }
          return { url, aspect, alt, fallback };
        };
      }
      case "icon": {
        const name = opt(o, "name");
        if (typeof name !== "string" || !ICONS.includes(name)) return fail(`name ${fmt(name)} is not a Kino icon`);
        return () => ({ name });
      }
      case "badge": {
        const text = t("text");
        if (text === "") return fail("is empty");
        return () => ({ text });
      }
      case "progress": {
        let value = null;
        const v = opt(o, "value");
        if (!absent(v)) {
          if (typeof v === "number" && Number.isFinite(v)) {
            value = Math.min(1, Math.max(0, v));
            if (value !== v) this.log(`screen: progress value ${fmt(v)} clamped to 0..1`);
          } else this.log("screen: progress value is not a number, indeterminate");
        }
        return () => ({ value, label });
      }
      case "loading": { const text = t("text"); return () => ({ text }); }
      case "list": {
        const columns = this.int(o, type, "columns", 1, LIMITS.maxGridColumns, 1);
        const paging = this.paging(o, type);
        // Task 14: the list opens at its end and follows new items while the person is there.
        const stickToBottom = this.flag(o, type, "stickToBottom");
        // Task 15: Kino's «↓ Nuevos» chip while new items wait below.
        const newItemsHint = this.flag(o, type, S.listHints.field);
        return (k) => {
          const items = k ? this.flatWhile(false, () => this.counted("inRepeat", () => this.children(o, depth, "items", LIMITS.maxListItems))) : [];
          let empty = null;
          if (k) {
            const e = opt(o, "empty");
            if (absent(e)) empty = null;
            else if (isObj(e)) empty = this.flatWhile(false, () => this.node(e, depth + 1));
            else this.log("screen: list empty is not a node, dropped");
          }
          return { items, empty, columns, paging, stickToBottom, newItemsHint };
        };
      }
      case "button": {
        const variant = this.enumOf(o, type, "variant", BUTTON_VARIANTS, "primary");
        const icon = this.iconOf(o, type);
        if (variant === "icon" && icon === null) return fail("variant icon needs an icon");
        if (variant !== "icon" && label === "") return fail("needs a label");
        const confirm = t("confirm") || null;
        // `submit: true` submits the form around it: Kino checks the form, then runs the form's onSubmit.
        const form = opt(o, "submit") === true ? this.formKey : null;
        if (opt(o, "submit") === true && form === null) this.log("screen: button submit outside a form, ignored");
        if (form !== null && present(o, "onTap")) this.log("screen: button submit runs its form's onSubmit, its onTap ignored");
        const submitTap = form === null ? null : { ui: [], event: null, go: null, submit: form };
        return () => ({ label, variant, icon, confirm, submitsForm: form, submitTap });
      }
      case "textInput": case "textArea": {
        const k = opt(o, "kind");
        let kind = "text";
        if (!absent(k)) {
          if (typeof k !== "string" || !S.inputKinds.includes(k)) return fail(`kind ${fmt(k)} is not ${S.inputKinds.join(", ")}`);
          kind = k;
        }
        // Screen asks: `secret` (Flutter's `obscureText`) masks the text and keeps it out of the state; anything but true or
        // false drops the field, and a multi-line field is never secret.
        const sec = opt(o, S.secretField);
        if (!absent(sec) && typeof sec !== "boolean") return fail(`${S.secretField} is not true or false`);
        const secret = sec === true;
        if (secret && type === "textArea") return fail(`${S.secretField} needs a one-line field`);
        const maxLength = this.int(o, type, "maxLength", 1, LIMITS.maxTextChars, LIMITS.maxTextChars);
        if (secret && present(o, "value")) this.log(`screen: ${type} ${S.secretField} never shows a value from the tree, its value ignored`);
        const value = secret ? "" : (typeof opt(o, "value") === "string" ? o.value : "").slice(0, maxLength);
        if (secret && present(o, "onChange")) this.log(`screen: ${type} ${S.secretField} sends no onChange, ignored`);
        const onChange = secret ? null : this.actions(opt(o, "onChange"), o, type, "onChange");
        const onSubmit = this.actions(opt(o, "onSubmit"), o, type, "onSubmit");
        const field = this.fieldProps(o, type, maxLength, secret);
        const trailing = this.trailingOf(o, type);
        return () => ({ label, hint, kind, maxLength, value, onChange, onSubmit, field, ...(type === "textInput" ? { trailing, secret } : {}) });
      }
      case "dropdown": case "radioGroup": {
        const options = this.options(opt(o, "options"), type, "option");
        if (options.length === 0) return fail(`needs 1 to ${LIMITS.maxListItems} valid options`);
        const value = this.chosen(o, type, options);
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        const field = this.fieldProps(o, type, null);
        return () => ({ label, hint, options, value, onChange, field });
      }
      case "chips": {
        const options = this.options(opt(o, "options"), type, "option");
        if (options.length === 0) return fail(`needs 1 to ${LIMITS.maxListItems} valid options`);
        const multiple = opt(o, "multiple") === true;
        const v = opt(o, "value");
        const wanted = typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
        const values = new Set(options.map((x) => x.value));
        const kept = [];
        for (const w of wanted) {
          if (values.has(w)) { if (!kept.includes(w)) kept.push(w); } else this.log(`screen: chips value ${fmt(w)} names no option, dropped`);
        }
        const value = multiple ? kept : kept.slice(0, 1);
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        const field = this.fieldProps(o, type, null);
        return () => ({ label, hint, options, multiple, value, onChange, field });
      }
      case "toggle": case "checkbox": {
        const value = opt(o, "value") === true;
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        const field = this.fieldProps(o, type, null);
        return () => ({ label, hint, value, onChange, field });
      }
      case "slider": {
        const min = this.num(o, type, "min") ?? 0;
        const max = this.num(o, type, "max") ?? 100;
        if (min >= max) return fail("needs min below max");
        let step = this.num(o, type, "step");
        if (step !== null && !(step > 0 && step <= max - min)) {
          this.log(`screen: slider step ${javaDouble(step)} is outside 0..${javaDouble(max - min)}, dropped`);
          step = null;
        }
        const value = Math.min(max, Math.max(min, this.num(o, type, "value") ?? min));
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        const field = this.fieldProps(o, type, null);
        return () => ({ label, hint, min, max, step, value, onChange, field });
      }
      case "tabs": {
        const tabs = this.options(opt(o, "tabs"), type, "tab");
        if (tabs.length === 0) return fail(`needs 1 to ${LIMITS.maxListItems} valid tabs`);
        const value = this.chosen(o, type, tabs) ?? tabs[0].value;
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        return () => ({ tabs, value, onChange });
      }
      case "emptyState": case "errorState": {
        const title = t("title");
        if (title === "") return fail("needs a title");
        const text = t("text");
        const icon = this.iconOf(o, type);
        return () => ({ title, text, icon });
      }
      case "titleCard": {
        const raw = opt(o, "item");
        if (!isObj(raw)) return fail("needs an item");
        const item = this.items(raw, 1, type)[0];
        if (item === undefined) return fail("needs a valid item");
        const size = this.cardSize(o, type);
        // No tap of its own (or an invalid one, logged): the title's page, inside this plugin.
        return () => ({ item, size, defaultTap: { ui: [], event: null, go: { title: { ref: item.ref, kind: item.kind, id: item.id } } } });
      }
      case "titleRail": case "titleGrid": {
        let title = "";
        if (type === "titleRail") {
          title = t("title");
          if (title === "") return fail("needs a title");
        }
        const raw = opt(o, "items");
        // Drawn all at once (not lazily): a grid in a scroll, list or pop-up, a rail in a scroll across. A cap of its own.
        const flatHere = type === "titleGrid" ? this.flat > 0 : this.across > 0;
        const items = Array.isArray(raw) ? this.items(raw, LIMITS.maxListItems, type, flatHere) : [];
        if (items.length === 0) return fail(`needs 1 to ${LIMITS.maxListItems} valid items`);
        // Drawn all at once here, a rail or grid keeps its flat cap: load more stops there too.
        const paging = this.paging(o, type, flatHere ? LIMITS.maxFlatTitles : LIMITS.maxListItems);
        if (type === "titleGrid") {
          const columns = this.int(o, type, "columns", 1, LIMITS.maxGridColumns, TITLE_GRID_COLUMNS);
          return () => ({ items, columns, paging });
        }
        let more = null;
        const r = opt(o, "ref");
        if (!absent(r)) {
          if (typeof r === "string" && r !== "" && r.length <= LIMITS.maxRefChars) more = r;
          else this.log(`screen: titleRail ref must be 1 to ${LIMITS.maxRefChars} characters, dropped`);
        }
        const size = this.cardSize(o, type);
        return () => ({ title, items, more, size, paging });
      }
      case "banner": {
        const text = t("text");
        if (text === "") return fail("needs a text");
        const role = this.enumOf(o, type, "role", S.roles, "info");
        const title = t("title");
        let action = null;
        const a = opt(o, "action");
        if (!absent(a)) {
          if (isObj(a)) {
            const l = this.text(a, "label");
            const tap = l === "" ? null : this.actions(opt(a, "onTap"), a, "banner action", "onTap");
            if (l === "" || tap === null) this.log("screen: banner action needs a label and an onTap, dropped");
            else action = { label: l, onTap: tap };
          } else this.log("screen: banner action is not an object, dropped");
        }
        const wantsDismiss = opt(o, "dismissible") === true;
        return (k, key) => {
          // Dismissing hides the banner by its key in `state.ui`: a generated key may name another node next time.
          const dismissible = wantsDismiss && !key.startsWith(AUTO);
          if (k && wantsDismiss && !dismissible) this.log("screen: banner dismissible needs a key of its own, ignored");
          return { role, title, text, action, dismissible };
        };
      }
      case "heroCard": {
        const title = t("title");
        if (title === "") return fail("needs a title");
        const text = t("text");
        let image = null;
        const i = opt(o, "image");
        if (!absent(i)) {
          image = httpsImage({ url: typeof i === "string" ? i : "" }, []) || null;
          if (image === null) this.log("screen: heroCard image is not https on a public host, dropped");
        }
        return (k) => ({ title, text, image, buttons: k ? this.heroButtons(o, depth) : [] });
      }
      case POPUP: {
        const kind = opt(o, "kind");
        if (typeof kind !== "string" || !S.popupKinds.includes(kind)) return fail(`kind ${fmt(kind)} is not ${S.popupKinds.join(", ")}`);
        const title = t("title");
        const onClose = this.popupOnClose(o);
        // Task 15: the node it is drawn next to (a popover); a key Kino cannot read is ignored, logged.
        let anchor = null;
        const a = opt(o, S.declaredPopups.anchor.field);
        if (!absent(a)) {
          if (typeof a === "string" && ID.test(a)) anchor = a;
          else this.log(`screen: popup anchor ${fmt(a)} is not a valid key, ignored`);
        }
        // A field another kind takes is ignored, logged.
        const foreign = kind === "dialog" ? ["items"] : kind === "sheet" ? ["buttons", "items"] : ["buttons", "children"];
        for (const f of foreign) if (present(o, f)) this.log(`screen: popup ${kind} does not take ${f}, ignored`);
        if (kind === "menu") {
          const items = this.menuItems(opt(o, "items"), POPUP);
          if (items.length === 0) return fail(`needs 1 to ${LIMITS.maxMenuItems} valid items`);
          return () => ({ kind, title, children: [], buttons: [], items, onClose, anchor });
        }
        // As an answer's: a dialog or sheet with neither a title nor a body is dropped.
        const children = opt(o, "children");
        if (title === "" && !(Array.isArray(children) && children.length > 0)) return fail("has neither a title nor a body");
        const buttons = kind === "dialog" ? this.buttons(opt(o, "buttons")) : [];
        // A pop-up's body is drawn over the canvas, outside any form around the pop-up.
        return (k) => ({ kind, title, children: k ? this.flatWhile(false, () => this.inForm(null, () => this.counted("inPopupBody", () => this.children(o, depth)))) : [], buttons, items: [], onClose, anchor });
      }
      case FORM: {
        const onSubmit = this.actions(opt(o, "onSubmit"), o, type, "onSubmit");
        if (onSubmit === null) return fail("needs an onSubmit");
        return (k, key) => ({ children: k ? this.inForm(key, () => kids(true)) : [], onSubmit });
      }
      case ACCORDION: {
        const items = this.accordionItems(opt(o, "items"));
        if (items.length === 0) return fail(`needs 1 to ${LIMITS.maxListItems} valid items`);
        const multiple = opt(o, "multiple") === true;
        // One open at a time unless `multiple`: the first open one is kept.
        const firstOpen = items.findIndex((it) => it.open);
        if (!multiple && items.filter((it) => it.open).length > 1) this.log("screen: accordion opens one item at a time, only the first open one kept");
        return (k) => {
          // Each item's header is drawn: it costs one node of the tree's budget, like a list's item.
          const kept = [];
          for (const [i, it] of items.entries()) {
            if (k && !this.spend()) break;
            kept.push({
              key: it.key, title: it.title,
              children: k ? this.children(it.json, depth, "children", Infinity, `accordion item ${it.index}`) : [],
              open: it.open && (multiple || i === firstOpen),
            });
          }
          return { items: kept, multiple };
        };
      }
      case STEPS: {
        const items = this.stepItems(opt(o, "items"));
        if (items.length === 0) return fail(`needs 1 to ${S.screenAsks.steps.maxSteps} valid items`);
        let onStepTap = this.eventRef(o, type, S.screenAsks.steps.onStepTapField);
        if (onStepTap !== null && onStepTap.arg !== null) { this.log("screen: steps onStepTap arg is the step's key, its own arg ignored"); onStepTap = { ...onStepTap, arg: null }; }
        return (k) => {
          // Each step's header is drawn: one node of the tree's budget, like an accordion item's.
          const kept = [];
          for (const it of items) {
            if (k && !this.spend()) break;
            const children = k && it.state === "current" ? this.children(it.json, depth, "children", Infinity, `steps item ${it.index}`) : [];
            kept.push({ key: it.key, title: it.title, summary: it.summary, state: it.state, children });
          }
          return { items: kept, onStepTap };
        };
      }
      case "skeleton": {
        const shape = this.enumOf(o, type, "shape", S.skeletonShapes, "line");
        const lines = this.int(o, type, "lines", 1, LIMITS.maxSkeletonLines, 1);
        return () => ({ shape, lines });
      }
      case "qr": {
        // The value is drawn as written: never trimmed, no English twin.
        const value = opt(o, "value");
        if (typeof value !== "string" || value === "" || value.length > LIMITS.maxQrChars) return fail(`value must be 1 to ${LIMITS.maxQrChars} characters`);
        const size = this.cardSize(o, type);
        if (present(o, "onTap") || present(o, "onLongPress")) this.log("screen: qr is never tappable, its onTap and onLongPress ignored");
        // Screen asks: a countdown to the code's end, Kino's own between the plugin's calls (PluginScreenOutput's qr).
        const Q = S.screenAsks.qr;
        let expiresInMs = present(o, "expiresInMs") ? this.intOrNull(o, type, "expiresInMs", Q.minExpiryMs, Q.maxExpiryMs) : null;
        let expiresAt = null;
        if (present(o, "expiresAt")) {
          const v = o.expiresAt;
          if (typeof v === "number" && Number.isFinite(v) && v === Math.floor(v) && v >= 0 && v <= S.textTime.maxMs) expiresAt = v;
          else this.log(`screen: qr expiresAt ${fmt(v)} is not a time in ms since 1970, dropped`);
        }
        if (expiresInMs !== null && expiresAt !== null) { this.log("screen: qr takes expiresInMs or expiresAt, expiresAt ignored"); expiresAt = null; }
        const timed = expiresInMs !== null || expiresAt !== null;
        let onExpire = this.eventRef(o, type, Q.onExpireField);
        if (onExpire !== null && !timed) { this.log("screen: qr onExpire without an expiry, ignored"); onExpire = null; }
        let renewBeforeMs = present(o, "renewBeforeMs") ? this.intOrNull(o, type, "renewBeforeMs", Q.minExpiryMs, Q.maxExpiryMs) : null;
        if (renewBeforeMs !== null) {
          if (!timed) { this.log("screen: qr renewBeforeMs without an expiry, ignored"); renewBeforeMs = null; }
          else if (onExpire === null) { this.log("screen: qr renewBeforeMs without onExpire, ignored"); renewBeforeMs = null; }
          else if (expiresInMs !== null && renewBeforeMs >= expiresInMs) {
            this.log(`screen: qr renewBeforeMs ${renewBeforeMs} is not below its expiresInMs, half its lifetime used`);
            renewBeforeMs = Math.floor(expiresInMs / 2);
          }
        }
        return () => ({ value, label, size, withheld: false, noTap: true, expiresInMs, expiresAt, onExpire, renewBeforeMs });
      }
      case STEPPER: {
        // Every number at most maxStepperAbs either way: no press can overflow.
        const limit = LIMITS.maxStepperAbs;
        const bounded = (name) => {
          const d = this.num(o, type, name);
          if (d === null || Math.abs(d) <= limit) return d;
          this.log(`screen: stepper ${name} is outside -${limit}..${limit}, clamped`);
          return stepperBounded(d);
        };
        const min = bounded("min");
        const max = bounded("max");
        if (min !== null && max !== null && min >= max) return fail("needs min below max");
        const decimals = this.int(o, type, "decimals", 0, LIMITS.maxStepperDecimals, 0);
        const unit = stepperRound(10 ** -decimals, decimals);
        let step = bounded("step");
        if (step !== null && !(step > 0)) { this.log(`screen: stepper step ${fmt(o.step)} is not above 0, 1 used`); step = null; }
        step = stepperRound(step ?? 1, decimals);
        if (step < unit) {
          this.log(`screen: stepper step ${fmt(o.step)} is finer than its decimals allow, the smallest step used`);
          step = unit;
        }
        const value = stepperNormalize(bounded("value") ?? min ?? 0, min, max, decimals);
        // Typed entry is Kino's digits-only pad: it can only make a whole number of 0 or more.
        const wantsEdit = opt(o, "editable") === true;
        const editable = wantsEdit && decimals === 0 && min !== null && min >= 0;
        if (wantsEdit && !editable) this.log("screen: stepper editable needs 0 decimals and a min of 0 or more, ignored");
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        const field = this.fieldProps(o, type, null);
        return () => ({ label, hint, value, min, max, step, decimals, editable, onChange, field });
      }
      case TABLE: {
        const header = opt(o, "header") === true;
        const wrap = opt(o, "wrap") === true;
        const zebra = opt(o, "zebra") === true;
        const declared = this.tableColumns(opt(o, "columns"));
        const rows = this.tableRows(opt(o, "children"));
        if (rows.length === 0) return fail(`needs 1 to ${LIMITS.maxTableRows} valid rows`);
        // No columns of its own: as many as its widest row spans, within the cap.
        const widest = Math.max(...rows.map((r) => r.cells.reduce((s, c) => s + c.colSpan, 0)));
        const count = declared !== null ? declared.length : Math.min(LIMITS.maxTableColumns, Math.max(1, widest));
        const columns = declared ?? Array.from({ length: count }, () => ({ key: null, weight: 1 }));
        // Fitted per class when drawn (resolveResponsive); checked here so its problems are logged in this pass.
        rows.forEach((r) => this.fitRow(r, count));
        // A class's copy keeps its own spans and aligns, its cells' children are the node's (read once).
        const layout = (r) => ({ cells: r.cells.map((c) => ({ text: c.text, children: [], align: c.align, colSpan: c.colSpan })), key: null, hidden: r.hidden });
        return (k) => ({ columns, rows: k ? this.tableCells(rows, depth) : rows.map(layout), header, wrap, zebra });
      }
      case SETTINGS: {
        // Kino's own form has its own save: never a field of a plugin's form, never in an answer's pop-up.
        if (this.formKey !== null) return fail("inside a form");
        if (this.answerBody > 0) return fail("in an answer's pop-up");
        const picked = this.settingsKeys(o);
        if (picked === null) return null;
        const keys = picked.keys;
        const onSaved = this.eventRef(o, type, S.screenAsks.onSavedField);
        // Task 18 (G11): its toggles and selects save on change (kept on the node only when true).
        const autoSave = this.flag(o, type, S.settingsAutoSave.field);
        return (k) => {
          if (k) { if (keys === null) this.allSettingsShown = true; else keys.forEach((x) => this.shownSettings.add(x)); }
          return autoSave ? { keys, autoSave, onSaved } : { keys, onSaved };
        };
      }
      // ---- Task 17 (PluginScreenOutput's FAB, LIST_TILE, AVATAR, PAGE_VIEW) ----
      case "fab": {
        const F = S.flutterNodes;
        if (this.inCell > 0 || this.inFallback > 0 || this.answerBody > 0 || (this.inPopupBody ?? 0) > 0 || (this.inRepeat ?? 0) > 0 || (this.inSlot ?? 0) > 0) {
          return fail("is drawn by Kino over the screen: never inside a list, a table, a pop-up, a ListTile or an image's fallback");
        }
        if ((this.fabs ?? 0) >= F.maxFabs) return fail("is one per screen (another came first)");
        const icon = this.iconOf(o, type);
        if (icon === null) return fail("needs an icon");
        if (!present(o, "onTap")) return fail("needs an onPressed");
        const position = this.enumOf(o, type, "fabPosition", F.fabPositions, F.fabPositions[0]);
        return (k) => { if (k) this.fabs = (this.fabs ?? 0) + 1; return { icon, label, position }; };
      }
      case "listTile": {
        const title = t("title");
        if (title === "") return fail("needs a title");
        const subtitle = t("subtitle");
        const dense = this.flag(o, type, "dense");
        return (k) => ({ title, subtitle, leading: k ? this.tileSlot(o, "leading", depth) : null, trailing: k ? this.tileSlot(o, "trailing", depth) : null, dense });
      }
      case "avatar": {
        const F = S.flutterNodes;
        let image = "";
        if (present(o, "image")) {
          image = httpsImage({ url: typeof o.image === "string" ? o.image : "" }, []) || "";
          if (image === "") this.log("screen: avatar image is not https on a public host, its initials drawn");
        }
        let text = t("text");
        if (text.length > F.avatarMaxTextChars) { text = text.slice(0, F.avatarMaxTextChars); this.log(`screen: avatar text is over ${F.avatarMaxTextChars} characters, cut`); }
        const icon = this.iconOf(o, type);
        const lo = F.avatarMinRadius, hi = F.avatarMaxRadius;
        let radius = F.avatarDefaultRadius;
        if (present(o, "radius")) {
          const v = o.radius;
          if (typeof v === "number" && Number.isFinite(v)) {
            radius = Math.round(Math.min(hi, Math.max(lo, v)));
            if (v < lo || v > hi) this.log(`screen: avatar radius ${fmt(v)} is outside ${lo}..${hi}, clamped`);
          } else this.log(`screen: avatar radius ${fmt(v)} is not a number, the default used`);
        }
        let background = null;
        if (present(o, "backgroundColor")) {
          if (typeof o.backgroundColor === "string" && S.colorRoles.includes(o.backgroundColor)) background = o.backgroundColor;
          else this.log(`screen: avatar backgroundColor ${fmt(o.backgroundColor)} is not a color role${colorHint(o.backgroundColor)}, the default used`);
        }
        return () => ({ image, text, icon, radius, background, label });
      }
      case "pageView": {
        const F = S.flutterNodes;
        // A page view scrolls across: never inside something that already does (a sideways scroll, a table cell).
        if (this.across > 0) return fail("inside a sideways scroll or a table cell");
        const onPageChanged = this.actions(opt(o, "onPageChanged"), o, type, "onPageChanged");
        let autoPlayMs = null;
        if (present(o, "autoPlayMs")) {
          const v = o.autoPlayMs;
          if (!(typeof v === "number" && Number.isFinite(v))) this.log(`screen: pageView autoPlayMs ${fmt(v)} is not a number, dropped`);
          else if (v < F.autoPlayMinMs) { autoPlayMs = F.autoPlayMinMs; this.log(`screen: pageView autoPlayMs ${fmt(v)} is below ${F.autoPlayMinMs}, raised to ${F.autoPlayMinMs}`); }
          else if (v > F.autoPlayMaxMs) { autoPlayMs = F.autoPlayMaxMs; this.log(`screen: pageView autoPlayMs ${fmt(v)} is above ${F.autoPlayMaxMs}, lowered to ${F.autoPlayMaxMs}`); }
          else autoPlayMs = Math.floor(v);
        }
        let viewportFraction = 1;
        if (present(o, "viewportFraction")) {
          const v = o.viewportFraction;
          if (!(typeof v === "number" && Number.isFinite(v))) this.log(`screen: pageView viewportFraction ${fmt(v)} is not a number, 1 used`);
          else {
            viewportFraction = Math.min(1, Math.max(F.viewportFractionMin, v));
            if (viewportFraction !== v) this.log(`screen: pageView viewportFraction ${fmt(v)} is outside 0.3..1, clamped`);
          }
        }
        let padEnds = true;
        if (present(o, "padEnds")) {
          if (typeof o.padEnds === "boolean") padEnds = o.padEnds;
          else this.log(`screen: pageView padEnds ${fmt(o.padEnds)} is not true or false, ignored`);
        }
        const initial = present(o, "initialPage") ? this.intOrNull(o, type, "initialPage", 0, INT_MAX) ?? 0 : 0;
        return (k) => {
          const pages = k ? this.children(o, depth, "children", F.maxPages) : [];
          if (k && pages.length === 0) this.log("screen: pageView has no pages, nothing drawn");
          let initialPage = 0;
          if (pages.length > 0) {
            initialPage = Math.min(initial, pages.length - 1);
            if (k && initialPage !== initial) this.log(`screen: pageView initialPage ${initial} is past its last page, ${pages.length - 1} used`);
          }
          return { pages, initialPage, onPageChanged, autoPlayMs, viewportFraction, padEnds };
        };
      }
      // ---- Task 17 item G ----
      case "scaffold": {
        if (depth !== 1 || this.answerBody > 0) return fail("only as the root of a screen or a panel");
        if (!isObj(opt(o, "body"))) return fail("needs a body");
        if (has(o, "children")) this.log("screen: scaffold takes body, not children, ignored");
        return (k) => (k
          ? { appBar: this.scaffoldSlot(o, "appBar", depth), body: this.scaffoldSlot(o, "body", depth), fab: this.scaffoldSlot(o, "floatingActionButton", depth), bottomBar: this.scaffoldSlot(o, "bottomNavigationBar", depth) }
          : { appBar: null, body: null, fab: null, bottomBar: null });
      }
      case "appBar": {
        if (this.mySlot !== "appBar") return fail("only as a Scaffold's appBar");
        const title = t("title");
        const centerTitle = this.flag(o, type, "centerTitle");
        let background = null;
        if (present(o, "backgroundColor")) {
          if (typeof o.backgroundColor === "string" && S.colorRoles.includes(o.backgroundColor)) background = o.backgroundColor;
          else this.log(`screen: appBar backgroundColor ${fmt(o.backgroundColor)} is not a color role${colorHint(o.backgroundColor)}, the default used`);
        }
        return (k) => {
          if (!k) return { title, leading: null, actions: [], bottom: null, centerTitle, background, titleNode: null };
          const leading = this.barButton(opt(o, "leading"), "leading", depth);
          const actions = [];
          const raw = opt(o, "actions");
          if (!absent(raw)) {
            if (!Array.isArray(raw)) this.log("screen: appBar actions is not an array, dropped");
            else {
              const max = S.scaffold.maxAppBarActions;
              if (raw.length > max) this.log(`screen: appBar keeps ${max} actions, the rest dropped`);
              for (let i = 0; i < Math.min(raw.length, max); i++) { const b = this.barButton(raw[i], `action ${i}`, depth); if (b !== null) actions.push(b); }
            }
          }
          let bottom = null;
          const b = opt(o, "bottom");
          if (!absent(b)) {
            const bt = isObj(b) && typeof b.type === "string" ? (has(ALIASES.types, b.type) ? ALIASES.types[b.type] : b.type) : null;
            if (bt !== "tabs") this.log("screen: appBar bottom must be a TabBar, dropped");
            else bottom = this.node(b, depth + 1);
          }
          // Flutter's way: `title` is a string (a Text) or any node (a TabBar, a Row of buttons...), at most
          // maxAppBarTitleNodes nodes; a bad one is dropped, logged.
          let titleNode = null;
          const tn = opt(o, "title");
          if (isObj(tn)) {
            const n = this.node(tn, depth + 1);
            if (n !== null) {
              const size = countNodes(n);
              if (size <= S.scaffold.maxAppBarTitleNodes) titleNode = n;
              else this.log(`screen: appBar title holds ${size} nodes, more than ${S.scaffold.maxAppBarTitleNodes}, dropped`);
            }
          }
          return { title, leading, actions, bottom, centerTitle, background, titleNode };
        };
      }
      case "navigationBar": {
        const G = S.scaffold;
        if (this.mySlot !== "bottomNavigationBar") return fail("only as a Scaffold's bottomNavigationBar");
        const items = this.navItems(opt(o, "items"));
        if (items.length < G.minNavItems) return fail(`needs ${G.minNavItems} to ${G.maxNavItems} valid items`);
        let value = items[0].key;
        const v = opt(o, "value");
        if (!absent(v)) {
          if (typeof v === "string" && items.some((x) => x.key === v)) value = v;
          else this.log(`screen: navigationBar value ${fmt(v)} names no item, the first used`);
        } else if (present(o, "selectedIndex")) {
          const i = o.selectedIndex;
          if (typeof i === "number" && Number.isFinite(i) && i === Math.floor(i) && i >= 0 && i < items.length) value = items[i].key;
          else this.log(`screen: navigationBar selectedIndex ${fmt(i)} names no item, the first used`);
        }
        const onChange = this.actions(opt(o, "onChange"), o, type, "onChange");
        return () => ({ items, value, onChange });
      }
      default: return fail("is not read by this Kino");
    }
  }

  /** [read] with the counter [name] (inRepeat, inPopupBody, inSlot) raised. */
  counted(name, read) {
    this[name] = (this[name] ?? 0) + 1;
    try { return read(); } finally { this[name]--; }
  }

  /**
   * PluginScreenOutput.tileSlot (Task 17): a ListTile's `leading` or `trailing`: one node of tileSlotWidgets (else dropped,
   * logged), never pressed itself.
   */
  tileSlot(o, slot, depth) {
    const raw = opt(o, slot);
    if (absent(raw)) return null;
    if (!isObj(raw)) { this.log(`screen: listTile ${slot} is not a node, dropped`); return null; }
    const written = typeof raw.type === "string" ? raw.type : null;
    const type = written !== null && has(ALIASES.types, written) ? ALIASES.types[written] : written;
    if (!S.flutterNodes.tileSlotWidgets.includes(type)) {
      this.log(`screen: listTile ${slot} must be an Icon, a CircleAvatar, an Image, a Badge, a Text or a spinner, dropped`);
      return null;
    }
    return this.counted("inSlot", () => this.node(raw, depth + 1));
  }

  /** PluginScreenOutput.spend: one node of the budget for an accordion item's header; false (logged once) when it ran out. */
  spend() {
    if (this.budget <= 0) {
      if (!this.nodesLogged) { this.nodesLogged = true; this.log(`screen: more than ${this.maxNodes} nodes, the rest dropped`); }
      return false;
    }
    this.budget--;
    return true;
  }

  /**
   * PluginScreenOutput.accordionItems: `items` [{key, title, titleEn, children, open}], at most maxListItems, each with a
   * valid key (distinct in the accordion) and a title; the rest dropped, logged. `json` holds the children, read later.
   */
  accordionItems(raw) {
    if (!Array.isArray(raw)) return [];
    let n = raw.length;
    if (n > LIMITS.maxListItems) { n = LIMITS.maxListItems; this.log(`screen: accordion keeps ${LIMITS.maxListItems} items, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = raw[i];
      const key = isObj(e) && typeof opt(e, "key") === "string" && ID.test(e.key) ? e.key : null;
      const title = isObj(e) ? this.text(e, "title") : "";
      if (!isObj(e) || key === null || title === "") { this.log(`screen: accordion item ${i} needs a valid key and a title, dropped`); continue; }
      if (out.some((it) => it.key === key)) { this.log(`screen: accordion item ${i} repeats key "${key}", dropped`); continue; }
      out.push({ index: i, key, title, open: opt(e, "open") === true, json: e });
    }
    return out;
  }

  /**
   * PluginScreenOutput.stepItems (screen asks): `items` [{key, title, titleEn, subtitle, subtitleEn, state, children}], at most
   * maxSteps, each with a valid key (distinct) and a title; state done, current or pending (absent: pending; else pending,
   * logged); exactly one current (none while one is to do: the first not done; several: the first). Children of a step that
   * is not current are never read (logged once).
   */
  stepItems(raw) {
    const ST = S.screenAsks.steps;
    if (!Array.isArray(raw)) return [];
    let n = raw.length;
    if (n > ST.maxSteps) { n = ST.maxSteps; this.log(`screen: steps keeps ${ST.maxSteps} items, the rest dropped`); }
    let out = [];
    for (let i = 0; i < n; i++) {
      const e = raw[i];
      const key = isObj(e) && typeof opt(e, "key") === "string" && ID.test(e.key) ? e.key : null;
      const title = isObj(e) ? this.text(e, "title") : "";
      if (!isObj(e) || key === null || title === "") { this.log(`screen: steps item ${i} needs a valid key and a title, dropped`); continue; }
      if (out.some((it) => it.key === key)) { this.log(`screen: steps item ${i} repeats key "${key}", dropped`); continue; }
      let state = "pending";
      const sv = opt(e, "state");
      if (!absent(sv)) {
        if (ST.states.includes(sv)) state = sv;
        else this.log(`screen: steps item ${i} state ${fmt(sv)} is not ${ST.states.join(", ")}, read as pending`);
      }
      out.push({ index: i, key, title, summary: this.text(e, "subtitle"), state, json: e });
    }
    const current = out.filter((it) => it.state === "current").length;
    if (current > 1) {
      this.log(`screen: steps has ${current} current steps, the first kept, the others read as pending`);
      let seen = false;
      out = out.map((it) => (it.state !== "current" ? it : !seen ? ((seen = true), it) : { ...it, state: "pending" }));
    } else if (current === 0 && out.some((it) => it.state === "pending")) {
      this.log("screen: steps has no current step, the first one not done is current");
      const first = out.findIndex((it) => it.state === "pending");
      out = out.map((it, j) => (j === first ? { ...it, state: "current" } : it));
    }
    if (out.some((it) => it.state !== "current" && Array.isArray(it.json.children) && it.json.children.length > 0)) {
      this.log("screen: steps children of a step that is not current are not drawn, ignored");
    }
    return out;
  }

  // ---- table (PluginScreenOutput's table helpers) ----

  /**
   * PluginScreenOutput.tableColumns: `columns` [{key, weight}], at most maxTableColumns; a bad entry is a plain column, a bad
   * key or weight dropped (each logged). Null when absent, empty or not an array (logged): then its widest row decides.
   */
  tableColumns(raw) {
    if (absent(raw)) return null;
    if (!Array.isArray(raw)) { this.log("screen: table columns is not an array, dropped"); return null; }
    if (raw.length === 0) return null;
    let n = raw.length;
    if (n > LIMITS.maxTableColumns) { n = LIMITS.maxTableColumns; this.log(`screen: table keeps ${LIMITS.maxTableColumns} columns, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = raw[i];
      if (!isObj(e)) { this.log(`screen: table column ${i} is not an object, a plain column used`); out.push({ key: null, weight: 1 }); continue; }
      let key = null;
      const k = opt(e, "key");
      if (!absent(k)) {
        if (typeof k === "string" && ID.test(k)) key = k;
        else this.log(`screen: table column ${i} key is not a valid key, dropped`);
      }
      let weight = 1;
      const w = this.pick(opt(e, "weight"), `screen: table column ${i}`, "weight");
      if (!absent(w)) {
        if (typeof w === "number" && Number.isFinite(w) && w === Math.floor(w) && w >= 1 && w <= LIMITS.maxWeight) weight = w;
        else this.log(`screen: table column ${i} weight ${fmt(w)} is outside 1..${LIMITS.maxWeight}, 1 used`);
      }
      out.push({ key, weight });
    }
    return out;
  }

  /**
   * PluginScreenOutput.tableRows: `children`, at most maxTableRows `tr` rows of `td` cells (`text` or `children`, `align`,
   * `colSpan` 1..maxColSpan); anything else dropped, logged. A row's cells are read until they span maxTableColumns.
   */
  tableRows(raw) {
    if (!Array.isArray(raw)) {
      if (!absent(raw)) this.log("screen: table children is not an array, dropped");
      return [];
    }
    let n = raw.length;
    if (n > LIMITS.maxTableRows) { n = LIMITS.maxTableRows; this.log(`screen: table keeps ${LIMITS.maxTableRows} rows, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const tr = raw[i];
      if (!isObj(tr) || opt(tr, "type") !== "tr") { this.log(`screen: table row ${i} is not a tr, dropped`); continue; }
      const cellsRaw = opt(tr, "children");
      const cells = Array.isArray(cellsRaw) ? cellsRaw : null;
      if (cells === null && !absent(cellsRaw)) this.log(`screen: table row ${i} children is not an array, dropped`);
      const kept = [];
      let overflow = false;
      for (let j = 0; j < (cells ? cells.length : 0); j++) {
        if (kept.length >= LIMITS.maxTableColumns) { overflow = true; break; }
        const td = cells[j];
        const where = `screen: table row ${i} cell ${j}`;
        if (!isObj(td) || opt(td, "type") !== "td") { this.log(`${where} is not a td, dropped`); continue; }
        const text = this.text(td, "text");
        if (text !== "" && present(td, "children")) this.log(`${where} takes text or children, its children ignored`);
        let align = null;
        const a = this.pick(opt(td, "align"), where, "align");
        if (!absent(a)) {
          if (typeof a === "string" && CELL_ALIGNS.includes(a)) align = a;
          else this.log(`${where} align ${fmt(a)} is not start, center or end, dropped`);
        }
        let colSpan = 1;
        const s = this.pick(opt(td, "colSpan"), where, "colSpan");
        if (!absent(s)) {
          const whole = typeof s === "number" && Number.isFinite(s) && s === Math.floor(s) && s >= 1;
          if (!whole) this.log(`${where} colSpan ${fmt(s)} is outside 1..${LIMITS.maxColSpan}, 1 used`);
          else if (s > LIMITS.maxColSpan) { colSpan = LIMITS.maxColSpan; this.log(`${where} colSpan ${fmt(s)} is above ${LIMITS.maxColSpan}, ${LIMITS.maxColSpan} used`); }
          else colSpan = s;
        }
        kept.push({ index: j, text, align, colSpan, json: td });
      }
      out.push({ index: i, cells: kept, overflow, key: opt(tr, "key"), hidden: opt(tr, "hidden") === true });
    }
    return out;
  }

  /** PluginScreenOutput.fitRow: logs what fitting [row] into [count] columns changes (cut, dropped); fitted when drawn. */
  fitRow(row, count) {
    const f = fitTableRow(row.cells, count);
    for (const [i, cut] of f.cuts) this.log(`screen: table row ${row.index} cell ${row.cells[i].index} spans past the last column, cut to ${cut}`);
    if (f.dropped || row.overflow) this.log(`screen: table row ${row.index} has more cells than its ${count} columns, the rest dropped`);
  }

  /**
   * PluginScreenOutput.tableCells: the rows as read (unfitted); each row and each cell costs one node of the budget; a row's
   * key is a node key (valid, unused: else dropped, logged); a cell's children sit one level below the table, drawn all at
   * once, holding no list, scroll or table.
   */
  tableCells(rows, depth) {
    return this.flatWhile(true, () => {
      const out = [];
      for (const r of rows) {
        if (!this.spend()) break;
        let key = null;
        if (!absent(r.key)) {
          const given = typeof r.key === "string" && ID.test(r.key) && !r.key.startsWith(AUTO) ? r.key : null;
          if (given === null) this.log(`screen: table row ${r.index} key is not a valid key, dropped`);
          else if (this.keys.has(given)) this.log(`screen: table row ${r.index} key "${given}" is used twice, dropped`);
          else { this.keys.add(given); key = given; }
        }
        const cells = [];
        let spent = true;
        for (const c of r.cells) {
          if (!this.spend()) { spent = false; break; }
          let children = [];
          if (c.text === "") {
            this.inCell++;
            try { children = this.children(c.json, depth, "children", Infinity, "td"); } finally { this.inCell--; }
          }
          cells.push({ text: c.text, children, align: c.align, colSpan: c.colSpan });
        }
        out.push({ cells, key, hidden: r.hidden });
        if (!spent) break;
      }
      return out;
    });
  }

  /**
   * A `settings` node's `keys` (absent: every setting), as PluginScreenOutput.settingsKeys: `{ keys }` (null keys: all of
   * them), or null (logged) when nothing is left to show.
   */
  settingsKeys(o) {
    const fail = (why) => { this.log(`screen: ${SETTINGS} ${why}, dropped`); return null; };
    const taken = (k) => this.log(`screen: ${SETTINGS} key "${k}" is already shown on this screen, dropped`);
    const declared = this.settings;
    const raw = opt(o, "keys");
    let wanted = null;
    if (!absent(raw)) {
      if (!Array.isArray(raw)) return fail("keys is not a list of setting keys");
      if (raw.length === 0) return fail("keys is empty");
      const n = Math.min(raw.length, LIMITS.maxListItems);
      if (raw.length > n) this.log(`screen: a list keeps ${n} items, the rest dropped`);
      wanted = [];
      for (let i = 0; i < n; i++) {
        const v = raw[i];
        if (typeof v !== "string" || !SETTING_KEY.test(v)) this.log(`screen: ${SETTINGS} key ${fmt(v)} is not a setting key, dropped`);
        else if (declared !== null && !declared.some((s) => s.key === v)) this.log(`screen: ${SETTINGS} key "${v}" is not one of this plugin's settings, dropped`);
        else if (wanted.includes(v)) this.log(`screen: ${SETTINGS} key "${v}" is listed twice, dropped`);
        else wanted.push(v);
      }
    }
    if (wanted === null) {
      if (this.allSettingsShown) return fail("has only settings already on this screen");
      if (declared === null) return this.shownSettings.size === 0 ? { keys: null } : fail("shows every setting, but some are already on this screen");
      const left = declared.map((s) => s.key).filter((k) => { const free = !this.shownSettings.has(k); if (!free) taken(k); return free; });
      if (left.length === 0) return fail("is left with nothing to show");
      return { keys: left.length === declared.length ? null : left };
    }
    const left = wanted.filter((k) => { const free = !this.allSettingsShown && !this.shownSettings.has(k); if (!free) taken(k); return free; });
    if (left.length === 0) return fail("is left with nothing to show");
    return { keys: left };
  }

  /** A field's `bind`: a setting key; with the settings known, one this field can hold (bindProblem). Else dropped, logged. */
  bindOf(o, type, secret = false) {
    const raw = opt(o, "bind");
    if (absent(raw)) return null;
    // An answer's pop-up holds no input state: a bind there would show and write nothing.
    if (this.answerBody > 0) { this.log(`screen: ${type} bind in an answer's pop-up, dropped`); return null; }
    if (typeof raw !== "string" || !SETTING_KEY.test(raw)) { this.log(`screen: ${type} bind is not a setting key, dropped`); return null; }
    if (this.settings === null) return raw;
    const problem = bindProblem(type, opt(o, "multiple") === true, raw, this.settings.find((s) => s.key === raw), secret);
    if (problem === null) return raw;
    this.log(`screen: ${type} ${problem}, dropped`);
    return null;
  }

  /**
   * A field's form rules (manifest.screen.fieldProps); a rule this input does not take is ignored, a bad value dropped,
   * both logged. [textMax]: a text field's own `maxLength` (its `minLength` may not pass it).
   */
  fieldProps(o, type, textMax, secret = false) {
    const takes = S.fieldProps[type] || [];
    for (const r of FIELD_RULES) if (!takes.includes(r) && present(o, r)) this.log(`screen: ${type} does not take ${r}, ignored`);
    // Not in this version: a stepper holds no setting.
    let bind;
    if (type === STEPPER) { bind = null; if (present(o, "bind")) this.log("screen: stepper does not take bind, ignored"); } else bind = this.bindOf(o, type, secret);
    // Task 18 (G8): the plugin's own verdict under the field, on every input (kept on the field only when given).
    const force = this.forceErrorOf(o, type);
    const withBind = (f) => { const g = bind === null ? f : { ...f, bind }; return force === null ? g : { ...g, forceError: force }; };
    const none = { required: false, minLength: null, maxLength: null, pattern: null, errorText: null };
    if (takes.length === 0) return withBind(none);
    let required = false;
    const rq = opt(o, "required");
    if (!absent(rq)) {
      if (typeof rq === "boolean") required = rq;
      else this.log(`screen: ${type} required is not true or false, dropped`);
    }
    const countMax = textMax === null ? LIMITS.maxListItems : LIMITS.maxTextChars;
    let min = takes.includes("minLength") && present(o, "minLength") ? this.intOrNull(o, type, "minLength", 1, countMax) : null;
    // A text field's maxLength is its own cap (read with the field); a choice's counts the chips picked.
    const max = textMax === null && takes.includes("maxLength") && present(o, "maxLength") ? this.intOrNull(o, type, "maxLength", 1, countMax) : null;
    const cap = textMax ?? max;
    if (min !== null && cap !== null && min > cap) {
      this.log(`screen: ${type} minLength ${min} is above its maxLength ${cap}, dropped`);
      min = null;
    }
    let pattern = null;
    if (takes.includes("pattern") && present(o, "pattern")) {
      const p = o.pattern;
      if (typeof p !== "string") this.log(`screen: ${type} pattern is not a string, dropped`);
      else if (p === "") pattern = null;
      else if (p.length > LIMITS.maxPatternChars) this.log(`screen: ${type} pattern is longer than ${LIMITS.maxPatternChars} characters, dropped`);
      else {
        const why = unsafePattern(p);
        if (why === null) pattern = p;
        else this.log(`screen: ${type} pattern ${why}, dropped`);
      }
    }
    const errorText = takes.includes("errorText") ? (this.text(o, "errorText") || null) : null;
    return withBind({ required, minLength: min, maxLength: max, pattern, errorText });
  }

  /** PluginScreenOutput.forceErrorOf (Task 18, G8): an input's forceErrorText (forceErrorTextEn), cut at maxChars (logged); else ignored, logged. */
  forceErrorOf(o, type) {
    const F = S.forceError;
    const raw = opt(o, F.field);
    if (absent(raw)) return null;
    if (typeof raw !== "string") { this.log(`screen: ${type} forceErrorText ${fmt(raw)} is not a text, ignored`); return null; }
    const t = kotlinTrim(localized(o, F.field, this.lang));
    if (t === "") return null;
    if (t.length <= F.maxChars) return t;
    this.log(`screen: ${type} forceErrorText is over ${F.maxChars} characters, cut`);
    return t.slice(0, F.maxChars);
  }

  cardSize(o, type) { return this.enumOf(o, type, "size", S.cardSizes, "medium"); }

  /** PluginScreenOutput.paging: load more, `onEndReached` {event, arg} (else dropped, logged), `loadingMore` and `done`. */
  paging(o, type, cap = LIMITS.maxListItems) {
    const where = `screen: ${type} onEndReached`;
    let onEndReached = null;
    const raw = opt(o, "onEndReached");
    if (!absent(raw)) {
      if (isObj(raw)) {
        const extra = Object.keys(raw).sort().find((k) => k !== "event" && k !== "arg");
        if (extra !== undefined) this.log(`${where}.${extra.slice(0, 40)} is not allowed, dropped`);
        else {
          const arg = this.argOf(opt(raw, "arg"), where);
          const name = arg === null ? null : this.eventOf(opt(raw, "event"), where);
          if (name !== null) onEndReached = { name, arg: arg.value };
        }
      } else this.log(`${where} is not {event, arg}, dropped`);
    }
    return { onEndReached, loadingMore: opt(o, "loadingMore") === true, done: opt(o, "done") === true, cap };
  }

  /**
   * PluginScreenOutput.Reader.eventRef (screen asks): an event-only field (a settings node's onSaved, a qr's onExpire, a steps
   * node's onStepTap): an event name or `{ event, arg }`; anything else dropped, logged.
   */
  eventRef(o, type, field) {
    const where = `screen: ${type} ${field}`;
    const raw = opt(o, field);
    if (absent(raw)) return null;
    if (typeof raw === "string") { const name = this.eventOf(raw, where); return name === null ? null : { name, arg: null }; }
    if (isObj(raw)) {
      const extra = Object.keys(raw).sort().find((k) => k !== "event" && k !== "arg");
      if (extra !== undefined) { this.log(`${where}.${extra.slice(0, 40)} is not allowed, dropped`); return null; }
      const arg = this.argOf(opt(raw, "arg"), where);
      if (arg === null) return null;
      const name = this.eventOf(opt(raw, "event"), where);
      return name === null ? null : { name, arg: arg.value };
    }
    this.log(`${where} is not an event name or {event, arg}, dropped`);
    return null;
  }

  /** PluginScreenOutput.Reader.toast: an answer's toast object; null (logged) without a text. */
  toast(o) {
    const where = "screen: answer.toast";
    const text = this.text(o, "text");
    if (text === "") { this.log(`${where} needs a text, dropped`); return null; }
    let role = null;
    const r = opt(o, "role");
    if (!absent(r)) {
      if (typeof r === "string" && S.roles.includes(r)) role = r;
      else this.log(`${where} role ${fmt(r)} is not one of ${S.roles.join(", ")}, the default used`);
    }
    let ms = LIMITS.toastDefaultMs;
    const v = opt(o, "ms");
    if (!absent(v)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        ms = Math.min(LIMITS.toastMaxMs, Math.max(LIMITS.toastMinMs, Math.floor(v)));
        if (v < LIMITS.toastMinMs || v > LIMITS.toastMaxMs) this.log(`${where} ms ${fmt(v)} is outside ${LIMITS.toastMinMs}..${LIMITS.toastMaxMs}, clamped`);
      } else this.log(`${where} ms ${fmt(v)} is not a number, the default used`);
    }
    let action = null;
    const a = opt(o, "action");
    if (!absent(a)) {
      if (isObj(a)) {
        const aw = `${where} action`;
        const label = this.text(a, "label");
        if (label === "") this.log(`${aw} needs a label, dropped`);
        else {
          const arg = this.argOf(opt(a, "arg"), aw);
          const event = arg === null ? null : this.eventOf(opt(a, "event"), aw);
          if (event !== null) action = { label, event, arg: arg.value };
        }
      } else this.log(`${where} action is not an object, dropped`);
    }
    return { text, role, action, ms };
  }

  /**
   * The titles in [raw] (one item object, or an array of them) as a `home` row's, by screenItems (its drop lines under
   * "screen: <type>"), at most [max] and within the tree's maxTitles. Read once per reading: the size passes of one node
   * see the same JSON and share the result.
   */
  flatWhile(horizontal, read) {
    this.flat++;
    if (horizontal) this.across++;
    try { return read(); } finally { this.flat--; if (horizontal) this.across--; }
  }

  items(raw, max, type, flatHere = false) {
    if (this.itemCache.has(raw)) return this.itemCache.get(raw);
    let out;
    if (this.titles <= 0) {
      if (!this.titlesLogged) { this.titlesLogged = true; this.log(`screen: more than ${LIMITS.maxTitles} titles, the rest dropped`); }
      out = [];
    } else {
      let read = screenItems(Array.isArray(raw) ? raw : [raw], max, (line) => this.log(`screen: ${type} ${line}`), this.allowSeries);
      if (flatHere && read.length > LIMITS.maxFlatTitles) {
        this.log(`screen: ${type} drawn all at once here keeps ${LIMITS.maxFlatTitles} titles, the rest dropped (a long one needs a list of its own)`);
        read = read.slice(0, LIMITS.maxFlatTitles);
      }
      if (read.length > this.titles && !this.titlesLogged) { this.titlesLogged = true; this.log(`screen: more than ${LIMITS.maxTitles} titles, the rest dropped`); }
      out = read.slice(0, this.titles);
      this.titles -= out.length;
    }
    this.itemCache.set(raw, out);
    return out;
  }

  /** A hero's `buttons`: button nodes only, at most maxHeroButtons. */
  heroButtons(o, depth) {
    const raw = opt(o, "buttons");
    if (absent(raw)) return [];
    if (!Array.isArray(raw)) { this.log("screen: heroCard buttons is not an array, dropped"); return []; }
    let n = raw.length;
    if (n > LIMITS.maxHeroButtons) { n = LIMITS.maxHeroButtons; this.log(`screen: heroCard keeps ${LIMITS.maxHeroButtons} buttons, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = isObj(raw[i]) ? normalizeNode(raw[i], this.log) : raw[i];
      if (!isObj(b) || opt(b, "type") !== "button") { this.log(`screen: heroCard button ${i} is not a button, dropped`); continue; }
      const c = this.node(b, depth + 1);
      if (c !== null) out.push(c);
    }
    return out;
  }

  /** A menu's `items` [{label, labelEn, icon, onTap}]: at most maxMenuItems, each with a label and an action. */
  menuItems(raw, who) {
    if (!Array.isArray(raw)) return [];
    let n = raw.length;
    if (n > LIMITS.maxMenuItems) { n = LIMITS.maxMenuItems; this.log(`screen: ${who} keeps ${LIMITS.maxMenuItems} items, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = isObj(raw[i]) ? raw[i] : null;
      const label = e ? this.text(e, "label") : "";
      if (e === null || label === "") { this.log(`screen: ${who} item ${i} needs a label, dropped`); continue; }
      const onTap = this.actions(opt(e, "onTap"), e, `${who} item ${i}`, "onTap");
      if (onTap === null) { this.log(`screen: ${who} item ${i} needs an action, dropped`); continue; }
      out.push({ label, icon: this.iconOf(e, `${who} item ${i}`), onTap });
    }
    return out;
  }

  /**
   * Task 8y (PluginScreenOutput.trailingOf): a text field's trailing icon action { icon, label, onTap }, all three of
   * `trailingIcon`, `trailingLabel` and `onTrailingTap`, or null. A bad or missing part leaves the field without the icon
   * (logged, the field kept); a `textArea` takes none.
   */
  trailingOf(o, type) {
    const raw = opt(o, "trailingIcon");
    const tapRaw = opt(o, "onTrailingTap");
    if (type !== "textInput") {
      if (!absent(raw) || !absent(tapRaw)) this.log(`screen: ${type} trailingIcon works only on a one-line field, ignored`);
      return null;
    }
    // No icon (in this width class: a per-size map may leave one out): the action has nothing to hang on, silently.
    if (absent(raw)) return null;
    if (typeof raw !== "string" || !ICONS.includes(raw)) { this.log(`screen: ${type} trailingIcon ${fmt(raw)} is not a Kino icon, ignored`); return null; }
    const label = kotlinTrim(this.text(o, "trailingLabel"));
    if (label === "") { this.log(`screen: ${type} trailingIcon needs a trailingLabel, ignored`); return null; }
    if (label.length > LIMITS.maxTrailingLabelChars) { this.log(`screen: ${type} trailingLabel is over ${LIMITS.maxTrailingLabelChars} characters, its icon ignored`); return null; }
    const onTap = this.actions(tapRaw, o, type, "onTrailingTap");
    if (onTap === null) { this.log(`screen: ${type} trailingIcon needs a valid onTrailingTap, ignored`); return null; }
    return { icon: raw, label, onTap };
  }

  iconOf(o, type) {
    const i = opt(o, "icon");
    if (absent(i)) return null;
    if (typeof i === "string" && ICONS.includes(i)) return i;
    this.log(`screen: ${type} icon ${fmt(i)} is not a Kino icon, dropped`);
    return null;
  }

  /** The `value` of a single-choice widget when it names one of [options]; else null (logged when it was set). */
  chosen(o, type, options) {
    const v = opt(o, "value");
    if (absent(v)) return null;
    if (typeof v === "string" && options.some((x) => x.value === v)) return v;
    this.log(`screen: ${type} value ${fmt(v)} names no option, dropped`);
    return null;
  }

  /** `[{value, label, labelEn}]`: at most maxListItems, each with a value and a label, values distinct. */
  options(raw, type, what) {
    if (!Array.isArray(raw)) return [];
    let n = raw.length;
    if (n > LIMITS.maxListItems) { n = LIMITS.maxListItems; this.log(`screen: ${type} keeps ${LIMITS.maxListItems} ${what}s, the rest dropped`); }
    const out = [];
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const e = isObj(raw[i]) ? raw[i] : null;
      const value = e && typeof opt(e, "value") === "string" ? e.value : null;
      const label = e ? this.text(e, "label") : "";
      if (value === null || value === "" || value.length > LIMITS.maxTextChars || label === "") { this.log(`screen: ${type} ${what} ${i} needs a value and a label, dropped`); continue; }
      if (seen.has(value)) { this.log(`screen: ${type} ${what} ${i} repeats value ${fmt(value)}, dropped`); continue; }
      seen.add(value);
      // Task 15: a tab's badge, beside its label; any other choice takes none.
      let badge = null;
      if (present(e, "badge")) {
        if (type === "tabs") badge = badgeOf(e.badge, this.lang, `screen: ${type} ${what} ${i}`, this.log);
        else this.log(`screen: ${type} ${what} ${i} badge works only on a tab, ignored`);
      }
      out.push({ value, label, badge });
    }
    return out;
  }

  num(o, type, name) {
    const v = opt(o, name);
    if (absent(v)) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    this.log(`screen: ${type} ${name} is not a number, dropped`);
    return null;
  }

  /** An integer in lo..hi, or null (logged) when it is not. */
  intOrNull(o, type, name, lo, hi) {
    const v = opt(o, name);
    if (typeof v === "number" && Number.isFinite(v) && v === Math.floor(v) && v >= lo && v <= hi) return v;
    this.log(`screen: ${type} ${name} ${fmt(v)} is outside ${lo}..${hi === INT_MAX ? "" : hi}, dropped`);
    return null;
  }

  int(o, type, name, lo, hi, def) {
    if (!present(o, name)) return def;
    return this.intOrNull(o, type, name, lo, hi) ?? def;
  }

  /** A true/false property [name] (false when absent or null; anything else is logged and read as false). */
  flag(o, type, name) {
    const v = opt(o, name);
    if (absent(v)) return false;
    if (typeof v === "boolean") return v;
    this.log(`screen: ${type} ${name} ${fmt(v)} is not true or false, ignored`);
    return false;
  }

  enumOf(o, type, name, values, def, listed = values) {
    const v = opt(o, name);
    if (absent(v)) return def;
    if (typeof v === "string" && values.includes(v)) return v;
    this.log(`screen: ${type} ${name} ${fmt(v)} is not one of ${listed.join(", ")}, the default used`);
    return def;
  }

  // ---- style ----

  style(o, type, depth) {
    const scaled = (raw, name, scale, what) => {
      if (typeof raw === "number" && Number.isFinite(raw) && raw === Math.floor(raw) && scale.includes(raw)) return raw === 0 ? 0 : raw;
      this.log(`screen: ${type} ${name} ${fmt(raw)} is off the ${what} scale, dropped`);
      return null;
    };
    const edges = (name) => {
      if (!present(o, name)) return null;
      const raw = o[name];
      if (typeof raw === "number") {
        const v = scaled(raw, name, S.spacingScale, "spacing");
        return v === null ? null : { top: v, end: v, bottom: v, start: v };
      }
      if (isObj(raw)) {
        const side = [0, 0, 0, 0]; // top, end, bottom, start
        const put = (k, ...at) => {
          if (!present(raw, k)) return;
          const v = scaled(raw[k], `${name}.${k}`, S.spacingScale, "spacing") ?? 0;
          for (const i of at) side[i] = v;
        };
        put("x", 1, 3); put("y", 0, 2); put("top", 0); put("end", 1); put("bottom", 2); put("start", 3);
        return { top: side[0], end: side[1], bottom: side[2], start: side[3] };
      }
      this.log(`screen: ${type} ${name} is not a number or an object, dropped`);
      return null;
    };
    const size = (name) => (present(o, name) ? scaled(o[name], name, S.sizeScale, "size") : null);
    const radius = () => {
      // Task 17: a CircleAvatar's `radius` is its own (a number of dp): it is always a circle.
      if (type === "avatar" || !present(o, "radius") || isObj(o.radius)) return null;
      if (typeof o.radius === "string" && S.radiusTokens.includes(o.radius)) return o.radius;
      this.log(`screen: ${type} radius ${fmt(o.radius)} is not a radius token, dropped`);
      return null;
    };
    // Task 15: `borderRadius` per corner, `{ topStart, topEnd, bottomStart, bottomEnd }` (an omitted corner is the default).
    const corners = () => {
      if (type === "avatar" || !isObj(opt(o, "radius"))) return null;
      const m = o.radius;
      const C = S.corners;
      for (const k of Object.keys(m).sort()) if (!C.keys.includes(k)) this.log(`screen: ${type} radius.${k.slice(0, 40)} is not a corner, ignored`);
      const out = {};
      for (const k of C.keys) {
        if (!present(m, k)) { out[k] = C.default; continue; }
        if (typeof m[k] === "string" && S.radiusTokens.includes(m[k])) { out[k] = m[k]; continue; }
        this.log(`screen: ${type} radius.${k} ${fmt(m[k])} is not a radius token, dropped`);
        return null;
      }
      return out;
    };
    // Task 15: a share of the parent's width, min to max in steps.
    const fraction = () => {
      if (!present(o, "maxWidthFraction")) return null;
      const F = S.maxWidthFraction;
      const v = o.maxWidthFraction;
      const d = typeof v === "number" && Number.isFinite(v) ? v : null;
      const steps = d === null ? 0 : (d - F.min) / F.step;
      if (d === null || d < F.min - 1e-9 || d > F.max + 1e-9 || Math.abs(steps - Math.round(steps)) > 1e-6) {
        this.log(`screen: ${type} maxWidthFraction ${fmt(v)} is not 0.25 to 1 in steps of 0.05, dropped`);
        return null;
      }
      return Math.round(d * 100) / 100;
    };
    const color = () => {
      if (!present(o, "color")) return null;
      if (typeof o.color === "string" && S.colorRoles.includes(o.color)) return o.color;
      this.log(`screen: ${type} color ${fmt(o.color)} is not a color role${colorHint(o.color)}, dropped`);
      return null;
    };
    const align = () => {
      if (!present(o, "align")) return null;
      if (typeof o.align === "string" && ALIGNS.includes(o.align)) return o.align;
      this.log(`screen: ${type} align ${fmt(o.align)} is not start, center, end or stretch, dropped`);
      return null;
    };
    const justify = () => {
      if (!present(o, "justify")) return null;
      if (typeof o.justify === "string" && JUSTIFIES.includes(o.justify)) return o.justify;
      this.log(`screen: ${type} justify ${fmt(o.justify)} is not start, center, end, spaceBetween or spaceAround, dropped`);
      return null;
    };
    // Evaluated in the Kotlin constructor's argument order, so the log lines come out in the same order.
    const base = {
      padding: edges("padding"),
      margin: edges("margin"),
      gap: present(o, "gap") ? scaled(o.gap, "gap", S.spacingScale, "spacing") : null,
      radius: radius(),
      corners: corners(),
      w: size("w"),
      h: size("h"),
      minH: size("minH"),
      fill: opt(o, "fill") === true,
      weight: present(o, "weight") ? this.intOrNull(o, type, "weight", 1, LIMITS.maxWeight) : null,
      align: align(),
      justify: justify(),
      color: color(),
    };
    // The twelve-column layout (a wrapping row's children): read last, so their lines come last.
    const cols = GRID_COLUMNS;
    const whole = (v, lo) => typeof v === "number" && Number.isFinite(v) && v === Math.floor(v) && v >= lo;
    let span = null;
    if (present(o, "span")) {
      const raw = o.span;
      if (raw === "auto") span = "auto";
      else if (!whole(raw, 1)) this.log(`screen: ${type} span ${fmt(raw)} is not 1 to ${cols} or auto, dropped`);
      else if (raw > cols) { span = cols; this.log(`screen: ${type} span ${fmt(raw)} is above ${cols}, clamped to ${cols}`); }
      else span = raw;
    }
    let offset = null;
    if (present(o, "offset")) {
      const raw = o.offset;
      if (!whole(raw, 0)) this.log(`screen: ${type} offset ${fmt(raw)} is outside 0..${cols - 1}, dropped`);
      else if (raw > cols - 1) { offset = cols - 1; this.log(`screen: ${type} offset ${fmt(raw)} is above ${cols - 1}, clamped to ${cols - 1}`); }
      else offset = raw === 0 ? 0 : raw;
    }
    if (typeof span === "number" && offset !== null && offset + span > cols) {
      this.log(`screen: ${type} offset ${offset} and span ${span} pass ${cols} columns, the offset lowered to ${cols - span}`);
      offset = cols - span;
    }
    const widthFraction = fraction();
    // Task 17: the box and text properties, read last and in this order (the app's lines come in the same one).
    const B = S.boxProps;
    const boxy = B.boxWidgets.includes(type);
    let alignSelf = null;
    if (present(o, "alignSelf")) {
      if (!(typeof o.alignSelf === "string" && ALIGNS.includes(o.alignSelf))) this.log(`screen: ${type} alignSelf ${fmt(o.alignSelf)} is not start, center, end or stretch, dropped`);
      else if (!B.alignSelfParents.includes(this.parentType) || depth === this.wrapChildDepth) this.log(`screen: ${type} alignSelf works only in a Row or a Column, ignored`);
      else alignSelf = o.alignSelf;
    }
    let textAlign = null;
    if (present(o, "textAlign")) {
      if (!(typeof o.textAlign === "string" && B.textAligns.includes(o.textAlign))) this.log(`screen: ${type} textAlign ${fmt(o.textAlign)} is not ${B.textAligns.join(", ")}, dropped`);
      else if (!B.textAlignWidgets.includes(type)) this.log(`screen: ${type} textAlign works only on a node that draws text, ignored`);
      else textAlign = o.textAlign;
    }
    const border = this.borderOf(o, type, boxy);
    let elevation = null;
    if (present(o, "elevation")) {
      const v = o.elevation;
      const max = B.maxElevation;
      if (!(typeof v === "number" && Number.isFinite(v))) this.log(`screen: ${type} elevation ${fmt(v)} is not a number from 0 to ${max}, dropped`);
      else if (!B.elevationWidgets.includes(type)) this.log(`screen: ${type} elevation works only on a Card or a Stack, ignored`);
      else {
        elevation = Math.round(Math.min(max, Math.max(0, v)));
        if (v < 0 || v > max) this.log(`screen: ${type} elevation ${fmt(v)} is outside 0..${max}, clamped`);
      }
    }
    let background = null;
    if (present(o, "background")) {
      if (!(typeof o.background === "string" && S.colorRoles.includes(o.background))) this.log(`screen: ${type} background ${fmt(o.background)} is not a color role${colorHint(o.background)}, dropped`);
      else if (!boxy) this.log(`screen: ${type} background works only on a node that draws a box, ignored`);
      else background = o.background;
    }
    const minW = size("minWidth");
    let maxW = size("maxWidth");
    if (minW !== null && maxW !== null && minW > maxW) {
      this.log(`screen: ${type} minWidth ${minW} is above its maxWidth ${maxW}, maxWidth dropped`);
      maxW = null;
    }
    let maxH = size("maxHeight");
    if (base.minH !== null && maxH !== null && base.minH > maxH) {
      this.log(`screen: ${type} minH ${base.minH} is above its maxHeight ${maxH}, maxHeight dropped`);
      maxH = null;
    }
    const positioned = this.positionedOf(o, type);
    let opacity = null;
    if (present(o, "opacity")) {
      const v = o.opacity;
      if (!(typeof v === "number" && Number.isFinite(v))) this.log(`screen: ${type} opacity ${fmt(v)} is not a number from 0 to 1, dropped`);
      else {
        opacity = Math.min(1, Math.max(0, v));
        if (opacity !== v) this.log(`screen: ${type} opacity ${fmt(v)} is outside 0..1, clamped`);
      }
    }
    const animate = this.animateOf(o, type, boxy || positioned !== null);
    return { ...base, span, offset, maxWidthFraction: widthFraction, alignSelf, textAlign, border, elevation, background, minW, maxW, maxH, positioned, opacity, animate };
  }

  /** PluginScreenOutput.animateOf (Task 17): `{ duration?, curve? }` on a box or a positioned child; clamped or defaulted, logged. */
  animateOf(o, type, takes) {
    if (!present(o, "animate")) return null;
    const a = o.animate;
    const M = S.motion;
    if (!isObj(a)) { this.log(`screen: ${type} animate is not { duration, curve }, dropped`); return null; }
    if (!takes) { this.log(`screen: ${type} animate works only on a box or a positioned child, ignored`); return null; }
    for (const k of Object.keys(a).sort()) if (!M.fields.includes(k)) this.log(`screen: ${type} animate.${k.slice(0, 40)} is not duration or curve, ignored`);
    let ms = M.defaultMs;
    if (present(a, "duration")) {
      const v = a.duration;
      if (!(typeof v === "number" && Number.isFinite(v))) this.log(`screen: ${type} animate.duration ${fmt(v)} is not a number, the default used`);
      else {
        ms = Math.round(Math.min(M.maxMs, Math.max(M.minMs, v)));
        if (v < M.minMs || v > M.maxMs) this.log(`screen: ${type} animate.duration ${fmt(v)} is outside ${M.minMs}..${M.maxMs}, clamped`);
      }
    }
    let curve = M.curves[0];
    if (present(a, "curve")) {
      if (typeof a.curve === "string" && M.curves.includes(a.curve)) curve = a.curve;
      else this.log(`screen: ${type} animate.curve ${fmt(a.curve)} is not ${M.curves.join(", ")}, the default used`);
    }
    return { durationMs: ms, curve };
  }

  /**
   * PluginScreenOutput.positionedOf (Task 17, Flutter's Positioned): on a child of a Stack only; each key dp (clamped) or
   * "<n>%" of the stack (clamped); a value that is neither drops that key, an unknown key is ignored; both sides and a size on
   * one axis: the size ignored. All logged. A length is { dp, fraction }, the other null.
   */
  positionedOf(o, type) {
    if (!present(o, "positioned")) return null;
    const p = o.positioned;
    const P = S.positioned;
    if (!isObj(p)) { this.log(`screen: ${type} positioned is not { top, left, right, bottom, width, height }, dropped`); return null; }
    if (this.parentType !== P.parent) { this.log(`screen: ${type} positioned works only on a child of a Stack, ignored`); return null; }
    for (const k of Object.keys(p).sort()) if (!P.keys.includes(k)) this.log(`screen: ${type} positioned.${k.slice(0, 40)} is not top, left, right, bottom, width or height, ignored`);
    const percent = new RegExp(P.percentPattern);
    const length = (k) => {
      if (!present(p, k)) return null;
      const v = p[k];
      const where = `screen: ${type} positioned.${k} ${fmt(v)}`;
      if (typeof v === "number") {
        if (!Number.isFinite(v)) { this.log(`${where} is not dp or a percentage, dropped`); return null; }
        const kept = Math.min(P.maxDp, Math.max(0, v));
        if (kept !== v) this.log(`${where} is outside 0..${P.maxDp}, clamped`);
        return { dp: kept, fraction: null };
      }
      const m = typeof v === "string" ? percent.exec(v) : null;
      if (m === null) { this.log(`${where} is not dp or a percentage, dropped`); return null; }
      const pct = Number(m[1]);
      const kept = Math.min(100, Math.max(0, pct));
      if (kept !== pct) this.log(`${where} is outside 0%..100%, clamped`);
      return { dp: null, fraction: kept / 100 };
    };
    const top = length("top"), left = length("left"), right = length("right"), bottom = length("bottom");
    let width = length("width"), height = length("height");
    if (left !== null && right !== null && width !== null) { this.log(`screen: ${type} positioned has left, right and width, its width ignored`); width = null; }
    if (top !== null && bottom !== null && height !== null) { this.log(`screen: ${type} positioned has top, bottom and height, its height ignored`); height = null; }
    return { top, left, right, bottom, width, height };
  }

  /**
   * PluginScreenOutput.borderOf (Task 17): a box's `border`, `{ width?, color? }`; off a box ignored; a width that is no number
   * drops it; a width outside the range is clamped and a colour that is no role takes the default; all logged.
   */
  borderOf(o, type, boxy) {
    if (!present(o, "border")) return null;
    const b = o.border;
    if (!isObj(b)) { this.log(`screen: ${type} border is not { width, color }, dropped`); return null; }
    if (!boxy) { this.log(`screen: ${type} border works only on a node that draws a box, ignored`); return null; }
    const B = S.boxProps.border;
    for (const k of Object.keys(b).sort()) if (!B.fields.includes(k)) this.log(`screen: ${type} border.${k.slice(0, 40)} is not width or color, ignored`);
    let width = B.defaultWidth;
    if (present(b, "width")) {
      const v = b.width;
      if (!(typeof v === "number" && Number.isFinite(v))) { this.log(`screen: ${type} border.width ${fmt(v)} is not a number, dropped`); return null; }
      width = Math.min(B.maxWidth, Math.max(0, v));
      if (width !== v) this.log(`screen: ${type} border.width ${fmt(v)} is outside 0..${B.maxWidth}, clamped`);
    }
    let color = null;
    if (present(b, "color")) {
      if (typeof b.color === "string" && S.colorRoles.includes(b.color)) color = b.color;
      else this.log(`screen: ${type} border.color ${fmt(b.color)} is not a color role${colorHint(b.color)}, the default used`);
    }
    return { width, color };
  }

  // ---- actions ----

  /**
   * `"name"` (an event, its arg from the node's `arg`), `{ui, event, arg}` / `{ui, go}`, or a bare go object. Null
   * (logged) when it is none of these or carries nothing usable.
   */
  actions(raw, node, type, field) {
    const where = `screen: ${type} ${field}`;
    if (absent(raw)) return null;
    if (typeof raw === "string") {
      const arg = this.argOf(opt(node, "arg"), where);
      if (arg === null) return null;
      const name = this.eventOf(raw, where);
      return name === null ? null : { ui: [], event: { name, arg: arg.value }, go: null };
    }
    if (!isObj(raw)) { this.log(`${where} is not an event, ui operations or a go, dropped`); return null; }
    const keys = Object.keys(raw).sort();
    if (keys.some((k) => k === "ui" || k === "event" || k === "go")) {
      const stray = keys.find((k) => !ACTION_KEYS.includes(k));
      if (stray !== undefined) { this.log(`${where}.${stray.slice(0, 40)} is not allowed, dropped`); return null; }
      const ui = this.uiOf(opt(raw, "ui"), where);
      let event = null;
      if (present(raw, "event")) {
        const arg = this.argOf(opt(raw, "arg"), where);
        if (arg === null) return null;
        const name = this.eventOf(raw.event, where);
        if (name === null) return null;
        event = { name, arg: arg.value };
      }
      let go = null;
      const g = opt(raw, "go");
      if (absent(g)) go = null;
      else if (isObj(g)) go = this.goOf(g, where);
      else this.log(`${where} go is not an object, dropped`);
      if (event !== null && go !== null) { this.log(`${where} has both an event and a go, the go dropped`); go = null; }
      // Task 18 (G6): the action's own call budget, on the person's press only (kept only when given).
      const timeoutMs = this.timeoutOf(raw, where, field, event !== null);
      if (ui.length === 0 && event === null && go === null) return null;
      return timeoutMs === null ? { ui, event, go } : { ui, event, go, timeoutMs };
    }
    if (keys.some((k) => GO_KEYS.includes(k))) {
      const go = this.goOf(raw, where);
      return go === null ? null : { ui: [], event: null, go };
    }
    this.log(`${where} is not an event, ui operations or a go, dropped`);
    return null;
  }

  /**
   * PluginScreenOutput.timeoutOf (Task 18, G6): an action's own timeoutMs: a whole number of ms from minActionTimeoutMs to
   * maxActionTimeoutMs (clamped, logged), only on a press with an event; else ignored, logged.
   */
  timeoutOf(raw, where, field, hasEvent) {
    const v = opt(raw, "timeoutMs");
    if (absent(v)) return null;
    if (!PRESS_FIELDS.includes(field)) { this.log(`${where} timeoutMs works only on the person's press (onPressed, onTap, onLongPress, onSubmitted, onTrailingTap), ignored`); return null; }
    if (!hasEvent) { this.log(`${where} timeoutMs needs an event, ignored`); return null; }
    if (typeof v !== "number" || !Number.isFinite(v)) { this.log(`${where} timeoutMs ${fmt(v)} is not a number, ignored`); return null; }
    const { minActionTimeoutMs: lo, maxActionTimeoutMs: hi } = S.pressBudget;
    if (v < lo || v > hi) this.log(`${where} timeoutMs ${fmt(v)} is outside ${lo}..${hi}, clamped`);
    return Math.min(hi, Math.max(lo, Math.floor(v)));
  }

  /**
   * A declared pop-up's `onClose` (PluginScreenOutput.popupOnClose): read as an action, its `go` dropped, logged (closing a
   * pop-up never navigates). Null when absent, invalid, or left empty.
   */
  popupOnClose(o) {
    const a = this.actions(opt(o, POPUP_ON_CLOSE), o, POPUP, POPUP_ON_CLOSE);
    if (a === null) return null;
    if (a.go !== null) this.log(`screen: popup ${POPUP_ON_CLOSE} go is not allowed (closing a pop-up never navigates), dropped`);
    // Fix round 1 (C1): an open here would bring the pop-up straight back, so Back could never close it.
    const ui = a.ui.filter((op) => {
      const name = Object.keys(op)[0];
      const drop = DISMISS_DROPPED_OPS.includes(name);
      if (drop) this.log(`screen: popup ${POPUP_ON_CLOSE} ${name} is not allowed (closing a pop-up never opens one or moves focus), dropped`);
      return !drop;
    });
    if (a.go === null && ui.length === a.ui.length) return a;
    return ui.length === 0 && a.event === null ? null : { ...a, go: null, ui };
  }

  /** The event's arg: absent, or a string of at most maxRefChars; null (logged) drops the action. */
  argOf(raw, where) {
    if (absent(raw)) return { value: null };
    if (typeof raw === "string") {
      if (raw.length <= LIMITS.maxRefChars) return { value: raw };
      this.log(`${where} arg longer than ${LIMITS.maxRefChars} characters, dropped`);
      return null;
    }
    this.log(`${where} arg is not a string, dropped`);
    return null;
  }

  eventOf(raw, where) {
    if (typeof raw !== "string" || !ID.test(raw)) { this.log(`${where} event ${fmt(raw)} is not a valid name, dropped`); return null; }
    if (raw === RESERVED_EVENT) { this.log(`${where} event "${RESERVED_EVENT}" is reserved, dropped`); return null; }
    return raw;
  }

  uiOf(raw, where) {
    if (absent(raw)) return [];
    if (!Array.isArray(raw)) { this.log(`${where} ui is not an array, dropped`); return []; }
    let n = raw.length;
    if (n > LIMITS.maxUiOps) { n = LIMITS.maxUiOps; this.log(`${where} ui keeps ${LIMITS.maxUiOps} operations, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const op = this.uiOp(raw[i], where);
      if (op !== null) out.push(op);
    }
    return out;
  }

  uiOp(raw, where) {
    const o = isObj(raw) ? raw : null;
    const names = o ? Object.keys(o) : [];
    // Task 15: `toggle` alone takes a second field, `prop` (what it flips).
    const op = names.length === 2 && names.includes("toggle") && names.includes("prop") ? "toggle" : names.length === 1 ? names[0] : null;
    if (o === null || op === null || !S.uiOps.includes(op)) {
      const name = o ? names.sort()[0] : undefined;
      this.log(`${where} ui operation ${fmt(name ?? raw)} is unknown, dropped`);
      return null;
    }
    const key = (v) => {
      if (typeof v === "string" && ID.test(v)) return v;
      this.log(`${where} ui.${op} key ${fmt(v)} is not a valid key, dropped`);
      return null;
    };
    if (op === "set") {
      const s = o.set;
      if (!isObj(s)) { this.log(`${where} ui.set is not {key, value}, dropped`); return null; }
      const k = key(opt(s, "key"));
      if (k === null) return null;
      const notValue = `${where} ui.set value is not a string, boolean, number or list of strings, dropped`;
      const v = opt(s, "value");
      let value;
      if (typeof v === "string") {
        if (v.length > LIMITS.maxTextChars) { this.log(`${where} ui.set value longer than ${LIMITS.maxTextChars} characters, dropped`); return null; }
        value = v;
      } else if (typeof v === "boolean") value = v;
      else if (typeof v === "number" && Number.isFinite(v)) value = v;
      else if (Array.isArray(v)) {
        if (v.length > LIMITS.maxListItems) { this.log(`${where} ui.set list holds more than ${LIMITS.maxListItems} values, dropped`); return null; }
        value = [];
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] !== "string") { this.log(notValue); return null; }
          if (v[i].length > LIMITS.maxTextChars) { this.log(`${where} ui.set list value ${i} longer than ${LIMITS.maxTextChars} characters, dropped`); return null; }
          value.push(v[i]);
        }
      } else { this.log(notValue); return null; }
      return { set: { key: k, value } };
    }
    const k = key(o[op]);
    if (k === null) return null;
    if (op === "toggle" && !absent(o.prop)) {
      const props = S.sharedProps.toggleProps;
      if (typeof o.prop !== "string" || !props.includes(o.prop)) { this.log(`${where} ui.toggle prop ${fmt(o.prop)} is not ${props.join(" or ")}, dropped`); return null; }
      return o.prop === props[0] ? { toggle: k } : { toggle: k, prop: o.prop };
    }
    return { [op]: k };
  }

  /** Exactly one of the twelve go shapes, logged under [where] when it is not. */
  goOf(o, where) {
    const keys = Object.keys(o);
    const k = keys.length === 1 && GO_KEYS.includes(keys[0]) ? keys[0] : null;
    if (k === null) { this.log(`${where} go must be exactly one of ${GO_KEYS.join(", ")}, dropped`); return null; }
    const v = o[k];
    const bad = (why) => { this.log(`${where} go.${k} ${why}, dropped`); return null; };
    if (k === "screen") {
      const g = screenGoOf(v, (why) => this.log(`${where} go.screen ${why}, dropped`));
      return g === null ? null : { screen: g };
    }
    if (k === "titleByIds") {
      const g = titleByIdsOf(v, (why) => this.log(`${where} go.titleByIds ${why}, dropped`));
      return g === null ? null : { titleByIds: g };
    }
    if (k === "url") {
      const g = urlGoOf(v, (why) => this.log(`${where} go.url ${why}, dropped`));
      return g === null ? null : { url: g };
    }
    if (k === "copy") {
      const g = copyGoOf(v, (why) => this.log(`${where} go.copy ${why}, dropped`));
      return g === null ? null : { copy: g };
    }
    if (k === "liveChannel") {
      const g = liveChannelGoOf(v, (why) => this.log(`${where} go.liveChannel ${why}, dropped`));
      return g === null ? null : { liveChannel: g };
    }
    if (k === "section" || k === "categories" || k === "close") return v === true ? { [k]: true } : bad("must be true");
    if (!isObj(v)) return bad("is not an object");
    if (k === "search") {
      const q = (typeof opt(v, "q") === "string" ? v.q : "").trim();
      return q === "" || q.length > LIMITS.maxSearchQueryChars ? bad(`q must be 1 to ${LIMITS.maxSearchQueryChars} characters`) : { search: { q } };
    }
    const ref = opt(v, "ref");
    if (typeof ref !== "string" || ref === "" || ref.length > LIMITS.maxRefChars) return bad(`ref must be 1 to ${LIMITS.maxRefChars} characters`);
    if (k === "browse") {
      const title = this.text(v, "title");
      return { browse: title === "" ? { ref } : { ref, title } };
    }
    const kind = opt(v, "kind");
    if (typeof kind !== "string" || !S.goKinds.includes(kind)) return bad(`kind ${fmt(kind)} is not ${S.goKinds.join(", ")}`);
    // The title's identity, as the plugin's lists give it (Task 8): optional, each checked as an item's (PluginScreenOutput.goOf).
    const out = { ref, kind };
    const id = opt(v, "id");
    if (id !== undefined && id !== null) {
      if (typeof id !== "string" || !new RegExp(contract.output.itemIdPattern).test(id)) return bad(GO_BAD_ID);
      out.id = id;
    }
    const title = opt(v, "title");
    if (title !== undefined && title !== null) {
      if (typeof title !== "string" || title.trim().length > contract.output.maxTitleChars) return bad(`title must be text of at most ${contract.output.maxTitleChars} characters`);
      if (title.trim() !== "") out.title = title.trim();
    }
    const adult = opt(v, "adult");
    if (adult !== undefined && adult !== null) {
      if (typeof adult !== "boolean") return bad("adult must be true or false");
      if (adult) out.adult = true;
    }
    return { [k]: out };
  }

  // ---- dialogs ----

  dialog(o) {
    const title = this.text(o, "title");
    const body = this.body(o, "dialog");
    if (title === "" && body.length === 0) { this.log("screen: dialog has no title and no body, dropped"); return null; }
    return { title, body, buttons: this.buttons(opt(o, "buttons")) };
  }

  /** An answer's `sheet`: `{ title, body }` (body text or nodes, as a dialog's). */
  sheet(o) {
    const title = this.text(o, "title");
    const body = this.body(o, "sheet");
    if (title === "" && body.length === 0) { this.log("screen: sheet has no title and no body, dropped"); return null; }
    return { title, body };
  }

  /** An answer's `menu`: `{ title, items }`, with 1..maxMenuItems valid items. */
  menu(o) {
    const items = this.menuItems(opt(o, "items"), "answer.menu");
    if (items.length === 0) { this.log(`screen: answer.menu needs 1 to ${LIMITS.maxMenuItems} valid items, dropped`); return null; }
    return { title: this.text(o, "title"), items };
  }

  /** A pop-up's `body`: one text, or nodes. */
  body(o, what) {
    return this.flatWhile(false, () => {
      this.answerBody++;
      try { return this.bodyOf(o, what); } finally { this.answerBody--; }
    });
  }

  bodyOf(o, what) {
    const b = opt(o, "body");
    const body = [];
    if (absent(b)) return body;
    if (typeof b === "string") {
      const text = this.text(o, "body");
      if (text !== "") body.push(node("text", { text, variant: "p", maxLines: null, bold: false }, { key: `${AUTO}0` }));
    } else if (Array.isArray(b)) {
      for (const item of b) {
        if (!isObj(item)) { this.log(`screen: a ${what} body item is not an object, dropped`); continue; }
        const n = this.node(item, 1);
        if (n !== null) body.push(n);
      }
    } else this.log(`screen: ${what} body is not text or nodes, dropped`);
    return body;
  }

  buttons(raw) {
    if (absent(raw)) return [];
    if (!Array.isArray(raw)) { this.log("screen: dialog buttons is not an array, dropped"); return []; }
    let n = raw.length;
    if (n > LIMITS.maxDialogButtons) { n = LIMITS.maxDialogButtons; this.log(`screen: dialog keeps ${LIMITS.maxDialogButtons} buttons, the rest dropped`); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = isObj(raw[i]) ? raw[i] : null;
      const label = b ? this.text(b, "label") : "";
      if (b === null || label === "") { this.log(`screen: dialog button ${i} needs a label, dropped`); continue; }
      const where = `screen: dialog button ${i}`;
      let event = null;
      if (present(b, "event")) {
        event = this.eventOf(b.event, where);
        if (event === null) continue;
      }
      const arg = this.argOf(opt(b, "arg"), where);
      if (arg === null) continue;
      let variant = this.enumOf(b, "dialog button", "variant", BUTTON_VARIANTS, "text");
      // A pop-up button has a label and no icon: the icon variant would draw nothing.
      if (variant === "icon") { this.log(`${where} variant icon needs an icon, text used`); variant = "text"; }
      out.push({ label, event, arg: arg.value, variant });
    }
    return out;
  }
}

const fmtType = (t) => (t === undefined || t === null ? "null" : typeof t === "string" ? t : numText(t));

/** A node as the app holds it: its type, its own fields, then what every node carries (ScreenCommon). */
function node(type, fields, common) {
  const { defaultTap, submitTap, noTap, ...own } = fields;
  const c = { key: "", enabled: true, hidden: false, style: null, onTap: null, onLongPress: null, devices: null, sizes: null, testKey: null, byClass: {}, ...common };
  // A QR is never pressable.
  if (noTap) { c.onTap = null; c.onLongPress = null; }
  // A title card without a tap of its own opens the title's page.
  if (defaultTap && c.onTap === null) c.onTap = defaultTap;
  // A form's submit button runs the form's submit, whatever its own onTap was.
  if (submitTap) c.onTap = submitTap;
  return { type, ...own, ...c };
}

// ---------- the answers (PluginScreenOutput.tree / answer) ----------

/**
 * The app's `PluginScreenOutput.tree`: `{ tree, dropped }`, the root node of a `screen` answer (null, logged, when it
 * is not an object or the root itself is dropped) and each problem as the app logs it. [lang] "es" | "en"; [widgets]
 * the widget names this Kino draws (default: all of them). [settings]: the manifest's `settings` (a field's `bind` and a
 * `settings` node's `keys` are checked against them; absent: only their shape is checked).
 */
export function checkScreenTree(value, lang = "es", widgets = WIDGETS, { allowSeries = true, settings } = {}) {
  const dropped = [];
  const v = wire(value);
  let every = [];
  let layout = SCREEN_LAYOUT.values[0];
  const tree = cappedLog((line) => dropped.push(line), "screen", (capped) => {
    if (!isObj(v)) { capped("screen: the tree is not a JSON object"); return null; }
    const root = new Reader(lang, new Set(widgets ?? WIDGETS), capped, allowSeries, settingsModel(settings)).node(v, 1);
    // The root's timers, read after the tree (PluginScreenOutput.frame): their lines come last; then its layout (Task 14).
    if (root !== null) {
      every = timersOf(opt(v, "every"), capped);
      layout = layoutFor(root, opt(v, SCREEN_LAYOUT.field), "screen", capped);
    }
    return root;
  });
  return { tree, dropped, every, layout };
}

/** contract.manifest.screen.layout (Task 14): the screen result's `layout` field and its values, the default first. */
export const SCREEN_LAYOUT = contract.manifest.screen.layout;

/**
 * PluginScreenOutput.layoutOf (Task 14): a screen result's `layout`; absent or null is "scroll", silently; any other value
 * outside the contract's values is logged under [where] and read as "scroll".
 */
/** PluginScreenOutput.layoutFor (Task 17 item G): a Scaffold root is always "fill" (another layout given: ignored, logged). */
export function layoutFor(root, v, where, log) {
  const l = layoutOf(v, where, log);
  if (root === null || root.type !== "scaffold") return l;
  if (!absent(v) && l !== "fill") log(`${where}: a Scaffold root is drawn as layout fill, its layout ignored`);
  return "fill";
}

export function layoutOf(v, where, log) {
  if (absent(v)) return SCREEN_LAYOUT.values[0];
  if (SCREEN_LAYOUT.values.includes(v)) return v;
  log(`${where}: layout ${fmt(v)} is not ${SCREEN_LAYOUT.values.join(" or ")}, read as ${SCREEN_LAYOUT.values[0]}`);
  return SCREEN_LAYOUT.values[0];
}

/**
 * PluginScreenOutput.timers: the manifest's `screen.every` (one timer or a list of them) as the app reads it at open,
 * `{ every, dropped }`. A bad timer is dropped and said, never refused.
 */
export function checkScreenTimers(value) {
  const dropped = [];
  const v = wire(value);
  const every = cappedLog((line) => dropped.push(line), "screen", (capped) => timersOf(v, capped));
  return { every, dropped };
}

/**
 * PluginScreenOutput.timersOf: `every` is `{ ms, event }` or a list of at most maxTimers; each needs a valid event name
 * (never `open`, never repeated) and a number `ms`, raised to minTimerMs or lowered to maxTimerMs (whole milliseconds).
 */
function timersOf(raw, log) {
  if (absent(raw)) return [];
  let list;
  if (isObj(raw)) list = [raw];
  else if (Array.isArray(raw)) list = raw;
  else { log("screen: every is not a timer or a list of timers, dropped"); return []; }
  if (list.length > LIMITS.maxTimers) log(`screen: every keeps ${LIMITS.maxTimers} timers, the rest dropped`);
  const out = [];
  list.slice(0, LIMITS.maxTimers).forEach((t, i) => {
    const where = `screen: every timer ${i}`;
    if (!isObj(t)) { log(`${where} is not an object, dropped`); return; }
    const event = opt(t, "event");
    if (typeof event !== "string" || !ID.test(event)) { log(`${where} event ${fmt(event)} is not a valid name, dropped`); return; }
    if (event === RESERVED_EVENT) { log(`${where} event "${RESERVED_EVENT}" is reserved, dropped`); return; }
    if (out.some((x) => x.event === event)) { log(`${where} repeats event "${event}", dropped`); return; }
    const v = opt(t, "ms");
    if (typeof v !== "number" || !Number.isFinite(v)) { log(`${where} ms ${fmt(v)} is not a number, dropped`); return; }
    let ms;
    if (v < LIMITS.minTimerMs) { ms = LIMITS.minTimerMs; log(`${where} ms ${fmt(v)} is below ${LIMITS.minTimerMs}, raised to ${LIMITS.minTimerMs}`); }
    else if (v > LIMITS.maxTimerMs) { ms = LIMITS.maxTimerMs; log(`${where} ms ${fmt(v)} is above ${LIMITS.maxTimerMs}, lowered to ${LIMITS.maxTimerMs}`); }
    else ms = Math.floor(v);
    out.push({ ms, event });
  });
  return out;
}

const EMPTY_ANSWER = { state: null, dialog: null, sheet: null, menu: null, toast: null, go: null, route: null, close: false, focus: null, config: null, ui: [] };
export { EMPTY_ANSWER };

/**
 * The app's `PluginScreenOutput.answer`: `{ answer, dropped }`. `null` is the empty answer, anything but an object is null
 * (logged). [settings]: the manifest's `settings`, which the answer's `config` may write (absent: every key dropped).
 */
export function checkScreenAnswer(value, lang = "es", { allowSeries = true, settings, timer = false, dismiss = false } = {}) {
  const dropped = [];
  const v = wire(value);
  let answer = cappedLog((line) => dropped.push(line), "screen", (capped) => {
    if (v === null) return { ...EMPTY_ANSWER };
    if (!isObj(v)) { capped("screen: the answer is not a JSON object"); return null; }
    return answerOf(v, lang, capped, allowSeries, settingsModel(settings));
  });
  // A timer's tick (PluginScreenOutput.forTimer): its pop-ups, focus, go and route are dropped, each said.
  if (timer && answer !== null) answer = forTimer(answer, (line) => dropped.push(line));
  // The answer to a pop-up's onClose event (PluginScreenOutput.forDismiss).
  if (dismiss && answer !== null) answer = forDismiss(answer, (line) => dropped.push(line));
  return { answer, dropped };
}

/**
 * PluginScreenOutput.forDismiss (Task 7i-2 fix round 1): the answer to a declared pop-up's onClose event drops
 * dismissDroppedFields and the dismissDroppedOps of its ui, each logged: Back always closes.
 */
export function forDismiss(a, log) {
  const fields = DISMISS_DROPPED_FIELDS.filter((f) => a[f]);
  for (const f of fields) log(`screen: a pop-up's onClose answer.${f} is dropped (closing a pop-up never opens, moves or navigates)`);
  const ui = (a.ui || []).filter((op) => {
    const k = Object.keys(op)[0];
    const drop = DISMISS_DROPPED_OPS.includes(k);
    if (drop) log(`screen: a pop-up's onClose answer.ui ${k} "${String(op[k]).slice(0, 40)}" is dropped (closing a pop-up never opens one or moves focus)`);
    return !drop;
  });
  if (fields.length === 0 && ui.length === (a.ui || []).length) return a;
  return { ...a, dialog: null, sheet: null, menu: null, focus: null, go: null, route: null, ui };
}

/**
 * PluginScreenOutput.forTimer: an answer as a timer's tick may use it (manifest.screen.timerAnswerFields): `dialog`,
 * `sheet`, `menu`, `focus`, `go` and `route` dropped, each logged.
 */
export function forTimer(a, log) {
  const fields = ["dialog", "sheet", "menu", "focus", "go", "route"].filter((f) => a[f]);
  if (a.ui && a.ui.length > 0) fields.push("ui");
  if (fields.length === 0) return a;
  for (const f of fields) log(`screen: a timer's answer.${f} is dropped (a timer's answer keeps only ${S.timerAnswerFields.join(", ")})`);
  return { ...a, dialog: null, sheet: null, menu: null, focus: null, go: null, route: null, ui: [] };
}

/**
 * PluginScreenOutput.configOf: an answer's `config`, the plugin's own settings to write. Only a declared key of a type a
 * screen may write, with a value that fits it; keys sorted, at most maxConfigKeys; the rest dropped, logged. Null when none.
 */
function configOf(raw, settings, log) {
  if (absent(raw)) return null;
  if (!isObj(raw)) { log("screen: answer.config is not an object, dropped"); return null; }
  const keys = Object.keys(raw).sort();
  if (keys.length > LIMITS.maxConfigKeys) log(`screen: answer.config has ${keys.length} keys, the first ${LIMITS.maxConfigKeys} kept`);
  const out = {};
  let any = false;
  for (const k of keys.slice(0, LIMITS.maxConfigKeys)) {
    const where = `screen: answer.config.${k.slice(0, 40)}`;
    const s = settings?.find((x) => x.key === k);
    if (!s) { log(`${where} is not one of this plugin's settings, dropped`); continue; }
    if (!S.configTypes.includes(s.type)) { log(`${where} is of type ${s.type}, never written from a screen, dropped`); continue; }
    const v = configValue(s, raw[k], (line) => log(`${where} ${line}`));
    if (v.why !== undefined) { log(`${where} ${v.why}, dropped`); continue; }
    out[k] = v.value;
    any = true;
  }
  return any ? out : null;
}

function answerOf(o, lang, log, allowSeries = true, settings = null) {
  for (const k of Object.keys(o).sort()) if (!ANSWER_KEYS.includes(k)) log(`screen: answer.${k.slice(0, 40)} is not an answer field, ignored`);
  const reader = new Reader(lang, new Set(WIDGETS), log, allowSeries, settings);
  let state = null;
  const s = opt(o, "state");
  if (absent(s)) state = null;
  else if (isObj(s)) {
    if (fits(s)) state = s;
    else log(`screen: answer.state is ${bytes(s)} bytes, over ${LIMITS.maxStateBytes}, refused`);
  } else log("screen: answer.state is not an object, dropped");
  let toast = null;
  const t = opt(o, "toast");
  if (absent(t)) toast = null;
  else if (typeof t === "string") { const text = reader.text(o, "toast"); toast = text === "" ? null : { text, role: null, action: null, ms: LIMITS.toastDefaultMs }; }
  else if (isObj(t)) toast = reader.toast(t);
  else log("screen: answer.toast is not a text or an object, dropped");
  let go = null;
  const g = opt(o, "go");
  if (absent(g)) go = null;
  else if (isObj(g)) go = reader.goOf(g, "screen: answer");
  else log("screen: answer.go is not an object, dropped");
  let focus = null;
  const f = opt(o, "focus");
  if (absent(f)) focus = null;
  else if (typeof f === "string" && ID.test(f)) focus = f;
  else log("screen: answer.focus is not a valid key, dropped");
  const dialog = dialogOf(opt(o, "dialog"), reader, log);
  let sheet = null;
  const sh = opt(o, "sheet");
  if (absent(sh)) sheet = null;
  else if (isObj(sh)) sheet = reader.sheet(sh);
  else log("screen: answer.sheet is not an object, dropped");
  let menu = null;
  const m = opt(o, "menu");
  if (absent(m)) menu = null;
  else if (isObj(m)) menu = reader.menu(m);
  else log("screen: answer.menu is not an object, dropped");
  // One pop-up at a time: a dialog wins over a sheet, a sheet over a menu.
  const kept = [dialog && "dialog", sheet && "sheet", menu && "menu"].filter(Boolean);
  if (kept.length > 1) {
    log(`screen: answer has ${kept.length} pop-ups, only the ${kept[0]} kept (one pop-up at a time)`);
    if (dialog) { sheet = null; menu = null; } else menu = null;
  }
  const route = routeOf(opt(o, "route"), log);
  const config = configOf(opt(o, "config"), settings, log);
  // Last, so its log lines come after the other fields' (as a panel answer's always did).
  const ui = reader.uiOf(opt(o, "ui"), "screen: answer");
  return { state, dialog, sheet, menu, toast, go, route, close: opt(o, "close") === true, focus, config, ui };
}

/** One dialog, or the last of an array of them: one pop-up at a time (maxPopups). */
function dialogOf(raw, reader, log) {
  if (absent(raw)) return null;
  if (isObj(raw)) return reader.dialog(raw);
  if (Array.isArray(raw)) {
    if (raw.length > LIMITS.maxPopups) log(`screen: answer has ${raw.length} dialogs, only the last kept (one pop-up at a time)`);
    if (raw.length === 0) return null;
    const last = raw[raw.length - 1];
    if (isObj(last)) return reader.dialog(last);
    log("screen: answer.dialog is not an object, dropped");
    return null;
  }
  log("screen: answer.dialog is not an object, dropped");
  return null;
}

function routeOf(raw, log) {
  if (absent(raw)) return null;
  if (!isObj(raw)) { log("screen: answer.route is not an object, dropped"); return null; }
  let push = null;
  const p = opt(raw, "push");
  if (!absent(p)) {
    if (typeof p === "string" && ID.test(p)) push = p;
    else { log("screen: answer.route.push is not a valid name, dropped"); return null; }
  }
  const pop = opt(raw, "pop") === true;
  if (push !== null && pop) { log("screen: answer.route has both push and pop, dropped"); return null; }
  if (push === null && !pop) { log("screen: answer.route has neither push nor pop, dropped"); return null; }
  let params = null;
  const q = opt(raw, "params");
  if (absent(q)) params = null;
  else if (isObj(q)) {
    if (fits(q)) params = q;
    else log(`screen: answer.route.params is over ${LIMITS.maxStateBytes} bytes, dropped`);
  } else log("screen: answer.route.params is not an object, dropped");
  return { push, pop, params };
}

// ---------- the player panel in screen mode (Task 8i: PanelScreenOutput) ----------

/** contract.output.panel.screen: the screen-format panel's limits and fields. */
export const PANEL_SCREEN = contract.output.panel.screen;
const NO_EVERY = "panel: every is not available in the player panel (refreshMs is its periodic call), dropped";
const LAYOUT_ON_ROOT = "panel: layout belongs on the panel result beside root, the root's is ignored";

/**
 * PanelScreenOutput.isScreen: whether a `panel` result is a screen-format panel (`format: "screen"` from a plugin of apiVersion
 * 14 or later). A screen format below it, or an unknown `format`, is logged and read as a legacy panel.
 */
export function isPanelScreen(value, apiVersion, log = () => {}) {
  if (!isObj(value)) return false;
  const f = opt(value, "format");
  if (absent(f)) return false;
  if (f !== PANEL_SCREEN.format) { log(`panel: format "${String(f).slice(0, 20)}" is not known, read as a legacy panel`); return false; }
  if (!(apiVersion >= PANEL_SCREEN.apiVersion)) { log(`panel: format "${PANEL_SCREEN.format}" needs apiVersion ${PANEL_SCREEN.apiVersion}, read as a legacy panel`); return false; }
  return true;
}

/**
 * The app's `PanelScreenOutput.frame`: `{ panel, dropped }`, `panel` = `{ root, title, accent, refreshMs, tabs, tab }` of a
 * screen-format `panel` result, or null (the whole panel invalid: not an object, or no root node). The root is read like a
 * screen's tree with the panel's limits (depth maxDepth, maxNodes nodes, no popup); `every` is dropped (refreshMs is the
 * panel's periodic call). [settings]: the manifest's `settings`.
 */
export function checkPanelScreen(value, lang = "es", { allowSeries = true, settings } = {}) {
  const dropped = [];
  const v = wire(value);
  const panel = cappedLog((line) => dropped.push(line), "panel", (capped) => {
    if (!isObj(v)) { capped("panel: the answer is not a JSON object"); return null; }
    for (const k of Object.keys(v).sort()) {
      if (k === "format" || k === "root" || PANEL_SCREEN.resultFields.includes(k)) continue;
      if (k === "every") capped(NO_EVERY);
      else capped(`panel: ${k.slice(0, 40)} is not a field of a screen-format panel, ignored`);
    }
    const title = localized(v, "title", lang).slice(0, contract.output.panel.maxTitleChars);
    const tabs = panelTabsOf(opt(v, "tabs"), lang, capped);
    const wanted = typeof opt(v, "tab") === "string" ? v.tab : null;
    const tab = wanted !== null && tabs.some((t) => t.id === wanted) ? wanted : tabs.length ? tabs[0].id : null;
    if (wanted !== null && tab !== wanted) capped(`panel: tab "${wanted.slice(0, 40)}" names no tab`);
    const accent = panelAccentOf(opt(v, "accent"), capped);
    const refreshMs = panelRefreshOf(opt(v, "refreshMs"), capped);
    const raw = opt(v, "root");
    if (!isObj(raw)) { capped("panel: root is not a node, the whole panel invalid"); return null; }
    if (has(raw, "every")) capped(NO_EVERY);
    // Task 14: a panel's layout sits on the result, beside root (a screen's sits on its root object).
    if (has(raw, SCREEN_LAYOUT.field)) capped(LAYOUT_ON_ROOT);
    const root = new Reader(lang, new Set(WIDGETS), capped, allowSeries, settingsModel(settings), { maxDepth: PANEL_SCREEN.maxDepth, maxNodes: PANEL_SCREEN.maxNodes, inPanel: true }).node(raw, 1);
    if (root === null) return null;
    // Task 8j: the result's own player (a refreshMs tick's): honoured only with the playerControl capability.
    const player = panelPlayerOf(opt(v, "player"), capped);
    // Task 17 item G: a Scaffold root is always drawn in the fill layout.
    const layout = layoutFor(root, opt(v, SCREEN_LAYOUT.field), "panel", capped);
    return { root, title, accent, refreshMs, tabs, tab, layout, ...(player ? { player } : {}) };
  });
  return { panel, dropped };
}

/**
 * The app's `PanelScreenOutput.answer`: `{ answer, dropped }` of a `panelAction` answer while the panel is in screen mode. The
 * screen answer's state, toast, ui, config, go, close and focus (go takes every shape), plus the legacy player, message,
 * pause and panel; dialog, sheet, menu and route are dropped (not honoured inside the panel), patch, values and save too (legacy
 * fields), each logged. `null` is the empty answer, anything but an object is null.
 */
export function checkPanelScreenAnswer(value, lang = "es", { allowSeries = true, settings } = {}) {
  const dropped = [];
  const v = wire(value);
  const answer = cappedLog((line) => dropped.push(line), "panel", (capped) => {
    if (v === null) return { ...EMPTY_ANSWER, ui: [], player: null, message: null, pause: false, panel: null };
    if (!isObj(v)) { capped("panel: the action answer is not a JSON object"); return null; }
    const kept = {};
    for (const k of Object.keys(v).sort()) {
      if (PANEL_SCREEN.droppedAnswerFields.includes(k)) capped(`panel: answer.${k} is not honoured inside the panel, dropped`);
      else if (PANEL_SCREEN.legacyAnswerFields.includes(k)) capped(`panel: answer.${k} is a legacy panel field, not used by a screen-format panel, dropped`);
      else if (PANEL_SCREEN.answerFields.includes(k)) { if (ANSWER_KEYS.includes(k)) kept[k] = v[k]; }
      else capped(`panel: answer.${k.slice(0, 40)} is not an answer field, ignored`);
    }
    const model = settingsModel(settings);
    // Its `ui` operations are read with the rest, as every screen answer's (Task 7i-2).
    const a = answerOf(kept, lang, capped, allowSeries, model);
    let panel = null;
    const p = opt(v, "panel");
    if (isObj(p)) panel = p;
    else if (!absent(p)) capped("panel: answer.panel is not an object, dropped");
    const player = panelPlayerOf(opt(v, "player"), capped);
    const message = panelMessageOf(opt(v, "message"), capped);
    return { ...a, player, message, pause: opt(v, "pause") === true, panel };
  });
  return { answer, dropped };
}

/** The summary of a screen-mode panel answer's fields, as the shared case table spells it (answerFields, then the panel's own). */
export function panelAnswerFields(a) {
  return [...answerFields(a), a.player && "player", a.message && "message", a.pause && "pause", a.panel && "panel"].filter(Boolean);
}

/**
 * The `panel(context)` argument of a screen-format panel: the panel's context (panel.mjs fakeContext) plus `state` (Kino's,
 * `{ inputs, ui }`) and `size` (the drawer's size classes).
 */
export function fakePanelScreenContext(context, over = {}) {
  const base = fakeScreenContext();
  // `features` carries "screen" only while plugin screens are on (the kit: always).
  const features = [...(Array.isArray(context.features) ? context.features : []), PANEL_SCREEN.contextFeature];
  return { ...context, features, state: over.state ?? base.state, size: over.size ?? base.size };
}

// ---------- responsive resolution (PluginScreenOutput.resolveResponsive) ----------

/**
 * [tree] as drawn on [device] at [widthClass]: null when its `devices` or `sizes` leave it out; otherwise its per-size
 * values resolved for [widthClass] and its children resolved the same way, with no `devices`, `sizes` or per-class
 * copies left. An unknown [device] counts as `phone`, an unknown [widthClass] as `compact` (never throws).
 */
export function resolveResponsive(tree, device, widthClass) {
  const d = DEVICES.includes(device) ? device : DEVICES[0];
  const w = SIZE_CLASSES.includes(widthClass) ? widthClass : SIZE_CLASSES[0];
  return resolveNode(tree, d, w);
}

function resolveNode(n, device, widthClass) {
  if (n.devices !== null && !n.devices.includes(device)) return null;
  if (n.sizes !== null && !n.sizes.includes(widthClass)) return null;
  const own = n.byClass[widthClass] ?? n;
  const out = { ...own, devices: null, sizes: null, byClass: {} };
  const kids = (list) => list.map((c) => resolveNode(c, device, widthClass)).filter((c) => c !== null);
  // `own` holds this class's own fields and no children: the children are the node's.
  if (Array.isArray(n.children)) out.children = kids(n.children);
  if (n.type === "list") {
    out.items = kids(n.items);
    out.empty = n.empty ? resolveNode(n.empty, device, widthClass) : null;
  }
  if (n.type === "heroCard") out.buttons = kids(n.buttons);
  // Task 17: a tile's slots and a page view's pages are the node's, read once.
  if (n.type === "listTile") { out.leading = n.leading ? resolveNode(n.leading, device, widthClass) : null; out.trailing = n.trailing ? resolveNode(n.trailing, device, widthClass) : null; }
  if (n.type === "scaffold") {
    for (const k of ["appBar", "body", "fab", "bottomBar"]) out[k] = n[k] ? resolveNode(n[k], device, widthClass) : null;
  }
  if (n.type === "appBar") { out.leading = n.leading ? resolveNode(n.leading, device, widthClass) : null; out.titleNode = n.titleNode ? resolveNode(n.titleNode, device, widthClass) : null; out.actions = kids(n.actions); out.bottom = n.bottom ? resolveNode(n.bottom, device, widthClass) : null; }
  if (n.type === "pageView") { out.pages = kids(n.pages); out.initialPage = Math.min(n.initialPage, Math.max(0, out.pages.length - 1)); }
  // The fallback is read once, with the base node: each class's copy draws it too.
  if (n.type === "image") out.fallback = n.fallback ? resolveNode(n.fallback, device, widthClass) : null;
  if (n.type === ACCORDION) out.items = n.items.map((it) => ({ ...it, children: kids(it.children) }));
  if (n.type === STEPS) out.items = n.items.map((it) => ({ ...it, children: kids(it.children) }));
  // This class's columns, spans and aligns (its own copy), the node's cells' children; fitted to the class's columns.
  if (n.type === TABLE) {
    const count = Math.max(1, own.columns.length);
    const rows = [];
    for (let i = 0; i < Math.min(own.rows.length, n.rows.length); i++) {
      const mine = own.rows[i].cells;
      const read = n.rows[i].cells;
      const cells = [];
      for (let j = 0; j < Math.min(mine.length, read.length); j++) cells.push({ ...mine[j], text: read[j].text, children: kids(read[j].children) });
      rows.push({ cells: fitTableRow(cells, count).cells, key: n.rows[i].key, hidden: n.rows[i].hidden });
    }
    out.rows = rows;
  }
  return out;
}

// ---------- the nodes as a person reads them ----------

/** The direct child nodes of [n] (a list's items and its empty node included), in drawing order. */
export function childNodes(n) {
  if (Array.isArray(n.children)) return n.children;
  if (n.type === "list") return n.empty ? [...n.items, n.empty] : n.items;
  if (n.type === "heroCard") return n.buttons;
  if (n.type === "listTile") return [n.leading, n.trailing].filter(Boolean);
  if (n.type === "pageView") return n.pages;
  if (n.type === "scaffold") return [n.appBar, n.body, n.fab, n.bottomBar].filter(Boolean);
  if (n.type === "appBar") return [n.leading, n.titleNode, ...n.actions, n.bottom].filter(Boolean);
  if (n.type === "image") return n.fallback ? [n.fallback] : [];
  if (n.type === ACCORDION) return n.items.flatMap((it) => it.children);
  if (n.type === STEPS) return n.items.flatMap((it) => it.children);
  if (n.type === TABLE) return n.rows.flatMap((r) => r.cells.flatMap((c) => c.children));
  return [];
}

/** The titles a component node draws (none for every other node). */
export function titleItems(n) {
  if (n.type === "titleCard") return [n.item];
  if (n.type === "titleRail" || n.type === "titleGrid") return n.items;
  return [];
}

/** How many titles [n] holds in all (per-size copies not counted). */
export function countTitles(n) {
  return titleItems(n).length + childNodes(n).reduce((sum, c) => sum + countTitles(c), 0);
}

/** How many nodes [n] holds (per-size copies and dialog bodies not counted). */
export function countNodes(n) {
  return 1 + childNodes(n).reduce((sum, c) => sum + countNodes(c), 0);
}

/** [n] for printing: nulls, defaults and empty per-size copies left out, so what remains is what the plugin set or Kino filled in. */
export function printScreenTree(n) {
  return JSON.parse(JSON.stringify(n, (k, v) => {
    if (v === null || v === undefined) return undefined;
    if (k === "enabled" && v === true) return undefined;
    if (k === "hidden" && v === false) return undefined;
    if ((k === "fill" || k === "close" || k === "pop" || k === "withheld" || k === "autofocus" || k === "newItemsHint") && v === false) return undefined;
    if (k === "byClass" && isObj(v) && Object.keys(v).length === 0) return undefined;
    if (k === "field" && isObj(v) && Object.values(v).every((x) => x === null || x === false)) return undefined;
    if (k === "style" && isObj(v) && Object.values(v).every((x) => x === null || x === false)) return undefined;
    return v;
  }));
}

/** The summary of an answer's fields, as the shared case table spells it. */
export function answerFields(a) {
  return [a.state && "state", a.dialog && "dialog", a.sheet && "sheet", a.menu && "menu", a.toast && "toast", a.go && "go", a.route && "route", a.close && "close", a.focus && "focus", a.config && "config", a.ui && a.ui.length > 0 && "ui"].filter(Boolean);
}

// ---------- forms (ScreenPatterns, ScreenForms) ----------

// Kino's OWN pattern matcher, a port of PluginScreenForms.kt line by line: a recursive-descent parser over the subset, a
// Thompson NFA program, and a Pike VM. Never RegExp, and every cost is bounded whatever the pattern: compiling does at
// most maxPatternCompileWork units of work (a node that costs no step is never copied); a match visits each program step
// at most once per character, each visit O(1) (a class is a 128-entry ASCII table plus a binary search of merged ranges),
// so it costs about the value's length times the program's size; one form check runs at most maxPatternMatchWork visits.
// Characters are UTF-16 code units, on both sides.
const PATTERN_QUANTIFIERS = "*+?{";
const PATTERN_CLASS_ESCAPES = "dDwWsS";
const PATTERN_PUNCTUATION = "\\^$.|?*+()[]{}-/";

class PatternRefused {
  constructor(why) { this.why = why; }
}
const refuse = (why) => { throw new PatternRefused(why); };

const isDigit = (c) => c >= 48 && c <= 57;
const isWord = (c) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13);
function escapeHas(e, c) {
  switch (e) {
    case "d": return isDigit(c); case "D": return !isDigit(c);
    case "w": return isWord(c); case "W": return !isWord(c);
    case "s": return isSpace(c); case "S": return !isSpace(c);
    default: return false;
  }
}
/**
 * Ranges (inclusive pairs of code units, any order) and class escapes, maybe negated (ScreenPatterns.CharSet): a
 * 128-entry ASCII table, and above it a binary search of the merged ranges (every class escape is ASCII, so above 128
 * \D \W \S always hold and \d \w \s never do).
 */
function charSet(ranges, escapes, negated) {
  const pairs = [];
  for (let i = 0; i < ranges.length; i += 2) pairs.push([ranges[i], ranges[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const starts = [], ends = [];
  for (const [lo, hi] of pairs) {
    if (ends.length > 0 && lo <= ends[ends.length - 1] + 1) { if (hi > ends[ends.length - 1]) ends[ends.length - 1] = hi; }
    else { starts.push(lo); ends.push(hi); }
  }
  const set = { starts, ends, negated, aboveAsciiEscape: [...escapes].some((e) => e === "D" || e === "W" || e === "S"), ascii: new Uint8Array(128) };
  for (let c = 0; c < 128; c++) set.ascii[c] = (inRanges(set, c) || [...escapes].some((e) => escapeHas(e, c))) !== negated ? 1 : 0;
  return set;
}
function inRanges(set, c) {
  let lo = 0, hi = set.starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (c < set.starts[mid]) hi = mid - 1;
    else if (c > set.ends[mid]) lo = mid + 1;
    else return true;
  }
  return false;
}
const setHas = (set, c) => (c < 128 ? set.ascii[c] === 1 : (set.aboveAsciiEscape || inRanges(set, c)) !== set.negated);
const DOT = charSet([10, 10, 13, 13, 0x2028, 0x2029], "", true);
/** The literal code unit of escape `\e` (n, r, t or punctuation), or -1. */
const literalOf = (e) => (e === "n" ? 10 : e === "r" ? 13 : e === "t" ? 9 : PATTERN_PUNCTUATION.includes(e) ? e.charCodeAt(0) : -1);
const isBackref = (e) => (e >= "1" && e <= "9") || e === "k";

/** ScreenPatterns.Parser: the first problem met is the reason. */
class PatternParser {
  constructor(p) { this.p = p; this.i = 0; }

  parse() {
    const n = this.alt();
    if (this.i < this.p.length) refuse("has unbalanced brackets");
    return n;
  }

  alt() {
    const options = [this.seq()];
    while (this.i < this.p.length && this.p[this.i] === "|") { this.i++; options.push(this.seq()); }
    return options.length === 1 ? options[0] : { t: "alt", options };
  }

  seq() {
    const items = [];
    const p = this.p;
    while (this.i < p.length && p[this.i] !== "|" && p[this.i] !== ")") {
      const atom = this.atom();
      if (atom.t === "assert") {
        if (this.i < p.length && PATTERN_QUANTIFIERS.includes(p[this.i])) { this.count(); refuse("has a quantifier with nothing to repeat"); }
        items.push(atom);
        continue;
      }
      items.push(this.quantified(atom));
    }
    return { t: "seq", items };
  }

  quantified(atom) {
    const p = this.p;
    if (this.i >= p.length || !PATTERN_QUANTIFIERS.includes(p[this.i])) return atom;
    const [min, max] = this.count();
    if (this.i < p.length && p[this.i] === "?") this.i++; // lazy: the same to a yes/no match
    if (this.i < p.length && PATTERN_QUANTIFIERS.includes(p[this.i])) refuse("has a possessive or doubled quantifier");
    return { t: "repeat", node: atom, min, max };
  }

  count() {
    const p = this.p;
    const c = p[this.i];
    if (c !== "{") {
      this.i++;
      return c === "*" ? [0, -1] : c === "+" ? [1, -1] : [0, 1];
    }
    const close = p.indexOf("}", this.i);
    const parts = close < 0 ? null : p.slice(this.i + 1, close).split(",");
    if (parts === null || parts.length > 2 || parts[0] === "" || !parts.every((x) => /^[0-9]*$/.test(x))) refuse("uses a construct outside the safe subset");
    if (parts.some((x) => x.length > 4 || (x !== "" && Number(x) > LIMITS.maxPatternRepeat))) refuse(`repeats more than ${LIMITS.maxPatternRepeat} times`);
    const min = Number(parts[0]);
    const max = parts.length === 1 ? min : parts[1] === "" ? -1 : Number(parts[1]);
    if (max >= 0 && max < min) refuse("has a range or a count out of order");
    this.i = close + 1;
    return [min, max];
  }

  atom() {
    const p = this.p;
    const c = p[this.i];
    switch (c) {
      case "\\": {
        const e = p[this.i + 1];
        if (e === undefined) refuse("has an escape outside the safe subset");
        if (isBackref(e)) refuse("has a backreference");
        this.i += 2;
        if (e === "b" || e === "B") return { t: "assert", kind: e };
        if (PATTERN_CLASS_ESCAPES.includes(e)) return { t: "one", set: charSet([], e, false) };
        const l = literalOf(e);
        if (l < 0) refuse("has an escape outside the safe subset");
        return { t: "one", set: charSet([l, l], "", false) };
      }
      case "[": return this.charClass();
      case "(": {
        if (p[this.i + 1] === "?") {
          if (p[this.i + 2] !== ":") refuse("uses a lookaround or a group flag");
          this.i += 3;
        } else this.i++;
        const inner = this.alt();
        if (this.i >= p.length || p[this.i] !== ")") refuse("has unbalanced brackets");
        this.i++;
        return inner;
      }
      case "^": case "$": this.i++; return { t: "assert", kind: c };
      case "]": case "}": return refuse("uses a construct outside the safe subset");
      case "*": case "+": case "?": case "{": this.count(); return refuse("has a quantifier with nothing to repeat");
      case ".": this.i++; return { t: "one", set: DOT };
      default: { this.i++; const u = c.charCodeAt(0); return { t: "one", set: charSet([u, u], "", false) }; }
    }
  }

  /** One class member at [j]: [code unit or -2 - escape index, next j]. */
  member(j) {
    const p = this.p;
    const d = p[j];
    if (d !== "\\") return [d.charCodeAt(0), j + 1];
    const e = p[j + 1];
    if (e === undefined) refuse("has an escape outside the safe subset");
    if (isBackref(e)) refuse("has a backreference");
    if (PATTERN_CLASS_ESCAPES.includes(e)) return [-2 - PATTERN_CLASS_ESCAPES.indexOf(e), j + 2];
    const l = literalOf(e);
    if (l < 0) refuse("has an escape outside the safe subset");
    return [l, j + 2];
  }

  charClass() {
    const p = this.p;
    let j = this.i + 1;
    const negated = p[j] === "^";
    if (negated) j++;
    const start = j;
    const ranges = [];
    let escapes = "";
    for (;;) {
      if (j >= p.length) refuse("has unbalanced brackets");
      const d = p[j];
      if (d === "]") {
        if (j === start) refuse("uses a construct outside the safe subset");
        break;
      }
      if (d === "[") refuse("uses a construct outside the safe subset");
      if (d === "&" && p[j + 1] === "&") refuse("uses a construct outside the safe subset");
      const [lo, next] = this.member(j);
      j = next;
      if (lo < 0) { escapes += PATTERN_CLASS_ESCAPES[-2 - lo]; continue; }
      // `a-z` is a range; a `-` first, last or after a range or an escape is itself.
      if (p[j] === "-" && j + 1 < p.length && p[j + 1] !== "]") {
        const [hi, after] = this.member(j + 1);
        if (hi < 0) refuse("uses a construct outside the safe subset"); // `[a-\d]`
        if (hi < lo) refuse("has a range or a count out of order");
        ranges.push(lo, hi);
        j = after;
      } else ranges.push(lo, lo);
    }
    this.i = j + 1;
    return { t: "one", set: charSet(ranges, escapes, negated) };
  }
}

const P_CHAR = 0, P_SPLIT = 1, P_JMP = 2, P_ASSERT = 3, P_MATCH = 4;

/** ScreenPatterns.Compiler: the program as parallel arrays. */
function compilePattern(p) {
  const prog = { op: [], x: [], y: [], sets: [], asserts: [] };
  // Every compile and empty call, against maxPatternCompileWork: no shape can spin.
  let work = 0;
  const tick = () => { if (++work > LIMITS.maxPatternCompileWork) refuse(`takes too much work to compile (over ${LIMITS.maxPatternCompileWork} steps)`); };
  // Whether a node compiles to no step at all (an empty group, anything counted {0}): repeating it is still nothing.
  const empty = (n) => {
    tick();
    switch (n.t) {
      case "seq": return n.items.every(empty);
      case "repeat": return n.max === 0 || empty(n.node);
      default: return false;
    }
  };
  const emit = (o, a = 0, b = 0, set = null, kind = " ") => {
    if (prog.op.length >= LIMITS.maxPatternStates) refuse(`is too large once expanded (over ${LIMITS.maxPatternStates} steps)`);
    prog.op.push(o); prog.x.push(a); prog.y.push(b); prog.sets.push(set); prog.asserts.push(kind);
    return prog.op.length - 1;
  };
  const compile = (n) => {
    tick();
    switch (n.t) {
      case "one": emit(P_CHAR, 0, 0, n.set); break;
      case "assert": emit(P_ASSERT, 0, 0, null, n.kind); break;
      case "seq": for (const i of n.items) compile(i); break;
      case "alt": {
        const jumps = [];
        n.options.forEach((o, k) => {
          if (k < n.options.length - 1) {
            const split = emit(P_SPLIT);
            prog.x[split] = prog.op.length;
            compile(o);
            jumps.push(emit(P_JMP));
            prog.y[split] = prog.op.length;
          } else compile(o);
        });
        for (const j of jumps) prog.x[j] = prog.op.length;
        break;
      }
      case "repeat": {
        // A node that costs no step, repeated, is still nothing: never copy it.
        if (n.max === 0 || empty(n.node)) break;
        for (let k = 0; k < n.min; k++) compile(n.node);
        if (n.max < 0) {
          const split = emit(P_SPLIT);
          prog.x[split] = prog.op.length;
          compile(n.node);
          emit(P_JMP, split);
          prog.y[split] = prog.op.length;
        } else {
          for (let k = 0; k < n.max - n.min; k++) {
            const split = emit(P_SPLIT);
            prog.x[split] = prog.op.length;
            compile(n.node);
            prog.y[split] = prog.op.length;
          }
        }
        break;
      }
    }
  };
  compile(new PatternParser(p).parse());
  emit(P_MATCH);
  return prog;
}

const compiledPatterns = new Map();
function keepProgram(p, prog) {
  if (compiledPatterns.size >= 64) compiledPatterns.delete(compiledPatterns.keys().next().value);
  compiledPatterns.set(p, prog);
}
function patternProgram(p) {
  if (compiledPatterns.has(p)) return compiledPatterns.get(p);
  let prog;
  try { prog = compilePattern(p); } catch (e) { if (e instanceof PatternRefused) return null; throw e; }
  keepProgram(p, prog);
  return prog;
}

/**
 * ScreenPatterns.unsafe: null when [p] is in the subset and small enough, else why not, as the app logs it. The subset
 * (PluginScreenForms.kt has the full list): literals, `.`, `^`, `$`, `\b`, `\B`, `|`, `( )`, `(?: )`, classes, the escapes
 * \d \D \w \W \s \S \n \r \t and escaped punctuation, `* + ? {n} {n,} {n,m}` (at most maxPatternRepeat, lazy allowed),
 * nested freely; at most maxPatternStates steps once expanded. No backreferences, no lookarounds.
 */
export function unsafePattern(p) {
  try { keepProgram(p, compilePattern(p)); return null; } catch (e) { if (e instanceof PatternRefused) return e.why; throw e; }
}

/** ScreenPatterns.matches: whether the WHOLE [value] matches [p] (false when [p] is refused, [value] is over maxTextChars or the run spends all its work). */
export function matchesPattern(p, value) {
  return matchOrNull(p, value, { left: LIMITS.maxPatternMatchWork }) ?? false;
}

/** ScreenPatterns.matchOrNull: matchesPattern spending [work] ({ left }); null when it ran out. */
function matchOrNull(p, value, work) {
  if (value.length > LIMITS.maxTextChars) return false;
  const prog = patternProgram(p);
  if (prog === null) return false;
  if (work.left <= 0) return null;
  return runPattern(prog, value, work);
}

/** The Pike VM: every live thread advances one character at a time; each step is visited at most once per position. Every visit and live thread costs one unit of [work]. */
function runPattern(prog, s, work) {
  const size = prog.op.length;
  const mark = new Int32Array(size);
  let gen = 0;
  let clist = new Int32Array(size); let cn = 0;
  let nlist = new Int32Array(size); let nn = 0;
  const stack = new Int32Array(size * 2 + 2);
  const wordAt = (at) => at >= 0 && at < s.length && isWord(s.charCodeAt(at));
  const holds = (kind, at) => {
    switch (kind) {
      case "^": return at === 0;
      case "$": return at === s.length;
      case "b": return wordAt(at - 1) !== wordAt(at);
      default: return wordAt(at - 1) === wordAt(at); // "B"
    }
  };
  const add = (list, len, start, at) => {
    let n = len;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const pc = stack[--top];
      work.left--;
      if (mark[pc] === gen) continue;
      mark[pc] = gen;
      switch (prog.op[pc]) {
        case P_JMP: stack[top++] = prog.x[pc]; break;
        case P_SPLIT: stack[top++] = prog.y[pc]; stack[top++] = prog.x[pc]; break;
        case P_ASSERT: if (holds(prog.asserts[pc], at)) stack[top++] = pc + 1; break;
        default: list[n++] = pc;
      }
    }
    return n;
  };
  gen++;
  cn = add(clist, 0, 0, 0);
  for (let at = 0; at <= s.length; at++) {
    if (cn === 0) return false;
    work.left -= cn;
    if (work.left < 0) return null;
    gen++;
    nn = 0;
    for (let k = 0; k < cn; k++) {
      const pc = clist[k];
      if (prog.op[pc] === P_MATCH) { if (at === s.length) return true; }
      else if (prog.op[pc] === P_CHAR && at < s.length && setHas(prog.sets[pc], s.charCodeAt(at))) nn = add(nlist, nn, pc + 1, at + 1);
    }
    const t = clist; clist = nlist; nlist = t; cn = nn;
  }
  return false;
}

/** The fields of form node [form] in tree order: every input in it, a pop-up's body excepted. */
export function formFields(form) {
  const out = [];
  const walk = (n) => {
    if (n.type === POPUP) return;
    if (INPUTS.includes(n.type)) out.push(n);
    for (const c of childNodes(n)) walk(c);
  };
  for (const c of form.children) walk(c);
  return out;
}

/** ScreenForms.valueOf: the JSON value input [n] shows. */
export function fieldValue(n) {
  switch (n.type) {
    case "dropdown": case "radioGroup": return n.value ?? null;
    case "chips": return n.multiple ? n.value : (n.value[0] ?? null);
    // The canonical text, as ScreenForms.valueOf: what the app's submit carries.
    case STEPPER: return stepperText(n.value, n.decimals);
    default: return n.value;
  }
}

/** ScreenForms.checkField: [n]'s first failing check `{ key, check, limit }`, or null; [pattern] runs a field's pattern. */
function checkField(n, pattern) {
  const f = n.field;
  const fail = (check, limit = null) => ({ key: n.key, check, limit });
  switch (n.type) {
    case "textInput": case "textArea": {
      const v = n.value;
      // Kotlin's isBlank, as the app checks it: U+FEFF is not blank there, U+001C..U+001F are.
      if (kotlinBlank(v)) return f.required ? fail("required") : null;
      if (f.minLength !== null && v.length < f.minLength) return fail("minLength", f.minLength);
      if (f.maxLength !== null && v.length > f.maxLength) return fail("maxLength", f.maxLength);
      if (f.pattern !== null && !pattern(f.pattern, v)) return fail("pattern");
      return null;
    }
    case "chips": {
      if (n.value.length === 0) return f.required ? fail("required") : null;
      if (f.minLength !== null && n.value.length < f.minLength) return fail("minLength", f.minLength);
      if (f.maxLength !== null && n.value.length > f.maxLength) return fail("maxLength", f.maxLength);
      return null;
    }
    case "dropdown": case "radioGroup": return f.required && n.value === null ? fail("required") : null;
    case "toggle": case "checkbox": return f.required && !n.value ? fail("required") : null;
    default: return null;
  }
}

/**
 * The app's form check (ScreenForms.check / values), on the tree as `screen` returned it (each field's own `value`):
 * `{ errors, value, dropped }` for the form keyed [formKey] in [tree] (a node from checkScreenTree), or null when there
 * is none. `errors` lists every failing field `{ key, check, limit }` in tree order (a hidden or disabled field, or one
 * inside a hidden or disabled container, is not checked; at most maxPatternFields patterns and maxPatternMatchWork
 * matcher visits in all, the rest logged in `dropped`);
 * `value` is the submit event's value, every field's value by key, a secret (`obscureText`) field's left out: `secrets`
 * names those, whose typed text the app writes into the call only as it goes out. On a phone or TV the person's input is in the fields;
 * with errors Kino shows them and calls nothing.
 */
export function checkScreenForm(tree, formKey) {
  const find = (n) => (n.key === formKey ? n : childNodes(n).map(find).find((x) => x) ?? null);
  const form = find(tree);
  if (form === null || form.type !== FORM) return null;
  const errors = [];
  const dropped = [];
  let patterns = 0;
  let overLogged = false;
  let workLogged = false;
  const work = { left: LIMITS.maxPatternMatchWork };
  const pattern = (p, v) => {
    if (patterns >= LIMITS.maxPatternFields) {
      if (!overLogged) { overLogged = true; dropped.push(`screen: a form checks at most ${LIMITS.maxPatternFields} patterns, the rest not checked`); }
      return true;
    }
    patterns++;
    const r = matchOrNull(p, v, work);
    if (r !== null) return r;
    if (!workLogged) { workLogged = true; dropped.push(`screen: a form's patterns took over ${LIMITS.maxPatternMatchWork} steps, the rest not checked`); }
    return true;
  };
  const walk = (n, live) => {
    if (n.type === POPUP) return;
    const on = live && !n.hidden && n.enabled;
    if (on && INPUTS.includes(n.type)) { const e = checkField(n, pattern); if (e !== null) errors.push(e); }
    // A hidden table row is like a hidden node: nothing in it is checked (ScreenForms.check).
    if (n.type === TABLE) { for (const r of n.rows) for (const cell of r.cells) for (const c of cell.children) walk(c, on && !r.hidden); return; }
    for (const c of childNodes(n)) walk(c, on);
  };
  for (const c of form.children) walk(c, !form.hidden && form.enabled);
  // A secret field is left out of `value` here, as ScreenForms.values: the app writes its text in only as the call goes out.
  const value = {};
  const secrets = [];
  for (const f of formFields(form)) if (f.secret) secrets.push(f.key); else value[f.key] = fieldValue(f);
  return { errors, value, secrets, dropped };
}

// ---------- the fake context (spec "The plugin side") ----------

/**
 * What the kit hands `screen(context)`: `{ state, route, device, size, lang }`, the shapes the app's PluginScreenSession
 * sends: `route` is `{ name, params }` (`"main"` at the root), `size` is `{ widthClass, heightClass, orientation }`, `lang`
 * is `"es"` or `"en"`. [over] is merged over it key by key. State is Kino's: `inputs` holds the value of every input on
 * screen (what the person or the plugin set, else the value the tree shows: the app fills those in per call and never
 * stores them; the kit has no tree yet, so pass them with --state) and `ui` the local operations' results.
 */
export function fakeScreenContext(over = {}) {
  return {
    state: { inputs: {}, ui: { hidden: {}, enabled: {}, open: {} } }, route: { name: "main", params: {} }, device: "phone",
    size: { widthClass: "compact", heightClass: "medium", orientation: "portrait" }, lang: "es", ...over,
  };
}

/** The `screenEvent` argument: `{ name, arg, value, state, route, device, lang }` (arg and value only when given), as the app sends it. */
export function fakeScreenEvent(name, { arg, value, state, route, device, lang } = {}) {
  const base = fakeScreenContext();
  return {
    name, ...(arg !== undefined ? { arg } : {}), ...(value !== undefined ? { value } : {}),
    state: state ?? base.state, route: route ?? base.route, device: device ?? base.device, lang: lang ?? base.lang,
  };
}
