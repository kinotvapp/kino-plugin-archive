// init.mjs --kind provider|consumer (apiVersion 20, the plugin protocol): scaffolds the kit accepts whose own tests pass out
// of the box, and --help prints the usage instead of making a folder called "--help".
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { KINDS, scaffold } from "../init.mjs";
import { isPlaceholderHost, placeholderHostWarnings, validate } from "../validate.mjs";

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
    // A screen-only consumer declares no host of its own: "hosts": [] (no placeholder to replace, no warning, no todo).
    assert.deepEqual(m.hosts, []);
    assert.doesNotMatch(readFileSync(join(dir, "kino-plugin.json"), "utf8"), /example\.com/);
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /`hosts`: `\[\]`/);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
    withKit(dir);
    const t = node(["--test", "--test-reporter=tap", "test/plugin.test.mjs"], dir);
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /# fail 0/);
    assert.match(t.stdout, /# pass [1-9]/);
    assert.match(t.stdout, /# todo 0/, "no placeholder host to replace");
    const provider = await validate(join(dir, "test", "provider"));
    assert.deepEqual(provider.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--kind consumer follows the screen rules: one compact bar with a real exit, a detail route, English labelEn, Spanish TODO description", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-consumer-bar-"));
  try {
    scaffold(dir, { kind: "consumer", name: "Visor de recetas", door: "recipes", host: "images.example-recipes.org" });
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.equal(m.screen.label, "Visor de recetas");
    assert.equal(m.screen.labelEn, "Recipes", "labelEn is English, not the Spanish label again");
    assert.match(m.description, /^TODO: en español/);
    const src = readFileSync(join(dir, "plugin.js"), "utf8");
    assert.match(src, /mergeWithKinoBar: true, dense: true, leading/);
    assert.match(src, /onPressed: \{ close: true \}/);
    assert.match(src, /route: \{ push: "detail"/);
    assert.match(src, /route: \{ pop: true \}/);
    assert.match(src, /name === "open"/);
    // The drawn tree: the bar is merged and its leading closes on the front page, goes back on the detail route.
    withKit(dir);
    const repo = m.recommends[0];
    const front = node([join(dir, "sdk", "run.mjs"), "--context", JSON.stringify({ installed: { [repo]: true } }), "--provider", "test/provider", "--raw", ".", "screen"], dir);
    assert.equal(front.status, 0, front.stderr);
    assert.doesNotMatch(front.stderr, /dropped|✗/, front.stderr);
    const tree = JSON.stringify(JSON.parse(front.stdout));
    assert.match(tree, /"mergeWithKinoBar":true/);
    const detail = node([join(dir, "sdk", "run.mjs"), "--context", JSON.stringify({ installed: { [repo]: true }, route: { name: "detail", params: { id: 1 } } }), "--state", '{"item":{"id":1,"text":"Uno"}}', ".", "screen"], dir);
    assert.equal(detail.status, 0, detail.stderr);
    assert.doesNotMatch(detail.stderr, /dropped|✗/, detail.stderr);
    assert.match(detail.stdout, /Atrás|arrow_back/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--kind consumer --door/--call/--stream: the consumer and its stand-in use the real door's names, a README says it is a stand-in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-consumer-door-"));
  try {
    const r0 = node([INIT, dir, "--kind", "consumer", "--door", "recipes", "--call", "random", "--stream", "fresh", "--repo", "ana/kino-plugin-recipes", "--host", "img.recetas.co"]);
    assert.equal(r0.status ?? 0, 0, r0.stderr);
    assert.match(r0.stderr, /STAND-IN/);
    const m = JSON.parse(readFileSync(join(dir, "kino-plugin.json"), "utf8"));
    assert.deepEqual(m.consumes, { recipes: { repo: "ana/kino-plugin-recipes", door: "recipes", calls: ["random"], streams: ["fresh"] } });
    assert.deepEqual(m.hosts, ["img.recetas.co"]);
    const p = JSON.parse(readFileSync(join(dir, "test", "provider", "kino-plugin.json"), "utf8"));
    assert.deepEqual(Object.keys(p.provides), ["recipes"]);
    assert.deepEqual(Object.keys(p.provides.recipes.calls), ["random"]);
    assert.deepEqual(Object.keys(p.provides.recipes.streams), ["fresh"]);
    assert.match(readFileSync(join(dir, "plugin.js"), "utf8"), /kino\.plugins\.call\("recipes", "random"/);
    assert.match(readFileSync(join(dir, "test", "provider", "plugin.js"), "utf8"), /^\/\/ STAND-IN PROVIDER/);
    const readme = readFileSync(join(dir, "test", "provider", "README.md"), "utf8");
    assert.match(readme, /STAND-IN/);
    assert.match(readme, /copy of the real provider/);
    assert.match(readme, /`recipes`.*`random`.*`fresh`/s);
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, [], "a real host: no warning");
    withKit(dir);
    const t = node(["--test", "--test-reporter=tap", "test/plugin.test.mjs"], dir);
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /# fail 0/);
    assert.match(t.stdout, /# todo 0/);
    // The provider scaffold takes the same names, so the two sides agree.
    const prov = join(dir, "..", `${basename(dir)}-provider`);
    scaffold(prov, { kind: "provider", door: "recipes", call: "random", stream: "fresh" });
    try {
      const pm = JSON.parse(readFileSync(join(prov, "kino-plugin.json"), "utf8"));
      assert.deepEqual(Object.keys(pm.provides.recipes.calls), ["random"]);
      assert.match(pm.description, /^TODO: en español/);
      const pv = await validate(prov);
      assert.deepEqual(pv.problems, []);
      assert.deepEqual(pv.warnings, []);
      withKit(prov);
      const pt = node(["--test", "--test-reporter=tap", "test/plugin.test.mjs"], prov);
      assert.equal(pt.status, 0, pt.stdout + pt.stderr);
      assert.match(pt.stdout, /# fail 0/);
    } finally { rmSync(prov, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--door, --call and --stream are checked like the app's names, and need --kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-init-door-bad-"));
  try {
    assert.throws(() => scaffold(join(dir, "a"), { kind: "consumer", door: "my_door" }), /--door needs a name/);
    assert.throws(() => scaffold(join(dir, "b"), { kind: "provider", call: "by-id" }), /--call needs a name/);
    assert.throws(() => scaffold(join(dir, "c"), { kind: "provider", call: "same", stream: "same" }), /must differ/);
    assert.throws(() => scaffold(join(dir, "d"), { door: "recipes" }), /need --kind/);
    assert.equal(node([INIT, join(dir, "e"), "--kind", "consumer", "--door", "9x"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate warns (and still accepts) on a placeholder host: example.com, *.example.com, example.org, .test, .invalid, .example", async () => {
  for (const h of ["example.com", "*.example.com", "cdn.example.com", "example.org", "example.net", "images.recipes.test", "example.invalid", "api.example", "EXAMPLE.COM."]) {
    assert.equal(isPlaceholderHost(h), true, h);
  }
  for (const h of ["image.tmdb.org", "myexample.com", "example.com.co", "test.org", "invalidator.io", "api.testing"]) {
    assert.equal(isPlaceholderHost(h), false, h);
  }
  assert.equal(placeholderHostWarnings(["image.tmdb.org", { host: "cdn.example.org", insecureHttp: true }]).length, 1);
  assert.match(placeholderHostWarnings(["x.invalid"])[0], /never lists it/);
  const dir = mkdtempSync(join(tmpdir(), "kino-validate-placeholder-"));
  try {
    scaffold(dir, { host: "images.recipes.test" });
    const r = await validate(dir);
    assert.deepEqual(r.problems, [], "still accepted");
    assert.equal(r.warnings.filter((w) => /placeholder host/.test(w)).length, 1);
    const cli = node([join(SDK, "validate.mjs"), dir]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stderr, /^! hosts: "images\.recipes\.test" is a placeholder host/m);
    assert.match(cli.stderr, /✓ Kino would accept this plugin/);
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
