import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScreenAnswer, forTimer } from "../screen.mjs";

const read = (a) => checkScreenAnswer(a, "es");

test("an answer's share is exactly { key }", () => {
  assert.deepEqual(read({ share: { key: "card" } }).answer.share, { key: "card" });
  for (const bad of ["card", {}, { key: 7 }, { key: "no spaces" }, { key: "card", text: "x" }]) {
    const r = read({ share: bad });
    assert.equal(r.answer.share, null);
    assert.ok(r.dropped.some((l) => l.startsWith("screen: answer.share ")), JSON.stringify(r.dropped));
  }
});

test("a timer's answer never shares", () => {
  const log = [];
  assert.equal(forTimer(read({ share: { key: "card" } }).answer, (l) => log.push(l)).share, null);
  assert.ok(log.some((l) => l.startsWith("screen: a timer's answer.share is dropped")));
});
