// node --test plugins/sdk/test/live-panel.test.mjs   (Node 18+)
// Task 11: the player panel on an En vivo channel. A contributed tab joins live channels only with "kinds": ["live"]; its
// context there is the live one (the channel, never a position); its player actions are dropped; go.liveChannel tunes only
// after the person's press and only for such a plugin. The shared cases (live-panel-cases.json) run through the app too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, liveChannelGoOf, liveChannelGoRefusal, validateManifest } from "../contract.mjs";
import { contributedKinds, contributesLive, liveAnswerDrops, liveContext } from "../panel.mjs";
import { checkScreenAnswer } from "../screen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "live-panel-cases.json"), "utf8"));
const RUN = join(here, "..", "run.mjs");

const manifestOf = (c) => ({
  id: "watch-party", name: "Watch Party", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"],
  capabilities: c.capabilities, ...(c.panel ? { panel: c.panel } : {}),
});

test("kit parity: panel.kinds for every shared manifest case", () => {
  assert.ok(cases.manifestKinds.length >= 8);
  for (const c of cases.manifestKinds) {
    const r = validateManifest(JSON.stringify(manifestOf(c)));
    if (c.expected.invalid) {
      assert.equal(r.ok, false, c.name);
      assert.equal(r.field, c.expected.invalid.field, c.name);
      assert.equal(r.message, c.expected.invalid.message, c.name);
    } else {
      assert.equal(r.ok, true, `${c.name}: ${r.message}`);
      assert.deepEqual(r.manifest.panel.kinds, c.expected.kinds, c.name);
      assert.deepEqual(contributedKinds(r.manifest), c.expected.kinds, c.name);
      assert.equal(contributesLive(r.manifest), c.expected.kinds.includes("live"), c.name);
    }
  }
});

test("kinds is unknown below apiVersion 14 (and contributes too)", () => {
  const r = validateManifest(JSON.stringify({ ...manifestOf({ capabilities: ["search", "resolve"], panel: { label: "P", kinds: ["live"] } }), apiVersion: 13 }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.manifest.panel.kinds, undefined);
});

test("kit parity: the go.liveChannel shape for every shared case", () => {
  for (const c of cases.goParse) {
    let why = null;
    const g = liveChannelGoOf(c.input, (w) => { why = w; });
    if (c.expected.go) assert.deepEqual(g, c.expected.go, c.name);
    else {
      assert.equal(g, null, c.name);
      assert.equal(why, c.expected.why, c.name);
    }
  }
});

test("kit parity: when a go.liveChannel is honoured", () => {
  for (const c of cases.goRefusal) {
    const r = validateManifest(JSON.stringify(manifestOf(c)));
    assert.equal(r.ok, true, `${c.name}: ${r.message}`);
    assert.equal(liveChannelGoRefusal(r.manifest, c.trigger), c.expected, c.name);
  }
});

test("a screen answer reads go.liveChannel as the twelfth shape", () => {
  assert.ok(contract.manifest.screen.goShapes.includes("liveChannel"));
  const ok = checkScreenAnswer({ go: { liveChannel: { provider: "tdt", code: "la1" } } }, "es");
  assert.deepEqual(ok.answer.go, { liveChannel: { provider: "tdt", code: "la1" } });
  const bad = checkScreenAnswer({ go: { liveChannel: { provider: "own", code: "x" } }, toast: "t" }, "es");
  assert.equal(bad.answer.go ?? null, null);
  assert.ok(bad.dropped.some((d) => d.includes("go.liveChannel provider must be a plugin id")), bad.dropped.join("\n"));
});

test("kit parity: the live context is exactly the shared one (no position, no ref, no title)", () => {
  const c = cases.context;
  const got = liveContext(c.channel, c.base, c.sourceName);
  assert.deepEqual(got, c.expected);
  assert.deepEqual(Object.keys(got).filter((k) => !contract.kinoLivePanel.screenContextAdds.includes(k)).sort(), [...contract.kinoLivePanel.contextFields].sort());
  for (const k of contract.kinoLivePanel.notSent) assert.equal(got[k], undefined, k);
});

test("a live tab's player action is dropped whole, with the app's line", () => {
  assert.equal(contract.kinoLivePanel.playerDroppedLog, cases.playerDroppedLog);
  const lines = liveAnswerDrops({ player: { pause: true, seekToMs: 1 }, go: { title: { ref: "x", kind: "movie" } } });
  assert.deepEqual(lines, [
    "player actions do nothing on a live channel, dropped (live_channel)",
    "go.title: a contributed panel never opens a plugin's title, dropped",
  ]);
  assert.deepEqual(liveAnswerDrops({ toast: "x" }), []);
});

function inDir(manifest, script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kino-live-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "plugin.js"), script);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SCRIPT = [
  "export async function panel(ctx) { return { title: 'Fiesta', elements: [{ type: 'text', text: JSON.stringify({ kind: ctx.kind, live: ctx.live, channel: ctx.channel, ref: ctx.ref ?? null, positionMs: ctx.positionMs ?? null }) }] }; }",
  "export async function panelAction(event, ctx) { return { player: { pause: true }, go: { title: { ref: 'movie:1', kind: 'movie' } } }; }",
  "export async function playerEvent(event, ctx) { return null; }",
  "",
].join("\n");

test("run.mjs --live-channel: the live context, the player dropped, no playerEvent, and only a tab that joins live", () => {
  const live = manifestOf({ capabilities: ["playerPanelTab"], panel: { contributes: true, kinds: ["title", "live"] } });
  inDir(live, SCRIPT, (dir) => {
    const p = spawnSync(process.execPath, [RUN, "--live-channel", "tdt:la1:La 1", dir, "panel", "-"], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /\\"kind\\":\\"live\\",\\"live\\":true,\\"channel\\":\{\\"provider\\":\\"tdt\\",\\"code\\":\\"la1\\",\\"name\\":\\"La 1\\"\},\\"ref\\":null,\\"positionMs\\":null/);
    const a = spawnSync(process.execPath, [RUN, "--live-channel", "tdt:la1", dir, "panelAction", "-", "k", "press"], { encoding: "utf8" });
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stderr, /player actions do nothing on a live channel, dropped \(live_channel\)/);
    assert.match(a.stderr, /go\.title: a contributed panel never opens a plugin's title/);
    const e = spawnSync(process.execPath, [RUN, "--live-channel", "tdt:la1", dir, "playerEvent", "-", "paused"], { encoding: "utf8" });
    assert.equal(e.status, 2);
    assert.match(e.stderr, /no playerEvent on an En vivo channel/);
  });
  const titlesOnly = manifestOf({ capabilities: ["playerPanelTab"], panel: { contributes: true } });
  inDir(titlesOnly, SCRIPT, (dir) => {
    const p = spawnSync(process.execPath, [RUN, "--live-channel", "tdt:la1", dir, "panel", "-"], { encoding: "utf8" });
    assert.equal(p.status, 2);
    assert.match(p.stderr, /does not declare "kinds": \["live"\]/);
  });
});
