# User interface

Every component a plugin screen can draw, one section each: what it is for, its properties, a JSON tree, the same in
plugin JavaScript, how it behaves on the phone and on the TV, its limits and the mistakes to avoid. It is the companion of
the guide's [Screens chapter](README.md#13-screens-screen-apiversion-14), which explains the model (the manifest, the
exports, state and events); this page is the catalogue.

Everything here needs `apiVersion: 14` (Kino 0.9.74 or newer). The property tables are generated
from [`contract.json`](contract.json) by `plugins/sdk/ui-tables.mjs`, so their names, defaults and numbers are the ones the
app enforces; [`kino.d.ts`](kino.d.ts) types every node (`KinoScreenNode`). To see every component running, install the
[gallery example](examples/screen-gallery/): one tab per group below, each component in its own labelled section.

<a id="contents"></a>
## Contents

| Group | Components |
| --- | --- |
| [Quick start](#quick-start) | [A first screen](#quick-start) · [Reading this page](#reading) |
| [Layout](#layout) | [Column](#column) · [Row](#row) · [Twelve-column row](#wrap-row) · [Stack](#stack) · [Positioned children](#positioned) · [Spacer and SizedBox](#spacer) · [Divider](#divider) · [Scroll](#scroll) · [GridView](#grid-view) · [ListView](#list-view) · [TabBar](#tab-bar) · [ExpansionTile](#accordion) · [steps](#steps) · [Card](#card) · [Scaffold](#scaffold) ([AppBar](#app-bar), [NavigationBar](#navigation-bar)) · [PageView](#page-view) · [ListTile](#list-tile) |
| [Content](#content) | [Text](#text) · [Text scale](#text-scale) · [Colours](#colors) · [Image](#image) · [Icon](#icon) · [Badge](#badge) · [CircleAvatar](#circle-avatar) · [MaterialBanner](#banner) · [Progress bar](#progress) · [Spinner](#loading) · [Skeleton](#skeleton) · [QrImage](#qr) ([countdown](#qr-countdown)) · [DataTable](#table) ([TableRow](#table-row), [TableCell](#table-cell)) · [NumberStepper](#number-stepper) · [emptyState](#empty-state) · [errorState](#error-state) · [titleCard](#title-card) · [titleRail](#title-rail) · [titleGrid](#title-grid) · [heroCard](#hero-card) |
| [Actions](#actions) | [Actions and events](#actions) · [Buttons](#button) · [FloatingActionButton](#floating-action-button) · [Tooltip](#tooltip) · [Chips](#chips) · [DropdownButton](#dropdown) · [Menus](#menu) · [Toasts](#toast) · [Local `ui` operations](#ui-ops) |
| [Forms](#forms) | [Form](#form) · [TextField](#text-field) ([secret fields](#secret-field)) · [Several lines](#text-area) · [DropdownButton](#dropdown) · [RadioGroup](#radio-group) · [Checkbox](#checkbox) · [Switch](#switch) · [Slider](#slider) · [NumberStepper](#number-stepper) · [Focus on TV](#tv-focus) · [Validation](#validation) · [Patterns](#pattern) · [Submit rules](#submit) · [settings node](#settings) ([onSaved](#on-saved)) · [bind and config](#bind-and-config) |
| [Overlays](#overlays) | [Dialog](#dialog) · [Sheet](#sheet) · [Menu](#menu) · [Declared pop-ups and `onClose`](#popup) |
| [Navigation](#navigation) | [`title`](#go-title) · [`play`](#go-play) · [`search`](#go-search) · [`browse`](#go-browse) · [`section`](#go-section) · [`categories`](#go-categories) · [`close`](#go-close) · [`screen`](#go-screen) · [`titleByIds`](#go-title-by-ids) · [`url`](#go-url) · [`copy`](#go-copy) · [`liveChannel`](#go-live-channel) · [Routes](#route) |
| [Data and behavior](#data) | [State](#state) · [Inputs](#inputs) · [Events](#events) · [Answers](#answer) · [Timers](#every) · [Per-size values](#responsive) · [Flutter-style names](#aliases) · [Style](#style) · [Common properties](#common-properties) · [Box and text properties](#box-props) · [Animations](#animate) · [Tokens](#tokens) · [Limits](#limits) |
| [Player panel](#panel) | [Legacy and screen mode](#panel-screen-mode) · [Contributed tabs](#panel-tab) · [Pinned panel](#pinned-panel) · [Layout fill: a chat tab](#layout-fill-a-chat-tab) |
| [Recipes](#recipes) | [News card grid](#recipe-news-grid) · [Settings form with validation](#recipe-settings-form) · [Confirmation pop-up](#recipe-confirm) · [Tabs with chips](#recipe-tabs-chips) · [Button matrix](#recipe-matrix) · [App bar, tabs and a floating button](#recipe-scaffold) · [Tabs in the app bar](#recipe-app-bar-tabs) |
| [Screenshots](#screenshots) | How the pictures on this page are captured |

<a id="quick-start"></a>
## Quick start

A screen plugin is a manifest with the `screen` capability and two exports. This one shows a card with a picture, a title
and a button; the button's event answers a state patch, and Kino draws the screen again.

`kino-plugin.json`:

```json
{
  "id": "hello-card",
  "name": "Tarjeta",
  "version": "1.0.0",
  "apiVersion": 14,
  "entry": "plugin.js",
  "hosts": ["kinotvapp.github.io"],
  "capabilities": ["screen"],
  "screen": { "label": "Tarjeta", "labelEn": "Card", "icon": "star", "menuOpens": "screen" }
}
```

`plugin.js`:

```js
export async function screen({ state }) {
  const liked = state.liked === true;
  return { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 12, children: [
    { type: "Card", key: "film", flush: true, children: [
      { type: "Image", url: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg", aspect: "16:9", alt: "Big Buck Bunny" },
      { type: "Column", padding: 12, gap: 8, children: [
        { type: "Text", text: "Big Buck Bunny", style: "h3" },
        { type: "Text", text: liked ? "Te gusta" : "Una película libre de 2008", textEn: liked ? "You like it" : "A free film from 2008", color: "muted" },
        { type: "ElevatedButton", key: "like", icon: "heart", labelText: "Me gusta", labelTextEn: "Like", onPressed: "like", enabled: !liked },
      ] },
    ] },
  ] }] };
}

export async function screenEvent({ name }) {
  return name === "like" ? { state: { liked: true }, toast: "¡Gracias!", toastEn: "Thanks!" } : null;
}
```

Try it with the kit, before any device: `node sdk/validate.mjs <folder>`, `node sdk/run.mjs <folder> screen`,
`node sdk/run.mjs --device tv <folder> screen` and `node sdk/run.mjs --state '{}' <folder> screenEvent like`.

<a id="reading"></a>
### Reading this page

- **Names.** Each section is titled with the Flutter-style name this page writes (`Column`, `TextField`...); the older
  lowercase name Kino reads internally (`col`, `textInput`...) is accepted too, and the kit's log lines use it. See
  [Flutter-style names](#aliases).
- **Property tables.** *Default* is what Kino uses when you leave the property out; *Per size* says whether the property
  takes a per-size map `{ compact, medium, expanded }` ([Per-size values](#responsive)). Every node also takes the
  [common properties](#common-properties) and the [style](#style), which are not repeated.
- **Validation never crashes.** A wrong value, an unknown type or a property out of place is dropped with a log line and
  the rest is drawn. Run `node sdk/run.mjs <folder> screen`: every dropped thing is printed.
- **Screenshot slots.** Each section names its two pictures (`ui-img/<component>-phone.png` and `-tv.png`), captured from
  the real renderer with the gallery ([Screenshots](#screenshots)).

<a id="layout"></a>
## Layout

Containers place their children; none of them draws anything of its own except `Card`, `Divider` and the tabs. The canvas
does not scroll by itself: put a long page in a [`SingleChildScrollView`](#scroll) or a [`ListView`](#list-view).

<a id="column"></a>
### Column

Children one under the other: the backbone of almost every screen. `gap` spaces them, `crossAxisAlignment` places them
across the width (`stretch` makes each as wide as the column) and `mainAxisAlignment` along the height. A child with
`flex` takes its share of the height left over.

> Screenshot slots: `ui-img/column-phone.png`, `ui-img/column-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:col:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes[] | none | no | its children, drawn in order |
<!-- ui:props:col:end -->

```json
{ "type": "Column", "gap": 8, "crossAxisAlignment": "stretch", "children": [
  { "type": "Text", "text": "Primero", "textEn": "First" },
  { "type": "Text", "text": "Segundo", "textEn": "Second" }
] }
```

```js
export async function screen() {
  const lines = ["Primero", "Segundo", "Tercero"];
  return { type: "Column", gap: 8, padding: 16, children: lines.map((text) => ({ type: "Text", text })) };
}
```

- **TV:** focus moves Down and Up through the column's focusable children, to the neighbour's nearest edge.
- **Phone and TV:** identical layout; use per-size `padding` and `gap` for the larger screen.
- **Limits and mistakes:** a root `Column` taller than the window is cut, not scrolled. Depth counts: at most
  10 levels of nesting in a tree.

<a id="row"></a>
### Row

Children side by side. `flex` shares the width (`flex: 1` and `flex: 2` take a third and two thirds), `mainAxisAlignment`
spreads them (`spaceBetween`, `spaceAround`), `crossAxisAlignment` aligns them on the row's height. With `stackOnNarrow`
the row becomes a column on a compact width; with `wrap: true` it is the [twelve-column layout](#wrap-row).

> Screenshot slots: `ui-img/row-phone.png`, `ui-img/row-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:row:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes[] | none | no | its children, drawn in order |
| `wrap` | boolean | `false` | yes | `true`: the twelve-column layout, children placed by `span` and `offset` on lines of 12 columns ([Twelve-column row](#wrap-row)) |
| `stackOnNarrow` | boolean | `false` | yes | on a compact width the children stack as a column; ignored with `wrap` |
<!-- ui:props:row:end -->

```json
{ "type": "Row", "gap": 8, "stackOnNarrow": true, "children": [
  { "type": "Card", "flex": 1, "children": [{ "type": "Text", "text": "Uno", "textEn": "One" }] },
  { "type": "Card", "flex": 2, "children": [{ "type": "Text", "text": "Dos", "textEn": "Two" }] }
] }
```

```js
export async function screen() {
  const box = (text, flex) => ({ type: "Card", flex, children: [{ type: "Text", text }] });
  return { type: "Row", gap: 8, mainAxisAlignment: "spaceBetween", children: [box("A", 1), box("B", 2)] };
}
```

- **TV:** Left and Right move between the row's focusable children, a `TabBar` or `Chips` in it included (Right
  from its last tab reaches the control after it). A row of more than six focusable items has not been
  checked on a real TV box yet: keep TV rows short.
- **Phone and TV:** `stackOnNarrow` only changes compact widths (a phone upright); a TV is `expanded`.
- **Limits and mistakes:** `stretch` in a plain row draws as `start` (a row has no intrinsic height to stretch to);
  `flex` is 1 to 12; `span` and `offset` mean nothing here (only with `wrap`).

<a id="wrap-row"></a>
### Twelve-column row (`wrap: true`)

Bootstrap's grid inside Kino: a `Row` with `wrap: true` lays its children on lines of 12 columns. Each child takes its
`span` (1 to 12, or `"auto"`, the default) after its `offset`; a child that does not fit what is left of the line starts
the next one. An `"auto"` button, `Badge` or `Icon` is never narrower than its label: when it does not fit it starts the
next line, and the `"auto"`s of a line share what is left without going under their own width. With per-size spans it is `col-12 col-md-6 col-lg-4`: one card per line on a phone, two on a medium
window, three on a TV. `gap` goes between cells and between lines.

> Screenshot slots: `ui-img/wrap-row-phone.png`, `ui-img/wrap-row-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "type": "Row", "wrap": true, "gap": 12, "children": [
  { "type": "Card", "key": "a", "span": { "compact": 12, "medium": 6, "expanded": 4 }, "children": [{ "type": "Text", "text": "A" }] },
  { "type": "Card", "key": "b", "span": { "compact": 12, "medium": 6, "expanded": 4 }, "children": [{ "type": "Text", "text": "B" }] },
  { "type": "Card", "key": "c", "span": 4, "offset": 4, "children": [{ "type": "Text", "text": "C" }] }
] }
```

```js
export async function screen() {
  const cards = ["Uno", "Dos", "Tres", "Cuatro"].map((text, i) => ({
    type: "Card", key: "card" + i, span: { compact: 12, medium: 6, expanded: 4 }, children: [{ type: "Text", text }],
  }));
  return { type: "SingleChildScrollView", children: [{ type: "Row", wrap: true, gap: 12, padding: 16, children: cards }] };
}
```

- **TV:** the grid keeps Left and Right inside itself (they never escape past the last cell); Down and Up go to the
  nearest cell of the next line, so a matrix of buttons keeps its columns (the [calculator](examples/screen-calculator/)
  is the regression guard).
- **Phone and TV:** a line is as tall as its tallest cell and, by default, every `Card` or container cell without a fixed
  `width`/`height` is drawn that tall, so a grid of cards is even; `crossAxisAlignment` `start`, `center` or `end` keeps
  each at its own height. Inside a sideways scroll the twelve columns are laid out on 600 dp.
- **Limits and mistakes:** `flex`, `mainAxisAlignment` and `stackOnNarrow` mean nothing in a wrapping row; a child takes
  its natural width unless `fill: true`. `span` and `offset` anywhere else are ignored (logged). A line holding something
  that cannot be measured (a lazy list, a rail, tabs, a table, the settings form) is left unstretched. A hidden child
  leaves no gap. `offset` is lowered when it would leave the span no room (logged).

<a id="stack"></a>
### Stack

Children laid on each other, the first at the back: a badge over a picture, a label over a banner. Today's `Stack` is not
positioned: every child starts at the top start corner; use `margin` and `padding` to move one.

> Screenshot slots: `ui-img/stack-phone.png`, `ui-img/stack-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:box:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes (laid on each other, first at the back)[] | none | no | its children, drawn in order |
<!-- ui:props:box:end -->

```json
{ "type": "Stack", "children": [
  { "type": "Image", "url": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg", "aspect": "banner", "alt": "Big Buck Bunny" },
  { "type": "Badge", "text": "Nuevo", "textEn": "New", "margin": 8 }
] }
```

```js
export async function screen() {
  return { type: "Stack", children: [
    { type: "Image", url: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg", aspect: "banner", alt: "Big Buck Bunny" },
    { type: "Badge", text: "4K", margin: 8 },
  ] };
}
```

- **TV:** only a focusable child takes focus; the stack itself takes it when it has an `onTap`.
- **Phone and TV:** the same.
- **Limits and mistakes:** no `alignSelf`, no positions (deferred); a `Stack` is a container cell in a twelve-column
  row (it stretches to its line).

<a id="positioned"></a>
### Positioned children (`Stack`)

Flutter's `Positioned`, as a style property of a `Stack`'s child (Task 17): `positioned: { top?, left?, right?, bottom?,
width?, height? }`, each a number of dp (0 to 1280, clamped) or a share of the stack written `"25%"` (0% to 100%). With
`left` and `right` (or `top` and `bottom`) the child takes the room between them; a `width` (`height`) given too is ignored,
logged. A child without `positioned` keeps the stack's alignment and sizes the stack; a stack whose children are all
positioned takes the width it is offered and its own `height` (or `minHeight`; without one it is 0 tall: give it one).
Children are drawn in their order (a later one over an earlier one) and the focus walks them in that order; everything is
clipped to the stack and kept inside it, so nothing is pressed outside it. On any other node `positioned` is ignored, logged.
Per size like every style property.

```json
{ "type": "Stack", "height": 200, "children": [
  { "type": "Image", "url": "https://img.example.com/cover.jpg", "fill": true, "height": 200 },
  { "type": "Badge", "text": "EN VIVO", "textEn": "LIVE", "color": "error", "positioned": { "top": 8, "right": 8 } },
  { "type": "Text", "text": "Final de la copa", "textEn": "Cup final", "style": "h4", "positioned": { "left": 12, "right": 12, "bottom": 12 } }
] }
```

<a id="spacer"></a>
### Spacer and SizedBox

Empty space. `SizedBox` is an empty box of its `width` and `height` (on the size scale); `Spacer` is an empty box that
takes its `flex` share of a `Row` or `Column`, pushing what follows to the end. Both are the same older node, `spacer`.

> Screenshot slots: `ui-img/spacer-phone.png`, `ui-img/spacer-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:spacer:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| (none) |  |  |  | `SizedBox` is an empty box of its `width`/`height`; `Spacer` takes its `flex` share of a `Row` or `Column` |
<!-- ui:props:spacer:end -->

```json
{ "type": "Row", "children": [
  { "type": "Text", "text": "A" },
  { "type": "SizedBox", "width": 48 },
  { "type": "Text", "text": "B" },
  { "type": "Spacer", "flex": 1 },
  { "type": "Text", "text": "C" }
] }
```

```js
export async function screen() {
  return { type: "Row", children: [{ type: "Text", text: "Título" }, { type: "Spacer", flex: 1 }, { type: "Badge", text: "3" }] };
}
```

- **TV:** never focused.
- **Phone and TV:** the same; prefer `gap` on the parent over spacers between every child.
- **Limits and mistakes:** `width` and `height` only take the size scale (16 to 640); a value off it drops the node.

<a id="divider"></a>
### Divider

A thin rule across its parent: between groups of a column, under a heading.

> Screenshot slots: `ui-img/divider-phone.png`, `ui-img/divider-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:divider:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| (none) |  |  |  | a thin rule across its parent |
<!-- ui:props:divider:end -->

```json
{ "type": "Column", "gap": 8, "children": [
  { "type": "Text", "text": "Arriba", "textEn": "Above" },
  { "type": "Divider" },
  { "type": "Text", "text": "Abajo", "textEn": "Below" }
] }
```

```js
export async function screen() {
  return { type: "Column", gap: 8, children: [{ type: "Text", text: "Uno" }, { type: "Divider" }, { type: "Text", text: "Dos" }] };
}
```

- **TV:** never focused. **Phone and TV:** the same. **Mistakes:** a divider in a `Row` draws nothing useful (it is
  horizontal).

<a id="scroll"></a>
### Scroll (SingleChildScrollView)

Its children, scrolling: `vertical` (the default) for a long page, `horizontal` for a strip of chips or badges. Most
screens put everything under the fixed parts (a `TabBar`) in one vertical scroll with `flex: 1`.

> Screenshot slots: `ui-img/scroll-phone.png`, `ui-img/scroll-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:scroll:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes[] | none | no | its children, drawn in order |
| `direction` | `vertical` \| `horizontal` | `vertical` | yes | a `ListView` or rail inside a scroll of the same direction is drawn all at once |
<!-- ui:props:scroll:end -->

```json
{ "type": "Column", "children": [
  { "type": "TabBar", "key": "tabs", "tabs": [{ "value": "a", "label": "Uno", "labelEn": "One" }, { "value": "b", "label": "Dos", "labelEn": "Two" }], "onChanged": "tab" },
  { "type": "SingleChildScrollView", "flex": 1, "children": [{ "type": "Column", "padding": 16, "gap": 12, "children": [
    { "type": "Text", "text": "Una página larga", "textEn": "A long page" }
  ] }] }
] }
```

```js
export async function screen() {
  const badges = ["Acción", "Drama", "Comedia", "Terror"].map((text) => ({ type: "Badge", text }));
  return { type: "SingleChildScrollView", direction: "horizontal", children: [{ type: "Row", gap: 8, children: badges }] };
}
```

- **TV:** the scroll follows the focus: moving onto a node off screen brings it into view, scrolling only as much as it
  needs (with a small margin); a node already in view never scrolls the rest under a header. Up (Down) moves focus only
  to a focusable that already shows that way; when none shows yet, the `Scroll` scrolls by 80% of its height instead, press
  after press, until one shows (then the next press moves there) or its start (end) is reached. So a block with nothing
  focusable (a status card, a caption, a table) between two focusables, above the first or below the last is always read
  on the way, never scrolled past unseen; where the next focusable is on screen (a dense list) focus moves at once, with no
  paging. Only at the start (end) does the key leave the `Scroll`: in a `Scaffold` body Up then reaches the `AppBar`'s
  picked tab; Down at the end does nothing (never wraps round to the top). Down from the `AppBar` always enters the body:
  its nearest focusable takes focus and scrolls into view, wherever the body was left; a body with nothing focusable
  (text, cards, tables) pages instead. A press always scrolls or moves focus, until there is nothing left that way. The
  same in a player panel's body. A block the remote should rest on can say so with
  [`canRequestFocus: true`](#shared-properties).
- **Phone and TV:** a touch drag on the phone; the D-pad on the TV.
- **Limits and mistakes:** a `ListView` or a rail inside a scroll of the same direction is drawn all at once (no
  laziness) and capped at 60 titles; a table cell never holds a scroll.

<a id="grid-view"></a>
### GridView

Its children in equal `columns`, filled row by row: a grid of small tiles where every cell is the same width. For cards
that change count by size, prefer the [twelve-column row](#wrap-row) or per-size `columns`.

> Screenshot slots: `ui-img/grid-view-phone.png`, `ui-img/grid-view-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:grid:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes[] | none | no | its children, drawn in order |
| `columns` | 1 to 8 | `2` | yes | equal columns, filled row by row |
<!-- ui:props:grid:end -->

```json
{ "type": "GridView", "columns": { "compact": 2, "medium": 3, "expanded": 4 }, "gap": 8, "children": [
  { "type": "Card", "children": [{ "type": "Text", "text": "1" }] },
  { "type": "Card", "children": [{ "type": "Text", "text": "2" }] },
  { "type": "Card", "children": [{ "type": "Text", "text": "3" }] }
] }
```

```js
export async function screen() {
  const tiles = Array.from({ length: 8 }, (_, i) => ({ type: "Card", children: [{ type: "Text", text: String(i + 1) }] }));
  return { type: "GridView", columns: { compact: 2, expanded: 4 }, gap: 8, children: tiles };
}
```

- **TV:** the D-pad moves cell by cell. **Phone and TV:** per-size `columns` is the usual way to fit both.
- **Limits and mistakes:** `columns` 1 to 8; a `GridView` is not lazy: for hundreds of items use a `ListView` with
  `columns`.

<a id="list-view"></a>
### ListView

A lazy list of `items` (nodes), drawn as they scroll into view: the way to show long feeds. `empty` is what shows when there
are no items; `columns` makes it a grid; `onEndReached` asks your plugin for more.

> Screenshot slots: `ui-img/list-view-phone.png`, `ui-img/list-view-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:list:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `items` | nodes[] | none | no | at most 500, each with a `key` of its own; drawn lazily |
| `empty` | node | none | no | drawn when there are no items |
| `columns` | 1 to 8 | `1` | yes | a grid of items |
| `stickToBottom` | boolean | `false` | yes | opens at the last item and follows new ones while the person is at the end; one column, in a list that scrolls itself ([layout fill](#layout-fill-a-chat-tab)) |
| `newItemsHint` | boolean | `false` | no | items appended while the person reads higher up show Kino's own «↓ Nuevos» chip (its text, never yours); a tap goes to the end ([new items](#new-items-hint)) |
| `onEndReached` | `{ event, arg? }` | none | no | sent once when the last item comes into view, again only after your answer drew a longer list (or `loadingMore` went from true to false); never more than once a second |
| `loadingMore` | boolean | `false` | no | `true` draws Kino's spinner after the items |
| `done` | boolean | `false` | no | `true` stops asking for more |
<!-- ui:props:list:end -->

```json
{ "type": "ListView", "key": "feed", "onEndReached": { "event": "more" }, "loadingMore": false, "done": false,
  "empty": { "type": "emptyState", "title": "Sin elementos", "titleEn": "No items" },
  "items": [
    { "type": "Text", "key": "i1", "text": "Elemento 1", "textEn": "Item 1" },
    { "type": "Text", "key": "i2", "text": "Elemento 2", "textEn": "Item 2" }
  ] }
```

```js
export async function screen({ state }) {
  const n = Number.isInteger(state.count) ? state.count : 10;
  const items = Array.from({ length: n }, (_, i) => ({ type: "Text", key: "row" + i, text: "Elemento " + (i + 1) }));
  return { type: "ListView", key: "feed", items, onEndReached: { event: "more" }, loadingMore: state.loading === true, done: n >= 100 };
}

export async function screenEvent({ name, state }) {
  if (name === "more") return { state: { count: Math.min(100, (state.count || 10) + 10) } };
  return null;
}
```

- **TV:** `onEndReached` fires when the last item comes into view, as on the phone.
- **Phone and TV:** the same lazy list. With `stickToBottom: true` it opens at its last item and a new last item scrolls into
  view while the person is at the end (or one item from it); once they scroll up it stays put until they come back down
  (a chat: see [Layout fill](#layout-fill-a-chat-tab)). It needs a list that scrolls itself: one column, in a full
  screen or in a panel with `layout: "fill"`. Drawn flat (a panel's default scroll layout, inside a `SingleChildScrollView`)
  it does nothing, logged once.
- **Limits and mistakes:** 500 items; each item needs a `key` of its own. `onEndReached` comes again only after your
  answer drew a longer list or `loadingMore` went from true to false, at most once a second, never while the screen is
  hidden. A timer that turns `loadingMore` off on every tick with nothing new makes Kino ask once per tick.

<a id="new-items-hint"></a>
#### New items (`newItemsHint`)

With `newItemsHint: true`, items appended while the person reads higher up (the old last item still in the list) show Kino's
own small chip over the list's bottom, «↓ Nuevos» / «↓ New»: Kino's text, never yours. A tap goes to the end and the chip
hides as soon as the end shows. Beside `stickToBottom` the chip only shows once the person scrolled up: at the end the list
follows the new item itself. It needs a list that scrolls itself (one column); a grid or a flat list draws no chip.

```json
{ "type": "ListView", "key": "chat", "flex": 1, "stickToBottom": true, "newItemsHint": true,
  "items": [{ "type": "Text", "key": "m1", "text": "Hola", "textEn": "Hi" }] }
```

- **TV:** the chip is a focus stop: Down from the list region (a list whose items take no focus holds focus itself) reaches it
  before the controls under the list; OK goes to the end.

<a id="tab-bar"></a>
### TabBar

A row of tabs: the top-level switch of a multi-part screen. It is **not an input**: its value is not in `state.inputs`.
Keep the chosen tab in your own state from its `onChanged` event, and draw the matching body.

> Screenshot slots: `ui-img/tab-bar-phone.png`, `ui-img/tab-bar-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:tabs:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `tabs` | `{ value, label, labelEn?, badge? }[]` | required | no | 1 to 500; a tab's `badge` sits beside its label ([shared properties](#shared-properties)) |
| `value` | string | the first tab | no | the selected tab; NOT in `state.inputs`: keep it in your state from `onChanged` |
| `onChanged` | action | none | no | its event's `value` is the tab's value |
<!-- ui:props:tabs:end -->

```json
{ "type": "TabBar", "key": "section", "value": "news", "onChanged": "tab", "tabs": [
  { "value": "news", "label": "Noticias", "labelEn": "News" },
  { "value": "config", "label": "Configuración", "labelEn": "Settings" }
] }
```

```js
export async function screen({ state }) {
  const tab = state.tab === "config" ? "config" : "news";
  return { type: "Column", children: [
    { type: "TabBar", key: "section", value: tab, onChanged: "tab", tabs: [{ value: "news", label: "Noticias" }, { value: "config", label: "Ajustes" }] },
    { type: "Text", text: tab === "news" ? "Las noticias" : "Los ajustes", padding: 16 },
  ] };
}

export async function screenEvent({ name, value }) {
  return name === "tab" ? { state: { tab: value } } : null;
}
```

- **TV:** Left and Right walk the tabs; at the bar's end they go on to the next focusable beside it **in the same row**
  (a refresh `IconButton` after the tabs), and with nothing there they stay on the bar, never jumping to another row or
  Kino's title bar. Entering the bar, from above, below or beside, lands on the selected tab. The same for `Chips`.
- **Phone and TV:** a body under the screen's first `TabBar` (anywhere: a header `Row` too) that is a `Scroll`, a
  `ListView` or a grid of titles with a `key` of yours keeps its scroll per tab: keyed per tab (`newsBody`,
  `settingsBody`) or not, coming back to a tab finds it where the person left it.
- **Phone and TV:** a row of tabs on both.
- **Limits and mistakes:** reading `state.inputs.<key>` for a tab gives nothing; a `TabBar` with no valid tab is dropped.

<a id="accordion"></a>
### ExpansionTile (accordion)

Sections that open and close: frequently asked questions, advanced options. Toggling is Kino's (no call to your plugin);
which items are open lives in `state.ui.open.<key>`, so it survives a re-render. One at a time unless `multiple`.

> Screenshot slots: `ui-img/accordion-phone.png`, `ui-img/accordion-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:accordion:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | which items are open lives in `state.ui.open.<key>` |
| `items` | `{ key, title, titleEn?, children?, open? }[]` | required | no | 1 to 500; `open` is only the first look |
| `multiple` | boolean | `false` | no | several items open at once |
<!-- ui:props:accordion:end -->

```json
{ "type": "ExpansionTile", "key": "faq", "items": [
  { "key": "what", "title": "¿Qué es?", "titleEn": "What is it?", "open": true, "children": [{ "type": "Text", "text": "Una sección.", "textEn": "A section." }] },
  { "key": "how", "title": "¿Cómo funciona?", "titleEn": "How does it work?", "children": [{ "type": "Text", "text": "Se abre y se cierra.", "textEn": "It opens and closes." }] }
] }
```

```js
export async function screen() {
  const faq = [["what", "¿Qué es?", "Una galería."], ["who", "¿Quién la dibuja?", "Kino."]];
  return { type: "ExpansionTile", key: "faq", items: faq.map(([key, title, text]) => ({ key, title, children: [{ type: "Text", text }] })) };
}
```

- **TV:** each header takes focus and OK toggles it; Down from an open header enters its content.
- **Phone and TV:** the same component.
- **Limits and mistakes:** `key` is required; items 1 to 500 with distinct keys; each header costs one node of the 600,
  and when the budget runs out the accordion keeps fewer items. Never in an answer's pop-up. A required field in a closed
  item does not keep a form's submit off, but the submit opens the item when it fails.

<a id="steps"></a>
### steps

A setup flow in Kino's own look, for any plugin with steps to walk through (sign in, a code, a password, done): each step
a header with Kino's numbered circle (a check once done). The `current` step is open, its `children` drawn under it (a
`Form` with a masked `TextField`, a `QrImage`...); a `done` step collapses to its `subtitle` (or Kino's «Listo»); a
`pending` one is dimmed. With `onStepTap` a done step is pressable, so the person can go back to it.

> Screenshot slots: `ui-img/steps-phone.png`, `ui-img/steps-tv.png` (not captured yet, see [Screenshots](#screenshots)).

<!-- ui:props:steps:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `items` | `{ key, title, titleEn?, subtitle?, subtitleEn?, state, children? }[]` | required | no | 1 to 12; `state` `done`, `current`, `pending`; exactly one `current` (its children are drawn under it); a `done` one shows its `subtitle` (else Kino's «Listo») |
| `onStepTap` | event name or `{ event }` | none | no | a `done` step becomes pressable (touch, or OK on the TV): the event goes with the step's `key` as `arg` |
<!-- ui:props:steps:end -->

```json
{ "type": "steps", "key": "login", "onStepTap": "goBack", "items": [
  { "key": "phone", "title": "Tu número", "titleEn": "Your number", "subtitle": "+57 300 •••• 12", "state": "done" },
  { "key": "code", "title": "Código", "titleEn": "Code", "state": "current", "children": [
    { "type": "Form", "key": "codeForm", "onSubmitted": "checkCode", "children": [
      { "type": "TextField", "key": "code", "kind": "number", "labelText": "Código", "required": true, "minLength": 5 },
      { "type": "ElevatedButton", "labelText": "Siguiente", "labelTextEn": "Next", "submit": true }
    ] }
  ] },
  { "key": "twofa", "title": "Contraseña", "titleEn": "Password", "state": "pending" }
] }
```

```js
export async function screenEvent({ name, arg, state }) {
  if (name === "goBack") return { state: { step: arg } }; // arg: the done step's key
  if (name === "checkCode") return { state: { step: "twofa" } };
  return null;
}
```

- **Phone and TV:** the same flow. On the TV only a pressable done step and the current step's own fields take focus: Down
  from a done step goes into the open step; OK on a done step sends `onStepTap`. A screen reader reads each header as
  «Paso 2 de 3: Código, actual».
- **Limits and mistakes:** 1 to 12 steps, each with a valid, distinct `key` and a `title`. Exactly one `current`: none
  while a step is still to do makes the first one not done current; two keep the first; an unknown `state` reads as
  `pending`; children on a step that is not current are not drawn (all logged). Each header counts as one node of the
  tree's budget; the open step's children sit one level below the node.

<a id="card"></a>
### Card

Kino's card around its children: `plain` (the default), `outlined` or `filled`. With `flush: true` the card has no
padding of its own and clips its children to its rounded shape, so an `Image` at its top runs edge to edge (pad the text
yourself). A card with an `onTap` is a press target as a whole.

**Containers own their padding: one value on all sides, children add none.** Without a `padding` of yours a card keeps 16 dp
on every side of its content (24 on the TV) and its children 8 dp apart (12 on the TV); a `padding` or `gap` you declare wins.

> Screenshot slots: `ui-img/card-phone.png`, `ui-img/card-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:card:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes[] | none | no | its children, drawn in order |
| `variant` | `plain` \| `outlined` \| `filled` | `plain` | yes | Kino's three card looks |
| `flush` | boolean | `false` | yes | no padding of its own and its children clipped to its rounded shape: an `Image` at its top runs edge to edge |
<!-- ui:props:card:end -->

```json
{ "type": "Card", "key": "story", "flush": true, "onTap": { "event": "read", "arg": "story-1" }, "children": [
  { "type": "Image", "url": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg", "aspect": "16:9", "alt": "Big Buck Bunny" },
  { "type": "Column", "padding": 12, "gap": 4, "children": [
    { "type": "Text", "text": "Un titular", "textEn": "A headline", "style": "h4", "maxLines": 3 },
    { "type": "Text", "text": "La fuente", "textEn": "The source", "style": "caption", "color": "muted" }
  ] }
] }
```

```js
export async function screen() {
  const card = (variant) => ({ type: "Card", variant, children: [{ type: "Text", text: variant }] });
  return { type: "Column", gap: 8, padding: 16, children: [card("plain"), card("outlined"), card("filled")] };
}
```

- **TV:** a card with an action takes focus with Kino's ring; one without is skipped.
- **Phone and TV:** the same look; `flush` clips on both.
- **Limits and mistakes:** with `flush` the card's own `padding` is not used: pad its text children. A card is a
  container cell in a twelve-column row: it stretches to its line's height unless it has a fixed `height`.

<a id="scaffold"></a>
### Scaffold

Flutter's `Scaffold` (Task 17): the root of a screen or of a player panel with an `appBar` pinned at the top of your area, a
`body` in the height left, a `floatingActionButton` above a `bottomNavigationBar` at the bottom. Only as a result's root (a
nested one is dropped, logged); a result whose root is a `Scaffold` is drawn in `layout: "fill"` without asking (another
`layout` is ignored, logged). Its body is bounded: a `ListView` or a `SingleChildScrollView` in it scrolls itself while the
bars stay put, and the keyboard shrinks the body, never the bars. A scrolling body keeps room under its last line (16 dp,
24 on the TV), so the end of a long text is never cut at the window's edge; on the TV, Down with nothing more to focus pages
the body (an opened `ExpansionTile`'s text too) and, at its very end, stays put.

**Kino's own title bar stays.** Over every plugin screen Kino draws the bar with your plugin's name and Close (an X alone; a screen reader says «Cerrar», «Close» in English); a `Scaffold`'s
`AppBar` sits under it, inside your area, and never replaces or covers it (the person always knows whose screen this is and
how to leave). In a player panel the `AppBar` is compact (one 48 dp row). The bar owns one padding on all sides (16 dp; 24 on the TV, 16 in a
panel) round its title row and its `bottom` TabBar together, so the first tab lines up with the title and nothing touches
the bar's edges; a hairline marks its lower edge, so the body that scrolls under it never merges with it. On the TV the D-pad goes from the `AppBar`'s
`leading` and `actions` to the body, then the bottom bar and the button; Up from the body's first stop reaches the bar's
`bottom` TabBar on its selected tab (with no `bottom`, its last action), never Kino's Close past it; while the body can
still scroll up, Up pages it first. Right past the last tab reaches the bar's actions in order (Left past the first tab its
`leading`), Down from an action goes back to the tabs, and Down from the tabs to the body. Back closes or pops as everywhere.

<!-- ui:props:scaffold:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `appBar` | an `AppBar` | none | no | pinned at the top of your area, under Kino's own title bar (never replacing or covering it) |
| `body` | node | required | no | the bounded height left: a `ListView` or a scroll in it scrolls itself while the bars stay |
| `floatingActionButton` | a `FloatingActionButton` | none | no | above the bottom bar |
| `bottomNavigationBar` | a `NavigationBar` | none | no | at the bottom |
<!-- ui:props:scaffold:end -->

See the recipe [A screen with an app bar, tabs and a floating button](#recipe-scaffold).

<a id="app-bar"></a>
### AppBar

Only a `Scaffold`'s `appBar` (anywhere else dropped, logged): a row with a `leading` `IconButton`, the `title` (read as a
heading by a screen reader) and up to four `actions` `IconButton`s (the rest dropped, logged; each needs a `labelText`, what a
screen reader says, and may carry a `badge`), then an optional `bottom` `TabBar`. `backgroundColor` is a colour role,
`elevation` Kino's shadow. A bar without a title is a row of buttons.

**`title` is a string or any node** (Flutter's way): a string is a `Text` read as the heading (`titleEn` its twin); a node
(a `TabBar`, a `Row` of buttons, an `Image`, a `Text` with its own style; at most 40 nodes, else dropped, logged; localize its
texts yourself) takes the room left of the `actions` in the same row: a `TabBar` there scrolls sideways when it overflows,
and on the TV its tabs and the actions are one row for the D-pad (Right past the last tab reaches the first action, Up from
the body lands on the selected tab). `bottom` stays for the classic second row. See [Tabs in the app bar](#recipe-app-bar-tabs).

<!-- ui:props:appBar:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string or a node | none | no | a string (`titleEn` its twin) is read as a heading; or, Flutter's way, any node (a `TabBar`, a `Row` of buttons...; at most 40 nodes) in the room left of the actions |
| `leading` | an `IconButton` | none | no | with a `labelText` (back, a menu) |
| `actions` | `IconButton[]` | none | no | at most 4, each with a `labelText`; a `badge` allowed |
| `bottom` | a `TabBar` | none | no | under the row |
| `centerTitle` | boolean | `false` | no | the title centred |
| `backgroundColor` | a colour role | Kino's surface | no | its text and icons in the role's readable colour |
<!-- ui:props:appBar:end -->

<a id="navigation-bar"></a>
### NavigationBar

Only a `Scaffold`'s `bottomNavigationBar` (anywhere else dropped, logged): 2 to 5 `items` (`{ key, icon, label, labelEn?,
badge? }`; more are dropped, fewer than two drop the bar, both logged). A phone draws Material's navigation bar, a TV a
bottom row of focusable items with Kino's ring. A press on another item sends `onChanged` with the item's `key` as `value`;
like a `TabBar`'s, the picked item is not in `state.inputs`: keep it in your state and draw the matching body.

<!-- ui:props:navigationBar:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `items` | `{ key, icon, label, labelEn?, badge? }[]` | required | no | 2 to 5, keys distinct |
| `value` | string | the first item | no | the picked item's key (or `selectedIndex`); NOT in `state.inputs`: keep it in your state from `onChanged` |
| `selectedIndex` | integer | none | no | the picked item by its place, when there is no `value` |
| `onChanged` | action | none | no | its event's `value` is the item's key |
<!-- ui:props:navigationBar:end -->

<a id="page-view"></a>
### PageView (and the carousel)

Flutter's `PageView` (Task 17): its `children` are pages, swiped across on a phone; on a TV Left and Right at a page's edge
turn the page (a page with nothing focusable leaves the pager itself as the stop). Kino draws the page dots under it and a
screen reader hears «Página 2 de 5». `onPageChanged` sends the settled page's index as `value`; `initialPage` is only the
first look (the page the person reached survives your re-renders). `autoPlayMs` (3,000 to 60,000) turns the page on its own,
paused while the person touches or focuses it and when the device's animations are off. `viewportFraction` below 1 is
Kino's carousel: the neighbouring pages peek at the sides (`padEnds: false` starts the first page at the edge). Never inside
a sideways scroll or a table cell (dropped, logged); at most 24 pages.

<!-- ui:props:pageView:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes (the pages)[] | none | no | its children, drawn in order |
| `initialPage` | integer | `0` | no | the first look only; past the last page, the last |
| `onPageChanged` | action | none | no | its event's `value` is the settled page's index |
| `autoPlayMs` | 3,000 to 60,000 | none | no | turns the page on its own; paused while touched or focused and with animations off |
| `viewportFraction` | 0.3 to 1 | `1` | yes | below 1, Kino's carousel: the neighbouring pages peek |
| `padEnds` | boolean | `true` | yes | the first and last pages centred in a carousel |
<!-- ui:props:pageView:end -->

```json
{ "type": "PageView", "key": "covers", "viewportFraction": 0.8, "autoPlayMs": 5000, "onPageChanged": "page", "children": [
  { "type": "Card", "flush": true, "children": [{ "type": "Image", "url": "https://img.example.com/1.jpg", "aspect": "16:9" }] },
  { "type": "Card", "flush": true, "children": [{ "type": "Image", "url": "https://img.example.com/2.jpg", "aspect": "16:9" }] }
] }
```

<a id="list-tile"></a>
### ListTile

Flutter's `ListTile` (Task 17): one row of a list in Material's heights (56 dp, 72 with a `subtitle`, 48 `dense`): a `leading`
and a `trailing` (one small node each: an `Icon`, a `CircleAvatar`, an `Image`, a `Badge`, a `Text` or a spinner; never
pressed themselves, their actions ignored, logged), the `title` and the `subtitle`. The whole tile is one press (`onTap`,
`onLongPress`) and, on the TV, one focus stop with Kino's ring (only with an `onTap`: a tile that does nothing never rings).
`selected` (with an `onTap`) fills it with Kino's primaryContainer and reads as selected.

<!-- ui:props:listTile:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | required | no | `titleEn`; at most two lines |
| `subtitle` | string | none | no | `subtitleEn`; Kino's muted second line |
| `leading` | node | none | no | one of `Icon`, `CircleAvatar`, `Image`, `Badge`, `Text`, `CircularProgressIndicator`, never pressed itself |
| `trailing` | node | none | no | as `leading`, at the end |
| `dense` | boolean | `false` | yes | a lower row (48 dp instead of 56, 72 with a subtitle) |
<!-- ui:props:listTile:end -->

```json
{ "type": "ListView", "items": [
  { "type": "ListTile", "key": "m1", "title": "María", "subtitle": "En línea", "subtitleEn": "Online", "onTap": "chat",
    "leading": { "type": "CircleAvatar", "text": "MA" }, "trailing": { "type": "Badge", "text": "2" } }
] }
```

<a id="content"></a>
## Content

What the person reads and looks at.

<a id="text"></a>
### Text

Plain text in one of Kino's styles. It never holds markup or links, keeps newlines and follows the app's reading
direction. Give every text its English twin (`textEn`): Kino picks by the person's language.

> Screenshot slots: `ui-img/text-phone.png`, `ui-img/text-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:text:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `text` | string | required (optional with `time`) | no | 1 to 2,000 characters, plain (no markup, no links); newlines kept; with a `time` it is its prefix |
| `textEn` | string | none | no | the English twin, shown when the app is in English |
| `style` | `h1` \| `h2` \| `h3` \| `h4` \| `h5` \| `p` \| `caption` \| `label` | `p` | yes | Kino's type scale ([Text scale](#text-scale)); `display`, `title`, `subtitle`, `body` read as `h1`, `h3`, `h4`, `p` |
| `maxLines` | integer ≥ 1 | none | yes | cut with an ellipsis |
| `bold` | boolean | `false` | yes | headings are bold already; `false` never thins one |
| `time` | epoch ms | none | no | a whole number 0 to 253,402,300,799,999: Kino writes the time itself in the app's language ([Text with a time](#text-time)) |
| `timeFormat` | `relative` \| `clock` \| `countdown` | `relative` | no | `relative` («hace 2 min», rewritten every 1 minute while shown, no call to you), `clock` («18:42», the device's 12/24 h) or `countdown` («0:42» left, every second, «0:00» once reached) |
<!-- ui:props:text:end -->

```json
{ "type": "Column", "gap": 4, "children": [
  { "type": "Text", "text": "Título", "textEn": "Title", "style": "h1" },
  { "type": "Text", "text": "Un párrafo que se corta en dos líneas.", "textEn": "A paragraph cut at two lines.", "maxLines": 2 },
  { "type": "Text", "text": "Importante", "textEn": "Important", "bold": true, "color": "warning" }
] }
```

```js
export async function screen({ state }) {
  const name = typeof state.name === "string" ? state.name : "Ana";
  return { type: "Text", text: "Hola, " + name, textEn: "Hello, " + name, style: "h2", crossAxisAlignment: "center" };
}
```

- **TV:** never focused by itself (a text inside a pressable card goes with the card).
- **Phone and TV:** every style grows by 1.25 on the TV, so the order of the scale holds at ten feet; the person's font
  scale is respected on both.
- **Limits and mistakes:** at most 2,000 characters; an empty text is dropped. No font family, size, italic or free colour:
  only `style`, `bold` and a colour role. `onPrimary` never reads on a surface: it falls back to the default (logged).

<a id="text-time"></a>
#### Text with a time

`time` (epoch ms) makes Kino write the time itself, in the app's language: `timeFormat: "relative"` (the default: «ahora»,
«hace 2 min», «hace 3 h», «ayer», a date beyond; «en 5 min» for one ahead), rewritten once a minute while it shows with no call
to your plugin, `"clock"` («18:42», the device's 12 or 24 hour setting), or `"countdown"` (Task 18: the wait left, «0:42»,
«1:02:03», rewritten every second while it runs, «0:00» once reached). With a `time` the `text` is optional and is its
prefix. A time that is not a whole number from 0 is dropped (logged), and the `text` is then required again.

A pressable's `enabledAt` (Task 18; a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`) draws it off until
that time on the device's clock and turns it on by itself, with no call to your plugin: «Reenviar» after a minute.

```json
{ "type": "Row", "gap": 8, "children": [
  { "type": "TextButton", "labelText": "Reenviar código", "labelTextEn": "Send the code again", "enabledAt": 1761580860000, "onPressed": "resend" },
  { "type": "Text", "text": "en", "textEn": "in", "time": 1761580860000, "timeFormat": "countdown", "style": "caption" }
] }
```

```json
{ "type": "Column", "children": [
  { "type": "Text", "text": "Actualizado", "textEn": "Updated", "style": "caption", "time": 1761580800000 },
  { "type": "Text", "time": 1761580800000, "timeFormat": "clock", "style": "caption", "color": "muted" }
] }
```

<a id="text-scale"></a>
### Text scale

`style` maps onto Kino's own type scale: on the phone `h1` is the headline-large step down to `p`, the body-medium step;
`caption` is the small muted step and `label` the one buttons use. On the TV each step grows by 1.25. Headings are bold
already. The older names `display`, `title`, `subtitle` and `body` read as `h1`, `h3`, `h4` and `p`; an unknown style is
`p` (logged).

> Screenshot slots: `ui-img/text-scale-phone.png`, `ui-img/text-scale-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "type": "Column", "gap": 4, "children": [
  { "type": "Text", "text": "h1", "style": "h1" }, { "type": "Text", "text": "h2", "style": "h2" },
  { "type": "Text", "text": "h3", "style": "h3" }, { "type": "Text", "text": "h4", "style": "h4" },
  { "type": "Text", "text": "h5", "style": "h5" }, { "type": "Text", "text": "p", "style": "p" },
  { "type": "Text", "text": "caption", "style": "caption" }, { "type": "Text", "text": "label", "style": "label" }
] }
```

<a id="colors"></a>
### Colours

`color` takes a **role**, never a value: `primary`, `secondary`, `surface`, `muted`, `warning`, `error`, `onPrimary`,
`primaryContainer` and `surfaceVariant`,
painted with Kino's palette (your manifest's `theme` tints `primary` where it passes the contrast rules). A role that would
not read on its surface is nudged toward the surface's own text colour until it does (4.5:1). On a `Text` it colours the
text; on a container (a `Stack`, a fallback) it is the fill.

> Screenshot slots: `ui-img/colors-phone.png`, `ui-img/colors-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "type": "Column", "gap": 4, "children": [
  { "type": "Text", "text": "primary", "color": "primary" },
  { "type": "Text", "text": "muted", "color": "muted" },
  { "type": "Text", "text": "warning", "color": "warning" },
  { "type": "Text", "text": "error", "color": "error" }
] }
```

- **Mistakes:** a hex value (`"#ff0000"`) is off the role list and is dropped. Use `MaterialBanner` or a toast's `role` for
  the success colour (`success` is a role of those, not of `color`). A word Kino recognises gets the closest role named in
  its log line, the same in the app and the kit: `screen: text color "success" is not a color role ("success" is a banner
  and toast role; the closest color role is "primary"), dropped` (also `info` → `secondary`, `danger` → `error`, `grey` →
  `muted`, a role in other capitals → that role).

The two container roles (Task 15) are for a box that stands out without a banner: `primaryContainer` (Kino's surface tinted
with the primary; a manifest `theme` tints it as it tints `primary`) and `surfaceVariant` (Kino's raised surface). On a box
(`Card`, `Column`, `Row`, `Stack`) they are its fill, and its text and icons take the matching on-colour by themselves; on a
`Text` or an `Icon` they are the colour, nudged to read like every role. A chat's own bubble, three quarters wide at most,
its tail corner small:

```json
{ "type": "Column", "crossAxisAlignment": "end", "fill": true, "children": [
  { "type": "Card", "key": "mine", "color": "primaryContainer", "maxWidthFraction": 0.75,
    "borderRadius": { "topStart": "large", "topEnd": "large", "bottomStart": "large", "bottomEnd": "small" },
    "children": [{ "type": "Text", "text": "Ya llegué", "textEn": "I'm here" }] }
] }
```

<a id="image"></a>
### Image

A picture from a public https address (no host declaration needed, as for every image in Kino). `aspect` fixes the box's
shape; `fallback` is one node drawn in that box when the picture fails or there is no `url`, so a broken feed never shows
a hole.

> Screenshot slots: `ui-img/image-phone.png`, `ui-img/image-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:image:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `url` | https URL | required without `fallback` | no | a public https host (no declaration needed); with a `fallback`, no `url` draws the fallback (an empty or refused one too, logged) |
| `alt` | string | none | no | what a screen reader says (`altEn` the English one) |
| `aspect` | `16:9` \| `2:3` \| `1:1` \| `banner` | the picture's own | yes | the box's shape |
| `fallback` | node | none | no | drawn in the image's box when the picture fails or there is no `url`: only `Column`, `Row`, `Stack`, `Card`, `Spacer`, `Divider`, `Text`, `Icon`, `Badge`, `Skeleton`, `Image`, at any depth, never pressed |
<!-- ui:props:image:end -->

```json
{ "type": "Image", "url": "https://kinotvapp.github.io/kino-plugins/missing-picture.png", "aspect": "16:9", "alt": "Sin imagen", "altEn": "No picture",
  "fallback": { "type": "Stack", "color": "surface", "children": [
    { "type": "Column", "padding": 12, "children": [{ "type": "Icon", "name": "movie" }, { "type": "Text", "text": "La fuente", "textEn": "The source", "style": "h3" }] }
  ] } }
```

```js
export async function screen({ state }) {
  const picture = typeof state.picture === "string" && state.picture ? { url: state.picture } : {}; // no url at all: the fallback, no log line
  return { type: "Image", ...picture, aspect: "16:9", alt: "Póster", fallback: { type: "Text", text: "Sin imagen", textEn: "No picture", padding: 12 } };
}
```

- **TV:** an image is not focused unless it (or what holds it) has an action.
- **Phone and TV:** the same.
- **Limits and mistakes:** `http://` and private addresses are refused (without a fallback the node is dropped; with one
  the fallback draws, and a `url` that is present but empty or refused is logged: leave `url` out when there is none). The fallback takes only simple nodes (`Column`, `Row`, `Stack`, `Card`, `Spacer`, `SizedBox`,
  `Divider`, `Text`, `Icon`, `Badge`, `Skeleton`, `Image`) and nothing in it is pressed. Without a fallback a failed
  picture shows Kino's mark.

<a id="icon"></a>
### Icon

One of Kino's icons by `name`; `color` takes a role. The same names serve a button's `icon` (an `IconButton` too), a
menu item's, the empty and error states', the manifest's `screen.icon` and the player panel's `panel.icon`. They are
Material Symbols (outlined), drawn as vectors: crisp at any size, tinted by the colour role around them. An icon says
nothing to a screen reader: an `IconButton` is read by its `labelText`.

> Screenshot slots: `ui-img/icon-phone.png`, `ui-img/icon-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:icon:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `name` | 50 names | required | no | one of Kino's icons (the [icon table](#icon-names)): `info`, `tune`, `settings`, `star`, `bolt`, `language`, `subtitles`, `list`, `magic`, `heart`, `movie`, `tv`, `sports`, `music`, `bookmark`, `help`, `refresh`, `sync`, `add`, `remove`, `delete`, `edit`, `search`, `close`, `check`, `share`, `play`, `pause`, `download`, `upload`, `link`, `open_in_new`, `home`, `person`, `lock`, `notifications`, `warning`, `error`, `visibility`, `copy`, `arrow_back`, `arrow_forward`, `expand_more`, `expand_less`, `more_vert`, `filter_list`, `calendar`, `schedule`, `send`, `mood`; the last 34 from apiVersion 14 |
<!-- ui:props:icon:end -->

```json
{ "type": "Row", "gap": 8, "children": [
  { "type": "Icon", "name": "star", "color": "primary" },
  { "type": "Icon", "name": "heart", "color": "error" },
  { "type": "Icon", "name": "movie" }
] }
```

```js
export async function screen() {
  return { type: "Row", gap: 8, children: ["info", "star", "heart"].map((name) => ({ type: "Icon", name })) };
}
```

- **Mistakes:** a name off the list (`"replay"`, a Material icon name such as `"Refresh"`) drops the node. Icons are not
  focusable.
- **apiVersion:** the first sixteen names work from apiVersion 9 (the player panel's button); the rest arrived with
  apiVersion 14. Screens need apiVersion 14, so a screen knows every name; a `panel.icon` of the newer names in a plugin
  below apiVersion 14 is an unknown name (the button draws `tune`).

<a id="icon-names"></a>
#### Icon names

Every name, what it shows, and since when. The [screen gallery](examples/screen-gallery/) draws them all, each with its
name, in the «Todos los iconos» section of its Contenido tab.

> Screenshot slots: `ui-img/icon-names-phone.png`, `ui-img/icon-names-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:icons:start -->
| Name | What it shows | Since |
| --- | --- | --- |
| `info` | information, details | apiVersion 9 |
| `tune` | options, adjustments (Kino's default) | apiVersion 9 |
| `settings` | settings | apiVersion 9 |
| `star` | a favourite, a rating | apiVersion 9 |
| `bolt` | quick, live, an action | apiVersion 9 |
| `language` | language, the web | apiVersion 9 |
| `subtitles` | subtitles, captions | apiVersion 9 |
| `list` | a list, an index | apiVersion 9 |
| `magic` | suggestions, something automatic | apiVersion 9 |
| `heart` | liked, saved | apiVersion 9 |
| `movie` | a film | apiVersion 9 |
| `tv` | a series, television | apiVersion 9 |
| `sports` | sport | apiVersion 9 |
| `music` | music, audio | apiVersion 9 |
| `bookmark` | saved for later | apiVersion 9 |
| `help` | help, a question | apiVersion 9 |
| `refresh` | refresh now (a circular arrow) | apiVersion 14 |
| `sync` | sync between devices | apiVersion 14 |
| `add` | add, new | apiVersion 14 |
| `remove` | remove one, less | apiVersion 14 |
| `delete` | delete (a bin) | apiVersion 14 |
| `edit` | edit (a pencil) | apiVersion 14 |
| `search` | search | apiVersion 14 |
| `close` | close, dismiss | apiVersion 14 |
| `check` | done, confirmed | apiVersion 14 |
| `share` | share | apiVersion 14 |
| `play` | play | apiVersion 14 |
| `pause` | pause | apiVersion 14 |
| `download` | download | apiVersion 14 |
| `upload` | upload, send a file | apiVersion 14 |
| `link` | a link | apiVersion 14 |
| `open_in_new` | opens outside (a link that leaves) | apiVersion 14 |
| `home` | home, the start | apiVersion 14 |
| `person` | a person, an account | apiVersion 14 |
| `lock` | locked, private | apiVersion 14 |
| `notifications` | notifications, alerts | apiVersion 14 |
| `warning` | a warning (a triangle) | apiVersion 14 |
| `error` | an error (a circle with a mark) | apiVersion 14 |
| `visibility` | show, seen (an eye) | apiVersion 14 |
| `copy` | copy | apiVersion 14 |
| `arrow_back` | back, previous | apiVersion 14 |
| `arrow_forward` | forward, next | apiVersion 14 |
| `expand_more` | open, more (a chevron down) | apiVersion 14 |
| `expand_less` | close, less (a chevron up) | apiVersion 14 |
| `more_vert` | more actions (three dots) | apiVersion 14 |
| `filter_list` | filter | apiVersion 14 |
| `calendar` | a date, a calendar | apiVersion 14 |
| `schedule` | a time, scheduled (a clock) | apiVersion 14 |
| `send` | send a message (a paper plane) | apiVersion 14 |
| `mood` | a reaction, a feeling (a smiley) | apiVersion 14 |
<!-- ui:icons:end -->

```json
{ "type": "ElevatedButton", "labelText": "Actualizar ahora", "labelTextEn": "Refresh now", "icon": "refresh", "onPressed": "refresh" }
```

<a id="badge"></a>
### Badge

A small label: a count, a quality tag, "Nuevo".

> Screenshot slots: `ui-img/badge-phone.png`, `ui-img/badge-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:badge:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `text` | string | required | no | a short label (`textEn` the English one) |
<!-- ui:props:badge:end -->

```json
{ "type": "Row", "gap": 8, "children": [
  { "type": "Badge", "text": "Nuevo", "textEn": "New" },
  { "type": "Badge", "text": "HDR", "color": "warning" }
] }
```

```js
export async function screen({ state }) {
  const unread = Number.isInteger(state.unread) ? state.unread : 3;
  return { type: "Row", gap: 8, children: [{ type: "Text", text: "Mensajes" }, { type: "Badge", text: String(unread) }] };
}
```

- **Mistakes:** an empty `text` drops it; a badge is not pressable on its own (put the action on its parent).

<a id="circle-avatar"></a>
### CircleAvatar

Flutter's `CircleAvatar` (Task 17): a circle of `radius` dp in a colour role holding a picture (https, through Kino's own
image pipeline and host rules), else initials (at most three characters), else an icon (Kino's person by default). A picture
that fails shows the initials. It is always a circle: it takes no `borderRadius` (its `radius` is a number). A screen reader
says its `labelText`, else its initials.

<!-- ui:props:avatar:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `image` | https URL | none | no | a public https picture, through Kino's image pipeline; when it fails, the initials |
| `text` | string | none | no | initials, at most 3 characters (`textEn`) |
| `icon` | a Kino icon name | `person` | no | without a picture or initials |
| `radius` | 12 to 64 (dp) | `20` | yes | always a circle: a `CircleAvatar` takes no `borderRadius` |
| `backgroundColor` | a colour role | `primaryContainer` | no | its initials and icon in the role's readable colour |
| `labelText` | string | none | no | what a screen reader says (`labelTextEn`); else the initials |
<!-- ui:props:avatar:end -->

```json
{ "type": "Row", "gap": 8, "children": [
  { "type": "CircleAvatar", "image": "https://img.example.com/me.jpg", "text": "MA", "labelText": "María" },
  { "type": "CircleAvatar", "text": "JP", "backgroundColor": "secondary", "radius": 24 },
  { "type": "CircleAvatar", "icon": "person" }
] }
```

<a id="banner"></a>
### MaterialBanner

A line of news across the screen in Kino's colour for its `role`: an update, a warning, a failure with «Reintentar». It
may carry a title, one action button, and Kino's close when `dismissible`.

> Screenshot slots: `ui-img/banner-phone.png`, `ui-img/banner-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:banner:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `text` | string | required | no | `textEn` |
| `role` | `info` \| `warning` \| `error` \| `success` | `info` | no | Kino's colour and icon for it |
| `title` | string | none | no | `titleEn` |
| `action` | `{ label, labelEn?, onTap }` | none | no | one button |
| `dismissible` | boolean | `false` | no | Kino's close (needs a `key` of its own): hides it and sends the event `dismiss` with the key as `arg` |
<!-- ui:props:banner:end -->

```json
{ "type": "Column", "gap": 8, "children": [
  { "type": "MaterialBanner", "role": "error", "text": "No se pudo cargar.", "textEn": "Could not load.", "action": { "label": "Reintentar", "labelEn": "Retry", "onTap": "retry" } },
  { "type": "MaterialBanner", "key": "tip", "role": "info", "title": "Consejo", "titleEn": "Tip", "text": "Puedes cerrar este aviso.", "textEn": "You can dismiss this notice.", "dismissible": true }
] }
```

```js
export async function screen({ state }) {
  if (!state.failed) return { type: "Text", text: "Todo bien", textEn: "All good" };
  return { type: "MaterialBanner", role: "warning", text: "Sin conexión", textEn: "Offline", action: { label: "Reintentar", labelEn: "Retry", onTap: "retry" } };
}

export async function screenEvent({ name }) {
  if (name === "dismiss") return null; // a dismissible banner's close: arg is its key, Kino already hid it
  if (name === "retry") return { state: { failed: false } };
  return null;
}
```

- **TV:** the action and the close are focus stops in tree order.
- **Phone and TV:** full width on both.
- **Limits and mistakes:** `dismissible` needs a `key` of your own (a generated one is ignored, logged). The close hides it
  at once (`state.ui.hidden`) and sends the event `dismiss` with the key as `arg`.

<a id="progress"></a>
### LinearProgressIndicator

A progress bar: `value` from 0 to 1, or none for an indeterminate one. A `labelText` sits beside it.

> Screenshot slots: `ui-img/progress-phone.png`, `ui-img/progress-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:progress:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `value` | number 0 to 1 | none | no | none draws an indeterminate bar; outside 0..1 is clamped |
| `labelText` | string | none | no | a label beside the bar (`labelTextEn`) |
<!-- ui:props:progress:end -->

```json
{ "type": "Column", "gap": 8, "children": [
  { "type": "LinearProgressIndicator", "value": 0.6, "labelText": "60 %" },
  { "type": "LinearProgressIndicator" }
] }
```

```js
export async function screen({ state }) {
  const done = Number.isFinite(state.done) ? state.done : 0;
  return { type: "LinearProgressIndicator", value: Math.min(1, done / 10), labelText: done + " / 10" };
}
```

- **Mistakes:** a value outside 0..1 is clamped (logged); a non-number makes it indeterminate.

<a id="loading"></a>
### CircularProgressIndicator

Kino's spinner, with an optional line under it. While a screen waits for data, a [`Skeleton`](#skeleton) shaped like the
content reads better.

> Screenshot slots: `ui-img/loading-phone.png`, `ui-img/loading-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:loading:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `text` | string | none | no | a line under Kino's spinner (`textEn`) |
<!-- ui:props:loading:end -->

```json
{ "type": "CircularProgressIndicator", "text": "Cargando", "textEn": "Loading" }
```

```js
export async function screen({ state }) {
  return state.ready ? { type: "Text", text: "Listo" } : { type: "CircularProgressIndicator", text: "Cargando", textEn: "Loading" };
}
```

<a id="skeleton"></a>
### Skeleton

A placeholder while something loads, in Kino's muted colour, pulsing gently (still when the system's animations are
off), read as "Cargando…": `line` (1 to 6 bars), `block`, `circle` or `card` (a poster and its lines).

> Screenshot slots: `ui-img/skeleton-phone.png`, `ui-img/skeleton-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:skeleton:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `shape` | `line` \| `block` \| `circle` \| `card` | `line` | yes | size it with `width`/`height` |
| `lines` | 1 to 6 | `1` | yes | bars of a `line` |
<!-- ui:props:skeleton:end -->

```json
{ "type": "Row", "gap": 12, "children": [
  { "type": "Skeleton", "shape": "circle", "width": 48, "height": 48 },
  { "type": "Skeleton", "shape": "line", "lines": 3, "flex": 1 }
] }
```

```js
export async function screen({ state }) {
  if (!Array.isArray(state.items)) return { type: "Column", gap: 12, padding: 16, children: [1, 2, 3].map(() => ({ type: "Skeleton", shape: "card", width: 160 })) };
  return { type: "Column", children: state.items.slice(0, 50).map((t, i) => ({ type: "Text", key: "t" + i, text: String(t) })) };
}
```

- **Mistakes:** `lines` above 6 is lowered (logged). Size a `block` with `height`, or it is a thin bar.

<a id="qr"></a>
### QrImage

A QR code Kino draws on the device (no network), black on white with its quiet zone: a link for a TV viewer to open on
their phone, a room code to scan. Never pressed, never focused; it may sit in a pop-up.

> Screenshot slots: `ui-img/qr-phone.png`, `ui-img/qr-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:qr:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `value` | string | required | no | 1 to 1,000 characters, drawn as written; a value holding one of your secrets is never drawn |
| `labelText` | string | none | no | what a screen reader says (`labelTextEn`) |
| `size` | `small` \| `medium` \| `large` | `medium` | yes | one of Kino's three sizes |
| `expiresInMs` | 1,000 to 3,600,000 | none | no | the code stops working that long after Kino first draws this value: Kino counts it down under the code and dims it at zero ([countdown](#qr-countdown)) |
| `expiresAt` | epoch ms | none | no | the same as a time (the device's clock, read once), at most 3,600,000 ms away; ignored beside `expiresInMs` |
| `onExpire` | event name or `{ event, arg? }` | none | no | sent once per value: `renew` `renewBeforeMs` before the end, else `expired` at zero; `value` is `{ phase, remainingMs }` |
| `renewBeforeMs` | 1,000 to 3,600,000 | none | no | with `onExpire`: ask for a new code that long before the end (below the lifetime, else half of it) |
<!-- ui:props:qr:end -->

```json
{ "type": "QrImage", "value": "https://kinotvapp.github.io/kino-plugins/", "size": "medium", "labelText": "Guía de plugins", "labelTextEn": "Plugin guide" }
```

```js
export async function screen({ device }) {
  const link = "https://kinotvapp.github.io/kino-plugins/";
  return device === "tv"
    ? { type: "QrImage", value: link, size: "large", labelText: "Escanéalo con tu teléfono" }
    : { type: "ElevatedButton", labelText: "Abrir", onPressed: { go: { url: { href: link } } } };
}
```

- **Phone and TV:** the same picture; on a TV it is the way to hand over a link (a TV cannot scan: `kino.qr.scan` answers
  `unavailable` there).
- **Sizes:** `small`, `medium` and `large` are 160, 200 and 240 dp on a phone and 180, 220 and 300 dp on a TV. On a TV a code
  is never taller than 30 % of the window, so on a 1280×720 TV (540 dp tall) every size is drawn at 162 dp: a step's
  header, the countdown and a button under the code still fit in view and the remote reaches them. A page that may still be
  taller than the window belongs in a `SingleChildScrollView`: the remote then walks it and Kino scrolls each focused item
  into view (a `Column` root does not scroll).
- **Limits and mistakes:** 1 to 1,000 characters, drawn as written. Never build one from a secret: a value holding one of
  your sealed secrets is not drawn (Kino's empty state shows, logged).

<a id="qr-countdown"></a>
#### A code that expires (`expiresInMs`, `onExpire`, `renewBeforeMs`)

A login code that stops working after a while (a messaging app's QR login, about 30 s) gets Kino's own countdown: a bar
and «Caduca en 23 s» under the code, ticked by Kino itself between your calls, and at zero the code dims under «Código
caducado». With `onExpire` Kino also asks you for a new code, once per code, without waiting for your `every` timer:

```json
{ "type": "QrImage", "value": "myapp://login?token=AbC", "size": "large", "labelText": "Escanéalo con la app",
  "expiresInMs": 30000, "renewBeforeMs": 5000, "onExpire": "newCode" }
```

```js
export async function screenEvent({ name, value }) {
  if (name !== "newCode") return null; // value: { phase: "renew" | "expired", remainingMs }
  const token = "AbC" + Date.now(); // ask your service for a new token here
  return { state: { qr: "myapp://login?token=" + token } }; // a new value: a new countdown, the square keeps its size
}
```

- **When the event goes:** once per code value: `renewBeforeMs` before the end (`phase: "renew"`), or at zero
  (`phase: "expired"`) when there is no lead time. A slow answer leaves the old code counting down to its expired look; an
  answer that never comes is never asked again for that code (your `every` timer stays the fallback). A lead time not below
  the lifetime is cut to half of it (logged).
- **Clocks:** `expiresInMs` counts from when Kino first draws that value; `expiresAt` (epoch ms) is read against the
  device's clock once and then counted like `expiresInMs`, so a clock change later never moves it. Sending the same value
  again (a timer re-sending `expiresInMs: 30000`) never restarts its countdown; a new value always does.
- **Background, TV, secrets:** the countdown keeps time while the screen is hidden, but the event waits: one that came due
  goes once the screen shows again (`expired` if the end passed too). The code and its countdown never take focus. A code
  holding one of your secrets is never drawn, counted down or asked about.
- **Its answer** is nobody's press: it keeps `state`, `toast`, `close` and `config`, as a timer's.

<a id="table"></a>
### DataTable

A table in Kino's own look: `TableRow`s holding `TableCell`s. `columns` shares the width (`flex`), `header` makes the first
row the header, `zebra` stripes the rows; on a compact width the table scrolls sideways unless `wrap`.

> Screenshot slots: `ui-img/table-phone.png`, `ui-img/table-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:table:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | `TableRow[]` | required | no | 1 to 200 rows |
| `columns` | `{ key?, flex? }[]` | the widest row's count | yes | at most 20; each `flex` 1 to 12 |
| `header` | boolean | `false` | yes | the first row is the header (bold, read as headings) |
| `wrap` | boolean | `false` | yes | on a compact width, wrap instead of scrolling sideways |
| `zebra` | boolean | `false` | yes | every other row on Kino's surface |
<!-- ui:props:table:end -->

```json
{ "type": "DataTable", "header": true, "zebra": true, "columns": [{ "flex": 2 }, { "flex": 1 }], "children": [
  { "type": "TableRow", "children": [{ "type": "TableCell", "text": "Plan" }, { "type": "TableCell", "text": "Precio", "textEn": "Price" }] },
  { "type": "TableRow", "children": [{ "type": "TableCell", "text": "Gratis", "textEn": "Free" }, { "type": "TableCell", "text": "0" }] },
  { "type": "TableRow", "key": "note", "children": [{ "type": "TableCell", "text": "Precios en dólares", "textEn": "Prices in dollars", "colSpan": 2, "crossAxisAlignment": "center" }] }
] }
```

```js
export async function screen() {
  const rows = [["Lunes", "3"], ["Martes", "5"]].map(([day, n]) => ({ type: "TableRow", children: [{ type: "TableCell", text: day }, { type: "TableCell", text: n, crossAxisAlignment: "end" }] }));
  return { type: "DataTable", header: true, children: [{ type: "TableRow", children: [{ type: "TableCell", text: "Día" }, { type: "TableCell", text: "Vistos" }] }, ...rows] };
}
```

- **TV:** the table takes no focus; the D-pad walks only what is focusable inside its cells.
- **Phone and TV:** at least 96 dp a column when it scrolls sideways on a phone; a TV has room for the whole table.
- **Limits and mistakes:** 200 rows, 20 columns, `colSpan` 1 to 8. A row with fewer cells is padded; cells past the last
  column are dropped (logged). Each row and each cell costs one node. Cells never hold a `ListView`, a scroll or another
  table.

<a id="table-row"></a>
#### TableRow

One row of a `DataTable`. Its `key` lets a `ui` `show`, `hide` or `toggle` name it (a row of details shown on demand).

<!-- ui:props:tr:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | `TableCell[]` | none | no | at most 20; a short row is padded |
| `key` | string | none | no | lets `show`, `hide`, `toggle` name the row |
| `hidden` | boolean | `false` | no | starts hidden; a required field in a hidden row is not checked |
<!-- ui:props:tr:end -->

<a id="table-cell"></a>
#### TableCell

One cell: a plain `text`, or `children` (nodes one level below the table). `colSpan` and `crossAxisAlignment` may be
per-size maps (`colSpan: { compact: 1, expanded: 3 }`).

<!-- ui:props:td:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `text` | string | none | no | a plain cell (`textEn`); with a `text` the children are ignored |
| `children` | nodes[] | none | no | never `ListView`, `SingleChildScrollView`, `DataTable` at any depth |
| `colSpan` | 1 to 8 | `1` | yes | columns the cell covers |
| `crossAxisAlignment` | `start` \| `center` \| `end` | `start` | yes | its content across its width |
<!-- ui:props:td:end -->

<a id="empty-state"></a>
### emptyState

Kino's empty state (an icon, a title and a line): a list with nothing in it, a search with no results. It is a Kino
component: its name has no Flutter twin.

> Screenshot slots: `ui-img/empty-state-phone.png`, `ui-img/empty-state-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:emptyState:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | required | no | `titleEn` the English one |
| `text` | string | none | no | a line under the title (`textEn`) |
| `icon` | a Kino icon name | Kino's | no |  |
<!-- ui:props:emptyState:end -->

```json
{ "type": "emptyState", "title": "Nada por aquí", "titleEn": "Nothing here", "text": "Agrega algo para verlo.", "textEn": "Add something to see it.", "icon": "bookmark" }
```

```js
export async function screen({ state }) {
  const saved = Array.isArray(state.saved) ? state.saved : [];
  if (saved.length === 0) return { type: "emptyState", title: "Sin guardados", titleEn: "Nothing saved", icon: "bookmark" };
  return { type: "Column", children: saved.slice(0, 50).map((s, i) => ({ type: "Text", key: "s" + i, text: String(s) })) };
}
```

<a id="error-state"></a>
### errorState

Kino's error state, the same shape as the empty one: a failed load with nothing to show. Pair it with a button to retry,
or show a [`MaterialBanner`](#banner) above the old data instead when there is some.

> Screenshot slots: `ui-img/error-state-phone.png`, `ui-img/error-state-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:errorState:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | required | no | `titleEn` the English one |
| `text` | string | none | no | a line under the title (`textEn`) |
| `icon` | a Kino icon name | Kino's | no |  |
<!-- ui:props:errorState:end -->

```json
{ "type": "Column", "gap": 12, "crossAxisAlignment": "center", "children": [
  { "type": "errorState", "title": "Algo falló", "titleEn": "Something failed", "text": "Inténtalo de nuevo.", "textEn": "Try again." },
  { "type": "ElevatedButton", "labelText": "Reintentar", "labelTextEn": "Retry", "onPressed": "retry" }
] }
```

```js
export async function screen() {
  return { type: "errorState", title: "Sin conexión", titleEn: "Offline", icon: "help" };
}
```

<a id="title-card"></a>
### titleCard

One Home poster card for a `KinoItem` (the shape a `home` row returns). Its tap opens the title the way Home's card does,
with that very item, so «Continuar viendo», the saved lists and the progress know it. `onTap` may replace that with an
event, a `go` or `ui` operations; an item's `open: { screen }` starts your screen again instead.

> Screenshot slots: `ui-img/title-card-phone.png`, `ui-img/title-card-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:titleCard:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `item` | `KinoItem` | required | no | the shape a `home` row returns (`id`, `ref`, `title`, `kind`, `poster`...); a series needs your `episodes` capability |
| `size` | `small` \| `medium` \| `large` | `medium` | yes | one of Kino's three sizes |
<!-- ui:props:titleCard:end -->

```json
{ "type": "titleCard", "size": "medium", "item": { "id": "bbb", "ref": "bbb", "title": "Big Buck Bunny", "kind": "movie", "year": 2008, "poster": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg" } }
```

```js
export async function screen() {
  const item = { id: "bbb", ref: "bbb", title: "Big Buck Bunny", kind: "movie", poster: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg" };
  return { type: "titleCard", item, size: "large" };
}
```

- **TV:** focused like Home's cards.
- **Phone and TV:** Home's own card on each.
- **Limits and mistakes:** read by Home's rules: a `series` needs your `episodes` capability, posters are https only (else
  Kino's placeholder), an 18+ item shows only while the person's 18+ code is unlocked. At most 1,000 titles per tree.

<a id="title-rail"></a>
### titleRail

A Home row: a heading, a sideways row of title cards and, with a `ref`, its «Ver más» (your `browse`). The way to give a
screen the look of Kino's own Home.

> Screenshot slots: `ui-img/title-rail-phone.png`, `ui-img/title-rail-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:titleRail:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | required | no | the row's heading (`titleEn`) |
| `items` | `KinoItem[]` | required | no | 1 to 500 (60 when drawn all at once) |
| `ref` | string | none | no | with it, the row's «Ver más» opens your `browse` (at most 4,096 characters) |
| `size` | `small` \| `medium` \| `large` | `medium` | yes | one of Kino's three sizes |
| `onEndReached` | `{ event, arg? }` | none | no | sent once when the last item comes into view, again only after your answer drew a longer list (or `loadingMore` went from true to false); never more than once a second |
| `loadingMore` | boolean | `false` | no | `true` draws Kino's spinner after the items |
| `done` | boolean | `false` | no | `true` stops asking for more |
<!-- ui:props:titleRail:end -->

```json
{ "type": "titleRail", "title": "Recomendadas", "titleEn": "Recommended", "size": "small", "items": [
  { "id": "bbb", "ref": "bbb", "title": "Big Buck Bunny", "kind": "movie", "poster": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg" },
  { "id": "sintel", "ref": "sintel", "title": "Sintel", "kind": "movie" }
] }
```

```js
export async function screen({ state }) {
  const items = Array.isArray(state.items) && state.items.length ? state.items : [{ id: "bbb", ref: "bbb", title: "Big Buck Bunny", kind: "movie" }];
  return { type: "titleRail", title: "Para ti", titleEn: "For you", items, onEndReached: { event: "more" }, done: items.length >= 60 };
}
```

- **TV:** Left and Right walk the cards; the rail scrolls with the focus.
- **Limits and mistakes:** 1 to 500 items (60 when the rail sits inside a sideways scroll, drawn all at once). Without
  `title` the rail is dropped.

<a id="title-grid"></a>
### titleGrid

Home cards in a grid of `columns` (default 3): a catalogue page, search results.

> Screenshot slots: `ui-img/title-grid-phone.png`, `ui-img/title-grid-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:titleGrid:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `items` | `KinoItem[]` | required | no | 1 to 500 (60 when drawn all at once) |
| `columns` | 1 to 8 | `3` | yes |  |
| `onEndReached` | `{ event, arg? }` | none | no | sent once when the last item comes into view, again only after your answer drew a longer list (or `loadingMore` went from true to false); never more than once a second |
| `loadingMore` | boolean | `false` | no | `true` draws Kino's spinner after the items |
| `done` | boolean | `false` | no | `true` stops asking for more |
<!-- ui:props:titleGrid:end -->

```json
{ "type": "titleGrid", "columns": { "compact": 3, "expanded": 6 }, "items": [
  { "id": "bbb", "ref": "bbb", "title": "Big Buck Bunny", "kind": "movie" },
  { "id": "sintel", "ref": "sintel", "title": "Sintel", "kind": "movie" },
  { "id": "tos", "ref": "tos", "title": "Tears of Steel", "kind": "movie" }
] }
```

```js
export async function screen() {
  const items = ["Big Buck Bunny", "Sintel", "Tears of Steel"].map((title, i) => ({ id: "t" + i, ref: "t" + i, title, kind: "movie" }));
  return { type: "titleGrid", columns: { compact: 3, expanded: 6 }, items };
}
```

- **Limits and mistakes:** 1 to 500 items, 60 when drawn all at once (a grid inside a scroll, a list, a pop-up or a table
  cell): a long grid wants a page of its own at the root.

<a id="hero-card"></a>
### heroCard

A section's banner: a big picture, a title, a line and at most two buttons. The top of a landing page.

> Screenshot slots: `ui-img/hero-card-phone.png`, `ui-img/hero-card-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:heroCard:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | required | no | `titleEn` the English one |
| `text` | string | none | no | `textEn` |
| `image` | https URL | none | no | a public https picture |
| `buttons` | button nodes | none | no | at most 2 |
<!-- ui:props:heroCard:end -->

```json
{ "type": "heroCard", "title": "Estreno", "titleEn": "Premiere", "text": "Un conejo y tres roedores.", "textEn": "A rabbit and three rodents.",
  "image": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg",
  "buttons": [
    { "type": "ElevatedButton", "labelText": "Ver", "labelTextEn": "Watch", "onPressed": { "go": { "titleByIds": { "tmdb": 10378, "kind": "movie" } } } },
    { "type": "TextButton", "labelText": "Más", "labelTextEn": "More", "onPressed": "more" }
  ] }
```

```js
export async function screen() {
  return { type: "heroCard", title: "Destacado", image: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg", buttons: [{ type: "ElevatedButton", labelText: "Abrir", onPressed: "open-hero" }] };
}
```

- **Limits and mistakes:** at most 2 buttons (the rest dropped, logged), buttons only; an `http` image is dropped.

<a id="actions"></a>
## Actions

What a press does is an **action**: a node's `onTap` and `onLongPress`, a button's `onPressed`, an input's `onChanged`
and `onSubmitted`, a form's `onSubmitted`, a menu item's `onTap`. Four shapes:

```js
onPressed: "refresh"                                        // an event for screenEvent; its arg is the node's arg
onPressed: { event: "read", arg: "story-42" }               // an event with its arg (at most 4,096 characters)
onPressed: { ui: [{ toggle: "details" }], event: "seen" }   // local operations first (no plugin call), then the event
onPressed: { go: { url: { href: "https://kinotvapp.github.io/kino-plugins/" } } } // somewhere in Kino, no plugin call
onPressed: { event: "login", timeoutMs: 28000 }               // Task 18: this press's call may take up to 28 s
```

`screenEvent` receives `{ name, arg, value, state, route, device, lang }` and answers what should change
([Answers](#answer)). The event name `open` is reserved: Kino sends it once when the screen opens.

<a id="button"></a>
### Buttons

`ElevatedButton` is Kino's primary button, `Button` with `variant: "secondary"` the secondary one, `TextButton` a flat
one and `IconButton` an icon (its `labelText` is what a screen reader says). `confirm` makes Kino ask before the action
runs; `submit: true` inside a `Form` checks and submits it; `enabled: false` draws it off.

> Screenshot slots: `ui-img/button-phone.png`, `ui-img/button-tv.png` (pending, see [Screenshots](#screenshots)).

<!-- ui:props:button:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `labelText` | string | required (not for `IconButton`) | no | `labelTextEn` the English one; on an `IconButton` it is what a screen reader says |
| `icon` | a Kino icon name | none | no | required for `IconButton` (variant `icon`) |
| `variant` | `primary` \| `secondary` \| `text` \| `icon` | `primary` | yes | set by `ElevatedButton`, `TextButton`, `IconButton`; `secondary` only as `Button` |
| `onPressed` | action | none | no | what a press does ([Actions](#actions)) |
| `confirm` | string | none | no | Kino asks this question (`confirmEn`) before the action runs |
| `submit` | boolean | `false` | no | inside a `Form`: checks and submits the form (its own `onPressed` is ignored) |
<!-- ui:props:button:end -->

```json
{ "type": "Row", "wrap": true, "gap": 8, "children": [
  { "type": "ElevatedButton", "labelText": "Guardar", "labelTextEn": "Save", "icon": "bookmark", "onPressed": "save" },
  { "type": "Button", "variant": "secondary", "labelText": "Compartir", "labelTextEn": "Share", "onPressed": "share" },
  { "type": "TextButton", "labelText": "Borrar", "labelTextEn": "Delete", "confirm": "¿Borrar?", "confirmEn": "Delete it?", "onPressed": "delete" },
  { "type": "IconButton", "icon": "heart", "labelText": "Me gusta", "labelTextEn": "Like", "onPressed": "like" }
] }
```

```js
export async function screen({ state }) {
  return { type: "ElevatedButton", key: "send", labelText: state.sent ? "Enviado" : "Enviar", enabled: !state.sent, onPressed: { event: "send", arg: "now" } };
}

export async function screenEvent({ name }) {
  return name === "send" ? { state: { sent: true }, toast: "Enviado", toastEn: "Sent" } : null;
}
```

- **TV:** each button is a focus stop with Kino's ring; OK presses it. A disabled button is drawn off and does nothing.
- **Phone and TV:** the same variants; give a button a fixed `height` per size class for a thumb or a remote (the
  calculator uses 80 on a phone, 48 on a TV).
- **Limits and mistakes:** a button needs a `labelText` (an `IconButton` an `icon`), or it is dropped. `onPressed` works on
  buttons only (elsewhere it is `onTap`). `submit` outside a form is ignored (logged). `OutlinedButton` does not exist.

<a id="busy"></a>
### Busy and slow presses (`loading`, `timeoutMs`)

A press whose call takes long shows Kino's own pending cue (Task 18): once the call of the person's press runs past 400 ms,
the button, `FloatingActionButton`, card or `ListTile` pressed is drawn in Kino's busy look (a spinner in its icon's place, no
press, read as busy) until your answer. `loading: true` on such a node draws the same look from your tree (a sign-in you keep
waiting on, say); on the TV the node keeps its focus.

An action object may give its event's call its own budget, `timeoutMs` (1,000 to 30,000 ms; the default stays 20,000):
only on a press (`onPressed`, `onTap`, `onLongPress`, `onSubmitted`, `onTrailingTap`) and honoured only when the person's own
press or submit sends it; a change, a timer, `open` or a load-more keep the default.

```json
{ "type": "ElevatedButton", "key": "send", "labelText": "Enviar código", "labelTextEn": "Send code", "onPressed": { "event": "sendCode", "timeoutMs": 28000 } }
```

```js
export async function screen({ state }) {
  return { type: "ElevatedButton", key: "refresh", labelText: "Actualizar", loading: state.refreshing === true, onPressed: "refresh" };
}
```

- **Limits and mistakes:** `timeoutMs` outside 1,000..30,000 is clamped, on a non-press or without an event ignored (logged).
  `loading` elsewhere than a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap` is ignored (logged).

<a id="floating-action-button"></a>
### FloatingActionButton

Flutter's `FloatingActionButton` (Task 17): one per screen (another is dropped, logged), drawn by Kino over the bottom end (or
centre, `fabPosition`) of your area, never in place, never under the system bars or the keyboard; in a `Scaffold` above its
bottom bar, in a player panel over the drawer's body. With a `labelText` it is the extended form. Never inside a list, a
table, a pop-up, a `ListTile` or an image's fallback (dropped, logged). It takes `selected`, `badge`, `autofocus` and
`tooltip`; on the TV it is a focus stop with Kino's ring, reached by the D-pad.

<!-- ui:props:fab:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `icon` | a Kino icon name | required | no | drawn on Kino's primary fill |
| `labelText` | string | none | no | the extended form: the label beside the icon (`labelTextEn`); else what a screen reader says is the `tooltip`, else Kino's own word |
| `onPressed` | action | required | no | what a press does |
| `fabPosition` | `end` \| `center` | `end` | yes | bottom end or bottom centre of the plugin's area, never under the system bars or the keyboard ([floating action button](#floating-action-button)) |
<!-- ui:props:fab:end -->

```json
{ "type": "Column", "children": [
  { "type": "Text", "text": "Tus listas", "textEn": "Your lists", "style": "h3" },
  { "type": "FloatingActionButton", "icon": "add", "labelText": "Nueva", "labelTextEn": "New", "onPressed": "newList" }
] }
```

<a id="tooltip"></a>
### Tooltip

`tooltip` (and `tooltipEn`), on any node that does something (a button, a field, a choice, a `FloatingActionButton`, any node
with `onTap` or `onLongPress`; elsewhere ignored, logged), at most 80 characters: Kino's own hint. A phone shows it on a long
press (a node with its own `onLongPress` shows none: its action wins), a TV after about 800 ms of focus (until focus leaves),
and a screen reader gets it as the long press's label. It never takes focus or a press. **Never put essential information
in a tooltip**: a person who never long-presses, or a TV that moves on quickly, never sees it. A disabled node shows yours too
(Kino adds no hint of its own).

```json
{ "type": "IconButton", "icon": "share", "labelText": "Compartir", "labelTextEn": "Share", "tooltip": "Copia el enlace del episodio", "tooltipEn": "Copies the episode's link", "onPressed": "share" }
```

<a id="chips"></a>
### Chips

One choice (or several with `multiple`) among a few `options`, drawn as chips: filters over a list, categories, tags. An
input: its value is in `state.inputs`, and `onChanged` reports the change.

> Screenshot slots: `ui-img/chips-phone.png`, `ui-img/chips-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:chips:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `options` | `{ value, label, labelEn? }[]` | required | no | 1 to 500, values distinct |
| `multiple` | boolean | `false` | no | several chips may be picked |
| `value` | string or string[] | none | no | the picked value (a list with `multiple`); a value naming no option is dropped |
| `bind` | a setting key | none | no | shows and stores one of your `select` or `text` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `minLength` | integer | none | no | form rule: characters (chips: picked chips) |
| `maxLength` | integer | none | no | form rule: characters (chips: picked chips) |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:chips:end -->

```json
{ "type": "Chips", "key": "genre", "value": "all", "onChanged": "filter", "options": [
  { "value": "all", "label": "Todo", "labelEn": "All" },
  { "value": "movies", "label": "Películas", "labelEn": "Movies" },
  { "value": "series", "label": "Series" }
] }
```

```js
export async function screen({ state }) {
  const picked = Array.isArray(state.inputs?.extras) ? state.inputs.extras : ["hd"];
  return { type: "Column", gap: 8, children: [
    { type: "Chips", key: "extras", multiple: true, value: picked, onChanged: "extras", options: [{ value: "hd", label: "HD" }, { value: "sub", label: "Subtítulos" }] },
    { type: "Text", text: "Elegidos: " + picked.join(", ") },
  ] };
}
```

- **TV:** Left and Right stay inside the row of chips; entering it lands on the picked chip; OK picks.
- **Limits and mistakes:** 1 to 500 options with distinct values; a `value` naming no option is dropped (logged). In a
  `Form`, `minLength` and `maxLength` count the picked chips.

<a id="toast"></a>
### Toasts

A short message at the bottom, from an answer: a string, or `{ text, textEn?, role?, action?, ms? }`. One at a time (a
newer one replaces it); its `action` sends its event once.

> Screenshot slots: `ui-img/toast-phone.png`, `ui-img/toast-tv.png` (pending, see [Screenshots](#screenshots)).

```json
{ "toast": { "text": "Elemento borrado", "textEn": "Item deleted", "role": "success", "ms": 6000,
  "action": { "label": "Deshacer", "labelEn": "Undo", "event": "undo" } } }
```

```js
export async function screenEvent({ name, lang }) {
  if (name === "save") return { toast: lang === "es" ? "Guardado" : "Saved" };
  if (name === "delete") return { toast: { text: "Borrado", textEn: "Deleted", action: { label: "Deshacer", labelEn: "Undo", event: "undo" } } };
  return null;
}
```

- **TV:** the toast never takes focus by itself: Down from the bottom of the tree reaches its action (Up or Back leaves
  it), and the remote's Menu or Play/Pause key runs it; the toast says so in words.
- **Limits and mistakes:** `ms` 2,000 to 8,000 (default 3,500). A string toast takes its English twin in `toastEn`; the
  object takes `textEn`.

<a id="ui-ops"></a>
### Local `ui` operations

Operations Kino runs at once, with no call to your plugin, on other nodes of the same screen by `key`: show a details
block, disable a button, fill a field, open a declared pop-up. At most 8 per action or answer; an unknown key is ignored
(logged). What they do is kept in `state.ui` (`hidden`, `enabled`, and `open` for each accordion), so your next call sees
it and a re-render keeps it.

> Screenshot slots: `ui-img/ui-ops-phone.png`, `ui-img/ui-ops-tv.png` (pending, see [Screenshots](#screenshots)).

<!-- ui:uiOps:start -->
| Operation | Shape | What it does |
| --- | --- | --- |
| `show` | `{ show: key }` | shows a hidden node |
| `hide` | `{ hide: key }` | hides it (kept in `state.ui.hidden`) |
| `toggle` | `{ toggle: key, prop? }` | shows or hides it; with `prop: "selected"`, flips a button's or a tappable card's `selected` |
| `enable` | `{ enable: key }` | turns it on |
| `disable` | `{ disable: key }` | draws it off (kept in `state.ui.enabled`) |
| `focus` | `{ focus: key }` | moves the focus there; dropped in an `onClose` |
| `set` | `{ set: { key, value } }` | gives an input a value: a string (at most 2,000 characters), a boolean, a number, or up to 500 strings for `Chips`; on a button or a tappable card, `true` or `false` is its `selected`; no event fires |
| `clear` | `{ clear: key }` | empties an input |
| `open` | `{ open: key }` | opens a declared pop-up (replacing an open one); in an answer it waits for the new tree; dropped in an `onClose` |
| `close` | `{ close: key }` | closes it when it is the one open |
<!-- ui:uiOps:end -->

```json
{ "type": "Column", "gap": 8, "children": [
  { "type": "Text", "key": "details", "text": "Detalles", "textEn": "Details", "hidden": true },
  { "type": "TextButton", "labelText": "Más", "labelTextEn": "More", "onPressed": { "ui": [{ "toggle": "details" }] } },
  { "type": "TextField", "key": "q", "labelText": "Buscar", "labelTextEn": "Search" },
  { "type": "TextButton", "labelText": "Limpiar", "labelTextEn": "Clear", "onPressed": { "ui": [{ "clear": "q" }, { "focus": "q" }] } }
] }
```

- **Mistakes:** a `set` value fires no event (read it from `state.inputs` on the next call); `state.ui` is Kino's record,
  but you may set its keys yourself in a `state` patch.
- **`selected`** ([shared properties](#shared-properties)): `{ toggle: key, prop: "selected" }` flips a button's or a tappable
  card's `selected` and `{ set: { key, value: true } }` sets it, at once and with no call. Kino keeps that value only until your
  next render says it again (it is not in `state.ui`), so also send the event and keep it in your own state. Any other `prop`
  drops the operation (logged); without `prop`, `toggle` still means `hidden`.

<a id="forms"></a>
## Forms

Inputs hold values Kino keeps in `state.inputs` by key ([Inputs](#inputs)). Inside a `Form` they also take rules that
**Kino checks before anything reaches your code**.

<a id="form"></a>
### Form

Fields with one submit: a button with `submit: true` checks every field, shows the errors under each failing one and
focuses the first; only a valid form runs the form's `onSubmitted`, whose event `value` holds every field by key.

> Screenshot slots: `ui-img/form-phone.png`, `ui-img/form-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:form:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `children` | nodes (its fields among them)[] | none | no | its children, drawn in order |
| `onSubmitted` | action | required | no | runs only when every field passes; its event's `value` holds every field by key |
<!-- ui:props:form:end -->

```json
{ "type": "Form", "key": "contact", "onSubmitted": "send", "gap": 12, "children": [
  { "type": "TextField", "key": "email", "kind": "email", "labelText": "Correo", "labelTextEn": "Email", "required": true,
    "pattern": "^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$", "errorText": "Revisa el correo", "errorTextEn": "Check the email" },
  { "type": "TextField", "key": "msg", "labelText": "Mensaje", "labelTextEn": "Message", "multiline": true, "maxLength": 500, "required": true },
  { "type": "Checkbox", "key": "ok", "labelText": "Acepto", "labelTextEn": "I agree", "required": true },
  { "type": "ElevatedButton", "labelText": "Enviar", "labelTextEn": "Send", "submit": true }
] }
```

```js
export async function screen() {
  return { type: "Form", key: "contact", onSubmitted: "send", gap: 12, children: [
    { type: "TextField", key: "name", labelText: "Nombre", required: true, minLength: 2 },
    { type: "ElevatedButton", labelText: "Enviar", submit: true },
  ] };
}

export async function screenEvent({ name, value }) {
  if (name !== "send") return null;
  return { state: { sentBy: value.name }, toast: "Enviado", toastEn: "Sent" }; // value: every field by key, already checked
}
```

- **TV:** the error moves focus to the first failing field.
- **Phone and TV:** identical rules; only the text entry differs ([TextField](#text-field)).
- **Limits and mistakes:** a form without `onSubmitted` is dropped; forms do not nest (write two siblings); an answer's
  pop-up takes none (a declared one does). Enter does not submit a form.

<a id="text-field"></a>
### TextField

A text field: a name, a search box, an email. `kind` picks the keyboard (`text`, `number`, `email`, `url`, `search`).
`onSubmitted` is the keyboard's action; `onChanged` reports changes. A `trailingIcon` (one of Kino's
[icons](#icon-names)) is drawn inside the field's box at its end, a chat's «Enviar» or a search's lens: its
`onTrailingTap` is sent like `onSubmitted`, with what the field holds now as the event's `value`, and `trailingLabel`
(`trailingLabelEn`, at most 40 characters) is what a screen reader says for it.

> Screenshot slots: `ui-img/text-field-phone.png`, `ui-img/text-field-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:textInput:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `kind` | `text` \| `number` \| `email` \| `url` \| `search` | `text` | no | the keyboard; there is no password kind (a masked field is `obscureText`) |
| `value` | string | `""` | no | the starting text (what `state.inputs` holds wins); ignored on an `obscureText` field |
| `obscureText` | boolean | `false` | no | masked like a password on phone and TV, with Kino's show / hide; never in your state, sent only with the person's own tap or submit, then cleared ([secret fields](#secret-field)); one line only; binds only a `password` setting |
| `maxLength` | 1 to 2,000 | 2,000 | no | also a form rule |
| `onSubmitted` | action | none | no | the keyboard's action (Enter); on the TV, the text dialog's accept |
| `trailingIcon` | one of the 50 [icons](#icon-names) | none | yes | drawn inside the field's box at its end, tinted by `color`; never on a disabled field; needs `trailingLabel` and `onTrailingTap`, else the field is drawn without it (logged) |
| `trailingLabel` | 1 to 40 characters | none | no | what a screen reader says for the icon (`trailingLabelEn` in English); required with `trailingIcon` |
| `onTrailingTap` | action | none | no | the icon's press: sent like `onSubmitted`, with the field's current text as `value` (a person's press); on the TV the icon is its own focus stop, Right from the field |
| `bind` | a setting key | none | no | shows and stores one of your `text` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `minLength` | integer | none | no | form rule: characters (chips: picked chips) |
| `pattern` | string | none | no | form rule: must match the whole value; Kino's own safe subset, at most 200 characters ([Patterns](#pattern)) |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:textInput:end -->

```json
{ "type": "TextField", "key": "q", "kind": "search", "labelText": "Buscar", "labelTextEn": "Search", "hintText": "Una película", "hintTextEn": "A film", "maxLength": 100, "onSubmitted": "search" }
```

```js
export async function screen({ state }) {
  return { type: "Column", gap: 8, children: [
    { type: "TextField", key: "q", kind: "search", labelText: "Buscar", onSubmitted: "search" },
    { type: "Text", text: state.query ? "Buscaste: " + state.query : "Escribe algo" },
  ] };
}

export async function screenEvent({ name, state }) {
  if (name === "search") return { state: { query: String(state.inputs.q ?? "").trim().slice(0, 100), inputs: { q: "" } } };
  return null;
}
```

A chat's field with its send icon inside (the icon and Enter send the same event):

```json
{ "type": "TextField", "key": "msg", "hintText": "Escribe un mensaje", "hintTextEn": "Type a message", "maxLength": 300,
  "onSubmitted": "send", "trailingIcon": "send", "trailingLabel": "Enviar", "trailingLabelEn": "Send", "onTrailingTap": "send" }
```

- **Trailing icon:** all three of `trailingIcon`, `trailingLabel` and `onTrailingTap`, or the field is drawn without the
  icon (logged): an unknown icon, a missing or too long label, a missing or bad action. `trailingIcon` may be a per-size
  map (a class without one draws no icon there). Never shown on a disabled field. Only on a one-line field: a
  `TextField` with several lines ignores it (logged).
- **Phone and TV:** on the phone a press on the icon sends the text as typed, its pending change first. On the TV the icon
  is a focus stop of its own inside the field's box: Right from the field reaches it, Left goes back, Up and Down leave as
  from the field; OK on it sends what the field holds.

- **TV:** **text on the TV is a simulated input**: the field draws as a row showing its value that, pressed, opens Kino's
  TV text dialog with its on-screen keyboard. `onChanged` and then `onSubmitted` fire **once, when the dialog is
  accepted**, with the final value, untrimmed. A hardware keyboard on a TV commits on Enter or when focus leaves.
- **Phone and TV:** the phone (and the desktop) use a normal field and the phone's keyboard; `onChanged` is debounced
  (300 ms). Your code cannot tell how a value was entered and never needs to.
- **Limits and mistakes:** `key` is required (a missing or repeated input key drops the node). There is no password kind:
  a masked field is `obscureText: true` ([secret fields](#secret-field)).
  To clear or prefill a field, answer `{ state: { inputs: { q: "" } } }`. Kino never autofills the person's saved data.

<a id="secret-field"></a>
#### Secret fields (`obscureText`)

`obscureText: true` masks a one-line `TextField` like a password, on the phone (dots, the password keyboard, Kino's show /
hide eye when there is no `trailingIcon`) and on the TV (dots on the field, the text dialog masked with its show / hide
toggle, the same D-pad path as any field). Put it in a `Form` to check and send a token or a password with a «Siguiente»:

```json
{ "type": "Form", "key": "login", "onSubmitted": "next", "children": [
  { "type": "TextField", "key": "token", "obscureText": true, "labelText": "Token", "required": true, "minLength": 20 },
  { "type": "ElevatedButton", "labelText": "Siguiente", "labelTextEn": "Next", "submit": true }
] }
```

```js
export async function screenEvent({ name, value }) {
  if (name !== "next") return null;
  const ok = /^[A-Za-z0-9_-]{20,}$/.test(value.token); // what was typed, only in this call
  return ok ? { state: { step: "done" } } : { toast: "Token no válido", toastEn: "Invalid token" }; // the field is now empty
}
```

- **Where the text goes:** only with the person's own tap or submit, in `state.inputs.<key>` and, for the form's or the
  field's own `onSubmitted` (or `onTrailingTap`), in `value`. Never in a `screen()` render, a change, a timer's tick, `open`,
  a load-more or a pop-up's `onClose`.
- **Never kept:** not in the screen's state (so not in a player panel's kept state, a restored screen or anything that
  syncs), not in Kino's logs or crash reports, not in the keyboard's suggestions or Autofill. Once the call that carried it
  ends (answered, failed or timed out) the field is empty again, unless your answer gives a text back in
  `state: { inputs: { <key>: "..." } }` (kept in memory only) or the person typed something new meanwhile. The screen
  closing forgets it.
- **Its own rules:** `value` from the tree and `onChanged` are ignored (logged); `obscureText` that is not `true` or
  `false`, or on a field with several lines, drops the field. The form rules (`required`, `minLength`, `pattern`) check
  what was typed.
- **`bind`:** only to a `password` setting (and a password binds only to a secret field): the field always starts empty
  (a password is never read back) and writes what was typed on commit; an empty field never clears the password (use
  `config: { <key>: null }`).
- **Editing a saved secret:** a stored secret is never shown, so the field starts empty. Leave it `required: false` (a `pattern`
  or `minLength` still checks what was typed, and an empty field passes) and read an empty `value` as "keep the stored one":
  write `config` only when the person typed something, and offer a separate button that sends `config: { <key>: null }` to
  remove it.

<a id="text-area"></a>
### TextField with several lines

A `TextField` with `multiline: true` (or a `maxLines` above 1 in any size class) takes several lines: a message, a note.
Kino reads it as the older `textArea`.

> Screenshot slots: `ui-img/text-area-phone.png`, `ui-img/text-area-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:textArea:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `multiline` | boolean | `false` | no | `true` (or `maxLines` above 1) makes a `TextField` several lines |
| `maxLines` | integer | none | no | above 1 in any size class: several lines |
| `kind` | `text` \| `number` \| `email` \| `url` \| `search` | `text` | no | as a one-line field |
| `value` | string | `""` | no | the starting text |
| `maxLength` | 1 to 2,000 | 2,000 | no | also a form rule |
| `onSubmitted` | action | none | no | sent on the TV only (the phone's multi-line keyboard has no submit: add a button) |
| `bind` | a setting key | none | no | shows and stores one of your `text` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `minLength` | integer | none | no | form rule: characters (chips: picked chips) |
| `pattern` | string | none | no | form rule: must match the whole value; Kino's own safe subset, at most 200 characters ([Patterns](#pattern)) |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:textArea:end -->

```json
{ "type": "TextField", "key": "note", "labelText": "Nota", "labelTextEn": "Note", "multiline": true, "maxLength": 500 }
```

```js
export async function screen() {
  return { type: "Column", gap: 8, children: [
    { type: "TextField", key: "note", labelText: "Nota", maxLines: 4, maxLength: 500 },
    { type: "ElevatedButton", labelText: "Guardar", onPressed: "saveNote" },
  ] };
}
```

- **TV:** the multi-line TV text dialog; `onSubmitted` is sent on the TV only.
- **Mistakes:** the phone's multi-line keyboard has no submit: always give the field a button.

<a id="dropdown"></a>
### DropdownButton

One choice among `options` in a closed field that opens a picker: a language, a sort order, a quality. Its value is the
option's `value` (or `null` before a choice).

> Screenshot slots: `ui-img/dropdown-phone.png`, `ui-img/dropdown-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:dropdown:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `options` | `{ value, label, labelEn? }[]` | required | no | 1 to 500, values distinct |
| `value` | string | none (`null`) | no | the chosen option's value |
| `bind` | a setting key | none | no | shows and stores one of your `select` or `text` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:dropdown:end -->

```json
{ "type": "DropdownButton", "key": "lang", "labelText": "Idioma", "labelTextEn": "Language", "value": "es", "onChanged": "lang", "options": [
  { "value": "es", "label": "Español", "labelEn": "Spanish" },
  { "value": "en", "label": "Inglés", "labelEn": "English" }
] }
```

```js
export async function screen() {
  const sorts = [["new", "Más reciente"], ["title", "Título"]];
  return { type: "DropdownButton", key: "sort", labelText: "Ordenar", value: "new", onChanged: "sort", options: sorts.map(([value, label]) => ({ value, label })) };
}
```

- **TV:** OK opens Kino's picker; focus stays inside it until a choice or Back (over an open pop-up, only the picker is
  focusable).
- **Limits and mistakes:** 1 to 500 options with distinct values. `bind` holds a `select` or `text` setting.

<a id="radio-group"></a>
### RadioGroup

One choice among a few `options`, all visible at once: two to five choices the person should compare.

> Screenshot slots: `ui-img/radio-group-phone.png`, `ui-img/radio-group-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:radioGroup:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `options` | `{ value, label, labelEn? }[]` | required | no | 1 to 500, values distinct |
| `value` | string | none (`null`) | no | the chosen option's value |
| `bind` | a setting key | none | no | shows and stores one of your `select` or `text` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:radioGroup:end -->

```json
{ "type": "RadioGroup", "key": "plan", "labelText": "Plan", "value": "free", "options": [
  { "value": "free", "label": "Gratis", "labelEn": "Free" },
  { "value": "family", "label": "Familiar", "labelEn": "Family" }
] }
```

```js
export async function screen() {
  return { type: "RadioGroup", key: "quality", labelText: "Calidad", value: "auto", onChanged: "quality", options: ["auto", "720p", "1080p"].map((value) => ({ value, label: value })) };
}
```

- **Mistakes:** in a form, a failing `RadioGroup`'s error shows on the group.

<a id="checkbox"></a>
### Checkbox

A check box with its label: "I accept the terms", one item of a list to pick. In a form, `required` means ticked.

> Screenshot slots: `ui-img/checkbox-phone.png`, `ui-img/checkbox-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:checkbox:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `value` | boolean | `false` | no | ticked or not |
| `bind` | a setting key | none | no | shows and stores one of your `toggle` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:checkbox:end -->

```json
{ "type": "Checkbox", "key": "terms", "labelText": "Acepto las condiciones", "labelTextEn": "I accept the terms", "required": true, "errorText": "Hace falta aceptarlas", "errorTextEn": "You need to accept them" }
```

```js
export async function screen({ state }) {
  return { type: "Checkbox", key: "remember", labelText: "Recordarme", value: state.inputs?.remember === true };
}
```

<a id="switch"></a>
### Switch

An on/off setting that applies at once. With `bind` it stores one of your `toggle` settings by itself.

> Screenshot slots: `ui-img/switch-phone.png`, `ui-img/switch-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:toggle:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `value` | boolean | `false` | no | on or off |
| `bind` | a setting key | none | no | shows and stores one of your `toggle` settings ([bind](#bind-and-config)) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:toggle:end -->

```json
{ "type": "Switch", "key": "autoplay", "labelText": "Reproducir solo", "labelTextEn": "Autoplay", "value": true, "onChanged": "autoplay" }
```

```js
export async function screen() {
  return { type: "Switch", key: "tipsSwitch", labelText: "Mostrar consejos", bind: "tips" }; // "tips" is a toggle setting of the manifest
}
```

- **TV:** OK flips it. **Mistakes:** a `Switch` is a toggle: for a choice of two named options use a `RadioGroup`.

<a id="slider"></a>
### Slider

A number between `min` and `max`, by `step`: a volume, a level. Its value in `state.inputs` is a number.

> Screenshot slots: `ui-img/slider-phone.png`, `ui-img/slider-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:slider:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `min` | number | `0` | no | below `max` |
| `max` | number | `100` | no | above `min` |
| `step` | number | none (continuous) | no | above 0 and at most `max - min` |
| `value` | number | `min` | no | clamped to `min..max` |
| `bind` | a setting key | none | no | shows and stores one of your `text` settings ([bind](#bind-and-config)) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:slider:end -->

```json
{ "type": "Slider", "key": "volume", "labelText": "Volumen", "labelTextEn": "Volume", "min": 0, "max": 10, "step": 1, "value": 5, "onChanged": "volume" }
```

```js
export async function screen({ state }) {
  const v = Number.isFinite(state.inputs?.level) ? state.inputs.level : 30;
  return { type: "Column", gap: 8, children: [
    { type: "Slider", key: "level", min: 0, max: 100, step: 10, value: v, onChanged: "level" },
    { type: "Text", text: "Nivel " + v },
  ] };
}
```

- **Mistakes:** `min` must be below `max` (else dropped); a `step` outside
  `0..max-min` is dropped (logged). No form rules of its own; `bind` holds a `text` setting (its number as text).

<a id="number-stepper"></a>
### NumberStepper

A number drawn `[ − ] value [ + ]`: seats, servings, a price. Each press moves it by `step`, kept within `min`..`max` and
rounded to `decimals`; holding a button repeats, slowly faster. Its value in `state.inputs` is **text** (`"2.50"`).
Flutter's `Stepper` is another widget (a wizard): that name is unknown here.

> Screenshot slots: `ui-img/number-stepper-phone.png`, `ui-img/number-stepper-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:stepper:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | names the value in `state.inputs`; unique on the screen |
| `labelText` | string | none | no | the field's label (`labelTextEn`) |
| `hintText` | string | none | no | a hint inside or under it (`hintTextEn`) |
| `onChanged` | action | none | no | the person changed it; the event's `value` is the new value |
| `value` | number | `min`, else 0 | no | rounded to `decimals`; in `state.inputs` as text (`"2.50"`) |
| `min` | number | none | no | below `max` |
| `max` | number | none | no | above `min` |
| `step` | number > 0 | `1` | no | rounded to `decimals` |
| `decimals` | 0 to 6 | `0` | no |  |
| `editable` | boolean | `false` | no | lets the person type it (digits only); only with `decimals: 0` and a `min` of 0 or more |
| `bind` |  |  | no | not taken (ignored, logged) |
| `required` | boolean | `false` | no | form rule: a text not blank, a choice made, a toggle on, a chip picked |
| `errorText` | string | Kino's text | no | form rule: what the person reads under the failing field (`errorTextEn`) |
| `forceErrorText` | string | none | no | your own verdict under the field (`forceErrorTextEn`, at most 200 characters) until the person edits it ([validation](#validation)) |
<!-- ui:props:stepper:end -->

```json
{ "type": "Column", "gap": 12, "children": [
  { "type": "NumberStepper", "key": "seats", "labelText": "Asientos", "labelTextEn": "Seats", "value": 2, "min": 1, "max": 8, "editable": true },
  { "type": "NumberStepper", "key": "price", "labelText": "Precio", "labelTextEn": "Price", "value": 2.5, "min": 0, "max": 10, "step": 0.25, "decimals": 2 }
] }
```

```js
export async function screen({ state }) {
  const seats = Number(state.inputs?.seats ?? "2"); // text in state.inputs
  return { type: "Column", gap: 8, children: [
    { type: "NumberStepper", key: "seats", value: seats, min: 1, max: 8, onChanged: "seats" },
    { type: "Text", text: "Total: " + seats * 5 },
  ] };
}
```

- **TV:** Left and Right move between −, the value (only when `editable`) and +; a button at its limit stays focusable
  (drawn off), so holding OK never drops focus. `editable` opens the TV's digits-only pad.
- **Limits and mistakes:** at most 6 decimals; numbers at most 1e15 either way (clamped, logged). `editable` only with
  `decimals: 0` and a `min` of 0 or more (else ignored, logged). No `bind`. Its `required` always passes (it always has a
  value).

<a id="tv-focus"></a>
### Focus on TV

Kino draws one of two focus looks on the TV, by the kind of node; a plugin never chooses it.

| Node | Focus on TV |
| --- | --- |
| `Switch`, `Checkbox`, each `RadioGroup` row | row: a soft tint over the whole row and an accent underline across its bottom edge |
| `TextField` (one line or several), `DropdownButton`, `Slider` | row |
| buttons (`ElevatedButton`, `TextButton`, `IconButton`...), `FloatingActionButton` | ring: a white outline and a soft fill |
| `Chips`, `TabBar`, `NavigationBar` items, `NumberStepper` buttons | ring |
| a pressable `Card`, `ListTile`, `Text` or `Icon`; title cards | ring |

A row keeps at least 16 dp between its edges and its text, so neither the tint nor the underline touches a letter. A
screen reader reads the focused node as before. The `settings` node is Kino's own settings form: its switch and option
rows show the row look too, as every full-width row and field in Kino does on the TV. On the TV its rows are at least 56 dp
tall (12 dp above and below their text, a select's options 4 dp apart, 8 dp under its label), so a focused row's underline
never touches the next; on the phone at least 48 dp. Its rows hold no D-pad key of their own: Up and Down from its first or
last row go on as from any node (the row above, else a page, else the `AppBar`'s tab), and Left and Right stay on a switch
or option row.

<a id="validation"></a>
### Validation

Every input in a `Form` takes the rules the [inputs table](#inputs) lists:

- `required`: a text not blank, a choice made, a toggle or checkbox on, a chip picked. An empty field that is not required
  passes every check.
- `minLength` / `maxLength`: characters of a text; picked chips of a `Chips`.
- `pattern`: a [pattern](#pattern) the whole text must match.
- `errorText` / `errorTextEn`: what the person reads under the failing field (a `RadioGroup`'s or `Chips`' on the group);
  without it Kino's own message.

Values of fields that are `hidden` or disabled are still sent, unchecked; a required field in a hidden `TableRow` is not
checked.

**Your own verdict** (Task 18): `forceErrorText` (and `forceErrorTextEn`), Flutter's, on any input, from your state: Kino
draws it under the field exactly as its own errors (a failed submit's wins while it shows) and a screen reader reads it with
the field. The person's edit of the field hides it until your next verdict: the answer to their next press or submit, or a
different text. At most 200 characters. It never blocks a submit.

```json
{ "type": "TextField", "key": "code", "kind": "number", "labelText": "Código", "labelTextEn": "Code", "forceErrorText": "El código no es válido", "forceErrorTextEn": "That code is not valid" }
``` Rules on a field outside a form are not used. Kino's verdict is the one that counts: check again in your code
only what your own logic needs.

> Screenshot slots: `ui-img/validation-phone.png`, `ui-img/validation-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<a id="pattern"></a>
### Patterns (Kino's own matcher)

**The pattern engine is Kino's own** (a linear-time matcher, the same in the app and the kit), never the platform's
regex, so a hostile pattern cannot freeze the device. A pattern must match the **whole** value, in a safe subset:
literals, `.`, `^`, `$`, `|`, groups `( )` and `(?: )`, classes `[...]`, the escapes `\d \D \w \W \s \S \b \B \n \r \t`
and escaped punctuation, the quantifiers `* + ? {n} {n,} {n,m}` (optionally lazy), which may nest. No backreferences, no
lookarounds. The meanings are ASCII: `\d` is `[0-9]`, `\w` `[A-Za-z0-9_]`, `\s` ASCII whitespace, `.` any character but a
newline.

<!-- ui:patterns:start -->
| Limit | Value |
| --- | --- |
| A pattern | at most 200 characters |
| A count (`{n,m}`) | at most 1,000 |
| Steps once counts are expanded | at most 500 (so `[a-z]{1,600}` is refused: write `[a-z]+` and `maxLength: 600`) |
| Work to read one pattern | 20,000 units |
| One submit | at most 16 patterns and 4,000,000 matcher steps; past either, the remaining patterns pass |
<!-- ui:patterns:end -->

A pattern outside the subset is dropped (logged) and the field still checks its other rules.

```js
pattern: "^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$" // an email (in JSON, every backslash doubled)
pattern: "^\\d{4,6}$"                          // a code of 4 to 6 digits
pattern: "^[A-Za-z0-9 ]+$"                     // letters, digits and spaces
```

<a id="submit"></a>
### Submit rules

- The button with `submit: true` submits; its own `onPressed` is ignored. It is drawn off while a required field is empty.
- An invalid form never calls your code: errors show under each failing field and focus goes to the first.
- **Enter does not submit a form**, and a field's own `onSubmitted` inside a form runs without the form's check.
- A required field in a closed `ExpansionTile` item does not keep the button off, but the submit checks it and, if it
  fails, opens the item and focuses it.
- The form's `onSubmitted` gets `value`: every field's value by key (the same types as `state.inputs`).

<a id="settings"></a>
### settings node

Kino's own settings form for your plugin, the very one Ajustes shows, inside your screen: every setting type, both
languages, validation, Kino's fields for secrets and its buttons for actions, «Enviar a otro aparato», its own save.
`keys` shows only those settings, in that order. Your code never sees what is typed in it; with `onSaved` it hears
that a save or an action button finished, never the values ([onSaved](#on-saved)).

> Screenshot slots: `ui-img/settings-phone.png`, `ui-img/settings-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:settings:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `keys` | string[] | all settings | no | only those settings, in that order; each setting shows at most once per screen |
| `autoSave` | boolean | `false` | no | its `toggle` and `select` settings save as they change (no `validateSettings`); with only those, no Guardar ([settings node](#settings)) |
| `onSaved` | event name or `{ event, arg? }` | none | no | sent after Kino's form here saved (Guardar, or an autosave) or one of its action buttons finished: `value` is `{ kind, ok, keys, action?, reason? }`, setting keys only, never a value ([onSaved](#on-saved)) |
<!-- ui:props:settings:end -->

```json
{ "type": "Column", "gap": 12, "children": [
  { "type": "Text", "text": "Ajustes", "textEn": "Settings", "style": "h3" },
  { "type": "settings", "keys": ["density"] }
] }
```

- **`autoSave`** (Task 18): `true` saves the node's toggles and selects as the person changes them, through the same store and
  sync (your `validateSettings` is not asked, as with `bind`; your web session stays); a refused write puts the stored value
  back. When every valued setting the node shows is a toggle or a select, Kino draws no Guardar nor Descartar; a text, an
  address, a password or a list keeps them. A locked setting saves only after its code.
- **Only buttons** (Task 18): a node whose keys hold no valued setting (`keys: ["logout"]`: an action, a status, a section, a
  link, a help, a QR) draws just those items and no Guardar nor Descartar; the action runs from its own button, its `confirm`
  first, exactly as in Ajustes.
- **A locked setting** (`"unlockWith": "adultCode"` in the manifest, a toggle or a select): moving it away from its default
  here asks the device's 18+ code with Kino's own prompt first (phone and TV); a wrong code or Cancelar keeps the old value,
  back toward the default never asks. Only this node (and Ajustes) changes it away from the default: never `bind` or
  `config` ([README](README.md#a-setting-the-18-code-guards-unlockwith-apiversion-14)).
- **Limits and mistakes:** never inside a `Form` or an answer's pop-up. Each setting shows at most once per screen, so
  several `settings` nodes are fine. A `url` setting can only be filled here (never through `bind` or `config`). A
  `password` can be filled here, by an answer's `config`, or by an `obscureText` field bound to it ([secret
  fields](#secret-field)).

<a id="on-saved"></a>
#### `onSaved`

`onSaved` (an event name or `{ event, arg }`) is sent after Kino's form in this node saved (its Guardar, or, with `autoSave`,
a toggle or select that saved as it changed: `kind: "save"` with that key; an autosave that changed nothing sends none) or
one of its action buttons finished (a node with only buttons has no Guardar: only `kind: "action"`), so your screen reacts
at once instead of on its next `every` tick. Quick autosaves still waiting are merged into one event. The event's
`value`:

| Field | What it holds |
| --- | --- |
| `kind` | `"save"` or `"action"` |
| `ok` | `true` when it saved, or the action ran and answered |
| `keys` | the settings that changed (keys only, sorted): what was edited, what an action cleared or set; never a value |
| `action` | the action button's key (`kind: "action"` only) |
| `reason` | when not `ok`: `rejected` (your `validateSettings` refused), `checkFailed` (it could not check), `refused` (Kino's store refused), `failed` (the action threw or timed out) |

```js
export async function screenEvent({ name, value }) {
  if (name === "saved" && value.ok && value.keys.includes("twoStepPassword")) return { state: { step: "login" } };
  return null;
}
```

- **Order and pace:** it waits in the screen's queue like the person's own events (a timer's tick never runs before it). A
  save while an earlier save's event still waits is merged into it (the keys of both, the later verdict); action events are
  never merged. It is nobody's press: its answer opens no title page and no link.
- **A closed screen:** a save or action that ends after the screen closed (or after the node left the tree) sends
  nothing; the next opening's `open` reads `kino.config` as always. The save itself always lands.
- **Never a value:** a password's key may be in `keys`, its text never is.

<a id="bind-and-config"></a>
### bind and config

- **`bind: "<settingKey>"`** on an input shows the stored value when the screen opens and writes the person's change back
  by itself: a choice on change, a text on commit (the keyboard's action, focus leaving, the TV dialog's accept), only when
  it differs. You still get the field's events. A plain settings tab needs no JavaScript at all.
- **`config: { <settingKey>: value }`** in an answer writes settings from your code: only keys your manifest declares, at
  most 32 per answer, each value fitting its type (`text` a string, `toggle` a boolean, `select` one of its values,
  `list` an array of records, `password` a string).
- **A `password`** is kept exactly as given (never trimmed); `null`, `""` or blanks empty it (never a `required` one); at
  most 500 characters. It is saved where Ajustes saves a typed one: a synced password reaches the person's other devices
  (an emptied one is cleared there too), a `"sync": false` one stays on this device. A screen never reads one back (`bind`
  never prefills it, `state` never holds it) and Kino never writes its text in a log line, only its key. Bind one only with
  an `obscureText` field ([secret fields](#secret-field)).
- **Never from a screen:** a `url` setting, an `action` or a `help` setting, a value holding one of your sealed secrets, a
  `list` write that adds an address, a setting with `unlockWith` moved away from its default (no field binds one). All
  dropped, logged.
- **Pace and cost:** each setting is written at most once every 500 ms per screen (a timer's answer: once a minute); every
  write restarts your runtime so `kino.config` reads the new value (toggles and selects keep your web session; any other
  write is Kino's full Guardar).

```json
{ "type": "Column", "gap": 8, "children": [
  { "type": "TextField", "key": "greetingField", "bind": "greeting", "labelText": "Saludo", "labelTextEn": "Greeting" },
  { "type": "Switch", "key": "tipsField", "bind": "tips", "labelText": "Mostrar consejos", "labelTextEn": "Show tips" },
  { "type": "DropdownButton", "key": "densityField", "bind": "density", "labelText": "Densidad", "labelTextEn": "Density", "options": [
    { "value": "compact", "label": "Compacta", "labelEn": "Compact" }, { "value": "normal", "label": "Normal" }, { "value": "roomy", "label": "Amplia", "labelEn": "Roomy" }
  ] }
] }
```

```json
{ "config": { "greeting": "Hola", "tips": false }, "toast": "Guardado", "toastEn": "Saved" }
```

<a id="overlays"></a>
## Overlays

One pop-up at a time; opening another replaces it; Back closes it before anything else; it never covers Kino's title
bar, and Kino always draws its close: an X alone (a screen reader says «Cerrar», «Close» in English), at the end of the
title row, or, with no title, at the start (left) of the bottom row, with your buttons together at its end (right), never
beside your main action; buttons that do not fit wrap to more lines, still at the end. Two ways to show one: **from an answer** (`dialog`, `sheet`, `menu`: built by
`screenEvent`, text or simple nodes) or **declared in the tree** (a `popup` node, hidden until a `ui` `open` names it,
whose body is part of your tree and may hold forms and inputs).

<a id="dialog"></a>
### Dialog

A question or a short message that needs an answer. From an answer: `dialog: { title, body, buttons }` (at most 3
buttons; one without `event` closes it). Declared: an `AlertDialog` node with `children` and `buttons`.

> Screenshot slots: `ui-img/dialog-phone.png`, `ui-img/dialog-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "dialog": { "title": "¿Borrar la lista?", "titleEn": "Delete the list?", "body": "No se puede deshacer.", "bodyEn": "It cannot be undone.",
  "buttons": [{ "label": "Borrar", "labelEn": "Delete", "event": "deleteList", "variant": "primary" }, { "label": "Cancelar", "labelEn": "Cancel", "variant": "text" }] } }
```

```js
export async function screenEvent({ name }) {
  if (name === "ask") return { dialog: { title: "¿Seguro?", titleEn: "Are you sure?", buttons: [{ label: "Sí", labelEn: "Yes", event: "yes" }, { label: "No" }] } };
  if (name === "yes") return { toast: "Hecho", toastEn: "Done" };
  return null;
}
```

- **TV:** focus stays inside the dialog; its first focus is its first focusable node, else (a body taller than the frame
  with nothing to focus) the body itself, else its first button, else its close; a body taller than the frame scrolls with
  Down and Up (keep a button at its end). Only the focused control draws Kino's ring: the frame and a scrolling body never
  do (scrolling is the cue). Left and Right move between Kino's X and your buttons in the bottom row.
- **Phone and TV:** a centred dialog on both.
- **Limits and mistakes:** with more than one of `dialog`, `sheet` and `menu` in one answer, the dialog wins. An answer's
  pop-up never holds a `Form`, an `ExpansionTile`, `bind` or the `settings` node (declare one for that).

<a id="sheet"></a>
### Sheet

More room than a dialog for details or a few actions: a bottom sheet on the phone, a side drawer on the TV. From an
answer: `sheet: { title, body }`; declared: a `BottomSheet` node.

> Screenshot slots: `ui-img/sheet-phone.png`, `ui-img/sheet-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "sheet": { "title": "Compartir", "titleEn": "Share", "body": [
  { "type": "Text", "text": "Escanéalo con tu teléfono.", "textEn": "Scan it with your phone." },
  { "type": "QrImage", "value": "https://kinotvapp.github.io/kino-plugins/", "size": "small" }
] } }
```

```js
export async function screenEvent({ name }) {
  return name === "info" ? { sheet: { title: "Información", body: "Una línea de texto.", bodyEn: "A line of text." } } : null;
}
```

- **Phone and TV:** the bottom of the screen on the phone, the side on the TV. Back closes it.

<a id="menu"></a>
### Menu

A short list of actions (1 to 8 items with a label, an optional icon and an `onTap`); the menu closes before the item's
action runs. From an answer: `menu: { title, items }`; declared: a `PopupMenuButton` node opened with `{ open: key }`.

> Screenshot slots: `ui-img/menu-phone.png`, `ui-img/menu-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "menu": { "title": "Ordenar por", "titleEn": "Sort by", "items": [
  { "label": "Más reciente", "labelEn": "Newest", "icon": "star", "onTap": { "event": "sort", "arg": "new" } },
  { "label": "Título", "labelEn": "Title", "icon": "list", "onTap": { "event": "sort", "arg": "title" } }
] } }
```

```js
export async function screen() {
  return { type: "Column", children: [
    { type: "TextButton", labelText: "Ordenar", onPressed: { ui: [{ open: "sortMenu" }] } },
    { type: "PopupMenuButton", key: "sortMenu", items: [{ label: "Título", onTap: { event: "sort", arg: "title" } }, { label: "Año", onTap: { event: "sort", arg: "year" } }] },
  ] };
}
```

- **Phone and TV:** a menu is not anchored to what opened it: on the phone it is an action list at the bottom of the
  canvas, on the TV it is centred.
- **Limits and mistakes:** at most 8 items; a menu item keeps `label` and `onTap` (never `labelText`/`onPressed`).

<a id="popup"></a>
### Declared pop-ups, `ui` open and close, `onClose`

A `popup` node (`AlertDialog`, `BottomSheet`, `PopupMenuButton`, or `popup` with its `kind`) with a `key`, anywhere in the
tree, hidden until a `ui` `open` names it. Its body is part of your tree, so it can hold forms and inputs and your next
render updates it.

> Screenshot slots: `ui-img/popup-phone.png`, `ui-img/popup-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<!-- ui:props:popup:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | required | no | what `{ open: key }` and `{ close: key }` name |
| `kind` | `dialog` \| `sheet` \| `menu` | set by the type | no | `AlertDialog` is `dialog`, `BottomSheet` `sheet`, `PopupMenuButton` `menu` |
| `title` | string | none | no | `titleEn`; none (or blank) draws no empty title row |
| `children` | nodes[] | none | no | the body of a dialog or sheet: forms and inputs allowed |
| `buttons` | `{ label, labelEn?, event?, arg?, variant? }[]` | none | no | a dialog's, at most 3; one without `event` closes it |
| `items` | `{ label, labelEn?, icon?, onTap }[]` | required for a menu | no | 1 to 8; the menu closes first |
| `onClose` | event name or `{ ui?, event?, arg? }` | none | no | runs after the person dismissed it (Back, Kino's close, a tap outside), never after its own buttons |
| `anchor` | a node's key | none | no | drawn next to that node, over the content, taking no room ([anchored pop-up](#anchored-popup)); the only pop-up a player panel draws |
<!-- ui:props:popup:end -->

The robust way to open one with new content is **from the answer**, not from the tap: the tap sends the event, the
answer patches the state and carries `ui: [{ open }]`; Kino opens it once the new tree is drawn, so the pop-up never shows
the last item's body (Back before then cancels it). Close it the same way after its own Save.

```json
{ "type": "AlertDialog", "key": "story", "title": "Una historia", "titleEn": "A story", "onClose": "storyClosed",
  "children": [{ "type": "Text", "text": "El texto de la historia.", "textEn": "The story's text." }],
  "buttons": [{ "label": "Cerrar", "labelEn": "Close" }] }
```

```js
export async function screen({ state }) {
  return { type: "Column", children: [
    { type: "ElevatedButton", labelText: "Leer", onPressed: { event: "read", arg: "42" } },
    { type: "AlertDialog", key: "story", title: "Historia " + (state.reading || ""), onClose: "storyClosed", children: [{ type: "Text", text: "…" }] },
  ] };
}

export async function screenEvent({ name, arg }) {
  if (name === "read") return { state: { reading: arg }, ui: [{ open: "story" }] }; // opens once the new tree is drawn
  if (name === "storyClosed") return { state: { reading: null } };                  // the person dismissed it
  return null;
}
```

- **`onClose`** (an event name, or `{ ui?, event?, arg? }`) runs after the **person** dismissed the pop-up (Back, Kino's
  close, a tap outside), never after its own buttons, a menu item, your `close` or another pop-up replacing it. Its event
  is no press: no `kino.qr.scan`, no `go.titleByIds` or `go.url`; its answer opens no pop-up, moves no focus and goes
  nowhere (dropped, logged).
- **TV:** focus is trapped inside the open pop-up; Back closes it and focus returns to what opened it.
- **Limits and mistakes:** `title` is optional (without one no empty row is drawn; never pass `" "`). A pop-up whose node
  is `hidden` cannot open. Whether a pop-up is open is not in `state.ui`. In a panel in screen mode a `popup` node is
  dropped (pop-ups belong to the screen), unless it has an `anchor` (below).

<a id="anchored-popup"></a>
#### Anchored pop-up (`anchor`)

`anchor` (a node's key) turns any declared pop-up into a popover: Kino draws it **next to that node**, above it when there is
more room above, else below, sized to its content and at most the area's width, over the content without dimming it and
taking no layout space. It opens and closes as every pop-up does (`ui` `open` and `close`, Back, a tap outside) and has no
close button of its own. A quick pick beside a button (a reaction, a speed, a sort order):

```json
{ "type": "Row", "children": [
  { "type": "IconButton", "key": "react", "icon": "mood", "labelText": "Reacciones", "labelTextEn": "Reactions",
    "onPressed": { "ui": [{ "open": "palette" }] } },
  { "type": "PopupMenuButton", "key": "palette", "anchor": "react", "items": [
    { "label": "Me gusta", "labelEn": "Like", "icon": "heart", "onTap": { "event": "react", "arg": "like" } },
    { "label": "Me encanta", "labelEn": "Love", "icon": "star", "onTap": { "event": "react", "arg": "love" } }] }
] }
```

- **TV:** focus moves into it (its first focusable, or its `autofocus` node) and stays inside while it is open; Back closes it
  and gives focus back to the anchor.
- **Player panel:** a `popup` with an `anchor` is the one pop-up a panel in screen mode draws, inside the drawer.
- **Fallback:** when the anchor is not on screen, or there is no room above or below it (a compact window, a tall body), it is
  drawn in its kind's own place, logged once. Without `anchor` it behaves as before.

<a id="navigation"></a>
## Navigation

A node's action or an answer may carry `go`: one of twelve shapes, **always into this plugin's own content or one of
Kino's own pages**. Kino's page opens over your screen; Back returns to it with its state. At most one page-opening `go`
every 500 ms. No shape names an intent or an app, and only `liveChannel` names another plugin (an En vivo provider, whose
channel Kino tunes to for a plugin whose player tab joins live channels).

<!-- ui:go:start -->
| Shape | Written | What opens | Sent from |
| --- | --- | --- | --- |
| [`title`](#go-title) | `{ title: { ref, kind, id, title, adult } }` | this plugin's title page | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`play`](#go-play) | `{ play: { ref, kind, id, title, adult } }` | plays this plugin's title | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`search`](#go-search) | `{ search: { q } }` | Kino's search with `q` (at most 200 characters), only this plugin as the source | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`browse`](#go-browse) | `{ browse: { ref, title?, titleEn? } }` | this plugin's «Ver más» list for a `ref` | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`section`](#go-section) | `{ section: true }` | this plugin's section | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`categories`](#go-categories) | `{ categories: true }` | Kino's Categorías, this plugin's group first | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`close`](#go-close) | `{ close: true }` | closes the screen | a tap or an event's answer (never `open`'s, a timer's or an `onClose`'s) |
| [`screen`](#go-screen) | `{ screen: { route?, args? } }` | this plugin's own screen at `route` (at most 64 characters) with `args` (at most 4,096 bytes) | a tap or an answer, `open`'s included |
| [`titleByIds`](#go-title-by-ids) | `{ titleByIds: { tmdb, imdb, kind, season, episode, title, year } }` | Kino's own title page for TMDB or IMDb ids, with every source the person has | only the person's own press or submit |
| [`url`](#go-url) | `{ url: { href, title } }` | an https link in the browser, after Kino's own sheet (a QR code on a TV) | only the person's own press or submit |
| [`copy`](#go-copy) | `{ copy: { text, label, sensitive } }` | Kino copies `text` (at most 500 characters, 6 lines) and shows its own «Copiado» toast; a TV cannot | only the person's own press or submit |
| [`liveChannel`](#go-live-channel) | `{ liveChannel: { provider, code } }` | tunes the player to an En vivo provider's channel (only for a plugin whose player tab joins live channels) | only the person's own press or submit |
<!-- ui:go:end -->

> Screenshot slots: `ui-img/navigation-phone.png`, `ui-img/navigation-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<a id="go-title"></a>
### `go.title`

Opens this plugin's title page. A title on the canvas (a `titleCard`, rail or grid item) opens with that very item (pass
its `id` when two items share a `ref`); a title that is not on the canvas needs its `id` and `title` (and `adult: true`
when it is 18+).

```json
{ "go": { "title": { "ref": "movie/123", "kind": "movie", "id": "m123", "title": "Una película" } } }
```

<a id="go-play"></a>
### `go.play`

Plays this plugin's title, written as `title`. A live channel plays; a series opens its page; a movie, a track or a
podcast episode plays at once. The 18+ gate holds.

```json
{ "type": "ElevatedButton", "labelText": "Reproducir", "labelTextEn": "Play", "onPressed": { "go": { "play": { "ref": "live/1", "kind": "live", "id": "c1", "title": "Canal 1" } } } }
```

<a id="go-search"></a>
### `go.search`

Kino's search with `q` filled in and only this plugin as the source (the person sees its chip and may clear it). Refused
for a plugin without `search`.

```json
{ "go": { "search": { "q": "big buck bunny" } } }
```

<a id="go-browse"></a>
### `go.browse`

This plugin's «Ver más» list for a `ref` (your `browse`).

```json
{ "go": { "browse": { "ref": "genre/drama", "title": "Drama" } } }
```

<a id="go-section"></a>
### `go.section`

This plugin's section (its rows of cards).

```json
{ "go": { "section": true } }
```

<a id="go-categories"></a>
### `go.categories`

Kino's Categorías with this plugin's group first; with `screen.replaces: ["categories"]` your own screen at the route
`categories`. Refused, logged, for a plugin without its own Categorías tiles.

```json
{ "go": { "categories": true } }
```

<a id="go-close"></a>
### `go.close`

Closes the screen (the same as the answer's `close: true`).

```json
{ "type": "TextButton", "labelText": "Cerrar", "labelTextEn": "Close", "onPressed": { "go": { "close": true } } }
```

<a id="go-screen"></a>
### `go.screen`

This plugin's own screen at a `route` with `args`, from its other surfaces (its player panel, its `home`/`section`/`browse`
items and rows with `open: { screen }`, the «Mis plugins» card) or from inside the screen, which starts again at that
route (the state stays). The reserved `open` event comes again with the new route, so one path loads what the args name.
At most one restart a second.

```json
{ "type": "Button", "variant": "secondary", "labelText": "Ver los ajustes", "labelTextEn": "See the settings", "onPressed": { "go": { "screen": { "route": "main", "args": { "tab": "config" } } } } }
```

```js
export async function screenEvent({ name, route }) {
  if (name === "open" && route.args?.tab === "config") return { state: { tab: "config" } };
  return null;
}
```

<a id="go-title-by-ids"></a>
### `go.titleByIds`

How people with **different plugins** reach the same title: Kino's own title page (the one a Home TMDB card opens), with
every source the person has. At least one of `tmdb` and `imdb`; it names no plugin, ref or URL, never plays, and tells you
nothing back. Only from the person's own press or submit.

```json
{ "type": "ElevatedButton", "labelText": "Abrir este título", "labelTextEn": "Open this title", "icon": "movie",
  "onPressed": { "go": { "titleByIds": { "tmdb": 10378, "kind": "movie", "title": "Big Buck Bunny", "year": 2008 } } } }
```

- 18+: while the person's 18+ code is locked it opens only when TMDB says the title is not adult. An `imdb` alone costs a
  TMDB lookup («Buscando el título…»). A series opens whole (no episode focus yet).

<a id="go-url"></a>
### `go.url`

Asks Kino to open an https link in a browser, a «Ver noticia» button. Nothing opens by itself: Kino shows **its own**
sheet first (your plugin's name, the host with its end always visible, your `title` under «Texto del plugin:», «Cancelar»
focused first and «Abrir», inert for its first 600 ms). On a TV, or a phone without a browser, the sheet shows the link as
a QR code to scan.

```json
{ "type": "ElevatedButton", "labelText": "Ver noticia", "labelTextEn": "Read the story", "icon": "language",
  "onPressed": { "go": { "url": { "href": "https://kinotvapp.github.io/kino-plugins/", "title": "Guía de plugins" } } } }
```

- `href`: `https://` only, at most 2,048 characters of printable ASCII, a public DNS name with a dot (never an IP,
  `localhost`, `.local`, `.lan`...), no `user:password@`, no port but 443. Only from the person's own press or submit; an
  answer more than 5 s after the tap drops it. Nothing comes back to you.

<a id="go-copy"></a>
### `go.copy`

A «Copiar» button: Kino puts your text on the clipboard itself and **always** shows its own toast, «Copiado» (or
«Copiado: <label>»), so nothing is ever copied unseen. Kino never reads the clipboard. Only from the person's own press or
submit (a tap, a submit, the answer to one, a pop-up's button, a panel press); the panel stays open.

```json
{ "type": "ElevatedButton", "labelText": "Copiar invitación", "labelTextEn": "Copy invite", "icon": "copy",
  "onPressed": { "go": { "copy": { "text": "Sala: luna roja azul\nCódigo: 4821", "label": "Invitación", "sensitive": true } } } }
```

- `text`: 1 to 500 characters in at most 6 lines, once control, direction and zero-width characters are removed (newlines
  stay). `label` (at most 40) names what was copied in Kino's toast. `sensitive: true` hides it from the clipboard's preview
  on Android 13 and later (a room code, a password).
- One copy every 500 ms and 20 a minute per plugin. A TV has no clipboard worth using: Kino shows «No se puede copiar en este
  aparato»; hide the button there (`kino.device` / `device: "tv"`).

<a id="go-live-channel"></a>
### `go.liveChannel`

Tunes Kino's player to an En vivo channel: `provider` is the id of the plugin that lists it, `code` the channel's id in
that plugin's listing (what a live tab's context carries as `channel`). How a Party Chat guest watches the same channel as
the host: the host's tab reads `context.channel`, sends it to the room, and the guest presses «Ver el mismo canal».

```json
{ "type": "ElevatedButton", "labelText": "Ver el mismo canal", "labelTextEn": "Watch the same channel", "icon": "tv",
  "onPressed": { "go": { "liveChannel": { "provider": "tdt", "code": "la1" } } } }
```

- Only for a plugin whose approved contributed tab declares `"kinds": ["live"]` (`panel.contributes`, `playerPanelTab`):
  the same consent; any other plugin's is dropped, logged `needs_live_tab`. Only from the person's own press or submit.
- The provider must be an installed, usable plugin with live channels (never `own`, «Mis canales»); an 18+ provider only
  while the 18+ code is unlocked, and an 18+ channel is not found while it is locked (Kino's usual message).
- In the player panel on a live channel the channel changes in place (the panel and its pin stay); from anywhere else the
  panel or screen closes and the player opens the channel. Nothing comes back to you: the next context says the channel.

<a id="route"></a>
### Routes (`route` push and pop)

Screens of your own deeper in the canvas: an answer's `route: { push: "detail", params }` goes one level deeper, `{ pop:
true }` back; Back pops a pushed route before it closes the canvas. `screen({ route })` gets `{ name, params, args? }`.

> Screenshot slots: `ui-img/route-phone.png`, `ui-img/route-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

```json
{ "route": { "push": "detail", "params": { "id": "42" } } }
```

```js
export async function screen({ route }) {
  if (route.name === "detail") return { type: "Column", padding: 16, children: [{ type: "Text", text: "Detalle " + route.params.id }, { type: "TextButton", labelText: "Volver", onPressed: "back" }] };
  return { type: "ElevatedButton", labelText: "Ver detalle", onPressed: { event: "detail", arg: "42" } };
}

export async function screenEvent({ name, arg }) {
  if (name === "detail") return { route: { push: "detail", params: { id: arg } } };
  if (name === "back") return { route: { pop: true } };
  return null;
}
```

<a id="data"></a>
## Data and behavior

<a id="state"></a>
### State

**The state lives in Kino.** Your runtime closes after a while idle, so nothing you keep in a variable survives: Kino keeps
the screen's state, hands it to every call, and calls `screen()` again after every answer that carries a `state` patch. A
patch is merged key by key (`null` removes a key). At most 64 KB; it lives for this opening only (keep what must survive
in `kino.storage`). `screen()` is a pure view: no network work there.

```json
{ "state": { "count": 3, "selected": null } }
```

<a id="inputs"></a>
### Inputs (`state.inputs`)

`state.inputs` holds every input on screen by key: what the person or your code set, else the value the tree shows. To set
what a field shows, answer `{ state: { inputs: { <key>: value } } }`: it shows at once and fires no event.

<!-- ui:inputs:start -->
| Input | Value in `state.inputs` | Form rules | `bind` holds |
| --- | --- | --- | --- |
| [`TextField`](#text-field) | string | `required`, `minLength`, `maxLength`, `pattern`, `errorText` | `text` |
| [`TextField` (several lines)](#text-area) | string | `required`, `minLength`, `maxLength`, `pattern`, `errorText` | `text` |
| [`DropdownButton`](#dropdown) | the option's value or `null` | `required`, `errorText` | `select` or `text` |
| [`Switch`](#switch) | boolean | `required`, `errorText` | `toggle` |
| [`Checkbox`](#checkbox) | boolean | `required`, `errorText` | `toggle` |
| [`RadioGroup`](#radio-group) | the option's value or `null` | `required`, `errorText` | `select` or `text` |
| [`Slider`](#slider) | number | none | `text` |
| [`Chips`](#chips) | a value or `null` (a list with `multiple`) | `required`, `minLength`, `maxLength`, `errorText` | `select` or `text` |
| [`NumberStepper`](#number-stepper) | its value as text (`"2.50"`) | `required`, `errorText` | no `bind` |
<!-- ui:inputs:end -->

<a id="events"></a>
### Events

- One event at a time per screen; the next waits (at most 8 waiting), spaced 100 ms apart, never dropped for coming fast.
  A newer `onChanged` of the same field replaces an older one still waiting.
- The first call after the screen opens is the reserved `open`: load your data there and answer a `state` patch.
- A call has 20 s. A call that times out shows the screen's error state; three failures in a row too. A screen's timeout
  never counts toward the plugin's "No responde".

<a id="answer"></a>
### Answers

What `screenEvent` (and a timer, a pop-up's `onClose`, a panel's `panelAction`) may answer. Every field is optional;
`null` means nothing to do. Some answers are not the person's, so they keep less: the answer to the reserved `open` drops
its `go` (except `go.screen`), a load-more's never changes the route.

<!-- ui:answer:start -->
| Field | What it does | In a timer's answer | In an `onClose` answer | In a panel in screen mode |
| --- | --- | --- | --- | --- |
| `state` | a patch merged key by key (`null` removes a key); then `screen()` runs again | kept | kept | kept |
| `dialog` | a pop-up dialog: `title`, `body` (text or nodes), at most 3 `buttons` | dropped | dropped | dropped |
| `sheet` | a bottom sheet on the phone, a side drawer on the TV: `title`, `body` | dropped | dropped | dropped |
| `menu` | a list of 1 to 8 actions: `items` of `{ label, icon?, onTap }` | dropped | dropped | dropped |
| `toast` | a short message: a string or `{ text, textEn?, role?, action?, ms? }` (`ms` 2,000 to 8,000, default 3,500) | kept | kept | kept |
| `toastEn` | the English twin of a string toast | kept | kept | kept |
| `go` | somewhere in Kino ([Navigation](#navigation)) | dropped | dropped | kept |
| `route` | `{ push: name, params? }` or `{ pop: true }`: a screen of your own deeper in the canvas | dropped | dropped | dropped |
| `close` | `true` closes the screen | kept | kept | kept |
| `focus` | the key of the node that takes the focus | dropped | dropped | kept |
| `config` | your settings to write, at most 32 keys ([bind and config](#bind-and-config)) | kept | kept | kept |
| `ui` | local operations (at most 8); an `open` waits for the tree the answer asks for | dropped | kept, without `open` and `focus` | kept |
<!-- ui:answer:end -->

<a id="every"></a>
### Timers (`every`)

The root of a tree (or the manifest's `screen.every`) may carry `{ ms, event }` or a list of them: Kino sends that event
every `ms` while the screen is open, shown and Kino in front. A tick is nobody's press: its answer keeps only `state`,
`toast`, `close` and `config`; 3 failures in a row switch that timer off; ticks never count toward "No responde" and never
run while one of the person's events waits.

```json
{ "type": "Column", "every": { "ms": 30000, "event": "refresh" }, "children": [{ "type": "Text", "text": "Se actualiza cada 30 s", "textEn": "Refreshes every 30 s" }] }
```

<a id="responsive"></a>
### Per-size values

**Every style or layout property may be a per-size map** `{ compact?, medium?, expanded? }` (the Material window classes:
`compact` under 600 dp, `medium` 600 to 839, `expanded` 840 and up; a TV is `expanded`). A class missing from the map takes
the next smaller one present, else Kino's default. A node whose value is invalid **in any one class is dropped whole**, and
a map that mixes classes with other keys is dropped. `devices` and `sizes` draw a node only somewhere; `ctx.device` and
`ctx.size` let `screen()` return a different tree.

```json
{ "type": "GridView", "columns": { "compact": 1, "medium": 2, "expanded": 3 }, "gap": { "compact": 8, "expanded": 16 }, "padding": { "compact": 16, "expanded": 32 }, "children": [
  { "type": "Text", "text": "Solo en la TV", "textEn": "TV only", "devices": ["tv"] },
  { "type": "Text", "text": "Solo en ventanas anchas", "textEn": "Wide windows only", "sizes": ["expanded"] }
] }
```

<a id="aliases"></a>
### Flutter-style names

Authors who know Flutter find the same names. They are the documented spelling; the older lowercase names stay accepted
and both read to the same tree. Give one spelling: when a node has both, the Flutter-style one wins and the clash is
logged. Only nodes are renamed: the fields of an answer's `dialog`, `sheet` and `menu`, a dialog's `buttons`, a menu's
`items`, a banner's `action` and the entries of `options` and `tabs` keep `label` and `onTap`. Kino's own components
(`titleCard`, `titleRail`, `titleGrid`, `heroCard`, `emptyState`, `errorState`, `popup`, `settings`) keep their names.

<!-- ui:aliasTypes:start -->
| Flutter-style name | Older name | Implies |
| --- | --- | --- |
| `Column` | `col` |  |
| `Row` | `row` |  |
| `Stack` | `box` |  |
| `Card` | `card` |  |
| `Spacer` | `spacer` |  |
| `SizedBox` | `spacer` |  |
| `Divider` | `divider` |  |
| `SingleChildScrollView` | `scroll` |  |
| `GridView` | `grid` |  |
| `Text` | `text` |  |
| `Image` | `image` |  |
| `Icon` | `icon` |  |
| `Badge` | `badge` |  |
| `LinearProgressIndicator` | `progress` |  |
| `CircularProgressIndicator` | `loading` |  |
| `ListView` | `list` |  |
| `Button` | `button` |  |
| `ElevatedButton` | `button` | `variant: "primary"` |
| `TextButton` | `button` | `variant: "text"` |
| `IconButton` | `button` | `variant: "icon"` |
| `TextField` | `textInput` |  |
| `DropdownButton` | `dropdown` |  |
| `Switch` | `toggle` |  |
| `Checkbox` | `checkbox` |  |
| `RadioGroup` | `radioGroup` |  |
| `Slider` | `slider` |  |
| `Chips` | `chips` |  |
| `TabBar` | `tabs` |  |
| `AlertDialog` | `popup` | `kind: "dialog"` |
| `BottomSheet` | `popup` | `kind: "sheet"` |
| `PopupMenuButton` | `popup` | `kind: "menu"` |
| `Form` | `form` |  |
| `MaterialBanner` | `banner` |  |
| `ExpansionTile` | `accordion` |  |
| `Skeleton` | `skeleton` |  |
| `QrImage` | `qr` |  |
| `NumberStepper` | `stepper` |  |
| `DataTable` | `table` |  |
| `TableRow` | `tr` |  |
| `TableCell` | `td` |  |
| `FloatingActionButton` | `fab` |  |
| `ListTile` | `listTile` |  |
| `CircleAvatar` | `avatar` |  |
| `PageView` | `pageView` |  |
| `Scaffold` | `scaffold` |  |
| `AppBar` | `appBar` |  |
| `NavigationBar` | `navigationBar` |  |
| `TextField` with `multiline: true` or `maxLines` > 1 | `textArea` |  |
<!-- ui:aliasTypes:end -->

<!-- ui:aliasProps:start -->
| Flutter-style property | Older name | Where |
| --- | --- | --- |
| `width` | `w` | any node |
| `height` | `h` | any node |
| `minHeight` | `minH` | any node |
| `mainAxisAlignment` | `justify` | any node |
| `crossAxisAlignment` | `align` | any node |
| `flex` | `weight` | any node |
| `borderRadius` | `radius` | any node |
| `onChanged` | `onChange` | any node |
| `onSubmitted` | `onSubmit` | any node |
| `hintText` | `hint` | any node |
| `hintTextEn` | `hintEn` | any node |
| `labelText` | `label` | any node |
| `labelTextEn` | `labelEn` | any node |
| `obscureText` | `secret` | any node |
| `onPressed` | `onTap` | a button only (elsewhere ignored, logged) |
| `flex` | `weight` | a `DataTable` column |
<!-- ui:aliasProps:end -->

<a id="style"></a>
### Style

Style comes from fixed scales, never from free values; a value off its scale is dropped and logged. Every node takes these.

<!-- ui:style:start -->
| Property | Older name | Values | Per size |
| --- | --- | --- | --- |
| `padding` |  | 0, 4, 8, 12, 16, 24, 32, 48, or per side `{ x, y, top, end, bottom, start }` | yes |
| `margin` |  | 0, 4, 8, 12, 16, 24, 32, 48, or per side | yes |
| `gap` |  | 0, 4, 8, 12, 16, 24, 32, 48 | yes |
| `borderRadius` | `radius` | `none`, `small`, `medium`, `large`, `full`, or per corner `{ topStart, topEnd, bottomStart, bottomEnd }` (an omitted one `medium`) | yes |
| `width` | `w` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `height` | `h` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `minHeight` | `minH` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `fill` |  | `true`: the parent's whole width | yes |
| `flex` | `weight` | 1 to 12: its share of a `Row` or `Column` | yes |
| `crossAxisAlignment` | `align` | `start`, `center`, `end`, `stretch`: across the main axis (on a `Text`, the paragraph) | yes |
| `mainAxisAlignment` | `justify` | `start`, `center`, `end`, `spaceBetween`, `spaceAround`: along the main axis | yes |
| `color` |  | `primary`, `secondary`, `surface`, `muted`, `warning`, `error`, `onPrimary`, `primaryContainer`, `surfaceVariant` | yes |
| `span` |  | 1 to 12 or `"auto"` (default), only in a `Row` with `wrap: true` | yes |
| `offset` |  | 0 to 11, only in a `Row` with `wrap: true` | yes |
| `maxWidthFraction` |  | 0.25 to 1 in steps of 0.05: at most that share of the parent's width (exactly, with `fill`) | yes |
| `alignSelf` |  | `start`, `center`, `end`, `stretch`: this child across its `Row` or `Column`, over the parent's `crossAxisAlignment` ([box and text properties](#box-props)) | yes |
| `textAlign` |  | `start`, `center`, `end`, `justify`: the paragraph of a node that draws text (`Text`, `Button`, `Chips`, `TextField`, `TextField`, `ListTile`) | yes |
| `border` |  | `{ width?, color? }` on a box: width 0 to 8 dp (default 1), a colour role (default Kino's outline) | yes |
| `elevation` |  | 0 to 24 on a `Card` or a `Stack`: Kino's shadow (a card's tonal lift too) | yes |
| `background` |  | a colour role: a box's fill (its content reads in the role's on-colour) | yes |
| `minWidth` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `maxWidth` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `maxHeight` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 | yes |
| `positioned` |  | `{ top?, left?, right?, bottom?, width?, height? }` on a `Stack` child: dp or `"25%"` of the stack ([positioned stack](#positioned)) | yes |
| `opacity` |  | 0 to 1; below 0.38 the node takes no press and no focus ([animations](#animate)) | yes |
| `animate` |  | `{ duration?, curve? }` on a box or a positioned child: changes glide ([animations](#animate)) | yes |
<!-- ui:style:end -->

<a id="common-properties"></a>
### Common properties

Every node takes these besides its own and the style.

<!-- ui:common:start -->
| Property | Type | Default | Per size | Notes |
| --- | --- | --- | --- | --- |
| `key` | string | `auto-<n>` | no | unique on the screen; required on inputs, pop-ups, an `ExpansionTile` and a dismissible banner; the `auto-` prefix is Kino's |
| `onTap` | action | none | no | a press (a button's is `onPressed`) |
| `onLongPress` | action | none | no | a long press; keep it for extras reachable another way |
| `arg` | string | none | no | the event's `arg` when the action is a bare event name (at most 4,096 characters) |
| `enabled` | boolean | `true` | no | `false` draws it off; `ui` `enable`/`disable` change it |
| `hidden` | boolean | `false` | no | `true` starts it hidden; `ui` `show`/`hide`/`toggle` change it |
| `devices` | `phone`, `tv`, `desktop` (a list) | everywhere | no | drawn only there; an unknown name drops the node |
| `sizes` | `compact`, `medium`, `expanded` (a list) | every size | no | drawn only at those width classes |
| `testKey` | string | none | no | 1 to 64 characters, for tests, never drawn |
| `autofocus` | boolean | `false` | no | a node that takes focus: where focus goes when a render left it nowhere ([shared properties](#shared-properties)) |
| `selected` | boolean | none | no | a button or a card with `onTap`: Kino's selected look; `ui` `set` and `toggle` (`prop: "selected"`) change it |
| `badge` | `"dot"` or `{ text, textEn?, color? }` | none | no | a button, a card with `onTap`, a tab: a count (at most 12 characters) or a dot on its top end corner |
| `visible` | boolean | `true` | no | `false` hides it as `hidden: true` does ([animations](#animate)) |
| `tooltip` | string | none | no | a node that does something: Kino's hint (`tooltipEn`), at most 80 characters; never essential information ([tooltip](#tooltip)) |
| `enabledAt` | epoch ms | none | no | a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: off until that time on the device's clock, then on by itself, no call to you ([text with a time](#text-time)) |
| `canRequestFocus` | boolean | `false` | no | any node: on the TV a D-pad stop where the remote rests to read it (Kino's row look, no press); ignored where the node takes focus already and on the phone ([shared properties](#shared-properties)) |
| `loading` | boolean | `false` | no | a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: Kino's busy look (a spinner, no press, read as busy); Kino also draws it on the node pressed while its call runs long ([busy and slow presses](#busy)) |
<!-- ui:common:end -->

<a id="shared-properties"></a>
### Shared properties

Kino never adds a component per need: a family of nodes shares one property with one meaning everywhere (Task 15).

- **`autofocus: true`** on a node that takes focus (a button, an input, a `TabBar`, a `titleCard`, or any node with `onTap` or
  `onLongPress`): on a render (a tick or an answer) that left focus nowhere, or on a node that is gone, focus goes to the first
  `autofocus` node in tree order. An answer's own `focus` wins and a node that still holds focus keeps it. This is mostly for
  the TV: a screen that changes on a timer (a download done, a live event over) puts the remote on its one way forward. On a
  phone a text field is never autofocused (no keyboard opens by itself). Elsewhere ignored, logged.
- **`canRequestFocus: true`** (Flutter's name) on any node that takes no focus of its own (a status `Card`, a `Text`, a
  `Row`, a `Column`, a `DataTable`, a `MaterialBanner` without an action): on the TV it becomes a D-pad stop where the remote
  rests to read it, in Kino's row look (a tonal tint and an accent underline, never the white ring), with no press (OK does
  nothing). It takes part in Up, Down, Left, Right and the `Scaffold` rules like any stop, and a screen reader reads its
  content. Ignored on a node that already takes focus and on the phone; never per size. Recipe, a status card as a TV read
  stop: `{ "type": "Card", "key": "status", "canRequestFocus": true, "children": [ ... ] }`. Without it the TV still shows the
  card: a scrolling body pages (80% of its height) before focus moves past a block that has not shown yet.
- **`selected: true | false`** on a button (any variant) or a card with `onTap`: Kino's selected look (filled-tonal; a card
  gets an outline in the primary colour), read as selected by a screen reader. It is state, not an action; `ui` `set` and
  `toggle` with `prop: "selected"` change it without a call ([Local ui operations](#ui-ops)). `Chips` and
  `TabBar` say which is selected with their `value`. On the TV focus is unchanged.
- **`badge`**: the `Badge` node's value, `"dot"` or `{ text, textEn?, color? }` (a count or a short word, at most 12
  characters; `color` a colour role, Kino's primary by default), on a button, a card with `onTap`, a `TabBar` tab (in its
  `tabs` entry) and a panel's drawer tab (in the panel result's `tabs`). It sits on the node's top end corner (beside a tab's
  label) and a screen reader reads it after the node's name («Chat, 3»; a dot reads «nuevo»). Set it on each render.

```json
{ "type": "Column", "children": [
  { "type": "TabBar", "key": "tabs", "value": "chat", "onChanged": "tab", "tabs": [
    { "value": "room", "label": "Sala", "labelEn": "Room" },
    { "value": "chat", "label": "Chat", "badge": { "text": "3" } }] },
  { "type": "Row", "gap": 8, "children": [
    { "type": "IconButton", "key": "mute", "icon": "close", "labelText": "Silencio", "labelTextEn": "Mute", "selected": true,
      "onPressed": { "ui": [{ "toggle": "mute", "prop": "selected" }], "event": "mute" } },
    { "type": "IconButton", "key": "downloads", "icon": "download", "labelText": "Descargas", "labelTextEn": "Downloads", "badge": "dot", "onPressed": "downloads" },
    { "type": "ElevatedButton", "key": "retry", "labelText": "Reintentar", "labelTextEn": "Try again", "autofocus": true, "onPressed": "retry" }] }
] }
```

`maxWidthFraction` (0.25 to 1 in steps of 0.05) and `borderRadius` per corner are [style](#style): every node takes the first,
every node that draws a box the second; the TV's focus ring follows the corners.

<a id="box-props"></a>
### Box and text properties

Style properties (Task 17), every one per size, each a token or a colour role, never a free value:

| Property | Taken by | What it does |
| --- | --- | --- |
| `alignSelf` | a child of a `Row`, `Column`, `Card`, `Form` or scroll | `start`, `center`, `end`, `stretch` across its parent, over the parent's `crossAxisAlignment`; in a row `stretch` draws as `start` (Kino measures no intrinsic heights); elsewhere, a wrapping row's cell too, ignored, logged |
| `textAlign` | `Text`, a button's label, `Chips`, `TextField`, `ListTile` | `start`, `center`, `end`, `justify`; on a `Text` it wins over the older paragraph reading of `crossAxisAlignment`. The TV draws its own field and action entries, sized to their text: there it shows on a `Text` |
| `border` | a box: `Column`, `Row`, `Stack`, `Card`, scroll, `GridView`, `Form`, `ListTile`, `PageView` | `{ width?, color? }`: 0 to 8 dp (default 1, out of range clamped), a colour role (default Kino's outline); follows `borderRadius`; a selected card keeps Kino's primary outline |
| `elevation` | `Card`, `Stack` | 0 to 24 (clamped): Kino's shadow, following the shape; a plain card is also lifted tonally. No free shadows |
| `background` | a box | a colour role: the fill (over `color`, which a box still reads as its fill); text and icons inside read in the role's on-colour, and a `Text` or `Icon` coloured with a role that would not read on that fill is drawn in the fill's readable colour |
| `minWidth`, `maxWidth`, `maxHeight` | any node | the size scale, beside `minHeight`; a minimum above its maximum drops the maximum, logged |

```json
{ "type": "Column", "crossAxisAlignment": "start", "children": [
  { "type": "Card", "border": { "width": 2, "color": "primary" }, "elevation": 3, "maxWidth": 320, "alignSelf": "center",
    "children": [{ "type": "Text", "text": "Centrado", "textEn": "Centred", "textAlign": "center", "fill": true }] },
  { "type": "Stack", "background": "primaryContainer", "padding": 12, "children": [{ "type": "Text", "text": "Destacado", "textEn": "Highlighted" }] }
] }
```

<a id="animate"></a>
### Animations (`animate`, `opacity`, `visible`)

Flutter's `AnimatedContainer`, `AnimatedOpacity` and `AnimatedSwitcher` folded into one style property (Task 17): `animate: {
duration?, curve? }` on a box (or a `positioned` child): changes of its size, its `opacity`, its fill, its place in a stack and
its visibility between two renders glide over `duration` ms (100 to 600, default 250, clamped) along `curve` (`standard`,
`ease`, `decelerate`). `opacity` (0 to 1, any node) fades it; below 0.38 the node takes no press and no focus. `visible:
false` hides a node as `hidden: true` does (`ui` `show` and `hide` still work); with `animate` it fades and folds in and out,
and while it glides out it takes nothing. The device's "remove animations" (animator duration scale 0) makes every one a
jump; an animation never delays a press or focus; at most 24 animating nodes a screen (the rest drop `animate`, logged).

```json
{ "type": "Card", "key": "details", "animate": { "duration": 300, "curve": "decelerate" }, "visible": true,
  "background": "surfaceVariant", "children": [{ "type": "Text", "text": "Más información", "textEn": "More details" }] }
```

<a id="tokens"></a>
### Tokens

<!-- ui:tokens:start -->
| Token | Values |
| --- | --- |
| Spacing (`padding`, `margin`, `gap`) | 0, 4, 8, 12, 16, 24, 32, 48 |
| Sizes (`width`, `height`, `minHeight`) | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| Corners (`borderRadius`) | `none`, `small`, `medium`, `large`, `full` (one for every corner, or a map per corner) |
| Colour roles (`color`) | `primary`, `secondary`, `surface`, `muted`, `warning`, `error`, `onPrimary`, `primaryContainer`, `surfaceVariant` |
| Roles (`MaterialBanner`, a toast) | `info`, `warning`, `error`, `success` |
| Text styles (`Text.style`) | `h1`, `h2`, `h3`, `h4`, `h5`, `p`, `caption`, `label` |
| Card sizes (`titleCard`, `titleRail`, `QrImage`) | `small`, `medium`, `large` |
| Width classes (per-size maps, `sizes`) | `compact`, `medium`, `expanded` |
| Devices (`devices`, `ctx.device`) | `phone`, `tv`, `desktop` |
| Icons (`Icon.name`, a button's `icon`) | `info`, `tune`, `settings`, `star`, `bolt`, `language`, `subtitles`, `list`, `magic`, `heart`, `movie`, `tv`, `sports`, `music`, `bookmark`, `help`, `refresh`, `sync`, `add`, `remove`, `delete`, `edit`, `search`, `close`, `check`, `share`, `play`, `pause`, `download`, `upload`, `link`, `open_in_new`, `home`, `person`, `lock`, `notifications`, `warning`, `error`, `visibility`, `copy`, `arrow_back`, `arrow_forward`, `expand_more`, `expand_less`, `more_vert`, `filter_list`, `calendar`, `schedule`, `send`, `mood` |
<!-- ui:tokens:end -->

Not in this version (deferred): pull-to-refresh, segmented buttons, autocomplete and combo boxes, date and time pickers, a
range slider, a rating, dismissible and reorderable list items, rich text, charts, continue-watching and channel cards and
file inputs. Task 17 added the positioned `Stack`, `alignSelf`, `textAlign`, borders, elevation, a background role,
`minWidth`/`maxWidth`/`maxHeight`, animations, `FloatingActionButton`, `ListTile`, `CircleAvatar`, `PageView` (and the
carousel), tooltips and the `Scaffold`. The screen asks added the masked `TextField` (`obscureText`), password writes
through `config`, and the `settings` node's `onSaved`.
Feature-detect a widget a newer Kino adds with `kino.screen.names.includes("DataTable")`.

<a id="limits"></a>
### Limits

<!-- ui:limits:start -->
| Limit | Value | What |
| --- | --- | --- |
| `maxConfigKeys` | 32 | settings one `config` writes |
| `maxDepth` | 10 | depth of a tree |
| `maxNodes` | 600 | nodes in a tree |
| `maxListItems` | 500 | items in a list, rail, grid, accordion or a choice's options |
| `maxStateBytes` | 65,536 (64 KB) | bytes of state, as JSON |
| `maxTextChars` | 2,000 | characters of a text |
| `minEventIntervalMs` | 100 | ms between two events |
| `callTimeoutMs` | 20,000 | ms per `screen` or `screenEvent` call |
| `maxPopups` | 1 | pop-up open at a time |
| `maxRefChars` | 4,096 | characters of a `ref` or an `arg` |
| `maxSearchQueryChars` | 200 | characters of a `go.search` `q` |
| `eventQueue` | 8 | events waiting |
| `maxUiOps` | 8 | `ui` operations per action or answer |
| `maxDialogButtons` | 3 | buttons in a dialog |
| `maxWeight` | 12 | largest `flex` |
| `maxGridColumns` | 8 | largest `columns` |
| `maxTestKeyChars` | 64 | characters of a `testKey` |
| `maxTrailingLabelChars` | 40 | characters of a text field's `trailingLabel` |
| `maxHeroButtons` | 2 | buttons in a `heroCard` |
| `maxMenuItems` | 8 | items in a menu |
| `maxTitles` | 1,000 | titles in a whole tree |
| `maxFlatTitles` | 60 | titles in a rail or grid drawn all at once |
| `maxPatternChars` | 200 | characters of a `pattern` |
| `maxPatternRepeat` | 1,000 | largest count in a pattern |
| `maxPatternStates` | 500 | steps of a pattern once counts are expanded |
| `maxPatternFields` | 16 | patterns one submit runs |
| `maxPatternCompileWork` | 20,000 | units of work to read one pattern |
| `maxPatternMatchWork` | 4,000,000 | matcher steps one submit runs |
| `minTimerMs` | 1,000 | shortest timer, ms |
| `maxTimerMs` | 86,400,000 | longest timer, ms |
| `maxTimers` | 3 | timers per screen |
| `timerMaxFailures` | 3 | failures in a row that switch a timer off |
| `toastMinMs` | 2,000 | shortest toast, ms |
| `toastMaxMs` | 8,000 | longest toast, ms |
| `toastDefaultMs` | 3,500 | a toast's default, ms |
| `timerConfigWriteIntervalMs` | 60,000 | ms between two writes of one setting from a timer |
| `maxQrChars` | 1,000 | characters of a `QrImage` value |
| `maxStepperDecimals` | 6 | decimals of a `NumberStepper` |
| `maxStepperAbs` | 1,000,000,000,000,000 | largest `NumberStepper` number either way |
| `maxSkeletonLines` | 6 | lines of a `Skeleton` |
| `maxTableColumns` | 20 | columns of a `DataTable` |
| `maxTableRows` | 200 | rows of a `DataTable` |
| `maxColSpan` | 8 | largest `colSpan` |
| `gridColumns` | 12 | columns of the twelve-column row |
| `maxGoRouteChars` | 64 | characters of a `go.screen` `route` |
| `maxGoArgsBytes` | 4,096 (4 KB) | bytes of `go.screen` `args`, as JSON |
<!-- ui:limits:end -->

<a id="panel"></a>
## Player panel

The player panel (apiVersion 9: the manifest's `panel` and the `panel`, `panelAction` and `playerEvent` exports) can be
built from the same nodes. The guide's [player panel section](README.md#the-player-panel-built-with-the-screen-kit) has
every rule; the [Watch Party example](examples/watch-party/) is a tab contributed to any plugin's panel.

> Screenshot slots: `ui-img/panel-phone.png`, `ui-img/panel-tv.png` (phone captured, TV pending, see [Screenshots](#screenshots)).

<a id="panel-screen-mode"></a>
### Legacy panel and screen mode

`panel(context)` may return `{ format: "screen", root, ... }`: the same drawer (its title, tabs, `refreshMs` and accent)
with a body that is a screen tree. A result without `format` is the legacy panel, read exactly as before. Answer a screen
result only when `context.features` includes `"screen"`.

On the TV the panel's text is a step smaller than a full screen's (the drawer and the dock are 360 to 480 dp wide): `h1`
draws at a screen's `h3` size, `h2` at `h4`'s, `h3` at `h5`'s, `h4` and `h5` at the large body size, `p` at 15 sp; the
phone's sizes do not change. When an answer's new tree no longer has the focused node (a QR view replacing the pressed
button), focus goes to the focusable now at or after its place; with none, the body itself takes it (no ring) so Up and
Down still scroll it. An answer's `focus` wins.

On the TV only what does something takes focus and Kino's ring in any panel, legacy or screen mode: buttons, toggles,
selects, fields, the episode list, the tabs, pin and close. A text, a section, a status, an image or a QR is never a focus
stop and never boxed: Up and Down page through them. Kino's own tab about the title shows, top to bottom, the poster with
the title and its facts, the synopsis, the details, the images and last the cast (three cards a row, two on a panel under
360 dp, names and characters in small type), each part only when TMDB has it.

<!-- ui:panel:start -->
| What | In a panel in screen mode |
| --- | --- |
| Result | `{ format: "screen", root, title, titleEn, accent, refreshMs, tabs, tab, player, layout }` (apiVersion 14) |
| Tree | depth 6, 200 nodes; `AlertDialog`, `BottomSheet`, `PopupMenuButton` not drawn, unless it has an `anchor` (a popover inside the drawer); no `every` (the panel's `refreshMs` is the periodic call) |
| Context adds | `state`, `size`, and `features` holds `"screen"` while screens are on |
| `panelAction` triggers | `press`, `change`, `submit` |
| Answer fields kept | `state`, `toast`, `toastEn`, `ui`, `config`, `go`, `close`, `focus`, `player`, `message`, `pause`, `panel` |
| Answer fields dropped | `dialog`, `sheet`, `menu`, `route`; legacy-only `patch`, `values`, `save` |
<!-- ui:panel:end -->

```json
{ "format": "screen", "title": "Party Chat", "refreshMs": 10000, "root": { "type": "Column", "gap": 8, "children": [
  { "type": "Text", "text": "3 personas viendo", "textEn": "3 people watching", "style": "h4" },
  { "type": "ElevatedButton", "labelText": "Sincronizar", "labelTextEn": "Sync", "onPressed": "sync" }
] } }
```

```js
export async function panel(context) {
  if (!(context.features || []).includes("screen")) return { title: "Party Chat", elements: [{ type: "status", text: "Actualiza Kino" }] };
  return { format: "screen", title: "Party Chat", root: { type: "Column", children: [{ type: "ElevatedButton", labelText: "Sincronizar", onPressed: "sync" }] } };
}
```

<a id="panel-tab"></a>
### Contributed tabs (`playerPanelTab`)

`"panel": { "contributes": true }` with the capability `playerPanelTab` adds your tab to the player panel of **any**
plugin's title: Kino's own information tab first, then the playing plugin's panel, then the contributed tabs. You are
called only while your tab is the selected one and the drawer is open; you see an allow-list of the title's context
(`foreign: true`, `source`, an opaque `ref`); your `go.title` and `go.play` are dropped; player actions only after a press
in your tab (`seekToMs`; with `playerControl` also `pause` and `speed`). Never on an 18+ title.

<a id="pinned-panel"></a>
### Pinned panel

Kino's own «Fijar» / «Pin» in the panel's header (a pin icon alone on a TV) docks it next to the video (the right third on
a TV or a wide landscape window, below the video on an upright phone, with at least 300 dp or 38 % of the height for the
video and its controls). Docked, the video keeps playing and the panel's `refreshMs` and
`playerEvent` keep running while Kino is in front. The pin lasts for the playback (a rotation and the next episodes keep
it; a new playback starts unpinned, nothing is remembered). On a TV, Right from the last control of the player's buttons
(or on the video while they are hidden) goes into the panel, Left comes back, and the first Back hides the panel (still
pinned) before the next Back leaves the video; docked on a TV or a phone held sideways, the player's two groups of buttons sit
one row under the other. Nothing in the plugin contract changes; a plugin that must keep running (a Watch Party) tells its
people to pin it for the playback.

<a id="layout-fill-a-chat-tab"></a>
### Layout fill: a chat tab

A panel's body scrolls by default (`layout: "scroll"`): the tree has no height limit, so a `ListView` draws flat and `flex`
does nothing, and a row after a list sits right under its last item. A chat wants the opposite: the messages take the room
and the input row stays at the bottom of the panel, like any chat app. Answer `layout: "fill"` (apiVersion 14, chosen per
result: beside `root` in a `panel()` result, on the root object of a `screen()` answer): the root is drawn at the body's
size with no body scroll, `flex` shares the height left, and a `ListView` with `flex` is lazy and scrolls itself.

```js
export async function panel(context) {
  const messages = ((context.state || {}).messages || []).map((m, i) => ({ type: "Text", key: "m" + i, text: m }));
  return { format: "screen", title: "Party Chat", layout: "fill", root: { type: "Column", gap: 8, children: [
    { type: "Text", text: "Sala 1234", style: "h4" },
    { type: "ListView", key: "chat", flex: 1, stickToBottom: true, items: messages,
      empty: { type: "Text", text: "Sin mensajes", textEn: "No messages", color: "muted" } },
    { type: "Row", gap: 8, children: [
      { type: "TextField", key: "msg", flex: 1, hintText: "Escribe…", hintTextEn: "Type…" },
      { type: "IconButton", icon: "send", labelText: "Enviar", labelTextEn: "Send", onPressed: "send" },
    ] },
  ] } };
}
```

- **Where the bottom row goes:** at the bottom of the panel, docked (pinned) or in the drawer, upright or sideways, however
  many messages the list holds; when the panel opens again (a return to Kino, a rotation) it is there too. The phone's
  keyboard lifts it: the dock and the drawer end above the keyboard, and the list gets the height left.
- **`stickToBottom`:** the list opens at the last message and follows new ones while the person reads the end; scrolled up
  to read older ones, it stays put until they come back down.
- **TV:** Up and Down page through a list with nothing to focus (messages), and leave it at its ends toward the controls.
- **Too tall:** when the parts without `flex` alone are taller than the panel (a short window, a big keyboard), Kino draws
  that render in the scroll layout and logs `screen: layout fill does not fit, using scroll` once; it tries `fill` again
  when the size or the root's children change. A `panel` root's own `layout` is ignored (logged): put it beside `root`.
- **Full screens** already draw the root at the screen's size with no scroll of their own (what `fill` does), whatever
  `layout` says. Any other value is logged and read as `scroll`.

<a id="recipes"></a>
## Recipes

Copy, paste, adapt. Each is a whole `screen` (and its `screenEvent` when it has events); the gallery runs most of them.

<a id="recipe-news-grid"></a>
### News card grid

One card per line on a phone, two on a medium window, three on a TV; flush cards with a picture and a fallback; a tap
reads the story in a declared pop-up opened from the answer.

```js
const STORIES = [
  { id: "a", title: "Un estreno", source: "Kino", image: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg" },
  { id: "b", title: "Otra noticia", source: "Guía", image: "" },
];

export async function screen({ state }) {
  const reading = STORIES.find((s) => s.id === state.reading);
  const card = (s) => ({
    type: "Card", key: "story-" + s.id, flush: true, span: { compact: 12, medium: 6, expanded: 4 }, onTap: { event: "read", arg: s.id },
    children: [
      { type: "Image", ...(s.image ? { url: s.image } : {}), aspect: "16:9", alt: s.title, fallback: { type: "Stack", color: "surface", children: [{ type: "Text", text: s.source, style: "h3", padding: 12 }] } },
      { type: "Column", padding: 12, gap: 4, children: [{ type: "Text", text: s.title, style: "h4", maxLines: 3 }, { type: "Text", text: s.source, style: "caption", color: "muted" }] },
    ],
  });
  return { type: "Column", children: [
    { type: "SingleChildScrollView", flex: 1, children: [{ type: "Row", wrap: true, gap: 12, padding: 16, children: STORIES.map(card) }] },
    { type: "AlertDialog", key: "story", title: reading ? reading.title : "", onClose: "closed", children: [{ type: "Text", text: reading ? reading.source : "…" }] },
  ] };
}

export async function screenEvent({ name, arg }) {
  if (name === "read") return { state: { reading: arg }, ui: [{ open: "story" }] };
  if (name === "closed") return { state: { reading: null } };
  return null;
}
```

<a id="recipe-settings-form"></a>
### Settings form with validation

A form whose submit Kino checks first; the answer writes your settings with `config` (the manifest declares `greeting` as
a `text` setting and `density` as a `select`).

```js
export async function screen() {
  return { type: "SingleChildScrollView", children: [{ type: "Form", key: "prefs", onSubmitted: "save", gap: 12, padding: 16, children: [
    { type: "TextField", key: "greeting", labelText: "Saludo", labelTextEn: "Greeting", required: true, maxLength: 40, pattern: "^[A-Za-z ]+$", errorText: "Solo letras", errorTextEn: "Letters only" },
    { type: "RadioGroup", key: "density", labelText: "Densidad", value: "normal", options: [{ value: "compact", label: "Compacta" }, { value: "normal", label: "Normal" }, { value: "roomy", label: "Amplia" }] },
    { type: "ElevatedButton", labelText: "Guardar", labelTextEn: "Save", submit: true },
  ] }] };
}

export async function screenEvent({ name, value }) {
  if (name !== "save") return null;
  return { config: { greeting: value.greeting, density: value.density }, toast: "Guardado", toastEn: "Saved" };
}
```

<a id="recipe-confirm"></a>
### Confirmation pop-up

The quick way is a button's `confirm` (Kino asks, then runs the action); the custom way is a dialog from the answer.

```js
export async function screen({ state }) {
  return { type: "Column", gap: 12, padding: 16, children: [
    { type: "Text", text: state.deleted ? "Lista borrada" : "Tu lista" },
    { type: "TextButton", labelText: "Borrar (rápido)", confirm: "¿Borrar la lista?", confirmEn: "Delete the list?", onPressed: "delete" },
    { type: "Button", variant: "secondary", labelText: "Borrar (diálogo)", onPressed: "ask" },
  ] };
}

export async function screenEvent({ name }) {
  if (name === "ask") return { dialog: { title: "¿Borrar la lista?", body: "No se puede deshacer.", buttons: [{ label: "Borrar", event: "delete", variant: "primary" }, { label: "Cancelar", variant: "text" }] } };
  if (name === "delete") return { state: { deleted: true }, toast: { text: "Borrada", role: "success" } };
  return null;
}
```

<a id="recipe-tabs-chips"></a>
### Tabs with chips

A `TabBar` whose value you keep in your state, and `Chips` filtering the tab's list.

```js
const ALL = [{ t: "Big Buck Bunny", k: "movies" }, { t: "Sintel", k: "movies" }, { t: "Una serie", k: "series" }];

export async function screen({ state }) {
  const tab = state.tab === "saved" ? "saved" : "all";
  const filter = typeof state.inputs?.kind === "string" ? state.inputs.kind : "any";
  const list = ALL.filter((x) => filter === "any" || x.k === filter);
  return { type: "Column", children: [
    { type: "TabBar", key: "tabs", value: tab, onChanged: "tab", tabs: [{ value: "all", label: "Todo", labelEn: "All" }, { value: "saved", label: "Guardado", labelEn: "Saved" }] },
    { type: "Chips", key: "kind", value: filter, padding: 8, options: [{ value: "any", label: "Todo" }, { value: "movies", label: "Películas" }, { value: "series", label: "Series" }], onChanged: "filter" },
    { type: "ListView", key: "list", flex: 1, items: list.map((x, i) => ({ type: "Text", key: "x" + i, text: x.t, padding: 12 })), empty: { type: "emptyState", title: "Nada", titleEn: "Nothing" } },
  ] };
}

export async function screenEvent({ name, value }) {
  if (name === "tab") return { state: { tab: value } };
  if (name === "filter") return { state: {} }; // the chip's value is already in state.inputs: just draw again
  return null;
}
```

<a id="recipe-matrix"></a>
### Button matrix (calculator style)

Twenty buttons in a twelve-column row, three columns each (four to a line), each with its own `key`, sized per class: the
D-pad walks it as a matrix on a TV. The [calculator example](examples/screen-calculator/) is the whole plugin.

```js
const KEYS = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "C", "0", ".", "+"];

export async function screen({ state }) {
  const shown = typeof state.shown === "string" ? state.shown : "0";
  return { type: "Column", gap: 12, padding: 16, children: [
    { type: "Card", variant: "filled", children: [{ type: "Text", text: shown, style: "h1", crossAxisAlignment: "end" }] },
    { type: "Row", wrap: true, gap: 8, children: KEYS.map((k, i) => ({
      type: "Button", key: "k" + i, variant: /\d|\./.test(k) ? "secondary" : "primary", labelText: k,
      onPressed: "key", arg: k, span: 3, fill: true, height: { compact: 80, medium: 64, expanded: 48 },
    })) },
  ] };
}

export async function screenEvent({ name, arg, state }) {
  if (name !== "key") return null;
  const now = typeof state.shown === "string" ? state.shown : "0";
  return { state: { shown: arg === "C" ? "0" : (now === "0" ? "" : now) + arg } };
}
```

<a id="recipe-scaffold"></a>
### A screen with an app bar, tabs and a floating button

A `Scaffold` root: the bar with a back button, a search action and two tabs; a lazy list in the body; a «Nueva» button above
a bottom bar of three sections. Your state keeps the tab and the section (neither is in `state.inputs`).

```js
export async function screen({ state }) {
  const tab = state.tab === "saved" ? "saved" : "all";
  const section = ["home", "lists", "me"].includes(state.section) ? state.section : "home";
  const rows = (tab === "saved" ? ["Guardado 1"] : ["Uno", "Dos", "Tres"]).map((t, i) => ({ type: "ListTile", key: "r" + i, title: t, onTap: "show", arg: String(i) }));
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", title: "Mis listas", titleEn: "My lists",
      leading: { type: "IconButton", icon: "arrow_back", labelText: "Atrás", labelTextEn: "Back", onPressed: { close: true } },
      actions: [{ type: "IconButton", icon: "search", labelText: "Buscar", labelTextEn: "Search", onPressed: "search" }],
      bottom: { type: "TabBar", key: "tabs", value: tab, onChanged: "tab", tabs: [{ value: "all", label: "Todo", labelEn: "All" }, { value: "saved", label: "Guardado", labelEn: "Saved" }] },
    },
    body: { type: "ListView", key: "rows", items: rows },
    floatingActionButton: { type: "FloatingActionButton", icon: "add", labelText: "Nueva", labelTextEn: "New", onPressed: "newList" },
    bottomNavigationBar: { type: "NavigationBar", value: section, onChanged: "section", items: [
      { key: "home", icon: "home", label: "Inicio", labelEn: "Home" },
      { key: "lists", icon: "list", label: "Listas", labelEn: "Lists" },
      { key: "me", icon: "person", label: "Yo", labelEn: "Me" },
    ] },
  };
}

export async function screenEvent(e) {
  if (e.name === "tab") return { state: { tab: e.value } };
  if (e.name === "section") return { state: { section: e.value } };
  return null;
}
```

<a id="recipe-app-bar-tabs"></a>
### Tabs in the app bar

Kino's own title bar already names the screen, so the app bar can hold the tabs themselves: a `TabBar` as the `title`, beside
the actions, one row tall.

```js
export async function screen({ state }) {
  const tab = ["account", "connection", "help"].includes(state.tab) ? state.tab : "account";
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      title: { type: "TabBar", key: "tabs", value: tab, onChanged: "tab", tabs: [
        { value: "account", label: "Cuenta", labelEn: "Account" },
        { value: "connection", label: "Conexión", labelEn: "Connection" },
        { value: "help", label: "Inicio y ayuda", labelEn: "Start and help" },
      ] },
      actions: [
        { type: "IconButton", icon: "refresh", labelText: "Actualizar", labelTextEn: "Refresh", onPressed: "refresh" },
        { type: "IconButton", icon: "help", labelText: "Ayuda", labelTextEn: "Help", onPressed: "help" },
      ],
    },
    body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 12, children: [{ type: "Text", text: "Pestaña: " + tab }] }] },
  };
}

export async function screenEvent(e) {
  return e.name === "tab" ? { state: { tab: e.value } } : null;
}
```

<a id="screenshots"></a>
## Screenshots

Each section names two pictures, `ui-img/<component>-phone.png` and `ui-img/<component>-tv.png`. They are captured from
Kino's real renderer with the [gallery example](examples/screen-gallery/), never drawn by hand: its
`screenshot-map.json` says, for each component, which tab to open, which section to scroll to and which button to press.
The folder's README lists how. Until a picture is captured its slot says "pending".
