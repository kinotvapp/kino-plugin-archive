// node --test plugins/sdk/test/kino-nuvio.test.mjs   (Node 18+)
// kino.nuvio (Kino 0.9.71, apiVersion 11, capability "nuvio"): the kit's stand-in checks what the app checks and answers from a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKino, signingLane } from "../kino-shim.mjs";
import { unguardedServiceNotes } from "../validate.mjs";

// The same sample as docs/plugins/fixtures/kino-services/nuvio.json, inline so this test runs wherever the kit does.
const FIXTURE = {
  "owner/nuvio-repository": {
    "available": [
      {
        "id": "alpha",
        "name": "Alpha",
        "description": "Movies and series, English",
        "types": [
          "movie",
          "tv"
        ],
        "languages": [
          "en"
        ]
      },
      {
        "id": "beta",
        "name": "Beta",
        "description": "Movies, Spanish",
        "types": [
          "movie"
        ],
        "languages": [
          "es"
        ]
      },
      {
        "id": "gamma",
        "name": "Gamma (torrents)",
        "description": "Torrent-only: Kino never installs it",
        "types": [
          "movie"
        ],
        "languages": [
          "en"
        ],
        "compatible": false
      }
    ],
    "streams": {
      "alpha": {
        "movie:603": {
          "url": "https://cdn.example.com/matrix-1080.m3u8",
          "mime": "application/x-mpegURL",
          "label": "1080p"
        },
        "series:1399:1:1": {
          "url": "https://cdn.example.com/got-s01e01.m3u8",
          "label": "720p"
        }
      },
      "beta": {
        "movie:603": {
          "url": "https://other.example.net/matrix.mp4",
          "label": "480p",
          "subtitles": [
            {
              "lang": "es",
              "url": "https://other.example.net/matrix.es.vtt"
            }
          ]
        },
        "movie:604": {
          "error": {
            "code": "not_found",
            "message": "the site has no such title"
          }
        },
        "movie:605": {
          "url": "https://other.example.net/slow.mp4",
          "delayMs": 90000
        }
      }
    }
  }
};
const REPO = "owner/nuvio-repository";
const MANIFEST = { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 11, entry: "plugin.js", hosts: ["example.com"], streamHosts: "any", capabilities: ["search", "resolve", "nuvio"], nuvioRepos: [REPO] };

const kinoWith = (manifest = MANIFEST, opts = {}) => createKino(manifest, { env: {}, nuvioFixture: FIXTURE, ...opts }).kino;

async function code(promise) {
  try {
    await promise;
  } catch (e) {
    return e.code;
  }
  return "no error";
}

test("kino.nuvio is an object (feature detection) and the signing lane refuses it", async () => {
  const kino = kinoWith();
  assert.equal(typeof kino.nuvio, "object");
  assert.equal(await code(signingLane(kino).nuvio.streams({ repo: REPO, type: "movie", tmdbId: 603 })), "not_allowed");
});

test("without the capability or with a repository the manifest does not name: not_allowed", async () => {
  const noCap = kinoWith({ ...MANIFEST, capabilities: ["search", "resolve"], nuvioRepos: undefined });
  assert.equal(await code(noCap.nuvio.available({ repo: REPO })), "not_allowed");
  assert.equal(await code(kinoWith().nuvio.available({ repo: "someone/else" })), "not_allowed");
});

test("invalid queries: invalid_request", async () => {
  const kino = kinoWith();
  assert.equal(await code(kino.nuvio.available({})), "invalid_request");
  assert.equal(await code(kino.nuvio.available({ repo: "x".repeat(5000) })), "invalid_request");
  assert.equal(await code(kino.nuvio.use({ repo: REPO, scrapers: [] })), "invalid_request");
  assert.equal(await code(kino.nuvio.streams({ repo: REPO, type: "radio", tmdbId: 603 })), "invalid_request");
  assert.equal(await code(kino.nuvio.streams({ repo: REPO, type: "movie", tmdbId: 0 })), "invalid_request");
  assert.equal(await code(kino.nuvio.streams({ repo: REPO, type: "series", tmdbId: 1399 })), "invalid_request");
  assert.equal(await code(kino.nuvio.streams({ repo: REPO, type: "movie", tmdbId: 603, timeoutMs: 100 })), "invalid_request");
});

test("without a fixture the repository cannot be read: unavailable", async () => {
  const kino = createKino(MANIFEST, { env: {} }).kino;
  assert.equal(await code(kino.nuvio.available({ repo: REPO })), "unavailable");
});

test("available lists what the repository offers; use installs the compatible ones and refuses torrent-only ones", async () => {
  const kino = kinoWith();
  const offered = await kino.nuvio.available({ repo: REPO });
  assert.deepEqual(offered.map((o) => [o.id, o.compatible, o.installed]), [["alpha", true, false], ["beta", true, false], ["gamma", false, false]]);
  const used = await kino.nuvio.use({ repo: REPO, scrapers: ["alpha", "gamma", "nope"] });
  assert.deepEqual(used.ready, ["alpha"]);
  assert.deepEqual(used.failed.map((f) => [f.id, f.code]), [["gamma", "refused"], ["nope", "not_found"]]);
  assert.deepEqual(await kino.nuvio.scrapers({ repo: REPO }), [{ id: "alpha", name: "Alpha" }]);
  assert.equal((await kino.nuvio.available({ repo: REPO })).find((o) => o.id === "alpha").installed, true);
});

test("streams: one entry per installed scraper; a missing, failing or slow scraper is an entry, never a throw", async () => {
  const kino = kinoWith();
  await kino.nuvio.use({ repo: REPO, scrapers: ["alpha", "beta"] });
  const matrix = await kino.nuvio.streams({ repo: REPO, type: "movie", tmdbId: 603 });
  assert.equal(matrix.truncated, false);
  assert.deepEqual(matrix.results.map((r) => [r.scraper.id, r.ok]), [["alpha", true], ["beta", true]]);
  assert.equal(matrix.results[0].stream.url, "https://cdn.example.com/matrix-1080.m3u8");
  assert.equal(matrix.results[1].stream.subtitles[0].lang, "es");
  const failing = await kino.nuvio.streams({ repo: REPO, type: "movie", tmdbId: 604 });
  assert.deepEqual(failing.results.map((r) => [r.ok, r.code]), [[false, "not_found"], [false, "not_found"]]);
  assert.equal(failing.results[1].message, "the site has no such title");
  const slow = await kino.nuvio.streams({ repo: REPO, type: "movie", tmdbId: 605, timeoutMs: 15000 });
  assert.equal(slow.results[1].code, "timeout");
  const episode = await kino.nuvio.streams({ repo: REPO, type: "series", tmdbId: 1399, season: 1, episode: 1, scrapers: ["alpha"] });
  assert.deepEqual(episode.results.map((r) => [r.scraper.id, r.ok]), [["alpha", true]]);
});

test("limits: 20 calls a minute per plugin", async () => {
  const kino = kinoWith();
  for (let i = 0; i < 20; i++) await kino.nuvio.available({ repo: REPO });
  assert.equal(await code(kino.nuvio.available({ repo: REPO })), "rate_limited");
});

test("validate warns when kino.nuvio is used without checking it exists", () => {
  assert.equal(unguardedServiceNotes("const a = await kino.nuvio.available({ repo: R });").length, 1);
  assert.equal(unguardedServiceNotes('if (typeof kino.nuvio === "object") await kino.nuvio.available({ repo: R });').length, 0);
});
