// The player slot (apiVersion 23, "playerSlot"): the manifest's `slot` block, the consent line of a fixed element, the answer
// SlotParser reads (the cases are shared with the app's SlotParserTest), the press answer, the kit's run modes, the clock example
// and the guide's rows. Kino 0.9.83.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contract, requiredExports, validateManifest } from "../contract.mjs";
import { TABLES } from "../guide-tables.mjs";
import { parseSlotFrame, slotActionRequest, slotBareContext, slotContext } from "../slot.mjs";
import { consentLines, validate } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, "..", "run.mjs");
const DOCS = join(here, "..", "..", "..", "docs", "plugins");
const CLOCK = join(DOCS, "examples", "player-clock");
const cases = JSON.parse(readFileSync(join(here, "player-slot-cases.json"), "utf8"));
const P = contract.playerSlot;
const NEEDS_KINO_REPO = "needs files of the Kino repo that this template does not have";

const el = (id, kind = "text", mode = "overlay") => ({ id, kind, mode });
const manifest = (over = {}) => ({
  id: "clockface", name: "Clockface", version: "1.0.0", apiVersion: 23, entry: "plugin.js", hosts: ["example.com"],
  capabilities: ["screen", "playerSlot"], screen: { label: "Clock" }, slot: { elements: [el("clock", "text", "fixed")] }, ...over,
});
const check = (m) => validateManifest(JSON.stringify(m));
const refused = (m) => { const r = check(m); assert.equal(r.ok, false, JSON.stringify(r)); return r; };

test("the clock example's manifest is valid and declares one fixed text element", { skip: NEEDS_KINO_REPO }, () => {
  const r = validateManifest(readFileSync(join(CLOCK, "kino-plugin.json"), "utf8"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.manifest.slot, { elements: [{ id: "clock", kind: "text", mode: "fixed" }], hasFixed: true });
  assert.deepEqual(requiredExports(r.manifest.capabilities, r.manifest.settings, r.manifest).sort(), ["playerSlot", "playerSlotAction"]);
});

test("a slot lists 1 to 3 elements, and a fourth is refused", () => {
  assert.equal(check(manifest({ slot: { elements: [el("a"), el("b"), el("c")] } })).ok, true);
  const four = refused(manifest({ slot: { elements: [el("a"), el("b"), el("c"), el("d")] } }));
  assert.equal(four.field, "slot");
  assert.equal(four.message, P.badElementsMessage);
  assert.equal(refused(manifest({ slot: { elements: [] } })).message, P.badElementsMessage);
  assert.equal(refused(manifest({ slot: {} })).message, P.badElementsMessage);
});

test("an element needs a lowercase id, a known kind and a known mode, and ids are unique", () => {
  for (const bad of [el("Clock"), el("1a"), el("a".repeat(25)), el("a", "video"), el("a", "text", "floating"), { id: "a", kind: "text" }, "a", null, [1]]) {
    assert.equal(refused(manifest({ slot: { elements: [bad] } })).message, P.badElementMessage, JSON.stringify(bad));
  }
  assert.equal(check(manifest({ slot: { elements: [el("a".repeat(24)), el("x-y_1")] } })).ok, true);
  assert.equal(refused(manifest({ slot: { elements: [el("a"), el("a", "icon")] } })).message, P.duplicateIdMessage);
});

test("the slot block and the playerSlot capability need each other, and a slot is an object", () => {
  assert.deepEqual([refused(manifest({ slot: undefined })).field, refused(manifest({ slot: undefined })).message], ["capabilities", P.capabilityNeedsMessage]);
  const r = refused(manifest({ capabilities: ["screen"] }));
  assert.deepEqual([r.field, r.message], ["slot", P.needsCapabilityMessage]);
  assert.equal(refused(manifest({ slot: [] })).message, P.notObjectMessage);
  assert.equal(refused(manifest({ slot: null })).message, P.notObjectMessage);
});

test("below apiVersion 23 the capability is too new and the block is unknown", () => {
  assert.match(refused(manifest({ apiVersion: 14 })).message, /playerSlot.*needs apiVersion 23/);
  const ignored = check(manifest({ apiVersion: 14, capabilities: ["screen"] }));
  assert.equal(ignored.ok, true);
  assert.equal(ignored.manifest.slot, null);
});

test("a plugin that only has a slot is standalone: playerSlot and its slot block validate with no resolve or search", () => {
  const alone = check(manifest({ capabilities: ["playerSlot"], screen: undefined }));
  assert.equal(alone.ok, true, JSON.stringify(alone));
  assert.equal(refused(manifest({ capabilities: ["playerSlot"], screen: undefined, slot: undefined })).field, "capabilities");
  // playerControl still needs a panel beside a standalone set.
  assert.equal(refused(manifest({ capabilities: ["playerSlot", "playerControl"], screen: undefined })).message, contract.capabilities.playerControlNeedsPanelMessage);
});

test("an enhancement adds a slot to an older plugin, and a half enhancement is dropped", () => {
  const base = { id: "old", name: "Old", version: "1.0.0", apiVersion: 14, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search", "resolve"] };
  const ok = check({ ...base, enhancements: { 23: { capabilities: ["playerSlot"], slot: { elements: [el("clock", "text", "fixed")] } } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.manifest.enhancementsApplied, [23]);
  assert.equal(ok.manifest.slot.hasFixed, true);
  const half = check({ ...base, enhancements: { 23: { capabilities: ["playerSlot"] } } });
  assert.equal(half.ok, true);
  assert.equal(half.manifest.slot, null);
  assert.match(half.manifest.enhancementsDropped[0], /^enhancements\.23: capabilities: .*needs a "slot" block/);
});

test("consent: a fixed element asks in red, an overlay-only slot asks nothing", () => {
  const fixed = consentLines(check(manifest()).manifest);
  assert.deepEqual(fixed.filter((l) => l.text === P.fixedConsentLine.es).map((l) => l.danger), [true]);
  const overlay = consentLines(check(manifest({ slot: { elements: [el("a"), el("b", "button")] } })).manifest);
  assert.equal(overlay.some((l) => l.text === P.fixedConsentLine.es), false);
  assert.equal(overlay.length, 0);
});

test("the answer cases shared with the app (SlotParserTest.sharedCases)", () => {
  for (const c of cases.cases) {
    const r = parseSlotFrame(c.raw, cases.elements);
    const got = r.frame && { items: r.frame.items, refreshMs: r.frame.refreshMs };
    const want = c.frame && {
      items: c.frame.items.map((i) => i), refreshMs: c.frame.refreshMs,
    };
    assert.deepEqual(got, want, c.name);
  }
});

test("a dropped item says why, and a repeated id keeps the first valid one", () => {
  const r = parseSlotFrame({ items: [{ id: "a" }, { id: "a", text: "x" }, { id: "a", text: "y" }, { id: "zz", text: "q" }, 7] }, [el("a")]);
  assert.deepEqual(r.frame.items, [{ id: "a", text: ["x"] }]);
  assert.equal(r.dropped.length, 4);
  assert.match(r.dropped[0], /"a" \(text\) has nothing Kino can draw/);
});

test("the press answer: openPanel and a player action go through the panel's reader and the press rules", () => {
  const log = [];
  assert.equal(slotActionRequest(null, {}, (l) => log.push(l)), null);
  assert.equal(slotActionRequest({}, {}, (l) => log.push(l)), null);
  assert.deepEqual(slotActionRequest({ openPanel: true }), { openPanel: true, player: null, controlled: false });
  assert.deepEqual(slotActionRequest({ openPanel: "yes" }), null);
  // The title's own plugin keeps a pause after a press; a contributor (the default) keeps only a seek.
  assert.deepEqual(slotActionRequest({ player: { pause: true } }, { contributed: false })?.player, { pause: true });
  assert.equal(slotActionRequest({ player: { pause: true } }, { contributed: true }), null);
  assert.deepEqual(slotActionRequest({ player: { seekToMs: 5000 } }, { contributed: true })?.player, { seekToMs: 5000 });
  assert.equal(slotActionRequest("nope", {}, (l) => log.push(l)), null);
  assert.ok(log.some((l) => l === "slot: the action answer is not a JSON object"));
});

test("on a live channel a press keeps only pause, and only with playerControl; resize and the timeline fields never survive", () => {
  const log = [];
  const out = slotActionRequest({ openPanel: true, player: { seekToMs: 5000, speed: 2, pause: true, resize: "fill" } }, { live: true, contributed: false, control: false }, (l) => log.push(l));
  assert.equal(out.player, null);
  assert.equal(out.openPanel, true);
  const withControl = slotActionRequest({ player: { seekToMs: 5000, speed: 2, pause: true, resize: "fill" } }, { live: true, contributed: false, control: true });
  assert.deepEqual(withControl.player, { pause: true });
  assert.equal(withControl.controlled, true);
  assert.ok(log.includes(`slot: on a live stream a slot press never seeks or changes the timeline (${P.liveDropped.join(", ")}), dropped`), log.join("|"));
  assert.equal(slotActionRequest({ player: { seekToMs: 1 } }, { live: true, contributed: false }), null);
  assert.equal(slotActionRequest({ player: { resize: "fill" } }, { live: true, contributed: false, control: true }), null);
});

test("the contexts: the owner's has live: false, a private title's has no kind", () => {
  const own = slotContext("ref1");
  assert.equal(own.live, false);
  assert.equal(own.kind, "movie");
  const bare = slotBareContext();
  assert.deepEqual(Object.keys(bare).sort(), [...P.bareContextFields].sort());
  assert.equal("kind" in bare, false);
  assert.equal(slotBareContext({ live: true }).live, true);
});

const run = (...args) => spawnSync(process.execPath, [RUN, ...args], { encoding: "utf8" });

test("run.mjs playerSlot renders the clock frame: HH:mm and the date on two lines, refreshMs 60000", { skip: NEEDS_KINO_REPO }, () => {
  const r = run(CLOCK, "playerSlot");
  assert.equal(r.status, 0, r.stderr);
  const frame = JSON.parse(r.stdout);
  assert.equal(frame.refreshMs, 60000);
  assert.equal(frame.items.length, 1);
  assert.equal(frame.items[0].id, "clock");
  assert.equal(frame.items[0].text.length, 2);
  assert.match(frame.items[0].text[0], /^\d{2}:\d{2}$/);
  assert.match(frame.items[0].text[1], /^\p{L}+ \d{1,2} \p{L}+$/u);
  // English when the context says so (--context merges over the fake one).
  const en = JSON.parse(run("--context", '{"lang":"en-US"}', CLOCK, "playerSlot").stdout);
  assert.match(en.items[0].text[1], /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);
});

test("run.mjs playerSlot works with the three other contexts, and playerSlotAction needs a declared button", { skip: NEEDS_KINO_REPO }, () => {
  assert.equal(run("--bare", CLOCK, "playerSlot").status, 0);
  assert.equal(run("--live-channel", "tdt:la1:La 1", CLOCK, "playerSlot", "-").status, 0);
  assert.equal(run("--foreign", "latino:Latino", CLOCK, "playerSlot", "abc").status, 0);
  const press = run(CLOCK, "playerSlotAction", "demo", "clock");
  assert.equal(press.status, 2);
  assert.match(press.stderr, /not a declared button/);
  const noId = run(CLOCK, "playerSlotAction", "demo");
  assert.equal(noId.status, 2);
});

test("run.mjs refuses the slot modes for a manifest without a slot", () => {
  const demo = join(here, "panel-demo");
  const r = run(demo, "playerSlot");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not declare "slot"/);
});

test("validate accepts the clock example: no problems, the red consent line and the slot note", { skip: NEEDS_KINO_REPO }, async () => {
  const r = await validate(CLOCK);
  assert.deepEqual(r.problems, []);
  assert.ok(r.consent.some((l) => l.text === P.fixedConsentLine.es));
  assert.ok(r.notes.some((n) => n.startsWith("playerSlot: up to 3 elements")));
  const frame = await validate(CLOCK, { run: "playerSlot" });
  assert.deepEqual(frame.problems, []);
  assert.equal(frame.output.refreshMs, 60000);
});

test("the clock's text for fixed instants, in both languages, and the committed bundle is what src/ builds to", { skip: NEEDS_KINO_REPO }, async () => {
  const { clockText } = await import(pathToFileURL(join(CLOCK, "src", "clock.js")).href);
  const at = new Date(2026, 10, 4, 21, 5);
  assert.equal(clockText(at, "es-CO"), "21:05\nmié 4 nov");
  assert.equal(clockText(at, "en-US"), "21:05\nWed Nov 4");
  assert.equal(clockText(new Date(2026, 0, 9, 7, 30), undefined), "07:30\nvie 9 ene");
  const { bundle } = await import(pathToFileURL(join(CLOCK, "scripts", "build.mjs")).href);
  assert.equal(readFileSync(join(CLOCK, "plugin.js"), "utf8").replace(/\r\n/g, "\n"), bundle());
});

test("the guide: the playerSlot consent row, the limits row, and the README names the capability and the apiVersion", { skip: NEEDS_KINO_REPO }, () => {
  const row = TABLES.screenConsents().split("\n").find((r) => r.startsWith("| `playerSlot` |"));
  assert.ok(row, "screenConsents lacks playerSlot");
  assert.ok(row.includes(P.fixedConsentLine.es) && row.includes(P.switchLabel.es), row);
  const limits = TABLES.limits().split("\n").find((r) => r.startsWith("| Player slot (`playerSlot`, apiVersion 23)"));
  assert.ok(limits, "the limits table lacks the player slot");
  for (const n of [P.maxElements, P.textMaxLines, P.refreshMsFloor, P.refreshMsCeiling, P.firstFrameRetries]) assert.ok(limits.includes(n.toLocaleString("en-US")), `${n}: ${limits}`);
  const readme = readFileSync(join(DOCS, "README.md"), "utf8");
  const field = (name) => readme.split("\n").find((r) => r.startsWith(`| \`${name}\` |`));
  assert.ok(field("capabilities").includes("`playerSlot`") && field("capabilities").includes("`apiVersion: 23`"), "the capabilities row");
  assert.ok(field("apiVersion").includes(`\`1\` to \`${contract.maxApiVersion}\``) && contract.maxApiVersion === 23, "the apiVersion row");
  assert.ok(readme.includes("## 15. The player slot (`playerSlot`, apiVersion 23)"));
  // The README's lines are the ones the app shows.
  for (const text of [P.fixedConsentLine.es, P.fixedConsentLine.en, P.switchLabel.es, P.openPanelKey, ...P.liveDropped, ...P.bareContextFields]) assert.ok(readme.includes(text), text);
  const dts = readFileSync(join(DOCS, "kino.d.ts"), "utf8");
  for (const name of ["KinoManifestSlot", "KinoSlotElement", "KinoSlotContext", "KinoSlotItem", "KinoSlotAnswer", "KinoSlotActionEvent", "KinoSlotActionAnswer"]) assert.ok(dts.includes(`interface ${name}`) || dts.includes(`type ${name}`), name);
});
