// The plugin protocol (apiVersion 20, contract.json "protocol"): the type language, the manifest blocks `provides` /
// `consumes`, and a caller that answers a consumer's kino.plugins.call from a provider plugin loaded from a folder, with the
// rules of the app's ProtocolSchema / ProtocolManifest / PluginProtocolBroker. Kino is authoritative; this is the kit's copy
// of its rules so a consumer can be tried offline (node sdk/run.mjs --provider <folder> <consumer> screenEvent ...).
import { contract } from "./contract.mjs";

const P = contract.protocol;
const NAME = new RegExp(P.provides.namePattern);
const TYPE_NAME = new RegExp(P.provides.typeNamePattern);
const PRIMITIVES = new Set(P.provides.primitives);
const utf8 = (text) => Buffer.byteLength(text, "utf8");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNull = (v) => v === null || v === undefined;
const fail = (msg) => { throw new Error(msg); };

/** An Error carrying a protocol error code, as `kino.plugins.call` rejects. */
export function protocolError(code, message) {
  return Object.assign(new Error(message), { code });
}

// ---------- the type language (ProtocolSchema) ----------

/** A type string (`string`, `T?`, `T[]`, `Name`) or an object of field to type, as a tree. Throws Error on an unknown type. */
export function parseType(raw, typeNames) {
  if (typeof raw === "string") return parseTypeString(raw.trim(), typeNames);
  if (isObject(raw)) return { kind: "object", fields: Object.fromEntries(Object.keys(raw).map((k) => [k, parseType(raw[k], typeNames)])) };
  return fail("A type must be a string or an object");
}

function parseTypeString(s, typeNames) {
  if (s === "") return fail("Empty type");
  if (s.endsWith("?")) return { kind: "optional", inner: parseTypeString(s.slice(0, -1).trim(), typeNames) };
  if (s.endsWith("[]")) return { kind: "array", element: parseTypeString(s.slice(0, -2).trim(), typeNames) };
  if (PRIMITIVES.has(s)) return { kind: "primitive", name: s };
  if (typeNames.has(s)) return { kind: "named", name: s };
  return fail(`Unknown type "${s}"`);
}

class SchemaFailure extends Error {}

function check(ref, types, v, strict, path) {
  const bad = (msg) => { throw new SchemaFailure(`${path}: ${msg}`); };
  switch (ref.kind) {
    case "optional": return isNull(v) ? null : check(ref.inner, types, v, strict, path);
    case "primitive":
      if (isNull(v)) return bad(`missing ${ref.name}`);
      if (typeof v !== ref.name || (ref.name === "number" && !Number.isFinite(v))) return bad(`expected ${ref.name}`);
      return v;
    case "array":
      if (!Array.isArray(v)) return bad("expected array");
      return v.map((x, i) => check(ref.element, types, x, strict, `${path}[${i}]`));
    case "named": {
      const def = types[ref.name];
      if (!def) return bad(`unknown type "${ref.name}"`);
      return checkFields(def, types, v, strict, path);
    }
    default: return checkFields(ref.fields, types, v, strict, path);
  }
}

const ROOT = "$";

function checkFields(fields, types, v, strict, path) {
  // A call with no argument (undefined or null) to an input whose fields are all optional is the empty object. Only the
  // argument itself: a null nested in it (an element of an Opts[]) is not an object.
  const obj = strict && path === ROOT && isNull(v) && Object.values(fields).every((t) => t.kind === "optional") ? {} : v;
  if (!isObject(obj)) throw new SchemaFailure(`${path}: expected object`);
  if (strict) {
    const extra = Object.keys(obj).find((k) => !(k in fields));
    if (extra !== undefined) throw new SchemaFailure(`${path}: unexpected field "${extra}"`);
  }
  const out = {};
  for (const [name, type] of Object.entries(fields)) {
    if (isNull(obj[name])) {
      if (type.kind !== "optional") throw new SchemaFailure(`${path}.${name}: missing`);
      continue;
    }
    out[name] = check(type, types, obj[name], strict, `${path}.${name}`);
  }
  return out;
}

function run(ref, types, value, strict, code) {
  try {
    if (utf8(JSON.stringify(value === undefined ? null : value) ?? "null") > P.call.maxPayloadBytes) throw new SchemaFailure(`Payload exceeds ${P.call.maxPayloadBytes} bytes`);
    return { ok: true, value: check(ref, types, value, strict, ROOT) };
  } catch (e) {
    if (e instanceof SchemaFailure) return { ok: false, code, message: e.message };
    throw e;
  }
}

/** A request, strictly: an extra or missing field is `bad_input`. `{ ok: true, value }` (declared fields only) or `{ ok: false, code, message }`. */
export const validateInput = (ref, types, value) => run(ref, types, value, true, "bad_input");
/** A response, loosely: extra fields are dropped, a wrong or missing type is `bad_output`. */
export const validateOutput = (ref, types, value) => run(ref, types, value, false, "bad_output");

// ---------- the manifest blocks (ProtocolManifest) ----------

const sortedKeys = (o) => Object.keys(o).sort();
const objectOf = (raw, what) => (isObject(raw) ? raw : fail(`${what} must be an object`));
const optionalObject = (o, key, what) => (isNull(o[key]) ? {} : objectOf(o[key], what));
const nameOf = (key, what) => (NAME.test(key) ? key : fail(`${what} "${key.slice(0, 40)}" must be letters and digits, starting with a letter (at most 32)`));

/** `provides` as the app reads it: doors with their calls, streams and types. Throws Error with the app's message. */
export function parseProvides(raw) {
  const doors = objectOf(raw, "provides");
  if (Object.keys(doors).length > P.provides.maxDoors) fail(`provides: at most ${P.provides.maxDoors} doors`);
  return sortedKeys(doors).map((name) => parseDoor(nameOf(name, "door"), objectOf(doors[name], `door "${name}"`)));
}

function parseDoor(door, o) {
  const where = `door "${door}"`;
  const summary = (typeof o.summary === "string" ? o.summary.trim() : "");
  if ([...summary].length > P.provides.summaryMaxChars) fail(`${where}: summary is over ${P.provides.summaryMaxChars} characters`);
  const typeObjs = optionalObject(o, "types", `${where}: types`);
  const typeNames = new Set(Object.keys(typeObjs));
  for (const t of typeNames) if (!TYPE_NAME.test(t)) fail(`${where}: type name "${t.slice(0, 40)}" must start with a capital letter and use letters and digits`);
  const typeRef = (raw, at) => { try { return parseType(raw, typeNames); } catch (e) { return fail(`${at}: ${e.message}`); } };
  const types = Object.fromEntries(sortedKeys(typeObjs).map((t) => {
    const fields = objectOf(typeObjs[t], `${where}: type "${t}"`);
    return [t, Object.fromEntries(sortedKeys(fields).map((f) => [f, typeRef(fields[f], `${where}: type "${t}".${f}`)]))];
  }));
  const callObjs = optionalObject(o, "calls", `${where}: calls`);
  if (Object.keys(callObjs).length > P.provides.maxCallsPerDoor) fail(`${where}: at most ${P.provides.maxCallsPerDoor} calls`);
  const calls = Object.fromEntries(sortedKeys(callObjs).map((c) => {
    const co = objectOf(callObjs[c], `${where}: call "${c}"`);
    if (isNull(co.out)) fail(`${where}: call "${c}" needs an "out"`);
    return [nameOf(c, "call"), { input: typeRef(isNull(co.in) ? {} : co.in, `${where}: call "${c}".in`), output: typeRef(co.out, `${where}: call "${c}".out`) }];
  }));
  const streamObjs = optionalObject(o, "streams", `${where}: streams`);
  if (Object.keys(streamObjs).length > P.provides.maxStreamsPerDoor) fail(`${where}: at most ${P.provides.maxStreamsPerDoor} streams`);
  const E = P.provides.streamEverySeconds;
  const streams = Object.fromEntries(sortedKeys(streamObjs).map((s) => {
    const so = objectOf(streamObjs[s], `${where}: stream "${s}"`);
    let every = E.default;
    if (!isNull(so.everySeconds)) {
      if (typeof so.everySeconds !== "number" || !Number.isFinite(so.everySeconds)) fail(`${where}: stream "${s}".everySeconds must be a number`);
      every = Math.trunc(so.everySeconds);
    }
    if (isNull(so.out)) fail(`${where}: stream "${s}" needs an "out"`);
    return [nameOf(s, "stream"), { output: typeRef(so.out, `${where}: stream "${s}".out`), everySeconds: Math.min(E.max, Math.max(E.min, every)) }];
  }));
  if (Object.keys(calls).some((c) => c in streams)) fail(`${where}: a call and a stream share a name`);
  return { name: door, summary, calls, streams, types };
}

/** `owner/name` as the app's PluginAddress.bareRepoOf reads it (a plain repo; a URL, a sub-path or a ref is not one), else null. */
function bareRepo(text) {
  const m = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(String(text).trim());
  return m && !m[2].startsWith(".") ? `${m[1]}/${m[2]}` : null;
}

/** `consumes` as the app reads it: one use per alias. Throws Error with the app's message. */
export function parseConsumes(raw) {
  const uses = objectOf(raw, "consumes");
  if (Object.keys(uses).length > P.consumes.maxEntries) fail(`consumes: at most ${P.consumes.maxEntries} entries`);
  const names = (list, alias, field, max) => {
    if (isNull(list)) return [];
    if (!Array.isArray(list)) return fail(`consumes "${alias}": ${field} must be a list of names`);
    if (list.length > max) fail(`consumes "${alias}": at most ${max} ${field}`);
    return [...new Set(list.map((n) => nameOf(typeof n === "string" ? n : fail(`consumes "${alias}": ${field} must be a list of names`), field.slice(0, -1))))];
  };
  return sortedKeys(uses).map((alias) => {
    nameOf(alias, "alias");
    const u = objectOf(uses[alias], `consumes "${alias}"`);
    const repo = typeof u.repo === "string" ? bareRepo(u.repo) : null;
    if (repo === null) fail(`consumes "${alias}": "repo" must be a plain GitHub owner/name`);
    if (typeof u.door !== "string") fail(`consumes "${alias}": needs a "door"`);
    return { alias, repo, door: nameOf(u.door, "door"), calls: names(u.calls, alias, "calls", P.consumes.maxCallsPerEntry), streams: names(u.streams, alias, "streams", P.consumes.maxStreamsPerEntry) };
  });
}

/**
 * The `provides` / `consumes` a raw manifest declares for this Kino: the top-level blocks (apiVersion 20 or later, else the
 * app refuses the manifest) and the ones of `enhancements["20"]`, which win. `{ provides: [], consumes: [], problems }`.
 */
export function protocolBlocks(rawManifest) {
  const out = { provides: [], consumes: [], problems: [] };
  const api = Number.isInteger(rawManifest?.apiVersion) ? rawManifest.apiVersion : 0;
  const sources = [];
  if (api >= P.apiVersion) sources.push(["", rawManifest]);
  else for (const f of ["provides", "consumes"]) if (rawManifest && f in rawManifest) out.problems.push(`The "${f}" block needs apiVersion ${P.apiVersion}`);
  const enh = rawManifest?.enhancements?.[String(P.apiVersion)];
  if (api < P.apiVersion && isObject(enh)) sources.push([`enhancements.${P.apiVersion}: `, enh]);
  for (const [prefix, src] of sources) {
    for (const [field, parse] of [["provides", parseProvides], ["consumes", parseConsumes]]) {
      if (src[field] === undefined) continue;
      try { out[field] = parse(src[field]); } catch (e) { out.problems.push(`${prefix}${field}: ${e.message}`); }
    }
  }
  return out;
}

/**
 * What validate warns about the protocol blocks of a raw manifest that the app accepts but changes or ignores, one line each:
 * a stream's `everySeconds` outside Kino's range (the app clamps it), a consumed repo missing from `recommends` (its screen
 * is never told whether the provider is installed, so an install gate never opens) and a literal `providesOnly` field (not a
 * manifest field: the app derives it).
 */
export function protocolWarnings(rawManifest) {
  const out = [];
  if (!isObject(rawManifest)) return out;
  const api = Number.isInteger(rawManifest.apiVersion) ? rawManifest.apiVersion : 0;
  if ("providesOnly" in rawManifest) {
    out.push(`kino-plugin.json: "providesOnly" is not a manifest field and Kino ignores it: a plugin is provides-only when it has apiVersion ${P.apiVersion} or later, a non-empty "provides", no capabilities and no settings (then "hosts" may be []). Remove the field`);
  }
  const src = api >= P.apiVersion ? rawManifest : rawManifest.enhancements?.[String(P.apiVersion)];
  if (!isObject(src)) return out;
  const E = P.provides.streamEverySeconds;
  for (const [door, d] of Object.entries(isObject(src.provides) ? src.provides : {})) {
    for (const [s, so] of Object.entries(isObject(d?.streams) ? d.streams : {})) {
      const every = so?.everySeconds;
      if (typeof every !== "number" || !Number.isFinite(every)) continue;
      const kept = Math.min(E.max, Math.max(E.min, Math.trunc(every)));
      if (kept !== every) out.push(`provides "${door}": stream "${s}" declares everySeconds ${every}; Kino polls it every ${kept} s (everySeconds is a whole number from ${E.min} to ${E.max})`);
    }
  }
  const recommended = new Set((Array.isArray(rawManifest.recommends) ? rawManifest.recommends : []).map((r) => (typeof r === "string" ? bareRepo(r) : null)).filter(Boolean).map((r) => r.toLowerCase()));
  for (const [alias, u] of Object.entries(isObject(src.consumes) ? src.consumes : {})) {
    const repo = typeof u?.repo === "string" ? bareRepo(u.repo) : null;
    if (repo && !recommended.has(repo.toLowerCase())) {
      out.push(`consumes "${alias}": its provider ${repo} is not in "recommends": Kino tells your screen whether a plugin is installed (installed["${repo}"]) only for the repos in "recommends", so an install gate on it never opens. Add "recommends": ["${repo}"]`);
    }
  }
  return out;
}

// ---------- the caller (PluginProtocolBroker) ----------

const exportOf = (door, name) => `proto_${door}_${name}`;

/**
 * Answers a consumer's `kino.plugins.call(alias, call, arg)` from provider plugins loaded from folders. [consumer] is the
 * consumer's `consumes` (parseConsumes); each provider is `{ id (its manifest's), doors (parseProvides), plugin (its exports) }`. The kit has no
 * repositories to match, so a use is served by the first provider that has the use's door; the app matches the use's `repo`
 * and never a fork. Same order of checks and same codes as the app: not_declared, provider_missing, provider_failed (the export
 * is missing), rate_limited, bad_input, then the provider runs (at most the contract's timeout; a throw is provider_failed)
 * and its answer is checked: bad_output.
 */
export function createProtocolCaller({ consumes, providers, now = Date.now, timeoutMs = P.call.timeoutMs, log = () => {} }) {
  const windows = new Map();
  const admit = (bucket, max) => {
    const t = now();
    const q = (windows.get(bucket) ?? []).filter((x) => t - x < P.call.windowMs);
    windows.set(bucket, q);
    if (q.length >= max) return false;
    q.push(t);
    return true;
  };
  // The limiter's bucket is the provider's door, as the app keys it ("<provider id>/<door>"), whatever alias reaches it: two
  // providers with a door of the same name never share one. A provider given without an id is told apart by its place.
  const bucketOf = (provider, door) => `${provider.id ?? `#${providers.indexOf(provider)}`}/${door.name}`;
  const resolveUse = (alias, listed) => {
    const use = consumes.find((u) => u.alias === alias);
    if (!use || !listed(use)) throw protocolError("not_declared", `"${alias}" is not in this plugin's consumes, or does not list it`);
    const provider = providers.find((p) => p.doors.some((d) => d.name === use.door));
    if (!provider) throw protocolError("provider_missing", `no provider has the door "${use.door}": install the plugin of ${use.repo}`);
    return { use, provider, door: provider.doors.find((d) => d.name === use.door) };
  };
  const invoke = async (provider, name, argument) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(protocolError("timeout", `the provider did not answer within ${timeoutMs / 1000} s`)), timeoutMs); });
    let answer;
    try {
      answer = await Promise.race([Promise.resolve().then(() => provider.plugin[name](JSON.parse(JSON.stringify(argument === undefined ? null : argument)))), late]);
    } catch (e) {
      if (e?.code === "timeout") throw e;
      log(`provider ${name} threw: ${e?.message ?? e}`);
      throw protocolError("provider_failed", `the provider's ${name} failed`);
    } finally {
      clearTimeout(timer);
    }
    const text = JSON.stringify(answer === undefined ? null : answer);
    if (text === undefined || utf8(text) > P.call.maxPayloadBytes) throw protocolError("bad_output", `the provider's ${name} answered something that is not JSON, or over ${P.call.maxPayloadBytes} bytes`);
    return JSON.parse(text);
  };
  return {
    async call(alias, call, arg) {
      const { use, provider, door } = resolveUse(alias, (u) => u.calls.includes(call));
      const decl = door.calls[call];
      if (!decl) throw protocolError("not_declared", `the door "${use.door}" has no call "${call}"`);
      const name = exportOf(door.name, call);
      if (typeof provider.plugin[name] !== "function") throw protocolError("provider_failed", `the provider does not export ${name}`);
      if (!admit(bucketOf(provider, door), P.call.maxCalls)) throw protocolError("rate_limited", `at most ${P.call.maxCalls} calls in ${P.call.windowMs / 1000} s per door`);
      const input = validateInput(decl.input, door.types, arg);
      if (!input.ok) throw protocolError("bad_input", input.message);
      const output = validateOutput(decl.output, door.types, await invoke(provider, name, input.value));
      if (!output.ok) throw protocolError("bad_output", output.message);
      return output.value;
    },
    /** One poll of a stream: `{ items, cursor }`, each item checked against the stream's `out` (bad_output otherwise). */
    async poll(alias, stream, cursor = null) {
      const { use, provider, door } = resolveUse(alias, (u) => u.streams.includes(stream));
      const decl = door.streams[stream];
      if (!decl) throw protocolError("not_declared", `the door "${use.door}" has no stream "${stream}"`);
      const name = exportOf(door.name, stream);
      if (typeof provider.plugin[name] !== "function") throw protocolError("provider_failed", `the provider does not export ${name}`);
      if (!admit(`poll ${bucketOf(provider, door)}`, P.streams.maxPollsPerWindow)) throw protocolError("rate_limited", "too many polls");
      const answer = await invoke(provider, name, cursor);
      if (!isObject(answer) || !Array.isArray(answer.items)) throw protocolError("bad_output", `${name} must answer { items: [...], cursor }`);
      const items = answer.items.map((item) => {
        const r = validateOutput(decl.output, door.types, item);
        if (!r.ok) throw protocolError("bad_output", r.message);
        return r.value;
      });
      return { items, cursor: answer.cursor ?? null, everySeconds: decl.everySeconds };
    },
  };
}
