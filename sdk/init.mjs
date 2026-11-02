#!/usr/bin/env node
// Scaffolds a new plugin: node sdk/init.mjs <folder> [--id my-plugin] [--name "Mi plugin"] [--host example.com]
//   [--with byteSource,images,catalog,socket]   (apiVersion 13: each adds its capability and a working, commented example)
//   [--store local|live]   (apiVersion 15: a plugin STORE, a source of plugins for Kino's store; local = a static list, live = your
//                           own API too. No search/home/resolve: a store plays nothing. See docs/plugins/examples/store-local and store-live)
//   [--bundle]   (the source split into src/ and bundled into plugin.js by `npm run build` with esbuild; see the guide's
//                 "Structure a bigger plugin in files and bundle it")
//   [--kind provider|consumer]   (apiVersion 20, the plugin protocol. provider: a provides-only plugin, "hosts": [] and no
//                 capabilities, one door with a call and a stream, its proto_ exports and a test that tries them with
//                 `run.mjs proto`. consumer: a screen-only plugin ("hosts": [], or --host) that asks a provider through kino.plugins.call, with the install
//                 gate, "recommends", "consumes", error handling, the stream switch, and a test against a stand-in provider in
//                 test/provider (a STAND-IN to replace with a copy of the real provider). --repo owner/name: the provider's
//                 repository a consumer asks; --door/--call/--stream: the real door's names (default quotes, byId, latest))
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
  + "       node sdk/init.mjs <folder> --kind provider|consumer [--id my-plugin] [--name \"Mi plugin\"] [--door quotes] [--call byId] [--stream latest] [--repo owner/name (consumer: the provider's repository)] [--host <a host the screen really fetches from; none by default: \"hosts\": []> (consumer)]\n"
  + "  (--door, --call, --stream: the real door's names, so the consumer, its test/provider stand-in and the provider agree)\n"
  + "  (no kind: a source plugin with search/home/browse/resolve; provider: provides-only, opens a door; consumer: a screen that asks a provider)\n"
  + `  docs: ${DOCS}`;

/** The door the protocol scaffolds share by default: a provider opens it, a consumer asks it (and its test stand-in answers it). */
const DOOR = "quotes";
const DEFAULT_CALL = "byId";
const DEFAULT_STREAM = "latest";
/** Door, call, stream and alias names, as the app checks them (contract.protocol). */
const PROTOCOL_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const DEFAULT_PROVIDER_REPO = "your-user/kino-plugin-quotes";
/**
 * Where the docs say a screen-only consumer declares no host, "hosts": [] (validate's placeholder-host warning names it too). Named,
 * not linked: the public docs site still describes the old rule under its anchor, and a dead or stale link is worse than none.
 */
export const TEXT_ONLY_CONSUMER_DOCS = "the plugin guide's section «A consumer's hosts: a screen-only consumer declares none»";

/** The door block of the scaffolds: one call and one stream named as the author asked, one type. */
function doorBlock({ call, stream }) {
  return {
    summary: "TODO: en español, qué datos da esta puerta",
    calls: { [call]: { in: { id: "number" }, out: "Item" } },
    streams: { [stream]: { out: "Item", everySeconds: 300 } },
    types: { Item: { id: "number", text: "string", detail: "string?" } },
  };
}

/** The screen's English label: the door's name, capitalised (an author renames it). */
const englishLabel = (door) => (door.charAt(0).toUpperCase() + door.slice(1)).slice(0, 20);

/** A provides-only manifest (apiVersion 20): no capabilities, no settings, "hosts": []. */
function providerManifest(pluginId, title, names) {
  return JSON.stringify({
    id: pluginId,
    name: title,
    version: "0.1.0",
    apiVersion: 20,
    entry: "plugin.js",
    description: `TODO: en español, qué da este plugin a otros (la puerta "${names.door}")`,
    hosts: [],
    provides: { [names.door]: doorBlock(names) },
  }, null, 2) + "\n";
}

/** A provider's plugin.js: the door's call and stream as proto_<door>_<name> exports. */
function providerPlugin(title, { door, call, stream }, standIn = false) {
  const head = standIn
    ? `// STAND-IN PROVIDER for the consumer's tests (see test/provider/README.md): it opens the door "${door}" with the call
// "${call}" and the stream "${stream}" so the tests run offline. It is NOT the real provider: replace this folder with a copy
// of the real provider (the same door, call and stream names, the same types), then fix the consumer's tests to its data.
`
    : `// ${title}: a Kino PROVIDER plugin (apiVersion 20, the plugin protocol). Docs: ${DOCS}
`;
  return `${head}// It opens the door "${door}" of kino-plugin.json "provides" to other plugins. Each call is an export named
// proto_<door>_<call>(arg) and each stream proto_<door>_<stream>(cursor); Kino checks the argument against the call's "in"
// (strictly: a wrong, extra or missing field never reaches you, the consumer gets bad_input) and your answer against "out"
// (a field you did not declare is dropped; a wrong type is bad_output). Throwing answers provider_failed.
//
// Provides-only: no capabilities, no settings and "hosts": [], so Kino's consent sheet claims no network. To read your
// data with kino.fetch, add its host to "hosts" (still provides-only); a capability or a setting brings the ordinary rules.
//
// Try it on its own:  node sdk/run.mjs . proto ${door}.${call} '{"id":1}'      node sdk/run.mjs . proto ${door}.${stream}
const ITEMS = [
  { id: 1, text: "A first item", detail: "Its detail" },
  { id: 2, text: "A second item", detail: "Another detail" },
  { id: 3, text: "A third item" },
];

// A call: the argument is already checked against { id: "number" }.
export async function proto_${door}_${call}({ id }) {
  const item = ITEMS.find((x) => x.id === id);
  if (!item) throw new Error("no item " + id); // the consumer gets provider_failed
  return item;
}

// A stream: the cursor is what this function returned last time (null the first time). Answer the items that are new since
// then and the next cursor (small JSON: a number, a string, an id). Kino polls it every "everySeconds" (at least 30).
export async function proto_${door}_${stream}(cursor) {
  const seen = typeof cursor === "number" ? cursor : 0;
  return { items: ITEMS.slice(seen), cursor: ITEMS.length };
}
`;
}

/** test/provider/README.md: what the stand-in is, and that it must be replaced. */
function standInReadme({ door, call, stream }, repo) {
  return `# STAND-IN provider: replace it

This folder is **not** the real provider. \`init.mjs --kind consumer\` wrote it so the consumer's tests run offline: it opens
the door \`${door}\` with the call \`${call}\` and the stream \`${stream}\`, the names this consumer's \`consumes\` lists,
and answers made-up items (\`{ id, text, detail? }\`).

Before you trust the tests:

1. Replace this folder with a **copy of the real provider** (\`${repo}\`): its \`kino-plugin.json\` and \`plugin.js\`, with the
   same door, call and stream names and the same types. Change only its \`id\` if both plugins share a folder tree.
2. Adapt the consumer's code (the argument it sends, the fields it reads) and \`test/plugin.test.mjs\` to the real data.
3. Run \`node --test test/plugin.test.mjs\` again.

The kit serves a call with the first \`--provider\` that opens the door and ignores \`repo\`: check by hand that \`repo\` in
\`consumes\` and \`recommends\` is the real provider's exact GitHub \`owner/name\`.
`;
}

const PROVIDER_TEST = ({ door, call, stream }) => `// The provider on its own: Kino accepts it, and each call and stream answers through the app's checks (run.mjs proto).
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
  const r = proto("${door}.${call}", '{"id":1}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).text, "A first item");
});

test("a wrong argument is bad_input, an unknown id provider_failed", () => {
  const bad = proto("${door}.${call}", '{"id":"1"}');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bad_input/);
  const missing = proto("${door}.${call}", '{"id":99}');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /provider_failed/);
});

test("the stream answers new items and a cursor, and nothing new from that cursor", () => {
  const first = proto("${door}.${stream}");
  assert.equal(first.status, 0, first.stderr);
  const a = JSON.parse(first.stdout);
  assert.equal(a.items.length, 3);
  const next = proto("${door}.${stream}", JSON.stringify(a.cursor));
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout).items, []);
});
`;

/** A consumer's manifest: a screen that asks [repo]'s door, with that repo in "recommends" (the install gate needs it). */
function consumerManifest(pluginId, title, host, repo, { door, call, stream }) {
  // A screen-only consumer (consumes + capabilities ["screen"], apiVersion 20) declares no host: it cannot fetch with none, and
  // pictures from public https addresses need no declaration. --host adds one the screen really fetches from.
  return JSON.stringify({
    id: pluginId,
    name: title,
    version: "0.1.0",
    apiVersion: 20,
    entry: "plugin.js",
    description: `TODO: en español, qué muestra esta pantalla (usa la puerta "${door}" de otro plugin)`,
    hosts: host ? [host] : [],
    capabilities: ["screen"],
    screen: { label: title.slice(0, 20), labelEn: englishLabel(door) },
    recommends: [repo],
    consumes: { [door]: { repo, door, calls: [call], streams: [stream] } },
  }, null, 2) + "\n";
}

/** A consumer's plugin.js: the install gate, one compact bar with a real exit, a detail route, one call with its error codes, the stream switch. */
function consumerPlugin(title, repo, { door, call, stream }) {
  const titleEn = englishLabel(door);
  return `// ${title}: a Kino plugin screen that CONSUMES another plugin's door (apiVersion 20, the plugin protocol).
// Docs: ${DOCS}
//
// - The install gate: \`installed\` has one key per entry of kino-plugin.json "recommends" (true once installed). Until the
//   provider is installed, draw only the install view and ignore every event (the reserved first event \`open\` too: answer
//   null); Kino calls screen() again after the install, without a new \`open\`.
// - kino.plugins.call("${door}", "${call}", arg) resolves to the provider's checked answer or rejects with an Error whose \`code\`
//   is provider_missing, not_declared, bad_input, bad_output, rate_limited, timeout or provider_failed (keep a default for a
//   code a newer Kino may add). Keep the code in the state and draw it; never let it throw out of screenEvent.
// - One compact bar on every screen: AppBar with mergeWithKinoBar + dense and a leading that really exits (close on the
//   front page, back on the detail route).
// - The stream: the state flag \`protocol.${door}.${stream}: true\` switches it on; Kino then sends its new items as the event
//   "protocol" with arg { alias, stream, items }. Items may repeat: keep the latest, never append blindly.
// - TV: the main button of each view has \`autofocus\`; each answer says where the focus goes.
// - TODO: the argument ({ id }) and the fields read (text, detail) are the stand-in's (test/provider): adapt them to the
//   real provider's door, and replace test/provider with a copy of it.
//
// Try it:  node sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screen
//          node sdk/run.mjs --lang en --context '{"installed":{"${repo}":false}}' . screen
//          node sdk/run.mjs --context '{"installed":{"${repo}":true},"route":{"name":"detail","params":{"id":1}}}' --state '{"item":{"id":1,"text":"Hola"}}' . screen
const PROVIDER = "${repo}"; // exactly as written in "recommends" and "consumes"
const TITLE = [${JSON.stringify(title)}, ${JSON.stringify(titleEn)}];

const text = (es, en, more = {}) => ({ type: "Text", text: es, textEn: en, ...more });
const button = (key, es, en, onPressed, more = {}) => ({ type: "ElevatedButton", key, labelText: es, labelTextEn: en, onPressed, ...more });
const CLOSE = { type: "IconButton", icon: "close", labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } };
const BACK = { type: "IconButton", icon: "arrow_back", labelText: "Atrás", labelTextEn: "Back", onPressed: "back" };
// One compact bar (mergeWithKinoBar + dense) whose leading is a real exit: CLOSE on the front page, BACK on a pushed route.
const page = (children, leading = CLOSE) => ({
  type: "Scaffold",
  appBar: { type: "AppBar", title: TITLE[0], titleEn: TITLE[1], mergeWithKinoBar: true, dense: true, leading },
  body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 12, children }] },
});

/** What went wrong, in the person's words, by the error code of kino.plugins.call (a default for any other code). */
function errorText(code) {
  switch (code) {
    case "provider_missing": return ["El plugin que da los datos está apagado o le falta configurarse. Revísalo en Plugins.", "The plugin that gives the data is off or needs setting up. Check it in Plugins."];
    case "rate_limited": return ["Demasiadas peticiones seguidas. Espera unos segundos.", "Too many requests in a row. Wait a few seconds."];
    case "timeout": return ["El plugin tardó demasiado en responder. Vuelve a intentarlo.", "The plugin took too long to answer. Try again."];
    default: return ["No se pudieron traer los datos. Vuelve a intentarlo.", "Could not get the data. Try again."];
  }
}

function installView() {
  return page([
    text("Esta pantalla necesita otro plugin para funcionar.", "This screen needs another plugin to work."),
    button("install", "Instalar", "Install", { go: { installPlugin: { repo: PROVIDER } } }, { autofocus: true }),
  ]);
}

function mainView(state) {
  const children = [];
  if (state.item) {
    children.push(text(state.item.text, state.item.text, { style: "h3" }));
    children.push({ type: "TextButton", key: "detail", labelText: "Ver detalle", labelTextEn: "See the detail", onPressed: "detail" });
  } else {
    children.push(text("Pulsa el botón para traer un dato.", "Press the button to get an item."));
  }
  if (state.error) {
    const [es, en] = errorText(state.error);
    children.push(text(es, en, { color: "error" }));
  }
  children.push(button("next", "Traer otro", "Get another", "next", { autofocus: true }));
  const on = state.protocol?.${door}?.${stream} === true;
  children.push({ type: "Divider" });
  children.push({ type: "Switch", key: "live", labelText: "Novedades en vivo", labelTextEn: "Live updates", value: on, onChanged: "live" });
  if (on && Array.isArray(state.latest) && state.latest.length) {
    for (const line of state.latest) children.push(text(line, line, { style: "caption" }));
  }
  return page(children);
}

// The route "detail" (pushed by the answer to "detail"): Back pops it and the front page is still below.
function detailView(state) {
  const item = state.item;
  if (!item) return page([text("No hay nada que mostrar.", "Nothing to show.")], BACK);
  const children = [text(item.text, item.text, { style: "h3" })];
  if (item.detail) children.push(text(item.detail, item.detail));
  return page(children, BACK);
}

export async function screen({ state = {}, route = { name: "main" }, installed = {} } = {}) {
  if (installed[PROVIDER] !== true) return installView();
  if (route && route.name === "detail") return detailView(state || {});
  return mainView(state || {});
}

export async function screenEvent({ name, value, arg, state = {}, installed = {} } = {}) {
  if (installed[PROVIDER] !== true) return null; // the gate: nothing works until the provider is installed (\`open\` too)
  const st = state || {};
  if (name === "open") return null; // the first event of every opening: nothing to load until the person presses
  if (name === "next") {
    const id = Number.isInteger(st.nextId) ? st.nextId : 1;
    try {
      const item = await kino.plugins.call("${door}", "${call}", { id });
      return { state: { item: { id: item.id, text: item.text, detail: item.detail ?? null }, nextId: id + 1, error: null }, focus: "next" };
    } catch (e) {
      // provider_failed here also means "no item with that id": start again from the first one.
      return { state: { error: typeof e?.code === "string" ? e.code : "provider_failed", nextId: 1 }, focus: "next" };
    }
  }
  if (name === "detail") return st.item ? { route: { push: "detail", params: { id: st.item.id } } } : null;
  if (name === "back") return { route: { pop: true } };
  if (name === "live") return { state: { protocol: { ${door}: { ${stream}: value === true } }, latest: [] } };
  if (name === "protocol") {
    if (st.protocol?.${door}?.${stream} !== true || !arg || !Array.isArray(arg.items)) return null;
    const lines = arg.items.map((x) => x && x.text).filter((t) => typeof t === "string" && t);
    return lines.length ? { state: { latest: lines.slice(-3) } } : null;
  }
  return null;
}
`;
}

/** The consumer's test: the gate, the drawn screens (nothing dropped), the call, its error, the route and the stream, against test/provider. */
function consumerTest(repo, { door, stream }) {
  return `// The screen as Kino runs it, against test/provider: a STAND-IN that opens the same door as the real provider (see
// test/provider/README.md: replace it with a copy of the real one). Point --provider at the real provider's folder to try it too.
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
const ctx = (installed, lang = "es", more = {}) => JSON.stringify({ installed: { [REPO]: installed }, lang, ...more });
const PLACEHOLDER = /placeholder host/;

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings.filter((w) => !PLACEHOLDER.test(w)), []);
});

// A todo until "hosts" names a host the screen really loads from (validate warns on a placeholder such as example.com).
const placeholder = (await validate(root)).warnings.some((w) => PLACEHOLDER.test(w));
test("hosts names a real host, not a placeholder", { todo: placeholder && "replace the placeholder in kino-plugin.json hosts (see ${TEXT_ONLY_CONSUMER_DOCS})" }, async () => {
  assert.deepEqual((await validate(root)).warnings.filter((w) => PLACEHOLDER.test(w)), []);
});

for (const installed of [false, true]) {
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      test(\`the screen draws with nothing dropped (installed \${installed}, \${lang}, \${device})\`, () => {
        const r = run("--context", ctx(installed, lang), "--device", device, "--provider", provider, root, "screen");
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /dropped|✗/, r.stderr);
        assert.match(r.stdout, installed ? (lang === "es" ? /Traer otro/ : /Get another/) : (lang === "es" ? /Instalar/ : /Install/));
      });
    }
  }
}

test("until the provider is installed an event does nothing, open included", () => {
  for (const name of ["next", "open"]) {
    const r = run("--context", ctx(false), "--provider", provider, "--raw", root, "screenEvent", name);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout), null);
  }
});

test("a press asks the provider and keeps its answer", () => {
  const r = run("--context", ctx(true), "--provider", provider, "--raw", root, "screenEvent", "next");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(typeof JSON.parse(r.stdout).state.item.text, "string");
});

test("without the provider the call fails with a code the screen draws", () => {
  const r = run("--context", ctx(true), "--raw", root, "screenEvent", "next");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state.error, "provider_missing");
  // The other codes (not_declared, bad_input, bad_output, rate_limited, timeout, provider_failed and any newer one) are
  // drawn from the state: the kit cannot make a real provider answer them all.
  for (const code of ["provider_missing", "rate_limited", "timeout", "provider_failed", "some_future_code"]) {
    const drawn = run("--context", ctx(true), "--state", JSON.stringify({ error: code }), root, "screen");
    assert.equal(drawn.status, 0, drawn.stderr);
    assert.doesNotMatch(drawn.stderr, /dropped/, drawn.stderr);
  }
});

test("the detail route: pushed from the front page, drawn with a back, popped by it", () => {
  const item = { id: 1, text: "Uno", detail: "El detalle" };
  const push = run("--context", ctx(true), "--state", JSON.stringify({ item }), "--raw", root, "screenEvent", "detail");
  assert.deepEqual(JSON.parse(push.stdout).route, { push: "detail", params: { id: 1 } });
  const drawn = run("--context", ctx(true, "es", { route: { name: "detail", params: { id: 1 } } }), "--state", JSON.stringify({ item }), root, "screen");
  assert.equal(drawn.status, 0, drawn.stderr);
  assert.doesNotMatch(drawn.stderr, /dropped|✗/, drawn.stderr);
  assert.match(drawn.stdout, /El detalle/);
  const back = run("--context", ctx(true), "--raw", root, "screenEvent", "back");
  assert.deepEqual(JSON.parse(back.stdout).route, { pop: true });
});

test("the switch turns the stream on, and its items (repeated ones too) replace the list", () => {
  const on = run("--context", ctx(true), "--trigger", "change", "--raw", root, "screenEvent", "live", "", "true");
  assert.deepEqual(JSON.parse(on.stdout).state.protocol, { ${door}: { ${stream}: true } });
  const state = '{"protocol":{"${door}":{"${stream}":true}}}';
  for (const cursor of ["null", "1"]) {
    const r = run("--context", ctx(true), "--state", state, "--provider", provider, "--cursor", cursor, "--raw", root, "screenEvent", "protocol", "${door}.${stream}");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout).state.latest.length > 0);
  }
});
`;
}

/** The files of a protocol scaffold (replace the search/home/browse/resolve ones). */
function protocolFiles({ kind, pluginId, name, host, repo, names }) {
  const title = name || pluginId;
  const { door, call, stream } = names;
  // A manifest name is 1 to 40 characters.
  const standInName = `${title} (test provider)`.length <= 40 ? `${title} (test provider)` : "Test provider";
  if (kind === "provider") {
    return {
      "kino-plugin.json": providerManifest(pluginId, title, names),
      "plugin.js": providerPlugin(title, names),
      "README.md": `# ${title}\n\nA [Kino](${DOCS}) provider plugin (apiVersion 20, the plugin protocol): it opens the door \`${door}\` to other plugins and plays nothing. Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`; a consumer names that repository in its \`consumes\` and \`recommends\`.\n\n- TODO: write the manifest's \`description\` and the door's \`summary\` in Spanish (the person reads the summary on a consumer's install sheet).\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs . proto ${door}.${call} '{"id":1}'\nnode sdk/run.mjs . proto ${door}.${stream}\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
      "test/plugin.test.mjs": PROVIDER_TEST(names),
    };
  }
  return {
    "kino-plugin.json": consumerManifest(pluginId, title, host, repo, names),
    "plugin.js": consumerPlugin(title, repo, names),
    "README.md": `# ${title}\n\nA [Kino](${DOCS}) plugin screen that asks the door \`${door}\` of the provider plugin \`${repo}\` (apiVersion 20, the plugin protocol). Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.\n\n- TODO: write the manifest's \`description\` in Spanish, and check \`screen.label\` (Spanish) and \`screen.labelEn\` (English).\n- \`consumes\` and \`recommends\` name the provider's repository: replace \`${repo}\` with the real one in kino-plugin.json, plugin.js and test/plugin.test.mjs.\n- \`hosts\`: \`[]\`: a screen whose only capability is \`screen\` and that only shows what its provider gives declares no host (its own \`kino.fetch\` calls are refused without one unless it declares \`fetchHosts: \"any\"\` or a \`url\` setting, and pictures from public https addresses need no declaration; see ${TEXT_ONLY_CONSUMER_DOCS}). Add a host only if the screen fetches from it, never a placeholder (\`node sdk/validate.mjs .\` warns on one).\n- \`test/provider\` is a STAND-IN that opens the door \`${door}\` (call \`${call}\`, stream \`${stream}\`) so the tests run offline: replace it with a copy of the real provider (test/provider/README.md); \`--provider <the real provider's folder>\` tries the real one.\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screen\nnode sdk/run.mjs --lang en --context '{"installed":{"${repo}":false}}' . screen\nnode sdk/run.mjs --context '{"installed":{"${repo}":true}}' --provider test/provider . screenEvent next\nnode sdk/run.mjs --context '{"installed":{"${repo}":true},"route":{"name":"detail","params":{"id":1}}}' --state '{"item":{"id":1,"text":"Hola"}}' . screen\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
    "test/plugin.test.mjs": consumerTest(repo, names),
    "test/provider/README.md": standInReadme(names, repo),
    "test/provider/kino-plugin.json": providerManifest(`${pluginId}-test-provider`.slice(0, 40), standInName, names),
    "test/provider/plugin.js": providerPlugin(standInName, names, true),
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

export function scaffold(folder, { id, name, host: hostOption, with: extras = [], bundle = false, store = null, kind = null, repo = DEFAULT_PROVIDER_REPO, door = DOOR, call = DEFAULT_CALL, stream = DEFAULT_STREAM } = {}) {
  if (kind !== null && !KINDS.includes(kind)) throw new Error(`unknown --kind ${kind}: ${KINDS.join(", ")}`);
  for (const [flag, v] of [["--door", door], ["--call", call], ["--stream", stream]]) {
    if (typeof v !== "string" || !PROTOCOL_NAME.test(v)) throw new Error(`${flag} needs a name like the provider's: a letter, then letters or digits (no "_" or "-"), at most 32`);
  }
  if (call === stream) throw new Error("--call and --stream must differ: a call and a stream of one door never share a name");
  if (!kind && (door !== DOOR || call !== DEFAULT_CALL || stream !== DEFAULT_STREAM)) throw new Error("--door, --call and --stream need --kind provider or --kind consumer");
  if (kind && (store || extras.length || bundle)) throw new Error("--kind cannot be combined with --store, --with or --bundle: a protocol scaffold has no catalogue");
  if (kind === "consumer" && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("--repo needs the provider's plain GitHub owner/name");
  if (store !== null && !STORE_MODES.includes(store)) throw new Error(`unknown --store ${store}: ${STORE_MODES.join(", ")}`);
  if (store && (extras.length || bundle)) throw new Error("--store cannot be combined with --with or --bundle: a store plays nothing and has no catalogue to scaffold");
  for (const x of extras) if (!WITH.includes(x)) throw new Error(`unknown --with ${x}: ${WITH.join(", ")}`);
  // The source and store scaffolds need a host (example.com until the author names one); a consumer gets only the one asked for.
  const host = hostOption || "example.com";
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
    Object.assign(files, protocolFiles({ kind, pluginId, name, host: hostOption || null, repo, names: { door, call, stream } }));
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
      written = scaffold(folder, { id: opt("--id"), name: opt("--name"), host: opt("--host"), with: extras, bundle: rest.includes("--bundle"), store: opt("--store"), kind: opt("--kind") ?? null, repo: opt("--repo") ?? DEFAULT_PROVIDER_REPO, door: opt("--door") ?? DOOR, call: opt("--call") ?? DEFAULT_CALL, stream: opt("--stream") ?? DEFAULT_STREAM });
    } catch (e) {
      console.error(e.message);
      process.exitCode = 2;
    }
    if (written) {
      console.error(written.length ? `wrote ${written.join(", ")}` : "nothing written: every file already exists");
      console.error(`next: copy sdk/ (without sdk/test/) and contract.json (required; kino.d.ts is optional, for editor typings) into ${folder}, then from inside it: ` +
        (rest.includes("--bundle") ? "npm install && npm run build && node sdk/validate.mjs ." : "node sdk/validate.mjs . && node --test test/plugin.test.mjs"));
      if (opt("--kind") === "consumer") console.error("test/provider is a STAND-IN provider: replace it with a copy of the real provider (see test/provider/README.md)");
    }
  }
}
