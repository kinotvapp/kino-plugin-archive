// kino.notifications (apiVersion 15, capability "notifications", contract.kinoNotifications): the kit's stand-in for the Home
// bell, with the app's rules (PluginNotifications / PluginNotificationsBridge): the capability and the revoke switch, the
// calls that may post (screen, screenEvent, job), every field, the go shapes, 20 posts an hour, 30 kept, 30 days. What a plugin
// posted is kept in a file next to it (`.kino-notices.json`) and `node sdk/run.mjs <folder> notifications` prints it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { contract } from "./contract.mjs";

const N = contract.kinoNotifications;
const SCRUB = new RegExp(contract.manifest.screen.goCopy?.textScrub ?? "[\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]", "g");
const ID = new RegExp(N.idPattern);
const plain = (s) => { const t = s.replace(/\n/g, " ").replace(SCRUB, "").replace(/ {2,}/g, " ").trim(); return t.length ? t : null; };
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function codedError(code, message) {
  const e = new Error(message);
  Object.defineProperty(e, "code", { value: code, enumerable: true });
  e.name = "KinoError_" + code;
  return e;
}

/** A notice's `go` as the app keeps it, or null (dropped: the notice opens the plugin's screen root). */
export function noticeGo(go) {
  if (!plainObject(go)) return null;
  const keys = Object.keys(go);
  if (keys.length !== 1 || !N.goKeys.includes(keys[0])) return null;
  const v = go[keys[0]];
  if (!plainObject(v)) return null;
  if (keys[0] === "screen") {
    if (Object.keys(v).some((k) => k !== "route" && k !== "args")) return null;
    if (v.route != null && !(typeof v.route === "string" && /^[A-Za-z0-9._~-]{1,64}$/.test(v.route))) return null;
    if (v.args != null && !(plainObject(v.args) && Buffer.byteLength(JSON.stringify(v.args), "utf8") <= 4096)) return null;
    return { screen: { ...(v.route != null ? { route: v.route } : {}), ...(v.args != null ? { args: v.args } : {}) } };
  }
  if (keys[0] === "titleByIds") {
    if (!["movie", "series"].includes(v.kind)) return null;
    if (!(Number.isInteger(v.tmdb) && v.tmdb > 0) && !(typeof v.imdb === "string" && /^tt\d{7,10}$/.test(v.imdb))) return null;
    return { titleByIds: v };
  }
  if (typeof v.ref !== "string" || !v.ref || typeof v.kind !== "string") return null;
  return { title: v };
}

/**
 * kino.notifications for [manifest]: `post(notice)` and `clear(id?)`, both resolving undefined or rejecting with the app's codes.
 * [file] (optional) keeps what was posted; [origin]() names the export running ({ fn, job }); [revoked] or
 * KINO_NOTIFICATIONS_REVOKED=1: the person switched it off.
 */
export function kitNotificationsApi(manifest, { file = null, origin = () => ({}), revoked = false, env = process.env, now = Date.now, syncCall = false } = {}) {
  let list = [];
  if (file && existsSync(file)) { try { list = JSON.parse(readFileSync(file, "utf8")); } catch { list = []; } }
  const posts = [];
  const save = () => {
    const t = now();
    const per = new Map();
    list = list.filter((n) => t - n.postedAtMs <= N.limits.keepDays * 86_400_000).sort((a, b) => b.postedAtMs - a.postedAtMs)
      .filter((n) => { const c = (per.get(n.pluginId) || 0) + 1; per.set(n.pluginId, c); return c <= N.limits.maxKept; });
    if (file) { try { writeFileSync(file, JSON.stringify(list, null, 2) + "\n"); } catch { /* the kit's own file */ } }
  };
  const gate = () => {
    if (!(manifest.capabilities || []).includes(N.capability) || revoked || env.KINO_NOTIFICATIONS_REVOKED === "1") {
      throw codedError("permission_denied", 'kino.notifications needs the "notifications" capability, approved and switched on by the person');
    }
    const o = origin();
    if (syncCall || !N.fromFunctions.includes(o.fn) || (o.fn === contract.kinoJobs.export && !o.job)) {
      throw codedError("permission_denied", `kino.notifications only answers in ${N.fromFunctions.join(", ")}`);
    }
  };
  const bad = (why) => codedError("bad_request", "kino.notifications.post: " + why);
  async function post(notice) {
    await null;
    gate();
    if (!plainObject(notice)) throw bad("the notice must be an object");
    if (Object.keys(notice).some((k) => !N.fields.includes(k))) throw bad(`takes only ${N.fields.join(", ")}`);
    if (typeof notice.id !== "string" || !ID.test(notice.id)) throw bad("id must be 1 to 64 of A-Z a-z 0-9 . _ -");
    const text = (k, max, required) => {
      const v = notice[k];
      if (v === undefined || v === null) { if (required) throw bad(`${k} is required`); return undefined; }
      if (typeof v !== "string") throw bad(`${k} must be text`);
      const t = plain(v);
      if (t === null) { if (required) throw bad(`${k} is empty`); return undefined; }
      if (t.length > max) throw bad(`${k} must be at most ${max} characters`);
      return t;
    };
    const n = {
      pluginId: manifest.id, id: notice.id, title: text("title", N.limits.maxTitleChars, true), titleEn: text("titleEn", N.limits.maxTitleChars, false),
      text: text("text", N.limits.maxTextChars, false), textEn: text("textEn", N.limits.maxTextChars, false),
      go: notice.go == null ? null : noticeGo(notice.go), postedAtMs: now(), read: false,
    };
    const t = now();
    while (posts.length && t - posts[0] >= 3_600_000) posts.shift();
    if (posts.length >= N.limits.perHour) throw codedError("rate_limited", `kino.notifications.post: at most ${N.limits.perHour} notices an hour`);
    posts.push(t);
    list = [n, ...list.filter((x) => !(x.pluginId === n.pluginId && x.id === n.id))];
    save();
  }
  async function clear(id) {
    await null;
    gate();
    if (id !== undefined && id !== null && (typeof id !== "string" || !ID.test(id))) throw codedError("bad_request", "kino.notifications.clear: id must be 1 to 64 of A-Z a-z 0-9 . _ -");
    list = list.filter((x) => !(x.pluginId === manifest.id && (id == null || x.id === id)));
    save();
  }
  return Object.freeze({ post, clear, list: () => list.slice() });
}
