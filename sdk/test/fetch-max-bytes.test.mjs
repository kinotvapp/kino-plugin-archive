// Task 7i-1: kino.fetch's maxBytes (apiVersion 14) as the kit runs it, mirroring the app (PluginHttp / prelude.js): the
// body read up to maxBytes and no further, `truncated` on the answer from apiVersion 14 only, the option ignored below it,
// out-of-range values refused. Plus the screen fields of the same task as the kit reads them (card flush, image fallback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { checkScreenTree, resolveResponsive } from "../screen.mjs";

const base = { id: "demo", name: "Demo", version: "1.0.0", entry: "plugin.js", hosts: ["api.example.com"], capabilities: ["home", "search", "resolve"] };
const v14 = { ...base, apiVersion: 14 };
const v13 = { ...base, apiVersion: 13 };

/** A server answering `size` bytes of "a", streamed in 1 KB chunks; counts how many chunks were pulled. */
function server(size) {
  const pulled = { chunks: 0 };
  const fetchImpl = async () => {
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent >= size) { controller.close(); return; }
        const n = Math.min(1024, size - sent);
        sent += n;
        pulled.chunks++;
        controller.enqueue(new Uint8Array(n).fill(97));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  };
  return { fetchImpl, pulled };
}

test("the contract's fetch.maxBytes: apiVersion 14, 1 to 2,000,000, answered in truncated", () => {
  assert.deepEqual(
    { apiVersion: contract.fetch.maxBytes.apiVersion, min: contract.fetch.maxBytes.min, max: contract.fetch.maxBytes.max, field: contract.fetch.maxBytes.field },
    { apiVersion: 14, min: 1, max: 2000000, field: "truncated" },
  );
  assert.ok(contract.fetch.maxBytes.max <= contract.fetch.maxBodyBytes);
});

test("maxBytes cuts the body, stops the read and says truncated", async () => {
  const { fetchImpl, pulled } = server(1024 * 1024);
  const { kino } = createKino(v14, { fetchImpl });
  const r = await kino.fetch("https://api.example.com/page", { maxBytes: 3000 });
  assert.equal(r.text().length, 3000);
  assert.equal(r.truncated, true);
  assert.ok(pulled.chunks <= 5, `read ${pulled.chunks} chunks of a 1024-chunk body`);
});

test("a body that fits is whole and not truncated; without maxBytes truncated is false from apiVersion 14", async () => {
  const fits = createKino(v14, { fetchImpl: server(100).fetchImpl }).kino;
  const r = await fits.fetch("https://api.example.com/page", { maxBytes: 100 });
  assert.equal(r.text().length, 100);
  assert.equal(r.truncated, false);
  const whole = await createKino(v14, { fetchImpl: server(10).fetchImpl }).kino.fetch("https://api.example.com/page");
  assert.equal(whole.truncated, false);
});

test("below apiVersion 14 maxBytes is ignored and the answer has no truncated", async () => {
  const { kino } = createKino(v13, { fetchImpl: server(5000).fetchImpl });
  const r = await kino.fetch("https://api.example.com/page", { maxBytes: 10 });
  assert.equal(r.text().length, 5000);
  assert.equal("truncated" in r, false);
});

test("maxBytes out of range or not a whole number is invalid_request", async () => {
  const { kino } = createKino(v14, { fetchImpl: server(10).fetchImpl });
  for (const bad of [0, -1, 2000001, 1.5, "100"]) {
    await assert.rejects(kino.fetch("https://api.example.com/page", { maxBytes: bad }), (e) => e.code === "invalid_request", String(bad));
  }
});

test("screen: a card's flush and an image's fallback as the kit reads them", () => {
  const r = checkScreenTree({ type: "col", children: [
    { type: "card", flush: true, children: [{ type: "image", url: "https://img.example.com/a.jpg", fallback: { type: "text", text: "Sin imagen" } }] },
    { type: "card", children: [{ type: "image", fallback: { type: "icon", name: "movie" } }] },
  ] }, "es");
  assert.deepEqual(r.dropped, []);
  const [flush, plain] = r.tree.children;
  assert.equal(flush.flush, true);
  assert.equal(plain.flush, false);
  assert.equal(flush.children[0].fallback.text, "Sin imagen");
  assert.equal(plain.children[0].url, "");
  assert.equal(plain.children[0].fallback.name, "movie");
  const resolved = resolveResponsive(r.tree, "tv", "expanded");
  assert.equal(resolved.children[0].children[0].fallback.text, "Sin imagen");
});
