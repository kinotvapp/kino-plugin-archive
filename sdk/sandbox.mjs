// The plugin engine's world, as far as Node can reproduce it: what a plugin may touch inside Kino and nothing else.
//
// Kino runs a plugin in QuickJS with no platform around it: no timers, no `fetch`, no `Buffer`, no `process`, no `Intl`...
// Node has all of those, so a plugin that used one passed every kit test and then failed in the app. `loadPlugin` runs the
// entry in its own `node:vm` context whose global holds only what Kino gives a plugin (`kino`, `console`, `URL`,
// `URLSearchParams`, `atob`, `btoa`, `TextEncoder`, `TextDecoder`) plus the language itself: touching anything else is a
// `ReferenceError`, and `typeof` says "undefined", exactly as in the app. It also refuses any `import` (Kino loads exactly one
// file) and makes `localeCompare` and `toLocaleString` behave as the engine's do (they ignore the locale).
//
// The entry is an ES module with named exports. It runs as a script inside an async function whose `export`s are turned into
// a namespace object (`toScript`), so no Node flag is needed and `node --test` gets the sandbox too. Line numbers are the
// entry's (the wrapper starts on line 1). `KINO_SDK_NO_SANDBOX=1` loads it with a plain `import()` instead (to debug with
// Node's own tools, or if a source form defeats `toScript`).
import { trackedExports } from "./kit-call.mjs";
import vm from "node:vm";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * What Node has and a Kino plugin does not (docs/plugins/README.md § "The engine is not Node and not a browser"), with what to
 * write instead. `Intl` and `WeakRef` are V8's own and are removed from the context; the rest simply are not put there.
 */
export const MISSING_GLOBALS = {
  setTimeout: "use `await kino.sleep(ms)` to wait",
  clearTimeout: "there are no timers: use `await kino.sleep(ms)` to wait",
  setInterval: "there are no timers: loop with `await kino.sleep(ms)`",
  clearInterval: "there are no timers: loop with `await kino.sleep(ms)`",
  setImmediate: "use `await kino.sleep(0)` or just `await`",
  clearImmediate: "there are no timers",
  queueMicrotask: "use `Promise.resolve().then(fn)`",
  Buffer: "use TextEncoder/TextDecoder, atob/btoa or `kino.crypto`",
  process: "Kino has no `process`: read settings with `kino.config` and the language with `kino.lang`",
  require: "Kino has no `require` and no module resolver: bundle your code into one file",
  fetch: "use `await kino.fetch(url, options)`",
  AbortController: "there is no AbortController: `kino.fetch` already gives up after 15 s",
  AbortSignal: "there is no AbortSignal: `kino.fetch` already gives up after 15 s",
  structuredClone: "use `JSON.parse(JSON.stringify(value))`",
  performance: "use `Date.now()`",
  crypto: "use `kino.crypto`",
  WeakRef: "WeakRef does not exist in Kino",
  Intl: "locale APIs do not exist in Kino: format dates and numbers by hand",
  WebAssembly: "WebAssembly does not exist in Kino",
};

/** The engine's `localeCompare` compares code units and `toLocaleString` ignores its arguments (README § engine limits). */
const ENGINE_QUIRKS = `(() => {
  const drop = (o, names) => { for (const n of names) { try { delete o[n]; } catch (e) { /* not configurable */ } } };
  // Newer than the engine: a plugin that used one passed here and broke in the app.
  drop(globalThis, ["Intl", "WeakRef", "FinalizationRegistry", "WebAssembly", "Iterator", "Float16Array", "DisposableStack", "AsyncDisposableStack", "SuppressedError", "Temporal"]);
  drop(Array, ["fromAsync"]);
  drop(Promise, ["try"]);
  drop(Set.prototype, ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]);
  drop(Error, ["captureStackTrace"]);
  drop(ArrayBuffer.prototype, ["resize", "resizable", "maxByteLength", "transfer", "transferToFixedLength", "detached"]);
  const define = (proto, name, fn) => Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false });
  // V8 only builds \`stack\` while Error.stackTraceLimit exists, so it stays (the app has none: documented). The app's stack is
  // one "    at name (plugin.js)" line per frame and no "Error: message" line first.
  define(Error, "prepareStackTrace", (error, frames) => frames.map((f) => "    at " + (f.getFunctionName() || "<anonymous>") + " (plugin.js)").join("\\n"));
  // Native functions print with the body on three lines.
  const nativeToString = Function.prototype.toString;
  define(Function.prototype, "toString", function toString() { return nativeToString.call(this).replace(/\\{ \\[native code\\] \\}$/, "{\\n    [native code]\\n}"); });
  // Date#toLocale{Date,Time}String ignore their arguments and print the device's local time as MM/DD/YYYY and hh:mm:ss AM.
  const pad2 = (n) => String(n).padStart(2, "0");
  define(Date.prototype, "toLocaleDateString", function toLocaleDateString() { return pad2(this.getMonth() + 1) + "/" + pad2(this.getDate()) + "/" + this.getFullYear(); });
  define(Date.prototype, "toLocaleTimeString", function toLocaleTimeString() { return pad2(this.getHours() % 12 || 12) + ":" + pad2(this.getMinutes()) + ":" + pad2(this.getSeconds()) + (this.getHours() < 12 ? " AM" : " PM"); });
  define(Date.prototype, "toLocaleString", function toLocaleString() { return this.toLocaleDateString() + ", " + this.toLocaleTimeString(); });
  // The global object prints as [object global].
  Object.defineProperty(globalThis, Symbol.toStringTag, { value: "global", configurable: true });
  // localeCompare compares code units and answers the difference of the first pair that differs, else of the lengths.
  define(String.prototype, "localeCompare", function localeCompare(that) {
    const a = String(this), b = String(that), n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d !== 0) return d; }
    return a.length - b.length;
  });
  define(String.prototype, "toLocaleLowerCase", function toLocaleLowerCase() { return String(this).toLowerCase(); });
  define(String.prototype, "toLocaleUpperCase", function toLocaleUpperCase() { return String(this).toUpperCase(); });
  define(Number.prototype, "toLocaleString", function toLocaleString() { return String(Number(this)); });
  class InternalError extends Error {}
  Object.defineProperty(InternalError.prototype, "name", { value: "InternalError", writable: true, configurable: true });
  define(globalThis, "InternalError", InternalError);
})();`;

/** Kino's TextDecoder: utf-8 only, no streaming (every call decodes on its own). */
class KinoTextDecoder {
  #inner;
  constructor(label = "utf-8", options = {}) {
    const l = String(label).trim().toLowerCase();
    if (!["utf-8", "utf8", "unicode-1-1-utf-8"].includes(l)) throw new RangeError(`The "${label}" encoding is not supported`);
    this.#inner = new TextDecoder("utf-8", { fatal: !!(options && options.fatal), ignoreBOM: !!(options && options.ignoreBOM) });
  }
  get encoding() { return "utf-8"; }
  get fatal() { return this.#inner.fatal; }
  get ignoreBOM() { return this.#inner.ignoreBOM; }
  decode(input) { return this.#inner.decode(input); }
}

/** Kino's TextEncoder: `encode` and `encoding`, no `encodeInto`. */
class KinoTextEncoder {
  #inner = new TextEncoder();
  get encoding() { return "utf-8"; }
  encode(input = "") { return this.#inner.encode(input); }
}

/** Kino's console: four methods (log, info, warn, error); `console.debug`, `table`, `trace`... are undefined there. */
const kinoConsole = (c) => ({ log: (...a) => c.log(...a), info: (...a) => (c.info || c.log)(...a), warn: (...a) => (c.warn || c.log)(...a), error: (...a) => (c.error || c.log)(...a) });

/** The refusal Kino's one-file loader gives, in the kit's words. */
export function importRefusal(specifier) {
  return `the entry imports "${specifier}": Kino loads exactly one file and has no module resolver, so an import has nothing to resolve against on the device (bundle the plugin into one file; see "Splitting your code across files" in the guide)`;
}

/**
 * The plugin entry as a module namespace. `kino` is what the plugin sees as the global `kino` (the kit's stand-in, or the
 * signing lane's). `sandboxed` is false only when KINO_SDK_NO_SANDBOX=1 asked for a plain import.
 */
export async function loadPlugin(entryPath, kino, { console: pluginConsole = console } = {}) {
  const source = readFileSync(entryPath, "utf8");
  if (process.env.KINO_SDK_NO_SANDBOX === "1") {
    globalThis.kino = kino;
    const scratch = mkdtempSync(join(tmpdir(), "kino-plugin-"));
    try {
      const copy = join(scratch, "plugin.mjs");
      writeFileSync(copy, source);
      return { plugin: trackedExports(await import(pathToFileURL(copy).href)), sandboxed: false };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const provided = { kino, console: kinoConsole(pluginConsole), URL, URLSearchParams, atob, btoa, TextEncoder: KinoTextEncoder, TextDecoder: KinoTextDecoder };
  const context = vm.createContext(provided, { codeGeneration: { strings: true, wasm: false } });
  vm.runInContext(ENGINE_QUIRKS, context);
  const script = new vm.Script(toScript(source), { filename: entryPath });
  return { plugin: trackedExports(await script.runInContext(context)), sandboxed: true };
}

/**
 * The entry as the body of an async function that returns its namespace. `export` is removed where it stands (same columns, so
 * stack traces keep the entry's lines and columns) and the names it exported become getters on the returned object, live like a
 * module's bindings. An `import` is refused as the device would. Handles `export [async] function|class|const|let|var`,
 * `export { a, b as c }` and `export default`.
 */
export function toScript(source) {
  const text = blankLiterals(source);
  const chars = source.split("");
  const blankOut = (from, to) => { for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " "; };
  const exportsMap = new Map(); // exported name -> local name
  for (const m of text.matchAll(/(^|[;}{\n])\s*import\b\s*(?!\()([^;\n]*)/g)) {
    const spec = /["'`]([^"'`]+)["'`]/.exec(source.slice(m.index, m.index + 400));
    throw new Error(importRefusal(spec ? spec[1] : "…"));
  }
  const re = /(^|[^.\w$])export\b(?!\s*:)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[1].length;
    const rest = text.slice(start + 6);
    const lead = rest.match(/^\s*/)[0].length;
    const after = rest.slice(lead);
    const at = start + 6 + lead;
    let d;
    if ((d = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(after)) || (d = /^class\s+([A-Za-z_$][\w$]*)/.exec(after))) {
      exportsMap.set(d[1], d[1]);
      blankOut(start, at);
    } else if ((d = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(after))) {
      exportsMap.set(d[1], d[1]);
      blankOut(start, at);
    } else if (after.startsWith("{")) {
      const close = text.indexOf("}", at);
      if (close === -1) throw new SyntaxError("export { … } is not closed");
      let end = close + 1;
      if (/^\s*from\b/.test(text.slice(end))) {
        const spec = /["'`]([^"'`]+)["'`]/.exec(source.slice(end, end + 200));
        throw new Error(`${importRefusal(spec ? spec[1] : "(export … from)")}; \`export { … } from\` re-exports a second file, so bundle that file into the entry first (the kit's esbuild recipe), then export the names from the bundle`);
      }
      const list = text.slice(at + 1, close);
      for (const part of list.split(",")) {
        const pm = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (pm) exportsMap.set(pm[2] || pm[1], pm[1]);
      }
      while (end < text.length && /[ \t]/.test(text[end])) end++;
      if (text[end] === ";") end++;
      blankOut(start, end);
    } else if (after.startsWith("default")) {
      // `export default` is 14 columns, as is `var __default=`: the expression keeps its columns.
      const head = "var __default=";
      for (let i = 0; i < head.length; i++) chars[start + i] = head[i];
      exportsMap.set("default", "__default");
    }
  }
  const getters = [...exportsMap].map(([name, local]) => `${JSON.stringify(name)}: { enumerable: true, get() { return ${local}; } }`).join(", ");
  return `(async function () { "use strict"; ${chars.join("")}\n;return Object.defineProperties(Object.create(null), { ${getters} }); }).call(undefined)`;
}

// ---- A static look at the source, for the code a test does not reach ----

/** `source` with comments and the text of strings blanked out (same length, same line breaks); `${...}` expressions are kept. */
function blankLiterals(source) {
  const out = source.split("");
  const n = source.length;
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " "; };
  const regexAllowedAfter = (prev) => prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev);
  let i = 0;
  let prev = "";
  const templates = []; // depth of braces inside each open `${`
  const skipString = (quote) => {
    const start = i;
    i++;
    while (i < n && source[i] !== quote && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
    blank(start + 1, Math.min(i, n));
    i++;
  };
  const skipTemplateText = () => {
    // from just after a backtick or a closing `}` of an expression, up to the next `${` or the closing backtick
    const start = i;
    while (i < n) {
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === "`") { blank(start, i); i++; return; }
      if (source[i] === "$" && source[i + 1] === "{") { blank(start, i); i += 2; templates.push(0); return; }
      i++;
    }
    blank(start, n);
  };
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") { const s = i; while (i < n && source[i] !== "\n") i++; blank(s, i); continue; }
    if (c === "/" && source[i + 1] === "*") { const s = i; i += 2; while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++; i += 2; blank(s, Math.min(i, n)); continue; }
    if (c === '"' || c === "'") { skipString(c); prev = c; continue; }
    if (c === "`") { i++; skipTemplateText(); prev = "`"; continue; }
    if (c === "/" && regexAllowedAfter(prev)) {
      const s = i;
      i++;
      let inClass = false;
      while (i < n && source[i] !== "\n" && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        i++;
      }
      blank(s + 1, Math.min(i, n));
      i++;
      prev = "/";
      continue;
    }
    if (templates.length) {
      if (c === "{") templates[templates.length - 1]++;
      else if (c === "}") {
        if (templates[templates.length - 1] === 0) { templates.pop(); i++; skipTemplateText(); prev = "`"; continue; }
        templates[templates.length - 1]--;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

/**
 * Free uses of a global Kino does not have: `setTimeout(...)`, `Buffer.from(...)`, `await fetch(url)`. Not property accesses
 * (`kino.fetch`, `x.crypto`), not `typeof setTimeout` (a feature test), and not a name the file declares itself. Best effort on
 * the text, not a parser: it exists so that code a test never runs is still named. Returns `[{ name, line, advice }]`.
 */
export function scanMissingGlobals(source) {
  const text = blankLiterals(source);
  const declared = new Set();
  for (const m of text.matchAll(/\b(?:const|let|var|function|class|import)\s+(?:\{[^}]*\}\s*,?\s*|\*\s+as\s+)?([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of text.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) declared.add(m[1]); // destructuring and shorthand: be lenient
  for (const m of text.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) for (const p of m[1].split(",")) declared.add(p.replace(/=.*$/, "").replace(/[.\s{}[\]]/g, ""));
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  const hits = [];
  const seen = new Set();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = m[0];
    if (!Object.prototype.hasOwnProperty.call(MISSING_GLOBALS, name) || declared.has(name)) continue;
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    if (k >= 0 && text[k] === ".") continue; // a property: kino.fetch, globalThis.setTimeout
    if (/typeof\s*$/.test(text.slice(Math.max(0, k - 7), k + 1))) continue; // a feature test
    const after = text.slice(m.index + name.length).match(/^\s*(.)/);
    if (after && after[1] === ":" && /[{,]$/.test(text.slice(0, m.index).trimEnd())) continue; // an object key
    const line = text.slice(0, m.index).split("\n").length;
    const key = `${name}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ name, line, advice: MISSING_GLOBALS[name] });
  }
  return hits;
}

export const missingGlobalLines = (hits) => hits.map((h) => `line ${h.line}: \`${h.name}\` does not exist in Kino (${h.advice}); Node has it, so a test run under Node would not catch this`);

