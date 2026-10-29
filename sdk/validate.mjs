#!/usr/bin/env node
// Checks a plugin the way Kino does, without installing it:
//   node sdk/validate.mjs <plugin folder>
//     the manifest (every rule in contract.json, the app's own messages), the entry file,
//     and that every declared capability is an exported function (the app refuses the install
//     otherwise).
//   node sdk/validate.mjs <plugin folder> --run <function> [argument] [cursor] [--config k=v] [--replay file]
//     <function>: a capability's export, meta, or section [tab], categories, settingsStatus, action <key>, validateSettings '<json>'
//   A signed plugin (apiVersion 5's signature): the signature is checked against the entry file for
//   `--repo owner/repo[/path]`, by default the folder's GitHub origin; an author key (*.pem) tracked
//   by git is refused.
//     also runs one function and reports every entry the app would drop, and why. With
//     `--run liveCategories`, each declared playlist is downloaded and parsed as the app would.
// It also prints the consent sheet's extra lines, the red ones marked, as the person will read them.
// Exit code 0 = Kino would accept it; 1 = it wouldn't (the reasons are on stderr).
import { sharedSecretWords } from "./shared.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkOutput, checkSettingsOutput, contract, englishCoverage, fetchAnyHost, isStandaloneSet, kb, maskSetPasswords, statusHide, requiredExports, validateManifest, validateManifestWithoutEnhancements } from "./contract.mjs";
import { resolvePalette } from "./palette.mjs";
import { decodeCipherKey } from "./seal.mjs";
import { createKino, signingLane } from "./kino-shim.mjs";
import { loadPlugin, missingGlobalLines, scanMissingGlobals } from "./sandbox.mjs";
import { call, callMeta, callPanel, markLiveSearch, metaQueryForItem, panelRequest, parseArgs, resolveFirstLiveRef, signExportProblem, unmarkedSearchNote } from "./run.mjs";
import { loadPlaylist } from "./live-playlist.mjs";
import { checkPanelOutput, langOf, PANEL_EXTRA_ICONS, PANEL_ICONS, PANEL_ICON_DEFAULT, panelIconKnown, panelIconProblem, settingsLayout } from "./panel.mjs";
import { checkPanelScreen, checkScreenTimers, isPanelScreen, PANEL_SCREEN, printScreenTree } from "./screen.mjs";
import { fingerprint, normalizeBinding, verifyEntry } from "./seal.mjs";

// Every return carries { ok, problems, drops, output, consent, notes } — even the early ones, before
// a `kino` even exists — so a caller (this file's own CLI included) never has to guess which fields
// are present.
const refused = (problems) => ({ ok: false, problems, drops: [], output: null, consent: [], notes: [] });

/** The note for a plugin that declares scopedSearch while its entry never reads `query.within`. */
/** A plugin that uses apiVersion 6's key pairs but declares an older apiVersion: an older Kino installs it and the call fails there. */
export const KEY_PAIRS_OLD_API = `Usa kino.crypto.generateKeyPair/sign/verify/importKey/deriveSharedSecret, que llegaron con apiVersion ${contract.crypto.keyPairs.apiVersion}: declara "apiVersion": ${contract.crypto.keyPairs.apiVersion} para que un Kino anterior no lo instale y falle al llamarlas`;
export const SCOPED_IGNORED = 'Declara "scopedSearch" pero search() no lee query.within: Kino le pide buscar dentro de una página "Ver más" y recibiría la búsqueda completa (responde null si no puede buscar en esa página)';

/**
 * The consent sheet's lines beyond the host list, as the app's PluginConsent.extraLines builds them
 * for a first install. `danger` lines are drawn in red.
 */
export function consentLines(m, { authorFingerprint = null } = {}) {
  const out = [];
  const line = (text, danger = false) => out.push({ text, danger });
  // "catalogOnly": true (Kino 0.9.54): not a grant, says what the plugin is (PluginConsent / PluginsStrings.catalogOnlyConsentLine).
  if (m.catalogOnly) line(contract.manifest.catalogOnly.consentLine.es);
  (m.permissions || []).forEach((p) => line(`Permiso: ${p}`));
  if ((m.settings || []).some((s) => s.type === "password")) line("Este plugin usa tu usuario y contraseña");
  if ((m.settings || []).some((s) => s.type === "url")) line("Se conectará a los servidores que escribas en su configuración");
  if (m.capabilities.includes("download")) line("Puede descargar videos para verlos sin conexión");
  if (m.capabilities.includes("drm")) line("Reproduce video protegido (DRM)");
  if (m.capabilities.includes("channels")) line("Agrega canales en vivo a la pestaña En vivo");
  if (m.capabilities.includes("migrate")) line("Revisar lo que tienes guardado (biblioteca, historial, favoritos) para pasarlo a este plugin");
  if (m.capabilities.includes("subtitles")) line("Agrega subtítulos a tus películas y series");
  // Experiment: the plugin may ask the Nuvio scrapers the person already installed (contract.json kinoNuvio.consentLine).
  if (m.capabilities.includes(contract.kinoNuvio.capability)) line(contract.kinoNuvio.consentLine.es);
  // apiVersion 7 "tracking": in red, the plugin's declared hosts named (PluginConsent / Tracking.consentLine).
  if (m.capabilities.includes(contract.tracking.capability)) line(trackingConsentLine(m.hosts || []), true);
  // apiVersion 12 "syncProvider" (PluginConsent.extraLines): the key comes from sync.keySecret, which the plugin reads, so the
  // plugin and its service can read the data: always red.
  if (m.capabilities.includes(contract.manifest.sync.requires)) line(contract.manifest.sync.consentLine, true);
  // apiVersion 14 "library" (PluginConsent.extraLines, Task 8b): it can read what the person watched and saved and send it to
  // its hosts (listed on the same sheet): always red.
  if (m.capabilities.includes(contract.kinoLibrary.capability)) line(contract.kinoLibrary.consentLine.es, true);
  // apiVersion 14 "playerPanelTab" (PluginConsent.extraLines, Task 8k): its tab in the player sees what the person watches: red.
  if (m.capabilities.includes(contract.manifest.panel.contributes.capability)) line(contract.manifest.panel.contributes.consentLine.es, true);
  // apiVersion 14 "playerControl" (PluginConsent.extraLines, Task 8j): it can pause, resume and move the video by itself: red.
  if (m.capabilities.includes(contract.kinoPlayerControl.capability)) line(contract.kinoPlayerControl.consentLine.es, true);
  // apiVersion 14 "room" (PluginConsent.extraLines, Task 8l): people on the Internet reach this device while a room is open: red.
  if (m.capabilities.includes(contract.kinoRoom.capability)) line(contract.kinoRoom.consentLine.es, true);
  // apiVersion 14 "schedule" (PluginConsent.extraLines, Task 8q): it runs by itself in the background, on the person's internet and battery: red.
  if (m.capabilities.includes(contract.kinoJobs.capability)) line(contract.kinoJobs.consentLine.es, true);
  // apiVersion 14 "ai" (PluginConsent.extraLines, Task 8r): what it sends leaves the device for a third-party AI service: red.
  if (m.capabilities.includes(contract.kinoAi.capability)) line(contract.kinoAi.consentLine.es, true);
  // apiVersion 14 "shared" (PluginConsent.extraLines, Task 8q-2): the person's own data between their own devices: a plain line.
  if (m.capabilities.includes(contract.kinoShared.capability)) line(contract.kinoShared.consentLine.es);
  // apiVersion 7 "segments": a plain line, not red (it only learns which title plays): PluginConsent / Segments.CONSENT_LINE.
  if (m.capabilities.includes(contract.segments.capability)) line(contract.segments.consentLine);
  if (m.secrets && Object.keys(m.secrets).length) line("Usa datos sellados por su autor");
  if (m.telemetry) line(m.telemetry === contract.manifest.telemetry.verbose.value ? contract.manifest.telemetry.verbose.consentLine : contract.manifest.telemetry.consentLine);
  if (authorFingerprint) line(contract.manifest.signature.consentLine);
  (m.insecureHosts || []).forEach((h) => line(`Conexión sin cifrar con ${h}`, true));
  if (m.liveStreamHostsAny) line("Puede reproducir canales desde cualquier servidor que indique su lista", true);
  // apiVersion 6 "browser": true (kino.browser.capture): the same red line as the app's PluginConsent.BROWSER_LINE;
  // "browser": "pages" also reads pages (kino.browser.page): PluginConsent.BROWSER_PAGE_LINE (manifest.browser.pageConsentLine).
  if (m.browser) line(m.browserPages ? contract.manifest.browser.pageConsentLine : contract.manifest.browser.consentLine, true);
  if (m.streamHostsAny) {
    const onlySubtitles = m.capabilities.includes("subtitles") && isStandaloneSet(m.capabilities);
    line(onlySubtitles ? "Puede traer subtítulos desde cualquier servidor que indique"
      : m.capabilities.includes("subtitles") ? "Puede reproducir video y traer subtítulos desde cualquier servidor que indique"
      : "Puede reproducir video desde cualquier servidor que indique", true);
  }
  // fetchHosts "any" at apiVersion 9 (Kino 0.9.55): PluginConsent.FETCH_HOSTS_LINE, in red.
  if (fetchAnyHost(m)) line(contract.manifest.fetchHosts.consentLine, true);
  return out;
}

/** The tracking consent line for [hosts], as the app's Tracking.consentLine builds it (`.invalid` placeholders left out). */
export function trackingConsentLine(hosts) {
  const named = hosts.map((h) => (typeof h === "string" ? h : h.host)).filter((h) => h && !h.toLowerCase().endsWith(".invalid") && h.toLowerCase() !== "invalid");
  if (!named.length) return contract.tracking.consentLineNoHosts;
  const max = contract.tracking.consentMaxHosts;
  const rest = named.length - max;
  return contract.tracking.consentLine.replace("{hosts}", named.slice(0, max).join(", ") + (rest > 0 ? ` y ${rest} más` : ""));
}

/** The functions `--run` takes that are not a capability's: the manifest's section, categories and settings form. */
export const UI_FUNCTIONS = ["section", "categories", "settingsStatus", "action", "validateSettings"];

/**
 * `--run` of one of [UI_FUNCTIONS], called and checked as run.mjs does (and the app: section and categories by
 * checkOutput, the settings form by checkSettingsOutput): `{ problems, drops, notes, output }`. A call the app would
 * never make (no "section" in the manifest, categories without apiVersion 6 and browse, an action key no `action`
 * setting has, a function not exported) is a problem.
 */
/**
 * `--run panel <ref> [tab]`: `panel(context)` called with the app's context (an apiVersion 14 plugin's carries `state` and
 * `size` too) and its result read as the app reads it, in whichever format it comes: `{ problems, drops, notes, output }`. A
 * result Kino would show no panel for (not an object, a screen-format one without a root node) is a problem.
 */
export async function runPanel(plugin, args, m, servers) {
  const problems = [], drops = [], notes = [];
  const out = (o) => ({ problems, drops, notes, output: o });
  if (!m.panel || !(m.apiVersion >= contract.manifest.panel.apiVersion)) { problems.push('the manifest does not declare "panel" (apiVersion 9): Kino shows no panel button for this plugin'); return out(null); }
  if (typeof plugin.panel !== "function") { problems.push(`the plugin doesn't export panel()`); return out(null); }
  let request;
  try { request = panelRequest("panel", args.length ? args : ["demo"], null, { apiVersion: m.apiVersion }); } catch (e) { problems.push(e.message); return out(null); }
  const answer = await callPanel(plugin, "panel", request);
  const value = answer === undefined ? null : JSON.parse(JSON.stringify(answer));
  const lang = langOf(request.context);
  const formatNotes = [];
  if (isPanelScreen(value, m.apiVersion, (l) => formatNotes.push(l))) {
    const r = checkPanelScreen(value, lang, { settings: m.settings });
    drops.push(...r.dropped);
    if (!r.panel) { problems.push("panel: the screen-format panel is invalid: Kino shows no panel"); return out(null); }
    notes.push(`panel: screen format (depth ${PANEL_SCREEN.maxDepth}, ${PANEL_SCREEN.maxNodes} nodes at most)`);
    const { root, ...drawer } = r.panel;
    return out({ format: PANEL_SCREEN.format, ...drawer, root: printScreenTree(root) });
  }
  drops.push(...formatNotes);
  const checked = checkPanelOutput("panel", value, servers, { context: request.context, lang });
  drops.push(...checked.drops);
  if (!checked.ok) problems.push("panel: the answer is not a panel: Kino shows no panel");
  return out(checked.value);
}

export async function runUiFunction(plugin, run, args, m, servers) {
  const problems = [], drops = [], notes = [];
  const out = (o) => ({ problems, drops, notes, output: o });
  const settings = m.settings || [];
  if (run === "section" && !m.section) return problems.push('"section" needs "section" in the manifest'), out(null);
  if (run === "categories" && !(m.apiVersion >= contract.output.categories.apiVersion && m.capabilities.includes("browse"))) {
    return problems.push(`"categories" needs apiVersion ${contract.output.categories.apiVersion} and the browse capability`), out(null);
  }
  if (run === "action") {
    const keys = settings.filter((x) => x.type === "action").map((x) => x.key);
    if (!args[0]) return problems.push(`"action" needs the key of an action setting${keys.length ? ` (${keys.join(", ")})` : ""}`), out(null);
    if (!keys.includes(args[0])) return problems.push(`no "action" setting has the key "${args[0]}": Kino never calls action("${args[0]}")${keys.length ? ` (actions: ${keys.join(", ")})` : ""}`), out(null);
  }
  if (typeof plugin[run] !== "function") return problems.push(`the plugin doesn't export ${run}()`), out(null);
  if (run === "settingsStatus" && !settings.some((x) => x.type === "status" || x.type === "qr")) notes.push("settingsStatus: no \"status\" or \"qr\" setting, so Kino never calls it");
  try {
    const answer = await call(plugin, run, args);
    if (run === "section" || run === "categories") {
      const checked = checkOutput(run, answer, m, servers);
      drops.push(...checked.drops);
      return out(checked.value);
    }
    const value = checkSettingsOutput(run, answer, m, undefined, (d) => drops.push(d), run === "action" ? args[0] : null);
    if (run === "settingsStatus") {
      Object.entries(value).forEach(([k, t]) => notes.push(`settingsStatus: ${k} shows "${t}"`));
      const missing = settings.filter((x) => (x.type === "status" || x.type === "qr") && !(x.key in value)).map((x) => x.key);
      if (missing.length) notes.push(`settingsStatus: no line for ${missing.join(", ")} (Kino shows nothing there)`);
      const hidden = statusHide(answer, m);
      if (hidden.length) notes.push(`settingsStatus: hides ${hidden.join(", ")} while this answer is current`);
    }
    if (run === "action") notes.push(`action(${JSON.stringify(args[0])}): ${value.message ? `Kino shows "${value.message}"` : "no message"}${value.refresh ? ", then reads settingsStatus again" : ""}${value.clearSettings.length ? `, clears ${value.clearSettings.join(", ")}` : ""}${value.link ? `, then asks "Is this you, ${value.link.candidate}?" and runs ${JSON.stringify(value.link.confirm)} only if the person confirms` : ""}${value.link === null ? ", and shows its generic error for the link it cannot use" : ""}${value.setSettings ? `, then saves ${Object.keys(value.setSettings).join(", ")} as if typed` : ""}${value.setSettings === null ? ", and shows its generic error for the setSettings it cannot apply" : ""}`);
    if (run === "validateSettings" && value.accepted) notes.push("validateSettings accepts the save");
    if (run === "validateSettings" && !value.accepted) notes.push(`validateSettings refuses the save: ${JSON.stringify(value)}`);
    // A password the action fills is shown masked: Kino never shows nor logs it.
    return out(run === "action" ? maskSetPasswords(value, m) : value);
  } catch (e) {
    problems.push(`${run}: ${e && e.code ? `[${e.code}] ` : ""}${e && e.message ? e.message : String(e)}`);
    return out(null);
  }
}

/** The fields of a kept meta answer that carry something. */
const keptMetaFields = (meta) => Object.entries(meta).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k]) => k);

/**
 * `meta()` asked about the first movie or series of a checked search/browse/home answer that carries `ids.imdb` or
 * `ids.tmdb`, with the query Kino builds for it and within the app's time: `{ problem, drops, notes }`. In the app a
 * plugin is never asked about its own titles; this is the same question about a title another source lists.
 */
export async function metaForFirstTitle(plugin, output, m, servers, timeoutMs) {
  const items = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== "object") return;
    if (typeof v.id === "string" && typeof v.ref === "string" && v.kind) items.push(v);
    for (const k of ["items", "rows"]) if (Array.isArray(v[k])) walk(v[k]);
  };
  walk(output);
  const item = items.find((i) => metaQueryForItem(i));
  if (!item) return { problem: null, drops: [], notes: items.length ? ["meta: no title in this answer carries ids.imdb or ids.tmdb, so meta was not tried (Kino asks no meta plugin about a title with no ids)"] : [] };
  const query = metaQueryForItem(item);
  const label = `meta(${JSON.stringify(query)}) for "${item.title}"`;
  try {
    const checked = checkOutput("meta", await callMeta(plugin, query, timeoutMs), m, servers);
    return {
      problem: null,
      drops: checked.drops.map((d) => `${label}: ${d.replace(/^meta: /, "")}`),
      notes: [checked.value ? `${label}: Kino keeps ${keptMetaFields(checked.value).join(", ")}` : `${label}: no answer (${checked.noAnswer})`],
    };
  } catch (e) {
    return { problem: `${label}: ${e && e.code ? `[${e.code}] ` : ""}${e && e.message ? e.message : String(e)}`, drops: [], notes: [] };
  }
}

/** Files of [dir]'s git repository, among [paths], that git tracks (none when [dir] is not in a repository). */
function trackedByGit(dir, paths) {
  const r = spawnSync("git", ["ls-files", "--", ...paths], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

/** `owner/repo[/folder]` from [dir]'s git origin on GitHub, or null. */
export function bindingFromGit(dir) {
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  const origin = git("remote", "get-url", "origin");
  if (origin.status !== 0) return null;
  const match = origin.stdout.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?\/?$/i);
  if (!match) return null;
  const prefix = git("rev-parse", "--show-prefix");
  const folder = prefix.status === 0 ? prefix.stdout.trim().replace(/\/+$/, "") : "";
  try {
    return normalizeBinding([match[1], match[2], folder].filter(Boolean).join("/"));
  } catch {
    return null;
  }
}

/**
 * "catalogOnly": true is additive (Kino 0.9.54): an older Kino ignores the field and applies its own rules, which ask for
 * `resolve` and for `search` or `home`. Notes only: the plugin is valid, older apps just refuse it (or play its resolve).
 */
export function catalogOnlyNotes(m) {
  if (!m.catalogOnly) return [];
  const co = contract.manifest.catalogOnly;
  const notes = [];
  const older = co.olderApps;
  const missing = [...contract.capabilities.required.filter((c) => !m.capabilities.includes(c))];
  if (!contract.capabilities.atLeastOneOf.some((c) => m.capabilities.includes(c))) missing.push(contract.capabilities.atLeastOneOf.join('" o "'));
  if (missing.length) notes.push(older.refusedNote.replace("{fromApp}", contract.additiveFromApp.catalogOnly).replace("{missing}", missing.join('", "')));
  else notes.push(older.compatibleNote.replace("{fromApp}", contract.additiveFromApp.catalogOnly));
  return notes;
}

/**
 * kino.meta and kino.tmdb exist from Kino 0.9.53 on, with no new apiVersion: a plugin that calls one without checking
 * `typeof kino.<name> === "function"` fails with a TypeError on older Kino. A warning only (contract.additiveFromApp).
 */
export function unguardedServiceNotes(source) {
  const notes = [];
  for (const name of ["meta", "tmdb"]) {
    const calls = new RegExp(`\\bkino\\s*\\.\\s*${name}\\s*\\(`).test(source);
    const guarded = new RegExp(`typeof\\s+kino\\s*\\.\\s*${name}\\b`).test(source);
    if (calls && !guarded) {
      notes.push(`kino.${name} existe desde Kino ${contract.additiveFromApp["kino." + name]}: comprueba typeof kino.${name} === "function" antes de usarlo, o el plugin falla en versiones anteriores`);
    }
  }
  // Kino 0.9.71 (apiVersion 11): kino.nuvio is an object, absent on an older Kino (which refuses apiVersion 11 anyway).
  if (/\bkino\s*\.\s*nuvio\s*\.\s*\w+\s*\(/.test(source) && !/typeof\s+kino\s*\.\s*nuvio\b/.test(source)) {
    notes.push(`kino.nuvio existe desde Kino ${contract.additiveFromApp["kino.nuvio"]}: comprueba typeof kino.nuvio === "object" antes de usarlo`);
  }
  // Kino 0.9.55: kino.meta({ type, title }) — an older Kino answers invalid_request (no ids).
  const byTitle = /\bkino\s*\.\s*meta\s*\(\s*\{[^}]*\btitle\s*[:,}]/.test(source);
  if (byTitle && !/\bkino\s*\.\s*meta\s*\.\s*byTitle\b/.test(source)) {
    notes.push(`kino.meta con title (sin ids) existe desde Kino ${contract.additiveFromApp["kino.meta.byTitle"]}: comprueba kino.meta.byTitle === true antes; en versiones anteriores responde invalid_request`);
  }
  return notes;
}

/**
 * apiVersion 14's kino.room (contract.kinoRoom, Task 8l): like [undeclaredLibraryProblem], for a plugin whose code calls
 * kino.room without declaring the "room" capability. The message, or null.
 */
export function undeclaredRoomProblem(m, source) {
  const R = contract.kinoRoom;
  if ((m.capabilities || []).includes(R.capability)) return null;
  if (!/\bkino\s*\.\s*room\s*\.\s*(open|join|send|inbox|members|close|state)\s*\(/.test(source)) return null;
  return `The code calls kino.room but the manifest does not declare the "${R.capability}" capability (apiVersion ${R.apiVersion}): Kino would refuse every call with permission_denied`;
}

/**
 * apiVersion 14's kino.ai (contract.kinoAi, Task 8r): like [undeclaredLibraryProblem], for a plugin whose code calls kino.ai.ask
 * without declaring the "ai" capability. The message, or null.
 */
export function undeclaredAiProblem(m, source) {
  const A = contract.kinoAi;
  if ((m.capabilities || []).includes(A.capability)) return null;
  if (!/\bkino\s*\.\s*ai\s*\.\s*ask\s*\(/.test(source)) return null;
  return `The code calls kino.ai.ask but the manifest does not declare the "${A.capability}" capability (apiVersion ${A.apiVersion}): Kino would refuse every ask`;
}

/**
 * apiVersion 14's kino.shared (contract.kinoShared, Task 8q-2): a plugin whose code calls it without declaring the "shared"
 * capability (every call would be not_allowed). The message, or null.
 */
export function undeclaredSharedProblem(m, source) {
  const S = contract.kinoShared;
  if ((m.capabilities || []).includes(S.capability)) return null;
  if (!/\bkino\s*\.\s*shared\s*\.\s*(get|set)\s*\(/.test(source)) return null;
  return `The code calls kino.shared but the manifest does not declare the "${S.capability}" capability (apiVersion ${S.apiVersion}): Kino would refuse every call with not_allowed`;
}

/**
 * kino.shared keys written as literals that look like a secret (contract.kinoShared.secretKeyPattern): Kino refuses them, and a
 * secret must never sync to every device anyway. One warning per key.
 */
export function sharedSecretKeyWarnings(source) {
  const out = [];
  for (const match of source.matchAll(/\bkino\s*\.\s*shared\s*\.\s*(?:get|set)\s*\(\s*(["'`])([^"'`]{1,80})\1/g)) {
    const key = match[2];
    if (sharedSecretWords(key).length && !out.some((w) => w.includes(`"${key}"`))) {
      out.push(`kino.shared key "${key}" looks like a secret: Kino refuses it (bad_request). Never put tokens, passwords, cookies or sessions in kino.shared: it is copied to every one of the person's linked devices; keep them in kino.storage or your settings`);
    }
  }
  return out;
}

/**
 * apiVersion 14's kino.library (contract.kinoLibrary): a plugin whose code calls it without declaring the "library" capability
 * would get permission_denied on every call in Kino, so the kit refuses it here. The message, or null when the source does not
 * call it or the capability is declared.
 */
export function undeclaredLibraryProblem(m, source) {
  const L = contract.kinoLibrary;
  if ((m.capabilities || []).includes(L.capability)) return null;
  if (!/\bkino\s*\.\s*library\s*\.\s*(watched|saved)\s*\(/.test(source)) return null;
  return `The code calls kino.library but the manifest does not declare the "${L.capability}" capability (apiVersion ${L.apiVersion}): Kino would refuse every call with permission_denied`;
}

/**
 * kino.browser.capture's captureAll, alsoMatch, waitForCookie and returnCookiesOnTimeout exist from Kino 0.9.54 on, with no
 * new apiVersion: older Kino ignores them and answers a plain capture. A plugin that uses them without checking
 * `kino.browser.captureAll` gets a warning (contract.additiveFromApp["kino.browser.captureAll"]).
 */
export function unguardedBrowserNotes(source) {
  const uses = /\b(captureAll|alsoMatch|waitForCookie|returnCookiesOnTimeout)\s*:/.test(source);
  const guarded = /\bkino\s*\.\s*browser\s*\.\s*captureAll\b/.test(source);
  if (!uses || guarded) return [];
  const feature = contract.browser.captureAll.feature;
  return [`Las opciones captureAll, alsoMatch, waitForCookie y returnCookiesOnTimeout de kino.browser.capture existen desde Kino ${contract.additiveFromApp[feature]}: comprueba ${feature} antes de usarlas; en versiones anteriores la captura las ignora`];
}

export async function validate(dirArg, { run = null, args = [], config = {}, replay = null, fetchImpl = globalThis.fetch, repo = null } = {}) {
  const problems = [];
  const dir = resolve(dirArg);
  const manifestFile = join(dir, "kino-plugin.json");
  if (!existsSync(manifestFile)) return refused([`no kino-plugin.json in ${dir}`]);
  const manifestText = readFileSync(manifestFile, "utf8");
  const checked = validateManifest(manifestText);
  if (!checked.ok) return refused([`kino-plugin.json: ${checked.field}: ${checked.message}`]);
  const m = checked.manifest;
  const notes = [];
  const warnings = [];
  let authorFingerprint = null;
  // Task 8c: an enhancement Kino can't apply never refuses the plugin (it runs as its base manifest says, the app logs why),
  // so here it is a problem the author must see before publishing.
  for (const d of m.enhancementsDropped) problems.push(`kino-plugin.json: ${d}: Kino ignores this enhancement and runs the plugin as its apiVersion ${m.apiVersion} says`);
  if (m.enhancementsApplied.length) {
    const E = contract.manifest.enhancements;
    // An enhancement's settings REPLACE the list: a key it leaves out exists only on an older Kino (values sync by key).
    const declaredBlocks = JSON.parse(manifestText).enhancements || {};
    let before = (validateManifestWithoutEnhancements(manifestText).manifest?.settings || []).map((s) => s.key);
    for (const k of m.enhancementsApplied) {
      const list = declaredBlocks[String(k)]?.settings;
      if (!Array.isArray(list)) continue;
      const now = list.map((s) => s && s.key);
      const gone = before.filter((key) => !now.includes(key));
      if (gone.length) notes.push(`enhancements.${k}: "settings" leaves out ${gone.join(", ")}: a Kino that reads the enhancement has no such setting, an older one does (their values sync by key); keep the list a superset of the manifest's`);
      before = now;
    }
    notes.push(`enhancements ${m.enhancementsApplied.join(", ")}: read by Kino ${contract.apiVersionFromApp[String(E.fromApiVersion)]} or later (capabilities: ${m.capabilities.join(", ")}); an older Kino ignores them and runs the plugin as apiVersion ${m.apiVersion}, so it must keep working without them there`);
  }
  if (!m.discoverable) notes.push("No aparecerá en la búsqueda de Kino");
  for (const note of catalogOnlyNotes(m)) notes.push(note);
  // "debug": true only turns every person's "Modo debug" switch on by default (Kino 0.9.50): the author is told what that means.
  if (m.debug) notes.push(contract.manifest.debug.defaultOnNote);
  if (m.theme && Object.keys(m.theme).length) for (const w of resolvePalette(m.theme).warnings) notes.push(w);
  // Accepted from Kino 0.9.45 on; older apps still refuse the install, so the author is told. They
  // counted the raw entries (duplicates too), so this does as well.
  const legacy = contract.manifest.legacyMaxHosts;
  if (JSON.parse(manifestText).hosts.length > legacy.value) {
    notes.push(`Más de ${legacy.value} hosts: Kino ${legacy.refusedUpToApp} o anterior rechaza este plugin; necesita Kino ${legacy.noLimitFromApp} o superior`);
  }
  if (m.browser) {
    notes.push(m.browserPages
      ? "kino.browser.capture and kino.browser.page only work in the app (a hidden WebView); here they answer browser_unavailable, so test on a device. Kino never solves captchas: a page that asks to confirm a human is there answers blocked"
      : "kino.browser.capture only works in the app (a hidden WebView); here it answers browser_unavailable, so test resolve on a device. To read pages with kino.browser.page declare \"browser\": \"pages\"");
  }
  // Kino 0.9.55's English texts (labelEn, hintEn, confirmEn, section.labelEn): only said once the plugin uses them.
  const en = englishCoverage(m);
  if (en.english > 0) {
    notes.push(en.missing.length
      ? `English texts: ${en.english} of ${en.total}; without an English version (Kino shows them in Spanish): ${en.missing.slice(0, 8).join(", ")}${en.missing.length > 8 ? ` and ${en.missing.length - 8} more` : ""}`
      : `English texts: ${en.english} of ${en.total}`);
    notes.push(`Kino ${contract.settings.english.fromApp} or later shows the English texts when the app is in English; an older Kino ignores them and shows the usual ones`);
  }
  // The app honors fetchHosts on a plugin it converted from a Nuvio scraper, and on one written by hand only from
  // apiVersion 9 (Kino 0.9.55; there it is a red consent line, see consentLines).
  if (m.fetchHostsAny && !fetchAnyHost(m)) notes.push(`fetchHosts only takes effect on plugins converted from Nuvio or, on one written by hand, from apiVersion ${contract.manifest.fetchHosts.handWrittenApiVersion} (Kino ${contract.additiveFromApp["kino.fetchAnyHost"]}); in your plugin it is ignored`);
  if (m.secrets && Object.keys(m.secrets).length) {
    notes.push("Which repository the secrets were sealed for can't be checked here: Kino checks it at install. They also only open when the person installs the plugin from its default branch, without @branch. And from a manifest URL (kino-plugin.json outside GitHub) Kino refuses the plugin: seals belong to a repository.");
  }
  const sg = contract.manifest.signature;
  if (m.apiVersion === sg.apiVersion) {
    notes.push(`apiVersion ${m.apiVersion}: needs Kino ${sg.fromApp} or later; older versions refuse it with "This plugin needs a newer version of Kino"`);
  } else if (m.apiVersion > sg.apiVersion) {
    // Above the signed entry's version: the Kino release each one first ships in (contract.json apiVersionFromApp).
    const fromApp = contract.apiVersionFromApp[String(m.apiVersion)];
    notes.push(`apiVersion ${m.apiVersion}: needs Kino ${fromApp} or later; older versions refuse it with "This plugin needs a newer version of Kino"`);
  }
  const entry = join(dir, m.entry);
  if (!existsSync(entry)) return { ...refused([`entry ${m.entry} not found`]), consent: consentLines(m), notes };
  // scopedSearch (apiVersion 6): Kino calls search() with `within`, the "Ver más" page's browse ref. An entry that never
  // names `within` answers the whole catalog's search there. A warning only: a plugin may read it some other way.
  if (m.capabilities.includes(contract.search.scoped.capability) && !new RegExp(`\\b${contract.search.scoped.field}\\b`).test(readFileSync(entry, "utf8"))) {
    notes.push(SCOPED_IGNORED);
  }
  for (const note of unguardedServiceNotes(readFileSync(entry, "utf8"))) notes.push(note);
  const libraryProblem = undeclaredLibraryProblem(m, readFileSync(entry, "utf8"));
  if (libraryProblem) problems.push(libraryProblem);
  const roomProblem = undeclaredRoomProblem(m, readFileSync(entry, "utf8"));
  if (roomProblem) problems.push(roomProblem);
  const aiProblem = undeclaredAiProblem(m, readFileSync(entry, "utf8"));
  if (aiProblem) problems.push(aiProblem);
  const sharedProblem = undeclaredSharedProblem(m, readFileSync(entry, "utf8"));
  if (sharedProblem) problems.push(sharedProblem);
  warnings.push(...sharedSecretKeyWarnings(readFileSync(entry, "utf8")));
  for (const note of unguardedBrowserNotes(readFileSync(entry, "utf8"))) notes.push(note);
  if (m.apiVersion < contract.crypto.keyPairs.apiVersion && /\b(generateKeyPair|importKey|deriveSharedSecret)\b|crypto\s*\.\s*(sign|verify)\b/.test(readFileSync(entry, "utf8"))) {
    notes.push(KEY_PAIRS_OLD_API);
  }
  if (statSync(entry).size > contract.manifest.entryMaxBytes) problems.push(`${m.entry} is bigger than ${kb(contract.manifest.entryMaxBytes)}: Kino refuses it`);
  if (m.signature) {
    authorFingerprint = fingerprint(Buffer.from(m.signature.authorKey, "hex"));
    notes.push(`${sg.authorKeyLabel}: ${authorFingerprint} (Kino la muestra en los detalles del plugin, no en la ventana de instalación)`);
    // The signature is bound to owner/repo: a plugin installed from its kino-plugin.json URL elsewhere is unsigned.
    notes.push("La firma solo vale si se instala desde el repositorio de GitHub: desde una URL del manifest (kino-plugin.json fuera de GitHub) el plugin se instala sin firma.");
    // The author key committed by mistake: anyone could then sign "updates" Kino accepts.
    trackedByGit(dir, ["*.pem"]).forEach((f) => problems.push(`${f} is tracked by git: anyone can read your author key on GitHub. Remove it (git rm --cached ${f}), add it to .gitignore, and since it leaked, make a new key (everyone must reinstall)`));
    let binding = null;
    try { binding = repo ? normalizeBinding(repo) : bindingFromGit(dir); } catch (e) { problems.push(e.message); }
    if (!binding) {
      notes.push("No sé desde qué repositorio se instalará (usa --repo owner/repo[/carpeta]): la firma no se comprobó aquí; Kino la comprueba al instalar.");
    } else if (!verifyEntry(m.signature, readFileSync(entry), binding, m.id, m.version)) {
      problems.push(`signature: ${sg.badSignatureMessage} (for ${binding}). Sign again: node sdk/seal.mjs --sign --repo ${binding}`);
    }
  }
  const consent = consentLines(m, { authorFingerprint });
  // apiVersion 9's player panel button and settings layout: below it Kino ignores both fields, so the author is told.
  const layoutDrops = [];
  const declared = JSON.parse(manifestText);
  const panelApi = contract.manifest.panel.apiVersion;
  if (m.apiVersion < panelApi) {
    for (const field of ["panel", "settingsLayout"]) if (declared[field] !== undefined) notes.push(`"${field}" needs apiVersion ${panelApi} (Kino ${contract.apiVersionFromApp[String(panelApi)]}): at apiVersion ${m.apiVersion} Kino ignores it`);
  }
  if ((m.capabilities || []).includes(contract.kinoPlayerControl.capability)) {
    // Task 8j: what the capability changes, so the author does not count on it (the person may refuse or revoke it).
    const P = contract.kinoPlayerControl;
    notes.push(`playerControl: your player actions also count from a panel result's own player (refreshMs) and from playerEvent, and a contributed tab may also ${P.contributedWithControl.filter((f) => f !== "seekToMs").join(" and ")}; Kino announces each one the person did not cause, drops it under a Kino dialog or while they seek, keeps only pause on live, and allows ${P.perMinute} a minute. The person may refuse it or switch it off: work without it. Try it: KINO_PLAYER_CONTROL_REVOKED=1 node sdk/run.mjs <this folder> panel <ref>`);
  }
  if ((m.capabilities || []).includes(contract.kinoRoom.capability)) {
    // Task 8l: what a room is and is not, so the author builds failover and polling into the plugin.
    const R = contract.kinoRoom;
    notes.push(`room: kino.room opens a mailbox on the person's device over the Internet (open from ${R.openFrom.join(" and ")} only, traffic while your screen or panel is open and Kino in front); poll inbox from refreshMs or every, at most ${R.limits.perSecond} messages a second of ${R.limits.maxPayloadBytes} bytes; who leads and failover are yours. The person may refuse it or switch it off: work without it. The kit runs an in-memory room with two simulated members; try KINO_ROOM_REVOKED=1`);
  }
  if ((m.capabilities || []).includes(contract.kinoJobs.capability)) {
    // Task 8q: what a job is and is not, so the author keeps its result in storage and its screens read it.
    const J = contract.kinoJobs;
    notes.push(`schedule: Kino runs job(ctx) in the background for ${(m.jobs || []).map((j) => j.id).join(", ")}, only once the person turns that job on (each starts off), at most every ${J.manifest.minEveryMin} min, ${J.limits.runTimeoutMs / 1000} s, ${J.limits.maxFetches} requests, ${J.limits.maxResponseBytes / (1024 * 1024)} MB of answers and ${J.limits.maxStorageWriteBytes / 1024} KB of storage per run, ${J.limits.maxRunsPerDay} runs a day; its answer is never read and it draws nothing: keep the result in kino.storage and read it when your screen opens. ${J.forbiddenApis.join(", ")} reject with not_allowed in a job. The person may refuse it or switch it off: work without it. Try it: node sdk/run.mjs <this folder> job ${(m.jobs || [])[0]?.id ?? "<id>"}`);
  }
  if ((m.capabilities || []).includes(contract.kinoShared.capability)) {
    // Task 8q-2: what kino.shared is and is not, so the author validates what another device wrote and keeps secrets out.
    const S = contract.kinoShared;
    notes.push(`shared: kino.shared.get/set keep up to ${S.limits.maxKeys} JSON values (${S.limits.maxValueBytes / 1024} KB each, ${S.limits.maxPluginBytes / 1024} KB in all) that sync between the person's linked devices, last writer wins; a key travels at most once a minute. Another device wrote what get answers: validate it before you use it. Never a secret (tokens, passwords, cookies, sessions). Try it: node sdk/run.mjs --device phone <this folder> job, then --device tv <this folder> screen, and node sdk/run.mjs <this folder> shared`);
  }
  if ((m.jobs || []).some((j) => j.runOn === "preferPhone")) {
    notes.push(`runOn "preferPhone": ONE of the person's linked devices runs ${(m.jobs || []).filter((j) => j.runOn === "preferPhone").map((j) => j.id).join(", ")}, a linked phone first; the TV runs it only when no phone can (none linked, or quiet for ${contract.kinoJobs.election.freshPeriods} periods). Write the result with kino.shared so the TV reads it${(m.capabilities || []).includes(contract.kinoShared.capability) ? "" : ' (declare the "shared" capability)'}, and read kino.device in the job to do less on a TV`);
  }
  if ((m.capabilities || []).includes(contract.kinoAi.capability)) {
    // Task 8r: what the AI is and is not, so the author treats the reply as untrusted data and keeps a fallback.
    const A = contract.kinoAi;
    notes.push(`ai: kino.ai.ask sends your prompt to a third-party AI (Kilo) and answers { ok, text, model } or { ok: false, error } (never throws); only after the person's own press (${A.fromFunctions.join(", ")}) or from your scheduled job; ${A.limits.perMinute} a minute, ${A.limits.perDay} a day, one at a time, ${A.limits.timeoutMs / 1000} s. The reply is untrusted: a prompt can be injected through what you send, so validate every field and never execute or follow it; json: true only asks for JSON. Tell the person in your own UI what you send. The person may refuse it or switch it off: keep a fallback. The kit answers canned text: KINO_AI_REPLY=..., KINO_AI_ERROR=<code>, KINO_AI_REVOKED=1`);
  }
  if (m.panel?.contributes && (m.panel.kinds ?? []).includes(contract.kinoLivePanel.kind)) {
    // Task 11: the tab also joins En vivo channels, after Kino's General tab, with the live context.
    notes.push(`panel.kinds "live": your tab joins every En vivo channel's panel after Kino's General tab; its context is { kind: "live", live: true, channel: { provider, code, name }, foreign, source } (no position), your player actions are dropped there, no playerEvent; go.liveChannel { provider, code } tunes after the person's press. Try it: node sdk/run.mjs --live-channel <provider>:<code>[:<name>] <this folder> panel -`);
  }
  if (m.panel?.contributes) {
    // Task 8k: the tab joins the panel of other plugins' titles, with a foreign context; the kit's run shows it.
    const C = contract.manifest.panel.contributes;
    notes.push(`panel.contributes: a tab in the player panel of any plugin's title (after Kino's own and the playing plugin's, at most ${C.maxTabs} tabs, the person's order); its context has foreign: true, an opaque ref and source { pluginId, name }; its player actions count only after a press in it, and only a seek. Try it: node sdk/run.mjs --foreign <plugin id>:<name> <this folder> panel <ref>`);
  }
  if (m.panel) {
    if (m.panel.icon && PANEL_ICONS.includes(m.panel.icon) && !panelIconKnown(m.panel.icon, m.apiVersion)) {
      // Task 8v: the larger icon set needs apiVersion 14; below it Kino reads the name as an unknown one.
      notes.push(`panel.icon "${m.panel.icon}" needs apiVersion ${PANEL_EXTRA_ICONS.apiVersion}: at apiVersion ${m.apiVersion} Kino draws "${PANEL_ICON_DEFAULT}"`);
    } else if (m.panel.icon && !PANEL_ICONS.includes(m.panel.icon)) notes.push(`panel.icon "${m.panel.icon}" is not a predefined icon: Kino draws "${PANEL_ICON_DEFAULT}" (${PANEL_ICONS.join(", ")})`);
    if (m.panel.iconFile) {
      // The installer refuses a missing or bad panel icon (unlike the plugin's own icon): the author asked for it.
      const file = join(dir, m.panel.iconFile);
      if (!existsSync(file)) problems.push(`Couldn't download the panel icon. ${m.panel.iconFile} was not found`);
      else {
        const bytes = readFileSync(file);
        const refusal = panelIconProblem(bytes);
        if (refusal) problems.push(`${m.panel.iconFile}: ${refusal}`);
      }
    }
  }
  // apiVersion 14's screen canvas: below it Kino ignores the field. The capability has no consent line (no grant: the screen
  // only draws the plugin's own content and goes nowhere outside it).
  const screenApi = contract.manifest.screen.apiVersion;
  if (m.apiVersion < screenApi && declared.screen !== undefined) {
    notes.push(`"screen" needs apiVersion ${screenApi} (Kino ${contract.apiVersionFromApp[String(screenApi)]}): at apiVersion ${m.apiVersion} Kino ignores it. To offer it to newer Kinos without cutting older ones off, put it in "enhancements": { "${screenApi}": { "capabilities": ["screen"], "screen": { … } } }`);
  }
  // The screen as written: the newest enhancement that carries one, else the manifest's own.
  const declaredScreen = [...m.enhancementsApplied].reverse().map((k) => declared.enhancements?.[String(k)]?.screen).find((s) => s !== undefined) ?? declared.screen;
  if (m.screen) {
    // Without "menu" in opensFrom there is no menu entry: what only that entry uses is ignored (Kino logs nothing, the kit says it).
    if (!m.screen.opensFrom.includes("menu") && declaredScreen && typeof declaredScreen === "object") {
      for (const f of ["icon", "iconFile", "menuOpens"]) {
        if (declaredScreen[f] !== undefined && declaredScreen[f] !== null) notes.push(`screen.${f} is ignored: "menu" is not in screen.opensFrom, so the screen has no menu entry`);
      }
    }
    if (m.screen.icon && !PANEL_ICONS.includes(m.screen.icon)) notes.push(`screen.icon "${m.screen.icon}" is not a predefined icon: Kino draws "${PANEL_ICON_DEFAULT}" (${PANEL_ICONS.join(", ")})`);
    if (m.screen.iconFile) {
      const file = join(dir, m.screen.iconFile);
      if (!existsSync(file)) problems.push(`Couldn't download the screen icon. ${m.screen.iconFile} was not found`);
      else {
        const refusal = panelIconProblem(readFileSync(file));
        if (refusal) problems.push(`${m.screen.iconFile}: ${refusal}`);
      }
    }
    // The screen's own timers: Kino drops a bad one (never refuses the plugin) and says so in the plugin's log.
    if (m.screen.every !== undefined) for (const line of checkScreenTimers(m.screen.every).dropped) notes.push(`screen.every: Kino logs ${line}`);
  }
  if (m.settingsLayout !== undefined && m.apiVersion >= contract.manifest.settingsLayout.apiVersion) {
    // Kino ignores an unknown or repeated setting and still shows the form; here it is a mistake in the manifest, so it fails.
    const layout = settingsLayout(m.settingsLayout, m.settings);
    // Uncapped: a bad key after the app's 10 logged lines still fails.
    problems.push(...layout.problems);
    for (const line of layout.log) if (!/unknown setting|placed twice/.test(line)) layoutDrops.push(line);
  }
  if (m.icon && existsSync(join(dir, m.icon)) && statSync(join(dir, m.icon)).size > contract.manifest.iconMaxBytes) problems.push(`${m.icon} is bigger than ${kb(contract.manifest.iconMaxBytes)}: Kino skips it`);
  // A typed cipher key's local stand-in must be a real key: the app refuses the install otherwise.
  const secretsFile = join(dir, ".kino-secrets.json");
  if (Object.keys(m.secretKeyEncodings || {}).length && existsSync(secretsFile)) {
    let local = {};
    try { local = JSON.parse(readFileSync(secretsFile, "utf8")) || {}; } catch { /* run.mjs reports an unreadable stand-in */ }
    for (const [n, enc] of Object.entries(m.secretKeyEncodings)) {
      if (Object.prototype.hasOwnProperty.call(local, n) && !decodeCipherKey(String(local[n]), enc)) {
        problems.push(`secret "${n}" in .kino-secrets.json is not a 16, 24 or 32-byte key in ${enc}`);
      }
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), "kino-validate-"));
  const drops = [...layoutDrops];
  let output = null;
  try {
    // Inside the try too: an invalid --replay path (or any other setup failure) must become a
    // problem, not an uncaught rejection.
    // The same local stand-in run.mjs reads: a plugin with `secrets` gets its plain values from it.
    const { kino, servers } = createKino(m, { config, replay: replay && resolve(replay), fetchImpl, secretsFile: join(dir, ".kino-secrets.json"), callFunction: run });
    // sign() runs in the signing lane, as in run.mjs and the app: no network, storage, cookies or sleep.
    const pluginKino = run === "sign" ? signingLane(kino) : kino;
    globalThis.kino = pluginKino;
    // What Node has and Kino lacks (setTimeout, fetch, Buffer...): named even where no test reaches, then the entry runs in the
    // kit's sandbox, where touching one is a ReferenceError as in the app (sandbox.mjs).
    warnings.push(...missingGlobalLines(scanMissingGlobals(readFileSync(entry, "utf8"))));
    const loaded = await loadPlugin(entry, pluginKino);
    if (!loaded.sandboxed) notes.push("running without the sandbox (KINO_SDK_NO_SANDBOX=1): the plugin can see Node's globals that Kino lacks");
    const plugin = loaded.plugin;
    // download/drm export nothing; channels exports liveCategories + liveChannels (guide optional).
    // Only the plugin's OWN manifest refuses the install (an enhancement's missing exports drop that block, as the app does: the
    // block's exports are checked below, against what the entry really exports).
    const own = validateManifestWithoutEnhancements(manifestText).manifest;
    const missing = requiredExports(own.capabilities, own.settings, own).filter((f) => typeof plugin[f] !== "function");
    if (missing.length) problems.push(`the plugin doesn't export ${missing.join(", ")}: Kino refuses the install ("le falta ${missing.sort().join(", ")}")`);
    else {
      const exported = Object.keys(plugin).filter((f) => typeof plugin[f] === "function");
      const probed = validateManifest(manifestText, { exports: exported });
      if (probed.ok) {
        for (const d of probed.manifest.enhancementsDropped) {
          if (!m.enhancementsDropped.includes(d)) problems.push(`kino-plugin.json: ${d}: Kino ignores this enhancement and runs the plugin as its apiVersion ${m.apiVersion} says`);
        }
      }
    }
    // The player panel (`--run panel <ref> [tab]`): either format, read as the app reads it (Task 8i: a screen-format result's
    // tree with the panel's limits, any other result as the legacy panel).
    if (run === "panel" && !problems.length) {
      const r = await runPanel(plugin, args, m, servers);
      problems.push(...r.problems);
      drops.push(...r.drops);
      notes.push(...r.notes);
      output = r.output;
    } else if (run && !problems.length && UI_FUNCTIONS.includes(run)) {
      const r = await runUiFunction(plugin, run, args, m, servers);
      problems.push(...r.problems);
      drops.push(...r.drops);
      notes.push(...r.notes);
      output = r.output;
      if (r.output && (run === "section") && m.capabilities.includes("meta") && typeof plugin.meta === "function") {
        const chained = await metaForFirstTitle(plugin, r.output, m, servers);
        if (chained.problem) problems.push(chained.problem);
        drops.push(...chained.drops);
        notes.push(...chained.notes);
      }
    } else if (run && !problems.length) {
      // A capability's exports are runnable too: channels runs liveCategories, liveChannels and guide.
      // Any plugin may export `subtitles` without the capability (contract.capabilities.anyPluginExports).
      const runnable = new Set([...m.capabilities, ...contract.capabilities.anyPluginExports, ...m.capabilities.flatMap((c) => [...(contract.capabilities.exports[c] || []), ...(contract.capabilities.optionalExports[c] || [])])]);
      if (!runnable.has(run)) problems.push(`"${run}" isn't in the manifest's capabilities`);
      else {
        const checkedOut = checkOutput(run, await call(plugin, run, args), m, servers, { migrateInput: run === "migrate" ? JSON.parse(args[0] || "null") : null });
        output = checkedOut.value;
        drops.push(...checkedOut.drops);
        // meta's null (or an answer with nothing usable) is "not a title I know": no failure, the page keeps TMDB's.
        if (run === "meta") notes.push(output === null ? `meta: no answer (${checkedOut.noAnswer})` : `meta: Kino keeps ${keptMetaFields(output).join(", ")}`);
        // A listed title's info page asks the meta plugins about it by its ids: ask this one about the first such title.
        if (["search", "browse", "home"].includes(run) && m.capabilities.includes("meta") && typeof plugin.meta === "function") {
          const r = await metaForFirstTitle(plugin, output, m, servers);
          if (r.problem) problems.push(r.problem);
          drops.push(...r.drops);
          notes.push(...r.notes);
        }
        const noSign = run === "resolve" ? signExportProblem(output, plugin) : null;
        if (noSign) problems.push(noSign);
        // A search hit is 18+ by its own marks and the plugin's categories (as in the app): unmarked ones get a warning.
        if (run === "liveSearch") {
          const marked = await markLiveSearch(plugin, output, m, servers);
          output = marked.value;
          const note = unmarkedSearchNote(marked);
          if (note) notes.push(note);
        }
        // A lazy copy's ref goes to resolve() when the person or the fallback needs it: follow the first, as the app would.
        const lazy = run === "resolve" && Array.isArray(output.alternatives) ? output.alternatives.find((a) => a.ref !== undefined) : undefined;
        if (lazy) {
          try {
            const copy = checkOutput("resolve", await call(plugin, "resolve", [lazy.ref]), m, servers, { alternative: true });
            if (copy.value.alternatives) notes.push(`resolve(${JSON.stringify(lazy.ref)}): its own alternatives are ignored for a lazy copy (no recursion)`);
          } catch (e) {
            problems.push(`resolve(${JSON.stringify(lazy.ref)}) (a lazy copy): ${e.message}`);
          }
        }
        // Playing a listed channel sends its ref to resolve() as a live channel's: follow the first.
        if (run === "liveChannels") {
          const r = await resolveFirstLiveRef(plugin, output, m, servers);
          if (r && r.error) problems.push(`resolve(${r.ref}) ${r.error}`);
        }
        // The app downloads and parses each declared playlist itself: one that fails or comes out
        // empty would show nothing.
        for (const p of run === "liveCategories" ? output.playlists : []) {
          try {
            const s = await loadPlaylist(p, { manifest: m, servers, fetchImpl });
            if (s.channels === 0) problems.push(`playlist ${p.url}: 0 channels (${s.skipped} entries dropped, ${s.hidden} hidden)`);
            if (s.skipped) drops.push(`playlist ${p.url}: ${s.skipped} entries dropped`);
            if (s.cut) drops.push(`playlist ${p.url}: pasa de ${Math.round(contract.live.maxPlaylistBytes / (1024 * 1024))} MB, Kino lee solo su comienzo`);
          } catch (e) {
            problems.push(`playlist ${p.url}: not downloaded: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    problems.push(e && e.code ? `[${e.code}] ${e.message}` : String(e && e.message ? e.message : e));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, drops, output, consent, notes, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // --repo is validate's own (run.mjs's parser doesn't know it): taken out before the rest is read.
  const argv = process.argv.slice(2);
  const repoAt = argv.indexOf("--repo");
  const repo = repoAt === -1 ? null : argv.splice(repoAt, 2)[1];
  const { opts, rest } = parseArgs(argv);
  const runAt = rest.indexOf("--run");
  const dir = rest[0];
  if (!dir) {
    console.error("usage: node sdk/validate.mjs <plugin folder> [--run <function> [argument] [cursor]] [--config k=v] [--replay file] [--repo owner/repo[/path]]");
    process.exitCode = 2;
  } else {
    const result = await validate(dir, {
      run: runAt === -1 ? null : rest[runAt + 1],
      args: runAt === -1 ? [] : rest.slice(runAt + 2),
      config: opts.config,
      replay: opts.replay,
      repo,
    });
    if (result.consent.length) {
      // Red on a terminal, as on the consent sheet; "(en rojo)" either way so a log keeps it.
      const red = process.stderr.isTTY ? (t) => `\x1b[31m${t}\x1b[0m` : (t) => t;
      console.error("Consent sheet:");
      result.consent.forEach((c) => console.error(c.danger ? red(`  ! ${c.text} (en rojo)`) : `  · ${c.text}`));
    }
    result.drops.forEach((d) => console.error(`[dropped by Kino] ${d}`));
    result.problems.forEach((p) => console.error(`✗ ${p}`));
    (result.warnings || []).forEach((w) => console.error(`! ${w}`));
    result.notes.forEach((n) => console.error(`· ${n}`));
    if (result.ok) console.error("✓ Kino would accept this plugin" + (result.drops.length ? ` (${result.drops.length} entries dropped, see above)` : "") + (result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} above: the install works, the call fails where the plugin uses a global Kino lacks)` : ""));
    process.exitCode = result.ok ? 0 : 1;
  }
}
