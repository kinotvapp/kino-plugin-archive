// A password setting's "sync": false (apiVersion 13), judged as the app's PluginSettings and ManifestParser.parseSync do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, validateManifest } from "../contract.mjs";

const base = { id: "demo", name: "Demo", version: "1.0.0", entry: "plugin.js", hosts: ["api.example.com"], capabilities: ["search", "resolve"] };
const v = (settings, extra = {}) => validateManifest(JSON.stringify({ ...base, apiVersion: 13, settings, ...extra }));
const pw = (extra = {}) => ({ key: "tg_password", label: "2FA", type: "password", ...extra });

test("the contract names the option, apiVersion 13, default true", () => {
  assert.equal(contract.settings.sync.apiVersion, 13);
  assert.equal(contract.settings.sync.default, true);
});

test("sync false or true is accepted on a password", () => {
  assert.equal(v([pw({ sync: false })]).ok, true);
  assert.equal(v([pw({ sync: true })]).ok, true);
  assert.equal(v([pw()]).ok, true);
});

test("sync on anything but a password or a text, or not a boolean, is refused with the app's messages", () => {
  const only = v([{ key: "nick", label: "Nick", type: "toggle", sync: false }]);
  assert.equal(only.ok, false);
  assert.equal(only.message, 'Only a setting of type password or text has "sync" ("nick")');
  for (const type of ["toggle", "section", "action", "url"]) assert.equal(v([{ key: "x", label: "X", type, sync: false }]).ok, false, type);
  // A text may stay on this device too (a phone number, shown as typed).
  assert.equal(v([{ key: "phone", label: "Teléfono", type: "text", sync: false }]).ok, true);
  const notBool = v([pw({ sync: "no" })]);
  assert.equal(notBool.ok, false);
  assert.equal(notBool.message, '"sync" of the setting "tg_password" must be true or false');
});

test("below apiVersion 13 the key is unknown, so ignored", () => {
  assert.equal(validateManifest(JSON.stringify({ ...base, apiVersion: 12, settings: [{ key: "nick", label: "Nick", type: "text", sync: "x" }] })).ok, true);
});

test("a sync provider may provision a device-only password (a one-shot secret), never as its keySecret", () => {
  const settings = [{ key: "botToken", label: "Token", type: "password" }, pw({ sync: false })];
  const m = (provision, keySecret = "botToken", apiVersion = 13) => v(settings, { apiVersion, capabilities: ["search", "resolve", "syncProvider"], sync: { keySecret, provision } });
  assert.equal(m(["botToken", "tg_password"]).ok, true, JSON.stringify(m(["botToken", "tg_password"])));
  assert.equal(m(["botToken"]).ok, true);
  assert.equal(contract.manifest.sync.provision.deviceOnlyMessage, undefined);
  const key = m(["tg_password"], "tg_password");
  assert.equal(key.ok, false);
  assert.equal(key.message, contract.manifest.sync.keySecret.deviceOnlyMessage);
  assert.equal(key.message, 'The "keySecret" of the "sync" field can\'t name a setting with "sync": false');
  // Below apiVersion 13 "sync" is unknown (the password syncs), so it is an ordinary keySecret.
  assert.equal(m(["tg_password"], "tg_password", 12).ok, true);
});

test("sync.generateKey (apiVersion 13): a boolean next to a password keySecret; below 13 ignored", () => {
  const G = contract.manifest.sync.generateKey;
  assert.equal(G.apiVersion, 13);
  assert.equal(G.keyBytes, 32);
  const settings = [{ key: "syncKey", label: "Clave", type: "password" }, { key: "chat", label: "Chat", type: "text" }];
  const m = (sync, apiVersion = 13) => v(settings, { apiVersion, capabilities: ["syncProvider"], sync });
  assert.equal(m({ keySecret: "syncKey", provision: ["syncKey"], generateKey: true }).ok, true);
  assert.equal(m({ keySecret: "syncKey", provision: ["syncKey"], generateKey: false }).ok, true);
  for (const bad of ["yes", 1, {}]) assert.equal(m({ keySecret: "syncKey", provision: ["syncKey"], generateKey: bad }).message, G.badMessage, JSON.stringify(bad));
  assert.equal(m({ keySecret: "syncKey", provision: ["syncKey"], generateKey: "yes" }, 12).ok, true);
  assert.equal(m({ generateKey: true, provision: ["syncKey"] }).message, contract.manifest.sync.keySecret.missingMessage);
  assert.equal(m({ keySecret: "chat", provision: ["chat"], generateKey: true }).message, contract.manifest.sync.keySecret.badMessage);
});

test("settingsStatus hide (apiVersion 13): the plugin's own keys, at most 32, unknown ones dropped; ignored below 13", async () => {
  const { statusHide } = await import("../contract.mjs");
  const H = contract.settings.ui.statusHide;
  assert.equal(H.apiVersion, 13);
  assert.equal(H.maxEntries, 32);
  const m = { apiVersion: 13, settings: [{ key: "qr_login" }, { key: "logout" }, { key: "status" }] };
  assert.deepEqual(statusHide({ status: "x", hide: ["qr_login", "ghost", 1, "qr_login", "logout"] }, m), ["qr_login", "logout"]);
  assert.deepEqual(statusHide({ hide: "qr_login" }, m), []);
  assert.deepEqual(statusHide({ hide: ["qr_login"] }, { ...m, apiVersion: 12 }), []);
  const many = { apiVersion: 13, settings: Array.from({ length: 40 }, (_, i) => ({ key: `k${i}` })) };
  assert.equal(statusHide({ hide: many.settings.map((s) => s.key) }, many).length, 32);
});

test("a provision can't name a device-only text (a password may, as a one-shot secret)", () => {
  const settings = [{ key: "botToken", label: "Token", type: "password" }, { key: "phone", label: "Teléfono", type: "text", sync: false }];
  const m = (provision) => v(settings, { capabilities: ["search", "resolve", "syncProvider"], sync: { keySecret: "botToken", provision } });
  assert.equal(m(["botToken", "phone"]).message, contract.manifest.sync.provision.deviceOnlyTextMessage);
  assert.equal(m(["botToken"]).ok, true);
});
