#!/usr/bin/env node
// Writes the guide's tables from contract.json, so the numbers people read are the numbers the app
// enforces (a test in the app pins contract.json to its code).
//   node sdk/guide-tables.mjs <guide.md>           rewrite every <!-- contract:NAME:start/end --> block
//   node sdk/guide-tables.mjs <guide.md> --check   exit 1 if a block is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, kb } from "./contract.mjs";

const c = contract;
const n = (x) => x.toLocaleString("en-US");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

// apiVersion 14: the screen kit and the capabilities that go with it.
const S = c.manifest.screen;
const L = S.limits;
const R = c.kinoRoom;
const J = c.kinoJobs;
const A = c.kinoAi;
const SH = c.kinoShared;
const PROP_CANON = Object.fromEntries(Object.entries(S.aliases.props).map(([flutter, old]) => [old, flutter]));
/** The documented (Flutter-style) spelling of a property the contract names by its older name. */
const canon = (p) => PROP_CANON[p] || p;
/** One line per widget, keyed by the older name contract.json lists; a widget without one fails the generator on purpose. */
const WIDGET_TEXT = {
  col: "its children in a column", row: "its children in a row; `wrap: true` is the twelve-column layout", box: "its children stacked on each other",
  card: "Kino's card around its children", spacer: "empty space (`SizedBox` its `width`/`height`, `Spacer` its `flex` share)", divider: "a thin rule",
  scroll: "its children, scrolling", grid: "its children in `columns`", text: "plain text (`text`, `textEn`)",
  image: "an https picture on a public host (`url`, `alt`, `fallback`)", icon: "one of Kino's icons (`name`)", badge: "a small label (`text`)",
  progress: "a progress bar (`value`, `labelText`)", loading: "Kino's spinner (`text`)",
  list: "a lazy list of `items` (nodes), `empty` when there are none, load more", button: "a button (`labelText`, `icon`, `onPressed`, `confirm`, `submit`)",
  textInput: "a text field (`kind`, `maxLength`, `value`, `onSubmitted`; a `trailingIcon` inside it with `trailingLabel` and `onTrailingTap`; `obscureText` masks it)", textArea: "a text field of several lines (`multiline: true` or `maxLines` above 1)",
  dropdown: "a choice among `options`", toggle: "an on/off switch", checkbox: "a check box", radioGroup: "one choice among `options`",
  slider: "a number between `min` and `max` (`step`)", chips: "one or several (`multiple`) choices among `options`",
  tabs: "a row of tabs (`tabs`, `value`, `onChanged`); its value is NOT in `state.inputs`", emptyState: "Kino's empty state (`title`, `text`, `icon`)",
  errorState: "Kino's error state (`title`, `text`, `icon`)", titleCard: "one Home poster card for an `item`",
  titleRail: "a Home row: `title`, `items`, `ref` for its \"Ver más\"", titleGrid: "Home cards in a grid (`items`)",
  heroCard: "a section's banner: `title`, `text`, `image`, at most " + L.maxHeroButtons + " `buttons`",
  popup: "a pop-up declared in the tree (`key`, `kind`), opened with a `ui` operation", form: "fields with one submit, checked by Kino before your code (`onSubmitted`)",
  settings: "Kino's own settings form for your plugin (`keys`, `onSaved`)", banner: "a line of news in a role's colour (`role`, `title`, `text`, `action`, `dismissible`)",
  accordion: "sections that open and close (`key`, `items`, `multiple`)", skeleton: "a placeholder while something loads",
  qr: "a QR code Kino draws on the device (`value`; `expiresInMs` or `expiresAt` with Kino's countdown, `onExpire`, `renewBeforeMs`)", stepper: "a number drawn `[ − ] value [ + ]` (`min`, `max`, `step`, `decimals`, `editable`)",
  table: "a table of `TableRow`s holding `TableCell`s (`text` or `children`, `colSpan`, `crossAxisAlignment`)",
  fab: "Kino's floating button over the screen's bottom (`icon`, `labelText`, `onPressed`), one per screen",
  listTile: "one row of a list: `leading`, `title`, `subtitle`, `trailing`, one press",
  avatar: "a circle with a picture, initials or an icon (`image`, `text`, `icon`, `backgroundColor`)",
  scaffold: "a screen's root with an `appBar`, a `body`, a `floatingActionButton` and a `bottomNavigationBar` (drawn in layout fill)",
  appBar: "a Scaffold's top bar: `title`, `leading`, up to four `actions`, a `bottom` TabBar",
  navigationBar: "a Scaffold's bottom bar of 2 to 5 `items` (`value`, `onChanged`)",
  pageView: "pages swiped across with Kino's dots (`initialPage`, `onPageChanged`, `autoPlayMs`); `viewportFraction` < 1 is a carousel",
  steps: "a setup flow in Kino's look: `items` done, current (open, its `children`) or pending; `onStepTap` lets a done step be pressed",
};
/** Properties a widget takes besides the ones contract.json lists in layoutProps (the d.ts has the rest). */
const WIDGET_PROPS = {
  list: ["onEndReached", "loadingMore", "done", S.listHints.field], titleRail: ["onEndReached", "loadingMore", "done"], titleGrid: ["onEndReached", "loadingMore", "done"],
  popup: ["onClose", "buttons", "items", S.declaredPopups.anchor.field], text: [S.textTime.field, S.textTime.formatField],
  pageView: ["initialPage", "onPageChanged", "autoPlayMs"], avatar: ["backgroundColor"], listTile: ["leading", "trailing", "subtitle"],
  // Screen asks.
  textInput: ["obscureText"], settings: [S.screenAsks.onSavedField], qr: S.screenAsks.qr.fields, steps: ["items", S.screenAsks.steps.onStepTapField],
};
const GO_TEXT = {
  title: "this plugin's title page (`ref`, `kind`; `id`, `title` and `adult` for a title that is not on the canvas)",
  play: "plays this plugin's title (`ref`, `kind`, as `title`)",
  search: `Kino's search with \`q\` (at most ${L.maxSearchQueryChars} characters), only this plugin as the source`,
  browse: "this plugin's \"Ver más\" list for a `ref`",
  section: "this plugin's section",
  categories: "Kino's Categorías with this plugin's group first (its own screen with `screen.replaces`)",
  close: "closes the screen",
  screen: `this plugin's own screen at \`route\` (at most ${L.maxGoRouteChars} characters) with \`args\` (at most ${n(L.maxGoArgsBytes)} bytes of JSON)`,
  titleByIds: "Kino's own title page for TMDB or IMDb ids, where the person picks any of their sources",
  url: "an https link in the browser, after Kino's own confirmation sheet (a QR code on a TV)",
  copy: "Kino puts the plugin's text on the clipboard and always shows its own «Copiado» toast (a TV cannot copy)",
  liveChannel: "the player tunes to an En vivo provider's channel (`provider`, `code`), only for a plugin whose player tab declares `\"kinds\": [\"live\"]`",
};
const CONSENTS = () => [
  ["screen", null], ["library", c.kinoLibrary], ["playerPanelTab", c.manifest.panel.contributes], ["playerControl", c.kinoPlayerControl],
  ["room", R], ["schedule", J], ["ai", A], ["shared", SH],
];
function screenLimitRows() {
  const used = new Set();
  const v = (k) => { used.add(k); return L[k]; };
  const P = c.output.panel.screen;
  const rows = [
    ["A tree", `depth ${v("maxDepth")}, ${v("maxNodes")} nodes (an accordion's header, a table's row and cell count as one each); in a panel in screen mode depth ${P.maxDepth} and ${P.maxNodes} nodes`],
    ["Lists", `${v("maxListItems")} items in a list, rail, grid, accordion or a choice's \`options\`; ${v("maxTitles")} titles in a whole tree, ${v("maxFlatTitles")} in a rail or grid drawn all at once (inside a scroll, a list, a pop-up or a table cell)`],
    ["Texts and keys", `a text ${n(v("maxTextChars"))} characters; \`testKey\` ${v("maxTestKeyChars")}; a text field\'s \`trailingLabel\` ${v("maxTrailingLabelChars")}; a \`ref\` ${n(v("maxRefChars"))}; the menu entry's \`label\` ${S.labelMaxChars}, the settings button's ${S.settingsButtonLabelMaxChars}`],
    ["State", `${kb(v("maxStateBytes"))} as JSON (a bigger patch is refused, the old state kept)`],
    ["Calls", `\`screen\` and \`screenEvent\` ${v("callTimeoutMs") / 1000} s each; events one at a time, at least ${v("minEventIntervalMs")} ms apart, at most ${v("eventQueue")} waiting`],
    ["Answers", `${v("maxUiOps")} \`ui\` operations per action or answer; ${v("maxConfigKeys")} settings per \`config\`; ${v("maxPopups")} pop-up at a time; ${v("maxDialogButtons")} buttons in a dialog; ${v("maxMenuItems")} items in a menu; ${v("maxHeroButtons")} buttons in a \`heroCard\``],
    ["Layout", `\`flex\` 1 to ${v("maxWeight")}; \`columns\` 1 to ${v("maxGridColumns")}; the twelve-column row: ${v("gridColumns")} columns`],
    ["Patterns (forms)", `a pattern at most ${v("maxPatternChars")} characters, a count at most ${n(v("maxPatternRepeat"))}, ${v("maxPatternStates")} steps once counts are expanded (and ${n(v("maxPatternCompileWork"))} units of work to read it); one submit runs at most ${v("maxPatternFields")} patterns and ${n(v("maxPatternMatchWork"))} matcher steps (past either, the rest pass)`],
    ["Timers (`every`)", `${v("maxTimers")} per screen, every ${n(v("minTimerMs"))} ms to ${n(v("maxTimerMs"))} ms (a day); ${v("timerMaxFailures")} failures in a row switch one off; a tick's \`config\` writes a setting at most once every ${v("timerConfigWriteIntervalMs") / 1000} s`],
    ["Toasts", `shown ${n(v("toastMinMs"))} to ${n(v("toastMaxMs"))} ms (default ${n(v("toastDefaultMs"))})`],
    ["`QrImage`", `\`value\` 1 to ${n(v("maxQrChars"))} characters`],
    ["`NumberStepper`", `${v("maxStepperDecimals")} decimals at most; numbers at most ${n(v("maxStepperAbs"))} either way`],
    ["`Skeleton`", `1 to ${v("maxSkeletonLines")} lines`],
    ["`DataTable`", `${v("maxTableRows")} rows, ${v("maxTableColumns")} columns, \`colSpan\` 1 to ${v("maxColSpan")}`],
    ["`go`", `\`route\` ${v("maxGoRouteChars")} characters, \`args\` ${n(v("maxGoArgsBytes"))} bytes; \`titleByIds\`: \`tmdb\` 1 to ${n(S.goTitleByIds.maxTmdb)}, \`season\` 0 to ${S.goTitleByIds.maxSeason}, \`episode\` 1 to ${S.goTitleByIds.maxEpisode}, \`year\` ${S.goTitleByIds.minYear} to ${S.goTitleByIds.maxYear}, \`title\` ${S.goTitleByIds.maxTitleChars}; \`url\`: \`href\` ${n(S.goUrl.maxHrefChars)}, \`title\` ${S.goUrl.maxTitleChars}, one link a second for all plugins and ${S.goUrl.perMinutePerPlugin} a minute per plugin, a QR code up to ${n(S.goUrl.maxQrChars)} characters; \`copy\`: \`text\` ${S.goCopy.maxTextChars} characters in ${S.goCopy.maxLines} lines, \`label\` ${S.goCopy.maxLabelChars}, one copy every ${S.goCopy.minIntervalMs} ms and ${S.goCopy.perMinutePerPlugin} a minute per plugin; at most one page-opening \`go\` every 500 ms`],
    ["Search", `\`q\` ${v("maxSearchQueryChars")} characters`],
  ];
  for (const [k, val] of Object.entries(L)) if (!used.has(k)) rows.push([`\`${k}\``, String(val)]);
  return rows;
}

export const TABLES = {
  limits: () => table(["What", "Limit"], [
    ["Manifest / entry file / icon", `${kb(c.manifest.maxBytes)} / ${kb(c.manifest.entryMaxBytes)} / ${kb(c.manifest.iconMaxBytes)}`],
    ["Memory / stack, per plugin", `${kb(c.runtime.memoryBytes)} / ${kb(c.runtime.stackBytes)}`],
    ["Time per call", `\`search\` ${c.timeoutsMs.search / 1000} s; \`home\`, \`browse\`, \`episodes\`, \`resolve\` ${c.timeoutsMs.home / 1000} s each (\`resolve\` of a plugin Kino itself generates, from a Nuvio scraper or a Stremio addon: ${c.timeoutsMs.nuvioResolve / 1000} s); \`liveCategories\`, \`liveChannels\`, \`guide\` ${c.timeoutsMs.liveChannels / 1000} s each; \`liveSearch\` ${c.timeoutsMs.liveSearch / 1000} s; \`subtitles\` ${c.timeoutsMs.subtitles / 1000} s; \`track\` ${c.timeoutsMs.track / 1000} s (apiVersion ${c.tracking.apiVersion}); \`segments\` ${c.timeoutsMs.segments / 1000} s (apiVersion ${c.segments.apiVersion}); \`meta\` ${c.timeoutsMs.meta / 1000} s (apiVersion ${c.output.meta.apiVersion}; past it, no answer); \`section\`, \`categories\` ${c.timeoutsMs.section / 1000} s each (apiVersion 6); \`details\` ${c.timeoutsMs.details / 1000} s (apiVersion ${c.output.details.apiVersion}); \`migrate\` ${c.timeoutsMs.migrate / 1000} s; \`sign\` ${c.timeoutsMs.sign / 1000} s (and ${c.timeoutsMs.signTotal / 1000} s counting its wait); counting all your fetches and sleeps together, but not the time the person spends answering a host question for that call`],
    ["Loading the module (its top level)", `${c.timeoutsMs.load / 1000} s`],
    ["Idle sandbox", `closed after ${c.runtime.idleCloseMs / 60000} minutes without calls`],
    ["Consecutive timeouts", `${c.runtime.timeoutsBeforeUnresponsive} in a row and Kino disables the plugin ("No responde")`],
    ["`kino.fetch`", `https only (or the person's own server as typed, or \`http\` on a host declared \`insecureHttp\`); ${c.fetch.defaultTimeoutMs / 1000} s default, ${c.fetch.maxTimeoutMs / 1000} s maximum; response body at most ${kb(c.fetch.maxBodyBytes)}; the request (URL, headers and body) at most ${n(c.fetch.maxRequestChars)} characters; inside a sync provider's ${c.fetch.syncCall.functions.map((f) => `\`${f}\``).join(" and ")} only, both the request and the response body may reach the declared blob's base64 plus ${kb(c.fetch.syncCall.envelopeChars)} (ceil(\`sync.maxBlobBytes\` × 4/3) + ${n(c.fetch.syncCall.envelopeChars)}); at most ${c.fetch.maxRequestsPerCall} requests per call, every hop counted, refused ones included (${c.fetch.nuvioMaxRequestsPerCall} for a plugin converted from a Nuvio scraper); at most ${c.fetch.maxInFlight} fetches in flight at once; at most ${c.fetch.maxHostQuestionsPerCall} host questions per call; at most ${c.fetch.maxRedirects} redirects per request; under \`"fetchHosts": "any"\`, a host reached only through it: https on port ${c.fetch.anyHost.port}, a dotted name or public IPv4 address, at most ${c.fetch.anyHost.perSite} requests a minute per site and ${c.fetch.anyHost.perPlugin} every ${c.fetch.anyHost.perPluginWindowMs / 60000} minutes per plugin (${c.fetch.anyHost.nuvioPerSite} / ${n(c.fetch.anyHost.nuvioPerPlugin)} for a converted Nuvio scraper), else \`rate_limited\``],
    ["Cookies", `${c.cookies.maxPerHost} per domain, ${kb(c.cookies.maxTotalBytes)} in total per plugin`],
    ["`kino.storage`", `${kb(c.storage.maxTotalBytes)} per plugin (with \`storageLarge\`, apiVersion ${c.storage.largeApiVersion}: ${kb(c.storage.largeMaxTotalBytes)} in total, ${kb(c.storage.largeMaxValueBytes)} per value, ${n(c.storage.largeMaxKeys)} keys of at most ${c.storage.largeMaxKeyChars} characters); an entry's optional \`ttlMs\` is 1..${n(c.storage.maxTtlMs)} ms (30 days)`],
    ["`kino.sleep`", `0 to ${n(c.sleep.maxMs)} ms per call`],
    [`\`kino.meta\` (Kino ${c.additiveFromApp["kino.meta"]})`, `at most ${c.kinoMeta.perMinute} calls a minute per plugin; ${c.kinoMeta.timeoutMs / 1000} s at most (each other \`meta\` plugin ${c.kinoMeta.providerTimeoutMs / 1000} s), inside your call's own limit; the query at most ${n(c.kinoMeta.maxRequestChars)} characters; the answer at most ${n(c.kinoMeta.maxAnswerChars)} characters; cached ${c.kinoMeta.cacheTtlMs / 60000} minutes`],
    [`\`kino.tmdb\` (Kino ${c.additiveFromApp["kino.tmdb"]})`, `at most ${c.kinoTmdb.perWindow} calls per ${c.kinoTmdb.windowMs / 1000} s per plugin; on Kino's own key at most ${c.kinoTmdb.kinoKeyPerWindow} per ${c.kinoTmdb.windowMs / 1000} s per plugin and ${c.kinoTmdb.kinoKeyGlobalPerWindow} per ${c.kinoTmdb.windowMs / 1000} s for all plugins (then the person's key, else the cache or \`rate_limited\`); ${c.kinoTmdb.timeoutMs / 1000} s per call; a body at most ${kb(c.kinoTmdb.maxBodyBytes)}; at most ${c.kinoTmdb.maxParams} params of at most ${c.kinoTmdb.maxParamValueChars} characters; cached and shared by all plugins, per route (${c.kinoTmdb.cacheTtlByRouteMs.tv / 3600000} hours for a series by id and its seasons and episodes; ${c.kinoTmdb.cacheTtlByRouteMs.stable / 86400000} days for a movie, person or collection by id, any title's credits, images and the like, and for \`/find\`, \`/genre\`, \`/configuration\`; ${c.kinoTmdb.cacheTtlByRouteMs.search / 3600000} hours for \`/search\`; ${c.kinoTmdb.cacheTtlByRouteMs.lists / 3600000} hours for \`/trending\`, \`/discover\` and the lists; ${c.kinoTmdb.cacheTtlMs / 60000} minutes for anything else, an empty answer or a 404), bodies up to ${kb(c.kinoTmdb.maxCachedBodyChars)}; a cached answer does not count against these limits, and when TMDB fails (not when it refuses the key) the last copy is served; not counted in \`kino.fetch\`'s requests per call`],
    ["`kino.crypto`", `data at most ${kb(c.crypto.maxDataBytes)} per call; PBKDF2 at most ${n(c.crypto.pbkdf2MaxIterations)} iterations and ${c.crypto.pbkdf2MaxKeyBytes}-byte keys; \`randomBytes\` at most ${n(c.crypto.randomMaxBytes)}`],
    [`\`kino.ws\` (apiVersion ${c.socket.apiVersion})`, `at most ${c.socket.maxSockets} open sockets per plugin (the fifth is refused with \`limit\`); at most ${c.socket.maxQueuedBytes / 1048576} MiB (${n(c.socket.maxQueuedBytes)} bytes) of received messages queued unread per socket, past that the socket closes with \`limit\`; a frame to send at most ${n(c.socket.maxSendBytes)} bytes once decoded, also when sent as a \`hex\` or \`base64\` string (\`too_large\`); one \`recv\` waits at most ${c.socket.maxRecvMs / 1000} s; \`wss://\` to a declared, approved host only; memory: what is queued unread sits on Kino's heap (up to ${c.socket.maxSockets * c.socket.maxQueuedBytes / 1048576} MiB with every socket full), what you keep from it counts in your ${kb(c.runtime.memoryBytes)} sandbox; not measured on 1 GB TV boxes, so read what arrives and keep little`],
    [`\`byteSource\` (apiVersion ${c.byteSource.apiVersion})`, `at most ${c.byteSource.maxSessions} open streams at once on the device (another is refused), and apart from them at most ${c.byteSource.maxLanSessions} served to TVs (one per Chromecast and DLNA cast); each \`read\` asks for ${c.byteSource.chunkBytes / 1048576} MiB (${n(c.byteSource.chunkBytes)} bytes) at an offset that is a multiple of ${n(c.byteSource.chunkBytes)} (so always a multiple of ${n(c.byteSource.alignmentBytes)}), the last one running past \`size\`; ${c.byteSource.readAheadChunks} chunks ahead are read while one plays; Kino keeps the last ${c.byteSource.cacheChunks} chunks read per stream; \`handle\` 1 to ${c.byteSource.maxHandleChars} characters; memory: each open stream holds up to about ${(c.byteSource.cacheChunks + c.byteSource.readAheadChunks + 1) * c.byteSource.chunkBytes / 1048576} MiB of Kino's heap (the chunks kept, the ones read ahead and the one in flight), so ${c.byteSource.maxSessions} on the device plus ${c.byteSource.maxLanSessions} served to TVs can reach about ${(c.byteSource.maxSessions + c.byteSource.maxLanSessions) * (c.byteSource.cacheChunks + c.byteSource.readAheadChunks + 1) * c.byteSource.chunkBytes / 1048576} MiB, besides your ${kb(c.runtime.memoryBytes)} sandbox; not measured on 1 GB TV boxes`],
    [`\`kino.catalog\` (apiVersion ${c.catalog.apiVersion})`, `at most ${n(c.catalog.maxItems)} items per plugin (then \`limit\`), as long as they fit in the file: about ${Math.round(c.catalog.maxDbBytes / c.catalog.maxItems / 10) * 10} bytes per item on average, so keep \`data\` small; \`id\` 1 to ${c.catalog.maxIdChars} characters, \`title\` at most ${c.catalog.maxTitleChars} characters, \`data\` at most ${n(c.catalog.maxDataBytes)} bytes of JSON; at most ${c.catalog.maxUpsertBatch} items or ids per call; \`search\`: \`q\` at most ${c.catalog.maxQueryChars} characters, \`limit\` default ${c.catalog.defaultSearchLimit}, at most ${c.catalog.maxSearchLimit}, \`offset\` at most ${n(c.catalog.maxOffset)}; the database file at most ${c.catalog.maxDbBytes / 1048576} MiB (then \`limit\`); one SQLite file per plugin, on the device only`],
    [`\`kino.qr.scan\` (apiVersion ${c.qr.apiVersion})`, `one scanner on screen at a time (another scan, from any plugin, is \`busy\`); it closes after ${c.qr.timeoutMs / 1000} s (\`timeout\`); \`title\` and \`titleEn\` at most ${c.qr.maxTitleChars} characters; the scanned text 1 to ${n(c.qr.maxScanChars)} characters (a longer code is ignored); only from a settings \`action\`, a \`panelAction\` or a \`screenEvent\` that follows the person's tap or submit (else \`not_allowed\`), never on a TV or a device without a camera (\`unavailable\`); a settings \`qr\` setting's text at most ${c.qr.settingsQr.maxChars} characters, asked again every ${n(c.qr.settingsQr.minRefreshMs)} to ${n(c.qr.settingsQr.maxRefreshMs)} ms (\`refreshMs\`)`],
    [`Images from the plugin (\`imageSource\`, apiVersion ${c.images.apiVersion})`, `\`handle\` 1 to ${c.images.maxHandleChars} characters, no control character; \`image\` answers at most ${kb(c.images.maxBytes)} once decoded (${n(c.images.maxBytes)} bytes), canonical base64, ${c.images.mimes.map((x) => `\`${x}\``).join(", ")} only; ${c.images.timeoutMs / 1000} s per call; at most ${c.images.maxInFlightPerPlugin} image call in flight per plugin, none while one of your byte streams is open or your \`read\` is queued or running or ended less than ${c.images.readQuietMs / 1000} s ago (an image waits up to ${c.images.maxWaitMs / 1000} s, then is skipped); a timed-out call discards your sandbox (QuickJS cannot be interrupted); a failed handle is not asked again for ${c.images.failureTtlMs / 60000} minutes; ${c.images.pauseAfterTimeouts} timeouts in a row pause your images for ${c.images.pauseMs / 60000} minutes; each image asked once, then kept in Kino's image disk cache per plugin, version and handle`],
    ["`kino.log` / `console.*`",`${n(c.runtime.maxLogChars)} characters per message; when a call of a plugin whose manifest declares \`telemetry\` fails, its last ${c.runtime.reportLogLines} lines (each cut at ${c.runtime.reportLogLineChars} characters, scrubbed, ${n(c.runtime.reportLogChars)} characters in all) go with the failure report`],
    ["What a function returns", `at most ${n(c.output.maxResultChars)} characters once turned into JSON (a sync provider's ${c.fetch.syncCall.functions.map((f) => `\`${f}\``).join(" and ")}: up to ceil(\`sync.maxBlobBytes\` × 4/3) + ${n(c.fetch.syncCall.envelopeChars)}, set by its declared blob)`],
    ["Results", `\`search\` ${c.output.maxSearchItems} items; \`home\` ${c.output.maxHomeRows} rows of ${c.output.maxRowItems}; \`browse\` ${c.output.maxBrowseItems} per page; \`episodes\` ${n(c.output.maxEpisodes)} (and ${c.output.maxSeasons} \`seasons\`); \`ref\` ${n(c.output.maxRefChars)} characters; \`next\` ${n(c.output.maxCursorChars)} characters; \`id\` matches \`${c.output.itemIdPattern}\``],
    ["Live channels (apiVersion 3)", `\`liveCategories\` ${c.live.maxCategories}; \`liveChannels\` ${c.live.maxChannelsPerPage} per page, ${c.live.maxPagesPerCategory} pages at first and ${c.live.pagesPerStep} more per scroll, ${n(c.live.maxChannelsPerCategory)} channels (${c.live.maxTotalPagesPerCategory} pages) per category; \`liveSearch\` ${c.live.maxSearchChannels} channels, asked from ${c.live.minSearchChars} characters; \`guide\` ${c.live.maxGuideChannels} channels and ${c.live.maxGuideWindowMs / 3600000} h per call, ${c.live.maxGuideEntriesPerChannel} entries per channel; \`number\` 1..${c.live.maxChannelNumber}`],
    [`Tracking (apiVersion ${c.tracking.apiVersion})`, `\`progress\` at most every ${c.tracking.progressIntervalMs / 60000} minutes of playback; \`watched\` once, with ${c.tracking.watched.remainingMs / 60000} minutes or less left and at least ${c.tracking.watched.minFraction * 100}% played; at most ${c.tracking.outbox.maxPerPlugin} events waiting per plugin; an event not delivered within ${c.tracking.outbox.maxAgeMs / 86400000} days is dropped; a retryable failure waits ${c.tracking.outbox.backoffBaseMs / 1000} s, doubling up to ${c.tracking.outbox.backoffMaxMs / 3600000} h, ${c.tracking.outbox.maxAttempts} tries at most`],
    ["Settings", `at most ${c.settings.max} with a value, plus at most ${c.settings.ui.maxItems} \`section\`/\`status\`/\`action\`/\`link\`/\`help\` (apiVersion ${c.settings.ui.apiVersion}; \`link\` and \`help\` apiVersion ${c.settings.configAids.apiVersion}, at most ${c.settings.configAids.maxLinks} of each) and \`qr\` (apiVersion ${c.settings.types.qr.apiVersion}); \`text\` ${c.settings.types.text.maxChars}, \`url\` ${n(c.settings.types.url.maxChars)}, \`password\` ${c.settings.types.password.maxChars} characters; a \`link\`'s address ${n(c.settings.configAids.linkUrlMaxChars)}, a \`help\`'s title ${c.settings.configAids.helpTitleMaxChars} and body ${n(c.settings.configAids.helpBodyMaxChars)}`],
    ["Error messages", `your \`kino.error\` message is a detail for the log, cut at ${c.errors.maxMessageChars} characters; a \`userMessage\` for the person is at most ${c.errors.maxUserMessageChars}`],
    ["`hosts`", `at least ${c.manifest.minHosts} entry, no upper limit from Kino ${c.manifest.legacyMaxHosts.noLimitFromApp} (only the manifest's ${kb(c.manifest.maxBytes)}; Kino ${c.manifest.legacyMaxHosts.refusedUpToApp} and older refuse more than ${c.manifest.legacyMaxHosts.value}); from apiVersion ${c.manifest.noHostsApiVersion}, none (\`[]\`) when a \`url\` setting exists`],
    [`\`secrets\` (apiVersion ${c.manifest.secrets.apiVersion})`, `at most ${c.manifest.secrets.maxSecrets}; names match \`${c.manifest.secrets.namePattern}\`; a value is 1..${n(c.manifest.secrets.maxValueBytes)} bytes (1..${n(c.manifest.secrets.largeMaxValueBytes)} from apiVersion ${c.manifest.secrets.largeApiVersion}); from apiVersion ${c.manifest.secrets.typed.apiVersion} a cipher key may be typed: \`{ seal, use: "cipher-key", encoding: "hex" | "base64" }\`, ${c.manifest.secrets.typed.keyBytes.join("/")} bytes`],
    [`\`kino.fetch\` \`maxBytes\` (apiVersion ${c.fetch.maxBytes.apiVersion})`, `${c.fetch.maxBytes.min} to ${n(c.fetch.maxBytes.max)} bytes of the body are read, the answer's \`${c.fetch.maxBytes.field}\` says whether it was cut; out of range: \`invalid_request\``],
    [`Screens (\`screen\`, apiVersion ${S.apiVersion})`, `depth ${L.maxDepth}, ${L.maxNodes} nodes, ${L.maxListItems} items per list, state ${kb(L.maxStateBytes)}, a text ${n(L.maxTextChars)} characters; \`screen\` and \`screenEvent\` ${L.callTimeoutMs / 1000} s each; every number in [Screen limits](#screen-limits)`],
    [`\`kino.library\` (apiVersion ${c.kinoLibrary.apiVersion})`, `\`limit\` default ${c.kinoLibrary.defaultLimit}, at most ${c.kinoLibrary.maxLimit}; at most ${c.kinoLibrary.perMinute} calls a minute per plugin; times rounded to the day, \`progress\` to ${c.kinoLibrary.progressStep}`],
    [`\`kino.room\` (apiVersion ${R.apiVersion})`, `a payload at most ${n(R.limits.maxPayloadBytes)} bytes and ${R.limits.maxPayloadDepth} levels; ${R.limits.perSecond} messages a second, ${R.limits.perMinute} and ${kb(R.limits.bytesPerMinute)} a minute per member; ${R.limits.minMembers} to ${R.limits.maxMembers} members; ${R.limits.minTtlMin} to ${R.limits.maxTtlMin} minutes (default ${R.limits.defaultTtlMin}); mailbox ${R.limits.mailboxEvents} events or ${R.limits.mailboxMs / 60000} minutes; ${R.limits.maxJoined} joined and ${R.limits.maxHosted} hosted per device, ${R.limits.maxSlotsPerPlugin} per plugin; ${R.limits.joinFailuresBeforeLock} wrong codes lock joins for ${R.limits.lockMs / 1000} s, doubling up to ${R.limits.maxLockMs / 60000} minutes; closed after ${R.limits.backgroundCloseMinutes} minutes in the background (a hosted room shows Kino's notification meanwhile)`],
    [`Jobs (\`schedule\`, apiVersion ${J.apiVersion})`, `1 to ${J.manifest.maxJobs} jobs, every ${J.manifest.minEveryMin} to ${n(J.manifest.maxEveryMin)} minutes; one run at most ${J.limits.runTimeoutMs / 1000} s, ${J.limits.maxFetches} requests made one at a time, ${kb(J.limits.maxResponseBytes)} of answers and ${kb(J.limits.maxStorageWriteBytes)} written to \`kino.storage\`; ${J.limits.maxRunsPerDay} runs a day per plugin; a failure waits ${J.limits.backoffBaseMin} minutes, doubling up to ${J.limits.backoffMaxMin / 60} h, and ${J.limits.failuresToPause} in a row pause the job`],
    [`\`kino.ai\` (apiVersion ${A.apiVersion})`, `a prompt at most ${n(A.limits.maxPromptBytes)} bytes, \`system\` ${n(A.limits.maxSystemBytes)}; the reply cut at \`maxChars\` (1 to ${n(A.limits.maxChars)}, default ${n(A.limits.defaultMaxChars)}); ${A.limits.perMinute} asks in any minute, ${A.limits.perDay} a day and ${A.limits.maxInFlight} at a time per plugin; ${A.limits.devicePerDay} a day and ${A.limits.deviceMaxInFlight} at a time for every plugin of the device together; ${A.limits.timeoutMs / 1000} s an ask`],
    [`\`kino.shared\` (apiVersion ${SH.apiVersion})`, `${SH.limits.maxKeys} keys of at most ${SH.limits.maxKeyChars} characters per plugin; a value at most ${kb(SH.limits.maxValueBytes)} and ${SH.limits.maxDepth} levels, ${kb(SH.limits.maxPluginBytes)} in all; ${SH.limits.writesPerMinute} writes a minute; a key's new value travels at most once every ${SH.limits.syncEveryMs / 1000} s`],
  ]),
  screenWidgets: () => table(["Name", "Older name", "What it is", "Its own properties", "As an input"], S.widgets.map((old) => {
    if (!WIDGET_TEXT[old]) throw new Error(`guide-tables: no description for the screen widget ${old}`);
    const names = old === "textArea" ? ["`TextField` (several lines)"] : S.aliases.names.filter((x) => (S.aliases.types[x] ?? x) === old).map((x) => `\`${x}\``);
    const own = [...(S.layoutProps[old] || []).map(canon), ...(WIDGET_PROPS[old] || [])];
    const input = S.inputs.includes(old)
      ? [`value in \`state.inputs\``, S.fieldProps[old]?.length ? `form rules: ${S.fieldProps[old].map((x) => `\`${x}\``).join(", ")}` : "", S.bindHolds[old]?.length ? `\`bind\` holds a ${S.bindHolds[old].map((x) => `\`${x}\``).join(" or ")} setting` : "no `bind`"].filter(Boolean).join("; ")
      : "";
    return [names.join(", ") || `\`${old}\``, `\`${old}\``, WIDGET_TEXT[old], own.map((x) => `\`${x}\``).join(", "), input];
  })),
  screenStyle: () => table(["Property", "Older name", "Values"], S.styleProps.map((p) => {
    const values = {
      padding: `${S.spacingScale.join(", ")}, or per side (\`x\`, \`y\`, \`top\`, \`end\`, \`bottom\`, \`start\`)`,
      margin: `${S.spacingScale.join(", ")}, or per side`,
      gap: S.spacingScale.join(", "),
      radius: `${S.radiusTokens.map((x) => `\`${x}\``).join(", ")}, or per corner (${S.corners.keys.map((x) => `\`${x}\``).join(", ")}; an omitted one \`${S.corners.default}\`)`,
      w: S.sizeScale.join(", "), h: S.sizeScale.join(", "), minH: S.sizeScale.join(", "),
      fill: "`true`: the parent's whole width",
      weight: `1 to ${S.limits.maxWeight}: its share of a \`Row\` or \`Column\``,
      align: "`start`, `center`, `end`, `stretch`: across the main axis (on a `Text`, the paragraph)",
      justify: "`start`, `center`, `end`, `spaceBetween`, `spaceAround`: along the main axis",
      color: S.colorRoles.map((x) => `\`${x}\``).join(", "),
      span: `1 to ${S.limits.gridColumns} or \`"auto"\`, in a \`Row\` with \`wrap: true\``,
      offset: `0 to ${S.limits.gridColumns - 1}, in a \`Row\` with \`wrap: true\``,
      maxWidthFraction: `${S.maxWidthFraction.min} to ${S.maxWidthFraction.max} in steps of ${S.maxWidthFraction.step}: at most that share of the parent's width (exactly, with \`fill\`)`,
      // Task 17.
      alignSelf: "`start`, `center`, `end`, `stretch`: this child across its `Row` or `Column` ([ui.md](ui.md#box-props))",
      textAlign: `${S.boxProps.textAligns.map((x) => `\`${x}\``).join(", ")}: a text's paragraph`,
      border: `\`{ width?, color? }\` on a box: 0 to ${S.boxProps.border.maxWidth} dp, a colour role`,
      elevation: `0 to ${S.boxProps.maxElevation} on a \`Card\` or a \`Stack\`: Kino's shadow`,
      background: "a colour role: a box's fill",
      minWidth: S.sizeScale.join(", "), maxWidth: S.sizeScale.join(", "), maxHeight: S.sizeScale.join(", "),
      positioned: "`{ top?, left?, right?, bottom?, width?, height? }` on a `Stack` child, dp or `\"25%\"` ([ui.md](ui.md#positioned))",
      opacity: "0 to 1 ([ui.md](ui.md#animate))",
      animate: "`{ duration?, curve? }`: changes glide ([ui.md](ui.md#animate))",
    }[p] || "see `kino.d.ts`";
    const name = canon(p);
    return [`\`${name}\``, name === p ? "" : `\`${p}\``, values];
  })),
  screenGo: () => table(["`go`", "What opens", "Sent from"], S.goShapes.map((g) => {
    if (!GO_TEXT[g]) throw new Error(`guide-tables: no description for the go shape ${g}`);
    const from = g === "titleByIds" || g === "url" || g === "copy" || g === "liveChannel"
      ? `only the person's own ${S.goUrl.fromTriggers.join(" or ")} (a tap, a submit, the answer to one, a pop-up's button, a panel press)`
      : g === "screen" ? "a tap, or an answer, the answer to the reserved `open` included (never a timer's or a pop-up's `onClose`)" : "a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`)";
    return [`\`${g}\``, GO_TEXT[g], from];
  })),
  screenLimits: () => table(["What", "Limit"], screenLimitRows()),
  screenConsents: () => table(["Capability", "What the person reads", "Red, waits for approval", "The person's switch (your tab in Ajustes)"], CONSENTS().map(([cap, block]) => [
    `\`${cap}\``,
    block?.consentLine ? `"${block.consentLine.es}" ("${block.consentLine.en}")` : "nothing: no line of its own",
    c.capabilities.needsApproval.includes(cap) ? "yes" : "no",
    block?.switchLabel ? `"${block.switchLabel.es}" ("${block.switchLabel.en}")` : "none",
  ])),
  settings: () => table(["type", "value", "can be `required`", "can have a `default`", "longest value"], Object.entries(c.settings.types).map(([t, v]) => [
    `\`${t}\``,
    t === "toggle" ? "`true` / `false`" : t === "select" ? "one of the `options` values" : t === "list" ? "a list of entries, each an object of the list's `fields`" : v.hasValue === false ? `none (apiVersion ${v.apiVersion})` : "text",
    v.canBeRequired ? "yes" : v.hasValue === false ? "no (holds no value)" : "no (always has a value)",
    v.canHaveDefault ? "yes" : t === "list" || v.hasValue === false ? "no" : "no (use `hint` for an example)",
    v.maxChars ? `${n(v.maxChars)} characters` : "—",
  ])),
  crypto: () => table(["Function", "Algorithms"], [
    ["`hash`, `hmac`", c.crypto.hashes.map((x) => `\`${x}\``).join(", ")],
    ["`encrypt`, `decrypt`", c.crypto.ciphers.map((x) => `\`${x}\``).join(", ")],
    ["`pbkdf2`", c.crypto.pbkdf2Hashes.map((x) => `\`${x}\``).join(", ")],
    ["encodings", c.crypto.encodings.map((x) => `\`${x}\``).join(", ")],
    [`\`generateKeyPair\` (apiVersion ${c.crypto.keyPairs.apiVersion})`, `${c.crypto.keyPairs.types.map((x) => `\`${x}\``).join(", ")}; \`ec\` on ${c.crypto.keyPairs.curves.map((x) => `\`${x}\``).join(", ")}; at most ${c.crypto.keyPairs.maxKeysPerRuntime} private keys alive per runtime (a new one drops the oldest)`],
    [`\`sign\`, \`verify\` (apiVersion ${c.crypto.keyPairs.apiVersion})`, `ECDSA with ${c.crypto.keyPairs.signHashes.map((x) => `\`${x}\``).join(", ")} as ${c.crypto.keyPairs.signatureFormats.map((x) => `\`${x}\``).join(" or ")}; Ed25519; a signature at most ${c.crypto.keyPairs.maxSignatureBytes} bytes`],
    [`\`importKey\`, \`deriveSharedSecret\` (apiVersion ${c.crypto.keyPairs.apiVersion})`, `public keys as ${c.crypto.keyPairs.importFormats.map((x) => `\`${x}\``).join(", ")}; ECDH (same curve) and X25519`],
  ]),
  errors: () => table(["`kino.error` code", "What the person sees"], [
    ["`auth_required`", "\"Configura {plugin} en Ajustes ▸ {plugin}\" when your plugin declares settings (its own tab in Ajustes), else \"Configura {plugin} en Ajustes ▸ Plugins\" (\"Menú ▸ Plugins\" on the phone), with a button to its Configurar screen"],
    ["`not_found`", "\"No se encontró en {plugin}\""],
    ["`geo_blocked`", "\"Este contenido no está disponible en tu región\""],
    ["`rate_limited`", "\"{plugin} está limitando las peticiones; intenta en unos minutos\""],
    ["`unavailable`", "\"{plugin} no está disponible ahora\""],
  ].filter(([code]) => c.errors.codes.includes(code.replace(/`/g, "")))),
  fetchErrors: () => table(["`e.code`", "When"], [
    ["`host_not_allowed`", "the host (or a redirect hop) is not one you declared or the person typed, or it is `http` on a declared host not marked `insecureHttp`; under `\"fetchHosts\": \"any\"`, a host reached only through it over `http`, on a port other than 443, or a single-label name"],
    ["`timeout`", "no complete answer within `timeoutMs`"],
    ["`network`", "the connection failed, or too many redirects"],
    ["`too_large`", "the request over the size cap, or a body over 5 MB"],
    ["`invalid_request`", "a bad URL, method, `redirect` or `body`, or more requests than a call allows"],
    ["`rate_limited`", `under \`"fetchHosts": "any"\`, too many requests to hosts reached only through it: more than ${c.fetch.anyHost.perSite} a minute to one site or ${c.fetch.anyHost.perPlugin} every ${c.fetch.anyHost.perPluginWindowMs / 60000} minutes in all (${c.fetch.anyHost.nuvioPerSite} and ${c.fetch.anyHost.nuvioPerPlugin.toLocaleString("en-US")} for a plugin converted from a Nuvio scraper)`],
  ].filter(([code]) => c.fetch.errorCodes.includes(code.replace(/`/g, "")))),
};

export function render(text) {
  return text.replace(/<!-- contract:(\w+):start -->[\s\S]*?<!-- contract:\1:end -->/g, (block, name) => {
    if (!TABLES[name]) throw new Error(`unknown table ${name}`);
    return `<!-- contract:${name}:start -->\n${TABLES[name]()}\n<!-- contract:${name}:end -->`;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node sdk/guide-tables.mjs <guide.md> [--check]");
    process.exitCode = 2;
  } else {
    const text = readFileSync(file, "utf8");
    const out = render(text);
    if (flag === "--check") {
      if (out !== text) { console.error(`${file}: the contract tables are out of date; run node sdk/guide-tables.mjs ${file}`); process.exitCode = 1; }
    } else {
      writeFileSync(file, out);
    }
  }
}
