// The plugin contract as the Node kit sees it: contract.json (the numbers and rules) plus the same
// validation the app runs on a manifest and on what each function returns. Kino's own app code is
// authoritative; a test in the app pins every value here to it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Published kit: contract.json next to the sdk/ folder. Kino's own repo: docs/plugins/contract.json.
export function loadContract() {
  for (const p of [join(here, "..", "contract.json"), join(here, "..", "..", "docs", "plugins", "contract.json")]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  throw new Error("contract.json not found next to sdk/");
}

export const contract = loadContract();

const re = (pattern) => new RegExp(pattern);
// Every regex/list below is read from contract.json, never hand-retyped: a hand-typed copy of the
// app's version pattern once allowed unbounded digits per segment where the app's own regex bounds
// each to 6 — the drift a hand-duplicated value invites, and exactly what this avoids.
const SEMVER = re(contract.manifest.versionPattern);
const PATH_SEGMENT = re(contract.manifest.pathSegmentPattern);
const LABEL = re(contract.hostRules.labelPattern);
const PRIVATE_SUFFIXES = contract.hostRules.privateSuffixes;

/** "5 MB" / "256 KB": how the app phrases a byte limit in its own Spanish messages. */
export function kb(bytes) {
  return bytes % (1024 * 1024) === 0 ? `${bytes / 1024 / 1024} MB` : `${bytes / 1024} KB`;
}

export function isSafeRelativePath(p) {
  return typeof p === "string" && p.length > 0 && p.length <= contract.manifest.maxPathChars && !p.startsWith("/") && !p.includes("\\") &&
    p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && PATH_SEGMENT.test(s));
}

export function isValidHostPattern(pattern) {
  const host = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  if (!host || host.includes("*") || host.length > contract.hostRules.maxHostChars || host.includes(":") || host.includes("[")) return false;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return !/^\d+$/.test(labels[labels.length - 1]);
}

export function hostMatches(host, patterns) {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => (p.startsWith("*.") ? h.endsWith("." + p.slice(2)) : h === p));
}

/**
 * The one scheme rule of a declared host (the app's `EffectiveHosts.allowsScheme`): https always;
 * plain http only on a host the manifest marked `insecureHttp` (apiVersion 2), matched exactly --
 * never through a `*.` pattern, never a subdomain. A typed server has its own rule (`isUserServer`).
 */
export function schemeAllowed(u, manifest) {
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const h = String(u.hostname).toLowerCase().replace(/\.$/, "");
  return (manifest.insecureHosts || []).includes(h);
}

/** What the entry must export: the capabilities' functions, settingsStatus/action for a status (or qr, apiVersion 13)/action setting, and `section` for a declared section (apiVersion 6). */
export function requiredExports(caps, settings = [], manifest = {}) {
  const ui = contract.settings.ui.exports;
  const fromSettings = [
    ...(settings.some((s) => s && (s.type === "status" || s.type === "qr")) ? [ui.status] : []),
    ...(settings.some((s) => s && s.type === "action") ? [ui.action] : []),
  ];
  return [...new Set([...caps.flatMap((c) => contract.capabilities.exports[c] || (contract.capabilities.declarative.includes(c) ? [] : [c])), ...fromSettings, ...(manifest.section ? [contract.manifest.section.export] : []), ...(manifest.panel ? [contract.manifest.panel.exports.panel] : []), ...((manifest.screen?.replaces || []).includes("categories") ? [contract.output.categories.export] : [])])];
}

/** PluginManifest.kt's refusals for the `screen` field (apiVersion 14). */
/** A `go.screen` route (PluginScreenOutput.GO_ROUTE). */
const GO_ROUTE = /^[A-Za-z0-9._~-]{1,64}$/;

/**
 * PluginScreenOutput.screenGoOf: a `go.screen`'s value (Task 7g), `{ route?, args? }` and nothing else, or null with [bad] told
 * why. Shared by screens, the player panel and the `open` of a home/section/browse item or row. `args` is measured as the app
 * measures it (org.json's text, which escapes "/").
 */
export function screenGoOf(v, bad) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) { bad("is not an object"); return null; }
  if (Object.keys(v).some((k) => k !== "route" && k !== "args")) { bad("takes only route and args"); return null; }
  const S = contract.manifest.screen.limits;
  let route = null;
  if (v.route !== undefined && v.route !== null) {
    if (typeof v.route !== "string" || !GO_ROUTE.test(v.route) || v.route.length > S.maxGoRouteChars) { bad(`route must be 1 to ${S.maxGoRouteChars} letters, digits or . _ ~ -`); return null; }
    route = v.route;
  }
  let args = null;
  if (v.args !== undefined && v.args !== null) {
    if (typeof v.args !== "object" || Array.isArray(v.args)) { bad("args is not an object"); return null; }
    if (Buffer.byteLength(JSON.stringify(v.args).replace(/\//g, "\\/"), "utf8") > S.maxGoArgsBytes) { bad(`args is over ${S.maxGoArgsBytes} bytes`); return null; }
    args = v.args;
  }
  return { ...(route !== null ? { route } : {}), ...(args !== null ? { args } : {}) };
}

/** A value as the app's screen log lines show it (PluginScreenOutput.fmt). */
function goFmt(v) {
  if (typeof v === "string") return `"${v.slice(0, 40)}"`;
  if (v === undefined || v === null) return "null";
  const t = typeof v === "number" ? (Number.isInteger(v) ? String(v) : javaDouble(v)) : typeof v === "object" ? JSON.stringify(v).replace(/\//g, "\\/") : String(v);
  return t.slice(0, 40);
}

/**
 * PluginScreenOutput.titleByIdsOf (Task 8m): a `go.titleByIds`'s value, only its fields, a kind of movie or series, at least
 * one of tmdb and imdb, every number a whole number in its range and the title scrubbed; or null with [bad] told the first
 * reason. A null field is an absent one. Shared by screens and the player panel's answers. Returns only the fields kept.
 */
export function titleByIdsOf(v, bad) {
  const T = contract.manifest.screen.goTitleByIds;
  if (v === null || typeof v !== "object" || Array.isArray(v)) { bad("is not an object"); return null; }
  if (Object.keys(v).some((k) => !T.fields.includes(k))) { bad(`takes only ${T.fields.join(", ")}`); return null; }
  const present = (k) => v[k] !== undefined && v[k] !== null;
  const kind = present("kind") ? v.kind : null;
  if (typeof kind !== "string" || !T.kinds.includes(kind)) { bad(`kind ${goFmt(kind)} is not ${T.kinds.join(", ")}`); return null; }
  const NOT = Symbol("not whole");
  const whole = (k, lo, hi) => {
    if (!present(k)) return null;
    const d = v[k];
    if (typeof d !== "number" || !Number.isInteger(d) || d < lo || d > hi) { bad(`${k} must be a whole number from ${lo} to ${hi}`); return NOT; }
    return d;
  };
  const tmdb = whole("tmdb", 1, T.maxTmdb);
  if (tmdb === NOT) return null;
  let imdb = null;
  if (present("imdb")) {
    if (typeof v.imdb !== "string" || !new RegExp(T.imdbPattern).test(v.imdb)) { bad("imdb must be tt and 7 to 10 digits"); return null; }
    imdb = v.imdb;
  }
  if (tmdb === null && imdb === null) { bad("needs tmdb or imdb"); return null; }
  const season = whole("season", 0, T.maxSeason);
  if (season === NOT) return null;
  const episode = whole("episode", 1, T.maxEpisode);
  if (episode === NOT) return null;
  if ((season !== null || episode !== null) && kind !== "series") { bad("season and episode are for a series only"); return null; }
  if (episode !== null && season === null) { bad("episode needs a season"); return null; }
  const year = whole("year", T.minYear, T.maxYear);
  if (year === NOT) return null;
  const badTitle = `title must be text of at most ${T.maxTitleChars} characters`;
  let title = null;
  if (present("title")) {
    if (typeof v.title !== "string") { bad(badTitle); return null; }
    const t = v.title.replace(new RegExp(T.scrubPattern, "g"), "").trim();
    if (t.length > T.maxTitleChars) { bad(badTitle); return null; }
    if (t !== "") title = t;
  }
  const out = { kind };
  if (tmdb !== null) out.tmdb = tmdb;
  if (imdb !== null) out.imdb = imdb;
  if (season !== null) out.season = season;
  if (episode !== null) out.episode = episode;
  if (title !== null) out.title = title;
  if (year !== null) out.year = year;
  return out;
}

/**
 * ScreenUrl.read (Task 8s): a `go.url`'s href by the same textual rule as the app, step for step, so both give the same
 * verdict, reason and normalized address (screen-cases.json pins it). Returns `{ href, host }` or `{ bad }`. The kit never
 * gates on `new URL()`: the WHATWG parser re-encodes `'` in a query, maps or refuses some punycode labels and resolves dot
 * segments, so it would disagree with the app. The app also asks java.net.URI, which accepts everything this rule accepts.
 */
export function urlHrefOf(raw) {
  const U = contract.manifest.screen.goUrl;
  const NOT_HTTPS = "href must be an https address";
  const NOT_VALID = "href is not a valid address";
  if (typeof raw !== "string" || raw === "") return { bad: NOT_HTTPS };
  if (raw.length > U.maxHrefChars) return { bad: `href is longer than ${U.maxHrefChars} characters` };
  if (!new RegExp(U.hrefChars).test(raw)) return { bad: "href holds a space, a control, direction or non-ASCII character (write the host as punycode, percent-encode the rest)" };
  if (raw.slice(0, 8).toLowerCase() !== "https://") return { bad: NOT_HTTPS };
  if (/%(?![0-9A-Fa-f]{2})/.test(raw) || raw.split("#").length > 2) return { bad: NOT_VALID };
  const rest = raw.slice(8);
  const cut = rest.search(/[/?#]/);
  const end = cut < 0 ? rest.length : cut;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  if (authority.includes("@")) return { bad: "href must not carry a user name or password" };
  const colon = authority.indexOf(":");
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!/^[0-9]*$/.test(port)) return { bad: NOT_VALID };
    if (port !== "" && port.replace(/^0+/, "") !== "443") return { bad: "href must not name a port other than 443" };
  }
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  if (!urlPublicName(host)) return { bad: `href host "${host.slice(0, 64)}" is not a public name with a dot (never an IP address, localhost, a local name or a single label)` };
  const path = tail === "" || tail[0] !== "/" ? `/${tail}` : tail;
  return { href: `https://${host}${path}`, host };
}

/** ScreenUrl.publicName: 2+ labels of letters, digits and inner hyphens, the last starting with a letter, never a local name. */
function urlPublicName(host) {
  if (host === "" || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || !/^[a-z]/.test(labels[labels.length - 1])) return false;
  return !contract.manifest.screen.goUrl.blockedSuffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * PluginScreenOutput.copyGoOf (Task 8x): a `go.copy`'s value, only text, label and sensitive; the text scrubbed (newlines kept),
 * trimmed, 1..goCopy.maxTextChars characters in at most goCopy.maxLines lines; the label scrubbed, trimmed, at most
 * goCopy.maxLabelChars (blank: none); sensitive true or false. Or null with [bad] told the first reason (never the text).
 * Returns `{ text, label?, sensitive? }` (`sensitive` only when true).
 */
export function copyGoOf(v, bad) {
  const C = contract.manifest.screen.goCopy;
  if (v === null || typeof v !== "object" || Array.isArray(v)) { bad("is not an object"); return null; }
  if (Object.keys(v).some((k) => !C.fields.includes(k))) { bad(`takes only ${C.fields.join(", ")}`); return null; }
  const badText = `text must be 1 to ${C.maxTextChars} characters`;
  if (typeof v.text !== "string") { bad(badText); return null; }
  const text = v.text.replace(new RegExp(C.textScrubPattern, "g"), "").trim();
  if (text === "" || text.length > C.maxTextChars) { bad(badText); return null; }
  if (text.split("\n").length > C.maxLines) { bad(`text must be at most ${C.maxLines} lines`); return null; }
  const badLabel = `label must be text of at most ${C.maxLabelChars} characters`;
  let label = null;
  if (v.label !== undefined && v.label !== null) {
    if (typeof v.label !== "string") { bad(badLabel); return null; }
    const l = v.label.replace(new RegExp(C.labelScrubPattern, "g"), "").trim();
    if (l.length > C.maxLabelChars) { bad(badLabel); return null; }
    if (l !== "") label = l;
  }
  let sensitive = false;
  if (v.sensitive !== undefined && v.sensitive !== null) {
    if (typeof v.sensitive !== "boolean") { bad("sensitive must be true or false"); return null; }
    sensitive = v.sensitive;
  }
  return { text, ...(label !== null ? { label } : {}), ...(sensitive ? { sensitive: true } : {}) };
}

/**
 * PluginScreenOutput.liveChannelGoOf (Task 11): a `go.liveChannel`'s value, exactly `provider` (a plugin id, never a reserved
 * one) and `code` (an item id: the channel's id in that plugin's listing). Or null with [bad] told the first reason.
 */
export function liveChannelGoOf(v, bad) {
  const L = contract.manifest.screen.goLiveChannel;
  if (v === null || typeof v !== "object" || Array.isArray(v)) { bad("is not an object"); return null; }
  if (Object.keys(v).some((k) => !L.fields.includes(k))) { bad(`takes only ${L.fields.join(", ")}`); return null; }
  if (typeof v.provider !== "string" || !new RegExp(L.providerPattern).test(v.provider) || L.reservedProviders.includes(v.provider)) {
    bad("provider must be a plugin id"); return null;
  }
  if (typeof v.code !== "string" || !new RegExp(L.codePattern).test(v.code)) { bad("code must be a channel id (1 to 128 letters, digits, . _ ~ -)"); return null; }
  return { provider: v.provider, code: v.code };
}

/**
 * ScreenLiveChannel.refusal (Task 11): why a kept `go.liveChannel` from [manifest]'s plugin is not honoured for an event of
 * [trigger] ("press", "submit", "change", "open", "timer", ...), or null when Kino tunes. Not the person's own press or submit:
 * "not_press"; a plugin whose approved contributing panel does not declare "live" in kinds: goLiveChannel.needsLiveTabLog.
 */
export function liveChannelGoRefusal(manifest, trigger) {
  const L = contract.manifest.screen.goLiveChannel;
  const C = contract.manifest.panel.contributes;
  if (!L.fromTriggers.includes(trigger)) return "not_press";
  const caps = manifest?.capabilities ?? [];
  const kinds = Array.isArray(manifest?.panel?.kinds) ? manifest.panel.kinds : C.kinds.default;
  if (manifest?.panel?.contributes !== true || !caps.includes(C.capability) || !kinds.includes(L.needsKind)) return L.needsLiveTabLog;
  return null;
}

/**
 * ScreenUrl.cleanTitle (Task 8s fix round 1, M3): goUrl.titleScrubPattern's characters removed, runs of combining marks cut to
 * goUrl.maxCombiningMarks, trimmed.
 */
export function urlTitleOf(raw) {
  const U = contract.manifest.screen.goUrl;
  return raw.replace(new RegExp(U.titleScrubPattern, "g"), "").replace(new RegExp(`(\\p{Mn}{${U.maxCombiningMarks}})\\p{Mn}+`, "gu"), "$1").trim();
}

/**
 * PluginScreenOutput.urlGoOf (Task 8s): a `go.url`'s value, only href and title, the href read by [urlHrefOf], the title
 * scrubbed and trimmed (at most goUrl.maxTitleChars); or null with [bad] told the first reason. Returns `{ href, title? }`.
 */
export function urlGoOf(v, bad) {
  const U = contract.manifest.screen.goUrl;
  if (v === null || typeof v !== "object" || Array.isArray(v)) { bad("is not an object"); return null; }
  if (Object.keys(v).some((k) => !U.fields.includes(k))) { bad(`takes only ${U.fields.join(", ")}`); return null; }
  const read = urlHrefOf(v.href === undefined ? null : v.href);
  if (read.bad !== undefined) { bad(read.bad); return null; }
  const badTitle = `title must be text of at most ${U.maxTitleChars} characters`;
  let title = null;
  if (v.title !== undefined && v.title !== null) {
    if (typeof v.title !== "string") { bad(badTitle); return null; }
    const t = urlTitleOf(v.title);
    if (t.length > U.maxTitleChars) { bad(badTitle); return null; }
    if (t !== "") title = t;
  }
  return title === null ? { href: read.href } : { href: read.href, title };
}

/** PluginManifest.kt's LABEL_SCRUB: what a plugin's button label never keeps (control characters, bidirectional overrides). */
const LABEL_SCRUB = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const SCREEN_MESSAGES = {
  notObject: 'The "screen" field must be an object with a "label"',
  badIconFile: 'The "screen.iconFile" field must be a relative path to a .png',
  bothIcons: 'The "screen" field takes an "icon" or an "iconFile", not both',
  badMenuOpens: 'The "screen.menuOpens" field must be "section", "screen" or "both"',
  menuNeedsSection: 'The "screen.menuOpens" value "section" or "both" needs the "section" field',
  badAdult: 'The "screen.adult" field must be true or false',
  badSettingsIn: 'The "screen.settingsIn" field must be "settings", "screen" or "both"',
  settingsNeedScreen: 'The "screen.settingsIn" value "screen" needs a screen entry: "screen.menuOpens" "screen" or "both", or "settings" in "screen.opensFrom"',
  badOpensFrom: 'The "screen.opensFrom" field must be a list of "menu" and "settings"',
  emptyOpensFrom: 'The "screen.opensFrom" field needs "menu", "settings" or both',
  badSettingsButton: 'The "screen.settingsButton" field must be an object whose "label" and "labelEn" are 1 to 40 characters',
  badReplaces: 'The "screen.replaces" field must be a list of "categories"',
  replacesNeedsCatalog: 'The "screen.replaces" value "categories" needs a catalog: the "browse" capability',
  needsCapability: 'The "screen" field needs the "screen" capability',
  capabilityNeedsBlock: 'The "screen" capability needs a "screen" field with a "label"',
};

/** Same checks, same order, same English messages as the app's own manifest validation. Returns { ok, field?, message?, manifest? }. */
const EXTERNAL_RESOLVER_BAD =
  'The "externalResolver" field must be an object with a "package" (an Android package name) and, optionally, an "apk" with a GitHub release or archive.org "url" (https://github.com/<owner>/<repo>/releases/download/<tag>/<file> or https://archive.org/download/<item>/<file>) and a 64-character hex "sha256"; "fdroid" may only be true and "downloader" an object with a "code" of 3 to 10 digits; "desktop" may only have "windows", "linux" and "macos", each an object with the same kind of "url" and "sha256"';
const DESKTOP_SYSTEMS = ["windows", "linux", "macos"];
const RESOLVER_APK_PATH = /^\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/releases\/(?:download\/[A-Za-z0-9._+-]{1,100}|latest\/download)\/[A-Za-z0-9._+-]{1,200}$/;
const RESOLVER_ARCHIVE_PATH = /^\/download\/[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._+-]{1,200}$/;

/** A `{ url, sha256 }` download: only a GitHub release asset or an archive.org file (that is where Kino fetches a recommended resolver from, nowhere else) and the sha256 its bytes must have. */
function resolverDownloadOk(a) {
  if (a === null || typeof a !== "object" || Array.isArray(a) || typeof a.url !== "string" || a.url.length > 2048 || /[\u0000-\u001f\u007f]/.test(a.url)) return false;
  let u;
  try { u = new URL(a.url); } catch { return false; }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password || u.search) return false;
  if (!(u.hostname === "github.com" ? RESOLVER_APK_PATH : u.hostname === "archive.org" ? RESOLVER_ARCHIVE_PATH : /(?!)/).test(u.pathname)) return false;
  return typeof a.sha256 === "string" && /^[0-9a-fA-F]{64}$/.test(a.sha256);
}

/** Whether `externalResolver` is well formed, as the app reads it: `{ package, apk?: { url, sha256, label? }, fdroid?: true, downloader?: { code }, desktop?: { windows|linux|macos: { url, sha256 } } }`. */
export function externalResolverOk(r) {
  if (r === null || typeof r !== "object" || Array.isArray(r)) return false;
  if (typeof r.package !== "string" || r.package.length > 255 || !ANDROID_PACKAGE.test(r.package)) return false;
  if (r.desktop !== undefined) {
    const d = r.desktop;
    if (d === null || typeof d !== "object" || Array.isArray(d)) return false;
    for (const [os, p] of Object.entries(d)) if (!DESKTOP_SYSTEMS.includes(os) || !resolverDownloadOk(p)) return false;
  }
  if (r.apk !== undefined) {
    const a = r.apk;
    if (!resolverDownloadOk(a)) return false;
    if (a.label !== undefined && (typeof a.label !== "string" || a.label.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(a.label.trim()))) return false;
  }
  if (r.fdroid !== undefined && r.fdroid !== true) return false;
  if (r.downloader !== undefined) {
    const d = r.downloader;
    if (d === null || typeof d !== "object" || Array.isArray(d) || typeof d.code !== "string" || !/^[0-9]{3,10}$/.test(d.code)) return false;
  }
  return true;
}

/**
 * ManifestParser.isStandaloneSet: at least one standalone capability and nothing else but standaloneSupplements (socket,
 * storageLarge, catalog, qrScan, room, schedule, ai, shared, and playerControl beside a panel). Such a plugin plays nothing and needs neither `required` nor `atLeastOneOf`.
 */
export function isStandaloneSet(caps) {
  const { standalone, standaloneSupplements = [] } = contract.capabilities;
  return caps.some((c) => standalone.includes(c)) && caps.every((c) => standalone.includes(c) || standaloneSupplements.includes(c));
}

/**
 * The app's ManifestParser.parse: the manifest validated, then each `enhancements` block this Kino knows (key <= maxApiVersion)
 * merged over it in numeric order through the same checks, at the key's apiVersion (contract.manifest.enhancements, Task 8c).
 * A block that fails is dropped (manifest.enhancementsDropped, as the app logs it): an enhancement never refuses the plugin.
 * [exports] (the script's, when known: the app's probe or record) also drops a block whose new exports the script lacks.
 * manifest.capabilities / screen / settings are the merged ones; manifest.enhancementsApplied lists the keys merged.
 */
export function validateManifest(text, { knownPermissions = contract.permissions, exports = null } = {}) {
  const base = validateManifestWithoutEnhancements(text, { knownPermissions });
  if (!base.ok) return base;
  return withEnhancements(JSON.parse(text), base.manifest, { knownPermissions }, exports);
}

/** ManifestParser.allRequiredExports: everything the entry must export for [m]. */
function allRequiredExports(m) {
  return new Set(requiredExports(m.capabilities, m.settings || [], m));
}

/** ManifestParser.shownKey: at most 40 characters, control and bidirectional characters replaced by "?". */
const shownKey = (k) => k.slice(0, 40).replace(LABEL_SCRUB, "?");

/**
 * G5, PluginManifest.settingsApiVersion: the apiVersion the settings list in effect was read at: the key of the last enhancement
 * that replaced `settings`, else the plugin's own. An action's setSettings (a password) and a status answer's `hide` gate on it.
 */
export function settingsApiVersion(manifest) {
  return manifest.settingsApiVersion ?? (manifest.apiVersion || 1);
}

/** The apiVersion whose features the manifest uses: its own, or the newest enhancement merged (PluginManifest.featureApiVersion). */
export function featureApiVersion(manifest) {
  return Math.max(manifest.apiVersion, ...(manifest.enhancementsApplied || []));
}

/** The manifest as a Kino before `enhancements` reads it: that key is never looked at (ManifestParser.parseWithoutEnhancements). */
export function validateManifestWithoutEnhancements(text, { knownPermissions = contract.permissions } = {}) {
  const bad = (field, message) => ({ ok: false, field, message });
  if (Buffer.byteLength(text, "utf8") > contract.manifest.maxBytes) return bad("kino-plugin.json", "The manifest is over 16 KB");
  let o;
  try { o = JSON.parse(text); } catch { return bad("kino-plugin.json", "The manifest is not valid JSON"); }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return bad("kino-plugin.json", "The manifest is not valid JSON");
  return validateManifestObject(o, { knownPermissions });
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** ManifestParser.withEnhancements: [base] with each block of o.enhancements this Kino knows merged in. */
function withEnhancements(o, base, opts, exports) {
  const E = contract.manifest.enhancements;
  if (!has(o, "enhancements")) return { ok: true, manifest: { ...base, enhancementsApplied: [], enhancementsDropped: [] } };
  const blocks = o.enhancements;
  if (blocks === null || typeof blocks !== "object" || Array.isArray(blocks)) {
    return { ok: true, manifest: { ...base, enhancementsApplied: [], enhancementsDropped: [E.dropped.notObject] } };
  }
  const dropped = [];
  const numbered = [];
  // Sorted by UTF-16 code units, as the app sorts them: the log reads the same in both.
  for (const k of Object.keys(blocks).sort()) {
    if (!re(E.keyPattern).test(k)) dropped.push(`enhancements.${shownKey(k)}: ${E.dropped.badKey}`);
    else numbered.push([Number(k), blocks[k]]);
  }
  numbered.sort((a, b) => a[0] - b[0]);
  let merged = { ...o };
  delete merged.enhancements;
  // Task 18 (G1): a top-level `jobs` the plugin's own apiVersion ignores never starts to count; jobs come only in a block.
  if (base.apiVersion < contract.kinoJobs.apiVersion) delete merged.jobs;
  let current = { ...base, enhancementsApplied: [] };
  for (const [key, block] of numbered) {
    // Dropped, never refused: an older Kino installed the plugin, and the app's store re-reads it after a Kino update.
    if (key <= base.apiVersion) { dropped.push(`enhancements.${key}: ${E.dropped.notAboveApi.replace("{api}", String(base.apiVersion))}`); continue; }
    // A key above this Kino's maxApiVersion belongs to a newer Kino: ignored without a word.
    if (key > contract.maxApiVersion) continue;
    const step = enhance(merged, key, block, current, opts, exports);
    if (typeof step === "string") dropped.push(`enhancements.${key}: ${step}`);
    else { merged = step.json; current = step.manifest; }
  }
  const out = { ...current, enhancementsDropped: dropped };
  // G5: the settings list's own apiVersion survives the copy (not enumerable, like on every step: settingsApiVersion()).
  if (current.settingsApiVersion !== undefined) Object.defineProperty(out, "settingsApiVersion", { value: current.settingsApiVersion, enumerable: false });
  return { ok: true, manifest: out };
}

/** ManifestParser.enhance: the block of [key] merged over [json] and validated at apiVersion [key], or why not (a string). */
function enhance(json, key, block, current, opts, exports) {
  const E = contract.manifest.enhancements;
  if (block === null || typeof block !== "object" || Array.isArray(block)) return E.dropped.blockNotObject;
  const extra = Object.keys(block).filter((k) => !E.fields.includes(k)).sort()[0];
  if (extra !== undefined) return E.dropped.badField.replace("{field}", shownKey(extra));
  const candidate = { ...json };
  if (has(block, "capabilities")) {
    const added = block.capabilities;
    if (!Array.isArray(added) || added.some((c) => typeof c !== "string")) return E.dropped.capabilitiesNotList;
    const no = added.find((c) => !E.capabilities.includes(c));
    if (no !== undefined) return E.dropped.badCapability.replace("{capability}", shownKey(no));
    const caps = Array.isArray(candidate.capabilities) ? [...candidate.capabilities] : [];
    for (const c of added) if (!caps.includes(c)) caps.push(c);
    candidate.capabilities = caps;
  }
  if (has(block, "screen")) candidate.screen = block.screen;
  if (has(block, "settings")) candidate.settings = block.settings;
  if (has(block, "panel")) candidate.panel = block.panel;
  if (has(block, "jobs")) candidate.jobs = block.jobs;
  candidate.apiVersion = key;
  const r = validateManifestObject(candidate, opts);
  if (!r.ok) return `${r.field}: ${r.message}`;
  // Only the enhanced fields come from the check at [key]: a field the plugin's apiVersion ignores must not start to count.
  if ((r.manifest.section === null) !== (current.section === null)) return E.dropped.sectionChanges.replace("{key}", String(key));
  // A setting the manifest (or an earlier block) declares keeps its type: another device on an older Kino stores it as that.
  if (has(block, "settings")) {
    const retyped = r.manifest.settings.find((s) => current.settings.some((b) => b.key === s.key && b.type !== s.type));
    if (retyped) return E.dropped.settingRetyped.replace("{key}", retyped.key);
    // Task 18 (G13): nor its sync, as each list's own apiVersion reads it (below the field's apiVersion every value syncs).
    const syncs = (s, api) => !(api >= contract.settings.sync.apiVersion && s.sync === false);
    const listApi = current.settingsApiVersion ?? current.apiVersion;
    const resynced = r.manifest.settings.find((s) => current.settings.some((b) => b.key === s.key && b.type === s.type && syncs(b, listApi) !== syncs(s, key)));
    if (resynced) return E.dropped.settingResynced.replace("{key}", resynced.key);
  }
  // Categorías for this plugin follow its OWN apiVersion: a screen cannot replace what is never there.
  const categoriesApi = contract.output.categories.apiVersion;
  if ((r.manifest.screen?.replaces || []).includes("categories") && current.apiVersion < categoriesApi) {
    return E.dropped.replacesNeedsCategories.replace("{min}", String(categoriesApi));
  }
  const next = {
    ...current, capabilities: r.manifest.capabilities, screen: r.manifest.screen,
    settings: has(block, "settings") ? r.manifest.settings : current.settings,
    panel: has(block, "panel") ? r.manifest.panel : current.panel,
    // Task 18 (G1): the jobs of a `schedule` an enhancement added (the check at [key] makes each need the other).
    jobs: r.manifest.jobs || [],
    enhancementsApplied: [...current.enhancementsApplied, key],
  };
  // Task 18 (G13): the apiVersion the settings list was read at (the block's key when it carried one); kept out of the manifest's
  // own fields (not enumerable), for the next block's sync check.
  Object.defineProperty(next, "settingsApiVersion", { value: has(block, "settings") ? key : (current.settingsApiVersion ?? current.apiVersion), enumerable: false });
  // Task 8k: the capability and the contributing panel come together (the check at [key] saw the merged JSON, which may hold a
  // `panel` the plugin's own apiVersion ignores).
  if (next.capabilities.includes(contract.manifest.panel.contributes.capability) !== (next.panel?.contributes === true)) return E.dropped.panelTabNeedsPanel;
  if (exports) {
    const before = allRequiredExports(current);
    const have = new Set(exports);
    const missing = [...allRequiredExports(next)].filter((e) => !before.has(e) && !have.has(e)).sort();
    if (missing.length) return E.dropped.missingExports.replace("{exports}", missing.join(", "));
  }
  return { json: candidate, manifest: next };
}

function validateManifestObject(o, { knownPermissions = contract.permissions } = {}) {
  const m = contract.manifest;
  const bad = (field, message) => ({ ok: false, field, message });
  const id = typeof o.id === "string" ? o.id : "";
  if (!re(m.idPattern).test(id)) return bad("id", 'The "id" field must be 2 to 40 lowercase letters, digits or hyphens');
  if (m.reservedIds.includes(id)) return bad("id", `The id "${id}" is reserved by Kino`);
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name || name.length > m.nameMaxChars) return bad("name", 'The "name" field must be 1 to 40 characters');
  if (!SEMVER.test(typeof o.version === "string" ? o.version : "")) return bad("version", 'The "version" field must look like 1.2.3');
  if (!Number.isInteger(o.apiVersion)) return bad("apiVersion", 'The "apiVersion" field must be a whole number');
  if (o.apiVersion > contract.maxApiVersion) return bad("apiVersion", "This plugin needs a newer version of Kino");
  if (o.apiVersion < 1) return bad("apiVersion", 'The "apiVersion" field must be 1 or more');
  // Kino 0.9.46+ drops a leading "./" itself, but 0.9.45 and older refuse it: tell the author to remove it.
  if (typeof o.entry === "string" && o.entry.startsWith("./")) return bad("entry", 'Drop the "./" from the "entry" field (for example "plugin.js"): Kino 0.9.45 and older don\'t install the plugin with "./"');
  if (!isSafeRelativePath(o.entry) || !o.entry.endsWith(".js")) return bad("entry", 'The "entry" field must be a relative path to a .js file');
  // apiVersion 5's signature (the author's Ed25519 key and signature over the entry). Below that
  // apiVersion it is unknown and ignored like any other field.
  const sg = m.signature;
  const signed = o.apiVersion >= sg.apiVersion && Object.prototype.hasOwnProperty.call(o, "signature");
  if (signed) {
    const s = o.signature;
    const hex = (v, n) => typeof v === "string" && v.length === n && /^[0-9a-f]*$/.test(v);
    const wellFormed = s !== null && typeof s === "object" && !Array.isArray(s) &&
      Object.keys(s).sort().join(",") === "authorKey,value" && hex(s.authorKey, sg.authorKeyHexChars) && hex(s.value, sg.valueHexChars);
    if (!wellFormed) return bad("signature", sg.badFieldMessage);
  }
  if (!Array.isArray(o.hosts)) return bad("hosts", 'The "hosts" field is missing');
  // Empty is judged once the settings are read (below), and only from noHostsApiVersion: an older
  // manifest gets the refusal it always got, at the point it always got it.
  const emptyHostsAllowedLater = o.hosts.length === 0 && o.apiVersion >= m.noHostsApiVersion;
  // No upper bound (Kino 0.9.45+): the 16 KB manifest cap above is the practical one. Older apps
  // refuse more than legacyMaxHosts; validate.mjs warns about that, it is not an error.
  if (!emptyHostsAllowedLater && o.hosts.length < m.minHosts) return bad("hosts", `The "hosts" field must have at least ${m.minHosts} domain`);
  const hostEntries = [];
  for (const raw of o.hosts) {
    if (typeof raw === "string") { hostEntries.push({ host: raw, insecure: false }); continue; }
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      // The object shape itself -- {host, insecureHttp} -- is apiVersion 2, whatever insecureHttp's
      // value: a v1 manifest gets the same clear refusal either way.
      if (o.apiVersion < m.insecureHostApiVersion) return bad("hosts", `A host with "insecureHttp" needs apiVersion ${m.insecureHostApiVersion}`);
      hostEntries.push({ host: typeof raw.host === "string" ? raw.host : "", insecure: raw.insecureHttp === true });
      continue;
    }
    hostEntries.push({ host: "", insecure: false });
  }
  const badHost = hostEntries.find((e) => !isValidHostPattern(e.host));
  if (badHost !== undefined) return bad("hosts", `The domain "${badHost.host}" is not allowed`);
  // A comodín widens which servers accept plain http far more than one named host: not allowed on
  // an insecureHttp entry even though it is fine on an https-only one.
  const wildcardInsecure = hostEntries.find((e) => e.insecure && e.host.startsWith("*."));
  if (wildcardInsecure !== undefined) return bad("hosts", 'A host with "insecureHttp" can\'t have a wildcard ("*.")');
  const hosts = hostEntries.map((e) => e.host);
  const insecureHosts = [...new Set(hostEntries.filter((e) => e.insecure).map((e) => e.host))];
  if (!Array.isArray(o.capabilities)) return bad("capabilities", 'The "capabilities" field is missing');
  const caps = [...new Set(o.capabilities.map((c) => (typeof c === "string" ? c : "")))];
  const unknownCap = caps.find((c) => !contract.capabilities.names.includes(c));
  if (unknownCap !== undefined) return bad("capabilities", `Unknown capability: "${unknownCap}"`);
  const tooNewCap = caps.find((c) => (contract.capabilities.apiVersions[c] ?? 1) > o.apiVersion);
  if (tooNewCap !== undefined) return bad("capabilities", `The "${tooNewCap}" capability needs apiVersion ${contract.capabilities.apiVersions[tooNewCap]}`);
  // "catalogOnly": true (Kino 0.9.54, additive: valid at every apiVersion, ignored by older apps) lists titles and plays none:
  // `resolve` is not required, one of its own atLeastOneOf is, and nothing that only serves playback may be declared.
  const co = m.catalogOnly;
  if (o.catalogOnly !== undefined && typeof o.catalogOnly !== "boolean") return bad("catalogOnly", co.notBooleanMessage);
  const catalogOnly = o.catalogOnly === true;
  if (catalogOnly) {
    const playback = co.forbiddenCapabilities.find((c) => caps.includes(c));
    if (playback !== undefined) return bad("catalogOnly", co.forbidsMessage.replace("{name}", playback));
    if (!co.atLeastOneOf.some((c) => caps.includes(c))) return bad("catalogOnly", co.atLeastOneOfMessage);
  } else {
    // Capabilities that play nothing, declared without any other (a subtitle provider, a tracker, or both), maybe with the
    // runtime room they use (apiVersion 13 standaloneSupplements): neither `required` nor `atLeastOneOf` applies.
    const standalone = isStandaloneSet(caps);
    // Task 8t (ManifestParser): a standalone set may hold playerControl only beside a panel object.
    if (standalone && caps.includes("playerControl") && !(o.apiVersion >= m.panel.apiVersion && o.panel !== null && typeof o.panel === "object" && !Array.isArray(o.panel))) {
      return bad("capabilities", contract.capabilities.playerControlNeedsPanelMessage);
    }
    const missingRequiredCap = contract.capabilities.required.find((c) => !caps.includes(c));
    if (!standalone && missingRequiredCap !== undefined) return bad("capabilities", `The plugin must declare "${missingRequiredCap}"`);
    if (!standalone && !contract.capabilities.atLeastOneOf.some((c) => caps.includes(c))) {
      return bad("capabilities", `The plugin must declare "${contract.capabilities.atLeastOneOf.join('" or "')}"`);
    }
  }
  // A capability that rides on another (scopedSearch on search): refused without it.
  const lacking = Object.entries(contract.capabilities.requires || {}).find(([c, needs]) => caps.includes(c) && !caps.includes(needs));
  if (lacking) return bad("capabilities", contract.capabilities.requiresMessage.replace("{capability}", lacking[0]).replace("{requires}", lacking[1]));
  let liveStreamHostsAny = false;
  // Below its apiVersion the field is unknown and ignored like any other (v1/v2 stay as they were).
  if (o.liveStreamHosts !== undefined && o.apiVersion >= m.liveStreamHosts.apiVersion) {
    const lsh = m.liveStreamHosts;
    if (o.liveStreamHosts !== lsh.value) return bad("liveStreamHosts", `The "liveStreamHosts" field only takes "${lsh.value}"`);
    if (!caps.includes(lsh.requires)) return bad("liveStreamHosts", `"liveStreamHosts" needs the "${lsh.requires}" capability`);
    liveStreamHostsAny = true;
  }
  let streamHostsAny = false;
  if (o.streamHosts !== undefined && o.apiVersion >= m.streamHosts.apiVersion) {
    if (o.streamHosts !== m.streamHosts.value) return bad("streamHosts", `The "streamHosts" field only takes "${m.streamHosts.value}"`);
    streamHostsAny = true;
  }
  // Below its apiVersion the field is unknown and ignored like any other. Kino honors it only on a
  // plugin it converted from a Nuvio scraper (validate.mjs warns a hand-written one); the parse is the same.
  let fetchHostsAny = false;
  if (o.fetchHosts !== undefined && o.apiVersion >= m.fetchHosts.apiVersion) {
    if (o.fetchHosts !== m.fetchHosts.value) return bad("fetchHosts", `The "fetchHosts" field only takes "${m.fetchHosts.value}"`);
    fetchHostsAny = true;
  }
  // Only discovery reads it (never the runtime): valid at every apiVersion, exactly true or false.
  if (o.discoverable !== undefined && typeof o.discoverable !== "boolean") return bad("discoverable", 'The "discoverable" field must be true or false');
  const discoverable = o.discoverable === undefined ? m.discoverable.default : o.discoverable;
  // Only the plugin marketplace reads it (its category chips): valid at every apiVersion, a list of known ids without repeats.
  if (o.categories !== undefined) {
    const ok = Array.isArray(o.categories) && o.categories.every((c) => m.categories.values.includes(c)) && new Set(o.categories).size === o.categories.length;
    if (!ok) return bad("categories", m.categories.message);
  }
  const categories = o.categories || [];
  // apiVersion 6: the default of the person's "Modo debug" switch, which every plugin has (errors on screen, the
  // Registro page). Below it, unknown and ignored.
  let debug = false;
  if (o.debug !== undefined && o.apiVersion >= m.debug.apiVersion) {
    if (typeof o.debug !== "boolean") return bad("debug", 'The "debug" field must be true or false');
    debug = o.debug;
  }
  // apiVersion 6: diagnostic lines to Kino's error tracker (opt-in). Below it, unknown and ignored.
  // true, false or "verbose" (playback summaries of good plays, live/cast problems and edge cases too).
  let telemetry = false;
  if (o.telemetry !== undefined && o.apiVersion >= m.telemetry.apiVersion) {
    if (typeof o.telemetry !== "boolean" && o.telemetry !== m.telemetry.verbose.value) return bad("telemetry", m.telemetry.notBooleanMessage);
    telemetry = o.telemetry;
  }
  // apiVersion 6: hidden web pages from resolve (kino.browser.capture), approved in red; "pages" also reads them
  // (kino.browser.page), with its own red line. Below it, unknown and ignored.
  let browser = false;
  let browserPages = false;
  if (o.browser !== undefined && o.apiVersion >= m.browser.apiVersion) {
    if (typeof o.browser !== "boolean" && o.browser !== m.browser.pagesValue) return bad("browser", m.browser.notBooleanMessage);
    browser = o.browser === true || o.browser === m.browser.pagesValue;
    browserPages = o.browser === m.browser.pagesValue && o.apiVersion >= m.browser.pageApiVersion;
  }
  // apiVersion 6: the plugin's own section entry. Below it, unknown and ignored.
  let section = null;
  if (o.section !== undefined && o.apiVersion >= m.section.apiVersion) {
    if (o.section === null || typeof o.section !== "object" || Array.isArray(o.section)) return bad("section", 'The "section" field must be an object with a "label"');
    const label = typeof o.section.label === "string" ? o.section.label.trim() : "";
    if (!label || label.length > m.section.labelMaxChars) return bad("section", 'The "section.label" field must be 1 to 20 characters');
    // Kino 0.9.55's English variant (settings.english.sectionKeys), same limit; absent or null = none.
    const labelEn = o.apiVersion >= contract.settings.english.apiVersion ? englishVariant(o.section, "label", 1, m.section.labelMaxChars) : "";
    if (labelEn === null) return bad("section", 'The "section.labelEn" field must be 1 to 20 characters');
    section = labelEn ? { label, labelEn } : { label };
  }
  // apiVersion 9: the player panel's button. Below it, unknown and ignored. `icon` (a predefined name, any string: an
  // unknown one draws "tune", validate.mjs warns) or `iconFile` (a .png in the repo, checked by validate.mjs), not both.
  let panel = null;
  if (o.panel !== undefined && o.apiVersion >= m.panel.apiVersion) {
    const max = m.panel.labelMaxChars;
    if (o.panel === null || typeof o.panel !== "object" || Array.isArray(o.panel)) return bad("panel", 'The "panel" field must be an object with a "label"');
    // apiVersion 14 (Task 8k): `contributes`, a tab in the player panel of any content. Below it the key is unknown.
    const C = m.panel.contributes;
    let contributes = false;
    if (o.apiVersion >= C.apiVersion && o.panel.contributes !== undefined && o.panel.contributes !== null) {
      if (typeof o.panel.contributes !== "boolean") return bad("panel", C.badMessage);
      contributes = o.panel.contributes;
    }
    // A contributing panel may leave its label out: the plugin's name stands in (cut to the label's limit).
    let label = typeof o.panel.label === "string" ? o.panel.label.trim() : "";
    if (!label && contributes && !has(o.panel, "label")) label = name.slice(0, max).trim();
    if (!label || label.length > max) return bad("panel", `The "panel.label" field must be 1 to ${max} characters`);
    const labelEn = englishVariant(o.panel, "label", 1, max);
    if (labelEn === null) return bad("panel", `The "panel.labelEn" field must be 1 to ${max} characters`);
    const icon = typeof o.panel.icon === "string" && o.panel.icon.trim() ? o.panel.icon.trim() : null;
    const rawFile = o.panel.iconFile;
    if (rawFile !== undefined && rawFile !== null && typeof rawFile !== "string") return bad("panel", 'The "panel.iconFile" field must be a relative path to a .png');
    const iconFile = typeof rawFile === "string" && rawFile.replace(/^\.\//, "") ? rawFile.replace(/^\.\//, "") : null;
    if (icon !== null && iconFile !== null) return bad("panel", 'The "panel" field takes "icon" or "iconFile", not both');
    if (iconFile !== null && (!isSafeRelativePath(iconFile) || !iconFile.endsWith(".png"))) return bad("panel", 'The "panel.iconFile" field must be a relative path to a .png');
    // Task 11 (apiVersion 14): which content a contributed tab joins, "title" and/or "live"; default ["title"].
    const K = C.kinds;
    let kinds = null;
    if (o.apiVersion >= C.apiVersion && o.panel.kinds !== undefined && o.panel.kinds !== null) {
      if (!contributes) return bad("panel", K.needsContributesMessage);
      const raw = o.panel.kinds;
      if (!Array.isArray(raw) || raw.length === 0 || raw.some((k) => !K.values.includes(k))) return bad("panel", K.badMessage);
      kinds = K.values.filter((k) => raw.includes(k));
    }
    panel = {
      label, ...(labelEn ? { labelEn } : {}), ...(icon !== null ? { icon } : {}), ...(iconFile !== null ? { iconFile } : {}), ...(contributes ? { contributes: true } : {}),
      ...(contributes ? { kinds: kinds ?? [...K.default] } : {}),
    };
  }
  // Task 8k: the capability and `panel.contributes` need each other (the capability is what the person approves).
  if (panel?.contributes === true && !caps.includes(m.panel.contributes.capability)) return bad("panel", m.panel.contributes.needsCapabilityMessage);
  if (caps.includes(m.panel.contributes.capability) && panel?.contributes !== true) return bad("capabilities", m.panel.contributes.capabilityNeedsMessage);
  // apiVersion 14: the screen canvas's menu entry (PluginManifest.kt). The block and the capability need each other; below 14
  // both are unknown. `icon` (a predefined name, any string: validate.mjs warns) or `iconFile` (a .png in the repo), not both.
  let screen = null;
  if (o.apiVersion >= m.screen.apiVersion) {
    if (!caps.includes("screen")) {
      if (o.screen !== undefined) return bad("screen", SCREEN_MESSAGES.needsCapability);
    } else {
      if (o.screen === undefined) return bad("screen", SCREEN_MESSAGES.capabilityNeedsBlock);
      const sc = o.screen;
      if (sc === null || typeof sc !== "object" || Array.isArray(sc)) return bad("screen", SCREEN_MESSAGES.notObject);
      const max = m.screen.labelMaxChars;
      const label = typeof sc.label === "string" ? sc.label.trim() : "";
      if (!label || label.length > max) return bad("screen", `The "screen.label" field must be 1 to ${max} characters`);
      const labelEn = englishVariant(sc, "label", 1, max);
      if (labelEn === null) return bad("screen", `The "screen.labelEn" field must be 1 to ${max} characters`);
      // Where the screen opens from (Task 7g): without the menu, the icon and menuOpens are ignored (no entry draws them).
      let opensFrom = ["menu"];
      if (sc.opensFrom !== undefined && sc.opensFrom !== null) {
        if (!Array.isArray(sc.opensFrom)) return bad("screen", SCREEN_MESSAGES.badOpensFrom);
        const out = [];
        for (const v of sc.opensFrom) {
          if (typeof v !== "string" || !m.screen.opensFrom.includes(v)) return bad("screen", SCREEN_MESSAGES.badOpensFrom);
          if (!out.includes(v)) out.push(v);
        }
        if (out.length === 0) return bad("screen", SCREEN_MESSAGES.emptyOpensFrom);
        opensFrom = out;
      }
      const inMenu = opensFrom.includes("menu");
      let settingsButton = null;
      if (sc.settingsButton !== undefined && sc.settingsButton !== null) {
        const b = sc.settingsButton;
        if (typeof b !== "object" || Array.isArray(b)) return bad("screen", SCREEN_MESSAGES.badSettingsButton);
        const label = (key) => {
          const v = b[key];
          if (v === undefined || v === null) return "";
          if (typeof v !== "string") return null;
          const t = v.replace(LABEL_SCRUB, "").trim();
          return t !== "" && t.length <= m.screen.settingsButtonLabelMaxChars ? t : null;
        };
        const es = label("label");
        const en = label("labelEn");
        if (es === null || en === null) return bad("screen", SCREEN_MESSAGES.badSettingsButton);
        if (es !== "" || en !== "") settingsButton = { label: es, labelEn: en };
      }
      const icon = typeof sc.icon === "string" && sc.icon.trim() ? sc.icon.trim() : null;
      const rawFile = sc.iconFile;
      if (rawFile !== undefined && rawFile !== null && typeof rawFile !== "string") return bad("screen", SCREEN_MESSAGES.badIconFile);
      const iconFile = typeof rawFile === "string" && rawFile.replace(/^\.\//, "") ? rawFile.replace(/^\.\//, "") : null;
      if (icon !== null && iconFile !== null) return bad("screen", SCREEN_MESSAGES.bothIcons);
      if (iconFile !== null && (!isSafeRelativePath(iconFile) || !iconFile.endsWith(".png"))) return bad("screen", SCREEN_MESSAGES.badIconFile);
      let menuOpens;
      // No menu entry for the screen: a section keeps its own entry, exactly as before screens existed.
      if (!inMenu) menuOpens = section ? "section" : "screen";
      else if (sc.menuOpens === undefined || sc.menuOpens === null) menuOpens = section ? "section" : "screen";
      else if (typeof sc.menuOpens === "string" && m.screen.menuOpens.includes(sc.menuOpens)) menuOpens = sc.menuOpens;
      else return bad("screen", SCREEN_MESSAGES.badMenuOpens);
      if (inMenu && menuOpens !== "screen" && !section) return bad("screen", SCREEN_MESSAGES.menuNeedsSection);
      if (sc.adult !== undefined && sc.adult !== null && typeof sc.adult !== "boolean") return bad("screen", SCREEN_MESSAGES.badAdult);
      let settingsIn = "both";
      if (sc.settingsIn !== undefined && sc.settingsIn !== null) {
        if (typeof sc.settingsIn !== "string" || !m.screen.settingsIn.includes(sc.settingsIn)) return bad("screen", SCREEN_MESSAGES.badSettingsIn);
        settingsIn = sc.settingsIn;
      }
      // Settings only in the screen need a screen the person can open: an entry of its own.
      const hasEntry = (inMenu && menuOpens !== "section") || opensFrom.includes("settings");
      if (settingsIn === "screen" && !hasEntry) return bad("screen", SCREEN_MESSAGES.settingsNeedScreen);
      // What the screen takes the place of (Task 8): Kino's own Categorías needs the catalog it falls back on.
      const replaces = [];
      if (sc.replaces !== undefined && sc.replaces !== null) {
        if (!Array.isArray(sc.replaces)) return bad("screen", SCREEN_MESSAGES.badReplaces);
        for (const v of sc.replaces) {
          if (typeof v !== "string" || !m.screen.replaces.includes(v)) return bad("screen", SCREEN_MESSAGES.badReplaces);
          if (!replaces.includes(v)) replaces.push(v);
        }
      }
      if (replaces.includes("categories") && !caps.includes("browse")) return bad("screen", SCREEN_MESSAGES.replacesNeedsCatalog);
      screen = {
        label, ...(labelEn ? { labelEn } : {}), ...(icon !== null && inMenu ? { icon } : {}), ...(iconFile !== null && inMenu ? { iconFile } : {}), menuOpens, adult: sc.adult === true, settingsIn,
        ...(sc.every !== undefined && sc.every !== null ? { every: sc.every } : {}), opensFrom, ...(settingsButton !== null ? { settingsButton } : {}),
        ...(replaces.length > 0 ? { replaces } : {}),
      };
    }
  }
  // apiVersion 9: where the settings go (rows, columns, cards). A list here; validate.mjs and panel.mjs judge the rest.
  if (o.settingsLayout !== undefined && o.apiVersion >= m.settingsLayout.apiVersion && !Array.isArray(o.settingsLayout)) return bad("settingsLayout", 'The "settingsLayout" field must be a list');
  // apiVersion 6: the palette. Format only; the guardrails run where it is used.
  const theme = {};
  if (o.theme !== undefined && o.apiVersion >= m.theme.apiVersion) {
    if (o.theme === null || typeof o.theme !== "object" || Array.isArray(o.theme)) return bad("theme", 'The "theme" field must be an object of colors');
    const unknown = Object.keys(o.theme).filter((k) => !m.theme.tokens.includes(k)).sort()[0];
    if (unknown !== undefined) return bad("theme", `The "theme" field has an unknown color: "${unknown.slice(0, 40)}"`);
    for (const k of m.theme.tokens) {
      if (!(k in o.theme)) continue;
      const v = o.theme[k];
      if (typeof v !== "string" || !re(m.colorPattern).test(v)) return bad("theme", `The "${k}" color of "theme" must look like #RRGGBB`);
      theme[k] = v.toUpperCase();
    }
  }
  // Below its apiVersion the field is unknown and ignored like any other (v1/v2/v3 stay as they were).
  let secrets = {};
  const secretKeyEncodings = {};
  if (o.secrets !== undefined && o.apiVersion >= m.secrets.apiVersion) {
    if (o.secrets === null || typeof o.secrets !== "object" || Array.isArray(o.secrets)) return bad("secrets", 'The "secrets" field must be an object');
    const secretNames = Object.keys(o.secrets);
    if (secretNames.length > m.secrets.maxSecrets) return bad("secrets", `The "secrets" field takes up to ${m.secrets.maxSecrets} secrets`);
    const NAME = re(m.secrets.namePattern);
    const T = m.secrets.typed;
    const maxValueBytes = o.apiVersion >= m.secrets.largeApiVersion ? m.secrets.largeMaxValueBytes : m.secrets.maxValueBytes;
    const parsed = {};
    for (const name of secretNames) {
      if (!NAME.test(name)) return bad("secrets", `The secret "${name.slice(0, 40)}" has an invalid name`);
      let value = o.secrets[name];
      // An object is a typed secret only from its apiVersion; below it, it is "not a seal" exactly as before.
      if (value !== null && typeof value === "object" && !Array.isArray(value) && o.apiVersion >= T.apiVersion) {
        // The lexicographically smallest unknown field, exactly as the app names it (deterministic whatever the key order).
        const unknown = Object.keys(value).filter((k) => !["seal", "use", "encoding"].includes(k)).sort()[0];
        if (unknown !== undefined) return bad("secrets", `The secret "${name}" has an unknown field: "${unknown.slice(0, 40)}"`);
        if (!T.uses.includes(value.use)) return bad("secrets", `The secret "${name}" only takes "use": "${T.uses[0]}"`);
        if (!T.keyEncodings.includes(value.encoding)) return bad("secrets", `The secret "${name}" must have "encoding": "hex" or "base64"`);
        secretKeyEncodings[name] = value.encoding;
        value = value.seal;
      }
      if (!isWellFormedSeal(value, maxValueBytes, m.secrets.prefix)) return bad("secrets", `The secret "${name}" is not a valid Kino seal`);
      parsed[name] = value;
    }
    secrets = parsed;
  }
  if (o.color !== undefined && o.color !== "" && !re(m.colorPattern).test(o.color)) return bad("color", 'The "color" field must look like #RRGGBB');
  if (o.icon !== undefined && o.icon !== "" && (!isSafeRelativePath(o.icon) || !o.icon.endsWith(".png"))) return bad("icon", 'The "icon" field must be a relative path to a .png');
  if (o.permissions !== undefined && !Array.isArray(o.permissions)) return bad("permissions", 'The "permissions" field must be a list');
  for (const p of o.permissions || []) {
    if (typeof p !== "string") return bad("permissions", 'The "permissions" field can only hold strings');
    if (!knownPermissions.includes(p)) return bad("permissions", `unknown permission: ${p.slice(0, 40)}`);
  }
  if (o.settings !== undefined && !Array.isArray(o.settings)) return bad("settings", 'The "settings" field must be a list');
  const settingsError = validateSettings(o.settings || [], o.apiVersion);
  if (settingsError) return bad("settings", settingsError);
  if (hosts.length === 0 && !(o.settings || []).some((x) => x.type === "url" || (x.type === "list" && Array.isArray(x.fields) && x.fields.some((f) => f.type === "url")))) {
    return bad("hosts", 'The "hosts" field can only be empty if the plugin has a setting of type "url"');
  }
  // apiVersion 11, `externalResolver`: the app a plugin hands its `external` answers to and the ways to get it (ManifestParser.parseExternalResolver).
  if (o.externalResolver !== undefined && o.apiVersion >= 11) {
    if (!caps.includes("externalResolve")) return bad("externalResolver", 'The "externalResolver" field needs the "externalResolve" capability');
    if (!externalResolverOk(o.externalResolver)) return bad("externalResolver", EXTERNAL_RESOLVER_BAD);
  }
  // apiVersion 11, `nuvioRepos`: the Nuvio repositories a `nuvio` plugin uses (ManifestParser: 1 to 4, each a GitHub owner/repo or an https address).
  if (o.apiVersion >= 11 && (caps.includes("nuvio") || o.nuvioRepos !== undefined)) {
    const repos = o.nuvioRepos;
    const one = (r) => typeof r === "string" && (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}(@[A-Za-z0-9._\/-]+)?$/.test(r.trim()) || /^https:\/\/[^\s/]+\/\S*$/i.test(r.trim()) || /^https:\/\/github\.com\/[^\s/]+\/[^\s/]+/i.test(r.trim()));
    if (!caps.includes("nuvio") || !Array.isArray(repos) || repos.length < 1 || repos.length > 4 || !repos.every(one)) {
      return bad("nuvioRepos", 'The "nuvioRepos" field must list 1 to 4 GitHub repositories (owner/repo) or https addresses of a Nuvio manifest, and goes with the "nuvio" capability, which needs it');
    }
  }
  // apiVersion 12, `sync` (ManifestParser.parseSync): only with syncProvider, which requires it; the numbers, keySecret and provision rules.
  if (o.apiVersion >= m.sync.apiVersion) {
    const syncError = syncFieldError(o, caps, o.settings || []);
    if (syncError) return bad("sync", syncError);
  }
  // apiVersion 14, `jobs` (Task 8q, PluginJobs.parse): the background jobs of the `schedule` capability; each needs the other.
  let jobs = [];
  if (o.apiVersion >= contract.kinoJobs.apiVersion) {
    const parsedJobs = parseJobs(o.jobs, caps, o.settings || []);
    if (parsedJobs.message) return bad(caps.includes(contract.kinoJobs.capability) && !has(o, "jobs") ? "capabilities" : "jobs", parsedJobs.message);
    jobs = parsedJobs.jobs;
  }
  // Judged on what the app honours: below its apiVersion a field is ignored, so it forbids nothing there.
  if (catalogOnly) {
    const playback = { streamHosts: streamHostsAny, browser: browser && !browserPages };
    const field = co.forbiddenFields.find((f) => playback[f] === true);
    if (field !== undefined) return bad("catalogOnly", co.forbidsMessage.replace("{name}", field));
  }
  // Below apiVersion 9 the English keys are unknown: dropped here, so nothing downstream (the form, englishCoverage) sees them.
  const settingsOut = o.apiVersion >= contract.settings.english.apiVersion ? o.settings || [] : withoutEnglish(o.settings || []);
  const out = { ...o, hosts: [...new Set(hosts)], capabilities: caps, permissions: o.permissions || [], settings: settingsOut, insecureHosts, liveStreamHostsAny, streamHostsAny, fetchHostsAny, discoverable, categories, debug, telemetry, browser, browserPages, section, panel, screen, theme, secrets, secretKeyEncodings, catalogOnly };
  // Task 8q: the parsed jobs (labels scrubbed, options sorted); none below apiVersion 14 or without `schedule`.
  if (o.apiVersion >= contract.kinoJobs.apiVersion) out.jobs = jobs; else delete out.jobs;
  // `signature` only where the app reads it (apiVersion 5+): an ignored one is dropped, as the app drops it.
  if (!signed) delete out.signature;
  return { ok: true, manifest: out };
}

/** What a job label never keeps (PluginJobs.LABEL_SCRUB): control characters, zero-width and bidirectional marks. */
const JOB_LABEL_SCRUB = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * The manifest's `jobs` as the app's PluginJobs.parse reads it: `{ jobs }` (each `{ id, label, labelEn, everyMin, everyOptions }`,
 * labels scrubbed, options sorted, runOn "any" or "preferPhone") or `{ message }` (contract.kinoJobs.manifest). Other keys of a job
 * are ignored. Shared cases: test/job-cases.json (run by the app too).
 */
export function parseJobs(raw, caps, settings = []) {
  const J = contract.kinoJobs;
  const M = J.manifest;
  const declared = caps.includes(J.capability);
  if (raw === undefined || raw === null) return declared ? { message: M.scheduleNeedsJobs } : { jobs: [] };
  if (!declared) return { message: M.jobsNeedsCapability };
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > M.maxJobs) return { message: M.jobsBad };
  const idPattern = new RegExp(M.idPattern);
  const label = (v) => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") return null;
    const s = v.replace(JOB_LABEL_SCRUB, "").trim();
    return s.length > 0 && s.length <= M.labelMaxChars ? s : null;
  };
  const minutes = (v) => (typeof v === "number" && Number.isInteger(v) && v >= M.minEveryMin && v <= M.maxEveryMin ? v : null);
  const out = [];
  for (const j of raw) {
    if (j === null || typeof j !== "object" || Array.isArray(j)) return { message: M.jobsBad };
    if (typeof j.id !== "string" || !idPattern.test(j.id)) return { message: M.badId };
    if (out.some((x) => x.id === j.id)) return { message: M.duplicateId };
    if (j.label === null || typeof j.label !== "object" || Array.isArray(j.label)) return { message: M.badLabel };
    const es = label(j.label.es);
    const en = label(j.label.en);
    if (!es || en === null) return { message: M.badLabel };
    if (!Array.isArray(j.everyOptions) || j.everyOptions.length < 1 || j.everyOptions.length > M.maxOptions) return { message: M.badOptions };
    const options = [];
    for (const v of j.everyOptions) {
      const n = minutes(v);
      if (n === null || options.includes(n)) return { message: M.badOptions };
      options.push(n);
    }
    const every = minutes(j.everyMin);
    if (every === null || !options.includes(every)) return { message: M.badEvery };
    // Task 8q-2: runOn, the default when absent or null.
    const runOn = j.runOn === undefined || j.runOn === null ? M.runOnDefault : j.runOn;
    if (!M.runOnValues.includes(runOn)) return { message: M.badRunOn };
    // Task 18 (G2): enabledBy, the key of one of the plugin's toggle settings (absent or null: the job's own opt-in switch).
    let enabledBy = null;
    if (j.enabledBy !== undefined && j.enabledBy !== null) {
      if (typeof j.enabledBy !== "string" || !settings.some((s) => s && s.key === j.enabledBy && s.type === "toggle")) return { message: M.badEnabledBy };
      enabledBy = j.enabledBy;
    }
    out.push({ id: j.id, label: es, labelEn: en, everyMin: every, everyOptions: options.sort((a, b) => a - b), runOn, enabledBy });
  }
  return { jobs: out };
}

/**
 * Shape only, like the app's SealedSecrets.isWellFormed: the kit never opens a seal. The overhead
 * (32-byte ephemeral pubkey + 12-byte nonce + 16-byte GCM tag = 60 bytes) plus 1..maxValueBytes (4096, or 8192 from apiVersion 6) of
 * plaintext bounds the decoded length; SealedSecrets.kt is the source of truth for these numbers.
 */
function isWellFormedSeal(seal, maxValueBytes, prefix) {
  if (typeof seal !== "string" || !seal.startsWith(prefix)) return false;
  const body = seal.slice(prefix.length);
  if (body.length === 0 || !/^[A-Za-z0-9_-]+$/.test(body)) return false;
  const raw = Buffer.from(body, "base64url");
  const overhead = 60;
  return raw.length >= overhead + 1 && raw.length <= overhead + maxValueBytes;
}

/**
 * What the app's ManifestParser refuses in the `sync` field (apiVersion 12), as its message, or null when it is fine (or
 * absent without the syncProvider capability). [settings] are the manifest's own, already validated.
 */
function syncFieldError(o, caps, settings) {
  const s = contract.manifest.sync;
  if (!caps.includes(s.requires)) return o.sync !== undefined ? s.needsCapabilityMessage : null;
  // Every provider derives its key from one of its own settings: a key one device made up could never reach another.
  if (o.sync === undefined) return s.keySecret.missingMessage;
  const v = o.sync;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return s.badMessage;
  if (v.mode !== undefined && !s.modes.includes(v.mode)) return s.badMessage;
  const whole = (k) => v[k] === undefined || (Number.isInteger(v[k]) && v[k] > 0);
  if (!whole("pullEveryMs") || !whole("pushDebounceMs") || !whole("maxBlobBytes")) return s.badMessage;
  if (v.maxBlobBytes !== undefined && v.maxBlobBytes > s.maxBlobBytes) return s.badMessage;
  if (v.keySecret === undefined) return s.keySecret.missingMessage;
  const named = typeof v.keySecret === "string" && v.keySecret ? settings.find((x) => x.key === v.keySecret && x.type === s.keySecret.settingType) : null;
  if (!named) return s.keySecret.badMessage;
  if (named.default !== undefined && named.default !== null) return s.keySecret.noDefaultMessage;
  // Every device derives the key from it: a device-only password ("sync": false, read from apiVersion 13) can't be the key.
  if (named.sync === false && o.apiVersion >= contract.settings.sync.apiVersion) return s.keySecret.deviceOnlyMessage;
  let provision = [];
  if (v.provision !== undefined) {
    if (!Array.isArray(v.provision) || v.provision.length > s.provision.maxNames || !v.provision.every((n) => typeof n === "string")) return s.provision.badMessage;
    const valued = (n) => settings.some((x) => x.key === n && contract.settings.types[x.type]?.hasValue !== false);
    if (new Set(v.provision).size !== v.provision.length || !v.provision.every(valued)) return s.provision.badMessage;
    provision = v.provision;
  }
  // A device-only password may be named (apiVersion 13): a one-shot secret the pairing hands over while it holds a value;
  // a device-only text never.
  if (o.apiVersion >= contract.settings.sync.apiVersion && provision.some((n) => settings.some((x) => x.key === n && x.type === "text" && x.sync === false))) {
    return s.provision.deviceOnlyTextMessage;
  }
  if (!provision.includes(v.keySecret)) return s.provision.needsKeySecretMessage;
  // apiVersion 13 generateKey: Kino makes the keySecret value itself; below 13 the key is unknown, so ignored.
  if (v.generateKey !== undefined && o.apiVersion >= s.generateKey.apiVersion && typeof v.generateKey !== "boolean") return s.generateKey.badMessage;
  return null;
}

/**
 * The optional English variant of [o]'s text [base] (`<base>En`, Kino 0.9.55, contract.settings.english): "" when absent
 * or null, the trimmed text when it is a string of [min]..[max] characters, null when it is anything else (refused), as
 * the app's PluginSettings.variant.
 */
function englishVariant(o, base, min, max) {
  const raw = o[base + contract.settings.english.suffix];
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text && min === 0) return "";
  return text.length >= min && text.length <= max ? text : null;
}

/**
 * [settings] (a validated manifest's) as Kino's form shows them in [lang] ("en…" = English, anything else Spanish): in
 * English each text with an English variant (labelEn, hintEn, confirmEn, an option's or a list field's) takes it, the
 * rest keep their base text; keys, types, values and defaults never change. The app's PluginSetting.localized.
 */
export function localizedSettings(settings, lang = "es") {
  if (!String(lang || "").toLowerCase().startsWith("en")) return settings;
  const pick = (o, k) => (typeof o[k + "En"] === "string" && o[k + "En"].trim() ? o[k + "En"].trim() : o[k]);
  const one = (o) => {
    const out = { ...o, label: pick(o, "label") };
    if (o.hint !== undefined || o.hintEn !== undefined) out.hint = pick(o, "hint");
    if (o.confirm !== undefined) out.confirm = pick(o, "confirm");
    if (Array.isArray(o.options)) out.options = o.options.map((x) => ({ ...x, label: pick(x, "label") }));
    if (Array.isArray(o.fields)) out.fields = o.fields.map(one);
    return out;
  };
  return settings.map(one);
}

/** The section entry's label as Kino shows it in [lang] (section.labelEn in English when there is one), or null. */
export function sectionLabel(manifest, lang = "es") {
  const s = manifest && manifest.section;
  if (!s) return null;
  return String(lang || "").toLowerCase().startsWith("en") && s.labelEn ? s.labelEn : s.label;
}

/**
 * Every text of a validated manifest that could carry an English variant (settings, options, list fields, section),
 * and how many do: `{ total, english, missing: ["<key>.label", …] }`. validate.mjs's note.
 */
export function englishCoverage(manifest) {
  const missing = [];
  let total = 0;
  const count = (o, k, where) => {
    if (typeof o[k] !== "string" || !o[k].trim()) return;
    total++;
    if (!(typeof o[k + "En"] === "string" && o[k + "En"].trim())) missing.push(`${where}.${k}`);
  };
  for (const st of manifest.settings || []) {
    for (const k of ["label", "hint", "confirm"]) count(st, k, st.key);
    for (const x of st.options || []) count(x, "label", `${st.key}[${x.value}]`);
    for (const f of st.fields || []) for (const k of ["label", "hint"]) count(f, k, `${st.key}.${f.key}`);
  }
  if (manifest.section) count(manifest.section, "label", "section");
  return { total, english: total - missing.length, missing };
}

/** [settings] without their English keys (`<text>En`): what an apiVersion below 9 means, as in the app. */
function withoutEnglish(settings) {
  const strip = (o) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) if (!["labelEn", "hintEn", "confirmEn"].includes(k)) out[k] = v;
    if (Array.isArray(o.options)) out.options = o.options.map(strip);
    if (Array.isArray(o.fields)) out.fields = o.fields.map(strip);
    return out;
  };
  return settings.map(strip);
}

function validateSettings(list, apiVersion = contract.maxApiVersion) {
  const s = contract.settings;
  const ui = s.ui;
  if (apiVersion < ui.apiVersion) {
    if (list.length > s.max) return `The plugin asks for more than ${s.max} settings`;
  } else if (list.length > s.max + ui.maxItems) {
    return `The plugin asks for more than ${s.max + ui.maxItems} settings`;
  }
  const keys = new Set();
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === null || typeof o !== "object" || Array.isArray(o)) return `Setting #${i + 1} is not valid`;
    const key = typeof o.key === "string" ? o.key : "";
    if (!re(s.keyPattern).test(key)) return `Setting #${i + 1} has an invalid key`;
    if (keys.has(key)) return `The setting "${key}" is repeated`;
    keys.add(key);
    const type = s.types[o.type];
    if (!type || typeof o.type !== "string") return `The setting "${key}" has an unknown type`;
    const aids = s.configAids;
    const aid = o.type === "link" || o.type === "help";
    if (aid && apiVersion < aids.apiVersion) return `The setting "${key}" is of type ${o.type}: it needs apiVersion ${aids.apiVersion}`;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    // A help's label is optional: without one Kino's own "Ayuda" / "Help" names the button.
    const labelOptional = o.type === "help" && !label && (o.label === undefined || typeof o.label === "string");
    if (!labelOptional && (!label || label.length > s.labelMaxChars)) return `The setting "${key}" needs a label of 1 to ${s.labelMaxChars} characters`;
    if (o.type !== "link" && o.url !== undefined) return `Only a setting of type link has "url" ("${key}")`;
    if (o.type !== "help" && ["title", "titleEn", "body", "bodyEn"].some((k) => o[k] !== undefined)) return `Only a setting of type help has "title" and "body" ("${key}")`;
    if (o.type === "link" && !isLinkUrl(o.url)) return `The setting "${key}" of type link needs a "url": an https address without user info, at most ${aids.linkUrlMaxChars} characters`;
    if (o.type === "help") {
      const t = (k, max) => o[k] === undefined || o[k] === null ? "" : typeof o[k] === "string" && o[k].trim().length <= max ? o[k].trim() : null;
      for (const [k, max] of [["title", aids.helpTitleMaxChars], ["titleEn", aids.helpTitleMaxChars], ["body", aids.helpBodyMaxChars], ["bodyEn", aids.helpBodyMaxChars]]) {
        if (t(k, max) === null) return `"${k}" of the setting "${key}" must be a string of up to ${max} characters`;
      }
      if (!t("body", aids.helpBodyMaxChars) && !t("bodyEn", aids.helpBodyMaxChars)) return `The setting "${key}" of type help needs a "body" (or "bodyEn")`;
    }
    if (aid) {
      // As PluginSettings.unsafeAidText: no control character (a body keeps \n; \r\n counts as one), invisible formatting
      // (Cf: zero-width, direction overrides) or line/paragraph separator in the aid's texts.
      const unsafe = (v, newlines) => typeof v === "string" && /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(newlines ? v.replace(/\r\n?/g, "\n").replace(/\n/g, "") : v.trim());
      for (const k of ["label", "labelEn", "title", "titleEn"]) if (unsafe(o[k], false)) return `"${k}" of the setting "${key}" has a control, invisible or direction character`;
      for (const k of ["body", "bodyEn"]) if (unsafe(o[k], true)) return `"${k}" of the setting "${key}" has a control, invisible or direction character`;
    }
    if (type.hasValue === false && apiVersion < type.apiVersion) return `The setting "${key}" is of type ${o.type}: it needs apiVersion ${type.apiVersion}`;
    // A section's explanation may be longer than a field's hint (PluginSettings.MAX_SECTION_HINT_CHARS, Kino 0.9.51).
    const hintMax = o.type === "section" && s.sectionHintMaxChars ? s.sectionHintMaxChars : s.hintMaxChars;
    if (typeof o.hint === "string" && o.hint.trim().length > hintMax) return `The hint of the setting "${key}" is over ${hintMax} characters`;
    // Kino 0.9.55's English variants (apiVersion 9): the base fields' limits; below 9 unknown keys, never checked.
    const en = apiVersion >= s.english.apiVersion;
    if (en && englishVariant(o, "label", 1, s.labelMaxChars) === null) return `"labelEn" of the setting "${key}" must be a string of 1 to ${s.labelMaxChars} characters`;
    if (en && englishVariant(o, "hint", 0, hintMax) === null) return `"hintEn" of the setting "${key}" must be a string of up to ${hintMax} characters`;
    if (o.required !== undefined && typeof o.required !== "boolean") return `"required" of the setting "${key}" must be true or false`;
    if (o.required === true && !type.canBeRequired) return `The setting "${key}" can't be required`;
    // Below apiVersion 6 the key is unknown, so ignored like any other unknown key (as in the app).
    if (o.confirm !== undefined && o.confirm !== null && apiVersion >= ui.apiVersion) {
      if (o.type !== "action") return `Only a setting of type action has "confirm" ("${key}")`;
      const c = typeof o.confirm === "string" ? o.confirm.trim() : "";
      if (!c || c.length > ui.confirmMaxChars) return `"confirm" of the setting "${key}" must be a string of 1 to ${ui.confirmMaxChars} characters`;
    }
    // confirmEn: ignored wherever "confirm" is (below apiVersion 6); only on an action, and only next to "confirm".
    if (en && o.confirmEn !== undefined && o.confirmEn !== null) {
      if (o.type !== "action") return `Only a setting of type action has "confirmEn" ("${key}")`;
      const c = englishVariant(o, "confirm", 1, ui.confirmMaxChars);
      if (c === null) return `"confirmEn" of the setting "${key}" must be a string of 1 to ${ui.confirmMaxChars} characters`;
      if (o.confirm === undefined || o.confirm === null) return `"confirmEn" of the setting "${key}" also needs "confirm"`;
    }
    // apiVersion 13: only a qr setting has "refreshMs" (contract.qr.settingsQr), 2000 to 60000 ms; below 13 an unknown key, ignored.
    if (o.refreshMs !== undefined && o.refreshMs !== null && apiVersion >= s.types.qr.apiVersion) {
      const Q = contract.qr.settingsQr;
      if (o.type !== "qr") return `Only a setting of type qr has "refreshMs" ("${key}")`;
      if (!(Number.isInteger(o.refreshMs) && o.refreshMs >= Q.minRefreshMs && o.refreshMs <= Q.maxRefreshMs)) return `"refreshMs" of the setting "${key}" goes from ${Q.minRefreshMs} to ${Q.maxRefreshMs}`;
    }
    if (o.fields !== undefined && o.type !== "list") return `Only a setting of type list has "fields" ("${key}")`;
    if (o.type === "list") {
      const L = s.list;
      if (apiVersion < L.apiVersion) return `The setting "${key}" is a list: it needs apiVersion ${L.apiVersion}`;
      if (o.max !== undefined && !(Number.isInteger(o.max) && o.max >= 1 && o.max <= L.maxEntries)) return `"max" of the setting "${key}" goes from 1 to ${L.maxEntries}`;
      if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.length > L.maxFields) return `The setting "${key}" needs 1 to ${L.maxFields} fields`;
      const fkeys = new Set();
      for (const f of o.fields) {
        const fk = f && typeof f.key === "string" ? f.key : "";
        if (!re(s.keyPattern).test(fk) || fkeys.has(fk)) return `A field of the setting "${key}" has an invalid or repeated key`;
        fkeys.add(fk);
        const fl = typeof f.label === "string" ? f.label.trim() : "";
        if (!fl || fl.length > s.labelMaxChars) return `A field of the setting "${key}" needs a label of 1 to ${s.labelMaxChars} characters`;
        if (!L.fieldTypes.includes(f.type)) return `A field of the setting "${key}" must be of type ${L.fieldTypes.join(" or ")}`;
        if (typeof f.hint === "string" && f.hint.trim().length > s.hintMaxChars) return `The hint of a field of the setting "${key}" is over ${s.hintMaxChars} characters`;
        if (en && englishVariant(f, "label", 1, s.labelMaxChars) === null) return `"labelEn" of the field "${fk}" of "${key}" must be a string of 1 to ${s.labelMaxChars} characters`;
        if (en && englishVariant(f, "hint", 0, s.hintMaxChars) === null) return `"hintEn" of the field "${fk}" of "${key}" must be a string of up to ${s.hintMaxChars} characters`;
        if (f.required !== undefined && typeof f.required !== "boolean") return `"required" of a field of the setting "${key}" must be true or false`;
        if (f.default !== undefined && f.default !== null) return `A field of the setting "${key}" can't have a default value`;
      }
    }
    if (o.type === "select") {
      if (!Array.isArray(o.options) || o.options.length === 0) return `The setting "${key}" needs options`;
      if (o.options.length > s.maxOptions) return `The setting "${key}" has more than ${s.maxOptions} options`;
      const values = new Set();
      for (const opt of o.options) {
        const v = opt && typeof opt.value === "string" ? opt.value : "";
        const l = opt && typeof opt.label === "string" ? opt.label.trim() : "";
        if (!v || v.length > s.optionValueMaxChars || !l || l.length > s.optionLabelMaxChars) return `An option of the setting "${key}" is not valid`;
        if (en && englishVariant(opt, "label", 1, s.optionLabelMaxChars) === null) return `An option of the setting "${key}" is not valid`;
        if (values.has(v)) return `The setting "${key}" repeats the option "${v}"`;
        values.add(v);
      }
    }
    if (o.default !== undefined && o.default !== null) {
      // A typed server becomes an allowed host; only the person may type one (a `hint` shows an example).
      if (type.canHaveDefault === false) return `The setting "${key}" of type ${o.type} can't have a default value: use "hint"`;
      const fits = o.type === "toggle" ? typeof o.default === "boolean"
        : o.type === "select" ? o.options.some((x) => x.value === o.default)
          : typeof o.default === "string" && o.default.length <= type.maxChars;
      if (!fits) return `The default value of the setting "${key}" doesn't fit its type`;
    }
    // apiVersion 12 `devices` (PluginSettings.devicesOf): a non-empty list of different known devices; ignored below it.
    if (apiVersion >= s.devices.apiVersion && o.devices !== undefined) {
      const d = o.devices;
      if (!Array.isArray(d) || d.length === 0 || new Set(d).size !== d.length || !d.every((x) => s.devices.values.includes(x))) return s.devices.badMessage.replace("{key}", key);
    }
    // apiVersion 12 `linkOnly` (PluginSettings): only on an action, only a boolean; ignored below it.
    if (apiVersion >= s.linkOnly.apiVersion && o.linkOnly !== undefined) {
      if (o.type !== "action") return s.linkOnly.onlyActionMessage.replace("{key}", key);
      if (typeof o.linkOnly !== "boolean") return s.linkOnly.notBooleanMessage.replace("{key}", key);
    }
    // apiVersion 13 `sync` (PluginSettings): a password or a text may stay on this device with "sync": false; only on
    // those types, only a boolean; ignored below it.
    if (apiVersion >= s.sync.apiVersion && o.sync !== undefined && o.sync !== null) {
      if (!s.sync.types.includes(o.type)) return s.sync.onlyPasswordOrTextMessage.replace("{key}", key);
      if (typeof o.sync !== "boolean") return s.sync.notBooleanMessage.replace("{key}", key);
    }
    // apiVersion 14 `unlockWith` (PluginSettings): a toggle or a select may ask Kino's 18+ code before it moves away from its
    // default; only one of the known values; ignored below it.
    if (apiVersion >= s.unlockWith.apiVersion && o.unlockWith !== undefined && o.unlockWith !== null) {
      if (!s.unlockWith.types.includes(o.type)) return s.unlockWith.onlyToggleOrSelectMessage.replace("{key}", key);
      if (!s.unlockWith.values.includes(o.unlockWith)) return s.unlockWith.badValueMessage.replace("{key}", key).replace("{values}", s.unlockWith.values.join(", "));
    }
  }
  if (list.filter((o) => o.type === "link").length > s.configAids.maxLinks) return `The plugin has more than ${s.configAids.maxLinks} settings of type link`;
  if (list.filter((o) => o.type === "help").length > s.configAids.maxHelps) return `The plugin has more than ${s.configAids.maxHelps} settings of type help`;
  const valued = list.filter((o) => s.types[o.type].hasValue !== false).length;
  if (valued > s.max) return `The plugin asks for more than ${s.max} settings`;
  if (list.length - valued > ui.maxItems) return `The plugin has more than ${ui.maxItems} sections, statuses or actions`;
  return null;
}

/** A `link` setting's address as PluginSettings.linkUrlOf: https with a host, no user info (not even an empty one), at most linkUrlMaxChars. */
export function isLinkUrl(raw) {
  if (typeof raw !== "string") return false;
  const t = raw.trim();
  if (!t || t.length > contract.settings.configAids.linkUrlMaxChars || !/^https:\/\//i.test(t) || t.includes("\\")) return false;
  const authority = t.slice("https://".length).split(/[/?#]/)[0];
  if (authority.includes("@")) return false;
  let u;
  try { u = new URL(t); } catch { return false; }
  return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
}

/** A server a person may type (spec §1.4): http(s), not loopback, link-local, unspecified or localhost. */
export function isUserServer(value) {
  let u;
  try { u = new URL(String(value).trim()); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:" || !u.hostname) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (/^127\./.test(h) || /^169\.254\./.test(h) || h === "0.0.0.0" || h === "::1" || h === "::" || /^fe[89ab][0-9a-f]:/i.test(h)) return false;
  if (/^::ffff:(127\.|169\.254\.|0\.0\.0\.0)/i.test(h) || /^::ffff:7f/i.test(h)) return false;
  return true;
}

/**
 * The app's PluginPanelOutput.qrUrl (the player panel's qr, and a web address in a settings `qr`): https only, at most maxQrUrlChars, on a public host with a dot or a public IPv4 address (never the device or the home
 * network: a single-label name such as `router` or `nas` is a home network's).
 */
export function qrUrl(raw) {
  const v = typeof raw === "string" ? raw.trim() : null;
  if (v === null || v.length > contract.output.panel.maxQrUrlChars || !v.startsWith("https://")) return null;
  // OkHttp keeps the host as written ("010.1.1.1" or "0x7f.1" are names to it, not IPv4 like WHATWG's URL reads them).
  let parsed;
  try { parsed = new URL(v); } catch { return null; }
  if (!parsed.hostname) return null;
  const written = /^https:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/.exec(v);
  // OkHttp percent-decodes the host ("127.0.0.%31", "%6cocalhost"): judge what it would connect to; a bad escape is no URL.
  let host;
  try { host = decodeURIComponent(written ? written[1] : parsed.hostname).toLowerCase(); } catch { return null; }
  if (!host) return null;
  if (isPublicIpv4Literal(host)) return v;
  return host.replace(/\.+$/, "").includes(".") && !hostRulesLocal(host) ? v : null;
}

/** HostRules.isLocalAddress. */
function hostRulesLocal(host) {
  const h = host.toLowerCase().replace(/\.+$/, "");
  if (h === "" || h.includes(":") || h.includes("[")) return true;
  if (h === "localhost" || contract.hostRules.privateSuffixes.some((s) => h.endsWith(s))) return true;
  return /^\d+$/.test(h.split(".").pop());
}

// ---------- output: what the app keeps and drops ----------

const o = () => contract.output;
const text = (v, max) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").trim().slice(0, max);
const isLocalAddress = (host) => {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.includes(":") || h.includes("[")) return true;
  if (h === "localhost" || PRIVATE_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return /^\d+$/.test(h.split(".").pop());
};

/**
 * The app's PluginOutput.imageUrl, with why: `{ url, why }`, `url` the trimmed URL Kino shows or "" (then `why` says
 * what refused it), `why` on a kept URL says which rule let it through. http or https, at most maxImageUrlChars,
 * on a public name or a public IPv4 address; never the home network or a local name, and over http never a name
 * without a dot. A server the person typed (scheme, host and port exactly) may serve any image.
 */
export function imageVerdict(raw, servers = []) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { url: "", why: "empty" };
  if (v.length > o().maxImageUrlChars) return { url: "", why: `longer than ${o().maxImageUrlChars} characters` };
  // OkHttp's toHttpUrlOrNull: an absolute http(s) URL with a host. Its host is the one written: OkHttp does not read
  // "010.1.1.1" or "0x7f.1" as IPv4 like WHATWG's URL does, so the rules below look at the host as written.
  let u;
  try { u = new URL(v); } catch { return { url: "", why: "not a URL" }; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) return { url: "", why: `not an http(s) URL (${u.protocol.replace(/:$/, "")})` };
  if (servers.some((srv) => sameServer(srv, u))) return { url: v, why: "a server the person typed" };
  if (!v.startsWith("https://") && !v.startsWith("http://")) return { url: "", why: 'does not start with "https://" or "http://" (lowercase, two slashes)' };
  const written = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/.exec(v);
  const host = (written ? written[1] : u.hostname).toLowerCase();
  if (isPublicIpv4Literal(host)) return { url: v, why: "a public IPv4 address" };
  if (isLocalAddress(host)) {
    const h = host.replace(/\.$/, "");
    const what = h === "localhost" || h.endsWith(".localhost") ? "localhost"
      : PRIVATE_SUFFIXES.some((s) => h.endsWith(s)) ? `a local name (${PRIVATE_SUFFIXES.find((s) => h.endsWith(s))})`
      : h.includes(":") || h.includes("[") ? "an IPv6 address"
      : "a private, local or reserved IP address";
    return { url: "", why: `${host} is ${what}: never the home network` };
  }
  if (u.protocol === "http:" && !host.includes(".")) return { url: "", why: `http to "${host}", a name without a dot: a device on the home network` };
  return { url: v, why: u.protocol === "http:" ? "a public name (plain http is fine for a picture)" : "a public name" };
}

function image(v, servers) {
  return imageVerdict(typeof v === "string" ? v : "", servers).url;
}

/** imageSource (apiVersion 13): whether this manifest's answers may carry image references (the app's EffectiveHosts.imagePlugin). */
export function allowsImageRefs(manifest) {
  return Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= contract.images.apiVersion &&
    Array.isArray(manifest.capabilities) && manifest.capabilities.includes(contract.images.capability);
}

// ---------- byteSource (apiVersion 13): a stream whose bytes the plugin serves through read() ----------

/** The app's PluginOutput.allowsBytes: the manifest declares byteSource at apiVersion 13 or later. */
export function allowsByteSource(manifest) {
  const b = contract.byteSource;
  return Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= b.apiVersion &&
    Array.isArray(manifest.capabilities) && manifest.capabilities.includes("byteSource");
}

/** ContractProblem.ByteStreamInvalid's English: what the app logs for a malformed `{ source: "plugin" }` stream. */
export const BYTE_STREAM_INVALID = "the plugin stream's handle, size or mime is not valid";
/** ContractProblem.ReadInvalid's English: a read answer that is not `{ bytes }` of exactly the length asked for. */
export const READ_INVALID = "read didn't return the bytes asked for";

/**
 * The app's PluginOutput.byteSourceOf: `{ handle, size, mime }` of a `{ source: "plugin" }` stream, or null. handle: a
 * string of 1 to maxHandleChars characters with no ISO control character (U+0000..U+001F, U+007F..U+009F); size: a
 * positive whole number; mime: trimmed, matching contract.byteSource.mimePattern.
 */
export function byteSourceOf(v) {
  const b = contract.byteSource;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const h = v.handle;
  if (typeof h !== "string" || h.length < 1 || h.length > b.maxHandleChars || /[\u0000-\u001f\u007f-\u009f]/.test(h)) return null;
  const size = v.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return null;
  const mime = typeof v.mime === "string" ? v.mime.trim() : "";
  if (!mime || !new RegExp(b.mimePattern).test(mime)) return null;
  return { handle: h, size, mime };
}

/**
 * The app's PluginByteStreams.decodeRead: the bytes of a `read` answer `{ bytes: <base64> }` (standard alphabet, padding
 * optional, nothing else), which must be exactly min(length, size - offset) long; else an Error with READ_INVALID.
 */
export function readAnswer(value, offset, length, size) {
  const text = value !== null && typeof value === "object" && !Array.isArray(value) ? value.bytes : undefined;
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.replace(/=+$/, "").length % 4 === 1) throw new Error(READ_INVALID);
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== Math.min(length, size - offset)) throw new Error(READ_INVALID);
  return bytes;
}

/** Why Kino's proxy would never ask this range ([offset], [length] of a stream of [size] bytes), or null. */
export function readRangeProblem(offset, length, size) {
  const b = contract.byteSource;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % b.alignmentBytes !== 0) return `offset must be a non-negative multiple of ${b.alignmentBytes}`;
  if (!Number.isSafeInteger(length) || length < 1 || length > b.chunkBytes) return `length must be 1 to ${b.chunkBytes}`;
  if (Number.isFinite(size) && offset >= size) return `offset ${offset} is past the end of the ${size}-byte stream`;
  return null;
}

/** The app's PluginImageRef.validHandle: 1 to maxHandleChars characters, no control character. */
export function imageHandleOk(h) {
  return typeof h === "string" && h.length >= 1 && h.length <= contract.images.maxHandleChars && !/[\u0000-\u001f\u007f-\u009f]/.test(h);
}

/** The app's PluginImageRef.fromOutput: `{ source: "plugin", handle }` with a valid handle as `{ source, handle }`, else null. */
export function imageRefOf(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v) || v.source !== contract.images.source || !imageHandleOk(v.handle)) return null;
  return { source: contract.images.source, handle: v.handle };
}

/**
 * The app's PluginOutput.imageOrRef, for the fields that may carry a reference (poster, backdrop, still, a hero's image): a
 * string is the Images rule's URL; an object is a reference only for a plugin that declares imageSource (ctx.imageRefs).
 * The kit keeps a reference as `{ source: "plugin", handle }` (the app turns it into an address of its own).
 */
function imageOrRef(v, ctx) {
  if (typeof v === "string") return image(v, ctx.servers);
  if (ctx.imageRefs) return imageRefOf(v) || "";
  return "";
}

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * What the app's PluginImages.decodeAnswer keeps of an `image` answer: `{ bytes: Buffer, mime }`, or throws an Error saying
 * why Kino would show the placeholder (canonical base64 of at most maxBytes decoded bytes, a mime of contract.images.mimes,
 * and bytes that really are that type).
 */
export function imageAnswer(value) {
  const lim = contract.images;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("image didn't return { bytes, mime }");
  if (typeof value.mime !== "string" || !lim.mimes.includes(value.mime)) throw new Error(`image: mime must be one of ${lim.mimes.join(", ")}`);
  const text = value.bytes;
  if (typeof text !== "string" || !text) throw new Error("image: bytes must be a base64 string");
  if (text.length > Math.ceil(lim.maxBytes / 3) * 4) throw new Error(`image: over ${lim.maxBytes} bytes once decoded`);
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const last = pad ? B64_ALPHABET.indexOf(text[text.length - pad - 1]) : 0;
  if (!B64.test(text) || (pad && (last & (pad === 2 ? 15 : 3)) !== 0)) throw new Error("image: bytes is not canonical base64 (standard alphabet, padded, no whitespace)");
  const bytes = Buffer.from(text, "base64");
  if (!bytes.length || bytes.length > lim.maxBytes) throw new Error(`image: over ${lim.maxBytes} bytes once decoded`);
  const sig = {
    "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/png": (b) => b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
    "image/webp": (b) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
  }[value.mime];
  if (!sig(bytes)) throw new Error(`image: the bytes are not ${value.mime}`);
  return { bytes, mime: value.mime };
}

function sameServer(server, u) {
  let s;
  try { s = new URL(server); } catch { return false; }
  const port = (x) => x.port || (x.protocol === "https:" ? "443" : "80");
  return s.protocol === u.protocol && s.hostname === u.hostname && port(s) === port(u);
}

function strings(v, max, maxChars) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (out.length >= max) break;
    const s = typeof x === "string" ? x.trim().slice(0, maxChars) : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** org.json's optString: a string as it is, a number or boolean as Java prints it, an object or array as JSON, else "". */
function optString(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : javaDouble(v);
  if (typeof v === "boolean") return String(v);
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return "";
}

function items(list, max, ctx, drop) {
  const { allowSeries, allowLive, allowAudio, allowAdult } = ctx;
  const out = [];
  const seen = new Set();
  const list2 = Array.isArray(list) ? list : [];
  for (let i = 0; i < list2.length; i++) {
    // The app's loop: one line at the cap, then it stops.
    if (out.length >= max) { drop(`items beyond ${max} dropped`); break; }
    one(list2[i], i);
  }
  return out;

  function one(x, i) {
    // org.json's optJSONObject: an array (or anything not an object) is skipped silently.
    if (x === null || typeof x !== "object" || Array.isArray(x)) return;
    const id = optString(x.id);
    if (!re(o().itemIdPattern).test(id)) return drop(`item #${i}: invalid id`);
    const ref = optString(x.ref);
    if (!ref || ref.length > o().maxRefChars) return drop(`item ${id}: invalid ref`);
    const title = text(x.title, o().maxTitleChars);
    if (!title) return drop(`item ${id}: no title`);
    if (!o().itemKinds.includes(x.kind)) return drop(`item ${id}: invalid kind '${String(x.kind).slice(0, 20)}'`);
    if (x.kind === "series" && !allowSeries) return drop(`item ${id}: series without the episodes capability`);
    // Silently, like any invalid item: an apiVersion 1 plugin never declared it could go live.
    if (x.kind === "live" && !allowLive) return drop(`item ${id}: live needs apiVersion ${o().liveKindApiVersion}`);
    // Like live below 2: music and podcast (audio kinds, output.audioKindApiVersion) need no `episodes` capability,
    // but an older plugin never declared it could answer them.
    if (o().audioKinds.includes(x.kind) && !allowAudio) return drop(`item ${id}: ${x.kind} needs apiVersion ${o().audioKindApiVersion}`);
    // Below apiVersion 6 (output.adultApiVersion) an adult title never reaches a screen; from 6 it is kept and
    // marked, and Kino lists it only while the person's 18+ code is unlocked.
    const adult = x.adult === true;
    if (adult && !allowAdult) return drop(`item ${id}: adult, dropped`);
    if (seen.has(id)) return;
    seen.add(id);
    const ids = x.ids && typeof x.ids === "object" ? x.ids : {};
    out.push({
      id, ref, title, kind: x.kind, year: text(x.year, 10),
      poster: imageOrRef(x.poster, ctx), backdrop: imageOrRef(x.backdrop, ctx),
      overview: text(x.overview, o().maxTextChars), lang: text(x.lang, 20), quality: text(x.quality, 20),
      originalTitle: text(x.originalTitle, o().maxTitleChars),
      genres: strings(x.genres, o().maxGenres, o().maxGenreChars),
      rating: typeof x.rating === "number" && x.rating >= o().minRating && x.rating <= o().maxRating ? x.rating : null,
      // A channel has no length: whatever the plugin put there is ignored, never shown.
      runtimeMinutes: x.kind !== "live" && Number.isInteger(x.runtimeMinutes) && x.runtimeMinutes >= o().minRuntimeMinutes && x.runtimeMinutes <= o().maxRuntimeMinutes ? x.runtimeMinutes : 0,
      tmdb: Number.isInteger(ids.tmdb) && ids.tmdb > 0 ? ids.tmdb : 0,
      imdb: typeof ids.imdb === "string" && re(o().imdbPattern).test(ids.imdb) ? ids.imdb : "",
      badges: strings(x.badges, o().maxBadges, o().maxBadgeChars),
      ...(adult ? { adult: true } : {}),
      // Only an audio item has one (and audio items only exist from apiVersion 8, dropped above below it).
      ...(o().audioKinds.includes(x.kind) && text(x.artist, o().maxArtistChars) ? { artist: text(x.artist, o().maxArtistChars) } : {}),
      ...openField(x.open, `item ${id}`, drop),
    });
  }
}

/**
 * The app's PluginOutput.screenItems: the items of a plugin screen's title components (apiVersion 14 allows every item
 * kind and `adult`), read by the same item parser as `home` rows, with its drop lines; at most [max].
 */
export function screenItems(list, max, drop, allowSeries = true) {
  // A screen's images are https only (spec Safety): a cleartext poster or backdrop is blanked, Kino's placeholder shows.
  const https = (u) => (u.startsWith("https://") ? u : "");
  return items(list, max, { allowSeries, allowLive: true, allowAudio: true, allowAdult: true, servers: [] }, drop)
    .map((x) => ({ ...x, poster: https(x.poster), backdrop: https(x.backdrop) }));
}

/**
 * PluginOutput.openOf (Task 7g): an item's or a row's `open` is only `{ screen: { route?, args? } }` (read as a screen's
 * go.screen); anything else is ignored, the item or row kept. `{ open }` to spread, or nothing.
 */
function openField(raw, where, drop) {
  if (raw === undefined || raw === null) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || !("screen" in raw)) {
    drop(`${where}: open must be {screen: {route, args}}, ignored`);
    return {};
  }
  const g = screenGoOf(raw.screen, (why) => drop(`${where}: open.screen ${why}, ignored`));
  return g === null ? {} : { open: { screen: g } };
}

function page(value, max, ctx, drop) {
  if (Array.isArray(value)) return { items: items(value, max, ctx, drop), next: null };
  if (value === null || typeof value !== "object" || !Array.isArray(value.items)) {
    drop("the answer is not a list or a page");
    return { items: [], next: null };
  }
  let next = typeof value.next === "string" && value.next ? value.next : null;
  if (next && !ctx.allowNext) { drop("page: next dropped, the plugin doesn't declare browse"); next = null; }
  if (next && next.length > o().maxCursorChars) { drop(`page: next longer than ${o().maxCursorChars} dropped`); next = null; }
  return { items: items(value.items, max, ctx, drop), next };
}

function rows(value, ctx, drop) {
  if (!Array.isArray(value)) { drop("home: the answer is not a JSON array"); return []; }
  const out = [];
  const seen = new Set();
  value.forEach((r, i) => {
    if (out.length >= o().maxHomeRows) { drop(`home: rows beyond ${o().maxHomeRows} dropped`); return; }
    if (r === null || typeof r !== "object") return;
    const id = typeof r.id === "string" ? r.id : "";
    if (!re(o().itemIdPattern).test(id)) return drop(`home: row ${i} has an invalid id`);
    const title = text(r.title, o().maxTitleChars);
    if (!title) return drop(`home: row ${id} has no title`);
    let list = items(r.items, o().maxRowItems, ctx, drop);
    // Below apiVersion 6 (output.homeLiveApiVersion) a channel is not a Home card: it lives in En vivo.
    if (ctx.homeLive === false) {
      list = list.filter((x) => {
        if (x.kind !== "live") return true;
        drop(`home: row ${id} item ${x.id}: live in a Home row needs apiVersion ${o().homeLiveApiVersion}`);
        return false;
      });
    }
    if (!list.length) return;
    if (seen.has(id)) return drop(`home: duplicate row ${id} dropped`);
    seen.add(id);
    let ref = typeof r.ref === "string" && r.ref ? r.ref : null;
    if (ref && !ctx.allowNext) { drop(`home: row ${id} has a ref but the plugin doesn't declare browse`); ref = null; }
    if (ref && ref.length > o().maxRefChars) { drop(`home: row ${id} ref too long`); ref = null; }
    out.push({ id, title, ref, items: list, genre: genreOf(r.genre), ...openField(r.open, `home: row ${id}`, drop) });
  });
  return out;
}

// The app reads these fields as strings only (a number is no label), unlike `text`.
const strictText = (v, max) => (typeof v === "string" ? text(v, max) : "");

function section(value, ctx, drop) {
  const empty = { tabs: [], tab: null, hero: null, rows: [] };
  if (value === null || typeof value !== "object" || Array.isArray(value)) { drop("section: the answer is not a JSON object"); return empty; }
  const lim = o().section;
  const tabs = [];
  const seen = new Set();
  (Array.isArray(value.tabs) ? value.tabs : []).forEach((t, i) => {
    if (tabs.length >= lim.maxTabs) { drop(`section: tabs beyond ${lim.maxTabs} dropped`); return; }
    if (t === null || typeof t !== "object") return;
    const id = typeof t.id === "string" ? t.id : "";
    if (!re(o().itemIdPattern).test(id)) return drop(`section: tab ${i} has an invalid id`);
    const label = strictText(t.label, lim.maxTabLabelChars);
    if (!label) return drop(`section: tab ${id} has no label`);
    if (seen.has(id)) return drop(`section: duplicate tab ${id} dropped`);
    seen.add(id);
    tabs.push({ id, label });
  });
  const tab = typeof value.tab === "string" && tabs.some((t) => t.id === value.tab) ? value.tab : (tabs[0] ? tabs[0].id : null);
  let hero = null;
  if (value.hero !== null && typeof value.hero === "object" && !Array.isArray(value.hero)) {
    const title = strictText(value.hero.title, o().maxTitleChars);
    if (!title) drop("section: a hero without title dropped");
    else hero = { title, image: imageOrRef(value.hero.image, ctx), text: strictText(value.hero.text, lim.maxHeroTextChars) };
  }
  return { tabs, tab, hero, rows: rows(Array.isArray(value.rows) ? value.rows : [], ctx, (m) => drop(`section ${m}`)) };
}

function categories(value, ctx, drop) {
  const lim = o().categories;
  if (!ctx.allowNext) { drop("categories: ignored, the plugin doesn't declare browse"); return []; }
  if (!Array.isArray(value)) { drop("categories: the answer is not a JSON array"); return []; }
  const out = [];
  const seen = new Set();
  value.forEach((c, i) => {
    if (out.length >= lim.maxCategories) { drop(`categories: beyond ${lim.maxCategories} dropped`); return; }
    if (c === null || typeof c !== "object") return;
    const id = typeof c.id === "string" ? c.id : "";
    if (!re(o().itemIdPattern).test(id)) return drop(`categories: #${i} has an invalid id`);
    const title = strictText(c.title, lim.maxTitleChars);
    if (!title) return drop(`categories: ${id} has no title`);
    const ref = typeof c.ref === "string" ? c.ref : "";
    if (!ref || ref.length > o().maxRefChars) return drop(`categories: ${id} has no valid ref`);
    const adult = c.adult === true;
    if (adult && !ctx.allowAdult) return drop(`categories: ${id} adult, dropped`);
    if (seen.has(id)) return drop(`categories: duplicate ${id} dropped`);
    seen.add(id);
    out.push({ id, title, art: image(c.art, ctx.servers) || null, ref, ...(adult ? { adult: true } : {}) });
  });
  return out;
}

function episodes(value, drop, servers, imageRefs = false) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("the episode list is not valid JSON");
  if (!Array.isArray(value.episodes)) throw new Error("the plugin returned zero episodes");
  const seen = new Set();
  const eps = [];
  value.episodes.forEach((e, i) => {
    if (eps.length >= o().maxEpisodes) { drop(`episodes: beyond ${o().maxEpisodes} dropped`); return; }
    if (e === null || typeof e !== "object") return;
    const season = Number.isInteger(e.season) && e.season >= 1 && e.season <= o().maxSeasonNumber ? e.season : 1;
    if (!Number.isInteger(e.number) || e.number < 1 || e.number > o().maxEpisodeNumber) return drop(`episodes: #${i} has no valid number`);
    if (typeof e.ref !== "string" || !e.ref || e.ref.length > o().maxRefChars) return drop(`episodes: #${i} has no valid ref`);
    const key = season + "x" + e.number;
    if (seen.has(key)) return drop(`episodes: duplicate S${season}E${e.number} dropped`);
    seen.add(key);
    eps.push({
      season, number: e.number, ref: e.ref, title: text(e.title, o().maxTitleChars),
      // The same image and length rules as an item's poster and runtimeMinutes (PluginOutput.episodes).
      still: imageOrRef(e.still, { servers, imageRefs }), overview: text(e.overview, o().maxTextChars),
      airDate: re(o().airDatePattern).test(text(e.airDate, 10)) ? text(e.airDate, 10) : "",
      runtimeMinutes: Number.isInteger(e.runtimeMinutes) && e.runtimeMinutes >= o().minRuntimeMinutes && e.runtimeMinutes <= o().maxRuntimeMinutes ? e.runtimeMinutes : 0,
    });
  });
  return { series: value.series && typeof value.series === "object" ? value.series : null, episodes: eps, seasons: seasons(value, drop) };
}

/** The optional sibling `seasons` of an episodes answer, read as the app reads them (PluginOutput.seasonsOf). */
function seasons(value, drop) {
  if (!("seasons" in value) || value.seasons === undefined) return [];
  if (!Array.isArray(value.seasons)) { drop("seasons: not a list, ignored"); return []; }
  const seen = new Set();
  const out = [];
  value.seasons.forEach((s, i) => {
    if (out.length >= o().maxSeasons) { drop(`seasons: beyond ${o().maxSeasons} dropped`); return; }
    if (s === null || typeof s !== "object" || Array.isArray(s)) return;
    const id = typeof s.id === "number" ? String(s.id) : s.id;
    if (typeof id !== "string" || !re(o().itemIdPattern).test(id)) return drop(`seasons: #${i} has an invalid id`);
    if (typeof s.ref !== "string" || !s.ref || s.ref.length > o().maxRefChars) return drop(`seasons: ${id} has no valid ref`);
    const title = text(s.title, o().maxTitleChars);
    if (!title) return drop(`seasons: ${id} has no title`);
    if (seen.has(id)) return drop(`seasons: duplicate ${id} dropped`);
    seen.add(id);
    const number = Number.isInteger(s.number) && s.number >= 1 && s.number <= o().maxSeasonNumber ? s.number : 0;
    out.push({ id, ref: s.ref, title, number, current: s.current === true });
  });
  return out;
}

/** Up to `maxHeaders` request headers as the app keeps them: a token name, none of the forbidden ones, a string value with no line break. */
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = ["host", "content-length", "transfer-encoding", "connection"];
/** A declared `genre`, read as Genre.parse: the id when it is in the closed vocabulary (case and outer spaces ignored), else null. */
function genreOf(raw) {
  const g = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return contract.genres.includes(g) ? g : null;
}

function headersOf(h) {
  const out = {};
  if (h === null || typeof h !== "object" || Array.isArray(h)) return out;
  for (const k of Object.keys(h)) {
    if (Object.keys(out).length >= o().maxHeaders) break;
    const v = h[k];
    if (typeof v !== "string" || !HEADER_NAME.test(k) || FORBIDDEN_HEADERS.includes(k.toLowerCase())) continue;
    if (v.length > 4096 || v.includes("\n") || v.includes("\r")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The optional `drm` block, read ONLY for a plugin that declares the capability (`allowDrm`) and
 * when it is the only DRM-shaped key present; any other of `drmKeys` refuses the stream as it
 * always did. Mirrors the app's PluginOutput.drmOf, message for message.
 */
function drmOf(value, check, allowDrm) {
  const present = o().drmKeys.filter((k) => k in value);
  if (present.length === 0) return null;
  if (!allowDrm || present.length !== 1 || present[0] !== o().drm.field) throw new Error("the video has DRM and plugins don't support it");
  const d = value[o().drm.field];
  if (d === null || typeof d !== "object" || Array.isArray(d)) throw new Error("the video's DRM is not valid");
  if (!o().drm.types.includes(d.type)) throw new Error("the video uses a DRM Kino doesn't support");
  check(d.licenseUrl, "the video's license");
  return { type: d.type, licenseUrl: d.licenseUrl, licenseHeaders: headersOf(d.licenseHeaders) };
}

/** PluginOutput.SIGNED_CHANNEL: an inline channel stream that asks for signing. */
const SIGNED_CHANNEL = "a channel signed per request must play through resolve()";

/** `signing: "request"`, `signContext` and `alternateHosts` (apiVersion 6), as the app's PluginOutput.signingOf reads them. */
function signingOf(value, manifest, drm, inline, alternateOk, drop) {
  const s = o().signing;
  if (!(Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= s.apiVersion)) return null;
  if (value.signing === undefined || value.signing === null) return { signing: false, signContext: "", alternateHosts: [] };
  if (value.signing !== s.value) throw new Error('the "signing" value is not valid');
  if (inline) throw new Error(SIGNED_CHANNEL);
  const mime = typeof value.mime === "string" ? value.mime.trim().toLowerCase() : "";
  let path = "";
  try { path = new URL(value.url).pathname.toLowerCase(); } catch { /* the URL rule already ran */ }
  if (!s.hlsMimes.includes(mime) && !path.endsWith(".m3u8")) throw new Error("per-request signing only works with HLS video (.m3u8)");
  if (drm || (Array.isArray(value.audioTracks) && value.audioTracks.length > 0)) {
    throw new Error("a video signed per request can't carry drm or separate audio tracks");
  }
  const ctx = value.signContext;
  if (ctx !== undefined && ctx !== null && (typeof ctx !== "string" || ctx.length > s.maxContextChars)) throw new Error('the "signContext" value is not valid');
  // A kino.secret() marker means nothing in sign()'s own runtime, as in the app.
  if (typeof ctx === "string" && ctx.includes("__kinoSecret_")) throw new Error("signContext can't carry a kino.secret(): call it inside sign()");
  return { signing: true, signContext: typeof ctx === "string" ? ctx : "", alternateHosts: alternateHostsOf(value, alternateOk, drop) };
}

/** [url] with its authority (`host` or `host:port`, no port = the scheme's default) replaced, or null when it is not one. */
function withAuthority(url, authority) {
  if (!re(o().signing.alternateHosts.pattern).test(authority)) return null;
  const [host, port] = authority.split(":");
  if (port !== undefined && !(Number(port) >= 1 && Number(port) <= 65535)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  u.hostname = host;
  // The URL setter ignores (or rewrites) a host it can't take: such an entry is not an authority.
  if (u.hostname !== host.toLowerCase()) return null;
  u.port = port === undefined ? "" : String(Number(port));
  return u;
}

/** `host`, or `host:port` when the port is not the scheme's default (the URL drops a default port itself). */
const authorityOf = (u) => (u.port ? `${u.hostname}:${u.port}` : u.hostname);

/**
 * A signed Stream's `alternateHosts`, as PluginOutput.alternateHostsOf: the wrong type refuses the
 * Stream; an entry that is not an authority, fails the stream URL's own rule once put in its place,
 * or repeats the stream's host or a kept one is dropped; once `maxEntries` are kept the rest is ignored (one line).
 */
function alternateHostsOf(value, alternateOk, drop) {
  const raw = value.alternateHosts;
  if (raw === undefined || raw === null) return [];
  const invalid = 'the "alternateHosts" value is not valid';
  if (!Array.isArray(raw) || raw.some((e) => typeof e !== "string")) throw new Error(invalid);
  const max = o().signing.alternateHosts.maxEntries;
  let primary;
  try { primary = new URL(value.url); } catch { return []; }
  const seen = new Set([authorityOf(primary)]);
  const kept = [];
  for (const [i, entry] of raw.entries()) {
    // Full: the rest is not even looked at, one line says how many (as the app).
    if (kept.length >= max) { drop(`alternateHosts: ${max} kept, ${raw.length - i} more ignored`); break; }
    const swapped = withAuthority(value.url, entry);
    if (!swapped) { drop(`alternateHosts: "${entry.slice(0, 100)}" is not a host or host:port, dropped`); continue; }
    const authority = authorityOf(swapped);
    if (seen.has(authority)) { drop(`alternateHosts: ${authority} repeats the stream's host or another entry, dropped`); continue; }
    seen.add(authority);
    const refusal = alternateOk(swapped.toString());
    if (refusal) { drop(`alternateHosts: ${authority} dropped: ${refusal}`); continue; }
    kept.push(authority);
  }
  return kept;
}

/**
 * A `subtitles()` answer, as the app's PluginOutput.subtitleTracks reads it: an array of { lang, url, format?, label?, translated? }, each
 * URL checked like a Stream's side subtitles (any public host with `streamHosts: "any"`), `format` only vtt/srt, `lang` 20
 * characters ("und" when blank), `label` maxSubtitleLabelChars; maxSubtitles at most, a repeated URL kept once.
 */
/**
 * A `segments()` answer as the app's Segments.parse keeps it: `{ type, startMs, endMs }` entries, each dropped on its own
 * (never the whole answer): an unknown type, times that are not whole ms, start below 0, shorter than minLengthMs; with
 * [durationMs] known, a start at or past it or an end more than endSlackMs past it (an end within is cut to it); one
 * overlapping an earlier kept one of the same type. maxEntriesRead read, maxSegments kept, earliest first.
 */
export function segmentsAnswer(value, durationMs, drop = () => {}) {
  const c = contract.segments;
  if (!Array.isArray(value)) { if (value !== null) drop("segments: the answer is not an array"); return []; }
  if (value.length > c.maxEntriesRead) drop(`segments: only the first ${c.maxEntriesRead} of ${value.length} entries are read`);
  const known = Number.isInteger(durationMs) && durationMs > 0;
  const whole = (v) => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 1e15;
  const read = [];
  for (const [i, e] of value.slice(0, c.maxEntriesRead).entries()) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) { drop(`segments: entry ${i} is not an object`); continue; }
    if (!c.types.includes(e.type)) { drop(`segments: entry ${i}: unknown type`); continue; }
    if (!whole(e.startMs) || !whole(e.endMs)) { drop(`segments: entry ${i}: startMs and endMs must be whole numbers of ms`); continue; }
    const start = e.startMs;
    let end = e.endMs;
    if (start < 0) { drop(`segments: entry ${i}: startMs below 0`); continue; }
    if (known) {
      if (start >= durationMs) { drop(`segments: entry ${i}: starts past the file's end`); continue; }
      if (end > durationMs + c.endSlackMs) { drop(`segments: entry ${i}: ends past the file's end`); continue; }
      end = Math.min(end, durationMs);
    }
    if (end - start < c.minLengthMs) { drop(`segments: entry ${i}: shorter than ${c.minLengthMs} ms or ends before it starts`); continue; }
    read.push({ type: e.type, startMs: start, endMs: end });
  }
  read.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const kept = [];
  for (const seg of read) {
    if (kept.some((k) => k.type === seg.type && seg.startMs < k.endMs && k.startMs < seg.endMs)) { drop(`segments: a ${seg.type} overlaps another`); continue; }
    if (kept.length === c.maxSegments) { drop(`segments: more than ${c.maxSegments} segments`); break; }
    kept.push(seg);
  }
  return kept;
}

/** What the app's skip button takes from [segments] (Segments.skipTimes): the opening and the ending's start, or null. */
export function segmentSkip(segments) {
  const c = contract.segments;
  const first = (types) => segments.filter((s) => types.includes(s.type)).sort((a, b) => a.startMs - b.startMs)[0];
  const opening = first(c.openingTypes);
  let ending = first(c.endingTypes);
  if (ending && opening && ending.startMs < opening.endMs) ending = undefined;
  if (!opening && !ending) return null;
  return { openingStartMs: opening ? opening.startMs : null, openingEndMs: opening ? opening.endMs : null, endingStartMs: ending ? ending.startMs : null };
}

function subtitleTracks(value, { manifest, servers }, drop) {
  if (!Array.isArray(value)) { drop("subtitles: the answer is not a list"); return []; }
  const check = urlChecker(manifest, servers);
  const anyPublic = liveStreamUrlAllowed(manifest, servers);
  const out = [];
  for (const [i, s] of value.entries()) {
    if (out.length >= o().maxSubtitles) { drop(`subtitles: beyond ${o().maxSubtitles} dropped`); break; }
    if (s === null || typeof s !== "object" || Array.isArray(s)) continue;
    if (manifest.streamHostsAny) {
      if (!anyPublic(s.url)) { drop(`subtitles: #${i} dropped: the subtitle points to a local address`); continue; }
    } else {
      try { check(s.url, "the subtitle"); } catch (e) { drop(`subtitles: #${i} dropped: ${e.message}`); continue; }
    }
    if (out.some((t) => t.url === s.url)) continue;
    const text = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
    const track = { lang: text(s.lang, 20) || "und", url: s.url };
    if (s.format === "vtt" || s.format === "srt") track.format = s.format;
    const label = text(s.label, o().maxSubtitleLabelChars);
    if (label) track.label = label;
    if (s.translated === true) track.translated = true;
    out.push(track);
  }
  return out;
}

const EXTERNAL_PROTOCOL = /^[a-z0-9._-]{1,64}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** `{ protocol, ref, resolver? }`, or null when the plugin may not hand off or the object is malformed (Kino drops it the same way). */
function externalOf(raw, manifest) {
  if ((manifest.apiVersion || 1) < 11 || !(manifest.capabilities || []).includes("externalResolve")) return null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.protocol !== "string" || !EXTERNAL_PROTOCOL.test(raw.protocol)) return null;
  if (typeof raw.ref !== "string" || raw.ref.length < 1 || raw.ref.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw.ref)) return null;
  const out = { protocol: raw.protocol, ref: raw.ref };
  if (raw.resolver !== undefined && raw.resolver !== null) {
    if (typeof raw.resolver !== "string" || raw.resolver.length > 255 || !ANDROID_PACKAGE.test(raw.resolver)) return null;
    out.resolver = raw.resolver;
  }
  return out;
}

/** One tidy line: control characters dropped, whitespace collapsed, cut at [max] (as StreamMedia.parse does). */
function mediaText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max).trimEnd();
}

const MEDIA_MAX_TRACKS = 16;
const MEDIA_MAX_NOTES = 4;
const mediaInt = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : 0);

/**
 * A stream's optional `media` (what the source says about the file itself): bounded and cleaned the way the app does, or null when
 * nothing usable is left. Advisory: the app shows and logs it, never trusts it for a decision (PluginOutput / StreamMedia).
 */
export function mediaOf(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const tracks = (list, make) => (Array.isArray(list) ? list.slice(0, MEDIA_MAX_TRACKS).filter((t) => t && typeof t === "object" && !Array.isArray(t)).map(make) : []);
  const video = raw.video && typeof raw.video === "object" && !Array.isArray(raw.video) ? {
    codec: mediaText(raw.video.codec, 40), profile: mediaText(raw.video.profile, 40),
    width: mediaInt(raw.video.width, 0, 16384), height: mediaInt(raw.video.height, 0, 16384),
    fps: Number.isFinite(raw.video.fps) ? Math.min(480, Math.max(0, raw.video.fps)) : 0,
    bitDepth: mediaInt(raw.video.bitDepth, 0, 16), hdr: raw.video.hdr === true,
  } : null;
  const out = {
    title: mediaText(raw.title, 120),
    sizeBytes: Number.isFinite(raw.sizeBytes) ? Math.min(2 ** 50, Math.max(0, Math.trunc(raw.sizeBytes))) : 0,
    container: mediaText(raw.container, 40),
    video: video && (video.codec || video.width || video.height) ? video : null,
    audio: tracks(raw.audio, (a) => ({ codec: mediaText(a.codec, 40), channels: mediaInt(a.channels, 0, 32), language: mediaText(a.language, 20), title: mediaText(a.title, 120), default: a.default === true })),
    subtitles: tracks(raw.subtitles, (s) => ({ codec: mediaText(s.codec, 40), language: mediaText(s.language, 20), title: mediaText(s.title, 120), text: s.text === true })),
    converted: raw.converted === true,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map((n) => mediaText(n, 120)).filter(Boolean).slice(0, MEDIA_MAX_NOTES),
  };
  const empty = !out.title && !out.sizeBytes && !out.container && !out.video && !out.audio.length && !out.subtitles.length && !out.notes.length;
  return empty ? null : out;
}

function stream(value, { manifest, servers, allowDrm, liveChannel = false, inline = false, alternative = false, drop = () => {} }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("the plugin returned zero videos");
  // byteSource (apiVersion 13, PluginOutput.stream's allowBytes): a movie's, an episode's or a track's own stream only, never a
  // live channel's, an inline one or a lazy copy's. Anything else has `source` ignored and fails below like a missing url.
  if (!liveChannel && !inline && !alternative && value.source === contract.byteSource.source && allowsByteSource(manifest)) {
    return byteStream(value, manifest, servers, drop);
  }
  // apiVersion 11, `externalResolve`: the answer is a hand-off to a resolver app, not a playable URL (PluginOutput.externalOf).
  // Read only from a plugin that declares both; anything else has its `external` ignored and fails below like a missing url.
  const external = !liveChannel && !inline ? externalOf(value.external, manifest) : null;
  if (external) return { external, headers: {}, subtitles: [], audioTracks: [], expiresInSeconds: 0, drm: null };
  const check = urlChecker(manifest, servers);
  const drm = drmOf(value, check, allowDrm);
  // `liveStreamHosts: "any"` relaxes a live channel's own stream URL only; its subtitles, audio and
  // license stay on the strict rule below. `streamHosts: "any"` on a movie or an episode is the app's
  // broad-video rule (EffectiveHosts.anyPublicVideoHost, the player's own resolve): the URL AND its
  // side subtitles and audio tracks; never the license. On a live channel it is the live rule.
  const anyVideo = !liveChannel && manifest.streamHostsAny;
  const anyPublic = liveStreamUrlAllowed(manifest, servers);
  const anyHost = (liveChannel && manifest.liveStreamHostsAny) || manifest.streamHostsAny;
  if (anyHost) {
    if (!anyPublic(value.url)) throw new Error("the video points to a local address");
  } else check(value.url, "the video");
  // An alternate host meets the stream URL's own rule: the refusal's sentence, or null.
  const alternateOk = (url) => {
    if (anyHost) return anyPublic(url) ? null : `the alternate server points to ${new URL(url).hostname}, a local address`;
    try { check(url, "the alternate server"); return null; } catch (e) { return e.message; }
  };
  const sideOk = (url, what) => {
    if (anyVideo) return anyPublic(url);
    try { check(url, what); return true; } catch { return false; }
  };
  const expires = Number.isInteger(value.expiresInSeconds) && value.expiresInSeconds >= o().minExpiresInSeconds && value.expiresInSeconds <= o().maxExpiresInSeconds ? value.expiresInSeconds : 0;
  const subtitles = (Array.isArray(value.subtitles) ? value.subtitles : []).slice(0, o().maxSubtitles).filter((s) => sideOk(s && s.url, "the subtitle"));
  // One URL is one merged child in the app: a repeated URL is kept once, the first wins.
  const audioUrls = new Set();
  const audioTracks = (Array.isArray(value.audioTracks) ? value.audioTracks : []).slice(0, o().maxAudioTracks).filter((a) => {
    if (!sideOk(a && a.url, "the audio")) return false;
    if (audioUrls.has(a.url)) return false;
    audioUrls.add(a.url);
    return true;
  });
  const sig = signingOf(value, manifest, drm, inline, alternateOk, drop);
  // Other copies of the video (PluginOutput.alternativesOf): never next to drm or signing; each checked like `url`.
  // Labels and lazy `{ label, ref }` copies (PluginOutput.STREAM_LABELS_API_VERSION): below it both keys are unknown.
  const labels = (manifest.apiVersion || 1) >= o().streamLabels.apiVersion;
  const alternatives = drm || (sig && sig.signing) ? [] : alternativesOf(value.alternatives, value.url, (url) => {
    if (anyHost) return anyPublic(url);
    try { check(url, "the video"); return true; } catch { return false; }
  }, labels, drop);
  // A portable copy (PluginOutput.portableOf): a universal HLS of this same video, checked like `url`; never next to drm or signing.
  // Anything else is dropped, never refused.
  let portable = null;
  const rawPortable = value.portable;
  if (rawPortable !== undefined && !drm && !(sig && sig.signing)) {
    const u = rawPortable && typeof rawPortable === "object" && !Array.isArray(rawPortable) ? rawPortable.url : undefined;
    const mime = rawPortable && typeof rawPortable.mime === "string" ? rawPortable.mime.trim() : "";
    const hls = mime === "" || /^application\/(x-mpegurl|vnd\.apple\.mpegurl)$/i.test(mime);
    let allowed = false;
    if (typeof u === "string") {
      if (anyHost) allowed = anyPublic(u);
      else { try { check(u, "the video"); allowed = true; } catch { allowed = false; } }
    }
    if (allowed && hls) portable = { url: u, mime: "application/x-mpegURL" };
    else drop("resolve: portable dropped (it needs an HLS url that passes the same host rules as url)");
  }
  const { signing: _signing, signContext: _signContext, alternateHosts: _alternateHosts, alternatives: _alternatives, label: _label, portable: _portable, ...rest } = value;
  if (labels) {
    const label = labelOf(value, "resolve: label", drop);
    if (label) rest.label = label;
  }
  const durationMs = Number.isFinite(value.durationMs) && value.durationMs > 0 ? Math.floor(value.durationMs) : 0;
  const out = { ...rest, headers: headersOf(value.headers), subtitles, audioTracks, expiresInSeconds: expires, drm, ...(alternatives.length ? { alternatives } : {}) };
  const raw = value[o().skip.field];
  const skip = liveChannel ? null : skipOf(raw, durationMs);
  if (raw !== undefined) {
    if (liveChannel) drop("resolve: skip is ignored for a live channel");
    else if (!skip) drop("resolve: skip has nothing usable (each value 0..durationMs, the opening needs its end after its start): ignored");
    else for (const k of o().skip.fields) {
      if (raw && k in raw && raw[k] !== null && skip[k] === null) drop(`resolve: skip.${k} dropped (out of range or out of order)`);
    }
  }
  if (skip) out.skip = skip; else delete out.skip;
  const media = mediaOf(value.media);
  if (media) out.media = media; else delete out.media;
  if (portable) out.portable = portable;
  return sig ? { ...out, ...sig } : out;
}

/**
 * The app's PluginOutput.byteStreamOf: the byte source (or ByteStreamInvalid), with its subtitles, audio tracks, duration,
 * skip times, label and media read as a url Stream's; nothing that needs a url of its own (drm, signing, alternatives,
 * alternate hosts, an external hand-off, a portable copy).
 */
function byteStream(value, manifest, servers, drop) {
  const bytes = byteSourceOf(value);
  if (!bytes) throw new Error(BYTE_STREAM_INVALID);
  const check = urlChecker(manifest, servers);
  const anyPublic = liveStreamUrlAllowed(manifest, servers);
  const sideOk = (url, what) => {
    if (manifest.streamHostsAny) return anyPublic(url);
    try { check(url, what); return true; } catch { return false; }
  };
  const subtitles = (Array.isArray(value.subtitles) ? value.subtitles : []).slice(0, o().maxSubtitles).filter((s) => sideOk(s && s.url, "the subtitle"));
  const audioUrls = new Set();
  const audioTracks = (Array.isArray(value.audioTracks) ? value.audioTracks : []).slice(0, o().maxAudioTracks).filter((a) => {
    if (!sideOk(a && a.url, "the audio")) return false;
    if (audioUrls.has(a.url)) return false;
    audioUrls.add(a.url);
    return true;
  });
  const durationMs = Number.isFinite(value.durationMs) && value.durationMs > 0 ? Math.floor(value.durationMs) : 0;
  const expires = Number.isInteger(value.expiresInSeconds) && value.expiresInSeconds >= o().minExpiresInSeconds && value.expiresInSeconds <= o().maxExpiresInSeconds ? value.expiresInSeconds : 0;
  for (const k of ["drm", "signing", "alternatives", "alternateHosts", "external", "portable", "url"]) {
    if (value[k] !== undefined) drop(`resolve: ${k} is ignored on a { source: "plugin" } stream`);
  }
  const out = { source: contract.byteSource.source, ...bytes, headers: {}, subtitles, audioTracks, expiresInSeconds: expires, drm: null };
  if (durationMs) out.durationMs = durationMs;
  const skip = skipOf(value[o().skip.field], durationMs);
  if (skip) out.skip = skip;
  if ((manifest.apiVersion || 1) >= o().streamLabels.apiVersion) {
    const label = labelOf(value, "resolve: label", drop);
    if (label) out.label = label;
  }
  const media = mediaOf(value.media);
  if (media) out.media = media;
  return out;
}

/**
 * A Stream's `alternatives` as the app keeps them: a bad, repeated or surplus entry is dropped, the rest still count.
 * With [labels] (PluginOutput.STREAM_LABELS_API_VERSION) each may carry a `label`, and an entry with no `url` but a
 * `ref` is a lazy copy `{ ref, label? }`, resolved by the app only when needed.
 */
function alternativesOf(list, url, ok, labels = false, drop = () => {}) {
  if (!Array.isArray(list)) return [];
  const seen = new Set([url]);
  const seenRefs = new Set();
  const out = [];
  for (const [i, a] of list.entries()) {
    if (out.length >= o().maxAlternatives) break;
    if (a === null || typeof a !== "object" || Array.isArray(a)) continue;
    const au = typeof a.url === "string" ? a.url : "";
    if (labels && au === "" && "ref" in a) {
      const ref = lazyRefOf(a.ref);
      if (ref === null) { drop(`resolve: alternative #${i} dropped: invalid ref (a non-blank string of at most ${o().streamLabels.maxRefChars} characters, no control characters)`); continue; }
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
      const label = labelOf(a, `resolve: alternative #${i} label`, drop);
      out.push(label ? { ref, label } : { ref });
      continue;
    }
    if (seen.has(au)) continue;
    seen.add(au);
    if (!ok(au)) continue;
    const mime = typeof a.mime === "string" ? a.mime.trim() : "";
    const copy = { url: au, mime, headers: headersOf(a.headers) };
    if (labels) {
      const label = labelOf(a, `resolve: alternative #${i} label`, drop);
      if (label) copy.label = label;
    }
    out.push(copy);
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** A lazy copy's `ref` (PluginOutput.lazyRefOf): a non-blank string, at most maxRefChars, no control characters; else null. */
function lazyRefOf(ref) {
  if (typeof ref !== "string" || ref.trim() === "" || ref.length > o().streamLabels.maxRefChars || CONTROL.test(ref)) return null;
  return ref;
}

/** An optional `label` (PluginOutput.labelOf): trimmed, at most maxChars, no control characters; anything else dropped with a note. */
function labelOf(obj, what, drop) {
  if (!("label" in obj) || obj.label === null || obj.label === undefined) return "";
  const label = typeof obj.label === "string" ? obj.label.trim() : null;
  if (label === null || label.length > o().streamLabels.maxChars || CONTROL.test(label)) {
    drop(`${what} dropped (a string of at most ${o().streamLabels.maxChars} characters, no control characters)`);
    return "";
  }
  return label;
}

/**
 * The optional `skip` block (the app's PluginOutput.skipOf): `{ openingStartMs?, openingEndMs?, endingStartMs? }` in ms
 * of the file. Never refuses the stream: a bad part is dropped, null when nothing usable is left. Each value a finite
 * number in 0..durationMs (0..maxMs without one); the opening needs its end after its start (a missing start is 0); the
 * ending not before the opening's end.
 */
export function skipOf(raw, durationMs = 0) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const limit = durationMs > 0 ? durationMs : o().skip.maxMs;
  const ms = (k) => {
    if (!(k in raw) || raw[k] === null) return null;
    const n = raw[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > limit) return null;
    return Math.round(n);
  };
  const start = ms("openingStartMs");
  const end = ms("openingEndMs");
  // Left out or null: the opening starts at 0. Present but invalid: the opening is dropped (never silently 0).
  const startOk = start !== null || !("openingStartMs" in raw) || raw.openingStartMs === null;
  const opening = end !== null && startOk && end > (start ?? 0) ? [start ?? 0, end] : null;
  let ending = ms("endingStartMs");
  if (ending !== null && opening && ending < opening[1]) ending = null;
  if (!opening && ending === null) return null;
  return { openingStartMs: opening ? opening[0] : null, openingEndMs: opening ? opening[1] : null, endingStartMs: ending };
}

/** The stream URL rule (the app's PluginOutput.checkUrl): a typed server, or the scheme rule and a declared host. */
function urlChecker(manifest, servers) {
  return (url, what) => {
    let u;
    try { u = new URL(String(url)); } catch { throw new Error(`${what} has an invalid address`); }
    if (servers.some((s) => sameServer(s, u))) return;
    if (!schemeAllowed(u, manifest)) throw new Error(`${what} must use https`);
    if (!hostMatches(u.hostname, manifest.hosts)) throw new Error(`${what} points to ${u.hostname}, which the plugin didn't declare`);
  };
}

const live = () => contract.live;

/** HostRules.isPublicIpv4Literal: a canonical dotted IPv4 outside every private, local and reserved range. */
export function isPublicIpv4Literal(host) {
  const parts = String(host).split(".");
  if (parts.length !== 4) return false;
  const b = parts.map((p) => (/^\d+$/.test(p) && Number(p) <= 255 && String(Number(p)) === p ? Number(p) : -1));
  if (b.includes(-1)) return false;
  if (b[0] === 0 || b[0] === 10 || b[0] === 127 || b[0] >= 224) return false;
  if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return false;
  if (b[0] === 169 && b[1] === 254) return false;
  if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return false;
  if (b[0] === 192 && b[1] === 168) return false;
  if (b[0] === 192 && b[1] === 0 && (b[2] === 0 || b[2] === 2)) return false;
  if (b[0] === 198 && (b[1] === 18 || b[1] === 19)) return false;
  return true;
}

/**
 * The playlist and XMLTV download rule (strict, never `liveStreamHosts: "any"`): a server the person
 * typed, or the scheme rule and a declared host. Every redirect hop is judged the same way.
 */
export function playlistUrlAllowed(manifest, servers = []) {
  const check = urlChecker(manifest, servers);
  return (url) => { try { check(url, ""); return true; } catch { return false; } };
}

/**
 * A live channel's own stream URL (PluginOutput.checkUrl with anyPublicLiveHost): the strict rule,
 * or, with `liveStreamHosts: "any"`, any public host over http(s), never a local one and never
 * another port or scheme of a server the person typed.
 */
export function liveStreamUrlAllowed(manifest, servers = []) {
  const strict = playlistUrlAllowed(manifest, servers);
  const typedNames = servers.map((s) => { try { return new URL(s).hostname; } catch { return null; } });
  return (url) => {
    if (strict(url)) return true;
    if (!manifest.liveStreamHostsAny && !manifest.streamHostsAny) return false;
    let u;
    try { u = new URL(String(url)); } catch { return false; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (typedNames.includes(u.hostname)) return false;
    return isPublicIpv4Literal(u.hostname) || !isLocalAddress(u.hostname);
  };
}

/**
 * Whether a hand-written plugin's `kino.fetch` may reach any public host (the app's InstalledRecord.fetchFromAnyHost
 * once the person approved the red line): `fetchHosts: "any"` at apiVersion manifest.fetchHosts.handWrittenApiVersion
 * (9, Kino 0.9.55) or later. Takes the raw manifest or validateManifest's (with `fetchHostsAny`).
 */
export function fetchAnyHost(manifest) {
  const asks = manifest.fetchHostsAny === true || (manifest.fetchHostsAny === undefined && manifest.fetchHosts === contract.manifest.fetchHosts.value);
  return asks && manifest.apiVersion >= contract.manifest.fetchHosts.handWrittenApiVersion;
}

/**
 * PluginHostGate.anyFetchRefusal: why a host reached ONLY through fetchHosts "any" (contract.fetch.anyHost) may not be
 * requested at [u] (a URL), or null when it may: https on port 443, to a public IPv4 literal or a dotted public name,
 * never the home network. The messages are the app's.
 */
export function anyFetchRefusal(u) {
  const rule = contract.fetch.anyHost;
  const host = u.hostname;
  if (!rule.schemes.includes(u.protocol.replace(/:$/, ""))) return `only https is allowed for a host reached through fetchHosts "any": ${host.slice(0, 200)}`;
  if (Number(u.port || 443) !== rule.port) return `only the default https port (${rule.port}) is allowed for a host reached through fetchHosts "any": ${host.slice(0, 200)}`;
  if (isPublicIpv4Literal(host)) return null;
  if (isLocalAddress(host)) return "host not allowed: " + host.slice(0, 200);
  if (!host.replace(/\.+$/, "").includes(".")) return `a single-label name is never reached through fetchHosts "any": ${host.slice(0, 200)}`;
  return null;
}

/**
 * The site a fetchHosts "any" budget counts [host] under. The app uses the public suffix list (OkHttp's
 * topPrivateDomain); the kit approximates it with the last two labels, or three under a short second-level label of a
 * two-letter country code ("example.co.uk", "example.com.br"). An IPv4 literal is its own site.
 */
export function budgetSite(host) {
  const h = String(host).toLowerCase().replace(/\.+$/, "");
  if (isPublicIpv4Literal(h)) return h;
  const labels = h.split(".");
  const n = labels.length >= 3 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
  return labels.slice(-n).join(".");
}

/**
 * AnyHostFetchBudget: token buckets (capacity = the limit, refilled continuously over its window) per site and for the
 * whole plugin, read with [now]. take(host) answers null when the request may go out, else the app's rate_limited message.
 * Known differences from the app: always the hand-written numbers (perSite/perPlugin; a converted Nuvio scraper's larger
 * nuvioPerSite/nuvioPerPlugin never apply here), and [budgetSite]'s grouping is stricter than the public suffix list.
 */
export function anyHostBudget(now = Date.now) {
  const rule = contract.fetch.anyHost;
  const bucket = (capacity, windowMs) => {
    const all = new Map();
    const level = (key, t) => {
      const b = all.get(key);
      return b ? Math.min(capacity, b.tokens + Math.max(0, t - b.at) * capacity / windowMs) : capacity;
    };
    return {
      has: (key, t) => level(key, t) >= 1,
      take: (key, t) => all.set(key, { tokens: level(key, t) - 1, at: t }),
    };
  };
  const plugin = bucket(rule.perPlugin, rule.perPluginWindowMs);
  const sites = bucket(rule.perSite, rule.perSiteWindowMs);
  return {
    // Both checked before either is spent: a refused request costs nothing.
    take(host) {
      const t = now();
      const site = budgetSite(host);
      if (!plugin.has("plugin", t)) return `too many requests to hosts reached through fetchHosts "any" (at most ${rule.perPlugin} every ${rule.perPluginWindowMs / 60000} minutes); wait a moment`;
      if (!sites.has(site, t)) return `too many requests to ${site.slice(0, 100)} through fetchHosts "any" (at most ${rule.perSite} a minute to one site); wait a moment`;
      plugin.take("plugin", t);
      sites.take(site, t);
      return null;
    },
  };
}

/** A `{ playlist: {...} }` declaration, read as PluginOutput.playlistOf: null (dropped) when it can't be used. */
function playlistOf(p, { manifest, servers }, drop) {
  const allows = (url) => { try { urlChecker(manifest, servers)(url, ""); return true; } catch { return false; } };
  const url = typeof p.url === "string" ? p.url : "";
  if (!live().playlistFormats.includes(p.format)) { drop("playlist: unknown format"); return null; }
  // Strict on purpose: the list and its guide are downloaded by the app, never under liveStreamHosts "any".
  if (!allows(url)) { drop(`playlist: ${url.slice(0, 100)} is not a declared host`); return null; }
  let epgUrl = "";
  if (p.epg !== null && typeof p.epg === "object" && !Array.isArray(p.epg) && live().epgFormats.includes(p.epg.format)) {
    const e = typeof p.epg.url === "string" ? p.epg.url : "";
    if (allows(e)) epgUrl = e; else drop("playlist: epg host not declared, guide dropped");
  }
  const h = typeof p.refreshHours === "number" ? Math.trunc(p.refreshHours) : NaN;
  const refreshHours = h >= live().minRefreshHours && h <= live().maxRefreshHours ? h : live().defaultRefreshHours;
  const hideGroups = [...new Set((Array.isArray(p.hideGroups) ? p.hideGroups : []).slice(0, live().maxHideGroups)
    .map((g) => (typeof g === "string" ? g.trim().toLowerCase().slice(0, 100) : "")).filter(Boolean))];
  return { url, headers: headersOf(p.headers), epgUrl, refreshHours, hideGroups, resolve: p.resolve === true, streamHeaders: headersOf(p.streamHeaders), genre: genreOf(p.genre) };
}

/** liveCategories(), read as PluginOutput.liveCategories: `{ categories, playlists }`. */
function liveCategories(value, ctx, drop) {
  let list = value;
  if (!Array.isArray(value)) {
    if (value !== null && typeof value === "object" && "playlist" in value) list = [value];
    else { drop("liveCategories: the answer is not a JSON array"); return { categories: [], playlists: [] }; }
  }
  const categories = [];
  const playlists = [];
  const seen = new Set();
  list.forEach((c, i) => {
    if (c === null || typeof c !== "object" || Array.isArray(c)) return;
    if ("playlist" in c) {
      if (c.playlist === null || typeof c.playlist !== "object" || Array.isArray(c.playlist)) return drop(`liveCategories: #${i} playlist is not an object`);
      if (playlists.length >= live().maxPlaylists) return drop(`liveCategories: playlists beyond ${live().maxPlaylists} dropped`);
      const p = playlistOf(c.playlist, ctx, drop);
      if (p) playlists.push(p);
      return;
    }
    if (categories.length >= live().maxCategories) return drop(`liveCategories: beyond ${live().maxCategories} dropped`);
    // optString in the app: a numeric id is its text.
    const id = typeof c.id === "number" ? String(c.id) : typeof c.id === "string" ? c.id : "";
    if (!re(o().itemIdPattern).test(id)) return drop(`liveCategories: #${i} has an invalid id`);
    const title = text(c.title, o().maxTitleChars);
    if (!title) return drop(`liveCategories: ${id} has no title`);
    const adult = c.adult === true;
    if (adult && !ctx.allowAdult) return drop(`liveCategories: ${id} adult, dropped`);
    if (seen.has(id)) return drop(`liveCategories: duplicate ${id} dropped`);
    seen.add(id);
    const cc = typeof c.country === "string" ? c.country.trim().toUpperCase() : "";
    categories.push({ id, title, country: /^[A-Z]{2}$/.test(cc) ? cc : "", genre: genreOf(c.genre), ...(adult ? { adult: true } : {}) });
  });
  return { categories, playlists };
}

/** liveChannels(), read as PluginOutput.liveChannels. Every channel carries `ref` ("" when absent) and `stream` (null when absent). */
function liveChannels(value, ctx, drop) {
  let list = value;
  let next = null;
  if (!Array.isArray(value)) {
    if (value === null || typeof value !== "object" || !Array.isArray(value.items)) { drop("liveChannels: the answer is not a list or a page"); return { items: [], next: null }; }
    list = value.items;
    next = typeof value.next === "string" && value.next ? value.next : null;
    if (next && next.length > o().maxCursorChars) { drop(`page: next longer than ${o().maxCursorChars} dropped`); next = null; }
  }
  const out = [];
  const seen = new Set();
  list.forEach((c, i) => {
    if (out.length >= live().maxChannelsPerPage) { drop(`liveChannels: beyond ${live().maxChannelsPerPage} dropped`); return; }
    if (c === null || typeof c !== "object") return;
    // optString in the app: a numeric id is its text.
    const id = typeof c.id === "number" ? String(c.id) : typeof c.id === "string" ? c.id : "";
    if (!re(o().itemIdPattern).test(id)) return drop(`liveChannels: #${i} has an invalid id`);
    if (id.startsWith(live().reservedIdPrefix)) return drop(`liveChannels: ${id} uses a reserved id`);
    const title = text(c.title, o().maxTitleChars);
    if (!title) return drop(`liveChannels: ${id} has no title`);
    const adult = c.adult === true;
    if (adult && !ctx.allowAdult) return drop(`liveChannels: ${id} adult, dropped`);
    const ref = typeof c.ref === "string" ? c.ref : "";
    if (ref.length > o().maxRefChars) return drop(`liveChannels: ${id} has an invalid ref`);
    let checked = null;
    if (c.stream !== null && typeof c.stream === "object" && !Array.isArray(c.stream)) {
      try { checked = stream(c.stream, { ...ctx, liveChannel: true, inline: true }); } catch (e) {
        // Signed and with a ref: that ref is how it plays (resolve() may sign), as in the app.
        if (!(ref && e.message === SIGNED_CHANNEL)) return drop(`liveChannels: ${id} stream refused: ${e.message}`);
        drop(`liveChannels: ${id} inline stream is signed: it plays through resolve(ref)`);
      }
    }
    if (!ref && !checked) return drop(`liveChannels: ${id} has neither a ref nor a stream`);
    if (seen.has(id)) return drop(`liveChannels: duplicate ${id} dropped`);
    seen.add(id);
    const number = Number.isInteger(c.number) && c.number >= 1 && c.number <= live().maxChannelNumber ? c.number : 0;
    const categoryId = typeof c.categoryId === "string" && re(o().itemIdPattern).test(c.categoryId) ? c.categoryId : "";
    // A liveSearch hit's own `adult: false` says it is plain (markSearchHits); a listing never needs it.
    const plain = ctx.search && c.adult === false;
    out.push({ id, title, ref, logo: image(c.logo, ctx.servers), number, categoryId, stream: checked, ...(adult ? { adult: true } : plain ? { adult: false } : {}) });
  });
  return { items: out, next };
}

/**
 * Whether a checked liveSearch [hit] counts as 18+ in the app (PluginLiveProvider.searchHitAdult), given the plugin's
 * checked liveCategories [categories] (null = they can't be read). `adult: true` or the categoryId of an 18+ category:
 * 18+; the categoryId of a plain category or `adult: false`: plain; neither: 18+ when the plugin has any 18+ category;
 * categories unreadable: 18+ unless `adult: false`. Below apiVersion 6 nothing is.
 */
export function searchHitAdult(hit, categories, manifest) {
  if (hit.adult === true) return true;
  if (!(Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= live().adultApiVersion)) return false;
  if (categories == null) return hit.adult !== false;
  const known = categories.find((c) => c.id === hit.categoryId);
  if (known) return known.adult === true;
  return categories.some((c) => c.adult === true) && hit.adult !== false;
}

/**
 * A checked liveSearch answer as the app keeps it: each hit that counts as 18+ ([searchHitAdult]) marked `adult: true`.
 * `unmarked` names the hits that count as 18+ only for carrying neither `adult` nor a known categoryId (worth a warning);
 * `unreadable` is true when [categories] is null.
 */
export function markSearchHits(value, categories, manifest) {
  const unmarked = [];
  const items = value.items.map((h) => {
    const adult = searchHitAdult(h, categories, manifest);
    if (adult && h.adult !== true && !(categories || []).some((c) => c.id === h.categoryId && c.adult === true)) unmarked.push(h.title);
    const { adult: _drop, ...rest } = h;
    return adult ? { ...rest, adult: true } : rest;
  });
  return { value: { ...value, items }, unmarked, unreadable: categories == null };
}

/**
 * guide(), read as PluginOutput.guide -- except the requested-ids and time-window filters, which
 * need the call's arguments: the kit checks shape and limits only.
 */
function guide(value, drop) {
  if (!Array.isArray(value)) { drop("guide: the answer is not a JSON array"); return []; }
  const per = new Map();
  value.forEach((g, i) => {
    if (g === null || typeof g !== "object") return;
    const channelId = typeof g.channelId === "string" ? g.channelId : "";
    const title = text(g.title, o().maxTitleChars);
    if (!channelId || !title) return drop(`guide: #${i} has no channel or title`);
    if (!Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start) return drop(`guide: #${i} has an invalid start/end`);
    const list = per.get(channelId) || [];
    if (list.length >= live().maxGuideEntriesPerChannel) return drop(`guide: ${channelId} beyond ${live().maxGuideEntriesPerChannel} dropped`);
    if (list.some((e) => e.start === Math.trunc(g.start))) return;
    list.push({ channelId, title, start: Math.trunc(g.start), end: Math.trunc(g.end), description: text(g.description, o().maxTextChars) });
    per.set(channelId, list);
  });
  return [...per.values()].flatMap((l) => l.sort((a, b) => a.start - b.start));
}

// ---------- meta (apiVersion 6): the app's TitleMetaOutput.parse ----------
// The answer crosses from the engine as JSON and Kotlin reads it with org.json, so a number is an Integer/Long when its
// JSON has no ".", "e" or "E" and fits a long, a Double otherwise; the helpers below read values that way.

const MAX_LONG = 9223372036854775807n;

/** Java's Double.toString of [d] (finite): "8.5", "1.0E21", "1.0E-5", "100.0". */
export function javaDouble(d) {
  if (d === 0) return Object.is(d, -0) ? "-0.0" : "0.0";
  const a = Math.abs(d);
  if (a >= 1e-3 && a < 1e7) {
    const s = String(d);
    return s.includes(".") ? s : `${s}.0`;
  }
  const [m, e] = d.toExponential().split("e");
  return `${m.includes(".") ? m : `${m}.0`}E${Number(e)}`;
}

/** A JSON number as org.json holds it: `{ integer: true, text }` (Integer/Long) or `{ integer: false, text }` (Double). */
function jsonNumber(n) {
  const json = JSON.stringify(n);
  if (!/[.eE]/.test(json) && BigInt(json) <= MAX_LONG && BigInt(json) >= -MAX_LONG - 1n) return { integer: true, text: json };
  return { integer: false, text: javaDouble(n) };
}

/** TitleMetaOutput.parse's `text()`: a string, or a number as Kotlin prints it, trimmed and cut at [max]. */
function metaText(v, max) {
  const raw = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? jsonNumber(v).text : "";
  const t = raw.trim();
  return { value: t.slice(0, max), cut: t.length > max, kind: typeof v === "string" ? "string" : typeof v === "number" ? "number" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v };
}

/** Java's Double.parseDouble on [s], or NaN when it throws (hex floats aside). */
function javaParseDouble(s) {
  const t = s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  if (!/^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?)$/.test(t)) return NaN;
  return Number(t.replace(/[fFdD]$/, ""));
}

/** Java's `(int)` of a double: truncated, NaN is 0, saturated at the int range. */
const javaInt = (d) => (Number.isNaN(d) ? 0 : d >= 2147483647 ? 2147483647 : d <= -2147483648 ? -2147483648 : Math.trunc(d));

/**
 * Android org.json's `optInt(key, fallback)` on [v]: an integer number as an int (a long one wraps, as Long.intValue
 * does), a decimal one truncated, a numeric string parsed (`"90"`, `" 1.9 "`); anything else is [fallback].
 */
export function optInt(v, fallback) {
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = jsonNumber(v);
    return n.integer ? Number(BigInt.asIntN(32, BigInt(n.text))) : javaInt(v);
  }
  if (typeof v === "string") {
    const d = javaParseDouble(v);
    return Number.isNaN(d) && !/^\s*[+-]?NaN\s*$/.test(v) ? fallback : javaInt(d);
  }
  return fallback;
}

/** A rating's value as Kotlin reads it: a number as written without trailing zeros, or a string trimmed; else null. */
function ratingValue(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  // v.toDouble().toString(), then BigDecimal(that).stripTrailingZeros().toPlainString().
  const [mant, exp = "0"] = javaDouble(v).split("E");
  const [int, frac = ""] = mant.split(".");
  let digits = (int + frac).replace(/^0+/, "");
  let scale = frac.length - Number(exp);
  if (!digits) return "0";
  while (digits.length > 1 && digits.endsWith("0")) { digits = digits.slice(0, -1); scale--; }
  if (scale <= 0) return digits + "0".repeat(-scale);
  if (digits.length > scale) return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  return `0.${"0".repeat(scale - digits.length)}${digits}`;
}

const metaRules = () => o().meta;
/** "a string", "an object", "null": what a value is, for a verdict. */
const aKind = (kind) => (kind === "null" ? "null" : /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const META_KNOWN = ["title", "overview", "poster", "backdrop", "year", "genres", "runtimeMinutes", "episodes", "logo", "ratings", "cast"];
const short = (v, max = 60) => { const s = JSON.stringify(v) ?? String(v); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/**
 * What the app keeps of a `meta` answer (TitleMetaOutput.parse) and why, field by field:
 * `{ value, drops, fields, noAnswer }`. `value` is the TitleMeta Kino builds (blanks are "not known"), or null when
 * the app treats the answer as none (`noAnswer` says why). `fields`: one `{ field, status, detail, items? }` per known
 * field and per unknown one, `status` one of kept, cut, partly kept, dropped, absent, ignored. `drops` are the
 * one-line reasons, for the kit's `[dropped by Kino]` lines.
 */
export function metaAnswer(value, servers = []) {
  const m = metaRules();
  const fields = [];
  const drops = [];
  const note = (field, status, detail, items) => {
    fields.push(items ? { field, status, detail, items } : { field, status, detail });
    if (items) items.forEach((i) => drops.push(`meta: ${field} ${i}`));
    else if (status === "dropped" || status === "cut") drops.push(`meta: ${field} ${status}: ${detail}`);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const noAnswer = value === null ? "the plugin answered null: not a title it knows" : `the answer is ${Array.isArray(value) ? "an array" : aKind(typeof value)}, not an object: Kino reads it as no answer`;
    return { value: null, drops, fields, noAnswer };
  }
  const absent = (k) => !(k in value) || value[k] === undefined;
  const textField = (k, max, extra = "") => {
    if (absent(k)) { note(k, "absent", "not given"); return ""; }
    const t = metaText(value[k], max);
    if (t.kind !== "string" && t.kind !== "number") { note(k, "dropped", `${aKind(t.kind)}, not text: Kino reads ""`); return ""; }
    if (!t.value) { note(k, "dropped", "empty"); return ""; }
    if (t.cut) note(k, "cut", `cut to ${max} characters${extra}`);
    else note(k, "kept", `${plural(t.value.length, "character", "characters")}${t.kind === "number" ? " (a number, read as text)" : ""}${extra}`);
    return t.value;
  };
  /** TitleMetaOutput's image(): the value read whole as text, then PluginOutput.imageUrl (which drops one past maxImageUrlChars). */
  const imageOf = (obj, k) => {
    const t = metaText(obj[k], Number.MAX_SAFE_INTEGER);
    const r = imageVerdict(t.value, servers);
    return { ...r, kind: t.kind };
  };
  const imageField = (k, extra = "") => {
    if (absent(k)) { note(k, "absent", "not given"); return ""; }
    const r = imageOf(value, k);
    if (r.kind !== "string" && r.kind !== "number") { note(k, "dropped", `${aKind(r.kind)}, not a URL`); return ""; }
    if (!r.url) { note(k, "dropped", r.why); return ""; }
    note(k, "kept", `${r.url} (${r.why})${extra}`);
    return r.url;
  };

  const title = textField("title", o().maxTitleChars, "; the page keeps the source's own title, this one is not shown");
  const overview = textField("overview", o().maxTextChars, "; shown as the synopsis when TMDB and AniList have none (HTML tags stripped)");
  const poster = imageField("poster", "; used when the page has no poster");
  const backdrop = imageField("backdrop", "; used when the page has no background");

  let year = "";
  if (absent("year")) note("year", "absent", "not given");
  else {
    const t = metaText(value.year, m.yearReadChars);
    const found = t.value.match(new RegExp(m.yearPattern));
    year = found ? found[0] : "";
    if (t.kind !== "string" && t.kind !== "number") note("year", "dropped", `${aKind(t.kind)}, not a year`);
    else if (!year) note("year", "dropped", `no four digits in its first ${m.yearReadChars} characters (${short(t.value)})`);
    else note("year", "kept", `${year}${String(value.year).trim() !== year ? ` (read from ${short(value.year)})` : ""}`);
  }

  let genres = [];
  if (absent("genres")) note("genres", "absent", "not given");
  else if (!Array.isArray(value.genres)) note("genres", "dropped", `${aKind(metaText(value.genres, 1).kind)}, not a list`);
  else {
    const items = [];
    for (const [i, g] of value.genres.entries()) {
      // Strings only (a number is not a genre), trimmed and cut, empty ones skipped; NOT de-duplicated (the app keeps repeats).
      if (typeof g !== "string") { items.push(`#${i} ${short(g)}: not a string`); continue; }
      const s = g.trim().slice(0, o().maxGenreChars);
      if (!s) { items.push(`#${i}: empty`); continue; }
      if (genres.length >= o().maxGenres) { items.push(`#${i} ${short(s)}: beyond ${o().maxGenres}`); continue; }
      if (g.trim().length > o().maxGenreChars) items.push(`#${i}: cut to ${o().maxGenreChars} characters`);
      genres.push(s);
    }
    const lost = value.genres.length - genres.length;
    note("genres", !genres.length ? "dropped" : lost || items.length ? "partly kept" : "kept", `${genres.length} of ${value.genres.length}${genres.length ? `: ${genres.join(", ")}` : ""}`, items.length ? items : undefined);
  }

  let runtimeMinutes = 0;
  if (absent("runtimeMinutes")) note("runtimeMinutes", "absent", "not given");
  else {
    const n = optInt(value.runtimeMinutes, 0);
    runtimeMinutes = n >= o().minRuntimeMinutes && n <= o().maxRuntimeMinutes ? n : 0;
    if (!runtimeMinutes) note("runtimeMinutes", "dropped", `${short(value.runtimeMinutes)} is not ${o().minRuntimeMinutes}..${o().maxRuntimeMinutes} minutes`);
    else note("runtimeMinutes", "kept", `${n}${n !== value.runtimeMinutes ? ` (read from ${short(value.runtimeMinutes)})` : ""}; shown only for a movie (a series' runtime is per episode)`);
  }

  let episodes = [];
  if (absent("episodes")) note("episodes", "absent", "not given");
  else if (!Array.isArray(value.episodes)) note("episodes", "dropped", `${aKind(metaText(value.episodes, 1).kind)}, not a list`);
  else {
    const items = [];
    const read = Math.min(value.episodes.length, m.maxEpisodes);
    if (value.episodes.length > m.maxEpisodes) items.push(`only the first ${m.maxEpisodes} entries are read (invalid ones count), ${value.episodes.length - m.maxEpisodes} ignored`);
    const seen = new Set();
    for (let i = 0; i < read; i++) {
      const e = value.episodes[i];
      if (e === null || typeof e !== "object" || Array.isArray(e)) { items.push(`#${i}: not an object`); continue; }
      const s = optInt(e.season, -1), n = optInt(e.number, -1);
      if (s < m.minEpisodeSeason || s > o().maxSeasonNumber) { items.push(`#${i}: season ${short(e.season)} is not ${m.minEpisodeSeason}..${o().maxSeasonNumber}`); continue; }
      if (n < 1 || n > o().maxEpisodeNumber) { items.push(`#${i}: number ${short(e.number)} is not 1..${o().maxEpisodeNumber}`); continue; }
      if (seen.has(`${s}x${n}`)) { items.push(`#${i}: S${s}E${n} repeated, the first one stays`); continue; }
      seen.add(`${s}x${n}`);
      const still = e.still === undefined ? { url: "" } : imageOf(e, "still");
      if (e.still !== undefined && !still.url) items.push(`#${i} S${s}E${n}: still dropped (${still.why})`);
      const airText = metaText(e.airDate, 10).value;
      const airDate = re(o().airDatePattern).test(airText) ? airText : "";
      if (e.airDate !== undefined && !airDate) items.push(`#${i} S${s}E${n}: airDate ${short(e.airDate)} is not YYYY-MM-DD`);
      for (const [k, max] of [["title", o().maxTitleChars], ["overview", o().maxTextChars], ["id", o().maxRefChars]]) {
        if (metaText(e[k], max).cut) items.push(`#${i} S${s}E${n}: ${k} cut to ${max} characters`);
      }
      episodes.push({
        season: s, number: n, title: metaText(e.title, o().maxTitleChars).value, overview: metaText(e.overview, o().maxTextChars).value,
        still: still.url, airDate, id: metaText(e.id, o().maxRefChars).value,
      });
    }
    episodes.sort((a, b) => a.season - b.season || a.number - b.number);
    const bad = items.length;
    note("episodes", !episodes.length ? "dropped" : bad ? "partly kept" : "kept", `${episodes.length} of ${value.episodes.length}${episodes.some((e) => e.season === 0) ? " (season 0 kept here, but the page never lists it)" : ""}`, bad ? items : undefined);
  }

  const logo = imageField("logo", "; drawn instead of the title's name at the top of the page (Kino 0.9.51+)");

  let ratings = [];
  if (absent("ratings")) note("ratings", "absent", "not given");
  else if (!Array.isArray(value.ratings)) note("ratings", "dropped", `${aKind(metaText(value.ratings, 1).kind)}, not a list`);
  else {
    const items = [];
    const valid = [];
    value.ratings.forEach((r, i) => {
      if (r === null || typeof r !== "object" || Array.isArray(r)) return items.push(`#${i}: not an object`);
      const source = metaText(r.source, m.maxRatingSourceChars).value.toLowerCase();
      if (!m.ratingSources.includes(source)) return items.push(`#${i}: source ${short(r.source)} is not one of ${m.ratingSources.join(", ")}`);
      const v = ratingValue(r.value);
      if (v === null) return items.push(`#${i} ${source}: value ${short(r.value)} is not a string or a number >= 0`);
      if (!re(m.ratingValuePattern).test(v)) return items.push(`#${i} ${source}: value ${short(v)} is not like "8.8", "94%", "4.1/5" (up to 3 digits, 2 decimals)`);
      if (valid.some((x) => x.source === source)) return items.push(`#${i} ${source}: a second ${source} rating, the first one stays`);
      valid.push({ source, value: v });
    });
    ratings = valid.slice(0, m.maxRatings);
    valid.slice(m.maxRatings).forEach((x) => items.push(`${x.source} ${x.value}: beyond ${m.maxRatings} ratings`));
    note("ratings", !ratings.length ? "dropped" : items.length ? "partly kept" : "kept",
      `${ratings.length} of ${value.ratings.length}${ratings.length ? `: ${ratings.map((x) => `${x.source} ${x.value}`).join(", ")}` : ""}`, items.length ? items : undefined);
  }

  let cast = [];
  if (absent("cast")) note("cast", "absent", "not given");
  else if (!Array.isArray(value.cast)) note("cast", "dropped", `${aKind(metaText(value.cast, 1).kind)}, not a list`);
  else {
    const items = [];
    const valid = [];
    value.cast.forEach((c, i) => {
      if (c === null || typeof c !== "object" || Array.isArray(c)) return items.push(`#${i}: not an object`);
      const name = metaText(c.name, m.maxCastNameChars);
      if (!name.value) return items.push(`#${i}: no name`);
      if (name.cut) items.push(`#${i}: name cut to ${m.maxCastNameChars} characters`);
      const character = metaText(c.character, m.maxCastNameChars);
      if (character.cut) items.push(`#${i} ${name.value}: character cut to ${m.maxCastNameChars} characters`);
      const photo = c.photo === undefined ? { url: "" } : imageOf(c, "photo");
      if (c.photo !== undefined && !photo.url) items.push(`#${i} ${name.value}: photo dropped (${photo.why})`);
      // distinctBy the name as cut: the first one stays.
      if (valid.some((x) => x.name === name.value)) return items.push(`#${i} ${name.value}: repeated name, the first one stays`);
      valid.push({ name: name.value, character: character.value, photo: photo.url });
    });
    cast = valid.slice(0, m.maxCast);
    if (valid.length > m.maxCast) items.push(`${valid.length - m.maxCast} beyond ${m.maxCast} dropped`);
    note("cast", !cast.length ? "dropped" : items.length ? "partly kept" : "kept", `${cast.length} of ${value.cast.length}`, items.length ? items : undefined);
  }

  for (const k of Object.keys(value)) if (!META_KNOWN.includes(k) && value[k] !== undefined) note(k, "ignored", "not a meta field: Kino never reads it");

  const kept = { title, overview, poster, backdrop, year, genres, runtimeMinutes, episodes, logo, ratings, cast };
  const any = m.answerFields.some((k) => (Array.isArray(kept[k]) ? kept[k].length : kept[k]));
  if (!any) {
    const alone = [year && "year", runtimeMinutes && "runtimeMinutes"].filter(Boolean);
    return { value: null, drops, fields, noAnswer: alone.length ? `only ${alone.join(" and ")} survived, and alone they are no answer (Kino needs one of ${m.answerFields.join(", ")})` : "nothing Kino can use survived: no answer" };
  }
  return { value: kept, drops, fields, noAnswer: null };
}

/**
 * What the app would keep of [value], the answer of [fn]: `{ value, drops }` (drops are the log
 * lines the app writes). Throws, with the app's message, when the app would refuse it outright.
 * [servers]: the url settings' values (`--config`), which the app allows like declared hosts.
 */
/**
 * What the app keeps of a migrate() answer for `input` (PluginMigration.parse): the answer, or null
 * when the plugin does not claim the value. A wrong shape is not an error in the app, only "not
 * claimed" plus a log line: here it is a drop, so the author sees why. `allowAudio`: the plugin's apiVersion
 * reaches `audioKindApiVersion`, so a title may be claimed as `music` or `podcast`.
 */
export function migrateAnswer(value, input, allowAudio = false) {
  const drops = [];
  const no = (m) => { drops.push(`migrate: ${m}`); return { value: null, drops }; };
  if (value === null || value === undefined) return { value: null, drops };
  if (typeof value !== "object" || Array.isArray(value)) return no("the answer must be an object or null");
  const ID = re(o().itemIdPattern);
  const refOk = (r) => typeof r === "string" && r.length > 0 && r.length <= o().maxRefChars && !r.startsWith("plg1:");
  const kind = value.kind;
  if (input.kind === "title") {
    const audio = o().audioKinds.includes(kind);
    if (audio && !allowAudio) return no(`a title answered kind "${kind}", which needs apiVersion ${o().audioKindApiVersion}`);
    if (kind !== "movie" && kind !== "series" && !audio) return no(`a title answered kind "${kind}"`);
    if (typeof value.id !== "string" || !ID.test(value.id)) return no("invalid id");
    if (!refOk(value.ref)) return no("invalid ref");
    return { value: { kind, id: value.id, ref: value.ref }, drops };
  }
  if (input.kind === "chapter") {
    if (kind !== "episode") return no(`a chapter answered kind "${kind}"`);
    if (!refOk(value.ref)) return no("invalid ref");
    const number = Number.isInteger(value.number) ? value.number : 0;
    if (number < 1 || number > o().maxEpisodeNumber) return no("invalid number");
    const season = Number.isInteger(value.season) && value.season >= 1 && value.season <= o().maxSeasonNumber ? value.season : 1;
    return { value: { kind, ref: value.ref, season, number }, drops };
  }
  if (input.kind === "live") {
    if (kind !== "live") return no(`a live channel answered kind "${kind}"`);
    if (typeof value.code !== "string" || !ID.test(value.code)) return no("invalid code");
    return { value: { kind, code: value.code }, drops };
  }
  return no(`unknown input kind "${input.kind}"`);
}

/**
 * An action's `clearSettings`, as PluginSettingsUi.parseActionResult: only the plugin's own valued, non-required settings,
 * once each, read up to `max` entries. Anything else is dropped with one line, never an error (the action succeeded).
 */
function clearSettingsOf(raw, settings, max, drop) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { drop("action answered clearSettings that is not an array"); return []; }
  const clearable = new Set(settings.filter((s) => contract.settings.types[s.type]?.hasValue !== false && s.required !== true).map((s) => s.key));
  const out = [];
  let dropped = raw.length > max;
  for (const k of raw.slice(0, max)) {
    if (typeof k === "string" && clearable.has(k) && !out.includes(k)) out.push(k);
    else dropped = true;
  }
  if (dropped) drop("action answered clearSettings entries that cannot be cleared; they were ignored");
  return out;
}

/**
 * What the app keeps of a settings-form export's answer (apiVersion 6), as PluginSettingsUi reads it:
 * `settingsStatus` -> { [statusKey]: text }, `action` -> { message, refresh, clearSettings, link?, setSettings? }, `validateSettings` ->
 * { accepted: true } or { accepted: false, fieldErrors, general }. Garbage is dropped, never thrown,
 * except where the app refuses to save (validateSettings answering something that is not null, a text
 * or an object). `scrub` (the app's secret scrubbing) runs on each kept text before it is clipped.
 */
/**
 * The app's PluginSettingsUi.qrText: a settings `qr`'s text (apiVersion 13), or null. A string of 1 to
 * contract.qr.settingsQr.maxChars characters once trimmed, no control character; an http(s) address only by the panel
 * qr's rule (qrUrl); a text the secret scrub would change is dropped whole.
 */
export function settingsQrText(raw, scrub = (t) => t) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  // Kotlin's Char.isISOControl: U+0000..U+001F and U+007F..U+009F.
  if (!v || v.length > contract.qr.settingsQr.maxChars || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return null;
  const lower = v.toLowerCase();
  if ((lower.startsWith("http:") || lower.startsWith("https:")) && qrUrl(v) === null) return null;
  return scrub(v) === v ? v : null;
}

/**
 * An action answer's `link` (additive action.link), as PluginSettingsUi.linkOf: null when Kino cannot use it, with one drop
 * line. Only ANOTHER declared action than `actionKey` (the one that answered) may confirm it; the candidate is never clipped.
 */
function linkOf(raw, settings, actionKey, scrub, drop) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(raw)) { drop("action answered a link that is not an object; it was ignored"); return null; }
  // Never the action that answered, and never one with its own confirm question (a destructive action passed off as "Is this you?").
  const targets = new Set(settings.filter((s) => s.type === "action" && s.key !== actionKey && !s.confirm && !s.confirmEn).map((s) => s.key));
  if (typeof raw.confirm !== "string" || !targets.has(raw.confirm)) { drop("action answered a link whose confirm is not another declared action; it was ignored"); return null; }
  const max = contract.settings.ui.link.candidateMaxChars;
  // As the app refuses them: control characters, invisible formatting (bidi overrides, zero-width), line/paragraph separators,
  // any space but the ASCII one, and the fillers that draw nothing (Hangul U+115F, U+1160, U+3164, U+FFA0; blank Braille U+2800).
  const unsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]|(?! )\p{Zs}/u;
  const collapse = (t) => t.replace(/ {2,}/g, " ");
  const c = typeof raw.candidate === "string" ? collapse(raw.candidate.trim()) : "";
  const shown = c && c.length <= max && !unsafe.test(c) ? collapse(scrub(c).trim()) : "";
  if (!shown || shown.length > max || unsafe.test(shown)) { drop("action answered a link with an unusable candidate; it was ignored"); return null; }
  return { candidate: shown, confirm: raw.confirm };
}

/** PluginSettingsUi.settableTypes: the setting types an action's setSettings may fill at [apiVersion] (a password from passwordApiVersion). */
export function settableTypes(apiVersion) {
  const rule = contract.settings.ui.setSettings;
  return rule.types.filter((t) => t !== "url" && (t !== "password" || apiVersion >= rule.passwordApiVersion));
}

/**
 * SettingLocks.refusesPluginWrite: whether a plugin's own write of [wanted] to setting [s] (its manifest entry) is refused by its
 * `unlockWith`: anything but its default (a toggle without one starts off, a select at its first option).
 */
export function lockRefuses(s, wanted) {
  if (!s || s.unlockWith === undefined || s.unlockWith === null) return false;
  const def = s.default !== undefined && s.default !== null ? s.default
    : s.type === "toggle" ? false : s.type === "select" && Array.isArray(s.options) && s.options[0] ? s.options[0].value : null;
  return wanted !== def;
}

/**
 * An action answer's `setSettings` (additive action.setSettings), as PluginSettingsUi.setValues: the kept values, or null when
 * Kino refuses the whole field (one drop line). Only the plugin's own text/select settings and, from apiVersion 13, its
 * passwords (never a url); a value the scrub would change holds a secret and is refused.
 */
function setSettingsOf(raw, settings, cleared, scrub, drop, apiVersion) {
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const rule = contract.settings.ui.setSettings;
  if (!isObj(raw)) { drop("action answered setSettings that is not an object; nothing was set"); return null; }
  const keys = Object.keys(raw);
  if (keys.length > rule.maxEntries) { drop(`action answered more than ${rule.maxEntries} setSettings; nothing was set`); return null; }
  const out = {};
  const types = settableTypes(apiVersion);
  for (const k of keys) {
    // Never a url (its value would become a server the plugin may reach); a password only from passwordApiVersion.
    const s = settings.find((x) => x.key === k && types.includes(x.type));
    const v = typeof raw[k] === "string" ? raw[k].trim() : null;
    const type = s && contract.settings.types[s.type];
    // A locked select (unlockWith) moves away from its default only by the person, after the code (SettingLocks).
    const fits = s && v !== null && !cleared.includes(k) && !(s.required === true && !v) && !lockRefuses(s, v) &&
      (s.type === "select" ? (s.options || []).some((o) => o.value === v)
        : v.length <= type.maxChars && (s.type !== "url" || !v || isUserServer(v))) &&
      scrub(v) === v;
    if (!fits) { drop("action answered setSettings Kino cannot apply; nothing was set"); return null; }
    out[k] = v;
  }
  return out;
}

/**
 * The password values an action answer's setSettings names (kept or not), longest first: PluginSettingsUi.passwordsIn.
 * They are secrets from then on, so the action's message and link are scrubbed of them.
 */
function setPasswordsIn(raw, settings, apiVersion) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !settableTypes(apiVersion).includes("password")) return [];
  return Object.keys(raw).filter((k) => settings.some((x) => x.key === k && x.type === "password"))
    .map((k) => (typeof raw[k] === "string" ? raw[k].trim() : "")).filter((v) => v).sort((a, b) => b.length - a.length);
}

/** [scrub], then each of [values] removed until none is left; a text still holding one after 8 rounds is dropped. */
function withoutValues(scrub, values) {
  if (!values.length) return scrub;
  return (t) => {
    let out = scrub(t);
    for (let i = 0; i < 8 && values.some((v) => out.includes(v)); i++) for (const v of values) out = out.split(v).join("");
    return values.some((v) => out.includes(v)) ? "" : out;
  };
}

/**
 * An action's checked answer with the password values of its setSettings masked, for printing: the kit never shows a
 * value Kino would store as a password (Kino never logs one).
 */
export function maskSetPasswords(out, manifest) {
  if (!out || typeof out !== "object" || !out.setSettings) return out;
  const pw = new Set((manifest.settings || []).filter((s) => s.type === "password").map((s) => s.key));
  return { ...out, setSettings: Object.fromEntries(Object.entries(out.setSettings).map(([k, v]) => [k, pw.has(k) ? "••••••••" : v])) };
}

/**
 * PluginSettingsUi.parseStatusAnswer's `hide` (apiVersion 13): the keys of [manifest]'s own settings, among the answer's first
 * contract.settings.ui.statusHide.maxEntries entries, that the form does not draw while this answer is current. [] below 13,
 * for a non-array, and for unknown keys or non-strings (dropped).
 */
export function statusHide(value, manifest) {
  const rule = contract.settings.ui.statusHide;
  // G5: at the settings list's apiVersion (an enhancement's list: its key).
  if (settingsApiVersion(manifest) < rule.apiVersion || value === null || typeof value !== "object" || !Array.isArray(value.hide)) return [];
  const known = new Set((manifest.settings || []).map((s) => s.key));
  return [...new Set(value.hide.slice(0, rule.maxEntries).filter((k) => typeof k === "string" && known.has(k)))];
}

export function checkSettingsOutput(fn, value, manifest, scrub = (t) => t, drop = () => {}, actionKey = null) {
  const ui = contract.settings.ui;
  const clip = (t, max) => (t.length <= max ? t : t.slice(0, max - 1) + "…");
  const text = (v, max) => {
    if (typeof v !== "string" || !v.trim()) return null;
    const t = scrub(v.trim()).trim();
    return t ? clip(t, max) : null;
  };
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const settings = manifest.settings || [];
  if (fn === "settingsStatus") {
    const out = {};
    for (const s of settings.filter((x) => x.type === "status")) {
      const t = isObj(value) ? text(value[s.key], ui.statusMaxChars) : null;
      if (t) out[s.key] = t;
    }
    // apiVersion 13: a qr setting's text, kept whole or not at all (PluginSettingsUi.qrText).
    for (const s of settings.filter((x) => x.type === "qr")) {
      const raw = isObj(value) ? value[s.key] : undefined;
      const t = settingsQrText(raw, scrub);
      if (t !== null) out[s.key] = t;
      else if (raw !== undefined && raw !== null) drop(`settingsStatus answered a qr text Kino does not draw ("${s.key}")`);
    }
    return out;
  }
  if (fn === "action") {
    // G5: a password from apiVersion 13 of the settings list in effect (an enhancement's list: its key).
    const api = settingsApiVersion(manifest);
    // A password the answer fills (or tried to) is a secret from now on: never echoed in the message or a link.
    const shown = withoutValues(scrub, isObj(value) ? setPasswordsIn(value.setSettings, settings, api) : []);
    const shownText = (v, max) => {
      if (typeof v !== "string" || !v.trim()) return null;
      const t = shown(v.trim()).trim();
      return t ? clip(t, max) : null;
    };
    const out = {
      message: isObj(value) ? shownText(value.message, ui.messageMaxChars) : null,
      refresh: isObj(value) && value.refresh === true,
      clearSettings: isObj(value) ? clearSettingsOf(value.clearSettings, settings, ui.clearSettings.maxEntries, drop) : [],
    };
    // Only when the answer carried one, so an answer without it keeps its shape: null means Kino refuses it (generic error).
    if (isObj(value) && value.link !== undefined && value.link !== null) out.link = linkOf(value.link, settings, actionKey, shown, drop);
    if (isObj(value) && value.setSettings !== undefined && value.setSettings !== null) out.setSettings = setSettingsOf(value.setSettings, settings, out.clearSettings, scrub, drop, api);
    return out;
  }
  if (value === null || value === undefined) return { accepted: true };
  if (typeof value === "string") {
    const t = text(value, ui.fieldErrorMaxChars);
    return t ? { accepted: false, fieldErrors: {}, general: t } : { accepted: true };
  }
  if (!isObj(value)) throw new Error("validateSettings must return null, a string or an object { key: message }: Kino can't read this answer");
  const keys = new Set(settings.filter((s) => contract.settings.types[s.type]?.hasValue !== false).map((s) => s.key));
  const fieldErrors = {};
  const other = [];
  let otherChars = 0;
  for (const [k, v] of Object.entries(value)) {
    const t = text(v, ui.fieldErrorMaxChars);
    if (!t) continue;
    if (keys.has(k)) fieldErrors[k] = t;
    else if (otherChars < ui.fieldErrorMaxChars) { other.push(t); otherChars += t.length + 1; }
  }
  if (!Object.keys(fieldErrors).length && !other.length) return { accepted: true };
  return { accepted: false, fieldErrors, general: other.length ? clip(other.join(" "), ui.fieldErrorMaxChars) : null };
}

/**
 * `liveChannel`: the `resolve` answer is for a live channel's ref (the app knows; the kit is told),
 * so `liveStreamHosts: "any"` applies to its stream URL.
 */
/**
 * The caps of a syncProvider's syncPull/syncPush call (contract.fetch.syncCall): ceil(sync.maxBlobBytes * 4/3) +
 * envelopeChars for each kino.fetch request and response body and for the call's answer. Null for any other plugin.
 */
export function syncCallCap(manifest) {
  if (!manifest || !Array.isArray(manifest.capabilities) || !manifest.capabilities.includes("syncProvider")) return null;
  const max = contract.manifest.sync.maxBlobBytes;
  const declared = Number(manifest.sync?.maxBlobBytes ?? max);
  return Math.ceil(Math.min(declared, max) * 4 / 3) + contract.fetch.syncCall.envelopeChars;
}

/**
 * What Kino keeps of a sync export's answer: syncPull `{ blob, version }` or null, syncPush `{ version }`, syncStatus
 * `{ ready, message? }`. The answer of syncPull/syncPush may reach [syncCallCap] characters as JSON; syncStatus keeps the
 * usual 2,000,000. Throws what the app would refuse.
 */
export function checkSyncAnswer(fn, value, manifest) {
  const json = JSON.stringify(value === undefined ? null : value);
  const cap = contract.fetch.syncCall.functions.includes(fn) ? syncCallCap(manifest) ?? o().maxResultChars : o().maxResultChars;
  if (json.length > cap) throw new Error(`plugin answer too large (over ${cap} characters)`);
  const v = JSON.parse(json);
  const blobOk = (b) => typeof b === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(b) && b.length % 4 === 0;
  if (fn === "syncPull") {
    if (v === null) return null;
    if (!v || typeof v.version !== "string" || !v.version || !blobOk(v.blob)) throw new Error("syncPull must answer null or { blob: <base64>, version: <string> }");
    const bytes = (v.blob.length / 4) * 3 - (v.blob.endsWith("==") ? 2 : v.blob.endsWith("=") ? 1 : 0);
    const max = Math.min(Number(manifest.sync?.maxBlobBytes ?? contract.manifest.sync.maxBlobBytes), contract.manifest.sync.maxBlobBytes);
    if (bytes > max) throw new Error(`pull blob is ${bytes} bytes, over the ${max} cap`);
    return { blob: v.blob, version: v.version };
  }
  if (fn === "syncPush") {
    if (!v || typeof v.version !== "string" || !v.version) throw new Error("syncPush must answer { version: <string> }");
    return { version: v.version };
  }
  if (fn === "syncStatus") return { ready: !(v && v.ready === false), message: v && typeof v.message === "string" ? v.message : null };
  throw new Error(`not a sync export: ${fn}`);
}

export function checkOutput(fn, value, manifest, servers = [], { liveChannel = false, alternative = false, migrateInput = null, segmentsQuery = null } = {}) {
  const drops = [];
  const drop = (m) => { drops.push(m); };
  const ctx = {
    allowSeries: manifest.capabilities.includes("episodes"),
    allowNext: manifest.capabilities.includes("browse"),
    // Live channels are apiVersion 2: a v1 plugin's live item is dropped like any invalid one.
    allowLive: Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= o().liveKindApiVersion,
    // Music and podcast items are apiVersion 8: an older plugin's are dropped, the rest of its answer stays.
    allowAudio: Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= o().audioKindApiVersion,
    // 18+ entries are apiVersion 6: kept and marked (shown behind the person's 18+ code); below it, dropped.
    allowAdult: Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= o().adultApiVersion,
    servers,
    // imageSource (apiVersion 13): a poster, backdrop, still or hero image may be { source: "plugin", handle }.
    imageRefs: allowsImageRefs(manifest),
  };
  const liveAdult = Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= live().adultApiVersion;
  const json = JSON.stringify(value === undefined ? null : value);
  if (json.length > o().maxResultChars) throw new Error("plugin answer too large (over 2 million characters)");
  const parsed = JSON.parse(json);
  switch (fn) {
    case "search": return { value: page(parsed, o().maxSearchItems, ctx, drop), drops };
    case "browse": return { value: page(parsed, o().maxBrowseItems, { ...ctx, allowNext: true }, drop), drops };
    case "home": return { value: rows(parsed, { ...ctx, homeLive: Number.isInteger(manifest.apiVersion) && manifest.apiVersion >= o().homeLiveApiVersion }, drop), drops };
    case "section": return { value: section(parsed, ctx, drop), drops };
    case "categories": return { value: categories(parsed, ctx, drop), drops };
    case "episodes": return { value: episodes(parsed, drop, servers, ctx.imageRefs), drops };
    // imageSource (apiVersion 13): what the app keeps of an image answer, or the reason it shows the placeholder.
    case "image": return { value: imageAnswer(parsed), drops };
    // Widevine is the `drm` capability (apiVersion 2 by the manifest rules): without it every DRM-shaped key refuses the stream.
    case "resolve": return { value: stream(parsed, { manifest, servers, allowDrm: manifest.capabilities.includes("drm"), liveChannel, alternative, drop }), drops };
    case "sign": {
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || parsed.headers === null || typeof parsed.headers !== "object" || Array.isArray(parsed.headers)) {
        throw new Error("sign didn't return { headers }");
      }
      // Markers are per runtime and never substituted in a stream's headers: refused, names and values.
      const headers = headersOf(parsed.headers);
      if (Object.entries(headers).some(([k, v]) => k.includes("__kinoSecret_") || v.includes("__kinoSecret_"))) throw new Error("sign can't return sealed data");
      return { value: { headers }, drops };
    }
    case "liveCategories": return { value: liveCategories(parsed, { manifest, servers, allowAdult: liveAdult }, drop), drops };
    case "liveChannels": return { value: liveChannels(parsed, { manifest, servers, allowDrm: manifest.capabilities.includes("drm"), allowAdult: liveAdult }, drop), drops };
    // A liveChannels page whose `next` Kino ignores, cut to the search's own cap.
    case "liveSearch": {
      const found = liveChannels(parsed, { manifest, servers, allowDrm: manifest.capabilities.includes("drm"), allowAdult: liveAdult, search: true }, drop);
      if (found.items.length > live().maxSearchChannels) drop(`liveSearch: beyond ${live().maxSearchChannels} dropped`);
      return { value: { items: found.items.slice(0, live().maxSearchChannels) }, drops };
    }
    case "guide": return { value: guide(parsed, drop), drops };
    case "migrate": return migrateAnswer(parsed, migrateInput || { kind: "title" }, ctx.allowAudio);
    case "subtitles": return { value: subtitleTracks(parsed, { manifest, servers }, drop), drops };
    // Kino only needs track() to return (anything, `{ ok: true }` by convention) or throw: a kino.error code says whether to retry.
    case "track": return { value: parsed, drops };
    // apiVersion 7's segments: what the app's Segments.parse keeps, judged against the query's durationMs.
    case "segments": return { value: segmentsAnswer(parsed, segmentsQuery?.durationMs, drop), drops };
    // apiVersion 6's meta: what the app's TitleMetaOutput.parse keeps (null = no answer), with a verdict per field.
    case "meta": {
      const r = metaAnswer(parsed, servers);
      return { value: r.value, drops: r.drops, fields: r.fields, noAnswer: r.noAnswer };
    }
    // apiVersion 10's playlists: a loose shape check, like liveCategories's own array-of-objects check.
    case "playlists": {
      if (!Array.isArray(parsed)) { drop("playlists: the answer is not a JSON array"); return { value: [], drops }; }
      const out = [];
      parsed.forEach((p, i) => {
        if (p === null || typeof p !== "object" || Array.isArray(p)) return drop(`playlists: #${i} is not an object`);
        const id = typeof p.id === "string" ? p.id : "";
        if (!id) return drop(`playlists: #${i} has no id`);
        const title = text(p.title, o().maxTitleChars);
        if (!title) return drop(`playlists: ${id} has no title`);
        const itemCount = Number.isInteger(p.itemCount) && p.itemCount >= 0 ? p.itemCount : 0;
        out.push({ id, title, itemCount });
      });
      return { value: out, drops };
    }
    // playlistItems: the same page shape as browse.
    case "playlistItems": return { value: page(parsed, o().maxBrowseItems, { ...ctx, allowNext: true }, drop), drops };
    case "playlistCreate": {
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.id !== "string" || !parsed.id) {
        throw new Error("playlistCreate didn't return { id }");
      }
      return { value: { id: parsed.id }, drops };
    }
    // playlistAddItem/playlistRemoveItem/playlistReorder return void: like track, anything or throw.
    case "playlistAddItem":
    case "playlistRemoveItem":
    case "playlistReorder":
      return { value: parsed, drops };
    default: throw new Error(`unknown function ${fn}`);
  }
}
