#!/usr/bin/env node
// Writes the tables of the User interface reference (docs/plugins/ui.md) from contract.json, so the names, defaults and
// numbers a plugin author reads there are the ones the app enforces (a test in the app pins contract.json to its code).
//   node sdk/ui-tables.mjs <ui.md>           rewrite every <!-- ui:NAME:start --> ... <!-- ui:NAME:end --> block
//   node sdk/ui-tables.mjs <ui.md> --check   exit 1 if a block is out of date, or if a contract node has no section
//
// Every widget contract.json lists (manifest.screen.widgets, and the table parts) needs a section in the page: an anchor
// (`<a id="..."></a>`) and its props block. A widget the contract adds without a description here fails the generator on
// purpose, and so does a contract property (layoutProps, fieldProps, styleProps, uiOps, answerFields, goShapes, limits)
// this file does not describe: the page can never silently fall behind the contract.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, kb } from "./contract.mjs";

const c = contract;
const S = c.manifest.screen;
const L = S.limits;
const P = c.output.panel.screen;
const n = (x) => x.toLocaleString("en-US");
const code = (x) => `\`${x}\``;
const codes = (xs, sep = ", ") => xs.map(code).join(sep);
const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** The documented (Flutter-style) spelling of a property the contract names by its older name, and the reverse. */
const CANON = Object.fromEntries(Object.entries(S.aliases.props).map(([flutter, old]) => [old, flutter]));
const OLDER = S.aliases.props;
const canon = (p) => CANON[p] || p;
const older = (p) => OLDER[p] || p;

/** Each widget's section anchor in ui.md, by the older name contract.json lists. A widget without one fails on purpose. */
export const ANCHORS = {
  col: "column", row: "row", box: "stack", card: "card", spacer: "spacer", divider: "divider", scroll: "scroll", grid: "grid-view",
  text: "text", image: "image", icon: "icon", badge: "badge", progress: "progress", loading: "loading", list: "list-view",
  button: "button", textInput: "text-field", textArea: "text-area", dropdown: "dropdown", toggle: "switch", checkbox: "checkbox",
  radioGroup: "radio-group", slider: "slider", chips: "chips", tabs: "tab-bar", emptyState: "empty-state", errorState: "error-state",
  titleCard: "title-card", titleRail: "title-rail", titleGrid: "title-grid", heroCard: "hero-card", popup: "popup", form: "form",
  settings: "settings", banner: "banner", accordion: "accordion", skeleton: "skeleton", qr: "qr", stepper: "number-stepper",
  table: "table", tr: "table-row", td: "table-cell", steps: "steps",
  fab: "floating-action-button", listTile: "list-tile", avatar: "circle-avatar", pageView: "page-view",
  scaffold: "scaffold", appBar: "app-bar", navigationBar: "navigation-bar",
};
/** A go shape's anchor. */
export const goAnchor = (g) => "go-" + g.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** The type names a widget is written with: the Flutter-style ones the contract maps to it, else its own. */
export function namesOf(old) {
  if (old === "textArea") return ["TextField"];
  if (old === "tr") return ["TableRow"];
  if (old === "td") return ["TableCell"];
  const flutter = Object.entries(S.aliases.types).filter(([, o]) => o === old).map(([f]) => f);
  return flutter.length ? flutter : [old];
}

const ICONS = c.manifest.panel.icons;
const EXTRA_ICONS = c.manifest.panel.extraIcons;
/** What each icon means (the gallery table, #icon-names). An icon the contract adds without a meaning here fails on purpose. */
const ICON_TEXT = {
  info: "information, details", tune: "options, adjustments (Kino's default)", settings: "settings", star: "a favourite, a rating",
  bolt: "quick, live, an action", language: "language, the web", subtitles: "subtitles, captions", list: "a list, an index",
  magic: "suggestions, something automatic", heart: "liked, saved", movie: "a film", tv: "a series, television",
  sports: "sport", music: "music, audio", bookmark: "saved for later", help: "help, a question",
  refresh: "refresh now (a circular arrow)", sync: "sync between devices", add: "add, new", remove: "remove one, less",
  delete: "delete (a bin)", edit: "edit (a pencil)", search: "search", close: "close, dismiss", check: "done, confirmed",
  share: "share", play: "play", pause: "pause", download: "download", upload: "upload, send a file", link: "a link",
  open_in_new: "opens outside (a link that leaves)", home: "home, the start", person: "a person, an account", lock: "locked, private",
  notifications: "notifications, alerts", warning: "a warning (a triangle)", error: "an error (a circle with a mark)",
  visibility: "show, seen (an eye)", copy: "copy", arrow_back: "back, previous", arrow_forward: "forward, next",
  expand_more: "open, more (a chevron down)", expand_less: "close, less (a chevron up)", more_vert: "more actions (three dots)",
  filter_list: "filter", calendar: "a date, a calendar", schedule: "a time, scheduled (a clock)",
  send: "send a message (a paper plane)", mood: "a reaction, a feeling (a smiley)",
};
const TEXT_STYLES = ["h1", "h2", "h3", "h4", "h5", "p", "caption", "label"];
const ACTION = "action";
const NODE = "node";
const kids = (what = "nodes") => ["children", `${what}[]`, "none", "its children, drawn in order"];
const paging = () => [
  ["onEndReached", "`{ event, arg? }`", "none", "sent once when the last item comes into view, again only after your answer drew a longer list (or `loadingMore` went from true to false); never more than once a second"],
  ["loadingMore", "boolean", "`false`", "`true` draws Kino's spinner after the items"],
  ["done", "boolean", "`false`", "`true` stops asking for more"],
];
const SIZE = ["size", codes(S.cardSizes, " \\| "), "`medium`", "one of Kino's three sizes"];

/**
 * Each widget's own properties: [name, type, default, notes]. The common properties, the style and (for inputs) `key`,
 * `labelText`, `hintText`, `onChanged`, `bind` and the form rules are added from the contract; every layoutProps entry
 * must be described here (the generator fails otherwise).
 */
export const PROPS = {
  col: [kids()],
  box: [kids("nodes (laid on each other, first at the back)")],
  row: [
    kids(),
    ["wrap", "boolean", "`false`", `\`true\`: the twelve-column layout, children placed by \`span\` and \`offset\` on lines of ${L.gridColumns} columns ([Twelve-column row](#wrap-row))`],
    ["stackOnNarrow", "boolean", "`false`", "on a compact width the children stack as a column; ignored with `wrap`"],
  ],
  card: [
    kids(),
    ["variant", "`plain` \\| `outlined` \\| `filled`", "`plain`", "Kino's three card looks"],
    ["flush", "boolean", "`false`", "no padding of its own and its children clipped to its rounded shape: an `Image` at its top runs edge to edge"],
  ],
  spacer: [["(none)", "", "", "`SizedBox` is an empty box of its `width`/`height`; `Spacer` takes its `flex` share of a `Row` or `Column`"]],
  divider: [["(none)", "", "", "a thin rule across its parent"]],
  scroll: [kids(), ["direction", "`vertical` \\| `horizontal`", "`vertical`", "a `ListView` or rail inside a scroll of the same direction is drawn all at once"]],
  grid: [kids(), ["columns", `1 to ${L.maxGridColumns}`, "`2`", "equal columns, filled row by row"]],
  text: [
    ["text", "string", "required (optional with `time`)", `1 to ${n(L.maxTextChars)} characters, plain (no markup, no links); newlines kept; with a \`time\` it is its prefix`],
    ["textEn", "string", "none", "the English twin, shown when the app is in English"],
    ["style", codes(TEXT_STYLES, " \\| "), "`p`", "Kino's type scale ([Text scale](#text-scale)); `display`, `title`, `subtitle`, `body` read as `h1`, `h3`, `h4`, `p`"],
    ["maxLines", "integer ≥ 1", "none", "cut with an ellipsis"],
    ["bold", "boolean", "`false`", "headings are bold already; `false` never thins one"],
    [S.textTime.field, "epoch ms", "none", `a whole number 0 to ${n(S.textTime.maxMs)}: Kino writes the time itself in the app's language ([Text with a time](#text-time))`],
    [S.textTime.formatField, codes(S.textTime.formats, " \\| "), code(S.textTime.formats[0]), `\`relative\` («hace 2 min», rewritten every ${S.textTime.refreshMs / 60000} minute while shown, no call to you), \`clock\` («18:42», the device's 12/24 h) or \`countdown\` («0:42» left, every second, «0:00» once reached)`],
  ],
  image: [
    ["url", "https URL", "required without `fallback`", "a public https host (no declaration needed); with a `fallback`, no `url` draws the fallback (an empty or refused one too, logged)"],
    ["alt", "string", "none", "what a screen reader says (`altEn` the English one)"],
    ["aspect", "`16:9` \\| `2:3` \\| `1:1` \\| `banner`", "the picture's own", "the box's shape"],
    ["fallback", NODE, "none", `drawn in the image's box when the picture fails or there is no \`url\`: only ${codes(S.fallbackWidgets.widgets.map((w) => namesOf(w)[0]))}, at any depth, never pressed`],
  ],
  icon: [["name", ICONS.length + " names", "required", `one of Kino's icons (the [icon table](#icon-names)): ${codes(ICONS)}; the last ${EXTRA_ICONS.names.length} from apiVersion ${EXTRA_ICONS.apiVersion}`]],
  badge: [["text", "string", "required", "a short label (`textEn` the English one)"]],
  progress: [
    ["value", "number 0 to 1", "none", "none draws an indeterminate bar; outside 0..1 is clamped"],
    ["labelText", "string", "none", "a label beside the bar (`labelTextEn`)"],
  ],
  loading: [["text", "string", "none", "a line under Kino's spinner (`textEn`)"]],
  list: [
    ["items", "nodes[]", "none", `at most ${L.maxListItems}, each with a \`key\` of its own; drawn lazily`],
    ["empty", NODE, "none", "drawn when there are no items"],
    ["columns", `1 to ${L.maxGridColumns}`, "`1`", "a grid of items"],
    ["stickToBottom", "boolean", "`false`", "opens at the last item and follows new ones while the person is at the end; one column, in a list that scrolls itself ([layout fill](#layout-fill-a-chat-tab))"],
    [S.listHints.field, "boolean", "`false`", "items appended while the person reads higher up show Kino's own «↓ Nuevos» chip (its text, never yours); a tap goes to the end ([new items](#new-items-hint))"],
    ...paging(),
  ],
  button: [
    ["labelText", "string", "required (not for `IconButton`)", "`labelTextEn` the English one; on an `IconButton` it is what a screen reader says"],
    ["icon", "a Kino icon name", "none", "required for `IconButton` (variant `icon`)"],
    ["variant", codes(["primary", "secondary", "text", "icon"], " \\| "), "`primary`", "set by `ElevatedButton`, `TextButton`, `IconButton`; `secondary` only as `Button`"],
    ["onPressed", ACTION, "none", "what a press does ([Actions](#actions))"],
    ["confirm", "string", "none", "Kino asks this question (`confirmEn`) before the action runs"],
    ["submit", "boolean", "`false`", "inside a `Form`: checks and submits the form (its own `onPressed` is ignored)"],
  ],
  textInput: [
    ["kind", codes(S.inputKinds, " \\| "), "`text`", "the keyboard; there is no password kind (a masked field is `obscureText`)"],
    ["value", "string", "`\"\"`", "the starting text (what `state.inputs` holds wins); ignored on an `obscureText` field"],
    ["obscureText", "boolean", "`false`", "masked like a password on phone and TV, with Kino's show / hide; never in your state, sent only with the person's own tap or submit, then cleared ([secret fields](#secret-field)); one line only; binds only a `password` setting"],
    ["maxLength", `1 to ${n(L.maxTextChars)}`, n(L.maxTextChars), "also a form rule"],
    ["onSubmitted", ACTION, "none", "the keyboard's action (Enter); on the TV, the text dialog's accept"],
    ["trailingIcon", `one of the ${ICONS.length} [icons](#icon-names)`, "none", "drawn inside the field's box at its end, tinted by `color`; never on a disabled field; needs `trailingLabel` and `onTrailingTap`, else the field is drawn without it (logged)"],
    ["trailingLabel", `1 to ${L.maxTrailingLabelChars} characters`, "none", "what a screen reader says for the icon (`trailingLabelEn` in English); required with `trailingIcon`"],
    ["onTrailingTap", ACTION, "none", "the icon's press: sent like `onSubmitted`, with the field's current text as `value` (a person's press); on the TV the icon is its own focus stop, Right from the field"],
  ],
  textArea: [
    ["multiline", "boolean", "`false`", "`true` (or `maxLines` above 1) makes a `TextField` several lines"],
    ["maxLines", "integer", "none", "above 1 in any size class: several lines"],
    ["kind", codes(S.inputKinds, " \\| "), "`text`", "as a one-line field"],
    ["value", "string", "`\"\"`", "the starting text"],
    ["maxLength", `1 to ${n(L.maxTextChars)}`, n(L.maxTextChars), "also a form rule"],
    ["onSubmitted", ACTION, "none", "sent on the TV only (the phone's multi-line keyboard has no submit: add a button)"],
  ],
  dropdown: [
    ["options", "`{ value, label, labelEn? }[]`", "required", `1 to ${L.maxListItems}, values distinct`],
    ["value", "string", "none (`null`)", "the chosen option's value"],
  ],
  radioGroup: [
    ["options", "`{ value, label, labelEn? }[]`", "required", `1 to ${L.maxListItems}, values distinct`],
    ["value", "string", "none (`null`)", "the chosen option's value"],
  ],
  toggle: [["value", "boolean", "`false`", "on or off"]],
  checkbox: [["value", "boolean", "`false`", "ticked or not"]],
  slider: [
    ["min", "number", "`0`", "below `max`"],
    ["max", "number", "`100`", "above `min`"],
    ["step", "number", "none (continuous)", "above 0 and at most `max - min`"],
    ["value", "number", "`min`", "clamped to `min..max`"],
  ],
  chips: [
    ["options", "`{ value, label, labelEn? }[]`", "required", `1 to ${L.maxListItems}, values distinct`],
    ["multiple", "boolean", "`false`", "several chips may be picked"],
    ["value", "string or string[]", "none", "the picked value (a list with `multiple`); a value naming no option is dropped"],
  ],
  tabs: [
    ["tabs", "`{ value, label, labelEn?, badge? }[]`", "required", `1 to ${L.maxListItems}; a tab's \`badge\` sits beside its label ([shared properties](#shared-properties))`],
    ["value", "string", "the first tab", "the selected tab; NOT in `state.inputs`: keep it in your state from `onChanged`"],
    ["onChanged", ACTION, "none", "its event's `value` is the tab's value"],
  ],
  emptyState: [
    ["title", "string", "required", "`titleEn` the English one"],
    ["text", "string", "none", "a line under the title (`textEn`)"],
    ["icon", "a Kino icon name", "Kino's", ""],
  ],
  errorState: [
    ["title", "string", "required", "`titleEn` the English one"],
    ["text", "string", "none", "a line under the title (`textEn`)"],
    ["icon", "a Kino icon name", "Kino's", ""],
  ],
  titleCard: [
    ["item", "`KinoItem`", "required", "the shape a `home` row returns (`id`, `ref`, `title`, `kind`, `poster`...); a series needs your `episodes` capability"],
    SIZE,
  ],
  titleRail: [
    ["title", "string", "required", "the row's heading (`titleEn`)"],
    ["items", "`KinoItem[]`", "required", `1 to ${L.maxListItems} (${L.maxFlatTitles} when drawn all at once)`],
    ["ref", "string", "none", `with it, the row's «Ver más» opens your \`browse\` (at most ${n(L.maxRefChars)} characters)`],
    SIZE,
    ...paging(),
  ],
  titleGrid: [
    ["items", "`KinoItem[]`", "required", `1 to ${L.maxListItems} (${L.maxFlatTitles} when drawn all at once)`],
    ["columns", `1 to ${L.maxGridColumns}`, "`3`", ""],
    ...paging(),
  ],
  heroCard: [
    ["title", "string", "required", "`titleEn` the English one"],
    ["text", "string", "none", "`textEn`"],
    ["image", "https URL", "none", "a public https picture"],
    ["buttons", "button nodes", "none", `at most ${L.maxHeroButtons}`],
  ],
  popup: [
    ["key", "string", "required", "what `{ open: key }` and `{ close: key }` name"],
    ["kind", codes(S.popupKinds, " \\| "), "set by the type", "`AlertDialog` is `dialog`, `BottomSheet` `sheet`, `PopupMenuButton` `menu`"],
    ["title", "string", "none", "`titleEn`; none (or blank) draws no empty title row"],
    ["children", "nodes[]", "none", "the body of a dialog or sheet: forms and inputs allowed"],
    ["buttons", "`{ label, labelEn?, event?, arg?, variant? }[]`", "none", `a dialog's, at most ${L.maxDialogButtons}; one without \`event\` closes it`],
    ["items", "`{ label, labelEn?, icon?, onTap }[]`", "required for a menu", `1 to ${L.maxMenuItems}; the menu closes first`],
    ["onClose", "event name or `{ ui?, event?, arg? }`", "none", "runs after the person dismissed it (Back, Kino's close, a tap outside), never after its own buttons"],
    [S.declaredPopups.anchor.field, "a node's key", "none", "drawn next to that node, over the content, taking no room ([anchored pop-up](#anchored-popup)); the only pop-up a player panel draws"],
  ],
  form: [kids("nodes (its fields among them)"), ["onSubmitted", ACTION, "required", "runs only when every field passes; its event's `value` holds every field by key"]],
  settings: [
    ["keys", "string[]", "all settings", "only those settings, in that order; each setting shows at most once per screen"],
    [S.settingsAutoSave.field, "boolean", "`false`", `its ${codes(S.settingsAutoSave.types, " and ")} settings save as they change (no \`validateSettings\`); with only those, no Guardar ([settings node](#settings))`],
    [S.screenAsks.onSavedField, "event name or `{ event, arg? }`", "none", "sent after Kino's form here saved (Guardar, or an autosave) or one of its action buttons finished: `value` is `{ kind, ok, keys, action?, reason? }`, setting keys only, never a value ([onSaved](#on-saved))"],
  ],
  banner: [
    ["text", "string", "required", "`textEn`"],
    ["role", codes(S.roles, " \\| "), "`info`", "Kino's colour and icon for it"],
    ["title", "string", "none", "`titleEn`"],
    ["action", "`{ label, labelEn?, onTap }`", "none", "one button"],
    ["dismissible", "boolean", "`false`", "Kino's close (needs a `key` of its own): hides it and sends the event `dismiss` with the key as `arg`"],
  ],
  accordion: [
    ["key", "string", "required", "which items are open lives in `state.ui.open.<key>`"],
    ["items", "`{ key, title, titleEn?, children?, open? }[]`", "required", `1 to ${L.maxListItems}; \`open\` is only the first look`],
    ["multiple", "boolean", "`false`", "several items open at once"],
  ],
  skeleton: [
    ["shape", codes(S.skeletonShapes, " \\| "), "`line`", "size it with `width`/`height`"],
    ["lines", `1 to ${L.maxSkeletonLines}`, "`1`", "bars of a `line`"],
  ],
  qr: [
    ["value", "string", "required", `1 to ${n(L.maxQrChars)} characters, drawn as written; a value holding one of your secrets is never drawn`],
    ["labelText", "string", "none", "what a screen reader says (`labelTextEn`)"],
    SIZE,
    ["expiresInMs", `${n(S.screenAsks.qr.minExpiryMs)} to ${n(S.screenAsks.qr.maxExpiryMs)}`, "none", "the code stops working that long after Kino first draws this value: Kino counts it down under the code and dims it at zero ([countdown](#qr-countdown))"],
    ["expiresAt", "epoch ms", "none", `the same as a time (the device's clock, read once), at most ${n(S.screenAsks.qr.maxExpiryMs)} ms away; ignored beside \`expiresInMs\``],
    ["onExpire", "event name or `{ event, arg? }`", "none", "sent once per value: `renew` `renewBeforeMs` before the end, else `expired` at zero; `value` is `{ phase, remainingMs }`"],
    ["renewBeforeMs", `${n(S.screenAsks.qr.minExpiryMs)} to ${n(S.screenAsks.qr.maxExpiryMs)}`, "none", "with `onExpire`: ask for a new code that long before the end (below the lifetime, else half of it)"],
  ],
  stepper: [
    ["value", "number", "`min`, else 0", "rounded to `decimals`; in `state.inputs` as text (`\"2.50\"`)"],
    ["min", "number", "none", "below `max`"],
    ["max", "number", "none", "above `min`"],
    ["step", "number > 0", "`1`", "rounded to `decimals`"],
    ["decimals", `0 to ${L.maxStepperDecimals}`, "`0`", ""],
    ["editable", "boolean", "`false`", "lets the person type it (digits only); only with `decimals: 0` and a `min` of 0 or more"],
  ],
  table: [
    ["children", "`TableRow[]`", "required", `1 to ${L.maxTableRows} rows`],
    ["columns", "`{ key?, flex? }[]`", "the widest row's count", `at most ${L.maxTableColumns}; each \`flex\` 1 to ${L.maxWeight}`],
    ["header", "boolean", "`false`", "the first row is the header (bold, read as headings)"],
    ["wrap", "boolean", "`false`", "on a compact width, wrap instead of scrolling sideways"],
    ["zebra", "boolean", "`false`", "every other row on Kino's surface"],
  ],
  steps: [
    ["items", "`{ key, title, titleEn?, subtitle?, subtitleEn?, state, children? }[]`", "required", `1 to ${S.screenAsks.steps.maxSteps}; \`state\` ${codes(S.screenAsks.steps.states, ", ")}; exactly one \`current\` (its children are drawn under it); a \`done\` one shows its \`subtitle\` (else Kino's «Listo»)`],
    [S.screenAsks.steps.onStepTapField, "event name or `{ event }`", "none", "a `done` step becomes pressable (touch, or OK on the TV): the event goes with the step's `key` as `arg`"],
  ],
  tr: [
    ["children", "`TableCell[]`", "none", `at most ${L.maxTableColumns}; a short row is padded`],
    ["key", "string", "none", "lets `show`, `hide`, `toggle` name the row"],
    ["hidden", "boolean", "`false`", "starts hidden; a required field in a hidden row is not checked"],
  ],
  fab: [
    ["icon", "a Kino icon name", "required", "drawn on Kino's primary fill"],
    ["labelText", "string", "none", "the extended form: the label beside the icon (`labelTextEn`); else what a screen reader says is the `tooltip`, else Kino's own word"],
    ["onPressed", ACTION, "required", "what a press does"],
    ["fabPosition", codes(S.flutterNodes.fabPositions, " \\| "), "`end`", "bottom end or bottom centre of the plugin's area, never under the system bars or the keyboard ([floating action button](#floating-action-button))"],
  ],
  listTile: [
    ["title", "string", "required", "`titleEn`; at most two lines"],
    ["subtitle", "string", "none", "`subtitleEn`; Kino's muted second line"],
    ["leading", NODE, "none", `one of ${codes(S.flutterNodes.tileSlotWidgets.map((w) => namesOf(w)[0]))}, never pressed itself`],
    ["trailing", NODE, "none", "as `leading`, at the end"],
    ["dense", "boolean", "`false`", `a lower row (${48} dp instead of 56, 72 with a subtitle)`],
  ],
  avatar: [
    ["image", "https URL", "none", "a public https picture, through Kino's image pipeline; when it fails, the initials"],
    ["text", "string", "none", `initials, at most ${S.flutterNodes.avatarMaxTextChars} characters (\`textEn\`)`],
    ["icon", "a Kino icon name", "`person`", "without a picture or initials"],
    ["radius", `${S.flutterNodes.avatarMinRadius} to ${S.flutterNodes.avatarMaxRadius} (dp)`, code(S.flutterNodes.avatarDefaultRadius), "always a circle: a `CircleAvatar` takes no `borderRadius`"],
    ["backgroundColor", "a colour role", "`primaryContainer`", "its initials and icon in the role's readable colour"],
    ["labelText", "string", "none", "what a screen reader says (`labelTextEn`); else the initials"],
  ],
  pageView: [
    kids("nodes (the pages)"),
    ["initialPage", "integer", "`0`", "the first look only; past the last page, the last"],
    ["onPageChanged", ACTION, "none", "its event's `value` is the settled page's index"],
    ["autoPlayMs", `${n(S.flutterNodes.autoPlayMinMs)} to ${n(S.flutterNodes.autoPlayMaxMs)}`, "none", "turns the page on its own; paused while touched or focused and with animations off"],
    ["viewportFraction", `${S.flutterNodes.viewportFractionMin} to 1`, "`1`", "below 1, Kino's carousel: the neighbouring pages peek"],
    ["padEnds", "boolean", "`true`", "the first and last pages centred in a carousel"],
  ],
  scaffold: [
    ["appBar", "an `AppBar`", "none", "pinned at the top of your area, under Kino's own title bar (never replacing or covering it)"],
    ["body", NODE, "required", "the bounded height left: a `ListView` or a scroll in it scrolls itself while the bars stay"],
    ["floatingActionButton", "a `FloatingActionButton`", "none", "above the bottom bar"],
    ["bottomNavigationBar", "a `NavigationBar`", "none", "at the bottom"],
  ],
  appBar: [
    ["title", "string or a node", "none", `a string (\`titleEn\` its twin) is read as a heading; or, Flutter's way, any node (a \`TabBar\`, a \`Row\` of buttons...; at most ${S.scaffold.maxAppBarTitleNodes} nodes) in the room left of the actions`],
    ["leading", "an `IconButton`", "none", "with a `labelText` (back, a menu)"],
    ["actions", "`IconButton[]`", "none", `at most ${S.scaffold.maxAppBarActions}, each with a \`labelText\`; a \`badge\` allowed`],
    ["bottom", "a `TabBar`", "none", "under the row"],
    ["centerTitle", "boolean", "`false`", "the title centred"],
    ["backgroundColor", "a colour role", "Kino's surface", "its text and icons in the role's readable colour"],
  ],
  navigationBar: [
    ["items", "`{ key, icon, label, labelEn?, badge? }[]`", "required", `${S.scaffold.minNavItems} to ${S.scaffold.maxNavItems}, keys distinct`],
    ["value", "string", "the first item", "the picked item's key (or `selectedIndex`); NOT in `state.inputs`: keep it in your state from `onChanged`"],
    ["selectedIndex", "integer", "none", "the picked item by its place, when there is no `value`"],
    ["onChanged", ACTION, "none", "its event's `value` is the item's key"],
  ],
  td: [
    ["text", "string", "none", "a plain cell (`textEn`); with a `text` the children are ignored"],
    ["children", "nodes[]", "none", `never ${codes(S.notInTableCell.map((w) => namesOf(w)[0]))} at any depth`],
    ["colSpan", `1 to ${L.maxColSpan}`, "`1`", "columns the cell covers"],
    ["crossAxisAlignment", "`start` \\| `center` \\| `end`", "`start`", "its content across its width"],
  ],
};

/** What every form rule means, by the name contract.json lists. */
const RULE_TEXT = {
  required: ["boolean", "`false`", "a text not blank, a choice made, a toggle on, a chip picked"],
  minLength: ["integer", "none", "characters (chips: picked chips)"],
  maxLength: ["integer", "none", "characters (chips: picked chips)"],
  pattern: ["string", "none", `must match the whole value; Kino's own safe subset, at most ${L.maxPatternChars} characters ([Patterns](#pattern))`],
  errorText: ["string", "Kino's text", "what the person reads under the failing field (`errorTextEn`)"],
};

/** The rows of a widget's props table. */
export function propRows(old) {
  if (!PROPS[old]) throw new Error(`ui-tables: no properties described for the screen widget ${old}`);
  const own = PROPS[old].map((r) => [...r]);
  const isInput = S.inputs.includes(old);
  const rows = [];
  if (isInput) {
    rows.push(["key", "string", "required", "names the value in `state.inputs`; unique on the screen"]);
    rows.push(["labelText", "string", "none", "the field's label (`labelTextEn`)"]);
    if (old !== "toggle" && old !== "checkbox") rows.push(["hintText", "string", "none", "a hint inside or under it (`hintTextEn`)"]);
    rows.push(["onChanged", ACTION, "none", "the person changed it; the event's `value` is the new value"]);
  }
  rows.push(...own);
  if (isInput) {
    const holds = S.bindHolds[old] || [];
    rows.push(holds.length
      ? ["bind", "a setting key", "none", `shows and stores one of your ${holds.map(code).join(" or ")} settings ([bind](#bind-and-config))`]
      : ["bind", "", "", "not taken (ignored, logged)"]);
    for (const rule of S.fieldProps[old] || []) {
      if (rows.some((r) => r[0] === rule)) continue;
      if (!RULE_TEXT[rule]) throw new Error(`ui-tables: no description for the form rule ${rule}`);
      rows.push([rule, ...RULE_TEXT[rule].slice(0, 2), `form rule: ${RULE_TEXT[rule][2]}`]);
    }
    for (const rule of S.fieldProps[old] || []) {
      const r = rows.find((x) => x[0] === rule);
      if (r && !r[3].includes("form rule")) r[3] = `${r[3]}${r[3] ? "; " : ""}form rule inside a \`Form\``;
    }
    // Task 18 (G8): every input takes the plugin's own verdict.
    rows.push([S.forceError.field, "string", "none", `your own verdict under the field (\`forceErrorTextEn\`, at most ${S.forceError.maxChars} characters) until the person edits it ([validation](#validation))`]);
  }
  const named = new Set(rows.map((r) => r[0]));
  const layout = old === "td" ? S.tableCellProps : S.layoutProps[old] || [];
  for (const p of layout) {
    if (!named.has(p) && !named.has(canon(p))) throw new Error(`ui-tables: the contract's ${old}.${p} is not described`);
  }
  const perSize = old === "td"
    ? new Set(S.tableCellProps.map(older).concat(["align"]))
    : new Set([...S.styleProps, ...(S.layoutProps[old] || [])]);
  return rows.map(([name, type, def, notes]) => [
    name === "(none)" ? "(none)" : code(name), type, def, name === "(none)" ? "" : perSize.has(older(name)) || perSize.has(name) ? "yes" : "no", notes,
  ]);
}

const PROP_HEAD = ["Property", "Type", "Default", "Per size", "Notes"];

// ---------- the shared tables ----------

const COMMON = [
  ["key", "string", "`auto-<n>`", "unique on the screen; required on inputs, pop-ups, an `ExpansionTile` and a dismissible banner; the `auto-` prefix is Kino's"],
  ["onTap", ACTION, "none", "a press (a button's is `onPressed`)"],
  ["onLongPress", ACTION, "none", "a long press; keep it for extras reachable another way"],
  ["arg", "string", "none", `the event's \`arg\` when the action is a bare event name (at most ${n(L.maxRefChars)} characters)`],
  ["enabled", "boolean", "`true`", "`false` draws it off; `ui` `enable`/`disable` change it"],
  ["hidden", "boolean", "`false`", "`true` starts it hidden; `ui` `show`/`hide`/`toggle` change it"],
  ["devices", codes(S.devices, ", ") + " (a list)", "everywhere", "drawn only there; an unknown name drops the node"],
  ["sizes", codes(S.sizeClasses, ", ") + " (a list)", "every size", "drawn only at those width classes"],
  ["testKey", "string", "none", `1 to ${L.maxTestKeyChars} characters, for tests, never drawn`],
  ["autofocus", "boolean", "`false`", "a node that takes focus: where focus goes when a render left it nowhere ([shared properties](#shared-properties))"],
  ["selected", "boolean", "none", "a button or a card with `onTap`: Kino's selected look; `ui` `set` and `toggle` (`prop: \"selected\"`) change it"],
  ["badge", "`\"dot\"` or `{ text, textEn?, color? }`", "none", `a button, a card with \`onTap\`, a tab: a count (at most ${S.sharedProps.badge.maxChars} characters) or a dot on its top end corner`],
  ["visible", "boolean", "`true`", "`false` hides it as `hidden: true` does ([animations](#animate))"],
  [S.tooltip.field, "string", "none", `a node that does something: Kino's hint (\`tooltipEn\`), at most ${S.tooltip.maxChars} characters; never essential information ([tooltip](#tooltip))`],
  [S.enabledAt.field, "epoch ms", "none", "a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: off until that time on the device's clock, then on by itself, no call to you ([text with a time](#text-time))"],
  [S.canRequestFocus.field, "boolean", "`false`", "any node: on the TV a D-pad stop where the remote rests to read it (Kino's row look, no press); ignored where the node takes focus already and on the phone ([shared properties](#shared-properties))"],
  [S.pressBudget.loadingField, "boolean", "`false`", "a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: Kino's busy look (a spinner, no press, read as busy); Kino also draws it on the node pressed while its call runs long ([busy and slow presses](#busy))"],
];

const STYLE_VALUES = {
  padding: `${S.spacingScale.join(", ")}, or per side \`{ x, y, top, end, bottom, start }\``,
  margin: `${S.spacingScale.join(", ")}, or per side`,
  gap: S.spacingScale.join(", "),
  radius: `${codes(S.radiusTokens)}, or per corner \`{ ${S.corners.keys.join(", ")} }\` (an omitted one \`${S.corners.default}\`)`,
  w: S.sizeScale.join(", "), h: S.sizeScale.join(", "), minH: S.sizeScale.join(", "),
  fill: "`true`: the parent's whole width",
  weight: `1 to ${L.maxWeight}: its share of a \`Row\` or \`Column\``,
  align: "`start`, `center`, `end`, `stretch`: across the main axis (on a `Text`, the paragraph)",
  justify: "`start`, `center`, `end`, `spaceBetween`, `spaceAround`: along the main axis",
  color: codes(S.colorRoles),
  span: `1 to ${L.gridColumns} or \`"auto"\` (default), only in a \`Row\` with \`wrap: true\``,
  offset: `0 to ${L.gridColumns - 1}, only in a \`Row\` with \`wrap: true\``,
  maxWidthFraction: `${S.maxWidthFraction.min} to ${S.maxWidthFraction.max} in steps of ${S.maxWidthFraction.step}: at most that share of the parent's width (exactly, with \`fill\`)`,
  alignSelf: "`start`, `center`, `end`, `stretch`: this child across its `Row` or `Column`, over the parent's `crossAxisAlignment` ([box and text properties](#box-props))",
  textAlign: `${codes(S.boxProps.textAligns)}: the paragraph of a node that draws text (${codes(S.boxProps.textAlignWidgets.map((w) => namesOf(w)[0]))})`,
  border: `\`{ width?, color? }\` on a box: width 0 to ${S.boxProps.border.maxWidth} dp (default ${S.boxProps.border.defaultWidth}), a colour role (default Kino's outline)`,
  elevation: `0 to ${S.boxProps.maxElevation} on a \`Card\` or a \`Stack\`: Kino's shadow (a card's tonal lift too)`,
  background: "a colour role: a box's fill (its content reads in the role's on-colour)",
  minWidth: S.sizeScale.join(", "), maxWidth: S.sizeScale.join(", "), maxHeight: S.sizeScale.join(", "),
  positioned: "`{ top?, left?, right?, bottom?, width?, height? }` on a `Stack` child: dp or `\"25%\"` of the stack ([positioned stack](#positioned))",
  opacity: "0 to 1; below 0.38 the node takes no press and no focus ([animations](#animate))",
  animate: "`{ duration?, curve? }` on a box or a positioned child: changes glide ([animations](#animate))",
};

const UI_OP_TEXT = {
  show: ["`{ show: key }`", "shows a hidden node"],
  hide: ["`{ hide: key }`", "hides it (kept in `state.ui.hidden`)"],
  toggle: ["`{ toggle: key, prop? }`", "shows or hides it; with `prop: \"selected\"`, flips a button's or a tappable card's `selected`"],
  enable: ["`{ enable: key }`", "turns it on"],
  disable: ["`{ disable: key }`", "draws it off (kept in `state.ui.enabled`)"],
  focus: ["`{ focus: key }`", "moves the focus there"],
  set: ["`{ set: { key, value } }`", `gives an input a value: a string (at most ${n(L.maxTextChars)} characters), a boolean, a number, or up to ${L.maxListItems} strings for \`Chips\`; on a button or a tappable card, \`true\` or \`false\` is its \`selected\`; no event fires`],
  clear: ["`{ clear: key }`", "empties an input"],
  open: ["`{ open: key }`", "opens a declared pop-up (replacing an open one)"],
  close: ["`{ close: key }`", "closes it when it is the one open"],
};

const ANSWER_TEXT = {
  state: "a patch merged key by key (`null` removes a key); then `screen()` runs again",
  dialog: `a pop-up dialog: \`title\`, \`body\` (text or nodes), at most ${L.maxDialogButtons} \`buttons\``,
  sheet: "a bottom sheet on the phone, a side drawer on the TV: `title`, `body`",
  menu: `a list of 1 to ${L.maxMenuItems} actions: \`items\` of \`{ label, icon?, onTap }\``,
  toast: `a short message: a string or \`{ text, textEn?, role?, action?, ms? }\` (\`ms\` ${n(L.toastMinMs)} to ${n(L.toastMaxMs)}, default ${n(L.toastDefaultMs)})`,
  toastEn: "the English twin of a string toast",
  go: "somewhere in Kino ([Navigation](#navigation))",
  route: "`{ push: name, params? }` or `{ pop: true }`: a screen of your own deeper in the canvas",
  close: "`true` closes the screen",
  focus: "the key of the node that takes the focus",
  config: `your settings to write, at most ${L.maxConfigKeys} keys ([bind and config](#bind-and-config))`,
  ui: `local operations (at most ${L.maxUiOps}); an \`open\` waits for the tree the answer asks for`,
};

const GO_FIELDS = {
  title: `\`{ title: { ${S.goTitleFields.join(", ")} } }\``,
  play: `\`{ play: { ${S.goTitleFields.join(", ")} } }\``,
  search: "`{ search: { q } }`",
  browse: "`{ browse: { ref, title?, titleEn? } }`",
  section: "`{ section: true }`",
  categories: "`{ categories: true }`",
  close: "`{ close: true }`",
  screen: "`{ screen: { route?, args? } }`",
  titleByIds: `\`{ titleByIds: { ${S.goTitleByIds.fields.join(", ")} } }\``,
  url: `\`{ url: { ${S.goUrl.fields.join(", ")} } }\``,
  copy: `\`{ copy: { ${S.goCopy.fields.join(", ")} } }\``,
  liveChannel: `\`{ liveChannel: { ${S.goLiveChannel.fields.join(", ")} } }\``,
};
const GO_OPENS = {
  title: "this plugin's title page",
  play: "plays this plugin's title",
  search: `Kino's search with \`q\` (at most ${L.maxSearchQueryChars} characters), only this plugin as the source`,
  browse: "this plugin's «Ver más» list for a `ref`",
  section: "this plugin's section",
  categories: "Kino's Categorías, this plugin's group first",
  close: "closes the screen",
  screen: `this plugin's own screen at \`route\` (at most ${L.maxGoRouteChars} characters) with \`args\` (at most ${n(L.maxGoArgsBytes)} bytes)`,
  titleByIds: "Kino's own title page for TMDB or IMDb ids, with every source the person has",
  url: "an https link in the browser, after Kino's own sheet (a QR code on a TV)",
  copy: `Kino copies \`text\` (at most ${S.goCopy.maxTextChars} characters, ${S.goCopy.maxLines} lines) and shows its own «Copiado» toast; a TV cannot`,
  liveChannel: "tunes the player to an En vivo provider's channel (only for a plugin whose player tab joins live channels)",
};
const goFrom = (g) => g === "titleByIds" || g === "url" || g === "copy" || g === "liveChannel"
  ? `only the person's own ${S.goUrl.fromTriggers.join(" or ")}`
  : g === "screen" ? "a tap or an answer, `open`'s included" : "a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s)";

/** What each limit means, by its contract key. A limit without one fails the generator. */
const LIMIT_TEXT = {
  maxConfigKeys: "settings one `config` writes", maxDepth: "depth of a tree", maxNodes: "nodes in a tree",
  maxListItems: "items in a list, rail, grid, accordion or a choice's options", maxStateBytes: "bytes of state, as JSON",
  maxTextChars: "characters of a text", minEventIntervalMs: "ms between two events", callTimeoutMs: "ms per `screen` or `screenEvent` call",
  maxPopups: "pop-up open at a time", maxRefChars: "characters of a `ref` or an `arg`", maxSearchQueryChars: "characters of a `go.search` `q`",
  eventQueue: "events waiting", maxUiOps: "`ui` operations per action or answer", maxDialogButtons: "buttons in a dialog",
  maxWeight: "largest `flex`", maxGridColumns: "largest `columns`", maxTestKeyChars: "characters of a `testKey`", maxTrailingLabelChars: "characters of a text field's `trailingLabel`",
  maxHeroButtons: "buttons in a `heroCard`", maxMenuItems: "items in a menu", maxTitles: "titles in a whole tree",
  maxFlatTitles: "titles in a rail or grid drawn all at once", maxPatternChars: "characters of a `pattern`",
  maxPatternRepeat: "largest count in a pattern", maxPatternStates: "steps of a pattern once counts are expanded",
  maxPatternFields: "patterns one submit runs", maxPatternCompileWork: "units of work to read one pattern",
  maxPatternMatchWork: "matcher steps one submit runs", minTimerMs: "shortest timer, ms", maxTimerMs: "longest timer, ms",
  maxTimers: "timers per screen", timerMaxFailures: "failures in a row that switch a timer off",
  toastMinMs: "shortest toast, ms", toastMaxMs: "longest toast, ms", toastDefaultMs: "a toast's default, ms",
  timerConfigWriteIntervalMs: "ms between two writes of one setting from a timer", maxQrChars: "characters of a `QrImage` value",
  maxStepperDecimals: "decimals of a `NumberStepper`", maxStepperAbs: "largest `NumberStepper` number either way",
  maxSkeletonLines: "lines of a `Skeleton`", maxTableColumns: "columns of a `DataTable`", maxTableRows: "rows of a `DataTable`",
  maxColSpan: "largest `colSpan`", gridColumns: "columns of the twelve-column row", maxGoRouteChars: "characters of a `go.screen` `route`",
  maxGoArgsBytes: "bytes of `go.screen` `args`, as JSON",
};

const VALUE_TYPE = {
  textInput: "string", textArea: "string", dropdown: "the option's value or `null`", toggle: "boolean", checkbox: "boolean",
  radioGroup: "the option's value or `null`", slider: "number", chips: "a value or `null` (a list with `multiple`)", stepper: "its value as text (`\"2.50\"`)",
};

export const UI_TABLES = {
  common: () => table(PROP_HEAD, COMMON.map(([a, b, d, e]) => [code(a), b, d, "no", e])),
  style: () => table(["Property", "Older name", "Values", "Per size"], S.styleProps.map((p) => {
    if (!STYLE_VALUES[p]) throw new Error(`ui-tables: no values described for the style property ${p}`);
    const name = canon(p);
    return [code(name), name === p ? "" : code(p), STYLE_VALUES[p], "yes"];
  })),
  uiOps: () => table(["Operation", "Shape", "What it does"], S.uiOps.map((op) => {
    if (!UI_OP_TEXT[op]) throw new Error(`ui-tables: no description for the ui operation ${op}`);
    const notes = [UI_OP_TEXT[op][1]];
    if (S.declaredPopups.deferredOps.includes(op)) notes.push("in an answer it waits for the new tree");
    if (S.declaredPopups.dismissDroppedOps.includes(op)) notes.push("dropped in an `onClose`");
    return [code(op), UI_OP_TEXT[op][0], notes.join("; ")];
  })),
  answer: () => table(["Field", "What it does", "In a timer's answer", "In an `onClose` answer", "In a panel in screen mode"], S.answerFields.map((f) => {
    if (!ANSWER_TEXT[f]) throw new Error(`ui-tables: no description for the answer field ${f}`);
    const timer = S.timerAnswerFields.includes(f) || (f === "toastEn" && S.timerAnswerFields.includes("toast"));
    const dismiss = !S.declaredPopups.dismissDroppedFields.includes(f);
    const panel = P.answerFields.includes(f) ? "kept" : P.droppedAnswerFields.includes(f) ? "dropped" : "not used";
    return [code(f), ANSWER_TEXT[f], timer ? "kept" : "dropped", dismiss ? (f === "ui" ? "kept, without `open` and `focus`" : "kept") : "dropped", panel];
  })),
  go: () => table(["Shape", "Written", "What opens", "Sent from"], S.goShapes.map((g) => {
    if (!GO_FIELDS[g] || !GO_OPENS[g]) throw new Error(`ui-tables: no description for the go shape ${g}`);
    return [`[${code(g)}](#${goAnchor(g)})`, GO_FIELDS[g], GO_OPENS[g], goFrom(g)];
  })),
  aliasTypes: () => table(["Flutter-style name", "Older name", "Implies"], Object.entries(S.aliases.types).map(([f, o]) => [
    code(f), code(o), S.aliases.implied[f] ? Object.entries(S.aliases.implied[f]).map(([k, v]) => `\`${k}: "${v}"\``).join(", ") : "",
  ]).concat([[ "`TextField` with `multiline: true` or `maxLines` > 1", code(S.aliases.textFieldMultiline), "" ]])),
  aliasProps: () => table(["Flutter-style property", "Older name", "Where"], [
    ...Object.entries(S.aliases.props).map(([f, o]) => [code(f), code(o), "any node"]),
    ...Object.entries(S.aliases.buttonProps).map(([f, o]) => [code(f), code(o), "a button only (elsewhere ignored, logged)"]),
    ...Object.entries(S.aliases.columnProps).map(([f, o]) => [code(f), code(o), "a `DataTable` column"]),
  ]),
  inputs: () => table(["Input", "Value in `state.inputs`", "Form rules", "`bind` holds"], S.inputs.map((old) => [
    `[${code(namesOf(old)[0])}${old === "textArea" ? " (several lines)" : ""}](#${ANCHORS[old]})`, VALUE_TYPE[old] ?? "?",
    (S.fieldProps[old] || []).length ? codes(S.fieldProps[old]) : "none", (S.bindHolds[old] || []).length ? codes(S.bindHolds[old], " or ") : "no `bind`",
  ])),
  tokens: () => table(["Token", "Values"], [
    ["Spacing (`padding`, `margin`, `gap`)", S.spacingScale.join(", ")],
    ["Sizes (`width`, `height`, `minHeight`)", S.sizeScale.join(", ")],
    ["Corners (`borderRadius`)", `${codes(S.radiusTokens)} (one for every corner, or a map per corner)`],
    ["Colour roles (`color`)", codes(S.colorRoles)],
    ["Roles (`MaterialBanner`, a toast)", codes(S.roles)],
    ["Text styles (`Text.style`)", codes(TEXT_STYLES)],
    ["Card sizes (`titleCard`, `titleRail`, `QrImage`)", codes(S.cardSizes)],
    ["Width classes (per-size maps, `sizes`)", codes(S.sizeClasses)],
    ["Devices (`devices`, `ctx.device`)", codes(S.devices)],
    ["Icons (`Icon.name`, a button's `icon`)", codes(ICONS)],
  ]),
  icons: () => table(["Name", "What it shows", "Since"], ICONS.map((name) => {
    if (!ICON_TEXT[name]) throw new Error(`ui-tables: no meaning described for the icon ${name}`);
    return [code(name), ICON_TEXT[name], EXTRA_ICONS.names.includes(name) ? `apiVersion ${EXTRA_ICONS.apiVersion}` : "apiVersion 9"];
  })),
  limits: () => table(["Limit", "Value", "What"], Object.entries(L).map(([k, v]) => {
    if (!LIMIT_TEXT[k]) throw new Error(`ui-tables: no description for the screen limit ${k}`);
    return [code(k), typeof v === "number" ? (k.endsWith("Bytes") && v >= 1024 ? `${n(v)} (${kb(v)})` : n(v)) : String(v), LIMIT_TEXT[k]];
  })),
  patterns: () => table(["Limit", "Value"], [
    ["A pattern", `at most ${L.maxPatternChars} characters`],
    ["A count (`{n,m}`)", `at most ${n(L.maxPatternRepeat)}`],
    ["Steps once counts are expanded", `at most ${L.maxPatternStates} (so \`[a-z]{1,600}\` is refused: write \`[a-z]+\` and \`maxLength: 600\`)`],
    ["Work to read one pattern", `${n(L.maxPatternCompileWork)} units`],
    ["One submit", `at most ${L.maxPatternFields} patterns and ${n(L.maxPatternMatchWork)} matcher steps; past either, the remaining patterns pass`],
  ]),
  panel: () => table(["What", "In a panel in screen mode"], [
    ["Result", `\`{ format: "${P.format}", root, ${P.resultFields.join(", ")} }\` (apiVersion ${P.apiVersion})`],
    ["Tree", `depth ${P.maxDepth}, ${P.maxNodes} nodes; ${P.notDrawn.map((w) => namesOf(w).map(code).join(", ")).join(", ")} not drawn${P.drawnWhenAnchored.length ? ", unless it has an `anchor` (a popover inside the drawer)" : ""}; no \`every\` (the panel's \`refreshMs\` is the periodic call)`],
    ["Context adds", codes(P.contextAdds) + `, and \`features\` holds \`"${P.contextFeature}"\` while screens are on`],
    ["`panelAction` triggers", codes(P.triggers)],
    ["Answer fields kept", codes(P.answerFields)],
    ["Answer fields dropped", codes(P.droppedAnswerFields) + "; legacy-only " + codes(P.legacyAnswerFields)],
  ]),
};
for (const old of [...S.widgets, ...S.tableParts]) UI_TABLES[`props:${old}`] = () => table(PROP_HEAD, propRows(old));

/** The page with every generated block rewritten. Throws on a block the generator does not know. */
export function render(text) {
  return text.replace(/<!-- ui:([\w:.-]+):start -->[\s\S]*?<!-- ui:\1:end -->/g, (block, name) => {
    if (!UI_TABLES[name]) throw new Error(`ui-tables: unknown block ${name}`);
    return `<!-- ui:${name}:start -->\n${UI_TABLES[name]()}\n<!-- ui:${name}:end -->`;
  });
}

/**
 * What the page lacks for the contract [screen] (default: contract.json's): a widget or table part without its anchor or
 * props block, a go shape without its anchor, a generated block missing. An empty list is a page that covers everything.
 */
export function coverage(text, screen = S) {
  const out = [];
  const hasBlock = (name) => text.includes(`<!-- ui:${name}:start -->`);
  const hasAnchor = (a) => text.includes(`<a id="${a}"></a>`);
  for (const old of [...screen.widgets, ...screen.tableParts]) {
    const anchor = ANCHORS[old];
    if (!anchor) { out.push(`the widget ${old} has no anchor in ui-tables.mjs`); continue; }
    if (!hasAnchor(anchor)) out.push(`the widget ${old} has no section (#${anchor})`);
    if (!hasBlock(`props:${old}`)) out.push(`the widget ${old} has no props block`);
  }
  for (const g of screen.goShapes) if (!hasAnchor(goAnchor(g))) out.push(`the go shape ${g} has no section (#${goAnchor(g)})`);
  for (const name of Object.keys(UI_TABLES)) if (!name.startsWith("props:") && !hasBlock(name)) out.push(`the block ${name} is missing`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node sdk/ui-tables.mjs <ui.md> [--check]");
    process.exitCode = 2;
  } else {
    const text = readFileSync(file, "utf8");
    const out = render(text);
    const missing = coverage(out);
    for (const m of missing) console.error(`${file}: ${m}`);
    if (missing.length) process.exitCode = 1;
    if (flag === "--check") {
      if (out !== text) { console.error(`${file}: the contract tables are out of date; run node sdk/ui-tables.mjs ${file}`); process.exitCode = 1; }
    } else {
      writeFileSync(file, out);
    }
  }
}
