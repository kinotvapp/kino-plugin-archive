// Node stand-in for the `kino` global Kino gives plugins (see GUIDE.md). Same shapes, same host
// check, same caps and error codes as the app, read from contract.json. Node 18+ (global fetch).
//
// Kino's own app code is authoritative: its own network and host-gate logic decide what a plugin
// may really do. This file only APPROXIMATES their host, redirect and request-cap rules so you can
// develop locally; if the two ever disagree, the app is right. Known differences:
// kino.html.select exists only in the app (it uses Jsoup); a host that resolves to a private
// address is not refused; the cookie jar keeps name/value/domain/path/expiry/secure but not every
// RFC 6265 corner; nothing enforces the per-call time or memory limits.
//
// Sealed secrets (spec 2026-09-29-plugin-sealed-secrets-design.md §5, §6): this kit can never open
// a seal -- only the app, with the native private key, can -- so it reads the PLAIN values straight
// from `.kino-secrets.json` next to the manifest (`{ "<name>": "<value>" }`, written by hand during
// development; `seal.mjs` only ever produces the sealed string that goes in the manifest) and
// simulates the app's marker, substitution, declared-host-and-https and redaction rules on top of that.
import { aiOriginAllowed, currentQrOrigin, kitCall, kitJobRequest, qrScanOriginAllowed } from "./kit-call.mjs";
import { gunzipSync } from "node:zlib";
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowsByteSource, allowsImageRefs, anyFetchRefusal, BYTE_STREAM_INVALID, byteSourceOf, readAnswer, readRangeProblem, anyHostBudget, contract, featureApiVersion, fetchAnyHost, hostMatches, imageAnswer, imageRefOf, isUserServer, kb, schemeAllowed, syncCallCap } from "./contract.mjs";
import { decodeCipherKey } from "./seal.mjs";
import { keepsAddresses } from "./screen.mjs";
import { filterRelevant, shortQuery, sortBySimilarity } from "./kino-rank.mjs";
import { createSharedStore, kitSharedApi } from "./shared.mjs";

// Captured at load: the runner later replaces console.error to keep stdout clean, and kino.log
// must not be routed through that replacement (it would print two prefixes).
const writeErr = console.error.bind(console);

const SDK_DIR = dirname(fileURLToPath(import.meta.url));

export function kinoError(code, message, options) {
  const c = typeof code === "string" && /^[a-z_]{1,32}$/.test(code) ? code : "unknown";
  const e = new Error(String(message ?? "").slice(0, contract.errors.maxMessageChars));
  Object.defineProperty(e, "name", { value: `KinoError_${c}` });
  Object.defineProperty(e, "code", { value: c, enumerable: true });
  // `{ userMessage }`: the plugin's own sentence for the person. Like the app: an own data property
  // (a getter never runs), a string only, cut one character over the limit (then it is not shown).
  let s = null;
  try {
    const d = options !== null && typeof options === "object" ? Object.getOwnPropertyDescriptor(options, "userMessage") : undefined;
    if (d && typeof d.value === "string") s = d.value.slice(0, contract.errors.maxUserMessageChars + 1);
  } catch { s = null; }
  if (s !== null) Object.defineProperty(e, "userMessage", { value: s, enumerable: true });
  return e;
}

// A kino.fetch `host_not_allowed` naming the refused host in `e.host`, like the app (Kino 0.9.55, contract.json
// fetch.errorHostField).
function hostRefused(message, hostname) {
  const e = kinoError("host_not_allowed", message);
  Object.defineProperty(e, contract.fetch.errorHostField, { value: String(hostname).slice(0, contract.fetch.maxErrorHostChars), enumerable: true });
  return e;
}

// The app's PluginErrors.shownSentence / PluginErrorText.reason rule, approximated (the app is
// authoritative; it also hides a sentence that holds one of the person's passwords).
const URL_RE = /\b(?:https?|wss?|ftp):\/\/\S+/i;
const PREFIX_RE = /^(?:Uncaught\b\s*|(?:[A-Za-z_$][\w$.]*)?(?:Error|Exception)\s*:\s*|\[[^\]\n]{0,40}\]\s*)/;
const CODE_CHARS_RE = /[{}()[\]<>=;$_`"|\\/]/;
const CODE_WORDS_RE = /\b(?:undefined|null|NaN|function|prototype|is not defined|unexpected token)\b/;
const PROSE_ASIDE_RE = /(?<=\s)\((?=[^)]*\p{L}{2,})[\p{L}\p{N} ,.¿?¡!'%-]{1,60}\)(?=[\s.,:!?]|$)/gu;

const PUNCTUATION = " .,:;¿?¡!'’‘“”«»()%-–—▸";
const MAX_DIGITS = 6;
// Basic Latin and Latin-1 letters (what Spanish, Portuguese and English write), 0-9, the plain space and PUNCTUATION.
// Latin-1's × ÷ and the letters NFD keeps whole (ø æ ð þ ß) are refused: no Spanish word needs them.
const NOT_LETTERS_HERE = "×÷ØøÆæÐðÞþß";
const allowedChar = (ch) => /[a-zA-Z0-9]/.test(ch) || PUNCTUATION.includes(ch) || (ch >= "À" && ch <= "ÿ" && !NOT_LETTERS_HERE.includes(ch));
const GLUED_DIGIT_RE = /\p{L}[0-9]|[0-9]\p{L}/u;
// What a text spells: lowercase, no accents, a-z only; `one` is what a 1 reads as, 0 reads as o.
const letters = (text, one) => [...text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()]
  .map((c) => (c === "1" ? one : c === "0" ? "o" : c)).filter((c) => c >= "a" && c <= "z").join("");
const kinoSkeleton = (text) => letters([...text].map((c) => ("lL!¡|".includes(c) ? "i" : c)).join(""), "i");
const DOMAIN_RES = [/[\p{L}\p{N}][.]\p{L}/u, /\s[.]/u, /[.]\s+[a-z]{2,6}(?!\p{L})/u];
const LONG_STEMS = ["contrasen", "passw", "passc", "credencial", "daviplata", "whatsapp", "telegram", "transfer", "consign", "tarjeta", "deposit", "verificati"];
const WORD_STEMS = ["abon", "recarg", "clave", "token", "cedula"];
const WORDS = new Set(["pin", "pins", "cvv", "cvc", "otp", "www", "dot", "arroba"]);
const TLDS = "com|net|org|co|app|dev|io|tv|xyz|info|site|online|click|link|lat|mx|ar|cl|pe|us|biz|club|live|shop|store|top|vip|cc|gg|ws|ly";
const SPELLED_DOMAIN_RE = new RegExp(`(?:punto|dot)(?:${TLDS})$`);
// Runs of 3+ one-letter words read as one word ("N e q u i").
const collapseSpelled = (words) => {
  const out = [];
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && words[j].length === 1) j++;
    if (j - i >= 3) { out.push(words.slice(i, j).join("")); i = j; } else { out.push(words[i]); i++; }
  }
  return out;
};
// Runs of 2+ neighbouring words of up to 3 letters, joined from each of their words on ("Ne qui", "pa go").
const shortRuns = (words) => {
  const out = [];
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && words[j].length <= 3) j++;
    for (let k = i; k < j - 1; k++) out.push(words.slice(k, j).join(""));
    i = Math.max(j, i + 1);
  }
  return out;
};
// Spaces kept between ordinary words, a split word read whole; 1 read as i and as l, 0 as o (the app's PluginErrors.asks).
const asks = (s) => ["i", "l"].some((one) => {
  const words = collapseSpelled(s.split(/\s+/).map((w) => letters(w, one)).filter((w) => w));
  const windows = [];
  for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= words.length; i++) windows.push(words.slice(i, i + n).join(""));
  const shorts = [...words, ...shortRuns(words)];
  return LONG_STEMS.some((st) => windows.some((w) => w.includes(st))) || windows.some((w) => SPELLED_DOMAIN_RE.test(w)) ||
    /codigo.*(?:sms|verific|llego)/.test(words.join(" ")) ||
    shorts.some((w) => w.includes("nequi") || WORDS.has(w) || WORD_STEMS.some((st) => w.startsWith(st)) || (w.startsWith("pag") && !w.startsWith("pagin")));
});

/** Whether the app lets [name] introduce a plugin's sentence ("Mensaje de <name>: …"). */
export function safeName(name) {
  return typeof name === "string" && name.length > 0 && name.trim() === name && [...name].every(allowedChar) && !name.includes(":") && !GLUED_DIGIT_RE.test(name) && !kinoSkeleton(name).includes("kino");
}

/** Why the app would NOT show [err]'s userMessage, or null when it would (the app also checks the person's passwords). */
function sentenceRefusal(err) {
  if (!err || typeof err.userMessage !== "string") return "no userMessage";
  if (!contract.errors.codes.includes(err.code)) return `the code ${err.code} is always worded by Kino`;
  const s = err.userMessage.normalize("NFC").trim();
  if (s.length === 0) return "empty";
  if (s.length > contract.errors.maxUserMessageChars) return `longer than ${contract.errors.maxUserMessageChars} characters`;
  if (![...s].every(allowedChar)) return "a character other than Latin-1 letters, 0-9, a plain space and .,:;¿?¡!'’‘“”«»()%-–—▸";
  if (/;(?! )/.test(s)) return "a ; not followed by a space";
  const prose = s.replace(/; /g, ", ");
  if (URL_RE.test(s)) return "a URL";
  if (PREFIX_RE.test(s)) return 'an error prefix ("TypeError:", "[Tag]")';
  if (/[:,;\-–]$/.test(s)) return "it ends in : , ; or -";
  if (CODE_CHARS_RE.test(prose.replace(PROSE_ASIDE_RE, " ")) || CODE_WORDS_RE.test(s)) return "it reads as code";
  if ((s.match(/\p{L}{2,}/gu) || []).length < 2) return "fewer than two words";
  if ((s.match(/[0-9]/g) || []).length >= MAX_DIGITS) return `${MAX_DIGITS} digits or more in all`;
  if (GLUED_DIGIT_RE.test(s)) return "a digit glued to a letter";
  if (DOMAIN_RES.some((re) => re.test(s))) return "a domain (site.app, site .app, site. app)";
  if (kinoSkeleton(s).includes("kino")) return "it spells Kino";
  if (asks(s)) return "it asks for credentials, money or contact outside Kino (or spells a domain)";
  return null;
}

/** The sentence the app shows for [err] in place of its own line for the code, or null (Kino's line stays). */
export function shownSentence(err) {
  return sentenceRefusal(err) === null ? err.userMessage.normalize("NFC").trim() : null;
}

/** How run.mjs reports a typed error: `[code] message`, plus what the person reads ("Mensaje de <plugin>: …") when it carries a userMessage. */
export function errorReport(err, pluginName = "Plugin") {
  const head = `[${err.code}] ${err.message}`;
  // kino.tmdb's no_tmdb_key (Kino 0.9.53): Kino words it itself, the same sentence it put in userMessage.
  if (err.code === contract.kinoTmdb.noKeyCode) return `${head}\n  the person reads: "${contract.kinoTmdb.noKeyUserMessage.es}"`;
  if (typeof err.userMessage !== "string") return head;
  const why = safeName(pluginName) ? sentenceRefusal(err) : `the plugin's name "${pluginName}" can't introduce a sentence (a colon, Kino, a digit glued to a letter, or a character outside the alphabet)`;
  return why === null
    ? `${head}\n  the person reads: "Mensaje de ${pluginName}: ${shownSentence(err)}"`
    : `${head}\n  userMessage is not shown (${why}): the person reads Kino's line for ${err.code}`;
}

export { hostMatches as hostAllowed };
// Which export the kit is running (kit-call.mjs): a test wraps a direct kino.qr.scan in kitCall.run("action", …).
export { kitCall };

// --- kino.crypto key pairs (apiVersion 6), with Node's crypto: the same answers, formats and errors
// as the app's PluginKeys / PluginKeyRing. A private key is a KeyObject kept in this kino's own Map;
// the plugin gets a handle that means nothing to another createKino() (another runtime in the app). ---

const KP = contract.crypto.keyPairs;
const KEY_UNKNOWN = "unknown key: a private key only lives while this plugin is open; generate another one";
const BAD_PUBLIC_KEY = "invalid public key";
const COORD_BYTES = { "P-256": 32, "P-384": 48 };
const SPKI_PREFIX = {
  "P-256": Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"),
  "P-384": Buffer.from("3076301006072a8648ce3d020106052b81040022036200", "hex"),
  ed25519: Buffer.from("302a300506032b6570032100", "hex"),
  x25519: Buffer.from("302a300506032b656e032100", "hex"),
};
const OKP_CRV = { ed25519: "Ed25519", x25519: "X25519" };

function keyPairApi({ pluginSecrets, buf }) {
  const fail = (message) => { throw kinoError("crypto_error", message); };
  const cut = (v) => String(v).slice(0, 20);
  const ring = new Map();
  const isObj = (v) => v !== null && typeof v === "object";
  const optStr = (v) => (v === undefined || v === null ? undefined : String(v));
  const handleOf = (k) => (typeof k === "string" ? k : isObj(k) && typeof k.handle === "string" ? k.handle : undefined);
  const strings = (v, out = []) => {
    if (typeof v === "string") out.push(v);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
    return out;
  };
  // Like the app: no sealed value in any field of these ops.
  const refuseSealed = (o) => {
    if (pluginSecrets && strings(o).some((t) => pluginSecrets.containsMarker(t) || pluginSecrets.containsCipherKeyMarker(t))) fail(SEALED_CRYPTO_REFUSED);
  };
  const keyType = (t) => (KP.types.includes(t) ? t : fail(`unknown key type: ${cut(t ?? "")} (ec, ed25519 or x25519)`));
  const curveOf = (c) => (KP.curves.includes(c) ? c : fail(`unknown curve: ${cut(c ?? "")} (P-256 or P-384)`));
  const outEnc = (e = "base64") => (e === "base64" || e === "hex" ? e : fail("a signature or a secret comes out as base64 or hex"));
  const hashOf = (h = "SHA-256") => (KP.signHashes.includes(h) ? h.replace("-", "").toLowerCase() : fail(`unknown signature hash: ${cut(h)} (SHA-256 or SHA-384)`));
  const formatOf = (f = "der") => (KP.signatureFormats.includes(f) ? f : fail(`unknown signature format: ${cut(f)} (der or ieee-p1363)`));
  const b64 = (v, field) => buf(v, "base64", field);

  // { type, curve, raw } -> a Node public KeyObject (an EC point checked on its curve by Node).
  const nodePublic = ({ type, curve, raw }) => {
    try {
      if (type === "ec") {
        const n = COORD_BYTES[curve];
        if (raw.length !== 1 + 2 * n || raw[0] !== 4) throw new Error();
        return createPublicKey({ key: { kty: "EC", crv: curve, x: raw.subarray(1, 1 + n).toString("base64url"), y: raw.subarray(1 + n).toString("base64url") }, format: "jwk" });
      }
      if (raw.length !== 32) throw new Error();
      return createPublicKey({ key: { kty: "OKP", crv: OKP_CRV[type], x: raw.toString("base64url") }, format: "jwk" });
    } catch {
      return fail(BAD_PUBLIC_KEY);
    }
  };
  const checked = (pub) => { nodePublic(pub); return pub; };
  const fromSpki = (der) => {
    for (const [name, prefix] of Object.entries(SPKI_PREFIX)) {
      if (der.length > prefix.length && der.subarray(0, prefix.length).equals(prefix)) {
        const ec = KP.curves.includes(name);
        return checked({ type: ec ? "ec" : name, curve: ec ? name : undefined, raw: Buffer.from(der.subarray(prefix.length)) });
      }
    }
    return fail("unrecognized spki: only P-256, P-384, Ed25519 or X25519 with a named curve");
  };
  const fromJwk = (j) => {
    const field = (name) => (typeof j[name] === "string" ? b64(j[name], `jwk.${name}`) : fail(`the JWK is missing "${name}"`));
    if (j.kty === "EC") {
      const curve = curveOf(j.crv);
      const x = field("x"), y = field("y");
      if (x.length !== COORD_BYTES[curve] || y.length !== COORD_BYTES[curve]) fail(BAD_PUBLIC_KEY);
      return checked({ type: "ec", curve, raw: Buffer.concat([Buffer.from([4]), x, y]) });
    }
    if (j.kty === "OKP") {
      const type = j.crv === "Ed25519" ? "ed25519" : j.crv === "X25519" ? "x25519" : fail(`unknown JWK curve: ${cut(j.crv ?? "")}`);
      return checked({ type, curve: undefined, raw: field("x") });
    }
    return fail(`unknown JWK kty: ${cut(j.kty ?? "")} (EC or OKP)`);
  };
  const rawOf = (publicKey, type) => {
    const j = publicKey.export({ format: "jwk" });
    return type === "ec" ? Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]) : Buffer.from(j.x, "base64url");
  };
  const publicOut = ({ type, curve, raw }) => {
    const n = COORD_BYTES[curve];
    const jwk = Object.freeze(type === "ec"
      ? { crv: curve, kty: "EC", x: raw.subarray(1, 1 + n).toString("base64url"), y: raw.subarray(1 + n).toString("base64url") }
      : { crv: OKP_CRV[type], kty: "OKP", x: raw.toString("base64url") });
    const spki = Buffer.concat([SPKI_PREFIX[curve || type], raw]).toString("base64");
    return Object.freeze(curve ? { type, namedCurve: curve, jwk, spki, raw: raw.toString("base64") } : { type, jwk, spki, raw: raw.toString("base64") });
  };
  const entryOf = (k) => {
    const h = handleOf(k);
    if (h === undefined) fail('missing "key": the private key from generateKeyPair');
    return ring.get(h) || fail(KEY_UNKNOWN);
  };
  // A public key given as { spki } (what generateKeyPair/importKey answer) or { jwk }; for verify, also a private key.
  const publicOf = (k, allowPrivate) => {
    if (isObj(k) && typeof k.spki === "string") return fromSpki(b64(k.spki, "publicKey"));
    if (isObj(k) && isObj(k.jwk)) return fromJwk(k.jwk);
    if (allowPrivate && handleOf(k) !== undefined) { const e = entryOf(k); return { type: e.type, curve: e.curve, raw: e.raw }; }
    return fail('missing "publicKey": use the one from generateKeyPair or importKey');
  };

  return {
    generateKeyPair(o) {
      const p = isObj(o) ? o : {};
      refuseSealed(p);
      const type = keyType(optStr(p.type));
      const curve = type === "ec" ? curveOf(optStr(p.namedCurve)) : undefined;
      const { privateKey, publicKey } = type === "ec" ? generateKeyPairSync("ec", { namedCurve: curve }) : generateKeyPairSync(type);
      const raw = rawOf(publicKey, type);
      const handle = "kinokey_" + randomBytes(16).toString("hex");
      ring.set(handle, { type, curve, privateKey, raw });
      while (ring.size > KP.maxKeysPerRuntime) ring.delete(ring.keys().next().value);
      const priv = Object.freeze(curve ? { type, namedCurve: curve, handle } : { type, handle });
      return Object.freeze({ privateKey: priv, publicKey: publicOut({ type, curve, raw }) });
    },
    importKey(o) {
      const p = isObj(o) ? o : {};
      refuseSealed(p);
      const format = optStr(p.format);
      if (format === "jwk") {
        if (!isObj(p.key)) fail('importKey with format "jwk" needs key: a JWK object');
        return publicOut(fromJwk(p.key));
      }
      if (format === "spki") return publicOut(fromSpki(b64(optStr(p.key), "key")));
      if (format === "raw") {
        const type = keyType(optStr(p.type));
        const curve = type === "ec" ? curveOf(optStr(p.namedCurve)) : undefined;
        return publicOut(checked({ type, curve, raw: b64(optStr(p.key), "key") }));
      }
      return fail(`unknown key format: ${cut(format ?? "")} (jwk, spki or raw)`);
    },
    sign(o) {
      const p = isObj(o) ? o : {};
      refuseSealed(p);
      const data = buf(p.data === undefined ? undefined : String(p.data), p.encoding || "utf8", "data");
      const e = entryOf(p.key);
      let sig;
      if (e.type === "ec") {
        const hash = hashOf(optStr(p.hash));
        sig = nodeSign(hash, data, { key: e.privateKey, dsaEncoding: formatOf(optStr(p.format)) });
      } else if (e.type === "ed25519") {
        if (p.hash !== undefined && p.hash !== null) fail('ed25519 does not take a hash: remove "hash"');
        sig = nodeSign(null, data, e.privateKey);
      } else {
        fail("an x25519 key doesn't sign: use it with deriveSharedSecret");
      }
      return sig.toString(outEnc(p.outputEncoding));
    },
    verify(o) {
      const p = isObj(o) ? o : {};
      refuseSealed(p);
      const data = buf(p.data === undefined ? undefined : String(p.data), p.encoding || "utf8", "data");
      const sig = buf(optStr(p.signature), p.signatureEncoding || "base64", "signature");
      if (sig.length > KP.maxSignatureBytes) fail(`the signature is over ${KP.maxSignatureBytes} bytes`);
      const pub = publicOf(p.key, true);
      try {
        if (pub.type === "ec") {
          const hash = hashOf(optStr(p.hash));
          const format = formatOf(optStr(p.format));
          if (format === "ieee-p1363" && sig.length !== 2 * COORD_BYTES[pub.curve]) return false;
          return nodeVerify(hash, data, { key: nodePublic(pub), dsaEncoding: format }, sig);
        }
        if (pub.type === "ed25519") {
          if (p.hash !== undefined && p.hash !== null) fail('ed25519 does not take a hash: remove "hash"');
          if (sig.length !== 64) return false;
          return nodeVerify(null, data, nodePublic(pub), sig);
        }
      } catch (err) {
        if (err && String(err.name).startsWith("KinoError")) throw err;
        return false;
      }
      return fail("an x25519 key doesn't verify signatures");
    },
    deriveSharedSecret(o) {
      const p = isObj(o) ? o : {};
      refuseSealed(p);
      const e = entryOf(p.privateKey);
      const peer = publicOf(p.publicKey, false);
      if (peer.type !== e.type || peer.curve !== e.curve) fail("both keys must have the same type and curve");
      if (e.type === "ed25519") fail("an ed25519 key doesn't derive secrets: use x25519 or ec");
      let secret;
      try {
        secret = diffieHellman({ privateKey: e.privateKey, publicKey: nodePublic(peer) });
      } catch (err) {
        if (err && String(err.name).startsWith("KinoError")) throw err;
        fail(BAD_PUBLIC_KEY);
      }
      return secret.toString(outEnc(p.outputEncoding));
    },
  };
}

// --- sealed secrets: the same encodings, marker shape and redaction the app's PluginSecrets uses
// (spec 2026-09-29-plugin-sealed-secrets §5, §6). The kit never opens a seal: it reads the plain
// value straight from .kino-secrets.json, so it can simulate substitution and redaction without
// the app's X25519 native bridge. ---

const SEALED_CRYPTO_REFUSED = "a sealed value can't be used here";

/** RFC 3986 unreserved bytes percent-encoded (UTF-8, uppercase hex): a URL path segment or query value. */
function encodeUrlComponent(value) {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || ch === "-" || ch === "." || ch === "_" || ch === "~") out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * [value] inside a JSON string, without the quotes -- the app's PluginSecrets.jsonEscape: `"` and
 * `\\` escaped, the short escapes for the usual control characters and `\\u00XX` for the rest; `/`
 * too when [slash], and every UTF-16 unit past ASCII as `\\uXXXX` when [nonAscii] (a character past
 * the BMP as its two surrogates). [upper] picks the hex digits' case.
 */
function jsonEscape(value, { slash = false, nonAscii = false, upper = true } = {}) {
  const hex4 = (code) => { const h = code.toString(16).padStart(4, "0"); return "\\u" + (upper ? h.toUpperCase() : h); };
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "/" && slash) out += "\\/";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20 || (nonAscii && code > 0x7f)) out += hex4(code);
    else out += ch;
  }
  return out;
}

/** Inside a JSON string, without the surrounding quotes: what the app substitutes into a JSON body. */
const encodeJsonStringBody = (value) => jsonEscape(value);

/** `java.net.URLEncoder.encode(value, "UTF-8")`: a form's own encoding, "+" for a space. */
function javaFormEncode(value) {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || ch === "-" || ch === "_" || ch === "." || ch === "*") out += ch;
    else if (byte === 0x20) out += "+";
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function encodeSealedValue(value, encoding) {
  if (encoding === "url") return encodeUrlComponent(value);
  if (encoding === "json") return encodeJsonStringBody(value);
  return value;
}

/**
 * Every form [redact] replaces for an opened [plain] value, the same list as the app's
 * PluginSecrets.echoForms: what [substitute] writes (raw, the URL encoding, the JSON encoding), and
 * how a server commonly echoes a value back (URLEncoder's form encoding and its "%20" twin, base64
 * and base64url, with and without padding, and inside a JSON string with `/` as `\\/` and non-ASCII
 * as `\\uXXXX` -- PHP's json_encode, Python's json.dumps -- in either hex case, and each combination).
 */
function echoForms(plain) {
  const bytes = Buffer.from(plain, "utf8");
  const b64 = bytes.toString("base64");
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_");
  const form = javaFormEncode(plain);
  const json = [];
  for (const upper of [true, false]) for (const slash of [false, true]) for (const nonAscii of [false, true]) json.push(jsonEscape(plain, { slash, nonAscii, upper }));
  return new Set([
    plain, encodeUrlComponent(plain), encodeJsonStringBody(plain), ...json,
    form, form.replace(/\+/g, "%20"),
    b64, b64.replace(/=+$/, ""), b64url, b64url.replace(/=+$/, ""),
  ]);
}

/**
 * One runtime's sealed secrets: [manifest.secrets]' names, each given a marker
 * (`__kinoSecret_<name>_<nonce>__`) random per runtime. The kit reads plain values from
 * [secretsFile] (`.kino-secrets.json`, `{ "<name>": "<value>" }`), opening one on its first
 * substitution -- a name declared in the manifest but missing there throws then -- and every one the
 * file has on the first redaction of non-empty text, like the app (a value can come back before
 * this runtime used it: a cookie an earlier one set, a server echo). Null when the manifest
 * declares no secrets, exactly like the app's `pluginSecretsFor`.
 */
function pluginSecretsFor(manifest, secretsFile) {
  const names = Object.keys(manifest.secrets || {});
  if (names.length === 0) return null;
  const nonce = randomBytes(8).toString("hex");
  const markers = Object.fromEntries(names.map((n) => [n, `__kinoSecret_${n}_${nonce}__`]));
  // apiVersion 6 typed cipher keys: from the validated manifest, or the raw { seal, use, encoding } object.
  const keyEncodings = {};
  for (const n of names) {
    const raw = manifest.secrets[n];
    const enc = (manifest.secretKeyEncodings || {})[n] ?? (raw && typeof raw === "object" ? raw.encoding : undefined);
    if (enc) keyEncodings[n] = enc;
  }
  const cipherKeyEncoding = (text) => {
    for (const [n, enc] of Object.entries(keyEncodings)) if (markers[n] === text) return enc;
    return null;
  };
  const containsCipherKeyMarker = (text) => typeof text === "string" && Object.keys(keyEncodings).some((n) => text.includes(markers[n]));
  /** The app's PluginSecrets.keyEchoForms: a typed key's bytes as hex (either case) and base64/base64url, padded or not. */
  const formsOf = (name, plain) => {
    const forms = echoForms(plain);
    const enc = keyEncodings[name];
    const bytes = enc ? decodeCipherKey(plain, enc) : null;
    if (bytes) {
      const hex = bytes.toString("hex"), b64 = bytes.toString("base64"), url = b64.replace(/\+/g, "-").replace(/\//g, "_");
      for (const f of [hex, hex.toUpperCase(), b64, b64.replace(/=+$/, ""), url, url.replace(/=+$/, "")]) forms.add(f);
      bytes.fill(0);
    }
    return forms;
  };
  const values = loadJson(secretsFile, {});
  const opened = {};
  const marker = (name) => markers[name];
  const containsMarker = (text) => typeof text === "string" && Object.values(markers).some((m) => text.includes(m));
  const isMarker = (text) => typeof text === "string" && Object.values(markers).includes(text);
  function plainOf(name) {
    if (!(name in opened)) {
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error(`the value of the secret ${name} is missing from .kino-secrets.json`);
      }
      opened[name] = String(values[name]);
    }
    return opened[name];
  }
  /** Every declared value .kino-secrets.json has, opened once: what the app's openAll does before redacting. */
  let allOpened = false;
  function openAll() {
    if (allOpened) return;
    for (const name of names) if (!(name in opened) && Object.prototype.hasOwnProperty.call(values, name)) opened[name] = String(values[name]);
    allOpened = true;
  }
  function substitute(text, encoding = "raw") {
    let out = text;
    for (const [name, m] of Object.entries(markers)) if (out.includes(m)) out = out.split(m).join(encodeSealedValue(plainOf(name), encoding));
    return out;
  }
  /**
   * Every opened value, in every form, replaced by [placeholderFor](name), in ONE left-to-right pass
   * over [text]: the leftmost occurrence of any form is replaced, the longest form when several start
   * at that same position, and the scan continues past it -- like the app's
   * PluginSecrets.Redaction.replaceIn. A short value that happens to be a substring of another form,
   * or of a placeholder just inserted, is never matched a second time once the pass is past it: doing
   * one full pass per form (mutating the text before the next, shorter form's pass ran over it) could
   * match a short secret's value INSIDE a placeholder an earlier, longer pass had just written. Plain
   * substring search (`indexOf`), never a regex: the caps (16 secrets, 4096 bytes each, ~20 forms)
   * can build a combined alternation past V8's regex size limit -- measured, not hypothetical.
   * [text] unchanged when nothing opened is found in it.
   */
  function redactWith(text, placeholderFor) {
    if (typeof text !== "string" || text === "") return text;
    openAll();
    const forms = [];
    for (const [name, plain] of Object.entries(opened)) {
      if (!plain) continue;
      const placeholder = placeholderFor(name);
      for (const f of formsOf(name, plain)) if (f) forms.push([f, placeholder]);
    }
    if (forms.length === 0) return text;
    forms.sort((a, b) => b[0].length - a[0].length); // longest first: on a position tie the longest form wins.
    const next = forms.map(([f]) => text.indexOf(f));
    let out = "";
    let cursor = 0;
    for (;;) {
      let best = -1;
      for (let i = 0; i < forms.length; i++) if (next[i] >= 0 && (best < 0 || next[i] < next[best])) best = i;
      if (best < 0) break;
      const [form, placeholder] = forms[best];
      out += text.slice(cursor, next[best]) + placeholder;
      cursor = next[best] + form.length;
      // Every form's occurrence the replacement covered (including the one just used) moves past it.
      for (let i = 0; i < forms.length; i++) if (next[i] >= 0 && next[i] < cursor) next[i] = text.indexOf(forms[i][0], cursor);
    }
    return out + text.slice(cursor);
  }
  const redact = (text) => redactWith(text, (name) => markers[name]);
  /** True when [text] holds a declared value in any form [redact] replaces. */
  function containsValue(text) {
    if (typeof text !== "string" || text === "") return false;
    openAll();
    return Object.entries(opened).some(([name, plain]) => plain && [...formsOf(name, plain)].some((f) => text.includes(f)));
  }
  // A stable, nonce-free placeholder for [record]/[replay]'s tape (spec §6): the marker itself is
  // random per runtime, so a tape keyed or written with it could never match a later run (a fresh
  // `--replay` process gets a different nonce than the `--record` one that made the tape) -- and a
  // record-time nonce baked into a committed fixtures.json would be a small, pointless leak of its
  // own. Keyed by name only, so two runtimes that open the same secret from the same
  // .kino-secrets.json always agree on it. A real NUL byte can't come from a marker or an opened
  // value's own forms, and no plugin or server text this kit handles has a legitimate reason to hold
  // one -- but a HAND-EDITED tape file's `\u0000` JSON escape decodes to one, so this is a
  // replay-only, self-inflicted collision risk, not a guarantee against arbitrary input.
  const canonicalToken = (name) => `\u0000kino-secret:${name}\u0000`;
  const redactToCanonical = (text) => redactWith(text, canonicalToken);
  /** The reverse of [redactToCanonical]'s placeholder: THIS runtime's own marker, for a taped answer read back on replay. */
  function fromCanonical(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const name of names) {
      const token = canonicalToken(name);
      if (out.includes(token)) out = out.split(token).join(markers[name]);
    }
    return out;
  }
  return { marker, containsMarker, isMarker, cipherKeyEncoding, containsCipherKeyMarker, substitute, redact, containsValue, redactToCanonical, fromCanonical, sealedHosts: manifest.hosts || [] };
}

const loadJson = (file, fallback) => (file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const saveJson = (file, value) => {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1));
};

// ---------- kino.meta and kino.tmdb (Kino 0.9.53, no new apiVersion: feature-detect them) ----------

/**
 * A per-plugin token bucket, the app's rule for kino.meta (contract.kinoMeta.perMinute per minute) and kino.tmdb
 * (contract.kinoTmdb.perWindow per windowMs): [capacity] calls at once, refilled evenly over [windowMs]. [now] is the clock
 * (a test moves it).
 */
export function tokenBucket(capacity, windowMs, now = Date.now) {
  let tokens = capacity;
  let at = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - at) * capacity) / windowMs);
      at = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

// A plugin runs in its own vm realm, so its Uint8Array is not `instanceof` this realm's; the app (one realm) accepts exactly Uint8Array.
const isUint8Array = (v) => ArrayBuffer.isView(v) && Object.prototype.toString.call(v) === "[object Uint8Array]";
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------- Task 8j: the player gate's limits (PanelPlayerGate, contract.kinoPlayerControl) ----------

/**
 * One plugin's player gate as the app keeps it (PanelPlayerGate): a pause never while [casting]() (the phone's player held for a
 * cast) and never when it asks for the state the video is already in ([paused]); one seek or pause per minIntervalMs; and for
 * a controlled action (kept only thanks to playerControl): nothing while [held]() (Kino not in front, a Kino dialog, the person
 * seeking), only pause on live, at most perMinute in windowMs, and at most one action of any field per minIntervalMs.
 * `check(action, { live, controlled, paused }, log)` answers what is left of [action] (seekToMs, pause and the other fields as
 * given; the duration clamp is gatePlayer's) or null. [now] is the clock.
 */
export function playerControlGate({ now = Date.now, held = () => false, casting = () => false } = {}) {
  const P = contract.kinoPlayerControl;
  let lastAt = null;
  const times = [];
  return {
    check(action, { live = false, controlled = false, paused = false } = {}, log = () => {}) {
      if (controlled && held()) { log("panel: player action while Kino is not in front, a Kino dialog is open or the person is seeking, dropped"); return null; }
      let b = { ...action };
      if (b.pause !== undefined && casting()) { log("panel: player.pause while casting, dropped (the phone's player is held for the TV)"); delete b.pause; }
      if (b.pause !== undefined && b.pause === paused) { log("panel: player.pause changes nothing (the video is already so), dropped"); delete b.pause; }
      if (controlled && live && Object.keys(b).some((k) => k !== "pause")) {
        log("panel: on a live stream a controlled player action only pauses or resumes, the rest dropped");
        b = b.pause !== undefined ? { pause: b.pause } : {};
      }
      if (!Object.keys(b).length) return null;
      const t = now();
      const recent = lastAt !== null && t - lastAt < P.minIntervalMs;
      if (controlled) {
        while (times.length && t - times[0] >= P.windowMs) times.shift();
        if (times.length >= P.perMinute) { log(`panel: more than ${P.perMinute} controlled player actions a minute, dropped`); return null; }
        if (recent) { log("panel: a controlled player action more than once per second, dropped"); return null; }
      }
      if (b.seekToMs !== undefined && recent) { log("panel: player.seekToMs more than once per second, dropped"); delete b.seekToMs; }
      if (b.pause !== undefined && recent) { log("panel: player.pause more than once per second, dropped"); delete b.pause; }
      if (controlled || b.seekToMs !== undefined || b.pause !== undefined) lastAt = t;
      if (!Object.keys(b).length) return null;
      if (controlled) times.push(t);
      return b;
    },
  };
}

/** Kino 0.9.55's title normalisation (KinoMetaTitleMatch.normalise): lowercase, no accents, punctuation and spaces as one space. */
export function normaliseMetaTitle(title) {
  return String(title).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Kino 0.9.55's pick among TMDB search hits (`[{ id, type: "movie"|"tv", title, originalTitle, year }]`) for
 * kino.meta({ type, title, year? }), as the app's KinoMetaTitleMatch.pick: the hits of [tmdbType] whose es-MX or original
 * title equals [title] once normalised; with a [year], that exact year wins, else one within yearSlack; a tie or nothing is
 * null. The kit has no TMDB search of Kino's own: use it to check what Kino would pick from hits you fetched yourself.
 */
export function pickMetaTitle(hits, tmdbType, title, year = 0) {
  const want = normaliseMetaTitle(title);
  if (!want) return null;
  const seen = new Set();
  const same = [];
  for (const h of hits || []) {
    if (!h || h.type !== tmdbType || !(h.id > 0) || seen.has(h.id)) continue;
    if (normaliseMetaTitle(h.title || "") !== want && normaliseMetaTitle(h.originalTitle || "") !== want) continue;
    seen.add(h.id);
    same.push(h);
  }
  if (!(year > 0)) return same.length === 1 ? same[0].id : null;
  const dated = same.map((h) => [h, parseInt(String(h.year || "").slice(0, 4), 10) || 0]).filter(([, y]) => y > 0);
  const exact = dated.filter(([, y]) => y === year);
  if (exact.length) return exact.length === 1 ? exact[0][0].id : null;
  const near = dated.filter(([, y]) => Math.abs(y - year) <= contract.kinoMeta.byTitle.yearSlack);
  return near.length === 1 ? near[0][0].id : null;
}

/**
 * kino.meta's query as the app checks it, or a thrown `invalid_request`: `{ type, ids: { imdb?, tmdb?, tvdb?, kitsu?, mal?,
 * anilist? }, lang? }`, at least one id. Answers the normalized query (numeric ids as numbers). Kino 0.9.55
 * (contract.kinoMeta.byTitle): `{ type, title, year?, lang? }` instead of ids; with ids too, the ids win (title and year
 * still checked, then dropped).
 */
export function kinoMetaRequest(query, apiVersion = contract.apiVersion) {
  const M = contract.kinoMeta;
  const B = M.byTitle;
  // Below apiVersion 9 the prelude drops title and year (unknown keys): the query then needs ids, as in the app.
  if (plainObject(query) && apiVersion < B.apiVersion && (query.title !== undefined || query.year !== undefined)) {
    const { title, year, ...rest } = query;
    query = rest;
  }
  const bad = (why) => kinoError("invalid_request", "kino.meta: " + why);
  if (!plainObject(query)) throw bad("needs { type, ids } or { type, title }");
  let text;
  try { text = JSON.stringify(query); } catch { throw bad("the query can't be turned into JSON"); }
  if (text === undefined || text.length > M.maxRequestChars) throw bad(`the query is over ${M.maxRequestChars} characters`);
  if (!M.types.includes(query.type)) throw bad(`type must be ${M.types.map((t) => `"${t}"`).join(" or ")}`);
  let title = "";
  if (query.title !== undefined && query.title !== null) {
    title = typeof query.title === "string" ? query.title.trim() : "";
    if (!title || title.length > B.titleMaxChars) throw bad(`title must be a text of 1 to ${B.titleMaxChars} characters`);
  }
  let year = 0;
  if (query.year !== undefined && query.year !== null) {
    year = typeof query.year === "number" ? query.year : typeof query.year === "string" && /^\d{4}$/.test(query.year.trim()) ? Number(query.year.trim()) : NaN;
    if (!Number.isInteger(year) || year < B.minYear || year > B.maxYear) throw bad(`year must be a whole number from ${B.minYear} to ${B.maxYear}`);
    if (!title) throw bad("year goes with title");
  }
  if ((query.ids === undefined || query.ids === null) && title) return { type: query.type, title, ...(year ? { year } : {}), ...langOf(query, bad) };
  if (!plainObject(query.ids)) throw bad("ids must be an object");
  const ids = {};
  for (const key of M.idKeys) {
    const v = query.ids[key];
    if (v === undefined || v === null) continue;
    if (key === "imdb") {
      if (typeof v !== "string" || !new RegExp(contract.output.imdbPattern).test(v)) throw bad("ids.imdb must look like tt0133093");
      ids.imdb = v;
      continue;
    }
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > M.maxNumericId) throw bad(`ids.${key} must be a whole number from 1 to ${M.maxNumericId}`);
    ids[key] = n;
  }
  if (!Object.keys(ids).length) {
    if (title) return { type: query.type, title, ...(year ? { year } : {}), ...langOf(query, bad) };
    throw bad("needs at least one id (" + M.idKeys.join(", ") + ") or a title");
  }
  return { type: query.type, ids, ...langOf(query, bad) };
}

function langOf(query, bad) {
  if (query.lang === undefined || query.lang === null) return {};
  if (typeof query.lang !== "string" || !new RegExp(contract.kinoMeta.langPattern).test(query.lang)) throw bad('lang must be a language code like "es" or "es-MX"');
  return { lang: query.lang };
}

/**
 * kino.tmdb's request as the app checks it, or a thrown `invalid_request`: an allowlisted path (no "/3", no query string,
 * no "..", no "//") and plain params. Answers `{ path, query }`, `query` the params sorted by name and URL-encoded: what
 * the app's cache is keyed by (with the path).
 */
export function kinoTmdbRequest(path, params) {
  const T = contract.kinoTmdb;
  const bad = (why) => kinoError("invalid_request", "kino.tmdb: " + why);
  if (typeof path !== "string" || !new RegExp(T.pathPattern).test(path) || path.includes("..") || path.includes("//")) {
    throw bad('path must be a TMDB path like "/movie/603", without "/3", "?" or ".."');
  }
  if (!T.pathPrefixes.some((p) => path === p || path.startsWith(p + "/"))) throw bad("that path is not allowed (only " + T.pathPrefixes.join(", ") + ")");
  if (params !== undefined && params !== null && !plainObject(params)) throw bad("params must be an object");
  const keys = Object.keys(params || {});
  if (keys.length > T.maxParams) throw bad(`at most ${T.maxParams} parameters`);
  const pairs = [];
  for (const k of keys) {
    if (!new RegExp(T.paramKeyPattern).test(k)) throw bad("invalid parameter name: " + k.slice(0, 40));
    if (T.forbiddenParams.includes(k.toLowerCase())) throw bad(`parameter ${k} is not allowed: Kino adds the key`);
    const v = params[k];
    if (!(typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))) throw bad(`parameter ${k} must be a string, number or boolean`);
    const s = String(v);
    if (s.length > T.maxParamValueChars) throw bad(`parameter ${k} is over ${T.maxParamValueChars} characters`);
    pairs.push([k, s]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { path, query: pairs.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&") };
}

/** The `no_tmdb_key` error, with the app's sentence for the person in [lang] (Spanish for "es…", else English). */
export function noTmdbKeyError(lang, message = "no TMDB key: neither Kino's nor the person's") {
  const words = contract.kinoTmdb.noKeyUserMessage;
  return kinoError(contract.kinoTmdb.noKeyCode, message, { userMessage: String(lang || "").toLowerCase().startsWith("es") ? words.es : words.en });
}

const readJsonFile = (file, what) => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${what}: ${file} could not be read as JSON (${e.message})`); }
};

/**
 * The kit's TMDB key, standing in for Kino's own: [explicit], else KINO_TMDB_KEY, else `tmdbKey` in sdk/config.json (next
 * to this file, or ./sdk/config.json from where you run). Null when none. Never printed.
 */
export function kitTmdbKey(explicit, env = process.env) {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (env.KINO_TMDB_KEY && env.KINO_TMDB_KEY.trim()) return env.KINO_TMDB_KEY.trim();
  for (const file of [join(SDK_DIR, "config.json"), join(process.cwd(), "sdk", "config.json")]) {
    if (!existsSync(file)) continue;
    try {
      const k = JSON.parse(readFileSync(file, "utf8")).tmdbKey;
      if (typeof k === "string" && k.trim()) return k.trim();
    } catch { /* a broken config.json is reported by run.mjs itself */ }
  }
  return null;
}

/** kino.device for [createKino]: the [device] option, else env KINO_DEVICE, else contract.kinoDevice.default. */
function deviceFor(device, env) {
  const D = contract.kinoDevice;
  const allowed = D.values.map((v) => `"${v}"`).join(" or ");
  if (device !== undefined && device !== null) {
    if (!D.values.includes(device)) throw new Error(`device must be ${allowed} (got ${JSON.stringify(device)})`);
    return device;
  }
  const fromEnv = env && env[D.kitEnv];
  if (fromEnv === undefined || fromEnv === "") return D.default;
  if (!D.values.includes(fromEnv)) throw new Error(`${D.kitEnv} must be ${allowed} (got ${JSON.stringify(fromEnv)})`);
  return fromEnv;
}

/**
 * [config]: the setting values (`--config key=value` / sdk/config.json); defaults from the
 * manifest are applied here like the app does. [record]/[replay]: a JSON file of kino.fetch
 * exchanges, so a test can run offline and give the same answers every time. [fetchImpl]: the
 * network itself (tests point it at a local server).
 *
 * kino.nuvio (Kino 0.9.71, apiVersion 11): [nuvioFixture] (an object, or a file path; default env KINO_NUVIO_FIXTURE) stands in for the
 * Nuvio repositories the manifest names: `{ "owner/repo": { available: [{ id, name, description?, types?, languages?, compatible? }],
 * streams: { "<scraper id>": { "movie:603": { url, mime?, headers?, label?, subtitles?, alternatives? }, "series:1399:1:1": {...},
 * "series:1399": {...}, "movie:1": { error: { code, message } }, "movie:2": { url, delayMs: 90000 } } } } }`. Without it, kino.nuvio throws
 * `unavailable`: the kit has no scrapers of its own.
 * kino.meta / kino.tmdb (Kino 0.9.53): [metaFixture] (an object, or a file path; default env KINO_META_FIXTURE) answers
 * kino.meta offline -- keys `"<type>:<idKey>:<value>"` or `"<idKey>:<value>"` (`"movie:imdb:tt0133093"`, `"tmdb:603"`), and
 * for a lookup by title (Kino 0.9.55) `"<type>:title:<normalised title>:<year>"` or without the year (`"movie:title:the matrix:1999"`) --
 * and without it kino.meta answers null (the kit has no TMDB/AniList of Kino's own and no other plugins). [tmdbKey]
 * (default [kitTmdbKey]) stands in for Kino's own TMDB key; [tmdbFixture] (an object or a file; default env KINO_TMDB_FIXTURE)
 * answers kino.tmdb offline, keyed `"<path>?<sorted query>"` or `"<path>"`, standing in for TMDB and a configured key.
 * [now] is the clock of their rate limits and cache.
 *
 * kino.library (apiVersion 14, capability "library", contract.kinoLibrary): [libraryFixture] (an object, or a file path; default env
 * KINO_LIBRARY_FIXTURE) stands in for what the person watched and saved: `{ "watched": [{ title, year?, kind, ids?, progress?,
 * watchedAtMs, adult? }], "saved": [{ title, year?, kind, ids?, savedAtMs?, adult? }] }`. The kit applies the app's rules to it: a
 * manifest without the capability, a [libraryRevoked] kit (or KINO_LIBRARY_REVOKED=1: the person switched it off) or a sync call
 * gets permission_denied; a wrong option bad_request; past contract.kinoLibrary.perMinute calls rate_limited; an `adult` entry is
 * never given; the newest first, at most `limit`, `watchedAtMs` rounded down to the day; only the contract's fields. Without a
 * fixture both functions answer [] (the kit has no library of its own). [callFunction]: the export run.mjs/validate.mjs runs; one
 * outside contract.kinoLibrary.fromFunctions (resolve, episodes, sign...) gets permission_denied, as in the app.
 *
 * kino.room (apiVersion 14, capability "room", contract.kinoRoom): [room] (default a fresh [createKitRoom]) is an in-memory room
 * with two simulated members standing in for the Internet; the kit applies the app's rules (PluginRooms): the capability,
 * [roomRevoked] (or KINO_ROOM_REVOKED=1), open/join only from contract.kinoRoom.openFrom, traffic from trafficFrom, never a sync
 * call, the payload, rate, member and session limits, and the error codes.
 *
 * kino.ai (apiVersion 14, capability "ai", contract.kinoAi): [ai] is the fake text AI (`async ({ system, prompt, json, maxChars })
 * => string | { text, model? } | { error } | null`); without it env KINO_AI_ERROR / KINO_AI_REPLY, else a canned sentence ("{}" for
 * json). [aiRevoked] (or KINO_AI_REVOKED=1) refuses every ask. The app's gates apply ([kitAiApi]): the origin, the request,
 * one in flight, perMinute, perDay, timeoutMs; an ask never throws.
 *
 * kino.device (Kino 0.9.55, contract.kinoDevice): [device] ("phone" or "tv", run.mjs --device), else env KINO_DEVICE,
 * else "phone". Anything else throws: a typo must not silently test the other UI.
 */
export function createKino(manifest, { appVersion = "sdk", lang = "es-CO", device = undefined, storageFile = null, cookiesFile = null, secretsFile = null, config = {}, record = null, replay = null, fetchImpl = globalThis.fetch, metaFixture = undefined, tmdbKey = undefined, tmdbFixture = undefined, nuvioFixture = undefined, libraryFixture = undefined, libraryRevoked = false, callFunction = null, env = process.env, now = Date.now, syncCall = false, qrScan = undefined, room = undefined, roomRevoked = false, ai = undefined, aiRevoked = false, shared = undefined } = {}) {
  const f = contract.fetch;
  // [syncCall]: this kino runs a syncProvider's syncPull/syncPush (contract.fetch.syncCall): its requests and responses may
  // carry the declared blob, ceil(sync.maxBlobBytes * 4/3) + envelopeChars, like the app; every other call keeps the defaults.
  const syncCap = syncCall ? syncCallCap(manifest) : null;
  const maxRequestChars = syncCap ?? f.maxRequestChars;
  const maxBodyBytes = syncCap ?? f.maxBodyBytes;
  const kinoDevice = deviceFor(device, env);
  const storage = loadJson(storageFile, {});
  // apiVersion 13, capability "storageLarge": contract.storage.largeMaxTotalBytes / largeMaxValueBytes / largeMaxKeys / largeMaxKeyChars instead of maxTotalBytes.
  const storageLarge = () => Array.isArray(manifest?.capabilities) && manifest.capabilities.includes("storageLarge");
  // An entry is a bare string (permanent, the format before ttlMs existed) or { v, e } (expires at
  // epoch ms `e`). Dropped lazily, on the next read or write that touches this instance -- never a
  // background timer -- so it stops counting against the cap the moment it is noticed.
  const storageEntryValue = (raw) => (raw !== null && typeof raw === "object" ? raw.v : raw);
  const purgeExpiredStorage = () => {
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(storage)) {
      const raw = storage[k];
      if (raw !== null && typeof raw === "object" && typeof raw.e === "number" && raw.e <= now) { delete storage[k]; changed = true; }
    }
    if (changed) saveJson(storageFile, storage);
  };
  const cookieJar = loadJson(cookiesFile, []);
  const tape = replay ? loadJson(replay, null) : record ? [] : null;
  if (replay && !tape) throw new Error(`--replay: ${replay} not found`);
  let requests = 0;
  // fetchHosts "any": the budget of hosts reached only through it (contract.fetch.anyHost), per site and per plugin.
  const anyBudget = anyHostBudget(now);

  // A plugin whose manifest declares secrets: markers, substitution, the declared-host-and-https
  // rule (checkSealedHost below) and redaction, all simulated without opening the seal.
  const pluginSecrets = pluginSecretsFor(manifest, secretsFile);
  const redact = (text) => (pluginSecrets ? pluginSecrets.redact(text) : text);
  // kino.log(...) and, apiVersion 6, kino.log.report(...): in the app a report also reaches the error tracker when the
  // manifest says "telemetry": true or "verbose" (always for now; later unless the person turns it off; once an hour per area); here both go to stderr.
  const logLine = (tag, args) => writeErr(tag, ...args.map((a) => (typeof a === "string" ? redact(a) : a)));
  const kinoLog = Object.assign((...args) => logLine("[kino.log]", args), {
    report: (...args) => logLine(manifest && manifest.telemetry ? "[kino.log.report]" : "[kino.log.report: no \"telemetry\", log only]", args),
  });
  // kino.seed(session) (Kino 0.9.55, contract.kinoSeed): the kit sends nothing anywhere. It applies the app's own filter and says
  // which keys Kino would keep (never the values: they are tokens), and, like kino.log.report, that the app sends only with
  // "telemetry" on. Synchronous, answers nothing, never throws into the plugin.
  // kino.sync.remoteChanged() (Kino 0.9.74, contract.additiveFromApp["kino.sync.remoteChanged"]): a realtime syncProvider tells Kino its
  // remote changed. The kit has no app to tell: it checks the manifest the way Kino does and logs.
  let remoteChangedLogged = false;
  const kinoSync = Object.freeze({
    remoteChanged: Object.freeze(function remoteChanged() {
      const ok = manifest && Array.isArray(manifest.capabilities) && manifest.capabilities.includes("syncProvider") && manifest.sync && manifest.sync.mode === "realtime";
      if (!ok) throw Object.assign(new Error('kino.sync.remoteChanged() needs the "syncProvider" capability with "sync": { "mode": "realtime" }'), { code: "not_allowed" });
      if (!remoteChangedLogged) { remoteChangedLogged = true; logLine("[kino.sync.remoteChanged]", ["Kino would pull now (it accepts one signal every 30 s; this line is logged once)"]); }
    }),
  });
  const kinoSeed = Object.freeze(function seed(session) {
    try {
      const S = contract.kinoSeed;
      if (session === null || typeof session !== "object" || Array.isArray(session)) return;
      const json = JSON.stringify(session);
      if (typeof json !== "string" || json.length > S.maxInputChars) return;
      const kept = {};
      for (const key of S.allowed) {
        const v = session[key];
        if ((typeof v === "string" && v.length > 0 && v.length <= S.maxValueChars) || (typeof v === "number" && Number.isFinite(v))) kept[key] = v;
      }
      const missing = S.required.filter((key) => kept[key] === undefined || String(kept[key]).trim() === "");
      const tag = manifest && manifest.telemetry ? "[kino.seed]" : "[kino.seed: no \"telemetry\", nothing would be sent]";
      if (missing.length > 0) return logLine(tag, [`dropped: ${missing.join(", ")} missing or blank`]);
      if (JSON.stringify(kept).length > S.maxTotalChars) return logLine(tag, [`dropped: over ${S.maxTotalChars} characters once cleaned`]);
      logLine(tag, [`Kino would keep: ${Object.keys(kept).join(", ")}`]);
    } catch { /* a contribution never fails the plugin */ }
  });

  const values = {};
  // A url setting never takes a manifest default (the app refuses one): only a typed server counts.
  const defaultOf = (s) => (s.default !== undefined && contract.settings.types[s.type]?.canHaveDefault !== false ? s.default : s.type === "toggle" ? false : s.type === "select" ? s.options[0].value : undefined);
  for (const s of manifest.settings || []) {
    if (contract.settings.types[s.type]?.hasValue === false) continue; // section/status/action hold no value
    const v = config[s.key] !== undefined ? config[s.key] : defaultOf(s);
    if (s.type === "list") {
      // Entries with only their own fields, trimmed, all-blank ones dropped (what the app stores).
      const entries = (Array.isArray(v) ? v : []).map((e) => Object.fromEntries((s.fields || []).map((f) => [f.key, String(e?.[f.key] ?? "").trim()]))).filter((e) => Object.values(e).some(Boolean));
      if (entries.length) values[s.key] = entries;
    } else if (v !== undefined && v !== "") values[s.key] = s.type === "toggle" ? v === true || v === "true" : String(v);
  }
  const typedUrls = (manifest.settings || []).flatMap((s) => s.type === "url" ? [values[s.key]] : s.type === "list" ? (values[s.key] || []).flatMap((e) => (s.fields || []).filter((f) => f.type === "url").map((f) => e[f.key])) : []);
  const servers = typedUrls.filter((u) => typeof u === "string" && isUserServer(u)).map((u) => new URL(u.trim()));
  const port = (u) => u.port || (u.protocol === "https:" ? "443" : "80");
  const serverOf = (u) => servers.find((s) => s.protocol === u.protocol && s.hostname === u.hostname && port(s) === port(u));

  // fetchHosts "any" at apiVersion 9 (Kino 0.9.55): what the app does once the person approved its red line.
  const anyHost = fetchAnyHost(manifest);
  function gate(u, from) {
    const typed = serverOf(u);
    if (typed) {
      if (from && serverOf(from) && serverOf(from) !== typed) throw hostRefused("host not allowed: " + u.hostname, u.hostname);
      return;
    }
    // PluginHostGate: http or https to a public name or public IPv4 address; a typed server's name on another port or
    // scheme keeps the strict rules. (A public name that resolves into the home network is refused by the app's DNS
    // check, which the kit does not simulate.)
    // Through the grant (a host neither declared nor typed): https on port 443 to a public IPv4 literal or a DOTTED
    // public name, like PluginHostGate.anyFetchRefusal. A declared host keeps the rules below (insecureHttp included).
    if (anyHost && !servers.some((s) => s.hostname === u.hostname) && !hostMatches(u.hostname, manifest.hosts)) {
      const why = anyFetchRefusal(u);
      if (why) throw hostRefused(why, u.hostname);
      return;
    }
    if (!hostMatches(u.hostname, manifest.hosts)) throw hostRefused("host not allowed: " + u.hostname, u.hostname);
    if (!schemeAllowed(u, manifest)) throw hostRefused("only https is allowed", u.hostname);
  }

  // --- cookies: enough of RFC 6265 for logins (Domain, Path, Expires, Max-Age, Secure) ---
  const dropExpired = () => { const now = Date.now(); for (let i = cookieJar.length - 1; i >= 0; i--) if (cookieJar[i].expires <= now) cookieJar.splice(i, 1); };
  const cookieMatches = (c, u) => {
    const h = u.hostname;
    const domainOk = c.hostOnly ? h === c.domain : h === c.domain || h.endsWith("." + c.domain);
    const pathOk = u.pathname === c.path || u.pathname.startsWith(c.path.endsWith("/") ? c.path : c.path + "/");
    return domainOk && pathOk && (!c.secure || u.protocol === "https:");
  };
  function storeCookies(u, headers) {
    const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of list) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const c = { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: u.hostname, hostOnly: true, path: "/", secure: false, expires: Number.MAX_SAFE_INTEGER };
      const dir = u.pathname.lastIndexOf("/");
      c.path = dir > 0 ? u.pathname.slice(0, dir) : "/";
      for (const a of attrs) {
        const [k, v = ""] = a.split("=");
        const key = k.toLowerCase();
        if (key === "domain" && v) {
          const d = v.replace(/^\./, "").toLowerCase();
          if (u.hostname !== d && !u.hostname.endsWith("." + d)) { c.domain = null; break; }
          c.domain = d; c.hostOnly = false;
        } else if (key === "path" && v.startsWith("/")) c.path = v;
        else if (key === "secure") c.secure = true;
        else if (key === "max-age") c.expires = Date.now() + Number(v) * 1000;
        else if (key === "expires" && c.expires === Number.MAX_SAFE_INTEGER) c.expires = Date.parse(v) || c.expires;
      }
      if (!c.domain) continue;
      const i = cookieJar.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path);
      if (i !== -1) cookieJar.splice(i, 1);
      if (c.expires > Date.now()) cookieJar.push(c);
    }
    const perDomain = {};
    for (let i = cookieJar.length - 1; i >= 0; i--) {
      perDomain[cookieJar[i].domain] = (perDomain[cookieJar[i].domain] || 0) + 1;
      if (perDomain[cookieJar[i].domain] > contract.cookies.maxPerHost) cookieJar.splice(i, 1);
    }
    const size = () => cookieJar.reduce((n, c) => n + c.name.length + c.value.length + c.domain.length + c.path.length, 0);
    while (cookieJar.length && size() > contract.cookies.maxTotalBytes) cookieJar.shift();
    saveJson(cookiesFile, cookieJar);
  }
  const cookieHeader = (u) => { dropExpired(); return cookieJar.filter((c) => cookieMatches(c, u)).map((c) => `${c.name}=${c.value}`).join("; "); };

  function requestBody(body, headers) {
    const setType = (t) => { if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = t; };
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return body;
    if (typeof body !== "object") return String(body);
    if ("json" in body) { setType("application/json; charset=utf-8"); return JSON.stringify(body.json) ?? "null"; }
    if ("form" in body) {
      if (body.form === null || typeof body.form !== "object") throw kinoError("invalid_request", "body.form must be an object");
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      // OkHttp's FormBody encoding: spaces as %20, not "+".
      return Object.keys(body.form).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(body.form[k]))).join("&");
    }
    if ("base64" in body) return Buffer.from(String(body.base64), "base64");
    throw kinoError("invalid_request", "body must be a string, { json }, { form } or { base64 }");
  }

  /** PluginSecrets.cutUtf8: [text]'s longest prefix of at most [max] UTF-8 bytes, never splitting a character. */
  const cutUtf8 = (text, max) => {
    let bytes = 0;
    let out = "";
    for (const ch of text) {
      const n = Buffer.byteLength(ch, "utf8");
      if (bytes + n > max) break;
      bytes += n;
      out += ch;
    }
    return out;
  };

  /** PluginHttp.asciiCompatible: a body whose ASCII bytes are always those characters (no charset: UTF-8). */
  const asciiCompatible = (type) => {
    const cs = ((/charset=([^;]+)/i.exec(type || "") || [])[1] || "utf-8").trim().toLowerCase();
    return /^(utf-?8|us-ascii|ascii|iso-?8859-\d+|latin-?1|windows-125\d)$/.test(cs);
  };
  /** PluginHttp.asciiIndexOfIgnoreCase over a Buffer: [needle] holds lowercase ASCII bytes. */
  const asciiIndexOfIgnoreCase = (data, needle, from) => {
    for (let i = Math.max(0, from); i + needle.length <= data.length; i++) {
      let j = 0;
      for (; j < needle.length; j++) {
        let b = data[i + j];
        if (b >= 65 && b <= 90) b += 32;
        if (b !== needle[j]) break;
      }
      if (j === needle.length) return i;
    }
    return -1;
  };
  /** PluginHttp.cutAtMarker: [text] up to and including the first ASCII case-insensitive [marker], else all of it. */
  const cutAtMarker = (text, marker) => {
    const m = marker.toLowerCase();
    const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
    const i = lower.indexOf(m);
    return i < 0 ? text : text.slice(0, i + m.length);
  };

  /** The body's text as decoded for the plugin, before any redaction (the decode of [response]). */
  const decodeBody = (bytes, type) => {
    const charset = /charset=([^;]+)/i.exec(type || "");
    const buf = Buffer.from(bytes);
    if (!charset || /utf-?8/i.test(charset[1])) return buf.toString("utf8");
    if (/^\s*(iso-?8859-1|latin-?1|us-ascii)\s*$/i.test(charset[1])) return buf.toString("latin1");
    return new TextDecoder(charset[1].trim()).decode(buf);
  };
  const textual = (type) => !type || /charset=/i.test(type) || /^text\//i.test(type) || /[/+](json|xml)\b/i.test(type) || /javascript|x-www-form-urlencoded/i.test(type);

  function response(status, url, headerList, bytes, truncated = null) {
    const headers = {};
    for (const [k, v] of headerList) if (!k.startsWith("set-cookie")) headers[k] = headers[k] ? headers[k] + ", " + redact(v) : redact(v);
    const buf = Buffer.from(bytes);
    const type = headers["content-type"];
    const charset = /charset=([^;]+)/i.exec(type || "");
    const isLatin1 = (cs) => /^\s*(iso-?8859-1|latin-?1|us-ascii)\s*$/i.test(cs);
    /**
     * Node's `TextDecoder("iso-8859-1")` actually decodes windows-1252 (the WHATWG "iso-8859-1" label
     * aliases to it), which disagrees with `Buffer.from(str, "latin1")` on bytes 0x80-0x9F -- that one
     * maps every byte straight to the code point of the same number, true ISO-8859-1. [base64] below
     * re-encodes with `"latin1"`, so decoding those bytes with `TextDecoder` first would silently
     * change them on the round trip. Read with `Buffer.toString("latin1")` here instead, so decode and
     * the encode in [base64] agree on the same (true Latin-1) mapping for every byte.
     */
    const decode = () => (!charset || /utf-?8/i.test(charset[1]) ? buf.toString("utf8") : isLatin1(charset[1]) ? buf.toString("latin1") : new TextDecoder(charset[1].trim()).decode(buf));
    /**
     * The app's base64 twin (DefaultPluginHost.base64): a binary body's bytes as they came (not
     * scanned); a text body's bytes re-encoded from the REDACTED text in its own charset when
     * redaction changed it -- and when the twin's bytes, read as UTF-8 or as Latin-1, still hold a
     * value (a wrong declared charset), the redacted text's UTF-8 bytes instead.
     */
    function base64() {
      if (!pluginSecrets || !textual(type)) return buf.toString("base64");
      const raw = decode();
      const redacted = redact(raw);
      const enc = !charset || /utf-?8/i.test(charset[1]) ? "utf8" : isLatin1(charset[1]) ? "latin1" : null;
      const twin = redacted === raw ? buf : enc ? Buffer.from(redacted, enc) : null;
      if (!twin || pluginSecrets.containsValue(twin.toString("utf8")) || pluginSecrets.containsValue(twin.toString("latin1"))) return Buffer.from(redacted, "utf8").toString("base64");
      return twin.toString("base64");
    }
    return Object.freeze({
      ok: status >= 200 && status < 300, status, url: redact(url), headers: Object.freeze(headers),
      // apiVersion 14 (fetch.maxBytes): whether the body was cut at maxBytes; absent below 14, as in the app.
      ...(truncated === null ? {} : { truncated }),
      text: () => redact(textual(type) ? decode() : buf.toString("utf8")),
      json: () => JSON.parse(redact(textual(type) ? decode() : buf.toString("utf8"))),
      base64,
    });
  }

  /**
   * One hop of a request carrying a sealed value (spec §5): only to a host the MANIFEST declares
   * (never a typed server or one approved reactively -- the app has no reactive approval in the
   * kit either), and only over https -- checked before the ordinary [gate], which still applies on
   * top for a request that carries no secret.
   */
  function checkSealedHost(u, allowed) {
    if (!hostMatches(u.hostname, allowed)) {
      throw hostRefused("this plugin can't send sealed data to " + u.hostname.slice(0, 100), u.hostname);
    }
    if (u.protocol !== "https:") {
      throw hostRefused("this plugin can't send sealed data without https to " + u.hostname.slice(0, 100), u.hostname);
    }
  }

  const badHeaderChar = (ch) => { const cp = ch.codePointAt(0); return cp !== 9 && (cp < 0x20 || cp > 0x7e); };

  const isFormBody = (b) => Boolean(b && typeof b === "object" && b.form && typeof b.form === "object");

  async function fetchGated(url, opts = {}) {
    const o = opts || {};
    let method = String(o.method === undefined ? "GET" : o.method).toUpperCase();
    if (!f.methods.includes(method)) throw kinoError("invalid_request", "method not allowed: " + method.slice(0, 20));
    const redirect = o.redirect === undefined ? "follow" : String(o.redirect);
    if (!f.redirectModes.includes(redirect)) throw kinoError("invalid_request", 'redirect must be "follow" or "manual"');
    const headers = {};
    for (const k of Object.keys(o.headers || {})) headers[k] = String(o.headers[k]);
    // apiVersion 14 (contract fetch.maxBytes, Task 7i-1): the body is read up to maxBytes, then the read stops and the
    // answer says `truncated`. Below 14 the option is unknown and ignored, like the app's prelude.
    const MB = f.maxBytes;
    const cuts = featureApiVersion(manifest) >= MB.apiVersion;
    let maxBytes = null;
    if (cuts && o.maxBytes !== undefined && o.maxBytes !== null) {
      if (!Number.isInteger(o.maxBytes) || o.maxBytes < MB.min || o.maxBytes > MB.max) throw kinoError("invalid_request", `maxBytes takes ${MB.min} to ${MB.max}`);
      maxBytes = o.maxBytes;
    }
    // Task 8u (contract fetch.stopAt): end the read at a marker, printable ASCII, from the same apiVersion as maxBytes.
    const SA = f.stopAt;
    let stopAt = null;
    if (featureApiVersion(manifest) >= SA.apiVersion && o.stopAt !== undefined && o.stopAt !== null) {
      if (typeof o.stopAt !== "string" || o.stopAt.length < 1 || o.stopAt.length > SA.maxChars || /[^\x20-\x7e]/.test(o.stopAt)) {
        throw kinoError("invalid_request", `stopAt takes 1 to ${SA.maxChars} printable ASCII characters`);
      }
      stopAt = o.stopAt;
    }
    // Fix round 3 (owner ruling), as DefaultPluginHost.secretSafeCut: with ANY sealed value the body is read whole (the
    // ordinary cap: over it too_large), redacted whole, and only then cut (at stopAt, then maxBytes). Without one the read
    // stops at maxBytes or the marker.
    const readWhole = (maxBytes !== null || stopAt !== null) && pluginSecrets !== null && pluginSecrets !== undefined;
    const readMax = readWhole ? null : maxBytes;
    let truncated = false;
    let carriesSecret = false;
    // The size cap is checked BEFORE any substitution, on every body kind alike -- exactly like the
    // app, where the prelude computes it on the marker-laden request before it ever crosses to the
    // Kotlin side that substitutes.
    let body = requestBody(o.body, headers);
    // Counted as the app does: the request crosses as JSON text, so a { base64 } body counts its base64 characters.
    const bodyChars = body ? (typeof body === "string" ? body.length : o.body && typeof o.body === "object" && "base64" in o.body ? String(o.body.base64).length : body.length * 2) : 0;
    const size = String(url).length + JSON.stringify(headers).length + bodyChars;
    if (size > maxRequestChars) throw kinoError("too_large", `request too large (over ${kb(maxRequestChars)})`);
    let current;
    try { current = new URL(String(url)); } catch { throw kinoError("invalid_request", "invalid URL: " + String(url).slice(0, 200)); }
    if (pluginSecrets) {
      // A typed cipher key (apiVersion 6) is for kino.crypto only: its marker anywhere in a request
      // (url, header names or values, any body) is refused before any substitution, like the app.
      const formHolds = isFormBody(o.body) && Object.entries(o.body.form).some(([fk, fv]) => pluginSecrets.containsCipherKeyMarker(String(fk)) || pluginSecrets.containsCipherKeyMarker(String(fv)));
      if (formHolds || pluginSecrets.containsCipherKeyMarker(String(url)) || (typeof body === "string" && pluginSecrets.containsCipherKeyMarker(body)) ||
          Object.entries(headers).some(([hk, hv]) => pluginSecrets.containsCipherKeyMarker(hk) || pluginSecrets.containsCipherKeyMarker(hv))) {
        throw kinoError("invalid_request", SEALED_CRYPTO_REFUSED);
      }
      // Headers: substituted raw, then refused if the plain value put a character OkHttp can't
      // send in a header (a line break or anything else outside tab/space..tilde) -- named only by
      // the header, never the value.
      for (const name of Object.keys(headers)) {
        if (!pluginSecrets.containsMarker(headers[name])) continue;
        carriesSecret = true;
        const substituted = pluginSecrets.substitute(headers[name]);
        if ([...substituted].some(badHeaderChar)) {
          throw kinoError("invalid_request", `header ${name.slice(0, 40)} can't carry this sealed value: it has characters that aren't allowed`);
        }
        headers[name] = substituted;
      }
      // The body: a form's fields are substituted RAW at the object level and re-encoded (so a
      // plain value with a "&", "=" or space is percent-encoded like any other form value, never
      // spliced unescaped into the wire body); a JSON body is JSON-string-escaped in its already-
      // serialized text; a text body is substituted raw.
      const isForm = o.body && typeof o.body === "object" && o.body.form && typeof o.body.form === "object";
      if (isForm && pluginSecrets.containsMarker(body)) {
        carriesSecret = true;
        const substitutedForm = {};
        for (const [fk, fv] of Object.entries(o.body.form)) {
          substitutedForm[pluginSecrets.substitute(String(fk))] = pluginSecrets.substitute(String(fv));
        }
        body = requestBody({ ...o.body, form: substitutedForm }, headers);
      } else if (typeof body === "string" && pluginSecrets.containsMarker(body)) {
        carriesSecret = true;
        const isJson = o.body && typeof o.body === "object" && "json" in o.body;
        body = pluginSecrets.substitute(body, isJson ? "json" : "raw");
      }
      // The URL: only the path and the query (never the scheme, userinfo, host, port or fragment --
      // a plain value must never become a host name, looked up in DNS or logged as one).
      if (pluginSecrets.containsMarker(current.pathname) || pluginSecrets.containsMarker(current.search)) {
        carriesSecret = true;
        if (pluginSecrets.containsMarker(current.pathname)) current.pathname = pluginSecrets.substitute(current.pathname, "url");
        if (pluginSecrets.containsMarker(current.search)) current.search = pluginSecrets.substitute(current.search, "url");
      }
    }
    let previous = null;
    for (let hop = 0; hop <= f.maxRedirects; hop++) {
      if (carriesSecret) checkSealedHost(current, pluginSecrets.sealedHosts);
      gate(current, previous);
      if (++requests > f.maxRequestsPerCall) throw kinoError("invalid_request", `too many requests in one call (at most ${f.maxRequestsPerCall})`);
      if (anyHost && !serverOf(current) && !hostMatches(current.hostname, manifest.hosts)) {
        const over = anyBudget.take(current.hostname);
        if (over) throw kinoError("rate_limited", over);
      }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) headers["User-Agent"] = `Kino/${appVersion} (plugin ${manifest.id})`;
      const sendHeaders = { ...headers };
      if (o.cookies !== false) { const c = cookieHeader(current); if (c) sendHeaders.Cookie = c; }
      // A tape (--record/--replay) is keyed and stored in a nonce-free, per-name CANONICAL form,
      // never the plain value and never the runtime's own random marker: [record, then replay
      // offline]'s author commits fixtures.json, so it must never carry a secret to disk -- and a
      // marker's nonce is random per runtime, so a plain marker in the key would never match again
      // once a fresh `--replay` process (a different nonce than the `--record` one) looked it up.
      // redactToCanonical/fromCanonical are no-ops without pluginSecrets, so an ordinary plugin's
      // key and tape are unchanged.
      const canon = (text) => (pluginSecrets ? pluginSecrets.redactToCanonical(text) : text);
      const uncanon = (text) => (pluginSecrets ? pluginSecrets.fromCanonical(text) : text);
      // Each piece is canonicalized BEFORE it is composed into the key's JSON array, never after: a
      // JSON body already holds a value in its OWN (single) JSON-string escaping, and stringifying
      // it a second time as one element of this array would escape it again (a `"` or `\` doubled),
      // so an echo form that only matches the single-escaped text would silently miss the doubled one.
      const bodyKeyPart = typeof body === "string" ? canon(body) : body ? canon(body.toString("base64")) : null;
      const key = JSON.stringify([canon(method), canon(current.toString()), bodyKeyPart]);
      let status, headerList, bytes;
      const taped = tape && replay ? tape.find((t) => t.key === key) : null;
      if (replay) {
        if (!taped) throw kinoError("network", redact("--replay: no recorded answer for " + method + " " + current));
        ({ status, headers: headerList } = taped);
        headerList = headerList.map(([k2, v]) => [k2, uncanon(v)]);
        bytes = Buffer.from(taped.body, "base64");
        if (readMax !== null && bytes.length > readMax) { bytes = bytes.subarray(0, readMax); truncated = true; }
        if (pluginSecrets) {
          const asText = bytes.toString("utf8");
          if (Buffer.from(asText, "utf8").equals(bytes)) {
            const restored = uncanon(asText);
            if (restored !== asText) bytes = Buffer.from(restored, "utf8");
          }
        }
      } else {
        const requested = Math.trunc(Number(o.timeoutMs));
        const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, f.maxTimeoutMs) : f.defaultTimeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let r;
        try {
          r = await fetchImpl(current, { method, headers: sendHeaders, body: ["POST", "PUT", "PATCH"].includes(method) ? body ?? "" : undefined, redirect: "manual", signal: controller.signal });
          const isRedirect = [301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location") && redirect === "follow";
          const rType = r.headers.get("content-type") || undefined;
          // A marker is looked for in decoded text: a byte answer is refused before its body is read (the app's rule).
          if (stopAt !== null && !isRedirect && !textual(rType)) throw kinoError("invalid_request", "stopAt applies only to a text response");
          const markerEarly = stopAt !== null && !readWhole && !isRedirect && asciiCompatible(rType);
          if (markerEarly && r.body && typeof r.body.getReader === "function") {
            // Read chunk by chunk until the marker (ASCII case-insensitive, found across chunk edges) or the bound.
            const reader = r.body.getReader();
            const limit = readMax ?? maxBodyBytes;
            const needle = Buffer.from(stopAt.toLowerCase(), "latin1");
            let all = Buffer.alloc(0);
            let from = 0;
            for (;;) {
              const at = asciiIndexOfIgnoreCase(all, needle, from);
              if (at >= 0 && at + needle.length <= limit) {
                const end = at + needle.length;
                let more = all.length > end;
                if (!more) { const next = await reader.read(); more = !next.done && next.value.length > 0; }
                await reader.cancel().catch(() => {});
                bytes = all.subarray(0, end);
                truncated = more;
                break;
              }
              if (all.length > limit) {
                await reader.cancel().catch(() => {});
                if (readMax !== null) { bytes = all.subarray(0, readMax); truncated = true; } else bytes = all;
                break;
              }
              from = Math.max(0, all.length - needle.length + 1);
              const { done, value } = await reader.read();
              if (done) { bytes = all; break; }
              all = Buffer.concat([all, Buffer.from(value)]);
            }
          } else if (readMax !== null && r.body && typeof r.body.getReader === "function") {
            // Read until maxBytes are in, then stop and drop the rest, as the app's Okio read does.
            const reader = r.body.getReader();
            const parts = [];
            let got = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              parts.push(Buffer.from(value));
              got += value.length;
              if (got > readMax) { truncated = true; await reader.cancel().catch(() => {}); break; }
            }
            bytes = Buffer.concat(parts).subarray(0, readMax);
          } else {
            bytes = Buffer.from(await r.arrayBuffer());
            if (readMax !== null && bytes.length > readMax) { bytes = bytes.subarray(0, readMax); truncated = true; }
          }
        } catch (e) {
          // Kino's own refusal of this answer (stopAt on a byte answer) goes out as it is.
          if (e && e.code === "invalid_request") throw e;
          if (controller.signal.aborted) throw kinoError("timeout", "the request took too long");
          // Not cut to 200 chars for a sealed request: its detail may quote what the server echoed
          // back, and a value straddling the cut would leave a piece redaction can't recognize --
          // redacted whole here, then kinoError's own cap still applies.
          const detail = redact(String(e.message));
          throw kinoError("network", "network error: " + (carriesSecret ? detail : detail.slice(0, 200)));
        } finally {
          clearTimeout(timer);
        }
        status = r.status;
        headerList = [...r.headers].map(([k, v]) => [k.toLowerCase(), v]);
        if (o.cookies !== false) storeCookies(current, r.headers);
        if (tape) {
          // The recorded answer, canonicalized too: a server that echoes the secret back (an echo
          // endpoint, a test fixture) must never write its plain value -- or a marker some OTHER
          // runtime will never recognize -- into the tape file.
          const storedHeaders = headerList.filter(([k]) => !k.startsWith("set-cookie")).map(([k, v]) => [k, canon(v)]);
          let storedBody = bytes.toString("base64");
          if (pluginSecrets) {
            const asText = bytes.toString("utf8");
            // Only rewrite a body that round-trips as UTF-8 text -- true binary bytes are left as
            // recorded (spec: binary bodies are not scanned), and can't hold a text-form value.
            if (Buffer.from(asText, "utf8").equals(bytes)) {
              const canonText = canon(asText);
              if (canonText !== asText) storedBody = Buffer.from(canonText, "utf8").toString("base64");
            }
          }
          tape.push({ key, status, headers: storedHeaders, body: storedBody });
        }
      }
      if (bytes.length > maxBodyBytes) throw kinoError("too_large", `response too large (over ${kb(maxBodyBytes)})`);
      const location = headerList.find(([k]) => k === "location");
      if ([301, 302, 303, 307, 308].includes(status) && location && redirect === "follow") {
        if (status === 303 || ((status === 301 || status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        previous = current;
        current = new URL(location[1], current);
        continue;
      }
      const finalType = (headerList.find(([k]) => k === "content-type") || [])[1];
      const followsRedirect = [301, 302, 303, 307, 308].includes(status) && headerList.find(([k]) => k === "location") && redirect === "follow";
      if (stopAt !== null && !followsRedirect && !textual(finalType)) throw kinoError("invalid_request", "stopAt applies only to a text response");
      if (stopAt !== null && !readWhole && !followsRedirect) {
        // The marker, in decoded text (a charset whose bytes are not ASCII-compatible was read as without stopAt).
        const decoded = decodeBody(bytes, finalType);
        const cut = cutAtMarker(decoded, stopAt);
        if (cut.length < decoded.length || !asciiCompatible(finalType)) {
          const cutHeaders = headerList.map(([k, v]) => (k === "content-type" ? [k, "text/plain; charset=utf-8"] : [k, v]));
          return response(status, current.toString(), cutHeaders, Buffer.from(cut, "utf8"), truncated || cut.length < decoded.length);
        }
      }
      if (readWhole) {
        // Read whole: decode in its own charset, redact the WHOLE text, then cut it to maxBytes (UTF-8, never inside a
        // character). No value is ever partly read, so none can be partly shown. A binary body is not scanned, as without
        // maxBytes: its bytes are cut.
        const type = (headerList.find(([k]) => k === "content-type") || [])[1];
        if (textual(type)) {
          const redacted = redact(decodeBody(bytes, type));
          // stopAt is searched in the REDACTED text, so a marker made to match inside a sealed value matches nothing of it.
          const atMarker = stopAt !== null ? cutAtMarker(redacted, stopAt) : redacted;
          const cut = maxBytes !== null ? cutUtf8(atMarker, maxBytes) : atMarker;
          const cutHeaders = headerList.map(([k, v]) => (k === "content-type" ? [k, "text/plain; charset=utf-8"] : [k, v]));
          return response(status, current.toString(), cutHeaders, Buffer.from(cut, "utf8"), cut.length < redacted.length);
        }
        if (maxBytes !== null && bytes.length > maxBytes) { bytes = bytes.subarray(0, maxBytes); truncated = true; }
      }
      return response(status, current.toString(), headerList, bytes, cuts ? truncated : null);
    }
    throw kinoError("network", "too many redirects");
  }

  // --- crypto (node:crypto), same names, encodings and errors as the app ---
  const k = contract.crypto;
  const buf = (v, enc, field) => {
    if (typeof v !== "string") throw kinoError("crypto_error", `missing "${field}"`);
    if (!k.encodings.includes(enc)) throw kinoError("crypto_error", "unknown encoding: " + String(enc).slice(0, 20));
    if (enc === "hex" && (v.length % 2 !== 0 || /[^0-9a-f]/i.test(v))) throw kinoError("crypto_error", `"${field}" is not valid hex`);
    if (enc === "base64" && /[^A-Za-z0-9+/=_\-\s]/.test(v)) throw kinoError("crypto_error", `"${field}" is not valid base64`);
    const b = Buffer.from(v, enc === "utf8" ? "utf8" : enc === "hex" ? "hex" : "base64");
    if (b.length > k.maxDataBytes) throw kinoError("crypto_error", `"${field}" is over ${kb(k.maxDataBytes)}`);
    return b;
  };
  const out = (b, enc) => {
    if (!k.encodings.includes(enc)) throw kinoError("crypto_error", "unknown encoding: " + String(enc).slice(0, 20));
    return b.toString(enc === "utf8" ? "utf8" : enc);
  };
  // A marker in `data`, `iv` or `aad` is refused whatever the key is (spec §5): those are paths
  // that hand the value back or let it be computed (a sealed iv or aad falls to CBC-vs-ECB /
  // GHASH's E_K(0), even under a sealed key). Checked before anything else, exactly like the app.
  const sealedIn = (v) => typeof v === "string" && pluginSecrets && pluginSecrets.containsMarker(v);
  const refuseSealedDataLike = (p) => {
    if (sealedIn(p.data) || sealedIn(p.iv) || sealedIn(p.aad)) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
  };
  /** A key-like string (cipher key, hmac key, pbkdf2 password/salt) substituted if it holds a marker. */
  const openKeyLike = (v) => (sealedIn(v) ? pluginSecrets.substitute(v) : v);
  const redactOut = (v) => (pluginSecrets ? pluginSecrets.redact(v) : v);

  function cipher(decrypt, alg, p = {}) {
    let typedEnc = null;
    if (pluginSecrets) {
      refuseSealedDataLike(p);
      // A typed cipher key (apiVersion 6) as the WHOLE key: read with the manifest's encoding, so it
      // is safe for des-ede3 too; the JS-chosen keyEncoding is ignored.
      typedEnc = typeof p.key === "string" ? pluginSecrets.cipherKeyEncoding(p.key) : null;
      // A cipher key must be EXACTLY one marker, nothing before or after it: the rest of a longer
      // key would be known, and peeling it off shrinks the search to the secret alone.
      if (sealedIn(p.key) && !pluginSecrets.isMarker(p.key)) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
      // An untyped one only as an AES key: a des-ede3 key read under a JS-chosen keyEncoding can
      // carry little entropy per byte, which puts it in reach of a search.
      if (sealedIn(p.key) && typedEnc === null && !String(alg).startsWith("aes-")) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
    }
    if (!k.ciphers.includes(alg)) throw kinoError("crypto_error", "unknown cipher: " + String(alg).slice(0, 20));
    const key = buf(openKeyLike(p.key), typedEnc || p.keyEncoding || "utf8", "key");
    const data = buf(p.data, p.inputEncoding || (decrypt ? "base64" : "utf8"), "data");
    const bits = alg.startsWith("des") ? 192 : Number(alg.split("-")[1]);
    if (key.length * 8 !== bits) throw kinoError("crypto_error", `the ${alg} key must be ${bits / 8} bytes, it is ${key.length}`);
    const mode = alg.split("-")[2];
    const iv = mode === "ecb" ? null : buf(p.iv, p.ivEncoding || "utf8", "iv");
    const padding = p.padding === undefined ? "pkcs7" : p.padding;
    if (padding !== "pkcs7" && padding !== "none") throw kinoError("crypto_error", "unknown padding: " + String(padding).slice(0, 20));
    try {
      let result;
      if (mode === "gcm") {
        const c = decrypt ? createDecipheriv(alg, key, iv) : createCipheriv(alg, key, iv);
        if (p.aad !== undefined) c.setAAD(buf(p.aad, p.aadEncoding || "utf8", "aad"));
        if (decrypt) {
          if (data.length < 16) throw kinoError("crypto_error", "the ciphertext is missing its 16-byte tag");
          c.setAuthTag(data.subarray(data.length - 16));
          result = out(Buffer.concat([c.update(data.subarray(0, data.length - 16)), c.final()]), p.outputEncoding || "utf8");
        } else {
          result = out(Buffer.concat([c.update(data), c.final(), c.getAuthTag()]), p.outputEncoding || "base64");
        }
      } else {
        const c = decrypt ? createDecipheriv(alg, key, iv) : createCipheriv(alg, key, iv);
        if (mode !== "ctr") c.setAutoPadding(padding === "pkcs7");
        result = out(Buffer.concat([c.update(data), c.final()]), p.outputEncoding || (decrypt ? "utf8" : "base64"));
      }
      return redactOut(result);
    } catch (e) {
      if (e.code && String(e.code).startsWith("KinoError")) throw e;
      if (e.name && e.name.startsWith("KinoError")) throw e;
      throw kinoError("crypto_error", decrypt ? "couldn't decrypt: wrong key or iv" : "invalid crypto operation");
    }
  }
  // --- kino.crypto byte ops (apiVersion 13), as PluginCrypto.kt: AES-256-IGE, big-integer modPow over hex, gunzip. A sealed
  // value is refused in every field, whatever the op (an IGE call under a sealed key would be a decryption oracle). ---
  const BYTES = k.bytesOps;
  const INVALID_CRYPTO = "invalid crypto operation";
  const refuseSealedAny = (...vs) => {
    if (pluginSecrets && vs.some((v) => typeof v === "string" && (pluginSecrets.containsMarker(v) || pluginSecrets.containsCipherKeyMarker(v)))) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
  };
  function aesIge(dir, key, iv, data, p = {}) {
    refuseSealedAny(dir, key, iv, data);
    if (dir !== "encrypt" && dir !== "decrypt") throw kinoError("crypto_error", INVALID_CRYPTO);
    return redactOut(out(igeBytes(dir === "encrypt", key, iv, data, p), p.outputEncoding || "base64"));
  }
  function igeBytes(encrypt, key, iv, data, p) {
    const keyB = buf(key, p.keyEncoding || "utf8", "key"), ivB = buf(iv, p.ivEncoding || "utf8", "iv"), dataB = buf(data, p.inputEncoding || "utf8", "data");
    if (keyB.length !== 32 || ivB.length !== 32 || dataB.length % 16 !== 0) throw kinoError("crypto_error", INVALID_CRYPTO);
    const c = encrypt ? createCipheriv("aes-256-ecb", keyB, null) : createDecipheriv("aes-256-ecb", keyB, null);
    c.setAutoPadding(false);
    let y = Buffer.from(ivB.subarray(0, 16)), x = Buffer.from(ivB.subarray(16, 32));
    const res = Buffer.alloc(dataB.length);
    const tmp = Buffer.alloc(16);
    for (let i = 0; i < dataB.length; i += 16) {
      const block = dataB.subarray(i, i + 16);
      for (let j = 0; j < 16; j++) tmp[j] = block[j] ^ (encrypt ? y[j] : x[j]);
      const e = c.update(tmp);
      for (let j = 0; j < 16; j++) res[i + j] = e[j] ^ (encrypt ? x[j] : y[j]);
      if (encrypt) { x = Buffer.from(block); y = Buffer.from(res.subarray(i, i + 16)); } else { x = Buffer.from(res.subarray(i, i + 16)); y = Buffer.from(block); }
    }
    return res;
  }
  const bigHex = (v, field) => {
    if (typeof v !== "string") throw kinoError("crypto_error", `missing "${field}"`);
    const t = v.replace(/^0+/, "");
    if (/[^0-9a-f]/i.test(t)) throw kinoError("crypto_error", `"${field}" is not valid hex`);
    if (t.length > BYTES.modPowMaxBits / 4) throw kinoError("crypto_error", field === "mod" ? `the modulus is over ${BYTES.modPowMaxBits} bits` : `"${field}" is over ${BYTES.modPowMaxBits} bits`);
    if (v === "") throw kinoError("crypto_error", INVALID_CRYPTO);
    return t === "" ? 0n : BigInt("0x" + t);
  };
  function modPow(base, exp, mod) {
    refuseSealedAny(base, exp, mod);
    const b = bigHex(base, "base"), e = bigHex(exp, "exp"), m = bigHex(mod, "mod");
    if (m === 0n) throw kinoError("crypto_error", INVALID_CRYPTO);
    let result = 1n % m, sq = b % m, ex = e;
    while (ex > 0n) { if (ex & 1n) result = (result * sq) % m; sq = (sq * sq) % m; ex >>= 1n; }
    return redactOut(result.toString(16).padStart((m.toString(16).length + 1 >> 1) * 2, "0"));
  }
  function gunzip(data, p = {}) {
    refuseSealedAny(data);
    const input = buf(data, p.inputEncoding || "base64", "data");
    let raw;
    try {
      raw = gunzipSync(input, { maxOutputLength: k.maxDataBytes });
    } catch (e) {
      if (e && e.code === "ERR_BUFFER_TOO_LARGE") throw kinoError("crypto_error", "the unzipped data is over 5 MB");
      throw kinoError("crypto_error", INVALID_CRYPTO);
    }
    return redactOut(out(raw, p.outputEncoding || "utf8"));
  }
  function convert(data, from, to) {
    refuseSealedAny(data, from, to);
    if (!k.encodings.includes(from)) throw kinoError("crypto_error", "unknown encoding: " + String(from ?? "").slice(0, 20));
    if (!k.encodings.includes(to)) throw kinoError("crypto_error", "unknown encoding: " + String(to ?? "").slice(0, 20));
    return redactOut(out(buf(data, from, "data"), to));
  }
  // AES-256-IGE decryption checked by SHA-256(macPrefix || plaintext)[macOffset, macOffset + mac.length) === mac, as PluginCrypto.kt.
  function aesIgeVerify(key, iv, data, p = {}) {
    refuseSealedAny(key, iv, data, p.mac, p.macPrefix);
    const macEnc = p.macEncoding || "hex";
    const mac = buf(p.mac, macEnc, "mac");
    const prefix = p.macPrefix === undefined || p.macPrefix === null ? Buffer.alloc(0) : buf(p.macPrefix, macEnc, "macPrefix");
    const offset = p.macOffset === undefined || p.macOffset === null ? 0 : p.macOffset;
    if (!Number.isInteger(offset) || offset < 0 || offset > 31 || mac.length === 0 || offset + mac.length > 32) throw kinoError("crypto_error", INVALID_CRYPTO);
    const plain = igeBytes(false, key, iv, data, p);
    const digest = createHash("sha256").update(prefix).update(plain).digest();
    if (!timingSafeEqual(digest.subarray(offset, offset + mac.length), mac)) throw kinoError("crypto_error", "the mac doesn't match");
    return redactOut(out(plain, p.outputEncoding || "base64"));
  }
  const crypto = Object.freeze({
    hash(alg, data, p = {}) {
      if (sealedIn(String(data))) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
      if (!k.hashes.includes(alg)) throw kinoError("crypto_error", "unknown hash algorithm: " + String(alg).slice(0, 20));
      return redactOut(out(createHash(alg).update(buf(String(data), p.inputEncoding || "utf8", "data")).digest(), p.outputEncoding || "hex"));
    },
    hmac(alg, key, data, p = {}) {
      if (sealedIn(String(data))) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
      if (pluginSecrets && pluginSecrets.containsCipherKeyMarker(String(key))) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
      if (!k.hashes.includes(alg)) throw kinoError("crypto_error", "unknown hmac algorithm: " + String(alg).slice(0, 20));
      // Unlike a cipher key, the hmac key may join a marker with other text (e.g. OAuth 1's
      // `consumerSecret&tokenSecret`): HMAC mixes its whole key through a hash, so a known part
      // never splits the unknown one off.
      const keyBuf = buf(openKeyLike(String(key)), p.keyEncoding || "utf8", "key");
      if (!keyBuf.length) throw kinoError("crypto_error", "the hmac key is empty");
      return redactOut(out(createHmac(alg, keyBuf).update(buf(String(data), p.inputEncoding || "utf8", "data")).digest(), p.outputEncoding || "hex"));
    },
    encrypt: (alg, p) => cipher(false, alg, p),
    decrypt: (alg, p) => cipher(true, alg, p),
    pbkdf2(hash, password, salt, iterations, keyLength, p = {}) {
      if (pluginSecrets && (pluginSecrets.containsCipherKeyMarker(String(password)) || pluginSecrets.containsCipherKeyMarker(String(salt)))) throw kinoError("crypto_error", SEALED_CRYPTO_REFUSED);
      if (!k.pbkdf2Hashes.includes(hash)) throw kinoError("crypto_error", "unknown pbkdf2 hash: " + String(hash).slice(0, 20));
      if (!Number.isInteger(iterations) || iterations < 1 || iterations > k.pbkdf2MaxIterations) throw kinoError("crypto_error", `pbkdf2 iterations between 1 and ${k.pbkdf2MaxIterations}`);
      if (!Number.isInteger(keyLength) || keyLength < 1 || keyLength > k.pbkdf2MaxKeyBytes) throw kinoError("crypto_error", `pbkdf2 key length between 1 and ${k.pbkdf2MaxKeyBytes} bytes`);
      // password and salt may both join a marker with other text, same reasoning as the hmac key.
      const password0 = openKeyLike(String(password)), salt0 = openKeyLike(String(salt));
      return redactOut(out(pbkdf2Sync(buf(password0, p.keyEncoding || "utf8", "password"), buf(salt0, p.inputEncoding || "utf8", "salt"), iterations, keyLength, hash), p.outputEncoding || "hex"));
    },
    randomBytes(n, enc = "hex") {
      if (!Number.isInteger(n) || n < 1 || n > k.randomMaxBytes) throw kinoError("crypto_error", `randomBytes takes 1 to ${k.randomMaxBytes} bytes`);
      return redactOut(out(randomBytes(n), enc));
    },
    uuid: () => redactOut(randomUUID()),
    ...(contract.apiVersion >= BYTES.apiVersion ? { aesIge, modPow, gunzip, convert, aesIgeVerify } : {}),
    // apiVersion 6's key pairs: the kit reports apiVersion contract.apiVersion, so they are here whenever the app's are.
    ...(contract.apiVersion >= KP.apiVersion ? keyPairApi({ pluginSecrets, buf }) : {}),
  });

  // --- kino.nuvio (Kino 0.9.71, apiVersion 11, capability "nuvio"): the app installs and asks the scrapers of the Nuvio
  // repositories the manifest names (nuvioRepos). The kit has no scrapers: it answers from a fixture (KINO_NUVIO_FIXTURE),
  // with the app's checks, limits and codes, so the plugin's own logic -- which scrapers, in what order, how the copies
  // merge -- runs offline. ---
  const N = contract.kinoNuvio;
  const nuvioBucket = tokenBucket(N.perMinute, 60_000, now);
  const nuvioFixtureFile = nuvioFixture === undefined ? env.KINO_NUVIO_FIXTURE : nuvioFixture;
  const nuvioRepoAnswers = typeof nuvioFixtureFile === "string" && nuvioFixtureFile ? readJsonFile(nuvioFixtureFile, "KINO_NUVIO_FIXTURE") : plainObject(nuvioFixtureFile) ? nuvioFixtureFile : null;
  const nuvioInstalled = new Map(); // repository -> Map(scraper id -> { id, name }) in install order
  const repoKey = (r) => String(r).trim().toLowerCase();
  const nuvioScraperList = (q) => {
    if (q.scrapers === undefined) return undefined;
    if (!Array.isArray(q.scrapers) || q.scrapers.length > N.maxScraperFilter || !q.scrapers.every((s) => typeof s === "string" && s)) {
      throw kinoError("invalid_request", `kino.nuvio: "scrapers" is a list of at most ${N.maxScraperFilter} scraper ids`);
    }
    return q.scrapers;
  };
  async function nuvioRepo(query) {
    await null;
    if (!plainObject(query) || typeof query.repo !== "string" || !query.repo.trim()) throw kinoError("invalid_request", 'kino.nuvio: the query needs a "repo" (owner/repo or the https address of a Nuvio manifest)');
    if (JSON.stringify(query).length > N.maxRequestChars) throw kinoError("invalid_request", `kino.nuvio: the query is longer than ${N.maxRequestChars} characters`);
    const declared = Array.isArray(manifest.nuvioRepos) ? manifest.nuvioRepos.map(repoKey) : [];
    if (!manifest.capabilities.includes(N.capability) || !declared.includes(repoKey(query.repo))) {
      throw kinoError("not_allowed", `kino.nuvio: this plugin does not declare the "${N.capability}" capability with "${query.repo.slice(0, 80)}" in "${N.manifestField}"`);
    }
    if (!nuvioBucket.take()) throw kinoError("rate_limited", `too many kino.nuvio calls in a minute (at most ${N.perMinute}); wait a moment`);
    const key = Object.keys(nuvioRepoAnswers || {}).find((k) => repoKey(k) === repoKey(query.repo));
    if (!key) throw kinoError("unavailable", `the Node kit has no Nuvio repository to read: give it a fixture with KINO_NUVIO_FIXTURE (a repository "${query.repo.slice(0, 80)}" with its scrapers and their answers); the real scrapers only run in the app`);
    const repo = nuvioRepoAnswers[key];
    const offered = (Array.isArray(repo.available) ? repo.available : []).filter((o) => plainObject(o) && typeof o.id === "string" && o.id).slice(0, N.maxOffered);
    if (!nuvioInstalled.has(repoKey(query.repo))) nuvioInstalled.set(repoKey(query.repo), new Map());
    return { repo, offered, installed: nuvioInstalled.get(repoKey(query.repo)) };
  }
  const nuvioApi = Object.freeze({
    async available(query) {
      const { offered, installed } = await nuvioRepo(query);
      return offered.map((o) => ({
        id: o.id, name: String(o.name || o.id), description: String(o.description || "").slice(0, 120),
        types: Array.isArray(o.types) ? o.types.map(String) : [], languages: Array.isArray(o.languages) ? o.languages.map(String) : [],
        compatible: o.compatible !== false, installed: installed.has(o.id),
      }));
    },
    async use(query) {
      const { offered, installed } = await nuvioRepo(query);
      if (!Array.isArray(query.scrapers) || !query.scrapers.length || query.scrapers.length > N.maxUse || !query.scrapers.every((s) => typeof s === "string" && s)) {
        throw kinoError("invalid_request", `kino.nuvio.use needs "scrapers": 1 to ${N.maxUse} scraper ids`);
      }
      const ready = [];
      const failed = [];
      for (const id of query.scrapers) {
        const o = offered.find((x) => x.id === id);
        if (!o) failed.push({ id, code: "not_found", message: "the repository offers no such scraper" });
        else if (o.compatible === false) failed.push({ id, code: "refused", message: "Kino does not use this scraper (it needs torrents)" });
        else { if (!installed.has(id)) installed.set(id, { id, name: String(o.name || id) }); ready.push(id); }
      }
      return { ready, failed };
    },
    async scrapers(query) {
      const { installed } = await nuvioRepo(query);
      const only = nuvioScraperList(query);
      return [...installed.values()].filter((s) => !only || only.includes(s.id)).map((s) => ({ id: s.id, name: s.name }));
    },
    async streams(query) {
      const { repo, installed } = await nuvioRepo(query);
      const only = nuvioScraperList(query);
      if (!["movie", "series", "tv"].includes(query.type)) throw kinoError("invalid_request", 'kino.nuvio.streams: "type" is "movie", "series" or "tv"');
      if (!Number.isInteger(query.tmdbId) || query.tmdbId < 1) throw kinoError("invalid_request", 'kino.nuvio.streams: "tmdbId" is the title\'s TMDB id (a positive integer)');
      const isSeries = query.type !== "movie";
      if (isSeries && (!Number.isInteger(query.season) || query.season < 0 || !Number.isInteger(query.episode) || query.episode < 1)) {
        throw kinoError("invalid_request", 'kino.nuvio.streams: a series needs "season" and "episode"');
      }
      const timeoutMs = query.timeoutMs === undefined ? N.scraperTimeoutMs : query.timeoutMs;
      if (!Number.isInteger(timeoutMs) || timeoutMs < N.minScraperTimeoutMs || timeoutMs > N.scraperTimeoutMs) {
        throw kinoError("invalid_request", `kino.nuvio.streams: "timeoutMs" is ${N.minScraperTimeoutMs} to ${N.scraperTimeoutMs}`);
      }
      const asked = [...installed.values()].filter((s) => !only || only.includes(s.id));
      const keys = isSeries ? [`series:${query.tmdbId}:${query.season}:${query.episode}`, `series:${query.tmdbId}`] : [`movie:${query.tmdbId}`];
      const results = asked.slice(0, N.maxScrapers).map((s) => {
        const scraper = { id: s.id, name: s.name };
        const answers = plainObject(repo.streams) && plainObject(repo.streams[s.id]) ? repo.streams[s.id] : {};
        const hitKey = keys.find((k) => Object.prototype.hasOwnProperty.call(answers, k));
        const hit = hitKey === undefined ? undefined : answers[hitKey];
        if (!plainObject(hit)) return { scraper, ok: false, code: "not_found", message: "this scraper has no stream for the title" };
        if (hit.delayMs > timeoutMs) return { scraper, ok: false, code: "timeout", message: `this scraper took longer than ${timeoutMs} ms` };
        if (plainObject(hit.error)) return { scraper, ok: false, code: String(hit.error.code || "failed"), message: String(hit.error.message || "the scraper failed") };
        if (typeof hit.url !== "string" || !hit.url) return { scraper, ok: false, code: "failed", message: "the scraper answered no address" };
        const { delayMs, error, ...stream } = hit;
        return { scraper, ok: true, stream };
      });
      return { results, truncated: asked.length > N.maxScrapers };
    },
  });

  // --- kino.meta (Kino 0.9.53): the app asks TMDB, AniList and the person's other meta plugins; the kit answers from a
  // fixture, else null. Same checks, same rate limit, same codes. ---
  const M = contract.kinoMeta;
  const metaBucket = tokenBucket(M.perMinute, 60_000, now);
  const metaFixtureFile = metaFixture === undefined ? env.KINO_META_FIXTURE : metaFixture;
  const metaAnswers = typeof metaFixtureFile === "string" && metaFixtureFile ? readJsonFile(metaFixtureFile, "KINO_META_FIXTURE") : plainObject(metaFixtureFile) ? metaFixtureFile : null;
  async function meta(query) {
    await null;
    const q = kinoMetaRequest(query, manifest.apiVersion);
    if (!metaBucket.take()) throw kinoError("rate_limited", `too many kino.meta calls in a minute (at most ${M.perMinute}); wait a moment`);
    if (!metaAnswers) return null;
    // Kino 0.9.55's lookup by title: the fixture's "<type>:title:<normalised title>:<year>", then without the year.
    if (q.title) {
      const t = normaliseMetaTitle(q.title);
      const hit = (q.year ? metaAnswers[`${q.type}:title:${t}:${q.year}`] : undefined) ?? metaAnswers[`${q.type}:title:${t}`];
      return hit === undefined || hit === null ? null : JSON.parse(JSON.stringify(hit));
    }
    for (const key of M.idKeys) {
      if (q.ids[key] === undefined) continue;
      const hit = metaAnswers[`${q.type}:${key}:${q.ids[key]}`] ?? metaAnswers[`${key}:${q.ids[key]}`];
      if (hit !== undefined) return hit === null ? null : JSON.parse(JSON.stringify(hit));
    }
    return null;
  }

  // --- kino.tmdb (Kino 0.9.53): the app asks TMDB on Kino's own key first (its limits: kinoKeyPerWindow per plugin,
  // kinoKeyGlobalPerWindow for all) and on the person's key only when Kino's fails. The kit has neither: your key ([tmdbKey],
  // KINO_TMDB_KEY or sdk/config.json's tmdbKey) stands in for Kino's, under Kino's stricter limit, with no person's key to
  // fall back to; a fixture stands in for TMDB (and a key). ---
  const T = contract.kinoTmdb;
  const tmdbBucket = tokenBucket(T.perWindow, T.windowMs, now);
  const kinoKeyBucket = tokenBucket(T.kinoKeyPerWindow, T.windowMs, now);
  const personKey = tmdbKey === undefined ? kitTmdbKey(undefined, env) : tmdbKey;
  const tmdbFixtureFile = tmdbFixture === undefined ? env.KINO_TMDB_FIXTURE : tmdbFixture;
  const tmdbAnswers = typeof tmdbFixtureFile === "string" && tmdbFixtureFile ? readJsonFile(tmdbFixtureFile, "KINO_TMDB_FIXTURE") : plainObject(tmdbFixtureFile) ? tmdbFixtureFile : null;
  const tmdbCache = new Map();
  // Every text that could reach the plugin or the console loses the key first.
  const scrubKey = (text) => (personKey ? String(text).split(personKey).join("***") : String(text));
  async function tmdb(path, params) {
    await null;
    const { path: p, query } = kinoTmdbRequest(path, params);
    if (!tmdbBucket.take()) throw kinoError("rate_limited", `too many kino.tmdb calls (at most ${T.perWindow} every ${T.windowMs / 1000} s); wait a moment`);
    const cacheKey = query ? `${p}?${query}` : p;
    if (tmdbAnswers) {
      const hit = Object.prototype.hasOwnProperty.call(tmdbAnswers, cacheKey) ? tmdbAnswers[cacheKey] : Object.prototype.hasOwnProperty.call(tmdbAnswers, p) ? tmdbAnswers[p] : undefined;
      if (hit === undefined) throw kinoError("not_found", "KINO_TMDB_FIXTURE doesn't have " + cacheKey.slice(0, 200));
      return JSON.parse(JSON.stringify(hit));
    }
    const v3 = personKey && new RegExp(T.keyPatterns.v3).test(personKey);
    const v4 = personKey && !v3 && new RegExp(T.keyPatterns.v4).test(personKey);
    if (!v3 && !v4) throw noTmdbKeyError(lang);
    const cached = tmdbCache.get(cacheKey);
    if (cached && now() - cached.at < T.cacheTtlMs) return JSON.parse(cached.text);
    if (!kinoKeyBucket.take()) throw kinoError("rate_limited", `too many kino.tmdb calls on Kino's key (at most ${T.kinoKeyPerWindow} every ${T.windowMs / 1000} s); in Kino the person's key, if any, would answer`);
    const qs = [query, v3 ? "api_key=" + encodeURIComponent(personKey) : ""].filter(Boolean).join("&");
    const url = T.base + p + (qs ? "?" + qs : "");
    const headers = { Accept: "application/json", "User-Agent": `Kino/${appVersion}` };
    if (v4) headers.Authorization = "Bearer " + personKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), T.timeoutMs);
    let r, bytes;
    try {
      r = await fetchImpl(url, { method: "GET", headers, redirect: "manual", signal: controller.signal });
      bytes = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (controller.signal.aborted) throw kinoError("timeout", "TMDB took too long");
      throw kinoError("network", "couldn't connect to TMDB: " + scrubKey(e && e.message).slice(0, 150));
    } finally {
      clearTimeout(timer);
    }
    if (bytes.length > T.maxBodyBytes) throw kinoError("too_large", `the TMDB answer is over ${kb(T.maxBodyBytes)}`);
    // In Kino a refused or rate-limited Kino key goes again on the person's key; the kit has none to try.
    if (r.status === 401 || r.status === 403) throw kinoError("unavailable", `TMDB refused the key (${r.status}): check KINO_TMDB_KEY`);
    if (r.status === 404) throw kinoError("not_found", "TMDB doesn't have " + p.slice(0, 200));
    if (r.status === 429) throw kinoError("rate_limited", "TMDB asked to wait (429)");
    if (r.status < 200 || r.status > 299) throw kinoError("unavailable", "TMDB answered " + r.status);
    const text = bytes.toString("utf8");
    let body;
    try { body = JSON.parse(text); } catch { throw kinoError("unavailable", "TMDB answered something that isn't JSON"); }
    if (text.length <= T.maxCachedBodyChars) {
      tmdbCache.delete(cacheKey);
      tmdbCache.set(cacheKey, { at: now(), text });
      while (tmdbCache.size > T.maxCachedEntries) tmdbCache.delete(tmdbCache.keys().next().value);
    }
    return body;
  }

  // --- kino.library (apiVersion 14, capability "library"): the app reads the active profile's history and favorites; the kit
  // answers from a fixture with the app's rules (PluginLibraryBridge), so a plugin sees the same refusals and the same shape.
  const LB = contract.kinoLibrary;
  const libraryBucket = tokenBucket(LB.perMinute, 60_000, now);
  const libraryFixtureFile = libraryFixture === undefined ? env.KINO_LIBRARY_FIXTURE : libraryFixture;
  const libraryData = typeof libraryFixtureFile === "string" && libraryFixtureFile ? readJsonFile(libraryFixtureFile, "KINO_LIBRARY_FIXTURE") : plainObject(libraryFixtureFile) ? libraryFixtureFile : {};
  const libraryOff = libraryRevoked || env.KINO_LIBRARY_REVOKED === "1";
  const dayOf = (ms) => ms - (((ms % LB.dayMs) + LB.dayMs) % LB.dayMs);
  const libraryEntry = (e, watched) => {
    const out = { title: String(e.title).slice(0, LB.maxTitleChars) };
    if (Number.isInteger(e.year)) out.year = e.year;
    out.kind = e.kind;
    out.ids = {};
    if (plainObject(e.ids)) {
      if (Number.isInteger(e.ids.tmdb) && e.ids.tmdb > 0) out.ids.tmdb = e.ids.tmdb;
      if (typeof e.ids.imdb === "string" && /^tt\d{5,10}$/.test(e.ids.imdb)) out.ids.imdb = e.ids.imdb;
    }
    if (watched) {
      const p = Math.min(1, Math.max(0, typeof e.progress === "number" && Number.isFinite(e.progress) ? e.progress : 0));
      out.progress = Math.round(p / LB.progressStep) / Math.round(1 / LB.progressStep);
      out.watchedAtMs = dayOf(e.watchedAtMs);
    }
    return out;
  };
  async function libraryCall(op, options) {
    await null;
    if (!(manifest.capabilities || []).includes(LB.capability) || libraryOff) {
      throw kinoError("permission_denied", 'kino.library needs the "library" capability, approved by the person');
    }
    // Task 8q: a job's own run (run.mjs ... job) reads it too, with the same approval (PluginLibrary.FROM_JOB).
    if (syncCall || (callFunction !== null && !LB.fromFunctions.includes(callFunction) && callFunction !== contract.kinoJobs.export)) {
      throw kinoError("permission_denied", `kino.library only answers while the person uses the plugin (${LB.fromFunctions.join(", ")})`);
    }
    const bad = () => kinoError("bad_request", "kino.library: limit is a whole number from 1, kind is \"movie\" or \"series\", sinceMs (watched only) a whole number from 0");
    if (options !== undefined && options !== null && !plainObject(options)) throw bad();
    const o = options || {};
    if (o.limit !== undefined && o.limit !== null && !(Number.isInteger(o.limit) && o.limit >= 1)) throw bad();
    if (o.kind !== undefined && o.kind !== null && !LB.kinds.includes(o.kind)) throw bad();
    if (o.sinceMs !== undefined && o.sinceMs !== null && (op !== "watched" || !(Number.isInteger(o.sinceMs) && o.sinceMs >= 0))) throw bad();
    if (!libraryBucket.take()) throw kinoError("rate_limited", `too many kino.library calls (at most ${LB.perMinute} a minute)`);
    const limit = Math.min(LB.maxLimit, o.limit ?? LB.defaultLimit);
    const watched = op === "watched";
    const rows = (Array.isArray(libraryData[op]) ? libraryData[op] : [])
      .filter((e) => plainObject(e) && e.adult !== true && typeof e.title === "string" && LB.kinds.includes(e.kind))
      .filter((e) => !watched || Number.isInteger(e.watchedAtMs))
      .filter((e) => o.kind === undefined || o.kind === null || e.kind === o.kind)
      // sinceMs is rounded down to the day and compared with the rounded time, as in the app: no finer time can be probed.
      .filter((e) => !watched || o.sinceMs === undefined || o.sinceMs === null || dayOf(e.watchedAtMs) >= dayOf(o.sinceMs))
      .sort((a, b) => (watched ? b.watchedAtMs - a.watchedAtMs : (b.savedAtMs || 0) - (a.savedAtMs || 0)));
    return rows.slice(0, limit).map((e) => libraryEntry(e, watched));
  }
  const libraryApi = Object.freeze({
    watched: (options) => libraryCall("watched", options),
    saved: (options) => libraryCall("saved", options),
  });

  // --- kino.room (apiVersion 14, capability "room"): an in-memory room with two simulated members (createKitRoom). ---
  const roomApi = kitRoomApi(manifest, room || createKitRoom({ now }), { revoked: roomRevoked || env.KINO_ROOM_REVOKED === "1", callFunction, syncCall, now });

  // --- kino.ai (apiVersion 14, capability "ai", Task 8r): a fake text AI with the app's gates (kitAiApi). The origin is the export
  // running (kitCall, else [callFunction]) with its screen marks; a job's run is the export contract.kinoAi.fromJob. ---
  const aiApi = kitAiApi(manifest, {
    model: ai, revoked: aiRevoked, syncCall, env, now,
    origin: () => {
      const o = currentQrOrigin();
      const fn = o.fn ?? callFunction ?? undefined;
      return { ...o, fn, job: fn === contract.kinoAi.fromJob, takeRequest: kitJobRequest.getStore() };
    },
  });

  // --- kino.ws (apiVersion 13, capability "socket"): the app's PluginWebSocket over Node's global WebSocket. wss:// only,
  // a host the manifest declares (never an IP literal or a local name, which cannot be declared), at most
  // contract.socket.maxSockets open, at most contract.socket.maxQueuedBytes queued unread (then `limit`). ---
  const wsApi = (() => {
    if (!(manifest.capabilities || []).includes("socket") || typeof WebSocket !== "function") return null;
    const C = contract.socket;
    let live = 0;
    // Frames as strings (contract.socket.encodings), as the app's prelude.js and WsFrames: an object with `encoding`
    // "hex" or "base64" is the only option; the cap is on the decoded size; decoding is strict (canonical form only).
    const wsEncoding = (opts) => {
      if (opts === null || typeof opts !== "object") return null;
      const e = opts.encoding;
      if (e === undefined || e === null) return null;
      if (!C.encodings.includes(e)) throw kinoError("invalid_request", 'encoding must be "hex" or "base64"');
      return e;
    };
    const wsEncodedBytes = (s, encoding) => {
      const n = s.length;
      if (encoding === "hex") return (n + 1) >> 1;
      const pad = n > 0 && s.charCodeAt(n - 1) === 61 ? (n > 1 && s.charCodeAt(n - 2) === 61 ? 2 : 1) : 0;
      return (n >> 2) * 3 + (n % 4 === 0 ? 0 : (n % 4) - 1) - pad;
    };
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const wsDecode = (s, encoding) => {
      if (encoding === "hex") {
        if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw kinoError("invalid_request", "the frame is not valid hex");
        return new Uint8Array(Buffer.from(s, "hex"));
      }
      const bad = () => kinoError("invalid_request", "the frame is not valid base64");
      if (s.length % 4 !== 0) throw bad();
      const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
      if (!/^[A-Za-z0-9+/]*$/.test(s.slice(0, s.length - pad))) throw bad();
      if (pad > 0 && (B64.indexOf(s[s.length - pad - 1]) & (pad === 2 ? 15 : 3)) !== 0) throw bad();
      return new Uint8Array(Buffer.from(s, "base64"));
    };
    const open = (url, options) => new Promise((resolve, reject) => {
      let u;
      try { u = new URL(String(url)); } catch { reject(kinoError("invalid_request", "invalid URL")); return; }
      if (u.protocol !== "wss:") { reject(kinoError("not_https", "only wss:// is allowed")); return; }
      const literal = /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":") || u.hostname.startsWith("[");
      if (literal || !hostMatches(u.hostname, manifest.hosts)) { reject(hostRefused("host not allowed: " + u.hostname, u.hostname)); return; }
      // As PluginHttp.authorizeSocket: wss on port 443 only (URL drops the default port, so "" is 443).
      if (u.port !== "" && u.port !== "443") { reject(hostRefused("only port 443 is allowed for wss://", u.hostname)); return; }
      if (live >= C.maxSockets) { reject(kinoError("limit", `too many open sockets (at most ${C.maxSockets})`)); return; }
      live++;
      const protocol = options && typeof options.protocol === "string" && options.protocol ? options.protocol : undefined;
      const sock = protocol ? new WebSocket(u.href, protocol) : new WebSocket(u.href);
      sock.binaryType = "arraybuffer";
      const queue = [];
      let queued = 0, waiter = null, reason = null, settled = false;
      const end = (why) => { if (reason === null) { reason = why; live--; } if (waiter) { const w = waiter; waiter = null; w(); } };
      sock.addEventListener("message", (ev) => {
        const frame = typeof ev.data === "string" ? new TextEncoder().encode(ev.data) : new Uint8Array(ev.data);
        if (reason !== null) return;
        queued += frame.length;
        if (queued > C.maxQueuedBytes) { end("limit"); try { sock.close(); } catch { /* already closing */ } return; }
        queue.push(frame);
        if (waiter) { const w = waiter; waiter = null; w(); }
      });
      sock.addEventListener("close", () => end("closed"));
      sock.addEventListener("error", () => { if (!settled) { settled = true; end("closed"); reject(kinoError("network", "network error")); } });
      sock.addEventListener("open", () => {
        settled = true;
        resolve(Object.freeze({
          send: async (data, options) => {
            const encoding = wsEncoding(options);
            if (typeof data === "string" && encoding !== null) {
              if (wsEncodedBytes(data, encoding) > C.maxSendBytes) throw kinoError("too_large", "frame too large");
              const frame = wsDecode(data, encoding);
              if (reason !== null || sock.readyState !== 1) throw kinoError("closed", "the socket is closed");
              sock.send(frame);
              return;
            }
            if (!isUint8Array(data)) throw kinoError("invalid_request", encoding === null ? "send() takes a Uint8Array" : "send() takes a Uint8Array or an encoded string");
            if (data.length > C.maxSendBytes) throw kinoError("too_large", "frame too large");
            if (reason !== null || sock.readyState !== 1) throw kinoError("closed", "the socket is closed");
            sock.send(data);
          },
          recv: async (timeoutMs, options) => {
            const encoding = wsEncoding(options);
            const ms = Math.min(timeoutMs === undefined ? 30000 : Number.isInteger(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0, C.maxRecvMs);
            if (queue.length === 0 && reason === null) {
              await new Promise((r) => { const t = setTimeout(() => { waiter = null; r(); }, ms); waiter = () => { clearTimeout(t); r(); }; });
            }
            if (queue.length > 0) {
              const f = queue.shift();
              queued -= f.length;
              return encoding === null ? f : Buffer.from(f.buffer, f.byteOffset, f.length).toString(encoding === "hex" ? "hex" : "base64");
            }
            if (reason !== null) throw kinoError(reason, "the socket is closed");
            return null;
          },
          close: async () => { end("closed"); try { sock.close(); } catch { /* already closed */ } },
        }));
      });
    });
    return Object.freeze({ open });
  })();

  // --- kino.catalog (apiVersion 13, capability "catalog"): the app's PluginCatalogDb mirrored in memory (catalogAnswer
  // below), behind the same wrapper the app's prelude.js puts in front of it. Undefined without the capability. ---
  const catalogApi = (manifest.capabilities || []).includes("catalog") ? catalogKino(newCatalogState()) : null;

  // --- kino.qr (apiVersion 13, capability "qrScan"): the app's PluginQrScanner behind its prelude wrapper. Node has no
  // camera: the `qrScan` option of createKino is the person, `async ({ title, titleEn }) =>` the scanned text or null (a
  // cancel); it may throw a kinoError (permission_denied, ...). Without it, and on a TV (device "tv"), the scan is
  // unavailable, as on a device without a camera. A text the app would not accept (empty, over contract.qr.maxScanChars)
  // is not taken: the app's scanner would keep looking until its timeout, so the kit answers timeout at once. ---
  // FORMAT_RANGES (prelude.js has the same list): the characters a title may not hold (every ISO control, every Unicode
  // format character, the line and paragraph separators). Where a scan may start is qrScanOriginAllowed (kit-call.mjs).
  const QR_REFUSED = [[0x00AD, 0x00AD], [0x0600, 0x0605], [0x061C, 0x061C], [0x06DD, 0x06DD], [0x070F, 0x070F], [0x0890, 0x0891], [0x08E2, 0x08E2],
    [0x180E, 0x180E], [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x2064], [0x2066, 0x206F], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB],
    [0x110BD, 0x110BD], [0x110CD, 0x110CD], [0x13430, 0x1343F], [0x1BCA0, 0x1BCA3], [0x1D173, 0x1D17A], [0xE0001, 0xE0001], [0xE0020, 0xE007F]];
  const qrRefusedChar = (v) => [...v].some((ch) => { const cp = ch.codePointAt(0); return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || QR_REFUSED.some(([a, b]) => cp >= a && cp <= b); });
  const QR_KIT_MAX_IGNORED = 10;
  const qrApi = (() => {
    if (!(manifest.capabilities || []).includes(contract.qr.capability)) return null;
    const Q = contract.qr;
    let open = false;
    const scan = async (options) => {
      await null;
      const o = options === undefined || options === null ? {} : options;
      if (typeof o !== "object") throw kinoError("invalid_request", "kino.qr.scan takes { title, titleEn }");
      const ask = {};
      for (const k of ["title", "titleEn"]) {
        const v = o[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== "string") throw kinoError("invalid_request", `kino.qr.scan: ${k} must be a string`);
        if (v.length > Q.maxTitleChars) throw kinoError("invalid_request", `kino.qr.scan: ${k} is over ${Q.maxTitleChars} characters`);
        if (qrRefusedChar(v)) throw kinoError("invalid_request", `kino.qr.scan: ${k} holds a control or formatting character`);
        ask[k] = v.trim();
      }
      // The app's order: the request, the device, where the call comes from, the open scan.
      if (kinoDevice === "tv" || typeof qrScan !== "function") throw kinoError("unavailable", "kino.qr.scan: this device can't scan a QR code (a TV, or a device without a camera)");
      if (!qrScanOriginAllowed(currentQrOrigin())) throw kinoError("not_allowed", "kino.qr.scan only runs from a settings action, panelAction or screenEvent the person pressed");
      if (open) throw kinoError("busy", "kino.qr.scan: a scan is already open");
      open = true;
      try {
        // A code the app would not take (empty, or over maxScanChars) is ignored there and the scanner keeps looking: the
        // fake is asked again with invalid: true, and after QR_KIT_MAX_IGNORED of them the kit answers the app's timeout.
        let invalid = false;
        for (let i = 0; i <= QR_KIT_MAX_IGNORED; i++) {
          const text = await qrScan({ title: ask.title || "", titleEn: ask.titleEn || "", ...(invalid ? { invalid: true } : {}) });
          if (text === null || text === undefined) return null;
          if (typeof text === "string" && text.length > 0 && text.length <= Q.maxScanChars) return text;
          invalid = true;
        }
        throw kinoError("timeout", `kino.qr.scan: nothing was scanned in ${Q.timeoutMs / 1000} s`);
      } finally {
        open = false;
      }
    };
    return Object.freeze({ scan });
  })();

  const kino = Object.freeze({
    apiVersion: contract.apiVersion,
    appVersion,
    lang,
    // Kino 0.9.55 (contract.additiveFromApp["kino.fetchAnyHost"]): true when this install's kino.fetch reaches any public host.
    fetchAnyHost: anyHost,
    // Kino 0.9.55 (contract.additiveFromApp["kino.device"]): the UI Kino shows, "phone" or "tv".
    device: kinoDevice,
    // Kino 0.9.55 (contract.additiveFromApp["kino.seed"]): share one anonymous guest session; the kit only reports what Kino would keep.
    seed: kinoSeed,
    // Kino 0.9.74 (contract.additiveFromApp["kino.sync.remoteChanged"]): a realtime syncProvider signals its remote changed.
    sync: kinoSync,
    // apiVersion 14 (contract.manifest.screen.widgets): the widgets this Kino draws (their older names) and the type names the
    // docs list (contract.manifest.screen.aliases.names), for feature detection; `version` is the screen contract's own, 1
    // until a widget changes meaning.
    screen: Object.freeze({ widgets: Object.freeze([...contract.manifest.screen.widgets]), names: Object.freeze([...contract.manifest.screen.aliases.names]), version: 1 }),
    fetch: fetchGated,
    html: Object.freeze({
      select() {
        throw new Error("kino.html.select only exists inside Kino (it uses Jsoup): test it by installing the plugin in the app");
      },
    }),
    storage: Object.freeze({
      get: (key) => {
        purgeExpiredStorage();
        const k = String(key);
        return Object.prototype.hasOwnProperty.call(storage, k) ? storageEntryValue(storage[k]) : null;
      },
      set: (key, v, options) => {
        const k = String(key), value = String(v);
        let expiresAt;
        if (options !== null && typeof options === "object" && options.ttlMs !== undefined && options.ttlMs !== null) {
          const ttlMs = options.ttlMs;
          if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > contract.storage.maxTtlMs) {
            throw kinoError("invalid_request", `kino.storage.set: ttlMs must be a whole number above 0 and up to ${contract.storage.maxTtlMs} ms (30 days)`);
          }
          expiresAt = Date.now() + ttlMs;
        }
        purgeExpiredStorage();
        // apiVersion 13, capability "storageLarge": the app's larger quota (PluginStorage, one file per value there), else
        // the 256 KB one. The large total counts every key and value in UTF-8, as the app's index does.
        if (storageLarge()) {
          const st = contract.storage;
          if (k.length > st.largeMaxKeyChars) throw kinoError("invalid_request", `kino.storage.set: with storageLarge a key is at most ${st.largeMaxKeyChars} characters`);
          if (Buffer.byteLength(value) > st.largeMaxValueBytes) throw kinoError("too_large", `plugin storage full (${kb(st.largeMaxValueBytes)} per value)`);
          const others = Object.keys(storage).filter((x) => x !== k);
          if (others.length >= st.largeMaxKeys) throw kinoError("too_large", `plugin storage full (${st.largeMaxKeys} keys)`);
          const total = others.reduce((sum, x) => sum + Buffer.byteLength(x) + Buffer.byteLength(storageEntryValue(storage[x])), 0);
          if (total + Buffer.byteLength(k) + Buffer.byteLength(value) > st.largeMaxTotalBytes) throw kinoError("too_large", `plugin storage full (${kb(st.largeMaxTotalBytes)})`);
          storage[k] = expiresAt === undefined ? value : { v: value, e: expiresAt };
        } else {
          const previous = storage[k];
          storage[k] = expiresAt === undefined ? value : { v: value, e: expiresAt };
          if (Buffer.byteLength(JSON.stringify(storage)) > contract.storage.maxTotalBytes) {
            if (previous === undefined) delete storage[k]; else storage[k] = previous;
            throw kinoError("too_large", `plugin storage full (${kb(contract.storage.maxTotalBytes)})`);
          }
        }
        saveJson(storageFile, storage);
      },
      remove: (key) => { purgeExpiredStorage(); delete storage[String(key)]; saveJson(storageFile, storage); },
      keys: () => { purgeExpiredStorage(); return Object.keys(storage); },
    }),
    config: Object.freeze({
      get: (key) => values[String(key)],
      all: () => ({ ...values }),
    }),
    // apiVersion 13, capability "socket": undefined without it, like the app.
    ...(wsApi ? { ws: wsApi } : {}),
    // apiVersion 13, capability "catalog": undefined without it, like the app.
    ...(catalogApi ? { catalog: catalogApi } : {}),
    // apiVersion 13, capability "qrScan": undefined without it, like the app.
    ...(qrApi ? { qr: qrApi } : {}),
    cookies: Object.freeze({
      get(url, name) {
        let u;
        try { u = new URL(String(url)); gate(u, null); } catch { return null; }
        const c = cookieJar.filter((x) => cookieMatches(x, u) && x.name === String(name)).pop();
        return c ? redact(c.value) : null;
      },
      clear() { cookieJar.length = 0; saveJson(cookiesFile, cookieJar); },
    }),
    crypto,
    rank: Object.freeze({ shortQuery, sortBySimilarity, filterRelevant }),
    async sleep(ms) {
      await null;
      if (!Number.isInteger(ms) || ms < 0 || ms > contract.sleep.maxMs) throw kinoError("invalid_request", `kino.sleep takes 0 to ${contract.sleep.maxMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    // apiVersion 4: a marker for a secret the manifest's `secrets` declares (spec §5). A name is at
    // most 32 characters, so cutting to 64 before the lookup can never turn an undeclared name into
    // a declared one -- the same cut the app's prelude applies.
    secret(name) {
      const s = String(name).slice(0, 64);
      const m = pluginSecrets && pluginSecrets.marker(s);
      if (!m) throw kinoError("not_allowed", "this plugin doesn't declare the secret " + s.slice(0, 40));
      return m;
    },
    error: (code, message, options) => kinoError(code, message, options),
    log: kinoLog,
    // Kino 0.9.53 (no new apiVersion): ask Kino about a title, and TMDB with no key in the plugin (Kino's, else the person's).
    // byTitle: true is Kino 0.9.55's feature flag (contract.additiveFromApp["kino.meta.byTitle"]).
    meta: manifest.apiVersion >= contract.kinoMeta.byTitle.apiVersion ? Object.assign(meta, { byTitle: true }) : meta,
    tmdb,
    // Kino 0.9.71 (apiVersion 11, capability "nuvio"): the scrapers of the Nuvio repositories the manifest names. Feature-detect
    // it: typeof kino.nuvio === "object".
    nuvio: nuvioApi,
    // apiVersion 14 (contract.kinoLibrary): what the person watched and saved, read-only, with the "library" capability approved.
    // Present on every apiVersion 14 kino, like the app's: feature-detect with typeof kino.library === "object". A plugin of an
    // older apiVersion that adds the library through an enhancement runs on such a Kino too (featureApiVersion).
    ...(featureApiVersion(manifest) >= LB.apiVersion ? { library: libraryApi } : {}),
    // apiVersion 14 (contract.kinoRoom): present on every apiVersion 14 kino, like the app's (typeof kino.room === "object").
    ...(featureApiVersion(manifest) >= contract.kinoRoom.apiVersion ? { room: roomApi } : {}),
    // apiVersion 14 (contract.kinoAi): present on every apiVersion 14 kino, like the app's (typeof kino.ai === "object"); an ask
    // never throws: { ok: true, text, model } or { ok: false, error, message }.
    ...(featureApiVersion(manifest) >= contract.kinoAi.apiVersion ? { ai: aiApi } : {}),
    // apiVersion 14 (contract.kinoShared, Task 8q-2): one simulated device's store ([shared], createSharedDevices().phone or
    // .tv; a fresh one when none is given). Present on every apiVersion 14 kino, like the app's (typeof kino.shared === "object").
    ...(featureApiVersion(manifest) >= contract.kinoShared.apiVersion ? { shared: kitSharedApi(manifest, shared ?? createSharedStore({ now }), { now }) } : {}),
    // apiVersion 6: the app opens a hidden WebView; Node has none, so the kit answers as a device without one would.
    // A plugin's resolve should already fall back (another server, a plain kino.fetch path) on this code.
    // kino.browser.page ("browser": "pages", apiVersion 6) answers the same: a plugin keeps a plain kino.fetch path for it too.
    ...(contract.apiVersion >= contract.browser.apiVersion ? {
      browser: Object.freeze({
        // Kino 0.9.54's capture options are here (contract.additiveFromApp["kino.browser.captureAll"]): feature-detect them.
        captureAll: true,
        // The app's order: the request is checked first (invalid_request, as its prelude and PluginBrowser.parseRequest
        // do), and only then is there no browser.
        async capture(url, opts) {
          await null;
          browserCaptureOptions(opts);
          throw kinoError("browser_unavailable", "the Node kit has no browser: kino.browser.capture only works in the app");
        },
        ...(contract.apiVersion >= contract.browser.page.apiVersion ? {
          // The app's order: the request is checked first (invalid_request, as its prelude does), then the manifest's
          // approval (a plugin without "browser": "pages" gets not_allowed, as the app's PluginBrowser answers), and
          // only then is there no browser.
          async page(url, opts) {
            await null;
            const o = opts === undefined || opts === null ? {} : opts;
            const P = contract.browser.page;
            if (o.timeoutMs !== undefined && (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 1 || o.timeoutMs > P.maxTimeoutMs)) {
              throw kinoError("invalid_request", `timeoutMs takes 1 to ${P.maxTimeoutMs} ms`);
            }
            if (o.waitFor !== undefined && o.waitFor !== null) {
              const isRx = Object.prototype.toString.call(o.waitFor) === "[object RegExp]";
              const w = isRx ? o.waitFor.source : String(o.waitFor);
              const flags = isRx ? o.waitFor.flags.replace(/[^ms]/g, "") : "";
              if (w.length < 1 || w.length > P.maxWaitForChars) throw kinoError("invalid_request", `waitFor must be 1 to ${P.maxWaitForChars} characters`);
              try { new RegExp(w, "i" + flags); } catch { throw kinoError("invalid_request", "waitFor is not a valid regular expression"); }
            }
            const pages = manifest && (manifest.browserPages === true || (manifest.browserPages === undefined && manifest.browser === contract.manifest.browser.pagesValue));
            if (!pages) throw kinoError("not_allowed", `this plugin lacks permission to read pages ("browser": "${contract.manifest.browser.pagesValue}")`);
            throw kinoError("browser_unavailable", "the Node kit has no browser: kino.browser.page only works in the app");
          },
        } : {}),
      }),
    } : {}),
  });

  return {
    kino,
    servers: servers.map((s) => s.toString()),
    resetBudget: () => { requests = 0; },
    saveTape: () => { if (record && tape) saveJson(record, tape); },
    /**
     * A screen answer's `config`, already checked (screen.mjs checkScreenAnswer with the manifest's settings): written into
     * the kit's settings, so a later `kino.config.get/all` of this run reads it, as the app's would. `null` empties a setting
     * (its default again). Only the types a screen may write (never a url; a password since the screen asks); a list that would gain an address the
     * kit's settings do not hold is not written, as in the app. Returns the app's line for each key it does not write.
     */
    writeConfig: (changes) => {
      const notWritten = [];
      for (const [k, v] of Object.entries(changes || {})) {
        const s = (manifest.settings || []).find((x) => x.key === k);
        if (!s || !contract.manifest.screen.configTypes.includes(s.type)) { notWritten.push(`screen: setting "${k.slice(0, 40)}" cannot be written from a screen, not written`); continue; }
        if (s.type === "list" && !keepsAddresses(s, v, values[k])) { notWritten.push(`screen: setting "${k}" would gain an address the person did not type, not written`); continue; }
        const d = v === null || v === undefined ? defaultOf(s) : v;
        if (d === undefined || d === "") delete values[k]; else values[k] = d;
      }
      return notWritten;
    },
  };
}

/**
 * The app's signing lane (SigningLaneHost + prelude.js): sign() gets kino.crypto, kino.secret,
 * kino.config, kino.html and kino.log, never the network, storage, cookies, sleep, kino.meta, kino.tmdb or kino.nuvio. The refusals
 * are the app's: fetch rejects with host_not_allowed, the rest with not_allowed.
 */
export function signingLane(kino) {
  const why = (api) => kinoError("not_allowed", `sign() can't use ${api}: whatever you need must come in signContext`);
  const refused = (api) => () => { throw why(api); };
  const methods = (names, api) => Object.freeze(Object.fromEntries(names.map((n) => [n, refused(api)])));
  // The app's lane host is no catalog or QR host: sign() has no kino.catalog and no kino.qr at all.
  const { catalog: _noCatalog, qr: _noQr, ...laneKino } = kino;
  return Object.freeze({
    ...laneKino,
    fetch: async () => { throw kinoError("host_not_allowed", "sign can't use the network"); },
    storage: methods(["get", "set", "remove", "keys"], "kino.storage"),
    cookies: methods(["get", "clear"], "kino.cookies"),
    ws: Object.freeze({ open: async () => { throw why("kino.ws"); } }),
    sleep: async () => { throw why("kino.sleep"); },
    meta: async () => { throw why("kino.meta"); },
    tmdb: async () => { throw why("kino.tmdb"); },
    nuvio: Object.freeze({ available: async () => { throw why("kino.nuvio"); }, use: async () => { throw why("kino.nuvio"); }, scrapers: async () => { throw why("kino.nuvio"); }, streams: async () => { throw why("kino.nuvio"); } }),
    ...(kino.library ? { library: Object.freeze({ watched: async () => { throw why("kino.library"); }, saved: async () => { throw why("kino.library"); } }) } : {}),
    ...(kino.room ? { room: Object.freeze(Object.fromEntries(contract.kinoRoom.functions.map((n) => [n, async () => { throw why("kino.room"); }]))) } : {}),
    // kino.ai.ask never throws: the lane answers its refusal as data (prelude.js).
    ...(kino.ai ? { ai: Object.freeze({ ask: async () => Object.freeze({ ok: false, error: "refused", message: "sign() can't use kino.ai: whatever you need must come in signContext" }) }) } : {}),
    ...(kino.shared ? { shared: Object.freeze({ get: refused("kino.shared"), set: refused("kino.shared") }) } : {}),
    ...(kino.browser ? { browser: Object.freeze({ captureAll: true, capture: async () => { throw why("kino.browser"); }, ...(kino.browser.page ? { page: async () => { throw why("kino.browser"); } } : {}) }) } : {}),
  });
}

/**
 * `kino.browser.capture`'s options, checked as the app checks them (its prelude, then PluginBrowser.parseRequest):
 * throws invalid_request for what the app refuses. Kino 0.9.54 added captureAll, alsoMatch, waitForCookie and
 * returnCookiesOnTimeout (contract.browser.captureAll).
 */
export function browserCaptureOptions(opts) {
  const o = opts === undefined || opts === null ? {} : opts;
  const B = contract.browser;
  const C = B.captureAll;
  if (o.timeoutMs !== undefined && (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 1 || o.timeoutMs > B.maxTimeoutMs)) {
    throw kinoError("invalid_request", `timeoutMs takes 1 to ${B.maxTimeoutMs} ms`);
  }
  // Length and type only, like the app's prelude: the app compiles patterns as Java regexes (IGNORE_CASE, `(?-i)`, `(?i)`
  // and other syntax JavaScript refuses), so a JS RegExp compile here would refuse patterns the app accepts.
  const pattern = (p, what) => {
    const t = Object.prototype.toString.call(p) === "[object RegExp]" ? p.source : String(p);
    if (t.length < 1 || t.length > B.maxMatchChars) throw kinoError("invalid_request", `${what} must be 1 to ${B.maxMatchChars} characters`);
    return t;
  };
  const match = o.match === undefined || o.match === null ? null : pattern(String(o.match), "match");
  const flag = (name) => {
    const v = o[name];
    if (v === undefined || v === null) return false;
    if (v !== true && v !== false) throw kinoError("invalid_request", `${name} must be true or false`);
    return v;
  };
  const captureAll = flag("captureAll");
  flag("returnCookiesOnTimeout");
  if (o.alsoMatch !== undefined && o.alsoMatch !== null) {
    if (!captureAll) throw kinoError("invalid_request", "alsoMatch only works with captureAll");
    if (!Array.isArray(o.alsoMatch) || o.alsoMatch.length < 1 || o.alsoMatch.length > C.maxAlsoMatch) {
      throw kinoError("invalid_request", `alsoMatch takes 1 to ${C.maxAlsoMatch} expressions`);
    }
    o.alsoMatch.forEach((p) => pattern(p, "each alsoMatch"));
  }
  let cookie = null;
  if (o.waitForCookie !== undefined && o.waitForCookie !== null) {
    cookie = String(o.waitForCookie);
    if (!new RegExp(C.waitForCookiePattern).test(cookie)) throw kinoError("invalid_request", "waitForCookie must be a cookie name");
  }
  if (captureAll && match === null && cookie !== null) throw kinoError("invalid_request", "captureAll needs match when waitForCookie is used");
}

// --- kino.catalog (apiVersion 13): the app's PluginCatalogDb, in memory --------------------------------------------------
// Same validation order, messages, normalisation, matching and ordering as the app (pinned by the shared vectors in
// docs/plugins/catalog-vectors.json, which the app's PluginCatalogTest runs too). Two differences, both documented: the
// catalog lives in memory for one createKino (the app keeps a SQLite file), and maxDbBytes is checked against an estimate
// of the file size (the app measures SQLite's used pages).
const CAT = contract.catalog;
const CATALOG_DAMAGED = "kino.catalog: the catalog file was damaged and has been reset to empty; rebuild it";
// JavaScript's \s, written out so the app's Kotlin regex can be the very same class.
// Control characters other than whitespace (NUL, escape, C1): dropped from what is searched, as the app does.
const CATALOG_CONTROLS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]+/g;
const CATALOG_SPACES = /[\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/;

/** A title as the catalog searches it: lower-cased, then NFD without combining marks ("Película" -> "pelicula"). */
export function catalogNorm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(CATALOG_CONTROLS, "");
}

/** A query's tokens: normalised like a title, split on whitespace, each once. */
export function catalogTokens(q) {
  return [...new Set(catalogNorm(q).split(CATALOG_SPACES).filter((t) => t.length > 0))];
}

/** SQLite's BINARY order over UTF-8 text is code-point order (not JavaScript's UTF-16 order). */
function cmpCodePoints(a, b) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

const nonFinite = (v) => typeof v === "number" && !Number.isFinite(v);
const cmpNum = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wholeNumber = (v) => typeof v === "number" && Number.isInteger(v);

export function newCatalogState(maxDbBytes = CAT.maxDbBytes) {
  return { rows: new Map(), bytes: 0, maxDbBytes };
}

// An estimate of what a row costs in the app's SQLite file: the row (id, title, norm, sort, data) plus its two indexes.
function catalogRowBytes(r) {
  return Buffer.byteLength(r.id) * 3 + Buffer.byteLength(r.title) * 2 + Buffer.byteLength(r.norm) * 2 + (r.data === null ? 0 : Buffer.byteLength(r.data)) + 40;
}

class CatalogRefusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (code, message) => { throw new CatalogRefusal(code, message); };

function catalogItem(i, raw) {
  if (!isPlainObject(raw)) refuse("invalid_request", `kino.catalog.upsert: item ${i} must be an object`);
  const id = raw.id;
  if (typeof id !== "string" || id.length === 0) refuse("invalid_request", `kino.catalog.upsert: item ${i} needs an id, a string of 1 to ${CAT.maxIdChars} characters`);
  if (id.length > CAT.maxIdChars) refuse("too_large", `kino.catalog.upsert: item ${i} id is over ${CAT.maxIdChars} characters (maxIdChars)`);
  const title = raw.title;
  if (typeof title !== "string") refuse("invalid_request", `kino.catalog.upsert: item ${i} needs a title, a string of at most ${CAT.maxTitleChars} characters`);
  if (title.length > CAT.maxTitleChars) refuse("too_large", `kino.catalog.upsert: item ${i} title is over ${CAT.maxTitleChars} characters (maxTitleChars)`);
  let sort = 0;
  if (raw.sort !== undefined && raw.sort !== null) {
    if (!wholeNumber(raw.sort) || !Number.isSafeInteger(raw.sort)) refuse("invalid_request", `kino.catalog.upsert: item ${i} sort must be a whole number`);
    sort = raw.sort;
  }
  let data = null;
  if (raw.data !== undefined && raw.data !== null) {
    const d = raw.data;
    if (typeof d !== "string") refuse("invalid_request", `kino.catalog.upsert: item ${i} data must be an object`);
    if (Buffer.byteLength(d) > CAT.maxDataBytes) refuse("too_large", `kino.catalog.upsert: item ${i} data is over ${CAT.maxDataBytes} bytes as JSON (maxDataBytes)`);
    let ok = d.length >= 2 && d[0] === "{" && d[d.length - 1] === "}";
    if (ok) { try { ok = isPlainObject(JSON.parse(d)); } catch { ok = false; } }
    if (!ok) refuse("invalid_request", `kino.catalog.upsert: item ${i} data must be an object`);
    data = d;
  }
  return { id, title, norm: catalogNorm(title), sort, data };
}

function catalogIdsOf(op, args) {
  const raw = args.ids;
  if (!Array.isArray(raw)) refuse("invalid_request", `kino.catalog.${op} takes an array of ids`);
  if (raw.length > CAT.maxUpsertBatch) refuse("too_large", `kino.catalog.${op}: at most ${CAT.maxUpsertBatch} ids per call (maxUpsertBatch)`);
  raw.forEach((id, i) => { if (typeof id !== "string") refuse("invalid_request", `kino.catalog.${op}: id ${i} must be a string`); });
  return [...new Set(raw)];
}

const catalogRowOut = (r) => ({ id: r.id, title: r.title, sort: r.sort, data: r.data });

function catalogOp(state, op, args) {
  switch (op) {
    case "upsert": {
      if (!Array.isArray(args.items)) refuse("invalid_request", "kino.catalog.upsert takes an array of items");
      if (args.items.length > CAT.maxUpsertBatch) refuse("too_large", `kino.catalog.upsert: at most ${CAT.maxUpsertBatch} items per call (maxUpsertBatch)`);
      const items = args.items.map((raw, i) => catalogItem(i, raw));
      // All or nothing, like the app's transaction: the totals are computed before anything is written.
      const after = new Map();
      for (const it of items) after.set(it.id, it);
      let count = state.rows.size, bytes = state.bytes;
      for (const [id, it] of after) {
        const old = state.rows.get(id);
        if (old) bytes -= catalogRowBytes(old); else count++;
        bytes += catalogRowBytes(it);
      }
      if (count > CAT.maxItems) refuse("limit", `kino.catalog.upsert: the catalog is full (maxItems ${CAT.maxItems})`);
      if (bytes > state.maxDbBytes) refuse("limit", `kino.catalog.upsert: the catalog file is full (maxDbBytes ${state.maxDbBytes % 1048576 === 0 ? `${state.maxDbBytes / 1048576} MiB` : `${state.maxDbBytes} bytes`})`);
      for (const [id, it] of after) state.rows.set(id, it);
      state.bytes = bytes;
      return { count: items.length };
    }
    case "search": {
      let q = "";
      if (args.q !== undefined && args.q !== null) {
        if (typeof args.q !== "string") refuse("invalid_request", "kino.catalog.search: q must be a string");
        q = args.q;
      }
      if (q.length > CAT.maxQueryChars) refuse("too_large", `kino.catalog.search: q is over ${CAT.maxQueryChars} characters (maxQueryChars)`);
      let limit = CAT.defaultSearchLimit;
      if (args.limit !== undefined && args.limit !== null) {
        if (!wholeNumber(args.limit) || args.limit < 1) refuse("invalid_request", `kino.catalog.search: limit must be a whole number from 1 to ${CAT.maxSearchLimit}`);
        limit = args.limit;
      }
      if (limit > CAT.maxSearchLimit) refuse("too_large", `kino.catalog.search: limit is over ${CAT.maxSearchLimit} (maxSearchLimit)`);
      let offset = 0;
      if (args.offset !== undefined && args.offset !== null) {
        if (!wholeNumber(args.offset) || args.offset < 0) refuse("invalid_request", `kino.catalog.search: offset must be a whole number from 0 to ${CAT.maxOffset}`);
        offset = args.offset;
      }
      if (offset > CAT.maxOffset) refuse("too_large", `kino.catalog.search: offset is over ${CAT.maxOffset} (maxOffset)`);
      let order = CAT.orders[0];
      if (args.order !== undefined && args.order !== null) {
        if (typeof args.order !== "string" || !CAT.orders.includes(args.order)) refuse("invalid_request", 'kino.catalog.search: order must be "newest", "oldest" or "title"');
        order = args.order;
      }
      const tokens = catalogTokens(q);
      const hits = [...state.rows.values()].filter((r) => tokens.every((t) => r.norm.includes(t)));
      const byId = (a, b) => cmpCodePoints(a.id, b.id);
      const sorters = {
        newest: (a, b) => cmpNum(b.sort, a.sort) || byId(a, b),
        oldest: (a, b) => cmpNum(a.sort, b.sort) || byId(a, b),
        title: (a, b) => cmpCodePoints(a.norm, b.norm) || cmpCodePoints(a.title, b.title) || byId(a, b),
      };
      hits.sort(sorters[order]);
      return { items: hits.slice(offset, offset + limit).map(catalogRowOut), total: hits.length };
    }
    case "get": {
      const ids = catalogIdsOf("get", args);
      return { items: ids.filter((id) => state.rows.has(id)).map((id) => catalogRowOut(state.rows.get(id))) };
    }
    case "remove": {
      const ids = catalogIdsOf("remove", args);
      let count = 0;
      for (const id of ids) {
        const old = state.rows.get(id);
        if (old) { state.rows.delete(id); state.bytes -= catalogRowBytes(old); count++; }
      }
      return { count };
    }
    case "clear":
      state.rows.clear();
      state.bytes = 0;
      return {};
    case "count":
      return { count: state.rows.size };
    default:
      return refuse("invalid_request", "kino.catalog: unknown operation");
  }
}

/**
 * One catalog operation as the app's PluginCatalogDb.answer takes it: [op] and its arguments as the prelude sends them
 * (JSON text). Answers JSON text; a refusal is {"error":{code,message}}, never thrown.
 */
export function catalogAnswer(state, op, argsJson) {
  try {
    let args;
    try { args = JSON.parse(argsJson); } catch { args = undefined; }
    if (!isPlainObject(args)) refuse("invalid_request", "kino.catalog: invalid request");
    return JSON.stringify(catalogOp(state, op, args));
  } catch (e) {
    if (e instanceof CatalogRefusal) return JSON.stringify({ error: { code: e.code, message: e.message } });
    throw e;
  }
}

/** The app's prelude.js wrapper (kino.catalog), over [state]: the same request building, checks and typed errors. */
function catalogKino(state) {
  const call = async (op, args) => {
    await null;
    let text;
    try { text = String(JSON.stringify(args)); } catch { throw kinoError("invalid_request", `kino.catalog.${op}: the request can't be turned into JSON`); }
    if (text.length > CAT.maxRequestChars) throw kinoError("too_large", `kino.catalog.${op}: the request is over ${CAT.maxRequestChars} characters (maxRequestChars)`);
    const r = JSON.parse(catalogAnswer(state, op, text));
    if (r && r.error) throw kinoError(r.error.code, r.error.message);
    return r;
  };
  const dataIn = (d) => {
    if (d === undefined || d === null) return null;
    let t;
    try { t = JSON.stringify(d); } catch { t = undefined; }
    return typeof t === "string" ? t : false;
  };
  const itemsOut = (list) => list.map((it) => ({ id: it.id, title: it.title, sort: it.sort, data: it.data === null || it.data === undefined ? null : JSON.parse(it.data) }));
  const idsIn = async (op, ids) => {
    await null;
    if (!Array.isArray(ids)) throw kinoError("invalid_request", `kino.catalog.${op} takes an array of ids`);
    if (ids.length > CAT.maxUpsertBatch) throw kinoError("too_large", `kino.catalog.${op}: at most ${CAT.maxUpsertBatch} ids per call (maxUpsertBatch)`);
    return [...ids];
  };
  return Object.freeze({
    async upsert(items) {
      await null;
      if (!Array.isArray(items)) throw kinoError("invalid_request", "kino.catalog.upsert takes an array of items");
      if (items.length > CAT.maxUpsertBatch) throw kinoError("too_large", `kino.catalog.upsert: at most ${CAT.maxUpsertBatch} items per call (maxUpsertBatch)`);
      // NaN and Infinity would become null in JSON (the default): refused first, as the app's prelude does.
      items.forEach((it, i) => { if (it !== null && typeof it === "object" && nonFinite(it.sort)) throw kinoError("invalid_request", `kino.catalog.upsert: item ${i} sort must be a whole number`); });
      const out = items.map((it) => (it === null || typeof it !== "object" ? it : { id: it.id, title: it.title, sort: it.sort, data: dataIn(it.data) }));
      const r = await call("upsert", { items: out });
      return { count: r.count };
    },
    async search(options) {
      await null;
      const o = options === undefined || options === null ? {} : options;
      if (typeof o !== "object" || Array.isArray(o)) throw kinoError("invalid_request", "kino.catalog.search takes { q, limit, offset, order }");
      if (nonFinite(o.limit)) throw kinoError("invalid_request", `kino.catalog.search: limit must be a whole number from 1 to ${CAT.maxSearchLimit}`);
      if (nonFinite(o.offset)) throw kinoError("invalid_request", `kino.catalog.search: offset must be a whole number from 0 to ${CAT.maxOffset}`);
      const r = await call("search", { q: o.q, limit: o.limit, offset: o.offset, order: o.order });
      return { items: itemsOut(r.items), total: r.total };
    },
    async get(ids) { const r = await call("get", { ids: await idsIn("get", ids) }); return itemsOut(r.items); },
    async remove(ids) { const r = await call("remove", { ids: await idsIn("remove", ids) }); return { count: r.count }; },
    async clear() { await call("clear", {}); },
    async count() { return (await call("count", {})).count; },
  });
}

export { CATALOG_DAMAGED };

// ---------- byteSource (apiVersion 13): asking a plugin's read export as Kino's proxy does ----------

const readTurns = new WeakMap();

/**
 * Asks `plugin`'s `read({ handle, offset, length })` for a range of `stream` (a resolve answer `{ source: "plugin", handle,
 * size, mime }`) the way Kino's PluginByteStreams does: only for a manifest that declares byteSource at apiVersion 13 and a
 * plugin that exports `read`; only ranges Kino's proxy asks (offset a multiple of contract.byteSource.alignmentBytes and inside
 * the stream, length 1 to chunkBytes); one read at a time per plugin; at most readTimeoutMs; the answer checked by
 * `readAnswer` (exactly min(length, size - offset) bytes). Resolves with a Buffer; rejects with an Error saying why the
 * player would stop. What it does not mirror: the proxy's read-ahead, cache and seek scheduling.
 */
export async function askRead(plugin, manifest, stream, offset, length, { timeoutMs = contract.byteSource.readTimeoutMs } = {}) {
  const b = contract.byteSource;
  if (!allowsByteSource(manifest)) throw new Error(`the manifest does not declare "byteSource" at apiVersion ${b.apiVersion}: Kino ignores a { source: "plugin" } stream`);
  if (!plugin || typeof plugin[b.export] !== "function") throw new Error(`the plugin does not export ${b.export}(): the install fails with "El plugin no carga: le falta ${b.export}"`);
  const s = byteSourceOf(stream);
  if (!s) throw new Error(BYTE_STREAM_INVALID);
  const problem = readRangeProblem(offset, length, s.size);
  if (problem) throw new Error(`Kino never asks this range: ${problem}`);
  const before = readTurns.get(plugin) || Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`read did not answer within ${timeoutMs / 1000} s: the video stops`)), timeoutMs); });
    try {
      const out = await Promise.race([Promise.resolve().then(() => plugin[b.export]({ handle: s.handle, offset, length })), late]);
      return readAnswer(JSON.parse(JSON.stringify(out === undefined ? null : out)), offset, length, s.size);
    } finally {
      clearTimeout(timer);
    }
  });
  readTurns.set(plugin, run);
  return run;
}

// ---------- imageSource (apiVersion 13): asking a plugin's image export as Kino does ----------

const imageTurns = new WeakMap();

/**
 * Asks `plugin`'s `image({ handle })` for the picture behind `ref` (`{ source: "plugin", handle }`, as your answer carries
 * it), the way Kino's PluginImages does: only for a manifest that declares imageSource at apiVersion 13 and a plugin that
 * exports `image`; one call at a time per plugin; at most contract.images.timeoutMs; the answer checked by `imageAnswer`
 * (canonical base64, at most maxBytes decoded, an allowed mime whose signature the bytes carry). Resolves with
 * `{ bytes: Buffer, mime }`; rejects with an Error naming why Kino would show the placeholder instead. What it does not
 * mirror: the wait behind playback reads, the 5-minute memory of a failed handle and the disk cache (the app's scheduling).
 */
export async function askImage(plugin, manifest, ref, { timeoutMs = contract.images.timeoutMs } = {}) {
  if (!allowsImageRefs(manifest)) throw new Error(`the manifest does not declare "${contract.images.capability}" at apiVersion ${contract.images.apiVersion}: a reference is no image`);
  if (!plugin || typeof plugin[contract.images.export] !== "function") throw new Error(`the plugin does not export ${contract.images.export}(): the install fails with "El plugin no carga: le falta ${contract.images.export}"`);
  const r = imageRefOf(ref);
  if (!r) throw new Error(`not an image reference: { source: "${contract.images.source}", handle } with a handle of 1 to ${contract.images.maxHandleChars} characters and no control character`);
  const before = imageTurns.get(plugin) || Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`image did not answer within ${timeoutMs / 1000} s: Kino shows the placeholder`)), timeoutMs); });
    try {
      const out = await Promise.race([Promise.resolve().then(() => plugin[contract.images.export]({ handle: r.handle })), late]);
      return imageAnswer(JSON.parse(JSON.stringify(out === undefined ? null : out)));
    } finally {
      clearTimeout(timer);
    }
  });
  imageTurns.set(plugin, run);
  return run;
}

// --- kino.room (apiVersion 14, capability "room", Task 8l, contract.kinoRoom) -------------------------------------------------
// The app's rules (PluginRoomPayload, PluginRooms), shared through test/room-cases.json. The kit has no tunnel: createKitRoom is an
// in-memory room with two simulated members, so a plugin's room logic runs offline with the same answers and refusals.

const RL = contract.kinoRoom.limits;
const ROOM_SPACES = /[ \t\n\v\f\r]+/g;
const ROOM_SCRUB = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** The plugin's JSON text as a room payload: `{ ok: true, value }` or `{ ok: false, why }` (PluginRoomPayload.check). */
export function roomPayloadVerdict(text) {
  if (typeof text !== "string") return { ok: false, why: "the payload must be an object" };
  if (Buffer.byteLength(text, "utf8") > RL.maxPayloadBytes) return { ok: false, why: `the payload is over ${RL.maxPayloadBytes} bytes` };
  // Counted on the raw text before parsing, as the app does (PluginRoomPayload.rawDepth): strings skipped.
  if (roomRawDepth(text, RL.maxPayloadDepth) > RL.maxPayloadDepth) return { ok: false, why: `the payload is deeper than ${RL.maxPayloadDepth} levels` };
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, why: "the payload is not JSON" }; }
  if (!plainObject(value)) return { ok: false, why: "the payload must be an object" };
  const depth = (v) => (Array.isArray(v) ? 1 + Math.max(0, ...v.map(depth)) : plainObject(v) ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0);
  if (depth(value) > RL.maxPayloadDepth) return { ok: false, why: `the payload is deeper than ${RL.maxPayloadDepth} levels` };
  return { ok: true, value };
}

/** The deepest nesting of objects and arrays in JSON [text], without parsing (PluginRoomPayload.rawDepth). */
export function roomRawDepth(text, limit) {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") { depth++; if (depth > max) { max = depth; if (max > limit) return max; } }
    else if (c === "}" || c === "]") { if (depth > 0) depth--; }
    // Strict JSON only, as the app (review N1): the words true/false/null whole, else only separators and number characters.
    else if (c === "t" || c === "f" || c === "n") {
      const word = ["true", "false", "null"].find((w) => text.startsWith(w, i));
      if (!word) return Number.MAX_SAFE_INTEGER;
      i += word.length - 1;
    }
    else if (!ROOM_STRICT_OUTSIDE.has(c)) return Number.MAX_SAFE_INTEGER;
  }
  return max;
}
const ROOM_STRICT_OUTSIDE = new Set(":, \t\n\r0123456789+-.eE");

/** A display name as Kino keeps it (PluginRoomPayload.name): breaks as spaces, scrubbed, collapsed, trimmed, at most [max] code points. */
export function roomName(raw, max) {
  const s = String(raw ?? "").replace(ROOM_SPACES, " ").replace(ROOM_SCRUB, "").replace(ROOM_SPACES, " ").trim();
  const points = Array.from(s);
  return points.length <= max ? s : points.slice(0, max).join("").trim();
}

/** A typed room code as Kino reads it (PluginRoomCrypto.normalizeCode): spaces and hyphens dropped, codeDigits.min to .max digits, or null. */
export function roomCode(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[ -]/g, "");
  const D = contract.kinoRoom.codeDigits;
  return new RegExp(`^[0-9]{${D.min},${D.max}}$`).test(s) ? s : null;
}

/** One member's sending budget (RoomRateWindow): perSecond, perMinute and bytesPerMinute. */
function roomRateWindow(now) {
  const sent = [];
  return (bytes) => {
    const t = now();
    while (sent.length && t - sent[0].at >= 60_000) sent.shift();
    if (sent.filter((s) => t - s.at < 1000).length >= RL.perSecond) return false;
    if (sent.length >= RL.perMinute) return false;
    if (sent.reduce((n, s) => n + s.bytes, 0) + bytes > RL.bytesPerMinute) return false;
    sent.push({ at: t, bytes });
    return true;
  };
}

/** A bounded mailbox (RoomMailbox): the last mailboxEvents of the last mailboxMs, seq only grows. */
function roomMailbox(now) {
  const events = [];
  let next = 1;
  const prune = () => { while (events.length && now() - events[0].at > RL.mailboxMs) events.shift(); };
  return {
    add(from, kind, payload, name) {
      prune();
      const e = { seq: next++, from, kind, at: now() };
      if (payload !== undefined) e.payload = payload;
      if (name !== undefined) e.name = name;
      events.push(e);
      while (events.length > RL.mailboxEvents) events.shift();
    },
    after(since, limit) {
      prune();
      const out = events.filter((e) => e.seq > since);
      return { events: out.slice(0, limit).map(({ at, ...e }) => JSON.parse(JSON.stringify(e))), more: out.length > limit };
    },
  };
}

/**
 * The kit's stand-in for the Internet a room lives on: two simulated members. When the plugin opens a room, "Bea" (mbea0001)
 * and "Caro" (mcaro002) join it at once; a test makes them speak with [say] and leave with [leave], and reads what they got in
 * [received]. A room to join is waiting at [remote] (its words and code): its simulated host is "Kit" and "Bea" is a guest
 * there too. Any other words are room_unreachable, a wrong code room_denied.
 */
export function createKitRoom({ now = Date.now } = {}) {
  const sims = [{ memberId: "mbea0001", name: "Bea" }, { memberId: "mcaro002", name: "Caro" }];
  const received = Object.fromEntries(sims.map((s) => [s.memberId, []]));
  const remote = { words: "kit-remote-room-words", code: "111122223333", hostName: "Kit" };
  return { sims, received, remote, now, hosted: null, joined: [], created: new Map(), say: null, leave: null };
}

/** kino.room over [kitRoom] for [manifest] (createKino wires it), with the app's gates. */
function kitRoomApi(manifest, kitRoom, { revoked, callFunction, syncCall, now }) {
  const R = contract.kinoRoom;
  const declared = () => (manifest.capabilities || []).includes(R.capability) && !revoked;
  const deny = (why) => kinoError("permission_denied", `kino.room ${why}`);
  const bad = (why) => kinoError("bad_request", `kino.room: ${why}`);
  const gate = (op) => {
    if (!declared()) throw deny('needs the "room" capability, approved and switched on');
    if (syncCall) throw deny("never answers a background call");
    if ((op === "open" || op === "join") && callFunction !== null && !R.openFrom.includes(callFunction)) throw deny(`.${op} only runs from the person's own action (${R.openFrom.join(", ")})`);
    if (["send", "inbox", "members"].includes(op) && callFunction !== null && !R.trafficFrom.includes(callFunction)) throw deny(`.${op} only runs from an open screen or panel`);
  };
  const intIn = (o, k, min, max, dflt) => {
    if (o[k] === undefined || o[k] === null) return dflt;
    if (!Number.isInteger(o[k]) || o[k] < min || o[k] > max) throw bad(`${k} must be a whole number from ${min} to ${max}`);
    return o[k];
  };
  const opts = (o) => { if (o !== undefined && o !== null && !plainObject(o)) throw bad("the options must be an object"); return o || {}; };
  const select = (o) => {
    const s = o.session;
    let found;
    if (s === undefined || s === null) found = kitRoom.joined[0] || kitRoom.hosted;
    else if (s === R.hostedSession) found = kitRoom.hosted;
    else if (typeof s === "string") found = kitRoom.joined.find((j) => j.handle === s);
    else throw bad('session must be "hosted" or a handle from join');
    if (!found) throw kinoError("room_closed", "kino.room: not in that room");
    return found;
  };
  const membersOf = (session) => session.members.map((m) => ({ memberId: m.memberId, name: m.name, host: m.memberId === R.hostId }));

  kitRoom.say = (memberId, payload, { to } = {}) => {
    const p = roomPayloadVerdict(JSON.stringify(payload));
    if (!p.ok) throw new Error(p.why);
    if (kitRoom.hosted && kitRoom.hosted.members.some((m) => m.memberId === memberId)) kitRoom.hosted.mailbox.add(memberId, "msg", p.value);
    for (const j of kitRoom.joined) if (to === undefined || to === j.memberId) j.mailbox.add(memberId, "msg", p.value);
  };
  kitRoom.leave = (memberId) => {
    for (const s of [kitRoom.hosted, ...kitRoom.joined].filter(Boolean)) {
      if (!s.members.some((m) => m.memberId === memberId)) continue;
      s.members = s.members.filter((m) => m.memberId !== memberId);
      s.mailbox.add(memberId, memberId === R.hostId ? "closed" : "leave");
    }
  };

  const api = {
    async open(options) {
      await null;
      gate("open");
      const o = opts(options);
      const ttl = intIn(o, "ttlMin", RL.minTtlMin, RL.maxTtlMin, RL.defaultTtlMin);
      const max = intIn(o, "max", RL.minMembers, RL.maxMembers, RL.defaultMembers);
      // Task 8w: a shorter code on request (contract.kinoRoom.codeDigits).
      const digits = intIn(o, "codeDigits", R.codeDigits.min, R.codeDigits.max, R.codeDigits.default);
      let code = null;
      let expiresAtMs = now() + ttl * 60_000;
      if (o.code !== undefined) {
        code = roomCode(o.code);
        if (!code) throw bad(`code must be ${R.codeDigits.min} to ${R.codeDigits.max} digits`);
        if (o.codeDigits !== undefined && o.codeDigits !== code.length) throw bad("codeDigits does not match the code");
        const inRoom = kitRoom.joined.find((j) => j.code === code)?.expiresAtMs ?? (kitRoom.created.get(code) > now() ? kitRoom.created.get(code) : undefined);
        if (inRoom === undefined) throw deny(".open: that code is not of a room this plugin is in");
        expiresAtMs = Math.min(expiresAtMs, inRoom);
      }
      if (kitRoom.hosted) throw kinoError("room_busy", "kino.room.open: this device already hosts a room");
      if (kitRoom.joined.length >= RL.maxSlotsPerPlugin) throw kinoError("room_busy", `kino.room: this plugin already holds ${RL.maxSlotsPerPlugin} of this device's rooms`);
      code = code || Array.from({ length: digits }, () => Math.floor(Math.random() * 10)).join("");
      const words = `kit-room-words-${kitRoom.created.size + 1}`;
      const mailbox = roomMailbox(now);
      const hosted = { code, words, expiresAtMs, max, mailbox, rate: roomRateWindow(now), name: roomName(o.name, RL.maxHostNameChars), members: [{ memberId: R.hostId, name: roomName(o.name, RL.maxHostNameChars) }] };
      for (const s of kitRoom.sims.slice(0, max - 1)) { hosted.members.push({ ...s }); mailbox.add(s.memberId, "join", undefined, s.name); }
      kitRoom.hosted = hosted;
      kitRoom.created.set(code, expiresAtMs);
      return { code, words, expiresAtMs };
    },
    async join(options) {
      await null;
      gate("join");
      const o = opts(options);
      const words = typeof o.words === "string" ? o.words.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.trycloudflare\.com$/, "") : "";
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(words)) throw bad("words are the endpoint's words");
      const code = roomCode(o.code);
      if (!code) throw bad(`code must be ${R.codeDigits.min} to ${R.codeDigits.max} digits`);
      const same = kitRoom.joined.find((j) => j.code === code);
      if (!same && kitRoom.joined.length >= RL.maxJoined) throw kinoError("room_busy", `kino.room.join: this device is already in ${RL.maxJoined} rooms`);
      if (!same && kitRoom.joined.length + (kitRoom.hosted ? 1 : 0) >= RL.maxSlotsPerPlugin) throw kinoError("room_busy", `kino.room: this plugin already holds ${RL.maxSlotsPerPlugin} of this device's rooms`);
      if (kitRoom.hosted && kitRoom.hosted.words === words) throw bad("that is this device's own room");
      if (words !== kitRoom.remote.words) throw kinoError("room_unreachable", "kino.room: the room can't be reached");
      // Task 8w: after limits.maxFailedJoins wrong codes in all, the remote room closes itself, as the app's host does.
      if (kitRoom.remote.closed) throw kinoError("room_closed", "kino.room: the room is closed");
      if (code !== kitRoom.remote.code) {
        kitRoom.remote.failedJoins = (kitRoom.remote.failedJoins || 0) + 1;
        if (kitRoom.remote.failedJoins >= RL.maxFailedJoins) kitRoom.remote.closed = true;
        throw kinoError("room_denied", "kino.room: wrong code");
      }
      if (same) kitRoom.joined.splice(kitRoom.joined.indexOf(same), 1);
      const memberId = "mkit" + String(kitRoom.joined.length + 1).padStart(4, "0");
      const handle = "jkit" + String(Date.now() % 1000).padStart(3, "0") + kitRoom.joined.length;
      const session = {
        handle, code, words, memberId, expiresAtMs: now() + RL.defaultTtlMin * 60_000, mailbox: roomMailbox(now), rate: roomRateWindow(now),
        hostName: kitRoom.remote.hostName,
        members: [{ memberId: R.hostId, name: kitRoom.remote.hostName }, { ...kitRoom.sims[0] }, { memberId, name: roomName(o.name, RL.maxMemberNameChars) }],
      };
      kitRoom.joined.push(session);
      return { handle, memberId, host: { name: session.hostName }, expiresAtMs: session.expiresAtMs };
    },
    async send(payload, options) {
      await null;
      gate("send");
      if (!plainObject(payload)) throw bad("the payload must be an object");
      const text = JSON.stringify(payload);
      const v = roomPayloadVerdict(text);
      if (!v.ok) throw bad(v.why);
      const o = opts(options);
      if (o.to !== undefined && o.to !== null && typeof o.to !== "string") throw bad("to must be a member id");
      const session = select(o);
      const bytes = Buffer.byteLength(text, "utf8");
      if (session === kitRoom.hosted) {
        const targets = o.to === undefined || o.to === null || o.to === "all" ? session.members.filter((m) => m.memberId !== R.hostId) : session.members.filter((m) => m.memberId === o.to && m.memberId !== R.hostId);
        if (!targets.length && o.to !== undefined && o.to !== null && o.to !== "all") throw bad("that member id is not in the room");
        if (!session.rate(bytes)) throw kinoError("rate_limited", "kino.room.send: too many messages");
        for (const t of targets) (kitRoom.received[t.memberId] ||= []).push(v.value);
      } else {
        if (o.to !== undefined && o.to !== null && o.to !== R.hostId && o.to !== "all") throw bad('a guest writes to the host or to "all"');
        if (!session.rate(bytes)) throw kinoError("rate_limited", "kino.room.send: too many messages");
        (kitRoom.received[R.hostId] ||= []).push(v.value);
      }
      return undefined;
    },
    async inbox(options) {
      await null;
      gate("inbox");
      const o = opts(options);
      const since = Number.isFinite(o.since) ? Math.max(0, Math.floor(o.since)) : 0;
      const limit = intIn(o, "limit", 1, RL.maxInboxLimit, RL.defaultInboxLimit);
      const { events, more } = select(o).mailbox.after(since, limit);
      return { events, last: events.length ? events[events.length - 1].seq : since, more, reachable: true };
    },
    async members(options) {
      await null;
      gate("members");
      return membersOf(select(opts(options)));
    },
    async close(options) {
      await null;
      gate("close");
      const o = opts(options);
      let session;
      try { session = select(o); } catch { return undefined; }
      if (session === kitRoom.hosted) kitRoom.hosted = null;
      else kitRoom.joined.splice(kitRoom.joined.indexOf(session), 1);
      return undefined;
    },
    async state() {
      await null;
      gate("state");
      const h = kitRoom.hosted;
      return {
        role: h ? "host" : kitRoom.joined.length ? "guest" : "none",
        joined: kitRoom.joined.map((j) => ({ handle: j.handle, memberId: j.memberId, host: { name: j.hostName }, expiresAtMs: j.expiresAtMs, reachable: true })),
        hosted: h ? { code: h.code, words: h.words, expiresAtMs: h.expiresAtMs, members: h.members.length } : null,
      };
    },
  };
  return Object.freeze(api);
}

// --- kino.ai (apiVersion 14, capability "ai", Task 8r, contract.kinoAi) --------------------------------------------------------
// The app's rules (PluginAiBridge), shared through test/ai-cases.json. The kit has no AI: [model] is a fake that answers canned
// replies or errors, so a plugin's parsing, validation and fallbacks run offline with the app's refusals and limits.

const AL = contract.kinoAi.limits;
const AI_BAD = `kino.ai.ask takes { prompt: a non-empty string, system?: a string, json?: true or false, maxChars?: a whole number from 1 to ${AL.maxChars} }`;
/** What the kit's fake answers when nobody set one (KINO_AI_REPLY, KINO_AI_ERROR or createKino's `ai`). */
export const KIT_AI_MODEL = "kit/fake";
export const KIT_AI_REPLY = "(kit) Kino's text AI is not in the kit: set KINO_AI_REPLY or pass ai to createKino";

/** UTF-8 bytes, as the app counts a prompt (PluginJobs.utf8Bytes): a lone surrogate counts 3. */
export const aiBytes = (s) => Buffer.byteLength(String(s), "utf8");

/**
 * The request [options] as the app reads it (prelude.js, PluginAiBridge.parse): `{ ok: true, request: { prompt, system, json,
 * maxChars } }` or `{ ok: false, error, message }`.
 */
export function aiRequestVerdict(options) {
  const fail = (error, message) => ({ ok: false, error, message });
  if (!plainObject(options)) return fail("refused", AI_BAD);
  const { prompt, system, json, maxChars } = options;
  if (typeof prompt !== "string" || prompt.length === 0) return fail("refused", AI_BAD);
  if (system !== undefined && system !== null && typeof system !== "string") return fail("refused", AI_BAD);
  if (json !== undefined && json !== null && typeof json !== "boolean") return fail("refused", AI_BAD);
  if (maxChars !== undefined && maxChars !== null && !(Number.isInteger(maxChars) && maxChars >= 1 && maxChars <= AL.maxChars)) return fail("refused", AI_BAD);
  if (aiBytes(prompt) > AL.maxPromptBytes) return fail("too_large", `kino.ai.ask: the prompt is over ${AL.maxPromptBytes} bytes`);
  if (typeof system === "string" && aiBytes(system) > AL.maxSystemBytes) return fail("too_large", `kino.ai.ask: the system text is over ${AL.maxSystemBytes} bytes`);
  return { ok: true, request: { prompt, system: typeof system === "string" && system.length ? system : null, json: json === true, maxChars: maxChars ?? AL.defaultMaxChars } };
}

/** [text] cut to at most [maxChars] UTF-16 units, never inside a surrogate pair (PluginAi.cut). */
export function aiCut(text, maxChars) {
  if (text.length <= maxChars) return text;
  const c = text.charCodeAt(maxChars - 1);
  return text.slice(0, c >= 0xD800 && c <= 0xDBFF ? maxChars - 1 : maxChars);
}

/**
 * kino.ai for [manifest] (createKino wires it), with the app's gates: the capability and [revoked] (KINO_AI_REVOKED=1), the origin
 * ([origin]: aiOriginAllowed over the running export and its screen marks; a sync call never), the request, a job run's request
 * budget ([origin]'s `takeRequest`, job.mjs), one in flight, perMinute and perDay, timeoutMs. [model] is the fake:
 * `async ({ system, prompt, json, maxChars }) => string | { text, model? } | { error, message? } | null` (null: unavailable);
 * without it, env KINO_AI_ERROR (an error code) or KINO_AI_REPLY (the reply), else [KIT_AI_REPLY] ("{}" when json is asked).
 */
/**
 * Device-wide counters (PluginAiBridge's DEVICE_KEY count and its in-flight count). The kit runs one plugin, so each kitAiApi gets
 * its own by default; pass the same [kitAiDevice] to several to see the device-wide caps (contract.kinoAi.limits.devicePerDay,
 * deviceMaxInFlight) across plugins.
 */
export function kitAiDevice() { return { day: -1, used: 0, inFlight: 0 }; }

export function kitAiApi(manifest, { model = undefined, revoked = false, origin = () => ({}), syncCall = false, env = process.env, now = Date.now, timeoutMs = AL.timeoutMs, device = kitAiDevice() } = {}) {
  // A strict sliding window: at most perMinute asks in any 60 s (PluginAiBridge.takeWindow).
  const window = [];
  const takeWindow = () => {
    const t = now();
    while (window.length && t - window[0] >= 60_000) window.shift();
    if (window.length >= AL.perMinute) return false;
    window.push(t);
    return true;
  };
  let day = -1, used = 0, inFlight = false;
  const fail = (error, message) => Object.freeze({ ok: false, error, message });
  const fake = typeof model === "function" ? model : async ({ json }) => {
    if (env.KINO_AI_ERROR) return { error: env.KINO_AI_ERROR };
    if (typeof env.KINO_AI_REPLY === "string") return env.KINO_AI_REPLY;
    return json ? "{}" : KIT_AI_REPLY;
  };
  async function ask(options) {
    await null;
    const o = origin();
    if (syncCall || !aiOriginAllowed(o)) return fail("refused", `kino.ai.ask only runs from the person's own action (${contract.kinoAi.fromFunctions.join(", ")}) or a scheduled job`);
    if (!(manifest.capabilities || []).includes(contract.kinoAi.capability) || revoked || env.KINO_AI_REVOKED === "1") {
      return fail("refused", 'kino.ai.ask needs the "ai" capability, approved and switched on by the person');
    }
    const v = aiRequestVerdict(options);
    if (!v.ok) return fail(v.error, v.message);
    if (inFlight) return fail("rate_limited", "kino.ai.ask: one ask at a time");
    inFlight = true;
    let deviceSlot = false;
    try {
      if (device.inFlight >= AL.deviceMaxInFlight) return fail("rate_limited", "kino.ai.ask: Kino's text AI is busy with other plugins, try again shortly");
      device.inFlight++;
      deviceSlot = true;
      const today = Math.floor(now() / 86_400_000);
      if (today !== day) { day = today; used = 0; }
      if (today !== device.day) { device.day = today; device.used = 0; }
      if (used >= AL.perDay) return fail("rate_limited", `kino.ai.ask: at most ${AL.perDay} asks a day`);
      if (device.used >= AL.devicePerDay) return fail("rate_limited", `kino.ai.ask: this device's plugins already made ${AL.devicePerDay} asks today`);
      // A job's request is taken only once the ask passes the limits above (PluginAiBridge, fix round 1 M2).
      if (!takeWindow()) return fail("rate_limited", `kino.ai.ask: at most ${AL.perMinute} asks a minute`);
      if (typeof o.takeRequest === "function" && !o.takeRequest()) return fail("rate_limited", `kino.ai.ask: a scheduled job makes at most ${contract.kinoJobs.limits.maxFetches} requests per run`);
      used++;
      device.used++;
      const r = v.request;
      const system = [r.system, r.json ? contract.kinoAi.jsonInstruction : null].filter((s) => s).join("\n\n") || null;
      let timer;
      const late = new Promise((resolveLate) => { timer = setTimeout(() => resolveLate({ late: true }), timeoutMs); });
      let answer;
      try {
        answer = await Promise.race([Promise.resolve().then(() => fake({ system, prompt: r.prompt, json: r.json, maxChars: r.maxChars })), late]);
      } catch {
        answer = null;
      } finally {
        clearTimeout(timer);
      }
      if (answer && answer.late === true) return fail("timeout", `kino.ai.ask: no answer within ${timeoutMs / 1000} s`);
      if (answer && typeof answer === "object" && typeof answer.error === "string") {
        const code = contract.kinoAi.errorCodes.includes(answer.error) ? answer.error : "refused";
        return fail(code, typeof answer.message === "string" ? answer.message : `kino.ai.ask: ${code} (the kit's fake)`);
      }
      const text = typeof answer === "string" ? answer : answer && typeof answer.text === "string" ? answer.text : null;
      if (text === null) return fail("unavailable", "kino.ai.ask: Kino's text AI could not answer now");
      const name = answer && typeof answer === "object" && typeof answer.model === "string" ? answer.model : KIT_AI_MODEL;
      return Object.freeze({ ok: true, text: aiCut(text, r.maxChars), model: name });
    } finally {
      if (deviceSlot) device.inFlight--;
      inFlight = false;
    }
  }
  return Object.freeze({ ask });
}
