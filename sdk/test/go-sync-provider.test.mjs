// go.syncProvider (the thirteenth go shape): opens Kino's sync-provider settings so the person picks THIS plugin there.
// Mirrors ScreenGoSyncProviderTest in the app.
import assert from "node:assert/strict";
import test from "node:test";
import { contract, syncProviderGoRefusal } from "../contract.mjs";
import { checkScreenAnswer, checkScreenTree } from "../screen.mjs";
import { TABLES } from "../guide-tables.mjs";

const goOf = (go) => {
  const log = [];
  const r = checkScreenAnswer({ go }, "es", {});
  return { go: r.answer?.go, dropped: r.dropped, log };
};

test("contract: syncProvider is the thirteenth shape and carries the rules", () => {
  const shapes = contract.manifest.screen.goShapes;
  assert.equal(shapes.length, 13);
  assert.equal(shapes.at(-1), "syncProvider");
  const P = contract.manifest.screen.goSyncProvider;
  assert.equal(P.needsCapability, "syncProvider");
  assert.deepEqual(P.fromTriggers, ["press", "submit"]);
});

test("an answer's go.syncProvider is kept only as true", () => {
  assert.deepEqual(goOf({ syncProvider: true }).go, { syncProvider: true });
  for (const bad of [false, "yes", 1, {}, null]) {
    const r = goOf({ syncProvider: bad });
    assert.equal(r.go ?? null, null, JSON.stringify(bad));
    assert.ok(r.dropped.some((d) => d.includes("go.syncProvider")), JSON.stringify(bad));
  }
});

test("a node's onPressed go.syncProvider is kept in the tree", () => {
  const tree = { type: "ElevatedButton", key: "pick", labelText: "Abrir proveedor de sincronización", onPressed: { go: { syncProvider: true } } };
  const r = checkScreenTree(tree);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.tree.onTap.go, { syncProvider: true });
});

test("go.syncProvider takes no other key beside it", () => {
  const r = goOf({ syncProvider: true, search: { q: "x" } });
  assert.equal(r.go ?? null, null);
  assert.ok(r.dropped.some((d) => d.includes("exactly one of")));
});

test("refusal: only the person's press or submit, only a syncProvider plugin", () => {
  const provider = { capabilities: ["syncProvider", "screen"] };
  const other = { capabilities: ["screen"] };
  assert.equal(syncProviderGoRefusal(provider, "press"), null);
  assert.equal(syncProviderGoRefusal(provider, "submit"), null);
  for (const t of ["open", "timer", "change", "playerEvent"]) assert.equal(syncProviderGoRefusal(provider, t), "not_press", t);
  assert.equal(syncProviderGoRefusal(other, "press"), "not_sync_provider");
  assert.equal(syncProviderGoRefusal({}, "press"), "not_sync_provider");
});

test("the guide's go table lists syncProvider", () => {
  assert.match(TABLES.screenGo(), /\| `syncProvider` \|/);
});
