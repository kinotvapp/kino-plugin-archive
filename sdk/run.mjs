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
// The panel in screen mode (Task 8i, apiVersion 14): `panel` reads a result with format "screen" as the app does (the screen
//   tree with the panel's limits) and anything else as the legacy panel; an apiVersion 14 plugin's fake context also carries
//   `state` (--state merges over it) and `size`. A screen-mode panelAction takes --screen: <name> instead of <key>, the event
//   `{ trigger, name, arg?, value?, values }`, and the answer read as a screen-mode one (state, toast, ui, config, go...)
//   node sdk/run.mjs [--context '<json>'] [--state '<json>'] <plugin dir> panel <ref> [tab]
//   node sdk/run.mjs [--context '<json>'] [--state '<json>'] --screen <plugin dir> panelAction <ref> <name> <press|change|submit> ['<value json>'] ['<arg>']
// A tab the plugin contributes to ANOTHER plugin's title (Task 8k, "panel": { "contributes": true } + playerPanelTab): --foreign
//   <source plugin id>[:<name>] makes every panel, panelAction and playerEvent context the app's foreign one (an opaque ref,
//   foreign: true, source: { pluginId, name }, no copy label, no autoNext) and says what the app drops of the answer.
//   node sdk/run.mjs --foreign latino:Latino <plugin dir> panel <the owner's ref>
// The same tab on an En vivo channel (Task 11, "kinds": ["live"]): --live-channel <provider>:<code>[:<name>] makes every panel
//   and panelAction context the app's live one ({ kind: "live", live: true, channel, foreign, source }, no position, no ref),
//   drops every player action (live_channel) and refuses playerEvent (Kino sends none on live). The ref argument is ignored.
//   node sdk/run.mjs --live-channel tdt:la1:La 1 <plugin dir> panel -
// Who may move the player (Task 8j, contract.kinoPlayerControl): every panel export's `player` is sifted as the app does, by its
//   origin (panel: the result's own, panelAction: the trigger, playerEvent: the event) and the playerControl capability (granted
//   when the manifest declares it, unless KINO_PLAYER_CONTROL_REVOKED=1); what is dropped is printed, and so is the notice Kino
//   shows the person for an action it took by itself.
// Plugin screens (apiVersion 14, the "screen" capability): the fake context is a phone at compact width with an empty state;
//   --context '<json>' merges over it, --state '<json>' merges over its state. screen prints the validated tree; screenEvent runs
//   the export (the first call of a real session is the reserved event `open`) and prints the validated answer. --trigger
//   says what set the event off in the app (tap by default, change, submit): a tap or submit is the person's press (what
//   kino.qr.scan needs); a change is not, and its go.titleByIds / go.url is dropped
//   node sdk/run.mjs [--context '<json>'] [--state '<json>'] <plugin dir> screen
//   node sdk/run.mjs [--context '<json>'] [--state '<json>'] <plugin dir> screenEvent <name> [arg] ['<value json>'] [--trigger tap|change|submit]
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
//   KINO_NUVIO_FIXTURE=<file.json>  kino.nuvio (Kino 0.9.71, apiVersion 11, capability "nuvio") answers from it: the Nuvio repositories the
//                                   manifest names, each with the scrapers it offers and what each answers for a title
//                                   ({ "owner/repo": { "available": [...], "streams": { "<scraper id>": { "movie:603": {...} } } } });
//                                   without it kino.nuvio answers `unavailable`: the kit has no scrapers, only the app runs them
//   (samples: docs/plugins/fixtures/kino-services/ in Kino's repository)
// kino.ai.ask (apiVersion 14, capability "ai", contract.kinoAi) answers with the app's gates (only after the person's press in
//   screenEvent / panelAction --screen / action, or in a job run, where each ask is one of the run's requests) through a fake AI:
//   KINO_AI_REPLY=<text>            the reply every ask gets (else a canned sentence, or "{}" when json: true is asked)
//   KINO_AI_ERROR=<code>            every ask fails with that code (unavailable, rate_limited, too_large, timeout, refused)
//   KINO_AI_REVOKED=1               the person switched it off: every ask is refused
// kino.shared (apiVersion 14, capability "shared", contract.kinoShared) is simulated on two devices, "phone" and "tv", kept in
//   .kino-shared.json next to kino-plugin.json: a run uses the --device one (default phone) and, when it ends, the two sync (what
//   is due: a key travels at most once a minute). So `job --device phone` then `screen --device tv` shows what the TV reads.
//   `node sdk/run.mjs <folder> shared` prints what each device holds.
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
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkOutput, checkSettingsOutput, contract, featureApiVersion, liveChannelGoOf, liveChannelGoRefusal, markSearchHits, maskSetPasswords, readRangeProblem, segmentSkip, validateManifest } from "./contract.mjs";
import { contrast, formatRatio, resolvePalette } from "./palette.mjs";
import { askImage, askRead, createKino, errorReport, signingLane } from "./kino-shim.mjs";
import { loadPlugin, missingGlobalLines, scanMissingGlobals } from "./sandbox.mjs";
import { kitScreenCall } from "./kit-call.mjs";
import { actionEvent, checkPanelOutput, contributesLive, contributesPanel, fakeContext, foreignAnswerDrops, foreignContext, foreignEventDetail, gatePlayer, langOf, liveAnswerDrops, liveContext, panelPlayerOf, PLAYER_EVENTS, playerNotice, siftPlayer, TRIGGERS } from "./panel.mjs";
import { answerFields, checkPanelScreen, checkPanelScreenAnswer, checkScreenAnswer, checkScreenTree, fakePanelScreenContext, fakeScreenContext, fakeScreenEvent, isPanelScreen, LIMITS as SCREEN_LIMITS, PANEL_SCREEN, panelAnswerFields, printScreenTree } from "./screen.mjs";
import { channelLines, download, guideFor, keepStart, loadPlaylist, summarisePlaylist, summaryLines } from "./live-playlist.mjs";
import { jobBudget, jobContext, jobKino, runJob } from "./job.mjs";
import { createSharedDevices } from "./shared.mjs";

const FUNCTIONS = ["search", "home", "browse", "episodes", "resolve", "migrate", "section", "categories", "subtitles", "track", "segments", "meta"];
// apiVersion 6's settings form: not capabilities, so no capability check; the app runs them even before a required setting is typed.
const SETTINGS_FUNCTIONS = ["settingsStatus", "action", "validateSettings"];
// apiVersion 9's player panel: not capabilities either (the manifest's "panel" decides), and Kino calls them with a context.
const PANEL_FUNCTIONS = ["panel", "panelAction", "playerEvent"];
// apiVersion 14's screen canvas: the manifest's "screen" block decides, and Kino calls them with a context or an event.
const SCREEN_FUNCTIONS = ["screen", "screenEvent"];
/** What set off a screen event in the app (ScreenEventKind): the person's tap, a field's change, or a submit. */
export const SCREEN_EVENT_TRIGGERS = ["tap", "change", "submit"];

/**
 * Task 8p: whether the app runs screenEvent [name], set off by [trigger], as the person's own press (PersonPressPluginCall,
 * what kino.qr.scan needs): a tap or a submit, never the reserved open and never a change.
 */
export function screenEventIsPress(name, trigger = "tap") {
  return name !== "open" && trigger !== "change";
}
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
  + "       node sdk/run.mjs [--context '<json>'] [--state '<json>'] --screen <plugin folder> panelAction <ref> <name> <press|change|submit> ['<value json>'] ['<arg>']\n"
  + "       node sdk/run.mjs --foreign <source plugin id>[:<name>] <plugin folder> <panel | panelAction | playerEvent> <ref> ...\n"
  + "       node sdk/run.mjs --live-channel <provider>:<code>[:<name>] <plugin folder> <panel | panelAction> - ...\n"
  + "       node sdk/run.mjs [--context '<json>'] [--state '<json>'] <plugin folder> <screen | screenEvent <name> [arg] ['<value json>'] [--trigger tap|change|submit]>\n"
  + "       node sdk/run.mjs [--size <bytes>] <plugin folder> read <handle> <offset> <length>   (byteSource: one range, as Kino's proxy asks it)\n"
  + "       node sdk/run.mjs [--out <file>] <plugin folder> image <handle>   (imageSource: the picture, written to a file)\n"
  + "       node sdk/run.mjs [--context '<json>'] <plugin folder> job [jobId] [scheduled|manual]   (schedule: one background run, with Kino's caps)\n"
  + "       node sdk/run.mjs <plugin folder> shared   (kino.shared: what the simulated phone and tv hold)\n"
  + "       node sdk/run.mjs live playlist <url|file> [--epg <url|file>]\n"
  + "       env: KINO_META_FIXTURE=<json> (kino.meta), KINO_TMDB_KEY=<your TMDB key> or KINO_TMDB_FIXTURE=<json> (kino.tmdb), KINO_NUVIO_FIXTURE=<json> (kino.nuvio)";
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
  const opts = { config: {}, record: null, replay: null, raw: false, epg: null, live: false, retry: null, within: null, context: null, state: null, device: null, size: null, out: null, screen: false, foreign: null, liveChannel: null, trigger: null };
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
    else if (a === "--screen") opts.screen = true;
    else if (a === "--foreign") {
      // Task 8k: the plugin whose title plays (its public id and name): the context is a contributed panel's.
      const v = argv[++i] || "";
      const colon = v.indexOf(":");
      const pluginId = colon < 0 ? v : v.slice(0, colon);
      if (!new RegExp(contract.manifest.idPattern).test(pluginId)) throw new Error("--foreign needs the id of the plugin whose title plays (and :<name>)");
      opts.foreign = { pluginId, name: colon < 0 ? pluginId : v.slice(colon + 1) };
    }
    else if (a === "--live-channel") {
      // Task 11: the En vivo channel on screen, as the provider plugin lists it: the context is a live tab's.
      const [provider, code, ...name] = (argv[++i] || "").split(":");
      const L = contract.manifest.screen.goLiveChannel;
      if (!new RegExp(L.providerPattern).test(provider || "") || !new RegExp(L.codePattern).test(code || "")) {
        throw new Error("--live-channel needs <provider plugin id>:<channel id>[:<name>]");
      }
      opts.liveChannel = { provider, code, name: name.length ? name.join(":") : code };
    }
    else if (a === "--size") {
      const n = Number(argv[++i]);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error("--size needs the stream's whole length in bytes (a positive whole number)");
      opts.size = n;
    }
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--trigger") {
      const t = argv[++i];
      if (!SCREEN_EVENT_TRIGGERS.includes(t)) throw new Error(`--trigger takes ${SCREEN_EVENT_TRIGGERS.join(", ")}`);
      opts.trigger = t;
    }
    else if (a === "--context") {
      let c;
      try { c = JSON.parse(argv[++i] || ""); } catch (e) { throw new Error(`--context needs a JSON object: ${e.message}`); }
      if (c === null || typeof c !== "object" || Array.isArray(c)) throw new Error("--context needs a JSON object");
      opts.context = c;
    }
    else if (a === "--state") {
      let c;
      try { c = JSON.parse(argv[++i] || ""); } catch (e) { throw new Error(`--state needs a JSON object: ${e.message}`); }
      if (c === null || typeof c !== "object" || Array.isArray(c)) throw new Error("--state needs a JSON object");
      opts.state = c;
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
  if (fn === "read" || fn === "image") return bytesCommand(fn, targetArg, rest, opts);
  if (fn === contract.kinoJobs.export) return jobCommand(targetArg, rest, opts);
  if (fn === "shared") return sharedCommand(targetArg);
  if (!targetArg || !(FUNCTIONS.includes(fn) || SETTINGS_FUNCTIONS.includes(fn) || PANEL_FUNCTIONS.includes(fn) || SCREEN_FUNCTIONS.includes(fn) || fn === "sign" || fn === "theme" || Object.values(LIVE).includes(fn))) return fail(USAGE);
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
  // A screen declared through an apiVersion 14 enhancement counts (featureApiVersion): only an older Kino skips it.
  if (SCREEN_FUNCTIONS.includes(fn) && !(featureApiVersion(manifest) >= contract.manifest.screen.apiVersion && manifest.screen)) return fail(`the manifest does not declare "screen" (apiVersion ${contract.manifest.screen.apiVersion}, or an "enhancements" block for it, and the "screen" capability with its "screen" block): Kino shows no screen for this plugin`);
  if (fn === "categories" && !(manifest.apiVersion >= contract.output.categories.apiVersion && manifest.capabilities.includes("browse"))) return fail("categories needs apiVersion 6 and the browse capability");
  const capability = Object.values(LIVE).includes(fn) ? "channels" : fn === "sign" ? "resolve" : fn === contract.tracking.export ? contract.tracking.capability : fn;
  // `subtitles` may be exported by any plugin without the capability (Kino asks whoever exports it).
  const anyPlugin = contract.capabilities.anyPluginExports.includes(fn);
  if (fn === "meta" && !manifest.capabilities.includes("meta")) return fail(NO_META_CAPABILITY);
  if (!anyPlugin && !SETTINGS_FUNCTIONS.includes(fn) && !PANEL_FUNCTIONS.includes(fn) && !SCREEN_FUNCTIONS.includes(fn) && fn !== "section" && fn !== "categories" && !manifest.capabilities.includes(capability)) return fail(`the manifest does not declare "${capability}" in capabilities`);
  // "catalogOnly": true (Kino 0.9.54): Kino never calls resolve (nor sign); it still runs here, for the older Kino it serves.
  if (manifest.catalogOnly && capability === "resolve") process.stderr.write(`· ${CATALOG_ONLY_RESOLVE_NOTE}\n`);

  const configFile = join(here, "config.json");
  const config = { ...(existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}), ...opts.config };
  const sharedDevices = kitSharedDevices(dir);
  const { kino, servers, resetBudget, saveTape, writeConfig } = createKino(manifest, {
    shared: sharedDevices.of(kitDevice(opts)),
    storageFile: join(dir, ".kino-storage.json"),
    cookiesFile: join(dir, ".kino-cookies.json"),
    secretsFile: join(dir, ".kino-secrets.json"),
    config,
    record: opts.record && resolve(opts.record),
    replay: opts.replay && resolve(opts.replay),
    device: opts.device,
    callFunction: fn,
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
      if (opts.foreign && !contributesPanel(manifest)) {
        return fail(`--foreign: the manifest does not declare "panel": { "contributes": true } with the "${contract.manifest.panel.contributes.capability}" capability: Kino adds no tab of this plugin to other plugins' titles`);
      }
      if (opts.liveChannel && !contributesLive(manifest)) {
        return fail(`--live-channel: the manifest's contributed panel does not declare "kinds": ["live"] (with "contributes": true and the "${contract.manifest.panel.contributes.capability}" capability): Kino adds no tab of this plugin to an En vivo channel`);
      }
      if (opts.liveChannel && fn === "playerEvent") return fail("--live-channel: Kino sends no playerEvent on an En vivo channel (there is no plugin title to feed it)");
      if (opts.liveChannel && opts.foreign) return fail("--live-channel and --foreign do not go together");
      const foreign = opts.foreign ? { contributorId: manifest.id, ...opts.foreign } : null;
      try { request = panelRequest(fn, rest.length ? rest : ["-"], opts.context, { apiVersion: manifest.apiVersion, screen: opts.screen, state: opts.state, foreign, liveChannel: opts.liveChannel }); } catch (e) { return fail(e.message); }
      // Task 8p: a screen-mode panelAction runs as the app marks it: the person's press for a press or submit trigger.
      const answer = fn === "panelAction" && opts.screen
        ? await kitScreenCall.run({ press: contract.qr.screenTriggers.includes(request.event.trigger), tick: false }, () => callPanel(plugin, fn, request))
        : await callPanel(plugin, fn, request);
      saveTape();
      // Task 11: on a live channel every player action is dropped whole, and go.title/play as for any contributed tab.
      if (opts.liveChannel && answer && typeof answer === "object") {
        for (const line of liveAnswerDrops(answer)) stderr(`· dropped: ${line}`);
        liveChannelGoLine(answer.go, manifest, fn === "panelAction" ? request.event.trigger : "refresh");
        if (!opts.raw) delete answer.player;
      }
      // A contributed panel's answer: what the app drops of it (go.title/play; its player is sifted below).
      if (foreign && fn !== "panel" && answer && typeof answer === "object") {
        for (const line of foreignAnswerDrops({ ...answer, player: undefined }, fn === "panelAction" ? request.event.trigger : null)) stderr(`· dropped: ${line}`);
      }
      // Task 8j: who may move the player, by origin and the playerControl capability.
      if (!opts.liveChannel) playerControlLines(fn, answer, request, { contributed: !!foreign, manifest });
      if (opts.raw) { process.stdout.write(JSON.stringify(answer === undefined ? null : answer, null, 2) + "\n"); return 0; }
      return printPanelAnswer(fn, answer, request.context, servers, { apiVersion: manifest.apiVersion, screen: opts.screen, settings: manifest.settings });
    }
    if (SCREEN_FUNCTIONS.includes(fn)) {
      // Built before the call: a bad argument is the command's fault (exit 2), not the plugin's.
      let request;
      if (opts.trigger !== null && fn !== "screenEvent") return fail("--trigger only applies to screenEvent");
      try { request = screenRequest(fn, rest, opts); } catch (e) { return fail(e.message); }
      if (opts.trigger !== null && request.event.name === "open") return fail("--trigger does not apply to open: Kino sends it itself, never as a press");
      const trigger = opts.trigger ?? "tap";
      // Task 8p: a screen's call as the app marks it: the person's press for a tap or a submit, never open or a change.
      const answer = await kitScreenCall.run({ press: fn === "screenEvent" && screenEventIsPress(request.event.name, trigger), tick: false }, () => callScreen(plugin, fn, request));
      saveTape();
      if (opts.raw) { process.stdout.write(JSON.stringify(answer === undefined ? null : answer, null, 2) + "\n"); return 0; }
      return printScreenAnswer(fn, answer, request.context, manifest, writeConfig, fn === "screenEvent" ? { name: request.event.name, trigger } : null);
    }
    const out = await call(plugin, fn, rest, opts);
    saveTape();
    if (SETTINGS_FUNCTIONS.includes(fn) && !opts.raw) {
      // What the app keeps of the answer (status lines, the action's line, the save's verdict).
      // A password the action fills is printed masked: Kino never shows nor logs it.
      process.stdout.write(JSON.stringify(maskSetPasswords(checkSettingsOutput(fn, out, manifest, undefined, (d) => stderr(`[dropped by Kino] ${d}`), fn === "action" ? rest[0] : null), manifest), null, 2) + "\n");
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
export function panelRequest(fn, rest, over = null, { apiVersion = 0, screen = false, state = null, foreign = null, liveChannel = null } = {}) {
  const r = panelRequestOf(fn, rest, over, { apiVersion, screen, state });
  // Task 11: a tab on an En vivo channel: the live context (PanelContextJson's live shape), the session's own parts kept.
  if (liveChannel) return { ...r, context: liveContext(liveChannel, r.context) };
  if (!foreign) return r;
  // Task 8k: the context a contributed panel gets for another plugin's title (PanelForeign.applyTo).
  const out = { ...r, context: foreignContext(r.context, foreign.contributorId, { pluginId: foreign.pluginId, name: foreign.name }) };
  if (fn === "playerEvent") out.event = { type: r.event.type, ...foreignEventDetail(r.event.type, (({ type, ...d }) => d)(r.event)) };
  return out;
}

function panelRequestOf(fn, rest, over, { apiVersion = 0, screen = false, state = null }) {
  const ref = rest[0] === undefined ? "" : String(rest[0]);
  // Task 8i: a plugin that may answer the screen format (apiVersion 14) gets the screen-mode context: `state` and `size` too.
  const screenFormat = apiVersion >= PANEL_SCREEN.apiVersion;
  const withScreen = (context) => {
    if (!screenFormat) return context;
    const ctx = fakePanelScreenContext(context);
    if (state) ctx.state = { ...ctx.state, ...state };
    return ctx;
  };
  if (!ref) throw new Error(`${fn} needs the ref of the title that plays`);
  const json = (text, what, shape) => {
    let v;
    try { v = JSON.parse(text); } catch (e) { throw new Error(`the ${what} must be JSON: ${e.message}`); }
    if (shape === "object" && (v === null || typeof v !== "object" || Array.isArray(v))) throw new Error(`the ${what} must be a JSON object`);
    return v;
  };
  if (fn === "panel") {
    const tab = rest[1] === undefined || rest[1] === "" ? {} : { tab: String(rest[1]) };
    return { context: withScreen(fakeContext(ref, { ...tab, ...(over || {}) })) };
  }
  if (fn === "panelAction" && screen) {
    if (!screenFormat) throw new Error(`--screen needs apiVersion ${PANEL_SCREEN.apiVersion} in kino-plugin.json (the panel's screen format)`);
    const [, name, trigger, value, arg] = rest;
    if (!name) throw new Error("panelAction --screen needs the event name of the node");
    if (!PANEL_SCREEN.triggers.includes(trigger)) throw new Error(`panelAction --screen needs a trigger: ${PANEL_SCREEN.triggers.join(", ")}`);
    const context = withScreen(fakeContext(ref, over || {}));
    const event = {
      trigger, name: String(name), ...(arg !== undefined ? { arg: String(arg) } : {}),
      ...(value !== undefined ? { value: json(value, "value", "any") } : {}), values: context.state.inputs ?? {},
    };
    return { context, event };
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

/**
 * Task 8j: what the app does with the `player` of a panel export's [answer] (a `panel` result's own, a `panelAction`'s, a
 * `playerEvent`'s): the drops of PlayerControlRules.sift on stderr, and the notice Kino shows when it acts by itself.
 * playerControl counts as granted when the manifest declares it, unless KINO_PLAYER_CONTROL_REVOKED=1 (the person refused it
 * or switched it off).
 */
function playerControlLines(fn, answer, request, { contributed = false, manifest }) {
  if (!answer || typeof answer !== "object" || answer.player === undefined || answer.player === null) return;
  const player = panelPlayerOf(JSON.parse(JSON.stringify(answer.player)), () => {});
  if (!player) return;
  const origin = fn === "panel" ? "refresh" : fn === "playerEvent" ? "event" : request.event.trigger;
  if (!contract.kinoPlayerControl.origins.includes(origin)) return;
  const control = (manifest.capabilities || []).includes(contract.kinoPlayerControl.capability) && process.env.KINO_PLAYER_CONTROL_REVOKED !== "1";
  const sifted = siftPlayer(player, origin, { contributed, control }, (line) => stderr(`· dropped: ${line}`));
  if (sifted?.announce) {
    const notice = playerNotice(manifest.name, sifted.action, langOf(request.context));
    if (notice) stderr(`· Kino tells the person: ${notice}`);
  }
}

/**
 * Prints what the app keeps of a panel export's [answer] (`· dropped: <reason>` on stderr, the result on stdout); the exit
 * code. A `panel` result in the screen format (Task 8i) is read as the app does: the tree with the panel's limits; a
 * `panelAction --screen` answer as a screen-mode one.
 */
function printPanelAnswer(fn, answer, context, servers, { apiVersion = 0, screen = false, settings } = {}) {
  const lang = langOf(context);
  const value = answer === undefined ? null : answer;
  if (fn === "panel") {
    const notes = [];
    if (isPanelScreen(JSON.parse(JSON.stringify(value)), apiVersion, (l) => notes.push(l))) {
      const r = checkPanelScreen(value, lang, { settings });
      r.dropped.forEach((d) => stderr(`· dropped: ${d}`));
      if (!r.panel) { stderr("✗ the whole panel is invalid: Kino shows no panel"); return 1; }
      const { root, ...drawer } = r.panel;
      process.stdout.write(JSON.stringify({ format: PANEL_SCREEN.format, ...drawer, root: printScreenTree(root) }, null, 2) + "\n");
      return 0;
    }
    notes.forEach((d) => stderr(`· ${d}`));
  }
  if (fn === "panelAction" && screen) {
    const r = checkPanelScreenAnswer(value, lang, { settings });
    r.dropped.forEach((d) => stderr(`· dropped: ${d}`));
    if (!r.answer) { stderr("✗ the answer is not an object: Kino counts a failure"); return 1; }
    const kept = Object.fromEntries(panelAnswerFields(r.answer).map((f) => [f, r.answer[f]]));
    urlGoLine(r.answer.go);
    if (kept.player) kept.player = gatePlayer(kept.player, context, (d) => stderr(`· dropped: ${d}`));
    process.stdout.write(JSON.stringify(kept, null, 2) + "\n");
    return 0;
  }
  const checked = checkPanelOutput(fn, answer, servers, { context, lang, apiVersion });
  checked.drops.forEach((d) => stderr(`· dropped: ${d}`));
  if (!checked.ok) { stderr("✗ the whole panel is invalid: Kino shows no panel"); return 1; }
  if (fn === "panelAction" && checked.value.patch) stderr("· a patch is applied by Kino only to a key that is on screen; one that names no element is dropped there");
  if (fn === "panelAction" && checked.value.url) urlGoLine({ url: checked.value.url });
  if (fn === "panelAction" && checked.value.copy) copyGoLine({ copy: checked.value.copy });
  process.stdout.write(JSON.stringify(checked.value, null, 2) + "\n");
  return 0;
}

// ---------- plugin screens (apiVersion 14) ----------

/**
 * Task 8x: what the app does with a kept `go.copy` [go]: Kino copies the text itself (only after a tap or submit) and always
 * shows its own toast, «Copiado» or «Copiado: <label>»; a TV refuses with «No se puede copiar en este aparato».
 */
function copyGoLine(go) {
  if (!go || !go.copy) return;
  const shown = go.copy.label ? `Copiado: ${go.copy.label}` : "Copiado";
  stderr(`· go.copy: Kino copies ${go.copy.text.length} characters${go.copy.sensitive ? " (hidden from the clipboard preview on Android 13+)" : ""} and shows its own toast "${shown}"; only after a tap or submit, one copy every 500 ms and 20 a minute; a TV refuses ("No se puede copiar en este aparato")`);
}

/**
 * Task 11: what the app does with a `go.liveChannel` in [go] (raw or kept) from [manifest]'s plugin for an event of [trigger]:
 * refused (said, false) without the person's press or a contributed tab that joins live channels; else Kino tunes (true).
 */
function liveChannelGoLine(go, manifest, trigger) {
  if (!go || typeof go !== "object" || go.liveChannel === undefined) return false;
  const g = liveChannelGoOf(go.liveChannel, () => {});
  if (!g) return false;
  const why = liveChannelGoRefusal(manifest, trigger);
  if (why !== null) {
    const said = why === "not_press" ? "only the person's own tap or submit tunes a channel" : 'the plugin\'s contributed panel must declare "kinds": ["live"] (with the playerPanelTab capability)';
    stderr(`· dropped: go.liveChannel (${why}): ${said}`);
    return false;
  }
  stderr(`· go.liveChannel: Kino tunes to ${g.provider}:${g.code} (an installed, usable En vivo provider that is not 18+ while locked; an 18+ channel fails closed: not found); in the player panel on a live channel it changes in place, elsewhere the player opens it`);
  return true;
}

/**
 * Task 8s: what the app does with a kept `go.url` [go]: nothing opens by itself. Kino asks the person in its own sheet (its
 * heading, your plugin's name, the host), only after their tap or submit and within 5 s of it, at most one link a second and
 * 10 a minute; a TV shows a QR code. Fix round 1 (M1): the screen [answer]'s own pop-ups and `open` operations beside it are
 * dropped by the app, said here.
 */
function urlGoLine(go, answer = null) {
  copyGoLine(go);
  if (!go || !go.url) return;
  const host = go.url.href.slice("https://".length).split(/[/?#]/)[0];
  stderr(`· go.url: Kino asks the person first in its own sheet ("Abrir un enlace", "Lo pide: <your plugin's name>", ${host}); it opens only on their Abrir, and only after a tap or submit answered within 5 s (never from open, a timer, a load-more, a change or a playerEvent); a TV shows a QR code instead`);
  if (!answer) return;
  for (const f of ["dialog", "sheet", "menu"]) if (answer[f]) stderr(`· dropped: screen: answer.${f} beside a go.url is dropped (nothing covers Kino's link sheet)`);
  for (const op of answer.ui || []) if (op && op.open !== undefined) stderr(`· dropped: screen: answer.ui open "${String(op.open).slice(0, 40)}" beside a go.url is dropped (nothing covers Kino's link sheet)`);
}

/**
 * One screen call as the app makes it: `{ context }` for `screen`, `{ context, event }` for `screenEvent`. [opts] carries
 * `--context` (merged over the fake context) and `--state` (merged over its state). [rest] for screenEvent:
 * `<name> [arg] [value json]`. Throws on a bad argument.
 */
export function screenRequest(fn, rest, { context = null, state = null } = {}) {
  const ctx = fakeScreenContext(context || {});
  if (state) ctx.state = { ...ctx.state, ...state };
  if (fn === "screen") return { context: ctx };
  const [name, arg, value] = rest;
  if (!name) throw new Error("screenEvent needs the name of the event (the first call of a real session is `open`)");
  let parsed;
  if (value !== undefined) {
    try { parsed = JSON.parse(value); } catch (e) { throw new Error(`the value must be JSON: ${e.message}`); }
  }
  return { context: ctx, event: fakeScreenEvent(String(name), { arg: arg === undefined || arg === "" ? undefined : String(arg), value: parsed, state: ctx.state, route: ctx.route, device: ctx.device, lang: ctx.lang }) };
}

/** The plugin's export called with the app's arguments: `screen(context)` or `screenEvent(event)`, within the app's 20 s. */
export async function callScreen(plugin, fn, { context, event }, timeoutMs = SCREEN_LIMITS.callTimeoutMs) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${fn} did not answer within ${timeoutMs / 1000} s: Kino stops waiting and shows the screen's error state`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => (fn === "screen" ? plugin.screen(context) : plugin.screenEvent(event))), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prints what the app keeps of a screen export's [answer] (`· dropped: <reason>` on stderr, the result on stdout); the exit
 * code. An answer's `config` is checked against the manifest's settings and what Kino would write is said and written into the
 * kit's settings ([writeConfig]), as the app writes it into the plugin's real settings.
 */
function printScreenAnswer(fn, answer, context, manifest, writeConfig = () => {}, event = null) {
  const lang = langOf(context);
  // As the app: a series title is kept only from a plugin that declares episodes; binds and config meet its settings.
  const opts = { allowSeries: (manifest?.capabilities ?? []).includes("episodes"), settings: manifest?.settings ?? [] };
  if (fn === "screen") {
    const checked = checkScreenTree(answer, lang, undefined, opts);
    checked.dropped.forEach((d) => stderr(`· dropped: ${d}`));
    if (!checked.tree) { stderr("✗ the whole screen is invalid: Kino shows its error state with a close button"); return 1; }
    process.stdout.write(JSON.stringify(printScreenTree(checked.tree), null, 2) + "\n");
    return 0;
  }
  const checked = checkScreenAnswer(answer, lang, opts);
  checked.dropped.forEach((d) => stderr(`· dropped: ${d}`));
  if (!checked.answer) { stderr("✗ the answer is invalid: Kino ignores it"); return 1; }
  // Task 11: a go.liveChannel: honoured only after the person's own tap or submit, for a plugin whose tab joins live channels.
  if (checked.answer.go?.liveChannel && !liveChannelGoLine(checked.answer.go, manifest, event ? (event.trigger === "tap" ? "press" : event.trigger) : "open")) delete checked.answer.go;
  // As the app (Task 8m, 8s): a change's go.titleByIds or go.url is dropped; only the person's own tap opens one.
  const go = checked.answer.go;
  if (event && event.trigger === "change" && go && (go.titleByIds || go.url)) {
    const link = !!go.url;
    stderr(`· dropped: screen: answer.${link ? "go.url" : "go.titleByIds"} to "${event.name.slice(0, 40)}" (a change) is dropped: only the person's own tap opens ${link ? "a link" : "a title page"}`);
    delete checked.answer.go;
  }
  urlGoLine(checked.answer.go, checked.answer);
  if (checked.answer.config) {
    // Screen asks: a password written from a screen is never printed (Kino never logs it either), only that it is set.
    const isPassword = (k) => (manifest.settings || []).some((s) => s.key === k && s.type === "password");
    for (const [k, v] of Object.entries(checked.answer.config)) stderr(`· Kino writes the setting ${k} = ${v === null ? "(emptied, back to its default)" : isPassword(k) ? "(a password, never shown)" : JSON.stringify(v)} (the same store and sync as its settings screen)`);
    for (const line of writeConfig(checked.answer.config) || []) stderr(`· dropped: ${line}`);
    checked.answer = { ...checked.answer, config: Object.fromEntries(Object.entries(checked.answer.config).map(([k, v]) => [k, v !== null && isPassword(k) ? "(a password, never shown)" : v])) };
  }
  // An answer with no ui operations prints without them, as one with none of the other fields (Task 7i-2).
  const { ui, ...rest } = checked.answer;
  process.stdout.write(JSON.stringify(printScreenTree(ui.length > 0 ? checked.answer : rest), null, 2) + "\n");
  if (answerFields(checked.answer).length === 0) stderr("· an empty answer: Kino does nothing");
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
/**
 * `read <handle> <offset> <length>` (byteSource) and `image <handle>` (imageSource): the plugin's export called through the
 * shim exactly as Kino calls it (askRead / askImage: the same gates, range rules, timeout and answer checks). `read` prints
 * the bytes' count, sha256 and first 32 bytes; without --size it takes the stream as long as the range (so it expects exactly
 * `length` bytes). `image` writes the picture to --out (default image.<jpg|png|webp> in the plugin folder).
 */
/**
 * `job [jobId] [scheduled|manual]` (apiVersion 14, capability "schedule", Task 8q): one run of a manifest job as Kino makes it in
 * the background: job(ctx) with the job's context (--context merges lastRunMs and attempt), a `kino` whose fetch and storage
 * count against the run's caps and whose forbidden APIs reject with not_allowed, cut at the first cap or the time limit. Kino
 * never reads the answer: the kit prints only how the run went and what it spent.
 */
async function jobCommand(targetArg, rest, opts) {
  if (!targetArg) return fail(USAGE);
  const J = contract.kinoJobs;
  const target = resolve(targetArg);
  let stat;
  try { stat = statSync(target); } catch { return fail(`not found: ${targetArg}`); }
  const dir = stat.isDirectory() ? target : dirname(target);
  let manifestText;
  try { manifestText = readFileSync(join(dir, "kino-plugin.json"), "utf8"); } catch (e) { return fail(`cannot read kino-plugin.json in ${dir}: ${e.message}`); }
  const checked = validateManifest(manifestText);
  if (!checked.ok) return fail(`kino-plugin.json: ${checked.field}: ${checked.message}`);
  const manifest = checked.manifest;
  // Task 18 (G1): an older apiVersion's `schedule` and `jobs` added by an apiVersion 14 enhancement count (featureApiVersion).
  if (!(featureApiVersion(manifest) >= J.apiVersion && manifest.capabilities.includes(J.capability) && (manifest.jobs || []).length)) {
    return fail(`job needs the "${J.capability}" capability and a "${J.manifest.field}" list at apiVersion ${J.apiVersion} (or in an "enhancements" block for it) in kino-plugin.json`);
  }
  const [idArg, reasonArg] = rest;
  const job = idArg === undefined ? manifest.jobs[0] : manifest.jobs.find((j) => j.id === idArg);
  if (!job) return fail(`no job "${idArg}" in kino-plugin.json (${manifest.jobs.map((j) => j.id).join(", ")})`);
  const reason = reasonArg ?? J.reasons[0];
  if (!J.reasons.includes(reason)) return fail(`a job runs ${J.reasons.join(" or ")}`);
  const over = opts.context || {};
  const ctx = jobContext(job.id, reason, {
    lastRunMs: Number.isInteger(over.lastRunMs) ? over.lastRunMs : null,
    attempt: Number.isInteger(over.attempt) && over.attempt >= 1 ? over.attempt : 1,
  });
  const configFile = join(here, "config.json");
  const config = { ...(existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}), ...opts.config };
  const sharedDevices = kitSharedDevices(dir);
  const { kino, saveTape } = createKino(manifest, {
    storageFile: join(dir, ".kino-storage.json"), cookiesFile: join(dir, ".kino-cookies.json"), secretsFile: join(dir, ".kino-secrets.json"),
    config, record: opts.record && resolve(opts.record), replay: opts.replay && resolve(opts.replay), device: opts.device, callFunction: J.export,
    shared: sharedDevices.of(kitDevice(opts)),
  });
  const budget = jobBudget();
  const wrapped = jobKino(kino, budget, (line) => stderr(`· ${line}`));
  globalThis.kino = wrapped;
  const plugin = (await loadPlugin(resolve(dir, manifest.entry), wrapped)).plugin;
  if (typeof plugin[J.export] !== "function") return fail(`${manifest.entry} does not export ${J.export}(): Kino refuses to install a "${J.capability}" plugin without it`);
  stderr(`job(${JSON.stringify(ctx)})`);
  const r = await runJob(plugin, ctx, budget);
  saveTape();
  const label = job.label + (job.labelEn ? ` / ${job.labelEn}` : "");
  if (job.runOn === "preferPhone") stderr(`· runOn "preferPhone": in Kino ONE of the person's linked devices runs it, a phone first; share the result with kino.shared (this run: the simulated ${kitDevice(opts)})`);
  stderr(`${label}: every ${job.everyMin} min by default (the person picks among ${job.everyOptions.join(", ")}); each job starts off until the person turns it on`);
  process.stdout.write(JSON.stringify({ ok: r.ok, failure: r.failure, ms: r.ms, fetches: budget.fetches, bytes: budget.bytes, stored: budget.stored }, null, 2) + "\n");
  if (!r.ok) stderr(`✗ ${r.failure}: Kino counts this run as a failure (${J.limits.failuresToPause} in a row pause the job until the person acts)`);
  stderr("· Kino never reads what job() returns: keep what you fetched in kino.storage and read it when your screen opens");
  return r.ok ? 0 : 1;
}

/** What kino.device says in this run (run.mjs --device, else KINO_DEVICE, else phone): the simulated device kino.shared uses. */
function kitDevice(opts) {
  const d = opts.device || process.env[contract.kinoDevice.kitEnv] || contract.kinoDevice.default;
  return d === "tv" ? "tv" : "phone";
}

/** The two simulated devices of kino.shared, synced and saved when this run ends (a key travels at most once a minute). */
function kitSharedDevices(dir) {
  const devices = createSharedDevices({ file: join(dir, ".kino-shared.json") });
  process.once("exit", () => { try { devices.sync(); devices.save(); } catch { /* the kit's own file: never fail the run */ } });
  return devices;
}

/** `shared`: what each simulated device holds for this plugin (values are JSON text, as Kino keeps them). */
function sharedCommand(targetArg) {
  if (!targetArg) return fail(USAGE);
  const target = resolve(targetArg);
  let stat;
  try { stat = statSync(target); } catch { return fail(`not found: ${targetArg}`); }
  const dir = stat.isDirectory() ? target : dirname(target);
  let manifestText;
  try { manifestText = readFileSync(join(dir, "kino-plugin.json"), "utf8"); } catch (e) { return fail(`cannot read kino-plugin.json in ${dir}: ${e.message}`); }
  const checked = validateManifest(manifestText);
  if (!checked.ok) return fail(`kino-plugin.json: ${checked.field}: ${checked.message}`);
  const manifest = checked.manifest;
  if (!manifest.capabilities.includes(contract.kinoShared.capability)) stderr(`· the manifest does not declare "${contract.kinoShared.capability}": Kino answers every kino.shared call with not_allowed`);
  const devices = createSharedDevices({ file: join(dir, ".kino-shared.json") });
  const out = {};
  for (const name of ["phone", "tv"]) {
    const d = devices.of(name);
    out[name] = Object.fromEntries(d.keys(manifest.id).map((k) => [k, JSON.parse(d.get(manifest.id, k))]));
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  stderr("· another device wrote these values: validate them before you use them");
  return 0;
}

async function bytesCommand(fn, targetArg, rest, opts) {
  if (!targetArg) return fail(USAGE);
  const target = resolve(targetArg);
  let stat;
  try { stat = statSync(target); } catch { return fail(`not found: ${targetArg}`); }
  const dir = stat.isDirectory() ? target : dirname(target);
  let manifestText;
  try { manifestText = readFileSync(join(dir, "kino-plugin.json"), "utf8"); } catch (e) { return fail(`cannot read kino-plugin.json in ${dir}: ${e.message}`); }
  const checked = validateManifest(manifestText);
  if (!checked.ok) return fail(`kino-plugin.json: ${checked.field}: ${checked.message}`);
  const manifest = checked.manifest;
  const [handle, offsetArg, lengthArg] = rest;
  if (typeof handle !== "string" || !handle) return fail(USAGE);
  let offset = 0, length = 0, size = 0;
  if (fn === "read") {
    const cap = contract.byteSource;
    if (!(manifest.apiVersion >= cap.apiVersion && manifest.capabilities.includes("byteSource"))) return fail(`read needs the "byteSource" capability at apiVersion ${cap.apiVersion} in kino-plugin.json`);
    offset = Number(offsetArg);
    length = Number(lengthArg);
    size = opts.size ?? (Number.isSafeInteger(offset) && Number.isSafeInteger(length) ? offset + length : NaN);
    const problem = readRangeProblem(offset, length, size);
    if (problem) return fail(`read: Kino never asks this range: ${problem}`);
  } else if (!(manifest.apiVersion >= contract.images.apiVersion && manifest.capabilities.includes(contract.images.capability))) {
    return fail(`image needs the "${contract.images.capability}" capability at apiVersion ${contract.images.apiVersion} in kino-plugin.json`);
  }
  const configFile = join(here, "config.json");
  const config = { ...(existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}), ...opts.config };
  const { kino, saveTape } = createKino(manifest, {
    storageFile: join(dir, ".kino-storage.json"), cookiesFile: join(dir, ".kino-cookies.json"), secretsFile: join(dir, ".kino-secrets.json"),
    config, record: opts.record && resolve(opts.record), replay: opts.replay && resolve(opts.replay), device: opts.device,
  });
  globalThis.kino = kino;
  const loaded = await loadPlugin(resolve(dir, manifest.entry), kino);
  const plugin = loaded.plugin;
  try {
    if (fn === "read") {
      const stream = { source: contract.byteSource.source, handle, size, mime: "application/octet-stream" };
      const bytes = await askRead(plugin, manifest, stream, offset, length);
      saveTape();
      const sha = createHash("sha256").update(bytes).digest("hex");
      process.stdout.write(`read ${JSON.stringify(handle)} at ${offset}, ${length} asked: ${bytes.length} bytes\nsha256 ${sha}\nfirst ${Math.min(32, bytes.length)}: ${bytes.subarray(0, 32).toString("hex")}\n`);
      if (opts.size === null) stderr("· without --size the stream is taken as ending at offset + length: Kino would also accept a shorter final chunk");
      return 0;
    }
    const img = await askImage(plugin, manifest, { source: contract.images.source, handle });
    saveTape();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[img.mime] || "bin";
    const out = resolve(opts.out || join(dir, `image.${ext}`));
    writeFileSync(out, img.bytes);
    process.stdout.write(`image ${JSON.stringify(handle)}: ${img.mime}, ${img.bytes.length} bytes -> ${out}\n`);
    return 0;
  } catch (e) {
    stderr(`${fn}: ${e && e.message}`);
    return 1;
  }
}

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
