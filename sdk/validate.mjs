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
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkOutput, checkSettingsOutput, contract, englishCoverage, fetchAnyHost, kb, requiredExports, validateManifest } from "./contract.mjs";
import { resolvePalette } from "./palette.mjs";
import { decodeCipherKey } from "./seal.mjs";
import { createKino, signingLane } from "./kino-shim.mjs";
import { loadPlugin, missingGlobalLines, scanMissingGlobals } from "./sandbox.mjs";
import { call, callMeta, markLiveSearch, metaQueryForItem, parseArgs, resolveFirstLiveRef, signExportProblem, unmarkedSearchNote } from "./run.mjs";
import { loadPlaylist } from "./live-playlist.mjs";
import { PANEL_ICONS, PANEL_ICON_DEFAULT, panelIconProblem, settingsLayout } from "./panel.mjs";
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
  // apiVersion 7 "tracking": in red, the plugin's declared hosts named (PluginConsent / Tracking.consentLine).
  if (m.capabilities.includes(contract.tracking.capability)) line(trackingConsentLine(m.hosts || []), true);
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
    const onlySubtitles = m.capabilities.includes("subtitles") && m.capabilities.every((c) => contract.capabilities.standalone.includes(c));
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
  if (run === "settingsStatus" && !settings.some((x) => x.type === "status")) notes.push("settingsStatus: no \"status\" setting, so Kino never calls it");
  try {
    const answer = await call(plugin, run, args);
    if (run === "section" || run === "categories") {
      const checked = checkOutput(run, answer, m, servers);
      drops.push(...checked.drops);
      return out(checked.value);
    }
    const value = checkSettingsOutput(run, answer, m, undefined, (d) => drops.push(d));
    if (run === "settingsStatus") {
      Object.entries(value).forEach(([k, t]) => notes.push(`settingsStatus: ${k} shows "${t}"`));
      const missing = settings.filter((x) => x.type === "status" && !(x.key in value)).map((x) => x.key);
      if (missing.length) notes.push(`settingsStatus: no line for ${missing.join(", ")} (Kino shows nothing there)`);
    }
    if (run === "action") notes.push(`action(${JSON.stringify(args[0])}): ${value.message ? `Kino shows "${value.message}"` : "no message"}${value.refresh ? ", then reads settingsStatus again" : ""}${value.clearSettings.length ? `, clears ${value.clearSettings.join(", ")}` : ""}`);
    if (run === "validateSettings" && value.accepted) notes.push("validateSettings accepts the save");
    if (run === "validateSettings" && !value.accepted) notes.push(`validateSettings refuses the save: ${JSON.stringify(value)}`);
    return out(value);
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
  // Kino 0.9.55: kino.meta({ type, title }) — an older Kino answers invalid_request (no ids).
  const byTitle = /\bkino\s*\.\s*meta\s*\(\s*\{[^}]*\btitle\s*[:,}]/.test(source);
  if (byTitle && !/\bkino\s*\.\s*meta\s*\.\s*byTitle\b/.test(source)) {
    notes.push(`kino.meta con title (sin ids) existe desde Kino ${contract.additiveFromApp["kino.meta.byTitle"]}: comprueba kino.meta.byTitle === true antes; en versiones anteriores responde invalid_request`);
  }
  return notes;
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
  if (m.panel) {
    if (m.panel.icon && !PANEL_ICONS.includes(m.panel.icon)) notes.push(`panel.icon "${m.panel.icon}" is not a predefined icon: Kino draws "${PANEL_ICON_DEFAULT}" (${PANEL_ICONS.join(", ")})`);
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
    const { kino, servers } = createKino(m, { config, replay: replay && resolve(replay), fetchImpl, secretsFile: join(dir, ".kino-secrets.json") });
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
    const missing = requiredExports(m.capabilities, m.settings, m).filter((f) => typeof plugin[f] !== "function");
    if (missing.length) problems.push(`the plugin doesn't export ${missing.join(", ")}: Kino refuses the install ("le falta ${missing.sort().join(", ")}")`);
    // apiVersion 6's own section, categories and settings form: no capability, the manifest decides (as in run.mjs).
    if (run && !problems.length && UI_FUNCTIONS.includes(run)) {
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
            const copy = checkOutput("resolve", await call(plugin, "resolve", [lazy.ref]), m, servers);
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
