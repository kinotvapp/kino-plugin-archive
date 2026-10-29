#!/usr/bin/env node
// Scaffolds a new plugin: node sdk/init.mjs <folder> [--id my-plugin] [--name "Mi plugin"] [--host example.com]
//   [--with byteSource,images,catalog,socket]   (apiVersion 13: each adds its capability and a working, commented example)
//   [--bundle]   (the source split into src/ and bundled into plugin.js by `npm run build` with esbuild; see the guide's
//                 "Structure a bigger plugin in files and bundle it")
// Writes kino-plugin.json, plugin.js (every function, commented), README.md, test/plugin.test.mjs
// (a replay-based test: record once with --record, then it runs offline) and a .gitignore for the
// kit's local stand-ins (.kino-storage.json, .kino-cookies.json, .kino-secrets.json). Never overwrites a file.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** What `--with` may add (apiVersion 13); `images` is the imageSource capability. */
export const WITH = ["byteSource", "images", "catalog", "socket"];
const WITH_CAPABILITY = { byteSource: "byteSource", images: "imageSource", catalog: "catalog", socket: "socket" };

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

export function scaffold(folder, { id, name, host = "example.com", with: extras = [], bundle = false } = {}) {
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
    "plugin.js": `// ${name || pluginId}: a Kino plugin. Read GUIDE.md: every function is async, returns plain JSON,
// and must not throw before its first await (Kino 0.9.49 and older cannot catch that).
const BASE = "https://${host}";

${CATALOG_FUNCTIONS}
function toItem(x) {
  return { id: String(x.id), ref: String(x.id), title: x.title, kind: "movie", year: x.year, poster: x.poster };
}
` + extras.map((x) => withBlock(x, host)).join(""),
    "README.md": `# ${name || pluginId}\n\nA [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin. Install it in Kino (Ajustes ▸ Plugins) with this repository's \`owner/repo\`.\n\n## Develop\n\n\`\`\`\nnode sdk/validate.mjs .\nnode sdk/run.mjs --record test/fixtures.json . search "algo"\nnode --test test/plugin.test.mjs\n\`\`\`\n`,
    "test/plugin.test.mjs": PLUGIN_TEST,
  };
  if (bundle) Object.assign(files, bundleFiles({ pluginId, name, host, extras }));
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
    "src/plugin.js": `// ${name || pluginId}: a Kino plugin. Read GUIDE.md: every function is async, returns plain JSON,
// and must not throw before its first await (Kino 0.9.49 and older cannot catch that).
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
  const [folder, ...rest] = process.argv.slice(2);
  if (!folder) {
    console.error('usage: node sdk/init.mjs <folder> [--id my-plugin] [--name "Mi plugin"] [--host example.com] [--with ' + WITH.join(",") + "] [--bundle]");
    process.exitCode = 2;
  } else {
    const opt = (k) => { const i = rest.indexOf(k); return i === -1 ? undefined : rest[i + 1]; };
    const extras = (opt("--with") || "").split(",").map((x) => x.trim()).filter(Boolean);
    let written;
    try {
      written = scaffold(folder, { id: opt("--id"), name: opt("--name"), host: opt("--host"), with: extras, bundle: rest.includes("--bundle") });
    } catch (e) {
      console.error(e.message);
      process.exitCode = 2;
    }
    if (written) {
      console.error(written.length ? `wrote ${written.join(", ")}` : "nothing written: every file already exists");
      console.error(`next: copy sdk/ (and contract.json) into ${folder}, then from inside it: ` +
        (rest.includes("--bundle") ? "npm install && npm run build && node sdk/validate.mjs ." : "node sdk/validate.mjs ."));
    }
  }
}
