// node --test plugins/sdk/test/kino-room.test.mjs   (Node 18+)
// kino.room (apiVersion 14, capability "room", Task 8l): the kit prints the red consent line, refuses a plugin that calls
// kino.room without declaring it, shares the app's payload/name/code rules (room-cases.json, run by PluginRoomTest too), and
// its in-memory room with two simulated members answers with the app's shapes and refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { createKino, createKitRoom, roomCode, roomName, roomPayloadVerdict, signingLane } from "../kino-shim.mjs";
import { consentLines, undeclaredRoomProblem } from "../validate.mjs";

const R = contract.kinoRoom;
const kinoOf = (m, o) => createKino(m, o).kino;
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "room-cases.json"), "utf8"));

const manifest = (extra = {}) => ({
  id: "party", name: "Fiesta", version: "1.0.0", apiVersion: 14, entry: "plugin.js",
  hosts: ["example.com"], capabilities: ["screen", "room"], screen: { label: "Fiesta" }, ...extra,
});

test("kitPrintsTheConsentLine: the room line is red and is the app's, word for word", () => {
  const checked = validateManifest(JSON.stringify(manifest()));
  assert.equal(checked.ok, true, checked.message);
  const line = consentLines(checked.manifest).find((l) => l.text === R.consentLine.es);
  assert.deepEqual(line, { text: "Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los mensajes de la sala a quienes entren", danger: true });
  // Never on its own, and only at apiVersion 14.
  assert.equal(validateManifest(JSON.stringify(manifest({ capabilities: ["room"], screen: undefined }))).ok, false);
  assert.equal(validateManifest(JSON.stringify(manifest({ apiVersion: 13, capabilities: ["search", "resolve", "room"], screen: undefined }))).ok, false);
});

test("undeclaredRoomProblem: calling kino.room without the capability is refused", () => {
  assert.match(undeclaredRoomProblem({ capabilities: ["screen"] }, "await kino.room.open({})"), /does not declare the "room" capability/);
  assert.equal(undeclaredRoomProblem({ capabilities: ["screen", "room"] }, "await kino.room.open({})"), null);
  assert.equal(undeclaredRoomProblem({ capabilities: ["screen"] }, "const room = 1;"), null);
});

test("kit parity with the app: payloads, names and codes (room-cases.json)", () => {
  for (const p of CASES.payloads) {
    let text = p.repeat !== undefined ? p.text.replace("{x}", p.repeat.repeat(p.times)) : p.text;
    if (p.repeat2 !== undefined) text = text.replace("{y}", p.repeat2.repeat(p.times2));
    assert.equal(roomPayloadVerdict(text).ok, p.ok, p.name);
  }
  for (const n of CASES.names) assert.equal(roomName(n.in, n.max), n.out, JSON.stringify(n.in));
  for (const c of CASES.codes) assert.equal(roomCode(c.in), c.out, c.in);
});

test("the fake room: open, two simulated members, messages both ways, members, state, close", async () => {
  const kitRoom = createKitRoom();
  const kino = kinoOf(manifest(), { room: kitRoom, callFunction: "screenEvent", env: {} });
  assert.equal(typeof kino.room, "object");
  const opened = await kino.room.open({ name: "Ana", ttlMin: 30 });
  assert.match(opened.code, /^[0-9]{12}$/);
  assert.equal(typeof opened.words, "string");
  assert.ok(!JSON.stringify(opened).includes("http"));
  const first = await kino.room.inbox();
  assert.deepEqual(first.events.map((e) => [e.kind, e.from, e.name]), [["join", "mbea0001", "Bea"], ["join", "mcaro002", "Caro"]]);
  await kino.room.send({ play: true });
  assert.deepEqual(kitRoom.received.mbea0001, [{ play: true }]);
  await kino.room.send({ only: "caro" }, { to: "mcaro002" });
  assert.deepEqual(kitRoom.received.mcaro002, [{ play: true }, { only: "caro" }]);
  kitRoom.say("mbea0001", { chat: "hola" });
  const next = await kino.room.inbox({ since: first.last });
  assert.deepEqual(next.events.map((e) => [e.kind, e.payload]), [["msg", { chat: "hola" }]]);
  assert.deepEqual((await kino.room.members()).map((m) => m.memberId), ["host", "mbea0001", "mcaro002"]);
  assert.equal((await kino.room.state()).role, "host");
  kitRoom.leave("mcaro002");
  assert.equal((await kino.room.inbox({ since: next.last })).events[0].kind, "leave");
  await kino.room.close();
  assert.equal((await kino.room.state()).role, "none");
  await assert.rejects(kino.room.inbox(), { code: "room_closed" });
});

test("the fake room: joining the waiting remote room, wrong code, unknown words, sessions and busy", async () => {
  const kitRoom = createKitRoom();
  const kino = kinoOf(manifest(), { room: kitRoom, callFunction: "panelAction", env: {} });
  await assert.rejects(kino.room.join({ words: kitRoom.remote.words, code: "000000000000" }), { code: "room_denied" });
  await assert.rejects(kino.room.join({ words: "nowhere-at-all", code: kitRoom.remote.code }), { code: "room_unreachable" });
  await assert.rejects(kino.room.join({ words: kitRoom.remote.words, code: "123" }), { code: "bad_request" });
  const joined = await kino.room.join({ words: kitRoom.remote.words, code: kitRoom.remote.code.replace(/(\d{4})(?=\d)/g, "$1 "), name: "Beto" });
  assert.equal(joined.host.name, "Kit");
  await kino.room.send({ hi: 1 });
  assert.deepEqual(kitRoom.received.host, [{ hi: 1 }]);
  await assert.rejects(kino.room.send({ x: 1 }, { to: "mbea0001" }), { code: "bad_request" });
  // A backup endpoint with the room's code: allowed only because this plugin is in that room.
  const backup = await kino.room.open({ code: kitRoom.remote.code });
  assert.equal(backup.code, kitRoom.remote.code);
  await assert.rejects(kino.room.open(), { code: "room_busy" });
  await assert.rejects(kinoOf(manifest(), { callFunction: "screenEvent", env: {} }).room.open({ code: "999999999999" }), { code: "permission_denied" });
  // Session selector: hosted vs the joined handle.
  await kino.room.send({ to: "guests" }, { session: "hosted" });
  assert.deepEqual(kitRoom.received.mbea0001, [{ to: "guests" }]);
  await assert.rejects(kino.room.inbox({ session: "jnothere" }), { code: "room_closed" });
  kitRoom.leave("host");
  assert.equal((await kino.room.inbox({ session: joined.handle })).events.at(-1).kind, "closed");
});

test("the fake room: limits and gates as the app's", async () => {
  let t = 1_000_000;
  const kitRoom = createKitRoom({ now: () => t });
  const kino = kinoOf(manifest(), { room: kitRoom, callFunction: "screenEvent", env: {}, now: () => t });
  await kino.room.open();
  await kino.room.send({ t: "x".repeat(R.limits.maxPayloadBytes - 8) });
  await assert.rejects(kino.room.send({ t: "x".repeat(R.limits.maxPayloadBytes - 7) }), { code: "bad_request" });
  await assert.rejects(kino.room.send({ a: { b: { c: [[1]] } } }), { code: "bad_request" });
  await assert.rejects(kino.room.send([1]), { code: "bad_request" });
  t += 2000;
  for (let i = 0; i < R.limits.perSecond; i++) await kino.room.send({ i });
  await assert.rejects(kino.room.send({ i: 99 }), { code: "rate_limited" });
  await assert.rejects(kino.room.inbox({ limit: R.limits.maxInboxLimit + 1 }), { code: "bad_request" });
  await assert.rejects(kinoOf(manifest(), { env: {} }).room.open({ ttlMin: R.limits.maxTtlMin + 1 }), { code: "bad_request" });
  // Gates: not from a background or sync call, open not from a render, traffic not from another export, revoked, undeclared.
  await assert.rejects(kinoOf(manifest(), { callFunction: "screen", env: {} }).room.open(), { code: "permission_denied" });
  await assert.rejects(kinoOf(manifest(), { callFunction: "search", env: {} }).room.inbox(), { code: "permission_denied" });
  await assert.rejects(kinoOf(manifest(), { syncCall: true, env: {} }).room.state(), { code: "permission_denied" });
  await assert.rejects(kinoOf(manifest(), { env: { KINO_ROOM_REVOKED: "1" } }).room.state(), { code: "permission_denied" });
  await assert.rejects(kinoOf(manifest({ capabilities: ["screen"] }), { env: {} }).room.state(), { code: "permission_denied" });
  assert.equal(kinoOf(manifest({ apiVersion: 13, capabilities: ["search", "resolve"], screen: undefined }), { env: {} }).room, undefined);
  // The signing lane never has it.
  const lane = signingLane(kinoOf(manifest(), { env: {} }));
  await assert.rejects(lane.room.open(), { code: "not_allowed" });
});

test("the contract and the kit agree on the shapes", () => {
  assert.deepEqual(R.functions, ["open", "join", "send", "inbox", "members", "close", "state"]);
  assert.deepEqual(Object.keys(kinoOf(manifest(), { env: {} }).room).sort(), [...R.functions].sort());
  assert.ok(contract.capabilities.standaloneSupplements.includes("room"));
  assert.ok(contract.capabilities.needsApproval.includes("room"));
});

test("Task 8w: a shorter code on request, and 30 wrong joins close the room, as the app's", async () => {
  for (const digits of [4, 6, 12]) {
    const kino = kinoOf(manifest(), { room: createKitRoom(), callFunction: "screenEvent", env: {} });
    const r = await kino.room.open({ codeDigits: digits });
    assert.match(r.code, new RegExp(`^[0-9]{${digits}}$`));
  }
  assert.equal((await kinoOf(manifest(), { room: createKitRoom(), callFunction: "screenEvent", env: {} }).room.open()).code.length, R.codeDigits.default);
  for (const bad of [3, 13, 4.5, "6"]) {
    await assert.rejects(kinoOf(manifest(), { room: createKitRoom(), callFunction: "screenEvent", env: {} }).room.open({ codeDigits: bad }), { code: "bad_request" });
  }
  assert.deepEqual(R.codeDigits, { $comment: R.codeDigits.$comment, min: 4, max: 12, default: 12 });
  assert.equal(R.limits.maxFailedJoins, 30);
  const kitRoom = createKitRoom();
  const kino = kinoOf(manifest(), { room: kitRoom, callFunction: "screenEvent", env: {} });
  for (let i = 0; i < R.limits.maxFailedJoins; i++) await assert.rejects(kino.room.join({ words: kitRoom.remote.words, code: "0000" }), { code: "room_denied" });
  await assert.rejects(kino.room.join({ words: kitRoom.remote.words, code: kitRoom.remote.code }), { code: "room_closed" });
});
