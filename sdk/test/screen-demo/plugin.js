// A static news list: image left, title and a line right; a tap opens a dialog with the story. It uses the documented
// (Flutter-style) names; the kit prints the tree under the older names Kino reads. The "marquee" node is there on purpose:
// it is not a widget, so the kit prints the app's drop line for it.
const NEWS = [
  { id: "1", title: "Primera noticia", titleEn: "First story", summary: "Resumen uno" },
  { id: "2", title: "Segunda noticia", titleEn: "Second story", summary: "Resumen dos" },
];

export async function screen({ state, device, size, lang }) {
  const en = String(lang).startsWith("en");
  return {
    type: "Column", padding: 16, gap: 12,
    children: [
      { type: "Text", text: "Noticias", textEn: "News", style: "h3" },
      { type: "marquee", text: "breaking" },
      ...(state.loaded ? [] : [{ type: "CircularProgressIndicator", text: "…" }]),
      {
        type: "ListView",
        items: NEWS.map((n) => ({
          type: "Row", key: `n${n.id}`, gap: 12, onTap: { event: "read", arg: n.id },
          children: [
            { type: "Image", url: "https://img.example.com/" + n.id + ".jpg", width: 96, height: 96, borderRadius: "small" },
            { type: "Column", flex: 1, children: [
              { type: "Text", text: en ? n.titleEn : n.title, style: "h3", maxLines: 2 },
              { type: "Text", text: n.summary, style: "caption", color: "muted" },
            ] },
          ],
        })),
      },
      { type: "Text", text: `${device} ${size.widthClass}`, style: "caption" },
    ],
  };
}

export async function screenEvent({ name, arg }) {
  if (name === "open") return { state: { loaded: true } };
  if (name === "read") {
    const n = NEWS.find((x) => x.id === arg);
    return { dialog: { title: n.title, body: n.summary, buttons: [{ label: "Cerrar" }] }, toast: "Abierto" };
  }
  return null;
}
