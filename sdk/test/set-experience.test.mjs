// apiVersion 18: go.setExperience as the kit reads it (PluginScreenOutput.setExperienceGoOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, setExperienceGoOf } from "../contract.mjs";
import { checkPanelScreenAnswer, checkScreenAnswer } from "../screen.mjs";

const read = (v) => { const why = []; return { go: setExperienceGoOf(v, (w) => why.push(w)), why }; };

test("the contract lists the shape, from apiVersion 18", () => {
  assert.ok(contract.manifest.screen.goShapes.includes("setExperience"));
  assert.deepEqual(contract.manifest.screen.goSetExperience.words, ["light", "full"]);
  assert.equal(contract.manifest.screen.goSetExperience.apiVersion, 18);
});

test("the two experience words are read", () => {
  assert.deepEqual(read("light").go, { experience: "light" });
  assert.deepEqual(read("full").go, { experience: "full" });
});

test("anything else is dropped, with the app's reason", () => {
  for (const v of ["medium", "Light", "", 1, true, null, { experience: "full" }]) {
    assert.deepEqual(read(v).why, ['must be "light" or "full"'], String(JSON.stringify(v)));
    assert.equal(read(v).go, null);
  }
});

test("an answer keeps it at apiVersion 18 and drops it below", () => {
  assert.deepEqual(checkScreenAnswer({ go: { setExperience: "full" } }).answer.go, { setExperience: { experience: "full" } });
  const old = checkScreenAnswer({ go: { setExperience: "full" } }, "es", { apiVersion: 17 });
  assert.equal(old.answer.go, null);
  assert.ok(old.dropped.includes("screen: answer go.setExperience needs apiVersion 18, dropped"), old.dropped.join("\n"));
});

test("a panel drops it: only the plugin's own screen may ask", () => {
  const r = checkPanelScreenAnswer({ go: { setExperience: "full" } });
  assert.equal(r.answer.go, null);
  assert.ok(r.dropped.includes("panel: go.setExperience is honoured only on the plugin's own screen, dropped"), r.dropped.join(" | "));
});
