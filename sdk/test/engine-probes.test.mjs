// node --test plugins/sdk/test/engine-probes.test.mjs
// The language battery (engine-probes.js) in the kit's sandbox against what Kino's real engine answered
// (engine-probes.expected.json, written by the app's PluginEngineProbeTest). A difference is a place where a plugin
// that passes in the kit could behave differently in the app.
//
// Known differences are listed in KNOWN below with why; the test fails on any NEW difference and on a known one that
// stopped differing (so the list never rots). Engines print error messages differently, so only names are compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "../kino-shim.mjs";
import { loadPlugin } from "../sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(here, "engine-probes.expected.json"), "utf8"));

// name -> why the kit's answer differs from the app's. Filled from the first run; see engine-limits.md.
const KNOWN = JSON.parse(readFileSync(join(here, "engine-probes.known.json"), "utf8"));

test("the kit's sandbox answers the language battery as Kino's engine does, except the known differences", async () => {
  const { kino } = createKino({ id: "probe", name: "Probe", version: "1.0.0", apiVersion: 11, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search"] });
  const { plugin } = await loadPlugin(join(here, "engine-probes.js"), kino);
  const got = JSON.parse(await plugin.home());
  assert.equal(got.length, expected.length, "the battery and the fixture have different sizes: regenerate the fixture");
  const unexpected = [];
  const stale = new Set(Object.keys(KNOWN));
  for (let i = 0; i < got.length; i++) {
    assert.equal(got[i].name, expected[i].name);
    if (got[i].result === expected[i].result) continue;
    if (KNOWN[got[i].name] !== undefined) { stale.delete(got[i].name); continue; }
    unexpected.push(`${got[i].name}\n    kit: ${got[i].result}\n    app: ${expected[i].result}`);
  }
  for (const name of stale) if (!got.some((g, i) => g.name === name && g.result !== expected[i].result)) unexpected.push(`${name}: listed as a known difference but the answers now agree: remove it from engine-probes.known.json`);
  assert.deepEqual(unexpected.filter((u) => !u.includes("listed as a known")), [], "new differences between the kit and Kino's engine");
  assert.deepEqual(unexpected.filter((u) => u.includes("listed as a known")), []);
});
