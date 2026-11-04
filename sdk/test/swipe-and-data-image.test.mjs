// onSwipeLeft / onSwipeRight (any node) and `data:` urls on an image: both additive, no apiVersion.
import assert from "node:assert/strict";
import test from "node:test";
import { checkScreenTree } from "../screen.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("a node keeps its swipe actions, one per direction", () => {
  const { tree, dropped } = checkScreenTree({ type: "col", key: "page", onSwipeLeft: "next", onSwipeRight: { event: "prev", arg: "x" }, children: [{ type: "text", text: "Hola" }] });
  assert.deepEqual(dropped, []);
  assert.equal(tree.onSwipeLeft.event.name, "next");
  assert.equal(tree.onSwipeRight.event.name, "prev");
  assert.equal(tree.onSwipeRight.event.arg, "x");
});

test("a node with no swipe carries none", () => {
  const { tree } = checkScreenTree({ type: "col", children: [{ type: "text", text: "Hola" }] });
  assert.equal(tree.onSwipeLeft, undefined);
  assert.equal(tree.onSwipeRight, undefined);
});

test("a swipe that is not an action is dropped, logged", () => {
  const { tree, dropped } = checkScreenTree({ type: "col", onSwipeLeft: 5, children: [{ type: "text", text: "Hola" }] });
  assert.equal(tree.onSwipeLeft, undefined);
  assert.ok(dropped.some((l) => l.includes("onSwipeLeft")));
});

test("an image takes a base64 data url", () => {
  const { tree, dropped } = checkScreenTree({ type: "col", children: [{ type: "image", url: PNG, aspect: "2:3" }] });
  assert.deepEqual(dropped, []);
  assert.equal(tree.children[0].url, PNG);
});

test("a data url that is not a raster picture, or too long, is refused", () => {
  const svg = checkScreenTree({ type: "col", children: [{ type: "image", url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", fallback: { type: "icon", name: "movie" } }] });
  assert.equal(svg.tree.children[0].url, "");
  assert.ok(svg.dropped.some((l) => l.includes("data:")));
  const big = checkScreenTree({ type: "col", children: [{ type: "image", url: "data:image/png;base64," + "A".repeat(200001), fallback: { type: "icon", name: "movie" } }] });
  assert.equal(big.tree.children[0].url, "");
  const bare = checkScreenTree({ type: "col", children: [{ type: "image", url: PNG.replace("png", "png;charset=x") }] });
  assert.equal(bare.tree.children.length, 0);
});
