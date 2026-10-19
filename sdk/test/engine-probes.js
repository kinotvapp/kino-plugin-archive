// A battery of language probes. The SAME file runs in two places:
//  - inside Kino's real plugin engine (QuickJS, on the JVM) by PluginEngineProbeTest, which writes its answers to
//    engine-probes.expected.json;
//  - inside the kit's sandbox (V8) by engine-probes.test.mjs, which compares against that file.
// A difference is a place where a plugin tested in the kit could behave differently in the app. Every probe answers
// ASCII-only JSON, avoids anything that depends on the machine's time zone or locale, and reports a thrown error as
// "ErrorName" (messages differ between engines on purpose and are not compared).
const ser = (v) => {
  if (v === undefined) return "undefined";
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "function" || typeof v === "symbol") return typeof v;
  return JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
};

const probes = {
  // ---- globals the engine has or lacks
  "typeof missing globals": () => ["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "Buffer", "process", "require", "fetch", "AbortController", "structuredClone", "performance", "crypto", "WeakRef", "FinalizationRegistry", "Intl", "Atomics", "SharedArrayBuffer", "WebAssembly", "escape", "unescape", "globalThis", "module", "exports", "__dirname"].map((n) => `${n}:${typeof globalThis[n]}`),
  "typeof language globals": () => ["Proxy", "Reflect", "Symbol", "BigInt", "Map", "Set", "WeakMap", "WeakSet", "Promise", "ArrayBuffer", "DataView", "Uint8Array", "Float64Array", "BigInt64Array", "JSON", "Math", "Date", "RegExp", "Error", "AggregateError", "eval", "Function"].map((n) => `${n}:${typeof globalThis[n]}`),
  "typeof provided globals": () => ["kino", "console", "URL", "URLSearchParams", "atob", "btoa", "TextEncoder", "TextDecoder", "Headers", "Request", "Response", "Blob", "FormData", "Event", "EventTarget", "URLPattern", "navigator", "location", "window", "self", "document"].map((n) => `${n}:${typeof globalThis[n]}`),
  "console methods": () => ["log", "info", "warn", "error", "debug", "trace", "table", "dir", "time", "timeEnd", "assert", "group", "count"].map((n) => `${n}:${typeof console[n]}`),
  "ES2022-2025 methods": () => ({
    at: typeof [].at, findLast: typeof [].findLast, findLastIndex: typeof [].findLastIndex, toSorted: typeof [].toSorted, toReversed: typeof [].toReversed, toSpliced: typeof [].toSpliced, with: typeof [].with,
    hasOwn: typeof Object.hasOwn, groupBy: typeof Object.groupBy, mapGroupBy: typeof Map.groupBy, fromEntries: typeof Object.fromEntries,
    replaceAll: typeof "".replaceAll, isWellFormed: typeof "".isWellFormed, toWellFormed: typeof "".toWellFormed, matchAll: typeof "".matchAll,
    promiseAny: typeof Promise.any, allSettled: typeof Promise.allSettled, withResolvers: typeof Promise.withResolvers, fromAsync: typeof Array.fromAsync, tryFn: typeof Promise.try,
    setUnion: typeof new Set().union, setIsSubsetOf: typeof new Set().isSubsetOf, iteratorHelpers: typeof globalThis.Iterator, arrayFlat: typeof [].flat, flatMap: typeof [].flatMap,
    structuredClone: typeof globalThis.structuredClone, errorCause: new Error("x", { cause: 1 }).cause, stringRaw: typeof String.raw, objectEntries: typeof Object.entries,
    bigintAsUintN: typeof BigInt.asUintN, weakRef: typeof globalThis.WeakRef, arrayBufferResize: typeof new ArrayBuffer(1).resize, arrayBufferTransfer: typeof new ArrayBuffer(1).transfer,
    regexpHasIndices: typeof /a/d.hasIndices, dateToTemporal: typeof globalThis.Temporal,
  }),

  // ---- regular expressions
  "regexp lookbehind": () => "price: $42".match(/(?<=\$)\d+/)[0],
  "regexp named groups": () => { const m = "2024-05-06".match(/(?<y>\d{4})-(?<m>\d\d)/); return [m.groups.y, m.groups.m]; },
  "regexp unicode property": () => "Ñandú 日本".match(/\p{L}+/gu),
  "regexp unicode property script": () => "abc αβγ 日本".match(/\p{Script=Greek}+/u)[0],
  "regexp sticky and lastIndex": () => { const r = /a/y; r.lastIndex = 1; return [r.test("ba"), r.lastIndex]; },
  "regexp matchAll": () => [..."a1b22c333".matchAll(/\d+/g)].map((m) => [m[0], m.index]),
  "regexp case-insensitive unicode": () => [/ñ/i.test("Ñ"), /ß/i.test("SS"), /\u212a/i.test("k"), /\u212a/iu.test("k")],
  "regexp dotAll and flags": () => [/a.b/s.test("a\nb"), /a.b/.test("a\nb"), /a/gimsuy.flags],
  "regexp split with captures": () => "a1b2c".split(/(\d)/),
  "regexp replace fn and $<name>": () => ["abc".replace(/(?<x>b)/, "[$<x>]"), "abc".replace(/b/, (m, i) => `${m}${i}`), "aaa".replace(/a/g, "$&$&")],
  "regexp backtracking guard": () => { const t = Date.now(); /(a+)+b/.test("a".repeat(22)); return Date.now() - t < 5000; },
  "regexp indices flag": () => { try { return /(?<a>b)/d.exec("abc").indices.groups.a; } catch (e) { return e.name; } },
  "regexp \\w with unicode ignoreCase": () => [/\w/iu.test("\u017f"), /[\w]/iu.test("\u212a")],
  "regexp lastIndex after failed global": () => { const r = /x/g; r.lastIndex = 5; r.test("abc"); return r.lastIndex; },
  "regexp String(re) and source escapes": () => [String(/a\/b/), new RegExp("a/b").source, new RegExp("\n").source, new RegExp("").source],

  // ---- strings
  "string localeCompare": () => ["a".localeCompare("B"), "ñ".localeCompare("o"), "a".localeCompare("A"), "10".localeCompare("9", undefined, { numeric: true }), "résumé".localeCompare("resume", "en", { sensitivity: "base" })],
  "string case mapping": () => ["i\u0307".toUpperCase(), "\u0130".toLowerCase().length, "ß".toUpperCase(), "\u03a3".toLowerCase(), "ΑΣ".toLowerCase(), "ǅ".toLowerCase(), "ǆ".toUpperCase()],
  "string toLocale case": () => ["I".toLocaleLowerCase("tr"), "i".toLocaleUpperCase("tr")],
  "string normalize": () => ["\u00e9".normalize("NFD").length, "e\u0301".normalize("NFC").length, "\ufb01".normalize("NFKC"), "\u00e9".normalize("NFKD").length],
  "string unicode handling": () => ["😀".length, [..."😀a"].length, "😀".codePointAt(0), "😀".at(0).length, String.fromCodePoint(128512).length, "a\ud800b".length, "\ud83d".isWellFormed ? "\ud83d".isWellFormed() : "no"],
  "string pad slice substr": () => ["5".padStart(3, "0"), "ab".padEnd(5, "xy"), "abcdef".substr(-3, 2), "abcdef".slice(-3, -1), "abc".substring(2, 0)],
  "string trim whitespace set": () => [" \u00a0\ufeff\u2003\u180ex ".trim().length, "\u200bx".trim().length, "\u0085x".trim().length],
  "string split edge": () => ["".split(","), "".split(""), "abc".split("", 2), "a,b,".split(",")],
  "string raw and escapes": () => [String.raw`a\nb`.length, "\x41\u{1F600}".length, `a${1 + 1}b`],
  "string search compare codeunit": () => ["Z" < "a", "é" < "f", "😀" < "\uffff", ["b", "a", "B", "A", "é", "e"].sort()],
  "string toString of numbers": () => [(0.1 + 0.2).toString(), (1e21).toString(), (1e-7).toString(), (123.456).toFixed(1), (0.000001234).toPrecision(2), (255).toString(16), (-255).toString(2), (0.5).toString(2), (1234.5678).toExponential(2)],
  "number formatting locale": () => [(1234567.891).toLocaleString(), (1234567.891).toLocaleString("de-DE"), (1234.5).toLocaleString("es-CO", { style: "currency", currency: "COP" }), (0.256).toLocaleString("en", { style: "percent" }), (5).toLocaleString("en", { minimumIntegerDigits: 2 })],
  "RegExp v flag": () => { try { return new RegExp("a", "v").unicodeSets; } catch (e) { return e.name; } },
  "date toLocale": () => { const d = new Date(2024, 0, 15, 13, 5, 9); const t = (f) => { try { return f(); } catch (e) { return e.name; } }; return [t(() => d.toLocaleDateString("en-US")), t(() => d.toLocaleDateString("en-US", { month: "long", year: "numeric" })), t(() => d.toLocaleTimeString("en-US")), t(() => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })), t(() => d.toLocaleString("en-US")), t(() => d.toLocaleString()), t(() => d.toLocaleDateString()), t(() => d.toLocaleTimeString()), t(() => new Date(2024, 0, 5, 0, 5, 9).toLocaleTimeString("en-US")), t(() => new Date(2024, 0, 5, 12, 5, 9).toLocaleTimeString("en-US"))]; },

  // ---- Date (time-zone independent forms only)
  "date iso and utc": () => { const d = new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)); return [d.toISOString(), d.toJSON(), d.getUTCDay(), d.getTime(), new Date(0).toUTCString()]; },
  "date parse iso variants": () => ["2020-01-02", "2020-01-02T03:04:05Z", "2020-01-02T03:04:05.123+05:30", "2020-01-02T03:04Z", "2020-01", "2020", "+002020-01-02T00:00:00Z", "2020-13-01", "2020-02-30", "2020-01-02T24:00:00Z", "2020-01-02T25:00:00Z", "Thu, 02 Jan 2020 03:04:05 GMT", "Jan 2 2020 03:04:05 GMT+0100", "2 January 2020 UTC", "2020/01/02 UTC", "01/02/2020 GMT", "20200102", "", "abc"].map((s) => Date.parse(s)),
  "date parse local forms relative to local ctor": () => ["2020-01-02T03:04:05", "2020-01-02T03:04", "2020-01-02 03:04:05", "Jan 2 2020 03:04:05", "01/02/2020", "2020/01/02", "January 2, 2020", "Thu Jan 02 2020 03:04:05"].map((s) => { const p = Date.parse(s); return Number.isNaN(p) ? "NaN" : p - new Date(2020, 0, 2, s.includes(":") ? 3 : 0, s.includes(":") ? 4 : 0, s.includes(":05") ? 5 : 0).getTime(); }),
  "date overflow and invalid": () => [new Date(NaN).getTime(), String(new Date(NaN)), (() => { try { return new Date(NaN).toISOString(); } catch (e) { return e.name; } })(), new Date(8.64e15).getTime(), new Date(8.64e15 + 1).getTime(), Date.UTC(2020, 12, 1), Date.UTC(99, 0), new Date(Date.UTC(2020, 0, 31)).setUTCMonth(1)],
  "date setters getters": () => { const d = new Date(Date.UTC(2020, 0, 31)); d.setUTCMonth(1); return [d.toISOString(), d.getUTCFullYear(), new Date(Date.UTC(2020, 0, 1)).valueOf(), +new Date(5), new Date(2020, 0, 1) instanceof Date]; },
  "date string format shape": () => { const s = String(new Date(Date.UTC(2020, 0, 2, 3, 4, 5))); return [/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d\d 2020 \d\d:\d\d:\d\d GMT[+-]\d{4}/.test(s), /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d\d 2020$/.test(new Date(Date.UTC(2020, 0, 2, 12)).toDateString()), typeof new Date().getTimezoneOffset()]; },
  "date year 0-99 and negatives": () => [new Date(Date.UTC(0, 0, 1)).getUTCFullYear(), new Date("0099-01-01T00:00:00Z").getUTCFullYear(), new Date(-1).toISOString(), new Date("-000001-01-01T00:00:00Z").toISOString()],

  // ---- numbers and math
  "number parsing": () => [parseInt("0x1f"), parseInt("08"), parseInt(" 12px"), parseFloat("1e3x"), Number(""), Number(" 12 "), Number("0b101"), Number("1_000"), Number("١٢"), Number(null), Number([5]), +"Infinity", parseInt("1e3"), parseFloat(".5."), Number("12e"), (1e21).toFixed(2), (-1.5).toFixed(0), (2.5).toFixed(0), (1.005).toFixed(2), (0.5).toFixed(0), (-0).toFixed(1)],
  "math": () => [Math.round(-0.5), Math.round(2.5), Math.round(-2.5), Math.max(), Math.min(), Math.hypot(3, 4), Math.cbrt(27), Math.sign(-3), Math.trunc(-4.7), Math.clz32(1), Math.fround(5.5), Math.imul(2 ** 31, 2), 2 ** -1074, 0.1 * 3, 9007199254740993, 5 % -3, -5 % 3, 2 ** 53 + 2, Math.expm1(1e-10), Math.atan2(1, 1)],
  "bigint": () => [(2n ** 64n).toString(), BigInt.asUintN(8, 257n), 7n / 2n, -7n % 3n, typeof (5n * 5n), BigInt("0x10"), (() => { try { return 1n + 1; } catch (e) { return e.name; } })(), 10n > 9, 2n == 2, JSON.stringify({ a: 1 }), (123456789012345678901234567890n).toString(36)],
  "typed arrays": () => { const u = new Uint8Array([1, 2, 300]); const f = new Float32Array([1.1]); const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, Math.PI); return [Array.from(u), f[0], dv.getUint8(0), Array.from(new Uint8Array(dv.buffer)), new Uint8Array(2).fill(7).join(), Array.from(new Uint8ClampedArray([300, -5, 1.5, 2.5])), new Int8Array([200])[0], Array.from(new Uint8Array([3, 1, 2]).sort()), new Uint16Array(new Uint8Array([1, 2]).buffer)[0], typeof new Uint8Array(1).toHex, typeof Uint8Array.fromBase64]; },

  // ---- arrays, objects, iteration
  "array sort inconsistent comparator": () => [[1, 2, 3].sort(() => -1), [1, 2, 3].sort(() => 1)],
  "array sort": () => [[3, 1, 10, 2].sort(), [3, 1, 10, 2].sort((a, b) => a - b), [undefined, 3, , 1].sort(), [{ k: 1, v: "a" }, { k: 0, v: "b" }, { k: 1, v: "c" }, { k: 0, v: "d" }].sort((a, b) => a.k - b.k).map((x) => x.v).join(""), Array.from({ length: 40 }, (_, i) => ({ g: i % 2, i })).sort((a, b) => a.g - b.g).map((x) => x.i).join(","), [3, 2, 1].sort(() => 0)],
  "array holes and length": () => { const a = [1, , 3]; a.length = 5; return [Object.keys(a), 1 in a, a.indexOf(undefined), a.includes(undefined), a.flat(), JSON.stringify(a), a.map((x) => 1).length, Array(3).join("-"), Array.from({ length: 2 }), [, ,].length]; },
  "array methods": () => [[1, [2, [3, [4]]]].flat(Infinity), [1, 2, 3].at(-1), [1, 2, 3, 4].findLast((x) => x % 2), [3, 1, 2].toSorted?.(), [1, 2, 3].with?.(1, 9), [[1, 2], [3]].flatMap((x) => x), Array.from("abc", (c) => c + c), Array.of(7).length, [1, 2, 3].copyWithin(0, 1), [1, 2, 3].reduceRight((a, b) => a + "" + b), [..."ab"].entries().next().value, [0, -0, NaN].indexOf(NaN), [NaN].includes(NaN), [].concat([1], 2, [[3]])],
  "object key order": () => Object.keys({ b: 1, 2: 1, a: 1, 1: 1, [Symbol("s")]: 1, "-1": 1, "01": 1, 4294967295: 1, 4294967294: 1 }),
  "object semantics": () => [Object.entries({ a: 1, b: [2] }), Object.fromEntries([["a", 1]]), Object.getOwnPropertyNames("ab"), Object.assign({}, "ab", null, [9]), (() => { try { "use strict"; Object.freeze([1]).push(2); } catch (e) { return e.name; } })(), Object.is(NaN, NaN), JSON.stringify(Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a")), typeof Object.getOwnPropertyDescriptors, ({}).toString.call(null), ({}).toString.call([]), ({}).toString.call(new Date()), ({}).toString.call(/x/), ({}).toString.call(function* () {}()), ({}).toString.call(Promise.resolve()), ({}).toString.call(new Map())],
  "class features": () => { class A { #p = 1; static s = 2; static #sp = 3; get p() { return this.#p; } static has(o) { return #p in o; } static { A.init = "yes"; } static sp() { return A.#sp; } } return [new A().p, A.s, A.has(new A()), A.has({}), A.init, A.sp()]; },
  "generators async iterators": async () => { async function* g() { yield 1; yield 2; } const out = []; for await (const x of g()) out.push(x); function* h() { const x = yield 1; return x * 2; } const it = h(); it.next(); return [out, it.next(21), [...(function* () { yield* [1, 2]; })()], await Promise.all([1, Promise.resolve(2)])]; },
  "destructuring spread rest": () => { const { a = 5, ...r } = { b: 1, c: 2 }; const [x, , y = 9, ...z] = [1, 2, undefined, 4, 5]; return [a, r, x, y, z, { ...{ a: 1 }, ...null, ...[7] }, Math.max(...[1, 5, 3]), ((a, b = a + 1, ...c) => [a, b, c])(1)]; },
  "optional chaining nullish": () => { const o = { a: { b: null } }; let n = 0; const f = () => { n++; return 1; }; o.x?.[f()]; return [o.a?.b?.c, o?.a.b ?? "d", 0 ?? 1, "" || "e", o.a?.["b"], n, (null)?.x, typeof o.m?.(), (o.q ||= 4), (o.q &&= 5), (o.z ??= 6), 2 ** 3 ** 2, (-2) ** 2]; },
  "label tagged template getter setter": () => { const tag = (s, ...v) => s.raw.join("|") + v.join(); const o = { _v: 1, get v() { return this._v; }, set v(x) { this._v = x * 2; } }; o.v = 4; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; if (i === 2) break outer; } } return [tag`a${1}b\n${2}`, o.v, tag``, ((s) => Object.isFrozen(s))`x`, ((s) => s === ((t) => t)`x`)`x`]; },
  "json": () => [JSON.stringify({ a: undefined, b: () => 1, c: NaN, d: new Date(0), e: [undefined], f: -0, g: Infinity, h: 1n === 1n, i: Symbol("x") }), JSON.stringify("\u2028\ud800"), JSON.stringify({ a: 1, b: [1, 2] }, null, 2), JSON.stringify([1], null, "--"), JSON.stringify({ a: 1, b: 2 }, ["b"]), JSON.parse("[1,2]", (k, v) => (typeof v === "number" ? v + 1 : v)), (() => { try { JSON.parse("{'a':1}"); } catch (e) { return e.name; } })(), (() => { try { JSON.parse("[1,]"); } catch (e) { return e.name; } })(), JSON.parse('"\\u00e9"'), JSON.stringify({ toJSON() { return 7; } }), (() => { try { JSON.stringify(1n); } catch (e) { return e.name; } })(), (() => { const c = {}; c.c = c; try { JSON.stringify(c); } catch (e) { return e.name; } })(), JSON.parse("1e3"), JSON.parse(" \t\n[ ] "), JSON.parse('{"__proto__":1}').__proto__, JSON.stringify("\u007f")],
  "map set weak": () => { const m = new Map([[NaN, 1], [0, 2]]); const s = new Set([1, 1, "1", NaN, NaN, 0, -0]); const wm = new WeakMap(); const k = {}; wm.set(k, 1); return [m.get(NaN), m.get(-0), s.size, [...s], wm.get(k), (() => { try { wm.set(1, 1); } catch (e) { return e.name; } })(), [...new Map([[1, 2]]).keys()], new Map([[1, 2]]).size, typeof new Set().union]; },
  "symbol proxy reflect": () => { const log = []; const p = new Proxy({}, { get: (t, k) => { log.push(String(k)); return 1; }, has: () => true, ownKeys: () => ["a"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) }); const x = p.foo; return [x, "z" in p, Object.keys(p), Reflect.ownKeys({ a: 1, [Symbol.iterator]: 1 }).length, Symbol("d").description, Symbol.for("a") === Symbol.for("a"), typeof Symbol.asyncIterator, typeof Symbol.matchAll, String(Symbol("q")), Reflect.has({ a: 1 }, "a"), Reflect.getPrototypeOf([]) === Array.prototype, log]; },
  "iteration protocols": () => [Array.from(new Map([[1, 2]])), Array.from("a😀"), Object.entries([5, 6]), [..."ab"].map((c, i) => c + i), Array.from(new Set([3, 3, 4]).values()), [...[1, 2].keys()], typeof [][Symbol.iterator]().next, typeof ""[Symbol.iterator], Math.max.apply(null, Array(3).fill(2))],
  "function properties": () => [(function f(a, b) {}).length, ((a, b = 1, c) => {}).length, (function () {}).name, (() => {}).name, (class Q {}).name, ({ m() {} }).m.name, (async () => {}).constructor.name, (function* () {}).constructor.name, String(function f(a) { return a; }), String(() => 1), String(class A { x() {} }), String(Math.max), String(async function g() {}), (function () { return typeof this; }).call(1), (function () { "use strict"; return typeof this; }).call(1), (() => typeof this)(), Function.prototype.toString.call(class {}).length > 0],
  "string of builtins": () => [String(Symbol), String(parseInt), String(Map), String(Object.prototype.hasOwnProperty), Object.prototype.toString.call(globalThis), String(globalThis), String(undefined), String(null), String([1, [2, 3]]), String({}), String(() => {}), `${[]}`, [] + {}, [1] == 1, null == undefined, null == 0, NaN != NaN, "b" + "a" + +"a" + "a"],

  // ---- errors
  "stack overflow error name": () => { try { (function f() { f(); })(); } catch (x) { return x.name; } },
  "error shapes": () => { const e = new TypeError("boom"); const c = (() => { try { null.x; } catch (x) { return x; } })(); const r = (() => { try { undefinedVar; } catch (x) { return x; } })(); return [e.name, e.message, String(e), e instanceof Error, typeof e.stack, e.stack.split("\n")[0], Object.prototype.toString.call(e), Object.keys(e), c.name, r.name, (() => { try { new Array(-1); } catch (x) { return x.name; } })(), (() => { try { (void 0)(); } catch (x) { return x.name; } })(), (() => { try { x = 1; let x; } catch (x) { return x.name; } })(), (() => { try { "x".repeat(-1); } catch (x) { return x.name; } })(), (() => { try { new (class A { constructor() { this.x; } }); class B extends Object { constructor() { this.x; } } new B(); } catch (x) { return x.name; } })(), (() => { try { BigInt(1.5); } catch (x) { return x.name; } })(), (() => { try { decodeURIComponent("%"); } catch (x) { return x.name; } })(), (() => { try { new RegExp("["); } catch (x) { return x.name; } })(), (() => { try { Symbol() + ""; } catch (x) { return x.name; } })(), (() => { try { Object.defineProperty(Object.freeze({}), "a", { value: 1 }); } catch (x) { return x.name; } })(), (() => { try { new Intl.NumberFormat(); } catch (x) { return x.name; } })()]; },
  "Error.stackTraceLimit": () => typeof Error.stackTraceLimit,
  "error cause aggregate": () => { const e = new Error("a", { cause: "c" }); const ag = new AggregateError([new Error("x")], "m"); return [e.cause, ag.errors.length, ag.name, ag.message, e.hasOwnProperty("cause"), e.hasOwnProperty("message"), new Error().message === "", "stack" in new Error(), Error.captureStackTrace === undefined ? "undef" : typeof Error.captureStackTrace]; },
  "error thrown values": () => { const out = []; for (const v of [1, "s", null, undefined, { a: 1 }]) { try { throw v; } catch (x) { out.push(x); } } return out; },
  // A promise rejected before a handler is attached (`try { await f() } catch {}` where f throws at once) is NOT probed
  // here: the app ships a patched QuickJS that handles it (jniLibs/patches/0002, PluginAsyncRejectionTest), but the JVM
  // unit tests only load that patch on macOS arm64, so the answer would depend on the machine that wrote the fixture.
  "async: rejection one tick later, awaited in try/catch": async () => { try { await Promise.resolve().then(() => { throw new Error("l"); }); } catch (e) { return e.message; } },
  "async: race with a never-settling promise": async () => Promise.race([new Promise(() => {}), Promise.resolve("w")]),
  "microtask and thenable order": async () => { const log = []; const p = Promise.resolve(); p.then(() => log.push("a")); (async () => { log.push("b"); await null; log.push("c"); })(); Promise.resolve({ then(r) { log.push("t"); r(); } }).then(() => log.push("d")); log.push("e"); await new Promise((r) => r()); await null; await null; return log; },
  "promise resolve return await ordering": async () => { const log = []; const a = (async () => { await 1; log.push("a1"); await 2; log.push("a2"); })(); const b = (async () => { return Promise.resolve(); })().then(() => log.push("b")); const c = Promise.resolve().then(() => log.push("c1")).then(() => log.push("c2")).then(() => log.push("c3")).then(() => log.push("c4")); await Promise.all([a, b, c]); return log; },
  "await in sync gaps": async () => { let x = 0; const f = async () => { x++; await null; x++; }; const p = f(); const mid = x; await p; return [mid, x]; },

  // ---- URL, encoding, base64 (provided by Kino)
  "URL parsing": () => { const u = new URL("https://user:pw@Example.COM:443/a/../b/./c?q=1&q=2#h"); return [u.href, u.origin, u.host, u.hostname, u.port, u.pathname, u.search, u.hash, u.username, u.protocol, [...u.searchParams.entries()], new URL("../x", "http://a/b/c/d").href, new URL("//h/p", "https://a").href, new URL("file:///a/b").pathname, new URL("http://[::1]:80/").host, new URL("HTTP://A.com").href, new URL("http://a.com:8080").port, new URL("http://a.com/ü?ü#ü").href]; },
  "URL internationalized host": () => { try { return new URL("http://münchen.de").href; } catch (e) { return e.name; } },
  "URL errors and edge": () => ["nope", "http://", "http://a b/", "https://exa mple.com", "http://a.com:99999", "javascript:alert(1)", "data:text/plain,hi", "http://1.2.3", "http://0x7f.1", "mailto:a@b.c", "http://a.com/%zz", "http:\\\\a.com\\b", "https://a.com\t/x", "http://a.com/a b"].map((s) => { try { return new URL(s).href; } catch (e) { return e.name; } }),
  "URL setters": () => { const u = new URL("http://a.com/x?y=1"); u.searchParams.append("z", "a b&c"); u.pathname = "/p q"; u.hash = "#frag"; u.port = "81"; u.protocol = "https"; return [u.href, u.searchParams.toString()]; },
  "URLSearchParams": () => { const p = new URLSearchParams("a=1&b=%20x+y&a=2&c"); p.sort(); const q = new URLSearchParams({ k: "v w", e: "é" }); return [p.get("b"), p.getAll("a"), p.has("c"), p.toString(), q.toString(), [...new URLSearchParams([["x", "1"]]).keys()], new URLSearchParams("?a=1").get("a"), p.size, typeof p.delete, (() => { const d = new URLSearchParams("a=1&a=2"); d.delete("a", "1"); return d.toString(); })(), new URLSearchParams("a=%zz&b=%E0%A4").toString(), new URLSearchParams("a=b=c").get("a")]; },
  "encodeURI family": () => [encodeURIComponent("é €😀 /?&=+"), encodeURI("http://a/é ü?x=1&y=é#h"), decodeURIComponent("%C3%A9%20"), escape?.("é ü"), decodeURI("%41%2F"), encodeURIComponent("\ud83d\ude00"), (() => { try { encodeURIComponent("\ud800"); } catch (e) { return e.name; } })()],
  "atob btoa": () => [btoa("hello"), atob("aGVsbG8="), atob("aGVsbG8"), atob(" aGVs bG8="), (() => { try { return btoa("é\u0100"); } catch (e) { return e.name; } })(), btoa("é"), atob("w6k=").length, (() => { try { return atob("a"); } catch (e) { return e.name; } })(), (() => { try { return atob("a!b="); } catch (e) { return e.name; } })(), btoa(""), atob(""), btoa("\u00ff\u0000"), atob("//8="), atob("ab==") === atob("ab"), (() => { try { return atob("a b c"); } catch (e) { return e.name; } })()],
  "TextEncoder TextDecoder": () => [Array.from(new TextEncoder().encode("é€😀")), new TextDecoder().decode(new Uint8Array([0xc3, 0xa9, 0xe2, 0x82, 0xac])), new TextDecoder().decode(new Uint8Array([0xff, 0x41])), new TextDecoder("utf-8").encoding, (() => { try { return new TextDecoder("latin1").encoding; } catch (e) { return e.name; } })(), (() => { try { return new TextDecoder("utf-16le").decode(new Uint8Array([0x41, 0])); } catch (e) { return e.name; } })(), new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).length, (() => { try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])); } catch (e) { return e.name; } })(), new TextEncoder().encoding, Array.from(new TextEncoder().encode("\ud800")), typeof new TextEncoder().encodeInto, new TextDecoder().decode(new ArrayBuffer(2)).length, new TextDecoder().decode().length],
  "TextEncoder stream decode": () => { const d = new TextDecoder(); const a = d.decode(new Uint8Array([0xe2, 0x82]), { stream: true }); const b = d.decode(new Uint8Array([0xac])); return [a, b]; },

  // ---- timing and environment
  "Date.now and clocks": () => [typeof Date.now(), Date.now() > 1.6e12, new Date().getFullYear() >= 2024, typeof new Date().getTimezoneOffset(), Number.isInteger(Date.now())],
  "Math.random range": () => { let ok = true; for (let i = 0; i < 100; i++) { const r = Math.random(); if (!(r >= 0 && r < 1)) ok = false; } return ok; },
  "global object prototype": () => [Object.getPrototypeOf(globalThis) === Object.prototype, String(globalThis)],
  "global object shape": () => [Object.isExtensible(globalThis), "x" in globalThis, (() => { globalThis.__p = 1; const r = typeof __p; delete globalThis.__p; return r; })(), (() => { try { return typeof (0, eval)("this").Array; } catch (e) { return e.name; } })(), (() => { try { return new Function("return typeof this")(); } catch (e) { return e.name; } })(), (() => { try { return eval("1+1"); } catch (e) { return e.name; } })(), typeof globalThis.kino, Object.isFrozen(globalThis.kino || {}), typeof this, typeof undefined, void 0 === undefined, (() => { "use strict"; try { undeclared = 1; } catch (e) { return e.name; } })()],
  "globalThis own names (language only)": () => Object.getOwnPropertyNames(globalThis).filter((n) => /^[A-Z]/.test(n) && typeof globalThis[n] === "function" && /^(Array|Object|Number|String|Boolean|Symbol|BigInt|Map|Set|Weak|Promise|Proxy|Reflect|JSON|Math|Date|RegExp|Error|Aggregate|Eval|Range|Reference|Syntax|Type|URI|Internal|Int|Uint|Float|Big|DataView|ArrayBuffer|Shared|Atomics|Iterator|Intl|Temporal|Function|Finalization|Disposable|AsyncDisposable|SuppressedError)/.test(n)).sort(),
  "console is callable and silent": () => { console.log("probe"); console.warn("probe"); console.error("probe"); return [typeof console.log, typeof console.log("x"), console.log.length]; },
  "kino frozen": () => [Object.isFrozen(globalThis.kino), typeof kino.sleep, typeof kino.fetch, typeof kino.storage, typeof kino.crypto, typeof kino.cloudstream, typeof kino.config, typeof kino.log, typeof kino.error, typeof kino.html, typeof kino.cookies, typeof kino.secret, typeof kino.device, typeof kino.seed, typeof kino.meta, typeof kino.tmdb, typeof kino.browser, typeof kino.fetchAnyHost, Object.keys(kino).sort()],
  "eval and Function constructor": () => [(() => { try { return eval("typeof kino"); } catch (e) { return e.name; } })(), (() => { try { return new Function("a", "b", "return a+b")(1, 2); } catch (e) { return e.name; } })(), (() => { try { return (0, eval)("var __v = 3; typeof __v"); } catch (e) { return e.name; } })(), typeof globalThis.__v, (() => { try { return eval("(function(){ return 1 })()"); } catch (e) { return e.name; } })()],
  "getter on array length and sparse perf": () => { const a = []; a[100000] = 1; return [a.length, Object.keys(a).length, a.filter(() => true).length]; },
  "large: string repeat 1e6": () => "x".repeat(1e6).length,
  "large: string repeat 1e7": () => "x".repeat(1e7).length,
  "large: array fill 1e6": () => new Array(1e6).fill(0).length,
  "large: array fill 1e7": () => new Array(1e7).fill(0).length,
  "large: split into 5e5 parts": () => "ab".repeat(5e5).split("a").length,
  "large: array from 1e5 reduce": () => Array.from({ length: 1e5 }, (_, i) => i).reduce((a, b) => a + b, 0),
  "large: spread string 1e5": () => [..."x".repeat(1e5)].length,
  "large: regex replace to 2 MB": () => "a".repeat(2 ** 20).replace(/a/g, "bb").length,
  "large: string concat loop 1e5": () => { let s = ""; for (let i = 0; i < 1e5; i++) s += "ab"; return s.length; },
  "large: JSON 5 MB": () => JSON.stringify(JSON.parse(JSON.stringify({ a: "x".repeat(5e6) }))).length,
  "large: nested array depth 5000 JSON": () => JSON.stringify(JSON.parse("[".repeat(5000) + "]".repeat(5000))).length,
  "large: recursion depth 5000": () => { const f = (n) => (n === 0 ? 0 : 1 + f(n - 1)); return f(5000); },
  "large: recursion depth 50000": () => { const f = (n) => (n === 0 ? 0 : 1 + f(n - 1)); return f(50000); },
  "large: object with 1e6 keys": () => { const o = {}; for (let i = 0; i < 1e6; i++) o["k" + i] = i; return Object.keys(o).length; },
  "large: Map with 1e6 entries": () => { const m = new Map(); for (let i = 0; i < 1e6; i++) m.set(i, i); return m.size; },
  "large: typed array 50 MB": () => new Uint8Array(50e6).length,
  "string concat and number edge": () => ["" + 1e21, "" + 1e-7, "" + 123456789012345680000, "" + 0.000001, "" + -1e-7, 1 / 3 + "", 100 .toString(), (25).toString(36), 0.1 + 0.7, 4.35 * 100, 1.1 * 1.1, 123456789.123456789 + "", 5e-324 + "", 1.7976931348623157e308 * 10 + "", (-1e21).toString(), (1e21).toLocaleString === undefined],
  "date get local vs utc": () => { const d = new Date(Date.UTC(2020, 5, 15, 12)); return [d.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime() === 0, d.getTimezoneOffset() === new Date(2020, 5, 15, 12).getTimezoneOffset()]; },
};

// home() answers every probe. The app's test runs each probe alone instead (home("names?") lists them, home("<name>")
// answers one), because some failures take the whole call down: running out of the plugin's memory is not catchable
// in JS, and the "large:" probes are written to find that limit.
export async function home(only) {
  if (only === "names?") return JSON.stringify(Object.keys(probes));
  const out = [];
  for (const [name, fn] of Object.entries(probes)) {
    if (typeof only === "string" && name !== only) continue;
    let result;
    try {
      result = ser(await fn());
    } catch (e) {
      result = `THROWS ${e && e.name}`;
    }
    out.push({ name, result });
  }
  return JSON.stringify(out);
}
