// init.mjs --store local|live (apiVersion 15): a plugin store scaffold the kit accepts, with the exports Kino needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { scaffold, STORE_MODES } from "../init.mjs";
import { validate } from "../validate.mjs";

const INIT = join(dirname(fileURLToPath(import.meta.url)), "..", "init.mjs");

test("--store local: a pluginStore-only manifest at apiVersion 15, storeSync only, and the kit accepts it", async () => {
  assert.deepEqual(STORE_MODES, ["local", "live"]);
  const dir = mkdtempSync(join(tmpdir(), "kino-init-store-local-"));
  try {
    scaffold(dir, { host: "store.example.org", store: "local", name: "Tienda de Ana" });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.apiVersion, 15);
    assert.deepEqual(m.capabilities, ["pluginStore"]);
    assert.deepEqual(m.pluginStore, { mode: "local", name: "Tienda de Ana" });
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    assert.match(src, /export async function storeSync\(/);
    assert.doesNotMatch(src, /export async function (storeList|storeSearch|search|home|resolve)/);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--store live: the three exports, the live mode, and the kit accepts it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-store-live-"));
  try {
    scaffold(dir, { host: "store.example.org", store: "live" });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.pluginStore.mode, "live");
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    for (const fn of ["storeSync", "storeList", "storeSearch"]) assert.ok(src.includes(`export async function ${fn}(`), fn);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the command line takes --store, refuses an unknown mode and refuses --with beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-store-cli-"));
  try {
    const bad = spawnSync(process.execPath, [INIT, join(dir, "a"), "--store", "remote"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /local, live/);
    const mixed = spawnSync(process.execPath, [INIT, join(dir, "b"), "--store", "local", "--with", "catalog"], { encoding: "utf8" });
    assert.equal(mixed.status, 2);
    const ok = spawnSync(process.execPath, [INIT, join(dir, "c"), "--store", "live"], { encoding: "utf8" });
    assert.equal(ok.status ?? 0, 0, ok.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, "c", "kino-plugin.json"), "utf8")).pluginStore.mode, "live");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
