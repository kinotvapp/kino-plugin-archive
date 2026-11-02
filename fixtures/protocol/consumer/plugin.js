// An example consumer of the plugin protocol (apiVersion 20). The alias "tmdb" is the key of the manifest's `consumes`;
// kino.plugins.call(alias, call, arg) resolves to the validated answer, or rejects with an Error whose `code` says why.
const TMDB = "kinotvapp/kino-plugin-tmdb";

export async function screen({ installed, state }) {
  // The install gate: show only an install screen until the provider is installed. `installed` comes from `recommends`.
  if (!installed[TMDB]) {
    return {
      type: "Scaffold",
      appBar: { title: "Cine Trivia" },
      body: { type: "Column", children: [
        { type: "Text", text: "Cine Trivia necesita el plugin TMDB.", textEn: "Cine Trivia needs the TMDB plugin." },
        { type: "FilledButton", label: "Instalar", labelEn: "Install", onTap: { go: { installPlugin: { repo: TMDB } } } },
      ] },
    };
  }
  return {
    type: "Scaffold",
    appBar: { title: "Cine Trivia" },
    body: { type: "Column", children: [
      { type: "Text", text: state.question ?? "", textEn: state.question ?? "" },
      { type: "FilledButton", label: "Jugar", labelEn: "Play", onTap: "play" },
    ] },
  };
}

export async function screenEvent({ name, arg }) {
  if (name === "play") {
    try {
      const movie = await kino.plugins.call("tmdb", "random", { fromYear: 1990 });
      return { state: { question: `¿Quién dirigió ${movie.title}?`, answer: movie.director ?? null } };
    } catch (e) {
      // e.code: provider_missing, not_declared, bad_input, bad_output, rate_limited, timeout or provider_failed.
      return { toast: { text: `No se pudo cargar (${e.code})`, textEn: `Could not load (${e.code})` } };
    }
  }
  // A stream's new items arrive as the event "protocol" with arg { alias, stream, items } once the screen switches it on with
  // state.protocol.tmdb.trending = true.
  if (name === "protocol") return { state: { lastTrending: arg.items.map((m) => m.title) } };
  return null;
}
