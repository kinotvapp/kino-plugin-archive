// imageSource (apiVersion 13): the kit's mirror of the app's image references (PluginOutput.imageOrRef), of the image
// answer's checks (PluginImages.decodeAnswer) and of the call itself (askImage), plus the README's plugin, run as written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowsImageRefs, checkOutput, contract, imageAnswer, imageRefOf, validateManifest } from "../contract.mjs";
import { askImage, createKino } from "../kino-shim.mjs";
import { loadPlugin } from "../sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(here, "..", "..", "..", "docs", "plugins", "README.md");

const base = { id: "demo", name: "Demo", version: "1.0.0", entry: "plugin.js", hosts: ["api.example.com"] };
const withRefs = { ...base, apiVersion: 13, capabilities: ["home", "search", "resolve", "episodes", "browse", "imageSource"] };
const without = { ...base, apiVersion: 13, capabilities: ["home", "search", "resolve", "episodes", "browse"] };
const ref = { source: "plugin", handle: "thumb:1" };

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");

test("the contract's images block and the capability, apiVersion 13, export image", () => {
  assert.equal(contract.images.apiVersion, 13);
  assert.equal(contract.images.capability, "imageSource");
  assert.equal(contract.capabilities.apiVersions.imageSource, 13);
  assert.deepEqual(contract.capabilities.exports.imageSource, ["image"]);
  assert.ok(!contract.capabilities.declarative.includes("imageSource"));
  assert.ok(!contract.capabilities.needsApproval.includes("imageSource"));
  const old = validateManifest(JSON.stringify({ ...withRefs, apiVersion: 12 }));
  assert.equal(old.ok, false);
  assert.equal(old.message, 'The "imageSource" capability needs apiVersion 13');
  assert.equal(validateManifest(JSON.stringify(withRefs)).ok, true);
  assert.equal(allowsImageRefs(withRefs), true);
  assert.equal(allowsImageRefs(without), false);
  assert.equal(allowsImageRefs({ ...withRefs, apiVersion: 12 }), false);
});

test("a reference is kept in poster, backdrop, still and a hero's image only for an imageSource plugin", () => {
  const item = { id: "a1", ref: "r1", title: "T", kind: "movie", poster: ref, backdrop: ref };
  const page = checkOutput("search", [item], withRefs).value;
  assert.deepEqual(page.items[0].poster, ref);
  assert.deepEqual(page.items[0].backdrop, ref);
  const home = checkOutput("home", [{ id: "r", title: "Row", items: [item] }], withRefs).value;
  assert.deepEqual(home[0].items[0].poster, ref);
  assert.equal(checkOutput("search", [item], without).value.items[0].poster, "");
  const eps = checkOutput("episodes", { episodes: [{ season: 1, number: 1, ref: "e1", still: { source: "plugin", handle: "s1" } }] }, withRefs).value;
  assert.deepEqual(eps.episodes[0].still, { source: "plugin", handle: "s1" });
  assert.equal(checkOutput("episodes", { episodes: [{ number: 1, ref: "e1", still: ref }] }, without).value.episodes[0].still, "");
  const sec = checkOutput("section", { hero: { title: "H", image: ref }, rows: [] }, withRefs).value;
  assert.deepEqual(sec.hero.image, ref);
  // Never a category's art.
  const cats = checkOutput("categories", [{ id: "k", title: "K", ref: "k", art: ref }], withRefs).value;
  assert.equal(cats[0].art, null);
});

test("a string in Kino's scheme is no image, and a malformed reference is simply none", () => {
  const forged = { id: "a1", ref: "r1", title: "T", kind: "movie", poster: "kino-plugin-image://other/aDE?m=00", backdrop: { source: "plugin", handle: "" } };
  const out = checkOutput("search", [forged], withRefs).value.items[0];
  assert.equal(out.poster, "");
  assert.equal(out.backdrop, "");
  assert.equal(out.title, "T");
  for (const bad of [null, {}, { source: "web", handle: "x" }, { source: "plugin" }, { source: "plugin", handle: 1 }, { source: "plugin", handle: "x".repeat(513) }, { source: "plugin", handle: "a\nb" }, { source: "plugin", handle: "\u0085" }]) {
    assert.equal(imageRefOf(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(imageRefOf({ source: "plugin", handle: "x".repeat(512), extra: 1 }), { source: "plugin", handle: "x".repeat(512) });
});

test("the image answer: three types whose bytes match, canonical base64, at most 256 KB", () => {
  assert.deepEqual(imageAnswer({ bytes: jpeg.toString("base64"), mime: "image/jpeg" }), { bytes: jpeg, mime: "image/jpeg" });
  assert.equal(imageAnswer({ bytes: png.toString("base64"), mime: "image/png" }).mime, "image/png");
  assert.equal(imageAnswer({ bytes: webp.toString("base64"), mime: "image/webp" }).mime, "image/webp");
  assert.equal(contract.images.maxBytes, 262144);
  const exact = Buffer.alloc(contract.images.maxBytes); jpeg.copy(exact);
  assert.equal(imageAnswer({ bytes: exact.toString("base64"), mime: "image/jpeg" }).bytes.length, 262144);
  const big = Buffer.alloc(contract.images.maxBytes + 1); jpeg.copy(big);
  assert.throws(() => imageAnswer({ bytes: big.toString("base64"), mime: "image/jpeg" }), /over 262144 bytes/);
  for (const [bytes, mime] of [[jpeg, "image/gif"], [jpeg, "image/svg+xml"], [png, "image/jpeg"], [jpeg, "image/png"], [Buffer.from("<svg/>"), "image/jpeg"]]) {
    assert.throws(() => imageAnswer({ bytes: bytes.toString("base64"), mime }), Error, mime);
  }
  const good = jpeg.toString("base64");
  for (const bad of [good.slice(0, -1), good + "\n", " " + good, good.replace("/", "_"), "/9j/4AECAwQ", "/9j/4AECAwR=", "", "!!!!"]) {
    assert.throws(() => imageAnswer({ bytes: bad, mime: "image/jpeg" }), Error, JSON.stringify(bad));
  }
  for (const shape of [null, [], "x", { mime: "image/jpeg" }, { bytes: good }, { bytes: 1, mime: "image/jpeg" }]) {
    assert.throws(() => imageAnswer(shape), Error, JSON.stringify(shape));
  }
  assert.equal(checkOutput("image", { bytes: good, mime: "image/jpeg" }, withRefs).value.mime, "image/jpeg");
});

test("askImage asks the plugin's image as Kino does: capability, export, reference, one at a time, 10 s", async () => {
  const answer = { bytes: jpeg.toString("base64"), mime: "image/jpeg" };
  const plugin = { image: async ({ handle }) => (handle === "thumb:1" ? answer : null) };
  assert.deepEqual(await askImage(plugin, withRefs, ref), { bytes: jpeg, mime: "image/jpeg" });
  await assert.rejects(askImage(plugin, without, ref), /does not declare "imageSource"/);
  await assert.rejects(askImage({}, withRefs, ref), /does not export image\(\)/);
  await assert.rejects(askImage(plugin, withRefs, { source: "plugin", handle: "" }), /not an image reference/);
  await assert.rejects(askImage(plugin, withRefs, { source: "plugin", handle: "other" }), /didn't return \{ bytes, mime \}/);
  await assert.rejects(askImage({ image: () => new Promise(() => {}) }, withRefs, ref, { timeoutMs: 30 }), /did not answer within/);
  assert.equal(contract.images.timeoutMs, 10000);
  // One call at a time per plugin.
  let inFlight = 0, peak = 0;
  const slow = { image: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return answer; } };
  await Promise.all([1, 2, 3].map((n) => askImage(slow, withRefs, { source: "plugin", handle: "h" + n })));
  assert.equal(peak, 1);
  // A failed call does not block the next one.
  const flaky = { n: 0, image: async () => { if (flaky.n++ === 0) throw new Error("boom"); return answer; } };
  await assert.rejects(askImage(flaky, withRefs, ref), /boom/);
  assert.equal((await askImage(flaky, withRefs, ref)).mime, "image/jpeg");
});

function imagesGuide() {
  const readme = readFileSync(README_PATH, "utf8");
  return readme.slice(readme.indexOf("### Images from the plugin (`imageSource`, apiVersion 13)"), readme.indexOf("### Catalog (SQLite): `kino.catalog`"));
}

// These tests read files of the Kino repo itself (docs/plugins/, plugins/archive-org, its .gitignore). A template does
// not carry them, so they are skipped here and run in the Kino repo.
const NEEDS_KINO_REPO = "needs files of the Kino repo that this template does not have";

test("the README's imageSource plugin runs as written: public posters stay URLs, the rest are references served by image", { skip: NEEDS_KINO_REPO }, async () => {
  const guide = imagesGuide();
  assert.ok(guide.length > 1000, "the README lost its imageSource section");
  const blocks = [...guide.matchAll(/```js\n([\s\S]*?)```/g)].map((x) => x[1]);
  const recipe = blocks.find((b) => b.startsWith("// kino-plugin.json (the parts that matter): "));
  assert.ok(recipe, "the README lost its complete imageSource plugin");
  const head = recipe.split("\n")[0];
  const m = { ...base, ...JSON.parse(head.slice(head.indexOf("{"))) };
  const checked = validateManifest(JSON.stringify(m));
  assert.equal(checked.ok, true, checked.message);
  const thumb = Buffer.concat([jpeg, Buffer.alloc(100)]);
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const headers = new Headers(init.headers || {});
    seen.push([u.pathname + u.search, headers.get("authorization")]);
    if (headers.get("authorization") !== "Bearer t0k3n") return new Response("no", { status: 401 });
    if (u.pathname === "/videos") return Response.json([
      { id: 1, title: "With a poster", posterUrl: "https://img.example.org/1.jpg" },
      { id: 2, title: "Only a thumbnail" },
      { id: 3, title: "A broken thumbnail" },
    ]);
    if (u.pathname === "/videos/2/thumbnail") return new Response(thumb, { status: 200, headers: { "content-type": "image/jpeg; charset=binary" } });
    if (u.pathname === "/videos/3/thumbnail") return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    if (u.pathname === "/videos/2") return Response.json({ streamUrl: "https://api.example.com/v/2.mp4" });
    return new Response("not found", { status: 404 });
  };
  const dir = mkdtempSync(join(tmpdir(), "kino-images-"));
  try {
    writeFileSync(join(dir, "plugin.js"), recipe);
    const { kino } = createKino(m, { fetchImpl, config: { token: "t0k3n" } });
    const plugin = (await loadPlugin(join(dir, "plugin.js"), kino)).plugin;
    const rows = checkOutput("home", await plugin.home(), m).value;
    const [a, b, c] = rows[0].items;
    assert.equal(a.poster, "https://img.example.org/1.jpg");
    assert.deepEqual(b.poster, { source: "plugin", handle: "thumb:2" });
    assert.deepEqual(c.poster, { source: "plugin", handle: "thumb:3" });
    // Kino asks image for the references only, and gets the bytes the service sent.
    const got = await askImage(plugin, m, b.poster);
    assert.equal(got.mime, "image/jpeg");
    assert.deepEqual(got.bytes, thumb);
    assert.ok(seen.some(([p, auth]) => p === "/videos/2/thumbnail?size=small" && auth === "Bearer t0k3n"));
    // A picture that is not an image, and a handle the plugin never made, end as the placeholder.
    await assert.rejects(askImage(plugin, m, c.poster), /not a JPEG, PNG or WebP picture/);
    await assert.rejects(askImage(plugin, m, { source: "plugin", handle: "../etc" }), /unknown image handle/);
    // The same answer without the capability: the references are dropped, the public poster stays.
    const plain = { ...m, capabilities: m.capabilities.filter((x) => x !== "imageSource") };
    const plainRows = checkOutput("home", await plugin.home(), plain).value;
    assert.deepEqual(plainRows[0].items.map((x) => x.poster), ["https://img.example.org/1.jpg", "", ""]);
    assert.equal((await plugin.resolve("video:2")).url, "https://api.example.com/v/2.mp4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the README's image export shape and storage one-liner hold the contract's words", { skip: NEEDS_KINO_REPO }, () => {
  const guide = imagesGuide();
  for (const mime of contract.images.mimes) assert.ok(guide.includes(`\`${mime}\``), mime);
  assert.ok(guide.includes("262,144 bytes") && guide.includes("10 seconds") && guide.includes("512 characters"));
  assert.ok(guide.includes("At most 1 `image` call in flight") && guide.includes("less than 2 s ago") && guide.includes("up to 20 s"));
  assert.ok(guide.includes("not asked again for 5 minutes") && guide.includes("2 timeouts in a row pause all your images for 5 minutes"));
  assert.ok(guide.includes("while one of your [byte streams]") && guide.includes("QuickJS cannot be interrupted, so Kino discards the runtime"));
  assert.ok(guide.includes("**Known limits.**") && guide.includes("Kino does not rewrite saved rows") && guide.includes("is not asked again while that card stays on screen"));
  assert.ok(!guide.includes("until your plugin's next answer brings it again"));
});
