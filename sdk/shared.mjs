// Task 8q-2: kino.shared as Kino makes it (PluginShared, PluginSharedValues, PluginSharedBridge): a plugin's small store that
// syncs between the person's linked devices, last writer wins by a clock Kino assigns. The kit simulates two devices, "phone" and
// "tv", that sync when run.mjs ends (or when a test calls sync). Every rule is contract.kinoShared's; the shared cases
// (test/shared-cases.json) are run by the app too.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { contract } from "./contract.mjs";
import { roomRawDepth } from "./kino-shim.mjs";

const S = contract.kinoShared;
const L = S.limits;
const KEY = new RegExp(S.keyPattern);
const WORD = new RegExp(S.wordPattern, "g");
const NOT_STRICT = Number.MAX_SAFE_INTEGER;

/** UTF-8 bytes, as the app counts them. */
export const sharedBytes = (s) => Buffer.byteLength(String(s), "utf8");

/** The words of [key] that make it look like a secret (PluginShared.secretWords): a listed word or its plural, or api + key. */
export function sharedSecretWords(key) {
  const words = (String(key).match(WORD) || []).map((w) => w.toLowerCase());
  const hits = words.filter((w) => S.secretKeyTokens.includes(w) || (w.endsWith("s") && S.secretKeyTokens.includes(w.slice(0, -1))));
  for (let i = 0; i + 1 < words.length; i++) { const p = words[i] + words[i + 1]; if (p === "apikey" || p === "apikeys") hits.push(p); }
  return hits;
}

/** A key's problem as the app words it, or null. */
export function sharedKeyProblem(key) {
  if (typeof key !== "string" || !KEY.test(key)) return "a kino.shared key is 1 to 40 characters: letters, digits, _ . and -";
  if (sharedSecretWords(key).length) return "kino.shared never holds secrets: a key can't look like one (token, secret, password, cookie, session...)";
  return null;
}

/** [code, message] when [text] is not a value kino.shared keeps, else null (PluginShared.valueProblem). */
export function sharedValueProblem(text) {
  if (sharedBytes(text) > L.maxValueBytes) return ["too_large", `a kino.shared value is at most ${L.maxValueBytes} bytes of JSON`];
  const d = roomRawDepth(text, L.maxDepth);
  if (d === NOT_STRICT || d === Infinity || d === null) return ["bad_request", "a kino.shared value must be strict JSON"];
  if (d > L.maxDepth) return ["bad_request", `a kino.shared value is at most ${L.maxDepth} levels deep`];
  let v;
  try { v = JSON.parse(text); } catch { return ["bad_request", "a kino.shared value must be JSON"]; }
  if (v === null) return ["bad_request", "null removes a key: it is not a value"];
  return null;
}

const wire = (pluginId, key) => JSON.stringify([pluginId, key]);
const partsOf = (w) => {
  try {
    const a = JSON.parse(w);
    if (Array.isArray(a) && a.length === 2 && typeof a[0] === "string" && typeof a[1] === "string" && /^[a-z0-9][a-z0-9-]{1,39}$/.test(a[0])) return a;
  } catch { /* not a key */ }
  return null;
};
const nextClock = (prev, now) => Math.max(now, prev + 1);

/**
 * One device's store (PluginSharedValues): { entries, pending } are maps of wire key -> { at, v } (v null: a removal). A write is
 * local at once; its key travels at most once per syncEveryMs (pending holds the newest value meanwhile).
 */
export function createSharedStore({ now = Date.now, state = null } = {}) {
  let entries = new Map(Object.entries(state?.entries || {}));
  let pending = new Map(Object.entries(state?.pending || {}));
  const sentAt = new Map();
  const trips = new Map();
  // How long until [w] of [pluginId] may travel (PluginSharedValues.waitFor): its key once a minute, the plugin's tripsPerMinute.
  const waitFor = (pluginId, w, t) => {
    const last = sentAt.get(w);
    const keyWait = last === undefined || t < last ? 0 : Math.max(0, last + L.syncEveryMs - t);
    const q = trips.get(pluginId) || [];
    while (q.length && (t - q[0] >= L.syncEveryMs || t < q[0])) q.shift();
    trips.set(pluginId, q);
    const tripWait = q.length < L.tripsPerMinute ? 0 : q[0] + L.syncEveryMs - t;
    return Math.max(keyWait, tripWait);
  };
  const travelled = (pluginId, w, t) => { sentAt.set(w, t); const q = trips.get(pluginId) || []; q.push(t); trips.set(pluginId, q); };
  const acceptable = (w, s) => {
    const p = partsOf(w);
    if (!p || w !== wire(p[0], p[1]) || sharedKeyProblem(p[1]) !== null) return false;
    if (s.v === null || s.v === undefined) return true;
    return typeof s.v === "string" && sharedValueProblem(s.v) === null;
  };
  entries = new Map([...entries].filter(([w, s]) => acceptable(w, s)));
  pending = new Map([...pending].filter(([w, s]) => acceptable(w, s)));
  const visible = (w) => (pending.has(w) ? pending.get(w) : entries.get(w));
  const live = (pluginId) => {
    const out = new Map();
    for (const [w, s] of entries) { const p = partsOf(w); if (!pending.has(w) && s.v != null && p && p[0] === pluginId) out.set(p[1], s); }
    for (const [w, s] of pending) { const p = partsOf(w); if (s.v != null && p && p[0] === pluginId) out.set(p[1], s); }
    return out;
  };
  // PluginSharedValues.capped: per plugin and for the row, the newest values that fit; the rest kept as removals at their clock.
  const capped = (map) => {
    const out = new Map(map);
    const per = new Map();
    for (const [w, s] of out) { if (s.v == null) continue; const id = partsOf(w)?.[0]; if (!per.has(id)) per.set(id, []); per.get(id).push([w, s]); }
    for (const list of per.values()) {
      let bytes = 0, count = 0;
      for (const [w, s] of list.sort((a, b) => b[1].at - a[1].at)) {
        const b = sharedBytes(s.v);
        if (count + 1 > L.maxKeys || bytes + b > L.maxPluginBytes) out.set(w, { at: s.at, v: null }); else { count++; bytes += b; }
      }
    }
    let rowBytes = 0;
    for (const [w, s] of [...out].filter(([, s]) => s.v != null).sort((a, b) => b[1].at - a[1].at)) {
      const b = sharedBytes(s.v);
      if (rowBytes + b > L.maxRowBytes) out.set(w, { at: s.at, v: null }); else rowBytes += b;
    }
    const t = now();
    for (const [w, s] of [...out]) if (s.v == null && s.at < t - L.tombstoneMs) out.delete(w);
    const removals = new Map();
    for (const [w, s] of out) { if (s.v != null) continue; const id = partsOf(w)?.[0]; if (!removals.has(id)) removals.set(id, []); removals.get(id).push([w, s]); }
    for (const list of removals.values()) {
      if (list.length > L.maxRemovals) for (const [w] of list.sort((a, b) => a[1].at - b[1].at).slice(0, list.length - L.maxRemovals)) out.delete(w);
    }
    if (out.size > L.maxRowEntries) {
      const drop = [...out].filter(([, s]) => s.v == null).sort((a, b) => a[1].at - b[1].at).slice(0, out.size - L.maxRowEntries);
      for (const [w] of drop) out.delete(w);
    }
    return out;
  };
  return {
    get(pluginId, key) {
      const s = visible(wire(pluginId, key));
      if (!s || typeof s.v !== "string" || sharedValueProblem(s.v) !== null) return null;
      return s.v;
    },
    keys(pluginId) { return [...live(pluginId)].sort((a, b) => a[1].at - b[1].at).map(([k]) => k); },
    /** "synced" | "held" | "unchanged" | [code, message] (PluginSharedValues.set). */
    set(pluginId, key, text) {
      const kp = sharedKeyProblem(key);
      if (kp) return ["bad_request", kp];
      if (text !== null) { const vp = sharedValueProblem(text); if (vp) return vp; }
      const w = wire(pluginId, key);
      const t = now();
      const current = visible(w);
      if ((current ? current.v : null) === text) return "unchanged";
      if (text !== null) {
        const others = [...live(pluginId)].filter(([k]) => k !== key);
        if (others.length + 1 > L.maxKeys) return ["too_large", `a plugin keeps at most ${L.maxKeys} kino.shared keys`];
        const total = others.reduce((n, [, s]) => n + sharedBytes(s.v), 0) + sharedBytes(text);
        if (total > L.maxPluginBytes) return ["too_large", `a plugin keeps at most ${L.maxPluginBytes} bytes in kino.shared`];
      }
      const stamp = { at: nextClock(Math.max(entries.get(w)?.at ?? 0, pending.get(w)?.at ?? 0), t), v: text };
      if (waitFor(pluginId, w, t) === 0) {
        travelled(pluginId, w, t);
        entries.set(w, stamp);
        entries = capped(entries);
        pending.delete(w);
        return "synced";
      }
      pending.set(w, stamp);
      return "held";
    },
    flushDue() {
      const t = now();
      for (const [w, s] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        const pluginId = partsOf(w)?.[0];
        if (!pluginId || waitFor(pluginId, w, t) > 0) continue;
        if (s.at > (entries.get(w)?.at ?? 0)) entries.set(w, s);
        travelled(pluginId, w, t);
        pending.delete(w);
      }
      entries = capped(entries);
    },
    forget(pluginId) {
      const t = now();
      for (const w of new Set([...entries.keys(), ...pending.keys()])) {
        if (partsOf(w)?.[0] !== pluginId) continue;
        if (entries.get(w)?.v == null && entries.has(w) && !pending.has(w)) continue;
        entries.set(w, { at: nextClock(Math.max(entries.get(w)?.at ?? 0, pending.get(w)?.at ?? 0), t), v: null });
        sentAt.set(w, t);
        pending.delete(w);
      }
      entries = capped(entries);
    },
    snapshot() { return new Map(entries); },
    clocks() {
      const out = new Map();
      for (const [w, s] of entries) out.set(w, s.at);
      for (const [w, s] of pending) out.set(w, Math.max(out.get(w) ?? 0, s.at));
      return out;
    },
    /** A peer's entries, checked again (never trusted). */
    applyRemote(incoming) {
      const accepted = [...incoming].filter(([w, s]) => acceptable(w, s) && s.at > (entries.get(w)?.at ?? 0) && s.at > (pending.get(w)?.at ?? 0));
      if (!accepted.length) return;
      for (const [w, s] of accepted) { entries.set(w, s); pending.delete(w); }
      entries = capped(entries);
    },
    toJSON() { return { entries: Object.fromEntries(entries), pending: Object.fromEntries(pending) }; },
  };
}

/** One sync from [from] to [to], as the app's sealed row does it: only what is newer there. */
export function syncShared(from, to) {
  const clocks = to.clocks();
  to.applyRemote(new Map([...from.snapshot()].filter(([w, s]) => s.at > (clocks.get(w) ?? 0))));
}

/**
 * The kit's two simulated devices: { phone, tv, sync() (both ways, what is due), save() }. [file] keeps them between runs of
 * run.mjs (`.kino-shared.json` in the plugin's folder), so a job run with --device phone is read by a screen run with --device tv.
 */
export function createSharedDevices({ now = Date.now, file = null } = {}) {
  let saved = {};
  if (file && existsSync(file)) { try { saved = JSON.parse(readFileSync(file, "utf8")); } catch { saved = {}; } }
  const phone = createSharedStore({ now, state: saved.phone });
  const tv = createSharedStore({ now, state: saved.tv });
  return {
    phone, tv,
    of(device) { return device === "tv" ? tv : phone; },
    sync() { phone.flushDue(); tv.flushDue(); syncShared(phone, tv); syncShared(tv, phone); },
    save() { if (file) writeFileSync(file, JSON.stringify({ phone: phone.toJSON(), tv: tv.toJSON() }, null, 2)); },
  };
}

/** A kino error as the app's prelude throws it. */
function kinoError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * kino.shared over [store] (one device) for [manifest], with the app's gates (PluginSharedBridge + the prelude): the "shared"
 * capability, the key, JSON only, the caps, secret-looking keys and the write rate.
 */
export function kitSharedApi(manifest, store, { now = Date.now } = {}) {
  const declared = () => (manifest.capabilities || []).includes(S.capability);
  // PluginSharedBridge's bucket: writesPerMinute, one back every minute / writesPerMinute.
  let tokens = L.writesPerMinute, at = now();
  const takeWrite = () => {
    const t = now();
    tokens = Math.min(L.writesPerMinute, tokens + Math.max(0, t - at) / (60000 / L.writesPerMinute));
    at = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
  const gateKey = (op, key) => {
    if (typeof key !== "string" || key.length < 1 || key.length > L.maxKeyChars) throw kinoError("bad_request", `kino.shared.${op}: a key is a string of 1 to ${L.maxKeyChars} characters`);
    if (!declared()) throw kinoError("not_allowed", 'kino.shared needs the "shared" capability, and the plugin switched on');
    const kp = sharedKeyProblem(key);
    if (kp) throw kinoError("bad_request", kp);
  };
  return Object.freeze({
    get(key) {
      gateKey("get", key);
      const text = store.get(manifest.id, key);
      return text === null ? null : JSON.parse(text);
    },
    set(key, value) {
      let text = null;
      if (typeof key !== "string" || key.length < 1 || key.length > L.maxKeyChars) throw kinoError("bad_request", `kino.shared.set: a key is a string of 1 to ${L.maxKeyChars} characters`);
      if (value !== null) {
        try { text = JSON.stringify(value); } catch { text = undefined; }
        if (typeof text !== "string") throw kinoError("bad_request", "kino.shared.set: the value must be JSON (null removes the key)");
        if (text.length > L.maxValueBytes) throw kinoError("too_large", `kino.shared.set: a value is at most ${L.maxValueBytes} bytes of JSON`);
      }
      gateKey("set", key);
      if (!takeWrite()) throw kinoError("rate_limited", `kino.shared takes at most ${L.writesPerMinute} writes a minute`);
      const r = store.set(manifest.id, key, text);
      if (Array.isArray(r)) throw kinoError(r[0], r[1]);
      return r !== "unchanged";
    },
  });
}
