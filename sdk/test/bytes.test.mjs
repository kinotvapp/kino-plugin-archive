// byteSource (apiVersion 13): the kit's mirror of the app's `{ source: "plugin", handle, size, mime }` stream
// (PluginOutput.byteSourceOf), of the read answer's checks (PluginByteStreams.decodeRead) and of the read call itself
// (askRead), and run.mjs's `read` and `image` commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { allowsByteSource, byteSourceOf, checkOutput, contract, readAnswer, validateManifest } from "../contract.mjs";
import { askRead } from "../kino-shim.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, "..", "run.mjs");
const KOTLIN_OUTPUT = join(here, "..", "..", "..", "app", "src", "main", "java", "com", "arkiv", "player", "data", "plugin", "PluginOutput.kt");

const base = { id: "demo", name: "Demo", version: "1.0.0", entry: "plugin.js", hosts: ["api.example.com"] };
const m = (extra = {}) => {
  const r = validateManifest(JSON.stringify({ ...base, apiVersion: 13, capabilities: ["search", "resolve", "byteSource"], ...extra }));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.manifest;
};
const stream = { source: "plugin", handle: "msg:1", size: 10_000, mime: "video/mp4" };
const INVALID = "the plugin stream's handle, size or mime is not valid";

test("the byteSource block carries what a resolve, a read and the kit need", () => {
  const b = contract.byteSource;
  assert.equal(b.apiVersion, 13);
  assert.equal(b.source, "plugin");
  assert.equal(b.export, "read");
  assert.equal(b.chunkBytes, 1048576);
  assert.equal(b.alignmentBytes, 4096);
  assert.equal(b.maxHandleChars, 512);
  assert.equal(b.readTimeoutMs, 20000);
  assert.equal(b.mimePattern, "^[a-z]+/[A-Za-z0-9.+-]{1,100}$");
});

test("the mime rule is the Kotlin parser's own (parity with PluginOutput.MIME)", (t) => {
  let kt;
  try { kt = readFileSync(KOTLIN_OUTPUT, "utf8"); } catch { return t.skip("no app sources around this kit"); }
  const m1 = /val MIME = Regex\("(.*)"\)/.exec(kt);
  assert.ok(m1, "PluginOutput.MIME not found");
  assert.equal(m1[1].replace(/\\\\/g, "\\"), contract.byteSource.mimePattern);
  // The handle rule: 1..MAX_HANDLE_CHARS, no ISO control character (isISOControl: U+0000..U+001F and U+007F..U+009F).
  assert.match(kt, /handle\.isEmpty\(\) \|\| handle\.length > com\.arkiv\.player\.playback\.PluginByteProxy\.MAX_HANDLE_CHARS \|\| handle\.any \{ it\.isISOControl\(\) \}/);
  assert.match(kt, /if \(size <= 0L\) return null/);
});

test("resolve accepts the byteSource shape as the app's resolve parser does", () => {
  const out = checkOutput("resolve", { ...stream, durationMs: 5000, label: "HD" }, m()).value;
  assert.equal(out.source, "plugin");
  assert.equal(out.handle, "msg:1");
  assert.equal(out.size, 10_000);
  assert.equal(out.mime, "video/mp4");
  assert.equal(out.durationMs, 5000);
  assert.equal(out.label, "HD");
  assert.equal(out.url, undefined);
  // The mime is trimmed; a 512-character handle and a whole-number double size are fine.
  assert.equal(checkOutput("resolve", { ...stream, mime: " video/x-matroska " }, m()).value.mime, "video/x-matroska");
  assert.equal(checkOutput("resolve", { ...stream, handle: "h".repeat(512) }, m()).value.handle.length, 512);
  assert.equal(checkOutput("resolve", { ...stream, size: 1e6 }, m()).value.size, 1_000_000);
  assert.deepEqual(byteSourceOf(stream), { handle: "msg:1", size: 10_000, mime: "video/mp4" });
  assert.equal(allowsByteSource(m()), true);
});

test("resolve refuses a malformed byteSource stream with the app's reason", () => {
  for (const bad of [
    { handle: "" }, { handle: "h".repeat(513) }, { handle: "a\u0000b" }, { handle: "a\nb" }, { handle: "a\u0085b" }, { handle: 7 },
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: "10" }, { size: null }, { size: Infinity },
    { mime: "" }, { mime: "video" }, { mime: "Video/mp4" }, { mime: "video/mp4;codecs=x" }, { mime: 3 }, { mime: "video/" + "a".repeat(101) },
  ]) {
    assert.throws(() => checkOutput("resolve", { ...stream, ...bad }, m()), (e) => e.message === INVALID, JSON.stringify(bad));
  }
});

test("without the capability, below apiVersion 13, for a live channel or a lazy copy, `source` is ignored", () => {
  const plain = validateManifest(JSON.stringify({ ...base, apiVersion: 13, capabilities: ["search", "resolve"] })).manifest;
  assert.equal(allowsByteSource(plain), false);
  assert.throws(() => checkOutput("resolve", stream, plain), (e) => e.message !== INVALID);
  assert.throws(() => checkOutput("resolve", stream, m(), [], { liveChannel: true }), (e) => e.message !== INVALID);
  assert.throws(() => checkOutput("resolve", stream, m(), [], { alternative: true }), (e) => e.message !== INVALID);
});

// --- read through the shim, as PluginByteStreams calls it ---

const data = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 7) & 255));
const servingPlugin = (calls = []) => ({
  async read({ handle, offset, length }) {
    calls.push({ handle, offset, length });
    return { bytes: data.subarray(offset, Math.min(offset + length, data.length)).toString("base64") };
  },
});

test("askRead serves ranges, the final short chunk, and passes handle, offset and length", async () => {
  const calls = [];
  const p = servingPlugin(calls);
  const a = await askRead(p, m(), stream, 0, 4096);
  assert.deepEqual(a, data.subarray(0, 4096));
  const b = await askRead(p, m(), stream, 8192, 4096);
  assert.equal(b.length, 10_000 - 8192); // past the end: exactly what is left
  assert.deepEqual(b, data.subarray(8192));
  assert.deepEqual(calls, [{ handle: "msg:1", offset: 0, length: 4096 }, { handle: "msg:1", offset: 8192, length: 4096 }]);
});

test("askRead refuses a misaligned or out-of-range request before calling the plugin", async () => {
  const calls = [];
  const p = servingPlugin(calls);
  await assert.rejects(askRead(p, m(), stream, 100, 4096), /multiple of 4096/);
  await assert.rejects(askRead(p, m(), stream, 0, 0), /1 to 1048576/);
  await assert.rejects(askRead(p, m(), stream, 0, 1048577), /1 to 1048576/);
  await assert.rejects(askRead(p, m(), stream, 12288, 4096), /past the end/);
  await assert.rejects(askRead(p, m(), { ...stream, size: 0 }, 0, 4096), /handle, size or mime/);
  await assert.rejects(askRead({}, m(), stream, 0, 4096), /does not export read/);
  await assert.rejects(askRead(p, validateManifest(JSON.stringify({ ...base, apiVersion: 13, capabilities: ["search", "resolve"] })).manifest, stream, 0, 4096), /byteSource/);
  assert.deepEqual(calls, []);
});

test("a read answer of the wrong length or shape is refused as the app refuses it", async () => {
  const answering = (v) => ({ read: async () => v });
  const reason = "read didn't return the bytes asked for";
  for (const v of [{ bytes: data.subarray(0, 4095).toString("base64") }, { bytes: data.subarray(0, 4097).toString("base64") }, { bytes: "%%%" }, { bytes: 5 }, {}, null, "AAAA"]) {
    await assert.rejects(askRead(answering(v), m(), stream, 0, 4096), (e) => e.message === reason, JSON.stringify(v));
  }
  // Unpadded base64 decodes as the app's java.util.Base64 does.
  const unpadded = data.subarray(0, 4096).toString("base64").replace(/=+$/, "");
  assert.equal((await askRead(answering({ bytes: unpadded }), m(), stream, 0, 4096)).length, 4096);
  assert.throws(() => readAnswer({ bytes: "AA AA" }, 0, 3, 3), (e) => e.message === reason);
});

test("reads come one at a time per plugin, like the app's", async () => {
  let running = 0, peak = 0;
  const p = { async read({ offset, length }) { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return { bytes: data.subarray(offset, offset + length).toString("base64") }; } };
  await Promise.all([0, 4096].map((o) => askRead(p, m(), stream, o, 4096)));
  assert.equal(peak, 1);
});

// --- run.mjs read / image ---

function pluginDir(manifest, source) {
  const dir = mkdtempSync(join(tmpdir(), "kino-bytes-"));
  writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "plugin.js"), source);
  return dir;
}
const SOURCE = `
const data = new Uint8Array(10000).map((_, i) => (i * 7) & 255);
const b64 = (u8) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
export async function search() { return { items: [] }; }
export async function resolve() { return { source: "plugin", handle: "msg:1", size: 10000, mime: "video/mp4" }; }
export async function read({ handle, offset, length }) { if (handle !== "msg:1") throw new Error("unknown handle"); return { bytes: b64(data.subarray(offset, offset + length)) }; }
export async function image({ handle }) { return { bytes: btoa("\\xff\\xd8\\xff\\xe0\\x01\\x02"), mime: "image/jpeg" }; }
`;

test("run.mjs read prints the size, sha256 and first bytes of a range, and refuses a misaligned one", () => {
  const dir = pluginDir({ ...base, apiVersion: 13, capabilities: ["search", "resolve", "byteSource"] }, SOURCE);
  try {
    const ok = spawnSync(process.execPath, [RUN, "--size", "10000", dir, "read", "msg:1", "8192", "4096"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const want = data.subarray(8192);
    assert.match(ok.stdout, new RegExp(`${want.length} bytes`));
    assert.match(ok.stdout, new RegExp(createHash("sha256").update(want).digest("hex")));
    assert.match(ok.stdout, new RegExp(want.subarray(0, 16).toString("hex")));
    const bad = spawnSync(process.execPath, [RUN, dir, "read", "msg:1", "100", "4096"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /multiple of 4096/);
    const big = spawnSync(process.execPath, [RUN, dir, "read", "msg:1", "0", "2000000"], { encoding: "utf8" });
    assert.equal(big.status, 2);
    assert.match(big.stderr, /1 to 1048576/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run.mjs image writes the picture to a file and needs imageSource", () => {
  const dir = pluginDir({ ...base, apiVersion: 13, capabilities: ["search", "resolve", "imageSource"] }, SOURCE);
  try {
    const out = join(dir, "poster.jpg");
    const ok = spawnSync(process.execPath, [RUN, "--out", out, dir, "image", "thumb:1"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /image\/jpeg/);
    assert.deepEqual(readFileSync(out), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const noCap = pluginDir({ ...base, apiVersion: 13, capabilities: ["search", "resolve"] }, SOURCE);
  try {
    const r = spawnSync(process.execPath, [RUN, noCap, "image", "thumb:1"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /imageSource/);
  } finally { rmSync(noCap, { recursive: true, force: true }); }
});
