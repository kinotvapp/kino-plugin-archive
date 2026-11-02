#!/usr/bin/env node
// Scaffolds a new plugin: node sdk/init.mjs <folder> [--id my-plugin] [--name "Mi plugin"] [--host example.com]
//   [--with byteSource,images,catalog,socket]   (apiVersion 13: each adds its capability and a working, commented example)
//   [--store local|live]   (apiVersion 15: a plugin STORE, a source of plugins for Kino's store; local = a static list, live = your
//                           own API too. No search/home/resolve: a store plays nothing. See docs/plugins/examples/store-local and store-live)
//   [--bundle]   (the source split into src/ and bundled into plugin.js by `npm run build` with esbuild; see the guide's
//                 "Structure a bigger plugin in files and bundle it")
//   [--kind provider|consumer]   (apiVersion 20, the plugin protocol. provider: a provides-only plugin, "hosts": [] and no
//                 capabilities, one door with a call and a stream, its proto_ exports and a test that tries them with
//                 `run.mjs proto`. consumer: a screen plugin that asks a provider through kino.plugins.call, with the install
//                 gate, "recommends", "consumes", error handling, the stream switch, and a test against a stand-in provider in
//                 test/provider. --repo owner/name: the provider's repository a consumer asks)
//   [--help]     this usage
// Writes kino-plugin.json, plugin.js (every function, commented), README.md, test/plugin.test.mjs
// (a replay-based test: record once with --record, then it runs offline) and a .gitignore for the
// kit's local stand-ins (.kino-storage.json, .kino-cookies.json, .kino-secrets.json). Never overwrites a file.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** What `--with` may add (apiVersion 13); `images` is the imageSource capability. */
export const WITH = ["byteSource", "images", "catalog", "socket"];
const WITH_CAPABILITY = { byteSource: "byteSource", images: "imageSource", catalog: "catalog", socket: "socket" };

/** What `--store` may be (apiVersion 15): a local store hands Kino its list; a live store also answers while the person browses. */
export const STORE_MODES = ["local", "live"];

/** What `--kind` may be (apiVersion 20, the plugin protocol): the plugin that opens a door, or the one that asks it. */
export const KINDS = ["provider", "consumer"];

/** Where an author reads about every function, node and rule (the scaffolds ship no guide of their own). */
export const DOCS = "https://kinotvapp.github.io/kino-plugins/";

export const USAGE = 'usage: node sdk/init.mjs <folder> [--id my-plugin] [--name "Mi plugin"] [--host example.com] [--with ' + WITH.join(",") + "] [--bundle] [--store " + STORE_MODES.join("|") + "]\n"
  + "       node sdk/init.mjs <folder> --kind provider|consumer [--id my-plugin] [--name \"Mi plugin\"] [--repo owner/name (consumer: the provider's repository)] [--host example.com (consumer)]\n"
  + "  (no kind: a source plugin with search/home/browse/resolve; provider: provides-only, opens a door; consumer: a screen that asks a provider)\n"
  + `  docs: ${DOCS}`;

/** The door the protocol scaffolds share: a provider opens it, a consumer asks it (and its test stand-in answers it). */
const DOOR = "quotes";
const DOOR_BLOCK = {
  summary: "Short quotes with the movie they come from",
  calls: { byId: { in: { id: "number" }, out: "Quote" } },
  streams: { latest: { out: "Quote", everySeconds: 300 } },
  types: { Quote: { id: "number", text: "string", movie: "string?" } },
};
const DEFAULT_PROVIDER_REPO = "your-user/kino-plugin-quotes";

/** A provides-only manifest (apiVersion 20): no capabilities, no settings, "hosts": []. */
function providerManifest(pluginId, title) {
  return JSON.stringify({
    id: pluginId,
    name: title,
    version: "0.1.0",
    apiVersion: 20,
    entry: "plugin.js",
    description: "Opens the door \"quotes\" to other plugins",
    hosts: [],
    provides: { [DOOR]: DOOR_BLOCK },
  }, null, 2) + "\n";
}

/** A provider's plugin.js: the door's call and stream as proto_<door>_<name> exports. */
function providerPlugin(title) {
  return `// ${title}: a Kino PROVIDER plugin (apiVersion 20, the plugin protocol). Docs: ${DOCS}
// It opens the door "${DOOR}" of kino-plugin.json "provides" to other plugins. Each call is an export named
// proto_<door>_<call>(arg) and each stream proto_<door>_<stream>(cursor); Kino checks the argument against the call's "in"
// (strictly: a wrong, extra or missing field never reaches you, the consumer gets bad_input) and your answer against "out"
// (a field you did not declare is dropped; a wrong type is bad_output). Throwing answers provider_failed.
//
// Provides-only: no capabilities, no settings and "hosts": [], so Kino's consent sheet claims no network. To read your
// data with kino.fetch, add its host to "hosts" (still provides-only); a capability or a setting brings the ordinary rules.
//
// Try it on its own:  node sdk/run.mjs . proto ${DOOR}.byId '{"id":1}'      node sdk/run.mjs . proto ${DOOR}.latest
const QUOTES = [
  { id: 1, text: "A first quote", movie: "A first movie" },
  { id: 2, text: "A second quote", movie: "A second movie" },
  { id: 3, text: "A third quote" },
];

// A call: the argument is already checked against { id: "number" }.
export async function proto_${DOOR}_byId({ id }) {
  const quote = QUOTES.find((q) => q.id === id);
  if (!quote) throw new Error("no quote " + id); // the consumer gets provider_failed
  return quote;
}

// A stream: the cursor is what this function returned last time (null the first time). Answer the items that are new since
// then and the next cursor (small JSON: a number, a string, an id). Kino polls it every "everySeconds" (at least 30).
export async function proto_${DOOR}_latest(cursor) {
  const seen = typeof cursor === "number" ? cursor : 0;
  return { items: QUOTES.slice(seen), cursor: QUOTES.length };
}
`;
}

const PROVIDER_TEST = `// The provider on its own: Kino accepts it, and each call and stream answers through the app's checks (run.mjs proto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const proto = (...args) => spawnSync(process.execPath, [join(root, "sdk", "run.mjs"), root, "proto", ...args], { encoding: "utf8" });

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
});

test("a call answers what its \\"out\\" declares", () => {
  const r = proto("${DOOR}.byId", '{"id":1}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).text, "A first quote");
});

test("a wrong argument is bad_input, an unknown id provider_failed", () => {
  const bad = proto("${DOOR}.byId", '{"id":"1"}');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bad_input/);
  const missing = proto("${DOOR}.byId", '{"id":99}');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /provider_failed/);
});

test("the stream answers new items and a cursor, and nothing new from that cursor", () => {
  const first = proto("${DOOR}.latest");
  assert.equal(first.status, 0, first.stderr);
  const a = JSON.parse(first.stdout);
  assert.equal(a.items.length, 3);
  const next = proto("${DOOR}.latest", JSON.stringify(a.cursor));
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout).items, []);
});
`;

/** A consumer's manifest: a screen that asks [repo]'s door, with that repo in "recommends" (the install gate needs it). */
function consumerManifest(pluginId, title, host, repo) {
  return JSON.stringify({
    id: pluginId,
    name: title,
    version: "0.1.0",
    apiVersion: 20,
    entry: "plugin.js",
    description: "Shows quotes another plugin provides",
    hosts: [host],
    capabilities: ["screen"],
    screen: { label: title.slice(0, 20), labelEn: title.slice(0, 20) },
    recommends: [repo],
    consumes: { [DOOR]: { repo, door: DOOR, calls: ["byId"], streams: ["latest"] } },
  }, null, 2) + "\n";
}

/** A consumer's plugin.js: the install gate, one call with its error codes, and the stream switch. */
function consumerPlugin(title, repo) {
  return `// ${title}: a Kino plugin screen that CONSUMES another plugin's door (apiVersion 20, the plugin protocol).
// Docs: ${DOCS}
//
// - The install gate: \`installed\` has one key per entry of kino-plugin.json "recommends" (true once installed). Until the
//   provider is installed, draw only the install view and ignore every event; Kino calls screen() again after the install.
// - kino.plugins.call("${DOOR}", call, arg) resolves to the provider's checked answer or rejects with an Error whose \`code\` is
//   provider_missing, not_declared, bad_input, bad_output, rate_limited, timeout or provider_failed. Keep the code in the
//   state and draw it; never let it throw out of screenEvent.
// - The stream: the state flag \`protocol.${DOOR}.latest: true\` switches it on; Kino then sends its new items as the event
//   "protocol" with arg { alias, stream, items }. Items may repeat: keep the latest, never append blindly.
// - TV: the main button of each view has \`autofocus\`; each answer says where the focus goes.
//
// Try it:  node sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screen
//          node sdk/run.mjs --lang en --context '{"installed":{"${repo}":false}}' . screen
const PROVIDER = "${repo}";

const text = (es, en, more = {}) => ({ type: "Text", text: es, textEn: en, ...more });
const button = (key, es, en, onPressed, more = {}) => ({ type: "ElevatedButton", key, labelText: es, labelTextEn: en, onPressed, ...more });
const page = (children) => ({
  type: "Scaffold",
  appBar: { type: "AppBar", title: ${JSON.stringify(title)}, titleEn: ${JSON.stringify(title)} },
  body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 12, children }] },
});

/** What went wrong, in the person's words, by the error code of kino.plugins.call. */
function errorText(code) {
  switch (code) {
    case "provider_missing": return ["El plugin de frases está apagado o le falta configurarse. Revísalo en Plugins.", "The quotes plugin is off or needs setting up. Check it in Plugins."];
    case "rate_limited": return ["Demasiadas peticiones seguidas. Espera unos segundos.", "Too many requests in a row. Wait a few seconds."];
    case "timeout": return ["El plugin tardó demasiado en responder. Vuelve a intentarlo.", "The plugin took too long to answer. Try again."];
    default: return ["No se pudo traer la frase. Vuelve a intentarlo.", "Could not get the quote. Try again."];
  }
}

function installView() {
  return page([
    text("Esta pantalla necesita el plugin de frases.", "This screen needs the quotes plugin."),
    button("install", "Instalar", "Install", { go: { installPlugin: { repo: PROVIDER } } }, { autofocus: true }),
  ]);
}

function mainView(state) {
  const children = [];
  if (state.quote) children.push(text(state.quote.text, state.quote.text, { style: "h3" }));
  if (state.quote && state.quote.movie) children.push(text(state.quote.movie, state.quote.movie, { style: "caption" }));
  if (!state.quote) children.push(text("Pulsa el botón para ver una frase.", "Press the button to see a quote."));
  if (state.error) {
    const [es, en] = errorText(state.error);
    children.push(text(es, en, { color: "error" }));
  }
  children.push(button("next", "Ver una frase", "Show a quote", "next", { autofocus: true }));
  const on = state.protocol?.${DOOR}?.latest === true;
  children.push({ type: "Divider" });
  children.push({ type: "Switch", key: "latest", labelText: "Novedades en vivo", labelTextEn: "Live updates", value: on, onChanged: "latest" });
  if (on && Array.isArray(state.latest) && state.latest.length) {
    for (const line of state.latest) children.push(text(line, line, { style: "caption" }));
  }
  return page(children);
}

export async function screen({ state = {}, installed = {} } = {}) {
  if (installed[PROVIDER] !== true) return installView();
  return mainView(state || {});
}

export async function screenEvent({ name, value, arg, state = {}, installed = {} } = {}) {
  if (installed[PROVIDER] !== true) return null;
  const st = state || {};
  if (name === "next") {
    const id = Number.isInteger(st.nextId) ? st.nextId : 1;
    try {
      const quote = await kino.plugins.call("${DOOR}", "byId", { id });
      return { state: { quote: { text: quote.text, movie: quote.movie ?? null }, nextId: id + 1, error: null }, focus: "next" };
    } catch (e) {
      // provider_failed here also means "no quote with that id": start again from the first one.
      return { state: { error: typeof e?.code === "string" ? e.code : "provider_failed", nextId: 1 }, focus: "next" };
    }
  }
  if (name === "latest") return { state: { protocol: { ${DOOR}: { latest: value === true } }, latest: [] } };
  if (name === "protocol") {
    if (st.protocol?.${DOOR}?.latest !== true || !arg || !Array.isArray(arg.items)) return null;
    const lines = arg.items.map((q) => q && q.text).filter((t) => typeof t === "string" && t);
    return lines.length ? { state: { latest: lines.slice(-3) } } : null;
  }
  return null;
}
`;
}

/** The consumer's test: the gate, the drawn screens (nothing dropped), the call, its error and the stream, against test/provider. */
function consumerTest(repo) {
  return `// The screen as Kino runs it, against test/provider: a stand-in that opens the same door as the real provider. Point
// --provider at the real provider's folder to try it too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provider = join(root, "test", "provider");
const REPO = "${repo}";
const run = (...args) => spawnSync(process.execPath, [join(root, "sdk", "run.mjs"), ...args], { encoding: "utf8" });
const ctx = (installed, lang = "es") => JSON.stringify({ installed: { [REPO]: installed }, lang });

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
});

for (const installed of [false, true]) {
  for (const lang of ["es", "en"]) {
    test(\`the screen draws with nothing dropped (installed \${installed}, \${lang})\`, () => {
      const r = run("--context", ctx(installed, lang), "--provider", provider, root, "screen");
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /dropped|✗/, r.stderr);
      assert.match(r.stdout, installed ? (lang === "es" ? /Ver una frase/ : /Show a quote/) : (lang === "es" ? /Instalar/ : /Install/));
    });
  }
}

test("until the provider is installed an event does nothing", () => {
  const r = run("--context", ctx(false), "--provider", provider, "--raw", root, "screenEvent", "next");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout), null);
});

test("a press asks the provider and keeps its answer", () => {
  const r = run("--context", ctx(true), "--provider", provider, "--raw", root, "screenEvent", "next");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state.quote.text, "A first quote");
});

test("without the provider the call fails with a code the screen draws", () => {
  const r = run("--context", ctx(true), "--raw", root, "screenEvent", "next");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state.error, "provider_missing");
  const drawn = run("--context", ctx(true), "--state", '{"error":"provider_missing"}', root, "screen");
  assert.doesNotMatch(drawn.stderr, /dropped/, drawn.stderr);
});

test("the switch turns the stream on, and its items (repeated ones too) replace the list", () => {
  const on = run("--context", ctx(true), "--trigger", "change", "--raw", root, "screenEvent", "latest", "", "true");
  assert.deepEqual(JSON.parse(on.stdout).state.protocol, { ${DOOR}: { latest: true } });
  const state = '{"protocol":{"${DOOR}":{"latest":true}}}';
  for (const cursor of ["null", "1"]) {
    const r = run("--context", ctx(true), "--state", state, "--provider", provider, "--cursor", cursor, "--raw", root, "screenEvent", "protocol", "${DOOR}.latest");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout).state.latest.length > 0);
  }
});
`;
}

/** The files of a protocol scaffold (replace the search/home/browse/resolve ones). */
function protocolFiles({ kind, pluginId, name, host, repo }) {
  const title = name || pluginId;
  if (kind === "provider") {
    return {
      "kino-plugin.json": providerManifest(pluginId, title),
      "plugin.js": providerPlugin(title),
      "README.md": `# ${title}\n\nA [Kino](${DOCS}) provider plugin (apiVersion 20, the plugin protocol): it opens the door \`${DOOR}\` to other plugins and plays nothing. Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`; a consumer names that repository in its \`consumes\` and \`recommends\`.\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs . proto ${DOOR}.byId '{"id":1}'\nnode sdk/run.mjs . proto ${DOOR}.latest\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
      "test/plugin.test.mjs": PROVIDER_TEST,
    };
  }
  return {
    "kino-plugin.json": consumerManifest(pluginId, title, host, repo),
    "plugin.js": consumerPlugin(title, repo),
    "README.md": `# ${title}\n\nA [Kino](${DOCS}) plugin screen that asks the door \`${DOOR}\` of the provider plugin \`${repo}\` (apiVersion 20, the plugin protocol). Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.\n\n- \`consumes\` and \`recommends\` name the provider's repository: replace \`${repo}\` with the real one in kino-plugin.json, plugin.js and test/plugin.test.mjs.\n- \`hosts\`: a screen plugin needs at least one; put the one host your screen really uses (the pictures it draws, a site it reads), not a placeholder.\n- \`test/provider\` is a stand-in that opens the same door, so the tests run offline; \`--provider <the real provider's folder>\` tries the real one.\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screen\nnode sdk/run.mjs --lang en --context '{"installed":{"${repo}":false}}' . screen\nnode sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screenEvent next\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
    "test/plugin.test.mjs": consumerTest(repo),
    "test/provider/kino-plugin.json": providerManifest(`${pluginId}-test-provider`.slice(0, 40), `${title} (test provider)`),
    "test/provider/plugin.js": providerPlugin(`${title} (test provider)`),
  };
}

/** The plugin.js of a store scaffold; the same code as docs/plugins/examples/store-local and store-live, shortened. */
function storePlugin(name, host, mode) {
  const head = `// ${name}: a Kino plugin STORE (apiVersion 15, "pluginStore"). It is a source of plugins: Kino keeps the entries in its own
// local index, paints the store from there and installs through its own consent sheet. Every function is async, returns plain
// JSON and must not throw before its first await.
const API = "https://${host}/api";

/** One row of your list -> a StoreEntry. Only address (or stremio), id and name are required. */
function toEntry(p) {
  return {
    address: p.repo,            // what Kino installs from: "owner/repo", "owner/repo/path", "owner/repo@ref" or "url:https://.../kino-plugin.json"
    id: p.id,                   // the plugin's own id
    name: p.name,
    description: p.description,
    categories: p.categories,   // movies, series, anime, live, radio, subtitles, utilities, adult
    icon: p.icon,               // https only
    version: p.version,
    popularity: p.popularity,   // a number: the "popular" sort
    updatedAt: p.updatedAt,     // ms since 1970: the "recent" sort
  };
}

async function get(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
    .join("&");
  const r = await kino.fetch(API + path + (query ? "?" + query : ""));
  if (r.status === 429) throw kino.error("rate_limited", "demasiadas peticiones");
  if (!r.ok) throw kino.error("unavailable", "la tienda respondió " + r.status);
  return r.json();
}

// storeSync({ reason, since, state }): reason is "schedule" (background, at the person's interval) or "reload"; since is when it
// last synced (ms); state is what you returned last time (at most 16 KB). full: true means entries is the WHOLE list.
export async function storeSync({ reason, since, state }) {
  const data = await get("/plugins");
  return { full: true, entries: data.plugins.map(toEntry) };
}
`;
  if (mode !== "live") return head;
  return head + `
// A live store also answers while the person browses (at most 5 s a call, 20 calls a minute). Kino appends these results to the
// end of the list as they arrive and skips an address it already shows. Export all three or Kino will not install it.
export async function storeList({ category, sort, cursor }) {
  // sort: "popular" | "recent"
  const data = await get("/plugins", { category, sort, cursor });
  return { entries: data.plugins.map(toEntry), next: data.next || undefined };
}

export async function storeSearch({ q, category, cursor }) {
  const data = await get("/search", { q, category, cursor });
  return { entries: data.plugins.map(toEntry), next: data.next || undefined };
}
`;
}

/** The files of a store scaffold (replaces the search/home/browse/resolve ones). */
function storeFiles({ pluginId, name, host, store }) {
  const title = name || pluginId;
  return {
    "kino-plugin.json": JSON.stringify({
      id: pluginId,
      name: title,
      version: "0.1.0",
      apiVersion: 15,
      entry: "plugin.js",
      description: "",
      hosts: [host],
      capabilities: ["pluginStore"],
      pluginStore: { mode: store, name: title.slice(0, 60) },
    }, null, 2) + "\n",
    "plugin.js": storePlugin(title, host, store),
    "README.md": `# ${title}

A plugin store for [Kino](https://github.com/kinotvapp/kino-plugin-sdk) (${store}). Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.

## Develop

\`\`\`
node sdk/validate.mjs .
node sdk/run.mjs . storeSync${store === "live" ? `
node sdk/run.mjs . storeList popular
node sdk/run.mjs . storeSearch "algo"` : ""}
node --test test/plugin.test.mjs
\`\`\`
`,
    "test/plugin.test.mjs": STORE_TEST,
  };
}

/** The plugin.js block each `--with` option appends. */
function withBlock(option, host) {
  switch (option) {
    case "byteSource": return `
// --- byteSource (apiVersion 13): a stream whose bytes this plugin serves ---
// resolve() may answer { source: "plugin", handle, size, mime } instead of { url }; Kino then asks read() for the bytes,
// 1 MiB at a time at offsets that are multiples of 4096. Answer exactly the range asked, or what is left at the end.
//   return { source: "plugin", handle: "file-" + id, size: totalBytes, mime: "video/mp4" };
export async function read({ handle, offset, length }) {
  const r = await kino.fetch(BASE + "/file/" + encodeURIComponent(handle), { headers: { Range: "bytes=" + offset + "-" + (offset + length - 1) } });
  if (!r.ok) throw kino.error("unavailable", "el archivo respondió " + r.status);
  return { bytes: r.base64() }; // base64 of the range: no JavaScript loop over the bytes
}

// Bytes you hold as hex (a binary protocol, kino.ws frames) become base64 natively where the app has it. These crypto
// byte ops follow the app's own version, not your apiVersion: feature-detect them.
function hexToBase64(hex) {
  if (typeof kino.crypto.convert === "function") return kino.crypto.convert(hex, "hex", "base64");
  let s = "";
  for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(s);
}
`;
    case "images": return `
// --- imageSource (apiVersion 13): posters this plugin serves itself ---
// A poster, backdrop, still or hero image may be { source: "plugin", handle } instead of a URL; Kino asks image() for it
// (at most 256 KB, image/jpeg, image/png or image/webp) and caches it.
//   poster: { source: "plugin", handle: "thumb:" + x.id },
export async function image({ handle }) {
  const r = await kino.fetch(BASE + "/thumb/" + encodeURIComponent(handle.replace(/^thumb:/, "")));
  if (!r.ok) throw kino.error("not_found", "sin imagen");
  return { bytes: r.base64(), mime: "image/jpeg" };
}
`;
    case "catalog": return `
// --- catalog (apiVersion 13): a searchable SQLite catalog of up to 100,000 items ---
// Fill it in batches of at most 500, then answer search/home from it without the network:
//   await kino.catalog.upsert([{ id: "m1", title: "Una película", sort: 2024, data: { year: 2024 } }]);
//   const { items, total } = await kino.catalog.search({ q: query.q, limit: 50 });
async function searchCatalog(q) {
  const page = await kino.catalog.search({ q: String(q || "").slice(0, 256), limit: 50 });
  return page.items.map((x) => ({ id: x.id, ref: x.id, title: x.title, kind: "movie" }));
}
`;
    case "socket": return `
// --- socket (apiVersion 13): outbound WebSockets (wss, port 443) to a host in "hosts" ---
async function talk() {
  const ws = await kino.ws.open("wss://${host}/socket", { protocol: "binary" });
  try {
    await ws.send("00010203", { encoding: "hex" });          // frames as hex or base64: no JavaScript loop over bytes
    return await ws.recv(10000, { encoding: "hex" });       // null after 10 s without a frame
  } finally {
    await ws.close();
  }
}
`;
    default: throw new Error(`unknown --with ${option}: ${WITH.join(", ")}`);
  }
}

export function scaffold(folder, { id, name, host = "example.com", with: extras = [], bundle = false, store = null, kind = null, repo = DEFAULT_PROVIDER_REPO } = {}) {
  if (kind !== null && !KINDS.includes(kind)) throw new Error(`unknown --kind ${kind}: ${KINDS.join(", ")}`);
  if (kind && (store || extras.length || bundle)) throw new Error("--kind cannot be combined with --store, --with or --bundle: a protocol scaffold has no catalogue");
  if (kind === "consumer" && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("--repo needs the provider's plain GitHub owner/name");
  if (store !== null && !STORE_MODES.includes(store)) throw new Error(`unknown --store ${store}: ${STORE_MODES.join(", ")}`);
  if (store && (extras.length || bundle)) throw new Error("--store cannot be combined with --with or --bundle: a store plays nothing and has no catalogue to scaffold");
  for (const x of extras) if (!WITH.includes(x)) throw new Error(`unknown --with ${x}: ${WITH.join(", ")}`);
  const dir = resolve(folder);
  const pluginId = id || basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mi-plugin";
  const files = {
    ".gitignore": "# Local stand-ins the kit writes; never commit a real secret value.\n.kino-storage.json\n.kino-cookies.json\n.kino-secrets.json\n",
    "kino-plugin.json": JSON.stringify({
      id: pluginId,
      name: name || pluginId,
      version: "0.1.0",
      apiVersion: extras.length ? 13 : 1,
      entry: "plugin.js",
      description: "",
      hosts: [host],
      capabilities: ["search", "home", "browse", "resolve", ...extras.map((x) => WITH_CAPABILITY[x])],
    }, null, 2) + "\n",
    "plugin.js": `// ${name || pluginId}: a Kino plugin. Docs: ${DOCS}
// Every function is async, returns plain JSON and must not throw before its first await (Kino 0.9.49 and older cannot catch that).
const BASE = "https://${host}";

${CATALOG_FUNCTIONS}
function toItem(x) {
  return { id: String(x.id), ref: String(x.id), title: x.title, kind: "movie", year: x.year, poster: x.poster };
}
` + extras.map((x) => withBlock(x, host)).join(""),
    "README.md": `# ${name || pluginId}\n\nA [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin. Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs --record test/fixtures.json . search "algo"\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
    "test/plugin.test.mjs": PLUGIN_TEST,
  };
  if (kind) {
    Object.assign(files, protocolFiles({ kind, pluginId, name, host, repo }));
  } else if (store) {
    Object.assign(files, storeFiles({ pluginId, name, host, store }));
  } else if (bundle) Object.assign(files, bundleFiles({ pluginId, name, host, extras }));
  const written = [];
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    const file = join(dir, path);
    if (existsSync(file)) continue;
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
    written.push(path);
  }
  return written;
}

/** The catalog functions of the scaffold, the same text in plugin.js and (with --bundle) in src/catalog.js. */
const CATALOG_FUNCTIONS = `export async function search(query) {
  // query: { q, type, year, season, episode, tmdbId, originalTitle, altTitles, cursor }
  const r = await kino.fetch(BASE + "/search?q=" + encodeURIComponent(query.q));
  if (r.status === 429) throw kino.error("rate_limited", "demasiadas peticiones");
  if (!r.ok) throw kino.error("unavailable", "el sitio respondió " + r.status);
  return r.json().results.map(toItem);
}

export async function home() {
  const r = await kino.fetch(BASE + "/latest");
  return [{ id: "latest", title: "Lo último", ref: "latest", items: r.json().results.map(toItem) }];
}

export async function browse(ref, cursor) {
  const r = await kino.fetch(BASE + "/" + encodeURIComponent(ref) + (cursor ? "?page=" + encodeURIComponent(cursor) : ""));
  const data = r.json();
  return { items: data.results.map(toItem), next: data.nextPage ? String(data.nextPage) : undefined };
}

export async function resolve(ref) {
  const r = await kino.fetch(BASE + "/watch/" + encodeURIComponent(ref));
  if (r.status === 404) throw kino.error("not_found", "ya no está");
  return { url: r.json().url, mime: "video/mp4" };
}
`;

/** The exports each --with block adds (a block's other functions are its own helpers). */
const WITH_EXPORTS = { byteSource: ["read"], images: ["image"], catalog: [], socket: [] };

/**
 * --bundle: the source split into src/ and bundled into the shipped plugin.js by `npm run build` (esbuild), as the
 * Party Chat and Solo noticias examples are. plugin.js itself is not written: `npm install && npm run build` makes it.
 */
function bundleFiles({ pluginId, name, host, extras }) {
  const exported = extras.flatMap((x) => WITH_EXPORTS[x]);
  return {
    "plugin.js": null,
    ".gitignore": "# Local stand-ins the kit writes; never commit a real secret value.\n.kino-storage.json\n.kino-cookies.json\n.kino-secrets.json\n# esbuild (npm install); plugin.js itself is generated by npm run build and committed.\nnode_modules/\n",
    "package.json": JSON.stringify({
      name: "kino-plugin-" + pluginId,
      private: true,
      type: "module",
      scripts: {
        build: "node scripts/build.mjs",
        "check:built": "node scripts/build.mjs --check",
        test: "node --test test/*.test.mjs",
        validate: "node sdk/validate.mjs .",
      },
      devDependencies: { esbuild: "^0.21.0" },
    }, null, 2) + "\n",
    "src/plugin.js": `// ${name || pluginId}: a Kino plugin. Docs: ${DOCS}
// Every function is async, returns plain JSON and must not throw before its first await (Kino 0.9.49 and older cannot catch that).
//
// The entry of the source: it only re-exports what Kino calls. \`npm run build\` bundles src/ into the shipped plugin.js
// (one ES module, the file Kino installs); never edit plugin.js by hand.

export { search, home, browse, resolve } from "./catalog.js";
` + (exported.length ? `export { ${exported.join(", ")} } from "./extras.js";\n` : ""),
    "src/site.js": `// The site this plugin reads: its address, and how one of its results becomes a Kino item.

export const BASE = "https://${host}";

export function toItem(x) {
  return { id: String(x.id), ref: String(x.id), title: x.title, kind: "movie", year: x.year, poster: x.poster };
}
`,
    "src/catalog.js": `// What Kino asks for: search, home, browse and resolve.

import { BASE, toItem } from "./site.js";

${CATALOG_FUNCTIONS}`,
    "src/extras.js": extras.length ? `// The apiVersion 13 capabilities scaffolded with --with.

import { BASE } from "./site.js";
` + extras.map((x) => withBlock(x, host)).join("") : null,
    "scripts/build.mjs": BUNDLE_BUILD_SCRIPT,
    "test/built.test.mjs": BUNDLE_BUILT_TEST,
    "README.md": `# ${name || pluginId}\n\nA [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin. Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.\n\n## Develop\n\nThe code lives in \`src/\` (\`src/plugin.js\` only re-exports); \`npm run build\` bundles it into \`plugin.js\`, the one file Kino installs. Commit \`plugin.js\` and never edit it by hand.\n\n\`\`\`\nnpm install                # esbuild\nnpm run build              # src/ -> plugin.js\nnpm run check:built        # plugin.js is exactly what src/ builds to\nnode sdk/validate.mjs .\nnode sdk/run.mjs --record test/fixtures.json . search "algo"\nnpm test\n\`\`\`\n`,
  };
}

/** --bundle: scripts/build.mjs, the same file the Party Chat and Solo noticias examples use. */
export const BUNDLE_BUILD_SCRIPT = [
  "#!/usr/bin/env node",
  "// Builds the shipped plugin.js from src/ (src/plugin.js is the entry) with esbuild: one readable ES module (bundled, not",
  "// minified), the same named exports, a header that says it is generated, and the same bytes for the same sources.",
  "//",
  "//   node scripts/build.mjs          writes plugin.js            (npm run build)",
  "//   node scripts/build.mjs --check  fails if plugin.js is not exactly what src/ builds to   (npm run check:built)",
  "//",
  "// Kino installs one file (`entry: plugin.js`, straight from the repository), and the signature covers its bytes: so the",
  "// generated file is committed, and the check proves it was generated from src/ and not edited by hand.",
  "import { readFileSync, writeFileSync } from \"node:fs\";",
  "import { dirname, join, resolve } from \"node:path\";",
  "import { fileURLToPath, pathToFileURL } from \"node:url\";",
  "",
  "/** The plugin's folder: the one that holds src/ and plugin.js. */",
  "export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), \"..\");",
  "export const BANNER = \"// Generated by `npm run build` from src/. Do not edit this file: edit src/ and rebuild.\";",
  "",
  "/** esbuild's options: the same as `esbuild src/plugin.js --bundle --format=esm --target=es2020`, plus the banner and UTF-8 text. */",
  "export function buildOptions(root = ROOT) {",
  "  return {",
  "    absWorkingDir: root,",
  "    entryPoints: [\"src/plugin.js\"],",
  "    outfile: \"plugin.js\",",
  "    bundle: true,",
  "    format: \"esm\",",
  "    target: \"es2020\",",
  "    charset: \"utf8\", // the reactions and the Spanish texts stay readable instead of \\u escapes",
  "    banner: { js: BANNER },",
  "    write: false,",
  "    logLevel: \"silent\",",
  "  };",
  "}",
  "",
  "/** What src/ builds to, as text. Throws when esbuild is not installed (`npm install`). */",
  "export async function buildText(root = ROOT) {",
  "  const esbuild = await import(\"esbuild\");",
  "  const result = await esbuild.build(buildOptions(root));",
  "  return result.outputFiles[0].text;",
  "}",
  "",
  "if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {",
  "  const check = process.argv.includes(\"--check\");",
  "  let text;",
  "  try {",
  "    text = await buildText();",
  "  } catch (e) {",
  "    console.error(String(e && e.message ? e.message : e));",
  "    if (e && e.code === \"ERR_MODULE_NOT_FOUND\") console.error(\"esbuild is missing: run `npm install` first\");",
  "    process.exit(1);",
  "  }",
  "  const out = join(ROOT, \"plugin.js\");",
  "  if (check) {",
  "    let committed = \"\";",
  "    try { committed = readFileSync(out, \"utf8\"); } catch { /* no plugin.js yet */ }",
  "    if (committed !== text) {",
  "      console.error(\"plugin.js is not what src/ builds to: run `npm run build` (and never edit plugin.js by hand)\");",
  "      process.exit(1);",
  "    }",
  "    console.log(\"plugin.js is exactly what src/ builds to\");",
  "  } else {",
  "    writeFileSync(out, text);",
  "    console.log(`plugin.js written (${Buffer.byteLength(text)} bytes)`);",
  "  }",
  "}",
].join("\n") + "\n";

/** --bundle: test/built.test.mjs, plugin.js is exactly what src/ builds to (skipped without esbuild). */
export const BUNDLE_BUILT_TEST = [
  "// The shipped plugin.js is generated from src/ (`npm run build`): it must be exactly what src/ builds to, so the file",
  "// Kino installs (and its signature) never drifts from the source people read. The other tests run the shipped bundle.",
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "import { readFileSync } from \"node:fs\";",
  "import { dirname, join } from \"node:path\";",
  "import { fileURLToPath } from \"node:url\";",
  "import { BANNER, buildText } from \"../scripts/build.mjs\";",
  "",
  "const DIR = join(dirname(fileURLToPath(import.meta.url)), \"..\");",
  "",
  "let esbuildMissing = null;",
  "try {",
  "  await import(\"esbuild\");",
  "} catch (e) {",
  "  esbuildMissing = \"esbuild is not installed here (run `npm install`): the plugin.js-is-built-from-src check is skipped\";",
  "}",
  "",
  "test(\"plugin.js is exactly what src/ builds to (npm run build), with its generated-file header\", { skip: esbuildMissing || false }, async () => {",
  "  const committed = readFileSync(join(DIR, \"plugin.js\"), \"utf8\");",
  "  assert.ok(committed.startsWith(BANNER + \"\\n\"), \"plugin.js starts with the generated-file header\");",
  "  const built = await buildText(DIR);",
  "  assert.ok(built === committed, \"plugin.js differs from what src/ builds to: run `npm run build`, never edit plugin.js by hand\");",
  "});",
].join("\n") + "\n";

const STORE_TEST = `// The store's manifest and exports are accepted by the kit. To check its answers offline, serve your list through a fake
// fetch as docs/plugins/examples/store-local/test/store.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});
`;

const PLUGIN_TEST = `// Offline test: answers come from test/fixtures.json (record it once with
//   node sdk/run.mjs --record test/fixtures.json . search "algo").
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures.json");

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("search answers offline, and Kino drops nothing", { skip: !existsSync(fixtures) && "record test/fixtures.json first" }, async () => {
  const r = await validate(root, { run: "search", args: ["algo"], replay: fixtures });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  assert.ok(r.output.items.length > 0);
});
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const [folder, ...rest] = argv;
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
  } else if (!folder || folder.startsWith("-")) {
    // The folder comes first: an option in its place would become a folder of that name.
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    const opt = (k) => { const i = rest.indexOf(k); return i === -1 ? undefined : rest[i + 1]; };
    const extras = (opt("--with") || "").split(",").map((x) => x.trim()).filter(Boolean);
    let written;
    try {
      written = scaffold(folder, { id: opt("--id"), name: opt("--name"), host: opt("--host"), with: extras, bundle: rest.includes("--bundle"), store: opt("--store"), kind: opt("--kind") ?? null, repo: opt("--repo") ?? DEFAULT_PROVIDER_REPO });
    } catch (e) {
      console.error(e.message);
      process.exitCode = 2;
    }
    if (written) {
      console.error(written.length ? `wrote ${written.join(", ")}` : "nothing written: every file already exists");
      console.error(`next: copy sdk/ (and contract.json) into ${folder}, then from inside it: ` +
        (rest.includes("--bundle") ? "npm install && npm run build && node sdk/validate.mjs ." : "node sdk/validate.mjs . && node --test test/plugin.test.mjs"));
    }
  }
}
