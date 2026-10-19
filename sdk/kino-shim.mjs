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
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anyFetchRefusal, anyHostBudget, contract, fetchAnyHost, hostMatches, isUserServer, kb, schemeAllowed } from "./contract.mjs";
import { decodeCipherKey } from "./seal.mjs";
import { filterRelevant, shortQuery, sortBySimilarity } from "./kino-rank.mjs";

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

const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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
 * kino.meta / kino.tmdb (Kino 0.9.53): [metaFixture] (an object, or a file path; default env KINO_META_FIXTURE) answers
 * kino.meta offline -- keys `"<type>:<idKey>:<value>"` or `"<idKey>:<value>"` (`"movie:imdb:tt0133093"`, `"tmdb:603"`), and
 * for a lookup by title (Kino 0.9.55) `"<type>:title:<normalised title>:<year>"` or without the year (`"movie:title:the matrix:1999"`) --
 * and without it kino.meta answers null (the kit has no TMDB/AniList of Kino's own and no other plugins). [tmdbKey]
 * (default [kitTmdbKey]) stands in for Kino's own TMDB key; [tmdbFixture] (an object or a file; default env KINO_TMDB_FIXTURE)
 * answers kino.tmdb offline, keyed `"<path>?<sorted query>"` or `"<path>"`, standing in for TMDB and a configured key.
 * [now] is the clock of their rate limits and cache.
 *
 * kino.device (Kino 0.9.55, contract.kinoDevice): [device] ("phone" or "tv", run.mjs --device), else env KINO_DEVICE,
 * else "phone". Anything else throws: a typo must not silently test the other UI.
 */
export function createKino(manifest, { appVersion = "sdk", lang = "es-CO", device = undefined, storageFile = null, cookiesFile = null, secretsFile = null, config = {}, record = null, replay = null, fetchImpl = globalThis.fetch, metaFixture = undefined, tmdbKey = undefined, tmdbFixture = undefined, env = process.env, now = Date.now } = {}) {
  const f = contract.fetch;
  const kinoDevice = deviceFor(device, env);
  const storage = loadJson(storageFile, {});
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
  for (const s of manifest.settings || []) {
    if (contract.settings.types[s.type]?.hasValue === false) continue; // section/status/action hold no value
    // A url setting never takes a manifest default (the app refuses one): only a typed server counts.
    const v = config[s.key] !== undefined ? config[s.key] : s.default !== undefined && contract.settings.types[s.type]?.canHaveDefault !== false ? s.default : s.type === "toggle" ? false : s.type === "select" ? s.options[0].value : undefined;
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

  const textual = (type) => !type || /charset=/i.test(type) || /^text\//i.test(type) || /[/+](json|xml)\b/i.test(type) || /javascript|x-www-form-urlencoded/i.test(type);

  function response(status, url, headerList, bytes) {
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
    let carriesSecret = false;
    // The size cap is checked BEFORE any substitution, on every body kind alike -- exactly like the
    // app, where the prelude computes it on the marker-laden request before it ever crosses to the
    // Kotlin side that substitutes.
    let body = requestBody(o.body, headers);
    const size = String(url).length + JSON.stringify(headers).length + (body ? (typeof body === "string" ? body.length : body.length * 2) : 0);
    if (size > f.maxRequestChars) throw kinoError("too_large", `request too large (over ${kb(f.maxRequestChars)})`);
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
          bytes = Buffer.from(await r.arrayBuffer());
        } catch (e) {
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
      if (bytes.length > f.maxBodyBytes) throw kinoError("too_large", `response too large (over ${kb(f.maxBodyBytes)})`);
      const location = headerList.find(([k]) => k === "location");
      if ([301, 302, 303, 307, 308].includes(status) && location && redirect === "follow") {
        if (status === 303 || ((status === 301 || status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        previous = current;
        current = new URL(location[1], current);
        continue;
      }
      return response(status, current.toString(), headerList, bytes);
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
    // apiVersion 6's key pairs: the kit reports apiVersion contract.apiVersion, so they are here whenever the app's are.
    ...(contract.apiVersion >= KP.apiVersion ? keyPairApi({ pluginSecrets, buf }) : {}),
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
        const previous = storage[k];
        storage[k] = expiresAt === undefined ? value : { v: value, e: expiresAt };
        if (Buffer.byteLength(JSON.stringify(storage)) > contract.storage.maxTotalBytes) {
          if (previous === undefined) delete storage[k]; else storage[k] = previous;
          throw kinoError("too_large", `plugin storage full (${kb(contract.storage.maxTotalBytes)})`);
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
  };
}

/**
 * The app's signing lane (SigningLaneHost + prelude.js): sign() gets kino.crypto, kino.secret,
 * kino.config, kino.html and kino.log, never the network, storage, cookies, sleep, kino.meta or kino.tmdb. The refusals
 * are the app's: fetch rejects with host_not_allowed, the rest with not_allowed.
 */
export function signingLane(kino) {
  const why = (api) => kinoError("not_allowed", `sign() can't use ${api}: whatever you need must come in signContext`);
  const refused = (api) => () => { throw why(api); };
  const methods = (names, api) => Object.freeze(Object.fromEntries(names.map((n) => [n, refused(api)])));
  return Object.freeze({
    ...kino,
    fetch: async () => { throw kinoError("host_not_allowed", "sign can't use the network"); },
    storage: methods(["get", "set", "remove", "keys"], "kino.storage"),
    cookies: methods(["get", "clear"], "kino.cookies"),
    sleep: async () => { throw why("kino.sleep"); },
    meta: async () => { throw why("kino.meta"); },
    tmdb: async () => { throw why("kino.tmdb"); },
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
