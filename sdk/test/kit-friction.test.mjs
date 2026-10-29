// Two small frictions authors hit with the kit: a "~" in --key on Windows, and the words of the `export … from` refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { expandHome } from "../seal.mjs";
import { toScript } from "../sandbox.mjs";

test("expandHome: a leading ~ is the home folder, anything else is left alone", () => {
  const home = join("C:", "Users", "someone");
  assert.equal(expandHome("~", home), home);
  assert.equal(expandHome("~/keys/author.pem", home), join(home, "keys", "author.pem"));
  assert.equal(expandHome("~" + "\\" + "keys", home), process.platform === "win32" ? join(home, "keys") : "~" + "\\" + "keys");
  assert.equal(expandHome("kino-author-key.pem", home), "kino-author-key.pem");
  assert.equal(expandHome("a~/b", home), "a~/b");
  assert.equal(expandHome("~other/key.pem", home), "~other/key.pem");
  assert.equal(expandHome(undefined, home), undefined);
});

test("toScript: export … from names the file and says to bundle it", () => {
  assert.throws(() => toScript('export { screen } from "./x.js";\n'), (e) => e.message.includes('"./x.js"') && /bundle/.test(e.message) && /one file/.test(e.message));
});

test("toScript: a local export { screen } still loads", () => {
  assert.doesNotThrow(() => toScript("const screen = () => ({});\nexport { screen };\n"));
});
