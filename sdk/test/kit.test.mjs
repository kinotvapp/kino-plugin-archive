// node --test plugins/sdk/test/kit.test.mjs   (Node 18+)
// The kit against the same rules and vectors the app's JVM tests use.
import { loadPlugin, missingGlobalLines, scanMissingGlobals } from "../sandbox.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPublicKey, createDecipheriv, diffieHellman, generateKeyPairSync, hkdfSync } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkOutput, checkSettingsOutput, mediaOf, contract, englishCoverage, imageVerdict, localizedSettings, sectionLabel, markSearchHits, metaAnswer, optInt, requiredExports, segmentSkip, segmentsAnswer, validateManifest } from "../contract.mjs";
import { createKino, errorReport, shownSentence, signingLane } from "../kino-shim.mjs";
import { filterRelevant, shortQuery, sortBySimilarity } from "../kino-rank.mjs";
import { contrast, deltaE, formatRatio, luminance, resolvePalette } from "../palette.mjs";
import { consentLines, KEY_PAIRS_OLD_API, metaForFirstTitle, validate } from "../validate.mjs";
import { TABLES } from "../guide-tables.mjs";
import { scaffold } from "../init.mjs";
import { adultLines, call, callMeta, metaArg, metaPageLines, metaQueryForItem, metaVerdictLines, NO_META_CAPABILITY, parseArgs, segmentsArg, subtitlesArg } from "../run.mjs";
import { decodeCipherKey, normalizeBinding, seal, sealTyped } from "../seal.mjs";
import { ADULT_GROUPS, OPEN_END_MS, decodeM3u, keepStart, loadPlaylist, normaliseName, parseM3u, parseXmltv, parseXmltvTime, summarisePlaylist, summaryLines } from "../live-playlist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const archive = join(here, "..", "..", "archive-org");

const manifest = (extra = {}) => JSON.stringify({
  id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "plugin.js",
  hosts: ["example.com"], capabilities: ["search", "resolve"], ...extra,
});

// These tests read files of the Kino repo itself (docs/plugins/, plugins/archive-org, its .gitignore). A template does
// not carry them, so they are skipped here and run in the Kino repo.
const NEEDS_KINO_REPO = "needs files of the Kino repo that this template does not have";

test("contract.json is the one the app pins", () => {
  assert.equal(contract.apiVersion, 11);
  // apiVersion 5 stays what Kino 0.9.45 made it: the author-signed entry, nothing else.
  assert.equal(contract.manifest.signature.apiVersion, 5);
  assert.deepEqual(contract.capabilities.names, ["search", "home", "browse", "episodes", "resolve", "download", "drm", "channels", "migrate", "scopedSearch", "meta", "subtitles", "tracking", "segments", "playlists", "externalResolve"]);
  assert.deepEqual(contract.capabilities.declarative, ["download", "drm", "scopedSearch", "externalResolve"]);
  assert.deepEqual(contract.permissions, []);
});

test("manifest rules and Spanish messages match the app", () => {
  assert.equal(validateManifest(manifest()).ok, true);
  const cases = [
    [{ permissions: ["local-network"] }, "permissions", "unknown permission: local-network"],
    [{ settings: [{ key: "Server", label: "x", type: "text" }] }, "settings", "Setting #1 has an invalid key"],
    [{ settings: [{ key: "k", label: "x", type: "toggle", required: true }] }, "settings", 'The setting "k" can\'t be required'],
    [{ settings: [{ key: "k", label: "x", type: "select" }] }, "settings", 'The setting "k" needs options'],
    [{ settings: [{ key: "k", label: "x", type: "url", default: "http://127.0.0.1/" }] }, "settings", 'The setting "k" of type url can\'t have a default value: use "hint"'],
    [{ settings: [{ key: "k", label: "x", type: "url", default: "http://192.168.1.1" }] }, "settings", 'The setting "k" of type url can\'t have a default value: use "hint"'],
    [{ settings: [{ key: "k", label: "x", type: "url", default: "" }] }, "settings", 'The setting "k" of type url can\'t have a default value: use "hint"'],
    [{ capabilities: ["search"] }, "capabilities", 'The plugin must declare "resolve"'],
    [{ capabilities: ["search", "resolve", "download"] }, "capabilities", 'The "download" capability needs apiVersion 2'],
    [{ capabilities: ["search", "resolve", "drm"] }, "capabilities", 'The "drm" capability needs apiVersion 2'],
    [{ hosts: ["192.168.1.1"] }, "hosts", 'The domain "192.168.1.1" is not allowed'],
    [{ hosts: [{ host: "x.example.com", insecureHttp: true }] }, "hosts", 'A host with "insecureHttp" needs apiVersion 2'],
    [{ apiVersion: 2, hosts: [{ host: "*.example.com", insecureHttp: true }] }, "hosts", 'A host with "insecureHttp" can\'t have a wildcard ("*.")'],
    [{ apiVersion: 2, hosts: [{ host: "nas.local", insecureHttp: true }] }, "hosts", 'The domain "nas.local" is not allowed'],
    [{ id: "live" }, "id", 'The id "live" is reserved by Kino'],
    // The app's version regex bounds each segment to 6 digits (Regex("^(0|[1-9]\\d{0,5})...")); a
    // hand-typed unbounded copy would wrongly accept this.
    [{ version: "1234567.0.0" }, "version", 'The "version" field must look like 1.2.3'],
  ];
  for (const [extra, field, message] of cases) {
    assert.deepEqual(validateManifest(manifest(extra)), { ok: false, field, message }, JSON.stringify(extra));
  }
  assert.equal(validateManifest(manifest({ permissions: ["x"] }), { knownPermissions: ["x"] }).ok, true);
});

test("apiVersion 2: download/drm and an insecureHttp host validate and are exposed on the manifest", () => {
  const r = validateManifest(manifest({
    apiVersion: 2,
    hosts: ["archive.org", { host: "x.example.com", insecureHttp: true }],
    capabilities: ["search", "resolve", "download", "drm"],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.hosts, ["archive.org", "x.example.com"]);
  assert.deepEqual(r.manifest.insecureHosts, ["x.example.com"]);
  assert.deepEqual(r.manifest.capabilities, ["search", "resolve", "download", "drm"]);
});

test("apiVersion 2: empty hosts validate only with a url setting, as the app rules", () => {
  const server = { key: "server", label: "Servidor", type: "url", required: true };
  const ok = validateManifest(manifest({ apiVersion: 2, hosts: [], settings: [server] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.hosts, []);
  assert.equal(contract.manifest.noHostsApiVersion, 2);
  assert.deepEqual(validateManifest(manifest({ hosts: [], settings: [server] })),
    { ok: false, field: "hosts", message: 'The "hosts" field must have at least 1 domain' });
  const noUrl = { ok: false, field: "hosts", message: 'The "hosts" field can only be empty if the plugin has a setting of type "url"' };
  assert.deepEqual(validateManifest(manifest({ apiVersion: 2, hosts: [] })), noUrl);
  assert.deepEqual(validateManifest(manifest({ apiVersion: 2, hosts: [], settings: [{ key: "user", label: "Usuario", type: "text" }] })), noUrl);
});

test("hosts: no upper limit (21, 100, 500 accepted); only the 16 KB manifest cap bounds it", () => {
  assert.equal(contract.manifest.maxHosts, undefined);
  for (const n of [21, 100, 500]) {
    const hosts = Array.from({ length: n }, (_, i) => `h${i + 1}.example.com`);
    const r = validateManifest(manifest({ hosts }));
    assert.equal(r.ok, true, `${n} hosts`);
    assert.deepEqual(r.manifest.hosts, hosts);
  }
  const tooBig = Array.from({ length: 1000 }, (_, i) => `host-number-${i + 1}.example.com`);
  assert.deepEqual(validateManifest(manifest({ hosts: tooBig })), { ok: false, field: "kino-plugin.json", message: "The manifest is over 16 KB" });
});

test("validate() warns, without refusing, that more than 20 hosts needs Kino 0.9.45", async () => {
  const warning = "Más de 20 hosts: Kino 0.9.44 o anterior rechaza este plugin; necesita Kino 0.9.45 o superior";
  assert.deepEqual(contract.manifest.legacyMaxHosts, { value: 20, refusedUpToApp: "0.9.44", noLimitFromApp: "0.9.45" });
  const dir = mkdtempSync(join(tmpdir(), "kino-many-hosts-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    const hosts = (n) => Array.from({ length: n }, (_, i) => `h${i + 1}.example.com`);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ hosts: hosts(20) }));
    assert.deepEqual((await validate(dir)).notes, []);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ hosts: hosts(21) }));
    const r = await validate(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.notes, [warning]);
    const cli = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(cli.status, 0);
    assert.ok(cli.stderr.includes(warning), cli.stderr);
    // Older apps counted the raw entries, duplicates included: so does the warning.
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ hosts: [...hosts(20), "h1.example.com"] }));
    assert.deepEqual((await validate(dir)).notes, [warning]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate() does not require download/drm to be exported functions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-declarative-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 2, capabilities: ["search", "resolve", "download", "drm"] }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a' } }");
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate() reports the palette guardrails as notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-theme-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, theme: { accent: "#D81F26", highlight: "#F7C948" } }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a' } }");
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.ok(r.notes.includes("theme.accent: is too close to Kino's red; Kino's colors are used for accent and onAccent"), JSON.stringify(r.notes));
    assert.equal(r.notes.filter((n) => n.startsWith("theme.")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the archive-org plugin passes the kit's checks", { skip: NEEDS_KINO_REPO }, async () => {
  const r = await validate(archive);
  assert.deepEqual(r.problems, []);
});

function runValidateCli(args) {
  // stdio fully piped (never inherited): the child's own stderr must not leak into this test run's
  // own output, and both cases still capture it on e.stdout/e.stderr for the assertions below.
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    const stdout = execFileSync(process.execPath, [join(here, "..", "validate.mjs"), ...args], opts);
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// A JS stack trace (an uncaught throw) looks nothing like the app's own Spanish refusal text; any
// of these lines means the CLI crashed instead of reporting cleanly.
const looksLikeAStackTrace = (s) => /TypeError|ReferenceError|at file:|at Object\.|at async /.test(s);

test("validate.mjs's CLI reports the app's refusal instead of crashing on the most common failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-badplugin-"));
  try {
    const noManifest = runValidateCli([dir]);
    assert.equal(noManifest.code, 1);
    assert.ok(!looksLikeAStackTrace(noManifest.stderr), `unexpected stack trace:\n${noManifest.stderr}`);
    assert.match(noManifest.stderr, /no kino-plugin\.json/);

    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify({ id: "X" }));
    const badManifest = runValidateCli([dir]);
    assert.equal(badManifest.code, 1);
    assert.ok(!looksLikeAStackTrace(badManifest.stderr), `unexpected stack trace:\n${badManifest.stderr}`);
    assert.match(badManifest.stderr, /field/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate() reports a problem instead of throwing when --replay points at a missing file", { skip: NEEDS_KINO_REPO }, async () => {
  const r = await validate(archive, { run: "search", args: ["algo"], replay: join(here, "does-not-exist.json") });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("not found")));
  assert.deepEqual(r.drops, []);
});

test("crypto gives the app's vectors", () => {
  const { kino } = createKino(JSON.parse(manifest()));
  const c = kino.crypto;
  assert.equal(c.hash("md5", "abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(c.hmac("sha256", "Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  const key = "2b7e151628aed2a6abf7158809cf4f3c", iv = "000102030405060708090a0b0c0d0e0f";
  const enc = c.encrypt("aes-128-cbc", { key, iv, keyEncoding: "hex", ivEncoding: "hex", data: "hola mundo", outputEncoding: "hex" });
  assert.equal(enc, "91d3f1bb5aa666718bdcd8514571632a");
  assert.equal(c.decrypt("aes-128-cbc", { key, iv, keyEncoding: "hex", ivEncoding: "hex", data: enc, inputEncoding: "hex" }), "hola mundo");
  const gcm = c.encrypt("aes-128-gcm", { key: "00".repeat(16), keyEncoding: "hex", iv: "00".repeat(12), ivEncoding: "hex", data: "00".repeat(16), inputEncoding: "hex", outputEncoding: "hex" });
  assert.equal(gcm, "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf");
  assert.equal(c.pbkdf2("sha1", "password", "salt", 2, 20), "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957");
  assert.equal(c.encrypt("des-ede3-ecb", { key: "0123456789abcdef23456789abcdef01456789abcdef0123", keyEncoding: "hex", data: "5468652071756663", inputEncoding: "hex", padding: "none", outputEncoding: "hex" }), "a826fd8ce53b855f");
  assert.throws(() => c.hash("sha3", "x"), (e) => e.code === "crypto_error" && e.name === "KinoError_crypto_error");
  assert.throws(() => c.pbkdf2("sha1", "p", "s", 100001, 20), (e) => e.code === "crypto_error");
  assert.throws(() => c.randomBytes(1025), (e) => e.code === "crypto_error");
});

// --- kino.crypto key pairs (apiVersion 6): the same vectors the app's PluginKeysTest checks ---
// Absent in a published plugin repo (sdk/ and contract.json at its root): the vectors test skips there.
const asymVectorsFile = join(here, "..", "..", "..", "docs", "plugins", "fixtures", "crypto", "asymmetric-vectors.json");
const asymVectors = existsSync(asymVectorsFile) ? JSON.parse(readFileSync(asymVectorsFile, "utf8")).vectors : null;
const kinoV6 = () => createKino(JSON.parse(manifest({ apiVersion: 6 }))).kino;
const cryptoError = (message) => (e) => e.code === "crypto_error" && (message === undefined || e.message.includes(message));

test("key pairs: the shared vectors import and verify like the app", (t) => {
  if (!asymVectors) return t.skip("no shared crypto vectors around this kit");
  const c = kinoV6().crypto;
  for (const v of asymVectors) {
    const fromJwk = c.importKey({ format: "jwk", key: v.jwk });
    assert.equal(fromJwk.spki, v.spki);
    assert.equal(fromJwk.raw, v.raw);
    assert.deepEqual(Object.keys(fromJwk.jwk), v.type === "ec" ? ["crv", "kty", "x", "y"] : ["crv", "kty", "x"]);
    assert.deepEqual({ ...c.importKey({ format: "spki", key: v.spki }).jwk }, v.jwk);
    assert.equal(c.importKey({ format: "raw", type: v.type, namedCurve: v.namedCurve, key: v.raw }).spki, v.spki);
    if (v.type === "ec") {
      for (const format of ["der", "ieee-p1363"]) {
        const signature = format === "der" ? v.der : v.p1363;
        assert.equal(c.verify({ key: fromJwk, data: v.data, signature, hash: v.hash, format }), true);
        assert.equal(c.verify({ key: { jwk: v.jwk }, data: v.data, signature, hash: v.hash, format }), true);
        assert.equal(c.verify({ key: fromJwk, data: v.data + "!", signature, hash: v.hash, format }), false);
      }
    }
    if (v.type === "ed25519") assert.equal(c.verify({ key: fromJwk, data: v.data, encoding: "hex", signature: v.signature }), true);
  }
});

test("key pairs: round trips, P1363 vs DER lengths, ECDH and X25519 agree", () => {
  const c = kinoV6().crypto;
  for (const [curve, n, hash] of [["P-256", 32, "SHA-256"], ["P-384", 48, "SHA-384"]]) {
    const { privateKey, publicKey } = c.generateKeyPair({ type: "ec", namedCurve: curve });
    assert.deepEqual(Object.keys(privateKey), ["type", "namedCurve", "handle"]);
    assert.ok(Object.isFrozen(privateKey) && Object.isFrozen(publicKey) && Object.isFrozen(publicKey.jwk));
    assert.equal(Buffer.from(publicKey.raw, "base64").length, 1 + 2 * n);
    const p1363 = c.sign({ key: privateKey, data: "reto", hash, format: "ieee-p1363" });
    assert.equal(Buffer.from(p1363, "base64").length, 2 * n);
    const der = Buffer.from(c.sign({ key: privateKey.handle, data: "reto", hash }), "base64");
    assert.equal(der[0], 0x30);
    assert.ok(der.length > 2 * n && der.length <= 2 * n + 8);
    assert.equal(c.verify({ key: publicKey, data: "reto", signature: p1363, hash, format: "ieee-p1363" }), true);
    assert.equal(c.verify({ key: privateKey, data: "reto", signature: der.toString("hex"), signatureEncoding: "hex", hash }), true);
    const other = c.generateKeyPair({ type: "ec", namedCurve: curve });
    const ab = c.deriveSharedSecret({ privateKey, publicKey: other.publicKey });
    assert.equal(ab, c.deriveSharedSecret({ privateKey: other.privateKey, publicKey }));
    assert.equal(Buffer.from(ab, "base64").length, n);
  }
  const ed = c.generateKeyPair({ type: "ed25519" });
  assert.deepEqual(Object.keys(ed.privateKey), ["type", "handle"]);
  const sig = c.sign({ key: ed.privateKey, data: "68656c6c6f", encoding: "hex", outputEncoding: "hex" });
  assert.equal(sig.length, 128);
  assert.equal(c.verify({ key: ed.publicKey, data: "hello", signature: sig, signatureEncoding: "hex" }), true);
  const a = c.generateKeyPair({ type: "x25519" }), b = c.generateKeyPair({ type: "x25519" });
  const s1 = c.deriveSharedSecret({ privateKey: a.privateKey, publicKey: c.importKey({ format: "raw", type: "x25519", key: b.publicKey.raw }) });
  assert.equal(s1, c.deriveSharedSecret({ privateKey: b.privateKey, publicKey: { jwk: a.publicKey.jwk } }));
  assert.equal(Buffer.from(s1, "base64").length, 32);
});

test("key pairs: handles stay in their own kino, no Node alias, the app's errors", () => {
  const first = kinoV6().crypto, second = kinoV6().crypto;
  const { privateKey } = first.generateKeyPair({ type: "ed25519" });
  assert.throws(() => second.sign({ key: privateKey, data: "x" }), cryptoError("unknown key"));
  assert.equal(first.generateKeyPairSync, undefined);
  assert.equal(first.createSign, undefined);
  const x = first.generateKeyPair({ type: "x25519" });
  const p256 = first.generateKeyPair({ type: "ec", namedCurve: "P-256" });
  assert.throws(() => first.generateKeyPair({ type: "rsa" }), cryptoError("unknown key type"));
  assert.throws(() => first.generateKeyPair(), cryptoError("unknown key type"));
  assert.throws(() => first.generateKeyPair({ type: "ec", namedCurve: "P-521" }), cryptoError("unknown curve"));
  assert.throws(() => first.sign({ key: x.privateKey, data: "a" }), cryptoError("x25519 key doesn't sign"));
  assert.throws(() => first.sign({ key: privateKey, data: "a", hash: "SHA-256" }), cryptoError("does not take a hash"));
  assert.throws(() => first.sign({ key: p256.privateKey, data: "a", hash: "SHA-1" }), cryptoError("signature hash"));
  assert.throws(() => first.sign({ key: p256.privateKey, data: "a", format: "raw" }), cryptoError("signature format"));
  assert.throws(() => first.sign({ key: {}, data: "x" }), cryptoError('missing "key"'));
  assert.throws(() => first.deriveSharedSecret({ privateKey: p256.privateKey, publicKey: x.publicKey }), cryptoError("same type"));
  assert.throws(() => first.importKey({ format: "pem", key: "AAAA" }), cryptoError("key format"));
  assert.throws(() => first.importKey({ format: "jwk", key: "x" }), cryptoError("a JWK object"));
  assert.throws(() => first.importKey({ format: "spki", key: "AAAA" }), cryptoError("unrecognized spki"));
  const offCurve = Buffer.from(p256.publicKey.raw, "base64");
  offCurve[64] ^= 1;
  assert.throws(() => first.importKey({ format: "raw", type: "ec", namedCurve: "P-256", key: offCurve.toString("base64") }), cryptoError("invalid public key"));
  for (const [signature, format] of [["AAAA", "ieee-p1363"], ["AAAA", "der"], ["", "der"]]) {
    assert.equal(first.verify({ key: p256.publicKey, data: "a", signature, format }), false);
  }
  assert.throws(() => first.verify({ data: "a", signature: "AAAA" }), cryptoError('missing "publicKey"'));
});

test("key pairs: the ring keeps the newest keys only", () => {
  const c = kinoV6().crypto;
  const oldest = c.generateKeyPair({ type: "ed25519" });
  for (let i = 0; i < contract.crypto.keyPairs.maxKeysPerRuntime; i++) c.generateKeyPair({ type: "ed25519" });
  assert.throws(() => c.sign({ key: oldest.privateKey, data: "x" }), cryptoError("unknown key"));
});

test("key pairs: a sealed marker is refused in every field, like the app", () => {
  const { kino } = sealedKino({ tok: "s3cr3t-value" });
  const m = kino.secret("tok");
  const c = kino.crypto;
  const ec = c.generateKeyPair({ type: "ec", namedCurve: "P-256" });
  const refused = (fn) => assert.throws(fn, (e) => e.code === "crypto_error" && e.message === "a sealed value can't be used here");
  refused(() => c.sign({ key: ec.privateKey, data: m }));
  refused(() => c.sign({ key: ec.privateKey, data: "a" + m }));
  refused(() => c.verify({ key: ec.publicKey, data: "x", signature: m }));
  refused(() => c.importKey({ format: "spki", key: m }));
  refused(() => c.sign({ key: m, data: "x" }));
  assert.equal(typeof c.sign({ key: ec.privateKey, data: "plain" }), "string");
});

test("validate() tells a plugin below apiVersion 6 that uses key pairs to declare it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-keypairs-"));
  try {
    const code = "export async function search(){ const k = kino.crypto.generateKeyPair({ type: 'ed25519' }); return [] }\nexport async function resolve(){ return { url: 'https://example.com/a' } }";
    writeFileSync(join(dir, "plugin.js"), code);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 4 }));
    assert.ok((await validate(dir)).notes.includes(KEY_PAIRS_OLD_API));
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6 }));
    assert.ok(!(await validate(dir)).notes.includes(KEY_PAIRS_OLD_API));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config, storage keys, typed errors and sleep", async () => {
  const m = JSON.parse(manifest({ settings: [
    { key: "server", label: "Servidor", type: "url", required: true },
    { key: "hd", label: "HD", type: "toggle" },
    { key: "q", label: "Calidad", type: "select", options: [{ value: "auto", label: "A" }] },
  ] }));
  const { kino } = createKino(m, { config: { server: "http://192.168.1.10:8096", hd: "true" } });
  assert.deepEqual(kino.config.all(), { server: "http://192.168.1.10:8096", hd: true, q: "auto" });
  kino.storage.set("a", "1");
  assert.deepEqual(kino.storage.keys(), ["a"]);
  assert.throws(() => kino.storage.set("big", "x".repeat(300 * 1024)), /256 KB/);
  const e = kino.error("not_found", "x".repeat(500));
  assert.equal(e.code, "not_found");
  assert.equal(e.message.length, 200);
  assert.equal(kino.error("NOPE", "m").code, "unknown");
  await assert.rejects(kino.sleep(6000), (err) => err.code === "invalid_request");
});

test("kino.error's userMessage: carried as the app carries it, shown only when the app would show it", () => {
  const { kino } = createKino(JSON.parse(manifest()));
  const gone = "Este capítulo ya no está disponible.";
  const e = kino.error("not_found", "portal100006", { userMessage: gone });
  assert.equal(e.userMessage, gone);
  assert.equal(shownSentence(e), gone);
  assert.equal(kino.error("not_found", "x").userMessage, undefined);
  assert.equal(kino.error("not_found", "x", { userMessage: 7 }).userMessage, undefined);
  let ran = false;
  assert.equal(kino.error("not_found", "x", { get userMessage() { ran = true; return gone; } }).userMessage, undefined);
  assert.equal(ran, false);
  assert.equal(kino.error("not_found", "x", { userMessage: "z".repeat(5000) }).userMessage.length, contract.errors.maxUserMessageChars + 1);
  // The app's rule: one of the five codes, one short plain line, no URL or code.
  assert.equal(shownSentence(kino.error("network", "x", { userMessage: gone })), null);
  for (const bad of ["Hola", "Mira https://x.example/y ahora.", "Primera.\nSegunda línea.", "Usa {code} aquí mismo.", "TypeError: no se pudo leer", "y ".repeat(100)]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  // The app's tightened rule (review C1): domains, addresses, numbers, hidden text, homoglyphs, Kino's name, credentials and money.
  for (const bad of [
    "Descarga la nueva version en kino-app.net ahora.", "Visita www mipagina ahora mismo.", "Entra a mipagina .app ahora mismo.",
    "Entra a mipagina. app ahora mismo.", "Entra a mipagina punto com ahora mismo.", "Escribe a soporte@ejemplo ya mismo.",
    "Llama al 300 123 4567 para seguir viendo.", "Linea uno.\u2028Linea dos bonita.", "Hola\u3164mundo bonito.", "Hola\u00A0mundo bonito.",
    "Tu cuenta fue susp\u0435ndida hoy.", "Kino: tu cuenta fue suspendida.", "\u041Aino: tu cuenta fue suspendida.", "K i n o informa un cambio.",
    "Ingresa tu contraseña para seguir.", "Escribe tu PIN para seguir.", "Paga la suscripción para seguir.", "Envía por Nequi para seguir.",
    "Escribe el código de verificación que te llegó.",
  ]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: "Esta serie ya no está disponible. Vuelve luego." })), "Esta serie ya no está disponible. Vuelve luego.");
  // Fix round 2 (structural): Latin-1 letters only, 6 digits in all, Kino's skeleton, stems, spelled domains.
  for (const bad of [
    "Descarga desde mipagina\uA78Fapp ya mismo.", "Entra a mipagina punto dev ahora.", "Entra a mipaginapuntocom ahora.", "Entra a p u n t o com ahora.",
    "Llama al 300, 123, 4567 ya mismo.", "Marca 3001 y 234 y 567 ahora.", "\u1D0B\u026A\u0274\u1D0F informa un cambio.", "\u043A\u0456\u043F\u043E informa un cambio.",
    "K1NO informa un cambio.", "Kin0 informa un cambio.", "K¡no informa un cambio.", "Ki no informa un cambio.", "SoporteKino informa un cambio.",
    "No es necesario que pagues nada.", "Abona el saldo hoy mismo.", "Recarga tu saldo hoy mismo.", "Escribe tu contra seña aquí.", "Escribe tu passw0rd aquí.",
    "Revisa tus credenciales hoy.", "Pega aquí el token nuevo.", "Escribe el código que te llegó por SMS.", "Escríbenos por WhatsApp hoy mismo.",
  ]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: "Não há mais episódios, señor, ça va." })), "Não há mais episódios, señor, ça va.");
  // Fix round 3: letters NFD keeps whole, digits glued to letters, "; " is prose, stems word by word.
  for (const bad of ["KINØ informa un cambio.", "Escribe tu cøntraseña aquí.", "Envía por N3qui para seguir.", "Haz el p4go hoy.", "Faltan 5minutos para volver.",
    "Envía por N e q u i para seguir.", "Escribe tu contra seña aquí.", "Entra a p u n t o com ahora.", "Tu cuenta;vincúlala de nuevo.", "Recarga la lista para ver los capítulos."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  for (const ok of ["Tu cuenta se abrió en otro dispositivo; vincúlala de nuevo en Ajustes ▸ Plugins ▸ Demo.", "Este título no tiene quien lo suba.",
    "El servidor está a punto de volver.", "Vuelve a intentarlo en 5 minutos, por favor."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: ok })), ok, ok);
  }
  // Fix round 4: a stem split across neighbouring words.
  for (const bad of ["Envía por Ne qui para seguir.", "Envía por N e qui para seguir.", "Escribe tu con tra seña aquí.", "Escribe tu co n tra seña aquí.",
    "Agrega tu tar je ta hoy.", "Haz una trans fe rencia hoy.", "Escríbenos por What s app hoy.", "Escríbenos por Wh ats app hoy.", "Envía por Davi pla ta hoy.",
    "Haz un de pó sito hoy.", "Entra a mipagina pun to com ahora.", "Haz el pa go hoy mismo.", "Escribe tu cla ve aquí.", "Pega el to ken nuevo aquí."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  for (const ok of ["Este capítulo ya no está disponible.", "El servidor no respondió, intenta en unos minutos."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: ok })), ok, ok);
  }
  // Task 14: "verifica" alone and "punto es" are prose; a verification code is still refused.
  for (const ok of ["Verifica tu conexión e intenta de nuevo.", "En este punto es mejor esperar."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: ok })), ok, ok);
  }
  for (const bad of ["Escribe el código de verificación que te llegó.", "Escribe tu verification code aquí.", "Entra a mipagina punto com ahora."]) {
    assert.equal(shownSentence(kino.error("not_found", "x", { userMessage: bad })), null, bad);
  }
  for (const name of ["KINØ", "Cuevana3", "M3U"]) assert.match(errorReport(e, name), /userMessage is not shown/, name);
  assert.match(errorReport(e, "Cuevana 3"), /Mensaje de Cuevana 3: /);
  for (const name of ["Kino", "Soporte Kino", "Kino: Aviso", "\u041A1NO", "Xu:per", "Xu\u2028per", "Xu\u00A0per", ""]) {
    assert.match(errorReport(e, name), /userMessage is not shown/, name);
  }
  // run.mjs prints what the person would read: always attributed to the plugin.
  assert.match(errorReport(e), /\[not_found\] portal100006/);
  assert.match(errorReport(e, "Demo"), /the person reads: "Mensaje de Demo: Este capítulo ya no está disponible\."/);
  assert.match(errorReport(kino.error("not_found", "x", { userMessage: "Hola" })), /userMessage is not shown/);
  assert.equal(errorReport(kino.error("not_found", "x")), "[not_found] x");
});

test("kino.storage entries with a ttlMs expire, are purged, and old data keeps working", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-storage-"));
  const storageFile = join(dir, "storage.json");
  try {
    // Data written before ttlMs existed: a bare string per key, no wrapper at all.
    writeFileSync(storageFile, JSON.stringify({ legacy: "still here" }));
    const m = JSON.parse(manifest());
    const opened = () => createKino(m, { storageFile }).kino;

    let kino = opened();
    assert.equal(kino.storage.get("legacy"), "still here");
    kino.storage.set("temp", "v", { ttlMs: 1000 });
    assert.equal(kino.storage.get("temp"), "v");
    assert.deepEqual(kino.storage.keys().sort(), ["legacy", "temp"]);
    kino.storage.set("permanent", "p"); // no options: unaffected, exactly as before.

    // Move "temp" into the past on disk instead of waiting: a fresh instance now sees it expired.
    const onDisk = JSON.parse(readFileSync(storageFile, "utf8"));
    onDisk.temp = { v: "v", e: Date.now() - 1 };
    writeFileSync(storageFile, JSON.stringify(onDisk));

    kino = opened();
    assert.equal(kino.storage.get("temp"), null);
    assert.deepEqual(kino.storage.keys().sort(), ["legacy", "permanent"]);
    // The read purged it: the file no longer carries the expired entry.
    assert.equal(JSON.parse(readFileSync(storageFile, "utf8")).temp, undefined);

    for (const ttlMs of [0, -1, 1.5, NaN, Infinity, contract.storage.maxTtlMs + 1]) {
      assert.throws(() => kino.storage.set("bad", "v", { ttlMs }), (e) => e.code === "invalid_request" && /ttlMs/.test(e.message), `ttlMs ${ttlMs} must be refused`);
    }
    assert.equal(kino.storage.get("bad"), null);
    kino.storage.set("ok", "v", { ttlMs: contract.storage.maxTtlMs }); // the cap itself is accepted
    assert.equal(kino.storage.get("ok"), "v");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ported from the cookbook this promoted (branch feat/plugin-sdk-ranking-helper), against the
// shipped kino.rank.* functions rather than a copy-pasted recipe.
test("kino.rank.shortQuery cuts at the first separator, but never a plain hyphen", () => {
  assert.equal(shortQuery("Avatar: Aang, El ultimo Maestro Aire"), "Avatar");
  assert.equal(shortQuery("Movie – Subtitle"), "Movie");
  assert.equal(shortQuery("Movie — Subtitle"), "Movie");
  assert.equal(shortQuery("One, Two, Three"), "One");
  // A one- or two-letter head identifies nothing: the whole text is kept instead.
  assert.equal(shortQuery("A: The Beginning"), "A: The Beginning");
  // No separator present at all: the whole (trimmed) text is the head, so it is returned either way.
  assert.equal(shortQuery("  El Ultimo Refugio  "), "El Ultimo Refugio");
  // Not a plain "-": it must not cut inside a hyphenated word.
  assert.equal(shortQuery("Spider-Man: Far From Home"), "Spider-Man");
  assert.equal(shortQuery(""), "");
});

test("kino.rank.sortBySimilarity puts the item sharing the most words first, stable on ties", () => {
  const items = [
    { name: "Saga of Something Else" }, // shares only "saga": 1
    { name: "Totally Unrelated Movie" }, // shares nothing: 0
    { name: "Warrior Saga Legends" }, // shares "warrior", "saga": 2
    { name: "Dragon Warrior Saga: Special Edition" }, // shares all 3
  ];
  const getTitle = (x) => x.name;
  const sorted = sortBySimilarity(items, "Dragon Warrior Saga", getTitle).map(getTitle);
  assert.deepEqual(sorted, [
    "Dragon Warrior Saga: Special Edition",
    "Warrior Saga Legends",
    "Saga of Something Else",
    "Totally Unrelated Movie",
  ]);
  // Several forms of the query (a title known in more than one language): the best match of any wins.
  assert.deepEqual(sortBySimilarity(items, ["Ay", "Dragon Warrior Saga"], getTitle).map(getTitle), sorted);
  // No requested title carries any 3+ letter token: nothing to rank by, so the order is untouched.
  assert.deepEqual(sortBySimilarity(items, "Ay", getTitle).map(getTitle), items.map(getTitle));
  // getTitle defaults to `.title`.
  const titled = items.map((x) => ({ title: x.name }));
  assert.deepEqual(sortBySimilarity(titled, "Dragon Warrior Saga").map((x) => x.title), sorted);
});

test("kino.rank.filterRelevant drops hits that only share a stray word", () => {
  const items = [
    { name: "Saga of Something Else" }, // 1 of 3 tokens: 0.33, dropped
    { name: "Totally Unrelated Movie" }, // 0 of 3: dropped
    { name: "Warrior Saga Legends" }, // 2 of 3: 0.67, kept
    { name: "Dragon Warrior Saga: Special Edition" }, // 3 of 3: kept
  ];
  const getTitle = (x) => x.name;
  assert.deepEqual(
    filterRelevant(items, "Dragon Warrior Saga", getTitle).map(getTitle),
    ["Warrior Saga Legends", "Dragon Warrior Saga: Special Edition"],
  );
  // An absent title: 0 results, not a page of near-misses.
  assert.deepEqual(filterRelevant(items, "Completely Different Name", getTitle), []);
});

test("kino.rank: filterRelevant then sortBySimilarity leaves the real match first, the noise gone", () => {
  const items = [
    { name: "Saga of Something Else" },
    { name: "Totally Unrelated Movie" },
    { name: "Warrior Saga Legends" },
    { name: "Dragon Warrior Saga: Special Edition" },
  ];
  const getTitle = (x) => x.name;
  const result = sortBySimilarity(filterRelevant(items, "Dragon Warrior Saga", getTitle), "Dragon Warrior Saga", getTitle).map(getTitle);
  assert.deepEqual(result, ["Dragon Warrior Saga: Special Edition", "Warrior Saga Legends"]);
});

test("kino.rank: titleTokens folds accents and keeps a word whose only accent is ã or å", () => {
  // Regression coverage via the public functions: an earlier FOLD_ACCENTS with no ã/å entry fell
  // outside the word regex and dropped the whole word instead of just leaving an accent on it.
  const items = [{ title: "São Paulo em Chamas" }, { title: "Unrelated" }];
  assert.deepEqual(sortBySimilarity(items, "Sao Paulo").map((x) => x.title), ["São Paulo em Chamas", "Unrelated"]);
  assert.deepEqual(filterRelevant(items, "Sao Paulo").map((x) => x.title), ["São Paulo em Chamas"]);
});

// Robustness convention (see kino-rank.mjs's own header comment): a bad `items` argument never
// throws, and neither does a bad title on one entry -- only a coded error crossing a real boundary
// (kino.fetch, kino.crypto, kino.sleep) does that.
test("kino.rank: a non-array items answers [] instead of throwing", () => {
  for (const bad of [null, undefined, "not an array", 42, { title: "x" }]) {
    assert.deepEqual(sortBySimilarity(bad, "Dragon Warrior Saga"), []);
    assert.deepEqual(filterRelevant(bad, "Dragon Warrior Saga"), []);
  }
});

test("kino.rank: an item with no usable title is dropped by filterRelevant and sorts last in sortBySimilarity", () => {
  const real = { title: "Dragon Warrior Saga: Special Edition" };
  const noTitleAtAll = { note: "no title field" };
  const numericTitle = { title: 7 };
  const arrayOfJunk = { title: [1, 2, 3] };
  const items = [null, undefined, noTitleAtAll, numericTitle, arrayOfJunk, real];

  assert.deepEqual(filterRelevant(items, "Dragon Warrior Saga"), [real]);

  const sorted = sortBySimilarity(items, "Dragon Warrior Saga");
  // The one real match goes first; every title-less item follows, in its original relative order.
  assert.equal(sorted[0], real);
  assert.deepEqual(sorted.slice(1), [null, undefined, noTitleAtAll, numericTitle, arrayOfJunk]);
});

test("kino.rank: a getTitle that throws is treated as a missing title, not a crash", () => {
  const boom = () => { throw new Error("backend field is missing"); };
  const real = { title: "Dragon Warrior Saga: Special Edition" };
  const items = [{ broken: true }, real];

  assert.deepEqual(filterRelevant(items, "Dragon Warrior Saga", boom), []);
  assert.deepEqual(sortBySimilarity(items, "Dragon Warrior Saga", boom), items);
});

test("kino.rank: getTitle answering a non-string, or an array with none, is a missing title too", () => {
  const real = { name: "Dragon Warrior Saga: Special Edition" };
  const weird = { name: 123 };
  const mixedArray = { name: [123, null, "Dragon Warrior Saga: Special Edition"] };
  const getTitle = (x) => x.name;

  assert.deepEqual(filterRelevant([weird], "Dragon Warrior Saga", getTitle), []);
  // A form buried in an array of junk is still found and used.
  assert.deepEqual(filterRelevant([mixedArray], "Dragon Warrior Saga", getTitle), [mixedArray]);
  assert.deepEqual(sortBySimilarity([weird, real], "Dragon Warrior Saga", getTitle), [real, weird]);
});

test("kino.rank: the shim wires the exact same functions the runtime inlines", () => {
  const { kino } = createKino(JSON.parse(manifest()));
  // Same module, not a copy: kino-shim.mjs imports kino-rank.mjs directly.
  assert.equal(kino.rank.shortQuery, shortQuery);
  assert.equal(kino.rank.sortBySimilarity, sortBySimilarity);
  assert.equal(kino.rank.filterRelevant, filterRelevant);
});

// The app's prelude.js has no module loader to import kino-rank.mjs with, so it carries a literal
// copy of the algorithm instead (see both files' own comments). This is what keeps that copy honest.
// prelude.js lives only in the app repo, not in a published plugin repo: skip there.
test("kino.rank: the shim and the runtime run the exact same code", (t) => {
  const preludePath = join(here, "..", "..", "..", "app", "src", "main", "resources", "plugin", "prelude.js");
  if (!existsSync(preludePath)) { t.skip("no app repo around this kit"); return; }
  const BEGIN = "kino.rank shared core: BEGIN (byte-identical in kino-rank.mjs and prelude.js)";
  const END = "kino.rank shared core: END";
  const coreOf = (path) => {
    const text = readFileSync(path, "utf8");
    const beginIdx = text.indexOf(BEGIN);
    assert.notEqual(beginIdx, -1, `${path} is missing the BEGIN marker`);
    const contentStart = text.indexOf("\n", beginIdx) + 1;
    const endIdx = text.indexOf(END, contentStart);
    assert.notEqual(endIdx, -1, `${path} is missing the END marker`);
    const contentEnd = text.lastIndexOf("\n", endIdx) + 1;
    return text.slice(contentStart, contentEnd);
  };
  const shim = coreOf(join(here, "..", "kino-rank.mjs"));
  const prelude = coreOf(preludePath);
  assert.equal(prelude, shim);
});

// Same as the app: a url setting's manifest default is never a server the plugin may reach, even
// when a manifest skips validation and hands one to the shim directly.
test("a url setting's manifest default is ignored: only a typed server counts", async () => {
  const m = JSON.parse(manifest({ settings: [{ key: "server", label: "Servidor", type: "url", default: "http://192.168.1.1" }] }));
  const { kino } = createKino(m, { fetchImpl: () => { throw new Error("must not reach the network"); } });
  assert.equal(kino.config.get("server"), undefined);
  await assert.rejects(kino.fetch("http://192.168.1.1/"), (err) => err.code === "host_not_allowed");
});

function server(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler).listen(0, "127.0.0.1", () => resolve(s));
  });
}

// The app never lets a typed server be loopback, and neither does the kit: tests type 10.0.2.2
// and this fetch delivers it to the local server.
const toLocal = (port) => (url, init) => fetch(String(url).replace("10.0.2.2:8096", `127.0.0.1:${port}`), init);
const typedServer = JSON.parse(manifest({ settings: [{ key: "server", label: "Servidor", type: "url", required: true }] }));

test("fetch v2: bodies, cookies, manual redirects, hidden set-cookie, binary, typed codes", async () => {
  const seen = [];
  const s = await server((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, type: req.headers["content-type"], cookie: req.headers.cookie, body });
      if (req.url === "/login") { res.writeHead(302, { Location: "https://evil.example/", "Set-Cookie": "sid=abc; Path=/" }); return res.end(); }
      if (req.url === "/bin") { res.writeHead(200, { "Content-Type": "application/octet-stream" }); return res.end(Buffer.from([1, 2, 3])); }
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "t=2" });
      res.end('{"ok":true}');
    });
  });
  const { kino } = createKino(typedServer, { config: { server: "http://10.0.2.2:8096" }, fetchImpl: toLocal(s.address().port) });
  const at = (p) => "http://10.0.2.2:8096" + p;
  try {
    const login = await kino.fetch(at("/login"), { method: "POST", body: { form: { user: "ana maría", pass: "a&b" } }, redirect: "manual" });
    assert.equal(login.status, 302);
    assert.equal(login.headers.location, "https://evil.example/");
    assert.equal(login.headers["set-cookie"], undefined);
    assert.equal(kino.cookies.get(at("/"), "sid"), "abc");
    const j = await kino.fetch(at("/j"), { method: "PUT", body: { json: { q: 1 } } });
    assert.equal(j.json().ok, true);
    await kino.fetch(at("/nocookie"), { cookies: false });
    const bin = await kino.fetch(at("/bin"));
    assert.equal(bin.base64(), "AQID");
    assert.deepEqual(seen.map((r) => [r.url, r.cookie ?? null]), [["/login", null], ["/j", "sid=abc"], ["/nocookie", null], ["/bin", "sid=abc; t=2"]]);
    assert.equal(seen[0].body, "user=ana%20mar%C3%ADa&pass=a%26b");
    assert.equal(seen[0].type, "application/x-www-form-urlencoded");
    assert.equal(seen[1].body, '{"q":1}');
    // Kino 0.9.55: the refused host rides in e.host (contract.json fetch.errorHostField).
    await assert.rejects(kino.fetch("https://evil.example/"), (e) => e.code === "host_not_allowed" && e.host === "evil.example");
    await assert.rejects(kino.fetch("http://example.com/"), (e) => e.code === "host_not_allowed" && e.host === "example.com");
    await assert.rejects(kino.fetch("http://10.0.2.2:9999/"), (e) => e.code === "host_not_allowed" && e.host === "10.0.2.2");
    await assert.rejects(kino.fetch("https://example.com/", { method: "TRACE" }), (e) => e.code === "invalid_request");
    await assert.rejects(kino.fetch("https://example.com/", { body: { weird: 1 }, method: "POST" }), (e) => e.code === "invalid_request");
    await assert.rejects(kino.fetch("https://example.com/", { method: "POST", body: "x".repeat(1100000) }), (e) => e.code === "too_large");
    assert.equal(seen.length, 4);
  } finally {
    s.close();
  }
});

test("record, then replay offline gives the same answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-tape-"));
  const tape = join(dir, "tape.json");
  const s = await server((req, res) => { res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "a=1" }); res.end('{"n":' + req.url.length + "}"); });
  const config = { server: "http://10.0.2.2:8096" };
  try {
    const rec = createKino(typedServer, { config, record: tape, fetchImpl: toLocal(s.address().port) });
    const live = await rec.kino.fetch("http://10.0.2.2:8096/abc", { method: "POST", body: { json: { q: 1 } } });
    rec.saveTape();
    assert.equal(live.json().n, 4);
  } finally {
    s.close();
  }
  const saved = JSON.parse(readFileSync(tape, "utf8"));
  assert.equal(saved.length, 1);
  assert.ok(saved.every((t) => t.headers.every(([k]) => !k.startsWith("set-cookie"))));
  const rep = createKino(typedServer, { config, replay: tape, fetchImpl: () => { throw new Error("replay must not touch the network"); } });
  const again = await rep.kino.fetch("http://10.0.2.2:8096/abc", { method: "POST", body: { json: { q: 1 } } });
  assert.equal(again.json().n, 4);
  await assert.rejects(rep.kino.fetch("http://10.0.2.2:8096/other"), (e) => e.code === "network");
  rmSync(dir, { recursive: true, force: true });
});

test("checkOutput drops what the app drops", () => {
  const m = JSON.parse(manifest());
  const r = checkOutput("search", { items: [{ id: "a", ref: "r", title: "A", kind: "movie" }, { id: "b", ref: "r", title: "B", kind: "movie", adult: true }], next: "2" }, { ...m, capabilities: ["search", "resolve"] });
  assert.deepEqual(r.value.items.map((i) => i.id), ["a"]);
  assert.equal(r.value.next, null);
  assert.ok(r.drops.some((d) => d.includes("browse")));
  assert.ok(r.drops.some((d) => d.includes("adult")));
  assert.throws(() => checkOutput("resolve", { url: "http://example.com/v.mp4" }, m), /https/);
  const lan = checkOutput("resolve", { url: "http://192.168.1.10:8096/v.mp4", expiresInSeconds: 10 }, m, ["http://192.168.1.10:8096/"]);
  assert.equal(lan.value.expiresInSeconds, 0);
});

test("checkOutput keeps a live item only for an apiVersion 2 plugin, and never its duration", () => {
  const items = [
    { id: "c1", ref: "ch-1", title: "Canal Uno", kind: "live", runtimeMinutes: 120 },
    { id: "m", ref: "r", title: "M", kind: "movie", runtimeMinutes: 90 },
  ];
  const v1 = checkOutput("search", items, { ...JSON.parse(manifest()), capabilities: ["search", "resolve"] });
  assert.deepEqual(v1.value.items.map((i) => i.id), ["m"]);
  assert.ok(v1.drops.some((d) => d.includes("c1") && d.includes("live")));
  const v2 = checkOutput("search", items, { ...JSON.parse(manifest({ apiVersion: 2 })), capabilities: ["search", "resolve"] });
  assert.deepEqual(v2.value.items.map((i) => [i.id, i.kind, i.runtimeMinutes]), [["c1", "live", 0], ["m", "movie", 90]]);
  // Below apiVersion 6 a channel never stays in a Home row (output.homeLiveApiVersion); from 6 it does.
  const home = checkOutput("home", [{ id: "vivo", title: "En vivo", items }], { ...JSON.parse(manifest({ apiVersion: 2 })), capabilities: ["home", "resolve"] });
  assert.deepEqual(home.value[0].items.map((i) => i.kind), ["movie"]);
  assert.ok(home.drops.some((d) => d.includes("c1") && d.includes("apiVersion 6")));
  const home6 = checkOutput("home", [{ id: "vivo", title: "En vivo", items }], { ...JSON.parse(manifest({ apiVersion: 6 })), capabilities: ["home", "resolve"] });
  assert.deepEqual(home6.value[0].items.map((i) => i.kind), ["live", "movie"]);
  const onlyLive = [{ id: "vivo", title: "En vivo", items: [items[0]] }];
  assert.equal(checkOutput("home", onlyLive, { ...JSON.parse(manifest({ apiVersion: 5 })), capabilities: ["home", "resolve"] }).value.length, 0);
  assert.equal(contract.output.homeLiveApiVersion, 6);
  assert.deepEqual(contract.output.itemKinds, ["movie", "series", "live", "music", "podcast"]);
  assert.equal(contract.output.liveKindApiVersion, 2);
});

test("checkOutput keeps music and podcast items only from apiVersion 8, with their duration and without episodes", () => {
  const items = [
    { id: "al", ref: "album-1", title: "Un álbum", kind: "music", runtimeMinutes: 42 },
    { id: "pc", ref: "show-1", title: "Un podcast", kind: "podcast" },
    { id: "m", ref: "r", title: "M", kind: "movie", runtimeMinutes: 90 },
  ];
  // No "episodes": an audio item doesn't need it (its ref then goes to resolve, like a movie's).
  const at = (apiVersion) => ({ ...JSON.parse(manifest({ apiVersion })), capabilities: ["search", "home", "resolve"] });
  const v7 = checkOutput("search", items, at(7));
  assert.deepEqual(v7.value.items.map((i) => i.id), ["m"]);
  assert.ok(v7.drops.some((d) => d.includes("al") && d.includes("music") && d.includes("apiVersion 8")), v7.drops.join("\n"));
  assert.ok(v7.drops.some((d) => d.includes("pc") && d.includes("podcast") && d.includes("apiVersion 8")), v7.drops.join("\n"));
  const v8 = checkOutput("search", items, at(8));
  assert.deepEqual(v8.value.items.map((i) => [i.id, i.kind, i.runtimeMinutes]), [["al", "music", 42], ["pc", "podcast", 0], ["m", "movie", 90]]);
  assert.deepEqual(checkOutput("home", [{ id: "musica", title: "Música", items }], at(8)).value[0].items.map((i) => i.kind), ["music", "podcast", "movie"]);
  assert.equal(contract.output.audioKindApiVersion, 8);
  assert.deepEqual(contract.output.audioKinds, ["music", "podcast"]);
  assert.deepEqual(contract.search.types, ["movie", "series", "music", "podcast", "any"]);
});

test("checkOutput keeps an audio item's artist trimmed and cut, as the app does, and never on another kind", () => {
  const at8 = { ...JSON.parse(manifest({ apiVersion: 8 })), capabilities: ["search", "resolve"] };
  const r = checkOutput("search", [
    { id: "al", ref: "a", title: "Un álbum", kind: "music", artist: "  Los Artistas  " },
    { id: "pc", ref: "p", title: "Un podcast", kind: "podcast", artist: "x".repeat(250) },
    { id: "nn", ref: "n", title: "Sin artista", kind: "music" },
    { id: "m", ref: "r", title: "t", kind: "movie", artist: "Alguien" },
  ], at8);
  assert.deepEqual(r.value.items.map((i) => i.artist), ["Los Artistas", "x".repeat(200), undefined, undefined]);
  assert.equal(contract.output.maxArtistChars, 200);
});

test("checkOutput validates a stream's audioTracks like its subtitles", () => {
  const m = JSON.parse(manifest());
  const r = checkOutput("resolve", {
    url: "https://example.com/v.mp4",
    audioTracks: [
      { lang: "en", url: "https://example.com/a-en.aac", label: "English" },
      { lang: "es", url: "https://evil.example/a-es.aac" },
    ],
  }, m);
  assert.deepEqual(r.value.audioTracks.map((a) => a.lang), ["en"]);
  const many = checkOutput("resolve", {
    url: "https://example.com/v.mp4",
    audioTracks: Array.from({ length: 10 }, (_, i) => ({ lang: "en", url: `https://example.com/a${i}.aac` })),
  }, m);
  assert.equal(many.value.audioTracks.length, contract.output.maxAudioTracks);
});

test("checkOutput keeps an audio track URL given twice once, the first wins, as the app does", () => {
  const m = JSON.parse(manifest());
  const r = checkOutput("resolve", {
    url: "https://example.com/v.mp4",
    audioTracks: [
      { lang: "es", url: "https://example.com/a.aac", label: "Latino" },
      { lang: "en", url: "https://example.com/a.aac" },
      { lang: "fr", url: "https://example.com/b.aac" },
    ],
  }, m);
  assert.deepEqual(r.value.audioTracks.map((a) => a.lang), ["es", "fr"]);
});

test("checkOutput accepts a widevine drm block only for a plugin that declares drm, and checks its license like the url", () => {
  const stream = {
    url: "https://example.com/v.mpd",
    drm: { type: "widevine", licenseUrl: "https://example.com/lic", licenseHeaders: { Authorization: "Bearer t", Host: "evil", "X-Bad": "a\nb" } },
  };
  const plain = { ...JSON.parse(manifest({ apiVersion: 2 })), capabilities: ["search", "resolve"] };
  assert.throws(() => checkOutput("resolve", stream, plain), /the video has DRM and plugins don't support it/);
  assert.throws(() => checkOutput("resolve", stream, JSON.parse(manifest())), /the video has DRM and plugins don't support it/);
  const withDrm = { ...plain, capabilities: ["search", "resolve", "drm"] };
  const r = checkOutput("resolve", stream, withDrm).value;
  assert.deepEqual(r.drm, { type: "widevine", licenseUrl: "https://example.com/lic", licenseHeaders: { Authorization: "Bearer t" } });
  assert.equal(checkOutput("resolve", { url: "https://example.com/v.mp4" }, withDrm).value.drm, null);
  const bad = (drm) => () => checkOutput("resolve", { url: "https://example.com/v.mpd", drm }, withDrm);
  assert.throws(bad({ type: "widevine", licenseUrl: "http://example.com/lic" }), /the video's license must use https/);
  assert.throws(bad({ type: "widevine", licenseUrl: "https://evil.example/lic" }), /the video's license points to evil.example, which the plugin didn't declare/);
  assert.throws(bad({ type: "widevine" }), /the video's license has an invalid address/);
  assert.throws(bad({ type: "playready", licenseUrl: "https://example.com/lic" }), /the video uses a DRM Kino doesn't support/);
  assert.throws(bad("widevine"), /the video's DRM is not valid/);
  for (const k of ["license", "licenseUrl", "drmLicenseUrl", "keySystem", "widevine"]) {
    assert.throws(() => checkOutput("resolve", { url: "https://example.com/v.mpd", [k]: "x" }, withDrm), /the video has DRM/);
    assert.throws(() => checkOutput("resolve", { ...stream, [k]: "x" }, withDrm), /the video has DRM/);
  }
  assert.deepEqual(contract.output.drm, { field: "drm", types: ["widevine"] });
  assert.equal(contract.output.maxHeaders, 20);
  // A protected video may still bring side audio tracks: both are kept (the app plays the audio clear).
  const both = checkOutput("resolve", { ...stream, audioTracks: [{ lang: "es", url: "https://example.com/a.aac" }, { lang: "en", url: "https://evil.example/a.aac" }] }, withDrm).value;
  assert.equal(both.drm.licenseUrl, "https://example.com/lic");
  assert.deepEqual(both.audioTracks.map((a) => a.lang), ["es"]);
});

test("checkOutput lets a stream, its subtitles, audio and license use http only on a host declared insecureHttp", () => {
  const m = validateManifest(manifest({
    apiVersion: 2,
    hosts: ["api.example.com", { host: "cdn.example.com", insecureHttp: true }, "lic.example.com"],
    capabilities: ["search", "resolve", "drm"],
  })).manifest;
  const r = checkOutput("resolve", {
    url: "http://cdn.example.com/v.mpd",
    subtitles: [{ lang: "es", url: "http://cdn.example.com/s.vtt" }, { lang: "en", url: "http://api.example.com/s.vtt" }],
    audioTracks: [{ lang: "es", url: "http://cdn.example.com/a.aac" }, { lang: "en", url: "http://lic.example.com/a.aac" }],
    drm: { type: "widevine", licenseUrl: "http://cdn.example.com/lic" },
  }, m).value;
  assert.equal(r.url, "http://cdn.example.com/v.mpd");
  assert.deepEqual(r.subtitles.map((s) => s.lang), ["es"]);
  assert.deepEqual(r.audioTracks.map((a) => a.lang), ["es"]);
  assert.equal(r.drm.licenseUrl, "http://cdn.example.com/lic");
  // Every other declared host stays https-only, and https still works on the insecure one.
  assert.throws(() => checkOutput("resolve", { url: "http://api.example.com/v.mp4" }, m), /the video must use https/);
  assert.throws(() => checkOutput("resolve", { url: "http://sub.cdn.example.com/v.mp4" }, m), /the video must use https/);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example.com/v.mp4", drm: { type: "widevine", licenseUrl: "http://lic.example.com/l" } }, m), /the video's license must use https/);
  assert.equal(checkOutput("resolve", { url: "https://cdn.example.com/v.mp4" }, m).value.url, "https://cdn.example.com/v.mp4");
  // A v1 manifest (never an insecure host) is unchanged: http is refused on every declared host.
  assert.throws(() => checkOutput("resolve", { url: "http://example.com/v.mp4" }, validateManifest(manifest()).manifest), /the video must use https/);
});

test("kino.fetch reaches a host declared insecureHttp over http, and no other declared host", async () => {
  const s = await server((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("hola " + req.url); });
  const m = validateManifest(manifest({ apiVersion: 2, hosts: ["api.example.com", { host: "cdn.example.com", insecureHttp: true }] })).manifest;
  const port = s.address().port;
  const local = (url, init) => fetch(String(url).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`), init);
  let touched = 0;
  const { kino } = createKino(m, { fetchImpl: (url, init) => { touched++; return local(url, init); } });
  try {
    const r = await kino.fetch("http://cdn.example.com/x");
    assert.equal(r.status, 200);
    assert.equal(r.text(), "hola /x");
    assert.equal(r.url, "http://cdn.example.com/x");
    await assert.rejects(kino.fetch("http://api.example.com/x"), (e) => e.code === "host_not_allowed" && /https/.test(e.message));
    await assert.rejects(kino.fetch("http://sub.cdn.example.com/x"), (e) => e.code === "host_not_allowed");
    assert.equal(touched, 1);
    // A v1 plugin never has an insecure host: http on its declared host is refused as always.
    const v1 = createKino(JSON.parse(manifest()), { fetchImpl: () => { throw new Error("must not reach the network"); } }).kino;
    await assert.rejects(v1.fetch("http://example.com/"), (e) => e.code === "host_not_allowed");
  } finally {
    s.close();
  }
});

test("checkOutput keeps an episode's still, overview and runtimeMinutes as the app does", () => {
  const m = JSON.parse(manifest({ capabilities: ["search", "episodes", "resolve"] }));
  const r = checkOutput("episodes", {
    episodes: [
      { number: 1, ref: "e1", title: "Uno", still: "https://example.com/e1.png", overview: "  Primero  ", runtimeMinutes: 42 },
      { number: 2, ref: "e2", still: "http://example.com/e2.png", runtimeMinutes: 0 },
      { number: 3, ref: "e3", still: "https://192.168.1.5/e3.png", runtimeMinutes: 99999 },
    ],
  }, m);
  const [one, two, three] = r.value.episodes;
  assert.equal(one.still, "https://example.com/e1.png");
  assert.equal(one.overview, "Primero");
  assert.equal(one.runtimeMinutes, 42);
  // The image rule of an item's poster (PluginOutput.imageUrl): http is fine on a public name, never the home network; a bad length is 0.
  assert.equal(two.still, "http://example.com/e2.png");
  assert.equal(two.runtimeMinutes, 0);
  assert.equal(three.still, "");
  assert.equal(three.runtimeMinutes, 0);
  // The person's own server (a url setting) may serve the still, over http too.
  const own = checkOutput("episodes", { episodes: [{ number: 1, ref: "e1", still: "http://192.168.1.5:8096/e1.png" }] }, m, ["http://192.168.1.5:8096"]);
  assert.equal(own.value.episodes[0].still, "http://192.168.1.5:8096/e1.png");
});

test("checkOutput reads an episodes answer's sibling seasons as the app does", () => {
  const m = JSON.parse(manifest({ capabilities: ["search", "episodes", "resolve"] }));
  const none = checkOutput("episodes", { episodes: [{ number: 1, ref: "e1" }] }, m);
  assert.deepEqual(none.value.seasons, []);
  const r = checkOutput("episodes", {
    episodes: [{ number: 1, ref: "e1" }],
    seasons: [
      { id: "s1", ref: "S1", title: "Temporada 1", number: 1 },
      { id: "s2", ref: "S2", title: "Temporada 2", number: 2, current: true },
      { id: "s2", ref: "S2b", title: "Repetida" },
      { id: "bad id!", ref: "S3", title: "T" },
      { id: "s4", ref: "", title: "T" },
      { id: "s5", ref: "S5", title: "  " },
      { id: "s6", ref: "S6", title: "Sin número", number: 1000, current: "yes" },
    ],
  }, m);
  assert.deepEqual(r.value.seasons, [
    { id: "s1", ref: "S1", title: "Temporada 1", number: 1, current: false },
    { id: "s2", ref: "S2", title: "Temporada 2", number: 2, current: true },
    { id: "s6", ref: "S6", title: "Sin número", number: 0, current: false },
  ]);
  assert.equal(r.drops.length, 4);
  const many = { episodes: [], seasons: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, ref: `S${i}`, title: `T${i}` })) };
  assert.equal(checkOutput("episodes", many, m).value.seasons.length, contract.output.maxSeasons);
  assert.deepEqual(checkOutput("episodes", { episodes: [], seasons: "T1, T2" }, m).value.seasons, []);
});

test("run.mjs's call() gives a clear message for a malformed search argument, not a bare JSON error", async () => {
  await assert.rejects(
    call({ search: () => {} }, "search", ['{"q": bad json']),
    (e) => e instanceof Error && !(e instanceof SyntaxError) && /search argument/.test(e.message) && /not valid JSON/.test(e.message),
  );
});

test("init scaffolds a plugin the kit accepts, and never overwrites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-"));
  const target = join(dir, "mi-plugin");
  const written = scaffold(target, { name: "Mi plugin", host: "example.org" });
  assert.deepEqual(written.sort(), [".gitignore", "README.md", "kino-plugin.json", "plugin.js", "test/plugin.test.mjs"]);
  const r = await validate(target);
  assert.deepEqual(r.problems, []);
  writeFileSync(join(target, "plugin.js"), "// mine");
  assert.deepEqual(scaffold(target, {}), []);
  assert.equal(readFileSync(join(target, "plugin.js"), "utf8"), "// mine");
  rmSync(dir, { recursive: true, force: true });
});

// This plan's own recorded trap: `node --test` on a bare directory argument fails on Node 24 (it
// needs the explicit file). The scaffolded README must not tell an author to hit it.
test("the scaffolded README points at the explicit test file, never a bare test/ directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-readme-"));
  try {
    scaffold(dir, {});
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.ok(readme.includes("node --test test/plugin.test.mjs"), "README should point at the explicit test file");
    assert.doesNotMatch(readme, /node --test test\/\s/, "README must not tell authors to run node --test on a bare directory");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function dtsPath() {
  const candidates = [join(here, "..", "..", "kino.d.ts"), join(here, "..", "..", "..", "docs", "plugins", "kino.d.ts")];
  return candidates.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
}

// kino.d.ts's header claims its numeric comments "come from contract.json"; nothing enforced that
// claim until now. This ties each documented number to the contract value it describes, so the two
// can't silently drift apart.
test("kino.d.ts's documented numbers match contract.json", { skip: NEEDS_KINO_REPO }, () => {
  const dts = readFileSync(dtsPath(), "utf8");
  const c = contract;
  const kb = (bytes) => (bytes % (1024 * 1024) === 0 ? `${bytes / 1024 / 1024} MB` : `${bytes / 1024} KB`);
  const mustContain = [
    `at most ${c.output.maxRefChars} characters`,
    `http or https, at most ${c.output.maxImageUrlChars} characters`,
    `At most ${c.output.maxGenres}, each at most ${c.output.maxGenreChars} characters`,
    `${c.output.minRuntimeMinutes}..${c.output.maxRuntimeMinutes}`,
    `At most ${c.output.maxBadges}, each at most ${c.output.maxBadgeChars} characters`,
    `at most ${c.output.maxCursorChars} characters`,
    `1..${c.output.maxSeasonNumber}, default 1.`,
    `1..${c.output.maxEpisodeNumber}`,
    `${c.output.minExpiresInSeconds}..${c.output.maxExpiresInSeconds}:`,
    `at most ${c.fetch.maxRequestChars.toLocaleString("en-US")} characters`,
    `at most ${c.fetch.maxRedirects} hops`,
    `Default ${c.fetch.defaultTimeoutMs}, at most ${c.fetch.maxTimeoutMs}.`,
    `at most ${kb(c.fetch.maxBodyBytes)}`,
    `at most ${c.errors.maxMessageChars} characters`,
    `0..${c.sleep.maxMs} ms`,
    `${c.storage.maxTotalBytes / 1024} KB in total`,
    `at most ${c.storage.maxTtlMs.toLocaleString("en-US")} ms (30 days)`,
    `Data at most ${kb(c.crypto.maxDataBytes)}`,
    `iterations at most ${c.crypto.pbkdf2MaxIterations}, keyLength at most ${c.crypto.pbkdf2MaxKeyBytes} bytes`,
    `1..${c.crypto.randomMaxBytes} bytes`,
    `at most ${c.search.maxAltTitles}, each at most ${c.search.maxAltTitleChars} characters`,
    c.output.itemIdPattern,
    c.output.imdbPattern,
    c.search.types.map((t) => `"${t}"`).join(" | "),
  ];
  for (const needle of mustContain) assert.ok(dts.includes(needle), `kino.d.ts is out of date with contract.json: missing "${needle}"`);
});

test("kino.d.ts's meta typings carry contract.json's meta rules", { skip: NEEDS_KINO_REPO }, () => {
  const dts = readFileSync(dtsPath(), "utf8");
  const c = contract, m = contract.output.meta;
  const block = dts.slice(dts.indexOf("interface KinoMetaQuery"), dts.indexOf("type KinoMetaFn"));
  const mustContain = [
    `a URL longer than ${c.output.maxImageUrlChars} characters is dropped`,
    `Read (up to ${c.output.maxTitleChars} characters) but not shown`,
    `Up to ${c.output.maxTextChars} characters`,
    `Only its first ${m.yearReadChars} characters are read`,
    `up to ${c.output.maxGenreChars} characters each; the first ${c.output.maxGenres} non-empty ones`,
    `${c.output.minRuntimeMinutes}..${c.output.maxRuntimeMinutes} (a numeric string`,
    `At most ${m.maxEpisodes} entries read`,
    `\`season\` ${m.minEpisodeSeason}..${c.output.maxSeasonNumber}`,
    `\`number\`\n   * 1..${c.output.maxEpisodeNumber}`,
    `(up to ${c.output.maxRefChars} characters)`,
    `at most ${m.maxRatings} kept`,
    `at most ${m.maxCast} with a name`,
    `up to ${m.maxCastNameChars} characters`,
    `with the first ${m.pageCastNames} names`,
    m.ratingSources.map((x) => `"${x}"`).join(" | "),
  ];
  for (const needle of mustContain) assert.ok(block.includes(needle), `kino.d.ts's meta typings are out of date with contract.json: missing ${JSON.stringify(needle)}`);
  const fn = dts.slice(dts.indexOf("type KinoMetaFn") - 300, dts.indexOf("type KinoMetaFn"));
  assert.ok(fn.includes(`within ${c.timeoutsMs.meta / 1000} s`) && fn.includes(`remembered ${m.cacheTtlMs / 60000} minutes`), "KinoMetaFn's timeout and cache");
  assert.match(dts, /interface KinoPlayingPlugin extends KinoPlugin \{[^}]*meta\?: KinoMetaFn/);
});

function declaredKino() {
  const lines = readFileSync(dtsPath(), "utf8").split("\n");
  const out = new Set();
  const path = [];
  let depth = 0;
  for (const raw of lines.slice(lines.findIndex((l) => l.startsWith("declare namespace kino")))) {
    const line = raw.trim();
    const ns = /^(?:declare )?namespace (\w+) \{$/.exec(line);
    if (ns) { path.push(ns[1]); depth++; continue; }
    const fn = /^function (\w+)\(/.exec(line);
    if (fn) out.add([...path, fn[1]].join(".") + "=function");
    const cst = /^const (\w+):/.exec(line);
    if (cst) out.add([...path, cst[1]].join(".") + "=value");
    if (line === "}") { path.pop(); depth--; if (depth === 0) break; }
  }
  return out;
}

test("kino.d.ts declares exactly what the kit's kino has", { skip: NEEDS_KINO_REPO }, () => {
  // At the highest apiVersion, so members gated on it (kino.meta.byTitle, apiVersion 9) are there too.
  const { kino } = createKino(JSON.parse(manifest({ apiVersion: contract.maxApiVersion })));
  const out = new Set();
  const walk = (o, p) => Object.keys(o).forEach((k) => {
    const v = o[k];
    // A function's own members too (kino.log.report).
    if (typeof v === "function") { out.add(`${p}.${k}=function`); walk(v, `${p}.${k}`); }
    else if (v !== null && typeof v === "object") walk(v, `${p}.${k}`);
    else out.add(`${p}.${k}=value`);
  });
  walk(kino, "kino");
  // kino.cloudstream exists only in a plugin Kino generated from a CloudStream repository (KinoDtsTest's rule): a
  // hand-written plugin's kino, which is the kit's, never has it.
  const declared = [...declaredKino()];
  const conditional = declared.filter((m) => m.startsWith("kino.cloudstream."));
  assert.ok(conditional.length > 0, "kino.d.ts no longer declares kino.cloudstream");
  assert.deepEqual([...out].sort(), declared.filter((m) => !conditional.includes(m)).sort());
});

test("kino.seed in the kit answers nothing, never throws, and keeps the contract's keys and limits", () => {
  const { kino } = createKino(JSON.parse(manifest({ apiVersion: contract.maxApiVersion })));
  assert.equal(typeof kino.seed, "function");
  for (const bad of [undefined, null, 7, "x", [], {}, { sn: "a" }, { sn: "a", userId: "b", userToken: "   " }, { sn: "a".repeat(contract.kinoSeed.maxValueChars + 1), userId: "b", userToken: "c" }]) assert.equal(kino.seed(bad), undefined);
  assert.equal(kino.seed({ sn: "a", userId: "b", userToken: "c", extra: { nested: true } }), undefined);
  assert.deepEqual(contract.kinoSeed.required.filter((k) => !contract.kinoSeed.allowed.includes(k)), []);
});

test("telemetry: apiVersion 6 boolean, a consent line, and kino.log.report writes a line", () => {
  assert.equal(validateManifest(manifest({ apiVersion: 6, telemetry: true })).manifest.telemetry, true);
  assert.equal(validateManifest(manifest({ apiVersion: 6 })).manifest.telemetry, false);
  assert.equal(validateManifest(manifest({ apiVersion: 5, telemetry: "yes" })).manifest.telemetry, false);
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, telemetry: "yes" })), { ok: false, field: "telemetry", message: 'The "telemetry" field must be true, false or "verbose"' });
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 6, telemetry: true })).manifest),
    [{ text: "Comparte con Kino registros de errores y datos técnicos de algunas reproducciones para corregir fallas", danger: false }]);
  const { kino } = createKino(validateManifest(manifest({ apiVersion: 6, telemetry: true })).manifest);
  const seen = [];
  const before = console.error;
  // writeErr was bound at load; capture through process.stderr instead.
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { seen.push(String(chunk)); return true; };
  try {
    kino.log.report("session", "shared_fallback", "tries=2");
  } finally {
    process.stderr.write = write;
    console.error = before;
  }
  assert.ok(seen.join("").includes("[kino.log.report] session shared_fallback tries=2"), seen.join(""));
});

test("telemetry \"verbose\": accepted at apiVersion 6, with its own consent line", () => {
  assert.equal(validateManifest(manifest({ apiVersion: 6, telemetry: "verbose" })).manifest.telemetry, "verbose");
  assert.equal(validateManifest(manifest({ apiVersion: 5, telemetry: "verbose" })).manifest.telemetry, false);
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, telemetry: "Verbose" })).ok, false);
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 6, telemetry: "verbose" })).manifest),
    [{ text: "Comparte registros detallados de reproducción y errores con Kino para corregir fallas", danger: false }]);
});

test("--retry takes an optional HTTP status", () => {
  assert.deepEqual(parseArgs(["--retry", "conflict:1:409", "p.js", "resolve", "r"]).opts.retry, { reason: "conflict", attempt: 1, status: 409 });
  assert.deepEqual(parseArgs(["--retry", "expired:2", "p.js", "resolve", "r"]).opts.retry, { reason: "expired", attempt: 2 });
  assert.throws(() => parseArgs(["--retry", "expired:2:500", "p.js", "resolve", "r"]));
});

test("apiVersion 3: channels validates only on v3, and needs liveCategories + liveChannels exported", async () => {
  const caps = ["home", "resolve", "channels"];
  assert.deepEqual(validateManifest(manifest({ capabilities: caps })), { ok: false, field: "capabilities", message: 'The "channels" capability needs apiVersion 3' });
  assert.deepEqual(validateManifest(manifest({ apiVersion: 2, capabilities: caps })), { ok: false, field: "capabilities", message: 'The "channels" capability needs apiVersion 3' });
  assert.deepEqual(validateManifest(manifest({ capabilities: ["search", "resolve", "download"] })), { ok: false, field: "capabilities", message: 'The "download" capability needs apiVersion 2' });
  assert.equal(validateManifest(manifest({ apiVersion: 3, capabilities: caps })).ok, true);
  const dir = mkdtempSync(join(tmpdir(), "kino-channels-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, capabilities: caps }));
    writeFileSync(join(dir, "plugin.js"), "export async function home(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    const missing = await validate(dir);
    assert.ok(missing.problems.some((p) => p.includes("liveCategories, liveChannels")));
    writeFileSync(join(dir, "plugin.js"), "export async function home(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }\nexport async function liveCategories(){ return [] }\nexport async function liveChannels(){ return { items: [] } }");
    assert.deepEqual((await validate(dir)).problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkOutput reads liveCategories, liveChannels and guide as the app does", () => {
  const m = { ...JSON.parse(manifest({ apiVersion: 3 })), capabilities: ["home", "resolve", "channels"] };
  const cats = checkOutput("liveCategories", [{ id: "news", title: "Noticias", country: "co" }, { id: "news", title: "x" }, { id: "a", title: "A", adult: true }], m);
  assert.deepEqual(cats.value.categories, [{ id: "news", title: "Noticias", country: "CO", genre: null }]);
  const page = checkOutput("liveChannels", { items: [
    { id: "c1", title: "Uno", ref: "r1", number: 7, categoryId: "news" },
    { id: "c2", title: "Dos", ref: "" },
    { id: "c3", title: "Tres", ref: "r3", number: 10000 },
  ], next: "p2" }, m);
  assert.deepEqual(page.value.items.map((c) => [c.id, c.number]), [["c1", 7], ["c3", 0]]);
  assert.equal(page.value.next, "p2");
  const g = checkOutput("guide", [
    { channelId: "c1", title: "B", start: 2000, end: 3000 },
    { channelId: "c1", title: "A", start: 1000, end: 2000, description: "d" },
    { channelId: "c1", title: "Mal", start: 5, end: 4 },
  ], m);
  assert.deepEqual(g.value.map((e) => e.title), ["A", "B"]);
  assert.equal(contract.live.maxChannelsPerPage, 500);
});

test("checkOutput reads inline streams and playlist declarations as the app does", () => {
  const m = { ...JSON.parse(manifest({ apiVersion: 3, hosts: ["cdn.example.com"] })), capabilities: ["home", "resolve", "channels"] };
  const page = checkOutput("liveChannels", { items: [
    { id: "a", title: "A", stream: { url: "https://cdn.example.com/a.m3u8" } },
    { id: "b", title: "B", stream: { url: "https://evil.example.org/b.m3u8" } },
    { id: "~c", title: "C", ref: "r" },
  ] }, m);
  assert.deepEqual(page.value.items.map((c) => c.id), ["a"]);
  assert.equal(page.value.items[0].ref, "");
  assert.equal(page.value.items[0].stream.url, "https://cdn.example.com/a.m3u8");
  const cats = checkOutput("liveCategories", [
    { id: "news", title: "Noticias" },
    { playlist: { url: "https://cdn.example.com/l.m3u", format: "m3u", epg: { url: "https://cdn.example.com/g.xml", format: "xmltv" } } },
    { playlist: { url: "https://evil.example.org/l.m3u", format: "m3u" } },
  ], m);
  assert.deepEqual(cats.value.categories.map((c) => c.id), ["news"]);
  assert.deepEqual(cats.value.playlists.map((p) => [p.url, p.epgUrl, p.refreshHours]), [["https://cdn.example.com/l.m3u", "https://cdn.example.com/g.xml", 12]]);
  // Strict like the app: only the boolean true, never the string "true"; an array epg is ignored.
  const stringy = checkOutput("liveCategories", { playlist: { url: "https://cdn.example.com/l.m3u", format: "m3u", resolve: "true", epg: [] } }, m);
  assert.deepEqual(stringy.value.playlists.map((p) => [p.resolve, p.epgUrl]), [[false, ""]]);
});

test("checkOutput reads a playlist's streamHeaders as the app does: filtered like a Stream's headers, apart from headers", () => {
  const m = { ...JSON.parse(manifest({ apiVersion: 3, hosts: ["cdn.example.com"] })), capabilities: ["home", "resolve", "channels"] };
  const withHeaders = checkOutput("liveCategories", { playlist: {
    url: "https://cdn.example.com/l.m3u", format: "m3u", headers: { Authorization: "Bearer T" },
    streamHeaders: { "User-Agent": "VLC/3.0.20", Referer: "https://cdn.example.com/", Host: "evil", "X-Bad": "a\nb" },
  } }, m);
  const playlist = withHeaders.value.playlists[0];
  assert.deepEqual(playlist.headers, { Authorization: "Bearer T" });
  assert.deepEqual(playlist.streamHeaders, { "User-Agent": "VLC/3.0.20", Referer: "https://cdn.example.com/" });
  const without = checkOutput("liveCategories", { playlist: { url: "https://cdn.example.com/l.m3u", format: "m3u" } }, m);
  assert.deepEqual(without.value.playlists[0].streamHeaders, {});
});

test("checkOutput reads genre on Home rows, live categories and playlists from the closed vocabulary", () => {
  const m = { ...JSON.parse(manifest({ apiVersion: 3, hosts: ["cdn.example.com"] })), capabilities: ["home", "resolve", "channels"] };
  const item = { id: "a", ref: "r", title: "A", kind: "movie" };
  const home = checkOutput("home", [
    { id: "r1", title: "Fútbol", genre: "Deportes", items: [item] },
    { id: "r2", title: "Otra", genre: "sports", items: [item] },
    { id: "r3", title: "Sin género", items: [item] },
  ], m);
  assert.deepEqual(home.value.map((r) => r.genre), ["deportes", null, null]);
  const cats = checkOutput("liveCategories", [
    { id: "n", title: "Noticias propias", genre: "noticias" },
    { id: "x", title: "Raro", genre: "nope" },
    { playlist: { url: "https://cdn.example.com/a.m3u", format: "m3u", genre: "infantil" } },
    { playlist: { url: "https://cdn.example.com/b.m3u", format: "m3u" } },
  ], m);
  assert.deepEqual(cats.value.categories.map((c) => c.genre), ["noticias", null]);
  assert.deepEqual(cats.value.playlists.map((p) => p.genre), ["infantil", null]);
  assert.ok(contract.genres.includes("deportes") && !contract.genres.includes("sports"));
});

test("run.mjs builds the live arguments the app sends", async () => {
  const seen = [];
  const plugin = {
    liveCategories: async (a) => { seen.push(["liveCategories", a]); return []; },
    liveChannels: async (a) => { seen.push(["liveChannels", a]); return { items: [] }; },
    guide: async (a) => { seen.push(["guide", a.channelIds, a.to - a.from]); return []; },
  };
  await call(plugin, "liveCategories", []);
  await call(plugin, "liveChannels", ["news", "p2"]);
  await call(plugin, "guide", ["c1,c2"]);
  assert.deepEqual(seen, [
    ["liveCategories", null],
    ["liveChannels", { categoryId: "news", cursor: "p2" }],
    ["guide", ["c1", "c2"], 24 * 3600 * 1000],
  ]);
});

test("liveSearch: run.mjs sends the trimmed query, checkOutput reads a page capped at the search's limit, next ignored", async () => {
  const seen = [];
  await call({ liveSearch: async (a) => { seen.push(a); return []; } }, "liveSearch", ["  caracol "]);
  assert.deepEqual(seen, [{ query: "caracol" }]);
  const m = { apiVersion: 3, capabilities: ["home", "resolve", "channels"], hosts: ["cdn.example.com"] };
  const many = Array.from({ length: contract.live.maxSearchChannels + 5 }, (_, i) => ({ id: `c${i}`, title: `C${i}`, ref: `r${i}` }));
  const out = checkOutput("liveSearch", { items: many, next: "more" }, m);
  assert.equal(out.value.items.length, contract.live.maxSearchChannels);
  assert.equal(out.value.next, undefined);
  assert.ok(out.drops.some((d) => d.includes("liveSearch: beyond")));
  assert.ok(contract.capabilities.optionalExports.channels.includes("liveSearch"));
});

test("liveSearch hits are 18+ like the app: own mark, category, or unmarked in a plugin with 18+ categories", () => {
  const m = { apiVersion: 6, capabilities: ["home", "resolve", "channels"], hosts: ["cdn.example.com"] };
  const hits = checkOutput("liveSearch", [
    { id: "s1", title: "Rojo uno", ref: "r1" },
    { id: "s2", title: "Rojo dos", ref: "r2", categoryId: "n" },
    { id: "s3", title: "Rojo tres", ref: "r3", adult: false },
    { id: "s4", title: "Rojo cuatro", ref: "r4", categoryId: "zz" },
    { id: "s5", title: "Rojo cinco", ref: "r5", categoryId: "x" },
  ], m).value;
  const adultOf = (r) => r.value.items.map((h) => [h.id, h.adult === true]);
  const both = [{ id: "x", title: "18+", adult: true }, { id: "n", title: "Noticias" }];
  const marked = markSearchHits(hits, both, m);
  assert.deepEqual(adultOf(marked), [["s1", true], ["s2", false], ["s3", false], ["s4", true], ["s5", true]]);
  assert.deepEqual(marked.unmarked, ["Rojo uno", "Rojo cuatro"]);
  // No 18+ category: nothing changes.
  assert.deepEqual(adultOf(markSearchHits(hits, [{ id: "n", title: "Noticias" }], m)).filter(([, a]) => a), []);
  // Categories unreadable: only adult:false stays plain (locked, Kino fails closed).
  const unknown = markSearchHits(hits, null, m);
  assert.deepEqual(adultOf(unknown).filter(([, a]) => !a).map(([id]) => id), ["s3"]);
  assert.equal(unknown.unreadable, true);
  // Below apiVersion 6 nothing is 18+.
  assert.deepEqual(adultOf(markSearchHits(hits, both, { ...m, apiVersion: 5 })).filter(([, a]) => a), []);
});

test("validate --run liveSearch warns when a plugin with 18+ categories answers unmarked hits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-live-search-adult-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, hosts: ["cdn.example.com"], capabilities: ["home", "resolve", "channels"] }));
    const entry = (hits) => "export async function home(){ return [] }\nexport async function resolve(){ return { url: 'https://cdn.example.com/a.m3u8' } }\n"
      + "export async function liveCategories(){ return [{ id: 'x', title: '18+', adult: true }, { id: 'n', title: 'Noticias' }] }\n"
      + `export async function liveChannels(){ return [] }\nexport async function liveSearch(){ return ${JSON.stringify(hits)} }`;
    writeFileSync(join(dir, "plugin.js"), entry([{ id: "s1", title: "Rojo uno", ref: "r1" }, { id: "s2", title: "Rojo dos", ref: "r2", categoryId: "n" }]));
    const r = await validate(dir, { run: "liveSearch", args: ["rojo"] });
    assert.deepEqual(r.problems, []);
    assert.ok(r.notes.some((n) => n.includes("liveSearch") && n.includes("Rojo uno") && n.includes("categoryId")), r.notes.join("\n"));
    assert.equal(r.output.items.find((h) => h.id === "s1").adult, true);
    writeFileSync(join(dir, "plugin.js"), entry([{ id: "s1", title: "Rojo uno", ref: "r1", adult: false }, { id: "s2", title: "Rojo dos", ref: "r2", categoryId: "n" }]));
    const clean = await validate(dir, { run: "liveSearch", args: ["rojo"] });
    assert.ok(!clean.notes.some((n) => n.includes("liveSearch")), clean.notes.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("subtitles: declared alone it skips resolve and search/home; any other mix keeps the old rules", () => {
  assert.equal(validateManifest(manifest({ capabilities: ["subtitles"] })).ok, true);
  assert.equal(validateManifest(manifest({ capabilities: ["home", "resolve", "subtitles"] })).ok, true);
  assert.equal(validateManifest(manifest({ apiVersion: 2, capabilities: ["subtitles", "download"] })).message, 'The plugin must declare "resolve"');
  assert.equal(validateManifest(manifest({ capabilities: ["subtitles", "resolve"] })).message, 'The plugin must declare "search" or "home"');
  assert.deepEqual(contract.capabilities.anyPluginExports, ["subtitles"]);
  assert.equal(contract.timeoutsMs.subtitles, 10000);
});

test("subtitles: run.mjs builds the app's argument, checkOutput keeps what the app keeps", async () => {
  process.env.KINO_LANGS = "es,en";
  assert.deepEqual(subtitlesArg(["tt0133093"]), { kind: "movie", languages: ["es", "en"], imdbId: "tt0133093" });
  assert.deepEqual(subtitlesArg(["tmdb:1396", "1", "2"]), { kind: "series", languages: ["es", "en"], tmdbId: 1396, season: 1, episode: 2 });
  assert.throws(() => subtitlesArg(["matrix"]));
  const seen = [];
  await call({ subtitles: async (a) => { seen.push(a); return []; } }, "subtitles", ["tt0133093"]);
  assert.equal(seen[0].imdbId, "tt0133093");
  const m = validateManifest(manifest({ capabilities: ["subtitles"] })).manifest;
  const many = Array.from({ length: contract.output.maxSubtitles + 3 }, (_, i) => ({ lang: "es", url: `https://example.com/${i}.srt` }));
  const out = checkOutput("subtitles", [
    { lang: "es", url: "https://example.com/a.srt", format: "srt", label: "x".repeat(80), translated: true },
    { lang: "es", url: "https://example.com/a.srt" },
    { lang: "en", url: "https://elsewhere.org/b.srt" },
    { lang: "", url: "https://example.com/c.vtt", format: "ass" },
  ], m);
  assert.deepEqual(out.value, [
    { lang: "es", url: "https://example.com/a.srt", format: "srt", label: "x".repeat(contract.output.maxSubtitleLabelChars), translated: true },
    { lang: "und", url: "https://example.com/c.vtt" },
  ]);
  assert.ok(out.drops.some((d) => d.includes("elsewhere.org")));
  assert.equal(checkOutput("subtitles", many, m).value.length, contract.output.maxSubtitles);
  // streamHosts "any" (apiVersion 4): side tracks on any public host, never a local one.
  const anyHost = validateManifest(manifest({ apiVersion: 4, capabilities: ["subtitles"], streamHosts: "any" })).manifest;
  assert.equal(checkOutput("subtitles", [{ lang: "es", url: "https://elsewhere.org/b.srt" }, { lang: "es", url: "http://192.168.1.2/x.srt" }], anyHost).value.length, 1);
  assert.deepEqual(consentLines(anyHost).map((l) => l.text), ["Agrega subtítulos a tus películas y series", "Puede traer subtítulos desde cualquier servidor que indique"]);
});

test("liveStreamHosts any is read only on v3, and needs channels there", () => {
  const caps = ["home", "resolve", "channels"];
  assert.equal(validateManifest(manifest({ apiVersion: 3, capabilities: caps, liveStreamHosts: "any" })).manifest.liveStreamHostsAny, true);
  // v1/v2 ignore it like any unknown field: never refused, never honoured.
  for (const apiVersion of [1, 2]) for (const v of ["any", "x", true]) {
    assert.equal(validateManifest(manifest({ apiVersion, liveStreamHosts: v })).manifest.liveStreamHostsAny, false);
  }
  assert.deepEqual(validateManifest(manifest({ apiVersion: 3, liveStreamHosts: "any" })), { ok: false, field: "liveStreamHosts", message: '"liveStreamHosts" needs the "channels" capability' });
  assert.deepEqual(validateManifest(manifest({ apiVersion: 3, capabilities: caps, liveStreamHosts: "x" })), { ok: false, field: "liveStreamHosts", message: 'The "liveStreamHosts" field only takes "any"' });
  assert.equal(validateManifest(manifest({ apiVersion: 3, capabilities: caps })).manifest.liveStreamHostsAny, false);
  assert.deepEqual(contract.manifest.liveStreamHosts, { value: "any", apiVersion: 3, requires: "channels" });
});

test("meta: apiVersion 6, exports meta, no consent line", () => {
  const ok = validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "resolve", "meta"] }));
  assert.equal(ok.ok, true);
  assert.equal(validateManifest(manifest({ apiVersion: 5, capabilities: ["home", "resolve", "meta"] })).ok, false);
  assert.equal(contract.capabilities.apiVersions.meta, 6);
  assert.ok(!contract.capabilities.declarative.includes("meta"));
  assert.ok(!contract.capabilities.needsApproval.includes("meta"));
});

test("categories: an optional list of known ids at every apiVersion, no repeats", () => {
  assert.deepEqual(validateManifest(manifest()).manifest.categories, []);
  for (const apiVersion of [1, 6]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion, categories: ["live", "radio"] })).manifest.categories, ["live", "radio"]);
  }
  for (const value of [["movies", "movies"], ["películas"], "live", [1]]) {
    assert.deepEqual(validateManifest(manifest({ categories: value })), { ok: false, field: "categories", message: contract.manifest.categories.message });
  }
});

test("discoverable: an optional boolean at every apiVersion; false is a note, not a problem", async () => {
  assert.equal(validateManifest(manifest()).manifest.discoverable, true);
  for (const apiVersion of [1, 2, 3]) {
    assert.equal(validateManifest(manifest({ apiVersion, discoverable: false })).manifest.discoverable, false);
  }
  for (const value of ["no", 0, null, []]) {
    assert.deepEqual(validateManifest(manifest({ discoverable: value })), { ok: false, field: "discoverable", message: 'The "discoverable" field must be true or false' });
  }
  assert.deepEqual(contract.discovery, { topic: "kino-plugin", maxResults: 100 });
  assert.deepEqual(contract.manifest.discoverable, { default: true });
  const dir = mkdtempSync(join(tmpdir(), "kino-discoverable-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest());
    assert.deepEqual((await validate(dir)).notes, []);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ discoverable: false }));
    const r = await validate(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.notes, ["No aparecerá en la búsqueda de Kino"]);
    const cli = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(cli.status, 0);
    assert.match(cli.stderr, /No aparecerá en la búsqueda de Kino/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A shape-valid (but not cryptographically meaningful) v1 seal: 61 zero bytes, the minimum length
// (32-byte ephemeral pubkey + 12-byte nonce + 16-byte GCM tag + 1 plaintext byte), base64url-encoded.
// isWellFormed only checks shape, never opens the seal, so this is enough to exercise the manifest rules.
const FAKE_SEAL = "kino-sealed:v1:" + Buffer.alloc(61).toString("base64url");

test("secrets: parsed with apiVersion 4, ignored below it, and its Spanish messages", () => {
  const secrets = { apiKey: FAKE_SEAL };

  const ok = validateManifest(manifest({ apiVersion: 4, secrets }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.secrets, secrets);

  for (const apiVersion of [1, 2, 3]) {
    const ignored = validateManifest(manifest({ apiVersion, secrets }));
    assert.equal(ignored.ok, true);
    assert.deepEqual(ignored.manifest.secrets, {});
  }

  assert.deepEqual(validateManifest(manifest({ apiVersion: 4, secrets: [] })),
    { ok: false, field: "secrets", message: 'The "secrets" field must be an object' });

  const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s${i}`, FAKE_SEAL]));
  assert.deepEqual(validateManifest(manifest({ apiVersion: 4, secrets: many })),
    { ok: false, field: "secrets", message: 'The "secrets" field takes up to 16 secrets' });

  assert.deepEqual(validateManifest(manifest({ apiVersion: 4, secrets: { "2x": FAKE_SEAL } })),
    { ok: false, field: "secrets", message: 'The secret "2x" has an invalid name' });

  for (const badSeal of ["kino-sealed:v2:" + FAKE_SEAL.slice("kino-sealed:v1:".length), "kino-sealed:v1:@@@@", "kino-sealed:v1:AAAA"]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 4, secrets: { apiKey: badSeal } })),
      { ok: false, field: "secrets", message: 'The secret "apiKey" is not a valid Kino seal' });
  }

  assert.deepEqual(contract.manifest.secrets, {
    apiVersion: 4, namePattern: "^[A-Za-z][A-Za-z0-9_]{0,31}$", maxSecrets: 16, maxValueBytes: 4096, prefix: "kino-sealed:v1:",
    largeApiVersion: 6, largeMaxValueBytes: 8192,
    typed: { apiVersion: 6, uses: ["cipher-key"], keyEncodings: ["hex", "base64"], keyBytes: [16, 24, 32] },
  });
});

test("migrate: a consent line, and an update that adds it re-asks like any new reach", () => {
  assert.deepEqual(contract.capabilities.needsApproval, ["download", "drm", "channels", "migrate", "tracking"]);
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 6, capabilities: ["search", "resolve", "migrate"] })).manifest),
    [{ text: "Revisar lo que tienes guardado (biblioteca, historial, favoritos) para pasarlo a este plugin", danger: false }]);
});

test("secrets: a consent line, and validate notes it can't check the repo binding here", async () => {
  const secrets = { apiKey: FAKE_SEAL };
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 4, secrets })).manifest),
    [{ text: "Usa datos sellados por su autor", danger: false }]);
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 4 })).manifest), []);

  const dir = mkdtempSync(join(tmpdir(), "kino-secrets-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 4, secrets }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    const r = await validate(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.consent, [{ text: "Usa datos sellados por su autor", danger: false }]);
    assert.deepEqual(r.notes, ["Which repository the secrets were sealed for can't be checked here: Kino checks it at install. They also only open when the person installs the plugin from its default branch, without @branch. And from a manifest URL (kino-plugin.json outside GitHub) Kino refuses the plugin: seals belong to a repository."]);
    const cli = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(cli.status, 0);
    assert.match(cli.stderr, /Which repository the secrets were sealed for can't be checked here/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run reads .kino-secrets.json next to the manifest, like run.mjs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-validate-secrets-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 4, hosts: ["api.example.com"], secrets: { apiKey: FAKE_SEAL } }));
    writeFileSync(join(dir, "plugin.js"),
      "export async function search(){ const r = await kino.fetch('https://api.example.com/s', { headers: { 'X-Api-Key': kino.secret('apiKey') } }); return { items: [{ id: '1', title: r.text() }] } }\n" +
      "export async function resolve(){ return { url: 'https://api.example.com/a.m3u8' } }");
    writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify({ apiKey: "k-777" }));
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push(init.headers["X-Api-Key"]); return new Response("hola", { headers: { "content-type": "text/plain" } }); };
    const r = await validate(dir, { run: "search", args: ["q"], fetchImpl });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.deepEqual(seen, ["k-777"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- seal.mjs: the v1 sealer (spec §3, §6) ----------

const SEAL_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function testKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(SEAL_SPKI_PREFIX.length).toString("hex");
  return { privateKey, publicKeyHex };
}

/**
 * Opens a seal.mjs seal with a locally generated test keypair: an independent check that the kit's
 * own X25519/HKDF/AES-256-GCM round-trips, without needing Kotlin. The cross-language fixture
 * (app/src/test/resources/plugin/sealed/fixture.json) is what proves the app opens it too.
 */
function openSealed(sealed, binding, name, privateKey, publicKeyHex) {
  assert.equal(sealed.slice(0, contract.manifest.secrets.prefix.length), contract.manifest.secrets.prefix);
  const raw = Buffer.from(sealed.slice(contract.manifest.secrets.prefix.length), "base64url");
  const ephPubRaw = raw.subarray(0, 32);
  const nonce = raw.subarray(32, 44);
  const ct = raw.subarray(44, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const ephPub = createPublicKey({ key: Buffer.concat([SEAL_SPKI_PREFIX, ephPubRaw]), format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey, publicKey: ephPub });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephPubRaw, Buffer.from(publicKeyHex, "hex")]), "kino-sealed:v1", 32));
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(`kino-sealed:v1|${binding}|${name}`, "utf8"));
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

test("seal(): format, length, and it opens to the plain value for the right binding and name only", () => {
  const { privateKey, publicKeyHex } = testKeypair();
  const sealed = seal("s3cr3t-válue", "Owner/Repo", "apiKey", publicKeyHex);
  assert.match(sealed, /^kino-sealed:v1:[A-Za-z0-9_-]+$/);
  const raw = Buffer.from(sealed.slice("kino-sealed:v1:".length), "base64url");
  assert.equal(raw.length, 32 + 12 + Buffer.byteLength("s3cr3t-válue", "utf8") + 16);
  assert.equal(openSealed(sealed, "owner/repo", "apiKey", privateKey, publicKeyHex), "s3cr3t-válue");
  assert.throws(() => openSealed(sealed, "owner/other", "apiKey", privateKey, publicKeyHex));
  assert.throws(() => openSealed(sealed, "owner/repo", "otherName", privateKey, publicKeyHex));
  // Two seals of the same value differ: a fresh ephemeral key and nonce each time.
  assert.notEqual(seal("s3cr3t-válue", "Owner/Repo", "apiKey", publicKeyHex), sealed);
});

test("seal(): the binding is the app's owner/repo[/path], lowercased; .git and a trailing / dropped", () => {
  const { privateKey, publicKeyHex } = testKeypair();
  assert.equal(normalizeBinding("Owner/Repo"), "owner/repo");
  assert.equal(normalizeBinding("  Owner/Repo/Sub/Dir/ "), "owner/repo/sub/dir");
  assert.equal(normalizeBinding("owner/repo.git"), "owner/repo");
  assert.equal(normalizeBinding("owner/repo.git/"), "owner/repo");
  assert.equal(normalizeBinding("my-org/my.repo_1/plugins/x-y"), "my-org/my.repo_1/plugins/x-y");
  const sealed = seal("x", "Owner/Repo.git/", "n", publicKeyHex);
  assert.equal(openSealed(sealed, "owner/repo", "n", privateKey, publicKeyHex), "x");
});

test("seal(): --repo refuses a URL, an @ref, and anything the app's PluginAddress wouldn't accept", () => {
  const { publicKeyHex } = testKeypair();
  const url = /not a URL \(for https:\/\/github\.com\/owner\/repo use --repo owner\/repo\)/;
  for (const bad of ["https://github.com/owner/repo", "http://github.com/owner/repo", "github.com/owner/repo", "www.github.com/owner/repo", "git://example.com/o/r"]) {
    assert.throws(() => normalizeBinding(bad), url, bad);
  }
  for (const bad of ["owner/repo@main", "owner/repo/sub@v2", "owner/repo@0123abc"]) {
    assert.throws(() => normalizeBinding(bad), /without an @ref/, bad);
  }
  for (const bad of ["", "owner", "owner/", "-owner/repo", "o_wner/repo", "a".repeat(40) + "/repo", "owner/..", "owner/.", "owner/.git", "owner/re po", "owner/repo/../x", "owner/repo//x", "owner/" + "r".repeat(101)]) {
    assert.throws(() => normalizeBinding(bad), /invalid --repo: expected "owner\/repo" or "owner\/repo\/path"/, bad);
  }
  assert.throws(() => seal("x", "owner/repo@main", "n", publicKeyHex), /without an @ref/);
  // The CLI refuses before it even asks for the value.
  const r = spawnSync(process.execPath, [join(here, "..", "seal.mjs"), "--repo", "https://github.com/o/r", "--name", "n"], { input: "v\n", encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, url);
  assert.equal(r.stdout, "");
});

test("seal(): 1..8192 UTF-8 bytes seal; validate takes up to 4096 at apiVersion 4 and 5, and 8192 from 6", () => {
  const { privateKey, publicKeyHex } = testKeypair();
  for (const v of ["x", "x".repeat(4096), "ñ".repeat(2048), "x".repeat(8192)]) {
    const s = seal(v, "o/r", "n", publicKeyHex);
    assert.equal(openSealed(s, "o/r", "n", privateKey, publicKeyHex), v);
    assert.equal(validateManifest(manifest({ apiVersion: 6, secrets: { n: s } })).ok, true);
  }
  for (const v of ["", "x".repeat(8193), "ñ".repeat(4096) + "x"]) assert.throws(() => seal(v, "o/r", "n", publicKeyHex), /1\.\.8192 bytes/);
  // A seal's raw bytes: 60 bytes of overhead plus the value's.
  const rawSeal = (n) => contract.manifest.secrets.prefix + Buffer.alloc(n, 7).toString("base64url");
  for (const [api, n, ok] of [[4, 60, false], [4, 61, true], [4, 60 + 4096, true], [4, 60 + 4097, false], [5, 60 + 4096, true], [5, 60 + 4097, false], [6, 60 + 4097, true], [6, 60 + 8192, true], [6, 60 + 8193, false]]) {
    assert.equal(validateManifest(manifest({ apiVersion: api, secrets: { n: rawSeal(n) } })).ok, ok, `${api}/${n}`);
  }
});

test("secrets: typed cipher keys from apiVersion 6, with the app's Spanish messages", () => {
  const typed = (o = {}) => ({ seal: FAKE_SEAL, use: "cipher-key", encoding: "hex", ...o });
  const ok = validateManifest(manifest({ apiVersion: 6, secrets: { desKey: typed(), aesKey: typed({ encoding: "base64" }), token: FAKE_SEAL } }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.secrets, { desKey: FAKE_SEAL, aesKey: FAKE_SEAL, token: FAKE_SEAL });
  assert.deepEqual(ok.manifest.secretKeyEncodings, { desKey: "hex", aesKey: "base64" });

  const bad = (secrets, api = 6) => validateManifest(manifest({ apiVersion: api, secrets }));
  const msg = (message) => ({ ok: false, field: "secrets", message });
  assert.deepEqual(bad({ desKey: typed() }, 4), msg('The secret "desKey" is not a valid Kino seal'));
  for (const use of [undefined, "key", "CIPHER-KEY", 1, null]) assert.deepEqual(bad({ desKey: typed({ use }) }), msg('The secret "desKey" only takes "use": "cipher-key"'), String(use));
  for (const encoding of [undefined, "utf8", "HEX", "base64url", 1, null]) assert.deepEqual(bad({ desKey: typed({ encoding }) }), msg('The secret "desKey" must have "encoding": "hex" or "base64"'), String(encoding));
  assert.deepEqual(bad({ desKey: typed({ alg: "des-ede3-ecb" }) }), msg('The secret "desKey" has an unknown field: "alg"'));
  assert.deepEqual(bad({ desKey: typed({ ["x".repeat(60)]: 1 }) }), msg(`The secret "desKey" has an unknown field: "${"x".repeat(40)}"`));
  // With several unknown fields the lexicographically smallest is named, like the app.
  assert.deepEqual(bad({ desKey: typed({ zeta: 1, alg: 2 }) }), msg('The secret "desKey" has an unknown field: "alg"'));
  for (const s of [undefined, 42, "kino-sealed:v1:@@@"]) assert.deepEqual(bad({ desKey: typed({ seal: s }) }), msg('The secret "desKey" is not a valid Kino seal'), String(s));
  for (const v of [[], 7]) assert.deepEqual(bad({ desKey: v }), msg('The secret "desKey" is not a valid Kino seal'));
});

test("seal.mjs: sealTyped checks the key size under its encoding and emits the typed object", () => {
  const { privateKey, publicKeyHex } = testKeypair();
  const hex24 = "0123456789abcdef23456789abcdef01456789abcdef0123";
  const t = sealTyped(hex24, "o/r", "desKey", "hex", publicKeyHex);
  assert.deepEqual(Object.keys(t), ["seal", "use", "encoding"]);
  assert.equal(t.use, "cipher-key");
  assert.equal(t.encoding, "hex");
  assert.equal(openSealed(t.seal, "o/r", "desKey", privateKey, publicKeyHex), hex24);
  assert.equal(validateManifest(manifest({ apiVersion: 6, secrets: { desKey: t } })).ok, true);
  assert.equal(sealTyped("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "o/r", "aesKey", "base64", publicKeyHex).encoding, "base64");
  for (const [v, enc] of [["00".repeat(20), "hex"], ["zz".repeat(24), "hex"], ["0".repeat(47), "hex"], ["@@@@", "base64"]]) {
    assert.throws(() => sealTyped(v, "o/r", "k", enc, publicKeyHex), /16, 24 or 32 bytes/);
  }
  assert.throws(() => sealTyped(hex24, "o/r", "k", "utf8", publicKeyHex), /invalid --encoding/);
  assert.equal(decodeCipherKey(hex24.toUpperCase(), "hex").length, 24);
  assert.equal(decodeCipherKey("00".repeat(20), "hex"), null);
});

// The same vectors as the app's SealedSecretsV5Test: what one accepts, the other does.
test("decodeCipherKey matches the app: base64 padding, url-safe and whitespace; degenerate triple-DES keys refused", () => {
  const padded = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
  for (const ok of [padded, padded.replace(/=+$/, ""), " AAECAwQFBgcICQoL\nDA0ODxAREhMUFRYXGBkaGxwdHh8=\t", "-_-_" + padded.slice(4)]) {
    assert.equal(decodeCipherKey(ok, "base64")?.length, 32, ok);
  }
  for (const bad of [padded + "=", padded + "==", "AAECAwQFBgcICQoLDA0ODx=AREhMUFRYXGBkaGxwdHh8", "A" + padded.replace(/=+$/, ""), "AAE*AwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="]) {
    assert.equal(decodeCipherKey(bad, "base64"), null, bad);
  }
  const k1 = "0123456789abcdef", k2 = "fedcba9876543210", k3 = "89abcdef01234567";
  for (const bad of [k1 + k1 + k3, k1 + k2 + k2, k1 + "0023456789abcdef" + k3, "00".repeat(24)]) assert.equal(decodeCipherKey(bad, "hex"), null, bad);
  assert.equal(decodeCipherKey(k1 + k2 + k1, "hex").length, 24);
});

test("seal.mjs's CLI: --use cipher-key --encoding hex prints the typed object; bad flag combinations exit 2", () => {
  const { publicKeyHex } = testKeypair();
  const script = join(here, "..", "seal.mjs");
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8", env: { ...process.env, KINO_SEAL_PUBLIC_KEY: publicKeyHex } });
  const ok = run(["--repo", "o/r", "--name", "desKey", "--use", "cipher-key", "--encoding", "hex"], "0123456789abcdef23456789abcdef01456789abcdef0123\n");
  assert.equal(ok.status, 0, ok.stderr);
  const printed = JSON.parse(ok.stdout.trim());
  assert.equal(printed.use, "cipher-key");
  assert.equal(printed.encoding, "hex");
  assert.ok(printed.seal.startsWith("kino-sealed:v1:"));
  assert.equal(run(["--repo", "o/r", "--name", "k", "--use", "key", "--encoding", "hex"], "00\n").status, 2);
  assert.equal(run(["--repo", "o/r", "--name", "k", "--use", "cipher-key"], "00\n").status, 2);
  assert.equal(run(["--repo", "o/r", "--name", "k", "--encoding", "hex"], "00\n").status, 2);
  const wrongSize = run(["--repo", "o/r", "--name", "k", "--use", "cipher-key", "--encoding", "hex"], "0011\n");
  assert.equal(wrongSize.status, 1);
  assert.match(wrongSize.stderr, /16, 24 or 32 bytes/);
  assert.equal(wrongSize.stdout, "");
});

test("validate: a typed secret whose .kino-secrets.json value isn't a key of the right size is a problem", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-typed-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, secrets: { desKey: { seal: FAKE_SEAL, use: "cipher-key", encoding: "hex" } } }));
  writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return null }\n");
  writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify({ desKey: "00".repeat(20) }));
  const r = await validate(dir);
  assert.ok(r.problems.some((p) => p === 'secret "desKey" in .kino-secrets.json is not a 16, 24 or 32-byte key in hex'), JSON.stringify(r.problems));
  writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify({ desKey: "0123456789abcdef23456789abcdef01456789abcdef0123" }));
  assert.ok(!(await validate(dir)).problems.some((p) => p.includes("desKey")));
});

// The hidden prompt reads a raw-mode TTY, where a paste (and a fast typist) arrives as ONE chunk.
test("seal.mjs's hidden prompt: a line ends at the first Enter inside any chunk, with editing keys applied", async () => {
  const { hiddenLineReader } = await import("../seal.mjs");
  const feed = (...chunks) => {
    const r = hiddenLineReader();
    let last;
    for (const c of chunks) last = r.feed(c);
    return last;
  };
  assert.deepEqual(feed("abc\r"), { done: true, value: "abc" });
  assert.deepEqual(feed("ab", "c\r"), { done: true, value: "abc" });
  assert.deepEqual(feed("a", "b", "c", "\r"), { done: true, value: "abc" });
  assert.deepEqual(feed("abc\n"), { done: true, value: "abc" });
  assert.deepEqual(feed("abc\r\n"), { done: true, value: "abc" });
  assert.deepEqual(feed("abc\rdef\r"), { done: true, value: "abc" });
  assert.deepEqual(feed("x\u007f\r"), { done: true, value: "" });
  assert.deepEqual(feed("xy\u007fz\r"), { done: true, value: "xz" });
  assert.deepEqual(feed("xy\bz\r"), { done: true, value: "xz" });
  assert.deepEqual(feed("\u007f\u007fa\r"), { done: true, value: "a" });
  assert.deepEqual(feed("ñ😀\u007f\r"), { done: true, value: "ñ" });
  assert.deepEqual(feed("old\u0015new\r"), { done: true, value: "new" });
  assert.deepEqual(feed("a\u001b[Db\u001bOAc\r"), { done: true, value: "abc" });
  assert.deepEqual(feed("a\tb\u0001\r"), { done: true, value: "a\tb" });
  assert.deepEqual(feed("abc\u0003\r"), { done: true, cancelled: true });
  assert.deepEqual(feed("\u0004"), { done: true, cancelled: true });
  assert.deepEqual(feed("abc\u0004"), { done: true, value: "abc" });
  assert.deepEqual(feed("abc"), { done: false });
  // Once over, later chunks change nothing.
  const r = hiddenLineReader();
  r.feed("abc\r");
  assert.deepEqual(r.feed("more\r"), { done: true, value: "abc" });
});

// The real thing on a real pseudo-terminal (Python's pty module drives it): the value is typed as
// ONE write -- what a paste delivers -- and must come back sealed without its Enter, never echoed.
const hasPython = spawnSync("python3", ["-c", "import pty"], { encoding: "utf8" }).status === 0;
test("seal.mjs's CLI on a TTY: a pasted value with its Enter seals the value alone, echoing nothing", { skip: !hasPython && "python3 with pty not available" }, () => {
  const driver = [
    "import os, pty, sys, time, select, signal",
    "typed = sys.argv[1].encode()",
    "pid, fd = pty.fork()",
    "if pid == 0:",
    "    os.execvp(sys.argv[2], sys.argv[2:])",
    "out, sent, deadline = b'', False, time.time() + 10",
    "while time.time() < deadline:",
    "    r, _, _ = select.select([fd], [], [], 0.1)",
    "    if r:",
    "        try:",
    "            chunk = os.read(fd, 4096)",
    "        except OSError:",
    "            break",
    "        if not chunk:",
    "            break",
    "        out += chunk",
    "    if not sent and b'Secret value' in out:",
    "        time.sleep(0.2)",
    "        os.write(fd, typed)",
    "        sent = True",
    "else:",
    "    os.kill(pid, signal.SIGKILL)",
    "_, status = os.waitpid(pid, 0)",
    "sys.stdout.write(out.decode('utf-8', 'replace'))",
  ].join("\n");
  const { privateKey, publicKeyHex } = testKeypair();
  const r = spawnSync("python3", ["-c", driver, "p4ss-wörd\r", process.execPath, join(here, "..", "seal.mjs"), "--repo", "o/r", "--name", "n"], {
    encoding: "utf8", env: { ...process.env, KINO_SEAL_PUBLIC_KEY: publicKeyHex },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes("p4ss"), r.stdout);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("kino-sealed:v1:"));
  assert.ok(line, r.stdout);
  assert.equal(openSealed(line.trim(), "o/r", "n", privateKey, publicKeyHex), "p4ss-wörd");
});

test("seal(): rejects a bad name, a missing repo, and an out-of-range value", () => {
  const { publicKeyHex } = testKeypair();
  assert.throws(() => seal("x", "o/r", "2bad", publicKeyHex));
  assert.throws(() => seal("x", "not-a-repo", "n", publicKeyHex));
  assert.throws(() => seal("", "o/r", "n", publicKeyHex));
  assert.throws(() => seal("x".repeat(8193), "o/r", "n", publicKeyHex));
  assert.doesNotThrow(() => seal("x".repeat(8192), "o/r", "n", publicKeyHex));
});

test("seal.mjs's CLI reads the value from stdin, never argv, and prints one line", () => {
  const sealPath = join(here, "..", "seal.mjs");
  const r = spawnSync(process.execPath, [sealPath, "--repo", "owner/repo", "--name", "apiKey", "this-looks-like-a-value-but-is-argv"], { input: "from-stdin\n", encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^kino-sealed:v1:/);
  const { privateKey, publicKeyHex } = testKeypair();
  const r2 = spawnSync(process.execPath, [sealPath, "--repo", "owner/repo", "--name", "apiKey"], { input: "from-stdin\n", encoding: "utf8", env: { ...process.env, KINO_SEAL_PUBLIC_KEY: publicKeyHex } });
  assert.equal(r2.status, 0, r2.stderr);
  // Proves it sealed stdin's value, not the trailing argv text.
  assert.equal(openSealed(r2.stdout.trim(), "owner/repo", "apiKey", privateKey, publicKeyHex), "from-stdin");
});

test("seal.mjs's CLI honours KINO_SEAL_PUBLIC_KEY (tests only) instead of the embedded production key, and warns that it does", () => {
  const { privateKey, publicKeyHex } = testKeypair();
  const r = spawnSync(process.execPath, [join(here, "..", "seal.mjs"), "--repo", "o/r", "--name", "n"], { input: "v\n", encoding: "utf8", env: { ...process.env, KINO_SEAL_PUBLIC_KEY: publicKeyHex } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(openSealed(r.stdout.trim(), "o/r", "n", privateKey, publicKeyHex), "v");
  assert.match(r.stderr, /warning: KINO_SEAL_PUBLIC_KEY replaces Kino's own public key -- this seal will NOT open in Kino \(tests only\)/);
  // Without it: no warning.
  const env = { ...process.env };
  delete env.KINO_SEAL_PUBLIC_KEY;
  const plain = spawnSync(process.execPath, [join(here, "..", "seal.mjs"), "--repo", "o/r", "--name", "n"], { input: "v\n", encoding: "utf8", env });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stderr, "");
});

// ---------- kino.secret and the kit's simulation of substitution/redaction (spec §5, §6) ----------

function withSecretsFile(values) {
  const dir = mkdtempSync(join(tmpdir(), "kino-secrets-file-"));
  writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify(values));
  return { dir, file: join(dir, ".kino-secrets.json") };
}

/** A manifest object with `secrets` declared for each key of [plainValues], and its `.kino-secrets.json`. */
function sealedKino(plainValues, extra = {}) {
  const { dir, file } = withSecretsFile(plainValues);
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: Object.fromEntries(Object.keys(plainValues).map((k) => [k, "x"])), ...extra }));
  const { kino } = createKino(m, { secretsFile: file, fetchImpl: () => { throw new Error("must not reach the network"); } });
  return { kino, dir };
}

test("kino.secret: a marker per declared name, and an undeclared name throws the app's message", () => {
  const { kino } = sealedKino({ apiKey: "k-123" });
  const marker = kino.secret("apiKey");
  assert.match(marker, /^__kinoSecret_apiKey_[0-9a-f]{16}__$/);
  assert.throws(() => kino.secret("other"), (e) => e.message === "this plugin doesn't declare the secret other" && e.code === "not_allowed");
  // Survives concatenation, JSON.stringify and encodeURIComponent unchanged.
  assert.ok((marker + "x").includes(marker));
  assert.ok(JSON.stringify({ k: marker }).includes(marker));
  assert.equal(encodeURIComponent(marker), marker);
});

test("kino.storage over its cap throws the app's too_large, and keeps what was there", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-storage-"));
  try {
    const { kino } = createKino(JSON.parse(manifest()), { storageFile: join(dir, "storage.json") });
    kino.storage.set("small", "v");
    assert.throws(
      () => kino.storage.set("big", "x".repeat(contract.storage.maxTotalBytes)),
      (e) => e.code === "too_large" && e.message === `plugin storage full (${contract.storage.maxTotalBytes / 1024} KB)`,
    );
    assert.equal(kino.storage.get("big"), null);
    assert.equal(kino.storage.get("small"), "v");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kino.secret: a manifest with no secrets refuses every name", () => {
  const { kino } = createKino(JSON.parse(manifest()));
  assert.throws(() => kino.secret("apiKey"), (e) => e.message === "this plugin doesn't declare the secret apiKey");
});

test("kino.secret: a declared name missing from .kino-secrets.json throws only when it is actually used", async () => {
  const { file } = withSecretsFile({});
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: file, fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey"); // this alone never opens it
  await assert.rejects(
    kino.fetch("https://api.example.com/?k=" + marker),
    (e) => e.message === "the value of the secret apiKey is missing from .kino-secrets.json",
  );
});

test("kino.fetch substitutes a secret into the URL, headers and a JSON body, toward a declared host only", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: { ...init.headers }, body: init.body });
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  const r = await kino.fetch(`https://api.example.com/v1/items?api_key=${marker}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + marker },
    body: { json: { key: marker } },
  });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/v1/items?api_key=k-123");
  assert.equal(calls[0].headers.Authorization, "Bearer k-123");
  assert.equal(calls[0].body, '{"key":"k-123"}');
  // What comes back to the plugin never carries the plain value.
  assert.equal(r.url, `https://api.example.com/v1/items?api_key=${marker}`);
});

test("a secret in a form body is substituted, url-encoded like any other form value", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ body: init.body }); return new Response("ok"); };
  const { dir } = withSecretsFile({ apiKey: "a b&c" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  await kino.fetch("https://api.example.com/login", { method: "POST", body: { form: { key: marker } } });
  assert.equal(calls[0].body, "key=a%20b%26c");
});

test("a secret in a text body is substituted raw", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ body: init.body }); return new Response("ok"); };
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  await kino.fetch("https://api.example.com/x", { method: "POST", body: "key=" + marker });
  assert.equal(calls[0].body, "key=k-123");
});

test("a header carrying a secret with disallowed characters is refused, naming only the header", async () => {
  const { dir } = withSecretsFile({ apiKey: "line1\nline2" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey");
  await assert.rejects(
    kino.fetch("https://api.example.com/x", { headers: { "X-Token": marker } }),
    (e) => e.code === "invalid_request" && e.message === "header X-Token can't carry this sealed value: it has characters that aren't allowed",
  );
});

test("a request with a secret refuses an undeclared host, even one otherwise reachable", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey");
  await assert.rejects(
    kino.fetch(`https://other.example.com/x?k=${marker}`),
    (e) => e.code === "host_not_allowed" && e.message === "this plugin can't send sealed data to other.example.com" && e.host === "other.example.com",
  );
  // The very same host without the marker is refused too, but by the ordinary message.
  await assert.rejects(kino.fetch("https://other.example.com/x"), (e) => e.code === "host_not_allowed" && e.message === "host not allowed: other.example.com");
});

test("a request with a secret refuses plain http, even on a host declared insecureHttp", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const parsed = validateManifest(manifest({ apiVersion: 4, hosts: [{ host: "api.example.com", insecureHttp: true }], secrets: { apiKey: FAKE_SEAL } }));
  assert.equal(parsed.ok, true);
  const { kino } = createKino(parsed.manifest, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey");
  await assert.rejects(
    kino.fetch(`http://api.example.com/x?k=${marker}`),
    (e) => e.code === "host_not_allowed" && e.message === "this plugin can't send sealed data without https to api.example.com",
  );
});

test("a sealed request may follow a redirect within the declared hosts, and is refused off them", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/start")) return new Response("", { status: 307, headers: { Location: "https://api.example.com/landing" } });
    return new Response("ok", { status: 200 });
  };
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  const r = await kino.fetch(`https://api.example.com/start?k=${marker}`);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);

  const evil = async (url) => {
    if (String(url).includes("/start2")) return new Response("", { status: 307, headers: { Location: "https://other.example.com/landing" } });
    throw new Error("must not reach other.example.com");
  };
  const { kino: kino2 } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: evil });
  const marker2 = kino2.secret("apiKey");
  await assert.rejects(
    kino2.fetch(`https://api.example.com/start2?k=${marker2}`),
    (e) => e.code === "host_not_allowed" && e.message === "this plugin can't send sealed data to other.example.com",
  );
});

test("a secret never goes to a server the plugin's own settings point at, even though ordinary fetch would allow it", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const withServer = JSON.parse(manifest({ settings: [{ key: "server", label: "Servidor", type: "url", required: true }], secrets: { apiKey: "x" } }));
  const { kino } = createKino(withServer, { config: { server: "https://typed.example.com" }, secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey");
  await assert.rejects(
    kino.fetch(`https://typed.example.com/x?k=${marker}`),
    (e) => e.code === "host_not_allowed" && e.message === "this plugin can't send sealed data to typed.example.com",
  );
  // Without the marker, the very same typed server IS reachable (the ordinary rule).
  const calls = [];
  const { kino: kino2 } = createKino(withServer, { config: { server: "https://typed.example.com" }, secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: async (u) => { calls.push(String(u)); return new Response("ok"); } });
  await kino2.fetch("https://typed.example.com/x");
  assert.equal(calls.length, 1);
});

test("what comes back to the plugin never carries the plain value: body, url and headers show the marker", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const fetchImpl = async () => new Response(JSON.stringify({ echoed: "k-123", raw: "prefix-k-123-suffix" }), {
    status: 200, headers: { "content-type": "application/json", "x-echo": "k-123" },
  });
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  const r = await kino.fetch(`https://api.example.com/x?k=${marker}`);
  assert.ok(!r.text().includes("k-123"));
  assert.ok(r.text().includes(marker));
  assert.equal(r.headers["x-echo"], marker);
  assert.equal(r.json().echoed, marker);
});

test("a cookie value equal to an opened secret comes back as its marker", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const fetchImpl = async () => new Response("ok", { status: 200, headers: { "set-cookie": "sid=k-123; Path=/" } });
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  await kino.fetch(`https://api.example.com/login?k=${marker}`);
  assert.equal(kino.cookies.get("https://api.example.com/", "sid"), marker);
});

test("the --replay 'no recorded answer' error redacts a sealed value instead of just cutting it", async () => {
  const { dir } = withSecretsFile({ apiKey: "SUPER-SECRET-VALUE-12345" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const emptyTape = join(dir, "empty-tape.json");
  writeFileSync(emptyTape, JSON.stringify([]));
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), replay: emptyTape, fetchImpl: () => { throw new Error("must not reach the network"); } });
  const marker = kino.secret("apiKey");
  await assert.rejects(
    kino.fetch(`https://api.example.com/x?k=${marker}`),
    (e) => e.code === "network" && !e.message.includes("SUPER-SECRET-VALUE-12345") && e.message.includes(marker),
  );
});

test("--record never writes a plain secret value (or a random marker another runtime won't recognize) to the tape file, and --replay round-trips", async () => {
  const { dir } = withSecretsFile({ apiKey: "SUPER-SECRET-VALUE-12345" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const secretsFile = join(dir, ".kino-secrets.json");
  const tape = join(dir, "tape.json");
  const fetchImpl = async () => new Response(JSON.stringify({ echoed: "SUPER-SECRET-VALUE-12345" }), { status: 200, headers: { "content-type": "application/json", "x-echo": "SUPER-SECRET-VALUE-12345" } });

  const rec = createKino(m, { secretsFile, record: tape, fetchImpl });
  const recMarker = rec.kino.secret("apiKey");
  const live = await rec.kino.fetch(`https://api.example.com/v1/items?api_key=${recMarker}`, { headers: { Authorization: "Bearer " + recMarker } });
  rec.saveTape();
  assert.equal(live.json().echoed, recMarker);
  assert.equal(live.headers["x-echo"], recMarker);

  const tapeText = readFileSync(tape, "utf8");
  assert.ok(!tapeText.includes("SUPER-SECRET-VALUE-12345"), tapeText);
  assert.ok(!tapeText.includes(Buffer.from("SUPER-SECRET-VALUE-12345", "utf8").toString("base64")), tapeText);
  // Not even this runtime's own random marker (a fresh --replay process gets a different nonce).
  assert.ok(!tapeText.includes(recMarker), tapeText);
  assert.match(tapeText, /kino-secret:apiKey/);

  // A completely separate runtime (its own random nonce) replays the very same tape file offline.
  const rep = createKino(m, { secretsFile, replay: tape, fetchImpl: () => { throw new Error("replay must not touch the network"); } });
  const repMarker = rep.kino.secret("apiKey");
  assert.notEqual(repMarker, recMarker);
  const again = await rep.kino.fetch(`https://api.example.com/v1/items?api_key=${repMarker}`, { headers: { Authorization: "Bearer " + repMarker } });
  assert.equal(again.json().echoed, repMarker);
  assert.equal(again.headers["x-echo"], repMarker);
});

test("record→replay tape leaks no form of a secret with JSON/URL-tricky characters (quote, backslash, a control byte, +/=, space, non-ASCII)", async () => {
  // JSON body context: every tricky category at once.
  const jsonSecret = "My\\Pass\"word +/=\tñ";
  // Header context: the same tricky categories minus a control byte and non-ASCII (a header can't carry those).
  const headerSecret = 'Bearer "tok\\en+va/lue=x y';
  const { dir } = withSecretsFile({ jsonKey: jsonSecret, headerKey: headerSecret });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { jsonKey: "x", headerKey: "x" } }));
  const secretsFile = join(dir, ".kino-secrets.json");
  const tape = join(dir, "tape.json");
  const fetchImpl = async () => new Response(JSON.stringify({ echoedJson: jsonSecret, echoedHeader: headerSecret }), {
    status: 200, headers: { "content-type": "application/json" },
  });

  const rec = createKino(m, { secretsFile, record: tape, fetchImpl });
  const jsonMarker = rec.kino.secret("jsonKey");
  const headerMarker = rec.kino.secret("headerKey");
  const live = await rec.kino.fetch(`https://api.example.com/x?k=${headerMarker}`, {
    method: "POST",
    headers: { Authorization: headerMarker },
    body: { json: { key: jsonMarker } },
  });
  rec.saveTape();
  assert.equal(live.json().echoedJson, jsonMarker);
  assert.equal(live.json().echoedHeader, headerMarker);

  // Every form the app/kit's redaction knows, PLUS the doubly-JSON-escaped form a naive
  // "compose the key, then redact the whole string" bug produces for a value that itself needed
  // JSON escaping (this is exactly what leaked before the fix: canonicalizing after JSON.stringify
  // wrapped the body a second time, so the once-escaped echo form no longer matched anywhere).
  const jsonEscapeOnce = (s) => JSON.stringify(s).slice(1, -1);
  const formsOf = (plain) => {
    const bytes = Buffer.from(plain, "utf8");
    const once = jsonEscapeOnce(plain);
    return [plain, once, jsonEscapeOnce(once), encodeURIComponent(plain), bytes.toString("base64"), bytes.toString("base64url")];
  };
  const tapeText = readFileSync(tape, "utf8");
  for (const plain of [jsonSecret, headerSecret]) {
    for (const form of formsOf(plain)) assert.ok(!tapeText.includes(form), `tape leaked a form of a secret: ${JSON.stringify(form)}`);
  }
  // Not even this runtime's own (random-nonce) marker -- a fresh --replay process gets a different one.
  assert.ok(!tapeText.includes(jsonMarker) && !tapeText.includes(headerMarker), tapeText);
  assert.match(tapeText, /kino-secret:jsonKey/);
  assert.match(tapeText, /kino-secret:headerKey/);

  // A second, independent runtime (its own random nonce) replays the very same tape file offline.
  const rep = createKino(m, { secretsFile, replay: tape, fetchImpl: () => { throw new Error("replay must not touch the network"); } });
  const jsonMarker2 = rep.kino.secret("jsonKey");
  const headerMarker2 = rep.kino.secret("headerKey");
  assert.notEqual(jsonMarker2, jsonMarker);
  const again = await rep.kino.fetch(`https://api.example.com/x?k=${headerMarker2}`, {
    method: "POST",
    headers: { Authorization: headerMarker2 },
    body: { json: { key: jsonMarker2 } },
  });
  assert.equal(again.json().echoedJson, jsonMarker2);
  assert.equal(again.json().echoedHeader, headerMarker2);
});

test("redaction never builds a giant regex: 16 secrets of 4096 quote/backslash/non-ASCII bytes, all opened at once, redact cleanly", async () => {
  const bigTrickyValue = (i) => {
    const unit = `"\\ñ${i}`;
    let s = "";
    while (Buffer.byteLength(s, "utf8") < 4096) s += unit;
    while (Buffer.byteLength(s, "utf8") > 4096) s = s.slice(0, -1);
    return s;
  };
  const names = Array.from({ length: 16 }, (_, i) => `s${i}`);
  const values = Object.fromEntries(names.map((n, i) => [n, bigTrickyValue(i)]));
  const { dir } = withSecretsFile(values);
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: Object.fromEntries(names.map((n) => [n, "x"])) }));
  const fetchImpl = async () => new Response(names.map((n) => values[n]).join("|"), { status: 200, headers: { "content-type": "text/plain" } });
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const markers = Object.fromEntries(names.map((n) => [n, kino.secret(n)]));
  // One request whose query substitutes (and so opens) all 16 secrets at once.
  const query = names.map((n) => `${n}=${markers[n]}`).join("&");
  const r = await kino.fetch(`https://api.example.com/x?${query}`);
  assert.equal(r.status, 200);
  const text = r.text();
  for (const n of names) {
    assert.ok(!text.includes(values[n]), `${n}'s plain value leaked`);
    assert.ok(text.includes(markers[n]), `${n}'s marker missing`);
  }
});

test("the size cap is checked before substitution for a form body too, like the app's own prelude", async () => {
  const secretValue = "x".repeat(4096); // the largest a sealed secret's plaintext can ever be
  const { dir } = withSecretsFile({ apiKey: secretValue });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ body: init.body }); return new Response("ok"); };
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const marker = kino.secret("apiKey");
  // filler pads the MARKER-laden body to just under the cap; substituting the 4096-byte secret in
  // for the marker (~38 characters) would push the real, post-substitution body well over it.
  const filler = "a".repeat(contract.fetch.maxRequestChars - marker.length - 200);
  await kino.fetch("https://api.example.com/x", { method: "POST", body: { form: { key: marker, filler } } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.includes(secretValue));
  assert.ok(calls[0].body.length > contract.fetch.maxRequestChars, "the real, substituted body IS over the cap");
});

test("kino.crypto: a sealed key decrypts what that key encrypted", () => {
  const { kino } = sealedKino({ aesKey: "0123456789abcdef" });
  const hexIv = "000102030405060708090a0b0c0d0e0f";
  const ct = kino.crypto.encrypt("aes-128-cbc", { key: "0123456789abcdef", iv: hexIv, ivEncoding: "hex", data: "hola mundo" });
  const marker = kino.secret("aesKey");
  const out = kino.crypto.decrypt("aes-128-cbc", { key: marker, iv: hexIv, ivEncoding: "hex", data: ct });
  assert.equal(out, "hola mundo");
});

test("kino.crypto: a sealed cipher key must be exactly one marker", () => {
  const { kino } = sealedKino({ desKey: "0123456789abcdefghijklmn" });
  const m = kino.secret("desKey");
  const refused = "a sealed value can't be used here";
  assert.throws(() => kino.crypto.encrypt("des-ede3-cbc", { key: m + "A".repeat(16), iv: "0001020304050607", ivEncoding: "hex", data: "hola" }),
    (e) => e.code === "crypto_error" && e.message === refused);
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: m + m + m, data: "hola" }),
    (e) => e.code === "crypto_error" && e.message === refused);
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: "x" + m, data: "hola" }),
    (e) => e.code === "crypto_error" && e.message === refused);
  assert.throws(() => kino.crypto.encrypt("aes-192-ecb", { key: "x" + m, data: "hola" }),
    (e) => e.code === "crypto_error" && e.message === refused);
  // Exactly the marker (even rebuilt by concatenation with "") works, as an AES key.
  assert.equal(kino.crypto.encrypt("aes-192-ecb", { key: m + "", data: "hola" }), kino.crypto.encrypt("aes-192-ecb", { key: "0123456789abcdefghijklmn", data: "hola" }));
});

test("kino.crypto: a sealed key is refused for a non-AES cipher, like the app", () => {
  const { kino } = sealedKino({ desKey: "0123456789abcdefghijklmn" });
  const m = kino.secret("desKey");
  const refused = (fn) => assert.throws(fn, (e) => e.code === "crypto_error" && e.message === "a sealed value can't be used here");
  refused(() => kino.crypto.encrypt("des-ede3-ecb", { key: m, data: "hola" }));
  refused(() => kino.crypto.decrypt("des-ede3-cbc", { key: m, iv: "0001020304050607", ivEncoding: "hex", data: "AAAAAAAAAAA=" }));
  refused(() => kino.crypto.encrypt("des-ede3-ecb", { key: m, keyEncoding: "hex", data: "hola" }));
  // A plain des-ede3 key works as always.
  assert.doesNotThrow(() => kino.crypto.encrypt("des-ede3-ecb", { key: "0123456789abcdefghijklmn", data: "hola" }));
});

test("kino.crypto: hmac and pbkdf2 may join a marker with other text; a cipher key may not", () => {
  const { kino } = sealedKino({ hmacKey: "hm4c-k3y", password: "p4ss" });
  const m1 = kino.secret("hmacKey"), m2 = kino.secret("password");
  assert.equal(kino.crypto.hmac("sha256", m1 + "&tok", "datos"), kino.crypto.hmac("sha256", "hm4c-k3y&tok", "datos"));
  assert.equal(kino.crypto.pbkdf2("sha256", m2, "salt", 10, 32), kino.crypto.pbkdf2("sha256", "p4ss", "salt", 10, 32));
  assert.equal(kino.crypto.pbkdf2("sha256", "pw", m2, 10, 32), kino.crypto.pbkdf2("sha256", "pw", "p4ss", 10, 32));
});

test("kino.crypto: a marker in data, iv or aad is refused whatever the key is", () => {
  const { kino } = sealedKino({ aesKey: "0123456789abcdef", aesIv: "fedcba9876543210" });
  const k = kino.secret("aesKey"), iv = kino.secret("aesIv");
  const refused = (fn) => assert.throws(fn, (e) => e.code === "crypto_error" && e.message === "a sealed value can't be used here");
  refused(() => kino.crypto.hash("md5", k));
  refused(() => kino.crypto.hmac("sha256", "key", k));
  refused(() => kino.crypto.encrypt("aes-128-cbc", { key: k, iv, data: "hola" }));
  refused(() => kino.crypto.encrypt("aes-128-cbc", { key: "2b7e151628aed2a6abf7158809cf4f3c", keyEncoding: "hex", iv, data: "hola" }));
  refused(() => kino.crypto.encrypt("aes-128-gcm", { key: k, iv: "000102030405060708090a0b", ivEncoding: "hex", aad: iv, data: "hola" }));
});

test("kino.crypto: an opened value comes back redacted even from an unrelated later call", () => {
  const { kino } = sealedKino({ hmacKey: "hm4c-k3y" });
  const m = kino.secret("hmacKey");
  kino.crypto.hmac("sha256", m, "x"); // opens hmacKey
  const plainKeyHex = "2b7e151628aed2a6abf7158809cf4f3c";
  const ct = kino.crypto.encrypt("aes-128-ecb", { key: plainKeyHex, keyEncoding: "hex", data: "hm4c-k3y" });
  const out = kino.crypto.decrypt("aes-128-ecb", { key: plainKeyHex, keyEncoding: "hex", data: ct });
  assert.equal(out, m);
});

// Like the app: a runtime that declares secrets redacts every declared value from its first
// redaction on, used or not -- a value can arrive before any use (a cookie an earlier runtime's
// request set, a server echoing it to a request that carried no marker).
test("redaction covers a declared value this runtime never used: a crypto answer", () => {
  const { kino } = sealedKino({ hmacKey: "hm4c-k3y" });
  const plainKeyHex = "2b7e151628aed2a6abf7158809cf4f3c";
  const ct = kino.crypto.encrypt("aes-128-ecb", { key: plainKeyHex, keyEncoding: "hex", data: "hm4c-k3y" });
  assert.equal(kino.crypto.decrypt("aes-128-ecb", { key: plainKeyHex, keyEncoding: "hex", data: ct }), kino.secret("hmacKey"));
});

test("redaction covers a cookie an earlier runtime's request set, before this runtime uses the secret", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const cookiesFile = join(dir, ".kino-cookies.json");
  const first = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), cookiesFile, fetchImpl: async () => new Response("ok", { headers: { "set-cookie": "sid=k-123; Path=/" } }) });
  await first.kino.fetch(`https://api.example.com/login?k=${first.kino.secret("apiKey")}`);
  const second = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), cookiesFile, fetchImpl: () => { throw new Error("must not reach the network"); } });
  const cookie = second.kino.cookies.get("https://api.example.com/", "sid");
  assert.equal(cookie, second.kino.secret("apiKey"));
});

test("redaction covers a server echoing a value to a request that carried no marker", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  const fetchImpl = async () => new Response("session k-123", { status: 200, headers: { "content-type": "text/plain", "x-echo": "k-123" } });
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const r = await kino.fetch("https://api.example.com/whoami");
  const marker = kino.secret("apiKey");
  assert.equal(r.text(), `session ${marker}`);
  assert.equal(r.headers["x-echo"], marker);
  assert.equal(Buffer.from(r.base64(), "base64").toString("utf8"), `session ${marker}`);
});

test("redaction knows the JSON echo forms: '/' as '\\/' and non-ASCII as \\uXXXX in either case (PHP, Python)", async () => {
  const key = "ab/cd+ef==";
  const accented = "clé/ñ\u0001";
  const { dir } = withSecretsFile({ key, accented, emoji: "k\u{1F600}y" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { key: "x", accented: "x", emoji: "x" } }));
  const echoes = [
    ["ab\\/cd+ef==", "key"],
    ["cl\\u00e9\\/\\u00f1\\u0001", "accented"],
    ["cl\\u00e9/\\u00f1\\u0001", "accented"],
    ["cl\\u00E9/\\u00F1\\u0001", "accented"],
    ["cl\\u00E9\\/\\u00F1\\u0001", "accented"],
    ["clé\\/ñ\\u0001", "accented"],
    ["k\\ud83d\\ude00y", "emoji"],
    ["k\\uD83D\\uDE00y", "emoji"],
  ];
  const body = echoes.map(([e]) => `"${e}"`).join(",");
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: async () => new Response(`[${body}]`, { headers: { "content-type": "application/json" } }) });
  const r = await kino.fetch("https://api.example.com/x");
  assert.deepEqual(r.json(), echoes.map(([, name]) => kino.secret(name)));
  // What PHP's json_encode and Python's json.dumps really write, for these very values.
  assert.equal(JSON.stringify(accented).slice(1, -1), "clé/ñ\\u0001");
});

test("r.base64() of a text body is the redacted text's bytes, like the app; a binary body's bytes are untouched", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123", accented: "clé" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x", accented: "x" } }));
  const bodies = [
    ["text/plain; charset=utf-8", Buffer.from("año k-123", "utf8")],
    ["text/plain; charset=ISO-8859-1", Buffer.from("año k-123", "latin1")],
    // Declared UTF-16 over Latin-1 bytes: the decoded text is garbage, the bytes still hold the value.
    ["text/plain; charset=UTF-16LE", Buffer.from("año clé!", "latin1")],
    ["application/octet-stream", Buffer.from("raw k-123", "utf8")],
  ];
  let i = 0;
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: async () => { const [type, b] = bodies[i++]; return new Response(b, { headers: { "content-type": type } }); } });
  const k = kino.secret("apiKey");
  const utf8 = await kino.fetch("https://api.example.com/1");
  assert.equal(Buffer.from(utf8.base64(), "base64").toString("utf8"), `año ${k}`);
  const latin1 = await kino.fetch("https://api.example.com/2");
  assert.equal(latin1.text(), `año ${k}`);
  assert.equal(Buffer.from(latin1.base64(), "base64").toString("latin1"), `año ${k}`);
  const wrong = await kino.fetch("https://api.example.com/3");
  const twin = Buffer.from(wrong.base64(), "base64");
  assert.ok(!twin.toString("utf8").includes("clé") && !twin.toString("latin1").includes("clé"), twin.toString("latin1"));
  const binary = await kino.fetch("https://api.example.com/4");
  assert.equal(Buffer.from(binary.base64(), "base64").toString("utf8"), "raw k-123");
});

test("r.base64() of an ISO-8859-1 body round-trips bytes 0x80-0x9F, where windows-1252 disagrees with true Latin-1", async () => {
  const { dir } = withSecretsFile({ apiKey: "k-123" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { apiKey: "x" } }));
  // 0x80 and 0x9F are control characters in true ISO-8859-1 but "€" and "Ÿ" in windows-1252 -- and
  // Node's TextDecoder("iso-8859-1") decodes as windows-1252, not true Latin-1. Redacting this body
  // (the value is present) forces base64() to re-encode from the decoded text, which is where the
  // two disagreeing mappings used to lose the original bytes.
  const body = Buffer.concat([Buffer.from([0x80, 0x9f]), Buffer.from("año k-123", "latin1")]);
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl: async () => new Response(body, { headers: { "content-type": "text/plain; charset=ISO-8859-1" } }) });
  const k = kino.secret("apiKey");
  const r = await kino.fetch("https://api.example.com/x");
  assert.equal(r.text(), `\x80\x9faño ${k}`);
  const twin = Buffer.from(r.base64(), "base64");
  assert.equal(twin.toString("latin1"), `\x80\x9faño ${k}`);
});

// A marker is `__kinoSecret_<name>_<nonce>__`: it literally contains both "kino" and "Secret" as
// substrings, so a short secret whose OWN value is one of those words is exactly the case where a
// naive "one full pass per form, longest first" redaction can rematch itself inside a marker another
// secret's longer pass just inserted.
test("redactWith doesn't rematch a secret valued \"kino\" or \"Secret\" inside another secret's own marker", async () => {
  const { dir } = withSecretsFile({ other: "unrelated-value-here", kinoWord: "kino", secretWord: "Secret" });
  const m = JSON.parse(manifest({ hosts: ["api.example.com"], secrets: { other: "x", kinoWord: "x", secretWord: "x" } }));
  const { kino } = createKino(m, {
    secretsFile: join(dir, ".kino-secrets.json"),
    fetchImpl: async () => new Response("unrelated-value-here, kino, Secret", { headers: { "content-type": "text/plain" } }),
  });
  const otherMarker = kino.secret("other");
  const kinoMarker = kino.secret("kinoWord");
  const secretMarker = kino.secret("secretWord");
  assert.ok(otherMarker.includes("kino") && otherMarker.includes("Secret"), otherMarker);
  const r = await kino.fetch("https://api.example.com/x");
  assert.equal(r.text(), `${otherMarker}, ${kinoMarker}, ${secretMarker}`);
});

test("run.mjs wires .kino-secrets.json next to the manifest for kino.secret and substitution", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-run-secrets-"));
  try {
    const secrets = { apiKey: FAKE_SEAL };
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 4, hosts: ["example.com"], secrets }));
    writeFileSync(join(dir, "plugin.js"),
      "export async function search(){ return { items: [] } }\n" +
      "export async function resolve(){ await kino.fetch('https://example.com/x', { headers: { 'X-Api-Key': kino.secret('apiKey') } }); return { url: 'https://example.com/v.mp4', mime: 'video/mp4' }; }\n");
    const tape = join(dir, "tape.json");
    writeFileSync(tape, JSON.stringify([{ key: JSON.stringify(["GET", "https://example.com/x", null]), status: 200, headers: [["content-type", "text/plain"]], body: Buffer.from("ok").toString("base64") }]));
    writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify({ apiKey: "k-999" }));

    const ok = spawnSync(process.execPath, [join(here, "..", "run.mjs"), "--replay", tape, dir, "resolve", "ref"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).url, "https://example.com/v.mp4");

    // Without .kino-secrets.json, the exact app-parity message surfaces through the CLI.
    rmSync(join(dir, ".kino-secrets.json"));
    const missing = spawnSync(process.execPath, [join(here, "..", "run.mjs"), "--replay", tape, dir, "resolve", "ref"], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /the value of the secret apiKey is missing from \.kino-secrets\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init scaffolds a .gitignore for the kit's local storage, cookies and secrets files", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-secrets-"));
  try {
    const written = scaffold(dir, { id: "demo" });
    assert.ok(written.includes(".gitignore"), written.join(", "));
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    for (const line of [".kino-storage.json", ".kino-cookies.json", ".kino-secrets.json"]) assert.ok(gi.includes(line), gi);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the repo's own .gitignore excludes the kit's local secrets file too", { skip: NEEDS_KINO_REPO }, () => {
  const gi = readFileSync(join(here, "..", "..", "..", ".gitignore"), "utf8");
  assert.ok(gi.includes("plugins/**/.kino-secrets.json"), gi);
});

// ---------- live channels: the kit's own M3U/XMLTV readers (apiVersion 3) ----------

// The shared corpus the app's JVM tests read too. It lives only in Kino's repo
// (docs/plugins/fixtures/live); a published plugin repo (sdk/ and contract.json at its root) doesn't
// ship it, so these tests skip there.
const fixturesDir = join(here, "..", "..", "..", "docs", "plugins", "fixtures", "live");
const fixtures = existsSync(fixturesDir) ? fixturesDir : null;
const needFixtures = (t) => { if (!fixtures) t.skip("no shared live fixtures around this kit"); return !!fixtures; };
const M3U_FIXTURES = ["basic", "bom-crlf", "latin1", "broken", "headers", "unterminated-quote", "huge-line", "exthttp"];
// Whole-playlist fixtures: their .expected.json holds the manifest, the typed servers, the
// declaration and the grouped counts, checked here through loadPlaylist and in the app's
// PluginLivePlaylistTest through PluginLiveProvider.
const PLAYLIST_FIXTURES = ["any-hosts"];

// The fields a fixture's .expected.json holds, as the app's M3uParserTest writes them.
const FIXTURE_FIELDS = ["name", "url", "tvgId", "tvgName", "logo", "number", "group", "language", "country", "headers"];
const asFixture = (r) => ({ total: r.total, skipped: r.skipped, entries: r.entries.map((e) => Object.fromEntries(FIXTURE_FIELDS.map((k) => [k, e[k]]))) });

test("the kit's M3U reader gives the app's exact answer on every shared fixture", (t) => {
  if (!needFixtures(t)) return;
  for (const name of M3U_FIXTURES) {
    const got = asFixture(parseM3u(readFileSync(join(fixtures, `${name}.m3u`))));
    const want = JSON.parse(readFileSync(join(fixtures, `${name}.expected.json`), "utf8"));
    assert.deepEqual(got, want, name);
  }
});

test("every .m3u in the shared corpus has its .expected.json and is checked here", (t) => {
  if (!needFixtures(t)) return;
  const m3u = readdirSync(fixtures).filter((f) => f.endsWith(".m3u")).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(m3u, [...M3U_FIXTURES, ...PLAYLIST_FIXTURES].sort());
  for (const name of m3u) assert.ok(existsSync(join(fixtures, `${name}.expected.json`)), name);
});

test("loadPlaylist keeps, skips and hides exactly what the app does (README live recipe 1)", async (t) => {
  if (!needFixtures(t)) return;
  for (const name of PLAYLIST_FIXTURES) {
    const want = JSON.parse(readFileSync(join(fixtures, `${name}.expected.json`), "utf8"));
    const m = validateManifest(manifest({ apiVersion: 3, capabilities: ["home", "resolve", "channels"], ...want.manifest }));
    assert.equal(m.ok, true, name);
    const bytes = readFileSync(join(fixtures, `${name}.m3u`));
    const fetchImpl = async (url) => (String(url) === want.playlist.url ? new Response(bytes, { status: 200 }) : new Response("no", { status: 404 }));
    // Read as the app reads the liveCategories answer (strict hosts, hideGroups normalised) first.
    const declared = checkOutput("liveCategories", [{ playlist: want.playlist }], m.manifest, want.servers).value.playlists;
    assert.equal(declared.length, 1, name);
    const s = await loadPlaylist(declared[0], { manifest: m.manifest, servers: want.servers, fetchImpl });
    assert.deepEqual([s.channels, s.skipped, s.hidden], [want.kept, want.skipped, want.hidden], name);
    assert.deepEqual(s.entries.map((e) => e.name), want.channels, name);
  }
});

test("the kit's M3U reader keeps the cap and counts the rest", () => {
  const text = "#EXTM3U\n" + Array.from({ length: 6000 }, (_, i) => `#EXTINF:-1,C${i}\nhttps://x.example.com/${i}.m3u8\n`).join("");
  const r = parseM3u(text, { maxEntries: 5000 });
  assert.equal(r.entries.length, 5000);
  assert.equal(r.total, 6000);
  assert.equal(r.entries[4999].name, "C4999");
  assert.equal(parseM3u(text).entries.length, contract.live.maxChannelsPerProvider);
});

test("the kit's M3U reader drops hidden and refused entries during the parse, never spending the cap", () => {
  const text = "#EXTM3U\n"
    + Array.from({ length: 10 }, (_, i) => `#EXTINF:-1 group-title="XXX",A${i}\nhttps://live.example.com/a${i}.m3u8\n`).join("")
    + Array.from({ length: 4 }, (_, i) => `#EXTINF:-1,E${i}\nhttps://evil.example.org/${i}.m3u8\n`).join("")
    + Array.from({ length: 5 }, (_, i) => `#EXTINF:-1,C${i}\nhttps://live.example.com/${i}.m3u8\n`).join("");
  const r = parseM3u(text, { maxEntries: 3, hide: (e) => e.group === "XXX", allow: (url) => !url.includes("evil") });
  assert.deepEqual(r.entries.map((e) => e.name), ["C0", "C1", "C2"]);
  assert.deepEqual([r.total, r.hidden, r.refused], [5, 10, 4]);
  assert.deepEqual(parseM3u(""), { entries: [], total: 0, skipped: 0, epgUrls: [] });
});

const DRM_NONE = { drmKeyId: "", drmKey: "", drmLicenseUrl: "", drmLicenseHeaders: {} };
const drmOf = (e) => ({ drmKeyId: e.drmKeyId, drmKey: e.drmKey, drmLicenseUrl: e.drmLicenseUrl, drmLicenseHeaders: e.drmLicenseHeaders });
const KID = "0123456789abcdef0123456789abcdef";
const KEY = "fedcba9876543210fedcba9876543210";

test("the kit's M3U reader decodes UTF-16 lists, with a BOM or without one, like their UTF-8 text", () => {
  const sample = "#EXTM3U\n#EXTINF:-1 group-title=\"Noticias\",Señal Ñ\nhttps://live.example.com/n.m3u8\n";
  const be = (s) => Buffer.from(s, "utf16le").swap16();
  const expected = parseM3u(sample);
  assert.equal(expected.total, 1);
  for (const [name, bytes] of [
    ["LE BOM", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sample, "utf16le")])],
    ["BE BOM", Buffer.concat([Buffer.from([0xfe, 0xff]), be(sample)])],
    ["LE", Buffer.from(sample, "utf16le")],
    ["BE", be(sample)],
  ]) {
    assert.equal(decodeM3u(bytes), sample, name);
    assert.deepEqual(parseM3u(bytes), expected, name);
  }
  // UTF-8 and Latin-1 are never mistaken for UTF-16; two bytes are too few to sniff.
  assert.equal(decodeM3u(Buffer.from(sample, "utf8")), sample);
  assert.equal(decodeM3u(Buffer.from(sample, "latin1")), sample);
  assert.equal(decodeM3u(Buffer.from([0x23, 0x45])), "#E");
});

test("the kit's M3U reader takes single-quoted and bare attribute values, and an apostrophe never swallows the title", () => {
  const text = "#EXTM3U\n"
    + "#EXTINF:-1 tvg-id=abc.co tvg-logo='http://logo.example.com/a.png' group-title='Noticias, Deportes',Canal A\n"
    + "https://live.example.com/a.m3u8\n"
    + "#EXTINF:-1 tvg-name=O'Brien group-title=\"Uno, Dos\",Canal B\n"
    + "https://live.example.com/b.m3u8\n";
  const [a, b] = parseM3u(text).entries;
  assert.deepEqual([a.tvgId, a.logo, a.group, a.name], ["abc.co", "http://logo.example.com/a.png", "Noticias, Deportes", "Canal A"]);
  assert.deepEqual([b.tvgName, b.group, b.name], ["O'Brien", "Uno, Dos", "Canal B"]);
});

test("the kit's M3U reader takes the header's guides: http(s) only, deduplicated, capped, single quotes too, never a late header", () => {
  const text = "#EXTM3U url-tvg=\"https://epg.example.com/a.xml.gz, https://epg.example.com/b.xml,file:///sdcard/x.xml\" "
    + "x-tvg-url=\"https://epg.example.com/b.xml,http://epg.example.org/c.xml,https://epg.example.org/d.xml\"\n"
    + "#EXTINF:-1,Canal\nhttps://live.example.com/1.m3u8\n";
  assert.deepEqual(parseM3u(text).epgUrls, ["https://epg.example.com/a.xml.gz", "https://epg.example.com/b.xml", "http://epg.example.org/c.xml"]);
  assert.deepEqual(parseM3u("#EXTM3U url-tvg='https://epg.example.com/g.xml'\n").epgUrls, ["https://epg.example.com/g.xml"]);
  assert.deepEqual(parseM3u("#EXTM3U\n#EXTINF:-1,A\nhttps://x.example.com/a\n").epgUrls, []);
  assert.deepEqual(parseM3u("#EXTM3U\n#EXTINF:-1,A\nhttps://x.example.com/a\n#EXTM3U url-tvg=\"https://epg.example.com/late.xml\"\n").epgUrls, []);
  assert.deepEqual(parseM3u(Buffer.from("\uFEFF#EXTM3U x-tvg-url=\"https://epg.example.com/g.xml\"\n#EXTINF:-1,A\nhttps://x.example.com/a\n")).epgUrls, ["https://epg.example.com/g.xml"]);
});

test("the kit's M3U reader takes a KODIPROP ClearKey license, hex or JSON, and drops a bad one or another key system", () => {
  const one = (type, key) => parseM3u(`#EXTM3U\n#EXTINF:-1,C\n#KODIPROP:inputstream.adaptive.license_type=${type}\n#KODIPROP:inputstream.adaptive.license_key=${key}\nhttps://live.example.com/p.mpd\n`).entries[0];
  assert.deepEqual(drmOf(one("clearkey", `${KID}:${KEY}`)), { ...DRM_NONE, drmKeyId: KID, drmKey: KEY });
  assert.deepEqual(drmOf(one("org.w3.clearkey", `${KID.toUpperCase()}:${KEY}`)), { ...DRM_NONE, drmKeyId: KID, drmKey: KEY });
  assert.deepEqual(drmOf(one("clearkey", '{"keys":[{"kty":"oct","kid":"ASNFZ4mrze8BI0VniavN7w","k":"_ty6mHZUMhD-3LqYdlQyEA"}],"type":"temporary"}')), { ...DRM_NONE, drmKeyId: KID, drmKey: KEY });
  for (const bad of ["zz:yy", "0123:4567", '{"keys":[{"kid":"bad","k":"bad"}]}', '{"keys":']) assert.deepEqual(drmOf(one("clearkey", bad)), DRM_NONE, bad);
  assert.deepEqual(drmOf(one("com.microsoft.playready", "https://license.example.com/acquire")), DRM_NONE);
  assert.deepEqual(drmOf(parseM3u("#EXTM3U\n#EXTINF:-1,Libre\nhttps://live.example.com/l.m3u8\n").entries[0]), DRM_NONE);
});

test("the kit's M3U reader takes a KODIPROP Widevine license: its URL and request headers, by the app's limits", () => {
  for (const type of ["com.widevine.alpha", "widevine", "WIDEVINE"]) {
    const text = `#EXTM3U\n#EXTINF:-1,Canal widevine\n#KODIPROP:inputstream.adaptive.license_type=${type}\n`
      + "#KODIPROP:inputstream.adaptive.license_key=https://license.example.com/acquire?id=1|User-Agent=Mozilla%2F5.0&X-Custom-Data=a+b%3D&Host=evil&bad name=x&Connection=close&X-Ctl=a%0Ab|R{SSM}|\n"
      + "https://live.example.com/widevine.mpd\n";
    const e = parseM3u(text).entries[0];
    assert.deepEqual(drmOf(e), { ...DRM_NONE, drmLicenseUrl: "https://license.example.com/acquire?id=1", drmLicenseHeaders: { "User-Agent": "Mozilla/5.0", "X-Custom-Data": "a+b=" } }, type);
    // License headers go to the license server only, never the stream.
    assert.deepEqual(e.headers, {}, type);
  }
  const many = Array.from({ length: 20 }, (_, i) => `X-H${i}=${i}`).join("&");
  const capped = parseM3u(`#EXTM3U\n#EXTINF:-1,C\n#KODIPROP:inputstream.adaptive.license_type=widevine\n#KODIPROP:inputstream.adaptive.license_key=https://l.example.com/|${many}\nhttps://live.example.com/p.mpd\n`).entries[0];
  assert.equal(Object.keys(capped.drmLicenseHeaders).length, 16);
  assert.equal(capped.drmLicenseHeaders["X-H15"], "15");
  for (const key of ["", "ftp://license.example.com/x", `${KID}:${KEY}`, "https://", "https://a b.example.com/"]) {
    const e = parseM3u(`#EXTM3U\n#EXTINF:-1,C\n#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n#KODIPROP:inputstream.adaptive.license_key=${key}\nhttps://live.example.com/p.mpd\n`).entries[0];
    assert.equal(e.name, "C", key);
    assert.deepEqual(drmOf(e), DRM_NONE, key);
  }
});

test("the kit's M3U reader reads drm_legacy, and one entry's DRM never leaks into the next", () => {
  const text = "#EXTM3U\n"
    + "#EXTINF:-1,W\n#KODIPROP:inputstream.adaptive.drm_legacy=com.widevine.alpha|https://license.example.com/w|Referer=https%3A%2F%2Fsite.example.com%2F\nhttps://live.example.com/w.mpd\n"
    + `#EXTINF:-1,C\n#KODIPROP:inputstream.adaptive.drm_legacy=org.w3.clearkey|${KID}:${KEY}\nhttps://live.example.com/c.mpd\n`
    + "#EXTINF:-1,Libre\nhttps://live.example.com/l.m3u8\n";
  const [w, c, libre] = parseM3u(text).entries;
  assert.deepEqual(drmOf(w), { ...DRM_NONE, drmLicenseUrl: "https://license.example.com/w", drmLicenseHeaders: { Referer: "https://site.example.com/" } });
  assert.deepEqual(drmOf(c), { ...DRM_NONE, drmKeyId: KID, drmKey: KEY });
  assert.deepEqual(drmOf(libre), DRM_NONE);
});

test("the kit's M3U reader reads tvg-shift as the app: hours to minutes, at most a day either way", () => {
  const shift = (v) => parseM3u(`#EXTM3U\n#EXTINF:-1 tvg-shift="${v}",C\nhttps://live.example.com/c.m3u8\n`).entries[0].tvgShiftMin;
  assert.deepEqual(["+2", "-5", "2.5", "1,5", "24", "25", "abc", ""].map(shift), [120, -300, 150, 90, 1440, 0, 0, 0]);
});

test("the kit's XMLTV reader gives the app's answer on every shared guide, plain and gzip, and refuses a DOCTYPE", (t) => {
  if (!needFixtures(t)) return;
  const iso = (g) => Object.fromEntries(Object.entries(g.programmes).map(([k, l]) =>
    [k, l.map((p) => ({ title: p.title, start: new Date(p.start).toISOString().replace(".000", ""), end: new Date(p.end).toISOString().replace(".000", ""), description: p.description }))]));
  const cases = [["guide.xml", "guide"], ["guide.xml.gz", "guide"], ["guide-latin1.xml", "guide-latin1"], ["guide-windows1252.xml", "guide-windows1252"], ["guide-xxe.xml", "guide-xxe"], ["guide-doctype-comment.xml", "guide-doctype-comment"]];
  for (const [file, expected] of cases) {
    const want = JSON.parse(readFileSync(join(fixtures, `${expected}.expected.json`), "utf8"));
    // The window and the wanted ids come from the fixture's own "query", as in the app's test.
    const q = want.query;
    const opts = { from: Date.parse(q.from), to: Date.parse(q.to), wantedIds: q.wantedIds ? new Set(q.wantedIds) : null };
    const g = parseXmltv(readFileSync(join(fixtures, file)), opts);
    assert.deepEqual(g.displayNames, want.displayNames, file);
    assert.deepEqual(iso(g), want.programmes, file);
    assert.equal(g.truncated, want.truncated, file);
  }
  const opts = { from: Date.parse("2026-09-27T00:00:00Z"), to: Date.parse("2026-09-28T00:00:00Z"), wantedIds: null };
  assert.deepEqual(parseXmltv(readFileSync(join(fixtures, "guide-xxe.xml")), opts).programmes, {});
  assert.equal(parseXmltv(readFileSync(join(fixtures, "guide-latin1.xml")), opts).programmes.n[0].title, "Niñez");
  // A channel wanted by its display name, accents and case folded.
  const byName = parseXmltv(readFileSync(join(fixtures, "guide.xml")), { ...opts, wantedIds: new Set(), wantedNames: new Set([normaliseName("CANAL UNO")]) });
  assert.deepEqual(Object.keys(byName.programmes), ["canal1.co"]);
  // A gzip cut in half is read as far as it goes, and says so.
  const gz = readFileSync(join(fixtures, "guide.xml.gz"));
  assert.equal(parseXmltv(gz.subarray(0, gz.length >> 1), opts).truncated, true);
  const corrupt = Buffer.from(gz); corrupt[2] = 1;
  assert.deepEqual(parseXmltv(corrupt, opts).programmes, {});
});

test("the kit's XMLTV reader: every DOCTYPE refused, caps, times and a broken tail as the app", () => {
  const from = Date.parse("2026-09-27T00:00:00Z");
  const to = Date.parse("2026-09-28T00:00:00Z");
  const prog = (ch, start, stop, title) => `<programme start="${start}" stop="${stop}" channel="${ch}"><title>${title}</title></programme>`;
  const padded = `<?xml version="1.0"?><!-- ${"x".repeat(8300)} --><!DOCTYPE tv [<!ENTITY s "LEAKED">]><tv>${prog("x", "20260927120000 +0000", "20260927130000 +0000", "&s;")}</tv>`;
  assert.deepEqual(parseXmltv(Buffer.from(padded), { from, to }), { displayNames: {}, programmes: {}, truncated: false, refused: true });
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE tv SYSTEM "http://192.0.2.1/x.dtd"><tv>${prog("x", "20260927120000", "20260927130000", "Hi")}</tv>`, "utf16le")]);
  assert.deepEqual(parseXmltv(utf16, { from, to }).programmes, {});
  // The earliest per channel survive the cap, whatever the document order.
  const outOfOrder = `<tv>${[14, 13, 12, 11, 10].map((h) => prog("c", `20260927${h}0000 +0000`, `20260927${h}0100 +0000`, `P${h - 10}`)).join("")}</tv>`;
  assert.deepEqual(parseXmltv(Buffer.from(outOfOrder), { from, to, maxPerChannel: 3 }).programmes.c.map((p) => p.title), ["P0", "P1", "P2"]);
  // At most 5000 distinct channels when everything is wanted.
  const many = `<tv>${Array.from({ length: 5005 }, (_, i) => prog(`c${i}`, "20260927120000 +0000", "20260927130000 +0000", "P")).join("")}</tv>`;
  assert.equal(Object.keys(parseXmltv(Buffer.from(many), { from, to }).programmes).length, 5000);
  // A broken tail keeps what parsed, and says so.
  const broken = parseXmltv(Buffer.from(`<tv>${prog("c", "20260927120000", "20260927130000", "Uno")}<programme`), { from, to });
  assert.deepEqual([broken.programmes.c.map((p) => p.title), broken.truncated], [["Uno"], true]);
  // An unknown declared charset falls back to ISO-8859-1.
  const bogus = Buffer.from(`<?xml version="1.0" encoding="totally-bogus"?><tv>${prog("n", "20260927120000 +0000", "20260927130000 +0000", "Niñez")}</tv>`, "latin1");
  assert.equal(parseXmltv(bogus, { from, to }).programmes.n[0].title, "Niñez");
  // The byte cap: a gzip bomb is cut and reported.
  const body = `<tv>${Array.from({ length: 20000 }, (_, i) => prog(`c${i % 4000}`, "20260927120000 +0000", "20260927130000 +0000", "P")).join("")}</tv>`;
  const capped = parseXmltv(gzipSync(Buffer.from(body)), { from, to, maxBytes: 200_000 });
  assert.equal(capped.truncated, true);
  assert.ok(Object.keys(capped.programmes).length > 0 && Object.keys(capped.programmes).length < 4000);
  assert.equal(parseXmltvTime("20260927120000 -0500"), Date.parse("2026-09-27T17:00:00Z"));
  assert.equal(parseXmltvTime("202609271230 +0000"), Date.parse("2026-09-27T12:30:00Z"));
  assert.equal(parseXmltvTime("basura"), null);
  assert.equal(parseXmltvTime("20261399000000"), null);
});

test("the kit's XMLTV reader ends a programme with no stop at the next one of its channel, else after an hour", () => {
  const from = Date.parse("2026-09-27T00:00:00Z");
  const to = Date.parse("2026-09-28T00:00:00Z");
  const at = (hhmm) => Date.parse(`2026-09-27T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  const p = (ch, start, title, stop = null) => `<programme start="20260927${start}00 +0000"${stop ? ` stop="20260927${stop}00 +0000"` : ""} channel="${ch}">${title === null ? "" : `<title>${title}</title>`}</programme>`;
  const ends = (xml, opts = {}) => Object.fromEntries(Object.entries(parseXmltv(Buffer.from(`<tv>${xml}</tv>`), { from, to, ...opts }).programmes)
    .map(([ch, l]) => [ch, l.map((x) => [x.title, x.start, x.end])]));
  // In time order: each ends where the next of ITS channel starts; the last one an hour later.
  assert.deepEqual(ends(p("a", "1000", "A1") + p("b", "1015", "B1") + p("a", "1030", "A2") + p("a", "1100", "A3", "1200") + p("a", "1300", "A4")), {
    a: [["A1", at("1000"), at("1030")], ["A2", at("1030"), at("1100")], ["A3", at("1100"), at("1200")], ["A4", at("1300"), at("1300") + OPEN_END_MS]],
    b: [["B1", at("1015"), at("1015") + OPEN_END_MS]],
  });
  // An untitled programme is not kept, but still ends the open one before it.
  assert.deepEqual(ends(p("a", "1000", "A1") + p("a", "1020", null) + p("a", "1100", "A2", "1130")), {
    a: [["A1", at("1000"), at("1020")], ["A2", at("1100"), at("1130")]],
  });
  // Out of order: an earlier one with no stop ends where the open one starts; the open one ends at
  // the next kept start when that comes sooner than its own next programme.
  assert.deepEqual(ends(p("a", "1100", "A2") + p("a", "1000", "A1") + p("a", "1130", "A3", "1200")), {
    a: [["A1", at("1000"), at("1100")], ["A2", at("1100"), at("1130")], ["A3", at("1130"), at("1200")]],
  });
  assert.deepEqual(ends(p("a", "1030", "A2", "1045") + p("a", "1000", "A1") + p("a", "1200", "A3")), {
    a: [["A1", at("1000"), at("1030")], ["A2", at("1030"), at("1045")], ["A3", at("1200"), at("1200") + OPEN_END_MS]],
  });
  // The same start twice with no stop: the second is dropped.
  assert.deepEqual(ends(p("a", "1000", "A1") + p("a", "1000", "Dup") + p("a", "1100", "A2", "1200")), {
    a: [["A1", at("1000"), at("1100")], ["A2", at("1100"), at("1200")]],
  });
  // An unparsable stop is no stop; the window applies to the end it gets; a cut guide closes what is open.
  assert.deepEqual(ends(`<programme start="20260927100000 +0000" stop="basura" channel="a"><title>A1</title></programme>`), { a: [["A1", at("1000"), at("1100")]] });
  assert.deepEqual(ends(p("a", "2330", "Late") + p("a", "0000", "Before", "0010"), { from: at("0005"), to: at("2345") }), {
    a: [["Before", at("0000"), at("0010")], ["Late", at("2330"), at("2330") + OPEN_END_MS]],
  });
  const cut = parseXmltv(Buffer.from(`<tv>${p("a", "1000", "A1")}<programme`), { from, to });
  assert.deepEqual([cut.programmes.a.map((x) => x.end), cut.truncated], [[at("1000") + OPEN_END_MS], true]);
});

test("a list or guide over its cap keeps its start, cut at the last whole line, as the app does", async () => {
  assert.deepEqual(keepStart(Buffer.from("ab\ncd\nef"), 20), { bytes: Buffer.from("ab\ncd\nef"), cut: false });
  assert.deepEqual(keepStart(Buffer.from("ab\ncd\nef"), 7), { bytes: Buffer.from("ab\ncd\n"), cut: true });
  assert.deepEqual(keepStart(Buffer.from("abcdef"), 4), { bytes: Buffer.from("abcd"), cut: true });
  // A declared playlist over contract.live.maxPlaylistBytes gives the channels of its start, and says so.
  const entry = (i) => `#EXTINF:-1 group-title="G",C${i}\nhttps://live.example.com/${i}.m3u8\n`;
  let text = "#EXTM3U\n";
  for (let i = 0; text.length <= contract.live.maxPlaylistBytes + 100; i++) text += entry(i);
  const body = Buffer.from(text);
  const m = validateManifest(manifest({ apiVersion: 3, hosts: ["cdn.example.com", "live.example.com"], capabilities: ["home", "resolve", "channels"] })).manifest;
  const fetchImpl = async () => new Response(body, { status: 200 });
  const s = await loadPlaylist({ url: "https://cdn.example.com/big.m3u" }, { manifest: m, fetchImpl });
  const kept = summarisePlaylist(keepStart(body, contract.live.maxPlaylistBytes).bytes);
  assert.equal(s.cut, true);
  assert.equal(s.total, kept.total);
  assert.ok(s.total > 0 && s.skipped === kept.skipped);
  assert.ok(summaryLines(s).some((l) => /Kino reads only its beginning/.test(l)));
  const small = await loadPlaylist({ url: "https://cdn.example.com/s.m3u" }, { manifest: m, fetchImpl: async () => new Response(entry(1), { status: 200 }) });
  assert.equal(small.cut, undefined);
});

test("run.mjs live playlist reports channels, groups and skipped entries", (t) => {
  if (!needFixtures(t)) return;
  const out = execFileSync(process.execPath, [join(here, "..", "run.mjs"), "live", "playlist", join(fixtures, "broken.m3u")], { encoding: "utf8" });
  assert.match(out, /3 channels/);
  assert.match(out, /5 entries dropped/);
  assert.match(out, /A › Bueno {2}https:\/\/live\.example\.com\/ok\.m3u8/);
});

test("run.mjs live playlist --epg shows what is on now, or no guide", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-live-"));
  try {
    const now = Date.now();
    const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
    writeFileSync(join(dir, "l.m3u"), `#EXTM3U\n#EXTINF:-1 tvg-id="uno" group-title="Noticias",Canal Uno\nhttps://live.example.com/1.m3u8\n#EXTINF:-1 group-title="Adultos",Oculto\nhttps://live.example.com/x.m3u8\n#EXTINF:-1 group-title="Cine",Canal Dos\nhttps://live.example.com/2.m3u8\n`);
    writeFileSync(join(dir, "g.xml"), `<tv><channel id="uno"><display-name>Canal Uno</display-name></channel><programme start="${stamp(now - 600000)}" stop="${stamp(now + 600000)}" channel="uno"><title>Al aire</title></programme></tv>`);
    const out = execFileSync(process.execPath, [join(here, "..", "run.mjs"), "live", "playlist", join(dir, "l.m3u"), "--epg", join(dir, "g.xml")], { encoding: "utf8" });
    assert.match(out, /2 channels in 2 categories; 0 entries dropped; 1 hidden \(adult\)/);
    assert.match(out, /Noticias › Canal Uno .*\n\s+now: Al aire/);
    assert.match(out, /Cine › Canal Dos .*\n\s+no guide/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarisePlaylist groups as the app: adult and hideGroups hidden, blank group, a repeated tvg-id noticed", () => {
  const text = "#EXTM3U\n#EXTINF:-1 tvg-id=\"a\" group-title=\"XXX\",X\nhttps://c.example.com/x\n#EXTINF:-1 tvg-id=\"a\" group-title=\"Compras\",Y\nhttps://c.example.com/y\n#EXTINF:-1 tvg-id=\"d\",Z\nhttps://c.example.com/z\n#EXTINF:-1 tvg-id=\"d\",W\nhttps://c.example.com/w\n#EXTINF:-1,W\nhttps://c.example.com/w\n";
  const s = summarisePlaylist(text, { hideGroups: ["compras"] });
  assert.deepEqual([s.channels, s.hidden, s.skipped], [2, 2, 1]);
  assert.deepEqual(s.categories.map((c) => [c.title, c.count]), [["Sin categoría", 2]]);
  assert.deepEqual(s.duplicateTvgIds, ["d"]);
  assert.ok(ADULT_GROUPS.includes("xxx"));
});

test("summarisePlaylist keys a repeated tvg-id's first entry by the tvg-id, like the app's channel code", () => {
  // The first "d" keeps its tvg-id code, so the id-less copy of its url and name is a channel of its own;
  // the later "d" gets a url-and-name code, and the very same url and name again is the copy skipped.
  const text = "#EXTM3U\n#EXTINF:-1 tvg-id=\"d\",Z\nhttps://c.example.com/z\n#EXTINF:-1 tvg-id=\"d\",W\nhttps://c.example.com/w\n#EXTINF:-1,Z\nhttps://c.example.com/z\n#EXTINF:-1,W\nhttps://c.example.com/w\n";
  const s = summarisePlaylist(text);
  assert.deepEqual([s.channels, s.skipped], [3, 1]);
  assert.deepEqual(s.duplicateTvgIds, ["d"]);
});

test("validate shows the consent lines, the channels line and liveStreamHosts any in red", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-consent-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, capabilities: ["home", "resolve", "channels"], liveStreamHosts: "any" }));
    writeFileSync(join(dir, "plugin.js"), "export async function home(){ return [] }\nexport async function resolve(){ throw kino.error('not_found') }\nexport async function liveCategories(){ return [] }\nexport async function liveChannels(){ return { items: [] } }");
    const r = await validate(dir);
    assert.deepEqual(r.consent, [
      { text: "Agrega canales en vivo a la pestaña En vivo", danger: false },
      { text: "Puede reproducir canales desde cualquier servidor que indique su lista", danger: true },
    ]);
    const err = (() => { try { execFileSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8", stdio: "pipe" }); } catch (e) { return e; } return null; })();
    assert.equal(err, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run liveCategories downloads and parses each playlist, as the app would", async (t) => {
  if (!needFixtures(t)) return;
  const dir = mkdtempSync(join(tmpdir(), "kino-pl-"));
  const bytes = { "https://cdn.example.com/broken.m3u": readFileSync(join(fixtures, "broken.m3u")), "https://cdn.example.com/empty.m3u": Buffer.from("#EXTM3U\n") };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([String(url), init.headers["User-Agent"]]);
    const b = bytes[String(url)];
    return b ? new Response(b, { status: 200 }) : new Response("no", { status: 404 });
  };
  try {
    // The list's streams are on live.example.com: without it declared every entry is refused.
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, hosts: ["cdn.example.com", "live.example.com"], capabilities: ["home", "resolve", "channels"] }));
    const cats = (urls) => `export async function home(){ return [] }\nexport async function resolve(){ return { url: 'https://cdn.example.com/a.m3u8' } }\nexport async function liveCategories(){ return ${JSON.stringify(urls.map((url) => ({ playlist: { url, format: "m3u", headers: { "User-Agent": "Kit/1" } } })))} }\nexport async function liveChannels(){ return { items: [] } }`;
    writeFileSync(join(dir, "plugin.js"), cats(["https://cdn.example.com/broken.m3u"]));
    const ok = await validate(dir, { run: "liveCategories", fetchImpl });
    assert.deepEqual(ok.problems, []);
    assert.ok(ok.drops.includes("playlist https://cdn.example.com/broken.m3u: 5 entries dropped"), ok.drops.join("\n"));
    assert.deepEqual(seen, [["https://cdn.example.com/broken.m3u", "Kit/1"]]);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, hosts: ["cdn.example.com"], capabilities: ["home", "resolve", "channels"] }));
    const refusedHosts = await validate(dir, { run: "liveCategories", fetchImpl });
    assert.ok(refusedHosts.problems.some((p) => p.includes("0 channels (8 entries dropped")), refusedHosts.problems.join("\n"));
    writeFileSync(join(dir, "plugin.js"), cats(["https://cdn.example.com/empty.m3u", "https://cdn.example.com/missing.m3u"]));
    const bad = await validate(dir, { run: "liveCategories", fetchImpl });
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => p.startsWith("playlist https://cdn.example.com/empty.m3u") && p.includes("0 channels")), bad.problems.join("\n"));
    assert.ok(bad.problems.some((p) => p.startsWith("playlist https://cdn.example.com/missing.m3u") && p.includes("404")), bad.problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("liveStreamHosts any: a channel's inline stream may be on any public host, never a local one, its subtitles still strict", () => {
  const m = validateManifest(manifest({ apiVersion: 3, hosts: ["cdn.example.com"], capabilities: ["home", "resolve", "channels"], liveStreamHosts: "any" })).manifest;
  const page = checkOutput("liveChannels", { items: [
    { id: "a", title: "A", stream: { url: "http://8.8.8.8/a.m3u8", subtitles: [{ url: "https://subs.example.org/a.vtt", lang: "es" }] } },
    { id: "b", title: "B", stream: { url: "http://192.168.1.5/b.m3u8" } },
    { id: "c", title: "C", stream: { url: "https://iptv.example.org/c.m3u8" } },
  ] }, m);
  assert.deepEqual(page.value.items.map((c) => c.id), ["a", "c"]);
  assert.deepEqual(page.value.items[0].stream.subtitles, []);
  const strict = validateManifest(manifest({ apiVersion: 3, hosts: ["cdn.example.com"], capabilities: ["home", "resolve", "channels"] })).manifest;
  assert.deepEqual(checkOutput("liveChannels", { items: [{ id: "c", title: "C", stream: { url: "https://iptv.example.org/c.m3u8" } }] }, strict).value.items, []);
});

test("every guide in the shared corpus has its .expected.json and is checked here", (t) => {
  if (!needFixtures(t)) return;
  const guides = readdirSync(fixtures).filter((f) => /\.xml(\.gz)?$/.test(f)).sort();
  assert.deepEqual(guides, ["guide-doctype-comment.xml", "guide-latin1.xml", "guide-windows1252.xml", "guide-xxe.xml", "guide.xml", "guide.xml.gz"]);
});

test("run.mjs live playlist --epg says why a guide declaring a DOCTYPE shows nothing", (t) => {
  if (!needFixtures(t)) return;
  const out = execFileSync(process.execPath, [join(here, "..", "run.mjs"), "live", "playlist", join(fixtures, "basic.m3u"), "--epg", join(fixtures, "guide-xxe.xml")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /The guide declares a DOCTYPE; Kino refuses it for safety/);
});

// A token-per-channel plugin under liveStreamHosts "any": resolve() of a channel's ref answers a URL
// on any public host, which the app accepts because the ref is a live channel's.
function anyLivePlugin(resolveUrl) {
  const dir = mkdtempSync(join(tmpdir(), "kino-anylive-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, hosts: ["api.example.com"], capabilities: ["home", "resolve", "channels"], liveStreamHosts: "any" }));
  writeFileSync(join(dir, "plugin.js"), `export async function home(){ return [] }
export async function liveCategories(){ return [{ id: "news", title: "Noticias" }] }
export async function liveChannels(){ return { items: [{ id: "c1", title: "Uno", ref: "r1" }, { id: "c2", title: "Dos", ref: "r2" }] } }
export async function resolve(ref){ return { url: ${JSON.stringify(resolveUrl)} + "?ref=" + ref } }`);
  return dir;
}
const runCli = (args) => {
  const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("checkOutput resolve: liveStreamHosts any applies only when the ref is a live channel's", () => {
  const m = validateManifest(manifest({ apiVersion: 3, hosts: ["api.example.com"], capabilities: ["home", "resolve", "channels"], liveStreamHosts: "any" })).manifest;
  assert.throws(() => checkOutput("resolve", { url: "http://8.8.8.8/a.m3u8" }, m), /no declaró|https/);
  assert.equal(checkOutput("resolve", { url: "http://8.8.8.8/a.m3u8" }, m, [], { liveChannel: true }).value.url, "http://8.8.8.8/a.m3u8");
  assert.throws(() => checkOutput("resolve", { url: "http://192.168.1.4/a.m3u8" }, m, [], { liveChannel: true }), /local/);
});

test("run.mjs resolve: refused by host under any gives the --live hint, and --live accepts it", () => {
  const dir = anyLivePlugin("http://8.8.8.8/live.m3u8");
  try {
    const plain = runCli([dir, "resolve", "r1"]);
    assert.equal(plain.code, 1);
    assert.match(plain.stderr, /if this ref is a live channel's, try --live/);
    const live = runCli([dir, "resolve", "r1", "--live"]);
    assert.equal(live.code, 0, live.stderr);
    assert.equal(JSON.parse(live.stdout).url, "http://8.8.8.8/live.m3u8?ref=r1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs live channels resolves the first channel's ref as a live channel", () => {
  const dir = anyLivePlugin("http://8.8.8.8/live.m3u8");
  try {
    const r = runCli([dir, "live", "channels", "news"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /resolve\(r1\) → http:\/\/8\.8\.8\.8\/live\.m3u8\?ref=r1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run liveChannels follows the first ref through resolve as a live channel", async () => {
  const ok = anyLivePlugin("http://8.8.8.8/live.m3u8");
  const local = anyLivePlugin("http://192.168.1.4/live.m3u8");
  try {
    assert.deepEqual((await validate(ok, { run: "liveChannels", args: ["news"] })).problems, []);
    const bad = await validate(local, { run: "liveChannels", args: ["news"] });
    assert.ok(bad.problems.some((p) => p.startsWith("resolve(r1)") && p.includes("local")), bad.problems.join("\n"));
  } finally {
    rmSync(ok, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  }
});

const listSetting = (extra = {}) => ({ key: "sources", label: "Direcciones", type: "list", fields: [{ key: "url", label: "Dirección", type: "url", required: true }, { key: "category", label: "Categoría", type: "text" }], ...extra });

test("a list setting needs apiVersion 4 and valid fields, like the app", () => {
  const m = (api, s) => validateManifest(JSON.stringify({ ...JSON.parse(manifest()), apiVersion: api, settings: [s] }));
  assert.equal(m(4, listSetting()).ok, true);
  assert.equal(m(3, listSetting()).message, 'The setting "sources" is a list: it needs apiVersion 4');
  assert.equal(m(4, listSetting({ max: 51 })).message, '"max" of the setting "sources" goes from 1 to 50');
  assert.equal(m(4, listSetting({ fields: [] })).message, 'The setting "sources" needs 1 to 4 fields');
  assert.equal(m(4, { key: "k", label: "x", type: "text", fields: [] }).message, 'Only a setting of type list has "fields" ("k")');
});

test("the url fields of a list are the servers the plugin may reach", async () => {
  const { createKino } = await import("../kino-shim.mjs");
  const mf = { ...JSON.parse(manifest()), apiVersion: 4, hosts: [], settings: [listSetting()] };
  const { kino, servers } = createKino(mf, { config: { sources: [{ url: " https://my.server:8443/x ", category: " A ", extra: "z" }, { url: "", category: "" }] } });
  assert.deepEqual(kino.config.get("sources"), [{ url: "https://my.server:8443/x", category: "A" }]);
  assert.deepEqual(servers, ["https://my.server:8443/x"]);
});

test("streamHosts any (apiVersion 4) lets a movie's stream be on any public host, and nothing else", () => {
  const base = { ...JSON.parse(manifest()), apiVersion: 4, streamHosts: "any" };
  const r = validateManifest(JSON.stringify(base));
  assert.equal(r.ok, true);
  assert.equal(r.manifest.streamHostsAny, true);
  assert.equal(validateManifest(JSON.stringify({ ...base, streamHosts: "all" })).message, 'The "streamHosts" field only takes "any"');
  assert.equal(validateManifest(JSON.stringify({ ...base, apiVersion: 3 })).manifest.streamHostsAny, false);
  const out = checkOutput("resolve", { url: "https://cdn.random-tld.xyz/v.mp4" }, r.manifest, []);
  assert.equal(out.value.url, "https://cdn.random-tld.xyz/v.mp4");
  assert.throws(() => checkOutput("resolve", { url: "http://192.168.1.20/v.mp4" }, r.manifest, []), /local/);
});

test("fetchHosts: only \"any\" at apiVersion 4, ignored below it, and the app's Spanish message", () => {
  const ok = validateManifest(manifest({ apiVersion: 4, fetchHosts: "any" }));
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.fetchHostsAny, true);
  assert.equal(validateManifest(manifest({ apiVersion: 4 })).manifest.fetchHostsAny, false);
  for (const value of ["all", true, ["any"], null, ""]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 4, fetchHosts: value })),
      { ok: false, field: "fetchHosts", message: 'The "fetchHosts" field only takes "any"' });
  }
  // Below apiVersion 4 the app does not know the field: any value is ignored, never refused.
  for (const apiVersion of [1, 2, 3]) {
    for (const value of ["any", "all", 7]) {
      const ignored = validateManifest(manifest({ apiVersion, fetchHosts: value }));
      assert.equal(ignored.ok, true);
      assert.equal(ignored.manifest.fetchHostsAny, false);
    }
  }
  assert.deepEqual(contract.manifest.fetchHosts, { value: "any", apiVersion: 4, handWrittenApiVersion: 9, consentLine: "Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)" });
  // No consent line below apiVersion 9: there the app shows its red line only for a Nuvio-converted plugin.
  assert.deepEqual(consentLines(ok.manifest), []);
  assert.deepEqual(consentLines(validateManifest(manifest({ apiVersion: 9, fetchHosts: "any" })).manifest), [{ text: "Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)", danger: true }]);
});

test("fetchHosts on a hand-written plugin: below apiVersion 9 validate warns that Kino ignores it, from 9 it is a red consent line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-fetchhosts-"));
  const warning = "fetchHosts only takes effect on plugins converted from Nuvio or, on one written by hand, from apiVersion 9 (Kino 0.9.55); in your plugin it is ignored";
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    for (const apiVersion of [4, 5, 6, 7]) {
      writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion, fetchHosts: "any" }));
      const r = await validate(dir);
      assert.equal(r.ok, true);
      assert.ok(r.notes.includes(warning), `apiVersion ${apiVersion}`);
      assert.ok(!r.consent.some((l) => l.text === contract.manifest.fetchHosts.consentLine));
    }
    const cli = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(cli.status, 0);
    assert.ok(cli.stderr.includes(warning));
    // apiVersion 9 (Kino 0.9.55): honoured after the person approves its red line; nothing to warn about.
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 9, fetchHosts: "any" }));
    const v8 = await validate(dir);
    assert.equal(v8.ok, true);
    assert.ok(!v8.notes.some((n) => n.includes("fetchHosts")), v8.notes.join("\n"));
    assert.deepEqual(v8.consent.filter((l) => l.text === "Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)"), [{ text: "Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)", danger: true }]);
    // Ignored below apiVersion 4: no warning, as there is nothing Kino reads.
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 3, fetchHosts: "any" }));
    assert.deepEqual((await validate(dir)).notes, []);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 4, fetchHosts: "all" }));
    const bad = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /fetchHosts: The "fetchHosts" field only takes "any"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kino.device (Kino 0.9.55): phone by default, tv with --device tv or KINO_DEVICE=tv, read-only; lang and appVersion beside it", () => {
  const { $comment, ...device } = contract.kinoDevice;
  assert.deepEqual(device, { values: ["phone", "tv"], default: "phone", kitEnv: "KINO_DEVICE", kitFlag: "--device" });
  const m = JSON.parse(manifest({}));
  const phone = createKino(m, { env: {} }).kino;
  assert.equal(phone.device, "phone");
  assert.equal(phone.lang, "es-CO");
  assert.equal(phone.appVersion, "sdk");
  assert.equal(createKino(m, { env: { KINO_DEVICE: "tv" } }).kino.device, "tv");
  // The option (run.mjs --device) wins over the environment.
  const tv = createKino(m, { device: "tv", env: { KINO_DEVICE: "phone" }, lang: "en-US" }).kino;
  assert.equal(tv.device, "tv");
  assert.equal(tv.lang, "en-US");
  assert.throws(() => createKino(m, { device: "tablet", env: {} }), /device must be "phone" or "tv"/);
  assert.throws(() => createKino(m, { env: { KINO_DEVICE: "watch" } }), /KINO_DEVICE must be "phone" or "tv"/);
  assert.throws(() => { tv.device = "phone"; }, TypeError);
  assert.equal(tv.device, "tv");
  assert.equal(parseArgs(["--device", "tv", "p.js", "home"]).opts.device, "tv");
  assert.equal(parseArgs(["p.js", "home"]).opts.device, null);
  assert.throws(() => parseArgs(["--device", "tablet", "p.js", "home"]), /--device takes phone or tv/);
});

test("fetchHosts any at apiVersion 9: kino.fetch reaches an undeclared public host, never the home network nor a sealed value elsewhere", async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url)); return new Response("hola", { headers: { "content-type": "text/plain" } }); };
  const v8 = createKino(JSON.parse(manifest({ apiVersion: 9, fetchHosts: "any" })), { fetchImpl }).kino;
  assert.equal((await v8.fetch("https://cdn-42.rotating.example.net/a")).text(), "hola");
  assert.equal((await v8.fetch("https://8.8.8.8/b")).text(), "hola");
  for (const url of ["https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.2/x", "https://192.168.1.10/x", "https://169.254.169.254/x", "https://[::1]/x", "https://router.local/x", "https://nas.lan/x", "https://router/x"]) {
    await assert.rejects(v8.fetch(url), (e) => e.code === "host_not_allowed", url);
  }
  // The validated manifest (what run.mjs hands the shim) behaves the same.
  const checked = validateManifest(manifest({ apiVersion: 9, fetchHosts: "any" })).manifest;
  assert.equal((await createKino(checked, { fetchImpl }).kino.fetch("https://other.example.org/c")).text(), "hola");
  // kino.fetchAnyHost (Kino 0.9.55) says so; false when the kit, like the app, keeps kino.fetch on the hosts.
  assert.equal(v8.fetchAnyHost, true);
  assert.equal(createKino(JSON.parse(manifest({ apiVersion: 9 })), { fetchImpl }).kino.fetchAnyHost, false);
  assert.equal(createKino(JSON.parse(manifest({ apiVersion: 7, fetchHosts: "any" })), { fetchImpl }).kino.fetchAnyHost, false);
  // apiVersion 7: limited to its hosts, as before.
  const v7 = createKino(JSON.parse(manifest({ apiVersion: 7, fetchHosts: "any" })), { fetchImpl }).kino;
  await assert.rejects(v7.fetch("https://cdn-42.rotating.example.net/a"), (e) => e.code === "host_not_allowed");
  assert.deepEqual(seen, ["https://cdn-42.rotating.example.net/a", "https://8.8.8.8/b", "https://other.example.org/c"]);
  // A sealed value still goes only to the manifest's own hosts over https.
  const { kino: sealed, dir } = sealedKino({ apiKey: "k-123" }, { apiVersion: 9, fetchHosts: "any" });
  try {
    await assert.rejects(sealed.fetch("https://cdn-42.rotating.example.net/a?k=" + sealed.secret("apiKey")),
      (e) => e.code === "host_not_allowed" && e.message === "this plugin can't send sealed data to cdn-42.rotating.example.net");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchHosts any: a host reached only through it is https on the default port and a dotted public name; declared hosts keep their rules", async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url)); return new Response("hola", { headers: { "content-type": "text/plain" } }); };
  const m = validateManifest(JSON.stringify({ ...JSON.parse(manifest({ apiVersion: 9, fetchHosts: "any" })), hosts: ["declared.example.com", { host: "old.example.com", insecureHttp: true }] })).manifest;
  const { kino } = createKino(m, { fetchImpl });
  for (const url of ["http://mirror.example.org/x", "https://mirror.example.org:8443/x", "http://8.8.8.8/x", "https://8.8.8.8:8080/x", "https://router/x", "https://nas./x"]) {
    await assert.rejects(kino.fetch(url), (e) => e.code === "host_not_allowed" && /fetchHosts/.test(e.message) && typeof e.host === "string", url);
  }
  // A redirect through the grant to plain http is refused before it goes out.
  const redirecting = createKino(m, { fetchImpl: async (url) => { seen.push(String(url)); return new Response("", { status: 302, headers: { location: "http://cdn.example.net/b" } }); } }).kino;
  await assert.rejects(redirecting.fetch("https://mirror.example.org/a"), (e) => e.code === "host_not_allowed");
  // Declared hosts: an insecureHttp one keeps plain http on any port, a declared https one any port.
  assert.equal((await kino.fetch("http://old.example.com:8080/x")).text(), "hola");
  assert.equal((await kino.fetch("https://declared.example.com:8443/x")).text(), "hola");
  await assert.rejects(kino.fetch("http://declared.example.com/x"), (e) => e.code === "host_not_allowed" && e.message === "only https is allowed");
  assert.deepEqual(seen, ["https://mirror.example.org/a", "http://old.example.com:8080/x", "https://declared.example.com:8443/x"]);
});

test("fetchHosts any: the request budget of hosts reached through it, per site a minute and per plugin every ten minutes", async () => {
  const { $comment, ...anyHost } = contract.fetch.anyHost;
  assert.equal(typeof $comment, "string");
  assert.deepEqual(anyHost, {
    schemes: ["https"], port: 443, singleLabelNames: false,
    perSite: 60, perSiteWindowMs: 60000, perPlugin: 600, perPluginWindowMs: 600000, nuvioPerSite: 250, nuvioPerPlugin: 2500,
    errorCode: "rate_limited",
  });
  assert.ok(contract.fetch.errorCodes.includes("rate_limited"));
  let t = 1_000_000;
  let n = 0;
  const fetchImpl = async () => { n++; return new Response("hola", { headers: { "content-type": "text/plain" } }); };
  const m = { ...JSON.parse(manifest({ apiVersion: 9, fetchHosts: "any" })), hosts: ["declared.example.com"] };
  const shim = createKino(m, { fetchImpl, now: () => t });
  const { kino } = shim;
  // One site (its subdomains together): 60 a minute.
  for (let i = 0; i < 60; i++) await kino.fetch(`https://s${i % 3}.mirror.example.org/x`);
  shim.resetBudget();
  await assert.rejects(kino.fetch("https://cdn.mirror.example.org/x"), (e) => e.code === "rate_limited" && /fetchHosts/.test(e.message) && /60/.test(e.message));
  t += 1000;
  assert.equal((await kino.fetch("https://mirror.example.org/x")).text(), "hola");
  // The plugin: 600 every ten minutes in all.
  for (let site = 0; site < 9; site++) {
    shim.resetBudget();
    for (let i = 0; i < 60; i++) await kino.fetch(`https://www.mirror${site}.net/x`);
  }
  shim.resetBudget();
  await assert.rejects(kino.fetch("https://fresh-site.net/x"), (e) => e.code === "rate_limited" && /600/.test(e.message));
  // Declared hosts never spend it.
  for (let i = 0; i < 59; i++) await kino.fetch("https://declared.example.com/x");
  // It refills.
  t += 600_000;
  shim.resetBudget();
  for (let i = 0; i < 60; i++) await kino.fetch("https://again-site.net/x");
  assert.equal(n, 60 + 1 + 540 + 59 + 60);
});

test("streamHosts any covers a movie's side subtitles and audio too, never a channel's, like the broad video permission", () => {
  const m = validateManifest(JSON.stringify({ ...JSON.parse(manifest()), apiVersion: 4, streamHosts: "any" })).manifest;
  const value = {
    url: "https://cdn.random-tld.xyz/v.m3u8",
    subtitles: [{ lang: "es", url: "https://subs.elsewhere.org/es.vtt" }, { lang: "en", url: "http://10.0.0.5/en.vtt" }],
    audioTracks: [{ lang: "es", url: "https://audio.elsewhere.org/es.m4a" }],
  };
  const movie = checkOutput("resolve", value, m, []).value;
  assert.deepEqual(movie.subtitles.map((s) => s.lang), ["es"]);
  assert.equal(movie.audioTracks.length, 1);
  const channel = checkOutput("resolve", value, m, [], { liveChannel: true }).value;
  assert.equal(channel.url, value.url);
  assert.equal(channel.subtitles.length, 0);
  assert.equal(channel.audioTracks.length, 0);
});

/** Like sealedKino, but [encodings] names typed cipher keys ({ seal, use, encoding } in the manifest). */
function typedKino(plainValues, encodings, fetchImpl = () => { throw new Error("must not reach the network"); }) {
  const { dir, file } = withSecretsFile(plainValues);
  const secrets = Object.fromEntries(Object.keys(plainValues).map((k) => [k, encodings[k] ? { seal: "x", use: "cipher-key", encoding: encodings[k] } : "x"]));
  const m = JSON.parse(manifest({ apiVersion: 6, hosts: ["api.example.com"], secrets }));
  const { kino } = createKino(m, { secretsFile: file, fetchImpl });
  return { kino, dir };
}

const DES_HEX = "0123456789abcdef23456789abcdef01456789abcdef0123";
const AES_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const REFUSED = (e) => e.code === "crypto_error" && e.message === "a sealed value can't be used here";

test("kino.crypto: a typed hex key is a whole des-ede3 key, whatever keyEncoding the JS passes", () => {
  const { kino } = typedKino({ desKey: DES_HEX }, { desKey: "hex" });
  const m = kino.secret("desKey");
  const want = kino.crypto.encrypt("des-ede3-ecb", { key: DES_HEX, keyEncoding: "hex", data: "hola" });
  for (const keyEncoding of [undefined, "utf8", "base64"]) assert.equal(kino.crypto.encrypt("des-ede3-ecb", { key: m, keyEncoding, data: "hola" }), want);
  assert.equal(kino.crypto.decrypt("des-ede3-ecb", { key: m, data: want }), "hola");
});

test("kino.crypto: a typed base64 key works for AES; a wrong size names the size", () => {
  const { kino } = typedKino({ aesKey: AES_B64, shortKey: "00112233445566778899aabbccddeeff" }, { aesKey: "base64", shortKey: "hex" });
  const iv = "000102030405060708090a0b0c0d0e0f";
  assert.equal(kino.crypto.encrypt("aes-256-cbc", { key: kino.secret("aesKey"), iv, ivEncoding: "hex", data: "hola" }),
    kino.crypto.encrypt("aes-256-cbc", { key: AES_B64, keyEncoding: "base64", iv, ivEncoding: "hex", data: "hola" }));
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: kino.secret("shortKey"), data: "hola" }),
    (e) => e.code === "crypto_error" && e.message === "the des-ede3-ecb key must be 24 bytes, it is 16");
});

test("kino.crypto: a typed key is still exactly one marker, and never data, iv, hmac or pbkdf2", () => {
  const { kino } = typedKino({ desKey: DES_HEX, hmacKey: "hm4c" }, { desKey: "hex" });
  const m = kino.secret("desKey"), h = kino.secret("hmacKey");
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: m + "A", data: "hola" }), REFUSED);
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: "x" + m, data: "hola" }), REFUSED);
  assert.throws(() => kino.crypto.encrypt("aes-128-ecb", { key: "0123456789abcdef", data: m }), REFUSED);
  assert.throws(() => kino.crypto.encrypt("aes-128-cbc", { key: "0123456789abcdef", iv: m, data: "hola" }), REFUSED);
  assert.throws(() => kino.crypto.hmac("sha256", m, "datos"), REFUSED);
  assert.throws(() => kino.crypto.hmac("sha256", h + m, "datos"), REFUSED);
  assert.throws(() => kino.crypto.pbkdf2("sha256", m, "salt", 10, 32), REFUSED);
  assert.throws(() => kino.crypto.pbkdf2("sha256", "pw", m, 10, 32), REFUSED);
  assert.equal(kino.crypto.hmac("sha1", h, "base"), kino.crypto.hmac("sha1", "hm4c", "base"));
});

test("kino.crypto: an untyped sealed key is still refused for des-ede3 at apiVersion 6", () => {
  const { kino } = typedKino({ desKey: "0123456789abcdefghijklmn" }, {});
  assert.throws(() => kino.crypto.encrypt("des-ede3-ecb", { key: kino.secret("desKey"), data: "hola" }), REFUSED);
});

test("a typed key's bytes, in hex of either case or base64, come back from a server as the marker", async () => {
  const echo = [DES_HEX.toUpperCase(), Buffer.from(DES_HEX, "hex").toString("base64")].join("|");
  const { kino } = typedKino({ desKey: DES_HEX }, { desKey: "hex" }, async () => new Response(echo));
  const m = kino.secret("desKey");
  const r = await kino.fetch("https://api.example.com/x");
  assert.equal(r.text(), `${m}|${m}`);
});

test("kino.fetch: a typed key's marker is refused in the url, headers and every body kind; an untyped one still goes out", async () => {
  const seen = [];
  const { kino } = typedKino({ desKey: DES_HEX, token: "t0k" }, { desKey: "hex" }, async (u, init) => { seen.push(init.headers); return new Response("ok"); });
  const m = kino.secret("desKey");
  const refused = (e) => e.code === "invalid_request" && e.message === "a sealed value can't be used here";
  const U = "https://api.example.com/x";
  await assert.rejects(kino.fetch(`${U}?k=${m}`), refused);
  await assert.rejects(kino.fetch(U, { headers: { "X-K": m } }), refused);
  await assert.rejects(kino.fetch(U, { method: "POST", body: m }), refused);
  await assert.rejects(kino.fetch(U, { method: "POST", body: { json: { k: m } } }), refused);
  await assert.rejects(kino.fetch(U, { method: "POST", body: { form: { k: m } } }), refused);
  assert.equal(seen.length, 0);
  const r = await kino.fetch(U, { headers: { "X-T": kino.secret("token") } });
  assert.equal(r.status, 200);
});

test("migrate: the kit keeps what the app keeps", () => {
  const m = JSON.parse(manifest({ apiVersion: 6, capabilities: ["search", "resolve", "migrate"] }));
  const title = { kind: "title", ref: "old:42" };
  const keep = (v, input = title) => checkOutput("migrate", v, m, [], { migrateInput: input });
  assert.deepEqual(keep({ kind: "movie", id: "m42", ref: "R42" }).value, { kind: "movie", id: "m42", ref: "R42" });
  assert.equal(keep(null).value, null);
  assert.equal(keep(undefined).value, null);
  for (const bad of ["plg1:x", 42, [], { kind: "episode", id: "m", ref: "r" }, { kind: "movie", id: "a b", ref: "r" },
    { kind: "movie", id: "m", ref: "" }, { kind: "movie", id: "m", ref: "plg1:other:abc" }]) {
    const r = keep(bad);
    assert.equal(r.value, null, JSON.stringify(bad));
    assert.equal(r.drops.length, 1, JSON.stringify(bad));
  }
  const chapter = { kind: "chapter", ref: "old:42:3", season: 1, episode: 3 };
  assert.deepEqual(keep({ kind: "episode", ref: "E3", number: 3 }, chapter).value, { kind: "episode", ref: "E3", season: 1, number: 3 });
  assert.equal(keep({ kind: "episode", ref: "E3", number: 0 }, chapter).value, null);
  const live = { kind: "live", provider: "oldtv", code: "7" };
  assert.deepEqual(keep({ kind: "live", code: "c-7" }, live).value, { kind: "live", code: "c-7" });
  assert.equal(keep({ kind: "live", code: "a:b" }, live).value, null);
});

test("migrate: a music or podcast title is claimed only from an apiVersion 8 plugin, as the app does", () => {
  const title = { kind: "title", ref: "old:42" };
  const keep = (apiVersion, v) => checkOutput("migrate", v, JSON.parse(manifest({ apiVersion, capabilities: ["search", "resolve", "migrate"] })), [], { migrateInput: title });
  assert.deepEqual(keep(8, { kind: "music", id: "a1", ref: "A" }).value, { kind: "music", id: "a1", ref: "A" });
  assert.deepEqual(keep(8, { kind: "podcast", id: "p1", ref: "P" }).value, { kind: "podcast", id: "p1", ref: "P" });
  const old = keep(7, { kind: "music", id: "a1", ref: "A" });
  assert.equal(old.value, null);
  assert.deepEqual(old.drops, ['migrate: a title answered kind "music", which needs apiVersion 8']);
  assert.equal(checkOutput("migrate", { kind: "music", id: "a1", ref: "A" }, JSON.parse(manifest({ apiVersion: 8, capabilities: ["search", "resolve", "migrate"] })), [],
    { migrateInput: { kind: "chapter", ref: "x", season: 1, episode: 1 } }).value, null);
  assert.deepEqual(contract.output.migrateKinds, ["movie", "series", "episode", "live", ...contract.output.audioKinds]);
});

test("run.mjs passes migrate its input object", async () => {
  const plugin = { migrate: async (input) => input };
  assert.deepEqual(await call(plugin, "migrate", ['{"kind":"title","ref":"x"}']), { kind: "title", ref: "x" });
});

test("migrate is a capability that needs apiVersion 6", () => {
  const r = validateManifest(manifest({ apiVersion: 4, capabilities: ["search", "resolve", "migrate"] }));
  assert.equal(r.ok, false);
  assert.equal(r.message, 'The "migrate" capability needs apiVersion 6');
  assert.ok(validateManifest(manifest({ apiVersion: 6, capabilities: ["search", "resolve", "migrate"] })).ok);
});

const v6 = (extra = {}) => ({ id: "demo", name: "Demo", version: "1.0.0", apiVersion: 6, entry: "plugin.js",
  hosts: ["cdn.example"], capabilities: ["search", "resolve"], ...extra });

test("apiVersion 6: a stream may ask for per-request signing, HLS only, never with drm or audio", () => {
  const ok = checkOutput("resolve", { url: "https://cdn.example/a/index.m3u8", signing: "request", signContext: "c" }, v6()).value;
  assert.equal(ok.signing, true);
  assert.equal(ok.signContext, "c");
  assert.equal(checkOutput("resolve", { url: "https://cdn.example/a", mime: "Application/X-MpegURL ", signing: "request" }, v6()).value.signing, true);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.mp4", signing: "request" }, v6()), /only works with HLS video/);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", audioTracks: [{ lang: "en", url: "https://cdn.example/en.aac" }] }, v6()), /can't carry drm or separate audio tracks/);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "segment" }, v6()), /the "signing" value is not valid/);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: "x".repeat(4097) }, v6()), /the "signContext" value is not valid/);
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: 7 }, v6()), /the "signContext" value is not valid/);
  assert.equal(checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: "x".repeat(4096) }, v6()).value.signContext.length, 4096);
  const v4 = checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: "c" }, { ...v6(), apiVersion: 4 }).value;
  assert.equal(v4.signing, undefined);
  assert.equal(v4.signContext, undefined);
});

test("a kino.secret() marker in signContext is refused like the app refuses it", () => {
  assert.throws(() => checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: JSON.stringify({ key: "__kinoSecret_k_ab12__" }) }, v6()),
    /signContext can't carry a kino.secret\(\): call it inside sign\(\)/);
});

test("an inline liveChannels stream may not ask for signing", () => {
  const m = v6({ capabilities: ["search", "resolve", "channels"] });
  const page = (stream) => checkOutput("liveChannels", { items: [{ id: "c1", title: "C", stream }], next: null }, m);
  assert.equal(page({ url: "https://cdn.example/a.m3u8" }).value.items.length, 1);
  const refused = page({ url: "https://cdn.example/a.m3u8", signing: "request" });
  assert.equal(refused.value.items.length, 0);
  assert.match(refused.drops.join("\n"), /must play through resolve\(\)/);
});

test("a channel with a ref and a signed inline stream plays through resolve(ref), as in the app", () => {
  const m = v6({ capabilities: ["search", "resolve", "channels"] });
  const out = checkOutput("liveChannels", { items: [{ id: "c1", title: "C", ref: "r1", stream: { url: "https://cdn.example/a.m3u8", signing: "request" } }], next: null }, m);
  assert.equal(out.value.items.length, 1);
  assert.equal(out.value.items[0].ref, "r1");
  assert.equal(out.value.items[0].stream, null);
});

test("sign answers { headers }, filtered like a stream's, and never a sealed marker", () => {
  assert.deepEqual(checkOutput("sign", { headers: { "Content-Auth": "a", Host: "x" } }, v6()).value, { headers: { "Content-Auth": "a" } });
  assert.throws(() => checkOutput("sign", { headers: { "X-K": "__kinoSecret_k_ab__" } }, v6()), /can't return sealed data/);
  // A marker in a NAME never gets that far: "_" is not a header-name character, so the app drops it like any bad name.
  assert.deepEqual(checkOutput("sign", { headers: { "X-__kinoSecret_k_ab__": "v", "X-Ok": "1" } }, v6()).value, { headers: { "X-Ok": "1" } });
  assert.throws(() => checkOutput("sign", null, v6()), /sign didn't return \{ headers \}/);
  assert.throws(() => checkOutput("sign", { headers: [] }, v6()), /sign didn't return \{ headers \}/);
});

test("the signing lane refuses the network, storage, cookies and sleep as the app's does", async () => {
  const { kino } = createKino(v6());
  const lane = signingLane(kino);
  const why = (api) => `sign() can't use ${api}: whatever you need must come in signContext`;
  await assert.rejects(async () => lane.fetch("https://cdn.example/"), (e) => e.code === "host_not_allowed" && e.message === "sign can't use the network" && e.host === undefined);
  for (const m of ["get", "set", "remove", "keys"]) {
    assert.throws(() => lane.storage[m]("k"), (e) => e.code === "not_allowed" && e.message === why("kino.storage"));
  }
  for (const m of ["get", "clear"]) {
    assert.throws(() => lane.cookies[m]("https://cdn.example/", "k"), (e) => e.code === "not_allowed" && e.message === why("kino.cookies"));
  }
  await assert.rejects(async () => lane.sleep(1), (e) => e.code === "not_allowed" && e.message === why("kino.sleep"));
  assert.equal(lane.crypto, kino.crypto);
  assert.equal(lane.secret, kino.secret);
  assert.equal(lane.config, kino.config);
  assert.equal(lane.log, kino.log);
  assert.throws(() => { lane.fetch = 1; }, TypeError);
});

test("run.mjs calls sign with its JSON argument and resolve with a retry", async () => {
  const plugin = {
    sign: async (r) => ({ headers: { "X-Sig": r.kind + ":" + r.context } }),
    resolve: async (ref, opts) => ({ url: "https://cdn.example/" + ref + (opts ? "-" + opts.retry.reason + opts.retry.attempt : "") + ".m3u8" }),
  };
  assert.deepEqual(await call(plugin, "sign", ['{"url":"https://cdn.example/a.ts","kind":"segment","ref":"R","context":"c"}']), { headers: { "X-Sig": "segment:c" } });
  assert.equal((await call(plugin, "resolve", ["R"], { retry: { reason: "conflict", attempt: 1 } })).url, "https://cdn.example/R-conflict1.m3u8");
  assert.equal((await call(plugin, "resolve", ["R"])).url, "https://cdn.example/R.m3u8");
});

test("validate --run resolve and run.mjs refuse a signed stream from a plugin that doesn't export sign, like the app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-nosign-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, hosts: ["cdn.example"] }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\n" +
      "export async function resolve(){ return { url: 'https://cdn.example/a.m3u8', signing: 'request', signContext: 'c' } }");
    const r = await validate(dir, { run: "resolve", args: ["R"] });
    assert.equal(r.ok, false);
    assert.match(r.problems.join("\n"), /the plugin asks to sign the video but doesn't export sign\(\)/);
    const cli = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "resolve", "R"], { encoding: "utf8" });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /the plugin asks to sign the video but doesn't export sign\(\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- alternateHosts (apiVersion 6, only with signing: "request"), as PluginOutput.alternateHostsOf ---

const cdns = () => v6({ hosts: ["cdn.example", ...[2, 3, 4, 5, 6, 7, 8].map((n) => `cdn${n}.example`)] });
const signedWith = (alternateHosts, url = "https://cdn.example/live/a.m3u8") => ({ url, signing: "request", alternateHosts });

test("a signed stream carries its other hosts, lowercased, a default port dropped and another one kept", () => {
  const { value, drops } = checkOutput("resolve", signedWith(["cdn2.example", "CDN3.example:8443", "cdn4.example:443"]), cdns());
  assert.deepEqual(value.alternateHosts, ["cdn2.example", "cdn3.example:8443", "cdn4.example"]);
  assert.deepEqual(drops, []);
  assert.equal(contract.output.signing.alternateHosts.maxEntries, 6);
});

test("an alternate host failing the stream URL's own rule, repeating one, or past six is dropped, never fatal", () => {
  const { value, drops } = checkOutput("resolve", signedWith(["evil.example", "192.168.1.5", "localhost", "cdn.example", "CDN.example:443", "cdn2.example", "cdn2.EXAMPLE",
    "https://cdn3.example", "cdn3.example/x", "[::1]", "cdn4.example:99999", "cdn5.example:0"]), cdns());
  assert.deepEqual(value.alternateHosts, ["cdn2.example"]);
  const all = drops.join("\n");
  assert.match(all, /alternateHosts: evil\.example dropped: the alternate server points to evil\.example, which the plugin didn't declare/);
  assert.match(all, /alternateHosts: cdn\.example repeats the stream's host or another entry, dropped/);
  assert.match(all, /alternateHosts: "cdn3\.example\/x" is not a host or host:port, dropped/);
  const many = checkOutput("resolve", signedWith([2, 3, 4, 5, 6, 7, 8].map((n) => `cdn${n}.example`)), cdns());
  assert.deepEqual(many.value.alternateHosts, [2, 3, 4, 5, 6, 7].map((n) => `cdn${n}.example`));
  assert.deepEqual(many.drops, ["alternateHosts: 6 kept, 1 more ignored"]);
  const long = [...[2, 3, 4, 5, 6, 7].map((n) => `cdn${n}.example`), ...Array.from({ length: 200 }, (_, n) => (n % 2 ? `evil${n}.example` : `bad/${n}`))];
  const capped = checkOutput("resolve", signedWith(long), cdns());
  assert.deepEqual(capped.value.alternateHosts, [2, 3, 4, 5, 6, 7].map((n) => `cdn${n}.example`));
  assert.deepEqual(capped.drops, ["alternateHosts: 6 kept, 200 more ignored"]);
  // Another port of the primary's host is another authority.
  assert.deepEqual(checkOutput("resolve", signedWith(["cdn.example:8080"]), cdns()).value.alternateHosts, ["cdn.example:8080"]);
});

test("alternateHosts of the wrong type refuses the signed stream, and means nothing without signing", () => {
  for (const bad of ["cdn2.example", [5], ["cdn2.example", null], {}, true]) {
    assert.throws(() => checkOutput("resolve", signedWith(bad), cdns()), /the "alternateHosts" value is not valid/, JSON.stringify(bad));
  }
  assert.deepEqual(checkOutput("resolve", signedWith(null), cdns()).value.alternateHosts, []);
  const plain = checkOutput("resolve", { url: "https://cdn.example/live/a.m3u8", alternateHosts: 5 }, cdns()).value;
  assert.notEqual(plain.signing, true);
  assert.deepEqual(plain.alternateHosts, []);
  // Below apiVersion 6 the whole signing block is unknown: nothing kept, nothing refused.
  const v5 = checkOutput("resolve", signedWith(["cdn2.example"]), { ...cdns(), apiVersion: 5 }).value;
  assert.equal(v5.alternateHosts, undefined);
});

test("under liveStreamHosts any an alternate may be any public name or IPv4 literal, never a local one", () => {
  const m = v6({ hosts: ["portal.example"], liveStreamHostsAny: true });
  const { value } = checkOutput("resolve", signedWith(["203.0.113.7:8080", "other-cdn.net", "10.0.0.1", "localhost", "printer.local"], "http://190.2.3.4/live/a.m3u8"), m, [], { liveChannel: true });
  assert.deepEqual(value.alternateHosts, ["203.0.113.7:8080", "other-cdn.net"]);
});

test("validate --run resolve and run.mjs surface the kept alternate hosts and say which were dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-alt-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, hosts: ["cdn.example", "cdn2.example"] }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\n" +
      "export async function resolve(){ return { url: 'https://cdn.example/a.m3u8', signing: 'request', alternateHosts: ['cdn.example', 'cdn2.example', 'evil.example'] } }\n" +
      "export async function sign(r){ return { headers: {} } }");
    const r = await validate(dir, { run: "resolve", args: ["R"] });
    assert.equal(r.ok, true, r.problems.join("\n"));
    assert.deepEqual(r.output.alternateHosts, ["cdn2.example"]);
    assert.match(r.drops.join("\n"), /alternateHosts: cdn\.example repeats the stream's host/);
    assert.match(r.drops.join("\n"), /alternateHosts: evil\.example dropped/);
    const cli = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "resolve", "R"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout).alternateHosts, ["cdn2.example"]);
    assert.match(cli.stderr, /\[dropped by Kino\] alternateHosts: evil\.example dropped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run sign runs sign() in the signing lane, like run.mjs and the app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-lane-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, hosts: ["cdn.example"] }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\n" +
      "export async function resolve(){ return { url: 'https://cdn.example/a.m3u8', signing: 'request' } }\n" +
      "export async function sign(r){ return { headers: { 'X-K': String(kino.storage.get('k')) } } }");
    const r = await validate(dir, { run: "sign", args: ['{"url":"https://cdn.example/a.ts","kind":"segment","ref":"R","context":""}'] });
    assert.equal(r.ok, false);
    assert.match(r.problems.join("\n"), /sign\(\) can't use kino.storage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs --retry parses reason:attempt and refuses what the app would never send", () => {
  assert.deepEqual(parseArgs(["--retry", "expired:2", "p", "resolve", "R"]).opts.retry, { reason: "expired", attempt: 2 });
  assert.throws(() => parseArgs(["--retry", "nope:1"]), /--retry/);
  assert.throws(() => parseArgs(["--retry", "conflict:4"]), /--retry/);
  assert.throws(() => parseArgs(["--retry", "conflict"]), /--retry/);
});

test("below apiVersion 6 a stray confirm key on a setting is ignored, like the app", () => {
  for (const apiVersion of [1, 4]) {
    for (const confirm of ["¿Seguro?", 7]) {
      const r = validateManifest(manifest({ apiVersion, settings: [{ key: "token", label: "Token", type: "text", confirm }] }));
      assert.equal(r.ok, true, r.message);
    }
  }
});

// The app takes 300 characters for a section's explanation (PluginSettings.MAX_SECTION_HINT_CHARS, Kino 0.9.51) and 80
// for any other hint; the kit refused a section over 80, so a manifest the app installs failed validate.mjs.
test("a section's hint may be 300 characters, any other hint 80", () => {
  const base = (settings) => manifest({ apiVersion: 6, settings });
  assert.equal(validateManifest(base([{ key: "intro", label: "Intro", type: "section", hint: "x".repeat(300) }])).ok, true);
  assert.equal(validateManifest(base([{ key: "intro", label: "Intro", type: "section", hint: "x".repeat(301) }])).message, 'The hint of the setting "intro" is over 300 characters');
  assert.equal(validateManifest(base([{ key: "user", label: "Usuario", type: "text", hint: "x".repeat(81) }])).message, 'The hint of the setting "user" is over 80 characters');
});

test("section, status and action settings (apiVersion 6)", () => {
  const base = (api, settings) => manifest({ apiVersion: api, settings });
  const section = { key: "account", label: "Tu cuenta", type: "section", hint: "Opcional" };
  const status = { key: "linked", label: "Estado", type: "status" };
  const action = { key: "logout", label: "Cerrar sesión", type: "action", confirm: "¿Cerrar la sesión?" };
  assert.equal(validateManifest(base(6, [section, status, action])).ok, true);
  for (const [o, t, api] of [4, 5].flatMap((api) => [[section, "section", api], [status, "status", api], [action, "action", api]])) {
    const r = validateManifest(base(api, [o]));
    assert.equal(r.ok, false);
    assert.match(r.message, new RegExp(`is of type ${t}: it needs apiVersion 6$`));
  }
  assert.equal(validateManifest(base(6, [{ ...status, confirm: "x" }])).message, 'Only a setting of type action has "confirm" ("linked")');
  assert.equal(validateManifest(base(6, [{ ...action, confirm: "x".repeat(121) }])).message, '"confirm" of the setting "logout" must be a string of 1 to 120 characters');
  for (const bad of ["x".repeat(121), "  ", 3]) {
    assert.equal(validateManifest(base(6, [{ ...action, confirm: bad }])).message, '"confirm" of the setting "logout" must be a string of 1 to 120 characters');
  }
  // apiVersion 4: the version refusal comes before every other check of the same setting, as in the app.
  const need = (t, key) => `The setting "${key}" is of type ${t}: it needs apiVersion 6`;
  assert.equal(validateManifest(base(4, [{ ...status, required: true }])).message, need("status", "linked"));
  assert.equal(validateManifest(base(4, [{ ...status, hint: "x".repeat(81) }])).message, need("status", "linked"));
  assert.equal(validateManifest(base(4, [action])).message, need("action", "logout"));
  assert.equal(validateManifest(base(6, [{ ...status, required: true }])).message, 'The setting "linked" can\'t be required');
  const values = Array.from({ length: 12 }, (_, i) => ({ key: `v${i}`, label: `V${i}`, type: "text" }));
  const ui = Array.from({ length: 16 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, type: "section" }));
  assert.equal(validateManifest(base(6, [...values, ...ui])).ok, true);
  assert.equal(validateManifest(base(6, [...values.slice(0, 11), ...ui, { key: "s17", label: "S17", type: "section" }])).message, "The plugin has more than 16 sections, statuses or actions");
  assert.equal(validateManifest(base(6, [...values, { key: "v13", label: "V", type: "text" }, ...ui.slice(0, 15)])).message, "The plugin asks for more than 12 settings");
  assert.deepEqual(requiredExports(["search", "resolve"], [section, status, action]).sort(), ["action", "resolve", "search", "settingsStatus"]);
});

// --- clearSettings (apiVersion 6, an action's answer), as PluginSettingsUi.parseActionResult ---

test("an action's clearSettings keeps the plugin's own optional valued settings, once each, and says what it dropped", () => {
  const m = JSON.parse(manifest({ apiVersion: 6, settings: [
    { key: "email", label: "Correo", type: "text", required: true },
    { key: "password", label: "Contraseña", type: "password" },
    { key: "nickname", label: "Apodo", type: "text" },
    { key: "linked", label: "Estado", type: "status" },
    { key: "logout", label: "Salir", type: "action" },
  ] }));
  const drops = [];
  const out = checkSettingsOutput("action", { message: "Sesión cerrada", clearSettings: ["password", "email", "linked", "logout", "ghost", 7, null, "nickname", "password"] }, m, (t) => t, (d) => drops.push(d));
  assert.deepEqual(out, { message: "Sesión cerrada", refresh: false, clearSettings: ["password", "nickname"] });
  assert.equal(drops.length, 1);
  assert.match(drops[0], /clearSettings entries that cannot be cleared/);
  assert.equal(contract.settings.ui.clearSettings.maxEntries, 12);
  // Not an array: ignored and said, the action still succeeded.
  const bad = [];
  assert.deepEqual(checkSettingsOutput("action", { clearSettings: "password" }, m, (t) => t, (d) => bad.push(d)).clearSettings, []);
  assert.match(bad[0], /clearSettings that is not an array/);
  // Read up to the cap only.
  const many = JSON.parse(manifest({ apiVersion: 6, settings: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, type: "text" })) }));
  const keys = Array.from({ length: 40 }, (_, i) => `k${i}`);
  assert.deepEqual(checkSettingsOutput("action", { clearSettings: keys }, many).clearSettings, keys.slice(0, 12));
});

test("run.mjs prints an action's kept clearSettings and which entries Kino dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-clear-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, settings: [
      { key: "email", label: "Correo", type: "text", required: true },
      { key: "password", label: "Contraseña", type: "password" },
      { key: "logout", label: "Salir", type: "action" },
    ] }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\n" +
      "export async function action(k){ return { message: 'Adiós', clearSettings: ['password', 'email'] } }");
    const cli = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "action", "logout"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), { message: "Adiós", refresh: false, clearSettings: ["password"] });
    assert.match(cli.stderr, /\[dropped by Kino\] .*clearSettings entries that cannot be cleared/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("settingsStatus, action and validateSettings answers are read like the app reads them", () => {
  const m = JSON.parse(manifest({ apiVersion: 6, settings: [
    { key: "email", label: "Correo", type: "text" },
    { key: "linked", label: "Estado", type: "status" },
  ] }));
  assert.deepEqual(checkSettingsOutput("settingsStatus", { linked: " Vinculada ", other: "x", email: "y" }, m), { linked: "Vinculada" });
  assert.deepEqual(checkSettingsOutput("settingsStatus", "Vinculada", m), {});
  assert.deepEqual(checkSettingsOutput("action", { message: " Listo ", refresh: true }, m), { message: "Listo", refresh: true, clearSettings: [] });
  assert.deepEqual(checkSettingsOutput("action", undefined, m), { message: null, refresh: false, clearSettings: [] });
  assert.deepEqual(checkSettingsOutput("validateSettings", null, m), { accepted: true });
  assert.deepEqual(checkSettingsOutput("validateSettings", { email: "Correo inválido", account: "Bloqueada" }, m), { accepted: false, fieldErrors: { email: "Correo inválido" }, general: "Bloqueada" });
  assert.deepEqual(checkSettingsOutput("validateSettings", "No se pudo entrar", m), { accepted: false, fieldErrors: {}, general: "No se pudo entrar" });
  assert.throws(() => checkSettingsOutput("validateSettings", [1], m), /Kino can't read this answer/);
  assert.equal(checkSettingsOutput("settingsStatus", { linked: "a".repeat(500) }, m).linked.length, contract.settings.ui.statusMaxChars);
});

test("settings answers: garbage is dropped like the app drops it, never thrown", () => {
  const m = JSON.parse(manifest({ apiVersion: 6, settings: [
    { key: "email", label: "Correo", type: "text" },
    { key: "password", label: "Clave", type: "password" },
    { key: "linked", label: "Estado", type: "status" },
  ] }));
  for (const v of [null, undefined, [], 42, true, { linked: 3 }, { linked: { a: 1 } }, { linked: ["x"] }, { linked: "   " }]) assert.deepEqual(checkSettingsOutput("settingsStatus", v, m), {});
  for (const v of [[], "x", 5, { message: { a: 1 }, refresh: 1 }, { message: "   ", refresh: "yes" }]) assert.deepEqual(checkSettingsOutput("action", v, m), { message: null, refresh: false, clearSettings: [] });
  assert.deepEqual(checkSettingsOutput("validateSettings", { email: 5, password: { a: 1 }, x: [1], y: true }, m), { accepted: true });
  assert.deepEqual(checkSettingsOutput("validateSettings", { email: "no", password: 7 }, m), { accepted: false, fieldErrors: { email: "no" }, general: null });
  assert.deepEqual(checkSettingsOutput("validateSettings", "   ", m), { accepted: true });
  for (const v of [true, 3, [], ["x"]]) assert.throws(() => checkSettingsOutput("validateSettings", v, m), /Kino can't read this answer/);
  const big = {}; for (let i = 0; i < 500; i++) big["k" + i] = "m".repeat(100);
  assert.equal(checkSettingsOutput("validateSettings", big, m).general.length, contract.settings.ui.fieldErrorMaxChars);
  assert.equal(checkSettingsOutput("validateSettings", { email: "e".repeat(5000) }, m).fieldErrors.email.length, contract.settings.ui.fieldErrorMaxChars);
  assert.deepEqual(checkSettingsOutput("settingsStatus", { linked: "HolaSECRET" }, m, (t) => t.replaceAll("SECRET", "")), { linked: "Hola" });
  assert.deepEqual(checkSettingsOutput("validateSettings", { email: "SECRETmal", z: "bloqueSECRETada" }, m, (t) => t.replaceAll("SECRET", "")), { accepted: false, fieldErrors: { email: "mal" }, general: "bloqueada" });
});

test("settings answers: a deeply nested answer is read like the app reads it (nothing, or refused), never a crash", () => {
  const m = JSON.parse(manifest({ apiVersion: 6, settings: [{ key: "linked", label: "Estado", type: "status" }] }));
  let deep = [];
  for (let i = 0; i < 100000; i++) deep = [deep];
  let deepObj = {};
  for (let i = 0; i < 100000; i++) deepObj = { a: deepObj };
  for (const v of [deep, deepObj]) {
    assert.deepEqual(checkSettingsOutput("settingsStatus", v, m), {});
    assert.deepEqual(checkSettingsOutput("action", v, m), { message: null, refresh: false, clearSettings: [] });
  }
  assert.throws(() => checkSettingsOutput("validateSettings", deep, m), /Kino can't read this answer/);
  assert.deepEqual(checkSettingsOutput("validateSettings", deepObj, m), { accepted: true });
});

test("the settings demo validates and its three exports run through call()", async () => {
  const dir = join(here, "settings-demo");
  const v = await validate(dir);
  assert.deepEqual(v.problems, []);
  const pluginFile = join(dir, "plugin.js");
  const priorKino = globalThis.kino;
  const { kino } = createKino(JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8")), { config: { email: "ana@x.co" }, storageFile: join(mkdtempSync(join(tmpdir(), "kino-demo-")), "s.json") });
  globalThis.kino = kino;
  const scratch = mkdtempSync(join(tmpdir(), "kino-demo-"));
  writeFileSync(join(scratch, "p.mjs"), readFileSync(pluginFile));
  const plugin = await import(pathToFileURL(join(scratch, "p.mjs")).href);
  assert.deepEqual(await call(plugin, "settingsStatus", []), { linked: "Sin cuenta: sesión anónima", slow: 42 });
  assert.deepEqual(await call(plugin, "action", ["test"]), { message: "Conexión correcta" });
  assert.deepEqual(await call(plugin, "validateSettings", ['{"email":"sin-arroba"}']), { email: "Escribe un correo válido" });
  assert.equal(await call(plugin, "validateSettings", ['{"email":"ana@x.co"}']), null);
  // storage holds strings, so the status must read what the valid save stored
  assert.deepEqual(await call(plugin, "settingsStatus", []), { linked: "Vinculada como ana@x.co", slow: 42 });
  globalThis.kino = priorKino;
  rmSync(scratch, { recursive: true, force: true });
});

test("validate refuses a status setting without settingsStatus", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-ui-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, settings: [{ key: "linked", label: "Estado", type: "status" }] }));
  writeFileSync(join(dir, "plugin.js"), "export async function search(){}\nexport async function resolve(){}");
  const v = await validate(dir);
  assert.equal(v.ok, false);
  assert.match(v.problems.join("\n"), /settingsStatus/);
  rmSync(dir, { recursive: true, force: true });
});

test("run.mjs runs the settings exports and prints what the app keeps", () => {
  const demo = join(here, "settings-demo");
  const run = (...args) => spawnSync(process.execPath, [join(here, "..", "run.mjs"), "--config", "email=ana@x.co", demo, ...args], { encoding: "utf8" });
  const status = run("settingsStatus");
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout), { linked: "Sin cuenta: sesión anónima" });
  const act = run("action", "test");
  assert.equal(act.status, 0, act.stderr);
  assert.deepEqual(JSON.parse(act.stdout), { message: "Conexión correcta", refresh: false, clearSettings: [] });
  const rejected = run("validateSettings", '{"password":"mala"}');
  assert.deepEqual(JSON.parse(rejected.stdout), { accepted: false, fieldErrors: { password: "La contraseña no es correcta" }, general: null });
  const garbage = run("validateSettings", '{"password":"rara"}');
  assert.equal(garbage.status, 1);
  assert.match(garbage.stderr, /Kino can't read this answer/);
  const raw = spawnSync(process.execPath, [join(here, "..", "run.mjs"), "--raw", demo, "validateSettings", '{"password":"mala"}'], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(raw.stdout), { password: "La contraseña no es correcta" });
  const bad = run("validateSettings", "not json");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /JSON object/);
  rmSync(join(demo, ".kino-storage.json"), { force: true });
});

test("debug: an optional boolean from apiVersion 6, ignored below; on (the switch's default), it is a note for the author", async () => {
  assert.equal(contract.manifest.debug.apiVersion, 6);
  assert.equal(contract.manifest.debug.default, false);
  assert.equal(validateManifest(manifest({ apiVersion: 6 })).manifest.debug, false);
  assert.equal(validateManifest(manifest({ apiVersion: 6, debug: true })).manifest.debug, true);
  assert.equal(validateManifest(manifest({ apiVersion: 4, debug: true })).manifest.debug, false);
  assert.equal(validateManifest(manifest({ apiVersion: 4, debug: "yes" })).ok, true);
  // apiVersion 5 is 0.9.45's: debug is an unknown field there, ignored whatever it holds.
  assert.equal(validateManifest(manifest({ apiVersion: 5, debug: true })).manifest.debug, false);
  assert.equal(validateManifest(manifest({ apiVersion: 5, debug: "yes" })).ok, true);
  for (const value of ["yes", 1, null, []]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 6, debug: value })), { ok: false, field: "debug", message: 'The "debug" field must be true or false' });
  }
  const dir = mkdtempSync(join(tmpdir(), "kino-debug-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6 }));
    // Only the version note every apiVersion 6 plugin gets (validate.mjs); debug off adds nothing.
    const authorNotes = (notes) => notes.filter((n) => !n.startsWith("apiVersion "));
    assert.deepEqual(authorNotes((await validate(dir)).notes), []);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, debug: true }));
    const r = await validate(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(authorNotes(r.notes), [contract.manifest.debug.defaultOnNote]);
    assert.match(contract.manifest.debug.defaultOnNote, /^Modo debug encendido de entrada/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("section and theme: apiVersion 6 manifest fields with the app's messages", () => {
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, section: { label: "  Demo " } })).manifest.section, { label: "Demo" });
  assert.equal(validateManifest(manifest({ apiVersion: 6 })).manifest.section, null);
  const v4 = validateManifest(manifest({ apiVersion: 4, section: "nope", theme: 3 }));
  assert.equal(v4.ok, true);
  assert.equal(v4.manifest.section, null);
  assert.deepEqual(v4.manifest.theme, {});
  for (const bad of ["Demo", 3, [], null]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 6, section: bad })), { ok: false, field: "section", message: 'The "section" field must be an object with a "label"' });
  }
  for (const label of ["", "   ", "x".repeat(21), 5, null]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 6, section: { label } })), { ok: false, field: "section", message: 'The "section.label" field must be 1 to 20 characters' });
  }
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, theme: { highlight: "#f7c948", accent: "#3d5afe" } })).manifest.theme, { accent: "#3D5AFE", highlight: "#F7C948" });
  for (const bad of ["#FFFFFF", [], null]) {
    assert.deepEqual(validateManifest(manifest({ apiVersion: 6, theme: bad })), { ok: false, field: "theme", message: 'The "theme" field must be an object of colors' });
  }
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, theme: { accent: "blue" } })), { ok: false, field: "theme", message: 'The "accent" color of "theme" must look like #RRGGBB' });
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, theme: { surface: 123 } })), { ok: false, field: "theme", message: 'The "surface" color of "theme" must look like #RRGGBB' });
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, theme: { zeta: "#000000", bar: "#000000" } })), { ok: false, field: "theme", message: 'The "theme" field has an unknown color: "bar"' });
  const m = validateManifest(manifest({ apiVersion: 6, section: { label: "Mía" } })).manifest;
  assert.deepEqual(requiredExports(m.capabilities, m.settings, m).sort(), ["resolve", "search", "section"]);
});

test("palette: the same guardrails and Spanish warnings as the app", () => {
  assert.equal(luminance("#FFFFFF"), 1);
  assert.equal(contrast("#FFFFFF", "#000000"), 21);
  assert.ok(Math.abs(deltaE("#D81F26", "#E50914") - 12.28) < 0.05);
  const sound = resolvePalette({ accent: "#3D5AFE", onAccent: "#FFFFFF", background: "#101820", surface: "#1A2733", highlight: "#F7C948" });
  assert.deepEqual(sound.kept, ["background", "surface", "accent", "onAccent", "highlight"]);
  assert.deepEqual(sound.warnings, []);
  assert.equal(sound.accent, "#3D5AFE");
  const cases = [
    [{ accent: "#D81F26", onAccent: "#FFFFFF" }, "theme.accent: is too close to Kino's red; Kino's colors are used for accent and onAccent"],
    [{ accent: "#1DB954", onAccent: "#FFFFFF" }, "theme.onAccent: isn't readable on accent (contrast 2.5:1, at least 4.5:1); Kino's colors are used for accent and onAccent"],
    [{ accent: "#0B1E3F", onAccent: "#FFFFFF" }, "theme.accent: doesn't stand out on the background (contrast 1.1:1, at least 3:1); Kino's colors are used for accent and onAccent"],
    [{ background: "#7A7A7A" }, "theme.background: is too light (the background must be dark); Kino's is used"],
    [{ background: "#D81F26" }, "theme.background: is too close to Kino's red; Kino's is used"],
    [{ surface: "#0E0E0E" }, "theme.surface: doesn't stand out from the background (contrast 1.0:1, at least 1.05:1); Kino's is used"],
    [{ surface: "#7A7A7A" }, "theme.surface: is too light; Kino's is used"],
    [{ highlight: "#2B2B2B" }, "theme.highlight: isn't readable on the background (contrast 1.3:1, at least 4.5:1); Kino's is used"],
  ];
  for (const [theme, warning] of cases) assert.deepEqual(resolvePalette(theme).warnings, [warning], JSON.stringify(theme));
  assert.deepEqual(resolvePalette({ accent: "#1DB954", onAccent: "#000000" }).kept, ["accent", "onAccent"]);
  assert.deepEqual(resolvePalette({ onAccent: "#FEFEFE" }).kept, ["onAccent"]);
  assert.deepEqual(resolvePalette({ onAccent: "#000000" }).warnings, ["theme.onAccent: isn't readable on accent (contrast 4.3:1, at least 4.5:1); Kino's colors are used for accent and onAccent"]);

  // Parity with the app's extra cases.
  assert.deepEqual(resolvePalette({ surface: "#D81F26" }).warnings, ["theme.surface: is too close to Kino's red; Kino's is used"]);
  assert.deepEqual(resolvePalette({ highlight: "#F2303A" }).warnings, ["theme.highlight: is too close to Kino's red; Kino's is used"]);
  assert.deepEqual(resolvePalette({ accent: "#3D5AFE", onAccent: "#E50914" }).warnings, ["theme.onAccent: is too close to Kino's red; Kino's colors are used for accent and onAccent"]);
  const mix = resolvePalette({ background: "#101820", surface: "#1A2733", accent: "#1DB954", onAccent: "#FFFFFF", highlight: "#F7C948" });
  assert.deepEqual(mix.kept, ["background", "surface", "highlight"]);
  assert.equal(mix.warnings.length, 1);
  assert.equal(mix.accent, "#E50914");
  assert.equal(mix.highlight, "#F7C948");
  const order = resolvePalette({ accent: "#D81F26", background: "#7A7A7A", surface: "#0E0E0E", highlight: "#2B2B2B" });
  assert.deepEqual(order.warnings.map((w) => w.slice(6, w.indexOf(":"))), ["background", "surface", "accent", "highlight"]);
  assert.deepEqual(order.kept, []);
  assert.deepEqual(resolvePalette({ accent: "#F7C948", onAccent: "#000000" }).kept, ["accent", "onAccent"]);
  assert.deepEqual(resolvePalette({}).warnings, []);
  assert.deepEqual(resolvePalette().kept, []);
  assert.equal(resolvePalette({ accent: "#3d5afe", onAccent: "#ffffff" }).accent, "#3D5AFE");
});

test("palette: malformed input never throws and falls back with a warning", () => {
  for (const bad of ["", "red", "#12", "#GGGGGG", "#1234567", "3D5AFE", "#3D5AFE ", 12, null, {}, []]) {
    const p = resolvePalette({ accent: bad, onAccent: bad, background: bad, surface: bad, highlight: bad, bogus: bad });
    assert.deepEqual(p.kept, [], String(bad));
    assert.equal(p.warnings.length, 4, String(bad));
    assert.equal(p.background, "#0E0E0E");
  }
  for (const weird of [null, undefined, 5, "x", []]) assert.deepEqual(resolvePalette(weird).kept, []);
});

test("palette: ratios print floored to one decimal, identically to the app", () => {
  const vectors = [[4.55, "4.5"], [0.35, "0.3"], [4.46, "4.4"], [4.49999, "4.4"], [21, "21.0"], [1, "1.0"], [1.049, "1.0"], [2.99, "2.9"]];
  for (const [x, want] of vectors) assert.equal(formatRatio(x), want, String(x));
});

test("checkOutput: section and categories read like the app", () => {
  const m = validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "browse", "resolve"], section: { label: "Mía" } })).manifest;
  const row = { id: "top", title: "Lo más visto", ref: "top", items: [{ id: "m1", ref: "R1", title: "Uno", kind: "movie" }] };
  const s = checkOutput("section", { tabs: [{ id: "pelis", label: "Películas" }, { id: "pelis", label: "Dup" }, { id: "bad id", label: "x" }], tab: "otra", hero: { title: "  ", image: "https://example.com/b.jpg" }, rows: [row] }, m).value;
  assert.deepEqual(s.tabs, [{ id: "pelis", label: "Películas" }]);
  assert.equal(s.tab, "pelis");
  assert.equal(s.hero, null);
  assert.deepEqual(s.rows.map((r) => r.id), ["top"]);
  assert.deepEqual(checkOutput("section", null, m).value, { tabs: [], tab: null, hero: null, rows: [] });
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i + 1}`, title: `C${i + 1}`, ref: `r${i + 1}` }));
  const cats = checkOutput("categories", [{ id: "x", title: "t".repeat(50), ref: "accion", art: "http://10.0.0.1/a.jpg" }, { id: "w", title: "Sin ref" }, ...many], m).value;
  assert.equal(cats.length, 24);
  assert.deepEqual(cats[0], { id: "x", title: "t".repeat(40), art: null, ref: "accion" });
  const noBrowse = validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "resolve"] })).manifest;
  assert.deepEqual(checkOutput("categories", [{ id: "x", title: "A", ref: "r" }], noBrowse).value, []);
});

test("checkOutput: section tabs are capped at 8, labels at 24, hero text at 300, with the app's drop messages", () => {
  const m = validateManifest(manifest({ apiVersion: 6, section: { label: "Mía" } })).manifest;
  const tabs = Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, label: `T${i + 1}` }));
  const r = checkOutput("section", { tabs: [{ id: "b", label: "B" }, { id: "b", label: "B2" }, ...tabs, { id: "z", label: "x".repeat(30) }], hero: { title: "H", text: "y".repeat(400), image: "http://192.168.1.2/a.jpg" }, rows: [] }, m);
  assert.deepEqual(r.value.tabs.map((t) => t.id), ["b", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
  assert.ok(r.drops.includes("section: duplicate tab b dropped"));
  assert.ok(r.drops.includes("section: tabs beyond 8 dropped"));
  assert.deepEqual(r.value.hero, { title: "H", image: "", text: "y".repeat(300) });
  assert.equal(checkOutput("section", { tabs: [{ id: "a", label: "x".repeat(30) }], rows: [] }, m).value.tabs[0].label, "x".repeat(24));
  assert.ok(checkOutput("section", [], m).drops.includes("section: the answer is not a JSON object"));
  assert.ok(checkOutput("categories", {}, m).drops.includes("categories: ignored, the plugin doesn't declare browse"));
});

test("validate() refuses a plugin that declares a section but doesn't export it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-section-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, section: { label: "Mía" } }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a' } }");
    const missing = await validate(dir);
    assert.ok(missing.problems.some((p) => p.includes("doesn't export section")), JSON.stringify(missing.problems));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a' } }\nexport async function section(){ return { rows: [] } }");
    assert.deepEqual((await validate(dir)).problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs: section, categories and theme on the demo plugin", async () => {
  const dir = join(here, "section-demo");
  const plugin = await import(pathToFileURL(join(dir, "plugin.js")).href);
  assert.deepEqual((await call(plugin, "section", ["series"])).tab, "series");
  assert.equal((await call(plugin, "section", [])).tab, "pelis");
  assert.equal((await call(plugin, "categories", [])).length, 3);
  const run = (...args) => spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, ...args], { encoding: "utf8" });
  const theme = run("theme");
  assert.equal(theme.status, 0, theme.stderr);
  assert.match(theme.stdout, /accent\s+#3D5AFE\s+used/);
  assert.match(theme.stdout, /onAccent on accent: 5.1:1/);
  // One token fails a guardrail on purpose: the kit shows the fallback and the app's warning.
  assert.match(theme.stdout, /highlight\s+#6B5A2A\s+Kino\s+#F5F5F5/);
  assert.match(theme.stdout, /warning: theme\.highlight: isn't readable on the background/);
  const sec = run("section", "vacia");
  assert.equal(sec.status, 0, sec.stderr);
  assert.deepEqual(JSON.parse(sec.stdout).rows, []);
  const cats = run("categories");
  assert.equal(cats.status, 0, cats.stderr);
  assert.equal(JSON.parse(cats.stdout).length, 3);
  // Without a section in the manifest the kit refuses, like the app.
  const bare = mkdtempSync(join(tmpdir(), "kit-nosection-"));
  try {
    writeFileSync(join(bare, "plugin.js"), "export async function home(){return []}\nexport async function resolve(){return null}\n");
    writeFileSync(join(bare, "kino-plugin.json"), JSON.stringify({ id: "nosec", name: "Nosec", version: "1.0.0", apiVersion: 6, entry: "plugin.js", hosts: ["example.com"], capabilities: ["home", "resolve"] }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), bare, "section"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not declare "section"/);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

// The guide's field table is hand-written: pin its apiVersion and capabilities rows to contract.json
// so they can't drift again (they said "1, 2, 3 or 4" well after 5 shipped). Only in Kino's repo.
test("the guide's apiVersion and capabilities rows name every version and capability the contract has", (t) => {
  const readme = join(here, "..", "..", "..", "docs", "plugins", "README.md");
  if (!existsSync(readme)) return t.skip("no guide around this kit");
  const rows = readFileSync(readme, "utf8").split("\n");
  const row = (field) => rows.find((r) => r.startsWith(`| \`${field}\` |`));
  assert.ok(row("apiVersion").includes(`\`1\` to \`${contract.maxApiVersion}\``), row("apiVersion"));
  for (const c of contract.capabilities.names) assert.ok(row("capabilities").includes(`\`${c}\``), `capabilities row lacks ${c}`);
  for (const [c, v] of Object.entries(contract.capabilities.apiVersions)) {
    assert.ok(row("capabilities").includes(`\`${c}\``) && row("capabilities").includes(`apiVersion: ${v}`), `capabilities row lacks ${c}'s apiVersion ${v}`);
  }
});

test("the guide's kino.fetch limits row names every fetch limit the app enforces", () => {
  const row = TABLES.limits().split("\n").find((r) => r.startsWith("| `kino.fetch` |"));
  assert.ok(row.includes(`at most ${contract.fetch.maxRequestsPerCall} requests per call, every hop counted, refused ones included (${contract.fetch.nuvioMaxRequestsPerCall} for a plugin converted from a Nuvio scraper)`), row);
  assert.ok(row.includes(`at most ${contract.fetch.maxInFlight} fetches in flight at once`), row);
  assert.ok(row.includes(`at most ${contract.fetch.maxHostQuestionsPerCall} host questions per call`), row);
});

// apiVersion 5 is Kino 0.9.45's (the author's signature, nothing else): a v5 manifest using an apiVersion 6
// field is refused, or reads it exactly as those apps do (an unknown field, ignored).
test("apiVersion 5 manifests read as Kino 0.9.45 and 0.9.46 read them: every apiVersion 6 field is refused or ignored", () => {
  assert.equal(contract.maxApiVersion, 11);
  const v5 = (extra) => validateManifest(manifest({ apiVersion: 5, ...extra }));
  const ignored = v5({ debug: true, section: { label: "Mía" }, theme: { accent: "#3D5AFE" } });
  assert.equal(ignored.ok, true);
  assert.equal(ignored.manifest.debug, false);
  assert.equal(ignored.manifest.section, null);
  assert.deepEqual(ignored.manifest.theme, {});
  assert.equal(v5({ debug: "yes", section: 7, theme: "red" }).ok, true);
  assert.deepEqual(v5({ capabilities: ["search", "resolve", "migrate"] }), { ok: false, field: "capabilities", message: 'The "migrate" capability needs apiVersion 6' });
  const typed = v5({ secrets: { desKey: { seal: FAKE_SEAL, use: "cipher-key", encoding: "hex" } } });
  assert.deepEqual(typed, { ok: false, field: "secrets", message: 'The secret "desKey" is not a valid Kino seal' });
  const status = v5({ settings: [{ key: "linked", label: "Estado", type: "status" }] });
  assert.equal(status.ok, false);
  assert.equal(status.field, "settings");
  // A stream's signing is ignored below 6: it plays unsigned.
  const stream = checkOutput("resolve", { url: "https://cdn.example/a.m3u8", signing: "request", signContext: "c" }, { ...JSON.parse(manifest({ apiVersion: 5 })), hosts: ["cdn.example"] }).value;
  assert.notEqual(stream.signing, true);
});

// apiVersion 5 shipped in Kino 0.9.45 (signature.fromApp); 6 first ships in 0.9.50 (nothing ships until the built-in source removal is done).
test("each apiVersion above 4 names the Kino it first ships in, and validate's note reads it", async () => {
  assert.equal(contract.manifest.signature.fromApp, "0.9.45");
  assert.deepEqual(contract.apiVersionFromApp, { "6": "0.9.50", "7": "0.9.51", "8": "0.9.54", "9": "0.9.55", "10": "0.9.65", "11": "0.9.66" });
  const dir = mkdtempSync(join(tmpdir(), "kino-from-app-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6 }));
    assert.deepEqual((await validate(dir)).notes, ["apiVersion 6: needs Kino 0.9.50 or later; older versions refuse it with \"This plugin needs a newer version of Kino\""]);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 5 }));
    assert.deepEqual((await validate(dir)).notes, ["apiVersion 5: needs Kino 0.9.45 or later; older versions refuse it with \"This plugin needs a newer version of Kino\""]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkOutput: adult entries are dropped below apiVersion 6 and kept, marked, from 6", () => {
  const v5 = validateManifest(manifest({ apiVersion: 5, capabilities: ["home", "resolve"] })).manifest;
  const v6 = validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "resolve"] })).manifest;
  const rows = [{ id: "r", title: "R", items: [{ id: "a", title: "A", kind: "movie", ref: "a", adult: true }] }];
  // Its only item dropped, the row is no row at all (as in the app).
  assert.equal(checkOutput("home", rows, v5).value.length, 0);
  assert.equal(checkOutput("home", rows, v6).value[0].items[0].adult, true);
  assert.equal(contract.output.adultApiVersion, 6);
  assert.equal(contract.live.adultApiVersion, 6);
});

test("checkOutput: adult live categories, channels and category tiles follow the same gate", () => {
  const live = (apiVersion) => ({ ...JSON.parse(manifest({ apiVersion })), capabilities: ["home", "resolve", "channels"] });
  const cats = [{ id: "x", title: "18+", adult: true }, { id: "n", title: "Noticias" }];
  assert.deepEqual(checkOutput("liveCategories", cats, live(5)).value.categories.map((c) => c.id), ["n"]);
  assert.deepEqual(checkOutput("liveCategories", cats, live(6)).value.categories.map((c) => [c.id, c.adult === true]), [["x", true], ["n", false]]);
  const channels = [{ id: "c1", title: "Uno", ref: "r1", adult: true }, { id: "c2", title: "Dos", ref: "r2" }];
  assert.deepEqual(checkOutput("liveChannels", channels, live(5)).value.items.map((c) => c.id), ["c2"]);
  assert.deepEqual(checkOutput("liveChannels", channels, live(6)).value.items.map((c) => [c.id, c.adult === true]), [["c1", true], ["c2", false]]);
  const tiles = [{ id: "x", title: "18+", ref: "rx", adult: true }, { id: "n", title: "Acción", ref: "rn" }];
  const browse = (apiVersion) => ({ ...JSON.parse(manifest({ apiVersion })), capabilities: ["home", "browse", "resolve"] });
  assert.deepEqual(checkOutput("categories", tiles, browse(5)).value.map((c) => c.id), ["n"]);
  assert.deepEqual(checkOutput("categories", tiles, browse(6)).value.map((c) => [c.id, c.adult === true]), [["x", true], ["n", false]]);
});

test("run.mjs marks each kept 18+ entry with [18+], wherever the answer holds it", () => {
  const m = validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "resolve"] })).manifest;
  const rows = checkOutput("home", [{ id: "r", title: "R", items: [
    { id: "a", title: "Adulto", kind: "movie", ref: "a", adult: true }, { id: "b", title: "Uno", kind: "movie", ref: "b" }] }], m).value;
  assert.deepEqual(adultLines(rows), ["[18+] Adulto (Kino shows it only while the 18+ code is unlocked)"]);
  assert.deepEqual(adultLines({ categories: [{ id: "x", title: "18+", adult: true }], playlists: [] }), ["[18+] 18+ (Kino shows it only while the 18+ code is unlocked)"]);
  assert.deepEqual(adultLines({ items: [{ id: "c", title: "Canal" }], next: null }), []);
});

test("run.mjs prints [18+] before an adult entry it kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-adult-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6 }));
    writeFileSync(join(dir, "plugin.js"), `export async function search(){ return [{ id: "a", ref: "a", title: "Adulto", kind: "movie", adult: true }] }
export async function resolve(){ return { url: "https://example.com/a.m3u8" } }`);
    const r = runCli([dir, "search", "x"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /\[18\+\] Adulto/);
    assert.equal(JSON.parse(r.stdout).items[0].adult, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Task 14c: scopedSearch (search inside a "Ver más" page) ----

test("scopedSearch: apiVersion 6, only with search, and nothing more to export", () => {
  const ok = validateManifest(manifest({ apiVersion: 6, capabilities: ["search", "browse", "resolve", "scopedSearch"] }));
  assert.ok(ok.ok);
  assert.deepEqual(requiredExports(ok.manifest.capabilities).sort(), ["browse", "resolve", "search"]);
  assert.deepEqual(validateManifest(manifest({ apiVersion: 5, capabilities: ["search", "browse", "resolve", "scopedSearch"] })),
    { ok: false, field: "capabilities", message: 'The "scopedSearch" capability needs apiVersion 6' });
  assert.deepEqual(validateManifest(manifest({ apiVersion: 6, capabilities: ["home", "browse", "resolve", "scopedSearch"] })),
    { ok: false, field: "capabilities", message: 'The "scopedSearch" capability also needs "search"' });
  assert.deepEqual(contract.capabilities.needsApproval.includes("scopedSearch"), false);
});

test("validate() warns when scopedSearch is declared but search() never reads query.within", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-scoped-"));
  const warning = 'Declara "scopedSearch" pero search() no lee query.within: Kino le pide buscar dentro de una página "Ver más" y recibiría la búsqueda completa (responde null si no puede buscar en esa página)';
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, capabilities: ["search", "browse", "resolve", "scopedSearch"] }));
    const rest = "\nexport async function browse(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a' } }";
    writeFileSync(join(dir, "plugin.js"), "export async function search(query){ return [] }" + rest);
    const ignoring = await validate(dir);
    assert.deepEqual(ignoring.problems, []);
    assert.ok(ignoring.notes.includes(warning), ignoring.notes.join("\n"));
    writeFileSync(join(dir, "plugin.js"), "export async function search(query){ if (query.within) return null; return [] }" + rest);
    assert.ok(!(await validate(dir)).notes.includes(warning));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs --within sends the browse ref as the app's scoped search does", async () => {
  const { opts } = parseArgs(["--within", "row-7", "./p", "search", "matrix"]);
  assert.equal(opts.within, "row-7");
  const plugin = { search: async (q) => q };
  const q = await call(plugin, "search", ["matrix"], { within: "row-7" });
  assert.equal(q.q, "matrix");
  assert.equal(q.within, "row-7");
  assert.equal(q.type, "any");
  assert.equal((await call(plugin, "search", ["matrix"], {})).within, undefined);
  assert.throws(() => parseArgs(["--within"]), /--within needs/);
});

// --- alternatives (Stream.alternatives, from main): checked like `url`, never next to drm or signing, as PluginOutput.alternativesOf ---

test("a stream's alternatives are checked like its url: bad, repeated or surplus ones dropped, none with signing", () => {
  const url = "https://cdn.example/a.mp4";
  const list = [{ url: "https://cdn2.example/b.mp4", mime: "video/mp4", headers: { Referer: "https://cdn.example/" } }, { url },
    { url: "https://evil.example/c.mp4" }, { url: "https://cdn2.example/b.mp4" }, "nope",
    ...[3, 4, 5, 6, 7, 8].map((n) => ({ url: `https://cdn${n}.example/x.mp4` })), { url: "https://cdn2.example/last.mp4" }, { url: "https://cdn2.example/over.mp4" }];
  const { value } = checkOutput("resolve", { url, alternatives: list }, cdns());
  assert.equal(contract.output.maxAlternatives, 8);
  assert.equal(value.alternatives.length, 8);
  assert.deepEqual(value.alternatives[0], { url: "https://cdn2.example/b.mp4", mime: "video/mp4", headers: { Referer: "https://cdn.example/" } });
  assert.ok(!value.alternatives.some((a) => a.url === url || a.url.includes("evil")));
  assert.equal(checkOutput("resolve", { url }, cdns()).value.alternatives, undefined);
  const signed = checkOutput("resolve", { ...signedWith([]), alternatives: [{ url: "https://cdn2.example/b.m3u8" }] }, cdns()).value;
  assert.equal(signed.alternatives, undefined);
});

// --- labelled and lazy copies (PluginOutput.STREAM_LABELS_API_VERSION): { label, ref } alternatives, as PluginOutput.alternativesOf ---

const LABELS_API = contract.output.streamLabels.apiVersion;
const labelled = { url: "https://cdn.example/a.m3u8", label: "  Latino · Streamwish  ", alternatives: [
  { url: "https://cdn2.example/b.mp4", label: "Latino · Voe" }, { label: "Subtitulado · Filemoon", ref: "ep-1|sub" }, { ref: "ep-1|en" }] };

test("labels and lazy { label, ref } copies are kept from the labels apiVersion, as the app reads them", () => {
  const { value, drops } = checkOutput("resolve", labelled, { ...cdns(), apiVersion: LABELS_API });
  assert.equal(value.label, "Latino · Streamwish");
  assert.deepEqual(value.alternatives, [
    { url: "https://cdn2.example/b.mp4", mime: "", headers: {}, label: "Latino · Voe" },
    { ref: "ep-1|sub", label: "Subtitulado · Filemoon" },
    { ref: "ep-1|en" },
  ]);
  assert.deepEqual(drops, []);
});

test("below the labels apiVersion a label is ignored and a ref-only copy dropped, exactly as before", () => {
  const { value } = checkOutput("resolve", labelled, { ...cdns(), apiVersion: LABELS_API - 1 });
  assert.equal(value.label, undefined);
  assert.deepEqual(value.alternatives, [{ url: "https://cdn2.example/b.mp4", mime: "", headers: {} }]);
});

test("a bad label is dropped with a note and its copy kept; a bad or repeated ref is dropped; lazy copies share the maximum", () => {
  const max = contract.output.streamLabels.maxChars;
  const { value, drops } = checkOutput("resolve", {
    url: "https://cdn.example/a.mp4", label: "x".repeat(max + 1),
    alternatives: [{ ref: "r1", label: "La\u0007tino" }, { ref: "" }, { ref: "  " }, { ref: "r".repeat(contract.output.streamLabels.maxRefChars + 1) },
      { ref: 5 }, { ref: "r1" }, { ref: "y", label: "y".repeat(max) }, ...[...Array(10).keys()].map((n) => ({ ref: `k${n}` }))],
  }, { ...cdns(), apiVersion: LABELS_API });
  assert.equal(value.label, undefined);
  assert.equal(value.alternatives.length, contract.output.maxAlternatives);
  assert.deepEqual(value.alternatives.slice(0, 2), [{ ref: "r1" }, { ref: "y", label: "y".repeat(max) }]);
  assert.equal(drops.filter((d) => /label dropped/.test(d)).length, 2);
  assert.equal(drops.filter((d) => /invalid ref/.test(d)).length, 4);
});

test("run.mjs lists a resolve's copies the way the Servidor menu shows them, with the command for a lazy one", async () => {
  const { copyLines } = await import("../run.mjs");
  const { value } = checkOutput("resolve", labelled, { ...cdns(), apiVersion: LABELS_API });
  assert.deepEqual(copyLines(value), [
    "copies (4), as the Server menu shows them:",
    "  1. Latino · Streamwish — cdn.example",
    "  2. Latino · Voe — cdn2.example",
    '  3. Subtitulado · Filemoon — se resuelve al elegirla: resolve "ep-1|sub"',
    '  4. Option 4 — se resuelve al elegirla: resolve "ep-1|en"',
  ]);
  assert.deepEqual(copyLines({ url: "https://cdn.example/a.mp4" }), []);
});

test("validate.mjs --run resolve follows the first lazy copy's ref and reports a copy the app would refuse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-lazy-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: LABELS_API, hosts: ["example.com"] }));
    writeFileSync(join(dir, "plugin.js"), `
      export async function search() { return []; }
      export async function resolve(ref) {
        if (ref === "t|good") return { url: "https://example.com/good.m3u8", alternatives: [{ url: "https://example.com/x.mp4" }] };
        if (ref === "t|bad") return { url: "https://evil.example/v.m3u8" };
        return { url: "https://example.com/a.m3u8", label: "Latino", alternatives: [{ label: "Inglés", ref: ref.endsWith("!") ? "t|bad" : "t|good" }] };
      }`);
    const ok = await validate(dir, { run: "resolve", args: ["t"] });
    assert.deepEqual(ok.problems, []);
    assert.ok(ok.notes.some((n) => /no recursion/.test(n)));
    const bad = await validate(dir, { run: "resolve", args: ["t!"] });
    assert.ok(bad.problems.some((p) => /lazy copy/.test(p) && /evil\.example/.test(p)), bad.problems.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkOutput keeps a stream's skip times, drops the bad parts, never refuses the stream", () => {
  const m = JSON.parse(manifest());
  const base = { url: "https://example.com/v.mp4", durationMs: 1_420_000 };
  const ok = checkOutput("resolve", { ...base, skip: { openingStartMs: 62_000, openingEndMs: 152_000.4, endingStartMs: 1_290_000 } }, m);
  assert.deepEqual(ok.value.skip, { openingStartMs: 62_000, openingEndMs: 152_000, endingStartMs: 1_290_000 });
  assert.deepEqual(ok.drops, []);
  // No start: the opening starts at 0. Only an ending: kept alone.
  assert.deepEqual(checkOutput("resolve", { ...base, skip: { openingEndMs: 90_000 } }, m).value.skip, { openingStartMs: 0, openingEndMs: 90_000, endingStartMs: null });
  assert.deepEqual(checkOutput("resolve", { ...base, skip: { endingStartMs: 1_300_000 } }, m).value.skip, { openingStartMs: null, openingEndMs: null, endingStartMs: 1_300_000 });
  // Past the duration, reversed, a string, an ending inside the opening: dropped, the stream still plays.
  const bad = checkOutput("resolve", { ...base, skip: { openingStartMs: 100_000, openingEndMs: 90_000, endingStartMs: 2_000_000 } }, m);
  assert.equal(bad.value.url, base.url);
  assert.equal(bad.value.skip, undefined);
  assert.equal(bad.drops.length, 1);
  const half = checkOutput("resolve", { ...base, skip: { openingEndMs: 90_000, endingStartMs: 60_000 } }, m);
  assert.deepEqual(half.value.skip, { openingStartMs: 0, openingEndMs: 90_000, endingStartMs: null });
  assert.deepEqual(half.drops, ["resolve: skip.endingStartMs dropped (out of range or out of order)"]);
  assert.equal(checkOutput("resolve", { ...base, skip: { openingEndMs: "90" } }, m).value.skip, undefined);
  // An explicit null start is the same as leaving it out (0); an invalid one drops the opening, as in the app.
  assert.deepEqual(checkOutput("resolve", { ...base, skip: { openingStartMs: null, openingEndMs: 90_000 } }, m).value.skip, { openingStartMs: 0, openingEndMs: 90_000, endingStartMs: null });
  assert.equal(checkOutput("resolve", { ...base, skip: { openingStartMs: -5, openingEndMs: 90_000 } }, m).value.skip, undefined);
  assert.equal(checkOutput("resolve", { ...base, skip: [1, 2] }, m).value.skip, undefined);
  // Without durationMs the ceiling is contract.output.skip.maxMs.
  assert.equal(checkOutput("resolve", { url: base.url, skip: { openingEndMs: contract.output.skip.maxMs + 1 } }, m).value.skip, undefined);
  assert.equal(checkOutput("resolve", { url: base.url, skip: { openingEndMs: 90_000 } }, m).value.skip.openingEndMs, 90_000);
});

test("a live channel's skip is ignored", () => {
  const m = JSON.parse(manifest({ apiVersion: 2 }));
  const r = checkOutput("resolve", { url: "https://example.com/live.m3u8", skip: { openingEndMs: 90_000 } }, m, [], { liveChannel: true });
  assert.equal(r.value.skip, undefined);
  assert.deepEqual(r.drops, ["resolve: skip is ignored for a live channel"]);
});

// apiVersion 6: "browser": true and kino.browser.capture, which the Node kit cannot run.
test("browser: read from apiVersion 6, its red consent line, and the kit answers browser_unavailable", async () => {
  const v = (extra, api = 6) => validateManifest(manifest({ apiVersion: api, ...extra }));
  assert.equal(v({ browser: true }).manifest.browser, true);
  assert.equal(v({ browser: true }, 5).manifest.browser, false);
  assert.deepEqual(v({ browser: "yes" }), { ok: false, field: "browser", message: contract.manifest.browser.notBooleanMessage });
  const lines = consentLines(v({ browser: true }).manifest);
  assert.deepEqual(lines.find((l) => l.text === contract.manifest.browser.consentLine), { text: contract.manifest.browser.consentLine, danger: true });
  const dir = mkdtempSync(join(tmpdir(), "kino-browser-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ try { await kino.browser.capture('https://example.com/e/1') } catch (e) { return { url: 'https://example.com/' + e.code + '.m3u8' } } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, browser: true }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "resolve", "x"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /browser_unavailable\.m3u8/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// apiVersion 6 "browser": "pages": page reads too (kino.browser.page), with its own red line; "browser": true stays
// capture-only with the old line. The kit has no browser.
test("browser pages: its own wider line, true keeps the old one, and page answers browser_unavailable in the kit", async () => {
  const v = (extra, api = 6) => validateManifest(manifest({ apiVersion: api, ...extra }));
  const text = (browser) => consentLines(v({ browser }).manifest).map((l) => l.text);
  assert.ok(text("pages").includes(contract.manifest.browser.pageConsentLine));
  assert.ok(!text("pages").includes(contract.manifest.browser.consentLine));
  assert.ok(text(true).includes(contract.manifest.browser.consentLine));
  assert.ok(!text(true).includes(contract.manifest.browser.pageConsentLine));
  assert.equal(v({ browser: "pages" }).manifest.browser, true);
  assert.equal(v({ browser: "pages" }).manifest.browserPages, true);
  assert.equal(v({ browser: true }).manifest.browserPages, false);
  assert.equal(v({ browser: "pages" }, 5).manifest.browser, false);
  assert.deepEqual(v({ browser: "page" }), { ok: false, field: "browser", message: contract.manifest.browser.notBooleanMessage });
  assert.equal(contract.maxApiVersion, 11);
  assert.equal(v({}, 12).ok, false);
  const dir = mkdtempSync(join(tmpdir(), "kino-browser-page-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(q){ try { await kino.browser.page('https://example.com/?s=' + q, { waitFor: 'article' }) } catch (e) { return [{ id: e.code, title: e.code, ref: e.code, kind: 'movie' }] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, browser: "pages" }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "search", "x"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /browser_unavailable/);
    const val = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(val.status, 0, val.stderr + val.stdout);
    assert.match(val.stdout + val.stderr, /kino\.browser\.page/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser page in the kit mirrors the app: invalid_request first, not_allowed without \"pages\", then browser_unavailable", async () => {
  const code = async (manifestExtra, ...args) => {
    const { kino } = createKino(validateManifest(manifest({ apiVersion: 6, ...manifestExtra })).manifest);
    try { await kino.browser.page(...args); return "ok"; } catch (e) { return e.code; }
  };
  assert.equal(await code({ browser: "pages" }, "https://example.com/", { timeoutMs: 999999 }), "invalid_request");
  assert.equal(await code({ browser: "pages" }, "https://example.com/", { waitFor: "(" }), "invalid_request");
  assert.equal(await code({ browser: "pages" }, "https://example.com/", { waitFor: "" }), "invalid_request");
  assert.equal(await code({ browser: true }, "https://example.com/"), "not_allowed");
  assert.equal(await code({ browser: "pages" }, "https://example.com/", { waitFor: /item.+end/s }), "browser_unavailable");
});

// apiVersion 7's tracking: a capability that plays nothing (alone, or with subtitles), approved in red with the plugin's
// hosts named, refused below 7; run.mjs hands track() the app's event shape.
test("tracking: apiVersion 7, standalone, its red consent line naming the hosts, and run.mjs calls track()", async () => {
  const v = (extra, api = 7) => validateManifest(manifest({ apiVersion: api, ...extra }));
  assert.equal(v({ capabilities: ["tracking"] }).ok, true);
  assert.equal(v({ capabilities: ["tracking", "subtitles"] }).ok, true);
  assert.equal(v({ capabilities: ["search", "resolve", "tracking"] }).ok, true);
  assert.deepEqual(v({ capabilities: ["tracking"] }, 6), { ok: false, field: "capabilities", message: 'The "tracking" capability needs apiVersion 7' });
  assert.deepEqual(requiredExports(["tracking"]), ["track"]);
  const lines = (hosts) => consentLines(v({ capabilities: ["tracking"], hosts }).manifest);
  assert.deepEqual(lines(["seenr.app"]), [{ text: "Le contará a seenr.app qué ves y cuándo lo terminas", danger: true }]);
  assert.deepEqual(lines(["a.com", "b.com", "c.com", "d.com", "e.com"]).map((l) => l.text), ["Le contará a a.com, b.com, c.com y 2 más qué ves y cuándo lo terminas"]);
  const dir = mkdtempSync(join(tmpdir(), "kino-tracking-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function track(e){ return { ok: true, type: e.type, kind: e.kind, imdb: e.ids.imdb, id: typeof e.id } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 7, capabilities: ["tracking"], hosts: ["seenr.app"] }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "track", "watched"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true, type: "watched", kind: "movie", imdb: "tt0133093", id: "string" });
    const val = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(val.status, 0, val.stderr + val.stdout);
    assert.match(val.stdout + val.stderr, /Le contará a seenr\.app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// apiVersion 7's segments: a capability that plays nothing, a plain consent line (no approval), and the answer judged
// entry by entry exactly as the app's Segments.parse does (SegmentsTest pins the same vectors).
test("segments: apiVersion 7, standalone, plain consent line, and each bad entry dropped on its own", () => {
  const v = (extra, api = 7) => validateManifest(manifest({ apiVersion: api, ...extra }));
  assert.equal(v({ capabilities: ["segments"] }).ok, true);
  assert.equal(v({ capabilities: ["segments", "subtitles", "tracking"] }).ok, true);
  assert.deepEqual(v({ capabilities: ["segments"] }, 6), { ok: false, field: "capabilities", message: 'The "segments" capability needs apiVersion 7' });
  assert.deepEqual(requiredExports(["segments"]), ["segments"]);
  assert.equal(contract.capabilities.needsApproval.includes("segments"), false);
  assert.deepEqual(consentLines(v({ capabilities: ["segments"] }).manifest), [{ text: "Agrega el botón para saltar la intro y los créditos", danger: false }]);

  const drops = [];
  const kept = segmentsAnswer([
    { type: "intro", startMs: 60000, endMs: 150000 },
    { type: "intro", startMs: 100000, endMs: 170000 },            // overlaps the first intro
    { type: "recap", startMs: 0, endMs: 60000 },
    { type: "credits", startMs: 1300000, endMs: 1442000 },        // cut to the length
    { type: "outro", startMs: 1300000, endMs: 1500000 },          // ends far past the file
    { type: "preview", startMs: 1450000, endMs: 1460000 },        // starts past the file
    { type: "opening", startMs: 1, endMs: 5000 },                 // unknown type
    { type: "intro", startMs: "1", endMs: 5000 },                 // not a number
    { type: "intro", startMs: 2000.5, endMs: 5000 },              // not whole ms
    { type: "intro", startMs: -5, endMs: 5000 },
    { type: "outro", startMs: 900000, endMs: 900500 },            // too short
    null, [], "intro",
  ], 1440000, (d) => drops.push(d));
  assert.deepEqual(kept, [
    { type: "recap", startMs: 0, endMs: 60000 },
    { type: "intro", startMs: 60000, endMs: 150000 },
    { type: "credits", startMs: 1300000, endMs: 1440000 },
  ]);
  assert.equal(drops.length, 11);
  assert.deepEqual(segmentSkip(kept), { openingStartMs: 60000, openingEndMs: 150000, endingStartMs: 1300000 });
  assert.deepEqual(segmentsAnswer({ intro: [0, 1] }, 0, () => {}), []);
  assert.deepEqual(segmentsAnswer(null, 0, () => { throw new Error("null is no drop"); }), []);
  const many = Array.from({ length: 150 }, (_, i) => ({ type: "recap", startMs: i * 10000, endMs: i * 10000 + 5000 }));
  assert.equal(segmentsAnswer(many, 0).length, contract.segments.maxSegments);
  assert.equal(segmentSkip([{ type: "recap", startMs: 0, endMs: 9000 }]), null);
  // An ending that starts inside the opening is no ending.
  assert.deepEqual(segmentSkip([{ type: "intro", startMs: 0, endMs: 90000 }, { type: "outro", startMs: 30000, endMs: 95000 }]), { openingStartMs: 0, openingEndMs: 90000, endingStartMs: null });
});

test("segments: run.mjs builds the app's query and prints what Kino keeps", () => {
  assert.deepEqual(segmentsArg(["tt0133093", "8160000"]), { kind: "movie", ids: { imdb: "tt0133093" }, durationMs: 8160000 });
  assert.deepEqual(segmentsArg(["tmdb:1396", "1", "2"]), { kind: "episode", ids: {}, show: { ids: { tmdb: 1396 } }, season: 1, episode: 2 });
  assert.deepEqual(segmentsArg(["tmdb:1396", "1", "2", "2880000"]).durationMs, 2880000);
  assert.throws(() => segmentsArg(["Breaking Bad"]));
  const dir = mkdtempSync(join(tmpdir(), "kino-segments-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function segments(q){ return [{ type: 'intro', startMs: 1000, endMs: 61000, kind: q.kind }, { type: 'outro', startMs: q.durationMs - 1000, endMs: q.durationMs + 9000 }] }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 7, capabilities: ["segments"], hosts: ["example.com"] }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "segments", "tt0133093", "2000000"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [{ type: "intro", startMs: 1000, endMs: 61000 }]);
    assert.match(r.stderr, /ends past the file's end/);
    assert.match(r.stderr, /"openingEndMs":61000/);
    const val = spawnSync(process.execPath, [join(here, "..", "validate.mjs"), dir], { encoding: "utf8" });
    assert.equal(val.status, 0, val.stderr + val.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- meta (apiVersion 6): the app's TitleMetaOutput.parse, the query it builds, its timeout and the info page ---
// The vectors the app's TitleMetaVectorsTest checks too. Absent in a published plugin repo: those tests skip there.
const metaVectorsFile = join(here, "..", "..", "..", "docs", "plugins", "fixtures", "meta", "vectors.json");
const metaVectors = existsSync(metaVectorsFile) ? JSON.parse(readFileSync(metaVectorsFile, "utf8")).vectors : null;
const M = contract.output.meta;
const field = (r, name) => r.fields.find((f) => f.field === name);

test("meta: every shared vector keeps exactly what the app keeps", (t) => {
  if (!metaVectors) return t.skip("no shared meta vectors around this kit");
  assert.ok(metaVectors.length >= 20);
  for (const v of metaVectors) assert.deepEqual(metaAnswer(v.answer, v.servers).value, v.expected, v.name);
});

test("meta: checkOutput reads it like the app, the 2,000,000-character cap included", () => {
  const m = validateManifest(manifest({ apiVersion: 6, capabilities: ["search", "resolve", "meta"] })).manifest;
  const r = checkOutput("meta", { title: "T", poster: "http://nas/p.png" }, m);
  assert.equal(r.value.title, "T");
  assert.equal(r.value.poster, "");
  assert.deepEqual(r.drops, ['meta: poster dropped: http to "nas", a name without a dot: a device on the home network']);
  assert.equal(checkOutput("meta", null, m).value, null);
  assert.throws(() => checkOutput("meta", { overview: "x".repeat(contract.output.maxResultChars) }, m), /too large/);
});

test("meta: a valid answer is kept field by field, and the verdict says so", () => {
  const r = metaAnswer({
    title: "Big Buck Bunny", overview: "Un conejo.", poster: "https://img.example.org/p.png", backdrop: "https://img.example.org/b.png", year: 2008,
    genres: ["Animación"], runtimeMinutes: 10, logo: "https://img.example.org/l.png", ratings: [{ source: "imdb", value: 6.4 }],
    cast: [{ name: "Ana", character: "Conejo", photo: "https://img.example.org/a.png" }],
    episodes: [{ season: 1, number: 1, title: "Uno" }],
  });
  assert.equal(r.noAnswer, null);
  assert.deepEqual(r.drops, []);
  for (const k of ["title", "overview", "poster", "backdrop", "year", "genres", "runtimeMinutes", "episodes", "logo", "ratings", "cast"]) assert.equal(field(r, k).status, "kept", k);
  assert.equal(r.value.year, "2008");
  assert.deepEqual(r.value.ratings, [{ source: "imdb", value: "6.4" }]);
  assert.match(field(r, "logo").detail, /instead of the title's name/);
  assert.match(field(r, "title").detail, /not shown/);
  const lines = metaVerdictLines(r.fields);
  assert.match(lines[0], /^ {2}✓ title +kept: 14 characters/);
});

test("meta: each dropped field says why", () => {
  const r = metaAnswer({
    title: true, overview: "   ", poster: "https://10.0.0.5/p.png", backdrop: "http://tv/b.png", logo: "ftp://img.example.org/l.png",
    year: "estrenada 1999", genres: "Drama", runtimeMinutes: 0, episodes: { season: 1 }, ratings: [{ source: "netflix", value: "9" }],
    cast: [{ character: "Nadie" }], tagline: "x",
  });
  assert.equal(r.value, null);
  assert.match(r.noAnswer, /nothing Kino can use/);
  const why = Object.fromEntries(r.fields.map((f) => [f.field, `${f.status}: ${f.detail}`]));
  assert.equal(why.title, 'dropped: a boolean, not text: Kino reads ""');
  assert.equal(why.overview, "dropped: empty");
  assert.equal(why.poster, "dropped: 10.0.0.5 is a private, local or reserved IP address: never the home network");
  assert.equal(why.backdrop, 'dropped: http to "tv", a name without a dot: a device on the home network');
  assert.equal(why.logo, "dropped: not an http(s) URL (ftp)");
  assert.equal(why.year, `dropped: no four digits in its first ${M.yearReadChars} characters ("estrenada")`);
  assert.equal(why.genres, "dropped: a string, not a list");
  assert.equal(why.runtimeMinutes, `dropped: 0 is not ${contract.output.minRuntimeMinutes}..${contract.output.maxRuntimeMinutes} minutes`);
  assert.equal(why.episodes, "dropped: an object, not a list");
  assert.match(why.ratings, /^dropped: 0 of 1/);
  assert.deepEqual(field(r, "ratings").items, [`#0: source "netflix" is not one of ${M.ratingSources.join(", ")}`]);
  assert.deepEqual(field(r, "cast").items, ["#0: no name"]);
  assert.equal(why.tagline, "ignored: not a meta field: Kino never reads it");
  // Every dropped entry is a [dropped by Kino] line too.
  assert.ok(r.drops.includes('meta: ratings #0: source "netflix" is not one of ' + M.ratingSources.join(", ")));
});

test("meta: no answer, and why", () => {
  assert.match(metaAnswer(null).noAnswer, /answered null/);
  assert.match(metaAnswer([{ title: "t" }]).noAnswer, /an array, not an object/);
  assert.match(metaAnswer("t").noAnswer, /a string, not an object/);
  const alone = metaAnswer({ year: "1999", runtimeMinutes: 90 });
  assert.equal(alone.value, null);
  assert.match(alone.noAnswer, /only year and runtimeMinutes survived/);
  for (const k of M.answerFields) assert.notEqual(metaAnswer({ [k]: { title: "T", overview: "O", poster: "https://a.example/p.png", backdrop: "https://a.example/b.png", logo: "https://a.example/l.png", episodes: [{ season: 1, number: 1 }], genres: ["G"], ratings: [{ source: "imdb", value: "7" }], cast: [{ name: "N" }] }[k] }).value, null, k);
});

test("meta: the limits come from contract.json", () => {
  const cast = metaAnswer({ cast: Array.from({ length: M.maxCast + 3 }, (_, i) => ({ name: `N${i}`, character: "c".repeat(M.maxCastNameChars + 5) })) });
  assert.equal(cast.value.cast.length, M.maxCast);
  assert.equal(cast.value.cast[0].character.length, M.maxCastNameChars);
  assert.ok(field(cast, "cast").items.includes(`3 beyond ${M.maxCast} dropped`));
  const sources = M.ratingSources.slice(0, M.maxRatings + 2).map((source) => ({ source, value: "7" }));
  const ratings = metaAnswer({ ratings: sources });
  assert.equal(ratings.value.ratings.length, M.maxRatings);
  assert.ok(field(ratings, "ratings").items.some((i) => i.includes(`beyond ${M.maxRatings} ratings`)));
  // The cap counts entries read, invalid ones too: a list of maxEpisodes + 2 whose first is broken keeps maxEpisodes - 1.
  const eps = [null, ...Array.from({ length: M.maxEpisodes + 1 }, (_, i) => ({ season: 1, number: i + 1 }))];
  const many = metaAnswer({ episodes: eps });
  assert.equal(many.value.episodes.length, M.maxEpisodes - 1);
  assert.match(field(many, "episodes").items[0], new RegExp(`only the first ${M.maxEpisodes} entries`));
  const genres = metaAnswer({ genres: Array.from({ length: contract.output.maxGenres + 2 }, (_, i) => `G${i}`) });
  assert.equal(genres.value.genres.length, contract.output.maxGenres);
  assert.equal(metaAnswer({ title: "x".repeat(contract.output.maxTitleChars + 1) }).value.title.length, contract.output.maxTitleChars);
  assert.equal(field(metaAnswer({ title: "x".repeat(contract.output.maxTitleChars + 1) }), "title").status, "cut");
});

test("meta: ratings are read like the app (numbers as written, scales, one per source)", () => {
  const r = metaAnswer({ ratings: [{ source: "IMDb", value: 8.8 }, { source: "tmdb", value: 85 }, { source: "trakt", value: 0 }, { source: "mal", value: "8,75" }, { source: "letterboxd", value: " 4.1/5 " }, { source: "imdb", value: "1" }] });
  assert.deepEqual(r.value.ratings.map((x) => `${x.source} ${x.value}`), ["imdb 8.8", "tmdb 85", "trakt 0", "mal 8,75", "letterboxd 4.1/5"]);
  assert.deepEqual(field(r, "ratings").items, ["#5 imdb: a second imdb rating, the first one stays"]);
  const bad = metaAnswer({ ratings: [{ source: "imdb", value: -1 }, { source: "imdb", value: "1234" }, { source: "imdb", value: 0.001 }, { source: "imdb", value: true }] });
  assert.deepEqual(field(bad, "ratings").items, [
    "#0 imdb: value -1 is not a string or a number >= 0",
    '#1 imdb: value "1234" is not like "8.8", "94%", "4.1/5" (up to 3 digits, 2 decimals)',
    '#2 imdb: value "0.001" is not like "8.8", "94%", "4.1/5" (up to 3 digits, 2 decimals)',
    "#3 imdb: value true is not a string or a number >= 0",
  ]);
});

test("meta: image URLs follow PluginOutput.imageUrl, with the reason", () => {
  const own = ["http://192.168.1.10:8096"];
  const cases = [
    ["http://192.168.1.10:8096/p.png", own, "a server the person typed"],
    ["http://192.168.1.10:8097/p.png", own, "192.168.1.10 is a private, local or reserved IP address: never the home network"],
    ["http://img.example.org/p.png", [], "a public name (plain http is fine for a picture)"],
    ["https://img.example.org/p.png", [], "a public name"],
    ["http://8.8.8.8/p.png", [], "a public IPv4 address"],
    ["https://nas/p.png", [], "a public name"],
    ["http://nas/p.png", [], 'http to "nas", a name without a dot: a device on the home network'],
    ["http://localhost/p.png", [], "localhost is localhost: never the home network"],
    ["https://nas.local/p.png", [], "nas.local is a local name (.local): never the home network"],
    ["http://[::1]/p.png", [], "[::1] is an IPv6 address: never the home network"],
    ["http://010.1.1.1/p.png", [], "010.1.1.1 is a private, local or reserved IP address: never the home network"],
    ["HTTPS://img.example.org/p.png", [], 'does not start with "https://" or "http://" (lowercase, two slashes)'],
    ["ftp://img.example.org/p.png", [], "not an http(s) URL (ftp)"],
    ["img.example.org/p.png", [], "not a URL"],
    ["", [], "empty"],
    [`https://img.example.org/${"a".repeat(contract.output.maxImageUrlChars)}`, [], `longer than ${contract.output.maxImageUrlChars} characters`],
  ];
  for (const [url, servers, why] of cases) assert.equal(imageVerdict(url, servers).why, why, url);
  assert.equal(imageVerdict("  https://img.example.org/p.png ").url, "https://img.example.org/p.png");
  // In a meta answer a longer URL is dropped, never cut into a broken address (GlitchTip, 0.9.52).
  const long = metaAnswer({ overview: "x", logo: `https://img.example.org/${"a".repeat(contract.output.maxImageUrlChars)}` });
  assert.equal(long.value.logo, "");
  assert.equal(field(long, "logo").status, "dropped");
  assert.match(field(long, "logo").detail, new RegExp(`longer than ${contract.output.maxImageUrlChars} characters`));
});

test("meta: numbers are read the way Android's org.json reads them", () => {
  assert.equal(optInt("90", 0), 90);
  assert.equal(optInt(" 1.9 ", -1), 1);
  assert.equal(optInt(90.7, 0), 90);
  assert.equal(optInt(true, -1), -1);
  assert.equal(optInt("abc", -1), -1);
  assert.equal(optInt(4294967297, -1), 1);
  assert.equal(metaAnswer({ title: 1917 }).value.title, "1917");
  assert.equal(metaAnswer({ title: 8.5 }).value.title, "8.5");
  assert.equal(metaAnswer({ title: "t", year: 1999 }).value.year, "1999");
  assert.equal(metaAnswer({ episodes: [{ season: "1", number: "2" }] }).value.episodes[0].number, 2);
});

test("meta: run.mjs builds the app's query (TitleMetaQuery.json), never from a ref", () => {
  const env = { KINO_LANG: "es" };
  // The same key order as the app: type, ids (imdb, tmdb, kitsu, mal, anilist), id, lang.
  assert.equal(JSON.stringify(metaArg(["kitsu:1376", "series", "tt0944947", "tmdb:1399"], env)), '{"type":"series","ids":{"imdb":"tt0944947","tmdb":1399,"kitsu":1376},"id":"kitsu:1376","lang":"es"}');
  assert.deepEqual(metaArg(["tt0133093"], env), { type: "movie", ids: { imdb: "tt0133093" }, lang: "es" });
  assert.deepEqual(metaArg(["tmdb:603", "lang=en"], env), { type: "movie", ids: { tmdb: 603 }, lang: "en" });
  assert.deepEqual(metaArg(["id=tt0133093:1:1", "movie"], env), { type: "movie", ids: {}, id: "tt0133093:1:1", lang: "es" });
  assert.deepEqual(metaArg(['{"type":"series","ids":{"anilist":21,"imdb":"tt0388629"}}'], env), { type: "series", ids: { imdb: "tt0388629", anilist: 21 }, lang: "es" });
  assert.equal(metaArg(["tt0133093"], {}).lang, "es");
  assert.throws(() => metaArg(["matrix-1999"], env), /takes a title's ids, not a ref/);
  assert.throws(() => metaArg([], env), /at least one id/);
  assert.throws(() => metaArg(["series"], env), /at least one id/);
  assert.throws(() => metaArg(['{"type":"anime","ids":{"imdb":"tt1"}}'], env), /"movie" or "series"/);
  assert.throws(() => metaArg(['{"type":"movie","ids":{"tvdb":1}}'], env), /never sends ids.tvdb/);
  assert.throws(() => metaArg(['{"type":"movie","ids":{"tmdb":"603"}}'], env), /positive integer/);
  assert.throws(() => metaArg(["{nope"], env), /not valid JSON/);
  // validate.mjs's chained call: a listed title by the ids it carries.
  assert.deepEqual(metaQueryForItem({ kind: "series", imdb: "tt0944947", tmdb: 1399 }, "es"), { type: "series", ids: { imdb: "tt0944947", tmdb: 1399 }, lang: "es" });
  assert.equal(metaQueryForItem({ kind: "movie", imdb: "", tmdb: 0 }, "es"), null);
  assert.equal(metaQueryForItem({ kind: "live", imdb: "tt0944947" }, "es"), null);
});

test("meta: the plugin gets exactly that query, within the app's time", async () => {
  assert.equal(contract.timeoutsMs.meta, 6000);
  let got;
  const quick = { meta: async (q) => { got = q; return { title: "T" }; } };
  const q = metaArg(["tt0133093", "tmdb:603"], { KINO_LANG: "es" });
  assert.deepEqual(await callMeta(quick, q), { title: "T" });
  assert.deepEqual(got, q);
  const slow = { meta: () => new Promise(() => {}) };
  await assert.rejects(callMeta(slow, q, 30), (e) => e.metaTimeout === true && /did not answer within 0.03 s/.test(e.message) && /not remembered/.test(e.message));
  await assert.rejects(callMeta({ meta: async () => { throw new Error("boom"); } }, q), /boom/);
});

test("meta: the info page summary follows the page's rules", () => {
  const lines = metaPageLines(metaAnswer({
    logo: "https://img.example.org/l.png", poster: "https://img.example.org/p.png", year: "2011", runtimeMinutes: 57, overview: "<b>Siete</b> familias",
    ratings: [{ source: "imdb", value: "9.2" }, { source: "tmdb", value: "8.4" }], cast: Array.from({ length: 7 }, (_, i) => ({ name: `A${i}`, character: "c" })),
    episodes: [{ season: 0, number: 1 }, { season: 1, number: 1 }],
  }).value, { type: "series" }).join("\n");
  assert.match(lines, /top: the logo https:\/\/img.example.org\/l.png instead of the title's name/);
  assert.match(lines, /background: https:\/\/img.example.org\/p.png \(the poster: no usable backdrop\)/);
  assert.match(lines, /info line: ★ <the page's score> {2}· {2}IMDb 9.2 {2}· {2}TMDB 8.4 {2}· {2}2011 {2}\(the TMDB rating is left out when the page already has a score\)/);
  assert.match(lines, /runtime: not shown \(57 min is per episode on a series\)/);
  assert.match(lines, /synopsis: Siete familias/);
  assert.match(lines, new RegExp(`Reparto \\(only when TMDB has no cast\\): ${Array.from({ length: M.pageCastNames }, (_, i) => `A${i}`).join(", ")} {2}\\(\\+2 kept, not shown\\)`));
  assert.match(lines, /episodes: 2: .*season 0 is never listed/);
  const movie = metaPageLines(metaAnswer({ runtimeMinutes: 103, episodes: [{ season: 1, number: 1 }] }).value, { type: "movie" }).join("\n");
  assert.match(movie, /1 h 43 min/);
  assert.match(movie, /episodes: 1, ignored for a movie/);
});

/** A plugin folder for the meta CLI tests: [extra] manifest fields, [code] its entry. */
function metaPlugin(code, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kino-meta-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, capabilities: ["search", "resolve", "meta"], hosts: ["img.example.org"], ...extra }));
  writeFileSync(join(dir, "plugin.js"), `export async function search(){ return [{ id: "a", ref: "a", title: "A", kind: "movie", ids: { imdb: "tt0133093", tmdb: 603 } }] }
export async function resolve(){ return { url: "https://img.example.org/v.mp4" } }
${code}`);
  return dir;
}

test("run.mjs meta: raw answer, verdict, what Kino keeps on stdout, and the page", () => {
  const dir = metaPlugin(`export async function meta(q){ return { title: "Matrix", poster: "http://192.168.1.4/p.png", logo: "https://img.example.org/l.png", ratings: [{ source: "imdb", value: 8.7 }], cast: [{ name: "Keanu" }], extra: 1, asked: q } }`);
  try {
    const r = runCli([dir, "meta", "tt0133093", "tmdb:603"]);
    assert.equal(r.code, 0, r.stderr);
    const kept = JSON.parse(r.stdout);
    assert.equal(kept.poster, "");
    assert.equal(kept.logo, "https://img.example.org/l.png");
    assert.deepEqual(kept.ratings, [{ source: "imdb", value: "8.7" }]);
    assert.match(r.stderr, /meta\(\{"type":"movie","ids":\{"imdb":"tt0133093","tmdb":603\},"lang":"es"\}\)/);
    assert.match(r.stderr, /the plugin answered:\n\{\n {2}"title": "Matrix"/);
    assert.match(r.stderr, /"asked": \{\n {4}"type": "movie"/);
    assert.match(r.stderr, /✗ poster +dropped: 192.168.1.4 is a private/);
    assert.match(r.stderr, /- extra +ignored/);
    assert.match(r.stderr, /How the info page would use it/);
    assert.match(r.stderr, /logo, ratings, cast need Kino 0.9.51 or newer/);
    const raw = runCli(["--raw", dir, "meta", "tt0133093"]);
    assert.equal(JSON.parse(raw.stdout).poster, "http://192.168.1.4/p.png");
    assert.equal(runCli([dir, "meta", "matrix"]).code, 2);
    assert.match(runCli([dir, "meta"]).stderr, /at least one id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run.mjs meta: null is no answer, not a failure; a throw is a failure the app keeps silent", () => {
  const none = metaPlugin("export async function meta(){ return null }");
  const boom = metaPlugin("export async function meta(){ throw kino.error('unavailable', 'down') }");
  try {
    const r = runCli([none, "meta", "tt0133093"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "null");
    assert.match(r.stderr, /no answer: the plugin answered null/);
    const b = runCli([boom, "meta", "tt0133093"]);
    assert.equal(b.code, 1);
    assert.match(b.stderr, /in the app: no answer and nothing on screen, only a log line \("\[demo\] meta failed …"\)/);
  } finally {
    rmSync(none, { recursive: true, force: true });
    rmSync(boom, { recursive: true, force: true });
  }
});

test("run.mjs meta: a plugin without meta gets a clear message", () => {
  const undeclared = metaPlugin("export async function meta(){ return null }", { capabilities: ["search", "resolve"] });
  const unexported = metaPlugin("");
  try {
    const a = runCli([undeclared, "meta", "tt0133093"]);
    assert.equal(a.code, 2);
    assert.equal(a.stderr.trim(), NO_META_CAPABILITY);
    const b = runCli([unexported, "meta", "tt0133093"]);
    assert.equal(b.code, 2);
    assert.match(b.stderr, /plugin.js does not export meta\(\): the manifest declares "meta", so Kino refuses the install/);
  } finally {
    rmSync(undeclared, { recursive: true, force: true });
    rmSync(unexported, { recursive: true, force: true });
  }
});

test("run.mjs meta: past the app's 6 s it stops waiting, even with the plugin's work still pending", () => {
  const dir = metaPlugin("export async function meta(){ return new Promise(() => {}) }");
  try {
    const started = Date.now();
    const r = runCli([dir, "meta", "tt0133093"]);
    const took = Date.now() - started;
    assert.equal(r.code, 1);
    assert.match(r.stderr, /✗ meta did not answer within 6 s/);
    assert.ok(took >= contract.timeoutsMs.meta && took < contract.timeoutsMs.meta + 5000, `took ${took} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run: meta directly, and chained after search on the first title with ids", async () => {
  const dir = metaPlugin(`export async function meta(q){ return q.ids.imdb === "tt0133093" ? { title: "Matrix", poster: "http://nas/p.png" } : null }`);
  const broken = metaPlugin("export async function meta(){ throw new Error('meta exploded') }");
  const noIds = metaPlugin("export async function meta(){ return { title: 'x' } }");
  writeFileSync(join(noIds, "plugin.js"), readFileSync(join(noIds, "plugin.js"), "utf8").replace('ids: { imdb: "tt0133093", tmdb: 603 }', "ids: {}"));
  try {
    const direct = await validate(dir, { run: "meta", args: ["tt0133093"] });
    assert.equal(direct.ok, true, direct.problems.join("\n"));
    assert.deepEqual(direct.drops, ['meta: poster dropped: http to "nas", a name without a dot: a device on the home network']);
    const missing = await validate(dir, { run: "meta", args: ["tt9999999"] });
    assert.ok(missing.notes.includes("meta: no answer (the plugin answered null: not a title it knows)"));
    const chained = await validate(dir, { run: "search", args: ["matrix"] });
    assert.equal(chained.ok, true, chained.problems.join("\n"));
    const label = 'meta({"type":"movie","ids":{"imdb":"tt0133093","tmdb":603},"lang":"es"}) for "A"';
    assert.ok(chained.drops.includes(`${label}: poster dropped: http to "nas", a name without a dot: a device on the home network`), chained.drops.join("\n"));
    assert.ok(chained.notes.includes(`${label}: Kino keeps title`), chained.notes.join("\n"));
    const failed = await validate(broken, { run: "search", args: ["matrix"] });
    assert.equal(failed.ok, false);
    assert.ok(failed.problems.some((p) => p.includes("meta exploded")), failed.problems.join("\n"));
    const none = await validate(noIds, { run: "search", args: ["matrix"] });
    assert.ok(none.notes.some((n) => n.includes("no title in this answer carries ids.imdb or ids.tmdb")), none.notes.join("\n"));
    // The chain uses the app's timeout too.
    const r = await metaForFirstTitle({ meta: () => new Promise(() => {}) }, { items: [{ id: "a", ref: "a", title: "A", kind: "movie", imdb: "tt0133093", tmdb: 0 }] }, {}, [], 20);
    assert.match(r.problem, /did not answer within/);
  } finally {
    for (const d of [dir, broken, noIds]) rmSync(d, { recursive: true, force: true });
  }
});

// --- validate --run: the section, categories and settings form, like run.mjs (no capability, the manifest decides) ---
const sectionDemo = join(here, "section-demo");
const settingsDemo = join(here, "settings-demo");

test("validate --run section and categories check the answer as the app does", async () => {
  const sec = await validate(sectionDemo, { run: "section", args: ["series"] });
  assert.equal(sec.ok, true, sec.problems.join("\n"));
  assert.equal(sec.output.tab, "series");
  assert.equal(sec.output.rows.length, 2);
  const cats = await validate(sectionDemo, { run: "categories" });
  assert.equal(cats.ok, true, cats.problems.join("\n"));
  assert.deepEqual(cats.output.map((c) => c.id), ["accion", "comedia", "drama"]);
  // Calls the app never makes are problems.
  const noSection = await validate(settingsDemo, { run: "section" });
  assert.deepEqual(noSection.problems, ['"section" needs "section" in the manifest']);
  const noBrowse = await validate(settingsDemo, { run: "categories" });
  assert.deepEqual(noBrowse.problems, [`"categories" needs apiVersion ${contract.output.categories.apiVersion} and the browse capability`]);
});

test("validate --run section chains meta on its first title with ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-section-meta-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6, capabilities: ["home", "resolve", "meta"], section: { label: "S" } }));
    writeFileSync(join(dir, "plugin.js"), `const it = { id: "a", ref: "a", title: "A", kind: "movie", ids: { imdb: "tt0133093" } };
export async function home(){ return [] }
export async function resolve(){ return { url: "https://example.com/v.mp4" } }
export async function section(){ return { rows: [{ id: "r", title: "R", items: [it] }] } }
export async function meta(q){ return { title: "Matrix", year: q.ids.imdb === "tt0133093" ? "1999" : "" } }`);
    const r = await validate(dir, { run: "section" });
    assert.equal(r.ok, true, r.problems.join("\n"));
    assert.ok(r.notes.includes('meta({"type":"movie","ids":{"imdb":"tt0133093"},"lang":"es"}) for "A": Kino keeps title, year'), r.notes.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate --run settingsStatus, action and validateSettings read the answer as the app does", async () => {
  const status = await validate(settingsDemo, { run: "settingsStatus", config: { email: "ana@x.co" } });
  assert.equal(status.ok, true, status.problems.join("\n"));
  assert.deepEqual(status.output, { linked: "Sin cuenta: sesión anónima" });
  assert.ok(status.notes.includes("settingsStatus: no line for slow (Kino shows nothing there)"));
  const action = await validate(settingsDemo, { run: "action", args: ["logout"] });
  assert.equal(action.ok, true, action.problems.join("\n"));
  assert.deepEqual(action.output, { message: "Sesión cerrada", refresh: true, clearSettings: [] });
  assert.ok(action.notes.includes('action("logout"): Kino shows "Sesión cerrada", then reads settingsStatus again'));
  const boom = await validate(settingsDemo, { run: "action", args: ["boom"] });
  assert.deepEqual(boom.problems, ["action: falló a propósito"]);
  const unknown = await validate(settingsDemo, { run: "action", args: ["nope"] });
  assert.deepEqual(unknown.problems, ['no "action" setting has the key "nope": Kino never calls action("nope") (actions: test, logout, boom)']);
  const noKey = await validate(settingsDemo, { run: "action" });
  assert.deepEqual(noKey.problems, ['"action" needs the key of an action setting (test, logout, boom)']);
  const refused = await validate(settingsDemo, { run: "validateSettings", args: ['{"email":"ana"}'] });
  assert.equal(refused.ok, true, refused.problems.join("\n"));
  assert.deepEqual(refused.output, { accepted: false, fieldErrors: { email: "Escribe un correo válido" }, general: null });
  const accepted = await validate(settingsDemo, { run: "validateSettings", args: ['{"email":"ana@x.co"}'] });
  assert.deepEqual(accepted.output, { accepted: true });
  assert.ok(accepted.notes.includes("validateSettings accepts the save"));
  const odd = await validate(settingsDemo, { run: "validateSettings", args: ['{"password":"rara"}'] });
  assert.equal(odd.ok, false);
  assert.match(odd.problems[0], /^validateSettings: validateSettings must return null, a string or an object/);
  const badJson = await validate(settingsDemo, { run: "validateSettings", args: ["{nope"] });
  assert.match(badJson.problems[0], /must be a JSON object of setting values/);
});

test("validate --run: a settings function the plugin doesn't export is a problem", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-novalidate-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 6 }));
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/v.mp4' } }");
    const r = await validate(dir, { run: "validateSettings", args: ["{}"] });
    assert.deepEqual(r.problems, ["the plugin doesn't export validateSettings()"]);
    const st = await validate(dir, { run: "settingsStatus" });
    assert.deepEqual(st.problems, ["the plugin doesn't export settingsStatus()"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("catalogOnly: resolve may be left out, one of home/browse/search/meta is needed; the same rules and words as the app", () => {
  const co = contract.manifest.catalogOnly;
  const cat = (capabilities, extra = {}) => manifest({ apiVersion: 7, capabilities, catalogOnly: true, ...extra });
  for (const one of co.atLeastOneOf) {
    const r = validateManifest(cat([one]));
    assert.equal(r.ok, true, one);
    assert.equal(r.manifest.catalogOnly, true);
  }
  const tmdb = validateManifest(cat(["search", "home", "browse", "episodes", "resolve", "meta"])).manifest;
  assert.ok(requiredExports(tmdb.capabilities).includes("resolve"));
  for (const apiVersion of [1, 4, 7, 8]) assert.equal(validateManifest(manifest({ apiVersion, capabilities: ["home", "resolve"], catalogOnly: true })).manifest.catalogOnly, true);
  assert.equal(validateManifest(manifest()).manifest.catalogOnly, false);
  for (const caps of [["resolve"], ["episodes"], ["subtitles"], []]) {
    assert.deepEqual(validateManifest(cat(caps)), { ok: false, field: "catalogOnly", message: co.atLeastOneOfMessage });
  }
  const forbids = (name) => ({ ok: false, field: "catalogOnly", message: co.forbidsMessage.replace("{name}", name) });
  assert.deepEqual(validateManifest(cat(["home", "drm", "download"])), forbids("download"));
  assert.deepEqual(validateManifest(cat(["home", "drm"])), forbids("drm"));
  assert.deepEqual(validateManifest(cat(["home", "channels"])), forbids("channels"));
  assert.deepEqual(validateManifest(cat(["home"], { streamHosts: "any" })), forbids("streamHosts"));
  assert.deepEqual(validateManifest(cat(["home"], { browser: true })), forbids("browser"));
  assert.equal(validateManifest(cat(["home"], { browser: "pages" })).ok, true);
  assert.equal(validateManifest(cat(["home"], { apiVersion: 3, streamHosts: "any" })).ok, true);
  assert.equal(validateManifest(cat(["home"], { apiVersion: 5, browser: true })).ok, true);
  for (const value of ["true", 1, null, []]) {
    assert.deepEqual(validateManifest(manifest({ catalogOnly: value })), { ok: false, field: "catalogOnly", message: co.notBooleanMessage });
  }
  assert.deepEqual(validateManifest(manifest({ capabilities: ["home"] })), { ok: false, field: "capabilities", message: 'The plugin must declare "resolve"' });
  assert.equal(contract.additiveFromApp.catalogOnly, "0.9.54");
  // No apiVersion of its own: catalogOnly is valid at every apiVersion.
  assert.equal(contract.apiVersion, 11);
});

test("catalogOnly: validate prints the consent line and what an older Kino does with it", async () => {
  const co = contract.manifest.catalogOnly;
  const dir = mkdtempSync(join(tmpdir(), "kino-catalog-only-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function home(){ return [] }\nexport async function search(){ return [] }\nexport async function resolve(){ throw kino.error('not_found', 'catalog only') }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ capabilities: ["home", "search", "resolve"], catalogOnly: true }));
    let r = await validate(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.consent, [{ text: co.consentLine.es, danger: false }]);
    assert.deepEqual(r.notes, [co.olderApps.compatibleNote.replace("{fromApp}", "0.9.54")]);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ capabilities: ["browse", "meta"], catalogOnly: true, apiVersion: 6 }));
    writeFileSync(join(dir, "plugin.js"), "export async function browse(){ return { items: [] } }\nexport async function meta(){ return null }");
    r = await validate(dir);
    assert.equal(r.ok, true, r.problems.join("; "));
    assert.equal(r.notes.filter((n) => /catalogOnly/.test(n)).length, 1);
    assert.ok(r.notes.some((n) => /rechaza este plugin porque le falta "resolve", "search" o "home"/.test(n)), r.notes.join("\n"));
    assert.deepEqual(consentLines(validateManifest(manifest()).manifest), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catalogOnly: run.mjs still runs resolve, and says Kino 0.9.54+ never calls it", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-catalog-only-run-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function home(){ return [] }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ capabilities: ["home", "resolve"], catalogOnly: true }));
    const r = runCli([dir, "resolve", "x"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /Kino 0\.9\.54 y posteriores nunca llaman resolve/);
    const home = runCli([dir, "home"]);
    assert.doesNotMatch(home.stderr, /nunca llaman resolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Kino 0.9.55: English variants of the settings form's texts and of section.label (PluginSettingsEnglishTest's mirror).
test("English variants of setting texts: kept, shown under en, base under es, fallback when missing", () => {
  const settings = [
    { key: "about", label: "Acerca", labelEn: "About", type: "section", hint: "Inicia sesión", hintEn: "Sign in" },
    { key: "email", label: "Correo", labelEn: "Email", type: "text", hint: "tu@correo.com", hintEn: "you@mail.com" },
    { key: "quality", label: "Calidad", type: "select", options: [{ value: "hd", label: "Alta", labelEn: "High" }, { value: "sd", label: "Normal" }] },
    { key: "servers", label: "Servidores", type: "list", fields: [{ key: "name", label: "Nombre", labelEn: "Name", type: "text" }, { key: "url", label: "Dirección", type: "url" }] },
    { key: "linked", label: "Estado", type: "status" },
    { key: "logout", label: "Cerrar sesión", labelEn: "Sign out", type: "action", confirm: "¿Seguro?", confirmEn: "Are you sure?" },
  ];
  const r = validateManifest(manifest({ apiVersion: 9, settings, section: { label: "Novelas", labelEn: "Soaps" }, capabilities: ["home", "resolve"] }));
  assert.equal(r.ok, true, r.message);
  const en = Object.fromEntries(localizedSettings(r.manifest.settings, "en").map((x) => [x.key, x]));
  assert.equal(en.email.label, "Email");
  assert.equal(en.email.hint, "you@mail.com");
  assert.equal(en.about.hint, "Sign in");
  assert.deepEqual(en.quality.options.map((o) => [o.value, o.label]), [["hd", "High"], ["sd", "Normal"]]);
  assert.deepEqual(en.servers.fields.map((f) => f.label), ["Name", "Dirección"]);
  assert.equal(en.linked.label, "Estado");
  assert.equal(en.logout.confirm, "Are you sure?");
  assert.deepEqual(localizedSettings(r.manifest.settings, "es-CO"), r.manifest.settings);
  assert.equal(sectionLabel(r.manifest, "en"), "Soaps");
  assert.equal(sectionLabel(r.manifest, "es"), "Novelas");
  assert.equal(sectionLabel({ section: { label: "Novelas" } }, "en"), "Novelas");
  const cov = englishCoverage(r.manifest);
  assert.equal(cov.total, 14);
  assert.ok(cov.missing.includes("quality.label") && cov.missing.includes("quality[sd].label") && cov.missing.includes("linked.label"));
  // apiVersion 9 (Kino 0.9.55): below it the keys are unknown, never checked, and dropped from the validated manifest.
  for (const apiVersion of [1, 6, 8]) {
    const old = validateManifest(manifest({ apiVersion, settings: [{ key: "t", label: "Correo", labelEn: "a".repeat(99), type: "text" }], ...(apiVersion >= 6 ? { section: { label: "Novelas", labelEn: 7 }, capabilities: ["home", "resolve"] } : {}) }));
    assert.equal(old.ok, true, old.message);
    assert.equal(old.manifest.settings[0].labelEn, undefined);
    assert.equal(localizedSettings(old.manifest.settings, "en")[0].label, "Correo");
    if (old.manifest.section) assert.equal(sectionLabel(old.manifest, "en"), "Novelas");
  }
});

test("English variants have the base fields' limits and the app's messages", () => {
  const one = (o, api = 9) => validateManifest(manifest({ apiVersion: api, settings: [o] })).message;
  for (const bad of ["a".repeat(41), "  ", 7]) assert.equal(one({ key: "t", label: "T", labelEn: bad, type: "text" }), '"labelEn" of the setting "t" must be a string of 1 to 40 characters');
  assert.equal(validateManifest(manifest({ apiVersion: 9, settings: [{ key: "t", label: "T", labelEn: "a".repeat(40), type: "text" }] })).ok, true);
  assert.equal(one({ key: "t", label: "T", hintEn: "a".repeat(81), type: "text" }), '"hintEn" of the setting "t" must be a string of up to 80 characters');
  assert.equal(validateManifest(manifest({ apiVersion: 9, settings: [{ key: "s", label: "S", hintEn: "a".repeat(300), type: "section" }] })).ok, true);
  assert.equal(one({ key: "s", label: "S", hintEn: "a".repeat(301), type: "section" }), '"hintEn" of the setting "s" must be a string of up to 300 characters');
  assert.equal(one({ key: "go", label: "Go", type: "action", confirm: "¿Seguro?", confirmEn: "a".repeat(121) }), '"confirmEn" of the setting "go" must be a string of 1 to 120 characters');
  assert.equal(one({ key: "t", label: "T", type: "text", confirmEn: "Sure?" }), 'Only a setting of type action has "confirmEn" ("t")');
  assert.equal(one({ key: "go", label: "Go", type: "action", confirmEn: "Sure?" }), '"confirmEn" of the setting "go" also needs "confirm"');
  assert.equal(validateManifest(manifest({ apiVersion: 8, settings: [{ key: "t", label: "T", type: "text", confirmEn: "Sure?" }] })).ok, true);
  assert.equal(one({ key: "q", label: "Q", type: "select", options: [{ value: "a", label: "A", labelEn: "a".repeat(41) }] }), 'An option of the setting "q" is not valid');
  assert.equal(one({ key: "l", label: "L", type: "list", fields: [{ key: "n", label: "N", labelEn: "", type: "text" }] }), '"labelEn" of the field "n" of "l" must be a string of 1 to 40 characters');
  assert.equal(one({ key: "l", label: "L", type: "list", fields: [{ key: "n", label: "N", hintEn: "a".repeat(81), type: "text" }] }), '"hintEn" of the field "n" of "l" must be a string of up to 80 characters');
  const sec = (labelEn) => validateManifest(manifest({ apiVersion: 9, capabilities: ["home", "resolve"], section: { label: "Novelas", labelEn } }));
  assert.equal(sec("a".repeat(21)).message, 'The "section.labelEn" field must be 1 to 20 characters');
  assert.equal(sec(3).ok, false);
  assert.equal(sec(null).ok, true);
  assert.deepEqual(contract.settings.english.settingKeys, ["labelEn", "hintEn", "confirmEn"]);
});

test("validate() tells how many texts have English once the plugin uses them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-english-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function search(){ return { items: [] } }\nexport async function resolve(){ return { url: 'https://example.com/a.m3u8' } }");
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ settings: [{ key: "u", label: "Usuario", type: "text" }] }));
    assert.deepEqual((await validate(dir)).notes, []);
    // apiVersion 8: the English keys are unknown there, so nothing to tell.
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 8, settings: [{ key: "u", label: "Usuario", labelEn: "User", type: "text", hint: "tu nombre" }] }));
    assert.deepEqual((await validate(dir)).notes.filter((n) => n.includes("English texts")), []);
    writeFileSync(join(dir, "kino-plugin.json"), manifest({ apiVersion: 9, settings: [{ key: "u", label: "Usuario", labelEn: "User", type: "text", hint: "tu nombre" }] }));
    const notes = (await validate(dir)).notes.filter((n) => n.includes("English texts"));
    assert.equal(notes[0], "English texts: 1 of 2; without an English version (Kino shows them in Spanish): u.hint");
    assert.match(notes[1], /^Kino 0\.9\.55 or later shows the English texts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stream's media is cleaned and bounded, never refused", () => {
  const m = JSON.parse(manifest());
  const r = checkOutput("resolve", {
    url: "https://example.com/v.mp4",
    media: { title: " My\nMovie\u0000 ", sizeBytes: -1, video: { codec: "h264", width: 99999, fps: 1e99 }, audio: Array.from({ length: 40 }, () => ({ codec: "aac" })), notes: ["a", "", "b", "c", "d", "e"] },
  }, m);
  const v = r.value;
  assert.equal(v.media.title, "My Movie");
  assert.equal(v.media.sizeBytes, 0);
  assert.equal(v.media.video.width, 16384);
  assert.equal(v.media.video.fps, 480);
  assert.equal(v.media.audio.length, 16);
  assert.deepEqual(v.media.notes, ["a", "b", "c", "d"]);
  assert.equal(mediaOf({}), null);
  assert.equal(mediaOf("nope"), null);
  assert.equal(checkOutput("resolve", { url: "https://example.com/v.mp4", media: {} }, m).value.media, undefined);
});

test("a stream's portable HLS copy passes the url's own host rules, anything else is dropped", () => {
  const m = JSON.parse(manifest());
  const ok = checkOutput("resolve", { url: "https://example.com/v.mkv", portable: { url: "https://example.com/p/index.m3u8", mime: "application/vnd.apple.mpegurl" } }, m);
  assert.deepEqual(ok.value.portable, { url: "https://example.com/p/index.m3u8", mime: "application/x-mpegURL" });
  assert.deepEqual(checkOutput("resolve", { url: "https://example.com/v.mkv", portable: { url: "https://example.com/p.m3u8" } }, m).value.portable, { url: "https://example.com/p.m3u8", mime: "application/x-mpegURL" });
  for (const portable of [{ url: "https://elsewhere.org/p.m3u8" }, { url: "http://example.com/p.m3u8" }, { url: "https://example.com/p.mp4", mime: "video/mp4" }, "nope", { mime: "application/x-mpegURL" }]) {
    const r = checkOutput("resolve", { url: "https://example.com/v.mkv", portable }, m);
    assert.equal(r.value.portable, undefined, JSON.stringify(portable));
    assert.ok(r.drops.some((d) => d.includes("portable")), JSON.stringify(portable));
  }
  assert.equal(checkOutput("resolve", { url: "https://example.com/v.mkv" }, m).value.portable, undefined);
});

test("externalResolver: the package, an apk from a GitHub release, F-Droid and a Downloader code", () => {
  const ok = (er, caps = ["search", "resolve", "externalResolve"], api = 11) =>
    validateManifest(manifest({ apiVersion: api, capabilities: caps, externalResolver: er }));
  const gh = "https://github.com/acme/resolver/releases/download/v1.0/r.apk";
  assert.equal(ok({ package: "com.example.resolver" }).ok, true);
  assert.equal(ok({ package: "com.example.resolver", fdroid: true }).ok, true);
  assert.equal(ok({ package: "com.example.resolver", downloader: { code: "7702264" } }).ok, true);
  assert.equal(ok({ package: "com.example.resolver", apk: { url: gh, sha256: "ab".repeat(32), label: "R" }, fdroid: true, downloader: { code: "123" } }).ok, true);
  for (const bad of [
    "com.example.resolver", {}, { package: "nodots" },
    { package: "com.example.resolver", fdroid: false }, { package: "com.example.resolver", fdroid: "yes" },
    { package: "com.example.resolver", downloader: "123" }, { package: "com.example.resolver", downloader: {} },
    { package: "com.example.resolver", downloader: { code: 123 } }, { package: "com.example.resolver", downloader: { code: "12" } },
    { package: "com.example.resolver", downloader: { code: "12345678901" } }, { package: "com.example.resolver", downloader: { code: "12ab" } },
    { package: "com.example.resolver", apk: { url: "https://example.com/r.apk", sha256: "a".repeat(64) } }, // not GitHub
    { package: "com.example.resolver", apk: { url: "https://github.com/acme/resolver/raw/main/r.apk", sha256: "a".repeat(64) } },
    { package: "com.example.resolver", apk: { url: gh } },
  ]) {
    const r = ok(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.field, "externalResolver");
  }
  const noCap = ok({ package: "com.example.resolver", fdroid: true }, ["search", "resolve"]);
  assert.equal(noCap.ok, false);
  assert.match(noCap.message, /externalResolve/);
  // Below apiVersion 11 the field is ignored, as the app ignores it.
  assert.equal(ok({ package: "nodots" }, ["search", "resolve"], 10).ok, true);
});

// ---- the sandbox: the plugin sees Kino's world, not Node's ----

const sandboxPlugin = (code) => {
  const dir = mkdtempSync(join(tmpdir(), "kino-sandbox-"));
  writeFileSync(join(dir, "plugin.js"), code);
  return dir;
};

test("sandbox: Node's globals the engine lacks are undefined inside the plugin, and the provided ones are there", async () => {
  const dir = sandboxPlugin(`
    export const probe = () => ({
      missing: ["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "Buffer", "process", "require", "fetch", "AbortController", "structuredClone", "performance", "crypto", "WeakRef", "Intl"].filter((n) => typeof globalThis[n] !== "undefined"),
      present: ["kino", "console", "URL", "URLSearchParams", "atob", "btoa", "TextEncoder", "TextDecoder", "Promise", "JSON", "Map"].filter((n) => typeof globalThis[n] === "undefined"),
    });`);
  try {
    const { plugin, sandboxed } = await loadPlugin(join(dir, "plugin.js"), {});
    assert.equal(sandboxed, true);
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.probe())), { missing: [], present: [] }); // cross-realm: compare as JSON
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: touching a missing global is a ReferenceError, and the static scan names it with the fix", async () => {
  const code = "export async function search() { await new Promise((ok) => setTimeout(ok, 10)); return []; }";
  const dir = sandboxPlugin(code);
  try {
    const { plugin } = await loadPlugin(join(dir, "plugin.js"), {});
    await assert.rejects(plugin.search(), /setTimeout is not defined/);
    const hits = scanMissingGlobals(code);
    assert.equal(hits[0].name, "setTimeout");
    assert.match(missingGlobalLines(hits)[0], /kino\.sleep/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: an import is refused as the device would, named exports stay live, default export works", async () => {
  const bad = sandboxPlugin(`import fs from "node:fs";\nexport const a = 1;`);
  const good = sandboxPlugin(`export let n = 1;\nexport function bump() { n++; }\nconst x = 2;\nexport { x as two };\nexport default { id: "d" };`);
  try {
    await assert.rejects(loadPlugin(join(bad, "plugin.js"), {}), /node:fs/);
    const { plugin } = await loadPlugin(join(good, "plugin.js"), {});
    plugin.bump();
    assert.equal(plugin.n, 2);
    assert.equal(plugin.two, 2);
    assert.equal(plugin.default.id, "d");
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});

test("sandbox: localeCompare compares code units and toLocaleString ignores the locale, as in the engine", async () => {
  const dir = sandboxPlugin(`export const r = () => ({ cmp: "a".localeCompare("B"), num: (1234.5).toLocaleString("de-DE") });`);
  try {
    const { plugin } = await loadPlugin(join(dir, "plugin.js"), {});
    assert.equal(plugin.r().cmp, 31); // the engine answers the code-unit difference, "a"(97) - "B"(66); ICU would say -1
    assert.equal(plugin.r().num, "1234.5");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: validate() warns about a missing global without refusing the plugin", async () => {
  const dir = metaPlugin("export async function meta(){ await new Promise((ok) => setTimeout(ok, 1)); return { title: 'x' } }");
  try {
    const r = await validate(dir);
    assert.ok(r.warnings.some((w) => /setTimeout/.test(w)), JSON.stringify(r.warnings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
