// init.mjs --kind provider|consumer (apiVersion 20, the plugin protocol): scaffolds the kit accepts whose own tests pass out
// of the box, and --help prints the usage instead of making a folder called "--help".
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { KINDS, scaffold } from "../init.mjs";
import { validate } from "../validate.mjs";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const INIT = join(SDK, "init.mjs");
const CONTRACT = join(SDK, "..", "contract.json");
const node = (args, cwd) => spawnSync(process.execPath, args, { encoding: "utf8", cwd, env: childEnv() });
/** This runner's env without its child-test marker, so a nested `node --test` reports on its own (TAP) like an author's. */
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** The kit as an author has it next to the scaffold: sdk/ (without the kit's own tests) and contract.json beside it. */
function withKit(dir) {
  cpSync(SDK, join(dir, "sdk"), { recursive: true, filter: (src) => !src.startsWith(join(SDK, "test")) });
  cpSync(CONTRACT, join(dir, "contract.json"));
}

test("--help and -h print the usage, with --kind, and make no folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-help-"));
  try {
    for (const flag of ["--help", "-h"]) {
      const r = node([INIT, flag], dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout + r.stderr, /usage: node sdk\/init\.mjs <folder>/);
      assert.match(r.stdout + r.stderr, /--kind provider\|consumer/);
    }
    assert.deepEqual(readdirSync(dir), []);
    const dashed = node([INIT, "--id", "x"], dir);
    assert.equal(dashed.status, 2, "a folder name that is an option is refused");
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the source scaffold's plugin.js points to the docs site, not a GUIDE.md it does not ship", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-guide-"));
  try {
    scaffold(dir, {});
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    assert.doesNotMatch(src, /GUIDE\.md/);
    assert.match(src, /https:\/\/kinotvapp\.github\.io\/kino-plugins\//);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const bundled = mkdtempSync(join(tmpdir(), "kino-init-guide-b-"));
  try {
    scaffold(bundled, { bundle: true });
    assert.doesNotMatch(readFileSync(join(bundled, "src", "plugin.js"), "utf8"), /GUIDE\.md/);
  } finally { rmSync(bundled, { recursive: true, force: true }); }
});

test("--kind provider: provides-only (hosts [], no capabilities), one door with a call and a stream, exports, a passing test", async () => {
  assert.deepEqual(KINDS, ["provider", "consumer"]);
  const dir = mkdtempSync(join(tmpdir(), "kino-init-provider-"));
  try {
    scaffold(dir, { kind: "provider", name: "Frases" });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.apiVersion, 20);
    assert.deepEqual(m.hosts, []);
    assert.equal("capabilities" in m, false);
    assert.equal("providesOnly" in m, false);
    const doors = Object.values(m.provides);
    assert.equal(doors.length, 1);
    assert.ok(Object.keys(doors[0].calls).length >= 1 && Object.keys(doors[0].streams).length >= 1);
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    const door = Object.keys(m.provides)[0];
    for (const n of [...Object.keys(doors[0].calls), ...Object.keys(doors[0].streams)]) assert.match(src, new RegExp(`export async function proto_${door}_${n}\\(`));
    assert.doesNotMatch(src, /GUIDE\.md/);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
    withKit(dir);
    const t = node(["--test", "--test-reporter=tap", "test/plugin.test.mjs"], dir);
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /# fail 0/);
    assert.match(t.stdout, /# pass [1-9]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--kind consumer: a screen with the install gate, recommends = consumes' repo, error handling, a passing test against --provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-consumer-"));
  try {
    scaffold(dir, { kind: "consumer", name: "Visor" });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.apiVersion, 20);
    assert.deepEqual(m.capabilities, ["screen"]);
    const uses = Object.values(m.consumes);
    assert.equal(uses.length, 1);
    assert.deepEqual(m.recommends, [uses[0].repo]);
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    assert.match(src, /installed/);
    assert.match(src, /installPlugin/);
    assert.match(src, /provider_missing/);
    assert.match(src, /e\.code|\.code/);
    assert.doesNotMatch(src, /GUIDE\.md/);
    assert.ok(existsSync(join(dir, "test", "provider", "kino-plugin.json")), "a stand-in provider for the tests");
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
    withKit(dir);
    const t = node(["--test", "--test-reporter=tap", "test/plugin.test.mjs"], dir);
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /# fail 0/);
    assert.match(t.stdout, /# pass [1-9]/);
    const provider = await validate(join(dir, "test", "provider"));
    assert.deepEqual(provider.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the command line takes --kind, refuses an unknown kind and refuses --store, --with or --bundle beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-kind-cli-"));
  try {
    const bad = node([INIT, join(dir, "a"), "--kind", "both"]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /provider, consumer/);
    for (const extra of [["--store", "local"], ["--with", "catalog"], ["--bundle"]]) {
      assert.equal(node([INIT, join(dir, "b"), "--kind", "provider", ...extra]).status, 2, extra.join(" "));
    }
    const ok = node([INIT, join(dir, "c"), "--kind", "consumer"]);
    assert.equal(ok.status ?? 0, 0, ok.stderr);
    assert.ok(JSON.parse(readFileSync(join(dir, "c", "kino-plugin.json"), "utf8")).consumes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
