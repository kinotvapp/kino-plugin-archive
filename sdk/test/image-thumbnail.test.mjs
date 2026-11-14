// node --test plugins/sdk/test/image-thumbnail.test.mjs   (Node 18+)
// kino.image.thumbnail (Kino 0.9.84, no new apiVersion): the kit has no image codec, so it downloads under the plugin's own
// fetch rules and answers the bytes only when they already are a small JPEG/PNG; the app (PluginThumbnail) does the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract } from "../contract.mjs";
import { createKino, kinoImageRequest, signingLane } from "../kino-shim.mjs";

const MANIFEST = { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "plugin.js", hosts: ["img.example.com"], capabilities: ["search", "resolve"] };
const URL_OK = "https://img.example.com/a.jpg";

/** A JPEG header of w x h (SOI, APP0, SOF0), padded to [size] bytes: all the kit reads. */
function jpeg(w, h, size = 600) {
  const b = Buffer.alloc(size);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).copy(b, 0);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.copy(b, 20);
  return b;
}

/** A PNG signature and IHDR of w x h. */
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

const serve = (bytes, status = 200, type = "image/jpeg") => async () => new Response(bytes, { status, headers: { "content-type": type } });
const kinoWith = (opts = {}) => createKino(MANIFEST, { env: {}, ...opts }).kino;

async function code(promise) {
  try {
    await promise;
  } catch (e) {
    return e.code;
  }
  return "resolved";
}

test("the contract's kinoImage numbers", () => {
  const I = contract.kinoImage;
  assert.deepEqual([I.minMaxWidth, I.defaultMaxWidth, I.maxMaxWidth], [32, 200, 400]);
  assert.deepEqual([I.minMaxBytes, I.defaultMaxBytes, I.maxMaxBytes], [2048, 16384, 32768]);
  assert.equal(I.maxDownloadBytes, 5 * 1024 * 1024);
  assert.equal(I.perMinute, 20);
  assert.equal(contract.additiveFromApp["kino.image.thumbnail"], "0.9.84");
});

test("a bad address or bad options is bad_request", async () => {
  const kino = kinoWith({ fetchImpl: serve(jpeg(100, 150)) });
  for (const url of ["http://img.example.com/a.jpg", "ftp://img.example.com/a", "not a url", "", undefined, 5, "https://"]) {
    assert.equal(await code(kino.image.thumbnail(url)), "bad_request", String(url));
  }
  for (const options of [{ maxWidth: 31 }, { maxWidth: 401 }, { maxWidth: 200.5 }, { maxWidth: "200" }, { maxBytes: 2047 }, { maxBytes: 32769 }, [], "x"]) {
    assert.equal(await code(kino.image.thumbnail(URL_OK, options)), "bad_request", JSON.stringify(options));
  }
  assert.deepEqual(kinoImageRequest(URL_OK), { url: URL_OK, maxWidth: 200, maxBytes: 16384 });
});

test("a small JPEG passes through as a data address", async () => {
  const bytes = jpeg(150, 225, 900);
  const kino = kinoWith({ fetchImpl: serve(bytes) });
  assert.equal(await kino.image.thumbnail(URL_OK), "data:image/jpeg;base64," + bytes.toString("base64"));
});

test("a big picture is kit_unsupported, and the error names the app as the place it works", async () => {
  const fails = async (kino) => {
    try {
      await kino.image.thumbnail(URL_OK);
    } catch (e) {
      return e;
    }
    return null;
  };
  for (const kino of [
    kinoWith({ fetchImpl: serve(jpeg(1200, 1800)) }),
    kinoWith({ fetchImpl: serve(jpeg(100, 150, 20000)) }),
    kinoWith({ fetchImpl: serve(png(1000, 1000), 200, "image/png") }),
  ]) {
    const e = await fails(kino);
    assert.equal(e && e.code, "kit_unsupported");
    assert.match(e.message, /Kino app/);
  }
  // A PNG that is already small passes through as the PNG it is.
  const small = png(100, 100);
  assert.equal(await kinoWith({ fetchImpl: serve(small, 200, "image/png") }).image.thumbnail(URL_OK), "data:image/png;base64," + small.toString("base64"));
});

test("a download follows the plugin's fetch rules and the answer's status", async () => {
  assert.equal(await code(kinoWith({ fetchImpl: serve(jpeg(10, 10)) }).image.thumbnail("https://other.example.org/a.jpg")), "host_not_allowed");
  assert.equal(await code(kinoWith({ fetchImpl: serve("", 404) }).image.thumbnail(URL_OK)), "not_found");
  assert.equal(await code(kinoWith({ fetchImpl: serve("", 500) }).image.thumbnail(URL_OK)), "network");
  assert.equal(await code(kinoWith({ fetchImpl: serve("<html></html>", 200, "text/html") }).image.thumbnail(URL_OK)), "not_image");
});

test("KINO_THUMBNAIL_FIXTURE answers a fixed image", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-thumb-"));
  const file = join(dir, "fixed.jpg");
  const bytes = jpeg(64, 96, 700);
  writeFileSync(file, bytes);
  const viaEnv = createKino(MANIFEST, { env: { KINO_THUMBNAIL_FIXTURE: file }, fetchImpl: async () => { throw new Error("no network"); } }).kino;
  assert.equal(await viaEnv.image.thumbnail(URL_OK), "data:image/jpeg;base64," + bytes.toString("base64"));
  const viaOption = kinoWith({ thumbnailFixture: file, fetchImpl: async () => { throw new Error("no network"); } });
  assert.equal(await viaOption.image.thumbnail(URL_OK, { maxWidth: 64 }), "data:image/jpeg;base64," + bytes.toString("base64"));
});

test("at most 20 calls a minute, and not from sign()", async () => {
  let t = 1_000_000;
  const kino = kinoWith({ now: () => t, fetchImpl: serve(jpeg(10, 10)) });
  for (let i = 0; i < contract.kinoImage.perMinute; i++) await kino.image.thumbnail(URL_OK);
  assert.equal(await code(kino.image.thumbnail(URL_OK)), "rate_limited");
  t += 4000;
  assert.equal(await code(kino.image.thumbnail(URL_OK)), "resolved");
  assert.equal(await code(signingLane(kino).image.thumbnail(URL_OK)), "not_allowed");
});
