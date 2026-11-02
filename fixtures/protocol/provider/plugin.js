// An example provider of the plugin protocol (apiVersion 20). It opens the door "movies" of its manifest's `provides`:
// every call is an export named proto_<door>_<call>(arg) that returns JSON, every stream proto_<door>_<stream>(cursor) that
// returns { items, cursor }. Kino validates the argument against the call's "in" and the answer against its "out", so the
// provider only has to answer what it declared. A real provider would ask Kino for TMDB data here; this one has no network.
const MOVIES = [
  { id: 603, title: "The Matrix", year: 1999, director: "Lana Wachowski", overview: "A hacker learns what the world really is." },
  { id: 680, title: "Pulp Fiction", year: 1994, director: "Quentin Tarantino" },
  { id: 13, title: "Forrest Gump", year: 1994, director: "Robert Zemeckis" },
  { id: 550, title: "Fight Club", year: 1999, director: "David Fincher" },
];

export async function search() { return []; }
export async function resolve() { return null; }

export async function proto_movies_byId({ id }) {
  const movie = MOVIES.find((m) => m.id === id);
  if (!movie) throw new Error("no such movie");
  return movie;
}

export async function proto_movies_random({ fromYear, toYear }) {
  const pool = MOVIES.filter((m) => m.year >= (fromYear ?? 0) && m.year <= (toYear ?? 9999));
  if (!pool.length) throw new Error("no movie in that range");
  // Anything not in the declared Movie type (like this) is dropped by Kino before the consumer sees it.
  return { ...pool[0], internalScore: 0.97 };
}

export async function proto_movies_search({ q }) {
  const needle = q.toLowerCase();
  return MOVIES.filter((m) => m.title.toLowerCase().includes(needle));
}

// A stream: the cursor is whatever this function returned last time (null the first time); items are new since then.
export async function proto_movies_trending(cursor) {
  const seen = typeof cursor === "number" ? cursor : 0;
  return { items: MOVIES.slice(seen, seen + 2), cursor: Math.min(MOVIES.length, seen + 2) };
}
