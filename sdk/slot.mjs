// The player slot (apiVersion 23, the "playerSlot" capability): what the app reads of a plugin's `playerSlot` answer
// (SlotParser) and of a `playerSlotAction` answer (SlotSession.requestOf), and the contexts Kino passes. The kit's run.mjs and
// validate.mjs print these; the cases in test/player-slot-cases.json run here and in the app's SlotParserTest.
import { contract } from "./contract.mjs";
import { fakeContext, foreignContext, httpsImage, liveContext, panelIconKnown, panelPlayerOf, siftPlayer } from "./panel.mjs";
import { kotlinTrim } from "./screen.mjs";

export const SLOT = contract.playerSlot;
const GO_COPY = contract.manifest.screen.goCopy;
const TEXT_SCRUB = new RegExp(GO_COPY.textScrubPattern, "g");
const LABEL_SCRUB = new RegExp(GO_COPY.labelScrubPattern, "g");

/** The answer through JSON, as Kino receives it (undefined and NaN become null or vanish). */
const wire = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? null : JSON.parse(s);
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clampLong = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * SlotParser.parse: a `playerSlot` answer `{ items: [ { id, text | icon | image | label+icon } ], refreshMs }` against the manifest's
 * declared [elements] (`[{ id, kind, mode }]`). Returns `{ frame, dropped }`: `frame` is `{ items, refreshMs }` (items in declared
 * order, `refreshMs` clamped or null) or null when the answer is not an object with an `items` list (Kino keeps the last frame);
 * `dropped` says why an item was left out. Nothing is repaired: an undeclared id, a kind that differs from the declared one, an
 * unknown icon, an image that is not https on a public host and an empty button are dropped, and a repeated id keeps the first VALID item.
 */
export function parseSlotFrame(answer, elements) {
  const dropped = [];
  const root = wire(answer);
  if (!isObj(root) || !Array.isArray(root.items)) return { frame: null, dropped };
  const declared = new Map(elements.map((e) => [e.id, e]));
  const byId = new Map();
  const seen = new Set();
  for (const o of root.items) {
    if (!isObj(o)) { dropped.push("an item that is not an object"); continue; }
    if (typeof o.id !== "string") { dropped.push("an item whose id is not text"); continue; }
    const el = declared.get(o.id);
    if (!el) { dropped.push(`"${o.id.slice(0, 40)}" is not a declared element`); continue; }
    if (seen.has(o.id)) { dropped.push(`"${o.id}" came twice, the first valid one is kept`); continue; }
    const item = itemOf(el, o);
    if (!item) { dropped.push(`"${o.id}" (${el.kind}) has nothing Kino can draw: ${why(el.kind)}`); continue; }
    seen.add(o.id);
    byId.set(o.id, item);
  }
  const n = typeof root.refreshMs === "number" && Number.isFinite(root.refreshMs) ? Math.trunc(root.refreshMs) : null;
  const refreshMs = n === null ? null : clampLong(n, SLOT.refreshMsFloor, SLOT.refreshMsCeiling);
  return { frame: { items: elements.map((e) => byId.get(e.id)).filter(Boolean), refreshMs }, dropped };
}

const why = (kind) => ({
  text: "send a non-empty \"text\"",
  icon: `send an "icon" from the predefined names`,
  image: "send an \"image\" that is an https URL on a public host",
  button: "send a \"label\" and/or an \"icon\" from the predefined names",
}[kind]);

function itemOf(el, o) {
  const { id } = el;
  if (el.kind === "text") {
    if (typeof o.text !== "string") return null;
    const s = o.text.replace(TEXT_SCRUB, "").slice(0, SLOT.textMaxChars);
    const lines = s.split("\n").map(kotlinTrim).filter((l) => l !== "").slice(0, SLOT.textMaxLines);
    return lines.length ? { id, text: lines } : null;
  }
  if (el.kind === "icon") return iconOf(o.icon) ? { id, icon: o.icon } : null;
  if (el.kind === "image") {
    const url = httpsImage({ url: o.image }, []);
    return url ? { id, image: url } : null;
  }
  const label = typeof o.label === "string" ? kotlinTrim(o.label.replace(LABEL_SCRUB, "")).slice(0, SLOT.labelMaxChars) : "";
  const icon = iconOf(o.icon) ? o.icon : null;
  if (label === "" && icon === null) return null;
  return { id, ...(label !== "" ? { label } : {}), ...(icon !== null ? { icon } : {}) };
}

const iconOf = (v) => typeof v === "string" && panelIconKnown(v, SLOT.apiVersion);

/** The log line the app writes for a press answer's live drops (SlotSession.LIVE_DROPPED). */
export const LIVE_DROPPED = `slot: on a live stream a slot press never seeks or changes the timeline (${SLOT.liveDropped.join(", ")}), dropped`;

/**
 * SlotSession.requestOf: a `playerSlotAction` [answer] `{ openPanel?: true, player?: {...} }` (or null) as the host's request,
 * or null when it asks for nothing. `player` goes through the panel's own reader, then (live) loses what moves the timeline,
 * then PlayerControlRules.sift as the person's PRESS. [control] is the playerControl capability granted; [contributed] is true
 * for a plugin that does not own the title playing (and always on live). Lines go to [log].
 */
export function slotActionRequest(answer, { live = false, contributed = true, control = false } = {}, log = () => {}) {
  const say = (line) => log(line.startsWith("panel: ") ? `slot: ${line.slice("panel: ".length)}` : line);
  const value = wire(answer);
  if (value === null) return null;
  if (!isObj(value)) { log("slot: the action answer is not a JSON object"); return null; }
  const openPanel = value[SLOT.openPanelKey] === true;
  let player = panelPlayerOf(value.player, say);
  if (player && Object.keys(player).length === 0) player = null;
  if (player && live) {
    const kept = Object.fromEntries(Object.entries(player).filter(([k]) => !SLOT.liveDropped.includes(k)));
    if (Object.keys(kept).length !== Object.keys(player).length) log(LIVE_DROPPED);
    player = Object.keys(kept).length ? kept : null;
  }
  // On a live channel every plugin counts as a contributor (SlotSession: contributed = live || not the title's owner).
  const sifted = player ? siftPlayer(player, "press", { contributed: contributed || live, control }, say) : null;
  if (!openPanel && !sifted) return null;
  return { openPanel, player: sifted ? sifted.action : null, controlled: sifted?.controlled === true };
}

/** The context of a title's own plugin (the panel's, with `live: false`). */
export const slotContext = (ref, over = {}) => ({ ...fakeContext(ref, over), live: false });

/** The context another plugin gets for a title it does not own (the panel's foreign one, with `live: false`). */
export const slotForeignContext = (ref, contributorId, source, over = {}) => ({ ...foreignContext(fakeContext(ref, over), contributorId, source), live: false });

/** The context on an En vivo channel the provider confirmed (the live panel's, with `live: true`). */
export const slotLiveContext = (channel, base = {}) => ({ ...liveContext(channel, base), live: true });

/**
 * The context of a playback a plugin may learn nothing of (an 18+ title or owner, content no plugin owns, a live channel not
 * confirmed): `live`, `foreign: true`, `device`, `lang`, `features`. No `kind` (not even movie or series), ref, title, ids,
 * position or channel.
 */
export function slotBareContext({ live = false, device = "tv", lang = "es-CO" } = {}) {
  return { live, foreign: true, device, lang, features: ["loading"] };
}
