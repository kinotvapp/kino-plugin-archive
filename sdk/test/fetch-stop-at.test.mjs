// Task 8u: kino.fetch's stopAt (apiVersion 14) as the kit runs it, mirroring the app (PluginHttp.readUntil / cutAtMarker,
// DefaultPluginHost.secretSafeCut, prelude.js): the read ends at a marker (ASCII case-insensitive, kept), text only, with
// maxBytes whichever comes first, read whole and redacted first when the runtime holds a sealed value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";

const base = { id: "demo", name: "Demo", version: "1.0.0", entry: "plugin.js", hosts: ["api.example.com"], capabilities: ["home", "search", "resolve"] };
const v14 = { ...base, apiVersion: 14 };
const v13 = { ...base, apiVersion: 13 };

/** A server answering [chunks] (strings or Buffers) one per read, counting the reads, with [type]. */
function server(chunks, type = "text/html; charset=utf-8") {
  const pulled = { n: 0 };
  const fetchImpl = async () => {
    let i = 0;
    const body = new ReadableStream({
      pull(c) {
        if (i >= chunks.length) { c.close(); return; }
        pulled.n++;
        const x = chunks[i++];
        c.enqueue(new Uint8Array(typeof x === "string" ? Buffer.from(x, "utf8") : x));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": type } });
  };
  return { fetchImpl, pulled };
}

const page = ["<html><HEAD><title>T</title>", "<meta x></He", "ad><body>", "z".repeat(5000), "z".repeat(5000)];

test("the contract's fetch.stopAt: apiVersion 14, 1 to 32 printable ASCII characters, text only", () => {
  const s = contract.fetch.stopAt;
  assert.deepEqual([s.apiVersion, s.minChars, s.maxChars, s.charRange, s.notText], [14, 1, 32, [32, 126], "invalid_request"]);
});

test("stopAt ends the read at the marker, kept, case-insensitive, found across a chunk edge, and stops pulling", async () => {
  const { fetchImpl, pulled } = server(page);
  const r = await createKino(v14, { fetchImpl }).kino.fetch("https://api.example.com/p", { stopAt: "</head>" });
  assert.equal(r.text(), "<html><HEAD><title>T</title><meta x></Head>");
  assert.equal(r.truncated, true);
  assert.ok(pulled.n <= 4, `pulled ${pulled.n} of ${page.length}`);
});

test("a marker at the start, in the middle, at the very end, or absent", async () => {
  const at = async (chunks, marker) => createKino(v14, { fetchImpl: server(chunks).fetchImpl }).kino.fetch("https://api.example.com/p", { stopAt: marker });
  const start = await at(["END and more"], "end");
  assert.equal(start.text(), "END");
  assert.equal(start.truncated, true);
  const end = await at(["abc", "STOP"], "stop");
  assert.equal(end.text(), "abcSTOP");
  assert.equal(end.truncated, false);
  const none = await at(["abc", "def"], "zzz");
  assert.equal(none.text(), "abcdef");
  assert.equal(none.truncated, false);
});

test("with maxBytes, whichever comes first", async () => {
  const k = (chunks, o) => createKino(v14, { fetchImpl: server(chunks).fetchImpl }).kino.fetch("https://api.example.com/p", o);
  const marker = await k(["ab</head>", "cdef"], { stopAt: "</head>", maxBytes: 100 });
  assert.equal(marker.text(), "ab</head>");
  const bytes = await k(["abcdefghij</head>"], { stopAt: "</head>", maxBytes: 5 });
  assert.equal(bytes.text(), "abcde");
  assert.equal(bytes.truncated, true);
  // A marker that never comes leaves maxBytes in charge.
  const never = await k(["x".repeat(3000)], { stopAt: "</head>", maxBytes: 1000 });
  assert.equal(never.text().length, 1000);
  assert.equal(never.truncated, true);
});

test("a UTF-16 body is decoded first, then cut at the marker", async () => {
  const body = Buffer.from("<html><head>t</head><body>ñ</body>", "utf16le");
  const r = await createKino(v14, { fetchImpl: server([body], "text/html; charset=utf-16le").fetchImpl }).kino.fetch("https://api.example.com/p", { stopAt: "</HEAD>" });
  assert.equal(r.text(), "<html><head>t</head>");
  assert.equal(r.truncated, true);
});

test("a byte answer is refused, a bad marker is invalid_request, apiVersion 13 ignores stopAt", async () => {
  const bin = server([Buffer.from([1, 2, 3])], "application/octet-stream");
  await assert.rejects(createKino(v14, { fetchImpl: bin.fetchImpl }).kino.fetch("https://api.example.com/b", { stopAt: "x" }), (e) => e.code === "invalid_request");
  const k = createKino(v14, { fetchImpl: server(["abc"]).fetchImpl }).kino;
  for (const bad of ["", "a".repeat(33), "a\nb", "é", 5]) {
    await assert.rejects(k.fetch("https://api.example.com/p", { stopAt: bad }), (e) => e.code === "invalid_request", JSON.stringify(bad));
  }
  const ok32 = await k.fetch("https://api.example.com/p", { stopAt: "b".repeat(32) });
  assert.equal(ok32.text(), "abc");
  const old = await createKino(v13, { fetchImpl: server(page).fetchImpl }).kino.fetch("https://api.example.com/p", { stopAt: "</head>" });
  assert.equal(old.text().length, page.join("").length);
  assert.equal("truncated" in old, false);
});

test("with a sealed value the body is read whole, redacted, then cut: a marker inside the value matches nothing of it", async () => {
  const key = "SECRET-</head>-tail-ABCDEF";
  const dir = mkdtempSync(join(tmpdir(), "stopat-"));
  writeFileSync(join(dir, ".kino-secrets.json"), JSON.stringify({ apiKey: key }));
  const m = { ...v14, secrets: { apiKey: "x" } };
  const { fetchImpl, pulled } = server(["v=", key, ";", "</head>", "rest".repeat(100)]);
  const { kino } = createKino(m, { secretsFile: join(dir, ".kino-secrets.json"), fetchImpl });
  const r = await kino.fetch("https://api.example.com/p", { stopAt: "</head>" });
  assert.equal(r.text(), "v=" + kino.secret("apiKey") + ";</head>");
  assert.equal(r.truncated, true);
  assert.equal(pulled.n, 5, "read whole");
  assert.ok(!r.text().includes("SECRET"));
});
