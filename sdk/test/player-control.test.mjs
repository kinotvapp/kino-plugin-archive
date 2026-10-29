// Task 8j: player.pause and the consented playerControl capability, as the app decides them (PlayerControlRules.sift,
// PanelPlayerGate, PlayerControlRules.notice). The same cases run in the app's PlayerControlTest: kit parity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { foreignAnswerDrops, panelOutput, panelPlayerOf, playerNotice, siftPlayer } from "../panel.mjs";
import { checkPanelScreen } from "../screen.mjs";
import { playerControlGate } from "../kino-shim.mjs";
import { consentLines, validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "player-control-cases.json"), "utf8"));
const RUN = join(here, "..", "run.mjs");
const P = contract.kinoPlayerControl;

const action = (o) => panelPlayerOf(o, () => {});

test("the sift cases: who may move the player, by origin and the capability (pauseResumeApplied, playerActionFromTimerNeedsControl, ownerKeepsItsRulesWithoutControl, contributedPanelWithControlMayPauseSeekSpeedOnly)", () => {
  for (const c of cases.sift) {
    const lines = [];
    const out = siftPlayer(action(c.action), c.origin, { contributed: c.contributed, control: c.control }, (l) => lines.push(l));
    assert.deepEqual(out === null ? null : out.action, c.kept, c.name);
    if (out !== null) {
      assert.equal(out.controlled, c.controlled, c.name);
      assert.equal(out.announce, c.announce, c.name);
    }
    assert.deepEqual(lines, c.logs, c.name);
  }
});

test("the gate cases: one seek or pause a second, pause only on live, nothing under a Kino dialog or while seeking (rateLimits, neverOnLiveExceptPause, neverWhileKinoDialogOrScrubbing)", () => {
  for (const g of cases.gate) {
    let now = 0;
    let held = false;
    let casting = false;
    const gate = playerControlGate({ now: () => now, held: () => held, casting: () => casting });
    g.steps.forEach((s, j) => {
      now = s.atMs;
      held = s.held === true;
      casting = s.casting === true;
      const lines = [];
      const out = gate.check(action(s.action), { live: s.live === true, controlled: s.controlled, paused: s.paused === true }, (l) => lines.push(l));
      assert.deepEqual(out, s.kept, `${g.name} #${j}`);
      assert.deepEqual(lines, s.logs, `${g.name} #${j}`);
    });
  }
});

test("rateLimits: at most perMinute controlled actions a minute, and the window moves on", () => {
  const p = cases.perMinute;
  let now = 0;
  const gate = playerControlGate({ now: () => now });
  let kept = 0;
  const lines = [];
  for (let i = 0; i < p.count; i++) {
    now = i * p.every;
    if (gate.check({ seekToMs: i * 1000 }, { controlled: true }, (l) => lines.push(l)) !== null) kept++;
  }
  assert.equal(kept, p.keptCount);
  assert.equal(kept, P.perMinute);
  assert.deepEqual(lines, [`panel: more than ${P.perMinute} controlled player actions a minute, dropped`]);
  now = p.afterWindowAtMs;
  assert.deepEqual(gate.check({ seekToMs: 1 }, { controlled: true }), { seekToMs: 1 });
});

test("remoteActionIsAnnounced: the notice names the plugin and says what it did, es and en", () => {
  for (const c of cases.notice) {
    const confusable = c.name === "K1no";
    assert.equal(playerNotice(c.name, action(c.action), "es", confusable), c.es, c.name);
    assert.equal(playerNotice(c.name, action(c.action), "en", confusable), c.en, c.name);
  }
});

test("pauseResumeApplied: pause is read as a boolean, in answers and in panel results of both formats", () => {
  const logs = [];
  assert.deepEqual(panelPlayerOf({ pause: true }, (l) => logs.push(l)), { pause: true });
  assert.deepEqual(panelPlayerOf({ pause: false }, (l) => logs.push(l)), { pause: false });
  assert.equal(panelPlayerOf({ pause: "yes" }, (l) => logs.push(l)), null);
  assert.deepEqual(logs, ["panel: player.pause is not true or false, dropped"]);
  assert.deepEqual(panelOutput({ title: "P", elements: [], player: { seekToMs: 1000 } }).player, { seekToMs: 1000 });
  const screen = checkPanelScreen({ format: "screen", root: { type: "Text", text: "hola" }, refreshMs: 2000, player: { pause: true } });
  assert.deepEqual(screen.dropped, []);
  assert.deepEqual(screen.panel.player, { pause: true });
});

test("a contributed tab with playerControl: every origin, and a seek, a pause and a speed only", () => {
  const answer = { player: { seekToMs: 1000, pause: true, speed: 1.5, seekStepMs: 15000 } };
  assert.deepEqual(foreignAnswerDrops(answer, null, { control: true }), ["player.seekStepMs: a contributed panel only seeks, pauses and sets the speed; the playing plugin's player properties are its own, dropped"]);
  assert.deepEqual(foreignAnswerDrops({ player: { pause: true } }, "change", { control: true }), []);
  assert.deepEqual(P.contributedWithControl, contract.manifest.panel.contributes.playerActionKeptWithControl);
});

test("Task 8t: playerPanelTabWithPlayerControlIsStandalone and playerControlWithoutPanelIsRefused (app parity)", () => {
  const tab = (caps, panel = { contributes: true }) => JSON.stringify({ id: "party", name: "Fiesta", version: "1.0.0", apiVersion: P.apiVersion, entry: "plugin.js", hosts: ["example.com"], capabilities: caps, ...(panel ? { panel } : {}) });
  const ok = validateManifest(tab(["playerPanelTab", "room", "qrScan", "playerControl"]));
  assert.equal(ok.ok, true, ok.message);
  assert.ok(contract.capabilities.standaloneSupplements.includes("playerControl"));
  assert.equal(validateManifest(tab(["subtitles", "playerControl"], { label: "Fiesta" })).ok, true);
  const refused = validateManifest(tab(["subtitles", "playerControl"], null));
  assert.deepEqual([refused.ok, refused.field, refused.message], [false, "capabilities", contract.capabilities.playerControlNeedsPanelMessage]);
  const alone = validateManifest(tab(["playerControl"], null));
  assert.equal(alone.message, 'The plugin must declare "resolve"');
});

test("the manifest: apiVersion 14, never on its own, through an enhancement too", () => {
  const base = { id: "party", name: "Fiesta", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search", "resolve", P.capability] };
  assert.equal(validateManifest(JSON.stringify(base)).ok, true);
  const old = validateManifest(JSON.stringify({ ...base, apiVersion: 12 }));
  assert.equal(old.ok, false);
  assert.equal(old.message, 'The "playerControl" capability needs apiVersion 14');
  assert.equal(validateManifest(JSON.stringify({ ...base, capabilities: [P.capability] })).ok, false);
  assert.ok(contract.capabilities.needsApproval.includes(P.capability));
  assert.ok(contract.capabilities.declarative.includes(P.capability));
  assert.ok(!contract.capabilities.standalone.includes(P.capability));
  assert.ok(contract.manifest.enhancements.capabilities.includes(P.capability));
});

const MANIFEST = { id: "party", name: "Fiesta", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search", "resolve", "playerControl"], panel: { label: "Fiesta" } };
const SCRIPT = [
  "export async function search() { return []; }",
  "export async function resolve() { return null; }",
  "export async function panel(ctx) { return { title: 'Fiesta', refreshMs: 2000, elements: [], player: { pause: true } }; }",
  "export async function panelAction(event, ctx) { return { player: { pause: true } }; }",
  "export async function playerEvent(event, ctx) { return { player: { pause: false, seekToMs: 60000 } }; }",
  "",
].join("\n");

function inDir(manifest, script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "kino-control-"));
  try {
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "plugin.js"), script);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("consentLineAndRevoke: validate prints the red line and the note; run.mjs sifts as the app does, granted or revoked", async () => {
  const lines = consentLines(MANIFEST);
  assert.ok(lines.some((l) => l.text === P.consentLine.es && l.danger === true), JSON.stringify(lines));
  assert.equal(P.consentLine.en, "Can pause, resume and move your video by itself");
  await inDir(MANIFEST, SCRIPT, async (dir) => {
    const r = await validate(dir);
    assert.deepEqual(r.problems, []);
    assert.ok(r.consent.some((l) => l.text === P.consentLine.es && l.danger === true), JSON.stringify(r.consent));
    assert.ok(r.notes.some((n) => n.startsWith("playerControl:")), JSON.stringify(r.notes));
  });
  inDir(MANIFEST, SCRIPT, (dir) => {
    const granted = spawnSync(process.execPath, [RUN, dir, "panel", "movie:1"], { encoding: "utf8" });
    assert.equal(granted.status, 0, granted.stderr);
    assert.match(granted.stderr, /Kino tells the person: Fiesta: pausado/);
    const revoked = spawnSync(process.execPath, [RUN, dir, "panel", "movie:1"], { encoding: "utf8", env: { ...process.env, KINO_PLAYER_CONTROL_REVOKED: "1" } });
    assert.match(revoked.stderr, /a player action from a panel result or a playerEvent needs the playerControl capability, dropped/);
    assert.doesNotMatch(revoked.stderr, /Kino tells the person/);
    const event = spawnSync(process.execPath, [RUN, dir, "playerEvent", "movie:1", "paused"], { encoding: "utf8" });
    assert.match(event.stderr, /Kino tells the person: Fiesta: reanudado, movido a 1:00/);
    // The person's press: not announced.
    const press = spawnSync(process.execPath, [RUN, dir, "panelAction", "movie:1", "go", "press"], { encoding: "utf8" });
    assert.doesNotMatch(press.stderr, /Kino tells the person/);
  });
  // Without the capability a press still pauses (the owner), a change does not.
  inDir({ ...MANIFEST, capabilities: ["search", "resolve"] }, SCRIPT, (dir) => {
    const change = spawnSync(process.execPath, [RUN, dir, "panelAction", "movie:1", "go", "change", "true"], { encoding: "utf8" });
    assert.match(change.stderr, /player\.pause needs the person's press in the panel or the playerControl capability, dropped/);
  });
});
