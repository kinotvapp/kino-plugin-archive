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

export const TABLES = {
  limits: () => table(["What", "Limit"], [
    ["Manifest / entry file / icon", `${kb(c.manifest.maxBytes)} / ${kb(c.manifest.entryMaxBytes)} / ${kb(c.manifest.iconMaxBytes)}`],
    ["Memory / stack, per plugin", `${kb(c.runtime.memoryBytes)} / ${kb(c.runtime.stackBytes)}`],
    ["Time per call", `\`search\` ${c.timeoutsMs.search / 1000} s; \`home\`, \`browse\`, \`episodes\`, \`resolve\` ${c.timeoutsMs.home / 1000} s each (\`resolve\` of a plugin Kino itself generates, from a Nuvio scraper or a Stremio addon: ${c.timeoutsMs.nuvioResolve / 1000} s); \`liveCategories\`, \`liveChannels\`, \`guide\` ${c.timeoutsMs.liveChannels / 1000} s each; \`liveSearch\` ${c.timeoutsMs.liveSearch / 1000} s; \`subtitles\` ${c.timeoutsMs.subtitles / 1000} s; \`track\` ${c.timeoutsMs.track / 1000} s (apiVersion ${c.tracking.apiVersion}); \`segments\` ${c.timeoutsMs.segments / 1000} s (apiVersion ${c.segments.apiVersion}); \`meta\` ${c.timeoutsMs.meta / 1000} s (apiVersion ${c.output.meta.apiVersion}; past it, no answer); \`section\`, \`categories\` ${c.timeoutsMs.section / 1000} s each (apiVersion 6); \`details\` ${c.timeoutsMs.details / 1000} s (apiVersion ${c.output.details.apiVersion}); \`migrate\` ${c.timeoutsMs.migrate / 1000} s; \`sign\` ${c.timeoutsMs.sign / 1000} s (and ${c.timeoutsMs.signTotal / 1000} s counting its wait); counting all your fetches and sleeps together, but not the time the person spends answering a host question for that call`],
    ["Loading the module (its top level)", `${c.timeoutsMs.load / 1000} s`],
    ["Idle sandbox", `closed after ${c.runtime.idleCloseMs / 60000} minutes without calls`],
    ["Consecutive timeouts", `${c.runtime.timeoutsBeforeUnresponsive} in a row and Kino disables the plugin ("No responde")`],
    ["`kino.fetch`", `https only (or the person's own server as typed, or \`http\` on a host declared \`insecureHttp\`); ${c.fetch.defaultTimeoutMs / 1000} s default, ${c.fetch.maxTimeoutMs / 1000} s maximum; response body at most ${kb(c.fetch.maxBodyBytes)}; the request (URL, headers and body) at most ${n(c.fetch.maxRequestChars)} characters; at most ${c.fetch.maxRequestsPerCall} requests per call, every hop counted, refused ones included (${c.fetch.nuvioMaxRequestsPerCall} for a plugin converted from a Nuvio scraper); at most ${c.fetch.maxInFlight} fetches in flight at once; at most ${c.fetch.maxHostQuestionsPerCall} host questions per call; at most ${c.fetch.maxRedirects} redirects per request; under \`"fetchHosts": "any"\`, a host reached only through it: https on port ${c.fetch.anyHost.port}, a dotted name or public IPv4 address, at most ${c.fetch.anyHost.perSite} requests a minute per site and ${c.fetch.anyHost.perPlugin} every ${c.fetch.anyHost.perPluginWindowMs / 60000} minutes per plugin (${c.fetch.anyHost.nuvioPerSite} / ${n(c.fetch.anyHost.nuvioPerPlugin)} for a converted Nuvio scraper), else \`rate_limited\``],
    ["Cookies", `${c.cookies.maxPerHost} per domain, ${kb(c.cookies.maxTotalBytes)} in total per plugin`],
    ["`kino.storage`", `${kb(c.storage.maxTotalBytes)} per plugin; an entry's optional \`ttlMs\` is 1..${n(c.storage.maxTtlMs)} ms (30 days)`],
    ["`kino.sleep`", `0 to ${n(c.sleep.maxMs)} ms per call`],
    [`\`kino.meta\` (Kino ${c.additiveFromApp["kino.meta"]})`, `at most ${c.kinoMeta.perMinute} calls a minute per plugin; ${c.kinoMeta.timeoutMs / 1000} s at most (each other \`meta\` plugin ${c.kinoMeta.providerTimeoutMs / 1000} s), inside your call's own limit; the query at most ${n(c.kinoMeta.maxRequestChars)} characters; the answer at most ${n(c.kinoMeta.maxAnswerChars)} characters; cached ${c.kinoMeta.cacheTtlMs / 60000} minutes`],
    [`\`kino.tmdb\` (Kino ${c.additiveFromApp["kino.tmdb"]})`, `at most ${c.kinoTmdb.perWindow} calls per ${c.kinoTmdb.windowMs / 1000} s per plugin; on Kino's own key at most ${c.kinoTmdb.kinoKeyPerWindow} per ${c.kinoTmdb.windowMs / 1000} s per plugin and ${c.kinoTmdb.kinoKeyGlobalPerWindow} per ${c.kinoTmdb.windowMs / 1000} s for all plugins (then the person's key, else the cache or \`rate_limited\`); ${c.kinoTmdb.timeoutMs / 1000} s per call; a body at most ${kb(c.kinoTmdb.maxBodyBytes)}; at most ${c.kinoTmdb.maxParams} params of at most ${c.kinoTmdb.maxParamValueChars} characters; cached ${c.kinoTmdb.cacheTtlMs / 60000} minutes (bodies up to ${kb(c.kinoTmdb.maxCachedBodyChars)}); not counted in \`kino.fetch\`'s requests per call`],
    ["`kino.crypto`", `data at most ${kb(c.crypto.maxDataBytes)} per call; PBKDF2 at most ${n(c.crypto.pbkdf2MaxIterations)} iterations and ${c.crypto.pbkdf2MaxKeyBytes}-byte keys; \`randomBytes\` at most ${n(c.crypto.randomMaxBytes)}`],
    ["`kino.log` / `console.*`", `${n(c.runtime.maxLogChars)} characters per message; when a call of a plugin whose manifest declares \`telemetry\` fails, its last ${c.runtime.reportLogLines} lines (each cut at ${c.runtime.reportLogLineChars} characters, scrubbed, ${n(c.runtime.reportLogChars)} characters in all) go with the failure report`],
    ["What a function returns", `at most ${n(c.output.maxResultChars)} characters once turned into JSON`],
    ["Results", `\`search\` ${c.output.maxSearchItems} items; \`home\` ${c.output.maxHomeRows} rows of ${c.output.maxRowItems}; \`browse\` ${c.output.maxBrowseItems} per page; \`episodes\` ${n(c.output.maxEpisodes)} (and ${c.output.maxSeasons} \`seasons\`); \`ref\` ${n(c.output.maxRefChars)} characters; \`next\` ${n(c.output.maxCursorChars)} characters; \`id\` matches \`${c.output.itemIdPattern}\``],
    ["Live channels (apiVersion 3)", `\`liveCategories\` ${c.live.maxCategories}; \`liveChannels\` ${c.live.maxChannelsPerPage} per page, ${c.live.maxPagesPerCategory} pages at first and ${c.live.pagesPerStep} more per scroll, ${n(c.live.maxChannelsPerCategory)} channels (${c.live.maxTotalPagesPerCategory} pages) per category; \`liveSearch\` ${c.live.maxSearchChannels} channels, asked from ${c.live.minSearchChars} characters; \`guide\` ${c.live.maxGuideChannels} channels and ${c.live.maxGuideWindowMs / 3600000} h per call, ${c.live.maxGuideEntriesPerChannel} entries per channel; \`number\` 1..${c.live.maxChannelNumber}`],
    [`Tracking (apiVersion ${c.tracking.apiVersion})`, `\`progress\` at most every ${c.tracking.progressIntervalMs / 60000} minutes of playback; \`watched\` once, with ${c.tracking.watched.remainingMs / 60000} minutes or less left and at least ${c.tracking.watched.minFraction * 100}% played; at most ${c.tracking.outbox.maxPerPlugin} events waiting per plugin; an event not delivered within ${c.tracking.outbox.maxAgeMs / 86400000} days is dropped; a retryable failure waits ${c.tracking.outbox.backoffBaseMs / 1000} s, doubling up to ${c.tracking.outbox.backoffMaxMs / 3600000} h, ${c.tracking.outbox.maxAttempts} tries at most`],
    ["Settings", `at most ${c.settings.max} with a value, plus at most ${c.settings.ui.maxItems} \`section\`/\`status\`/\`action\` (apiVersion ${c.settings.ui.apiVersion}); \`text\` ${c.settings.types.text.maxChars}, \`url\` ${n(c.settings.types.url.maxChars)}, \`password\` ${c.settings.types.password.maxChars} characters`],
    ["Error messages", `your \`kino.error\` message is a detail for the log, cut at ${c.errors.maxMessageChars} characters; a \`userMessage\` for the person is at most ${c.errors.maxUserMessageChars}`],
    ["`hosts`", `at least ${c.manifest.minHosts} entry, no upper limit from Kino ${c.manifest.legacyMaxHosts.noLimitFromApp} (only the manifest's ${kb(c.manifest.maxBytes)}; Kino ${c.manifest.legacyMaxHosts.refusedUpToApp} and older refuse more than ${c.manifest.legacyMaxHosts.value}); from apiVersion ${c.manifest.noHostsApiVersion}, none (\`[]\`) when a \`url\` setting exists`],
    [`\`secrets\` (apiVersion ${c.manifest.secrets.apiVersion})`, `at most ${c.manifest.secrets.maxSecrets}; names match \`${c.manifest.secrets.namePattern}\`; a value is 1..${n(c.manifest.secrets.maxValueBytes)} bytes (1..${n(c.manifest.secrets.largeMaxValueBytes)} from apiVersion ${c.manifest.secrets.largeApiVersion}); from apiVersion ${c.manifest.secrets.typed.apiVersion} a cipher key may be typed: \`{ seal, use: "cipher-key", encoding: "hex" | "base64" }\`, ${c.manifest.secrets.typed.keyBytes.join("/")} bytes`],
  ]),
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
