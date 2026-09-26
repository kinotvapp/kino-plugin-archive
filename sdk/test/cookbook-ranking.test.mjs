// node --test plugins/sdk/test/cookbook-ranking.test.mjs   (Node 18+)
//
// Exercises the recipe from docs/plugins/README.md's Cookbook (§11): "A search backend that
// matches by loose shared words, not by title". The code between the markers below is a literal
// copy of the guide's code block: nothing here imports it, because a Kino plugin has no
// shared-module mechanism to import it from either (that is the whole reason it is a copy-paste
// recipe and not a `kino.*` API). Keep the two in sync by hand if either changes.
import { test } from "node:test";
import assert from "node:assert/strict";

// --- start of the guide's code block (docs/plugins/README.md, §11) ---

const FOLD_ACCENTS = {
  á: "a", à: "a", ä: "a", â: "a", é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i", ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u", ñ: "n", ç: "c",
};

function titleTokens(text) {
  const plain = String(text || "").toLowerCase().replace(/[áàäâéèëêíìïîóòöôõúùüûñç]/g, (c) => FOLD_ACCENTS[c]);
  return new Set((plain.match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2));
}

function tokensOf(titleOf, item) {
  const tokens = new Set();
  for (const form of [].concat(titleOf(item))) for (const t of titleTokens(form)) tokens.add(t);
  return tokens;
}

function sharedCount(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function sortBySimilarity(items, titles, titleOf) {
  const requested = titles.map(titleTokens).filter((t) => t.size > 0);
  if (requested.length === 0) return items;
  return items
    .map((item, index) => {
      const ofItem = tokensOf(titleOf, item);
      return { item, index, score: Math.max(...requested.map((r) => sharedCount(r, ofItem))) };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}

const MIN_RELEVANCE = 0.6;

function filterRelevant(items, titles, titleOf) {
  const forms = titles.map(titleTokens).filter((t) => t.size > 0);
  if (forms.length === 0) return items;
  return items.filter((item) => {
    const ofItem = tokensOf(titleOf, item);
    return forms.some((form) => sharedCount(form, ofItem) / form.size >= MIN_RELEVANCE);
  });
}

function shortQuery(q) {
  const text = String(q || "").trim();
  const head = text.split(/[:,|–—]/)[0].trim();
  return head.length >= 3 ? head : text;
}

// --- end of the guide's code block ---

test("titleTokens folds accents, lowercases, and drops words of 1-2 letters", () => {
  assert.deepEqual(
    [...titleTokens("Avatar: Aang, El último Maestro del Aire")].sort(),
    ["aang", "aire", "avatar", "del", "maestro", "ultimo"],
  );
  assert.deepEqual([...titleTokens(undefined)], []);
  assert.deepEqual([...titleTokens("")], []);
});

test("tokensOf unions the tokens of every form titleOf returns, string or array", () => {
  assert.deepEqual([...tokensOf(() => "Before Midnight", null)].sort(), ["before", "midnight"]);
  assert.deepEqual(
    [...tokensOf(() => ["Antes del anochecer", "Before Midnight"], null)].sort(),
    ["anochecer", "antes", "before", "del", "midnight"],
  );
});

test("sortBySimilarity puts the item sharing the most words first, stable on ties", () => {
  const titles = ["Dragon Warrior Saga"];
  const titleOf = (x) => x.name;
  // Deliberately out of relevance order, as a loose-matching backend would return them.
  const items = [
    { name: "Saga of Something Else" }, // shares only "saga": 1
    { name: "Totally Unrelated Movie" }, // shares nothing: 0
    { name: "Warrior Saga Legends" }, // shares "warrior", "saga": 2
    { name: "Dragon Warrior Saga: Special Edition" }, // shares all 3
  ];
  const sorted = sortBySimilarity(items, titles, titleOf).map(titleOf);
  assert.deepEqual(sorted, [
    "Dragon Warrior Saga: Special Edition",
    "Warrior Saga Legends",
    "Saga of Something Else",
    "Totally Unrelated Movie",
  ]);
  // No requested title carries any 3+ letter token: nothing to rank by, so the order is untouched.
  assert.deepEqual(sortBySimilarity(items, ["Ay"], titleOf).map(titleOf), items.map(titleOf));
});

test("filterRelevant drops hits that only share a stray word", () => {
  const titles = ["Dragon Warrior Saga"];
  const titleOf = (x) => x.name;
  const items = [
    { name: "Saga of Something Else" }, // 1 of 3 tokens: 0.33, dropped
    { name: "Totally Unrelated Movie" }, // 0 of 3: dropped
    { name: "Warrior Saga Legends" }, // 2 of 3: 0.67, kept
    { name: "Dragon Warrior Saga: Special Edition" }, // 3 of 3: kept
  ];
  assert.deepEqual(
    filterRelevant(items, titles, titleOf).map(titleOf),
    ["Warrior Saga Legends", "Dragon Warrior Saga: Special Edition"],
  );
  // An absent title: 0 results, not a page of near-misses.
  assert.deepEqual(filterRelevant(items, ["Completely Different Name"], titleOf), []);
});

test("filterRelevant then sortBySimilarity: the real match first, the noise gone", () => {
  const titles = ["Dragon Warrior Saga"];
  const titleOf = (x) => x.name;
  const items = [
    { name: "Saga of Something Else" },
    { name: "Totally Unrelated Movie" },
    { name: "Warrior Saga Legends" },
    { name: "Dragon Warrior Saga: Special Edition" },
  ];
  const result = sortBySimilarity(filterRelevant(items, titles, titleOf), titles, titleOf).map(titleOf);
  assert.deepEqual(result, ["Dragon Warrior Saga: Special Edition", "Warrior Saga Legends"]);
});

test("shortQuery cuts at the first separator, but never a plain hyphen", () => {
  assert.equal(shortQuery("Avatar: Aang, El ultimo Maestro Aire"), "Avatar");
  assert.equal(shortQuery("Movie – Subtitle"), "Movie");
  assert.equal(shortQuery("Movie — Subtitle"), "Movie");
  assert.equal(shortQuery("One, Two, Three"), "One");
  // A one- or two-letter head identifies nothing: the whole text is kept instead.
  assert.equal(shortQuery("A: The Beginning"), "A: The Beginning");
  // No separator present at all: the whole (trimmed) text is the head, so it is returned either way.
  assert.equal(shortQuery("  El Ultimo Refugio  "), "El Ultimo Refugio");
  // Not a plain "-": it must not cut inside a hyphenated word.
  assert.equal(shortQuery("Spider-Man: Far From Home"), "Spider-Man");
  assert.equal(shortQuery(""), "");
});
