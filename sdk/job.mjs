// Task 8q: a plugin job's run as Kino makes it (PluginJobKernel + JobRunBudget + the runtime's job bindings), for the kit's
// `node sdk/run.mjs <folder> job [id] [scheduled|manual]` and its tests. The plugin gets a `kino` whose fetch and storage count
// against the run's caps and whose forbidden APIs reject with not_allowed; a cap crossed cuts the run (a failure), and the
// answer of job(ctx) is never read. Shared cases: test/job-cases.json (run by the app too).
import { contract } from "./contract.mjs";
import { kitJobRequest } from "./kit-call.mjs";

const J = contract.kinoJobs;

/** JobRunBudget: the first cap crossed stays; every later fetch or write is refused. */
export function jobBudget({ maxFetches = J.limits.maxFetches, maxBytes = J.limits.maxResponseBytes, maxStorage = J.limits.maxStorageWriteBytes } = {}) {
  let fetches = 0, bytes = 0, storage = 0, exceeded = null, onCross = () => {};
  const cross = (why) => { if (exceeded === null) { exceeded = why; onCross(why); } return false; };
  return {
    takeFetch() { if (exceeded !== null) return false; if (fetches >= maxFetches) return cross("cap_fetches"); fetches++; return true; },
    addResponse(n) { bytes += Math.max(0, n); if (bytes > maxBytes) return cross("cap_bytes"); return exceeded === null; },
    takeStorage(n) { if (exceeded !== null) return false; if (storage + n > maxStorage) return cross("cap_storage"); storage += n; return true; },
    bytesLeft() { return Math.max(0, maxBytes - bytes); },
    crossBytes() { cross("cap_bytes"); },
    get exceeded() { return exceeded; },
    get fetches() { return fetches; },
    get bytes() { return bytes; },
    get stored() { return storage; },
    set onCross(f) { onCross = f; },
  };
}

/** A kino error as the app's prelude throws it (`code`, `message`). */
function kinoError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** The `ctx` job(ctx) receives (contract.kinoJobs.contextFields). */
export function jobContext(id, reason = "scheduled", { lastRunMs = null, attempt = 1 } = {}) {
  if (!J.reasons.includes(reason)) throw new Error(`a job's reason is ${J.reasons.join(" or ")}`);
  return { id, reason, lastRunMs, attempt };
}

/** UTF-8 bytes of a string, as the app counts a job's storage writes and answer bodies. */
const utf8 = (s) => Buffer.byteLength(String(s), "utf8");

/**
 * [kino] as a job's call sees it (fix round 1): an ALLOW-list, like the app's PluginJobs.ALLOWED_NATIVES. Only
 * contract.kinoJobs.availableApis and readOnly keep their own value; every other key rejects (or throws) not_allowed and is
 * [log]ged by name. Fetches run one at a time, each answer's body counted in bytes and refused (never handed over) when it
 * would cross what is left of the run's budget; storage writes count UTF-8 bytes of the key and the value.
 */
export function jobKino(kino, budget, log = () => {}) {
  const refuse = (api) => { log(`Kino: ${api} is not available in a scheduled job (refused)`); return kinoError("not_allowed", `${api} can't be used in a scheduled job`); };
  const asyncRefused = (api) => async () => { await null; throw refuse(api); };
  const syncRefused = (api) => () => { throw refuse(api); };
  const limitError = () => budget.exceeded === "cap_bytes"
    ? kinoError("too_large", `this scheduled job already read ${J.limits.maxResponseBytes / (1024 * 1024)} MB of answers`)
    : budget.exceeded === "cap_storage" ? kinoError("too_large", `this scheduled job already wrote its ${J.limits.maxStorageWriteBytes / 1024} KB`)
      : kinoError("rate_limited", `a scheduled job makes at most ${J.limits.maxFetches} requests per run`);
  const keep = new Set([...J.availableApis, ...J.readOnly].map((a) => a.replace(/^kino\./, "")));
  const out = {};
  for (const [name, value] of Object.entries(kino)) {
    if (keep.has(name)) { out[name] = value; continue; }
    const api = `kino.${name}`;
    if (typeof value === "function") out[name] = asyncRefused(api);
    else if (value !== null && typeof value === "object") out[name] = new Proxy({}, { get: () => asyncRefused(api) });
    else out[name] = value; // a plain value (a version, a flag) reaches nothing
  }
  let chain = Promise.resolve();
  out.fetch = (url, opts) => {
    if (!budget.takeFetch()) return Promise.reject(limitError());
    const run = chain.then(async () => {
      if (budget.exceeded !== null) throw limitError();
      const r = await kino.fetch(url, opts);
      let text = "";
      try { text = await r.text(); } catch { text = ""; }
      const size = utf8(text);
      if (size > budget.bytesLeft()) { budget.crossBytes(); throw kinoError("too_large", `response too large (this scheduled job's answers are over ${J.limits.maxResponseBytes / (1024 * 1024)} MB)`); }
      budget.addResponse(size);
      return r;
    });
    chain = run.catch(() => {});
    return run;
  };
  if (kino.storage) {
    out.storage = Object.freeze({
      ...kino.storage,
      set(key, value, options) {
        const n = utf8(key) + utf8(value);
        if (!budget.takeStorage(n)) throw kinoError("too_large", `this scheduled job already wrote its ${J.limits.maxStorageWriteBytes / 1024} KB`);
        return kino.storage.set(key, value, options);
      },
    });
  }
  // Task 8r: kino.ai.ask answers a job with the plugin's own approval, each ask one of the run's requests (PluginAiBridge).
  if (kino.ai) out.ai = Object.freeze({ ask: (options) => kitJobRequest.run(() => budget.takeFetch(), () => kino.ai.ask(options)) });
  // The sync ones throw at once, as the app's prelude does for a synchronous binding. kino.seed (Task 18, G2) is allowed: it
  // keeps the kit's own report of what Kino would send (only with the plugin's telemetry consent).
  if ("sync" in kino) out.sync = Object.freeze({ remoteChanged: syncRefused("kino.sync") });
  return Object.freeze(out);
}

/**
 * Runs [plugin].job([ctx]) as the app does: at most [timeoutMs], cut the moment [budget] crosses a cap. `{ ok, failure, ms }`:
 * failure is a contract.kinoJobs.failureCodes code (the plugin's own text never reaches the person).
 */
export async function runJob(plugin, ctx, budget, timeoutMs = J.limits.runTimeoutMs) {
  const started = Date.now();
  let timer;
  let cut;
  const limits = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    budget.onCross = (why) => resolve(why);
    cut = resolve;
  });
  let failure;
  try {
    failure = await Promise.race([
      Promise.resolve().then(() => plugin.job(ctx)).then(() => budget.exceeded, (e) => budget.exceeded ?? (e && ["network", "timeout", "dns", "offline"].includes(e.code) ? "network" : "plugin_error")),
      limits,
    ]);
  } finally {
    clearTimeout(timer);
    cut(null);
  }
  return { ok: failure === null || failure === undefined, failure: failure ?? null, ms: Date.now() - started };
}
