// An example consumer of the plugin protocol (apiVersion 20): a one-question movie trivia whose movies come from another
// plugin, the TMDB provider's door "movies" (kino-plugin.json "consumes".tmdb). Every node below is one Kino draws as is:
//   node sdk/run.mjs --context '{"installed":{"kinotvapp/kino-plugin-tmdb":true}}' --provider <provider folder> <this folder> screen
// prints no "dropped" line (add --lang en for the English texts, or "false" for the install gate).
//
// - The install gate: `installed` has one key per entry of the manifest's "recommends". Until the provider is installed the
//   screen is only the install view, and every event does nothing. Kino calls `screen` again once the person installs it.
// - kino.plugins.call(alias, call, arg) resolves to the provider's answer, checked against the door's "out", or rejects with an
//   Error whose `code` says why (provider_missing, not_declared, bad_input, bad_output, rate_limited, timeout, provider_failed).
//   Never let it throw out of screenEvent: keep the code in the state and draw it.
// - A stream: the screen switches it on with the state flag `protocol.<alias>.<stream>: true`; Kino then polls the provider
//   and sends the new items as the event "protocol" with arg { alias, stream, items }. Items may repeat: keep the latest.
// - TV: the main button of each view carries `autofocus`, and each answer says where the focus goes next.
const TMDB = "kinotvapp/kino-plugin-tmdb";

const text = (es, en, more = {}) => ({ type: "Text", text: es, textEn: en, ...more });
const button = (key, es, en, onPressed, more = {}) => ({ type: "ElevatedButton", key, labelText: es, labelTextEn: en, onPressed, ...more });
const page = (children) => ({
  type: "Scaffold",
  appBar: { type: "AppBar", title: "Cine Trivia", titleEn: "Cine Trivia" },
  body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 12, children }] },
});

/** What went wrong, in the person's words, by the error code of kino.plugins.call. */
function errorText(code) {
  switch (code) {
    case "provider_missing": return ["El plugin TMDB está apagado o le falta configurarse. Revísalo en Plugins.", "The TMDB plugin is off or needs setting up. Check it in Plugins."];
    case "rate_limited": return ["Demasiadas preguntas seguidas. Espera unos segundos.", "Too many questions in a row. Wait a few seconds."];
    case "timeout": return ["TMDB tardó demasiado en responder. Vuelve a intentarlo.", "TMDB took too long to answer. Try again."];
    default: return ["No se pudo traer la película. Vuelve a intentarlo.", "Could not get the movie. Try again."];
  }
}

function installView() {
  return page([
    text("Para jugar necesitas el plugin TMDB: de ahí salen las películas.", "To play you need the TMDB plugin: the movies come from it."),
    button("install", "Instalar TMDB", "Install TMDB", { go: { installPlugin: { repo: TMDB } } }, { autofocus: true }),
  ]);
}

function gameView(state) {
  const children = [];
  const movie = state.movie;
  if (movie) {
    children.push(text(`¿Quién dirigió ${movie.title}?`, `Who directed ${movie.title}?`, { style: "h3" }));
    if (state.revealed) children.push(text(movie.director || "TMDB no lo sabe", movie.director || "TMDB does not know", { color: "primary", bold: true }));
    else children.push(button("reveal", "Ver respuesta", "Show the answer", "reveal"));
  } else {
    children.push(text("Pulsa Jugar para la primera pregunta.", "Press Play for the first question."));
  }
  if (state.error) {
    const [es, en] = errorText(state.error);
    children.push(text(es, en, { color: "error" }));
  }
  children.push(button("play", movie ? "Otra película" : "Jugar", movie ? "Another movie" : "Play", "play", movie ? {} : { autofocus: true }));
  const on = state.protocol?.tmdb?.trending === true;
  children.push({ type: "Divider" });
  children.push({ type: "Switch", key: "trending", labelText: "Tendencias en vivo", labelTextEn: "Live trending", value: on, onChanged: "trending" });
  if (on && Array.isArray(state.trending) && state.trending.length) {
    const list = state.trending.join(", ");
    children.push(text(`En tendencia: ${list}`, `Trending: ${list}`, { style: "caption" }));
  }
  return page(children);
}

export async function screen({ state = {}, installed = {} } = {}) {
  if (installed[TMDB] !== true) return installView();
  return gameView(state || {});
}

export async function screenEvent({ name, value, arg, state = {}, installed = {} } = {}) {
  if (installed[TMDB] !== true) return null;
  if (name === "play") {
    try {
      const m = await kino.plugins.call("tmdb", "random", { fromYear: 1990 });
      return { state: { movie: { title: m.title, director: m.director ?? null }, revealed: false, error: null }, focus: "reveal" };
    } catch (e) {
      return { state: { error: typeof e?.code === "string" ? e.code : "provider_failed" }, focus: "play" };
    }
  }
  if (name === "reveal") return { state: { revealed: true }, focus: "play" };
  if (name === "trending") return { state: { protocol: { tmdb: { trending: value === true } }, trending: [] } };
  if (name === "protocol") {
    if (state.protocol?.tmdb?.trending !== true || !arg || !Array.isArray(arg.items)) return null;
    const titles = arg.items.map((m) => m.title).filter((t) => typeof t === "string" && t);
    return titles.length ? { state: { trending: titles.slice(0, 5) } } : null;
  }
  return null;
}
