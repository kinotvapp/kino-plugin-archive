// node --test plugins/sdk/test/store.test.mjs   (Node 18+)
// pluginStore (apiVersion 15, contract.kinoStore): the kit validates a store manifest and `run.mjs <folder> storeSync` prints
// the answer as Kino's index would keep it, dropping what is over the caps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { consentLines } from "../validate.mjs";

const RUN = join(dirname(fileURLToPath(import.meta.url)), "..", "run.mjs");
const base = { id: "my-store", name: "My store", version: "1.0.0", apiVersion: 15, entry: "plugin.js", hosts: ["store.example.com"], capabilities: ["pluginStore"] };
const manifest = (extra = {}) => JSON.stringify({ ...base, ...extra });

function folder(plugin, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kino-store-"));
  writeFileSync(join(dir, "kino-plugin.json"), manifest(extra));
  writeFileSync(join(dir, "plugin.js"), plugin);
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [RUN, dir, ...args], { encoding: "utf8" });

test("validate accepts a local store with only storeSync", () => {
  const r = validateManifest(manifest());
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.manifest.pluginStore, { mode: "local", name: null });
  assert.deepEqual(consentLines(r.manifest), [{ text: "Agrega plugins de sus servidores a tu tienda", danger: false }]);
  assert.equal(validateManifest(manifest({ apiVersion: 14 })).ok, false);
  assert.equal(validateManifest(manifest({ pluginStore: { mode: "remote" } })).ok, false);
  assert.equal(validateManifest(manifest({ capabilities: ["subtitles"], pluginStore: {} })).ok, false);
});

test("a live store adds the red line and needs storeList and storeSearch", () => {
  const r = validateManifest(manifest({ pluginStore: { mode: "live", name: "Tienda de Ana" } }));
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(consentLines(r.manifest), [
    { text: "Agrega plugins de sus servidores a tu tienda", danger: false },
    { text: "Lo que busques en la tienda llegará a sus servidores", danger: true },
  ]);
  assert.deepEqual(contract.kinoStore.liveExports, ["storeList", "storeSearch"]);
});

test("run.mjs storeSync prints the checked answer and drops over-cap entries", () => {
  const S = contract.kinoStore;
  const plugin = `export async function storeSync(arg) {
    const entries = [{ address: "o/good", id: "good", name: "Good", signed: true, authorKey: "${"ab".repeat(32)}" }, { address: "o/badkey", id: "badkey", name: "B", authorKey: "XYZ" }, { id: "no-address", name: "Nope" }, { address: "o/long", id: "long", name: "x".repeat(${S.limits.maxNameChars + 40}) }];
    while (entries.length < ${S.limits.maxEntriesPerSync + 5}) entries.push({ address: "o/r" + entries.length, id: "r" + entries.length, name: "R" });
    return { full: true, entries, state: { cursor: arg.since ?? null } };
  }`;
  const dir = folder(plugin);
  try {
    const r = run(dir, "storeSync", "--since", "7");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.full, true);
    assert.equal(out.entries.length, S.limits.maxEntriesPerSync);
    assert.equal(out.entries.some((e) => e.id === "no-address"), false);
    const good = out.entries.find((e) => e.id === "good");
    assert.equal(good.signed, true);
    assert.equal(good.authorKey, "ab".repeat(32));
    assert.equal(out.entries.find((e) => e.id === "badkey").authorKey, undefined);
    assert.equal(out.entries.find((e) => e.id === "long").name.length, S.limits.maxNameChars);
    assert.deepEqual(out.state, { cursor: 7 });
    assert.match(r.stderr, /dropped/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run.mjs storeList and storeSearch only exist on a live store", () => {
  const dir = folder("export async function storeSync(){ return { full: true, entries: [] }; }");
  try {
    const r = run(dir, "storeList");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /live/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const live = folder(`export async function storeSync(){ return { full: false, entries: [] }; }
    export async function storeList(a){ return { entries: [{ address: "o/a", id: "aa", name: "A" }], next: a.sort }; }
    export async function storeSearch(a){ return { entries: [{ address: "o/b", id: "bb", name: a.q }] }; }`, { pluginStore: { mode: "live" } });
  try {
    const l = run(live, "storeList");
    assert.equal(l.status, 0, l.stderr);
    assert.deepEqual(JSON.parse(l.stdout), { entries: [{ address: "o/a", id: "aa", name: "A" }], next: "popular" });
    const s = run(live, "storeSearch", "anime");
    assert.equal(s.status, 0, s.stderr);
    assert.equal(JSON.parse(s.stdout).entries[0].name, "anime");
  } finally { rmSync(live, { recursive: true, force: true }); }
});

test("run.mjs storeList keeps at most a live page's cap and only public https icons", () => {
  const S = contract.kinoStore;
  const live = folder(`export async function storeSync(){ return { full: false, entries: [] }; }
    export async function storeList(){
      const entries = [{ address: "o/lan", id: "lan", name: "L", icon: "https://192.168.1.4/i.png", screenshots: ["https://nas/s.png", "https://cdn.example.com/s.png"] }, { address: "o/pub", id: "pub", name: "P", icon: "https://cdn.example.com/i.png" }];
      while (entries.length < ${S.limits.maxEntriesPerLivePage + 10}) entries.push({ address: "o/r" + entries.length, id: "r" + entries.length, name: "R" });
      return { entries };
    }
    export async function storeSearch(){ return { entries: [] }; }`, { pluginStore: { mode: "live" } });
  try {
    const r = run(live, "storeList");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.entries.length, S.limits.maxEntriesPerLivePage);
    const lan = out.entries.find((e) => e.id === "lan");
    assert.equal(lan.icon, undefined);
    assert.deepEqual(lan.screenshots, ["https://cdn.example.com/s.png"]);
    assert.equal(out.entries.find((e) => e.id === "pub").icon, "https://cdn.example.com/i.png");
    assert.match(r.stderr, /dropped/);
  } finally { rmSync(live, { recursive: true, force: true }); }
});
