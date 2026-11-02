// node --test plugins/sdk/test/visual-browser.test.mjs   (Node 18+)
// The kit's twin of the app's VisualBrowserTest: same inputs, same expectations, so the two implementations cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contract, validateManifest } from "../contract.mjs";
import { consentLines } from "../validate.mjs";
import { createKino } from "../kino-shim.mjs";
import { kitCall, kitScreenCall } from "../kit-call.mjs";
import { answerFor, effectiveUserAgent, formatStored, globMatches, navigationAllowed, parseOptions, selectCookies, stripWebViewMarker } from "../visual-browser.mjs";

const hosts = ["accounts.google.com", "music.youtube.com", "*.example.org"];
const secrets = ["cookieHeader"];
const ok = (o) => parseOptions(o, hosts, secrets).options;
const bad = (o) => parseOptions(o, hosts, secrets).error;
const manifest = (extra = {}) => ({ id: "ytm", name: "YT", version: "1.0.0", apiVersion: 20, entry: "plugin.js", hosts, capabilities: ["search", "resolve"], visualBrowser: true,
  settings: [{ key: "cookieHeader", label: "Cookies", type: "password" }], ...extra });

test("visualBrowser: the contract's numbers", () => {
  const V = contract.visualBrowser;
  assert.equal(V.apiVersion, 20);
  assert.equal(contract.maxApiVersion, 20);
  assert.deepEqual([V.maxTimeoutMs, V.minTimeoutMs, V.maxCookies, V.maxCookieChars, V.maxHtmlChars], [600000, 5000, 64, 16384, 2000000]);
  assert.deepEqual(V.errorCodes, ["bad_args", "forbidden", "unavailable", "busy", "store_failed"]);
  assert.deepEqual(V.fromFunctions, contract.qr.fromFunctions);
});

test("visualBrowser: a minimal request takes the defaults", () => {
  const o = ok({ url: "https://accounts.google.com/ServiceLogin?continue=x" });
  assert.equal(o.userAgent, null);
  assert.equal(o.timeoutMs, 600000);
  assert.equal(o.hasDoneWhen, false);
  assert.equal(o.storeAs, null);
});

test("visualBrowser: the address must be https on a declared host", () => {
  for (const u of ["http://accounts.google.com/", "https://evil.example/", "https://accounts.google.com:8443/", "https://user:pw@accounts.google.com/", "https://127.0.0.1/", "https://localhost/", "https://example.org/", "ftp://accounts.google.com/", "not a url"]) {
    assert.ok(bad({ url: u }).startsWith("kino.visualBrowser.open: url"), u);
  }
  assert.ok(ok({ url: "https://login.example.org/x" }));
  assert.match(bad({ url: 123 }), /url must be a string/);
  assert.match(bad([1]), /takes \{/);
  assert.match(bad({ url: "https://accounts.google.com/" + "a".repeat(2100) }), /over/);
});

test("visualBrowser: title, doneWhen and collect", () => {
  assert.equal(ok({ url: "https://music.youtube.com/", title: "  YouTube Music " }).title, "YouTube Music");
  assert.equal(ok({ url: "https://music.youtube.com/", title: "   " }).title, null);
  for (const t of ["a\nb", "a‮b", "x".repeat(61), 5]) assert.match(bad({ url: "https://music.youtube.com/", title: t }), /title/);
  const o = ok({ url: "https://music.youtube.com/", doneWhen: { cookies: ["SAPISID", "SID"], urlMatches: "https://music.youtube.com/*" } });
  assert.deepEqual(o.doneCookies, ["SAPISID", "SID"]);
  assert.equal(o.hasDoneWhen, true);
  assert.equal(ok({ url: "https://music.youtube.com/", doneWhen: {} }).hasDoneWhen, false);
  assert.match(bad({ url: "https://music.youtube.com/", doneWhen: { cookies: ["a b"] } }), /not a cookie name/);
  assert.match(bad({ url: "https://music.youtube.com/", doneWhen: { cookies: "SID" } }), /list of cookie names/);
  assert.match(bad({ url: "https://music.youtube.com/", collect: { cookies: Array.from({ length: 33 }, (_, i) => `c${i}`) } }), /more than/);
  const c = ok({ url: "https://music.youtube.com/", collect: { cookies: ["SID", "SID", "HSID"], html: true, finalUrl: true, storeAs: { setting: "cookieHeader", format: "json" } } });
  assert.deepEqual(c.collectCookies, ["SID", "HSID"]);
  assert.deepEqual(c.storeAs, { setting: "cookieHeader", format: "json", thenEvent: null });
  assert.match(bad({ url: "https://music.youtube.com/", collect: { cookies: ["SID"], storeAs: { setting: "other", format: "header" } } }), /password setting/);
  assert.match(bad({ url: "https://music.youtube.com/", collect: { cookies: ["SID"], storeAs: { setting: "cookieHeader", format: "csv" } } }), /format/);
  assert.match(bad({ url: "https://music.youtube.com/", collect: { storeAs: { setting: "cookieHeader", format: "header" } } }), /needs collect.cookies/);
});

test("visualBrowser: userAgent and timeoutMs", () => {
  assert.equal(ok({ url: "https://music.youtube.com/", userAgent: "browser" }).userAgent, "browser");
  assert.equal(ok({ url: "https://music.youtube.com/", userAgent: "MyUA/1.0 (x)" }).userAgent, "MyUA/1.0 (x)");
  for (const u of ["", "a\nb", "café", "u".repeat(301), 5]) assert.match(bad({ url: "https://music.youtube.com/", userAgent: u }), /userAgent/);
  assert.equal(ok({ url: "https://music.youtube.com/", userAgent: "u".repeat(300) }).userAgent.length, 300);
  assert.equal(ok({ url: "https://music.youtube.com/", timeoutMs: 99999999 }).timeoutMs, 600000);
  assert.equal(ok({ url: "https://music.youtube.com/", timeoutMs: 1 }).timeoutMs, 5000);
  assert.match(bad({ url: "https://music.youtube.com/", timeoutMs: "soon" }), /timeoutMs/);
});

test("visualBrowser: the user agent never carries the WebView marker", () => {
  assert.equal(effectiveUserAgent("browser"), contract.visualBrowser.browserUserAgent);
  assert.ok(!effectiveUserAgent("browser").includes("wv"));
  assert.equal(effectiveUserAgent("Mozilla/5.0 (Linux; Android 14; wv) X"), "Mozilla/5.0 (Linux; Android 14) X");
  assert.equal(effectiveUserAgent(null), null);
  assert.equal(stripWebViewMarker("a; wv b"), "a b");
});

test("visualBrowser: navigation and the address pattern", () => {
  assert.ok(navigationAllowed("https://accounts.google.com/signin?x=1#f", hosts));
  assert.ok(navigationAllowed("https://a.b.example.org/", hosts));
  for (const u of ["https://example.org/", "https://evil.google.com/", "http://accounts.google.com/", "https://accounts.google.com.evil.net/", "https://192.168.1.5/", "https://router.local/", "javascript:alert(1)"]) {
    assert.equal(navigationAllowed(u, hosts), false, u);
  }
  assert.ok(globMatches("https://music.youtube.com/*", "https://music.youtube.com/"));
  assert.ok(globMatches("*music.youtube.com*", "https://music.youtube.com/x"));
  assert.equal(globMatches("https://music.youtube.com/", "https://music.youtube.com/x"), false);
  assert.ok(globMatches("a*b*c", "aXXbYYc"));
  assert.equal(globMatches("*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(2000)), false);
});

test("visualBrowser: cookies are selected by name, capped and never cut in half", () => {
  const got = selectCookies(["HSID", "SID", "MISSING"], ["SID=old; NOPE=1; HSID=h", "SID=new; OTHER=2"]);
  assert.deepEqual(Object.keys(got), ["HSID", "SID"]);
  assert.equal(got.SID, "new");
  assert.equal(selectCookies(["T"], ["T=a=b=="]).T, "a=b==");
  const names = Array.from({ length: 64 }, (_, i) => `c${i + 1}`);
  assert.equal(Object.keys(selectCookies(names, [names.map((n) => `${n}=v`).join("; ")])).length, 64);
  const big = Array.from({ length: 20 }, (_, i) => `k${i + 1}`);
  const capped = selectCookies(big, [big.map((n) => `${n}=${"x".repeat(1000)}`).join("; ")]);
  assert.equal(Object.keys(capped).length, 16);
  assert.ok(Object.values(capped).every((v) => v.length === 1000));
  assert.equal(formatStored({ SID: "s=1", HSID: "h" }, "header"), "SID=s=1; HSID=h");
  assert.deepEqual(JSON.parse(formatStored({ SID: "s=1" }, "json")), { SID: "s=1" });
});

test("visualBrowser: with storeAs the answer carries names, never values", () => {
  const o = ok({ url: "https://accounts.google.com/x", collect: { cookies: ["SID", "HSID", "GONE"], storeAs: { setting: "cookieHeader", format: "header" } } });
  const stored = [];
  const a = answerFor(o, { status: "done", cookies: { SID: "secret-1", HSID: "secret-2", EXTRA: "x" } }, (s, t) => stored.push([s, t]), { cookieHeader: 500 });
  assert.deepEqual(a, { status: "done", stored: true, storedNames: ["SID", "HSID"] });
  assert.ok(!JSON.stringify(a).includes("secret"));
  assert.deepEqual(stored, [["cookieHeader", "SID=secret-1; HSID=secret-2"]]);
  assert.deepEqual(answerFor(o, { status: "done", cookies: {} }, () => assert.fail("nothing to store"), { cookieHeader: 500 }), { status: "done", stored: false, storedNames: [] });
  assert.equal(answerFor(o, { status: "done", cookies: { SID: "x".repeat(100) } }, () => assert.fail("does not fit"), { cookieHeader: 50 }).error.code, "store_failed");
  // Closing is cancelling: no cookie leaves.
  assert.deepEqual(answerFor(o, { status: "closed", cookies: { SID: "s" } }, () => assert.fail("closed"), { cookieHeader: 500 }), { status: "closed" });
  // Without storeAs the values come back, only those asked for.
  const plain = ok({ url: "https://accounts.google.com/x", collect: { cookies: ["SID"], html: true, finalUrl: true } });
  assert.deepEqual(answerFor(plain, { status: "done", finalUrl: "https://music.youtube.com/", cookies: { SID: "s", EXTRA: "x" }, html: "<html/>" }, () => {}, {}),
    { status: "done", finalUrl: "https://music.youtube.com/", html: "<html/>", cookies: { SID: "s" } });
});

test("visualBrowser: the manifest key exists from apiVersion 20 and is a boolean", () => {
  const v = (extra, api = 20) => validateManifest(JSON.stringify(manifest({ apiVersion: api, ...extra })));
  assert.equal(v({}).manifest.visualBrowser, true);
  assert.equal(v({ visualBrowser: false }).manifest.visualBrowser, false);
  assert.equal(v({ visualBrowser: true }, 19).manifest.visualBrowser, false);
  assert.deepEqual(v({ visualBrowser: "yes" }), { ok: false, field: "visualBrowser", message: contract.visualBrowser.notBooleanMessage });
  assert.equal(v({}, 21).ok, false);
  assert.ok(consentLines(v({}).manifest).some((l) => l.text === contract.visualBrowser.consentLine));
  assert.ok(!consentLines(v({ visualBrowser: false }).manifest).some((l) => l.text === contract.visualBrowser.consentLine));
});

test("visualBrowser: kino.visualBrowser needs the manifest key; available only with a person, on a phone and on a TV", () => {
  assert.equal(createKino(manifest({ visualBrowser: false })).kino.visualBrowser, undefined);
  assert.equal(createKino(manifest({ apiVersion: 19 })).kino.visualBrowser, undefined);
  assert.equal(createKino(manifest()).kino.visualBrowser.available, false);
  assert.equal(createKino(manifest(), { visualBrowser: async () => null }).kino.visualBrowser.available, true);
  assert.equal(createKino(manifest(), { visualBrowser: async () => null, device: "tv" }).kino.visualBrowser.available, true);
  assert.equal(createKino(manifest(), { device: "tv" }).kino.visualBrowser.available, false);
});

test("visualBrowser: the gate is the scanner's, and the errors are typed", async () => {
  const request = { url: "https://accounts.google.com/x" };
  let opened = 0;
  const { kino } = createKino(manifest(), { visualBrowser: async () => { opened++; return { status: "done" }; } });
  const code = async (fn, req = request, marks) => {
    try { await (marks ? kitScreenCall.run(marks, () => kitCall.run(fn, () => kino.visualBrowser.open(req))) : kitCall.run(fn, () => kino.visualBrowser.open(req))); return "ok"; } catch (e) { return e.code; }
  };
  assert.equal(await code("action"), "ok");
  assert.equal(await code("search"), "forbidden");
  assert.equal(await code("home"), "forbidden");
  assert.equal(await code("screenEvent", request, { press: false, tick: false }), "forbidden");
  assert.equal(await code("screenEvent", request, { press: true, tick: false }), "ok");
  assert.equal(await code("action", { url: "https://evil.example/" }), "bad_args");
  assert.equal(opened, 2);
  const tv = createKino(manifest(), { visualBrowser: async () => ({ status: "done" }), device: "tv" }).kino;
  assert.equal(await kitCall.run("action", () => tv.visualBrowser.open(request)).then((r) => r.status), "done");
  const noPerson = createKino(manifest(), { device: "tv" }).kino;
  await assert.rejects(() => kitCall.run("action", () => noPerson.visualBrowser.open(request)), { code: "unavailable" });
});

test("visualBrowser: busy while one window is open, and storeAs lands in kino.config after the call", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { kino } = createKino(manifest(), { visualBrowser: async () => { await gate; return { status: "done", cookies: { SID: "s1" } }; } });
  const req = { url: "https://accounts.google.com/x", collect: { cookies: ["SID"], storeAs: { setting: "cookieHeader", format: "header" } } };
  const first = kitCall.run("action", () => kino.visualBrowser.open(req));
  await new Promise((r) => setImmediate(r));
  await assert.rejects(() => kitCall.run("action", () => kino.visualBrowser.open(req)), { code: "busy" });
  release();
  const a = await first;
  assert.deepEqual(a, { status: "done", stored: true, storedNames: ["SID"] });
  await new Promise((r) => setImmediate(r));
  assert.equal(kino.config.get("cookieHeader"), "SID=s1");
});

// A plugin on an older apiVersion offers the web window to a Kino that has it, through an enhancements block (apiVersion 20).
test("visualBrowser in an enhancements block: the plugin keeps its apiVersion, the feature level is 20", async () => {
  const { validateManifest, featureApiVersion } = await import("../contract.mjs");
  const base = { id: "music", name: "Music", version: "1.0.0", apiVersion: 8, entry: "plugin.js", hosts: ["music.example.com"], capabilities: ["search", "home", "resolve"] };
  const on = validateManifest(JSON.stringify({ ...base, enhancements: { 20: { visualBrowser: true } } }));
  assert.ok(on.ok, JSON.stringify(on));
  assert.equal(on.manifest.apiVersion, 8);
  assert.equal(on.manifest.visualBrowser, true);
  assert.equal(featureApiVersion(on.manifest), 20);
  // Not a boolean: that block is dropped, the plugin itself still installs.
  const bad = validateManifest(JSON.stringify({ ...base, enhancements: { 20: { visualBrowser: "yes" } } }));
  assert.ok(bad.ok);
  assert.ok(!bad.manifest.visualBrowser);
  assert.ok(bad.manifest.enhancementsDropped.length === 1);
});

test("visualBrowser: storeAs.thenEvent is validated like a screenEvent name", () => {
  const req = (thenEvent) => ({ url: "https://accounts.google.com/x", collect: { cookies: ["SID"], storeAs: { setting: "cookieHeader", format: "header", thenEvent } } });
  assert.equal(ok(req("account_linked")).storeAs.thenEvent, "account_linked");
  assert.equal(ok(req(undefined)).storeAs.thenEvent, null);
  for (const t of ["open", "", "a b", "x".repeat(129), "é"]) assert.match(bad(req(t)), /collect\.storeAs\.thenEvent must be a screenEvent name/, JSON.stringify(t));
  assert.match(bad(req(5)), /collect\.storeAs\.thenEvent must be a string/);
});

test("visualBrowser: thenEvent is told to the open screen after the write, names only, and only from a screen's call", async () => {
  const told = [];
  const { kino, values } = createKino(manifest(), { visualBrowser: async () => ({ status: "done", cookies: { SID: "s1", HSID: "h1" } }), deliverScreenEvent: (name, arg) => told.push([name, arg]) });
  const req = { url: "https://accounts.google.com/x", collect: { cookies: ["SID", "HSID"], storeAs: { setting: "cookieHeader", format: "header", thenEvent: "account_linked" } } };
  const press = { press: true };
  const a = await kitScreenCall.run(press, () => kitCall.run("screenEvent", () => kino.visualBrowser.open(req)));
  assert.deepEqual(a, { status: "done", stored: true, storedNames: ["SID", "HSID"] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(told, [["account_linked", { stored: ["SID", "HSID"] }]]);
  assert.ok(!JSON.stringify(told).includes("s1"));
  // A settings action accepts the option and delivers nothing.
  await kitCall.run("action", () => kino.visualBrowser.open(req));
  await new Promise((r) => setImmediate(r));
  assert.equal(told.length, 1);
});
