// node --test plugins/sdk/test/lyrics.test.mjs   (Node 18+)
// The kit's twin of the app's LyricsTest: same inputs, same expectations, so the two implementations cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, lyricsAnswer, lyricsShown, validateManifest } from "../contract.mjs";
import { consentLines } from "../validate.mjs";
import { lyricsArg } from "../run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const synced = (...ms) => JSON.stringify(ms.map((m) => ({ ms: m, text: `line ${m}` })));
const parse = (json, drops = []) => lyricsAnswer(json === null ? null : JSON.parse(json), (d) => drops.push(d));
const found = ({ s, plain, match, instrumental } = {}) => {
  const o = {};
  if (s !== undefined) o.synced = JSON.parse(s);
  if (plain !== undefined) o.plain = plain;
  if (match !== undefined) o.matchDurationMs = match;
  if (instrumental) o.instrumental = true;
  return parse(JSON.stringify(o));
};

test("lyrics: parse keeps ascending lines and drops the bad ones one by one", () => {
  const drops = [];
  const f = parse(`{"synced":[{"ms":0,"text":"a"},{"ms":1500.5,"text":"b"},{"ms":-1,"text":"c"},{"ms":3000,"text":"d"},{"ms":2000,"text":"e"},{"ms":4000,"text":""}]}`, drops);
  assert.deepEqual(f.synced, [{ ms: 0, text: "a" }, { ms: 3000, text: "d" }]);
  assert.equal(drops.length, 4);
});

test("lyrics: parse strips control and bidirectional characters but keeps newlines", () => {
  assert.equal(parse(JSON.stringify({ plain: "a‮b\u0007c\nd" })).plain, "abc\nd");
});

test("lyrics: parse cuts and drops over the caps", () => {
  assert.equal(parse(JSON.stringify({ plain: "x".repeat(25000) })).plain.length, contract.lyrics.maxPlainChars);
  const lines = Array.from({ length: 900 }, (_, i) => ({ ms: i * 1000, text: `l${i}` }));
  assert.equal(parse(JSON.stringify({ synced: lines })).synced.length, contract.lyrics.maxSyncedLines);
  assert.equal(parse(JSON.stringify({ synced: [{ ms: 0, text: "y".repeat(400) }] })).synced[0].text.length, contract.lyrics.maxLineChars);
  assert.equal(parse(JSON.stringify({ plain: "z".repeat(contract.lyrics.maxAnswerChars) })), null);
});

test("lyrics: parse returns null for nothing and keeps instrumental", () => {
  for (const nothing of [null, "null", "[]", "{}", `{"synced":[],"plain":""}`]) {
    const drops = [];
    assert.equal(parse(nothing, drops), null, String(nothing));
    assert.equal(drops.length, 0, `${nothing} drops nothing`);
  }
  const instrumental = parse(`{"instrumental":true}`);
  assert.equal(instrumental.instrumental, true);
  assert.deepEqual(instrumental.synced, []);
  assert.equal(instrumental.plain, null);
});

test("lyrics: parse reads the label and the matched duration when they are sane", () => {
  const ok = parse(`{"plain":"p","label":"LRCLIB","matchDurationMs":214000}`);
  assert.equal(ok.label, "LRCLIB");
  assert.equal(ok.matchDurationMs, 214000);
  const bad = parse(JSON.stringify({ plain: "p", label: "l".repeat(80), matchDurationMs: -5 }));
  assert.equal(bad.label.length, 60);
  assert.equal(bad.matchDurationMs, null);
});

test("lyrics: shown follows the plausible rule", () => {
  const s = synced(0, 100000, 214000);
  assert.equal(lyricsShown(found({ s, plain: "p", match: 214000 }), 215000), "synced");
  assert.equal(lyricsShown(found({ s, plain: "p", match: 200000 }), 215000), "plain");
  assert.equal(lyricsShown(found({ s, match: 200000 }), 215000), null);
  assert.equal(lyricsShown(found({ s: synced(0, 219000) }), 215000), "synced");
  assert.equal(lyricsShown(found({ s: synced(0, 221000) }), 215000), null);
  assert.equal(lyricsShown(found({ s, plain: "p" }), null), "plain");
  assert.equal(lyricsShown(found({ s }), null), "synced");
  assert.equal(lyricsShown(found({ instrumental: true }), 215000), "instrumental");
  assert.equal(lyricsShown(found({ plain: "p", instrumental: true }), 215000), "plain");
});

test("lyrics: lyricsArg builds the app's query", () => {
  assert.deepEqual(lyricsArg(["Song", "Artist", "Album", "215000"]), { title: "Song", artist: "Artist", album: "Album", durationMs: 215000 });
  assert.deepEqual(lyricsArg(["Song", "Artist"]), { title: "Song", artist: "Artist" });
  assert.deepEqual(lyricsArg(['{"title":"S","artist":"A","ids":{"isrc":"X"}}']), { title: "S", artist: "A", ids: { isrc: "X" } });
  assert.throws(() => lyricsArg([]));
});

test("lyrics: a manifest with only lyrics validates and shows the Spanish consent line", () => {
  const m = { id: "lyrics-demo", name: "Lyrics demo", version: "1.0.0", apiVersion: 19, entry: "plugin.js", hosts: ["lrclib.net"], capabilities: ["lyrics"] };
  assert.equal(validateManifest(JSON.stringify(m)).ok, true);
  assert.deepEqual(consentLines(m).map((l) => l.text), [contract.lyrics.consentLine]);
  assert.equal(contract.lyrics.consentLine, "Recibirá el título y el artista de lo que escuchas para buscar la letra");
});

test("lyrics: run.mjs asks the plugin and prints what Kino shows", () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-lyrics-"));
  try {
    writeFileSync(join(dir, "plugin.js"), "export async function lyrics(q){ return { synced: [{ ms: 0, text: q.title }, { ms: 1000, text: q.artist }], plain: 'p', matchDurationMs: q.durationMs }; }");
    writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify({ id: "lyrics-demo", name: "Lyrics demo", version: "1.0.0", apiVersion: 19, entry: "plugin.js", hosts: ["lrclib.net"], capabilities: ["lyrics"] }));
    const r = spawnSync(process.execPath, [join(here, "..", "run.mjs"), dir, "lyrics", "Song", "Artist", "Album", "215000"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^Kino shows: synced/m);
    assert.equal(JSON.parse(r.stdout).synced[0].text, "Song");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lyrics: the guide's limits table names the call time and the source has no raw control characters", async () => {
  const { TABLES } = await import("../guide-tables.mjs");
  assert.ok(TABLES.limits().includes(`${String.fromCharCode(96)}lyrics${String.fromCharCode(96)} ${contract.timeoutsMs.lyrics / 1000} s (apiVersion ${contract.lyrics.apiVersion})`));
  const { readFileSync } = await import("node:fs");
  for (const f of ["../contract.mjs"]) {
    const text = readFileSync(join(here, f), "utf8");
    // eslint-disable-next-line no-control-regex
    assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/.test(text), false, `${f} embeds raw control or bidirectional characters`);
  }
});
