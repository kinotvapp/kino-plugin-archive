// node --test plugins/sdk/test/kino-identity.test.mjs   (Node 18+)
// kino.identity (apiVersion 15, capability "identity"): the kit prints the red consent line, refuses a plugin that calls
// kino.identity without declaring it, and its stand-in answers a fake account with the app's rules (PluginIdentityBridge):
// a per-plugin pseudonym, never the Telegram id or username, and an optional challenge signed by a per-plugin P-256 key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract, validateManifest } from "../contract.mjs";
import { createKino, identityPseudonym, identitySignedBytes, kitCall, kitIdentityApi, signingLane } from "../kino-shim.mjs";
import { kitScreenCall } from "../kit-call.mjs";
import { consentLines, undeclaredIdentityProblem } from "../validate.mjs";

const I = contract.kinoIdentity;

const manifest = (extra = {}) => ({
  id: "kino-social", name: "Kino Social", version: "1.0.0", apiVersion: 15, entry: "plugin.js",
  hosts: ["social.example.com"], capabilities: ["screen", "identity"], screen: { label: "Social" }, ...extra,
});

const asScreen = (fn) => kitCall.run("screen", () => kitScreenCall.run({ press: false, tick: false }, fn));
const CHALLENGE = "abcdefghijklmnop0123_-";

test("the pseudonym formula is pinned: kino-social + 123456789", () => {
  assert.equal(identityPseudonym("kino-social", 123456789), "c1408d23c07560a94b771feb3de61c32");
  assert.equal(identityPseudonym("kino-social", "123456789"), "c1408d23c07560a94b771feb3de61c32");
  assert.notEqual(identityPseudonym("other-plugin", 123456789), identityPseudonym("kino-social", 123456789));
  assert.equal(I.pseudonymHexChars, 32);
  assert.equal(I.pseudonymPrefix, "kino-identity-v1\n");
  assert.equal(I.signaturePrefix, "kino-identity-v2\n");
});

test("the manifest: identity is apiVersion 15, declarative, needs approval, never on its own; the consent line is red", () => {
  assert.equal(contract.capabilities.apiVersions.identity, 15);
  assert.ok(contract.capabilities.needsApproval.includes("identity"));
  assert.ok(contract.capabilities.declarative.includes("identity"));
  assert.ok(contract.capabilities.standaloneSupplements.includes("identity"));
  const ok = validateManifest(JSON.stringify(manifest()));
  assert.equal(ok.ok, true, ok.message);
  const old = validateManifest(JSON.stringify(manifest({ apiVersion: 14 })));
  assert.equal(old.ok, false);
  const alone = validateManifest(JSON.stringify(manifest({ capabilities: ["identity"], screen: undefined })));
  assert.equal(alone.ok, false);
  const line = consentLines(ok.manifest).find((l) => l.text === I.consentLine.es);
  assert.deepEqual(line, { text: "Podrá saber tu usuario de Telegram y enviarlo a sus servicios", danger: true });
  assert.equal(I.consentLine.en, "Can know your Telegram user and send it to its services");
});

test("a plugin that calls kino.identity without declaring it is refused by validate", () => {
  const src = "export async function screen() { const me = await kino.identity.telegram(); return me.id; }";
  assert.match(undeclaredIdentityProblem({ capabilities: ["screen"] }, src), /does not declare the "identity" capability/);
  assert.equal(undeclaredIdentityProblem({ capabilities: ["screen", "identity"] }, src), null);
  assert.equal(undeclaredIdentityProblem({ capabilities: ["screen"] }, "const identity = 1;"), null);
});

test("the shim answers the fake identity: a pseudonym and the token, never the Telegram id nor a username", async () => {
  const { kino } = createKino(manifest(), { env: { KINO_IDENTITY_TG: "123456789", KINO_IDENTITY_TOKEN: "tok.sig" } });
  assert.equal(typeof kino.identity, "object");
  const me = await asScreen(() => kino.identity.telegram());
  assert.deepEqual({ ...me }, { id: "c1408d23c07560a94b771feb3de61c32", token: "tok.sig" });
  assert.deepEqual(Object.keys(me).sort(), [...I.answerFields].sort());
  // An apiVersion 14 kino has no kino.identity.
  assert.equal(createKino(manifest({ apiVersion: 14, capabilities: ["screen"] }), { env: {} }).kino.identity, undefined);
});

test("a challenge is signed by a per-plugin P-256 key over the exact v2 bytes, attesting the author and the code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-identity-"));
  const entryFile = join(dir, "plugin.js");
  writeFileSync(entryFile, "export async function screen() {}\n");
  const codeHash = createHash("sha256").update(readFileSync(entryFile)).digest("hex");
  const { kino } = createKino(manifest(), { env: { KINO_IDENTITY_TG: "42", KINO_IDENTITY_AUTHOR: "07DA-B67F-2ACF-B4D3" }, entryFile });
  const me = await asScreen(() => kino.identity.telegram({ challenge: CHALLENGE }));
  assert.deepEqual(Object.keys(me).sort(), [...I.answerFields, ...I.challengeFields].sort());
  assert.equal(me.author, "07DA-B67F-2ACF-B4D3");
  assert.equal(me.codeHash, codeHash);
  const key = createPublicKey({ key: Buffer.from(me.deviceKey, "base64url"), format: "der", type: "spki" });
  assert.equal(key.asymmetricKeyDetails.namedCurve, "prime256v1");
  const bytes = Buffer.from("kino-identity-v2\nkino-social\n" + CHALLENGE + "\n07DA-B67F-2ACF-B4D3\n" + codeHash, "utf8");
  assert.deepEqual(identitySignedBytes("kino-social", CHALLENGE, "07DA-B67F-2ACF-B4D3", codeHash), bytes);
  assert.equal(nodeVerify("sha256", bytes, key, Buffer.from(me.signature, "base64url")), true);
  // A modified copy (another code hash) or another author never matches the signature.
  assert.equal(nodeVerify("sha256", identitySignedBytes("kino-social", CHALLENGE, "07DA-B67F-2ACF-B4D3", "0".repeat(64)), key, Buffer.from(me.signature, "base64url")), false);
  assert.equal(nodeVerify("sha256", identitySignedBytes("kino-social", CHALLENGE, "", codeHash), key, Buffer.from(me.signature, "base64url")), false);
  // Unsigned and no entry known: both empty, still signed.
  const bare = createKino(manifest(), { env: {} }).kino;
  const b = await asScreen(() => bare.identity.telegram({ challenge: CHALLENGE }));
  assert.equal(b.author, "");
  assert.equal(b.codeHash, "");
  assert.equal(nodeVerify("sha256", identitySignedBytes("kino-social", CHALLENGE, "", ""), createPublicKey({ key: Buffer.from(b.deviceKey, "base64url"), format: "der", type: "spki" }), Buffer.from(b.signature, "base64url")), true);
  // Same plugin: the same key; another plugin: another key.
  const again = await asScreen(() => kino.identity.telegram({ challenge: CHALLENGE }));
  assert.equal(again.deviceKey, me.deviceKey);
  const other = createKino(manifest({ id: "other-plugin" }), { env: { KINO_IDENTITY_TG: "42" } }).kino;
  assert.notEqual((await asScreen(() => other.identity.telegram({ challenge: CHALLENGE }))).deviceKey, me.deviceKey);
  rmSync(dir, { recursive: true, force: true });
});

test("a bad challenge or options are bad_request", async () => {
  const { kino } = createKino(manifest(), { env: {} });
  for (const bad of [{ challenge: "short" }, { challenge: "x".repeat(129) }, { challenge: "has space in it!!" }, { challenge: 12345678901234567 }, "nope", [1]]) {
    await assert.rejects(asScreen(() => kino.identity.telegram(bad)), (e) => e.code === "bad_request", JSON.stringify(bad));
  }
  assert.ok(new RegExp(I.challengePattern).test("x".repeat(128)));
  assert.ok(new RegExp(I.challengePattern).test("x".repeat(16)));
});

test("revoked, undeclared, a background call: permission_denied; no account: not_available; past perMinute: rate_limited", async () => {
  const revoked = createKino(manifest(), { env: { KINO_IDENTITY_REVOKED: "1" } }).kino;
  await assert.rejects(asScreen(() => revoked.identity.telegram()), (e) => e.code === "permission_denied");
  const undeclared = createKino(manifest({ capabilities: ["screen"] }), { env: {} }).kino;
  await assert.rejects(asScreen(() => undeclared.identity.telegram()), (e) => e.code === "permission_denied");
  const { kino } = createKino(manifest(), { env: {} });
  await assert.rejects(kitCall.run("job", () => kino.identity.telegram()), (e) => e.code === "permission_denied");
  await assert.rejects(kitCall.run("home", () => kino.identity.telegram()), (e) => e.code === "permission_denied");
  await assert.rejects(kitCall.run("screenEvent", () => kitScreenCall.run({ press: false, tick: true }, () => kino.identity.telegram())), (e) => e.code === "permission_denied");
  const none = createKino(manifest(), { env: { KINO_IDENTITY_TG: "none" } }).kino;
  await assert.rejects(asScreen(() => none.identity.telegram()), (e) => e.code === "not_available");
  let t = 0;
  const api = kitIdentityApi(manifest(), { env: {}, now: () => t, origin: () => ({ fn: "screenEvent" }) });
  for (let i = 0; i < I.perMinute; i++) await api.telegram();
  await assert.rejects(api.telegram(), (e) => e.code === "rate_limited");
  t += 60_000;
  assert.ok((await api.telegram()).id);
});

test("sign() never reaches kino.identity", async () => {
  const { kino } = createKino(manifest(), { env: {} });
  await assert.rejects(signingLane(kino).identity.telegram(), (e) => e.code === "not_allowed");
});
