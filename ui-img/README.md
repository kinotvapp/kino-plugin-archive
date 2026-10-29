# Screenshots of the User interface reference

The pictures [`ui.md`](../ui.md) shows, two per component: `<component>-phone.png` and `<component>-tv.png`, where
`<component>` is the section's anchor in `ui.md` (`card`, `wrap-row`, `text-field`...). They are captured from Kino's real
renderer, never drawn or mocked: a picture that is not a capture of the app is worse than none.

## How to capture them

1. Install the [gallery example](../examples/screen-gallery/) (`docs/plugins/examples/screen-gallery`) on a phone and on a
   TV with a build that has apiVersion 14, and open «Galería UI» from the menu.
2. For each component, [`screenshot-map.json`](../examples/screen-gallery/screenshot-map.json) says which tab to open
   (`tab`), which section to scroll to (`section`, the node key `sec-<section>`; its title is on screen), and, for pop-ups,
   toasts and menus, which button to press first (`press`, a node key).
3. Capture the section only (crop to the section's title and its demo), in Kino's default theme, with the app in Spanish
   for the phone and the TV alike, at the device's own size class (a phone upright is `compact`, a TV `expanded`).
4. Save as `<component>-phone.png` / `<component>-tv.png` (PNG, at most about 200 KB each: crop rather than downscale), then
   replace the section's "Screenshot slots" line in `ui.md` with the two images.

Until a picture is captured, its slot in `ui.md` says "pending".

## What is captured

Phone pictures (Redmi Note 9 Pro, Android 12, Spanish, debug build of `f286ad6b`, cropped to the section and scaled to
540 px wide) exist for 50 of the 53 slots: every component except the three below. Their slots in `ui.md` say "phone
captured, TV pending" until `ui.md` links the TV pictures too.

TV pictures (Android TV emulator `kino_tv`, API 34, 1920x1080, Spanish, the same debug build of `f286ad6b`, cropped to
the section and scaled to 960 px wide) exist for the same 50 slots.

- Pop-ups, sheets, menus, the link sheet, the route and the TV text dialog are the whole screen, so the dimmed screen
  behind them shows.
- `text-field-tv.png` shows Kino's TV text dialog opened from «Sobre ti». The emulator has a hardware keyboard, and with
  one Kino draws a single-line field inline instead of the dialog; a TV with only a remote opens the same dialog for it.
- `panel-tv.png` is cut on the left: the debug build draws a buffer readout over the video's top-left corner, which a
  release never shows.
- `form`, `text`, `icon-names` and `settings` are taller than the screen: each is several captures joined at a measured
  scroll offset.

Pending:

- **`button`, `toast` and `ui-ops`, phone and TV**: the gallery's `Row` of buttons with `wrap: true` does not wrap. On the
  phone the buttons shrink to share one line and their labels are cut to "…" ("Aviso si…", ".."); on the TV each button
  gets a narrow slot and its label is clipped ("Princip", "Secund", "disa"). They are captured once that is fixed, so the
  pictures do not show the defect.
- `table-row` and `table-cell` have no picture of their own: the `table` picture serves them.

The `icon-names` phone picture is two captures joined. The scroll offset between them was measured, so no row is drawn
twice.
