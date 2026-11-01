// kino.coins (apiVersion 16, capability "coins", contract.kinoCoins): the kit's stand-in for Kino's free coin, with the app's rules
// (PluginCoins): the capability and the revoke switch, the calls that may give (screen, screenEvent, panelAction) or read the balance
// (those plus the job), the request shape, and perMinute calls a minute. There is no coins service here: the balance is a fixed
// pretend one that giving lowers by one (KINO_COINS_BALANCE sets the start, KINO_COINS_DISABLED=1 is the profile's switch off).
import { contract } from "./contract.mjs";

const C = contract.kinoCoins;
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const inRange = (v, max) => typeof v === "string" && v.length >= 1 && v.length <= max;

function codedError(code, message) {
  const e = new Error(message);
  Object.defineProperty(e, "code", { value: code, enumerable: true });
  e.name = "KinoError_" + code;
  return e;
}

/**
 * kino.coins for [manifest]: `balance()` and `give({ to, postId })`, rejecting with the app's codes. [origin]() names the export
 * running ({ fn }); [revoked] or KINO_COINS_REVOKED=1: the person revoked the plugin's approval.
 */
export function kitCoinsApi(manifest, { origin = () => ({}), revoked = false, env = process.env, now = Date.now } = {}) {
  let balance = Number.isInteger(Number(env.KINO_COINS_BALANCE)) && env.KINO_COINS_BALANCE !== undefined && env.KINO_COINS_BALANCE !== "" ? Number(env.KINO_COINS_BALANCE) : 5;
  const earnedToday = 3;
  const given = new Map();
  const calls = [];
  const gate = (allowed, what) => {
    if (!(manifest.capabilities || []).includes(C.capability) || revoked || env.KINO_COINS_REVOKED === "1") {
      throw codedError("permission_denied", 'kino.coins needs the "coins" capability, approved by the person');
    }
    if (env.KINO_COINS_DISABLED === "1") throw codedError("disabled", C.disabledMessage);
    const fn = origin().fn;
    if (!allowed.includes(fn)) throw codedError("permission_denied", `kino.coins.${what} only answers inside ${allowed.join(", ")}`);
    const t = now();
    while (calls.length && t - calls[0] >= 60_000) calls.shift();
    if (calls.length >= C.perMinute) throw codedError("rate_limited", `kino.coins answers ${C.perMinute} calls a minute`);
    calls.push(t);
  };
  return {
    balance: async () => {
      gate(C.balanceFromFunctions, "balance");
      return { balance, earnedToday, capToday: 20 };
    },
    give: async (gift) => {
      gate(C.giveFromFunctions, "give");
      if (!plainObject(gift) || Object.keys(gift).some((k) => k !== "to" && k !== "postId") || !inRange(gift.to, C.maxToChars) || !inRange(gift.postId, C.maxPostIdChars)) {
        throw codedError("bad_request", C.badRequestMessage);
      }
      if (balance < 1) throw codedError("no_balance", "no coin to give");
      balance -= 1;
      given.set(gift.postId, (given.get(gift.postId) || 0) + 1);
      return { balance, postTotal: given.get(gift.postId) };
    },
  };
}
