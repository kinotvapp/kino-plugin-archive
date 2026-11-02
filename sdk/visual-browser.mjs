// kino.visualBrowser (apiVersion 20, manifest "visualBrowser": true): the app's VisualBrowser rules (PluginVisualBrowser.kt) as the kit
// applies them. Node has no window: createKino's `visualBrowser` option is the person ("async (ask) => window result"); everything
// else -- the request's validation, the hosts, the cookie selection and caps, what is stored and what the script may see -- is here, the
// same words and numbers as the app (contract.visualBrowser, pinned by the app's parity test).
import { contract } from "./contract.mjs";

const V = () => contract.visualBrowser;
const COOKIE_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORMAT_RANGES = [[0x00AD, 0x00AD], [0x0600, 0x0605], [0x061C, 0x061C], [0x06DD, 0x06DD], [0x070F, 0x070F], [0x0890, 0x0891], [0x08E2, 0x08E2],
  [0x180E, 0x180E], [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x2064], [0x2066, 0x206F], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB],
  [0x110BD, 0x110BD], [0x110CD, 0x110CD], [0x13430, 0x1343F], [0x1BCA0, 0x1BCA3], [0x1D173, 0x1D17A], [0xE0001, 0xE0001], [0xE0020, 0xE007F]];
const refusedTitleChar = (v) => [...v].some((ch) => { const cp = ch.codePointAt(0); return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || FORMAT_RANGES.some(([a, b]) => cp >= a && cp <= b); });

/** HostRules.isLocalAddress: an IP literal, localhost, a local-only suffix or a name whose last label is all digits. */
export function isLocalAddress(host) {
  const h = host.toLowerCase().replace(/\.+$/, "");
  if (!h || h.includes(":") || h.includes("[")) return true;
  if (h === "localhost" || [".local", ".lan", ".internal", ".localhost", ".home.arpa"].some((s) => h.endsWith(s))) return true;
  return /^\d+$/.test(h.slice(h.lastIndexOf(".") + 1));
}

/** HostRules.matches: an exact host or `*.base` for every sub-domain (not the bare base). */
export function hostMatches(host, patterns) {
  const h = host.toLowerCase().replace(/\.+$/, "");
  return patterns.some((p) => (p.startsWith("*.") ? h.endsWith("." + p.slice(2)) : h === p));
}

/** VisualBrowser.navigationAllowed. */
export function navigationAllowed(url, declared) {
  if (typeof url !== "string" || url.length > V().maxUrlChars) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || (u.port !== "" && u.port !== "443")) return false;
  if (u.username || u.password) return false;
  if (isLocalAddress(u.hostname)) return false;
  return hostMatches(u.hostname, declared);
}

/** VisualBrowser.globMatches: `*` is any run of characters, the rest literal, against the whole address. */
export function globMatches(pattern, url) {
  let p = 0, s = 0, star = -1, mark = 0;
  while (s < url.length) {
    if (p < pattern.length && pattern[p] === "*") { star = p++; mark = s; }
    else if (p < pattern.length && pattern[p] === url[s]) { p++; s++; }
    else if (star >= 0) { p = star + 1; s = ++mark; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

/** VisualBrowser.stripWebViewMarker. */
export const stripWebViewMarker = (ua) => ua.replace(/;\s*wv\b/g, "");

/** VisualBrowser.effectiveUserAgent: null for the WebView's own. */
export function effectiveUserAgent(choice) {
  if (choice === null || choice === undefined) return null;
  return stripWebViewMarker(choice === V().userAgentBrowser ? V().browserUserAgent : choice);
}

/** VisualBrowser.selectCookies: [jars] one `Cookie` header per host the window was on, in order (a later host wins a name). */
export function selectCookies(names, jars) {
  const found = new Map();
  for (const header of jars) for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (names.includes(name)) found.set(name, pair.slice(eq + 1).trim());
  }
  const out = {};
  let chars = 0, count = 0;
  for (const n of names) {
    if (!found.has(n)) continue;
    const v = found.get(n);
    if (count >= V().maxCookies || chars + n.length + v.length > V().maxCookieChars) break;
    out[n] = v;
    chars += n.length + v.length;
    count++;
  }
  return out;
}

/** VisualBrowser.formatStored. */
export function formatStored(cookies, format) {
  return format === "json" ? JSON.stringify(cookies) : Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

const bad = (message) => ({ error: `kino.visualBrowser.open: ${message}` });
const names = (raw, where) => {
  if (raw === undefined || raw === null) return { list: [] };
  if (!Array.isArray(raw)) return { error: `${where} must be a list of cookie names` };
  if (raw.length > V().maxCookieNames) return { error: `${where} holds more than ${V().maxCookieNames} names` };
  const out = new Set();
  for (const n of raw) {
    if (typeof n !== "string") return { error: `${where} must be a list of cookie names` };
    if (!n || n.length > V().maxCookieNameChars || !COOKIE_NAME.test(n)) return { error: `${where}: "${n.slice(0, 40)}" is not a cookie name` };
    out.add(n);
  }
  return { list: [...out] };
};

/**
 * VisualBrowser.parse: `{ options }` or `{ error }` (the message the app throws as `bad_args`). [declared] the manifest's hosts,
 * [secretSettings] the keys of its password settings.
 */
export function parseOptions(o, declared, secretSettings) {
  const C = V();
  if (o === null || typeof o !== "object" || Array.isArray(o)) return bad("takes { url, title?, doneWhen?, collect?, userAgent?, timeoutMs? }");
  if (typeof o.url !== "string") return bad("url must be a string");
  if (o.url.length > C.maxUrlChars) return bad(`url is over ${C.maxUrlChars} characters`);
  if (!navigationAllowed(o.url, declared)) return bad("url must be https on a host listed in the plugin's manifest hosts");
  let title = null;
  if (o.title !== undefined && o.title !== null) {
    if (typeof o.title !== "string") return bad("title must be a string");
    if (o.title.length > C.maxTitleChars) return bad(`title is over ${C.maxTitleChars} characters`);
    if (refusedTitleChar(o.title)) return bad("title holds a control or formatting character");
    title = o.title.trim() || null;
  }
  let doneCookies = [], doneUrlMatches = null;
  if (o.doneWhen !== undefined && o.doneWhen !== null) {
    if (typeof o.doneWhen !== "object" || Array.isArray(o.doneWhen)) return bad("doneWhen must be an object");
    const r = names(o.doneWhen.cookies, "doneWhen.cookies");
    if (r.error) return bad(r.error);
    doneCookies = r.list;
    const m = o.doneWhen.urlMatches;
    if (m !== undefined && m !== null) {
      if (typeof m !== "string") return bad("doneWhen.urlMatches must be a string");
      if (!m || m.length > C.maxUrlMatchChars) return bad(`doneWhen.urlMatches must be 1 to ${C.maxUrlMatchChars} characters`);
      doneUrlMatches = m;
    }
  }
  let collectCookies = [], html = false, finalUrl = false, storeAs = null;
  if (o.collect !== undefined && o.collect !== null) {
    const c = o.collect;
    if (typeof c !== "object" || Array.isArray(c)) return bad("collect must be an object");
    const r = names(c.cookies, "collect.cookies");
    if (r.error) return bad(r.error);
    collectCookies = r.list;
    if (c.html !== undefined && c.html !== null) { if (typeof c.html !== "boolean") return bad("collect.html must be true or false"); html = c.html; }
    if (c.finalUrl !== undefined && c.finalUrl !== null) { if (typeof c.finalUrl !== "boolean") return bad("collect.finalUrl must be true or false"); finalUrl = c.finalUrl; }
    if (c.storeAs !== undefined && c.storeAs !== null) {
      const s = c.storeAs;
      if (typeof s !== "object" || Array.isArray(s)) return bad("collect.storeAs must be an object");
      if (typeof s.setting !== "string") return bad("collect.storeAs.setting must be a string");
      if (s.setting.length > 64 || !secretSettings.includes(s.setting)) return bad("collect.storeAs.setting must name a password setting declared in the manifest");
      if (!C.storeFormats.includes(s.format)) return bad('collect.storeAs.format must be "header" or "json"');
      if (!collectCookies.length) return bad("collect.storeAs needs collect.cookies");
      let thenEvent = null;
      if (s.thenEvent !== undefined && s.thenEvent !== null) {
        if (typeof s.thenEvent !== "string") return bad("collect.storeAs.thenEvent must be a string");
        if (!/^[A-Za-z0-9._~-]{1,128}$/.test(s.thenEvent) || s.thenEvent === "open") return bad('collect.storeAs.thenEvent must be a screenEvent name (1 to 128 letters, digits, . _ ~ -), not "open"');
        thenEvent = s.thenEvent;
      }
      let spill = [];
      if (s.spill !== undefined && s.spill !== null) {
        if (!Array.isArray(s.spill)) return bad("collect.storeAs.spill must be a list of setting names");
        if (s.spill.length < 1 || s.spill.length > C.maxSpill) return bad(`collect.storeAs.spill must list 1 to ${C.maxSpill} password settings`);
        const seen = new Set();
        for (const n of s.spill) {
          if (typeof n !== "string") return bad("collect.storeAs.spill must list setting names");
          if (n.length > 64 || !secretSettings.includes(n)) return bad("collect.storeAs.spill must name password settings declared in the manifest");
          if (n === s.setting) return bad('collect.storeAs.spill must not repeat "setting"');
          if (seen.has(n)) return bad(`collect.storeAs.spill names "${n.slice(0, 40)}" twice`);
          seen.add(n);
        }
        spill = [...s.spill];
      }
      storeAs = { setting: s.setting, format: s.format, thenEvent, spill };
    }
  }
  let userAgent = null;
  if (o.userAgent !== undefined && o.userAgent !== null) {
    if (typeof o.userAgent !== "string") return bad("userAgent must be a string");
    const printable = o.userAgent.length >= 1 && o.userAgent.length <= C.maxUserAgentChars && [...o.userAgent].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e);
    if (o.userAgent !== C.userAgentBrowser && !printable) return bad(`userAgent must be "browser" or 1 to ${C.maxUserAgentChars} printable ASCII characters`);
    userAgent = o.userAgent;
  }
  let timeoutMs = C.maxTimeoutMs;
  if (o.timeoutMs !== undefined && o.timeoutMs !== null) {
    if (typeof o.timeoutMs !== "number" || Number.isNaN(o.timeoutMs)) return bad("timeoutMs must be a number");
    timeoutMs = Math.trunc(Math.min(C.maxTimeoutMs, Math.max(C.minTimeoutMs, o.timeoutMs)));
  }
  return { options: { url: o.url, title, doneCookies, doneUrlMatches, collectCookies, collectHtml: html, collectFinalUrl: finalUrl, storeAs, userAgent, timeoutMs, hasDoneWhen: doneCookies.length > 0 || doneUrlMatches !== null } };
}

/**
 * VisualBrowser.cutForSettings: [text] cut into one piece per entry of [limits] (each setting's longest text, in write order);
 * the pieces after the text's end are empty, a surrogate pair is never split, and joined with no separator they are [text]
 * again. null when the text does not fit all of them.
 */
export function cutForSettings(text, limits) {
  const out = [];
  let at = 0;
  for (const limit of limits) {
    let end = Math.min(text.length, at + Math.max(limit, 0));
    if (end < text.length && end > at) { const c = text.charCodeAt(end - 1); if (c >= 0xD800 && c <= 0xDBFF) end--; }
    out.push(text.slice(at, end));
    at = end;
  }
  return at === text.length ? out : null;
}

/**
 * PluginVisualBrowser.answer: what the script gets from the window's result [r] `{ status, finalUrl?, cookies?, html? }`; with
 * storeAs, [store] is called with (pieces, then) -- pieces is `{ setting: text }` for `setting` then each `spill` setting (empty strings
 * for the ones the text does not reach), the kit's stand-in for the app's ONE save after the call;
 * [then] is `{ event, arg: { stored: [names] } }` when `storeAs.thenEvent` was given and [fromScreen] (the call is a plugin
 * screen's), else null -- and the values never appear in the answer.
 */
export function answerFor(options, r, store, secretMaxChars, fromScreen = false) {
  const C = V();
  const status = C.statuses.includes(r.status) ? r.status : "closed";
  const out = { status };
  if (options.collectFinalUrl && typeof r.finalUrl === "string") out.finalUrl = r.finalUrl;
  if (options.collectHtml && status === "done" && typeof r.html === "string") out.html = r.html.slice(0, C.maxHtmlChars);
  if (status === "done" && options.collectCookies.length) {
    const cookies = {};
    for (const [k, v] of Object.entries(r.cookies || {})) if (options.collectCookies.includes(k) && typeof v === "string") cookies[k] = v;
    if (!options.storeAs) out.cookies = cookies;
    else {
      const text = formatStored(cookies, options.storeAs.format);
      const settings = [options.storeAs.setting, ...(options.storeAs.spill || [])];
      const pieces = cutForSettings(text, settings.map((k) => secretMaxChars[k] ?? 0));
      if (!Object.keys(cookies).length) { out.stored = false; out.storedNames = []; }
      else if (!pieces) {
        const room = settings.reduce((n, k) => n + (secretMaxChars[k] ?? 0), 0);
        const where = settings.length === 1 ? `the setting "${settings[0]}" (at most ${room} characters)` : `the settings "${settings.join('", "')}" (at most ${room} characters together)`;
        return { error: { code: "store_failed", message: `kino.visualBrowser.open: the cookies do not fit ${where}; nothing was stored` } };
      } else {
        // thenEvent: told to the call's own screen only (a settings action or panelAction accepts it and sends nothing); names, never values.
        const then = options.storeAs.thenEvent && fromScreen ? { event: options.storeAs.thenEvent, arg: { stored: Object.keys(cookies) } } : null;
        store(Object.fromEntries(settings.map((k, i) => [k, pieces[i]])), then);
        out.stored = true;
        out.storedNames = Object.keys(cookies);
      }
    }
  }
  const ua = effectiveUserAgent(options.userAgent);
  if (ua) out.userAgent = ua;
  return out;
}

/** Where a window may open from: the scanner's gate (kit-call.mjs qrScanOriginAllowed); the sentence PluginVisualBrowser throws as `forbidden`. */
export const VISUAL_BROWSER_ONLY_FROM = "kino.visualBrowser.open only runs from a settings action, panelAction or screenEvent the person pressed";
