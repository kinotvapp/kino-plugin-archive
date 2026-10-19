// A test plugin for the player panel (apiVersion 9): every element type, every trigger, every `player` property.
export async function search() { return []; }
export async function resolve() { throw kino.error("not_found", "demo"); }

const TABS = [{ id: "main", label: "Main", labelEn: "Main" }, { id: "more", label: "More" }];

export async function panel(context) {
  const tab = context.tab || "main";
  const common = { title: context.title, presentation: "panel", accent: "#2E7D32", refreshMs: 10000, tabs: TABS, tab };
  if (tab === "more") {
    return {
      ...common,
      elements: [
        { type: "qr", url: "https://example.com/watch", label: "Open on your phone" },
        { type: "episodes", ref: context.ref },
        { type: "image", url: "https://example.com/poster.jpg", aspect: "2:3", alt: "Poster" },
      ],
    };
  }
  return {
    ...common,
    elements: [
      { type: "section", title: "Playback", text: `${context.stats.width}x${context.stats.height}, ${context.stats.bitrateKbps} kbps` },
      { type: "text", text: `Position ${Math.round(context.positionMs / 1000)} s of ${Math.round(context.durationMs / 1000)} s` },
      { type: "status", text: context.paused ? "Paused" : "Playing" },
      {
        type: "card", title: "Controls", style: "outlined", children: [
          { type: "row", gap: "small", children: [
            { type: "col", weight: 1, children: [{ type: "button", key: "jump", label: "Jump ahead" }] },
            { type: "col", weight: 1, children: [{ type: "button", key: "reset", label: "Reset", confirm: "Reset everything?" }] },
          ] },
          { type: "toggle", key: "autoplay", label: "Autoplay", scope: "plugin", hint: "Play the next one", autoSave: true },
          { type: "select", key: "audio", label: "Audio", scope: "video", options: [{ value: "es", label: "Spanish" }, { value: "en", label: "English" }] },
          { type: "text-input", key: "note", label: "Note", scope: "video", hint: "Only for this title", placeholder: "Type here" },
        ],
      },
    ],
  };
}

export async function panelAction(event, context) {
  if (event.key === "jump") {
    return {
      message: "Saltando adelante",
      player: {
        seekToMs: context.positionMs + context.seekStepMs, seekStepMs: 15000, speed: 1.25, resize: "fit",
        markers: [{ atMs: 120000, label: "Goal" }], autoNext: { enabled: false },
      },
    };
  }
  if (event.trigger === "change") return { values: { [event.key]: event.value }, save: [event.key] };
  if (event.trigger === "submit") return { values: { note: event.value }, focus: "jump", patch: { jump: { type: "button", key: "jump", label: "Jump again" } } };
  return null;
}

export async function playerEvent(event) {
  if (event.type === "ended") return { message: "Hasta la próxima", player: { autoNext: { enabled: true, countdownS: 5 } } };
  return null;
}
