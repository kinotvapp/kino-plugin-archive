#!/usr/bin/env node
// Runs one function of a Kino plugin under Node with the same `kino` API the app provides, then
// checks the answer the way the app does and prints what the app would keep.
//   node sdk/run.mjs ./plugin.js search "metropolis"      (KINO_TYPE=movie|series|music|podcast|any)
//   node sdk/run.mjs ./plugin.js search '{"q":"dragnet","type":"series","year":1951}'
//   node sdk/run.mjs ./plugin.js home
//   node sdk/run.mjs ./plugin.js browse '<ref>' ['<cursor>']
//   node sdk/run.mjs --within '<browse ref>' ./plugin.js search "matrix"   (apiVersion 6, scopedSearch: search inside a "Ver más" page)
//   node sdk/run.mjs ./plugin.js episodes '<series ref>'
//   node sdk/run.mjs ./plugin.js resolve '<ref>'      (lists its copies; a lazy copy's ref resolves the same way, apiVersion 6)
//   node sdk/run.mjs ./plugin.js sign '{"url":"https://…/seg.ts","kind":"segment","ref":"<ref>","context":"<signContext>"}'   (apiVersion 6)
//     (with alternateHosts, Kino signs the URL of the host it is asking: pass "url" on each host to try its token)
//   node sdk/run.mjs ./plugin.js migrate '{"kind":"title","ref":"<old ref>"}'   (apiVersion 6)
// The settings form (apiVersion 6; not capabilities, they run even with a required setting empty):
//   node sdk/run.mjs <plugin dir> settingsStatus
//   node sdk/run.mjs <plugin dir> action <key>
//   node sdk/run.mjs <plugin dir> validateSettings '{"email":"ana@x.co"}'
// Live channels (apiVersion 3, the "channels" capability):
//   node sdk/run.mjs <plugin dir> live categories        (and downloads + groups each declared playlist)
//   node sdk/run.mjs <plugin dir> live channels <categoryId> [cursor]
//   node sdk/run.mjs <plugin dir> live guide <id,id>
//   node sdk/run.mjs <plugin dir> live search <query>     (the optional liveSearch export)
//   node sdk/run.mjs live playlist <url|file> [--epg <url|file>]   (any M3U list, no plugin needed)
// Your own section, categories and colors (apiVersion 6; no capability, the manifest decides):
//   node sdk/run.mjs <plugin dir> section [tab]     needs "section" in the manifest
//   node sdk/run.mjs <plugin dir> categories        needs apiVersion 6 and the browse capability
//   node sdk/run.mjs <plugin dir> theme             previews the five colors, contrast ratios and warnings
// Subtitles (the "subtitles" capability, or the export alone):
//   node sdk/run.mjs <plugin dir> subtitles tt0133093               (a movie by IMDb id)
//   node sdk/run.mjs <plugin dir> subtitles tmdb:1396 1 2           (an episode: the SERIES' id, season, episode)
//   node sdk/run.mjs <plugin dir> subtitles '{"imdbId":"tt0903747","kind":"series","season":1,"episode":2}'
//   (KINO_LANGS=es,en: the person's subtitle languages, in order)
// Tracking (apiVersion 7, the "tracking" capability): one event, as the app builds it (a sample movie by default)
//   node sdk/run.mjs <plugin dir> track start
//   node sdk/run.mjs <plugin dir> track watched '{"kind":"episode","ids":{},"show":{"title":"Breaking Bad","ids":{"tmdb":1396}},"season":1,"episode":2}'
// Segments (apiVersion 7, the "segments" capability): the query as the app builds it, then what Kino keeps of the answer
//   node sdk/run.mjs <plugin dir> segments tt0133093 [durationMs]                 (a movie)
//   node sdk/run.mjs <plugin dir> segments tmdb:1396 1 2 [durationMs]             (an episode: the SHOW's id, season, episode)
//   node sdk/run.mjs <plugin dir> segments '{"kind":"episode","ids":{"tmdb":62085},"show":{"ids":{"tmdb":1396}},"season":1,"episode":2,"durationMs":2880000}'
// The player panel (apiVersion 9): the fake context is a movie 10 min in on a TV; --context '<json>' merges over it
//   node sdk/run.mjs [--context '<json>'] <plugin dir> panel <ref> [tab]
//   node sdk/run.mjs [--context '<json>'] <plugin dir> panelAction <ref> <key> <press|change|submit|tab|open> ['<value json>'] ['<values json>']
//   node sdk/run.mjs [--context '<json>'] <plugin dir> playerEvent <ref> <started|paused|resumed|ended|failed|copyChanged> ['<detail json>']
// Describing other titles (apiVersion 6, the "meta" capability): the query as the app builds it, Kino's verdict field by
// field, and how the info page would use it (within the app's 6 s)
//   node sdk/run.mjs <plugin dir> meta tt0133093 [movie|series]          (KINO_LANG=es: the person's language)
//   node sdk/run.mjs <plugin dir> meta tmdb:1399 series tt0944947         (several ids of one title)
//   node sdk/run.mjs <plugin dir> meta kitsu:1376 series                  (also sent as the query's `id`, as for a Stremio anime)
//   node sdk/run.mjs <plugin dir> meta '{"type":"series","ids":{"imdb":"tt0944947","tmdb":1399},"lang":"es"}'
// kino.meta and kino.tmdb (Kino 0.9.53, any apiVersion) work in every function above, through the kit's stand-ins:
//   KINO_META_FIXTURE=<file.json>   kino.meta answers from it ({ "movie:imdb:tt0133093": {...}, "tmdb:1399": {...} }); else null
//   KINO_TMDB_KEY=<your key>        kino.tmdb asks TMDB with YOUR key where Kino uses its own (a v3 API key or a v4 read
//                                   token), under Kino's limit for its key; also "tmdbKey" in sdk/config.json. Without one:
//                                   no_tmdb_key, as a Kino build without a key of its own and a person without one gets
//   KINO_TMDB_FIXTURE=<file.json>   kino.tmdb answers offline from it ({ "/movie/603?language=es-MX": {...}, "/genre/movie/list": {...} })
//   (samples: docs/plugins/fixtures/kino-services/ in Kino's repository)
// Options (before the plugin path):
//   --config key=value     a setting's value (repeatable); also read from sdk/config.json
//   --record <file>        save every kino.fetch answer to <file> (JSON)
//   --replay <file>        answer kino.fetch from <file> only: offline and repeatable
//   --raw                  print the plugin's answer as it returned it, without the app's checks
//   --epg <url|file>       live playlist only: the XMLTV guide to show what is on now
//   --retry conflict:1     resolve only: call resolve(ref, { retry: { reason: "conflict", attempt: 1 } })  (apiVersion 6);
//                          conflict:1:409 also passes the origin's HTTP status (401, 403 or 409)
//   --live                 resolve only: the ref is a live channel's (liveStreamHosts "any" applies)
//   --within <browse ref>  search only: Kino's scoped search ({ q, type: "any", within, cursor }); null = "can't search there"
//   --device tv|phone      what kino.device says (default KINO_DEVICE, else phone): test the TV side of your plugin
// The first argument is the plugin's entry file or the folder that holds kino-plugin.json. The
// result goes to stdout as JSON; everything else (kino.log, console.*, dropped entries, errors)
// goes to stderr.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkOutput, checkSettingsOutput, contract, markSearchHits, segmentSkip, validateManifest } from "./contract.mjs";
import { contrast, formatRatio, resolvePalette } from "./palette.mjs";
import { createKino, errorReport, signingLane } from "./kino-shim.mjs";
import { loadPlugin, missingGlobalLines, scanMissingGlobals } from "./sandbox.mjs";
import { actionEvent, checkPanelOutput, fakeContext, langOf, PLAYER_EVENTS, TRIGGERS } from "./panel.mjs";
import { channelLines, download, guideFor, keepStart, loadPlaylist, summarisePlaylist, summaryLines } from "./live-playlist.mjs";

const FUNCTIONS = ["search", "home", "browse", "episodes", "resolve", "migrate", "section", "categories", "subtitles", "track", "segments", "meta"];
// apiVersion 6's settings form: not capabilities, so no capability check; the app runs them even before a required setting is typed.
const SETTINGS_FUNCTIONS = ["settingsStatus", "action", "validateSettings"];
// apiVersion 9's player panel: not capabilities either (the manifest's "panel" decides), and Kino calls them with a context.
const PANEL_FUNCTIONS = ["panel", "panelAction", "playerEvent"];
// `live <sub>` names one of the channels capability's exports.
const LIVE = { categories: "liveCategories", channels: "liveChannels", guide: "guide", search: "liveSearch" };
const USAGE = "usage: node sdk/run.mjs [--config k=v] [--record f | --replay f] [--raw] [--device tv|phone] <plugin.js | plugin folder> <search|home|browse|episodes|resolve|migrate|sign> [argument] [cursor]\n"
  + "       node sdk/run.mjs [--config k=v] [--raw] <plugin folder> <section [tab] | categories | theme>\n"
  + "       node sdk/run.mjs [--config k=v] [--raw] <plugin folder> <settingsStatus | action <key> | validateSettings '<json>'>\n"
  + "       node sdk/run.mjs [--config k=v] <plugin folder> live <categories | channels <categoryId> [cursor] | guide <id,id> | search <query>>\n"
  + "       node sdk/run.mjs [--config k=v] <plugin folder> subtitles <ttID | tmdb:ID | JSON> [season episode]\n"
  + "       node sdk/run.mjs [--config k=v] <plugin folder> track <start|progress|stop|watched> [JSON]\n"
  + "       node sdk/run.mjs [--config k=v] <plugin folder> segments <ttID [durationMs] | tmdb:ID season episode [durationMs] | JSON>\n"
  + "       node sdk/run.mjs [--config k=v] [--raw] <plugin folder> meta <ttID | tmdb:ID | kitsu:ID | mal:ID | anilist:ID | JSON> [movie|series] [more ids] [lang=xx] [id=<source id>]\n"
  + "       node sdk/run.mjs [--context '<json>'] <plugin folder> <panel <ref> [tab] | panelAction <ref> <key> <press|change|submit|tab|open> ['<value json>'] ['<values json>'] | playerEvent <ref> <type> ['<detail json>']>\n"
  + "       node sdk/run.mjs live playlist <url|file> [--epg <url|file>]\n"
  + "       env: KINO_META_FIXTURE=<json> (kino.meta), KINO_TMDB_KEY=<your TMDB key> or KINO_TMDB_FIXTURE=<json> (kino.tmdb)";
const here = dirname(fileURLToPath(import.meta.url));

const stderr = console.error.bind(console);

/** What the app says when a `signing: "request"` Stream comes from a plugin without a sign() export. */
export const NO_SIGN_EXPORT = "the plugin asks to sign the video but doesn't export sign()";
/** run.mjs's note when a "catalogOnly" plugin's resolve (or sign) is run: only an older Kino ever calls it. */
export const CATALOG_ONLY_RESOLVE_NOTE = contract.manifest.catalogOnly.resolveNote.replace("{fromApp}", contract.additiveFromApp.catalogOnly);

/** The app's refusal of [value] (a checked resolve answer) from [plugin], or null. */
export function signExportProblem(value, plugin) {
  return value && value.signing && typeof plugin.sign !== "function" ? NO_SIGN_EXPORT : null;
}

/**
 * One `[18+] <title>` line per entry of a checked answer marked `adult` (apiVersion 6): rows' and pages' items,
 * category tiles, live categories and channels. Kino lists those only while the person's 18+ code is unlocked.
 */
export function adultLines(value) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== "object") return;
    if (v.adult === true) out.push(`[18+] ${v.title} (Kino shows it only while the 18+ code is unlocked)`);
    for (const k of ["items", "rows", "categories"]) if (Array.isArray(v[k])) walk(v[k]);
  };
  walk(value);
  return out;
}

/**
 * A checked liveSearch [value] marked 18+ the way the app does (contract.mjs markSearchHits): it reads the plugin's
 * liveCategories (null when that fails or is not exported) only when the apiVersion has 18+ entries.
 */
export async function markLiveSearch(plugin, value, manifest, servers) {
  if (!(manifest.apiVersion >= contract.live.adultApiVersion)) return { value, unmarked: [], unreadable: false };
  let categories = null;
  try {
    if (typeof plugin.liveCategories === "function") categories = checkOutput("liveCategories", await plugin.liveCategories(null), manifest, servers).value.categories;
  } catch { categories = null; }
  return markSearchHits(value, categories, manifest);
}

/** The warning for [marked] (markLiveSearch's answer), or null when every hit is marked. */
export function unmarkedSearchNote(marked) {
  if (!marked.unmarked.length) return null;
  const names = marked.unmarked.slice(0, 5).join(", ") + (marked.unmarked.length > 5 ? "…" : "");
  return marked.unreadable
    ? `liveSearch: your categories couldn't be read (liveCategories failed): Kino treats every result without "adult": false as 18+ (${names})`
    : `liveSearch: ${marked.unmarked.length} result(s) without "adult" or a "categoryId" of your categories, in a plugin with 18+ categories: Kino treats them as 18+ (${names}). Mark them with "adult" or "categoryId"`;
}

function fail(message) {
  stderr(message);
  return 2;
}

export function parseArgs(argv) {
  const opts = { config: {}, record: null, replay: null, raw: false, epg: null, live: false, retry: null, within: null, context: null, device: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") {
      const kv = argv[++i] || "";
      const eq = kv.indexOf("=");
      if (eq <= 0) throw new Error("--config needs key=value");
      opts.config[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--record") opts.record = argv[++i];
    else if (a === "--replay") opts.replay = argv[++i];
    else if (a === "--raw") opts.raw = true;
    else if (a === "--context") {
      let c;
      try { c = JSON.parse(argv[++i] || ""); } catch (e) { throw new Error(`--context needs a JSON object: ${e.message}`); }
      if (c === null || typeof c !== "object" || Array.isArray(c)) throw new Error("--context needs a JSON object");
      opts.context = c;
    }
    else if (a === "--epg") opts.epg = argv[++i];
    else if (a === "--live") opts.live = true;
    else if (a === contract.kinoDevice.kitFlag) {
      const d = argv[++i];
      if (!contract.kinoDevice.values.includes(d)) throw new Error(`${contract.kinoDevice.kitFlag} takes ${contract.kinoDevice.values.join(" or ")}`);
      opts.device = d;
    }
    else if (a === "--within") {
      const ref = argv[++i];
      if (ref === undefined || ref === "") throw new Error("--within needs the browse ref of a \"Ver más\" page");
      opts.within = ref;
    }
    else if (a === "--retry") {
      const [reason, attempt, status, extra] = (argv[++i] || "").split(":");
      const r = contract.output.retry;
      const n = Number(attempt);
      const s = status === undefined ? undefined : Number(status);
      if (extra !== undefined || !r.reasons.includes(reason) || !Number.isInteger(n) || n < 1 || n > r.maxAttempts || (s !== undefined && !r.statuses.includes(s))) {
        throw new Error(`--retry needs reason:attempt[:status], reason ${r.reasons.join("|")}, attempt 1..${r.maxAttempts}, status ${r.statuses.join("|")}`);
      }
      opts.retry = s === undefined ? { reason, attempt: n } : { reason, attempt: n, status: s };
    }
    else rest.push(a);
  }
  return { opts, rest };
}

async function main() {
  // Inside Kino, console.* goes to the log. Keep stdout clean so the JSON result can be piped.
  for (const level of ["log", "info", "warn", "error"]) {
    console[level] = (...args) => stderr(`[console.${level}]`, ...args);
  }
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { return fail(e.message); }
  const { opts, rest: args } = parsed;
  if (args[0] === "live" && args[1] === "playlist") {
    if (!args[2]) return fail(USAGE);
    return livePlaylist(args[2], opts.epg);
  }
  let [targetArg, fn, ...rest] = args;
  if (fn === "live") {
    fn = LIVE[rest[0]];
    rest = rest.slice(1);
  }
  if (!targetArg || !(FUNCTIONS.includes(fn) || SETTINGS_FUNCTIONS.includes(fn) || PANEL_FUNCTIONS.includes(fn) || fn === "sign" || fn === "theme" || Object.values(LIVE).includes(fn))) return fail(USAGE);
  if (opts.record && opts.replay) return fail("--record and --replay can't be used together");
  const target = resolve(targetArg);
  let stat;
  try { stat = statSync(target); } catch { return fail(`not found: ${targetArg}`); }
  const dir = stat.isDirectory() ? target : dirname(target);
  let manifestText;
  try { manifestText = readFileSync(join(dir, "kino-plugin.json"), "utf8"); } catch (e) { return fail(`cannot read kino-plugin.json in ${dir}: ${e.message}`); }
  const checked = validateManifest(manifestText);
  if (!checked.ok) return fail(`kino-plugin.json: ${checked.field}: ${checked.message}`);
  const manifest = checked.manifest;
  const entryPath = resolve(dir, manifest.entry);
  if (!stat.isDirectory() && target !== entryPath) return fail(`${targetArg} is not the manifest's entry (${manifest.entry})`);
  if (fn === "theme") {
    const declared = manifest.theme || {};
    const p = resolvePalette(declared);
    const lines = contract.manifest.theme.tokens.map((k) => `${k.padEnd(11)}${(declared[k] || "-").padEnd(9)}${declared[k] && p.kept.includes(k) ? "used" : "Kino"}`.padEnd(11 + 9 + 6) + `  ${p[k]}`);
    lines.push(`onAccent on accent: ${formatRatio(contrast(p.onAccent, p.accent))}:1`, `accent on background: ${formatRatio(contrast(p.accent, p.background))}:1`, `highlight on background: ${formatRatio(contrast(p.highlight, p.background))}:1`);
    for (const w of p.warnings) lines.push(`warning: ${w}`);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }
  if (fn === "section" && !manifest.section) return fail('the manifest does not declare "section"');
  if (PANEL_FUNCTIONS.includes(fn)) {
    if (!(manifest.apiVersion >= contract.manifest.panel.apiVersion)) return fail(`${fn} needs apiVersion ${contract.manifest.panel.apiVersion} in kino-plugin.json`);
    if (fn !== "playerEvent" && !manifest.panel) return fail('the manifest does not declare "panel": Kino shows no panel button for this plugin');
  }
  if (fn === "categories" && !(manifest.apiVersion >= contract.output.categories.apiVersion && manifest.capabilities.includes("browse"))) return fail("categories needs apiVersion 6 and the browse capability");
  const capability = Object.values(LIVE).includes(fn) ? "channels" : fn === "sign" ? "resolve" : fn === contract.tracking.export ? contract.tracking.capability : fn;
  // `subtitles` may be exported by any plugin without the capability (Kino asks whoever exports it).
  const anyPlugin = contract.capabilities.anyPluginExports.includes(fn);
  if (fn === "meta" && !manifest.capabilities.includes("meta")) return fail(NO_META_CAPABILITY);
  if (!anyPlugin && !SETTINGS_FUNCTIONS.includes(fn) && !PANEL_FUNCTIONS.includes(fn) && fn !== "section" && fn !== "categories" && !manifest.capabilities.includes(capability)) return fail(`the manifest does not declare "${capability}" in capabilities`);
  // "catalogOnly": true (Kino 0.9.54): Kino never calls resolve (nor sign); it still runs here, for the older Kino it serves.
  if (manifest.catalogOnly && capability === "resolve") process.stderr.write(`· ${CATALOG_ONLY_RESOLVE_NOTE}\n`);

  const configFile = join(here, "config.json");
  const config = { ...(existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}), ...opts.config };
  const { kino, servers, resetBudget, saveTape } = createKino(manifest, {
    storageFile: join(dir, ".kino-storage.json"),
    cookiesFile: join(dir, ".kino-cookies.json"),
    secretsFile: join(dir, ".kino-secrets.json"),
    config,
    record: opts.record && resolve(opts.record),
    replay: opts.replay && resolve(opts.replay),
    device: opts.device,
  });
  const missing = (manifest.settings || []).filter((s) => s.required && (kino.config.get(s.key) === undefined || kino.config.get(s.key) === ""));
  if (missing.length && !SETTINGS_FUNCTIONS.includes(fn)) {
    // The app doesn't run a plugin with a required setting empty: it fails with auth_required.
    return fail(`auth_required: set ${missing.map((s) => s.key).join(", ")} with --config key=value or sdk/config.json`);
  }
  if ((fn === "sign" || opts.retry) && !(manifest.apiVersion >= contract.output.signing.apiVersion)) {
    return fail(`${fn === "sign" ? "sign" : "--retry"} needs apiVersion ${contract.output.signing.apiVersion} in kino-plugin.json`);
  }
  if (opts.retry && fn !== "resolve") return fail("--retry only applies to resolve");
  if (opts.within !== null && fn !== "search") return fail("--within only applies to search");
  const scoped = contract.search.scoped;
  if (opts.within !== null && !manifest.capabilities.includes(scoped.capability)) return fail(`--within needs "${scoped.capability}" in capabilities (apiVersion ${scoped.apiVersion})`);
  // sign() runs in its own lane inside the app: no network, storage, cookies or sleep.
  const pluginKino = fn === "sign" ? signingLane(kino) : kino;
  globalThis.kino = pluginKino;

  // The entry runs in a sandbox with only what Kino gives a plugin (sandbox.mjs): a global Node has and Kino lacks is a
  // ReferenceError here too. Without Node's vm modules (the kit imported as a library) it is a plain import and says so.
  try {
    const found = scanMissingGlobals(readFileSync(entryPath, "utf8"));
    missingGlobalLines(found).forEach((l) => stderr(`! ${l}`));
    const loaded = await loadPlugin(entryPath, pluginKino);
    if (!loaded.sandboxed) stderr("· running without the sandbox (KINO_SDK_NO_SANDBOX=1): the plugin can see Node's globals that Kino lacks");
    const plugin = loaded.plugin;
    if (fn === "playerEvent" && typeof plugin[fn] !== "function") return fail(`${manifest.entry} does not export playerEvent(): Kino never calls this plugin for player events (it is optional)`);
    if (typeof plugin[fn] !== "function") return fail(fn === "meta" ? noMetaExport(manifest.entry) : `${manifest.entry} does not export ${fn}()`);
    resetBudget();
    if (fn === "meta") {
      // Built before the call: a bad argument is the command's fault (exit 2), not the plugin's.
      let query;
      try { query = metaArg(rest); } catch (e) { return fail(e.message); }
      stderr(`meta(${JSON.stringify(query)})`);
      const answer = await callMeta(plugin, query);
      saveTape();
      if (opts.raw) { process.stdout.write(JSON.stringify(answer === undefined ? null : answer, null, 2) + "\n"); return 0; }
      return printMeta(answer, query, manifest, servers);
    }
    if (PANEL_FUNCTIONS.includes(fn)) {
      // Built before the call: a bad argument is the command's fault (exit 2), not the plugin's.
      let request;
      try { request = panelRequest(fn, rest, opts.context); } catch (e) { return fail(e.message); }
      const answer = await callPanel(plugin, fn, request);
      saveTape();
      if (opts.raw) { process.stdout.write(JSON.stringify(answer === undefined ? null : answer, null, 2) + "\n"); return 0; }
      return printPanelAnswer(fn, answer, request.context, servers);
    }
    const out = await call(plugin, fn, rest, opts);
    saveTape();
    if (SETTINGS_FUNCTIONS.includes(fn) && !opts.raw) {
      // What the app keeps of the answer (status lines, the action's line, the save's verdict).
      process.stdout.write(JSON.stringify(checkSettingsOutput(fn, out, manifest, undefined, (d) => stderr(`[dropped by Kino] ${d}`)), null, 2) + "\n");
      return 0;
    }
    // A scoped search's null: "I can't search inside this page", and Kino filters the page's titles itself.
    if (opts.within !== null && out === null) {
      process.stdout.write("null\n");
      stderr("null: Kino filters the titles already loaded on that page itself (level 1)");
      return 0;
    }
    if (opts.raw) {
      process.stdout.write(JSON.stringify(out === undefined ? null : out, null, 2) + "\n");
      return 0;
    }
    let checked;
    try {
      checked = checkOutput(fn, out, manifest, servers, { liveChannel: fn === "resolve" && opts.live, migrateInput: fn === "migrate" ? JSON.parse(rest[0] || "null") : null, segmentsQuery: fn === "segments" ? segmentsArg(rest) : null });
    } catch (e) {
      // Refused only by host, and a live channel's ref would pass: say how to check it as one.
      if (fn === "resolve" && !opts.live && manifest.liveStreamHostsAny) {
        try { checkOutput(fn, out, manifest, servers, { liveChannel: true }); stderr("if this ref is a live channel's, try --live"); } catch { /* refused either way */ }
      }
      throw e;
    }
    let { value, drops } = checked;
    drops.forEach((d) => stderr(`[dropped by Kino] ${d}`));
    // A search hit names no listing: Kino decides its 18+ mark from its own marks and your categories.
    if (fn === "liveSearch") {
      const marked = await markLiveSearch(plugin, value, manifest, servers);
      value = marked.value;
      const note = unmarkedSearchNote(marked);
      if (note) stderr(`aviso: ${note}`);
    }
    if (fn === "segments") stderr(`Kino's button: ${JSON.stringify(segmentSkip(value))}`);
    adultLines(value).forEach((l) => stderr(l));
    const noSign = fn === "resolve" ? signExportProblem(value, plugin) : null;
    if (noSign) { stderr(`✗ ${noSign}`); return 1; }
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    if (fn === "resolve") copyLines(value).forEach((l) => stderr(l));
    // Playing a listed channel: its ref goes to resolve() as a live channel's.
    if (fn === "liveChannels" || fn === "liveSearch") {
      const r = await resolveFirstLiveRef(plugin, value, manifest, servers);
      if (r) stderr(r.error ? `resolve(${r.ref}) ✗ ${r.error}` : `resolve(${r.ref}) → ${r.url}`);
      if (r && r.error) return 1;
    }
    // The app downloads each declared playlist itself: do the same, and say what it would show.
    let failed = false;
    for (const p of fn === "liveCategories" ? value.playlists : []) {
      try {
        const s = await loadPlaylist(p, { manifest, servers });
        stderr(`playlist ${p.url}:`);
        summaryLines(s).forEach((l) => stderr(`  ${l}`));
        s.categories.forEach((c) => stderr(`  category ${c.title} (${c.count})`));
        if (s.channels === 0) { failed = true; stderr("  ✗ 0 channels: Kino would show nothing from this list"); }
      } catch (e) {
        failed = true;
        stderr(`playlist ${p.url}: ✗ not downloaded: ${e.message}`);
      }
    }
    return failed ? 1 : 0;
  } catch (e) {
    saveTape();
    if (e && e.metaTimeout) {
      stderr(`✗ ${e.message}`);
      // The plugin's pending work (a fetch, a timer) would keep Node running: the app stopped waiting, so does the kit.
      metaTimedOut = true;
      return 1;
    }
    stderr(e && e.code ? errorReport(e, manifest.name) : e && e.stack ? e.stack : String(e));
    if (fn === "meta") stderr(META_FAILED_IN_APP(manifest.id));
    return 1;
  } finally {
    // nothing to clean up: the sandbox loads the entry from memory
  }
}

/**
 * The copies of a checked `resolve` answer as the player's "Servidor" menu lists them (label, or "Opción N"), each with
 * its host or, for a lazy one, the command that resolves it. Nothing for a Stream with one copy.
 */
export function copyLines(stream) {
  const alts = (stream && Array.isArray(stream.alternatives)) ? stream.alternatives : [];
  if (!alts.length) return [];
  const name = (c, i) => (c.label || `Option ${i + 1}`);
  const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
  const lines = [`copies (${alts.length + 1}), as the Server menu shows them:`];
  lines.push(`  1. ${name(stream, 0)} — ${host(stream.url)}`);
  alts.forEach((a, i) => lines.push(a.ref !== undefined
    ? `  ${i + 2}. ${name(a, i + 1)} — se resuelve al elegirla: resolve ${JSON.stringify(a.ref)}`
    : `  ${i + 2}. ${name(a, i + 1)} — ${host(a.url)}`));
  return lines;
}

/**
 * The first listed channel that plays through a ref (no inline stream), resolved and checked the way
 * the app plays a channel: `{ ref, url }`, `{ ref, error }`, or null when there is none to try.
 */
export async function resolveFirstLiveRef(plugin, page, manifest, servers) {
  const c = (page.items || []).find((x) => x.ref && !x.stream);
  if (!c || typeof plugin.resolve !== "function") return null;
  try {
    const { value } = checkOutput("resolve", await plugin.resolve(c.ref), manifest, servers, { liveChannel: true });
    return { ref: c.ref, url: value.url };
  } catch (e) {
    return { ref: c.ref, error: e && e.code ? `[${e.code}] ${e.message}` : String(e && e.message ? e.message : e) };
  }
}

/** Reads a local file, or downloads an http(s) URL; past `maxBytes` only the start is kept, as the app does. `{ bytes, cut }`. */
async function readSource(src, maxBytes) {
  if (!/^https?:\/\//i.test(src)) return keepStart(readFileSync(src), maxBytes);
  let cut = false;
  const bytes = await download(src, { maxBytes, cut: true, onCut: () => { cut = true; } });
  return { bytes, cut };
}

/** `live playlist`: any M3U list (and, with --epg, its guide) read exactly as Kino would. */
async function livePlaylist(src, epg) {
  try {
    const list = await readSource(src, contract.live.maxPlaylistBytes);
    const s = { ...summarisePlaylist(list.bytes), cut: list.cut };
    const guide = epg ? guideFor(s, (await readSource(epg, contract.live.maxEpgBytes)).bytes) : null;
    if (guide && guide.truncated) stderr("[guide] cut short (byte cap, a cut download or a broken tail): what was read is kept");
    const refusal = guide && guide.refused ? ["The guide declares a DOCTYPE; Kino refuses it for safety"] : [];
    process.stdout.write([...summaryLines(s), ...refusal, ...s.categories.map((c) => `category ${c.title} (${c.count})`), "", ...channelLines(s, { guide })].join("\n") + "\n");
    return s.channels ? 0 : 1;
  } catch (e) {
    return fail(`${src}: ${e.message}`);
  }
}

/**
 * `subtitles()`'s argument as the app's PluginSubtitleSource builds it: `{ imdbId?, tmdbId?, kind, season?, episode?, title?,
 * year?, languages, file? }` (`file: { hash?, size?, name? }` only in the JSON form). [rest]: `tt…` or `tmdb:<id>` (then
 * season and episode for an episode), or the whole object as JSON.
 */
export function subtitlesArg(rest) {
  const arg = String(rest[0] === undefined ? "" : rest[0]).trim();
  const languages = (process.env.KINO_LANGS || "es,en").split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (arg.startsWith("{")) {
    try { return { languages, ...JSON.parse(arg) }; }
    catch (e) { throw new Error(`the subtitles argument starts with { but is not valid JSON: ${e.message}`); }
  }
  const season = Number(rest[1]), episode = Number(rest[2]);
  const out = { kind: season > 0 && episode > 0 ? "series" : "movie", languages };
  if (/^tt\d{5,10}$/.test(arg)) out.imdbId = arg;
  else if (/^tmdb:\d+$/.test(arg)) out.tmdbId = Number(arg.slice(5));
  else throw new Error("subtitles needs an IMDb id (tt…), tmdb:<id> or a JSON object");
  if (out.kind === "series") { out.season = season; out.episode = episode; }
  return out;
}

/**
 * `track()`'s argument as the app's TrackingEvents builds it: `{ id, type, at, kind, ids, title?, year?, show?, season?,
 * episode?, positionMs?, durationMs?, progress?, paused? }`. [rest]: the type, then optional JSON merged over a sample movie
 * (for an episode, pass `kind`, `ids` -- the EPISODE's own --, `show`, `season` and `episode`).
 */
export function trackArg(rest) {
  const type = String(rest[0] === undefined ? "start" : rest[0]).trim();
  if (!contract.tracking.types.includes(type)) throw new Error(`track needs a type: ${contract.tracking.types.join(", ")}`);
  const durationMs = 8_160_000;
  const positionMs = type === "watched" ? durationMs - 120_000 : type === "start" ? 0 : 3_600_000;
  const event = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, type, at: Date.now(), kind: "movie",
    ids: { imdb: "tt0133093", tmdb: 603 }, title: "The Matrix", year: 1999, positionMs, durationMs, progress: positionMs / durationMs,
  };
  const extra = rest[1] === undefined ? "" : String(rest[1]).trim();
  if (!extra) return event;
  try { return { ...event, ...JSON.parse(extra), type }; }
  catch (e) { throw new Error(`the track argument must be a JSON object: ${e.message}`); }
}

/**
 * `segments()`'s argument as the app's Segments.query builds it: `{ kind, ids, show?: { ids }, season?, episode?, durationMs? }`.
 * [rest]: `tt…` (a movie) or `tmdb:<id>` (a movie, or with season and episode the SHOW's id of an episode, whose own ids
 * are then unknown: `ids` empty), an optional durationMs last; or the whole object as JSON.
 */
export function segmentsArg(rest) {
  const arg = String(rest[0] === undefined ? "" : rest[0]).trim();
  if (arg.startsWith("{")) {
    try { return JSON.parse(arg); }
    catch (e) { throw new Error(`the segments argument starts with { but is not valid JSON: ${e.message}`); }
  }
  const id = /^tt\d{5,10}$/.test(arg) ? { imdb: arg } : /^tmdb:\d+$/.test(arg) ? { tmdb: Number(arg.slice(5)) } : null;
  if (!id) throw new Error("segments needs an IMDb id (tt…), tmdb:<id> or a JSON object");
  const nums = rest.slice(1).map(Number);
  const episode = nums.length >= 2 && nums[0] >= 0 && nums[1] > 0;
  const duration = nums[episode ? 2 : 0];
  const out = episode ? { kind: "episode", ids: {}, show: { ids: id }, season: nums[0], episode: nums[1] } : { kind: "movie", ids: id };
  if (Number.isInteger(duration) && duration > 0) out.durationMs = duration;
  return out;
}

// ---------- the player panel (apiVersion 9) ----------

/**
 * One panel call as the app makes it: `{ context, event? }`. [rest] after the function name: `<ref> [tab]` for panel,
 * `<ref> <key> <trigger> ['<value json>'] ['<values json>']` for panelAction (event `{ key, trigger, values, value? }`),
 * `<ref> <type> ['<detail json>']` for playerEvent (event `{ type, ...detail }`: the app puts the detail's keys flat).
 * [over] (`--context`) is merged over the fake context. Throws on a bad argument.
 */
export function panelRequest(fn, rest, over = null) {
  const ref = rest[0] === undefined ? "" : String(rest[0]);
  if (!ref) throw new Error(`${fn} needs the ref of the title that plays`);
  const json = (text, what, shape) => {
    let v;
    try { v = JSON.parse(text); } catch (e) { throw new Error(`the ${what} must be JSON: ${e.message}`); }
    if (shape === "object" && (v === null || typeof v !== "object" || Array.isArray(v))) throw new Error(`the ${what} must be a JSON object`);
    return v;
  };
  if (fn === "panel") {
    const tab = rest[1] === undefined || rest[1] === "" ? {} : { tab: String(rest[1]) };
    return { context: fakeContext(ref, { ...tab, ...(over || {}) }) };
  }
  if (fn === "panelAction") {
    const [, key, trigger, value, values] = rest;
    if (!key) throw new Error("panelAction needs the key of the element");
    if (!TRIGGERS.includes(trigger)) throw new Error(`panelAction needs a trigger: ${TRIGGERS.join(", ")}`);
    const event = actionEvent(String(key), trigger, value === undefined ? undefined : json(value, "value", "any"), values === undefined ? undefined : json(values, "values", "object"));
    return { context: fakeContext(ref, over || {}), event };
  }
  const type = rest[1];
  if (!PLAYER_EVENTS.includes(type)) throw new Error(`playerEvent needs a type: ${PLAYER_EVENTS.join(", ")}`);
  const detail = rest[2] === undefined ? {} : json(rest[2], "detail", "object");
  return { context: fakeContext(ref, over || {}), event: { type, ...detail } };
}

/** The plugin's export called with the app's arguments: `panel(context)`, `panelAction(event, context)`, `playerEvent(event, context)`. */
export async function callPanel(plugin, fn, { context, event }, timeoutMs = contract.timeoutsMs[fn]) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${fn} did not answer within ${timeoutMs / 1000} s: Kino stops waiting${fn === "panel" ? " and shows no panel" : ""}`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => (fn === "panel" ? plugin.panel(context) : plugin[fn](event, context))), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Prints what the app keeps of a panel export's [answer] (`· dropped: <reason>` on stderr, the result on stdout); the exit code. */
function printPanelAnswer(fn, answer, context, servers) {
  const checked = checkPanelOutput(fn, answer, servers, { context, lang: langOf(context) });
  checked.drops.forEach((d) => stderr(`· dropped: ${d}`));
  if (!checked.ok) { stderr("✗ the whole panel is invalid: Kino shows no panel"); return 1; }
  if (fn === "panelAction" && checked.value.patch) stderr("· a patch is applied by Kino only to a key that is on screen; one that names no element is dropped there");
  process.stdout.write(JSON.stringify(checked.value, null, 2) + "\n");
  return 0;
}

// ---------- meta (apiVersion 6) ----------

let metaTimedOut = false;

export const NO_META_CAPABILITY = 'the manifest does not declare "meta" in capabilities: Kino never asks this plugin about a title. Add "meta" (apiVersion 6) and export meta(query)';
export const noMetaExport = (entry) => `${entry} does not export meta(): the manifest declares "meta", so Kino refuses the install (missing meta). Export async function meta({ type, ids, id, lang })`;
/** What the app does with a meta() that throws (TitleMetaProviders.lookup): no answer, a log line, nothing on screen. */
const META_FAILED_IN_APP = (id) => `in the app: no answer and nothing on screen, only a log line ("[${id}] meta failed …"); the page keeps what TMDB and AniList gave`;

const ANIME_PREFIXES = ["kitsu", "mal", "anilist"];

/**
 * `meta()`'s argument as the app's TitleMetaQuery.json builds it: `{ type, ids: { imdb?, tmdb?, kitsu?, mal?, anilist? },
 * id?, lang? }`, keys in that order and only the known ids. [rest]: ids (`tt…`, `tmdb:N`, `kitsu:N`, `mal:N`,
 * `anilist:N`; an anime one is also the query's `id`, the source's own Stremio-style id), `movie` or `series`
 * (default movie), `lang=xx` (default KINO_LANG, else "es") and `id=<source id>`; or the whole object as JSON.
 * Never a ref: Kino describes a title by its ids, whatever source listed it. Throws on anything else, and on a query
 * with no id at all (TitleMetaQuery.isEmpty: Kino asks nobody then).
 */
export function metaArg(rest, env = process.env) {
  const lang = String(env.KINO_LANG || "es").trim();
  const first = String(rest[0] === undefined ? "" : rest[0]).trim();
  let type = "movie", id = "", ids = {};
  let langOut = lang;
  if (first.startsWith("{")) {
    let q;
    try { q = JSON.parse(first); } catch (e) { throw new Error(`the meta argument starts with { but is not valid JSON: ${e.message}`); }
    if (q === null || typeof q !== "object" || Array.isArray(q)) throw new Error("the meta argument must be a JSON object");
    if (q.type !== undefined) type = q.type;
    if (q.ids !== undefined) ids = q.ids;
    if (q.id !== undefined) id = q.id;
    if (q.lang !== undefined) langOut = q.lang;
    if (!["movie", "series"].includes(type)) throw new Error(`meta's "type" is "movie" or "series" (got ${JSON.stringify(type)})`);
    if (ids === null || typeof ids !== "object" || Array.isArray(ids)) throw new Error('meta\'s "ids" is an object: { imdb?, tmdb?, kitsu?, mal?, anilist? }');
    const extra = Object.keys(ids).filter((k) => !["imdb", "tmdb", "kitsu", "mal", "anilist"].includes(k));
    if (extra.length) throw new Error(`Kino never sends ids.${extra.join(", ids.")}: only imdb, tmdb, kitsu, mal and anilist`);
    for (const k of ["tmdb", "kitsu", "mal", "anilist"]) if (ids[k] !== undefined && !(Number.isInteger(ids[k]) && ids[k] > 0)) throw new Error(`ids.${k} is a positive integer (Kino leaves it out otherwise)`);
    if (ids.imdb !== undefined && (typeof ids.imdb !== "string" || !ids.imdb)) throw new Error("ids.imdb is a non-empty string (Kino leaves it out otherwise)");
  } else {
    for (const raw of rest.map((x) => String(x).trim()).filter(Boolean)) {
      const anime = /^(kitsu|mal|anilist):(\d+)$/.exec(raw);
      if (raw === "movie" || raw === "series") type = raw;
      else if (/^tt\d{5,10}$/.test(raw)) ids.imdb = raw;
      else if (/^tmdb:\d+$/.test(raw) && Number(raw.slice(5)) > 0) ids.tmdb = Number(raw.slice(5));
      else if (anime && Number(anime[2]) > 0) { ids[anime[1]] = Number(anime[2]); if (!id) id = raw; }
      else if (raw.startsWith("lang=")) langOut = raw.slice(5);
      else if (raw.startsWith("id=")) id = raw.slice(3);
      else {
        throw new Error(`meta takes a title's ids, not a ref (got ${JSON.stringify(raw)}): Kino calls meta({ type, ids, id?, lang? }) for a title ANY source listed. `
          + "Pass tt…, tmdb:N, kitsu:N, mal:N or anilist:N, then movie|series, or the whole query as JSON");
      }
    }
  }
  // TitleMetaQuery.json: the ids in this order, each only when known; `id` and `lang` only when not empty.
  const ordered = {};
  for (const k of ["imdb", "tmdb", ...ANIME_PREFIXES]) if (ids[k] !== undefined && ids[k] !== "" && ids[k] !== 0) ordered[k] = ids[k];
  const query = { type, ids: ordered };
  if (id) query.id = String(id);
  if (langOut) query.lang = String(langOut);
  if (!Object.keys(ordered).length && !query.id) throw new Error("meta needs at least one id of the title: with none, Kino asks no meta plugin (TitleMetaQuery.isEmpty)");
  return query;
}

/**
 * The query Kino builds for a title a source listed (TitleInfoViewModel.complement), from a checked item: its type, and
 * the `ids.imdb` / `ids.tmdb` it carries (a Kino plugin's title has no source id). Null for a live channel (no info
 * page) or a title with neither id (Kino asks nobody then).
 */
export function metaQueryForItem(item, lang = process.env.KINO_LANG || "es") {
  if (!item || item.kind === "live") return null;
  const ids = {};
  if (item.imdb) ids.imdb = item.imdb;
  if (item.tmdb) ids.tmdb = item.tmdb;
  if (!Object.keys(ids).length) return null;
  return { type: item.kind === "series" ? "series" : "movie", ids, ...(lang ? { lang } : {}) };
}

/** `meta(query)` within the app's limit (timeoutsMs.meta): past it, an error with `metaTimeout` set. */
export async function callMeta(plugin, query, timeoutMs = contract.timeoutsMs.meta) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(
      `meta did not answer within ${timeoutMs / 1000} s: Kino stops waiting and the page stays as TMDB and AniList left it. `
      + "A timeout is not remembered, so the next opening of the page asks again",
    ), { metaTimeout: true })), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => plugin.meta(query)), late]);
  } finally {
    clearTimeout(timer);
  }
}

const VERDICT_MARK = { kept: "✓", cut: "~", "partly kept": "~", dropped: "✗", absent: "·", ignored: "-" };

/** The checked `meta` answer's verdict, one line per field (and one per dropped entry), as printed on stderr. */
export function metaVerdictLines(fields) {
  const width = Math.max(14, ...fields.map((f) => f.field.length));
  const out = [];
  for (const f of fields) {
    out.push(`  ${VERDICT_MARK[f.status] || "?"} ${f.field.padEnd(width)}  ${f.status}: ${f.detail}`);
    (f.items || []).forEach((i) => out.push(`      ${i}`));
  }
  return out;
}

/** formatRuntime's text for [minutes]: "1 h 43 min", "2 h", "45 min". */
const runtimeText = (minutes) => { const h = Math.floor(minutes / 60), m = minutes % 60; return h > 0 && m > 0 ? `${h} h ${m} min` : h > 0 ? `${h} h` : `${m} min`; };
/** Roughly plainSynopsis: tags out, the usual entities decoded, spaces collapsed. */
const plain = (t) => t.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * How the info page would use a kept meta answer [meta] for a title of [query]'s type: each line what Kino shows when
 * TMDB and AniList left that part blank (fillBlanks), in the page's own words where it has them.
 */
export function metaPageLines(meta, query) {
  const m = contract.output.meta;
  const series = query && query.type === "series";
  const out = ["How the info page would use it (only where TMDB and AniList left the part blank; their values always win):"];
  out.push(meta.logo ? `  top: the logo ${meta.logo} instead of the title's name (the name stays for TalkBack and comes back if the image fails)` : "  top: the title's name (no logo)");
  const hero = meta.backdrop || meta.poster;
  out.push(hero ? `  background: ${hero}${meta.backdrop ? "" : " (the poster: no usable backdrop)"}` : "  background: nothing from meta");
  if (meta.poster) out.push(`  poster: ${meta.poster}`);
  const line = [
    ...meta.ratings.map((r) => `${m.ratingLabels[r.source] || r.source} ${r.value}`),
    meta.year || null,
    !series && meta.runtimeMinutes ? runtimeText(meta.runtimeMinutes) : null,
  ].filter(Boolean);
  if (line.length) out.push(`  info line: ★ <the page's score>  ·  ${line.join("  ·  ")}${meta.ratings.some((r) => r.source === "tmdb") ? `  (the ${m.ratingLabels.tmdb} rating is left out when the page already has a score)` : ""}`);
  if (series && meta.runtimeMinutes) out.push(`  runtime: not shown (${meta.runtimeMinutes} min is per episode on a series)`);
  if (meta.overview) { const p = plain(meta.overview); out.push(`  synopsis: ${p.length > 160 ? `${p.slice(0, 159)}…` : p}`); }
  if (meta.genres.length) out.push(`  genres: ${meta.genres.join(", ")}`);
  if (meta.cast.length) {
    const hidden = meta.cast.length - m.pageCastNames;
    out.push(`  Reparto (only when TMDB has no cast): ${meta.cast.slice(0, m.pageCastNames).map((c) => c.name).join(", ")}${hidden > 0 ? `  (+${hidden} kept, not shown)` : ""}${meta.cast.some((c) => c.character || c.photo) ? "; character and photo are kept for later, not shown" : ""}`);
  }
  if (meta.episodes.length) {
    out.push(series
      ? `  episodes: ${meta.episodes.length}: fill a chapter's blank title, overview and still by season and number; they replace the list only when the source's own failed and the source can play an episode by its id${meta.episodes.some((e) => e.season === 0) ? `; season 0 is never listed` : ""}`
      : `  episodes: ${meta.episodes.length}, ignored for a movie`);
  }
  if (meta.title) out.push(`  title: "${meta.title}" is not shown (the page keeps the source's title)`);
  out.push(`Kino asks this plugin only about titles another source listed (never its own), with every other meta plugin at once: the first answer in install order wins, within ${contract.timeoutsMs.meta / 1000} s, remembered ${m.cacheTtlMs / 60000} minutes (${m.maxCachedTitles} titles)`);
  return out;
}

/** Prints a meta answer the way `run.mjs meta` does: raw, verdict, what Kino keeps (stdout) and the page. Exit code. */
function printMeta(answer, query, manifest, servers) {
  stderr("the plugin answered:");
  stderr(JSON.stringify(answer === undefined ? null : answer, null, 2));
  const checked = checkOutput("meta", answer, manifest, servers);
  if (checked.fields.length) {
    stderr("Kino's verdict, field by field:");
    metaVerdictLines(checked.fields).forEach((l) => stderr(l));
  }
  process.stdout.write(JSON.stringify(checked.value, null, 2) + "\n");
  if (checked.value === null) {
    stderr(`no answer: ${checked.noAnswer}. The page stays as TMDB and AniList left it (not a failure)`);
    return 0;
  }
  metaPageLines(checked.value, query).forEach((l) => stderr(l));
  if (manifest.apiVersion >= contract.output.meta.apiVersion && (checked.value.logo || checked.value.ratings.length || checked.value.cast.length)) {
    stderr(`${contract.output.meta.fields.join(", ")} need Kino ${contract.output.meta.fromApp} or newer; an older Kino ignores them and uses the rest`);
  }
  return 0;
}

/** The argument each function gets, exactly as the app builds it. */
export async function call(plugin, fn, rest, opts = {}) {
  const arg = rest[0] === undefined ? "" : rest[0];
  if (fn === "sign") return plugin.sign(JSON.parse(arg));
  if (fn === "resolve" && opts.retry) return plugin.resolve(arg, { retry: opts.retry });
  if (fn === "section") return plugin.section({ tab: arg === "" ? null : arg });
  if (fn === "categories") return plugin.categories(null);
  if (fn === "home") return plugin.home(null);
  if (fn === "browse") return plugin.browse(arg, rest[1] === undefined ? null : rest[1]);
  // apiVersion 3's channels: the same arguments the app's PluginLiveProvider sends.
  if (fn === "liveCategories") return plugin.liveCategories(null);
  if (fn === "liveChannels") return plugin.liveChannels({ categoryId: arg, cursor: rest[1] === undefined ? null : rest[1] });
  if (fn === "liveSearch") return plugin.liveSearch({ query: arg.trim() });
  if (fn === "subtitles") return plugin.subtitles(subtitlesArg(rest));
  if (fn === "track") return plugin.track(trackArg(rest));
  if (fn === "segments") return plugin.segments(segmentsArg(rest));
  if (fn === "meta") return callMeta(plugin, metaArg(rest));
  if (fn === "guide") {
    const from = Date.now() - 2 * 3600 * 1000;
    return plugin.guide({ channelIds: arg ? arg.split(",") : [], from, to: from + contract.live.maxGuideWindowMs });
  }
  if (fn === "migrate") return plugin.migrate(JSON.parse(arg || "null"));
  if (fn === "settingsStatus") return plugin.settingsStatus(null);
  if (fn === "action") return plugin.action(arg);
  if (fn === "validateSettings") {
    try { return plugin.validateSettings(arg ? JSON.parse(arg) : {}); }
    catch (e) { throw new Error(`the validateSettings argument must be a JSON object of setting values: ${e.message}`); }
  }
  if (fn !== "search") return plugin[fn](arg);
  const query = { q: "", type: process.env.KINO_TYPE || "any", season: 0, episode: 0, tmdbId: 0, year: 0, originalTitle: "", altTitles: [], cursor: null };
  // Kino's scoped search (apiVersion 6): always type "any", the "Ver más" page's ref as `within`.
  if (opts.within) Object.assign(query, { type: "any", [contract.search.scoped.field]: opts.within });
  if (arg.trimStart().startsWith("{")) {
    try { Object.assign(query, JSON.parse(arg)); }
    catch (e) { throw new Error(`the search argument starts with { but is not valid JSON: ${e.message}`); }
  } else {
    query.q = arg;
  }
  return plugin.search(query);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
  if (metaTimedOut) setTimeout(() => process.exit(), 100).unref();
}
