// init.mjs --with: the apiVersion 13 capabilities scaffolded on request, each one accepted by the kit and exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold, WITH } from "../init.mjs";
import { validate } from "../validate.mjs";
import { askImage, askRead } from "../kino-shim.mjs";
import { checkOutput, validateManifest } from "../contract.mjs";

const INIT = join(dirname(fileURLToPath(import.meta.url)), "..", "init.mjs");

test("without --with the scaffold is exactly the apiVersion 1 one", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-plain-"));
  try {
    scaffold(dir, {});
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.apiVersion, 1);
    assert.deepEqual(m.capabilities, ["search", "home", "browse", "resolve"]);
    assert.doesNotMatch(readFileSync(join(dir, "plugin.js"), "utf8"), /export async function (read|image)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--with byteSource,images,catalog,socket: apiVersion 13, the capabilities, and the kit accepts it", async () => {
  assert.deepEqual(WITH, ["byteSource", "images", "catalog", "socket"]);
  const dir = mkdtempSync(join(tmpdir(), "kino-init-with-"));
  try {
    scaffold(dir, { host: "example.org", with: WITH });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.apiVersion, 13);
    for (const c of ["byteSource", "imageSource", "catalog", "socket"]) assert.ok(m.capabilities.includes(c), c);
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    assert.match(src, /export async function read\(\{ handle, offset, length \}\)/);
    assert.match(src, /export async function image\(\{ handle \}\)/);
    assert.match(src, /kino\.catalog\./);
    assert.match(src, /kino\.ws\.open/);
    assert.match(src, /typeof kino\.crypto\.convert === "function"/);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the scaffolded read and image answer the way Kino checks them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-run-"));
  try {
    scaffold(dir, { host: "example.org", with: ["byteSource", "images"] });
    const manifest = validateManifest(readFileSync(join(dir, "kino-plugin.json"), "utf8")).manifest;
    const bytes = Buffer.from(Array.from({ length: 9000 }, (_, i) => i & 255));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    globalThis.kino = {
      fetch: async (url, opts = {}) => {
        if (url.includes("/thumb/")) return { ok: true, status: 200, base64: () => jpeg.toString("base64"), headers: { "content-type": "image/jpeg" } };
        const [, a, b] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
        return { ok: true, status: 206, base64: () => bytes.subarray(Number(a), Number(b) + 1).toString("base64") };
      },
      error: (code, m) => Object.assign(new Error(m), { code }),
    };
    const plugin = await import(join(dir, "plugin.js"));
    const stream = { source: "plugin", handle: "file-1", size: 9000, mime: "video/mp4" };
    checkOutput("resolve", stream, manifest);
    assert.deepEqual(await askRead(plugin, manifest, stream, 4096, 8192), bytes.subarray(4096));
    assert.equal((await askImage(plugin, manifest, { source: "plugin", handle: "t1" })).mime, "image/jpeg");
  } finally { rmSync(dir, { recursive: true, force: true }); delete globalThis.kino; }
});

test("the command line takes --with and refuses an unknown one", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-cli-"));
  try {
    const bad = spawnSync(process.execPath, [INIT, join(dir, "a"), "--with", "teleport"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /byteSource, images, catalog, socket/);
    const ok = spawnSync(process.execPath, [INIT, join(dir, "b"), "--with", "byteSource,images"], { encoding: "utf8" });
    assert.equal(ok.status ?? 0, 0, ok.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, "b", "kino-plugin.json"), "utf8")).apiVersion, 13);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
