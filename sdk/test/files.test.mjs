// node --test plugins/sdk/test/files.test.mjs   (Node 18+)
// kino.files (apiVersion 21): the kit's version over a folder on disk, against contract.files. The app's twin is
// PluginFilesStore / PluginFilesBridge (PluginFilesTest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { kitCall, kitScreenCall } from "../kit-call.mjs";

const manifest = { id: "reader", name: "Reader", version: "1.0.0", apiVersion: 21, entry: "plugin.js", hosts: ["example.org"], capabilities: ["screen", "files"] };

/** A kit kino over a folder holding two books, a song and a folder with a film, and a call the person started (a screenEvent after a tap). */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kino-files-"));
  writeFileSync(join(dir, "a-book.epub"), "0123456789".repeat(100));
  writeFileSync(join(dir, "b-book.mobi"), "mobi bytes");
  writeFileSync(join(dir, "c-song.mp3"), "song");
  mkdirSync(join(dir, "Films"));
  writeFileSync(join(dir, "Films", "movie.mkv"), "film");
  const { kino } = createKino(manifest, { filesDir: dir });
  const press = (fn) => kitCall.run("screenEvent", () => kitScreenCall.run({ press: true }, () => fn()));
  return { dir, kino, press, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

test("the capability's contract block", () => {
  assert.equal(contract.files.apiVersion, 21);
  assert.equal(contract.files.capability, "files");
  assert.ok(contract.capabilities.names.includes("files"));
  assert.equal(contract.capabilities.apiVersions.files, 21);
  assert.equal(contract.files.urlScheme, "kino-file:");
});

test("kino.files exists only for a plugin that declares it, at apiVersion 21", () => {
  const { kino } = createKino({ ...manifest, capabilities: ["screen"] });
  assert.equal(kino.files, undefined);
  const on = createKino(manifest, { filesDir: "." }).kino;
  assert.equal(typeof on.files, "object");
});

test("pick hands out the files of the folder, by kind, from a press only", async () => {
  const t = setup();
  try {
    assert.equal(await code(t.kino.files.pick()), "not_allowed", "outside a call the person started");
    const books = await t.press(() => t.kino.files.pick({ kinds: ["book"], multiple: true }));
    assert.deepEqual(books.map((b) => b.name), ["a-book.epub", "b-book.mobi"]);
    assert.ok(books.every((b) => b.kind === "book" && b.copied === false && typeof b.id === "string"));
    const [song] = await t.press(() => t.kino.files.pick({ kinds: ["audio"] }));
    assert.equal(song.name, "c-song.mp3");
    assert.equal((await t.kino.files.list()).length, 3, "listing needs no press");
    assert.equal(await code(t.press(() => t.kino.files.pick({ kinds: ["tape"] }))), "invalid_request");
  } finally { t.done(); }
});

test("read and readText take a range and refuse what is too big", async () => {
  const t = setup();
  try {
    const [book] = await t.press(() => t.kino.files.pick({ kinds: ["book"] }));
    assert.deepEqual([...await t.kino.files.read(book.id, { start: 0, end: 4 })], [48, 49, 50, 51]);
    assert.equal(await t.kino.files.readText(book.id, { start: 8, end: 12 }), "8901");
    assert.equal((await t.kino.files.read(book.id, { start: 990, end: 99999 })).length, 10, "clamped to the file");
    assert.equal((await t.kino.files.read(book.id)).length, 1000);
    assert.equal(await code(t.kino.files.read("nope")), "denied");
  } finally { t.done(); }
});

test("a picked folder lists its files; forget drops a handle", async () => {
  const t = setup();
  try {
    const folder = await t.press(() => t.kino.files.pickFolder());
    assert.equal(folder.name, "Films");
    const inside = await t.kino.files.list({ folder: folder.id });
    assert.deepEqual(inside.map((f) => [f.name, f.kind, f.folder]), [["movie.mkv", "video", folder.id]]);
    assert.equal((await t.kino.files.folders()).length, 1);
    await t.kino.files.forget(inside[0].id);
    assert.equal(await code(t.kino.files.info(inside[0].id)), "denied");
    await t.kino.files.forget(folder.id);
    assert.equal((await t.kino.files.folders()).length, 0);
  } finally { t.done(); }
});

test("a file that went away is gone, and url() is a kino-file address", async () => {
  const t = setup();
  try {
    const [book] = await t.press(() => t.kino.files.pick({ kinds: ["book"] }));
    assert.equal(t.kino.files.url(book.id), `kino-file:${book.id}`);
    rmSync(join(t.dir, "a-book.epub"));
    assert.equal(await code(t.kino.files.read(book.id)), "gone");
  } finally { t.done(); }
});
