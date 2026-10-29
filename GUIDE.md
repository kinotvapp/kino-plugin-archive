# Writing a Kino plugin

A Kino plugin is a video source that anyone can publish as a small GitHub repository: one JSON
manifest and one JavaScript file. A person types `owner/repo` in Kino, sees which sites the plugin
will talk to, accepts, and from then on the plugin is one more source: its results show up in
search and on Home, and its titles open, list episodes, play in Kino's player, keep progress and
appear in "Continuar viendo" and the library like any other title.

You can write, run and test a plugin on your computer with Node before you ever touch the app. This
guide has everything you need: the file layout, the manifest, the contract your code must meet, the
API Kino gives you, every limit, the quirks of the JavaScript engine, and how to publish.

This repository is itself the reference plugin (`kino-plugin.json` + `plugin.js`, an Internet
Archive source), and `sdk/` is the Node kit. Two more files describe the contract for machines:
`contract.json` holds every number and rule the app enforces (the tables in this guide are generated
from it, and the app's tests pin its own constants to it), and `kino.d.ts` declares the whole `kino`
API for your editor (`/// <reference path="./kino.d.ts" />` at the top of `plugin.js`).

1. [What a plugin is](#1-what-a-plugin-is)
2. [A first plugin](#2-a-first-plugin)
3. [The manifest](#3-the-manifest)
4. [The contract (apiVersion 1 to 14)](#4-the-contract-apiversion-1-to-14)
5. [The `kino` API](#5-the-kino-api)
6. [Limits and engine quirks](#6-limits-and-engine-quirks)
7. [Test it locally](#7-test-it-locally)
8. [Publishing your plugin](#8-publishing-your-plugin)
9. [What people see](#9-what-people-see)
10. [The reference plugin](#10-the-reference-plugin)
11. [Cookbook](#11-cookbook)
12. [External resolver apps](#12-external-resolver-apps)
13. [Screens (`screen`, apiVersion 14)](#13-screens-screen-apiversion-14)
    - **[User interface](ui.md)**: every component a screen can draw, with its properties and an example, Bootstrap style

## 1. What a plugin is

A public GitHub repository, or a folder inside one, with:

```
kino-plugin.json   the manifest (required)
plugin.js          the code: a single ES module (required; its name is set by "entry")
icon.png           optional, square, at most 128 KB
README.md          for humans
```

Kino runs your code in a sandbox: no filesystem, no timers, no other plugins, no access to the
person's data. The only way out is `kino.fetch`, which can reach only the hosts your manifest
declares and the person approved on screen, plus the servers the person typed in your plugin's
settings (see [section 3](#3-the-manifest)).

Kino loads exactly one JavaScript file, so there is nothing for an `import` to resolve to. If you
use a build step or a library, bundle everything into that single file -- see
["Splitting your code across files"](#splitting-your-code-across-files) for a worked example.

**How people install it.** In Kino, Ajustes > Plugins, they type the address of your repository:

| They type | Kino reads |
| --- | --- |
| `owner/repo` | the repository root, default branch |
| `owner/repo/sub/dir` | a folder inside the repository |
| `owner/repo@v1.2.0` | a branch, tag or commit (the name cannot contain `/`); also works with a folder |
| `https://github.com/owner/repo` or `.../tree/<ref>/<path>` | the same, pasted from the browser |
| `https://raw.githubusercontent.com/owner/repo/<ref>/<path>/kino-plugin.json`, or `https://github.com/owner/repo/blob/<ref>/<path>/kino-plugin.json` (also `/raw/`, and `refs/heads/<branch>` as the ref) | the folder that file is in, at that ref; the file has to be a `.json` one (`kino-plugin.json`, or a Nuvio repo's `manifest.json`), any other file is refused |
| `https://cdn.jsdelivr.net/gh/owner/repo[@<ref>]/<path>/kino-plugin.json` (also `fastly`, `gcore`, `testingcf` and `quantil.jsdelivr.net`) | the same repository folder, read from GitHub: no `@ref` or `@latest` is the default branch; the ref must be an exact branch, tag or commit, so a version range (`@1`, `@^1.2`, `@1.x`) is refused |
| `https://<any public server>/<path>/kino-plugin.json` | a plugin hosted outside GitHub: see [Installing from a manifest URL](#installing-from-a-manifest-url) |

A query string or `#fragment` in a pasted URL is ignored. A ref that only comes from a pasted URL
(`tree`, `blob`, `raw`, `raw.githubusercontent.com` or jsDelivr's `@ref`) is not a pin: a plugin with sealed secrets
pasted that way installs from the default branch when that branch serves the same
`kino-plugin.json` (see [Sealed secrets](#sealed-secrets-apiversion-4)).

For a repository address, Kino downloads `kino-plugin.json`, your entry file and the icon from
`raw.githubusercontent.com`, which is why the repository has to be public. A URL of a repository's
`kino-plugin.json` (on GitHub, raw.githubusercontent.com or jsDelivr) always becomes that repository's
address, so sealed secrets, signatures and community search keep working for it.

#### Installing from a manifest URL

Your plugin does not have to live on GitHub. People can paste the `https` URL of its `kino-plugin.json`
on any public server (your own site, GitHub Pages, a CDN such as jsDelivr's `npm/`). Kino stores it
as the address `url:https://…/kino-plugin.json` (scheme and host lowercased, default port, query and
fragment dropped): that URL is the plugin's identity, and it travels as is to the person's other
devices with plugin sync.

- `entry` and `icon` are read relative to the manifest URL: `"entry": "plugin.js"` next to
  `https://example.com/kino/kino-plugin.json` is `https://example.com/kino/plugin.js`.
- `https` only (`http://` is refused with "Kino solo instala plugins desde direcciones https…"), on a
  public name: no IP addresses, no `localhost`, no single-label or `.local`/`.lan` names, no
  user:password in the URL, and the file has to be named exactly `kino-plugin.json`. A name that
  resolves to a private address, and a redirect off `https` or to such a host, are refused too.
- **No sealed secrets**: seals are bound to a GitHub repository, so a manifest with `secrets`
  installed from a URL is refused ("Este plugin trae datos sellados, y esos solo funcionan si lo
  instalas desde su repositorio de GitHub…"). Publish such a plugin on GitHub.
- **Unsigned**: a `signature` is bound to `owner/repo`, so it is not checked and the plugin installs
  (and shows) as unsigned.
- Everything else is the same as a repository install: the consent sheet, `hosts` and every approval
  rule, and updates — Kino re-reads the same URL and applies a higher `version`, asking again when it
  needs more than was approved. The plugin is never listed by community search (that only finds
  GitHub repositories).

**Stremio addons (a Kino feature for people, not something you write).** Besides repositories, people
can install a Stremio addon in the same field: the address of its `manifest.json`, a `stremio://`
link, or a tapped "Install" link (on the phone or the TV; it waits while the player is open). A tapped link only opens Plugins ▸ Agregar with the address filled in; Kino fetches nothing until you tap Agregar. Kino then reads the manifest and generates one plugin per
addon (id `stremio-<slug>-<hash>`); you never author or publish that plugin, and nothing here changes
for yours.

A tapped link opens Kino only when it is a `stremio://` one. On Android 12 and later an
`https://…/manifest.json` link opens in the browser: Android hands a web link to an app only for the
domains that app has verified, and Kino cannot verify an addon's domain. Kino still declares those links
(older Android versions offer it in the "Abrir con" list), and the address itself always works pasted
into the field.

- **The address stays out of the files.** It is kept only in the generated plugin's two settings: the
  server (`addonUrl`, a `url` setting) and the rest of the path (`addonPath`, a `password` setting
  held in the Keystore). The generated manifest, script and logs never contain it.
- **What it gives.** Catalogs become Home rows and "Ver más" (each row's title carries its type, the
  way Kino's own rows do: "Popular · Películas", "Popular · Series", "· Anime"), search, info pages
  and episodes. The addon's `logo` becomes the plugin's icon (read once at install, at most 128 KB; a
  logo that is not a PNG is converted to one with Android's own decoder, or left out).
  `tv`/`channel` catalogs become live channels in En vivo; only then does the plugin declare the
  `channels` capability. Subtitles come from the stream and from the addon's `subtitles` resource,
  which also answers the player's "Buscar subtítulos en línea" for any title with an IMDb or TMDB id
  (the plugin declares `subtitles`), with the playing file's `videoHash`, `videoSize` and `filename`
  when Kino knows them (never the video's URL). An addon with only a `subtitles` resource (OpenSubtitles v3)
  installs as a [subtitle provider](#subtitles-for-any-title): nothing on Home, in search or En vivo.
  A subtitle **translator** addon works the same way once configured: paste its configured address
  (the one its configure page gives, with the target language in the path, e.g. GTSubs'
  `https://gtsubs.strem.top/es/manifest.json`). Its machine translations show as "Español (traducido)":
  a track whose `lang` carries GTSubs' `gt` mark (`esgt`), or any track an addon whose name or
  description says it translates serves from its own server. GTSubs' `info:` notice tracks are skipped.
  For an addon that plays movies, series or anime, those can be downloaded for offline viewing on
  phones (the plugin declares `download`; an HLS stream is saved as one file, DASH is refused); live
  channels never, and a channels-only addon has no download option.
- **Catalogs on another host.** Some addons answer their catalogs with a redirect to another server
  (Cinemeta sends them to `cinemeta-catalogs.strem.io`), and a plugin may follow a redirect from the
  person's server only to that server or to a declared host. So at install Kino probes the catalog
  addresses the plugin will use (each Home row's first page and one later page, each search catalog,
  each live category: at most 30, a few at a time, about 10 s in all) at the addon's own address,
  following its redirects to their targets (never into the person's network, unless it is the server
  they typed), and declares every public https host they redirect to. The person sees those hosts on the consent
  sheet like any other. A redirect to a local or private address, or over plain http, is never
  declared, and a probe that fails just adds nothing: it never stops the install.
- **Where it plays.** Exactly where Stremio would ask it: its `stream` resource's `types` and
  `idPrefixes` (an object resource's own lists, else the manifest's). A catalog-only addon (Cinemeta,
  Kitsu) plays nothing: its titles say "<addon> solo trae el catálogo" with the player's "Ver en otros
  plugins", and it answers no title card's search (a typed search still lists its catalog). An id or
  type outside the stream resource is never asked about (a `kitsu:` id to a `tt`-only addon). A
  `tv`/`channel`-only addon (US Live TV) answers no title search at all.
- **What it plays.** Only direct `http(s)` links. Peer-to-peer (`infoHash`), Usenet, archives (rar, zip, tgz, tar),
  YouTube and external-page links are dropped. Of the playable ones Kino picks the best: web-ready
  first; then by the resolution the addon names (1080p, 720p, unlabelled, 2160p last); within a tier
  HLS/MP4 links win, HEVC combined with DTS/Dolby audio is avoided and 8-bit is preferred over 10-bit (Hi10P);
  ties keep the addon's order. When the first cannot play on the device, the next one plays by itself.
- **Refused**, among others: something that is not a Stremio addon ("Esa dirección no es la de un addon de
  Stremio"), an addon that offers nothing Kino can use (no catalog, meta, stream or subtitles), a torrent addon even
  when it is set up with a debrid service ("Kino no admite addons de torrents, ni siquiera con debrid"), an addon
  whose configuration is too long to keep (over 2048 characters) and an address that redirects to a local address.
  Not refused any more: a subtitles-only addon installs as a subtitle provider (above); an addon that needs
  configuring first (`configurationRequired`) is not installed from its bare address -- Kino opens its configure
  page instead, and the configured address installs normally (configured on the phone, synced to the person's other
  devices, the path sealed); an adult addon (`behaviorHints.adult`) installs behind the person's 18+ code; an addon
  collection (`addon_catalog`) lists its addons for the person to choose which to add.
- **Updates and sync.** An update re-reads the addon at the saved address and probes its catalogs
  again. An update that brings something new to approve (a new host the catalogs redirect to,
  `download` for an addon installed before downloads existed, `channels`) waits for the person's
  approval: "Buscar actualización" shows the consent sheet. A probe that fails during an update keeps
  the hosts already declared. The plugin and its settings sync both ways between the person's paired
  devices; the server travels in the sync row and the path travels sealed end to end. On their other
  devices an update applies on its own only within what they approved.

## 2. A first plugin

Two files. `kino-plugin.json`:

```json
{
  "id": "hello-archive",
  "name": "Hola Archive",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "plugin.js",
  "description": "Películas de archive.org, en veinte líneas",
  "hosts": ["archive.org", "*.archive.org"],
  "capabilities": ["search", "resolve"]
}
```

`plugin.js`:

```js
const BASE = "https://archive.org";

export async function search(query) {
  const q = "title:(" + query.q + ") AND mediatype:(movies)";
  const url = BASE + "/advancedsearch.php?q=" + encodeURIComponent(q) +
    "&fl%5B%5D=identifier&fl%5B%5D=title&rows=10&output=json";
  const r = await kino.fetch(url);
  if (!r.ok) throw new Error("archive.org respondió " + r.status);
  return r.json().response.docs.map((d) => ({
    id: d.identifier,
    ref: d.identifier,
    title: String(d.title),
    kind: "movie",
    poster: BASE + "/services/img/" + encodeURIComponent(d.identifier),
  }));
}

export async function resolve(ref) {
  const r = await kino.fetch(BASE + "/metadata/" + encodeURIComponent(ref));
  const file = r.json().files.find((f) => f.name.endsWith(".mp4"));
  if (!file) throw new Error("este item no tiene un mp4");
  const path = file.name.split("/").map(encodeURIComponent).join("/");
  return { url: BASE + "/download/" + encodeURIComponent(ref) + "/" + path };
}
```

Run it (needs Node 18 or newer; see [section 7](#7-test-it-locally)):

```
node sdk/run.mjs ./plugin.js search "metropolis"
node sdk/run.mjs ./plugin.js resolve TheGiantOfMetropolis1961
```

Or let the kit write the skeleton for you: `node sdk/init.mjs my-plugin --host example.com` creates
`my-plugin/` with a manifest, a `plugin.js` with every function, a README and a replay-based test. Add
`--with byteSource,images,catalog,socket` (any of them) for an apiVersion 13 skeleton that declares those capabilities and
carries a working, commented example of each (`read`, `image`, `kino.catalog`, `kino.ws`).

This one is deliberately naive (a query with a `/` or a lone `AND` makes archive.org answer with
an error, and nothing checks the shape of the reply). The reference plugin in this repository is
the robust version of the same idea; read [section 10](#10-the-reference-plugin) before you build
on it.

## 3. The manifest

`kino-plugin.json`, at most 16 KB:

```json
{
  "id": "archive-org",
  "name": "Internet Archive",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "plugin.js",
  "description": "Películas de dominio público y televisión clásica de archive.org",
  "author": "kinotvapp",
  "homepage": "https://github.com/kinotvapp/kino-plugin-archive",
  "hosts": ["archive.org", "*.archive.org"],
  "capabilities": ["search", "home", "browse", "episodes", "resolve"],
  "color": "#E0A030",
  "icon": "icon.png"
}
```

If a rule below is broken, Kino refuses to install the plugin. Since Kino 0.9.55 the refusal messages quoted here
are English and meant for you (the SDK kit prints them, and Kino's log); the person reads a line in their language
that names the field to fix ("This plugin needs a newer version of Kino" for an `apiVersion` above what their Kino
knows). Kino 0.9.54 and older showed the person a Spanish message naming the field.

| Field | Rule |
| --- | --- |
| `id` | Required. `^[a-z0-9][a-z0-9-]{1,39}$` (2 to 40 lowercase letters, digits or hyphens, not starting with a hyphen). Not one of `live`, `local`, `unknown`, `plugin`, `own`, `subtitle-keys`, `subtitle-prefs` (Kino's own names). It is the plugin's identity: never change it once people have installed it. |
| `name` | Required. 1 to 40 characters. |
| `version` | Required. `MAJOR.MINOR.PATCH` and nothing else (no `-beta`, no `+build`), each number up to 6 digits and without leading zeros. |
| `apiVersion` | Required. `1` to `14`. `5` adds only the author's [signature](#signed-plugins-apiversion-5-kino-0945) (Kino 0.9.45); `6` adds typed and larger sealed secrets, `migrate`, request-signed streams, the settings form's `section`/`status`/`action`, `debug`, `telemetry`, `section`, `categories`, `theme`, [18+ entries](#what-you-return) shown behind the person's 18+ code, [`"browser": true` and `kino.browser.capture`](#kinobrowsercaptureurl-options-apiversion-6), [`"browser": "pages"` and `kino.browser.page`](#kinobrowserpageurl-options-apiversion-6) and [labelled and lazy copies](#labelled-and-lazy-copies-apiversion-6) (Kino 0.9.50); `7` adds [`tracking`](#telling-a-tracker-what-the-person-watches-tracking-apiversion-7) (Kino 0.9.51); `8` adds the [audio item kinds `music` and `podcast`](#music-and-podcasts-apiversion-8) (Kino 0.9.54); `9` adds `"fetchHosts": "any"` for a hand-written plugin, the English setting and section texts (`labelEn`, `hintEn`, `confirmEn`), `kino.meta` by title, and the [player panel](https://kinotvapp.github.io/kino-plugins/en/player-panel/): the manifest's `panel` with the `panel`/`panelAction` exports, `settingsLayout` for the settings form, and the `playerEvent` export (Kino 0.9.55); `10` adds the `playlists` capability (Kino 0.9.65); `11` adds the [`externalResolve`](#letting-another-app-resolve-what-you-found-externalresolve-apiversion-11) capability and the manifest's `externalResolver` (Kino 0.9.66); `12` adds the `syncProvider` capability, the manifest's `sync` block and the settings form's [`link` and `help`](#configuration-aids-link-and-help-apiversion-12) (Kino 0.9.74); `13` adds the `socket`, `byteSource`, `storageLarge`, [`catalog`](#catalog-sqlite-kinocatalog-catalog-apiversion-13), [`qrScan`](#qr-scanning-kinoqrscan-qrscan-apiversion-13) and [`imageSource`](#images-from-the-plugin-imagesource-apiversion-13) capabilities, the settings form's `qr` setting, and the `kino.crypto` operations `aesIge`, `modPow`, `gunzip`, `convert` and `aesIgeVerify` (Kino 0.9.74 too: 12, 13 and 14 all arrive in Kino 0.9.74, the next release, not published yet; see [Sockets and plugin-served bytes](#sockets-and-plugin-served-bytes-socket-and-bytesource-apiversion-13)); `14` adds the `screen` capability (a full-screen canvas the plugin builds: the `screen` and `screenEvent` exports and the manifest's `screen` block), `library`, `playerPanelTab`, `playerControl`, `room`, `schedule` (background jobs: the manifest's `jobs` and the `job` export), `ai`, `shared` (`kino.shared`, small results synced between the person's linked devices) the manifest's `enhancements` and a toggle's or select's [`unlockWith`](#a-setting-the-18-code-guards-unlockwith-apiversion-14) (Kino 0.9.74 too); from Kino 0.9.66 a stream (yours or a resolver app's) may also carry an advisory `media` and a `portable` universal copy, at any `apiVersion` (see [External resolver apps](#12-external-resolver-apps)). A higher number than Kino supports is refused with "Este plugin necesita una versión más nueva de Kino". Declare the lowest number that has what you use, so your plugin also runs on older Kino builds. |
| `entry` | Required. Relative path of the JavaScript file: letters, digits, `.`, `_`, `-` and `/` only, no `..`, at most 200 characters, ends in `.js`. The file is at most 1 MB. |
| `signature` | Optional, from apiVersion 5: `{ "authorKey": …, "value": … }`, written by `sdk/seal.mjs --sign` — your signature over the entry file. See [Signed plugins](#signed-plugins-apiversion-5-kino-0945). |
| `hosts` | Required. At least 1 entry, with no upper limit from Kino 0.9.45 (only the manifest's 16 KB bounds it); Kino 0.9.44 and older refuse more than 20, and `sdk/validate.mjs` warns "Más de 20 hosts: Kino 0.9.44 o anterior rechaza este plugin; necesita Kino 0.9.45 o superior". From apiVersion 2 it may be empty, `[]`, when the plugin has a `url` setting: see [The person's own servers](#the-persons-own-servers). Each a lowercase DNS name (`archive.org`), `*.` plus a DNS name (`*.archive.org`), or (apiVersion 2 only) an object `{ "host": "…", "insecureHttp": true }` (below). Host names only: no scheme, port or path. No bare `*`, no IP addresses, no `localhost`, nothing ending in `.local`, `.lan`, `.internal`, `.localhost` or `.home.arpa`, and at least one dot. **`*.x` covers subdomains only, not `x` itself**: if you need both, list both. |
| `capabilities` | Required. A subset of `search`, `home`, `browse`, `episodes`, `resolve`, `download`, `drm`, `channels`, `migrate`, `scopedSearch`, `meta`, `subtitles`, `tracking`, `segments`, `playlists`, `externalResolve`, `nuvio`, `syncProvider`, `socket`, `byteSource`, `storageLarge`, `catalog`, `qrScan`, `imageSource`, `screen`, `library`, `playerPanelTab`, `playerControl`, `room`, `schedule`, `ai`, `shared`. Must include `resolve` and at least one of `search` or `home` -- except a [catalog-only plugin](#catalog-only-plugins-catalogonly-kino-0954) (`"catalogOnly": true`), and a plugin that declares only `subtitles`, `tracking`, `segments`, `syncProvider`, `screen`, `library` and/or `playerPanelTab`: a [subtitle provider](#subtitles-for-any-title), a [tracker](#telling-a-tracker-what-the-person-watches-tracking-apiversion-7), a [segment source](#where-the-intro-and-credits-are-segments-apiversion-7), a sync provider or any mix of them. From `apiVersion` 13 such a plugin may also declare `socket`, `storageLarge`, `catalog` and `qrScan` (the runtime room it works with, a sync provider talking over a WebSocket for example), and from `apiVersion` 14 `room`, `schedule`, `ai` and `shared`, and `playerControl` when it also declares a `panel` (its own, or `"contributes": true` with `playerPanelTab`: a Watch Party tab; without a panel it is refused with "The \"playerControl\" capability needs a \"panel\" ..."), and stay that kind of plugin; those alone, with none of the standalone capabilities above, still need `resolve` and `search` or `home`. `search`, `home`, `browse`, `episodes` and `resolve` must each be an exported function of the entry file, or the install fails with "El plugin no carga: le falta ...". `download` and `drm` need `apiVersion: 2` and are declarative flags instead — the app acts on them, not your code, so nothing extra to export; declaring one shows its consent line ("Puede descargar videos para verlos sin conexión" / "Reproduce video protegido (DRM)") and needs approval again on an update that adds it. `download` gives your titles offline downloads (see [Downloads](#downloads-apiversion-2)); `drm` lets a `Stream` carry a Widevine license (see [A Widevine-protected stream](#a-widevine-protected-stream-apiversion-2)). `channels` needs `apiVersion: 3` and the exports `liveCategories` and `liveChannels` (see [Channels in the En vivo tab](#channels-in-the-en-vivo-tab-apiversion-3)). `migrate` needs `apiVersion: 6` and the export `migrate`; declaring it shows "Revisar lo que tienes guardado (biblioteca, historial, favoritos) para pasarlo a este plugin" and needs approval again on an update that adds it (see [Moving saved titles to your plugin](#moving-saved-titles-to-your-plugin-migrate-apiversion-6)). `scopedSearch` needs `apiVersion: 6` and `search` (refused otherwise with "La capacidad \"scopedSearch\" necesita también \"search\""); it exports nothing of its own: your `search` gets `within` when the person searches inside a "Ver más" page (see [Searching inside a "Ver más" page](#searching-inside-a-ver-más-page-scopedsearch-apiversion-6)). `meta` needs `apiVersion: 6` and the export `meta`, no consent line: your plugin describes titles other sources listed (see [Describing other titles](#describing-other-titles-meta-apiversion-6)). `subtitles` needs the export `subtitles` (see [Subtitles for any title](#subtitles-for-any-title)). `tracking` needs `apiVersion: 7` and the export `track`; declaring it shows a red line naming your hosts ("Le contará a seenr.app qué ves y cuándo lo terminas") and needs approval again on an update that adds it, even when Kino approves other updates on its own (see [Telling a tracker what the person watches](#telling-a-tracker-what-the-person-watches-tracking-apiversion-7)). `segments` needs `apiVersion: 7` and the export `segments`; declaring it shows "Agrega el botón para saltar la intro y los créditos", not in red and with no approval of its own (see [Where the intro and credits are](#where-the-intro-and-credits-are-segments-apiversion-7)). `playlists` needs `apiVersion: 10`, no consent line: the optional exports `playlists`, `playlistItems`, `playlistCreate`, `playlistAddItem`, `playlistRemoveItem` and `playlistReorder` let it host playlists of its own, each independent of the others — declaring the capability with none implemented is valid though pointless. `externalResolve` needs `apiVersion: 11`, a declarative flag like `download` and `drm` (nothing to export): it lets a `resolve()` answer (or a Stream's `alternatives`) use `{ external: { protocol, ref } }` instead of a playable `url`, so Kino hands `ref` to an independently-installed app that declares it can resolve `protocol`, rather than playing the stream itself (see [Letting another app resolve what you found](#letting-another-app-resolve-what-you-found-externalresolve-apiversion-11)). `screen` needs `apiVersion: 14`, the exports `screen` and `screenEvent` and a manifest `screen` block (`label` 1 to 20 characters, optional `labelEn`, `icon` or `iconFile`, `menuOpens` `"section"`, `"screen"` or `"both"`, `opensFrom`, `settingsButton`, `settingsIn`, `replaces`, `every`, `adult`); it may be a plugin's only capability and shows no consent line (see [Screens](#13-screens-screen-apiversion-14)). `library` needs `apiVersion: 14`: a declarative capability (no export) that lets `kino.library.watched` / `kino.library.saved` read what the person watched and saved in Kino (never 18+, never another profile, never a stream or a ref); it may stand alone or beside `screen`, needs the person's approval with a red consent line ("Podrá leer lo que has visto y guardado en Kino, y enviarlo a sus servicios") at install and on the update that adds it, and the person can switch it off in your tab in Ajustes, for the whole device and their synced devices (calls then reject with `permission_denied`). `playerPanelTab` needs `apiVersion: 14`, the export `panel` and `"panel": { "contributes": true }` (each needs the other): the plugin adds a tab to the player panel of ANY plugin's title (never an 18+ one), after Kino's own and the playing plugin's, where its `panel(context)` gets `foreign: true`, an opaque `ref` and `source: { pluginId, name }`; it may stand alone, needs the person's approval with a red consent line ("Su pestaña en el reproductor verá lo que estás viendo (título, año, identificadores y posición, o el canal en vivo) mientras la tengas abierta, y podrá enviarlo a sus servicios") at install and on the update that adds it, and the person can hide it ("Mostrar en el reproductor") or reorder it (Ajustes, "Paneles del reproductor"). `playerControl` needs `apiVersion: 14`: a declarative capability (no export) that never stands alone (beside a standalone capability it keeps the plugin standalone only with a `panel`); with it your `player` actions (`seekToMs`, `pause`: true pauses, false resumes, `speed`...) count not only right after the person's press but also from a panel result's own `player` (a `refreshMs` tick) and from a `playerEvent` answer, and a tab you contribute to another plugin's title may also pause and set the speed besides seeking. It needs the person's approval with a red consent line ("Podrá pausar, reanudar y mover tu video por sí solo") at install and on the update that adds it (never approved by Kino on its own, unticked in a kit import), and the person can switch it off in your tab in Ajustes ("Dejar que pause y mueva mi video", for the whole device and their synced devices). Kino announces each such action with a short notice naming your plugin ("Party Chat: pausado"), drops it while one of its dialogs is up or the person is seeking, keeps only pause/resume on live, and allows at most 30 a minute and one seek or pause a second (contract.json `kinoPlayerControl`). `room` needs `apiVersion: 14`: a declarative capability (no export) that never stands alone (a screen or a player-panel tab drives it); it unlocks `kino.room`, a short-lived mailbox hosted on the person's own device and reached from the Internet through the same Cloudflare quick tunnel "Recibir configuración" opens (no server of yours or Kino's): `open` gives you `words` and a 12-digit `code` (or a shorter `codeDigits`, 4 to 12) to share, others `join` with them, and everyone `send`s small JSON messages (at most 8192 bytes, 5 a second) and polls its `inbox` from a panel's `refreshMs` or a screen's `every`. `open` and `join` work only from the person's own press (`screenEvent`, `panelAction`), the traffic only while your screen or panel is open and Kino is in front. It needs the person's approval with a red consent line ("Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los mensajes de la sala a quienes entren") at install and on the update that adds it (never approved by Kino on its own, unticked in a kit import), and the person can switch it off in your tab in Ajustes ("Dejar que abra salas por internet", for the whole device and their synced devices), which closes your rooms at once. Rooms close at their TTL (at most 4 hours), when you close them, and when Kino stays 5 minutes in the background; messages are encrypted end to end with the code, never stored and never executed by Kino. The code protects a room against casual access (guessing is online only), not against the tunnel provider (Cloudflare) targeting it: keep a room's messages low-sensitivity. While the device hosts a room, Kino shows it in your tab in Ajustes with a button to close it; one plugin holds at most two of the device's three room slots. What a message means, who leads and failover are yours (contract.json `kinoRoom`). `schedule` needs `apiVersion: 14`, the export `job` and the manifest's `jobs` (each needs the other); it never stands alone (a job feeds what your screen or catalog shows). Kino runs `job(ctx)` in the background, headless, every few minutes while the person has that job switched on (each starts off), at most 20 s, 10 requests, 2 MB of answers and 256 KB written to `kino.storage` per run, 96 runs a day per plugin; its answer is ignored, so keep what you fetched in `kino.storage` and read it when your screen opens. It needs the person's approval with a red consent line ("Podrá ejecutarse en segundo plano cada cierto tiempo para actualizar sus datos, usando internet y batería") at install and on the update that adds it (never approved by Kino on its own, unticked in a kit import), and the person can switch it off in your tab in Ajustes ("Dejar que trabaje en segundo plano", for the whole device and their synced devices), choose each job's frequency among your `everyOptions`, keep it to Wi-Fi (on by default) and run it now (contract.json `kinoJobs`; `node sdk/run.mjs <folder> job <id>`). `ai` needs `apiVersion: 14`: a declarative capability (no export) that never stands alone; it unlocks `kino.ai.ask({ prompt, system?, json?, maxChars? })`, one short one-shot ask to Kino's text AI (Kilo's free models; no key, no server of yours or Kino's), which answers `{ ok: true, text, model }` or `{ ok: false, error }` (`unavailable`, `rate_limited`, `too_large`, `timeout`, `refused`) and never throws. The prompt is at most 8192 UTF-8 bytes, the system text 2048, the reply cut at `maxChars` (at most 4096, 2048 by default); at most 10 asks in any 60 s, 100 a day, one at a time, 20 s each, and for every plugin of the device together at most 300 a day and 2 at once (so plugins never starve Kino's own assistant); only from the person's own press (a settings `action`, a `panelAction`, a `screenEvent` tap or submit) or from your scheduled `job` (each ask one of the run's requests). There is no memory between asks and Kino adds no persona; `json: true` only ASKS for JSON: the text comes back as the model wrote it. **The reply is untrusted data**: a model that read titles from the web or the person's words can be steered by them (prompt injection), so validate every field against what you sent (unknown ids or categories dropped), never execute it, never follow instructions in it, and never open a URL from it unchecked. It needs the person's approval with a red consent line ("Podrá enviar texto a un servicio de IA de terceros (Kilo) para que lo resuma o clasifique; lo que envíe sale de tu aparato") at install and on the update that adds it (never approved by Kino on its own, unticked in a kit import), and the person can switch it off in your tab in Ajustes ("Dejar que use la IA de texto", for the whole device and their synced devices). What you send leaves the device: say in your own UI what you send, and keep a fallback for when it is off or unavailable (contract.json `kinoAi`; the kit answers canned text, `KINO_AI_REPLY`, `KINO_AI_ERROR`, `KINO_AI_REVOKED=1`). `shared` needs `apiVersion: 14`: a declarative capability (no export) that never stands alone, with a plain consent line, not red ("Guarda unos pocos resultados que se sincronizan entre tus aparatos vinculados"), marked new on the update that adds it and never waiting for approval: it is the person's own data on the person's own devices. An update that adds only `shared` applies without a sheet. It unlocks `kino.shared.get(key)` / `kino.shared.set(key, value)`: up to 4 JSON values per profile (64 KB each, 16 levels deep, strict JSON, 128 KB in all) that sync between the person's linked devices (only as that profile's: a TV that carries several people's profiles never hands one person's values to another's phone), both ways, last writer wins by a clock Kino assigns; `set` answers false when the value was already that one (nothing written or sent), `set(key, null)` removes it, a key's new value reaches the other devices at most once a minute and at most 4 of your keys travel a minute; `get` never throws. Typical use: a job with `"runOn": "preferPhone"` runs on the phone and writes its result; the TV's screen reads it. **Never put a secret there** (a token, a password, a cookie, a session): it is copied to every linked device; a key with a word like one (token, secret, password, cookie, session, auth, apiKey, plurals too; `author` is fine) is refused, and so is a value holding a sealed secret. **What `get` answers is untrusted**: another device wrote it, maybe with another version of your plugin, so validate its shape, sizes and fields. The values go when the plugin is removed (contract.json `kinoShared`; the kit simulates a phone and a TV: `node sdk/run.mjs --device phone <folder> job`, then `--device tv <folder> screen`, and `node sdk/run.mjs <folder> shared`). A plugin with only `library` can never read it: the reads work only from `screen`, `screenEvent`, `home`, `section` or `search`. Kino keeps nothing of an answer, but if you build Home rows from it, Kino caches that Home answer like any other. `syncProvider` needs `apiVersion: 12` and the exports `syncPull` and `syncPush` (optional: `syncStatus`), each taking one object argument: the plugin becomes the transport of the person's cross-device sync, storing an encrypted snapshot Kino hands it. Declaring it shows a consent line (in red with `sync.keySecret` or `"fetchHosts": "any"`) and needs approval again on an update that adds it; see [Sync providers](#sync-providers-syncprovider-apiversion-12). `socket` needs `apiVersion: 13`, a declarative flag (nothing to export): it unlocks `kino.ws`, outbound WebSockets to your declared hosts. `byteSource` needs `apiVersion: 13` and the export `read`: a stream may then be `{ source: "plugin", handle, size, mime }` and Kino pulls its bytes from your `read` (see [Sockets and plugin-served bytes](#sockets-and-plugin-served-bytes-socket-and-bytesource-apiversion-13)). `storageLarge` needs `apiVersion: 13`, a declarative flag (nothing to export, no consent line): `kino.storage` then holds 16 MB in total (2 MB per value) instead of 256 KB, for a plugin that keeps a catalog (see [A bigger storage for a catalog](#a-bigger-storage-for-a-catalog-storagelarge-apiversion-13)). `catalog` needs `apiVersion: 13`, a declarative flag (nothing to export, no consent line): it unlocks `kino.catalog`, a searchable SQLite catalog of up to 100,000 items (in a 64 MiB file: about 670 bytes per item on average) in one database file for your plugin alone (see [Catalog (SQLite)](#catalog-sqlite-kinocatalog-catalog-apiversion-13)). `qrScan` needs `apiVersion: 13`, a declarative flag (nothing to export, no consent line): it unlocks `kino.qr.scan`, the phone's camera scanner opened for your plugin (see [QR scanning](#qr-scanning-kinoqrscan-qrscan-apiversion-13)). `imageSource` needs `apiVersion: 13` and the export `image`, no consent line: a `poster`, `backdrop`, `still` or section hero `image` may then be `{ source: "plugin", handle }` and Kino asks your `image` for the picture's bytes (see [Images from the plugin](#images-from-the-plugin-imagesource-apiversion-13)). |
| `settings` | Optional. What the person fills in on your plugin's "Configurar" screen: see below. |
| `permissions` | Optional. A list of names from the closed list in `contract.json`. **The list is empty in this version**: any name is refused with "unknown permission: …". It exists so a later version can add permissions (each one shown on the consent screen) without a new `apiVersion`. |
| `color` | Optional `#RRGGBB`: the accent of your plugin's tab and chips. A neutral color by default. |
| `icon` | Optional relative path to a square `.png`, at most 128 KB. An icon that is missing or too big is skipped without failing the install. |
| `discoverable` | Optional `true` or `false` (default `true`), at every `apiVersion`. `false` keeps the plugin out of Kino's community search (see [Get found](#get-found)); people can still install it by typing its address. Any other value is refused with "The \"discoverable\" field must be true or false". |
| `categories` | Optional, at every `apiVersion`: what your plugin offers, for the category chips of Kino's plugin marketplace (Recomendados, "De la comunidad", "Elige tus plugins"). A list without repeats of `movies`, `series`, `anime`, `live`, `radio`, `subtitles`, `utilities`, `adult`. When present it replaces Kino's guess from your capabilities (`channels` is `live`, `episodes` is `series`, anything that lists and plays is `movies`); an `adult` plugin's chip only shows while the person's 18+ code is unlocked. Any other value is refused with "The \"categories\" field must be a list without repeats of: movies, series, anime, live, radio, subtitles, utilities, adult". This field is only the marketplace tag; the apiVersion 6 `categories()` export is a different thing (tiles of content inside Kino's Categorías), see [Your own categories](#your-own-section-categories-and-colors-apiversion-6). |
| `catalogOnly` | Optional `true` or `false` (default `false`), at every `apiVersion`, from Kino 0.9.54 (older Kino ignores it). `true` says the plugin lists and describes titles but plays none: `resolve` is no longer required, and Kino never calls it. See [Catalog-only plugins](#catalog-only-plugins-catalogonly-kino-0954) for the rules and how to stay installable on older Kino. Any other value is refused with "The \"catalogOnly\" field must be true or false". |
| `externalResolver` | Optional, from `apiVersion` 11, and only with the `externalResolve` capability (otherwise the manifest is refused: `The "externalResolver" field needs the "externalResolve" capability`): `{ "package": "com.example.resolver", "apk"?: { "url": "https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.apk", "sha256": "<64 hex characters>", "label"?: "…" }, "fdroid"?: true, "downloader"?: { "code": "<3 to 10 digits>" } }`. `package` is the one resolver app this plugin wants its [`external` answers](#12-external-resolver-apps) handed to; with it set, no other app is ever asked, whatever else declares the protocol (a stream's own `external.resolver` overrides it). `apk`, `fdroid` and `downloader` are optional and independent ways to get that app when it is not installed (see [§12](#12-external-resolver-apps)): `apk` is where Kino may download it. Only a GitHub release asset (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`) or an archive.org file (`https://archive.org/download/<item>/<file>`) is accepted (https, no query), at most 300 MB, and the downloaded file must have exactly that `sha256` or nothing is offered; `label` is the app's name for the person (at most 40 characters). Anything malformed refuses the manifest (`The "externalResolver" field must be an object with a "package" (an Android package name) and, optionally, an "apk" with a GitHub release or archive.org "url" … and a 64-character hex "sha256"; "fdroid" may only be true and "downloader" an object with a "code" of 3 to 10 digits`). Older Kino ignores the field. |
| `sync` | From `apiVersion` 12, required with the `syncProvider` capability and only with it (without it the manifest is refused: `The "sync" field needs the "syncProvider" capability`; a provider without it or without `keySecret`: `The "syncProvider" capability needs a "sync" field whose "keySecret" is the key of one of the plugin's own "password" settings`): `{ "mode"?: "poll" \| "realtime", "pullEveryMs"?: 600000, "pushDebounceMs"?: 300000, "maxBlobBytes"?: 4194304, "keySecret": "<setting key>", "provision": ["<setting key>", …] }`. `mode` defaults to `poll`; `realtime` lets the provider call `kino.sync.remoteChanged()`. The times are positive whole milliseconds that Kino clamps to its own floors. `maxBlobBytes` is the largest blob the provider accepts (default and maximum 4194304, 4 MiB) and also sets how big `syncPull`/`syncPush`'s `kino.fetch` requests, responses and answers may be (ceil(maxBlobBytes × 4/3) + 64 KB). `keySecret` is the `key` of one of your own `"password"` settings, without a `"default"`, from whose value Kino derives the sync key (refused otherwise: `The "keySecret" of the "sync" field must be the key of one of the plugin's own "password" settings`, `The setting the "keySecret" of the "sync" field names must not have a "default"`); so the plugin and its service CAN read the synced data. `provision` lists at most 8 different keys of your own settings that hold a value (not a section, status or action) that pairing hands to another device, and must include `keySecret` (`The "provision" of the "sync" field must include its "keySecret"`). Anything malformed refuses the manifest. Older Kino ignores the field. What each one means: [Sync providers](#sync-providers-syncprovider-apiversion-12). |
| `nuvioRepos` | Optional, from `apiVersion` 11 (Kino 0.9.71), and required with the `nuvio` capability (each needs the other; otherwise the manifest is refused: `The "nuvioRepos" field must list 1 to 4 GitHub repositories (owner/repo) or https addresses of a Nuvio manifest, and goes with the "nuvio" capability, which needs it`). 1 to 4 Nuvio repositories, each a GitHub `owner/repo` or the https address of its `manifest.json`; `kino.nuvio` refuses any other repository with `not_allowed`. The capability is declarative (the person approves "Installs and uses Nuvio scrapers from the repository it names to look for links"). Experiment: a plugin asks Kino to install and ask the scrapers of those repositories for a title (`kino.nuvio.available`, `use`, `scrapers`, `streams`) and sorts and merges what they find. Guide: <https://kinotvapp.github.io/kino-plugins/en/nuvio-plugins/>; types in `kino.d.ts`; the Node kit answers `kino.nuvio` from a fixture (`KINO_NUVIO_FIXTURE`, `docs/plugins/fixtures/kino-services/`). |
| `debug` | Optional `true` or `false` (default `false`), from `apiVersion` 6; ignored below. Since Kino 0.9.50 **every installed plugin** (yours, a generated Stremio addon, a Nuvio scraper) has a **"Modo debug"** switch in its own tab in Ajustes, whatever its manifest says: on, every failed call of the plugin shows a panel on screen (the function, the error code, the technical message, the JavaScript stack and your last `kino.log` lines) and the tab gets a "Registro" page with the last 200 events and buttons to copy (and, on the phone, share) them; off, nothing is shown or kept. This field only sets the switch's **default**: `true` turns it on for everyone who installs the plugin until they switch it off; without it the switch starts off and the person turns it on when they want to send you a screenshot of the panel or their Registro. The person's own choice, once they touch the switch, is kept across updates (an update that adds or drops `debug` only moves the default of someone who never touched it) and syncs to their other devices. The Registro is kept in a private file on the device, so it survives a restart; it is never synced or backed up, and it is cleared when the switch goes off or the plugin is uninstalled. Secrets, and the person's own passwords, are redacted there like everywhere else. `validate.mjs` notes what `true` means. Any other value is refused with "The \"debug\" field must be true or false". |
| `telemetry` | Optional `true`, `false` or `"verbose"` (default `false`), from `apiVersion` 6; ignored below. Asks to share your plugin's diagnostic `kino.log` lines with Kino's error tracker when a call fails, whatever repository the plugin comes from, and turns on [`kino.log.report`](#kinologargs). The consent sheet says "Comparte con Kino registros de errores y datos técnicos de algunas reproducciones para corregir fallas" (English: "Shares error reports and technical data from some playbacks with Kino to fix problems"): besides failures, it also sends a small sample of [playback summaries](#playback-metrics-and-problem-reports) of plays that went well (numbers and Kino's own words only) -- only under a consent given to this wording: a plugin installed before Kino 0.9.54 sends failures only until the person approves an update sheet that shows the line (marked "nuevo" there; an update is never held back for it) or turns the switch back on. From Kino 0.9.54 your plugin's tab in Ajustes has an "Enviar registros de errores y de reproducción" switch, on by default and synced across the person's devices, that turns the sending off (older builds always send the lines of a plugin that declares it). A plugin that does not declare `telemetry` never sends a log line. An update that newly declares it waits for the person's approval, like a new host. Every line is scrubbed as described under [`kino.log`](#kinologargs). `"verbose"` shares everything `true` does plus [playback metrics](#playback-metrics-and-problem-reports) of plays that went well (a sample), live and cast problem reports and edge cases (a re-resolve, a failover, a decoder switch, a sign timeout, `migrate` results, settings synced from another device), at most 60 events per plugin until Kino restarts and one a minute per area; its consent line is "Comparte registros detallados de reproducción y errores con Kino para corregir fallas", and an update from `true` (or nothing) to `"verbose"` waits for the person's approval, while `"verbose"` to `true` applies silently. Any other value is refused with "The \"telemetry\" field must be true, false or \"verbose\"". |
| `section` | Optional `{ "label": "…" }`, from `apiVersion` 6 (label 1 to 20 characters); ignored below. Gives your plugin its own section and requires the `section` export: see [Your own section, categories and colors](#your-own-section-categories-and-colors-apiversion-6). |
| `theme` | Optional object, from `apiVersion` 6; ignored below. Up to five `#RRGGBB` colors: `accent`, `onAccent`, `background`, `surface`, `highlight`; any other key is refused with "The \"theme\" field has an unknown color". The manifest only checks the format; the guardrails run when Kino uses the colors (below). |
| `fetchHosts` | `"fetchHosts": "any"`: your `kino.fetch` may reach **any public host over https on the default port (443)**, for scrapers whose sites or extractor redirects rotate domains. Kino honors it on a plugin written by hand **from `apiVersion: 9` (Kino 0.9.55)**, and on the manifests it makes when it converts a Nuvio scraper. The person approves it on the consent sheet in red ("Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)"; in English "Can connect to any public server on the internet (https only, never your home network)"); an update that newly adds it waits for that approval again. From Kino 0.9.55 a host reached only through it (not in your `hosts`, not a server the person typed) must be `https` on port 443, a public IPv4 address or a name with a dot (a single-label name such as `router` is refused), on every redirect hop (a redirect that names `http://` on the default port is followed over `https://` instead, from the Kino after 0.9.72: nothing is ever sent in the clear; any other port is refused); never the home network (private, local or LAN addresses, a name that resolves into the LAN). Those requests also spend a budget on top of the per-call limit: at most 60 a minute to one site (a domain and its subdomains together) and 600 every 10 minutes in all, refilled continuously and kept for the whole app (250 and 2,500 for a plugin converted from a Nuvio scraper); over it the fetch fails with `rate_limited` at once. Your declared `hosts` keep their own rules (an `insecureHttp` host still takes `http`, a declared host any port) and never spend that budget, so **declare your primary sites** and keep the grant for the mirrors you cannot list; a sealed secret still only goes to your declared `hosts` over https. A converted Nuvio scraper declares every host its code names, `insecureHttp` for the ones it names with `http://`. The hidden page under the grant: see [`kino.browser.capture`](#kinobrowsercaptureurl-options-apiversion-6). In the Node kit the budget is always the hand-written one (60 / 600, it does not scale for Nuvio) and its site grouping (the last two labels) is stricter than the app's public suffix list. `kino.fetchAnyHost` (Kino 0.9.55) is `true` when it is active for this install. Below apiVersion 9 a hand-written plugin's copy is ignored: `kino.fetch` stays on your `hosts`, and `sdk/validate.mjs` warns "fetchHosts only takes effect on plugins converted from Nuvio or, on one written by hand, from apiVersion 9 (Kino 0.9.55); in your plugin it is ignored". From `apiVersion: 4` its only value is `"any"`; any other is refused with "The \"fetchHosts\" field only takes \"any\"". Below apiVersion 4 it is ignored. |
| `screen` | apiVersion 14, required with the `screen` capability: the menu entry and the options of the plugin's full-screen canvas, `{ "label": "Noticias", "labelEn": "News", "icon": "list", "menuOpens": "screen" }`. Every field and rule: [The manifest's `screen` block](#the-manifests-screen-block). |
| `jobs` | apiVersion 14, required with the `schedule` capability and refused without it: 1 to 3 background jobs, each `{ "id": "refresh", "label": { "es": "Actualizar noticias", "en": "Refresh news" }, "everyMin": 60, "everyOptions": [15, 30, 60, 180, 720, 1440] }`. `id` is 1 to 24 characters (`a-z`, `0-9`, `-`), unique; `label.es` 1 to 40 characters (`en` optional, the same limit; control and bidirectional characters are dropped); `everyOptions` 1 to 6 different whole minutes from 15 (Android's floor for periodic work) to 1440; `everyMin`, the default, one of them. `runOn` (optional): `"any"` (the default: every device that has the plugin runs the job, for its own `kino.storage`) or `"preferPhone"`: ONE of the person's linked devices runs it, a linked phone first (a TV never runs it while a phone that ran it successfully within two of its periods can); with no phone, or no successful run on the phone for two periods, the device that has the plugin (the TV) runs it itself. Write its result with `kino.shared` so the other devices read it, and read `kino.device` in the job to do a lighter batch on a TV. The person may pick "Hacer el trabajo en: Este aparato" instead. Kino draws its own rows for each job in your tab in Ajustes (switch, frequency, last run, "Ejecutar ahora"); you draw nothing. |
| `enhancements` | Optional, read from the Kino of apiVersion 14 (older Kinos ignore it, like any other key they don't know): features of a newer `apiVersion` offered **without raising yours**, so everyone on an older Kino keeps installing and running your plugin as before. Keyed by the apiVersion that brought the feature: `"apiVersion": 8, "enhancements": { "14": { "capabilities": ["screen", "library"], "screen": { "label": "Inicio" } } }`. A Kino that knows the key adds those `capabilities` (only `screen`, `library`, `playerPanelTab`, `playerControl`, `room`, `schedule`, `shared` and `ai`), replaces `screen`, `settings` (the whole list), `panel` and `jobs` (the `schedule` capability's jobs, which only a block brings: a top-level `jobs` below apiVersion 14 is never read) with the block's, and checks the result at that apiVersion with the same rules as the plain fields. Your plugin is **never refused** because of an enhancement: a block is dropped and logged (your plugin runs as its own manifest says) when it fails those rules, when its key is at or below your own `apiVersion` (declare a feature once), when its `settings` change the type of a setting your manifest declares (keep the list a superset of yours: values sync by key with devices on an older Kino), when its `screen.replaces` names Categorías your own apiVersion lacks, or when your script lacks an export the block newly needs (`screen`/`screenEvent`, `settingsStatus`/`action`). A key above the Kino's apiVersion is ignored. Your `apiVersion` never moves, so nothing else changes behaviour; the JS stays one file (an older Kino just never calls `screen`/`screenEvent`). The red lines of `library`, `playerPanelTab`, `playerControl`, `room`, `schedule` and `ai` are asked at install and on the update that adds them, as always, never approved by Kino on its own (`shared` is a plain line); their features follow the block (`featureApiVersion`): your jobs run, `kino.shared` and `kino.ai` exist only on a Kino that read it; until the person approves it `kino.library` calls reject with `permission_denied` (someone who installed your plugin on an older Kino and then updated Kino is asked only with your next version), so catch that and work without it. `node sdk/validate.mjs` reports every block Kino would drop as a problem. |
| `description`, `author`, `homepage` | Optional strings. Trimmed and cut to 300, 60 and 200 characters. Kino shows the name, author, version and description when it asks the person to install. |

Other keys are ignored. `hosts` does three jobs: it is what the person approves, it is the only set
of sites `kino.fetch` can reach, and it is the set a `Stream`'s URLs must be on: the video, its
subtitles, its `audioTracks` and a `drm` block's `licenseUrl` (besides the person's own server).

### Settings

`settings` is a list of at most 12 entries that hold a value (plus, from apiVersion 6, at most 16 that
only show or do something: see "The settings form" below). Each one becomes a field on the plugin's "Configurar"
screen (Ajustes ▸ Plugins), and your code reads its value with `kino.config.get(key)`:

```json
"settings": [
  { "key": "server", "label": "Servidor", "type": "url", "required": true, "hint": "http://192.168.1.10:8096" },
  { "key": "user", "label": "Usuario", "type": "text", "required": true },
  { "key": "password", "label": "Contraseña", "type": "password", "required": true },
  { "key": "quality", "label": "Calidad", "type": "select", "default": "hd",
    "options": [{ "value": "hd", "label": "Alta" }, { "value": "sd", "label": "Normal" }] },
  { "key": "subs", "label": "Subtítulos", "type": "toggle", "default": true }
]
```

<!-- contract:settings:start -->
| type | value | can be `required` | can have a `default` | longest value |
| --- | --- | --- | --- | --- |
| `text` | text | yes | yes | 500 characters |
| `url` | text | yes | no (use `hint` for an example) | 2,048 characters |
| `password` | text | yes | yes | 500 characters |
| `toggle` | `true` / `false` | no (always has a value) | yes | — |
| `select` | one of the `options` values | no (always has a value) | yes | — |
| `list` | a list of entries, each an object of the list's `fields` | yes | no | — |
| `section` | none (apiVersion 6) | no (holds no value) | no | — |
| `status` | none (apiVersion 6) | no (holds no value) | no | — |
| `action` | none (apiVersion 6) | no (holds no value) | no | — |
| `qr` | none (apiVersion 13) | no (holds no value) | no | 512 characters |
| `link` | none (apiVersion 12) | no (holds no value) | no | — |
| `help` | none (apiVersion 12) | no (holds no value) | no | — |
<!-- contract:settings:end -->

- `key` matches `^[a-z][a-zA-Z0-9_]{0,31}$` and is unique; `label` is 1 to 40 characters; `hint`
  (the example under the field) at most 80; a `section`'s `hint` (its explanation, which wraps on
  screen) up to 300 characters (apiVersion 6). **Builds before Kino 0.9.51 refuse a section `hint`
  over 80 characters**, so keep it short if your plugin must install on them.
- `select` needs `options` (1 to 20, each a `value` and a `label` of at most 40 characters); its
  `default` must be one of the values. A `toggle` default is `true` or `false`.
- `list` (apiVersion 4) is a list the person builds with an "Agregar" button: each entry is a
  text line with an "Editar" button, and the dialog to add or edit one shows the list's `fields`
  (1 to 4, each with a `key`, `label`, a `type` of `text` or `url`, and optionally `hint` and
  `required`; no `default`). `max` (1 to 50, default 20) caps the entries. `kino.config.get(key)`
  returns an array of objects `{ [field.key]: string }`, trimmed, without all-blank entries; an
  empty list is `undefined`. A `required` list needs at least one entry. The `url` fields of the
  entries become hosts your plugin may reach, exactly like a `url` setting (so `hosts` may be `[]`).
  ```json
  { "key": "sources", "label": "Direcciones", "type": "list", "max": 30,
    "fields": [ { "key": "url", "label": "Dirección", "type": "url", "required": true },
                { "key": "category", "label": "Categoría", "type": "text" } ] }
  ```
- **A `url` setting has no `default`**: a server the person types becomes a host your plugin may
  reach, so only the person can choose it. A manifest with a `default` on a `url` setting is
  refused; put an example address in `hint` instead.
- **A `required` setting with no value** stops every call to your plugin before it runs: the plugin
  shows "Falta configurar", its Home rows are not asked for, and anything the person opens from it
  says "Configura <name> en Ajustes ▸ Plugins" with a button to that screen.
- **Passwords** are stored encrypted on the device. Your code can read them (it has to send them),
  which is why the consent screen says "Este plugin usa tu usuario y contraseña". Kino never writes
  any setting to its log; do not do it yourself.
- **Changing any setting** closes your plugin's sandbox, deletes its cookies and its cached Home
  rows, so the next call starts a new session with the new values. `kino.storage` is **not** cleared:
  if you keep a token there, key it by the user and server it belongs to (the cookbook does).
- Uninstalling deletes the settings, passwords included.

#### The settings form and its own tab (apiVersion 6)

Every installed plugin that is enabled gets **its own tab in Ajustes** (phone and TV), named after the
plugin, with its "Modo debug" switch (see `debug` in [the manifest](#3-the-manifest)); when it has `settings` the tab
holds their form too, and Plugins ▸ Configurar opens the same form. From `"apiVersion": 6` the
form can also show and do things, with three types that hold no value (never in `kino.config`, never
`required`, no `default`), at most 16 of them on top of the 12 valued settings (from `"apiVersion": 13` a fourth, `qr`,
counts among them):

```json
"settings": [
  { "key": "account", "label": "Tu cuenta", "type": "section", "hint": "Opcional: sin cuenta usas la sesión anónima" },
  { "key": "email", "label": "Correo", "type": "text" },
  { "key": "password", "label": "Contraseña", "type": "password" },
  { "key": "linked", "label": "Estado", "type": "status" },
  { "key": "logout", "label": "Cerrar sesión", "type": "action", "confirm": "¿Cerrar la sesión de esta cuenta?" }
]
```

**English texts (apiVersion 9, Kino 0.9.55).** Any setting may add `labelEn` and `hintEn`, an `action` with `confirm` also
`confirmEn`, a select's option `labelEn`, a list field `labelEn`/`hintEn`, and the manifest's `section` a `labelEn`.
Same limits as the base field. Kino shows them when the app is in English; the base texts stay the Spanish default
and the fallback for anything without a variant. Below `apiVersion` 9 the keys are unknown and ignored (never checked). Your code
never sees them (keys and values do not change with the language).

- `section`: a heading; `hint` is its explanation.
- `status`: a read-only line. Kino calls your `settingsStatus()` when the form opens (10 s) and shows
  the text you return under that key: `{ linked: "Vinculada como ana@…" }` (at most 200 characters).
  Until it answers the line reads "Cargando…"; a missing key or a value that is not a text shows
  "Sin información"; a timeout or an error shows "No se pudo consultar". The rest of the form keeps
  working either way. **Required export** when a `status` setting exists.
- `action`: a button. Kino calls your `action(key)` (30 s), one action at a time (the other buttons
  and Guardar wait), and shows the `message` you return (at most 300 characters) or "Listo"; if it
  throws or times out, the person sees the error text instead. Kino asks `settingsStatus()` again
  after every action (and when the form opens), so the status lines describe what it just did; `refresh: true` is
  still accepted and changes nothing. `confirm` (1 to 120 characters) asks first, with Cancelar focused. **Required export** when
  an `action` setting exists.

  An action may also **forget settings of your own** with `clearSettings`: up to 12 keys of your
  declared valued settings (`text`, `url`, `password`, `toggle`, `select`, `list`). After the action
  returns, Kino empties them exactly as if the person had emptied the fields and pressed Guardar (a
  `password` also leaves the Keystore), closes your sandbox and forgets cookies and cached Home rows
  as for any saved change (`kino.storage` survives), reloads the form and asks `settingsStatus()`
  again; your `message` is still shown. It is how a "Cerrar sesión" button stops the next expired
  token from signing the person in again with the saved account. Only the action's own plugin is
  ever touched. An entry that is not a string, is unknown, names a `section`/`status`/`action`,
  names a `required` setting (clearing it would make every later call fail), repeats, or comes
  after the twelfth is dropped with a log line (`run.mjs` shows `[dropped by Kino]`); a value that
  is not an array is ignored. An action that throws or times out clears nothing.

  ```js
  export async function action(key) {
    if (key === "logout") {
      await api.logout();                       // tell the server first: a throw here keeps the saved account
      return { message: "Sesión cerrada", clearSettings: ["email", "password"] };
    }
  }
  ```
  (`email` and `password` must be optional settings here; mark the account `required` only if the
  plugin cannot work signed out.)
- `qr` (apiVersion 13): a QR code drawn on the form, on the device (nothing goes to a network to draw it). Its text is
  what your `settingsStatus()` returns under that key, like a status line, but kept whole: 1 to 512 characters with no
  control character; an `http`/`https` address only https on a public host (never the home network); any other text
  (an app link such as `exampleapp://login?token=…`, a pairing code) is drawn as it is. A longer text, a non-text or one that
  holds one of your sealed secrets draws no QR, and a `qr` with no text draws nothing at all (no label, no placeholder line). Kino asks `settingsStatus()` when the
  form opens, after every action and, with `"refreshMs"` (2000 to 60000; only a `qr` setting has it), every that many ms
  while the form is on screen and the app in front (a refresh never starts while the previous call is still running,
  and the QR on screen stays up until the new text replaces it). That is how a login code that expires every 30 s stays
  scannable, and how a status line next to it turns into "Listo" once the code was used: see
  [QR scanning](#qr-scanning-kinoqrscan-qrscan-apiversion-13). **Required export:** `settingsStatus`.
- `validateSettings(values)` (optional, 20 s) runs **before** Kino saves. `values` holds only the
  valued settings: strings trimmed, toggles as booleans, lists as arrays of objects. Return `null` to
  accept; `{ password: "La contraseña no es correcta" }` to refuse with that text under the field
  (at most 200 characters); or a text to refuse with a general message. A key that is not one of your
  valued settings also refuses, its text shown as the general message. Nothing is saved on a refusal
  and the person keeps what they typed. If it throws, times out or answers something Kino cannot
  read (an array, a number…), nothing is saved either, and the form offers **"Guardar sin
  comprobar"**; that button is offered only then, never after a refusal with messages.
- Texts you return are shown after Kino removes any of your stored secrets from them.
- **Hiding items (`hide`, apiVersion 13, additive).** Your `settingsStatus()` answer may carry `hide`: a list of keys of
  your own settings that the form (phone and TV) does not draw while that answer is current, for example the sign-in
  button, its QR and the password step once the person is signed in, or "Cerrar sesión" while signed out. Their
  stored values stay and nothing is deleted; they still count for the form's own rules (a `required` one you hide still
  blocks Guardar). Unknown keys and non-strings are ignored, at most 32 entries are read, and a failed answer hides
  nothing. Below apiVersion 13 the key is ignored.

  ```js
  export async function settingsStatus() {
    if (signedIn()) return { status: "Conectado", hide: ["qr_login", "login_qr", "tg_password", "check_password"] };
    return { status: "Falta iniciar sesión", hide: ["logout"] };
  }
  ```
- These three exports run even while a `required` setting is still empty, so a status line can say
  what is missing. Saving any setting closes your sandbox, as described above; `kino.storage` survives.

Try them with the kit (it prints what the app would keep): `node sdk/run.mjs . settingsStatus`,
`node sdk/run.mjs . action logout`, `node sdk/run.mjs . validateSettings '{"email":"ana@x.co"}'` (or `node sdk/validate.mjs . --run …` with the same arguments, which also says what Kino shows and flags a call it never makes)
(`--raw` prints your answer untouched). The kit does not apply the app's secret scrubbing, and `validateSettings` receives exactly the JSON you type: the app sends only valued settings, trimmed. A working example is `plugins/sdk/test/settings-demo`.

#### Configuration aids: `link` and `help` (apiVersion 12)

Two setting types help the person configure your plugin. Neither holds a value (never in
`kino.config`, never required, no default), and both count among the sections, statuses and actions.

- **`link`** — `{ "key": "botfather", "type": "link", "label": "Abrir @BotFather", "labelEn": "Open @BotFather", "url": "https://t.me/BotFather" }`.
  A button that opens `url` through the system **only when the person taps it** (on a phone,
  `https://t.me/...` opens the Telegram app when it is installed). Kino shows its own "Abrir enlace"
  and the host under the button, makes no request to that host, and does not count it as a network
  access of your plugin. On a TV (usually without a browser) the tap shows the address as text and
  as a QR to open on a phone. `url` must be `https://`, without user info, at most 2048 characters;
  `label` is required. An address that holds one of your stored secrets is not shown. There is no
  other way for a plugin to have Kino open an address.
- **`help`** — `{ "key": "steps", "type": "help", "title": "Cómo crear el bot", "titleEn": "How to create the bot", "body": "1. ...\n2. ...", "bodyEn": "1. ...\n2. ..." }`.
  A small button ("Ayuda" / "Help", or your own `label`) that opens a modal with your instructions,
  titled with your plugin's name. Plain text only: newlines are kept, markup is shown literally,
  nothing in it is clickable (use a `link` for an address). `title` at most 60 characters, `body` at
  most 2000 (`body` or `bodyEn` is required); a missing Spanish or English text falls back to the
  other; the text is scrubbed of your secrets. On a TV it scrolls with the D-pad, focus starts on
  Cerrar and Back closes it.

A link's label and a help's label, title and body may not hold control characters (a body keeps its
line breaks), invisible formatting or direction overrides; the manifest is refused otherwise. Kino
opens the canonical form of a link's address (host in lower case), the same one it names.

At most 4 links and 4 helps per plugin. Older Kino builds refuse apiVersion 12, so a plugin that uses
them declares `"apiVersion": 12`.

#### Settings for one kind of device (`devices`, apiVersion 12, additive)

Any settings item (a field, a section, a status, an action, a link or a help) may say which devices
draw it: `"devices": ["phone"]`, `["tv"]` or both; without it the item shows everywhere. It is only
about drawing: on a device it leaves out, the form neither draws nor checks the item (a hidden
`required` field never blocks Guardar there), but its value is still stored, saved back unchanged,
synced to the person's other devices, handed over by `sync.provision` and read by your code through
`kino.config`. Use it for setup a TV cannot do well, like a token pasted on the phone: Sync-Gram and
Sync Servidor draw their setup only on the phone, and the TV receives the values with "Recibir
configuración" ("Receive settings"). An unknown device, an empty list or a repeated one refuses the manifest
(`"devices" of the setting "<key>" must be a list of different devices: "phone", "tv"`); below
apiVersion 12 the key is ignored. The Node kit renders no form: `validate.mjs` only checks the field.

An `action` may also say `"linkOnly": true` (apiVersion 12): it is never drawn on any device and runs
only as the `confirm` of another action's [`link`](#linking-is-this-you-actionlink-kino-0974-additive), after Kino's own question. A
"find, then confirm" pair then shows the person one button (Sync-Gram's *Verificar mensaje en el
chat*); without it the confirm action is a second button. `linkOnly` on anything but an action, or not
a boolean, refuses the manifest.

A `password` may say `"sync": false` (apiVersion 13) to stay on the device where the person typed it:
use it for a value that only makes sense once, on one device, such as a two-step verification password
your plugin sends right away and then clears (`clearSettings`). Without it a password reaches the
person's paired devices, sealed end to end, like every other password. With it the value is never sent
to a paired device, a value another device sends never sets or clears it, and it is in no backup and no
kit. A sync provider's `sync.provision` may still name it, for a one-shot secret handed to one new device
([Handing the settings to another device](#handing-the-settings-to-another-device-provision)); it can never
be the `sync.keySecret` (refused: `The "keySecret" of the "sync" field can't name a setting with "sync": false`). Your plugin
reads it and clears it as any password. A `text` setting may say `"sync": false` too, for a value that
must stay on the device but is no secret to hide, such as a phone number the person types to sign in on
that device: it is drawn as a plain text field (nothing masked) and kept exactly like a device-only password
(never synced, never in a backup or a kit), and it may not appear in `sync.provision` (refused: `The
"provision" of the "sync" field can't name a text setting with "sync": false`). `sync` on any other type,
or not a boolean, refuses the manifest; below apiVersion 13 the key is ignored.

```json
{ "key": "tg_password", "label": "Contraseña de verificación", "type": "password", "sync": false }
```

#### A setting the 18+ code guards (`unlockWith`, apiVersion 14)

A `toggle` or a `select` may say `"unlockWith": "adultCode"`: before the person moves it **away from its
`default`** (a toggle off its default, a select to any other option), Kino asks the device's 18+ code with
its own prompt (the «Código» field of Ajustes on the phone, the padlock's keyboard dialog on a TV; while the
default code still rules, the prompt says so, as every 18+ prompt does). The change applies only once the
code is right; a wrong code says «Código incorrecto» and keeps the old value, and Cancelar or Back leave the
control as it was. Moving it back **toward** the default never asks. Your plugin never sees the code, and
giving it unlocks nothing else (no 18+ entry shows because of it). Use it for a filter the person should not
switch off on a whim, like the news example's «No mostrar noticias +18» (default on).

It works in Kino's settings form wherever it is drawn: your tab in Ajustes, and a screen's or a panel's
[`settings` node](ui.md#settings-node). Your own code may only move the setting toward its default: an
answer's `config` that moves it away is dropped (`is locked (unlockWith adultCode): only the person moves it
away from its default, in Kino's settings form`), an action's `setSettings` that does is refused whole, and a
field may not `bind` it (`bind "<key>" is locked (unlockWith adultCode): show it in a settings node`): show
it with `{ "type": "settings", "keys": ["<key>"] }`. The value syncs to the person's other devices like any
setting (and travels with «Enviar a otro aparato»); the code is asked on each device at the moment of the
change. `unlockWith` on any other type, or a value other than `"adultCode"`, refuses the manifest (`Only a
setting of type toggle or select has "unlockWith" ("<key>")`, `"unlockWith" of the setting "<key>" must be
one of: adultCode`); below apiVersion 14 the key is ignored. The Node kit renders no form: `validate.mjs`
checks the field and `run.mjs` applies the same `config`, `bind` and `setSettings` rules.

```json
{ "key": "hideAdult", "label": "No mostrar noticias +18", "labelEn": "Hide 18+ news", "type": "toggle", "default": true, "unlockWith": "adultCode" }
```

#### Filling your own settings (`setSettings`, Kino 0.9.74, additive)

An action may also **fill settings of your own** with `setSettings`: up to 8 keys of your `text`
or `select` settings, each with a string value. It is how a "Vincular" action stores the chat
it found, so the person types nothing. Kino trims each value, checks it like a typed one (length, one of
the options) and saves the values through the form's own Guardar: they reach
the person's other devices and stay in the profile in use like typed values, and your sandbox
closes as for any saved change.

```js
return { message: "Vinculado", setSettings: { chatId: String(chat.id) } };
```

Never a `url` (its value becomes a server your plugin may reach, so only the person types one),
a `toggle`, a `list` or a `section`/`status`/`action`, and a `required` setting is never emptied
this way. A `password` only from `apiVersion` 13 (below it the whole field is refused, as before). Kino does **not**
run your `validateSettings` on these values (you chose them), and it refuses a value that contains
one of your stored secrets instead of copying it into a plain, synced setting. An unknown or
secret key, a value that is not a string or fails its check, a key that is also in `clearSettings`,
a value that holds one of your stored secrets, or more than 8 keys refuse the **whole** field:
nothing is applied, your `message` still shows and Kino adds its generic error under it. It works
from your settings form (any action, including the `confirm` action of a [link](#linking-is-this-you-actionlink-kino-0974-additive)).

**A password (`apiVersion` 13).** An action may fill one of your own `password` settings, for a key
your plugin makes up instead of asking the person to type one (a "Crear clave" action that writes
32 random bytes as hex into the setting a sync provider's `sync.keySecret` names):

```js
return { message: "Clave creada", setSettings: { syncKey: kino.crypto.randomBytes(32) } };   // 64 hex characters
```

Kino stores it exactly like a typed password: sealed in the Keystore, synced sealed end-to-end to
the person's other devices (or kept on this device only when the setting says `"sync": false`), and
masked in the form. It is never logged, and every password value your answer names is scrubbed from
that same answer's `message` and `link`, so it is never shown back on the page. The usual rules
apply (at most 500 characters, a `required` one never emptied, a value holding another of your
secrets refused). Only an action the person ran fills a setting: a `settingsStatus` answer is never
read for `setSettings`.

#### Linking: "Is this you?" (`action.link`, Kino 0.9.74, additive)

Use it when an action finds **who** to link and the person must say it is them, for example a
[sync provider](#sync-providers-syncprovider-apiversion-12) whose bot reads the latest message ("write something to your bot")
and finds `@ana`. Your plugin never links on its own: it answers a candidate, and Kino asks.

```js
export async function action(key) {
  if (key === "findMe") {
    const who = await bot.latestSender();          // null while nobody wrote yet
    if (!who) return { message: "Escribe algo a tu bot y vuelve a tocar Buscar" };
    await kino.storage.set("pending", who.id);
    return { link: { candidate: "@" + who.username, confirm: "linkMe" } };
  }
  if (key === "linkMe") {                           // runs only after the person confirms
    await kino.storage.set("chat", await kino.storage.get("pending"));
    return { message: "Vinculado" };
  }
}
```

- Kino shows **its own** question, "¿Eres tú, @ana?" / "Is this you, @ana?", and names your plugin
  in it by the `name` of your manifest: "Demo pide confirmar. Demo quiere continuar con esto. No pasa
  nada hasta que lo confirmes." It has "Sí, soy yo" / "Yes, it's me" and Cancelar (Cancelar focused).
  You cannot change its words.
- **Cancelar runs nothing**: your plugin is not called and hears nothing. Only **"Sí, soy yo"** runs
  the `confirm` action, exactly once, like a press of that button (same settings, same 30 s). If it
  cannot start right then (another action or a save is running, or the person's unsaved edits
  cannot be saved), the question stays open and says so.
- `candidate`: a string, 1 to 64 characters after trimming, with runs of spaces collapsed to one. It
  may not hold control or invisible formatting characters, any space but the ordinary one, or the
  fillers that draw nothing (U+115F, U+1160, U+3164, U+FFA0, U+2800). It goes through the same secret
  scrubbing as your status lines and is shown as plain text, never as markup.
- `confirm`: the `key` of **another** `action` setting of your plugin (not the one that is
  answering) that has **no `confirm` question of its own**: an action that asks "¿Borrar todo?" can
  never be presented as "Is this you?".
- Anything else refuses the link: your `message` is still shown, with Kino's generic error ("No se
  pudo completar. Inténtalo de nuevo.") under it.
- A `message` in the same answer is shown too. A `link` in the `confirm` action's own answer is
  ignored (no chains). One question at a time: a newer link replaces a waiting one, and leaving the
  form drops it.
- An older Kino ignores `link`, so also say in `message` (or a status line) what to do.

#### On the person's other devices

When the person pairs two of their devices (phone and TV), Kino keeps their plugins in step. What
crosses, and what does not:

- **Crosses:** install, updates, on/off, uninstall, and the host approvals. Each device fetches your
  code itself; only the address and the approval travel. The other device installs **silently** when
  what it fetched asks for nothing beyond what the person approved on the first one; if you now ask
  for more (a new host, permission or capability), it waits in "Plugins de tus otros aparatos" for
  the normal consent sheet.
- **Crosses:** the values of `text`, `select`, `toggle`, `url` and `list` settings (a `list` that has
  a `password` field does not travel), and `password` settings, sealed end to end with the key the
  devices agreed when they paired, never readable on the way.
- **Crosses:** clears. A field the person empties, or an action's `clearSettings`, empties it on their
  other devices too (passwords included). A `required` setting is never cleared remotely. A device
  running an older Kino build ignores clears and keeps its value.
- **Never crosses:** `kino.storage`, cookies, the cached Home rows.

A value that arrives this way is applied **without** your `validateSettings`, and, like any saved
change, closes your sandbox. So write the plugin as if a setting can change under it at any time:
key any session you keep in `kino.storage` by the account it belongs to, and never put a device
identity in a setting, because it would be copied to the other device.

```js
const sessionKey = `session:${kino.config.get("email") ?? ""}`;   // not just "session"
```

### The person's own servers

A `url` setting is how a plugin talks to a server that is not on the internet: a media server at
home, for instance. **The server the person types becomes one more host your plugin may reach**,
exactly as typed: its scheme (`http` is allowed here, because home servers rarely have a
certificate), host and port. Nothing else on that machine or network is allowed, redirects from it
may only go to the same server or to your declared `hosts`, and your stream and image URLs may point
at it. The consent screen warns "Se conectará a los servidores que escribas en su configuración", and
Ajustes lists what each plugin reaches ("Se conectará a: …").

A plugin whose **only** reach is that server (it never calls a site of its own) declares
`"hosts": []` from `"apiVersion": 2`, as long as it has at least one `url` setting: the consent
screen then lists no host at all, only the line about the servers the person types, and Ajustes says
"Se conectará solo a los servidores que escribas en su configuración" until one is typed. An empty
`hosts` with no `url` setting is refused (`The "hosts" field can only be empty if the plugin has
a setting of type "url"`), and on `"apiVersion": 1` it is refused as always. (Kino never lists
a host under the reserved `.invalid` domain either, the placeholder older manifests used.)

Only the scheme, host and port count: any path on that server is reachable, and
`kino.config.get` returns the value as typed. Kino refuses, with a message under the field, a value
that is not an `http`/`https` URL, or whose host is `localhost`, a loopback address (`127.0.0.1`,
`::1`), a link-local one (`169.254.x.x`, `fe80::`) or `0.0.0.0`. Addresses in the person's own network (`192.168.x.x`,
`10.x.x.x`, a `.local` name) are allowed: that is the point.

### Declaring an insecure host (apiVersion 2)

A `hosts` entry can also be an object, for a site of yours that has no certificate:

```json
"hosts": ["archive.org", { "host": "cdn.example.org", "insecureHttp": true }]
```

This needs `"apiVersion": 2`. `insecureHttp: true` is the only thing it can carry beyond `host`, and
it marks the only *declared* hosts (not the person's own server, above) allowed over plain `http`:
`kino.fetch`, a `Stream`'s `url`, its `subtitles`, its `audioTracks` and a `drm` block's `licenseUrl`
all accept `http://cdn.example.org/…` once it is declared this way, and every redirect hop is judged
by the same rule. Every other declared host stays https-only, `https` keeps working on the insecure
one, and the host is matched exactly: `sub.cdn.example.org` is not covered. The same rules as a plain
string still apply (public DNS name, no `*`, no IP, nothing private/LAN; a name that resolves into
the person's own network is still refused) plus one more: **no `*.` wildcard** — an insecure host is
named exactly. The consent screen shows it in red, "Conexión sin cifrar con cdn.example.org", and an
update that newly marks a host this way waits for approval like a brand new host would. See
[A site of yours without a certificate](#a-site-of-yours-without-a-certificate-apiversion-2).

### Downloads (apiVersion 2)

Declare `"download"` in `capabilities` (with `"apiVersion": 2`) and Kino offers your titles for
offline viewing: "Descargar" on the info page and "Guardar en el dispositivo" in the library, on
phones (Kino never downloads on a TV). Nothing extra to export. When the person saves a title, Kino
calls your `resolve(ref)` when the download actually runs, exactly as playing would, and saves the
`Stream` as **one file**, with your `headers` on every request, through the same host gate as the
player for that stream (https on your `hosts` or the person's own server -- or any public host under
the broad video permission / `streamHosts: "any"` -- every redirect hop checked, never the home
network). Your `subtitles` are saved next to it. `audioTracks` are **not** saved: the offline copy has
only the audio inside the video file, so a source that dubs through separate tracks is heard in its
main audio when offline.

What downloads, and what does not:

- A progressive file (`mp4`, `mkv`, `webm`, `ts`, …) downloads. The saved file takes its extension
  from your `mime` when you give one, else from the URL, else `mp4`; the player sniffs the bytes anyway.
- An HLS VOD stream (`.m3u8`, an `mpegurl` `mime`, or a response that turns out to be a playlist)
  downloads too, saved as one file: MPEG-TS segments become a `.ts`, fMP4 ones (`EXT-X-MAP`) an
  `.mp4`. From a master playlist Kino takes the highest variant up to 1080p whose audio is inside the
  video; AES-128 keys and byte ranges are handled, and your `headers` go on the playlists, the key
  and every segment. At an `EXT-X-DISCONTINUITY` the segments are kept as they are (the timestamps
  restart there and the player follows; seeking right at the splice may land a little off), unless
  the video or audio format changes at it (e.g. H.264 → HEVC, a track added or gone): that is
  refused like below. A retry resumes at the first missing segment when it gets the same content
  (same variant, same first bytes), even from another CDN; different content starts over.
- What cannot be saved ends as "Este contenido no se puede descargar", a final state with no
  "Reintentar" (it would refuse the same way) that the person can only remove: a DASH or Smooth
  manifest (`.mpd`, `application/dash+xml`, …), a live HLS playlist (no `EXT-X-ENDLIST`), SAMPLE-AES
  or any DRM key, a key that is not 16 bytes or does not decrypt, an empty segment, a master whose
  every video variant needs a separate audio rendition (Kino does not save a silent video), a
  DRM-protected stream and a live channel (a live channel never even shows a download button, also in
  a plugin that declares both `channels` and `download`). Subtitle renditions inside the playlist are not saved (your `subtitles` are). There is no separate "resolve for download" call.
- The queue downloads one title at a time, so a `ref` may wait a while before `resolve` is called:
  keep something stable in it and look the fresh link up inside `resolve` (as recommended above). A
  retry resumes the partial file even when your URL changed. A `resolve` the queue makes that times
  out fails that download only: it does not count toward the three timeouts in a row that switch
  your plugin off ("No responde"), which only calls made for the person on screen do.
- A plugin that is disabled, waiting for its settings, or uninstalled downloads nothing: its titles
  show no download button, and a title already queued fails with "Este plugin ya no puede descargar
  videos". Files already downloaded keep playing offline and stay removable in Descargas, whatever
  happens to the plugin afterwards.

Declaring `download` shows "Puede descargar videos para verlos sin conexión" on the consent sheet,
and an update that newly declares it waits for the person's approval ([section 8](#8-publishing-your-plugin)).

### Live channels (apiVersion 2)

With `"apiVersion": 2` an item may be a live channel: `kind: "live"`, in a `browse` page or `search`
result, next to your movies and series. Nothing to declare beyond the version. In a `home` row a
channel stays only from `"apiVersion": 6`: it shows as a channel card with the "En vivo" badge and
opens like a channel from En vivo (a row of channels on Home is just a `home` row whose items are
`kind: "live"`); below 6 Kino drops it from Home. An `adult: true` channel follows the same 18+ lock
as any 18+ item, and a row left with nothing to show is not shown.

```js
export async function home() {
  return [{
    id: "en-vivo", title: "En vivo",
    items: [
      { id: "canal-1", ref: "live:1", title: "Canal Uno", kind: "live", poster: "https://cdn.example.org/canal-1.png" },
    ],
  }];
}

export async function resolve(ref) {
  if (ref.startsWith("live:")) {
    const url = await freshPlaylistUrlFor(ref); // look the live link up here, never in home()
    return { url, mime: "application/vnd.apple.mpegurl" };
  }
  // ...movies and episodes as before
}
```

What Kino does with a `live` item:

- Its card wears an "EN VIVO" badge (Home, "Ver más", search, phone and TV), and tapping it goes
  **straight to the player**: no info page, nothing to read or pick. `resolve(ref)` gets the item's
  `ref`, exactly as for a movie.
- The `Stream` plays as live: an HLS or DASH live manifest (`.m3u8`/`.mpd`) is what the player
  expects; a progressive file plays too but reads as a channel (no seek bar, no length). `headers`,
  `subtitles` and `expiresInSeconds` work as for any stream; `durationMs` and `audioTracks` are
  ignored (a separate audio file cannot follow a live window: put a channel's other languages inside
  its manifest, e.g. HLS `EXT-X-MEDIA` renditions, and the player's audio menu offers them).
- The player shows the live overlay (no progress bar, no seeking, no "next") and starts at the live
  edge. If it falls behind the live window, or the playlist resets or stalls, it re-joins the live
  edge in place without calling you (a few times a minute). On any other cut, or when your URL
  stops working, it calls `resolve` again with the same `ref` after 2 s, then 4 s, then 8 s: three
  reopens, replenished once the channel has played for five seconds. Only after the third failed
  reopen does the person read "Se cortó la señal de <canal> y no volvió". `expiresInSeconds` plays
  no part for a channel: a cut always re-resolves.
- A channel is never saved: no library row, no resume position, never in "Continuar viendo", and
  never downloadable (a plugin that declares `download` gets "Este contenido no se puede descargar"
  for it). `runtimeMinutes` on the item is ignored; a channel has no `episodes`.

Limits: a `live` item from a plugin on `"apiVersion": 1` is dropped silently, like any invalid
item (and a row left with no items disappears), so declare `2` before you return one. A channel
still counts against the same row and page sizes as any item. These channels appear in your rows,
with your plugin's name; to put channels in Kino's En vivo tab and its "Canales en vivo" row, use
the apiVersion 3 `channels` capability ([below](#channels-in-the-en-vivo-tab-apiversion-3)).

### Music and podcasts (apiVersion 8)

With `"apiVersion": 8` an item may be audio: `kind: "music"` (an album, a playlist or a single
track) or `kind: "podcast"` (a show or an audiobook), in `search`, `browse`, `home` rows and your
section, next to your movies and series. Nothing to declare beyond the version: an audio item does
**not** need the `episodes` capability.

```js
export async function search(q) {
  return [
    { id: "album-42", ref: "album:42", title: "Un álbum", kind: "music", artist: "Los Artistas", poster: "https://cdn.example.org/a42.jpg" },
    { id: "show-7", ref: "show:7", title: "Un podcast", kind: "podcast", overview: "Una charla por semana" },
  ];
}

export async function episodes(ref) {            // only with the "episodes" capability
  if (ref.startsWith("album:")) return { episodes: [
    { season: 1, number: 1, ref: "track:1", title: "Primera canción", runtimeMinutes: 4 },
    { season: 1, number: 2, ref: "track:2", title: "Segunda canción", runtimeMinutes: 5 },
  ] };
  // ...a podcast's episodes, a series' chapters
}
```

How the pieces connect:

- **With `episodes` declared**, Kino calls `episodes(ref)` with the item's `ref`, for every
  `music` and `podcast` item: an album's or playlist's tracks, a podcast's episodes, an audiobook's
  chapters, in your order (a single track answers one entry). `number` is the track or episode
  number, `title`, `still` (the cover) and `runtimeMinutes` work as for any episode, and each entry's
  `ref` goes to `resolve`. If you declare `episodes` (for your series, say), your `episodes` must
  also answer for every `music` and `podcast` ref, even a lone track: there is no per-item way to
  skip it.
- **Without `episodes`**, the item's own `ref` goes straight to `resolve` and plays as one track,
  exactly like a movie's.
- `artist` (optional, `music` and `podcast` only) is the artist (music) or the host/author (podcast):
  trimmed, at most 200 characters, ignored on any other kind. The album or podcast page shows it as
  the line under the title (and Kino names it as the artist where it plays the audio). Without it
  there is no such line: Kino never takes one from `overview` or `genres`.
- `runtimeMinutes` is kept on an audio item (unlike a `live` one). `search` may get `type: "music"`
  or `type: "podcast"` when Kino leans that way; `"any"` includes them, and it stays a hint.
- The `Stream` is a normal one: progressive audio (MP3, M4A, AAC, OGG) or an HLS/DASH manifest. The
  kind is a hint: a stream that turns out to carry video still plays as video.

Limits: a `music` or `podcast` item from a plugin below `"apiVersion": 8` is dropped (with a line in
the log), and the rest of the answer stays, so declare `8` before you return one; older Kino builds
refuse an apiVersion 8 plugin with "Este plugin necesita una versión más nueva de Kino". Audio items
count against the same row and page sizes as any item, and `adult: true` follows the same 18+ lock.

A complete example is the [Internet Archive Audio plugin](https://github.com/kinotvapp/kino-plugin-archive-audio)
(`plugins/archive-audio` in Kino's repository): albums, concerts, audiobooks and radio, with discs as seasons,
chapter titles in the person's language, every quality as a lazy labelled copy, its own section, genre tiles and
offline tests. See [the reference plugins](#10-the-reference-plugin).

### Channels in the En vivo tab (apiVersion 3)

Declare `"apiVersion": 3` and the capability `"channels"`, and export `liveCategories()` and
`liveChannels({ categoryId, cursor })` (and, optionally, `guide(...)`, see §4). Your channels then
appear in Kino's own En vivo tab, TV guide, channel drawer and Home "Canales en vivo" row, in a
section with your plugin's name. `channels` does not replace `search`/`home`: the manifest still
needs one of them (a plugin with only channels exports a `home()` that returns `[]`). Items of kind
`"live"` in your rows keep working; a plugin can do both. On install, and on an update that adds it,
the person reads and approves "Agrega canales en vivo a la pestaña En vivo".

### Subtitles for any title

Export `subtitles({ imdbId, tmdbId, kind, season, episode, title, year, languages, file })` and Kino lists
what you answer in the player's "Buscar subtítulos en línea" (phone and TV), under your plugin's
name, next to OpenSubtitles and SubDL: for **any** movie or episode the person plays -- your titles,
another plugin's, a Stremio addon's -- as long as Kino knows its IMDb or TMDB id (a title known only by name is
never sent to you). The person picks a track, Kino downloads it, turns it into SRT and adds it like
any online subtitle (sync offset, style, remembered for the title).

Two ways to offer it:

- **A subtitle provider**: `"capabilities": ["subtitles"]` and nothing else. No `resolve`, `search`
  or `home` needed; the plugin appears nowhere but the subtitle search and Ajustes ▸ Plugins (it is
  not a source in "Elige tus plugins"). The consent screen says "Agrega subtítulos a tus películas y
  series". Older Kino versions refuse a capability they do not know: they do not install it.
- **Alongside your videos**: keep your capabilities and just export `subtitles` (declaring
  `subtitles` too adds the consent line, but older Kino versions would then refuse the plugin).
  Kino asks every plugin whose install found the export; older versions never call it.

The argument: `imdbId` (`tt…`) and/or `tmdbId` (a number), at least one of them; `kind` `"movie"` or
`"series"` -- for an episode the ids are the **series'** and `season`/`episode` are set; `title` and
`year` are hints; `languages` are the person's subtitle languages, ISO 639-1, best first (`["es",
"en"]`). `file` is what Kino knows of the file playing, when the person searches from the player: `{ hash?, size?,
name? }`, each only when known -- `hash` the 16-hex OpenSubtitles hash and `size` the bytes it was computed with (only for a
plain, stable file), `name` the file's name with its extension ("The.Matrix.1999.1080p.mkv", only when the URL ends in a
video file name, at most 200 characters) -- and absent when nothing is; never the video's URL. Use it to rank the release
that matches the exact file first (a Stremio addon gets it as the `videoHash`, `videoSize` and `filename` extras). Kino
0.9.51 and later send it; older ones never do, so treat it as a hint. Return an array of `{ lang, url, format?, label?, translated? }`, a `Stream`'s `subtitles`
entries plus an optional `label` and `translated: true` for a machine translation: the menu then says
"Español (traducido)" and lists it after the person-made tracks of that language. Kino keeps 30,
then lists only those in the person's languages, in that order, 15 per plugin: put the asked
languages first. `label` (60 characters) is shown next to the language, a release name for example.
Each `url` follows a `Stream`'s subtitle rule: your `hosts`, the person's server, or any public host
with [`streamHosts: "any"`](#playing-from-any-server-streamhosts-apiversion-4). The call is a
background one (10 s, it never marks your plugin "No responde"); return `[]` when you have nothing.

### Catalog-only plugins (`catalogOnly`, Kino 0.9.54)

A plugin that lists and describes titles but has no video of its own -- a TMDB catalog, a list of what's new, ratings --
says so with `"catalogOnly": true`:

```json
{
  "id": "tmdb", "name": "TMDB", "version": "1.2.0", "apiVersion": 7, "entry": "plugin.js",
  "hosts": ["image.tmdb.org"],
  "capabilities": ["search", "home", "browse", "episodes", "resolve", "meta"],
  "catalogOnly": true
}
```

What Kino 0.9.54 and later do with it:

- **Its titles take the "Buscar dónde verlo" route.** The info page's main button reads "Buscar dónde verlo" instead of
  "Reproducir", and every other way into the player (Home and its quick play, "Continuar viendo", the hero, a deep link,
  the TV's quick play) looks the title up in the person's other plugins first: one source that has it plays, several
  open the sources list, none says "Ninguno de tus plugins tiene este título…". The same detour Stremio addons without
  streams get.
- **It is never a source of a title.** Its `search` is not asked when Kino lists the sources of a title (the search
  screen, the player's "Ver en otros plugins", "Buscar dónde verlo"), it is not offered in "Buscar por plugin", and it never
  shows up in the player's "Servidor" list. Inside its own pages (its section, "Ver más", searching inside a "Ver más"
  page) its catalog is browsed and searched as always.
- **Its `resolve` is never called.** If a title of it reaches the player anyway, the player says "<name> solo muestra el
  catálogo: no reproduce videos. Busca este título en tus otros plugins." (or its English version), with "Ver en otros
  plugins" under it.
- **It is not a source in "Elige tus plugins"**, and Kino files it under Utilidades when the manifest has no
  `categories`.
- The consent sheet says "Solo catálogo: no reproduce videos" ("Catalog only: doesn't play videos"). It is no grant:
  an update that adds or drops the field applies without asking.

The rules (the install is refused otherwise, with the message in quotes):

| Rule | Refusal |
| --- | --- |
| `true` or `false` only | "The \"catalogOnly\" field must be true or false" |
| At least one of `home`, `browse`, `search`, `meta` (instead of `resolve` plus `search` or `home`) | "A \"catalogOnly\" plugin must declare \"home\", \"browse\", \"search\" or \"meta\"" |
| No `download`, `drm` or `channels`: they only serve playback | "A \"catalogOnly\" plugin can't declare \"download\": it doesn't play videos" (the first one found) |
| No `streamHosts` (from apiVersion 4) and no `"browser": true` (from apiVersion 6); `"browser": "pages"` is fine, it reads pages for the catalog | "A \"catalogOnly\" plugin can't declare \"streamHosts\": it doesn't play videos" |

`resolve` may still be declared and exported: every capability you declare must be exported, as always, and Kino 0.9.54+
simply never calls it. `subtitles`, `tracking`, `segments`, `meta`, `episodes`, `scopedSearch`, `migrate`, `section`,
`categories()` and settings all work as for any plugin.

**No new apiVersion.** The field is additive, like `discoverable` and `kino.meta`: valid at every `apiVersion`, and an
older Kino ignores it as it ignores any key it does not know (its manifest parser reads only the fields it knows). That is
what lets one manifest serve both:

- **Kino 0.9.53 and older** ignore `catalogOnly` and apply their own rules, which require `resolve` and `search` or
  `home`. So, to stay installable there, **keep declaring and exporting `resolve`** -- one that always fails with a
  sentence for the person -- **and declare `search` or `home`**:

  ```js
  export async function resolve() {
    // Only Kino 0.9.53 and older call this: 0.9.54+ sends the person to their other sources first.
    throw kino.error("not_found", "catalog only", { userMessage: "Este catálogo no reproduce: busca el título en tus otros plugins." });
  }
  ```

  Without them, Kino 0.9.53 and older refuse the plugin ("El plugin debe declarar \"resolve\""), and an installed older
  version simply stops updating there. `sdk/validate.mjs` tells you which case you are in.
- **Kino 0.9.54 and later** read the field and never call that `resolve`.

`sdk/validate.mjs` prints the consent line and a note about older Kino; `sdk/run.mjs . resolve <ref>` still runs your
`resolve` (for the older Kino it serves) and reminds you that 0.9.54+ never calls it.

### Telling a tracker what the person watches (`tracking`, apiVersion 7)

A plugin for a tracking service -- Seenr, Trakt, Simkl, a Plex-style webhook, the person's own server -- declares
`"capabilities": ["tracking"]` (alone, with `subtitles`, or next to a source's capabilities) and `"apiVersion": 7`, and
exports `track(event)`. Kino calls it for every movie or episode the person plays **on that device**, from any source.
Kino 0.9.50 and older refuse such a manifest with "Este plugin necesita una versión más nueva de Kino".

- **Consent.** The install sheet says, in red, "Le contará a `<your hosts>` qué ves y cuándo lo terminas" (the first 3
  hosts, then "y N más"; with no host, "al servidor que escribas en su configuración"). An update that adds `tracking`
  always waits for the person, even when Kino approves other updates on its own.
- **The switch.** Your Ajustes tab gets "Enviar lo que veo" (on by default, synced to the person's other devices).
  Off, Kino stops calling `track` and deletes what was waiting. Disabling or uninstalling the plugin does the same.
- **What is never sent.** Live channels and radio, 18+ titles, anything a Chromecast or DLNA TV plays (the phone is only
  a remote then), and a title that is not in the person's library. An episode whose number Kino does not know is not sent
  either.

**When.** `start` once the video is really playing (and again when it resumes after a pause); `progress` at most every
5 minutes of playback and on every pause (with `paused: true`); `stop` with the position when the person leaves the title
(or plays another one); `watched` **once**, when the position crosses Kino's own "visto" rule: 3 minutes or less left
**and** at least 90% played (a 24-minute episode at 21:36, a 2-hour movie at 1:57). A title opened already past that
point (resumed at the credits on another device) does not send `watched` again, and each device sends a title's
`watched` to your plugin at most once.

**The event:**

```js
{
  id: "6f1c…",            // stable: the same on every retry of this event, use it to ignore a repeat
  type: "start" | "progress" | "stop" | "watched",
  at: 1759670000000,      // when it happened on the device (epoch ms), not when it reached you
  kind: "movie" | "episode",
  ids: { imdb?, tmdb?, tvdb?, anilist?, mal? },   // see below
  title?: "…",            // the movie's name; an episode's own name when TMDB has one
  year?: 1999,            // a movie's year
  show?: { title: "…", year?: 2008, ids: { imdb?, tmdb?, tvdb?, anilist?, mal? } },   // episodes only
  season?: 1, episode?: 2,                          // episodes only (season 1 when the source gave none)
  positionMs?: 1234000, durationMs?: 8160000, progress?: 0.151,   // where the person was, 0..1
  paused?: true           // a progress sent because the person paused
}
```

**Which ids you get.** For a **movie**, `ids` are the movie's. For an **episode**, `ids` are the **episode's own** ids
(TMDB's episode id, and its IMDb and TVDB ids when TMDB knows them) and the **show's** ids are in `show.ids`. Never use
`show.ids` where a service expects an episode id: checking in by the show's id lands on the wrong item. Kino fills the
ids it lacks from TMDB when it delivers (at most 8 s; the movie's or show's IMDb and TVDB ids, the episode's own); when
TMDB doesn't answer, the event still goes, with only what Kino had -- an episode's `ids` may then be `{}`, so fall back to
`show.ids` + `season` + `episode` (or `show.title`) as your service allows. `anilist`/`mal` appear only when the title's
own source named them. Every key is absent when unknown; `ids.tmdb`, `ids.tvdb`, `anilist` and `mal` are numbers, `imdb` a
`tt…` string.

**What to return.** Anything (`{ ok: true }` by convention) means delivered. Return `{ skipped: true }` for an event
your service has no use for (a tracker that keeps no `progress`): Kino drops it the same way, but only a real delivery
clears the red "No pudo avisar…" line, so a wrong link stays visible until it is fixed. To fail, throw `kino.error(code)`; the code
decides what Kino does:

- `timeout`, `network`, `unavailable`, `rate_limited` (and a timeout of the call itself, or an error thrown without a code):
  Kino tries the same event again later -- 30 s, then doubling up to 6 h, 12 tries at most --, and your later events wait
  behind it, in order;
- `auth_required`, `invalid_request`, `not_found`, `geo_blocked`, `host_not_allowed`, `too_large`: the event is dropped at
  once.

A dropped event, or three failures in a row, shows "No pudo avisar a `<your plugin>`: …" in red in your Ajustes tab and in
Gestionar, until a delivery succeeds. The call is a background one (10 s, never "No responde"), never on the player's
thread. Kino keeps at most 200 events waiting per plugin (the oldest `progress` goes first, a `watched` never) and drops
one still undelivered after 7 days; a newer `progress` replaces a waiting one of the same title, and a `stop` or `watched`
replaces its waiting `progress`. Nothing is lost offline or when the app is closed: Kino delivers once there is network.

Kino's own logs never carry what the person watched; with "Modo debug" on, your Registro shows each event sent. Stremio
addons have no scrobble protocol, so a converted addon never gets `tracking`. Try it with
`node sdk/run.mjs <plugin dir> track start` (or `progress`, `stop`, `watched`, and a JSON object to change the sample).

### Where the intro and credits are (`segments`, apiVersion 7)

A plugin that knows where a title's intro and credits are -- an IntroDB-like database, an AniSkip-like one, the person's
own server -- declares `"capabilities": ["segments"]` (alone, with `subtitles`/`tracking`, or next to a source's
capabilities) and `"apiVersion": 7`, and exports `segments(query)`. Kino then shows its "Saltar intro" and "Saltar outro"
buttons, and "Saltar automáticamente" jumps the intro, for **any** movie or episode the person plays, from any source,
on phone and TV. Kino 0.9.50 and older refuse such a manifest with "Este plugin necesita una versión más nueva de Kino".

- **Consent.** The install sheet says "Agrega el botón para saltar la intro y los créditos" (not in red: like
  `subtitles`, your plugin only learns which title plays). An update that adds `segments` needs no approval of its own.
- **When.** Once a movie or an episode really plays (Kino knows the file's length), in the background: playback never
  waits for you. Never for live channels or radio, never for 18+ titles, never for a title Kino knows by no id. Each
  installed `segments` plugin is asked at once; Kino keeps an answer (an empty one too) for the session per title,
  episode and length (rounded to 10 s), so replaying costs no call. When every plugin failed, Kino asks again after
  2 minutes.

**The query:**

```js
{
  kind: "movie" | "episode",
  ids: { imdb?, tmdb?, tvdb?, anilist?, mal? },   // a movie's; an episode's OWN (TMDB episode id, its IMDb/TVDB)
  show?: { ids: { imdb?, tmdb?, tvdb?, anilist?, mal? } },   // episodes only: the show's, AniList/MyAnimeList included
  season?: 1, episode?: 2,                          // episodes only (season 1 when the source gave none)
  durationMs?: 1440000                              // the playing file's length: answer for THAT cut
}
```

The ids follow [`track()`'s rule](#telling-a-tracker-what-the-person-watches-tracking-apiversion-7): an episode's `ids`
may be `{}` when TMDB did not know them, so fall back to `show.ids` + `season` + `episode`. No title, year or URL is sent.

**What to return:** an array of `{ type, startMs, endMs }`, `type` one of `intro`, `outro`, `recap`, `credits`,
`preview`, times in whole ms of the file (`[]` or `null` when you know nothing). Kino checks each entry on its own and
drops a bad one without losing the rest: an unknown `type`, a time that is not a whole number, a start below 0, an end
not at least 1 s after the start, and -- with `durationMs` known -- a start at or past the file's end or an end more than
5 s past it (an end within that is cut to the length). Of overlapping entries of the same type the earlier one stays.
Kino reads the first 100 entries and keeps 10, earliest first. Kino uses the earliest `intro` as the intro and the
earliest `outro` or `credits` as where the ending starts (only when it comes after the intro); `recap` and `preview` are
accepted and have no button yet.

**Who wins.** A person's own correction (the marker editor) always does, and so does the `skip` of the plugin serving the
file. For anime, AniSkip (when "Saltar intro en anime" is on) wins over you, part by part: your answer fills only the
intro or ending AniSkip lacks. Between two `segments` plugins, the first in the order Ajustes ▸ Plugins lists them that
answered something usable wins. Nothing you answer is stored or synced: it lives in memory for the session.

The call is a background one (8 s, never "No responde"); Kino waits for your turn at most 12 s. Kino's logs carry only
counts, never the title. Try it with `node sdk/run.mjs <plugin dir> segments tt0133093 8160000` (a movie and its length),
`segments tmdb:1396 1 2 2880000` (an episode: the show's id) or a JSON query; it prints what Kino keeps, what it dropped
and why, and the button it makes of it.

### Playing from any server (`streamHosts`, apiVersion 4)

Some sources serve their video from CDNs whose domains you cannot list (they change, or sit on bare
TLDs, which a `*.xyz` entry can never cover). With `"apiVersion": 4` a plugin may add:

```json
"apiVersion": 4,
"streamHosts": "any"
```

`"any"` is the only value and no capability is needed; an older manifest ignores the field. It lets
**what the plugin plays** be on **any public host**, over `http` or `https`:

- a movie or an episode: exactly the rule of the
  [broad video permission](#what-you-return) -- it is the same rule, asked for by you instead of
  granted by the person. **In the player only**, the `url` `resolve` returns, everything its manifest
  names, every redirect hop, **and** the `subtitles` and `audioTracks` you return may be on any public
  host. A download of that movie or episode follows the same rule;
- a live channel: the rule of [`liveStreamHosts: "any"`](#channels-from-any-server-livestreamhosts-apiversion-3)
  (the stream, its manifest and redirects; your `subtitles` and `audioTracks` stay on your `hosts`).

It changes nothing else: `kino.fetch` (and so every [sealed secret](#sealed-secrets-apiversion-4)),
images and DRM license servers stay on your declared `hosts`, and local or private addresses are
still refused. The consent screen shows it in red ("Puede reproducir video desde cualquier servidor
que indique"), and an update that adds it waits for the person to approve again. Prefer listing the
real domains when you can: people trust a narrow list more.

### Opening hidden web pages (`browser`, apiVersion 6)

Some sites never put the video address in their HTML: an embedded player builds it in the page with its own
scripts, and the only way to learn it is to run the page. With `"apiVersion": 6` a plugin may add:

```json
"apiVersion": 6,
"browser": true,
"streamHosts": "any"
```

and then call [`kino.browser.capture`](#kinobrowsercaptureurl-options-apiversion-6) from `resolve` -- only a
`resolve` the person started: they pressed play, or they started a download. The consent
screen shows it in red ("Puede abrir páginas web ocultas para encontrar el video"), and an update that adds it waits
for the person to approve again; below apiVersion 6 the field is ignored. A plugin approved for it gets a longer
`resolve` limit (75 s instead of 20 s), since each page may take up to 25 s.

The page you open must be on a host your `kino.fetch` may reach (your `hosts`), over https. The page itself may then
load from **any public server** (an embed's player lives on hosts you cannot list in advance), but never from the
home network: every request it makes to a local name, a private or loopback address, or a public name that resolves
into the home network is answered empty on the device. Since the video it finds is usually on such a server, a
plugin that plays what it captures also needs `"streamHosts": "any"`.

All of that page's traffic goes through a proxy inside Kino (on the device's loopback, open only while that capture
runs, answering only that capture's page through a one-time credential) that connects only to the address it checked, so a name
cannot answer one address to the check and another to the connection; the WebView itself resolves no name. Every
method works (`POST` included), redirects are followed by the page as in a browser, and WebSocket connections pass
the same check. WebRTC is switched off. A device whose WebView cannot be pointed at a proxy still captures, with Kino
fetching each `GET`/`HEAD` itself (a `POST` then only reaches a public IPv4 address written as such, and WebSocket is
off); one whose WebView cannot run scripts at document start gets `browser_unavailable`.

To also **read** pages through that hidden browser with
[`kino.browser.page`](#kinobrowserpageurl-options-apiversion-6) -- for a site that answers every plain `kino.fetch`
with its automatic browser check (Cloudflare's "Just a moment…") -- from `search`, `home`, `browse`, `episodes`,
`details`, `section` and `resolve`, ask for it by name:

```json
"apiVersion": 6,
"browser": "pages"
```

`"pages"` includes everything `true` gives (`kino.browser.capture` too). The red line then says so: "Puede abrir
páginas web ocultas para mostrar contenido y encontrar el video". `"browser": true` stays capture-only, with the old
line, and its `kino.browser.page` answers `not_allowed`. A plugin the person approved with `true` asks again when its
update says `"pages"` -- also on the automatic update pass after a Kino upgrade, and on another device that only
approved the old line. Any other value is refused: "The "browser" field must be true, false or "pages"".

### Labelled and lazy copies (apiVersion 6)

A source often has the same episode in several languages and on several servers, and finding each server's video
costs time (a page to open, sometimes a [hidden web page](#opening-hidden-web-pages-browser-apiversion-6) of 5-25 s).
Resolving all of them before the first frame would make every play slow. From `"apiVersion": 6`, a Stream's
`alternatives` may name a copy **without resolving it**: `{ label, ref }` instead of `{ url }`. Kino passes that
`ref` to your `resolve(ref)` only when the copy is actually needed:

- the person picks it in the player's **Servidor** menu (the copy on screen keeps playing while it opens, then the new
  one starts at the same spot);
- the automatic fallback reaches it (the copy on screen cannot play on this device, or is gone);
- a download's copy choice gets to it (inside the same 30 s budget it spends probing copies; a lazy copy that has not
  answered by then is skipped, never waited for).

That call is a normal `resolve`: the same time limit (75 s for an approved `browser` plugin), the same checks on what
it returns, `kino.browser.capture` allowed (for a download's copy choice: only when no other page is open, else
`busy` and the copy is skipped), host questions asked as for the title. From its answer Kino uses `url`,
`headers`, `mime`, `subtitles` (when it brings some; otherwise the title's are kept) and `expiresInSeconds` (a lazy
copy past its expiry is resolved again, not the whole title) and `skip` (it shows the "Saltar intro" button while that
copy plays, never saved: the Stream's own `skip` stays the episode's, and a hand correction still wins). Its own
`alternatives` are ignored -- a copy never expands into more copies. A `resolve` that fails moves on to the next copy; when the person picked it, they read "No se
pudo abrir …" and keep watching the copy they had.

```js
export async function resolve(ref) {
  // A copy's own ref: "<episode>|<server>". Resolve just that server.
  if (ref.includes("|")) return resolveServer(ref);
  const servers = await listServers(ref);            // [{ id, lang, name }], fast: no page opened yet
  const first = await resolveServer(`${ref}|${servers[0].id}`);
  return {
    ...first,
    label: `${servers[0].lang} · ${servers[0].name}`,  // "Latino · Streamwish"
    alternatives: servers.slice(1, 9).map((s) => ({
      label: `${s.lang} · ${s.name}`,                // "Subtitulado · Voe"
      ref: `${ref}|${s.id}`,
    })),
  };
}
```

Rules: `ref` is a non-blank string of at most 512 characters with no control characters (a bad or repeated one is
dropped); an entry with a `url` is a normal copy whatever else it carries; lazy and concrete copies mix freely and
share the limit of 8; each `label` is trimmed, at most 48 characters, no control characters, or it is dropped while
the copy still counts. Keep the ref enough to find that one server again: it may be resolved minutes after the
title (a person switching servers mid-episode). Below apiVersion 6 the keys are unknown: a `label` is ignored and a
`{ ref }` entry, having no `url`, is dropped exactly as before. Try it with `node sdk/run.mjs ./plugin.js resolve
'<ref>'`, which prints each copy with its label, then `resolve '<a copy's ref>'` to resolve that copy.

### Letting another app resolve what you found (`externalResolve`, apiVersion 11)

Sometimes your plugin can tell exactly what it found but has no way to turn it into a playable URL
itself: doing that needs a separate, independently-installed Android app, one Kino knows nothing
about and never talks to otherwise. From `"apiVersion": 11`, declare:

```json
"apiVersion": 11,
"capabilities": ["search", "resolve", "externalResolve"]
```

and have `resolve()` (or one entry of a Stream's
[`alternatives`](#labelled-and-lazy-copies-apiversion-6)) answer `{ external: { protocol, ref } }`
instead of `{ url, ... }`:

```js
export async function resolve(ref) {
  // This source can identify the content but cannot produce a playable URL itself:
  // hand it to whichever installed app knows how to resolve "my-protocol".
  return {
    external: { protocol: "my-protocol", ref: "some-opaque-reference" },
  };
}
```

This is not a general-purpose way to reach some other app -- it exists for the one case where your
plugin genuinely cannot produce a URL on its own. Whenever you can resolve a stream yourself, return
`{ url, ... }` as always; reach for `external` only when you can't.

`externalResolve` is declarative, like `download` and `drm`: nothing extra to export, Kino acts on
the flag by itself. Unlike them, it adds no line of its own to the install consent sheet, and an
update that newly declares it needs no fresh approval -- the only consent here is per installed app,
asked later, the first time Kino actually needs one (below).

**The shape.** `protocol` is a string you choose, 1 to 64 characters, lowercase letters, digits,
`.`, `_` and `-` only. There is no registry of protocol names: it is only a string your plugin and
whichever resolver app you're targeting agree on by convention, and Kino's own code never branches
on its value beyond that shape check. `ref` is opaque, 1 to 2048 characters, no control characters --
Kino never parses, validates or logs it in full, it is entirely between your plugin and whatever app
ends up resolving it. `external` can appear anywhere a `Stream` or an alternative would otherwise
carry a `url`: at the top level of a `resolve()` answer (then `url` may be left out or empty) or
inside one of `alternatives`'s entries, next to a concrete `{ url }` copy or a lazy `{ ref }` one.

**What Kino does with it.** Kino looks for an installed app that declares it can resolve that
`protocol`, and asks the person's permission the first time (with more than one qualifying app, the
person picks one, and the pick is remembered). If they agree, Kino hands `ref` to that app and waits
for an answer shaped exactly like a normal `resolve()` answer -- `url`, `headers`, `mime`,
`subtitles`, `expiresInSeconds` and the rest, checked the same way as yours would be. From your
plugin's side, assume one of two things happens: it plays normally, or it fails like any other
`resolve()` failure. Your code never learns which app handled it, or how.

**What not to assume.** Nothing guarantees such an app is installed: a person who has none is simply
told there is nothing to play it with, the same as any other `resolve` failure -- your plugin is not
told specially, and there is no way to check in advance. If resolving your content always needs one,
say so in your plugin's own description or support docs, and give it a real fallback when you can (a
`url` your own code can produce, with `external` kept to one of several `alternatives`). Nor is
`ref`'s format standardized in any way: its shape is entirely up to you and whichever resolver app or
apps you're building it for.

Name the app you want in your manifest with the [`externalResolver`](#3-the-manifest) field (`{ "package": "…" }`, plus an `apk`, `fdroid` or a `downloader` code so Kino can help the person get it), or per stream with `external.resolver`: then no other app is ever asked.
What the resolver's answer may carry besides `url` (`media`, `portable`, `subtitles`…), what the person
sees at each step, what you can and cannot expect and how a cast to a TV behaves are all in
**[§12, External resolver apps](#12-external-resolver-apps)**.

Building the other side -- the separate Android app that actually resolves a `protocol`/`ref` pair --
is a different job from writing a plugin, and not necessarily done by the same person: see
`resolver-contract/PROTOCOL.md` for that protocol, which is open (no signature lock; any developer
may implement it).

### Sockets and plugin-served bytes (`socket` and `byteSource`, apiVersion 13)

Some services are not HTTP at all: a messaging service speaks its own protocol over a WebSocket, and the video
lives in messages, not behind a URL. Two capabilities cover that case. Declare either or both, with
`"apiVersion": 13`:

```json
"apiVersion": 13,
"capabilities": ["search", "resolve", "socket", "byteSource"],
"hosts": ["ws.example.org"]
```

**`socket`: `kino.ws`.** Declarative (nothing to export).

```js
const ws = await kino.ws.open("wss://ws.example.org/apiws", { protocol: "binary" });
await ws.send(new Uint8Array([1, 2, 3]));
const reply = await ws.recv(10000);   // Uint8Array, or null when nothing came within 10 s
await ws.close();
```

- Host rules: `wss://` only (a plain `ws://` is refused with code `not_https`), on port 443 only, and the host must be one your
  manifest declares in `hosts` and the person approved. Anything else is refused with `host_not_allowed` (the error
  carries the `host`). Never the local network and never an IP literal, the same rule as `kino.fetch`.
- Limits: at most 4 open sockets per plugin (the fifth is refused with `limit`) and at most 8 MiB of received
  messages queued unread per socket; past that the socket closes and `recv` fails with `limit` once what was queued is read.
  A frame you send is at most 786,000 bytes (a bigger one fails with `too_large`; split it). One `recv` waits at most 60 s. A socket the plugin never closes lives until Kino closes the plugin's sandbox (idle 5 minutes),
  which closes every socket it opened. Opening never asks the person about a new host: declare it in `hosts`. Messages are binary (`Uint8Array`).
- `send` or `recv` on a closed socket fails with code `closed`; `recv` on a socket the other side closed answers what
  is still queued, then fails with `closed`. Close every socket you open.
- Session advice: whatever lets you reconnect later (an authorization key, a session string) is a secret. Keep it in
  a [sealed secret](#sealed-secrets-apiversion-4) or `kino.storage`, never in the manifest or the logs, and never
  send it to a host you did not declare.

**Frames as strings: `{ encoding: "hex" | "base64" }`.** Your plugin runs in QuickJS, an interpreter: a JavaScript loop
over the bytes of a message costs real time on a phone, about a second per MiB for the decode a `Uint8Array` needs (measured on
a recent phone). A binary protocol that already works on hex strings (most do, because `kino.crypto` takes and answers hex)
should ask for its frames encoded instead. Kino then encodes what `recv` answers and decodes what `send` passes in native
code, and no JavaScript touches the bytes:

```js
const ws = await kino.ws.open("wss://ws.example.org/apiws", { protocol: "binary" });
await ws.send("efefefef", { encoding: "hex" });                  // 4 bytes, decoded by Kino
const hex = await ws.recv(10000, { encoding: "hex" });          // "0a1b..." (lower case), or null after 10 s
await ws.send("AAECAw==", { encoding: "base64" });              // bytes 0, 1, 2, 3
const b64 = await ws.recv(10000, { encoding: "base64" });       // padded base64, or null
await ws.close();
```

- Without `encoding` nothing changes: `recv` answers a `Uint8Array` and `send` takes one.
- `hex` is an even number of digits (either case going out, lower case coming in); `base64` is the standard alphabet,
  padded, with no whitespace. Anything else, and any other `encoding`, fails with `invalid_request` before a byte is sent.
- Every limit counts the decoded bytes: a frame of at most 786,000 bytes is up to 1,572,000 hex characters.

**`byteSource`: a stream the plugin serves.** `resolve()` answers a stream that has no URL:

```js
return { source: "plugin", handle: "msg:12345", size: 734003200, mime: "video/mp4" };
```

`handle` is yours (opaque to Kino, 1 to 512 characters), `size` is the total length in bytes and `mime` the media
type. The player then asks your `read` export for the bytes, one range at a time:

```js
export async function read({ handle, offset, length }) {
  // offset is always a multiple of 4096; length is at most 1048576 (1 MiB)
  const base64 = await fetchRangeAsBase64(handle, offset, length);   // your own code
  return { bytes: base64 };                                          // the range, base64-encoded
}
```

Answer exactly the range asked, or fewer bytes only when it runs past `size`. A plugin that declares `byteSource`
must export `read`, or the install fails with "El plugin no carga: le falta read". A `{ source: "plugin" }`
answer from a plugin that does not declare the capability is refused.

The stream's `handle` is 1 to 512 characters with no control character, `size` a positive whole number and `mime` a
media type (`video/mp4`, `video/x-matroska`...; no parameters); anything else is refused ("El video que entregó el plugin
no es válido"). It is read only from a movie's, an episode's or a track's own `resolve`, never from a live channel or a lazy
alternative.

**In the kit.** `checkOutput("resolve", ...)` accepts the `{ source: "plugin", handle, size, mime }` shape of a plugin that
declares `byteSource` with these rules. `askRead(plugin, manifest, stream, offset, length)` from `sdk/kino-shim.mjs` calls your
`read` the way Kino's proxy does (the capability and the export, an offset that is a multiple of 4,096 inside the stream,
1 to 1,048,576 bytes, one call at a time, 20 s, exactly `min(length, size - offset)` bytes back) and resolves with a Buffer.
From the terminal: `node sdk/run.mjs --size <total bytes> . read <handle> <offset> <length>` prints the byte count, the sha256
and the first bytes; `node sdk/run.mjs --out poster.jpg . image <handle>` writes what your `image` answers.

**Performance.** Calls to `read` are serial per plugin (one at a time, whatever the player asks), so every call's time
adds up before the first frame. Kino asks for 1 MiB per call, reads ahead up to 3 chunks, keeps the last 8 chunks it read,
and reads the first and the last chunk of a stream early, because a player needs both before it can start (an MP4 whose
`moov` index sits at the end, a Matroska file's cues). When the person seeks, chunks queued for the old position are dropped
and the new position goes first; a read already running still ends and its chunk is kept. What makes a chunk fast is your
own per-call time:

- Prefer few large reads: answer the whole `length` asked in one call; if your source serves smaller pieces, fetch them
  in parallel inside that one call rather than one after another.
- Keep the bytes out of JavaScript loops: take socket frames encoded (`{ encoding: "hex" }`, above), do the crypto with
  `kino.crypto` on hex, and let the last `kino.crypto` step answer `outputEncoding: "base64"` instead of converting
  in JavaScript; when the last step is not a `kino.crypto` call (bytes you sliced out of a hex message), turn them into base64
  with `kino.crypto.convert(hex, "hex", "base64")`. A plain loop over the bytes of 1 MiB takes about a second on a phone.
- Fewer big strings: every `kino.crypto` call copies its input and its answer once each across the bridge, so one call
  that does two steps beats two calls. `kino.crypto.aesIgeVerify` decrypts AES-IGE and checks its SHA-256 MAC in one call
  (an MTProto 2.0 message is one call instead of a decryption, a join of the key slice with the plaintext and a hash).
- Your answer's `bytes` crosses as it is: Kino reads only `bytes` (any other field of the answer is dropped), and nothing
  scans the string on its way.

Each `read` has 20 seconds. What it throws (or a timeout) is what the person reads when the video stops, worded like
any other failed call; an answer that is not `{ bytes }` of the right length is refused as "El plugin no entregó los
datos del video". Calls to `read` come one at a time, and a call that started always runs to its end, even when the
person seeks meanwhile, so a connection you keep open between calls stays open. A byte stream may carry `subtitles`,
`audioTracks`, `durationMs`, `skip`, `label` and `media` like any stream; it is only for a movie, an episode or a track
(never a live channel nor a lazy alternative). It casts to a Chromecast or a DLNA TV when `mime` is a video or audio
file type other than MPEG-TS (`video/mp4`, `video/webm`, `video/x-matroska`, `audio/mpeg`...): the TV fetches it from
the phone over the home network, from a session of its own that ends with the cast (leaving the player doesn't stop the TV), and
every byte still comes from your `read`, which then also serves what the TV asks for. Kino never remuxes or converts
it for the TV, so a format the TV can't play as it is won't play there. It is never downloaded, so declaring
`download` is pointless for a plugin whose streams are all `{ source: "plugin" }`: its titles show the download
button, and every download fails as not downloadable. After 3
timed-out reads in a row Kino stops reading that stream until it is opened again (each timeout leaves your script's
evaluation running until it ends by itself).

### Images from the plugin (`imageSource`, apiVersion 13)

Kino draws a poster, backdrop or still from a public URL. Some pictures have no such URL: the thumbnail a messaging
service attaches to a video file, the cover inside a private library, an image behind your service's login. With
`imageSource` your plugin hands Kino an **image reference** instead, and Kino asks your plugin for the bytes when the card
comes on screen. Use it when only your plugin can fetch the picture; a public URL stays the better choice when there is
one (Kino loads it itself, without waking your plugin).

**Declaring it.** `imageSource` needs `"apiVersion": 13` and the export `image`. No consent line and no approval: it
reaches nothing new, it hands Kino pictures. Below 13 the manifest is refused with "The \"imageSource\" capability needs
apiVersion 13"; without the export the install fails with "El plugin no carga: le falta image".

```json
"apiVersion": 13,
"capabilities": ["home", "search", "resolve", "imageSource"]
```

**The reference.** Wherever these fields are read, a plugin that declares `imageSource` may answer an object instead of
a URL:

```json
{ "source": "plugin", "handle": "thumb:1234" }
```

- Fields: an item's `poster` and `backdrop` (Home rows, search, "Ver más", your section's rows), an
  episode's `still`, the `poster` and `backdrop` of `episodes().series` and of a `details` answer, and a section hero's
  `image`. Anywhere else (a channel logo, a category's `art`, a `meta` answer, a layout image) a reference is ignored like a
  bad URL, and so is a reference from a plugin that does not declare the capability.
- `handle` is yours and opaque to Kino: 1 to 512 characters, no control character. A malformed reference is no image;
  the item itself stays.
- There is no per-answer cap on references: Kino asks only for the pictures that come on screen, one at a time.
- Strings are always URLs. Kino turns your reference into an address of its own that names your plugin, and only Kino's
  own parser can make one: a string that looks like it is ignored, so no plugin can make Kino ask another plugin for an
  image.

**The `image` export.** Kino calls it with the handle you returned and expects the picture, base64-encoded:

```js
export async function image({ handle }) {
  return { bytes: "<base64 of the picture>", mime: "image/jpeg" };   // or "image/png", "image/webp"
}
```

- `bytes` is canonical base64 (the standard alphabet, padded, no whitespace or line breaks), at most 262,144 bytes
  (256 KB) once decoded. `mime` is `image/jpeg`, `image/png` or `image/webp`, and the bytes must really be that type (Kino
  checks their first bytes). A card's picture, not a photo: send the smallest size the service offers.
- It has 10 seconds. It runs in the background: nobody is asked anything, and a slow answer never marks your plugin "No
  responde".
- What it throws (any `kino.error` code), a wrong answer or a timeout: the card shows its placeholder, nothing more. The
  person never reads an error for a picture.

**What Kino does.**

| What | How |
| --- | --- |
| When | When a card with a reference comes on screen (phone and TV alike), never ahead of it. A card scrolled away before its turn is never asked for. |
| One at a time | At most 1 `image` call in flight for your plugin; the next waits for it. Another plugin's images are asked alongside. |
| Playback first | No `image` call starts while one of your [byte streams](#sockets-and-plugin-served-bytes-socket-and-bytesource-apiversion-13) is open (on the phone or served to a TV), or while your `read` is queued or running or ended less than 2 s ago: the video keeps its turn. An image waits up to 20 s for that to end (it starts as soon as the stream closes), then is skipped (asked again the next time the card is drawn). A `read` that comes while an `image` call runs waits for that one call, so answer fast. A timed-out `image` call costs your plugin its sandbox: QuickJS cannot be interrupted, so Kino discards the runtime, and with it any socket or session it holds, and the next call starts a fresh one. |
| Once | The picture goes to Kino's image disk cache, under your plugin, its installed version and the handle: the same handle is not asked again until the cache drops it or your plugin is updated (an update asks again, so a fixed picture shows). |
| Failures | A handle that failed is not asked again for 5 minutes. 2 timeouts in a row pause all your images for 5 minutes (each timeout costs your plugin its sandbox, and the connection it keeps). |
| A call that started | Always runs to its end and is stored, even if the card went away meanwhile: cancelling it would restart your plugin. |

**Privacy.** Kino keeps the reference wherever it keeps the title's poster: the library, the history, "Continuar
viendo", the person's lists. Those rows sync to the person's other devices and go into their backups, so never put a secret in a handle (a
token, a password, a signed URL): put an id there and the secret in a [sealed secret](#sealed-secrets-apiversion-4) or
`kino.storage`. A reference only loads on the device that read it from your answer; elsewhere (another of the person's
devices, a restored backup, a shared kit) it shows the placeholder. A reference is never sent to a Chromecast, a DLNA TV, the system's media controls or the TV launcher's rows: those get no
picture.

**Known limits.**

- A title saved with a reference (library, history, "Continuar viendo", lists) keeps that poster as saved: on another of
  the person's devices, after a restore, or after this device lost its image key (a reinstall, the app's data cleared),
  that saved poster stays the placeholder. Kino does not rewrite saved rows; your Home rows, search and pages show the
  picture again, because they come from your plugin's new answer on that device.
- A picture Kino refused when the card was drawn (your plugin was switched off, not set up, being updated or not
  installed at that moment, or the address was not this device's) is not asked again while that card stays on screen; it
  is asked the next time the card is drawn.
- Only the pictures on screen are asked, one at a time: a long row of references fills in card by card.

**A complete plugin.** A service whose thumbnails need the person's token: the item's `poster` is the public poster when
the service has one, and a reference otherwise. Kino asks `image` only for the second kind.

```js
// kino-plugin.json (the parts that matter): {"apiVersion": 13, "hosts": ["api.example.com"], "capabilities": ["home", "resolve", "imageSource"], "settings": [{"key": "token", "label": "Token", "type": "password", "required": true}]}
const API = "https://api.example.com";
const auth = () => ({ authorization: "Bearer " + kino.config.get("token") });

export async function home() {
  const videos = (await kino.fetch(API + "/videos", { headers: auth() })).json();
  return [{
    id: "latest",
    title: "Latest",
    items: videos.map((v) => ({
      id: "v" + v.id,
      ref: "video:" + v.id,
      title: v.title,
      kind: "movie",
      // A public poster when there is one; otherwise the thumbnail only this plugin can fetch.
      poster: v.posterUrl || { source: "plugin", handle: "thumb:" + v.id },
    })),
  }];
}

const MIMES = ["image/jpeg", "image/png", "image/webp"];

export async function image({ handle }) {
  const id = /^thumb:(\d{1,12})$/.exec(handle)?.[1];
  if (!id) throw kino.error("not_found", "unknown image handle");
  const r = await kino.fetch(API + "/videos/" + id + "/thumbnail?size=small", { headers: auth() });
  if (!r.ok) throw kino.error("not_found", "no thumbnail (" + r.status + ")");
  const mime = (r.headers["content-type"] || "").split(";")[0].trim();
  if (!MIMES.includes(mime)) throw kino.error("not_found", "not a JPEG, PNG or WebP picture");
  return { bytes: r.base64(), mime };
}

export async function resolve(ref) {
  const video = (await kino.fetch(API + "/videos/" + ref.slice("video:".length), { headers: auth() })).json();
  return { url: video.streamUrl };
}
```

A plugin that keeps the pictures itself (a thumbnail that came with a message it indexed) answers from `kino.storage`
instead: `const bytes = kino.storage.get(handle); if (!bytes) throw kino.error("not_found"); return { bytes, mime:
"image/jpeg" };`. Kino caches what you answer, so there is no need to keep a copy for Kino's sake.

**In the kit.** `checkOutput` keeps a reference of a plugin that declares `imageSource` as `{ source: "plugin", handle }`
and drops it otherwise, as Kino does. `askImage(plugin, manifest, ref)` from `sdk/kino-shim.mjs` asks your `image` the way
Kino does: the capability and the export, a valid reference, one call at a time, 10 s, and the answer's checks. It
resolves with `{ bytes, mime }` (a Buffer) or rejects saying why Kino would show the placeholder. It does not mirror
the wait behind playback, the 5-minute memory of a failed handle or the disk cache.

### Catalog (SQLite): `kino.catalog` (`catalog`, apiVersion 13)

A plugin whose source is a big library (every video of a Telegram channel, a site's whole archive, a self-hosted media
folder) needs to find things in thousands of records. Keeping them in `kino.storage` and filtering in JavaScript means
loading the whole list into your plugin's 64 MB of QuickJS memory on every search. `kino.catalog` keeps them in a SQLite
database that Kino owns for your plugin, and searches them there: your code only ever holds the page it asked for.

**Which store to use.**

| You keep | Use | Why |
| --- | --- | --- |
| Settings, a token, a cursor, a few small JSON values | `kino.storage` | 256 KB, synchronous, carried by a password-protected backup |
| A few big opaque blobs you read whole (a cached index file, a key bundle) | `kino.storage` with [`storageLarge`](#a-bigger-storage-for-a-catalog-storagelarge-apiversion-13) | 16 MB, one file per value, device-only |
| Thousands of records you search, sort and page through | `kino.catalog` | up to 100,000 items in a 64 MiB file (about 670 bytes per item on average, so keep `data` small), searched by Kino, never loaded whole |

#### Declaring it

```json
"apiVersion": 13,
"capabilities": ["search", "resolve", "catalog"]
```

`catalog` is declarative: nothing to export, no consent line and no approval (it is room on this device, not reach to
anyone). An older Kino refuses the manifest ("needs a newer version of Kino"), and a manifest below `apiVersion` 13 is
refused with "The \"catalog\" capability needs apiVersion 13". A plugin that does not declare it has no `kino.catalog` at
all (`typeof kino.catalog === "undefined"`), and neither does `sign()`.

#### The operations

Every operation is `async` (`await` it) and answers plain JSON values. All six, with their exact shapes:

| Call | Takes | Answers |
| --- | --- | --- |
| `kino.catalog.upsert(items)` | an array of at most 500 `{ id, title, sort?, data? }` | `{ count }`: how many items were written |
| `kino.catalog.search(options?)` | `{ q?, limit?, offset?, order? }`: `q` default `""` (everything), `limit` default 50 (1 to 100), `offset` default 0 (0 to 1,000,000), `order` default `"newest"` | `{ items, total }`: one page of `{ id, title, sort, data }` and the count of every match |
| `kino.catalog.get(ids)` | an array of at most 500 ids | the items found, in the order asked; missing ids are skipped, a repeated id comes once |
| `kino.catalog.remove(ids)` | an array of at most 500 ids | `{ count }`: how many were there and are now gone |
| `kino.catalog.clear()` | nothing | nothing: every item is gone and Kino deletes the file |
| `kino.catalog.count()` | nothing | the number of items |

A whole mini-plugin, runnable as it is (the Node kit's tests run this very code against a fake source). It indexes a
source that pages its videos newest first, a few pages per Home call so no call runs past its time limit; answers
`search` from the catalog only; drops a video the source deleted when someone tries to play it; and starts over once a
week (which also drops what the source deleted) or when the catalog comes back empty after a restore or a reset.

```js
// kino-plugin.json (the parts that matter): {"apiVersion": 13, "capabilities": ["home", "search", "resolve", "catalog"], "hosts": ["api.example.org"]}
const BATCH = 500;                         // maxUpsertBatch
const MAX_TITLE = 300;                     // maxTitleChars
const PAGES_PER_CALL = 3;                  // a few source pages per Home call
const ID_RE = /^[A-Za-z0-9._~-]{1,120}$/;  // fits a Kino Item id (128 characters) once prefixed with "v"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function sourcePage(cursor) {
  const url = "https://api.example.org/videos" + (cursor ? "?after=" + encodeURIComponent(cursor) : "");
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", "the source answered " + r.status);
  return r.json(); // { videos: [{ id, caption, date, file, poster }], next }, newest first
}

// At most `max` characters (JavaScript's length, as Kino counts them), never cutting a character in two.
function clip(text, max) {
  let t = String(text).slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t;
}

// One source video as a catalog item, or null to skip it. A caption can be missing or far longer than 300 characters,
// and one bad item would refuse its whole batch of 500: the title is never empty and always fits, the id fits Kino's
// Item id, and `data` holds only small fields.
function toItem(v) {
  const id = String(v.id);
  if (!ID_RE.test(id)) return null;
  const title = clip(String(v.caption || "").replace(/\s+/g, " ").trim(), MAX_TITLE) || "Video " + id;
  return {
    id,
    title,
    sort: Number.isSafeInteger(v.date) ? v.date : 0, // "newest" = the biggest date first
    data: { file: clip(v.file || "", 200), poster: v.poster ? clip(v.poster, 500) : null },
  };
}

async function upsertAll(items) {
  for (let i = 0; i < items.length; i += BATCH) await kino.catalog.upsert(items.slice(i, i + BATCH));
}

// The catalog stays on this device, but kino.storage travels in a backup: after a restore, on a new device or after a
// "damaged" reset the catalog is empty while the markers still say it was indexed. Start over then.
async function forgetIndexIfEmpty() {
  if (kino.storage.get("indexedAt") !== null && (await kino.catalog.count()) === 0) {
    kino.storage.remove("indexedAt");
    kino.storage.remove("cursor");
  }
}

// One step of indexing, from Home (20 s per call), never from search (15 s, and the person is waiting):
// - not complete yet: go on with the full pass where the last step stopped (a cursor in kino.storage);
// - complete: read from the newest video and stop at the first page holding an item already indexed;
// - a week after the last full pass: clear and index again.
async function indexStep() {
  const at = Number(kino.storage.get("indexedAt"));
  if (at && Date.now() - at > WEEK_MS) {
    await kino.catalog.clear();
    kino.storage.remove("indexedAt");
    kino.storage.remove("cursor");
  }
  const complete = kino.storage.get("indexedAt") !== null;
  let cursor = complete ? null : kino.storage.get("cursor");
  for (let i = 0; i < PAGES_PER_CALL; i++) {
    const page = await sourcePage(cursor);
    const items = page.videos.map(toItem).filter((it) => it !== null);
    const known = complete && items.length > 0 && (await kino.catalog.get(items.slice(0, BATCH).map((it) => it.id))).length > 0;
    await upsertAll(items);
    if (known || !page.next) {
      if (!complete) {
        kino.storage.set("indexedAt", String(Date.now()));
        kino.storage.remove("cursor");
      }
      return;
    }
    cursor = page.next;
    if (!complete) kino.storage.set("cursor", cursor);
  }
}

const toKinoItem = (it) => ({ id: "v" + it.id, ref: it.id, title: it.title, kind: "movie", poster: (it.data && it.data.poster) || undefined });

export async function home() {
  try {
    await forgetIndexIfEmpty();
    await indexStep();
  } catch (e) {
    // The source or the catalog is unavailable right now: show what the catalog already has; the next Home goes on.
    if (e.code !== "unavailable") throw e;
    kino.log("indexing paused: " + e.message);
  }
  const newest = await kino.catalog.search({ limit: 20 });
  return [{ id: "newest", title: "Newest", items: newest.items.map(toKinoItem) }];
}

export async function search(query) {
  // The catalog only: cheap enough for every keystroke, and never the network.
  const page = await kino.catalog.search({ q: String(query.q || "").slice(0, 256), limit: 50 });
  return page.items.map(toKinoItem);
}

export async function resolve(ref) {
  const [item] = await kino.catalog.get([ref]);
  if (!item) throw kino.error("not_found", "no longer in the catalog");
  const r = await kino.fetch("https://api.example.org/files/" + encodeURIComponent(item.data.file));
  if (r.status === 404) {
    await kino.catalog.remove([ref]); // the source deleted it: drop it now, not at the weekly rebuild
    throw kino.error("not_found", "the source deleted this video");
  }
  return { url: r.json().url };
}
```

A Kino `Item`'s `id` must match `^[A-Za-z0-9._~-]{1,128}$`; a catalog `id` can be any string of 1 to 128 characters, so
map it when yours has other characters or would pass 128 once prefixed (the example skips such videos; a hash of the id
works too).

#### How search matches

- **Case and accents do not matter.** Kino keeps each title lower-cased with its accents removed (Unicode NFD without
  the combining marks) and does the same to `q`: `"pelicula"`, `"PELÍCULA"` and `"Película"` all find "Película";
  `"nandu"` finds "Ñandú". Control characters other than whitespace (a NUL, an escape code) are dropped from both, so
  `"ab\u0000zz"` and `"abzz"` find the same items.
- **Every word must be there, in any order, as part of the title.** `q` is split on whitespace; each word must appear
  somewhere in the title: `"rojo gato"` and `"gato rojo"` both find "El gato ROJO", and `"gat roj"` finds it too. There
  is no ranking and no fuzzy match: an item either matches or not.
- **`%`, `_` and `\` are plain characters.** They are never wildcards: `"50%"` finds "50% off" and not "50 off";
  `"a_b"` finds "a_b" and not "axb". No query can run anything: there is no SQL on your side at all.
- **Empty, blank or absent `q` lists everything** (in the order asked).
- **Only `title` is searched**, never `id` or `data`. Put every word a person might type in the title.
- **Order.** `"newest"` (the default): `sort` from biggest to smallest; `"oldest"`: smallest first; `"title"`: by the
  title without case or accents, then the title as written, then the id. Ties are always broken by `id`, so the same
  query pages the same way every time.
- **`items` and `total`.** `items` is the page (at most `limit`); `total` is how many items match in all. There is more
  when `offset + items.length < total`.
- **Paging.** `limit` is 1 to 100 (default 50) and `offset` 0 to 1,000,000, whole numbers (`NaN` or `Infinity` is
  `invalid_request`); an `offset` past the end answers no items and the same `total`. `q` is at most 256 characters.

```js
await kino.catalog.search({ q: "gato rojo" });                                  // newest first, 50 at most
await kino.catalog.search({ q: "gato", order: "title", limit: 20, offset: 40 }); // the third page of 20, A to Z
const { total } = await kino.catalog.search({ q: "2001", limit: 1 });            // just the count of matches
```

#### The data model

One table, one row per item: `id` (your key, 1 to 128 characters), `title` (at most 300 characters; the only thing
searched), `sort` (a whole number, default 0: a date in milliseconds, a message number, an episode number) and `data`
(an optional plain object whose JSON is at most 4,096 bytes in UTF-8, given back as you stored it). Put in `data` the
few fields you show or need to play (a poster URL, a duration, a file reference), never blobs, pages of HTML or
credentials. `upsert` with an `id` that is already there **replaces the whole item**: a field you leave out is gone
(the `data` too). A batch is one transaction: if any item in it is refused, nothing of it is written, so clean your items
first (as `toItem` does above) rather than sending what the source gave you as it is.

**How many items fit.** Two limits hold at once: 100,000 items and a 64 MiB file. 100,000 items fit only when an item
costs at most about 670 bytes of the file on average: its id, its title twice (as written and without case or
accents), its `data`, and the two search indexes. Measured in Kino's tests with a 50-character title: about 370 bytes
with no `data` (100,000 fit, in 37 MB), about 690 bytes with 300 bytes of `data` (about 96,000 fit), about 920 bytes
with 500 bytes (about 72,000), and about 4,850 bytes with 4,000 bytes (about 13,800). Keep `data` small: a file
reference and a poster URL, not a description.

#### Limits and errors

| Limit | Value |
| --- | --- |
| Items per plugin | 100,000, if they fit in the file (see "How many items fit") |
| `id` | 1 to 128 characters |
| `title` | at most 300 characters |
| `data` | at most 4,096 bytes of JSON (UTF-8) |
| Items per `upsert`, ids per `get` or `remove` | 500 |
| `search` `limit` | default 50, at most 100 |
| `search` `offset` | at most 1,000,000 |
| `search` `q` | at most 256 characters |
| The database file | at most 64 MiB |

Every refusal is a `KinoError` whose `code` says what to do, and whose message names the limit:

| `code` | When | What to do |
| --- | --- | --- |
| `invalid_request` | A wrong shape or type: `upsert` without an array, an item without a string `id` or `title`, a fractional or non-finite `sort`, a `data` that is not an object, a `limit` of 0 or `NaN`, an unknown `order`. | Fix the call; the message says which item (`item 3`) and which field. |
| `too_large` | One value or one batch over its limit: `"kino.catalog.upsert: at most 500 items per call (maxUpsertBatch)"`, `"kino.catalog.upsert: item 0 data is over 4096 bytes as JSON (maxDataBytes)"`, a long `id` or `title`, `"kino.catalog.search: limit is over 100 (maxSearchLimit)"`, an `offset` or `q` over its limit. | Split the batch, shorten the value, ask a smaller page. |
| `limit` | The catalog is full: `"kino.catalog.upsert: the catalog is full (maxItems 100000)"` or `"kino.catalog.upsert: the catalog file is full (maxDbBytes 64 MiB)"`. | Remove items you no longer need (or `clear` and index less, with smaller `data`), then try again. |
| `unavailable` | Kino could not read or write the file right now (the device's storage failed or is full), or the plugin was just removed. When the file was corrupt, Kino deletes it and starts an empty one, and that call says `"kino.catalog: the catalog file was damaged and has been reset to empty; rebuild it"`. A file a newer Kino wrote (after the person went back to an older Kino) says `"kino.catalog: the catalog file was made by a newer Kino"` on every call until you `clear()` it. | Try again later; after "damaged", index again from your source; after "made by a newer Kino", `clear()` (it deletes that file and starts a new one) and index again. |

A refused `upsert` writes nothing of its batch, so retrying a smaller one is safe. Kino never deletes your catalog on an
I/O error: only a file SQLite reports as corrupt is replaced.

#### Isolation and privacy

- **One database file per plugin.** Your catalog is `catalog.db` inside your plugin's own data folder, named from your
  plugin's id alone; Kino picks it when it starts your plugin, and no argument you pass can name another plugin or
  another file. No other plugin can read or change your items, and you cannot read theirs.
- **No SQL from plugins, ever.** You only have the six operations above; every value you send is bound as a parameter.
- **It stays on this device: never synced, and excluded from backups.** It is a rebuildable cache of your source. No
  backup carries it, so on another device, after a restore there, or after the person uninstalls and reinstalls your
  plugin, it is empty: check `kino.catalog.count()` (as `forgetIndexIfEmpty` does above) and index again from your source.
- **Uninstalling the plugin deletes the file**, and a call of yours still running at that moment cannot create it again.
- **Credentials do NOT belong here.** Keep tokens and sessions in [sealed secrets](#sealed-secrets-apiversion-4), the
  person's settings or `kino.storage`, never in `data`.

#### Performance

- Write in batches of up to 500 items: each `upsert` is one transaction, much faster than one call per item.
- Never load the whole catalog into memory to filter it yourself: ask `search` for a page and let Kino do the
  matching. A page is at most 100 items.
- Page through big results with `limit`/`offset` instead of asking everything; read `total` with `limit: 1` when you only
  need the count.
- What it costs: a search reads every title once (a substring match cannot use an index to find words; the indexes
  carry the searched text so the rows themselves are read only for matches) plus the page asked for. Measured in Kino's
  JVM tests on a desktop computer (an Apple Silicon Mac), not on a phone or a TV box: two searches with their totals over
  50,000 items took 68 to 86 ms, with no `data` and with 500 bytes or 4,000 bytes of `data` per item alike. A phone or
  a 1 GB TV box is slower by a factor nobody has measured yet: test your plugin on the slowest device you support.
- Index from Home or a refresh of your own, a few source pages per call, never inside `search`: every call has its own
  time limit (15 s for `search`, 20 s for `home`) and the person waits for a search.

#### Recipes

- **Index a remote library incrementally.** As `indexStep` above: a full pass the first time, a few pages per call with
  a cursor in `kino.storage`; after that, read from the newest item and stop at the first page holding an item already
  indexed (`kino.catalog.get` answers it), `upsert`ing each page as you go. A full rebuild (`clear` then index) is for a
  schedule (once a week drops what the source deleted) or when your source changed shape.
- **Search as the person types.** In a "Ver más" page with `scopedSearch`, Kino waits 400 ms after the person stops
  typing before it calls your `search`, and a new query can follow right after: answer each call straight from
  `kino.catalog.search({ q: query.q })`, never from the network. While the catalog is still empty, answer what it has
  (nothing): Home fills it.
- **Say when older items are not loaded yet.** While the full pass is not complete (the `cursor` marker above is still
  there), add an item to your Home row, or a `userMessage` to an empty search, that says the library is still being
  read; drop it once `indexedAt` is set.

### QR scanning: `kino.qr.scan` (`qrScan`, apiVersion 13)

Some sign-ins are easier with a camera than with a keyboard, above all on a TV: the new device shows a QR code, and a
phone that already holds the account scans it and says "yes, let this device in". Kino gives you both halves, and
neither knows anything about your service:

- **Showing a QR:** the settings form's [`qr` setting](#settings) draws one from a text your `settingsStatus()` returns,
  and asks for it again every `refreshMs`, so a code that expires is replaced in place. It needs no capability.
- **Scanning a QR:** `kino.qr.scan()` opens Kino's own camera scanner full screen on the phone and gives you the decoded
  text. It needs the `qrScan` capability.

**Declaring it.** `qrScan` needs `"apiVersion": 13` and is declarative: nothing to export, no consent line, no approval
at install (the scanner only opens while the person is using your plugin, it names your plugin, and nothing is read
until they point the camera at a code). Below 13 the manifest is refused with "The \"qrScan\" capability needs apiVersion
13". Without the capability there is no `kino.qr` at all (`typeof kino.qr === "undefined"`), and `sign()` never has it.

```json
"capabilities": ["search", "resolve", "qrScan"]
```

**The call.** `await kino.qr.scan({ title?, titleEn? })` resolves with the scanned text, or `null` when the person
closed the scanner (the close button, Back, or leaving the screen). `title` is your line under your plugin's name
(`titleEn` is shown instead when Kino speaks English); each is optional, at most 80 characters, shown on at most two
lines, and may hold no control, bidi or format character (no line break, no right-to-left override, no invisible
character), so it can never pass for one of Kino's own lines. Anything else you pass is dropped.

**What the person sees.** The camera image with a frame to aim at and, at the top: "<your plugin's name> quiere leer un
código QR" ("… wants to read a QR code"), using the name of the plugin as installed (never a text you send), then your
`title`, then Kino's own instruction ("Apunta la cámara al código QR"), and a close button. The first code the camera
decodes that holds 1 to 4,096 characters answers your call and closes the scanner; a longer code is ignored, the
scanner says "Este código no es válido para <your plugin>" ("This code is not valid for …") and keeps looking. Without the camera permission Kino asks for it; if the person refuses, Kino explains why it needs
the camera, with Retry and Cancel.

**Where it works.** Only on a phone or tablet with a camera, in Kino's phone interface: on a TV (and on any device
without a camera) the scanner never opens and the call fails with `unavailable`. A scan runs
only from a settings `action`, a `panelAction` or a `screenEvent` that follows the person's press, that is, when the
person pressed one of your buttons: every other call fails with `not_allowed` ("kino.qr.scan only runs from a settings action, panelAction or screenEvent the person pressed"), even one the person started (Home, a search, a play, a list, a title
page, your section, `settingsStatus`), so the camera never opens by itself while someone browses. In a plugin screen
(apiVersion 14: a root screen, a panel in screen mode, a tab you contribute in screen mode) only the event of the
person's own tap or submit counts; the open event, a timer tick (`every`), a load-more, a change, a panel's `refreshMs`
and a `playerEvent` never open the scanner. The settings node inside a screen runs its `action` exactly as Ajustes does. While the scanner is up, that call's own time limit stops (the 30 s of an `action` does not run out
while the person looks for the other device); the scanner itself closes after 120 s with `timeout`. One scanner on
screen at a time, for the whole app: a second scan while one is open, yours or another plugin's, fails at once with
`busy`. Kino checks, in this order: the request (`invalid_request`), the device (`unavailable`), where the call comes from
(`not_allowed`), and the open scan (`busy`).

| Error `code` | When | What to do |
| --- | --- | --- |
| `busy` | A scan is already open (yours or another plugin's). | Wait for it; do not loop. |
| `timeout` | Nothing was scanned in 120 s. | Say so, and let the person try again. |
| `unavailable` | This device cannot scan: no camera, or Kino's TV interface. | Show the code another way: a settings `qr` setting, or a typed code. |
| `not_allowed` | The call is not a settings `action`, a `panelAction` or a `screenEvent` after the person's tap or submit (Home, search, a play, `settingsStatus`, a screen's open event, timer tick or load-more…). | Scan from a button: an `action` setting, a panel button or a screen button. |
| `permission_denied` | The person did not give Kino the camera. | Tell them they can allow it in the phone's settings. |
| `invalid_request` | `title` or `titleEn` is not a string, is over 80 characters or holds a control or formatting character, or the argument is not an object. | Fix the call. |

**Privacy.** You get only the text of the one code the person pointed the camera at, never an image or anything else the
camera saw. That text comes from the world: check it (its prefix, its length, its shape) before you act on it. Only your
plugin gets it, and only from the scan your call opened.

**Recipe: sign a new device in with a phone.** The new device (say, the TV) shows a login code in its settings; the phone
where the person is already signed in scans it from an action. The service here is a made-up `api.example.com` with three
calls: create a login token, ask whether it was accepted, accept it with a session. Both devices run the same plugin:

```js
// kino-plugin.json (the parts that matter): {"apiVersion": 13, "hosts": ["api.example.com"], "capabilities": ["search", "resolve", "qrScan"], "settings": [{"key": "state", "label": "Cuenta", "labelEn": "Account", "type": "status"}, {"key": "login", "label": "Escanéalo desde tu teléfono", "labelEn": "Scan it from your phone", "type": "qr", "refreshMs": 5000}, {"key": "link", "label": "Vincular otro aparato", "labelEn": "Link another device", "type": "action"}]}
const API = "https://api.example.com";
const PREFIX = "exampleapp://login?token=";

async function api(path, body) {
  const r = await kino.fetch(API + path, body === undefined ? {} : { method: "POST", body: { json: body } });
  if (!r.ok) throw kino.error("unavailable", path + " answered " + r.status);
  return r.json();
}

// The NEW device, not signed in: show a fresh login code, and keep the session once a phone accepted it.
// Kino calls this when the form opens, after every action and every refreshMs (5 s) while the form is on screen.
export async function settingsStatus() {
  if (kino.storage.get("session")) return { state: "Vinculado" }; // no "login" key: no QR is drawn
  let pending = JSON.parse(kino.storage.get("pending") || "null");
  if (pending) {
    const s = await api("/login/status?token=" + encodeURIComponent(pending.token));
    if (s.session) {
      kino.storage.set("session", s.session);
      kino.storage.remove("pending");
      return { state: "Vinculado" };
    }
  }
  if (!pending || pending.expires - Date.now() < 10000) {
    pending = await api("/login/token", {}); // { token, expires }: a new code before the old one runs out
    kino.storage.set("pending", JSON.stringify(pending));
  }
  return { state: "Esperando que lo escanees", login: PREFIX + pending.token };
}

// The phone, signed in: scan the new device's code and accept it with this phone's session.
export async function action(key) {
  if (key !== "link") return null;
  const session = kino.storage.get("session");
  if (!session) return { message: "Primero inicia sesión en este aparato" };
  let text;
  try {
    text = await kino.qr.scan({ title: "Escanea el código del otro aparato", titleEn: "Scan the other device's code" });
  } catch (e) {
    if (e.code === "unavailable") return { message: "Este aparato no puede escanear: hazlo desde tu teléfono" };
    if (e.code === "permission_denied") return { message: "Permite la cámara a Kino en los ajustes del teléfono" };
    if (e.code === "timeout") return { message: "No se leyó ningún código: inténtalo otra vez" };
    throw e;
  }
  if (text === null) return { message: "Cancelado" };
  if (!text.startsWith(PREFIX)) return { message: "Ese código no es de inicio de sesión" };
  await api("/login/accept", { token: text.slice(PREFIX.length), session });
  return { message: "Listo: el otro aparato ya entró" };
}

export async function search() { return []; }
export async function resolve() { throw kino.error("not_found", "this example plays nothing"); }
```

What happens: on the TV the form shows "Esperando que lo escanees" and the QR; every 5 s Kino asks `settingsStatus()`
again, which swaps in a new code before the old one expires and notices when the phone accepted it. On the phone the
person presses "Vincular otro aparato", the scanner opens under the plugin's name, they point it at the TV, and the
action accepts the token. At the TV's next refresh the line turns into "Vinculado" and the QR goes away. Pressing the
button on the TV itself answers "Este aparato no puede escanear" (`unavailable`): the same plugin, no special case.

**The `qr` setting's rules** (see [Settings](#settings)): its text is what `settingsStatus()` returns under its key, 1 to
512 characters, no control character; an `http`/`https` address must be https on a public host; any other text, such as
an app link like `exampleapp://login?token=…`, is drawn as it is; a text that would be longer, or that holds one of your sealed
secrets, draws no QR. `"refreshMs"` goes from 2000 to 60000 ms; without it the text is asked only when the form opens
and after an action. A refresh never cancels a `settingsStatus()` still running (that would restart your plugin and
close its sockets): the periodic one is skipped, and the one after an action waits for it and asks once more. The QR on
screen stays up until the new text replaces it.

**In the kit.** Node has no camera: `createKino(manifest, { qrScan })` takes a fake, `async ({ title, titleEn, invalid })
=>` the text "scanned", or `null` for a cancel; it may throw `kino.error("permission_denied")` and the like. Without one,
and with `device: "tv"`, `kino.qr.scan` fails with `unavailable`, as on a TV. The kit applies the same checks, in the same
order, with the same errors as the app: `not_allowed` unless the call is your plugin's `action` or `panelAction` (the kit
knows which export is running when it is called through `run.mjs` or `loadPlugin`), `busy` for a second scan while one is
open, `invalid_request` for a bad title. A code over 4,096 characters is ignored like on the phone: the kit asks your fake
again with `invalid: true` (the scanner keeps looking), and answers `timeout` after 10 ignored codes.

### Sync providers (`syncProvider`, apiVersion 12)

Kino keeps a person's devices in sync over the local network. A **sync provider** is another way
for that data to travel: the person's devices exchange one encrypted snapshot through a service your
plugin talks to (a chat with the person's own bot, a server of their own). The person picks it in
Ajustes de todos los perfiles ▸ Sincronización, where Kino lists the local network and every
installed provider; at most one is on per device (or none), and switching asks first and merges,
never overwrites. The choice belongs to that device: it never syncs, so each device turns its
provider on itself (with the settings a [pairing](#handing-the-settings-to-another-device-provision)
sent it). Every provider declares `sync.keySecret`: the sync key comes from that setting on each
device, so a manifest with `syncProvider` and no `keySecret` is refused.
Your plugin's own page in Ajustes (phone and TV) starts with Kino's button "Sincronización ▸
Proveedor", which opens that list (on the TV with your provider's row focused); you declare nothing
for it. Mark the setup the TV cannot do with [`devices`](#settings-for-one-kind-of-device-devices-apiversion-12-additive)
so the TV shows only what it needs.

```json
"apiVersion": 12,
"capabilities": ["syncProvider"],
"hosts": ["api.example.com"],
"settings": [{ "key": "token", "type": "password", "label": "Token", "required": true }],
"sync": { "mode": "poll", "pullEveryMs": 600000, "pushDebounceMs": 300000, "maxBlobBytes": 4194304,
          "keySecret": "token", "provision": ["token"] }
```

**A key Kino makes (`sync.generateKey`, apiVersion 13).** A provider whose service gives no
shared secret of its own (a person's own account, not a bot token) declares `"generateKey": true`
in its `sync` block. Kino then makes the `keySecret` value itself, 32 random bytes from a
`SecureRandom` as 64 lower-case hex characters, but only while that setting is empty, and at two
moments: when the person switches the provider on, and when they press "Enviar configuración"
(the key is made before the values are read, so an empty key never hides that button: it shows
as soon as your other `provision` settings hold values). It is saved exactly like a typed
password (sealed, synced end to end, per profile), never logged, and never drawn in your form on
any device (its value is kept and saved back with the rest). A value that exists, typed or
received, is never replaced; a value received from another device always replaces a generated
one. Your plugin needs no "Create key" action. Anything but `true` or `false` refuses the
manifest (`The "generateKey" of the "sync" field must be true or false`); below apiVersion 13 the
key is ignored.

```json
"sync": { "keySecret": "syncKey", "generateKey": true, "provision": ["syncKey", "api_id", "api_hash"] }
```

`syncProvider` may be your plugin's only capability (no `resolve`, `search` or `home` needed), or sit
next to the others. From `apiVersion` 13 a provider that plays nothing may also declare `socket`,
`storageLarge`, `catalog` and `qrScan` and still need none of them (`["syncProvider", "socket"]` for a
provider that talks over `kino.ws`); any other capability next to them brings back `resolve` and
`search` or `home`.

**The exports.** Each one receives **one object argument** (the runtime passes one JSON value):

```js
export async function syncPull({ maxBlobBytes }) {
  // -> { blob, version } with what you stored, or null when nothing is stored yet
}
export async function syncPush({ maxBlobBytes, blob, expectedVersion }) {
  // store blob; throw kino.error("conflict", "…") if the remote is no longer expectedVersion
  // -> { version }
}
export async function syncStatus() {               // optional; called with null
  // -> { ready: true } or { ready: false, message: "Falta vincular tu chat." }
}
```

- `blob` is standard base64 without line breaks: store it and give it back **byte for byte**. It is
  Kino's ciphertext; there is nothing in it for you to parse.
- `version` is an opaque, non-blank string you choose (a message id, an ETag, a counter). `syncPush`
  receives the version Kino last pulled (`null` when it pulled nothing). If your service can tell
  that the remote changed since (compare-and-set, `If-Match`), throw `kino.error("conflict", …)`:
  Kino pulls, merges and pushes again, at most 3 more times per round. If it cannot tell, ignore
  `expectedVersion`; the merge of the next round heals the race.
- `syncPull` and `syncPush` have 60 s each, `syncStatus` 15 s. They run in the background: nobody
  waits on screen and their timeouts never mark your plugin as "No responde".
- **Status.** `syncStatus` feeds your line on the provider row (scrubbed of your secrets). While it
  answers `ready: false`, or throws `auth_required`, Kino runs **no round** (no failure, no back-off,
  pending changes kept) and asks again one pull period later, when the person opens the screen or
  right after they save your settings. Without the export your provider is always ready. Any other
  failure of it shows your provider as not ready but lets the round run and fail on its own. A
  `syncPull`/`syncPush` that throws `auth_required` tells the person your provider lacks
  configuration and points them to Configurar.
- **Errors.** Use the usual [`kino.error` codes](#errors-people-understand); `conflict` is the one
  of its own. A `userMessage` follows the usual rules, so a sentence that names a token or a brand on
  the blocked list shows as Kino's own line.

**What your plugin and its service see.** Kino builds the snapshot (exactly the rows the local
network sync carries, for every profile this device syncs, with plugin passwords and the other
sealed values resealed row by row), compresses it and encrypts the whole of it with AES-256-GCM
under the **sync key**. Your plugin receives only that ciphertext; Kino never hands it the key or a
row. The key comes from `sync.keySecret` (the `key` of one of your own `password` settings, with no
`default`): Kino derives it on each device from that setting's value (HKDF-SHA256, host side), so a
second device only needs the same settings and no key ever travels. The derivation is public and
your code reads that setting, so **your plugin and its service CAN read the synced data**: the
consent line says so, always in red ("Sincronizará tus datos a través de su servicio: el plugin y su
servicio podrán leerlos" / "Will sync your data through its service: the plugin and its service can
read it"), on the install sheet and in the confirmation when the person switches your provider on (not on
the provider's card in Sincronización ▸ Proveedor). The value must be a long random token (a bot token, an API key), never a password a
person picks: anyone holding a stored blob can try guesses offline. While it is empty Kino runs no
round. A new value means a new key: the remote copy no longer opens (the person sees that the token
does not match, with "Corregir el token" and "Restablecer") until the person resets sync on one
device, which overwrites the remote with a fresh copy; the other devices keep syncing once they have
the new value (sent with "Enviar configuración" or typed).

Declaring `syncProvider` needs approval at install and again on an update that adds it: Kino never
approves it on its own. The logs of your `kino.fetch` calls carry the method, host, status, size and time only, never
the path or query, so a token in the path (`/bot<token>/…`) is not logged.

**When it syncs.** The provider declares its cadence in the manifest's `sync` block and Kino obeys
it within its own limits:

- `poll` (default): Kino pulls when the app comes to the front and every `pullEveryMs` (default 10
  minutes) while it is open, and pushes `pushDebounceMs` (default 5 minutes) after a change, at most
  one push per that period; playback positions are pushed when playback stops or the app goes to the
  background, not while they advance. "Sincronizar ahora" runs a round at once (still within the hourly ceiling below).
- `realtime`: the same, plus your plugin may call
  [`kino.sync.remoteChanged()`](#kinosyncremotechanged-kino-0974) when it learns that the remote moved,
  and Kino pulls at once.
- `pullEveryMs` is only the default: each provider's card in Sincronización ▸ Proveedor has
  "Sincronizar cada" (1, 5, 10, 30 or 60 minutes, starting at your value rounded to the nearest one),
  chosen per device and never synced. Your plugin is not told and needs nothing for it; the push
  debounce stays yours.
- Kino clamps the numbers to its floors (30 s between pulls, 5 s of debounce), runs at most 60 rounds
  an hour, and after a failure waits the pull period doubled per consecutive failure, up to 30
  minutes.

**Size.** `maxBlobBytes` is the largest blob your service takes (default and maximum 4194304,
4 MiB). Inside `syncPull` and `syncPush` only, `kino.fetch` requests and response bodies, and the
call's answer, may reach ceil(`maxBlobBytes` × 4/3) + 64 KB instead of the usual caps, so the blob
fits in one request; every other call of your plugin keeps them. The ceiling is 4 MiB because the
blob crosses the engine as base64 text several times: at 4 MiB it takes about 25 to 30 MB of the
plugin's 64 MB engine memory, so keep your own data small while those calls run. A snapshot bigger
than your limit is refused before it reaches you. To upload binary data without decoding it, send a
`{ base64 }` body with your own `Content-Type` (the Sync-Gram example builds a multipart body that way).

#### Handing the settings to another device (`provision`)

`sync.provision` lists up to 8 of your own settings that hold a value (secret or not; it must
include `keySecret`). On a device where the provider is set up, "Enviar
configuración" sends exactly those values to another device that shows "Recibir configuración": by
scanning its QR or typing its address and a 6-digit one-time code, over the local network. The
receiving device names the settings by their labels (and shows the value of a server address, saying
when it is on the local network) and applies them only when the person taps Aplicar; everything else
is refused. Received values are saved like typed ones but, as with an action's `setSettings`, Kino does
**not** run your `validateSettings` on them (they come from a device where your plugin already uses them). No sync key travels: the same settings give the same key. Settings you
leave out of `provision` are typed on each device. On a device that does not hold the `provision`
values it needs yet, your provider's card leads with "Recibir configuración" (with one line
saying how) and "Configurar" turns quiet; and while your `keySecret` is empty the card names that
setting by its label ("Falta «Clave de sincronización»: ve a Configurar"; a label with "token" says
"Falta el token"), or shows your own `syncStatus` line when it answers `ready: false` with one. On
the TV the card follows the provider's state: nothing received yet, only "Recibir
configuración"; received but not set up (Kino would offer "Configurar": the key is missing, your
`syncStatus` says not ready, or the last round needed setup), "Configurar" and a quiet "Recibir";
ready, "Sincronizar cada" and a quiet "Recibir". The TV never names a setting for a missing key: it
says to receive the setup from another device, so write your own TV lines the same way.

From `apiVersion` 13 `provision` may also name a password with [`"sync": false`](#settings-for-one-kind-of-device-devices-apiversion-12-additive),
for a **one-shot secret** the new device needs once (a two-step verification password, so the TV never
types it). It goes only while it holds a value on the sending device: blank (already used and
cleared), it is left out and never stops the rest from going. The sending screen adds a plain line
naming it by its label ("También se envía: Contraseña 2FA. En el otro aparato queda solo ahí: no se
sincroniza ni entra en las copias de seguridad." / "Also sent: 2FA password. On the other device it
stays there only: it never syncs or goes into backups."); the receiving device lists its label only,
never the value, and stores it sealed and device-only exactly as if typed there: never synced, never
in a backup. Your plugin clears it itself once used (an action's `clearSettings`). Never use it for a
lasting secret, and never as `keySecret` (refused).

Three complete providers to copy are in the [cookbook](#11-cookbook): [Sync
Servidor](#sync-providers-a-server-of-your-own-example-sync-servidor) (a server of the person's own),
[Sync-Gram](#sync-providers-a-telegram-bot-of-the-persons-own-example-sync-gram) (a Telegram bot of
the person's own) and [Sync-Gram
Cuenta](#sync-providers-the-persons-own-telegram-account-example-sync-gram-cuenta) (the person's own
Telegram account, apiVersion 13). The types are in `kino.d.ts` (`KinoSyncPullFn`, `KinoSyncPushFn`,
`KinoSyncStatusFn`, `KinoManifestSync`); `node sdk/validate.mjs .` checks the `sync` block like Kino
and shows the consent line.

### Channels from any server (`liveStreamHosts`, apiVersion 3)

IPTV lists name their streams on servers you cannot know ahead of time, often plain `http` and
often a bare public IP. For that, and only that, a `channels` plugin may add:

```json
"apiVersion": 3,
"capabilities": ["home", "resolve", "channels"],
"liveStreamHosts": "any"
```

It is read only with `"apiVersion": 3` (an older manifest ignores it, like any field it does not
know). There, `"any"` is the only value and it needs the `channels` capability: otherwise the
manifest is refused with `The "liveStreamHosts" field only takes "any"` or
`"liveStreamHosts" needs the "channels" capability`.

What it allows: **a live channel's stream** (the `url` of a channel's inline `stream`, or the `url`
`resolve` returns for a channel; items you mark as live are treated as channels) may be on **any
public host**, over `http` or `https`, a public IPv4 address included (not an IPv6 literal). The player then fetches that manifest and
its variants, segments and keys, and follows their redirects, under the same rule. The audio and
subtitle renditions the HLS manifest itself lists (`#EXT-X-MEDIA`) are part of that stream and follow
the same rule too; the `subtitles` and `audioTracks` you return in a `Stream` do not (see below).

What it never allows:

- the home network: private, loopback, link-local and carrier-grade NAT addresses, IPv6 literals,
  `localhost` and local names (`.local`, `.lan`, …), and a public name that resolves into any of
  them (refused when the player connects);
- other ports or schemes of a server the person typed: that server is reached exactly as typed,
  never "any";
- `kino.fetch`: your own requests still reach only your `hosts` and the person's servers;
- the playlist and XMLTV downloads a `{ playlist }` declaration asks Kino to make: those URLs must
  still be on your `hosts` (or the person's server);
- subtitles, audio tracks and a `drm` block's `licenseUrl`: still your `hosts` only, and every
  redirect they make is judged the same way;
- movies and episodes: a non-live `Stream` is checked exactly as before (unless your plugin declares
  [`streamHosts: "any"`](#playing-from-any-server-streamhosts-apiversion-4) or the person granted it the broad video permission, see
  [The `Stream` rules](#what-you-return));
- images: the poster rule (http or https, never local) does not change.

The consent sheet shows it in red, "Puede reproducir canales desde cualquier servidor que indique su
lista", and an update that newly adds it waits for the person's approval, like a new host.

### Signing every request (`signing`, apiVersion 6)

Some origins want a fresh signature on **every** request: a header that expires in seconds. Return
`signing: "request"` in the stream, and export `sign`:

```js
export async function resolve(ref, options) {
  const session = await openSession(options?.retry); // a retry says why: "conflict" or "expired"
  return { url: session.playlist, signing: "request", signContext: JSON.stringify({ token: session.token }),
           headers: { "Content-License": session.license } };
}

export async function sign({ url, kind, ref, context }) { // kind: "playlist" | "segment"
  const { token } = JSON.parse(context);
  return { headers: { "Content-Auth": await signatureFor(token, Date.now()) } };
}
```

Kino plays the stream through a local proxy. Before every playlist and segment request it calls
`sign()` and sends its headers, merged over the stream's own `headers`. Rules:

- **HLS only**: an HLS `mime`, or a `.m3u8` path. No `drm`, no `audioTracks` (subtitles are fine:
  they get the stream's own `headers`, like any stream's subtitles, but are never `sign()`ed).
  An inline `stream` of a `liveChannels` item can't ask for it: a channel that also has a `ref`
  plays through `resolve(ref)` (the inline stream is set aside), and one without a `ref` is dropped.
  A stream that breaks these is refused with `per-request signing only works with
  HLS video (.m3u8)`, `a video signed per request can't carry drm or separate audio tracks` or
  `a channel signed per request must play through resolve()` (the log's English detail; the person reads Kino's line). A signed video can't be downloaded: its download ends with `Este contenido no se puede descargar`.
- **`sign()` runs apart from your other functions**, so a slow `home` never delays a segment. It gets
  `kino.crypto`, `kino.secret`, `kino.config`, `kino.html` and `kino.log`, and nothing else:
  `kino.fetch` answers a `host_not_allowed` error ("sign can't use the network"), and `kino.storage`,
  `kino.cookies` and `kino.sleep` fail with the code `not_allowed` and "sign() can't use
  kino.storage: whatever you need must come in signContext" (likewise for the others). It also
  can't see anything the main runtime holds in memory. What it needs travels in `context`, the
  `signContext` your `resolve()` returned (a string of up to 4096 characters; a longer or non-string
  one refuses the stream with `the "signContext" value is not valid`). A `kino.secret()` marker means
  nothing there (a marker only works in the runtime that made it): call `kino.secret()` inside
  `sign()` itself; a `signContext` carrying one is refused with "signContext can't carry a
  kino.secret(): call it inside sign()".
- A stream asking for `signing: "request"` from a plugin that doesn't export `sign` is refused with
  "the plugin asks to sign the video but doesn't export sign()".
- **1.5 s per call.** A slow answer counts as a failed signature.
- Answer `{ headers }`, filtered like a stream's `headers` (same names and size rules). A value
  containing a `kino.secret()` marker is refused ("sign can't return sealed data"): a marker
  is only good inside `kino.crypto`, so compute the header there.
- Three failed signatures in a row stop the video.
- Below apiVersion 6, `signing` and `signContext` are ignored.
- **Reopening.** If the origin answers 409, or 401/403 twice in a row, Kino calls
  `resolve(ref, { retry: { reason, attempt, status } })` again: `"conflict"` (the access is in use
  elsewhere: get another one) or `"expired"`, `attempt` from 1 to 3, and `status`, the origin's HTTP
  status that caused it (401, 403 or 409; absent when Kino did not hear one), for your log. The budget refills once the
  video has played well for a minute; after the third retry the person sees the error. `options` is `undefined`
  on a normal call, and only apiVersion 6 plugins ever get it.
- **Other hosts that serve the same stream** (`alternateHosts`, up to 6 `"host"` or `"host:port"`, no
  scheme or path): Kino tries the playlist on each, the one that served last first, for up to 3 rounds,
  and moves a segment, key or map to another host when its own fails 3 times. `sign()` always gets the
  URL of the host being asked, so choose that host's token from `context`. Each entry meets the same
  host rule as `url`: a declared host (plain http only on one declared `insecureHttp`), or any public
  host under `liveStreamHosts: "any"`, never a local one. An entry that fails it, repeats `url`'s host
  or another entry, or comes after the sixth is dropped (`run.mjs` and `validate.mjs` show it as
  `[dropped by Kino]`); a value that is not an array of strings refuses the stream with
  `the "alternateHosts" value is not valid`. With them, the stream counts as `"expired"` only when
  **every** host rejected the signature, and as `"conflict"` only when the last one answered 409; a
  host answering 404 or not at all just moves Kino on. A host the playlist names that is not one of
  these is never swapped. Ignored without `signing`.
- **Chromecast and DLNA.** A signed stream can be sent to a TV like any other HLS. The TV never
  signs anything: it pulls the stream through Kino on the phone, which calls `sign()` for every
  playlist and segment the TV asks for, exactly as for its own player (the same 1.5 s limit, the same
  "three failed signatures stop the video"). So the phone must stay on the same Wi-Fi as the TV with
  Kino running for the whole cast. If the origin refuses the stream while the TV plays it (the
  **Reopening** rule above) while the player is open on the phone, Kino calls `resolve(ref, { retry })`
  again and the TV reloads it from the same point (a live channel from its edge). Once the person
  leaves the player, a Chromecast keeps playing until it is stopped or sent something else, but a
  refusal is no longer re-resolved: the TV's playback just ends. Leaving the player stops a DLNA TV,
  as for any title. A signed stream with `drm` is never cast. Kino plays one signed stream at a time:
  opening another one on the phone ends the cast of the first.

  ```js
  return { url: "http://cdn1.example/live/ch.m3u8", signing: "request",
           alternateHosts: ["cdn2.example", "cdn3.example:8080"],
           signContext: JSON.stringify({ "cdn1.example": t1, "cdn2.example": t2, "cdn3.example:8080": t3 }) };
  // sign({ url, context }): const tokens = JSON.parse(context); const token = tokens[new URL(url).host];
  ```

Test it from your terminal: `node sdk/run.mjs ./plugin.js sign '{"url":"https://cdn.example/seg.ts","kind":"segment","ref":"<ref>","context":"<signContext>"}'`
runs `sign` in the same restricted lane, and `node sdk/run.mjs --retry conflict:1 ./plugin.js resolve '<ref>'` (or `conflict:1:409` to pass a `status`)
calls `resolve` with a retry.

### Moving saved titles to your plugin (`migrate`, apiVersion 6)

When your plugin changes how its refs look, or takes over titles another source used to open,
declare the `migrate` capability and export `migrate(input)`. Kino calls it in the background for
every value it has saved and can no longer open: a library title (`{ kind: "title", ref }`), each of
its chapters (`{ kind: "chapter", ref, season, episode }`) and live favorites or recents
(`{ kind: "live", provider, code }`). Answer with what `search()` would return for it today —
`{ kind: "movie" | "series", id, ref }`, `{ kind: "episode", ref, season, number }` or
`{ kind: "live", code }` — or `null` when it is not yours. From apiVersion 8 a title may also be
answered as `{ kind: "music" | "podcast", id, ref }` (below 8 that answer is no claim).

- Declaring `migrate` adds "Revisar lo que tienes guardado (biblioteca, historial, favoritos) para
  pasarlo a este plugin" to the consent sheet, and an update that adds it waits for the person's
  approval like any new reach: your plugin sees what they saved.
- Kino asks the installed plugins with `migrate` in order of their id; the first answer wins.
- A series moves only when every saved chapter is answered as an `episode`.
- A `music` or `podcast` title moves in the shape your plugin saves it in from then on. If you
  declare `episodes`, it is an album or show: every saved row is asked about as a chapter and must be
  answered as an `episode` (a saved row with no ref and no number can't be one, so the title stays).
  Without `episodes`, it is a lone track: it moves like a movie, with no chapter asked, and only when
  one row is saved (with more, the title stays). Either refusal is logged and remembered like a `null`.
- Watched progress, intro/outro marks, downloads and favorites move with the title.
- A `null` is remembered until your plugin's next version, so returning `null` is cheap. So is a
  throw from your own code, or a `kino.error` with any code but `timeout`, `network`,
  `host_not_allowed`, `unavailable`, `rate_limited` or `auth_required`: those few mean "not now",
  and Kino asks again on a later run (meanwhile no plugin after yours is asked about that value).
- Never return a ref that starts with `plg1:`; never fetch from inside `migrate` unless you must:
  it runs for every saved value, 10 s each.

### Your own section, categories and colors (apiVersion 6)

Three optional widenings, all from `"apiVersion": 6`. None of them needs a capability of its own.

**A section of your own.** Declare `"section": { "label": "Demo" }` (1 to 20 characters; apiVersion 9, Kino 0.9.55, adds an optional
`"labelEn"`, same limit, shown when the app is in English) and export
`section({ tab })`:

```js
export async function section({ tab }) {   // tab is null the first time
  const tabs = [{ id: "pelis", label: "Películas" }, { id: "series", label: "Series" }];
  const chosen = tabs.some((t) => t.id === tab) ? tab : "pelis";
  return {
    tabs,                                    // optional, at most 8, labels at most 24 characters
    tab: chosen,                             // the tab this answer is for
    hero: { title: "Destacado", text: "…" }, // optional; also image (http or https); text at most 300 characters
    rows: [{ id: `${chosen}-a`, title: "Destacadas", ref: `${chosen}-a`, items: [/* KinoItem */] }],
  };
}
```

- `rows` are exactly the rows of `home` (same shape, same checks and limits); a row with a `ref` gets
  "Ver más", which calls `browse(ref, null)`. Return `rows: []` for an empty tab: Kino says there is nothing there.
- Choosing a tab calls `section({ tab })` again with that tab's `id`. 20 s per call.
- Where it shows: on the **TV**, an entry in the sidebar after "Categorías" (at most 3 plugins have
  one); on the **phone**, a chip in the strip at the top of Inicio (scrollable, at most 8). Only plugins
  that are enabled, usable and need no setup appear: one that is off, or still asks for a required
  setting, gets no entry. Entries are ordered by label, then by plugin id. A call that fails shows an
  error inside the section and never touches the rest of the app.
- A manifest that declares `section` must export it: the install fails otherwise, like any other
  required export.

**Your own categories.** Not to be confused with the manifest's `categories` field, which only tags your
plugin for the marketplace chips (see the [manifest table](#3-the-manifest)): this one is an export, and what it
returns are tiles that people browse inside Kino. Export `categories()` (needs the `browse` capability; no
manifest field, Kino sees the export):

```js
export async function categories() {
  return [{ id: "accion", title: "Acción", ref: "accion", art: "https://image.tmdb.org/t/p/w500/x.jpg" }];
}
```

At most 24 tiles, shown in your order; `title` at most 40 characters, `ref` at most 4,096, `art` an
image URL (the Images rule of [section 4](#what-you-return): `http` or `https`, not checked against `hosts`). They appear in Categorías as one group named after your plugin, and each
tile opens `browse(ref, null)`, paged like any `browse`. If `categories()` fails or times out you
simply contribute no group. 20 s per call. A tile with `adult: true` is shown only while the person's
18+ code is unlocked on that device, like any [18+ entry](#what-you-return); a group left with only such tiles is not shown.

**Your colors.** `"theme"` takes up to five colors, each `#RRGGBB`, each optional:

```json
"theme": { "accent": "#3D5AFE", "onAccent": "#FFFFFF", "background": "#101820", "surface": "#1A2733", "highlight": "#F7C948" }
```

| Token | What it paints |
| --- | --- |
| `accent` | in your section, your Ajustes tab and your Configurar screen: selected chip and tab, buttons, focus, the "Ver más" arrow; in the player: the progress bar, the slider, active states and the TV focus border |
| `onAccent` | text and icons drawn on top of `accent` |
| `background` | the screen behind your section, your Ajustes tab and (since Kino 0.9.55) your Configurar screen (Plugins ▸ Gestionar ▸ Configurar, or "Configurar" from an error) |
| `surface` | in your section: the cards, the "Ver más" card and the tabs that are not selected; since Kino 0.9.55 also the cards of your Ajustes tab on the phone (your settings, Modo debug, telemetry, "Enviar lo que veo") |
| `highlight` | emphasized text there; in Categorías, the title of your group |

Scope: your section, your Ajustes tab, your Configurar screen (Kino 0.9.55+), the title of your group in Categorías (only that title, in
`highlight`; its tiles and background stay Kino's) and, while your content plays, the player's
`accent` and `onAccent` only (the player keeps Kino's background and surfaces). Nothing else in
Kino changes, and **errors are always shown in Kino's red**, whatever your theme says.

Kino protects readability, so each color is checked when it is used:

- `background` must be dark (relative luminance at most 0.05).
- `surface` must be dark (at most 0.12) and at least 1.05:1 apart from the background.
- `accent` must reach 3:1 against the background.
- `onAccent` must reach 4.5:1 against `accent`.
- `highlight` must reach 4.5:1 against the background.
- No color may be close to Kino's red `#E50914` (CIE76 distance below 25).

A color that fails falls back to Kino's own for that token only (`accent` and `onAccent` are judged and
fall back **as a pair**); the install still succeeds and the other colors stay. A color that is not a
valid `#RRGGBB` is refused at install time. Preview it, with the ratios and the warnings Kino would
print, before publishing:

```
node sdk/run.mjs . theme
```

`sdk/validate.mjs` shows the same warnings. A complete example of the three is `plugins/sdk/test/section-demo`
(its `highlight` fails on purpose so you can see the fallback).

### Sealed secrets (apiVersion 4)

A plugin that ships a fixed key (an API token baked into a site's own client, a per-tenant secret its
author owns) can seal it instead of writing it into the manifest as plain text:

```
node sdk/seal.mjs --repo owner/repo --name apiKey
```

(`owner/repo/path` for a plugin that lives in a subfolder.) `--repo` follows the same rules as the
address people install from: a trailing `/` and a `.git` are dropped, but a URL
(`https://github.com/...`) and an `@ref` are refused rather than guessed at. The value is read from a
hidden prompt or piped on stdin — never as a command-line argument, which would land in shell
history. It must be 1 to 4,096 bytes (UTF-8) — up to 8,192 with `"apiVersion": 6`; the tool prints one line, `kino-sealed:v1:...`, to paste
into the manifest:

```json
"apiVersion": 4,
"secrets": { "apiKey": "kino-sealed:v1:AbC123..." }
```

- Up to 16 secrets; each name matches `^[A-Za-z][A-Za-z0-9_]{0,31}$`. `secrets` needs
  `"apiVersion": 4`; below that the field is ignored (the plugin installs with no secrets, and
  `kino.secret` throws for every name), and a device running an older Kino refuses the whole install
  with "Este plugin necesita una versión más nueva de Kino" — the release that includes sealed
  secrets (apiVersion 4).
- A seal is bound to the repository (and subfolder) you passed `seal.mjs`, lowercased, **never to a
  ref**. But it only OPENS when the plugin is installed with no explicit `@ref` at all — its default
  branch (`HEAD`); see below. At install and at every update Kino opens each seal once against the
  address the person is installing from, only to check it belongs there; each run of the plugin opens
  them again, in memory, for that run alone. A seal made for a different repository, path or name, or
  one that was corrupted, is refused with "Los datos sellados de este plugin no son para este
  repositorio o están dañados"; a build that cannot open seals at all (no native X25519) refuses with
  "Este Kino no puede abrir datos sellados".
- **Only from the default branch, never an explicit `@ref`.** GitHub serves any commit reachable in a
  repository's fork network — a fork's or a pull request's — through the parent repository's own
  address, and not only for an obvious SHA: a short hex prefix or a git-describe ref
  (`v1-0-g<sha>`) resolves the same way. So `owner/repo@<anything>` can be someone else's manifest,
  with their own `hosts`, while the seal still reads `owner/repo`. A plugin with secrets installed or
  updated with any explicit `@ref` — branch, tag, commit, whatever it's named — is refused with "Los
  datos sellados solo funcionan si instalas el plugin desde su rama principal, sin @rama", and a run at
  such an address gets no secrets. Only `HEAD` (no `@ref` at all) works.
- A seal trusts the repository's *name*: if its owner is renamed or deleted and someone else
  registers that name, their repository opens your seals. Seal again for the new name, and rotate the
  value if the old one was worth protecting.
- Declaring any secret adds "Usa datos sellados por su autor" to the consent sheet; an update that
  brings secrets to a plugin that had none asks again, exactly like a new host. Adding, changing or
  removing a secret in a plugin that already declared some does not.

#### Typed cipher keys (apiVersion 6)

A sealed value used as the key of `kino.crypto.encrypt`/`decrypt` can be declared as a key, so Kino
reads its bytes with an encoding fixed in the manifest instead of whatever `keyEncoding` the code
passes. That is what lets a sealed key work for `des-ede3-*` too (an untyped sealed key stays AES-only):

    node sdk/seal.mjs --repo owner/repo --name portalKey --use cipher-key --encoding hex

prints one JSON line to paste as the secret's value:

```json
"apiVersion": 6,
"secrets": { "portalKey": { "seal": "kino-sealed:v1:...", "use": "cipher-key", "encoding": "hex" } }
```

- `use` must be `"cipher-key"`; `encoding` is `"hex"` or `"base64"`; no other field is allowed.
- The value must decode, under that encoding, to a 16, 24 or 32-byte key: `seal.mjs` refuses anything
  else, and Kino refuses the install with "El secreto "portalKey" debe ser una clave de 16, 24 o 32 bytes".
- `kino.secret("portalKey")` works as the **whole** `key` of any `encrypt`/`decrypt`; the `keyEncoding`
  you pass is ignored. It is refused, with "a sealed value can't be used here", as an HMAC key, a
  `pbkdf2` input, anywhere in `data`/`iv`/`aad`, and anywhere in a `kino.fetch` request (the URL,
  header names or values, a text, JSON or form body): a typed key is for `kino.crypto` only and never
  goes on the wire.
- Below apiVersion 6 an object here is not a seal: the manifest is refused.
- The SDK kit simulates all of this from the plain value in `.kino-secrets.json`; the key's bytes, in
  hex (either case) or base64, are also redacted from anything a server sends back.

**What this protects, and what it does not.** This is obfuscation, not secrecy: the private key that
opens a seal ships inside every copy of Kino. Sealing a value keeps it out of your manifest and your
repository's history — it does not stop someone from pulling Kino's key apart and opening the seal
themselves, any more than it stops the site you call from seeing the plain value on its own end.
Don't bother sealing a value that is already public: a key already sitting in that site's own player
JavaScript gains nothing from being sealed in yours.

**`kino.secret(name)`** answers a marker string for a name your manifest declares (any other name
throws). Carry the marker wherever you would carry the value — it is not the value itself, just a
placeholder Kino recognizes later:

```js
const key = kino.secret("apiKey");
await kino.fetch(`https://api.example.org/v1/list?key=${key}`);
```

Kino swaps a marker for the real value **only inside `kino.fetch`**: in the URL's path and query
(percent-encoded, so the value can't split a segment or add a parameter; a `:` stays literal, so an
`id:secret` token such as a Telegram bot token reaches `/bot<token>/…` as sent), inside a JSON body
(JSON-escaped), and as is in headers, a text body or a form field. A marker in the URL's scheme,
userinfo, host, port or fragment is left as text — a value never becomes part of the host Kino
connects to. A header whose value would carry a control character once the secret is in it is
refused rather than sent.

**The request then reaches only a host your manifest's `hosts` lists, over `https`, on every redirect
hop** — never a host approved reactively while the plugin runs, never a server the person typed into
your settings, and the broad `liveStreamHosts: "any"` permission does not extend to it either. A hop
anywhere else fails as `host_not_allowed`: "this plugin can't send sealed data to `<host>`" for
a host you did not declare, "... without https to `<host>`" for plain `http` even on a declared one.

**`kino.crypto`.** A secret's marker may be the *entire* `key` of an AES `encrypt`/`decrypt` —
exactly one marker, nothing else in the string — or be part of a longer HMAC `key` or PBKDF2
`password`/`salt`. It is always refused, with "a sealed value can't be used here", as `data`, `iv`
or `aad`, as part of a longer cipher `key`, and as the key of a non-AES cipher (`des-ede3-*`: read
under a `keyEncoding` you choose, each of its bytes can carry little entropy, which puts a 3DES key
in reach of a search). That is not an arbitrary line: a known `iv` or `aad` under a sealed key
lets a cipher be turned into a way to compute the key back (the same block decrypted under CBC with
the known iv, XORed with the same block under ECB, is the iv itself — and with the key's own marker
used as the iv, that recovers the key), and a key padded out with known bytes shrinks the search down
to the unknown part alone. HMAC and PBKDF2 mix their whole input through a hash before anything comes
out, so a known prefix or suffix next to the secret never splits it back out.

**Redaction.** Anything Kino hands back to your code that could carry a sealed value — `r.text()`,
`r.url`, header values, a text body's `r.base64()`, `kino.cookies.get`, an error message, a
`kino.crypto` answer, and every `kino.log` line — has the value swapped back for its marker first,
whether or not this run has used the secret yet (a cookie set in an earlier run, or a server echoing
the value to a request that never carried it, is caught too). The forms caught: raw, URL
percent-encoding (strict, the `+`-for-space form, and the `%20`-for-space form), JSON-escaped —
including with `/` written as `\/` and non-ASCII as `\uXXXX` in either hex case, as PHP's
`json_encode` and Python's `json.dumps` write them — and base64/base64url. A URL the server returns
with the value inside it comes back with the marker instead, so a `Stream` built from it won't play:
markers are swapped only in `kino.fetch` requests, never in what your plugin returns to Kino. What it
does **not** catch: a binary response (`r.base64()` of something that was
never text) is not scanned, a response header's *name* is not checked (only its value), a lowercase
`%xx` a server happens to echo is not one of the forms above, and a server that transforms the value
on purpose (hashes it, reverses it, ...) leaves nothing left to recognize. A `kino.crypto` error can
still say how many bytes a sealed key was, or whether it was valid hex or base64 — metadata, never the
value. Prefer values of at least 8 bytes: a shorter one is still masked wherever it shows up inside
unrelated text, which gets noisier the shorter it is.

**Testing.** The Node kit can never open a seal — it has no private key — so it reads the plain value
straight from `.kino-secrets.json` next to your manifest (`{ "apiKey": "..." }`; the scaffold's
`.gitignore` already keeps it out of git) and simulates every rule above: markers, substitution, the
host-and-https check, the `kino.crypto` restrictions and redaction. `--record` never writes the plain
value to a fixtures file either — a canonical placeholder stands in for it, so a committed recording
never carries a secret however it is replayed later. See [section 7](#7-test-it-locally).

### Signed plugins (apiVersion 5, Kino 0.9.45+)

Strictly optional: you may **sign** your plugin with your own author key, so the people who install
it know every update comes from you. Your code stays plain, readable JavaScript — signing hides
nothing. Nothing changes for any unsigned plugin, at any apiVersion.

```json
"apiVersion": 6,
"entry": "plugin.js",
"signature": { "authorKey": "<64 hex>", "value": "<128 hex>" }
```

Kino 0.9.44 and older refuse an apiVersion 5 manifest with "Este plugin necesita una versión más
nueva de Kino"; `sdk/validate.mjs` reminds you. Below apiVersion 5 a `signature` is ignored.

**What is signed.** `value` is an Ed25519 signature, by the key in `authorKey`, over the UTF-8 text

```
kino-signed-entry:v1\n<owner/repo[/path], lowercase>\n<id>\n<version>\n<sha256 hex of the entry file>
```

So it covers your exact `plugin.js` and is bound to the repo (and folder), the plugin `id` and the
`version`: it can't be replayed onto another repo, plugin or version, and a single changed byte of
the script breaks it. The ref is not part of it: a signed plugin installs from any branch or tag.

**What Kino does.** At install and at every update — never when the plugin runs, so it costs
nothing at runtime — Kino downloads the script, checks the signature (refused with "La firma del
autor no es válida…" before anyone is asked) and **pins your key** the first time (trust on first
use). The consent sheet just says "Firmado por su autor"; the plugin's details (phone: Gestionar; TV:
the installed plugin's actions) show "Clave del autor: ABCD-EF01-2345-6789" (the first 8 bytes of the
key's SHA-256, also printed by `validate.mjs`). Catalog and community cards carry a "Firmado" pill, and
an installed card says it on its status line ("Activo · Firmado").

**Updates.** Every update must be signed with the **same** key. An update signed by another key, or
no longer signed, is refused ("Esta versión está firmada con otra clave de autor…" / "Esta versión
ya no está firmada por su autor…"); only uninstalling and installing again accepts it. So keep your
key safe and backed up: losing it means everyone has to reinstall. An unsigned plugin that becomes
signed asks the person again before updating.

**The same plugin at two addresses.** A plugin is normally known by the exact address it was
installed from: the same `id` from another repo is another plugin (a second install of that `id` is
refused with "Ya hay un plugin con ese id"). A signed plugin is the exception: when the person has
your plugin from one repo on their phone and from another repo on their TV, both installs are
**the same plugin** when they have the same `id` and both pinned the **same author key**. Then
switching it on or off, the approved hosts, the settings and passwords (still sealed end to end, per
setting), and an uninstall sync between those devices both ways, exactly as for one address. Each
device keeps the address it installed from and keeps updating from it; nothing is moved. An
unsigned install on either side, or another key, keeps the exact-address rule: never merged, and
neither ever receives the other's settings or passwords. Your manifest's own sealed `secrets` are
bound to each repo and never travel between devices, so sign and seal each repo's manifest for that
repo. If you publish the same plugin at two addresses (a move, a mirror), sign both with the same key.
In the recommended list, an entry that names your key (`"signed": true, "authorKey": "<64 hex>"`)
shows "Instalado" for someone who already has your plugin from your other repo; any other plugin
with that `id` installed here makes the entry say "Ya tienes otro plugin con ese id" ("No disponible",
nothing to install).

**The workflow.**

```
node sdk/seal.mjs --keygen                       # once: writes kino-author-key.pem (never commit it)
node sdk/seal.mjs --sign --repo owner/repo       # signs plugin.js, writes "signature" into kino-plugin.json
node sdk/validate.mjs . --repo owner/repo        # checks the signature, exports, and that no *.pem is tracked
```

Sign again after **any** change to the entry file or the `version` — `validate.mjs` fails until you
do. `--sign` takes `--manifest` and `--key` (default `kino-author-key.pem`); `validate.mjs` reads the
repo from the folder's GitHub `origin` when you omit `--repo`. **Never commit the key**: put
`*.pem` in `.gitignore`; `validate.mjs` fails when one is tracked.

**What it does and doesn't protect.** It proves each update was signed by whoever held the key at
the first install: someone who gets push access to your repo (or a compromised account) can't ship
an update people accept without your key. It does not make the first install trustworthy (that is
what the first-time line says), it does not protect a leaked key, and it does not hide your code.
Keep using `secrets` for keys and tokens.

### Nuvio scrapers (converted by Kino)

Kino turns a Nuvio repository (its `manifest.json` plus the scraper files) into a plugin on the
person's device; nothing here is for plugin authors to write, but it tells you what a scraper may
rely on.

Where the repository may live:

- **On GitHub**: `owner/repo`, a github.com page, or its `manifest.json` on raw.githubusercontent.com
  or jsDelivr (`/gh/`). Each scraper's `filename` is a path inside the repository, read from
  raw.githubusercontent.com.
- **On any public https server**: paste the URL of its `manifest.json`. A pasted URL
  is read once and judged by what it contains, whichever tab it was pasted in: a `scrapers` list
  (entries with `id` and `filename`) is a Nuvio repository, `resources` is a Stremio addon, both
  opens what the selected tab says, neither is refused. The address must be `https` on a public
  name: `http`, an IP address, `localhost`, a local name (`.local`, `.lan`…) or a name that
  resolves into the person's network is refused, and so are credentials in the URL. The manifest
  is at most 256 KiB.
- **Scraper files**: a relative `filename` is resolved against the manifest's URL; an absolute
  `https://` one may be on another public server (a CDN), under the same rules. `http://`, a local
  server, `/root-relative`, `//protocol-relative` or `../` filenames are refused with a message
  saying why. A scraper's sibling files are read from the server its own file is on.

What converts:

- **Nuvio globals and shapes**: `window`, `self` and `SCRAPER_ID`; `getStreams` exported through
  `module.exports`, `exports.getStreams`, `default` or as a global; regenerator-based async code;
  `require` calls inside `try`/`if` (bundled when the target is a sibling file).
- **A Node subset**: `path`, `url`, `util`, `events` and `http`/`https`/`undici` (over `kino.fetch`).
  `fs`, `child_process` and the like load as empty modules: every member reads as `undefined`, so a
  scraper's own feature check falls back to `fetch`, and calling one anyway is a `TypeError`.
- **Multi-file scrapers**: sibling files are read from the same repository (or, for a scraper whose
  file is on another server, from that server), through the same fetcher (no new destination). At
  most 16 files and 1 MiB in total; `../` inside the repository is fine, a path that escapes the
  repository or the server's root (also `%`-encoded) is refused.
- **Every playable copy** `getStreams` returns becomes a labelled alternative (at most 8; embed
  pages go last, so the player tries real video files first and falls back by itself). Only `http`
  and `https` addresses play. 30 s per request; `apiVersion` 6.
- **Settings**: a scraper's `onSettings` becomes the plugin's settings form (synced between devices
  like any plugin setting). A debrid setting is refused.
- A timer a scraper leaves running is cleared once `getStreams` settles, so a call does not wait
  for it.

What is refused, and why: **scrapers of peer-to-peer sources, with or without debrid**. Kino does not
carry torrents, so the card says "No compatible" and "Kino no admite scrapers de torrents, ni
siquiera con debrid"; it is judged like a Stremio peer-to-peer addon. A converted scraper plays only
`http`/`https` copies; when all it returned was an `infoHash` or another explicit scheme, the person
sees "solo enlaces P2P".

## 4. The contract (apiVersion 1 to 14)

Your entry file is one ES module that exports one `async` function for each capability you
declared, and nothing is called that you did not declare:

```js
export async function search(query) { /* -> Item[] or Page */ }
export async function home() { /* -> Row[] */ }
export async function browse(ref, cursor) { /* -> Page */ }
export async function episodes(ref) { /* -> { series?: SeriesInfo, episodes: Episode[], seasons?: Season[] } */ }
export async function resolve(ref) { /* -> Stream */ }
export async function liveCategories() { /* -> Array<LiveCategory | Playlist> or Playlist */ }
export async function liveChannels({ categoryId, cursor }) { /* -> { items: LiveChannel[], next? } */ }
export async function guide({ channelIds, from, to }) { /* -> GuideEntry[] */ }
export async function subtitles({ imdbId, tmdbId, kind, season, episode, title, year, languages, file }) { /* -> { lang, url, format?, label?, translated? }[] */ }
export async function track(event) { /* -> { ok: true }, or throw kino.error(code) (apiVersion 7) */ }
```

(`kino.d.ts` has the same shapes as TypeScript declarations.)

Use named exports (`export async function ...`). Data crosses into and out of your code as JSON, so
return plain data: strings, numbers, booleans, arrays and objects.

### Arguments

- `search(query)` gets `{ q, type, season, episode, tmdbId, year, originalTitle, altTitles, cursor }`:
  - `q` is the text the person typed (it can be empty; return `[]`).
  - `type` is `"movie"` or `"series"` (or, apiVersion 8, `"music"` or `"podcast"`) when Kino leans towards that kind, and `"any"` otherwise. It is
    a hint, not a filter: Kino derives it from TMDB's movie/tv split, which rarely lines up with a
    source's own catalogue, and a title can exist as both. Return every plausible match; use `type`
    at most to put the kind it names first.
  - `season` and `episode` are `0` unless Kino is looking for a specific episode; `tmdbId` and `year`
    are `0` when unknown.
  - `originalTitle` is TMDB's original title when it differs from `q` (else `""`), and `altTitles` up
    to 5 other titles Kino knows for the work (each at most 200 characters): try them when `q` finds
    nothing on a source that names things in another language.
  - `cursor` is `null`, except when the person asked for more results and your previous page said
    where to continue (see `Page` below).
  - `within` (apiVersion 6, only for a plugin that declares `scopedSearch`) is present when the person
    searches inside one of your "Ver más" pages: see [Searching inside a "Ver más" page](#searching-inside-a-ver-más-page-scopedsearch-apiversion-6).
- `home()` gets `null`.
- `browse(ref, cursor)` gets the `ref` of one of your Home rows (or a `ref` a previous page gave),
  and `cursor` `null` for the first page or the `next` of the page before.
- `episodes(ref)` gets the `ref` of a `series` item, as you returned it, or (apiVersion 8) the `ref`
  of a `music` or `podcast` item, for its tracks or episodes.
- `resolve(ref)` gets the `ref` of a `movie` item, the `ref` of an episode, (apiVersion 2) the
  `ref` of a `live` item, or (apiVersion 8) the `ref` of a `music` or `podcast` item from a plugin
  without `episodes`.
- `subtitles(arg)` gets `{ imdbId?, tmdbId?, kind, season?, episode?, title?, year?, languages, file? }` (see
  [Subtitles for any title](#subtitles-for-any-title)) and returns an array shaped like a `Stream`'s
  `subtitles`, each entry with an optional `label` and `translated`.

### What you return

```ts
Item       = { id: string, ref: string, title: string, kind: "movie" | "series" | "live" | "music" | "podcast",
               year?: string, poster?: string, backdrop?: string, overview?: string,
               lang?: string, quality?: string, originalTitle?: string,
               genres?: string[], rating?: number, runtimeMinutes?: number,
               ids?: { tmdb?: number, imdb?: string }, badges?: string[], adult?: boolean,
               artist?: string }
Row        = { id: string, title: string, items: Item[], ref?: string, genre?: Genre }
Genre      = "peliculas" | "series" | "anime" | "infantil" | "documentales" | "deportes" | "noticias" | "musica" | "entretenimiento" | "otros"
Page       = { items: Item[], next?: string }
SeriesInfo = { title?: string, poster?: string, backdrop?: string, overview?: string,
               ids?: { tmdb?: number, imdb?: string, mal?: number, anilist?: number, kitsu?: number },
               genres?: string[], year?: string,
               rating?: number, runtimeMinutes?: number }   // rating, runtimeMinutes, ids.mal/anilist/kitsu: Kino 0.9.54
Episode    = { season: number, number: number, ref: string, title?: string,
               still?: string, overview?: string, airDate?: string, runtimeMinutes?: number }
Season     = { id: string, ref: string, title: string, number?: number, current?: boolean }
Stream     = { url: string, mime?: string, headers?: Record<string, string>,
               subtitles?: { lang: string, url: string, format?: "vtt" | "srt" }[],
               audioTracks?: { lang: string, url: string, label?: string }[],
               durationMs?: number, expiresInSeconds?: number,
               drm?: { type: "widevine", licenseUrl: string, licenseHeaders?: Record<string, string> },
               label?: string,                                                        // apiVersion 6
               alternatives?: ({ url: string, mime?: string, headers?: Record<string, string>, label?: string }
                               | { ref: string, label?: string }
                               | { external: External, label?: string })[],           // { ref } from apiVersion 6, { external } from 11
               skip?: { openingStartMs?: number, openingEndMs?: number, endingStartMs?: number },
               external?: External,                                                   // apiVersion 11: instead of url, see §12
               media?: Media,                                                         // Kino 0.9.66: what you know about the file
               portable?: { url: string, mime?: "application/x-mpegURL" } }           // Kino 0.9.66: a universal HLS copy, see §12
External   = { protocol: string, ref: string, resolver?: string }
Media      = { title?: string, sizeBytes?: number, container?: string,
               video?: { codec?: string, profile?: string, width?: number, height?: number, fps?: number, bitDepth?: number, hdr?: boolean },
               audio?: { codec?: string, channels?: number, language?: string, title?: string, default?: boolean }[],
               subtitles?: { codec?: string, language?: string, title?: string, text?: boolean }[],
               converted?: boolean, notes?: string[] }
```

**How the pieces connect.** A `movie` item's `ref` goes to `resolve`. A `series` item's `ref` goes to
`episodes`, and each episode's `ref` goes to `resolve`. A `live` item's `ref` (apiVersion 2, see
[Live channels](#live-channels-apiversion-2)) goes to `resolve` too, and its Stream plays as live. A
`music` or `podcast` item's `ref` (apiVersion 8) goes to `episodes` when you declare it (its tracks
or episodes, each `ref` to `resolve`), else straight to `resolve` (see
[Music and podcasts](#music-and-podcasts-apiversion-8)). A row's `ref` goes to `browse`, and so
does each page's `next`.

**Seasons.** Two shapes, and your `episodes` answer says which. When every season of a show is in
one list, give each episode its `season` and leave `seasons` out: Kino reads the seasons from the
episodes and shows a selector that only filters the list. When your source keeps each season as its
own `series` item (its own `id` and `ref`, as a search would list it), return only that season's
episodes and list every season of the show in `seasons`, the one you are answering for included:
`{ id, ref, title, number?, current? }`, with `title` what the selector shows ("Temporada 2") and
`current: true` on the season being listed (Kino also recognizes it by `id`). Kino shows the seasons
as chips; choosing another one calls `episodes` with that season's `ref` and opens it as that title,
with its own progress in the library. `seasons` is optional and new in this revision of apiVersion 1:
a plugin that never returns it keeps working exactly as before.

**Genre (Categorías and the En vivo filter).** A Home `Row`, a live `LiveCategory` and a `playlist` may carry an optional
`genre` from a closed list of ten ids: `peliculas`, `series`, `anime`, `infantil`, `documentales`, `deportes`, `noticias`,
`musica`, `entretenimiento`, `otros` (Kino shows their Spanish names). It is what lets Kino line up categories from
different plugins: the Categorías tab groups the browsable Home rows (those with a `ref`, when you declare `browse`) of
every plugin by genre, and En vivo can be filtered by genre across all providers. A value outside the list is ignored,
never an error, and without a `genre` Kino guesses from the row's or group's title ("Deportes", "Noticias Colombia",
"Kids", "Películas de acción"…), so setting it is worth it when your titles do not say it. On a `playlist` the genre is
the default for every group of the list (a guess from each group's own title is used when the playlist has none).
Kino versions before this field ignore it.

**Paging ("Ver más").** If you declare `browse`, a Home row with a `ref` gets a "Ver más" card that
opens a grid: Kino calls `browse(ref, null)`, then `browse(ref, next)` while the person scrolls and
you keep returning a `next`. `search` may also return a `Page`; its `next` puts "Ver más resultados
de <name>" under your results, and Kino calls `search` again with the same query and `cursor: next`.
A `next` (and a row's `ref`) is only kept when you declare `browse`; without it Kino drops them with a
line in the log. Cursors are opaque to Kino: a page number, an offset, a URL, at most 2048
characters.

**A title's own details (`details`, optional export, Kino 0.9.54).** From `apiVersion` 8, **`details` is a reserved export
name**: export a function by that name only with the meaning below (a helper of yours called `details` must be renamed or
left unexported). A search or Home item often carries only a name and a
poster. The title page shows whatever the item carries (`overview`, `backdrop`, `genres`, `year`, `rating`,
`runtimeMinutes`) and, for a series, what `episodes(ref).series` adds. For a **movie** there is no `episodes` call, so
you may export `details(ref)`: it gets the movie item's `ref` and answers one `SeriesInfo` object (or `null`: nothing to
add). Kino calls it when the page opens, alongside its TMDB lookup (never in front of it), only if your plugin exports
it and declares `apiVersion` 8 or more (no capability: an older Kino never calls it, and an older plugin's own helper
named `details` is never called), with a 20 s limit (`timeoutsMs.details`). It may use `kino.browser.page` like
`episodes`. When the item carried no `ids`, the `ids` of your answer pin the movie on TMDB. The page is built from every
answer with one fixed order per field, whatever order the answers arrive in:

| Field | First → last |
|---|---|
| synopsis, year, genres | TMDB → your item → `details` → AniList → meta plugins |
| poster, backdrop | your item → `details` → AniList → meta plugins |
| score | TMDB → your item → `details` (a series page too: TMDB → your item → `episodes().series`) |
| runtime | TMDB → meta plugins → your item → `details` |
| cast; tagline, directors, certification | TMDB (cast then meta plugins) |
| logo, other sites' ratings | your item → meta plugins |

While `details` has not answered (up to its limit), AniList's and the meta plugins' synopsis, year, genres and art wait
for it, since it outranks them; everything else shows at once. Besides `tmdb` and `imdb`, `ids` (in `details` and in `episodes().series`)
may carry an anime's `mal`, `anilist` and `kitsu` (Kino 0.9.54): AniList and the person's meta plugins are then asked by
them. `rating` is 0 to 10 (like an item's); `runtimeMinutes` is the movie's
length (a series' `runtimeMinutes` is ignored: it is per episode). If your `resolve` needs the same page `details`
read, keep it in a small cache in your module: the person usually presses play right after the page opens.

```js
export async function details(ref) {
  const page = await loadPage(ref);           // your own helper, ideally cached per ref
  return { overview: page.plot, backdrop: page.fanart, genres: page.tags, year: String(page.year),
           rating: page.score, runtimeMinutes: page.minutes };
}
```

#### Searching inside a "Ver más" page (`scopedSearch`, apiVersion 6)

Every "Ver más" page (a Home row, a row of your section, one of your Categorías) has a search field at
the top ("Buscar en esta categoría"). For every plugin, Kino filters the titles already loaded on that
page by name (accents and case aside, every word anywhere in the title); with fewer than 24 matches it
keeps loading the next pages of the same `ref` ("Buscando en más páginas…"), at most 10 pages or 300
titles per round, and the person may ask for another round. A new query cancels the running one.

Declare `"scopedSearch"` (apiVersion 6, together with `search`; nothing more to export, no consent line)
to answer that search yourself, e.g. with your backend's search restricted to that category. Kino then
calls your `search` with the usual query plus `within`, the page's browse `ref` exactly as you gave it:

```js
export async function search(query) {
  if (query.within) {
    const category = categoryOf(query.within);      // your own ref
    if (!category) return null;                      // "can't search there": Kino filters the page itself
    return searchCategory(category, query.q, query.cursor); // Item[] or Page, paged by your `next`
  }
  /* the plain search */
}
```

`type` is always `"any"` there, and `season`, `episode`, `tmdbId` and `year` are `0`. The answer is
checked like any search answer (the same caps, `adult` titles only while the 18+ code is unlocked), and a
`Page`'s `next` pages it as the person scrolls. Kino falls back to its own filter when you answer `null`,
throw, or have not answered after 6 s (the page then searches its own titles and drops your late answer;
your call keeps the search limit of 15 s); a failure reaches the error board like any failed call, never
with the query or the `ref`. Answering `null` is not a failure. `sdk/validate.mjs` warns when you declare `scopedSearch` and your
entry never reads `within`; try it with `node sdk/run.mjs --within '<ref>' ./plugin.js search "texto"`.

#### Describing other titles (`meta`, apiVersion 6)

Declare `"meta"` and export `meta(query)` to fill in what Kino could not find about a title on its info page, whatever
plugin listed it: a synopsis, a poster or background, genres, a year, a runtime, an episode list. Kino asks TMDB first and,
for an anime, AniList; your answer only fills what they left empty, never replaces a value they gave (and never the title's
own plugin's). It is the way to describe titles TMDB does not know, like `kitsu:` anime.

```js
export async function meta(query) {
  // query: { type: "movie" | "series", ids: { imdb?, tmdb?, kitsu?, mal?, anilist? }, id?, lang? }
  //   id: the title's own Stremio-style id in its source ("kitsu:1376", "tt0944947"), when it has one
  //   lang: the person's language ("es")
  const found = await lookUp(query.ids);
  if (!found) return null;                         // not a title you know: no failure
  return {
    title, overview, poster, backdrop, year: "2011", genres: ["Drama"], runtimeMinutes: 57,
    episodes: [{ season: 1, number: 1, title, overview, still, airDate: "2011-04-17", id: "tt0944947:1:1" }],
    logo: "https://img.example.org/got-logo.png",                    // Kino 0.9.51+
    ratings: [{ source: "imdb", value: "9.2" }, { source: "rottentomatoes", value: "89%" }],
    cast: [{ name: "Emilia Clarke", character: "Daenerys Targaryen", photo: "https://img.example.org/ec.jpg" }],
  };
}
```

Every field is optional. Images follow the same rules as an item's. From Kino 0.9.51 three more (older versions ignore
them; no new apiVersion):

- `logo`: a clear-logo of the title (its name drawn as art, transparent background). The info page shows it instead of the
  title's name at the top (phone and TV; the name stays for TalkBack, and comes back if the image fails to load). Same
  image rules as a `poster`.
- `ratings`: at most 6 `{ source, value }`, one per source. `source` is one of `imdb`, `tmdb`, `rottentomatoes`,
  `metacritic`, `letterboxd`, `mal`, `anilist`, `trakt`; `value` a number as the site writes it, up to 3 digits with up to
  2 decimals, optionally followed by `%` or a scale (`"8.8"`, `"94%"`, `"4.1/5"`; a JSON number works too). Shown next to
  the page's ★ score ("IMDb 8.8  ·  Rotten Tomatoes 94%"). Unlike the other fields they add up: TMDB's own vote stays, and
  a `tmdb` rating is dropped when the page already has a score. A bad entry is dropped, the rest kept.
- `cast`: at most 20 `{ name, character?, photo? }` (`name` and `character` 60 characters; `photo` an image like a
  `poster`). Like every other field it only fills a gap: Kino shows TMDB's cast when TMDB has one ("Reparto: …"). Kino
  shows the names; `character` and `photo` are kept for later.

The other way round, any plugin can ask Kino what it knows about a title (TMDB, AniList and the person's `meta` plugins,
yours never asked on your own behalf): [`kino.meta`](#await-kinometaquery-asking-kino-about-a-title-kino-0953) (Kino
0.9.53).

`episodes[].id` is the episode's Stremio-style video id: a Stremio addon's title whose own listing failed can then play those episodes by it. Kino asks every `meta` plugin of
the person at once, at most 6 s each, uses the first answer in install order, and remembers it for 30 minutes; a failure
or a timeout is just no answer, and the page never waits for you.

What Kino reads, field by field (the rest of an answer is ignored, and each part is dropped on its own):

- Text fields (`title`, `overview`, an episode's `title`/`overview`/`id`, a cast member's `name`/`character`) may be strings
  or numbers, are trimmed and cut at their limit. `title` is read but never shown: the page keeps the source's own.
- `year`: only its first 9 characters are read, and their first four digits are the year (`1999`, `"1999-2003"`; not
  `"estrenada 1999"`). `runtimeMinutes`: 1 to 1000 (a numeric string or a decimal is read as Android's JSON does), shown
  only for a movie.
- `genres`: strings only, the first 5 non-empty ones, each cut at 30 characters.
- `episodes`: the first 5000 entries are read, invalid ones included; `season` 0 to 999 (0 is kept but the page never
  lists it), `number` 1 to 99999, one per season and number (the first wins), sorted.
- Images (`poster`, `backdrop`, `logo`, an episode's `still`, a cast `photo`): an item's image rule. A URL is read as text
  first, and one longer than 2048 characters is dropped (never cut into a broken address). A `meta` answer takes URLs only: an image
  reference (`imageSource`) is ignored here.
- An answer whose only usable parts are `year` and/or `runtimeMinutes` counts as no answer, like `null`.

Try it with `node sdk/run.mjs <plugin dir> meta tt0133093` (or `tmdb:603`, `kitsu:1376 series`, several ids, or the whole
query as JSON): it prints your answer, Kino's verdict for every field (kept, cut, dropped and why), what Kino keeps, and
how the info page would use it; [section 7](#7-test-it-locally) shows a real run. `node sdk/validate.mjs . --run search
<text>` (or `home`, `browse`) also asks your `meta` about the first title of the answer that carries `ids.imdb` or
`ids.tmdb`, the way Kino builds the query.

**`id` is stable, `ref` may change.** `id` is the identity of a title: the person's library,
progress and "Continuar viendo" hang off it, so it must be the same every time the same title comes
back, in every search and on every Home refresh. `ref` is opaque to Kino: it is just what your
`episodes`/`resolve` need to find the title again. It may differ from one call to the next (sources
re-issue links), and Kino can hand you a `ref` you returned earlier, for example the one saved with a
title in the person's library. So make refs that keep working; if your source's links expire, put
something stable in the `ref` (an id) and look the fresh link up inside `resolve`.

**Kino is strict, and forgiving with lists.** Every list is checked entry by entry: a bad entry is
dropped (with a line in the log) and the rest survive; anything over a cap is cut. A `Stream` is
all or nothing.

| Thing | Rules |
| --- | --- |
| `search` result | At most 100 items (an `Item[]`, or a `Page`). A `live` item whose name shares too few words with the query (under 60% of the 3+ letter words of `q`, `originalTitle` or one of `altTitles`, the rule of `kino.rank.filterRelevant`) is dropped; movies and series never are. |
| `browse` result | A `Page` of at most 100 items. |
| `home` result | At most 20 rows of at most 60 items each. A row needs a unique `id` (same pattern as an item id) and a non-blank `title`; rows with no valid items are dropped. Kino shows them after its own rows, labelled with your plugin's name, and caches them for 6 hours (stale rows show while it refreshes; an answer with no valid rows, or over 2 MB, is not cached and is asked again next time). If `home()` fails you contribute no rows and Home is not blocked. |
| `episodes` result | At most 5000 episodes. `number` is required and from 1 to 99999 (an episode numbered 0, such as a special, is dropped). `season` should be from 1 to 999; a missing or out-of-range season becomes 1. `ref` is required. A repeated season and number is dropped. Without a `title`, Kino shows "Capítulo N". |
| `seasons` (in the `episodes` result) | Optional; at most 50. Each needs an `id` (same pattern as an item id; a repeated one is dropped), a non-empty `ref` of at most 4096 characters and a non-blank `title` (up to 200 characters), or it is dropped. `number` from 1 to 999 and `current` a boolean; a wrong one is ignored, not the season. Anything that is not a list is ignored. |
| `id` | `^[A-Za-z0-9._~-]{1,128}$`. Anything else drops the item, so if your source's own ids have other characters (spaces, `/`, `:`, `%`), derive a stable id yourself, such as a slug. Repeated ids in one list are dropped. |
| `ref` | A non-empty string of at most 4096 characters. |
| `kind` | `"movie"`, `"series"`, (apiVersion 2) `"live"` or (apiVersion 8) `"music"` or `"podcast"`; a `live` item stays in a `home` row only from apiVersion 6 (below it, it is dropped from Home). A `series` item from a plugin that does not declare `episodes` is dropped: it could never be opened; a `live` item from an apiVersion 1 plugin is dropped too (see [Live channels](#live-channels-apiversion-2)), and a `music` or `podcast` item from a plugin below apiVersion 8 (see [Music and podcasts](#music-and-podcasts-apiversion-8)), which needs no `episodes`. |
| Text fields | `title` is required and non-blank, up to 200 characters. `overview` up to 2000; `lang` and `quality` up to 20 (for example `"es"`, `"1080p"`); `year` up to 10 (a number is accepted and converted). Longer text is cut; the text of `SeriesInfo` and `Episode` is cut the same way (200 characters for titles, 2000 for overviews). |
| Extra item fields | All optional; a wrong one is ignored, not the item. `genres` at most 5, each at most 30 characters; `badges` (shown as chips, e.g. `"HD"`, `"Latino"`) at most 3 of at most 20; `rating` from 0 to 10; `runtimeMinutes` from 1 to 1000; `ids.tmdb` a positive integer (Kino uses it to match your title with TMDB, to find it again from search, and to enrich its info page -- see below); `ids.imdb` matches `^tt\d{5,10}$` (also enriches a movie's info page when you have no `ids.tmdb`). An episode's `airDate` is `YYYY-MM-DD`; since Kino 0.9.55 its `airDate` and `runtimeMinutes` show under it in the episode list, phone and TV ("12 mar 2024 · 48 min", the date in the app's language). |
| `adult` | From apiVersion 6, `adult: true` marks an 18+ entry: Kino shows it only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental), and hides it again when they lock it; below apiVersion 6 it is dropped. It applies on Home, in search, "Ver más", your section and Categorías. |
| Images | `poster`, `backdrop` and `still` must be `http` or `https` URLs of at most 2048 characters, or they are ignored. Images are loaded by Kino directly and are **not** checked against `hosts` (they are display only), and Kino does not send your headers or cookies with them. This is the one exception to the host rule, with one limit: an image on the home network, a private or reserved IP address, or a local name (`localhost`, `.local`, `.lan`, …) is ignored too, unless it is on a server the person typed in your settings. A public IPv4 address is fine; over `http`, a name without a dot (`http://nas/…`) is a device on the home network and is ignored too. From apiVersion 13 a plugin that declares `imageSource` may answer, instead of a URL, an image **reference** `{ "source": "plugin", "handle": "…" }` in `poster`, `backdrop`, `still` and a section hero's `image`: Kino then asks its `image` export for the bytes (see [Images from the plugin](#images-from-the-plugin-imagesource-apiversion-13)); from any other plugin, or anywhere else, a reference is ignored. No data URIs: a string is always a URL. |

**`ids.tmdb` enriches the info page, not only matching.** When TMDB has this exact title (matched by
`ids.tmdb`, or by `ids.imdb` on a movie when you gave no `ids.tmdb`), opening it adds three kinds of
field, each filled in differently:

- **Only TMDB has these, so they always come from it:** a tagline, the director or (for a series)
  creator, the cast and the age rating.
- **TMDB wins whenever it has an answer; yours is only the fallback for what TMDB left blank:** the
  year and the genres. A title with its own year or genres still shows TMDB's once matched, not its
  own.
- **Yours wins when you gave one; TMDB only fills the gap:** the synopsis (only replaced if yours was
  empty), the rating (only if you left it out), and a movie's runtime (only if you left it unset --
  a series' runtime is never touched either way, TMDB's included; it prints per episode, not for the
  whole show).

It does **not** add a poster, a backdrop or seasons from TMDB -- those stay exactly what your
`Item`/`SeriesInfo`/`episodes` answer gave, or blank if you left them out.

**The `Stream` rules.**

- `url` must be `https` and its host must be one of your `hosts`, and so must the host of every
  subtitle URL, or it must be on a server the person typed in your settings (exactly that scheme,
  host and port). The one other way to plain `http` is a host you declared
  `{ "host": "…", "insecureHttp": true }` (apiVersion 2, [above](#declaring-an-insecure-host-apiversion-2)):
  that host, exactly, accepts `http` for the stream, its subtitles, its audio tracks and its
  license. A stream that breaks this is refused as a whole; a bad subtitle is dropped and the
  stream still plays.
- **A host you forgot may be asked about, once.** When the person opens a title in the player and
  the only thing wrong with your `Stream` is that a URL (the video, its license, a subtitle or an
  audio track) is on an `https` host you did not declare, Kino asks them in the moment ("El video
  está en `<host>`, un servidor nuevo para este plugin. ¿Permitir?"), the same dialog a `kino.fetch`
  to an undeclared host gets. "Permitir" adds that host to your plugin's approved hosts (there is no
  cap on how many a person approves this way) and the video plays; "Rechazar" (or Back) is remembered for your plugin -- the
  video fails as described above, a subtitle or audio track is dropped -- and that host is never
  asked about again until the person chooses "Olvidar rechazos de host". An IP address, a local
  name, plain `http` or a stream broken in any other way is never asked about, and nothing is
  asked when nobody is watching (a download resolves exactly as before). Don't rely on it: declare
  the hosts your streams use.
- **The person may let your video come from any server** (the *broad video permission*). The
  video, subtitle and audio dialogs of a movie or an episode (at resolve time, and when the player
  meets a new host mid-playback) have a third choice, "Permitir video de cualquier servidor". It is
  the person's own grant, shown and revocable in Ajustes ▸ Plugins ("Puede reproducir video desde
  cualquier servidor", "Quitar permiso de video amplio"); the one way for you to ask for the same rule
  up front is [`streamHosts: "any"`](#playing-from-any-server-streamhosts-apiversion-4) (apiVersion
  4), approved on the consent sheet, and with it no video host is ever asked about.
  An update or a reinstall keeps it; uninstalling drops it. While it is on, **in the player only**,
  your movie or episode `Stream` is checked the way a live channel's is under
  [`liveStreamHosts: "any"`](#channels-from-any-server-livestreamhosts-apiversion-3) -- the same
  single rule: its `url`, everything its manifest names, every redirect hop, **and** its
  `subtitles` and `audioTracks` may be on any public host, over `http` or `https`, a public IPv4
  address included -- and no video host is ever asked about again for your plugin. It never
  covers: the home network (private, loopback, link-local and CGNAT addresses, IPv6 literals,
  local names, a public name that resolves into the LAN); a `drm` block's `licenseUrl` (still your
  hosts only, asked about as above); `kino.fetch` (your own code still reaches only your hosts and
  the ones approved one by one); live channels (their own rule). A download of a movie or an episode
  follows the player's rule, so it is covered too. It exists for sources whose hosters change domain per video
  or mid-playback; a plugin with a fixed CDN should still declare it.
- `mime` is optional, of the form `video/mp4` (anything else refuses the stream). When it is missing
  Kino's player detects HLS, DASH or a plain file from the URL and the content.
- **Everything the player fetches for the stream follows the `kino.fetch` host rules.** That covers the
  `url` itself, the variants, segments and `#EXT-X-KEY` keys an HLS manifest names, the `BaseURL`s of a
  DASH manifest, the subtitles, and every redirect hop of any of them: each must be `https` on one of
  your `hosts` (or `http` on one you declared `insecureHttp`), never an IP address or a local name,
  and a declared name that resolves inside the person's own network is refused. A request that breaks this fails before it leaves the device and
  playback stops with an error, so a manifest that points at another CDN needs that CDN in `hosts`.
- `headers` are sent with every one of those player requests (the stream, its manifest's segments and
  keys, its subtitles, and redirect hops, all on your `hosts`) and, if you declare `download`, with
  the request that saves the stream to the device — and nowhere else. At most 20; names are letters, digits and
  hyphens; values are at most 4096 characters with no line breaks; `Host`, `Content-Length`,
  `Transfer-Encoding` and `Connection` are ignored.
- `subtitles`: at most 30, each `{ lang, url, format? }`. `lang` is a short language code such as
  `"es"` (up to 20 characters; blank becomes `"und"`), `format` is `"vtt"` or `"srt"`.
- `alternatives`: at most 8, each `{ url, mime?, headers? }` -- other copies of the same video, best first. When
  `url` cannot play on the device (a codec it has no decoder for, a broken or unsupported file) or is gone (404, 403),
  Kino moves on to the next alternative by itself, at the same spot, and only shows an error once none is left. A lost
  network is not a reason to move on: that is retried as usual. Each entry is checked exactly like `url`, `mime` and
  `headers`; a bad one is dropped and the rest still count. They share the stream's `subtitles` and `audioTracks`.
  Ignored next to `drm`, with `signing` (`alternateHosts` is a signed stream's failover) and for a live channel. Return
  them when your source offers several files of one title (other
  servers, resolutions, encodes): a device that cannot decode the first one still gets to watch. Every alternative
  must be **the same video in the same language** (same dub, same subtitles burned in or not): Kino switches between
  them by itself, so a dubbed copy listed next to the original would change the language under the person. Offer
  another language as another stream (another search result or episode source), never as an alternative. After
  repeated stalls Kino also moves once, by itself, to a clearly lighter copy (at most three quarters of the height on
  screen) when the labels say so: name the resolution in the label (`"Streamwish · 720p"`, `"4K"`, `"Full HD"`); a
  bare `HD` or `SD` is never enough for that.
- `label` (apiVersion 6): the Stream's own short name, and each alternative may carry one too -- e.g.
  `"Latino · Streamwish"`. Trimmed; at most 48 characters, no control characters, or it is dropped (the copy still
  plays). When a Stream has two or more copies the player shows them all, by label, in a **Servidor** section at the
  top of its "Audio y subtítulos" menu (phone and TV, reachable with the D-pad), where the person can switch at any
  moment and keep watching from the same spot; a copy without a label shows as "Opción 2", "Opción 3"… Labels also go
  to the plugin's log, with the host only (never a URL or a token). See [Labelled and lazy copies](#labelled-and-lazy-copies-apiversion-6).
- `audioTracks`: at most 8, each `{ lang, url, label? }` -- a dub or an alternate mix your source
  serves as its own file, separate from the video. Checked exactly like a subtitle: `url` must be
  `https` on a declared host, or the person's own server exactly as typed; a bad entry is dropped and
  the rest of the stream still plays, and so is a `url` already listed (the first entry wins). `lang` up to 16 characters (blank becomes `"und"`); `label`, up
  to 40 characters, is shown in the audio menu verbatim when given, instead of a name guessed from
  `lang`. Kino merges each one into the video and offers it, auto-picked by the person's audio
  preference, in the same menu as the container's own embedded tracks. A stream with no `audioTracks`
  plays exactly as it always has. Example, a source that dubs into two languages:
  ```js
  return {
    url: videoUrl,
    audioTracks: [
      { lang: "es-419", url: dubUrl("es"), label: "Español (Latinoamérica)" },
      { lang: "en", url: dubUrl("en") },
    ],
  };
  ```
- `durationMs` is optional, in milliseconds.
- `skip` is optional: where THIS file's opening and ending are, in milliseconds from its start --
  `{ openingStartMs?, openingEndMs?, endingStartMs? }`. Kino shows its "Saltar intro" button from
  `openingStartMs` (0 when left out or `null`) to `openingEndMs`, and "Saltar outro" (to the next episode) from
  `endingStartMs`. Every value must be a finite number between 0 and `durationMs` (or 24 h when you
  give no `durationMs`); the opening needs its `openingEndMs`, after its start; `endingStartMs` must
  not be before the opening's end. A bad part is dropped and the rest still count; a bad `skip` never
  stops the stream. Send times for the exact file you return: a different cut of the same episode
  (an extra logo, a recap trimmed) has its opening somewhere else. Kino keeps them as the episode's
  markers, also for a downloaded copy, and they sync to the person's other device. A correction the
  person makes by hand always wins over yours; yours win over the community times Kino looks up on
  its own for anime (AniSkip), which is not asked at all when you send `skip`. Ignored for a live
  channel. Older Kino versions ignore the field.
  ```js
  return { url: videoUrl, durationMs: 1_420_000, skip: { openingStartMs: 62_000, openingEndMs: 152_000, endingStartMs: 1_290_000 } };
  ```
- `expiresInSeconds` (30 to 86400) says when your URL may stop working. If playback fails after that
  long, Kino calls `resolve` once more and continues where the person was.
- `media` (optional, Kino 0.9.66; older Kino ignores it) says what you know about the file itself: its
  `title`, `sizeBytes` and `container`, its `video` (`codec`, `profile`, `width`, `height`, `fps`, `bitDepth`, `hdr`), its `audio`
  and `subtitles` tracks (`codec`, `language`, `title`, and `default` / `text`), whether you `converted` it for playback and
  short `notes`. It is **advisory**: Kino shows and logs it and may use it as a hint (for a cast, see §12), but never trusts it
  for anything that could harm the person. Every field is optional and cleaned: text is one line (control characters dropped,
  whitespace collapsed) cut at 120 characters (`codec`/`container` 40, `language` 20), numbers are clamped (`width`/`height`
  to 16384, `fps` to 480, `bitDepth` to 16, `channels` to 32, `sizeBytes` to 2^50), at most 16 tracks and 4 `notes`; an object
  with nothing usable left is dropped. A bad `media` never refuses the stream.
  ```js
  return { url, media: { container: "mp4", video: { codec: "h264", width: 1920, height: 1080, fps: 24 }, audio: [{ codec: "aac", channels: 2, language: "spa", default: true }] } };
  ```
- `portable` (optional, Kino 0.9.66; older Kino ignores it) is **a universal copy of this same video** next to `url`:
  `{ url, mime? }`, an HLS (`application/x-mpegURL`) any TV receiver plays (H.264 8-bit up to 1080p with stereo AAC). Only a source
  that can make one on demand has any use for it; the phone's own player never uses it, and Kino casts it to a TV only when the
  title's own route would need a conversion or the stream is likely not playable as it is (see
  [Casting a resolver's title](#casting-a-resolvers-title-chromecast-and-dlna)). It is checked exactly like `url` (same host
  rules); anything else, a non-HLS `mime` included, is dropped and the rest of the answer still counts. It is ignored next to
  `drm`, request `signing` or `external`.
- **DRM only when declared.** A stream carrying any of `drm`, `license`, `licenseUrl`, `drmLicenseUrl`,
  `keySystem` or `widevine` is refused ("El video tiene DRM y los plugins no lo soportan") -- unless
  your manifest declares the `drm` capability (apiVersion 2) and the only such key is a `drm` block
  `{ type: "widevine", licenseUrl, licenseHeaders? }`: then Kino plays it as Widevine. `licenseUrl`
  is checked exactly like `url` (https on one of your `hosts`, or the person's own server), and
  `licenseHeaders` are filtered like `headers` (at most 20) and sent with the license request only.
  The other five keys are refused even next to a valid `drm` block. See
  [A Widevine-protected stream](#a-widevine-protected-stream-apiversion-2).

#### Live channels (apiVersion 3)

With the `channels` capability ([§3](#channels-in-the-en-vivo-tab-apiversion-3)) Kino calls up to
four more functions. Their arguments:

- `liveCategories()` gets `null`.
- `liveChannels({ categoryId, cursor })` gets the `id` of one of your categories, and `cursor` `null`
  for the first page or the `next` of the page before.
- `guide({ channelIds, from, to })` gets at most 50 of your channel ids and a window of at most
  24 hours: `from` and `to` are epoch milliseconds.
- `liveSearch({ query })` (optional) gets what the person typed in En vivo's search, trimmed, at
  least 2 characters.

They return:

```ts
LiveCategory = { id: string, title: string, country?: string, adult?: boolean, genre?: Genre }
Playlist     = { playlist: { url: string, format: "m3u", headers?: Record<string, string>,
                             streamHeaders?: Record<string, string>, genre?: Genre,
                             epg?: { url: string, format: "xmltv" }, refreshHours?: number,
                             hideGroups?: string[], resolve?: boolean } }
LiveChannel  = { id: string, title: string, categoryId?: string, ref?: string, stream?: Stream,
                 logo?: string, number?: number, adult?: boolean }
GuideEntry   = { channelId: string, title: string, start: number, end: number, description?: string }
```

A plugin can give its channels in three ways, and mix them:

1. **A channel with a `ref`.** The `ref` goes to `resolve(ref)` when the person plays it, exactly
   like a `live` item's, and its Stream plays as live.
2. **A channel with an inline `stream`.** A `Stream` checked by the same rules as `resolve()`'s
   answer; it plays with no call to your plugin. A channel whose `stream` is refused is dropped. With
   both `ref` and `stream`, the stream plays and the `ref` is only the fallback (but a signed inline
   stream is set aside, and the `ref` plays). A channel with
   neither is dropped. Some channels only answer a known player: give the `Stream` a `headers` with
   the `User-Agent` (or `Referer`) it insists on, and the player sends it with every request for that channel.
3. **A playlist.** Put `{ playlist: { ... } }` entries next to your categories in the
   `liveCategories()` answer (or return one alone). Kino downloads the M3U list itself, and its XMLTV
   guide from `epg.url`, and groups the entries into categories. Both URLs must be `https` on one of
   your `hosts` (or `http` on one declared `insecureHttp`, or a server the person typed), always:
   a playlist on another host is dropped, and an `epg` on another host only loses the guide.
   `headers` go with those downloads. `streamHeaders` are what the **player** sends for every channel of
   the list, for the channels that only answer a known `User-Agent` (or a `Referer`): they are filtered
   like a Stream's `headers` and kept apart from `headers` on purpose, because those carry your list's own
   credentials and go only to the list's host, never to the many hosts the channels are on. A header an
   M3U entry names itself (`#EXTVLCOPT:http-user-agent=...`, `#EXTHTTP:{"User-Agent":"..."}`, a
   `url|User-Agent=...&Referer=...` suffix, or `#KODIPROP` stream headers) wins; only `User-Agent`,
   `Referer`, `Origin` and `Cookie` are kept, and a value with a control character is dropped. The list
   may be UTF-8, Latin-1 or UTF-16 (with or without a BOM); `#EXTINF` attributes may be double-quoted,
   single-quoted or bare (`tvg-id=abc`). A list over 20 MB, or a guide over 50 MB, is not refused: Kino
   keeps its start, up to its last whole line (`node sdk/run.mjs live playlist` says when). A guide
   `<programme>` without `stop` ends where the next programme of its channel starts, or one hour
   after its start when none follows. Kino versions before the one that added
   `streamHeaders` ignore the field, so the list plays without it. `refreshHours` is 1 to 168 (default 12); `hideGroups` lists
   group titles not to show (case doesn't matter, at most 50). With `resolve: true`, each entry plays
   through your `resolve(<entry url>)`, for lists whose links need a fresh token. At most 10 per
   answer.

   Each entry gets a channel code, the key of favourites and recents: its `tvg-id` when that is a
   valid id and the entry is the **first of the list to use it**, else one made from its URL and
   name. A later entry repeating a `tvg-id` never moves the first one's code, but it gets a
   URL-and-name code itself, which changes (and its favourites and recents stop matching) when its
   URL does; a copy inserted *before* the first one takes the `tvg-id` code over. Give every entry a
   stable, unique `tvg-id`; `node sdk/run.mjs live playlist <list>` lists the repeated ones.

The rules:

- Times are epoch milliseconds.
- At most 200 categories (playlists don't count), and at most 500 channels per `liveChannels` page.
  `id` follows the item `id` pattern; an `id` starting with `~` is reserved for Kino's own playlist
  entries and dropped. A repeated `id` in one answer is dropped. `title` is required.
- `country` is an ISO 3166 two-letter code (`"CO"`), informational; anything else is ignored.
  `number` is 1 to 9999 (anything else counts as no number); `logo` follows the poster rules;
  `categoryId` is optional and informational in `liveChannels` (a channel is listed under the
  category `liveChannels` was asked for); one that is not a valid id becomes empty. In a
  `liveSearch` hit it is how Kino knows whether the hit is 18+ (see below).
- Kino pages `liveChannels` until `next` is missing, repeats, or brings nothing new. A category's
  first listing asks at most 10 pages; when the last one still has a `next`, Kino keeps it and asks
  5 more pages each time the person scrolls near the end of the list, up to 10,000 channels (or 200
  pages) per category. Older Kino versions stop at the first 10 pages and never ask `liveSearch`.
- `liveSearch` is optional, for a catalog too big to list whole. Kino asks it from En vivo's search
  (the phone's field, the TV guide's and the TV channel drawer's) when the person stops typing,
  only while some of your channels were never listed (a category not opened yet, or one with
  pages left), and keeps each answer 10 minutes per query. It returns channels exactly like a
  `liveChannels` page (`next` is ignored), at most 100 kept, with the same `id` a listed channel
  has, so favourites and recents match. Kino still shows only the ones whose name contains what
  was typed (or whose number is it). A channel found this way plays like a listed one, and a
  favourite Kino no longer has in memory nor in its cache is looked up again by name through
  `liveSearch` (one call) before the first pages of your first 10 categories; without `liveSearch`,
  only those first pages are looked at, never the pages after them. It runs as a background call: a
  slow search never marks the plugin "No responde". Export it only when you can really search: an
  empty answer is taken as "nothing found", and Kino keeps saying some channels were not loaded.
  A preheat of the next channel (Kino resolving a neighbour ahead while one plays) never asks
  `liveSearch`: it looks only through your listings, and the zap itself asks when needed.
- **Mark every `liveSearch` hit** (apiVersion 6, when you have an 18+ category): a hit names no
  listing, so give it `adult: true`/`adult: false`, or the `categoryId` of the category it belongs
  to. A hit with `adult: true` or the `categoryId` of an 18+ category is 18+; one with the
  `categoryId` of a plain category, or `adult: false`, is plain. A hit with neither counts as 18+
  for a plugin that has any 18+ category, and, when your categories can't be read (`liveCategories`
  failed), every hit not marked `adult: false` counts as 18+. While the 18+ code is locked, Kino
  leaves those hits out of the search, does not open them and keeps them out of "Recientes".
  `node sdk/run.mjs <plugin dir> live search <query>` and `sdk/validate.mjs --run liveSearch` mark
  the hits the same way and warn about the ones that carry neither mark.
- Kino caches your categories and channels for 1 hour and your guide for 30 minutes.
- `guide` is optional. Kino keeps entries for the channels it asked for, with `end` after `start`,
  inside the window, at most 100 per channel and one per start time. A `guide` that fails or is not
  exported is simply not asked again for 30 minutes: your channels still list.
- `adult: true` on a category or a channel: from apiVersion 6, `adult: true` marks an 18+ entry: Kino shows it only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental), and hides it again when they lock it; below apiVersion 6 it is dropped. Every channel of an 18+ category counts as 18+, and an 18+ channel never enters "Recientes".

### Errors people understand

A plain `throw new Error("…")` reaches the person as a generic failure of your plugin. When the
failure is one of the usual ones, throw a typed error instead and Kino says it properly, in Spanish, with your plugin's
name:

```js
if (r.status === 401) throw kino.error("auth_required", "la sesión venció");
```

<!-- contract:errors:start -->
| `kino.error` code | What the person sees |
| --- | --- |
| `auth_required` | "Configura {plugin} en Ajustes ▸ {plugin}" when your plugin declares settings (its own tab in Ajustes), else "Configura {plugin} en Ajustes ▸ Plugins" ("Menú ▸ Plugins" on the phone), with a button to its Configurar screen |
| `not_found` | "No se encontró en {plugin}" |
| `geo_blocked` | "Este contenido no está disponible en tu región" |
| `rate_limited` | "{plugin} está limitando las peticiones; intenta en unos minutos" |
| `unavailable` | "{plugin} no está disponible ahora" |
<!-- contract:errors:end -->

Your message is a detail for the log (cut at 200 characters); the person reads Kino's sentence. An
unknown code becomes a plain error.

When Kino's sentence says too little (a chapter that was taken down, an account to link again), pass
your own sentence for the person as a third argument:

```js
throw kino.error("not_found", "portal100006", { userMessage: "Este capítulo ya no está disponible." });
throw kino.error("auth_required", "aaa100083", {
  userMessage: "Tu cuenta se abrió en otro dispositivo. Vuelve a intentarlo, o vincúlala de nuevo.",
});
```

Kino shows it **instead of** its own line, always as "Mensaje de <your plugin's name>: <your
sentence>" ("Mensaje de Demo: Este capítulo ya no está disponible."), only when all of this holds;
otherwise the person reads Kino's line and your sentence goes nowhere (it is not logged either; the
detail is):

- your plugin's name can introduce it: only the characters below, no `:`, no digit glued to a letter,
  nothing that spells Kino (so a plugin named `M3U` or `Cuevana3` always shows Kino's line; `Cuevana 3`
  is fine);
- the code is one of the five above (Kino always words `timeout`, `network`, `host_not_allowed`,
  `crypto_error` and the rest itself);
- it is 1 to 160 characters once trimmed, made only of the letters of Basic Latin and Latin-1 (what
  Spanish, Portuguese and English write: á é í ó ú ü ñ ç ã õ â ê ô à è…, but not ø æ ð þ ß), the
  digits 0-9, the plain space and `` . , : ; ¿ ? ¡ ! ' ’ ‘ “ ” « » ( ) % - – — ▸ `` (a `;` only before
  a space): so no other script, look-alike letter, small capital, line break, tab, other kind of
  space, invisible character, emoji or `@`;
- it reads as plain words: at least two words, no URL, no error prefix (`TypeError:`, `[Tag]`), no
  `undefined`/`null`/`NaN`, and it doesn't end in `:` `,` `;` or `-`;
- fewer than 6 digits in all, whatever separates them (no phone or account number, and so no full
  date with its year), and no digit glued to a letter (`en 5 minutos` is fine, `5minutos` is not);
- no domain: a dot glued to a letter (`site.app`), a dot after a space (`site .app`), a dot followed
  by a lowercase word of 2 to 6 letters (`site. app`), `www`, or `punto`/`dot` glued to or followed
  by a domain ending (`punto com`, `puntodev`; "a punto de volver" and "en este punto es mejor" are fine:
  `es`, `la`, `me` and `to` are not read as endings);
- it never spells Kino: read with `1`, `l`, `!`, `¡` as `i`, `0` as `o` and every non-letter dropped,
  it holds no `kino` anywhere (so avoid a word like "Kinoshita");
- it asks for no credentials, money or contact outside Kino, read word by word (a word split on
  purpose is read whole: `N e q u i`, `Ne qui`, `con tra seña`, `What s app`, `pun to com`): no `pag…` (pago,
  pagues, págalo; "página" is fine),
  `abon…`, `recarg…`, `transfer…`, `consign…`, `deposit…`, `contraseñ…`, `passw…`, `clave…`,
  `credencial…`, `token…`, `tarjeta`, `PIN`, Nequi, Daviplata, WhatsApp, Telegram, a `código` that
  came by SMS or is a verification code (`verification…`; "Verifica tu conexión" is fine): your own
  settings are the only place for those (`recarg…`
  also refuses "Recarga la lista": say "Vuelve a cargar");
- it holds none of the passwords the person typed in your settings (checked against your plugin's
  stored values; while they can't be read, the sentence is not shown), nor any sealed secret's value.
  Never echo what the person typed, in any form.

A plugin that uses `userMessage` to ask people for money, credentials or contact outside Kino is
removed from the plugin catalog.

Write it for the person, in their language; Kino doesn't translate it. It takes the very place Kino's
own line takes, so it never changes what the screen does: `auth_required` keeps the button to your
Configurar screen; `geo_blocked` shows the player's "No se puede reproducir" dialog; the other codes
show Kino's error line (on a live channel the person keeps zapping). It is also the reason under your
plugin's Home row and in the search notices. Your settings form and your section pages show it for
`not_found`, `unavailable` and `rate_limited`, and keep their own generic text for `auth_required`
and `geo_blocked`. One thing still wins over it, whatever the code: a host the person
refused for this call (they can act on that). The sentence counts only for the call that built the
error: build it where you throw it, not once at the top of your module. The Node kit (`run.mjs`)
prints what the person would read, or why the sentence is not shown. Kino builds older than this
ignore the third argument and show their own line, so it is always safe to pass.

## 5. The `kino` API

`kino` is a global object, frozen, always there. Nothing else from the outside world is.

```js
kino.apiVersion   // 8 -- the highest apiVersion this build of Kino understands, not your manifest's
kino.appVersion   // the version of Kino, for example "1.42.0"
kino.lang         // "es-CO" or "en-US": the language Kino speaks now
kino.fetchAnyHost // Kino 0.9.55+: true when this install's kino.fetch may reach any public host ("fetchHosts": "any"
                  // approved); false otherwise, undefined on an older Kino
kino.device       // Kino 0.9.55+: "tv" or "phone", the UI Kino shows on this device; undefined on an older Kino
```

All plain values, read-only like the rest of `kino`. They need no permission and add no consent line:
they say only what any app knows about itself and the screen it runs on, nothing about the person.

**`kino.lang` follows the person.** When they change Ajustes ▸ App ▸ Idioma (or, on Automático, the
device's language), Kino closes your plugin's runtime and the next call opens a new one with the new
value (a running `sign()` lane keeps the old one). Read it when you need it; do not keep words built
from it in `kino.storage`. `kino.lang.slice(0, 2)` is the bare `"es"` or `"en"`.

**`kino.device` (Kino 0.9.55, every apiVersion).** The same decision Kino makes to show its TV
interface (remote control, ten-foot screen) or its phone one; a tablet gets whatever Kino shows it,
usually `"phone"`. It does not change while Kino runs. Use it for what differs on a TV: fewer items per
request, a copy that decodes well on a box, a `userMessage` that says "en el control" instead of "toca".
Feature-detect it: an older Kino leaves it `undefined`, so treat anything but `"tv"` as the phone.

```js
const onTv = kino.device === "tv";
```

In the Node kit it is `"phone"` unless you pass `--device tv` to `sdk/run.mjs` (or set `KINO_DEVICE=tv`);
`kino.lang` there is `"es-CO"` and `kino.appVersion` is `"sdk"`.

### `kino.seed(session)` (Kino 0.9.55, every apiVersion)

Some sources hand out an anonymous, free guest session to anyone who asks, and block whole regions from
logging in. `kino.seed` lets a plugin share ONE such session with Kino, so people in those regions have live
sessions to fall back on. It is best-effort and synchronous: it answers nothing and never throws into your
plugin, so call it and carry on.

```js
if (typeof kino.seed === "function") {
  kino.seed({ sn, userId, userToken, jwtToken, mintedAt });   // a brand-new guest session, already proven to work
}
```

- **What to send.** A session you just created for this and nothing else, never the person's own, and only
  after you checked it works (for example by fetching one catalog page with it). A device that cannot create a
  working guest session (a blocked region, a refusal, an empty answer) sends nothing at all.
- **What Kino keeps.** Only these keys, each a short string (at most 2048 characters) or a finite number:
  `sn`, `userId`, `userToken`, `jwtToken`, `mintedAt`, `customer`, `activeTime`, `availableTime`. Any other key
  is dropped. If `sn`, `userId` and `userToken` are not all present and non-blank, the whole session is dropped.
  The cleaned session is at most 8192 characters, and a session whose JSON is over 16384 characters never
  crosses at all.
- **Consent.** Kino sends the session to its own error board only when the person's plugin-telemetry consent is
  on for your plugin (the same consent `kino.log.report` rides on); with it off, nothing leaves the device. It
  is anonymous: it names no account and carries nothing about the person. Say so in your plugin's description,
  and give the person a setting to turn the contribution off.
- **Rate.** Do not mint on every Home. Keep a timestamp in `kino.storage` and share at most one session every few
  hours per device.
- **From a background job** (Task 18): `kino.seed` is one of a job's APIs, under the same consent, filter and caps, so a
  contribution may move from after Home into a job (with `enabledBy` on your contribution setting, it runs exactly while the
  person leaves that setting on).
- **Feature-detect it.** An older Kino has no `kino.seed`, so the check above is the whole compatibility story.
  The contract's `kinoSeed` section carries the same keys and limits.
- **In the Node kit.** `kino.seed` is there too: it sends nothing, applies the same filter and logs which keys
  Kino would keep (never the values), and, like `kino.log.report`, notes when the manifest lacks `"telemetry"`
  and the app would send nothing.

Kino also provides the web globals QuickJS lacks, written in JavaScript and frozen: `URL`,
`URLSearchParams`, `atob`, `btoa`, `TextEncoder` and `TextDecoder` (UTF-8 only). They behave like the
browser's (checked against Node on a corpus of cases), except that `URL` does not convert
international domain names to punycode.

### `await kino.fetch(url, options?)`

```js
const r = await kino.fetch("https://archive.org/metadata/" + encodeURIComponent(id), {
  method: "GET",              // GET (default), POST, PUT, PATCH, DELETE or HEAD
  headers: { Accept: "application/json" },
  body: "a=1&b=2",            // see "Bodies" below; sent only with POST, PUT and PATCH
  redirect: "follow",         // or "manual": get the 3xx itself, with its Location header
  cookies: true,              // false: neither send nor store cookies for this request
  timeoutMs: 20000,           // default 15000, at most 30000
  maxBytes: 65536,            // apiVersion 14: read at most this many bytes of the body (1 to 2000000)
  stopAt: "</head>",          // apiVersion 14: end the read at this marker (1 to 32 ASCII characters), kept
});
r.ok        // true for 200 to 299
r.status    // the HTTP status
r.url       // the final URL, after redirects
r.headers   // { "content-type": "...", ... }: names in lowercase, repeated headers joined with ", "
r.text()    // the body as a string (already downloaded)
r.json()    // JSON.parse of the body
r.base64()  // the body bytes as base64: for anything that is not text
r.truncated // apiVersion 14: true when the body was cut at maxBytes or stopAt
```

- **`stopAt` (apiVersion 14).** Kino stops reading as soon as the text holds the marker (1 to 32 printable ASCII
  characters, compared ASCII case-insensitively) and keeps everything up to and including it; `r.truncated` is `true` when
  more followed. Only for text answers (a byte answer fails with `invalid_request`). With `maxBytes` the first limit
  reached wins; a marker that never comes leaves `maxBytes` (or the 5 MB limit) in charge. `{ stopAt: "</head>", maxBytes:
  65536 }` reads a page's metadata and nothing more. Below apiVersion 14 the option is ignored.

- **`maxBytes` (apiVersion 14).** Kino reads the body up to that many bytes and stops: the rest is never downloaded,
  and `r.truncated` is `true` (it is `false` when the whole body fit). Use it when the head of a page is enough (its
  `<meta>` tags): a server that ignores `Range` still costs you only what you asked for, and a body that would be over
  the 5 MB limit is cut instead of refused. The count is of the body's bytes after the transport's decompression, and a
  cut text may end in the middle of a character. A plugin that declares sealed `secrets` gets the same answer, but Kino
  then reads the body whole (up to the 5 MB limit) and redacts it before cutting, so the read does not stop early for it.
  Outside 1 to 2,000,000, or not a whole number, the fetch fails with
  `invalid_request`; below apiVersion 14 the option is ignored.

Kino hands your code either the text or the bytes of a body, depending on its `Content-Type`; the
other form is converted inside the engine when you ask for it, which for a body of several MB takes
seconds of your call's time. Ask for the form the content is.

- **Bodies.** A string is sent as is (`text/plain` unless you set `Content-Type`).
  `{ json: value }` sends `JSON.stringify(value)` as `application/json`; `{ form: { a: 1 } }` sends
  `application/x-www-form-urlencoded`; `{ base64: "…" }` sends those bytes.
- **https only, and only your hosts.** The host of the request and of **every redirect hop** must
  match `hosts` (`*.x` matches subdomains of `x`, not `x`), or be a server the person typed in your
  settings, exactly as typed. A request to anything else fails before it leaves the device. An `http`
  URL on a declared host fails too, unless you declared that host `{ "host": "…", "insecureHttp": true }`
  (apiVersion 2, [section 3](#declaring-an-insecure-host-apiversion-2)). An IP address or a local name (`localhost`, `.local`, …) is always
  refused unless the person typed it. Kino also refuses a declared name that resolves to an address
  inside the person's own network (loopback, private, link-local, carrier-grade NAT, multicast, and
  the IPv6 prefixes that embed one), and never sends your traffic through a proxy set on the device.
- **Redirects** (301, 302, 303, 307, 308) are followed by Kino, up to 10 hops; each hop is checked
  and counted as a request -- a hop Kino refuses (or asks the person about) counts too. A 303, or a 301/302 after a POST, turns into a GET without a body. With
  `redirect: "manual"` you get the 3xx answer instead (a login form usually answers 302 on success).
- **A host you forgot may be asked about, during `resolve` and `episodes` only.** When one of those
  calls fetches an `https` host you did not declare (a redirect hop included), Kino asks the person
  ("Quiere conectarse por primera vez a `<host>`. ¿Permitir?"). Your call's time limit stops while
  they decide, and the fetch goes on after "Permitir"; "Rechazar" or Back fails it as
  `host_not_allowed` and is remembered. The question comes down unanswered, with nothing remembered,
  if your call ends first (it failed, timed out, or the person left). One call asks about at most 3
  hosts, and nothing more once the person rejects one in it: after that, every other undeclared host
  of that call just fails as `host_not_allowed`. `search`, `home`, `browse`, the
  live lists, a download and a call that is already over never ask: the fetch just fails as
  `host_not_allowed`. Don't rely on it: declare your hosts.
- **A non-2xx answer does not throw**: check `r.ok`. Everything else that goes wrong throws an error
  with a `code` you can test (`e.code === "timeout"`):

<!-- contract:fetchErrors:start -->
| `e.code` | When |
| --- | --- |
| `host_not_allowed` | the host (or a redirect hop) is not one you declared or the person typed, or it is `http` on a declared host not marked `insecureHttp`; under `"fetchHosts": "any"`, a host reached only through it over `http`, on a port other than 443, or a single-label name |
| `timeout` | no complete answer within `timeoutMs` |
| `network` | the connection failed, or too many redirects |
| `too_large` | the request over the size cap, or a body over 5 MB |
| `invalid_request` | a bad URL, method, `redirect` or `body`, or more requests than a call allows |
| `rate_limited` | under `"fetchHosts": "any"`, too many requests to hosts reached only through it: more than 60 a minute to one site or 600 every 10 minutes in all (250 and 2,500 for a plugin converted from a Nuvio scraper) |
<!-- contract:fetchErrors:end -->

Kino 0.9.54: Kino's error messages are English and may change; match on `code`.

Kino 0.9.55: a `host_not_allowed` names the refused host in `e.host` (a redirect hop's host when the hop was refused;
absent in the signing lane, where no host is reached). Older Kino leaves `e.host` undefined, so read it as
`e.host || null` rather than parsing `e.message`.

- **Limits:** 15 s per request by default (30 s at most), a body of at most 5 MB (decoded with the
  charset of its `Content-Type`, UTF-8 by default), a request (URL, headers and body, a `{ base64 }` body counted as its
  base64 text) of at most 1 MB, and at most 60 requests in one call to your
  plugin, redirect hops and refused hops included (a plugin Kino converted from a Nuvio scraper
  gets 250). At most 6 of your fetches run at the same time; the rest wait their turn.
- **With `"fetchHosts": "any"` approved** ([manifest](#3-the-manifest)), from Kino 0.9.55 a host you did not declare is reached only
  over `https` on port 443, at a public IPv4 address or a name with a dot, and those requests (every hop that goes
  out) spend a budget kept for the whole app: at most 60 a minute to one site (a domain and its subdomains together)
  and 600 every 10 minutes in all (250 and 2,500 for a converted Nuvio scraper), refilled continuously. Over it the
  fetch fails at once with `rate_limited`; your declared hosts never spend it (declare your primary sites).
- **Headers you set** are sent as given, except `Host`, `Content-Length`, `Transfer-Encoding`,
  `Connection`, `Cookie2` and `Accept-Encoding` (Kino asks for gzip itself and always hands you the
  body decompressed; a copied browser `Accept-Encoding` would get you compressed bytes instead). Unless you set `User-Agent`, Kino sends `Kino/<version> (plugin <id>)`.
  A `Content-Type` header sets the type of the body.
- **Cookies:** each plugin has its own cookie jar. Kino stores what your hosts set (`Set-Cookie`
  never reaches your code) and sends it back on later requests, following the usual rules (domain,
  path, `Secure`, expiry). The jar is saved on the device, so a login survives the sandbox and the app
  restarting; it is deleted when the person changes your settings or uninstalls the plugin.
- **A marker from `kino.secret`** in the URL, a header, or the body is swapped for its real value
  right before the request goes out, and that request is then held to a stricter rule than the one
  above: only your manifest's `hosts`, over `https`, on every hop — see
  [Sealed secrets](#sealed-secrets-apiversion-4).

### `kino.secret(name)` (apiVersion 4)

```js
const key = kino.secret("apiKey");   // a marker, not the value; any other name throws
await kino.fetch(`https://api.example.org/v1/list?key=${key}`);
```

A placeholder for a value sealed in your manifest's `secrets` field. Kino opens each seal at most
once per run and swaps the marker for the plain value only where `kino.fetch` sends it (and inside
`kino.crypto`'s key-like fields); nowhere else in your code ever sees it, and anything that comes
back — the response, a cookie, an error, a log line — has it swapped back for the marker, even
before your code first asks for it. Full rules, the
`seal.mjs` tool and the security level: [Sealed secrets](#sealed-secrets-apiversion-4).

### `kino.cookies`

```js
kino.cookies.get("https://site.example/", "session")  // the value, or null
kino.cookies.clear()                                  // forget every cookie of this plugin
```

`get` only answers for URLs your plugin may reach. At most 50 cookies per domain and 64 KB in total.

### `kino.crypto`

Synchronous functions for what sites do to hide their links. Every string argument is text in an
encoding you choose (`utf8`, `hex` or `base64`); errors carry `code: "crypto_error"`.

```js
kino.crypto.hash("sha256", "hola")                        // hex by default
kino.crypto.hmac("sha1", "key", "data", { outputEncoding: "base64" })
kino.crypto.decrypt("aes-128-cbc", { key: "0123456789abcdef", iv: "abcdef9876543210", data: b64 })
kino.crypto.encrypt("aes-256-gcm", { key: k, keyEncoding: "hex", iv: n, ivEncoding: "hex", data: "hola" })
kino.crypto.pbkdf2("sha256", "password", "salt", 10000, 32)   // hex
kino.crypto.randomBytes(16)                               // hex
kino.crypto.uuid()
```

- `encrypt` takes text (`utf8`) and returns `base64`; `decrypt` takes `base64` and returns text.
  Change either with `inputEncoding` / `outputEncoding`; keys, IVs and GCM's `aad` take
  `keyEncoding`, `ivEncoding`, `aadEncoding` (default `utf8`).
- CBC and ECB use PKCS#7 padding unless you pass `padding: "none"`. GCM appends its 16-byte tag to
  the ciphertext, and expects it there to decrypt (as most sites send it).
- A wrong key size, a bad padding or a failed GCM tag throws; it never returns garbage silently.
- A `kino.secret` marker is only accepted as the whole `key` of an AES `encrypt`/`decrypt`, or as
  part of an HMAC `key` or `pbkdf2`'s `password`/`salt` — never in `data`, `iv` or `aad`, nor as a
  `des-ede3` key. A [typed cipher key](#typed-cipher-keys-apiversion-6) (apiVersion 6) is the
  exception: the whole key of any cipher, `des-ede3` included, and nothing else. See
  [Sealed secrets](#sealed-secrets-apiversion-4) for why.

#### Byte operations (apiVersion 13)

For binary protocols (MTProto and the like), on strings in any of the three encodings. They come with the Kino you run on,
not with your manifest: Kino gives every plugin the `kino.crypto` of its own version, so a Kino that predates one of them
lacks it whatever `apiVersion` you declare: Kino 0.9.74 has all five, an older Kino none (and the development builds
before 0.9.74 lack `convert` and `aesIgeVerify`).
Feature-detect each one and keep a fallback: `typeof kino.crypto.convert === "function"`. The kit does the same: it offers
what its own contract has.

```js
kino.crypto.aesIge("decrypt", keyHex, ivHex, dataHex, { keyEncoding: "hex", ivEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex" })
kino.crypto.modPow(baseHex, expHex, modHex)          // big-endian hex, padded to the modulus' width
kino.crypto.gunzip(b64)                              // base64 in, text out by default
kino.crypto.convert(hex, "hex", "base64")            // re-encoding, done natively
kino.crypto.aesIgeVerify(keyHex, ivHex, dataHex, {   // AES-IGE decrypt + SHA-256 MAC check in one call
  mac: msgKeyHex, macPrefix: authKeySliceHex, macOffset: 8,
  keyEncoding: "hex", ivEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex",
})
```

- `aesIge` is AES-256-IGE: a 32-byte key, a 32-byte iv (two blocks) and data a multiple of 16 bytes.
- `convert(data, from, to)` turns, say, the hex of a chunk you sliced out of a message into the base64 a `read` answers,
  without a JavaScript loop over its bytes.
- `aesIgeVerify` decrypts like `aesIge("decrypt", ...)` and then checks that bytes `macOffset` to `macOffset + mac.length` of
  `SHA-256(macPrefix || plaintext)` equal `mac` (`mac` and `macPrefix` read with `macEncoding`, hex by default). It answers the
  plaintext only when they match; otherwise it fails with "the mac doesn't match". MTProto 2.0's msg_key check is exactly
  that, with 32 bytes of the auth key as `macPrefix` and `macOffset: 8`.
- A sealed value is refused in every field of these five. Anything malformed fails with "invalid crypto operation".

#### Key pairs, signatures and key agreement (apiVersion 6)

Some players prove they are a real player by signing a challenge: they make a key pair, sign what the
server sends with the private key and send back the public key. `kino.crypto` does that with keys
that never leave Kino:

```js
// Node:      const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
// WebCrypto: await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
async function createAttest(challenge) {
  const { privateKey, publicKey } = kino.crypto.generateKeyPair({ type: "ec", namedCurve: "P-256" });
  // WebCrypto's ECDSA signature is r||s (64 bytes on P-256): format "ieee-p1363". Node's default is "der".
  const signature = kino.crypto.sign({ key: privateKey, data: challenge, hash: "SHA-256", format: "ieee-p1363" });
  return { publicKey: publicKey.jwk, signature };   // signature is base64; pass outputEncoding: "hex" for hex
}
```

- `generateKeyPair({ type: "ec", namedCurve: "P-256" | "P-384" })`, `{ type: "ed25519" }` or
  `{ type: "x25519" }` answers `{ privateKey, publicKey }`. `publicKey` is `{ type, namedCurve?, jwk,
  spki, raw }`: the JWK object in WebCrypto's key order (`{ crv, kty, x, y }`, base64url), the DER
  SubjectPublicKeyInfo as base64, and the raw key as base64 (`04||x||y` for `ec`, 32 bytes otherwise).
- `privateKey` is a handle, `{ type, namedCurve?, handle }`: the key itself stays inside Kino. A handle
  works only in the sandbox that made it: not in `sign()`'s signing lane, not after the plugin restarts
  (it closes after a few idle minutes), never on another device, so make the key in the call that uses
  it. At most 64 live at once; a new one drops the oldest. Private keys cannot be imported or exported.
- `sign({ key, data, encoding?, hash?, format?, outputEncoding? })` reads `data` as `utf8` unless you
  say `hex` or `base64`, and answers base64. `ec`: `hash` `"SHA-256"` (default) or `"SHA-384"`, `format`
  `"der"` (default) or `"ieee-p1363"` (64 bytes on P-256, 96 on P-384). `ed25519`: 64 bytes, no `hash`.
- `verify({ key, data, signature, signatureEncoding?, hash?, format? })` answers `true`/`false`; a
  malformed signature is `false`. `key` is a public key (yours, or a peer's from `importKey`), a bare
  `{ jwk }`, or your own private key.
- `importKey({ format: "jwk", key: jwkObject })`, `{ format: "spki", key: base64 }` or `{ format: "raw",
  key: base64, type, namedCurve? }` answers a public key in the same shape; a point off its curve throws.
- `deriveSharedSecret({ privateKey, publicKey })` is ECDH (both `ec` on the same curve: 32 bytes on
  P-256, 48 on P-384) or X25519 (32 bytes), base64 by default. Hash it (or HKDF it with `hmac`) before
  using it as a key.
- No `kino.secret` marker is accepted anywhere in these five functions.

| Node / WebCrypto | `kino.crypto` |
| --- | --- |
| `generateKeyPairSync("ec", { namedCurve: "P-256" })` / `subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, …)` | `generateKeyPair({ type: "ec", namedCurve: "P-256" })` |
| `generateKeyPairSync("ed25519")` / `generateKeyPairSync("x25519")` | `generateKeyPair({ type: "ed25519" })` / `{ type: "x25519" }` |
| `publicKey.export({ format: "jwk" })` / `subtle.exportKey("jwk", publicKey)` | `publicKey.jwk` |
| `publicKey.export({ format: "der", type: "spki" }).toString("base64")` / `exportKey("spki", …)` | `publicKey.spki` |
| `subtle.exportKey("raw", publicKey)` | `publicKey.raw` (base64) |
| `crypto.sign("sha256", data, privateKey)` | `sign({ key: privateKey, data, hash: "SHA-256" })` (DER) |
| `crypto.sign("sha256", data, { key, dsaEncoding: "ieee-p1363" })` / `subtle.sign({ name: "ECDSA", hash: "SHA-256" }, …)` | `sign({ key, data, hash: "SHA-256", format: "ieee-p1363" })` |
| `crypto.sign(null, data, ed25519Key)` / `subtle.sign("Ed25519", …)` | `sign({ key, data })` |
| `crypto.verify(…)` / `subtle.verify(…)` | `verify({ key: publicKey, data, signature, … })` |
| `createPublicKey({ key: jwk, format: "jwk" })` / `subtle.importKey("jwk", …)` | `importKey({ format: "jwk", key: jwk })` |
| `crypto.diffieHellman({ privateKey, publicKey })` / `subtle.deriveBits({ name: "ECDH" or "X25519", public }, …)` | `deriveSharedSecret({ privateKey, publicKey })` |

Buffers become strings: pass `encoding`/`outputEncoding` (`hex` or `base64`) where Node takes or gives a
Buffer. There is no `kino.crypto.generateKeyPairSync`: a Node or browser library calling it must be
adapted to these calls. A plugin that uses them should declare `"apiVersion": 6`, so a Kino without
them refuses to install it (`validate` says so).

<!-- contract:crypto:start -->
| Function | Algorithms |
| --- | --- |
| `hash`, `hmac` | `md5`, `sha1`, `sha256`, `sha512` |
| `encrypt`, `decrypt` | `aes-128-cbc`, `aes-192-cbc`, `aes-256-cbc`, `aes-128-ecb`, `aes-192-ecb`, `aes-256-ecb`, `aes-128-ctr`, `aes-192-ctr`, `aes-256-ctr`, `aes-128-gcm`, `aes-192-gcm`, `aes-256-gcm`, `des-ede3-cbc`, `des-ede3-ecb` |
| `pbkdf2` | `sha1`, `sha256`, `sha512` |
| encodings | `utf8`, `hex`, `base64` |
| `generateKeyPair` (apiVersion 6) | `ec`, `ed25519`, `x25519`; `ec` on `P-256`, `P-384`; at most 64 private keys alive per runtime (a new one drops the oldest) |
| `sign`, `verify` (apiVersion 6) | ECDSA with `SHA-256`, `SHA-384` as `der` or `ieee-p1363`; Ed25519; a signature at most 512 bytes |
| `importKey`, `deriveSharedSecret` (apiVersion 6) | public keys as `jwk`, `spki`, `raw`; ECDH (same curve) and X25519 |
<!-- contract:crypto:end -->

### `kino.browser.capture(url, options?)` (apiVersion 6)

Only with `"browser": true` in the manifest, approved by the person, and only inside a `resolve` the person started:
they pressed play, or they started a download (its copy choice included). Anywhere else -- another function, or a
`resolve` Kino runs in the background, such as an availability check -- it throws `not_allowed`; Kino never resolves a
browser plugin's live channels ahead while the person zaps. A download's capture never waits for another page: if one
is open it gets `busy` at once (that copy is skipped). It opens `url` in a hidden web view on the device, lets the page run (media muted), presses
play, and answers the video requests the page made:

```js
export async function resolve(ref) {
  const page = await kino.browser.capture(`https://example.com/watch/${ref}`, { timeoutMs: 18000 });
  const [first, ...rest] = page.media;              // HLS/DASH first, then MP4
  return {
    url: first.url,
    headers: first.headers,                          // Referer, User-Agent (+ Origin, Cookie): send them back
    alternatives: rest.map((m) => ({ url: m.url, headers: m.headers })),
    subtitles: page.subtitles.map((s) => ({ url: s.url, lang: "es" })),
  };
}
```

| option | |
| --- | --- |
| `timeoutMs` | 1 to 25000 ms; default 18000. The capture ends at the first video request (plus 1 s for its siblings; manifests are returned before MP4s whatever the order they came in) or here. |
| `headers` | Extra headers for the first page load only (a `Referer` an embed insists on). `Cookie`, `Host` and the like are dropped. |
| `match` | A regular expression (case-insensitive, 1-500 characters) for what counts as the video; default: `.m3u8`, `.mpd`, `.mp4`, `master.txt`, `videoplayback`, `/hls/`. |
| `autoplay` | Default `true`: start any video, click the usual play/server buttons a few times, and tap the middle of the page every 2 s (a tap reaches a cross-origin embed's player). |

The answer is `{ media: [{ url, mime?, headers }], subtitles: [{ url }], finalUrl }`, at most 8 media and 10
subtitles. A video request is **never fetched by the page**: Kino holds it (the page gets an empty answer), so a
single-use or session-bound token in its address is still unspent when the player asks. Its `headers` are the ones
the page's request carried (Referer, Origin, User-Agent, Accept-Language, a token header…, at most 12; never `Range`,
`Accept-Encoding` or the app's package) plus the page's cookies for that address: return them as the Stream's
`headers` and the player is served what the page would have been. Errors carry a code: `browser_unavailable` (this device has no WebView -- some TV boxes -- and always in
the Node kit), `timeout` (the page showed no video), `blocked` (the start host is not yours, not https, or resolves
into the home network; or the page asks for a human -- a CAPTCHA, ALTCHA, Turnstile, hCaptcha, "Confirme que es
humano" -- which Kino never tries to solve: the capture ends as soon as it shows, so move on to your next server), `busy` (another page is open; one at a time in the whole app), `not_allowed` (not approved, not in `resolve`, or a
`resolve` nobody started), and
`invalid_request`. Try a cheaper path first (a `kino.fetch` that finds the address in the HTML) and keep the
capture for what needs it; when one server fails, try the next.

With `"fetchHosts": "any"` approved (from Kino 0.9.55), what the hidden page may open is gated in three layers, with
one rule for the **start address** and every later **top-level navigation** (a redirect, a meta refresh, a script
setting `location`): a host you declared or the person typed keeps its own rules (an `insecureHttp` host takes `http`,
a declared host any port, a typed server exactly as typed); a host reachable only through the grant must be `https`, on
port 443, at a name with a dot or a public IPv4 address. Navigations may leave your hosts -- embeds hop by design -- and
the first one that breaks the rule ends the capture with `blocked` ("only https pages on port 443 at a public name with
a dot are opened"). This is detection, not always prevention: when the device's WebView routes the page through Kino's
proxy, a server redirect of the top page is followed by the WebView before Kino sees it, so its target may be contacted
once before the capture ends (the same holds for a page read). The page's **subresources** (frames, scripts, the
video's CDN) stay as broad as before: any public server, never the home network, covered by your own `"browser": true`
consent rather than by the grant, and not counted in the `kino.fetch` budget. Service workers are kept off the network
only where the device's WebView supports it (as before). Without the grant a capture's navigations are not guarded.

#### Every match, a cookie, an answer on timeout (Kino 0.9.54)

Four more options, with no new apiVersion: Kino 0.9.54 and later take them, older Kino ignores them and runs a plain
capture. Check `kino.browser.captureAll === true` before relying on them (`node sdk/validate.mjs` warns when you
don't).

```js
if (kino.browser.captureAll) {
  const page = await kino.browser.capture(embed, {
    match: "master\\.m3u8", captureAll: true, alsoMatch: ["\\.key", "/subs/"], timeoutMs: 15000,
  });
  const master = page.requests[0];                 // the first request matching `match`
  const key = page.requests.find((r) => /\.key/.test(r.url));
}
```

| option | |
| --- | --- |
| `captureAll` | Collect every request whose URL matches `match` (or the default media pattern) or one of `alsoMatch`, deduplicated by URL, at most 20, and end once the first match was seen and nothing new matched for 1 s (or at 20, or at `timeoutMs`). |
| `alsoMatch` | Only with `captureAll`: 1 to 10 more regular expressions (case-insensitive, 1-500 characters each; a string or a RegExp's source). Their requests are collected and still reach the page (only `match`'s are held back). |
| `waitForCookie` | A cookie name (an HTTP token, such as `cf_clearance`) the page must also hold for its current host. Without `match` no request is needed: the page ends as soon as the cookie is there. With `match`, only when both hold (with `captureAll`, the 1 s settle starts then). A page that waits for a cookie is never autoplayed or tapped. `captureAll` with `waitForCookie` needs a `match`. |
| `returnCookiesOnTimeout` | A page that runs out of time answers what it had, with `timedOut: true`, instead of throwing `timeout`. |

A call that used any of them also gets `requests` (`[{ url, method, headers }]`, the first match first, each with the
method and the headers the page sent), `cookies` (the final page's, as an object: at most 64 and 16,384 characters in
all, Cloudflare's `cf_*`/`__cf*` kept first), `userAgent` (the hidden page's, the one Cloudflare ties `cf_clearance`
to: send it with those cookies) and `timedOut`. On a timeout answer with no match seen, `requests` holds only
`alsoMatch` hits (or nothing): check each URL against your own patterns. A call without these options gets exactly the
answer above. Patterns are searched anywhere in the URL, the top page's own address and its redirects included;
start one with `(?-i)` to make it case-sensitive.

These four names were ignored before Kino 0.9.54 (the capture simply dropped them); from 0.9.54 on they are checked, and
a value of the wrong type (`captureAll: 1`, `alsoMatch: "x"`, a cookie name with a space) is `invalid_request`. No
plugin in Kino's catalog sends them today.

A capture's page may navigate anywhere public at the top level (an embed's redirect chain, such as hglink's, hops
hosts by design): it only ever returns the video requests the page made and the top page's last address, never a
document. To read a page's HTML use [`kino.browser.page`](#kinobrowserpageurl-options-apiversion-6), whose top
document must stay on your hosts. The hidden page takes none of the person's touches or keys; the only taps it gets
are the capture's own, and never on a human check.

Each page starts with no cookies or storage and everything is wiped when it closes; nothing is shared with
`kino.cookies` or with any other plugin. The page cannot open windows, download files, leave http(s), read files,
ask for location, camera or microphone, or show dialogs, and there is no bridge from the page to your code: what
you get back is only what the page requested.

### `kino.browser.page(url, options?)` (apiVersion 6)

Only with `"browser": "pages"` in the manifest (apiVersion 6), approved by the person, and only from `search`, `home`,
`browse`, `episodes`, `details` (Kino 0.9.54), `section` or `resolve` while the person is using the app: their own search, the
Home row or section they opened, a list, a title, their play (a `resolve` also for a download they started). A call
Kino makes on its own -- "Para ti" checking its suggestions after an episode ends, `categories` (always Kino's own call,
even while the person looks at Categorías), the Home rows it prefetches at start, new chapters, the live zap's resolve ahead, sync, an update check --
gets `not_allowed`, and so does a list's read while the app is not in front. It loads `url` in the same hidden web
view as [`kino.browser.capture`](#kinobrowsercaptureurl-options-apiversion-6) -- same start-host rule, same proxy and
home-network refusal, fresh cookies and storage, one page at a time in the whole app -- and returns the page's HTML
once it is loaded, is **no longer the site's browser check page** (Cloudflare's "Just a moment…", its `cf-chl`
markers) and matches `waitFor`.

The page you read must **stay on your own hosts**: not only the start address but every top-level navigation -- a
redirect, a meta refresh, a script setting `location`, an open redirect -- and the document finally read must be on a
host your `kino.fetch` may reach, over https. The first one that is not stops the read with `blocked` ("la página
terminó en un host que el plugin no declaró") and no HTML comes back; frames, scripts and images inside the page may
still load from any public server. Nothing on the page plays (media needs a gesture that never comes), and the
hidden page takes none of the person's touches or keys.

```js
// A site whose every kino.fetch answers Cloudflare's 403 "Just a moment…" page.
const BASE = "https://example.com";

async function read(url, waitFor) {
  const r = await kino.fetch(url);
  if (r.ok && !/just a moment|cf-chl/i.test(r.text)) return r.text;       // cheap path first
  const page = await kino.browser.page(url, { waitFor, timeoutMs: 12000 });  // under search's 15 s budget
  return page.html;
}

export async function search(query) {
  try {
    const html = await read(`${BASE}/?s=${encodeURIComponent(query.q)}`, "class=\"item");
    return kino.html.select(html, "article.item").map(/* … your items … */);
  } catch (e) {
    // blocked: the site wants a person (a captcha) or never let the device in. Kino never solves one: give up quietly.
    if (e.code === "blocked" || e.code === "busy" || e.code === "rate_limited") return [];
    throw e;
  }
}
```

| option | |
| --- | --- |
| `timeoutMs` | 1 to 25000 ms; default 15000. It counts inside your call's own limit (`search` 15 s, your other fetches included; `home`, `browse`, `episodes`, `details`, `section` 20 s; `resolve` 75 s for a browser plugin). Kino cuts it to what is left of that limit, minus 1.5 s for you to use the HTML, so the read ends with its own `timeout` answer instead of the whole call being cancelled; still, pass about 12000 in `search` and leave room for your other fetches. |
| `waitFor` | A JavaScript regular expression (a string or a `RegExp`, 1-500 characters, matched case-insensitively against the HTML inside the page; a `RegExp` keeps its `m` and `s` flags, the others change nothing for a test): the page is returned only once it matches. Without it, as soon as the page is loaded and past its check page. Use it for pages that fill in their list with scripts. |

The answer is `{ html, finalUrl, status, truncated }`: the doctype and the DOM's `outerHTML` after the page's own
scripts ran (at most 2,000,000 characters, the same as `kino.html.select` takes; `truncated` is `true` when it was
cut), the top page's last address, and the HTTP status of its last load (200 unless that load answered an error).

**Kino never solves, clicks or ticks a captcha.** A page read never touches the page at all -- no click, no tap, no
key, no scroll, no autoplay helper -- so the only check that can pass is one that completes by itself, the way it
does when a person opens the site: Cloudflare's automatic check usually does, in a few seconds. A page that asks for
a human -- a CAPTCHA, hCaptcha, a reCAPTCHA checkbox, ALTCHA, "Verify you are human", "Confirme que es humano" --
ends the read at once with `blocked`, and a page still on its check page when `timeoutMs` runs out is `blocked` too
(the site did not let the device in). Do not retry it in a loop; fall back to another source or return nothing.

Errors carry a code: `browser_unavailable` (no WebView on this device, and always in the Node kit once the request
is valid and the manifest says `"pages"` -- the kit answers `invalid_request` and `not_allowed` the way the app does
first; keep a plain `kino.fetch` path so the kit can still run your plugin), `timeout` (the page did not load, or
`waitFor` never matched), `blocked` (above: a human check, a check page that never passed, a top document off your
hosts; or the start host is not yours, not https, or resolves into the home network), `busy`
(another hidden page is open; a list's read waits up to 8 s for its turn, and the person pressing play ends it),
`not_allowed` (no approved `"browser": "pages"` -- `true` is capture-only --, another function, or nobody is using the app), `rate_limited` (more
than 20 page reads in a minute by this plugin: a site is never hammered through the hidden browser) and
`invalid_request`. Each read opens a fresh page, so cache what you read with `kino.storage` when you can.

### `kino.cloudstream` (generated plugins only)

Present only in the plugins Kino itself generates when the person installs a plugin from a CloudStream repository;
a plugin you write never has it (`typeof kino.cloudstream` is `"undefined"`), whatever its manifest says. Its four
functions (`search`, `mainPage`, `load`, `loadLinks`, typed in `kino.d.ts`) run a CloudStream provider inside the
separate CloudStream bridge app. They throw `not_found` when the provider itself failed and `unavailable` for
everything else (no bridge, an incompatible plugin, a timeout, a refused request; the message says which).

### `await kino.meta(query)`: asking Kino about a title (Kino 0.9.53)

```js
if (typeof kino.meta === "function") {                       // Kino 0.9.53+: absent before, so check first
  const m = await kino.meta({ type: "series", ids: { imdb: "tt0944947" }, lang: kino.lang });
  if (m) {
    // { title, overview, year, poster, backdrop, logo, genres, runtimeMinutes, tagline, certification, directors,
    //   episodes: [{ season, number, title, overview, still, airDate, id: "tt0944947:1:1" }],
    //   ids: { imdb, tmdb, tvdb, kitsu, mal, anilist }, ratings, cast, sources: ["tmdb", ...] }
  }
}
```

Kino answers what it knows about a title, and your plugin never touches a TMDB key for it. The answer is built exactly
the way Kino's own info page builds a title's page: **Kino's own TMDB lookup** first (an app feature of Kino, on Kino's
own key, in Spanish es-MX; no key ever reaches your code), **AniList** for an anime (through the anime id mapping, so a
`kitsu`, `mal` or `anilist` id works too), then **the person's installed `meta` plugins** (a Stremio metadata addon
configured with their own key, for example). Each later source only fills what the earlier ones left empty; ratings add
up. `null` means nobody knew the title: it is never an error.

- **The query**: `type` (`"movie"` or `"series"`) and at least one id: `imdb` (`"tt0133093"`), or `tmdb`, `tvdb`, `kitsu`,
  `mal`, `anilist` as positive integers (a number or a digit string, up to 2147483647). `lang` (`"es"`, `"es-MX"`) goes to
  the person's meta plugins. A bad query throws `invalid_request`; the whole query is at most 4,096 characters as JSON.
- **The answer**: every field appears only when known, except `ids` (every id Kino knows for the title, yours included:
  ask with an IMDb id and get the TMDB and TVDB ones) and `sources` (`"tmdb"`, `"anilist"`, `"plugin"`: who contributed).
  `episodes` only for a series (at most 5,000; trimmed from the end so the whole answer stays under 1,000,000
  characters), each with its Stremio-style `id`. `ratings` at most 6 (TMDB's vote is `{ source: "tmdb" }`), `cast` at
  most 20, `genres` at most 5.
- **Never yourself**: your own `meta` export is never asked on your behalf, and a `kino.meta` called from inside a `meta`
  export asks no plugin at all (only TMDB and AniList), so two meta plugins cannot ask each other in a loop.
- **Limits**: at most 30 calls a minute per plugin (then `rate_limited`, a token bucket: it refills one call every 2 s);
  8 s at most (6 s for each meta plugin; what is known by then is answered), counted inside your call's own time limit;
  the TMDB/AniList part is cached 30 minutes per query and the meta plugins' answers share the info page's own 30-minute
  cache. Not from `sign()` (`not_allowed`). No new network destination: TMDB and AniList are Kino's own, and each meta
  plugin uses its own approved hosts. Kino's telemetry counts calls and error codes, never the ids.
- **No new apiVersion**: `kino.meta` is in every plugin on Kino 0.9.53 and later, whatever its manifest says; older Kino
  has no such function, so feature-detect it (`typeof kino.meta === "function"`). `node sdk/validate.mjs` warns when your
  code calls it without that check.
- **By title (apiVersion 9, Kino 0.9.55, `kino.meta.byTitle === true`)**: `kino.meta({ type, title, year? })` when you have no id.
  `title` 1 to 200 characters, `year` 1870 to 2100 and only with `title`; anything else is `invalid_request`. Kino
  searches TMDB (the type's own search, es-MX) and keeps the hit whose es-MX or original title equals yours once both
  are normalised (lowercase, no accents, punctuation as spaces); with a `year` that exact year wins, else one a year off.
  A tie (same title and year, or same title with no year) or no match answers `null`, never a guess. Otherwise the
  answer is exactly the ids lookup's (same shape with `ids` filled in, same budget, timeout and cache). With `ids` too,
  the ids win. The kit's fixture takes keys `"movie:title:the matrix:1999"` (normalised title, then the year, or none).

Under the Node kit, `kino.meta` answers `null` unless you point `KINO_META_FIXTURE` at a JSON file of answers
(`docs/plugins/fixtures/kino-services/meta.json` in Kino's repository is a sample: keys `"movie:imdb:tt0133093"` or
`"tmdb:1399"`).

### `await kino.tmdb(path, params?)`: TMDB without a key in your code (Kino 0.9.53)

```js
async function tmdb(path, params) {
  if (typeof kino.tmdb === "function") return kino.tmdb(path, params);   // Kino 0.9.53+: Kino brings the key, never your code
  // Older Kino: your own "tmdbKey" setting, as before.
  const key = kino.config.get("tmdbKey");
  if (!key) throw kino.error("auth_required", "falta la llave de TMDB");
  const q = new URLSearchParams({ ...params, api_key: key });
  const r = await kino.fetch(`https://api.themoviedb.org/3${path}?${q}`);
  if (!r.ok) throw kino.error(r.status === 404 ? "not_found" : "unavailable", "TMDB respondió " + r.status);
  return r.json();
}

const week = await tmdb("/trending/movie/week", { language: "es-MX" });
```

A read-only door to TMDB's v3 API. Your plugin never holds a key: Kino brings one, in this order:

1. **Kino's own TMDB key**, always. Its calls go through Kino's TMDB cache (shared with Kino's own screens, kept on disk;
   a request already on its way is shared, not repeated) and through limits of their own, so plugins cannot spend Kino's
   TMDB quota: at most 20 calls per 10 s per plugin and 60 per 10 s for all plugins together reach TMDB on Kino's key.
2. **The person's own key, only when Kino's fails**: TMDB refuses Kino's key (401/403), TMDB rate-limits it (429), or one
   of Kino's two limits above is spent. Then the same request goes again with the key the person typed in **Ajustes de todos
   los perfiles ▸ Llaves ▸ Tu llave de TMDB** (optional; a v3 API key, 32 hexadecimal characters, or a v4 read access token; synced between their
   devices), else the key they configured in an **installed Stremio addon** (Kino looks in each addon's saved
   configuration for a field whose name contains "tmdb", no addon is listed by name, and uses it only after the person said
   yes once to "Usar la llave de TMDB de tu addon <name>", also synced).
3. **With neither**: a copy from the cache up to 7 days old when there is one; otherwise `rate_limited` (Kino's limit, or
   TMDB's 429) or `unavailable` (TMDB refused Kino's key).

`no_tmdb_key` is left for a Kino build with no key of its own and a person with none either: `e.userMessage` is then Kino's
own sentence for the person, in their language: "Agrega tu llave de TMDB en Ajustes de todos los perfiles ▸ Llaves" / "Add your TMDB key in Settings for
all profiles ▸ Keys". Uncaught,
the person reads that same sentence. On such a build, a person's key TMDB refuses is `no_tmdb_key` too.

A key your plugin keeps in its own settings (a `tmdbKey` setting) stays your plugin's business: Kino never reads it for
`kino.tmdb`. Kino adds the key itself (`api_key` for a v3 key, an `Authorization: Bearer` header for a v4 token): your code
never sees any key, Kino's or the person's, and answers, errors and logs never carry one. You do not declare
`api.themoviedb.org` in `hosts` for it.

- **`path`**: starts with `/discover`, `/trending`, `/search`, `/movie`, `/tv`, `/find`, `/genre`, `/configuration`,
  `/person` or `/collection` (`"/movie"` or `"/movie/603/credits"`), without the `/3` version, without a query string,
  no `..` and no `//`. Anything else (an account, a list, a rating: what writes or reads the person's account) is
  `invalid_request`. GET only.
- **`params`**: a plain object of at most 20 strings, numbers or booleans, each at most 500 characters as text, names
  like `language`, `page`, `with_genres`, `vote_count.gte`, `append_to_response`. Never `api_key`, `session_id`,
  `guest_session_id`, `request_token` or `access_token` (`invalid_request`).
- **The answer**: the body as parsed JSON. `404` is `not_found`, a body over 2 MiB is `too_large`; when TMDB does not
  answer in 15 s (`timeout`), cannot be reached (`network`) or answers 5xx (`unavailable`), the cached copy (up to 7 days)
  is served instead when there is one. Anything else that is not a 2xx with JSON is `unavailable`.
- **Limits**: at most 40 calls per 10 s per plugin whichever key answers (a token bucket), and the two limits on Kino's
  key above; a fresh cached answer counts against neither of Kino's. Cached 10 minutes in memory by path and params (so per
  `language`; only bodies up to 512 KiB), and on disk with Kino's TMDB cache (from 1 hour for lists and searches to 7 days
  for `/find` and `/genre`), whichever key fetched it. Not counted in `kino.fetch`'s 60 requests per call. Not from
  `sign()` (`not_allowed`). Kino's telemetry counts calls by how they were served (cache, Kino's key, the person's key) and
  error codes, never a path or a key.
- **No new apiVersion**: Kino 0.9.53 and later; feature-detect it (`typeof kino.tmdb === "function"`) and keep your own
  key setting only as the fallback for older Kino, as above. A plugin that builds its catalog from TMDB no longer needs
  to ask each person for a key.

Under the Node kit, `kino.tmdb` uses your key from `KINO_TMDB_KEY` (or `"tmdbKey"` in `sdk/config.json`) where the app uses
Kino's, with the stricter limit on Kino's key (20 per 10 s; the kit has no person's key to fall back to), and with
`KINO_TMDB_FIXTURE` it answers offline from a JSON file keyed `"<path>?<params sorted by name>"` or `"<path>"`
(`docs/plugins/fixtures/kino-services/tmdb.json` in Kino's repository). Without either, it throws `no_tmdb_key`, as a Kino
build without a key does. Try it: `KINO_TMDB_KEY=… node sdk/run.mjs . home`.

### `kino.sleep(ms)` and `kino.error(code, message?, { userMessage }?)`

`await kino.sleep(1500)` waits 0 to 5000 ms (for a site that rate-limits you); the time counts
inside the call's own limit. `kino.error` builds the typed errors of
[section 4](#errors-people-understand); its optional `{ userMessage }` is your own sentence for the
person, shown under the rules there.

### `kino.sync.remoteChanged()` (Kino 0.9.74)

Additive, for a `realtime` provider only (any other plugin gets `not_allowed`). Call it when your
plugin notices that the remote changed (for example from `syncStatus`); Kino then pulls. Kino accepts
at most one signal every 30 seconds and drops one that arrives while a round runs, so do not signal
from inside `syncPull`. Your code only runs while Kino calls it, so Kino keeps pulling every
`pullEveryMs` as well. Feature-detect it with `typeof kino.sync === "object"`. See [Sync providers](#sync-providers-syncprovider-apiversion-12).

### `kino.config`

```js
kino.config.get("server")   // a setting's value: a string, or true/false for a toggle
kino.config.all()           // every setting that has a value, as an object
```

Read-only: the values the person saved, or the `default` of a setting they left alone. A setting
with no value and no default is `undefined`.

### `kino.html.select(html, css)`

Parses `html` and returns `[{ text, html, attrs }]` for every element matching the CSS selector
(Jsoup's selector syntax): `text` is its text, `html` its inner HTML, `attrs` an object of its
attributes. Only the first 2,000,000 characters of `html` are read, at most 500 elements come back,
and it throws if the combined text and HTML of the matches goes over 5,242,880 characters (5 MB). A
selector longer than 10,000 characters throws `Error("CSS selector too long (over 10000 characters)")`. **It
exists only inside Kino**: the Node kit's version throws, so test anything that uses it in the app.

### `kino.storage`

```js
kino.storage.get("key")                          // the string, or null
kino.storage.set("key", "v")                     // values are converted to strings
kino.storage.set("key", "v", { ttlMs: 3600000 }) // expires after that many milliseconds
kino.storage.remove("key")
kino.storage.keys()                              // every key, as an array (expired keys are already gone)
```

Synchronous, private to your plugin, and it survives restarts of the sandbox and of the app. At most
256 KB in total (measured as the JSON of all keys and values); going over throws a `KinoError` with
`code` `"too_large"` and the message `"plugin storage full (256 KB)"`. It is deleted when the person uninstalls the
plugin, and it is **not** cleared when they change your settings.

#### A bigger storage for a catalog (`storageLarge`, apiVersion 13)

A plugin that indexes a catalog (thousands of videos of a channel, a library it builds from its source) runs out of
256 KB after a few hundred entries. To **search** thousands of records, use [`kino.catalog`](#catalog-sqlite-kinocatalog-catalog-apiversion-13)
instead: it never loads them into your memory. Declare `storageLarge` and the same `kino.storage` holds **16 MB in total
(16,777,216 bytes: every key and value, UTF-8), at most 2 MB per value (2,097,152 bytes) and at most 1,000 keys of at
most 256 characters**:

```json
"apiVersion": 13,
"capabilities": ["search", "resolve", "storageLarge"]
```

- Same API and the same `ttlMs` rules. Declarative (nothing to export) and no consent line: it is room on the device,
  not reach.
- **Shard the catalog into values of at most about 512 KB** (`catalog:0`, `catalog:1`, ... plus a small key that says
  how many there are). Every string your plugin holds costs QuickJS memory (a 2 MB string is 4 MB of your 64 MB), and
  Kino keeps each value in its own file: a `get` reads one value, a `set` writes one value, so small shards stay fast on
  a 1 GB TV box.
- Going over throws a `KinoError` with `code` `"too_large"`: `"plugin storage full (2 MB per value)"`,
  `"plugin storage full (16 MB)"` when the whole store would pass 16 MB, `"plugin storage full (1000 keys)"`. A key
  longer than 256 characters is `"invalid_request"`. A refused write changes nothing.
- **It is device-only: never synced and NOT in any backup.** A plugin without the capability has its 256 KB
  `kino.storage` carried by a backup with a password; a plugin with `storageLarge` has nothing of its `kino.storage` in
  a backup, and restoring one leaves it empty. Treat it as a cache you rebuild from your source.
- **Declaring `storageLarge` moves your existing keys into that device-only store.** The first call after an update that
  adds it moves everything your plugin had stored (tokens and sessions included) out of the backed-up store, at most
  1,000 keys of at most 256 characters (the rest is dropped). Keep credentials and sessions in
  [sealed secrets](#sealed-secrets-apiversion-4) or the person's settings, or in a plugin that does not declare
  `storageLarge`.
- An update that drops `storageLarge` starts again from an empty 256 KB store (the larger one stays on the device until
  the capability comes back or the plugin is uninstalled).
- An older Kino refuses a manifest with `storageLarge` ("needs a newer version of Kino").

`set`'s third argument is optional: leave it out for a permanent entry, exactly as before this option
existed. Give `{ ttlMs }` to make the entry expire -- after that many milliseconds `get` returns `null`
and `keys()` no longer lists it, even across a restart of the app. `ttlMs` must be a whole number
greater than 0 and at most 2,592,000,000 (30 days); anything else throws (`code` `"invalid_request"`)
before your entry is touched, the same way an oversized value already does. An expired entry never counts against the
cap (256 KB, or 16 MB with `storageLarge`): it is dropped the next time your plugin reads or writes storage. Example, a Home row
cached for an hour:

```js
export async function home() {
  const cached = kino.storage.get("home-rows");
  if (cached) return JSON.parse(cached);
  const rows = await buildHomeRows();
  kino.storage.set("home-rows", JSON.stringify(rows), { ttlMs: 60 * 60 * 1000 });
  return rows;
}
```

### `kino.catalog` (apiVersion 13)

`upsert`, `search`, `get`, `remove`, `clear` and `count` over a SQLite catalog of your own items, for a plugin that
declares `catalog`. The whole guide, with every rule, limit and error: [Catalog (SQLite)](#catalog-sqlite-kinocatalog-catalog-apiversion-13).

### `kino.qr.scan(options?)` (apiVersion 13)

With the `qrScan` capability: opens Kino's camera scanner full screen on the phone and resolves with the scanned text
(1 to 4,096 characters) or `null` when the person closes it. Only from a settings `action`, a `panelAction`
or a `screenEvent` the person pressed (`not_allowed` from anything else); `unavailable` on a TV or without a camera. See [QR scanning](#qr-scanning-kinoqrscan-qrscan-apiversion-13) for the rules, the errors and a
two-device login recipe.

### `kino.screen` (apiVersion 14)

What this Kino's screen canvas draws, for feature detection: `kino.screen.names` (the node types as this guide spells them,
`Column`, `TextField`, `titleRail`...), `kino.screen.widgets` (the same by their older names) and `kino.screen.version` (the
screen contract's own number, 1 for now). `undefined` on an older Kino. See [Screens](#13-screens-screen-apiversion-14).

### `kino.library`, `kino.room`, `kino.ai` and `kino.shared` (apiVersion 14)

Each needs its capability: what the person watched and saved ([`library`](#reading-what-the-person-watched-library)), a room
over the Internet hosted on the device ([`room`](#rooms-over-the-internet-room)), one ask to Kino's text AI
([`ai`](#kinos-text-ai-ai)) and a few small results synced between the person's devices
([`shared`](#results-shared-between-devices-shared)). A background `job(ctx)` (`schedule`) is described in
[Background jobs](#background-jobs-schedule-jobs-jobctx).

### `kino.log(...args)`

Also `console.log`, `console.info`, `console.warn` and `console.error`: they all go to the log
(tag `KinoPlugin` in `adb logcat`; `KinoPlugin/<your id>` in a debug build of Kino, or in any build while your
plugin's "Modo debug" switch is on: `"debug": true` only makes that the default), objects are written as JSON, and a message is cut at 2000
characters. Under the Node kit they go to stderr.

When a call of a plugin whose manifest says `"telemetry": true` or `"verbose"` (apiVersion 6) **fails**
(it throws, times out, returns something unusable, including `sign`, `settingsStatus`, `action` and
`validateSettings`), the lines it logged during that call — the last 30, each cut at 300
characters — travel with the failure report to the maintainers' error tracker as `plugin_log`, so a
`kino.log("home: status", r.status)` before the throw is how you see why it failed on someone else's
phone. Each report is tagged with your plugin's id and version. At most one report per function and
kind of failure an hour. Nothing is sent for a call that succeeds, and no line of any plugin that does
not declare `telemetry` (recommended or not, a converted Nuvio scraper): for those Kino only notes that
the call failed (your id and version, the function, the kind of failure). From Kino 0.9.54 the person
can turn "Enviar registros de errores y de reproducción" off in your plugin's tab in Ajustes (on by default, synced
across their devices), and then nothing is sent while it is off; older builds always send a declared plugin's lines. Before it leaves the device
every line has URLs, hostnames, IPs, e-mails, long ids, long hex/base64 runs, credential-shaped text,
the person's setting values and the text of their search or title removed, and the whole is capped at
2 KB (the newest lines win). Still: log what happened (a status, a step, a count), never what the
person typed or a secret, and never a setting's value. Works on every `apiVersion`.

**`kino.log.report(...args)`** (apiVersion 6, with `"telemetry": true`) writes a line like `kino.log` and also
tells the error tracker that your plugin served a **degraded** result, even though the call worked: it fell back to a
shared account, used a backup source, trimmed a list. The line's first word names the area, and must be a namespaced
word of lowercase letters, digits, `_` and `:` with at least one `_` or `:`, up to 24 characters
(`kino.log.report("myplugin:session", "shared_fallback", "tries=2")` is area `myplugin:session`); any other first word
(a bare word, anything with a dot, `@` or `/`, or one that holds one of the person's values) is filed as `other`. At most
one report per plugin and area an hour and 3 per plugin until Kino restarts, sent as a warning; the whole line is
scrubbed like any log line, the text of the call running at the time included. Without `telemetry` (or, once that switch
exists, with it off) it is just a log line. Report what happened in codes and counts, never values that came from a response.

### Playback metrics and problem reports

Kino measures every playback of a plugin stream (a film, a chapter, a live channel) and every cast of one to a TV, with
no code in your plugin. Each playback gets one record: how long `resolve` took, the time to the first frame (the zap
time for a channel), how the player reached the stream (`direct`, `proxy`, `signed_proxy`, `remux`), the video decoder
and its switches, resolution, bitrate and codec, how the stream is delivered (`hls`, `dash`, `ts`, `progressive`),
rebuffers and the time spent stalled with each stall's likely cause (`stall_cause`: `network_slower_than_bitrate`,
`network_buffer_dry`, `decoder_or_device`, `memory_brake`, `seek` (a seek's own buffering) or `unknown`, judged from the device's bandwidth estimate, the playing bitrate, the
buffer at the stall's start, late or dropped frames and Kino's memory brake), the network type (`wifi`, `ethernet`,
`cellular`, `other`; never its name), "slow connection" notices shown and a move to a lighter copy, player errors by class with
their HTTP status, retries and their reason (`expired`, `conflict`, `network`, `cut`…), and for a request-signed stream
`sign` p50/p95/max and timeouts per playlist and segment, fetch p50/p95 and errors per host **index** (0 = the stream's
own host, 1… = its `alternateHosts`). Detectors watch for what a viewer feels: no first frame in 10 s, a frozen picture,
long stalls, dropped-frame bursts, audio underruns or sink errors, audio and video drifting apart, the audio track lost,
decoder errors, falling behind the live window, HTTP errors per segment class; and for a cast the receiver's load
timeouts, errors and idle reasons, a remux that stopped, the TV starting far from the phone's position, and a session
that dropped. Nothing they write holds a URL, a host, a token or anything the person typed: only numbers and Kino's
own words.

Where it goes:
- your plugin's **Registro** (while its "Modo debug" switch is on), one `kino:play …` line per milestone and a summary line;
- **logcat** under the tag `KinoPlay` in a debug build of Kino, or in any build while that switch is on
  (`adb logcat -s KinoPlay KinoPlugin/<your id>` shows Kino's lines and yours together);
- the **error tracker**, only with `telemetry` (and, once that switch exists, while the person leaves it on): with `true`, one summary per playback that
  ended on an error the person saw, and one in twenty of the playbacks that went well (at most 6 until Kino restarts, one an
  hour per kind; only under a consent given to the wording that names playback data, see `telemetry`); with `"verbose"`, a quarter of the playbacks that went well instead, and one event per
  problem or edge case (at most 60 per plugin until Kino restarts, one a minute per area). Failure events carry the
  Kotlin exception's stack and, when your script threw, its own stack frames (`at fn (plugin.js:12:5)`, frames only).

### `kino.rank`

For a search backend that only matches a loose bag of shared words rather than a title as a whole:
asking it a long title can return twenty unrelated results that merely share one common word, with
the real match buried on page two. These three pure functions make a backend like that behave like a
title search, without touching its own JSON shape.

```js
kino.rank.shortQuery(query)
kino.rank.sortBySimilarity(items, query, getTitle?)
kino.rank.filterRelevant(items, query, getTitle?)
```

- **`shortQuery(query)`** returns the title's HEAD, up to its first `:`, `,`, `|`, en dash or em
  dash: ask your backend that instead of the whole title, so its own ranking has less noise to sort
  through. A one- or two-letter head ("El", "A") identifies nothing, so the whole (trimmed) text
  comes back instead; a plain `-` is never a cut point (it would split "Spider-Man"). Try it against
  your backend first -- some do worse with a short query, not better.
- **`sortBySimilarity(items, query, getTitle?)`** reorders `items` so the ones sharing the most words
  with `query` come first; ties keep the backend's own order.
- **`filterRelevant(items, query, getTitle?)`** drops items that only share a stray word with
  `query`. Reordering alone still shows a full page of near-misses when the title genuinely is not on
  the backend; this makes an absent title come back with 0 results instead.

`query` is a title, or an array of several forms of one worth trying together --
`[query.q, query.originalTitle, ...query.altTitles]`, since a backend may only know a title in one
language. `getTitle` reads a title off one of your own `items`; it defaults to
`(item) => item.title`, and may itself return an array the same way `query` can, when an item keeps
a title in more than one field or language (every form's words are combined). Matching folds accents
and case and ignores words of 1-2 letters (the "el", "de", "of" that make unrelated titles look
alike); `filterRelevant` keeps an item once it shares at least 60% of a requested title's distinctive
words.

**Bad input never throws.** Unlike `kino.fetch`/`kino.crypto`/`kino.sleep`, these three never raise a
`kino.error` for a malformed argument: `items` that is not an array answers `[]` from either
function. An item with no usable title -- `null`, `undefined`, `getTitle` returning something that is
not a string (or an array with none in it), or `getTitle` itself throwing -- is treated as "no title"
rather than crashing your call: `filterRelevant` drops it like an actual near-miss, and
`sortBySimilarity` sorts it after every item that does have one, in your list's own order among
themselves.

```js
export async function search(query) {
  const titles = [query.q, query.originalTitle, ...query.altTitles];
  const r = await kino.fetch(BASE + "/search?q=" + encodeURIComponent(kino.rank.shortQuery(query.q)));
  const found = r.json().results; // whatever shape your backend answers with
  const relevant = kino.rank.filterRelevant(found, titles, (x) => x.name);
  return kino.rank.sortBySimilarity(relevant, titles, (x) => x.name).map(toItem);
}
```

If your backend already ranks a full title well, skip `shortQuery` and run only
`filterRelevant`/`sortBySimilarity`, on what it gives you for `query.q` as typed.

Two things left out on purpose. Neither retries with the full title: if `shortQuery`'s head happens
to be a common word (e.g. "Love, Death & Robots" -> "Love") and the backend returns nothing relevant
for it, retry `search` with the full title yourself when the short one comes back empty. And neither
does anything with season numbers or ordering: how a backend spells "season 2" in its own titles
("T2", "Temporada 2", …) is specific to that backend, not something these can fold in.

## 6. Limits and engine quirks

### Every number in one place

<!-- contract:limits:start -->
| What | Limit |
| --- | --- |
| Manifest / entry file / icon | 16 KB / 1 MB / 128 KB |
| Memory / stack, per plugin | 64 MB / 1 MB |
| Time per call | `search` 15 s; `home`, `browse`, `episodes`, `resolve` 20 s each (`resolve` of a plugin Kino itself generates, from a Nuvio scraper or a Stremio addon: 75 s); `liveCategories`, `liveChannels`, `guide` 20 s each; `liveSearch` 15 s; `subtitles` 10 s; `track` 10 s (apiVersion 7); `segments` 8 s (apiVersion 7); `meta` 6 s (apiVersion 6; past it, no answer); `section`, `categories` 20 s each (apiVersion 6); `details` 20 s (apiVersion 8); `migrate` 10 s; `sign` 1.5 s (and 3 s counting its wait); counting all your fetches and sleeps together, but not the time the person spends answering a host question for that call |
| Loading the module (its top level) | 10 s |
| Idle sandbox | closed after 5 minutes without calls |
| Consecutive timeouts | 3 in a row and Kino disables the plugin ("No responde") |
| `kino.fetch` | https only (or the person's own server as typed, or `http` on a host declared `insecureHttp`); 15 s default, 30 s maximum; response body at most 5 MB; the request (URL, headers and body) at most 1,048,576 characters; inside a sync provider's `syncPull` and `syncPush` only, both the request and the response body may reach the declared blob's base64 plus 64 KB (ceil(`sync.maxBlobBytes` × 4/3) + 65,536); at most 60 requests per call, every hop counted, refused ones included (250 for a plugin converted from a Nuvio scraper); at most 6 fetches in flight at once; at most 3 host questions per call; at most 10 redirects per request; under `"fetchHosts": "any"`, a host reached only through it: https on port 443, a dotted name or public IPv4 address, at most 60 requests a minute per site and 600 every 10 minutes per plugin (250 / 2,500 for a converted Nuvio scraper), else `rate_limited` |
| Cookies | 50 per domain, 64 KB in total per plugin |
| `kino.storage` | 256 KB per plugin (with `storageLarge`, apiVersion 13: 16 MB in total, 2 MB per value, 1,000 keys of at most 256 characters); an entry's optional `ttlMs` is 1..2,592,000,000 ms (30 days) |
| `kino.sleep` | 0 to 5,000 ms per call |
| `kino.meta` (Kino 0.9.53) | at most 30 calls a minute per plugin; 8 s at most (each other `meta` plugin 6 s), inside your call's own limit; the query at most 4,096 characters; the answer at most 1,000,000 characters; cached 30 minutes |
| `kino.tmdb` (Kino 0.9.53) | at most 40 calls per 10 s per plugin; on Kino's own key at most 20 per 10 s per plugin and 60 per 10 s for all plugins (then the person's key, else the cache or `rate_limited`); 15 s per call; a body at most 2 MB; at most 20 params of at most 500 characters; cached and shared by all plugins, per route (12 hours for a series by id and its seasons and episodes; 30 days for a movie, person or collection by id, any title's credits, images and the like, and for `/find`, `/genre`, `/configuration`; 24 hours for `/search`; 3 hours for `/trending`, `/discover` and the lists; 10 minutes for anything else, an empty answer or a 404), bodies up to 512 KB; a cached answer does not count against these limits, and when TMDB fails (not when it refuses the key) the last copy is served; not counted in `kino.fetch`'s requests per call |
| `kino.crypto` | data at most 5 MB per call; PBKDF2 at most 100,000 iterations and 64-byte keys; `randomBytes` at most 1,024 |
| `kino.ws` (apiVersion 13) | at most 4 open sockets per plugin (the fifth is refused with `limit`); at most 8 MiB (8,388,608 bytes) of received messages queued unread per socket, past that the socket closes with `limit`; a frame to send at most 786,000 bytes once decoded, also when sent as a `hex` or `base64` string (`too_large`); one `recv` waits at most 60 s; `wss://` to a declared, approved host only; memory: what is queued unread sits on Kino's heap (up to 32 MiB with every socket full), what you keep from it counts in your 64 MB sandbox; not measured on 1 GB TV boxes, so read what arrives and keep little |
| `byteSource` (apiVersion 13) | at most 2 open streams at once on the device (another is refused), and apart from them at most 2 served to TVs (one per Chromecast and DLNA cast); each `read` asks for 1 MiB (1,048,576 bytes) at an offset that is a multiple of 1,048,576 (so always a multiple of 4,096), the last one running past `size`; 3 chunks ahead are read while one plays; Kino keeps the last 8 chunks read per stream; `handle` 1 to 512 characters; memory: each open stream holds up to about 12 MiB of Kino's heap (the chunks kept, the ones read ahead and the one in flight), so 2 on the device plus 2 served to TVs can reach about 48 MiB, besides your 64 MB sandbox; not measured on 1 GB TV boxes |
| `kino.catalog` (apiVersion 13) | at most 100,000 items per plugin (then `limit`), as long as they fit in the file: about 670 bytes per item on average, so keep `data` small; `id` 1 to 128 characters, `title` at most 300 characters, `data` at most 4,096 bytes of JSON; at most 500 items or ids per call; `search`: `q` at most 256 characters, `limit` default 50, at most 100, `offset` at most 1,000,000; the database file at most 64 MiB (then `limit`); one SQLite file per plugin, on the device only |
| `kino.qr.scan` (apiVersion 13) | one scanner on screen at a time (another scan, from any plugin, is `busy`); it closes after 120 s (`timeout`); `title` and `titleEn` at most 80 characters; the scanned text 1 to 4,096 characters (a longer code is ignored); only from a settings `action`, a `panelAction` or a `screenEvent` that follows the person's tap or submit (else `not_allowed`), never on a TV or a device without a camera (`unavailable`); a settings `qr` setting's text at most 512 characters, asked again every 2,000 to 60,000 ms (`refreshMs`) |
| Images from the plugin (`imageSource`, apiVersion 13) | `handle` 1 to 512 characters, no control character; `image` answers at most 256 KB once decoded (262,144 bytes), canonical base64, `image/jpeg`, `image/png`, `image/webp` only; 10 s per call; at most 1 image call in flight per plugin, none while one of your byte streams is open or your `read` is queued or running or ended less than 2 s ago (an image waits up to 20 s, then is skipped); a timed-out call discards your sandbox (QuickJS cannot be interrupted); a failed handle is not asked again for 5 minutes; 2 timeouts in a row pause your images for 5 minutes; each image asked once, then kept in Kino's image disk cache per plugin, version and handle |
| `kino.log` / `console.*` | 2,000 characters per message; when a call of a plugin whose manifest declares `telemetry` fails, its last 30 lines (each cut at 300 characters, scrubbed, 2,048 characters in all) go with the failure report |
| What a function returns | at most 2,000,000 characters once turned into JSON (a sync provider's `syncPull` and `syncPush`: up to ceil(`sync.maxBlobBytes` × 4/3) + 65,536, set by its declared blob) |
| Results | `search` 100 items; `home` 20 rows of 60; `browse` 100 per page; `episodes` 5,000 (and 50 `seasons`); `ref` 4,096 characters; `next` 2,048 characters; `id` matches `^[A-Za-z0-9._~-]{1,128}$` |
| Live channels (apiVersion 3) | `liveCategories` 200; `liveChannels` 500 per page, 10 pages at first and 5 more per scroll, 10,000 channels (200 pages) per category; `liveSearch` 100 channels, asked from 2 characters; `guide` 50 channels and 24 h per call, 100 entries per channel; `number` 1..9999 |
| Tracking (apiVersion 7) | `progress` at most every 5 minutes of playback; `watched` once, with 3 minutes or less left and at least 90% played; at most 200 events waiting per plugin; an event not delivered within 7 days is dropped; a retryable failure waits 30 s, doubling up to 6 h, 12 tries at most |
| Settings | at most 12 with a value, plus at most 16 `section`/`status`/`action`/`link`/`help` (apiVersion 6; `link` and `help` apiVersion 12, at most 4 of each) and `qr` (apiVersion 13); `text` 500, `url` 2,048, `password` 500 characters; a `link`'s address 2,048, a `help`'s title 60 and body 2,000 |
| Error messages | your `kino.error` message is a detail for the log, cut at 200 characters; a `userMessage` for the person is at most 160 |
| `hosts` | at least 1 entry, no upper limit from Kino 0.9.45 (only the manifest's 16 KB; Kino 0.9.44 and older refuse more than 20); from apiVersion 2, none (`[]`) when a `url` setting exists |
| `secrets` (apiVersion 4) | at most 16; names match `^[A-Za-z][A-Za-z0-9_]{0,31}$`; a value is 1..4,096 bytes (1..8,192 from apiVersion 6); from apiVersion 6 a cipher key may be typed: `{ seal, use: "cipher-key", encoding: "hex" | "base64" }`, 16/24/32 bytes |
| `kino.fetch` `maxBytes` (apiVersion 14) | 1 to 2,000,000 bytes of the body are read, the answer's `truncated` says whether it was cut; out of range: `invalid_request` |
| Screens (`screen`, apiVersion 14) | depth 10, 600 nodes, 500 items per list, state 64 KB, a text 2,000 characters; `screen` and `screenEvent` 20 s each; every number in [Screen limits](#screen-limits) |
| `kino.library` (apiVersion 14) | `limit` default 50, at most 100; at most 30 calls a minute per plugin; times rounded to the day, `progress` to 0.01 |
| `kino.room` (apiVersion 14) | a payload at most 8,192 bytes and 4 levels; 5 messages a second, 100 and 256 KB a minute per member; 2 to 8 members; 10 to 240 minutes (default 120); mailbox 200 events or 15 minutes; 2 joined and 1 hosted per device, 2 per plugin; 5 wrong codes lock joins for 60 s, doubling up to 30 minutes; closed after 30 minutes in the background (a hosted room shows Kino's notification meanwhile) |
| Jobs (`schedule`, apiVersion 14) | 1 to 3 jobs, every 15 to 1,440 minutes; one run at most 20 s, 10 requests made one at a time, 2 MB of answers and 256 KB written to `kino.storage`; 96 runs a day per plugin; a failure waits 15 minutes, doubling up to 6 h, and 3 in a row pause the job |
| `kino.ai` (apiVersion 14) | a prompt at most 8,192 bytes, `system` 2,048; the reply cut at `maxChars` (1 to 4,096, default 2,048); 10 asks in any minute, 100 a day and 1 at a time per plugin; 300 a day and 2 at a time for every plugin of the device together; 20 s an ask |
| `kino.shared` (apiVersion 14) | 4 keys of at most 40 characters per plugin; a value at most 64 KB and 16 levels, 128 KB in all; 30 writes a minute; a key's new value travels at most once every 60 s |
<!-- contract:limits:end -->

### How your code lives

- **One call at a time.** Calls to the same plugin run one after another. The sandbox is reused
  between calls, but Kino throws it away after 5 idle minutes, after a timeout, when a call is
  cancelled (for example a newer search replaces an older one), and when the plugin is updated or
  disabled. Module-level variables are a cache at best: keep anything that must survive in
  `kino.storage`.
- **Load-time code.** When it installs your plugin, Kino loads the module once in a throwaway sandbox
  without network access, to check that every declared capability is an exported function. Keep the
  top level to declarations: a network call there fails, and the install with it.
- **Errors reach people.** If your function throws, that call fails and the person sees an error that
  names your plugin, and the text of your `Error` can be part of it. Write those messages for a
  person, in Spanish, short.
- **Runaway code.** Running out of memory or stack fails the call. A synchronous infinite loop
  (`while (true) {}`) **cannot be interrupted**: at the time limit Kino stops waiting for the call
  and discards the sandbox, but the loop keeps spinning on its own thread until it ends, which for a
  real infinite loop means until the app is closed. Three timeouts in a row disable the plugin.
- **App closed during a call.** A crash inside the engine, or being killed for memory, can take the
  whole app down mid-call, and nothing in-process can catch that. Kino notices at the next start:
  whichever plugins were mid-call at that moment each get an unclean exit counted against them —
  **including a healthy plugin that simply happened to be running at the same time**, not only the
  one that actually caused the crash. Two unclean exits in a row for the same plugin, with no call
  finishing normally in between, switch it off ("No responde") exactly like three timeouts in a
  row; a call that completes normally resets its count.

### The engine is not Node and not a browser

Plugins run in QuickJS. It handles modern JavaScript: `async`/`await`, classes with fields, `?.` and
`??`, regular expressions with lookbehind, named groups and `\p{L}` under the `u` flag, template
literals, spread, `replaceAll`, `Array.prototype.at` and `flat`, `Object.fromEntries`,
`Promise.allSettled`, `Map`, `Set`, `BigInt`. It does **not** have the platform around it:

- **Missing globals** (`typeof` is `"undefined"` inside Kino): `setTimeout`, `setInterval`,
  `setImmediate`, `queueMicrotask`, `Buffer`, `process`, `require`, `fetch`, `AbortController`,
  `structuredClone`, `performance`, `crypto`, `WeakRef` and `Intl`. Use `kino.sleep` to wait,
  `kino.fetch` instead of `fetch` and `kino.crypto` instead of `crypto`. `URL`, `URLSearchParams`,
  `atob`, `btoa`, `TextEncoder`, `TextDecoder` and `console` do exist: Kino provides them.
- **Node has almost all of those**, so code that runs fine under the Node kit can still fail in Kino.
  Before you publish, search your file for the names above.
- **Locale-aware methods do not localize:** `localeCompare` ignores its locale and options (so
  `{ numeric: true }` and `{ sensitivity: "base" }` do nothing; it compares code units), and
  `(1234.5).toLocaleString("es-CO")` gives `"1234.5"`. Write the comparison you need; the reference
  plugin has a small `natural()` for numbered names.
- **Keep function names short.** A function name of millions of characters makes the engine's
  native code crash the whole app. As a best-effort guard, `kino.*`, `console.*`, the web globals and
  the other functions Kino provides are frozen, and on any function `Object.defineProperty`,
  `Object.defineProperties`, `Reflect.defineProperty` and `__defineGetter__`/`__defineSetter__`
  refuse to set `name` to a string longer than 1000 characters, to a getter or setter, or to make
  it writable: they throw a `TypeError` (`Reflect.defineProperty` returns `false`). The guard is not
  airtight (a huge computed key still names a function); a plugin that crashes the app anyway is
  switched off (see "App closed during a call" above). Setting `name` on ordinary objects, and
  `this.name = "MyError"` in an `Error` subclass, work as usual.

### Splitting your code across files

Kino loads exactly one file (the manifest's `entry`), and the engine has no `require` and no
module resolver, so an `import` from `plugin.js` to a second file has nothing to resolve against on
the device. That does not mean you must write the whole plugin in one file — just that the file you
publish has to be the finished, single-file result.

Write it split, normally, then bundle it before you publish:

```
src/
  animeav1.js       a helper module
  plugin.js         the entry point; imports from animeav1.js
kino-plugin.json
package.json
```

```js
// src/animeav1.js
export async function searchAnimeAV1(query) {
  const res = await kino.fetch(`https://animeav1.com/api/search?q=${encodeURIComponent(query.q)}`);
  if (!res.ok) throw new Error("animeav1 respondió " + res.status);
  return res.json().results.map((r) => ({ id: r.slug, ref: r.slug, title: r.title, kind: "series", poster: r.image }));
}
```

```js
// src/plugin.js -- this import is fine: it runs through the bundler, never on the device
import { searchAnimeAV1 } from "./animeav1.js";

export async function search(query) {
  return searchAnimeAV1(query);
}
```

Bundle with [esbuild](https://esbuild.github.io/) (`npm i -D esbuild`), targeting ES module output
(Kino runs the published file as one):

```bash
npx esbuild src/plugin.js --bundle --format=esm --outfile=plugin.js
```

`plugin.js` at the repo root is what comes out of that command, with `src/animeav1.js` inlined into
it and its `export async function search` intact -- that is the file `entry` names and the one Kino
fetches. Add it as an npm script (`"build": "esbuild src/plugin.js --bundle --format=esm --outfile=plugin.js"`)
and run it before every `sdk/` test or publish. Rollup and webpack work the same way; esbuild needs
the least configuration for a plugin this size.

### Structure a bigger plugin in files and bundle it

Two published plugins are built this way and are worth reading whole:
[kinotvapp/kino-plugin-watch-party](https://github.com/kinotvapp/kino-plugin-watch-party) (**Party Chat**, a player
panel tab with rooms and failover; its source also lives here, in
[`examples/watch-party/src/`](examples/watch-party/src/)) and
[kinotvapp/kino-plugin-news](https://github.com/kinotvapp/kino-plugin-news) (**Solo noticias**, a screen and a
background job; [`examples/screen-news/src/`](examples/screen-news/src/)). The recipe they follow:

- **One responsibility per file, grouped in folders** (`util/`, `protocol/`, `ui/`, `exports/`...), a short comment at
  the top of each file saying what it owns, and imports that only go one way: no import cycles (a cycle bundles, but it
  makes the order code runs in depend on who imported whom first).
- **`src/plugin.js` only re-exports** what Kino calls (`search`, `screen`, `panel`, `job`...) and what your tests use.
  The bundle keeps exactly those named exports.
- **One shipped file, generated and committed.** Kino installs `plugin.js` straight from your repository and the
  [signature](#signed-plugins-apiversion-5-kino-0945) covers its exact bytes, so the generated file is committed, never
  edited by hand, and signed after every build. Keep it readable (do not minify): people review what they install.
- **Deterministic.** The same sources must give the same bytes: no timestamps, no absolute paths (run esbuild from the
  plugin's folder), one esbuild version (`"esbuild": "^0.21.0"`). A header line says the file is generated.
- **`check:built`.** A script rebuilds in memory and fails when the result is not exactly the committed `plugin.js`, so
  nobody ships a hand-edited or stale bundle; a test does the same, so `npm test` catches it too. Your other tests load
  the built `plugin.js` with the kit, which is what Kino will run.

The build script both examples use (`scripts/build.mjs`, esbuild's JS API, so the banner needs no shell quoting):

```js
import * as esbuild from "esbuild";
const result = await esbuild.build({
  absWorkingDir: ROOT, entryPoints: ["src/plugin.js"], outfile: "plugin.js",
  bundle: true, format: "esm", target: "es2020", charset: "utf8",
  banner: { js: "// Generated by `npm run build` from src/. Do not edit this file: edit src/ and rebuild." },
  write: false,
});
const text = result.outputFiles[0].text;   // write it (build), or compare it with plugin.js (--check)
```

```json
"scripts": {
  "build": "node scripts/build.mjs",
  "check:built": "node scripts/build.mjs --check",
  "test": "node --test test/*.test.mjs",
  "validate": "node sdk/validate.mjs .",
  "sign": "node scripts/sign.mjs"
},
"devDependencies": { "esbuild": "^0.21.0" }
```

The workflow: edit `src/`, `npm run build`, `npm test`, raise `version` (and your changelog), `npm run sign`,
`npm run validate`, then commit `src/` and `plugin.js` together. Keep `node_modules/` in `.gitignore`. esbuild drops
most comments, so the bundle is readable but bare: point people at `src/` in your README.

### The trap: a rejection nobody is listening to yet (Kino 0.9.49 and older)

**From Kino 0.9.50** a rejection behaves as in Node: a `throw` inside an `async` function is caught
by the caller's `try`/`catch`, `.catch()`, `Promise.all` or `Promise.allSettled`, however early it
happens -- even before the function's first `await`, and even when the handler is attached a few
`await`s later. What still fails the call is a rejection **nobody ever handles**: one still without a
handler once the plugin is only waiting on Kino (a `kino.fetch`, a `kino.sleep`, ...). For example a
helper called without `await` that throws, or a promise you keep and only `await` after a
`kino.fetch`. The call then fails with that error, as Node would stop with an `unhandledRejection`.
Await what you start, or give it a `.catch()` right away.

**Kino 0.9.49 and older** abort the **whole call** when a promise is rejected before anything has a
handler on it, even if your code is inside `try`/`catch`. If your plugin must work there too (people
update late), follow these rules:

- **Aborts the call:** a `throw` inside an `async` function **before its first `await`**, while the
  caller is wrapped in `try`/`catch`. A `.catch()` on that call, or `Promise.all`/`Promise.allSettled`
  around it, do not rescue it either. Also aborts: `new Promise((_, reject) => reject(e))` rejected
  right away, and `return Promise.reject(e)` from an `async` function.
- **Is caught normally:** a `throw` after any `await` (even `await null;`), a rejection coming from
  `kino.fetch` or `kino.sleep` (for example a refused host), and `await Promise.reject(e)` or
  `Promise.reject(e).catch(...)` (those builds delay `Promise.reject` by one tick so a handler can
  attach in time).
- If nobody catches the error anyway, it is harmless: the call fails with that error either way, and
  a `kino.error` code still reaches the person correctly.
- **Nuvio-converted scrapers get a workaround:** when Kino converts a Nuvio scraper it rewrites the
  async helpers bundlers emit (esbuild's `__async`, TypeScript's `__awaiter`, Babel's
  `_asyncToGenerator`) so a transpiled function's body starts one tick later, and a throw before its
  first `await` is caught normally. A native `async` function (yours, or an untranspiled scraper's)
  still needs the `await` before anything that can throw.

So, for those builds, in a helper that a caller may wrap in `try`/`catch`, do the `await` first and
validate afterwards:

```js
// Wrong before Kino 0.9.50: this throw is NOT caught by the caller's try/catch; it aborts the whole call.
async function getJson(url) {
  if (!url.startsWith("https://")) throw new Error("dirección inválida");
  const r = await kino.fetch(url);
  return r.json();
}

// Right everywhere: the first await comes before anything that can throw.
async function getJson(url) {
  const r = await kino.fetch(url);
  if (!r.ok) throw new Error("archive.org respondió " + r.status);
  return r.json();
}
```

(If a helper has nothing to await, start it with `await null;`, or check the input in the caller
before it calls the helper. The examples in this guide do, so they run on older builds too.)

## 7. Test it locally

The Node kit is the `sdk/` folder: `run.mjs` (run one function), `validate.mjs` (check a plugin the
way Kino does), `init.mjs` (scaffold a new one), `kino-shim.mjs` (the `kino` API in Node),
`contract.mjs` (the rules, read from `contract.json`), `guide-tables.mjs` (regenerates this
guide's tables) and `ui-tables.mjs` (regenerates the [User interface](ui.md) tables; `--check` also fails when a widget of
the contract has no section there). There is nothing to install. It needs Node 18 or newer (checked on 18.20, 20.11
and 24.14); `node --test sdk/test/kit.test.mjs` runs its own tests.

```
node sdk/run.mjs ./plugin.js search "metropolis"
node sdk/run.mjs ./plugin.js home
node sdk/run.mjs ./plugin.js browse films 2
node sdk/run.mjs ./plugin.js episodes 'Dragnet1951'
node sdk/run.mjs ./plugin.js resolve 'Dragnet1951|Dragnet/Season 1/Dragnet (1951) - S01E01 - The Human Bomb.mp4'
node sdk/run.mjs . section [tab]      # apiVersion 6: needs "section" in the manifest
node sdk/run.mjs . categories         # apiVersion 6: needs the browse capability
node sdk/run.mjs . theme              # apiVersion 6: your colors, contrast ratios and fallbacks
node sdk/run.mjs . meta tt1254207 tmdb:10378   # apiVersion 6, "meta": Kino's verdict field by field and the info page
```

Screens, panels in screen mode, contributed tabs, jobs and `kino.shared` (apiVersion 14) have their own commands:
[Testing screens with the kit](#testing-screens-with-the-kit).

The first argument is your entry file (or the folder that holds `kino-plugin.json`), then the
function, then its argument: the text to search for, the `ref` for `episodes` and `resolve`, or the
`ref` and an optional cursor for `browse`. The runner reads your manifest, provides the `kino`
global, calls that one function the way Kino does, **checks the answer with the app's rules** and
prints what Kino would keep as JSON on stdout; every entry Kino would drop is reported on stderr with
the reason (`--raw` prints your answer untouched). The kit does not apply the app's secret scrubbing, and `validateSettings` receives exactly the JSON you type: the app sends only valued settings, trimmed. Logs, `console.*` and errors go to stderr, so you can
pipe the result (`... | head -30`, `... | jq`). The exit code is 0 on success, 1 when your code
throws and 2 when the command is wrong. The runner only runs functions your manifest declares.

- `--config key=value` (repeatable) sets a setting; the runner also reads `sdk/config.json`
  (`{ "server": "http://192.168.1.10:8096", "user": "ana" }`; keep it out of git). A required setting
  with no value stops the run with `auth_required`, as in the app.
- `--record fixtures.json` saves every `kino.fetch` answer; `--replay fixtures.json` answers from that
  file only, with no network. Record once, then your tests run offline and always the same (the
  scaffold's `test/plugin.test.mjs` does exactly that).
- `--device tv` (or `KINO_DEVICE=tv`) makes `kino.device` say `"tv"`, to try the TV side of your
  plugin; the default is `"phone"`. Any other value stops the run.
- `KINO_TYPE=movie|series|music|podcast|any` sets the `type` of the search (default `any`).
- To fill the other fields of the query, pass the whole query as JSON:
  `node sdk/run.mjs ./plugin.js search '{"q":"dragnet","type":"series","year":1951}'`
  (`season`, `episode`, `tmdbId` and `year` are `0` otherwise).
- Under the Node kit `kino.storage` is a file named `.kino-storage.json` and the cookie jar
  `.kino-cookies.json`, both next to your manifest. Add them to your `.gitignore`. Delete them to
  start from scratch. A plugin with `secrets` also reads `.kino-secrets.json`
  (`{ "<name>": "<plain value>" }`) from the same folder: see
  [Sealed secrets](#sealed-secrets-apiversion-4). `node sdk/init.mjs` already lists all three in the
  scaffold's `.gitignore`.
- `node sdk/validate.mjs <folder>` checks the manifest with every rule of section 3 (the same
  Spanish messages the app shows) and that each declared capability is exported, and prints the
  consent sheet's extra lines as the person will read them (the red ones, an `insecureHttp` host or
  `"liveStreamHosts": "any"`, marked "(en rojo)");
  `--run <function> [argument]` also runs it and lists what Kino would drop. With
  `--run liveCategories`, every declared playlist is downloaded and parsed too: one that cannot be
  downloaded or parses to 0 channels is a problem, and its discarded entries are listed. With
  `--run search`, `browse` or `home` and the `meta` capability, your `meta` is also asked about the first title that
  carries `ids.imdb` or `ids.tmdb` (as Kino asks about a title another source lists): what it drops is listed, and a
  throw or a timeout past 6 s is a problem. `--run meta <ids>` runs it alone; `null` is a note, not a problem.
  `--run section [tab]`, `--run categories`, `--run settingsStatus`, `--run action <key>` and
  `--run validateSettings '<json>'` (apiVersion 6) run them as `run.mjs` does and as the app reads them: the section and
  categories with their drops (and `section` asks `meta` about its first title with ids, like `home`), each status line
  and its missing ones, what an action shows (and whether it refreshes or clears settings), and whether the save is
  accepted. A call the app never makes is a problem: no `"section"` in the manifest, `categories` without apiVersion 6
  and `browse`, an action key no `action` setting has, a function not exported, or a `validateSettings` answer Kino
  cannot read. Exit code 0 means Kino would accept it.
- The `sdk/` folder does not have to live in your repository. Copy it anywhere and run
  `node /path/to/sdk/run.mjs ./plugin.js ...`.
- A stack trace names a temporary `plugin.mjs`: the runner loads a copy of your file so that Node
  treats it as an ES module whatever its version and `package.json` say. The line numbers are your
  `plugin.js`'s.

**Describing titles** (apiVersion 6, the `meta` capability). `meta <ids> [movie|series]` calls `meta()` with the query
Kino builds for a title another source listed, `{ type, ids: { imdb?, tmdb?, kitsu?, mal?, anilist? }, id?, lang? }`:
`tt…` is `ids.imdb`, `tmdb:N` `ids.tmdb`, and `kitsu:N`, `mal:N`, `anilist:N` set that id and the query's `id` (the
source's own id, as for a Stremio anime); `lang=xx` (default `KINO_LANG`, else `es`), `id=<source id>`, or the whole
query as JSON. It never takes a `ref`: Kino describes a title by its ids, whatever plugin listed it, and asks nobody about
a title with none. The call gets Kino's 6 s; past them the kit stops waiting, as the app does. On stderr: the query, your
answer as you returned it, Kino's verdict field by field (`✓` kept, `~` cut or partly kept, `✗` dropped, `·` absent,
`-` ignored, with the reason for each dropped entry), then how the info page would use it; on stdout, what Kino keeps
(`null` when it is no answer). A real run against the [own-server reference plugin](https://github.com/kinotvapp/kino-plugin-own-server)
(Tu servidor 1.5.0, its `server.mjs` running), with the two JSON copies left out:

```
$ node sdk/run.mjs --config server=http://192.168.2.13:18096 --config user=ana --config password=s3cr3t . meta tt1254207 tmdb:10378
meta({"type":"movie","ids":{"imdb":"tt1254207","tmdb":10378},"lang":"es"})
the plugin answered:
{ … }
Kino's verdict, field by field:
  ✓ title           kept: 14 characters; the page keeps the source's own title, this one is not shown
  ✓ overview        kept: 73 characters; shown as the synopsis when TMDB and AniList have none (HTML tags stripped)
  ✓ poster          kept: http://192.168.2.13:18096/img/poster/bbb.png (a server the person typed); used when the page has no poster
  ✓ backdrop        kept: http://192.168.2.13:18096/img/backdrop/bbb.png (a server the person typed); used when the page has no background
  ✓ year            kept: 2008
  ✓ genres          kept: 2 of 2: Animación, Comedia
  ✓ runtimeMinutes  kept: 10; shown only for a movie (a series' runtime is per episode)
  · episodes        absent: not given
  ✓ logo            kept: http://192.168.2.13:18096/img/logo/bbb.png (a server the person typed); drawn instead of the title's name at the top of the page (Kino 0.9.51+)
  ✓ ratings         kept: 2 of 2: imdb 6.4, letterboxd 3.4/5
  ✓ cast            kept: 2 of 2
{ … }
How the info page would use it (only where TMDB and AniList left the part blank; their values always win):
  top: the logo http://192.168.2.13:18096/img/logo/bbb.png instead of the title's name (the name stays for TalkBack and comes back if the image fails)
  background: http://192.168.2.13:18096/img/backdrop/bbb.png
  poster: http://192.168.2.13:18096/img/poster/bbb.png
  info line: ★ <the page's score>  ·  IMDb 6.4  ·  Letterboxd 3.4/5  ·  2008  ·  10 min
  synopsis: Un conejo enorme y tranquilo contra tres roedores que no lo dejan en paz.
  genres: Animación, Comedia
  Reparto (only when TMDB has no cast): Ana Prueba, Luis Ensayo; character and photo are kept for later, not shown
  title: "Big Buck Bunny" is not shown (the page keeps the source's title)
Kino asks this plugin only about titles another source listed (never its own), with every other meta plugin at once: the first answer in install order wins, within 6 s, remembered 30 minutes (200 titles)
logo, ratings, cast need Kino 0.9.51 or newer; an older Kino ignores them and uses the rest
```

A dropped part reads like `✗ backdrop        dropped: 192.168.1.4 is a private, local or reserved IP address: never the home network`,
and a list with bad entries like `~ ratings         partly kept: 3 of 4: …` followed by one line per entry
(`#3: source "netflix" is not one of imdb, tmdb, …`). The same rules run on the app's own test vectors
(`docs/plugins/fixtures/meta/vectors.json` in Kino's repository), so what the kit keeps is what Kino keeps.

**Live channels** (apiVersion 3). The `channels` exports run through `live`, with the plugin folder
first:

```
node sdk/run.mjs . live categories
node sdk/run.mjs . live channels noticias
node sdk/run.mjs . live channels noticias 2
node sdk/run.mjs . live guide canal1,canal2
node sdk/run.mjs . live search caracol
node sdk/run.mjs live playlist https://iptv-org.github.io/iptv/countries/co.m3u
node sdk/run.mjs live playlist ./lista.m3u --epg ./guia.xml.gz
```

- `live categories` calls `liveCategories()` and prints what Kino keeps. Then, for each `{ playlist }`
  in the answer, it downloads the list as the app would (your `headers`, your `hosts` or the person's
  server only, every redirect too) and prints, on stderr, the same summary as `live playlist` and
  the list's groups as the categories people will see.
- `live channels <categoryId> [cursor]` calls `liveChannels({ categoryId, cursor })`, then plays the
  first channel that has a `ref` and no `stream` the way Kino would: it sends that `ref` to
  `resolve()` and checks the answer as a live channel's (so `"liveStreamHosts": "any"` applies). With
  `validate.mjs --run liveChannels`, a refused answer there is a problem.
- `live search <query>` calls `liveSearch({ query })`, prints the channels Kino keeps (at most 100)
  and plays the first one with a `ref` like `live channels` does.
- `subtitles <tt… | tmdb:<id>> [season episode]` (or the whole argument as JSON) calls `subtitles()`
  with the argument Kino builds (`KINO_LANGS=es,en` for the languages) and prints the tracks Kino
  keeps, each dropped one on stderr. It runs whether the plugin declares `subtitles` or only exports it.
- `resolve <ref> --live` checks a `resolve()` answer as a live channel's. Without `--live` the kit
  cannot know the `ref` is a channel's and applies the strict rule; when only that stops the URL
  and your manifest has `"liveStreamHosts": "any"`, it says "si este ref es de un canal en vivo,
  prueba con --live".
- `live guide <id,id>` calls `guide()` with those ids and a 24-hour window starting two hours ago.
- `live playlist <url|file>` needs no plugin: it reads any M3U list with Kino's own rules and prints
  `N canales en M categorías; K entradas descartadas; L ocultas (adultos)`, the categories, and the
  first 20 channels as `group › name  url`. With `--epg <url|file>` it also shows what each of those
  20 has on now, or "sin guía". A guide that declares a DOCTYPE is refused, as in the app, and the
  command says so: "La guía declara un DOCTYPE; Kino la rechaza por seguridad". Use it on a list
  before you write a line of plugin.

The kit reads lists and guides with `sdk/live-playlist.mjs`, a copy of the app's readers pinned to
the same test files (`docs/plugins/fixtures/live` in Kino's repository): what it keeps is what Kino
keeps.

**What the Node kit does not reproduce.** Kino is the authority; the kit only approximates it so
you can iterate fast. Before you publish, install the plugin in the app and try it there. The
differences:

- `kino.html.select` throws (it uses Jsoup, which exists only in the app).
- The kit's XMLTV reader is a tolerant regex walk, not the app's XML parser. It gives the app's answer
  on every shared test guide, but on malformed XML in mid-document it may keep more than the app
  (which stops at the first error and keeps what it read up to there).
- The rejection trap of [section 6](#6-limits-and-engine-quirks): Node catches what Kino 0.9.49 and older
  would not.
- Node has globals Kino lacks (`setTimeout`, `fetch`, `Buffer`, ...): the plugin may pass under Node
  and fail in Kino. Kino's `URL` has no punycode.
- The host, redirect and request-count rules are the same, and so are the cookie rules as far as
  Node's own parsing goes, but there is no refusal of names that resolve to private addresses, bodies
  are always read as UTF-8, and the 15 s timeout covers the wait for the response but not the
  download.
- The per-call time limits, the memory limit and the size caps on requests, answers and selectors
  are not enforced, except `meta`'s 6 s (Kino gives up silently there, so the kit says so).

## 8. Publishing your plugin

1. **Create a public GitHub repository** and put `kino-plugin.json` and your entry file (for
   example `plugin.js`) at its root, plus an optional `icon.png` and a `README.md`. Add
   `.kino-storage.json` to `.gitignore`. (A plugin can also live in a subfolder; people then type
   `owner/repo/sub/dir`.)
2. **People install it** in Kino from Ajustes > Plugins, typing `owner/repo` in the field
   "usuario/repositorio" and pressing "Agregar". To point at a release, they type `owner/repo@v1.0.0`.
   Tag your releases so that people can pin them.
3. **A private repository cannot be installed.** Kino reads your files from
   `raw.githubusercontent.com` without any credentials, and GitHub answers a private repository with
   "not found". Make the repository public, or the plugin cannot be installed.
4. **To ship an update, raise `version`** (a strictly higher `MAJOR.MINOR.PATCH`; an unchanged or
   lower number is treated as "already up to date", so a fix without a version bump never reaches
   anyone). Kino checks for updates at most once a day per plugin, and when the person taps
   "Buscar actualización".
   - If the new version does not add anything to `hosts`, `permissions`, `download`, `drm` or an
     `insecureHttp` host, and needs a supported `apiVersion`, it is installed silently.
   - If `hosts` or `permissions` grow, or the manifest newly declares `download`, `drm`, or marks an
     already-approved host `insecureHttp`, Kino does **not** apply it: the plugin shows "Actualización
     disponible — requiere tu aprobación" and the person sees the new ones (marked "nuevo") before
     accepting. Removing them needs no approval.
   - **After a Kino update**, the first start checks every plugin that was installed and enabled
     before it, right away. In this release (a build switch Kino will turn off later) the updates
     that wait for approval are then installed **without asking**, once, and only when read from the
     plugin's own install address; a one-time notice "Se actualizaron tus plugins" lists each plugin
     and what it may do now (for example "Envía a Kino registros de errores y datos técnicos de algunas reproducciones"), with shortcuts to its
     tab in Ajustes, to disable it and to uninstall it. With the switch off, a one-time sheet "Hay
     actualizaciones de tus plugins" offers "Actualizar todos" and shows each consent sheet in turn.
     Later updates of your plugin follow the rules above.
   - A new **required** setting does not block the update: it installs and the plugin shows "Falta
     configurar" until the person fills it in.
   - If the new version needs a higher `apiVersion` than the app supports, the check reports "Este
     plugin necesita una versión más nueva de Kino" and the installed version keeps working.
5. **Give it time.** GitHub serves raw files with a cache of about five minutes (measured:
   `cache-control: max-age=300`), so a change you just pushed can take that long to be visible to an
   install or an update check.
6. **Keep the `id` and the address.** An `id` that is already installed from a different address is
   refused ("Ya hay un plugin con ese id"), so renaming or moving your repository makes it a
   different plugin for the people who installed it.

Before you publish, check that:

- `node sdk/validate.mjs . --run <function> ...` passes for every capability you declare;
- every host your plugin talks to (and every stream and subtitle host) is in `hosts`, including the
  bare domain next to its `*.` form;
- there is no `throw` before the first `await` in a function that a caller wraps in `try`/`catch`;
- your file uses none of the missing globals of [section 6](#6-limits-and-engine-quirks);
- you installed it in Kino and it searches, lists episodes and plays.

### Get found

Kino lists community plugins by searching GitHub for public repositories with the topic
`kino-plugin` (forks are left out).

**Without the `kino-plugin` topic, Kino will not find your plugin.** It is the only way the app
discovers a plugin: a perfect manifest, a public repository and a thousand stars change nothing if the
topic is missing. Put it on **the repository that contains `kino-plugin.json`** (a common mistake:
adding it to another repository by the same author that only holds data, such as an `.m3u` playlist).
Check it: `curl -s https://api.github.com/repos/OWNER/REPO | tr -d ' \n' | grep -o '"topics":\[[^]]*\]'`
must print `"kino-plugin"` inside the list.

**Descriptions.** The card shows the `description` of your **manifest** (up to 300 characters; empty
leaves the card without text), so write one. The GitHub repository description (About) is not read by
the app and does not affect discovery, but set it too:
`gh repo edit OWNER/REPO --add-topic kino-plugin --description "What your plugin does"` does both.

To be listed:

1. On your repository's GitHub page, add the topic `kino-plugin` (About ▸ ⚙ ▸ Topics).
2. Keep `kino-plugin.json` at the root of the repository: Kino reads it to show your plugin's name,
   description, colour and icon, and skips a repository whose manifest is missing or invalid, needs a
   newer `apiVersion` than the person's Kino, or says `"discoverable": false`. A plugin in a subfolder
   can be installed by address but is not searched.
3. Kino reads the matches 100 at a time (one page of GitHub's search), searches at most every 12 hours
   per device (and when the person taps "Actualizar"), and shows them in their own tab of the Plugins
   screen, "De la comunidad" (beside Recomendados; also a tab of "Elige tus plugins"). The person picks
   the order, and GitHub does the sorting: "Populares" (the default) lists the most-starred first,
   "Recientes" the most recently updated first (any push to your repository counts; GitHub's search
   cannot sort by creation date). When there are more than 100, "Cargar más" at the end of the list
   reads the next 100, only when the person taps it (up to the 1000 GitHub's search returns), so a
   plugin with no stars is still found. When the typed text in "Buscar plugins" matches nothing in the list, Kino can
   also ask GitHub for it ("Buscar en GitHub": still `topic:kino-plugin`, matched against your
   repository's name and description), so a clear name and description help people find you.
   Installing one goes through the same consent sheet as any other plugin.

To stay out of the search while keeping the topic, set `"discoverable": false`;
`node sdk/validate.mjs .` then prints "No aparecerá en la búsqueda de Kino".

### Exporting and importing a plugin file

A repository can disappear. So people can keep a plugin they use, Kino exports any
installed plugin as one file: Plugins ▸ Instalados ▸ Gestionar ▸ "Exportar plugin" on a phone shares a
`<id>-<version>.kinoplugin` file. Opening that file with Kino on a phone ("Abrir con Kino", or Plugins ▸ Agregar ▸
"Importar plugin desde un archivo") shows the same consent sheet as an install from GitHub and installs it as a **local
plugin**: it has no repository, it never updates by itself, and it stays on that device (plugin sync does not carry code,
so the person shares the file again to put it on another device).

- **It is a backup of the code, not of the person's data.** The file is a ZIP holding exactly `kino-plugin.json` (byte
  for byte as installed, `signature` included), your `entry` script, your `icon` and `panel.iconFile`, and a
  `kino-export.json` that names every other entry with its sha256 and the GitHub address it was installed from
  (`originalAddress`, or `null`). Never the person's settings, passwords, sealed or open secrets, cookies, storage or
  approvals. Nuvio scrapers, Stremio addons and CloudStream plugins are generated by Kino and are not exported.
- **The signature is kept.** Your signature binds your `owner/repo[/path]`, and the file carries that address, so an
  exported signed plugin still verifies on import and shows "Firmado por" with your key's fingerprint. What Kino pins is
  your *key*: a file signed by that same key updates (or, confirmed, downgrades) the plugin whatever address it was
  installed from; a file signed by another key, an unsigned file over your signed plugin, or a signed file over an
  unsigned install of that id are refused. If your repository is gone and you republish under a new one, sign again there
  with the same key (the signature names the new `owner/repo`): a person who kept your plugin as a local file can install
  the new address over it, because the key matches, and from then on it updates from there again.
- **Sealed secrets do not travel.** They open only against the repository they were sealed for; an imported plugin that
  declares `secrets` installs, the sheet says its sealed keys will not work, and `kino.secret` answers as for an
  undeclared name.
- **Modifying and re-sharing.** Edit the files, recompute every sha256 in `kino-export.json` (Kino refuses a file whose
  content does not match it) and drop the `signature` block, which no longer verifies over changed code: the result is an
  unsigned local plugin. Kino refuses names outside that list, `..`, absolute paths, symlinks, duplicates, files past the
  installer's caps (script 1 MB, manifest 16 KB, whole file 8 MB) and an `apiVersion` this Kino does not support. The id of
  a recommended plugin is taken only by a file signed with that plugin's author key.

No `apiVersion` change: any plugin can be exported, and a Kino that predates this simply does not open the file.

## 9. What people see

- **The consent sheet.** When someone types your address, Kino shows "Instalar <name>", your version
  and author, the description, the list of hosts under "Se va a conectar con:" (left out when
  `hosts` is empty), and the warning
  "Plugin no verificado: solo instálalo si confías en quien lo hizo." with "Instalar" and "Cancelar".
  If your manifest has a `password` setting it adds "Este plugin usa tu usuario y contraseña"; a `url`
  setting adds "Se conectará a los servidores que escribas en su configuración". Declaring `download`
  adds "Puede descargar videos para verlos sin conexión", `drm` adds "Reproduce video protegido (DRM)",
  `channels` adds "Agrega canales en vivo a la pestaña En vivo", each `insecureHttp` host adds, in red, "Conexión sin cifrar con <host>", and `liveStreamHosts: "any"` adds, in red, "Puede reproducir canales desde cualquier servidor que indique su lista". Nothing of yours runs
  before they accept.
- **Host dialogs.** A `kino.fetch` to an undeclared host during `resolve`/`episodes`, and an
  undeclared host of the video the player opens or meets mid-playback, ask the person ("Rechazar" /
  "Permitir"; the focus starts on "Rechazar"). For a movie's or episode's video, subtitles or audio
  the dialog also offers "Permitir video de cualquier servidor" (see [The `Stream` rules](#what-you-return));
  once chosen, the plugin's details say "Puede reproducir video desde cualquier servidor" next to
  "Quitar permiso de video amplio".
- **External resolver apps** ([§12](#12-external-resolver-apps)). The first time a title needs one, a dialog asks
  "<plugin>" quiere usar "<app>" para resolver contenido de tipo "<protocol>". / Esta aplicación no es de Kino y actúa por su cuenta.
  ("Permitir" / "No permitir"); with several apps for the protocol, "Elige qué aplicación usar". While the app works Kino shows
  "Abriendo con "<app>"" with its live progress (its own short text, or "Buscando…") and a "Cancelar" button. If it fails, the
  person reads "No se pudo resolver este contenido (<code>): <the app's own short sentence>."; if none is installed, "Este
  contenido necesita una aplicación externa que no tienes instalada." (or, when your manifest names one, a sheet offering to
  download it from GitHub). Their decisions live in Ajustes ▸ "Fuentes externas", where each can be revoked.
- **When a stream can't play**, the player says why in Spanish, never the player's own English: for
  example "Este aparato no puede reproducir este formato de video (4K/HEVC)", "El servidor del video
  respondió con un error" or "No se pudo reproducir este video". While `resolve` runs it shows
  "Resolviendo el video de <name>…", and after 5 s "… buscando enlaces (N s)".
- **Screens (apiVersion 14).** A plugin with a [screen](#13-screens-screen-apiversion-14) gets an entry on the TV sidebar
  (the first three plugin screens directly, the others under «Más pantallas») and a chip on the phone's Inicio strip, or
  a button at the top of its settings page; the screen opens with Kino's title bar (the plugin's name and a close button).
  An update that adds a red consent line or a new host shows it first, open, under «Nuevo en esta actualización».
- **Configurar.** A plugin with `settings` has a "Configurar" button in Ajustes ▸ Plugins. Until
  every required setting has a value its status is "Falta configurar" and nothing of it runs.
- **Modo debug.** Every plugin's tab in Ajustes ▸ <name> has a "Modo debug" switch ("Muestra los errores de este
  plugin en pantalla y guarda un registro que puedes compartir con su autor."): on, a failure shows a panel on screen
  the person can screenshot, and "Ver registro" opens the Registro to copy or share. It starts off unless your manifest
  says `"debug": true`; when someone reports a problem, ask them to turn it on, repeat what failed and send you that.
- **Ver más.** A Home row with a `ref` ends in a "Ver más" card, and a search page with a `next`
  shows "Ver más resultados de <name>": both open a grid that asks you for the next page as the
  person scrolls.
- **Search, Home and the library.** Your results appear in search under your plugin's name (with your
  `color`), next to the app's own sources; your `home` rows appear on Home after the app's own; your
  titles play in Kino's player and appear in "Continuar viendo" and the library. Titles of a plugin
  that declares `download` can be saved for offline viewing ([section 3](#downloads-apiversion-2));
  a plugin's stream can also be sent to a Chromecast or a DLNA TV. Kino picks the lightest route: a
  file (mp4, webm) with no `headers` goes straight to the TV (relayed through the phone if the TV fails
  it); one with `headers`, and every HLS stream (a Chromecast needs CORS on it), is relayed through the
  phone; a request-signed one too, from Kino 0.9.50 (see
  [Signing every request](#signing-every-request-signing-apiversion-6)). DRM (`drm`), DASH, a
  progressive MPEG-TS or an unknown format is not offered. A `live` item's card
  says "EN VIVO" and plays on tap, with no info page; a channel never enters "Continuar viendo" or
  the library ([Live channels](#live-channels-apiversion-2)). A plugin found through the `kino-plugin`
  topic carries the label "De la comunidad" on its card.
- **Status of each plugin** in Ajustes > Plugins: "Activo", "Desactivado", "Falta configurar", "No
  responde — actívalo para volver a intentar" (three timeouts in a row; the person can re-enable it),
  "Actualización
  disponible — requiere tu aprobación", and "Archivos dañados, reinstálalo" (the installed file no
  longer matches what was installed).
- **Disable and uninstall.** A disabled plugin disappears from search and Home; its titles stay in
  the library and say "Activa el plugin <name> para ver esto". Uninstalling deletes the plugin's
  files, its storage and its cached Home rows immediately, but keeps the person's library titles and
  progress: opening one says "Esto venía del plugin <name>, que ya no está instalado", and installing
  the plugin again restores them. That is one more reason to keep `id` and `ref` handling stable.
  Titles already downloaded keep playing offline and can be removed from Descargas.

## 10. The reference plugin

`kino-plugin.json` and `plugin.js` in this repository are the Internet Archive plugin, with all five
capabilities. It reads about like this:

1. It declares `archive.org` **and** `*.archive.org`: a download URL on `archive.org` redirects to a
   storage node such as `dn720705.ca.archive.org`, and the wildcard does not cover the bare domain.
2. `getJson` does the `await` first and throws afterwards (the rule of section 6).
3. `search` cleans what the person typed: archive.org answers 200 with an error body when the query
   has a stray `/`, `-`, `&` or `'` or a dangling `AND`/`OR`/`NOT`, so it keeps letters, digits and
   apostrophes inside words, drops the operator words, and asks both collections (films and classic
   TV) whatever `type` says, using it only to decide which group comes first; an item that is in both
   is listed once.
4. `home` builds three rows (films, classic TV, classic animation) and wraps each row in its own
   `try`/`catch`, so one failing row does not lose the others; it reports it with `kino.log`. Each row
   carries its own id as `ref`, and `browse(ref, cursor)` pages through the same query 50 at a time
   with the page number as the cursor (`"2"`, `"3"`, …), throwing `kino.error("not_found")` for a row
   it does not know.
5. `episodes` reads the item's file list, keeps the video originals in natural order (a small
   `natural()` comparator, because `localeCompare` cannot be trusted), numbers them from `S01E02`
   in the file name or 1, 2, 3, and uses `"<item>|<file name>"` as each episode's `ref`.
6. `resolve` picks the best playable file (an mp4 derived from the original, or the mp4/webm itself),
   turns sibling `.vtt`/`.srt` files into `subtitles`, and sets `durationMs`.
7. Every URL it builds is `https` on a declared host; posters use
   `https://archive.org/services/img/<id>` and are not host-checked.

`README.md` in this repository says what it does not do (a collection is exposed as a single movie,
episodes numbered 0 are dropped), so do not copy those as intended behavior.

### The audio reference (apiVersion 8)

[`kinotvapp/kino-plugin-archive-audio`](https://github.com/kinotvapp/kino-plugin-archive-audio) (`plugins/archive-audio`
in Kino's repository) is the reference for `music` and `podcast` items, using every SDK piece that applies to audio:
search, Home, "Ver más", episodes, resolve, downloads, its own section, genre tiles, theme, the settings form with a
status line, an action and validation, labelled lazy copies and telemetry. Read in it:

1. block 4 of `plugin.js` (`tracksOf`, `finishTracks`): archive.org's originals and derivatives grouped into tracks,
   discs as seasons, titles that are file names turned into readable ones;
2. block 5 (the cache): a `kino.storage` cache that never fails its call and never holds a translated text;
3. block 9 (`episodes`, `resolve`): an answer for every audio item, and every quality as a `{ label, ref }` copy;
4. the "Lessons for your own plugin" section of its README, and its `test/` folder (a fake archive.org plus real
   answers recorded with `run.mjs --record`).

Its README also carries a ready-to-paste prompt for an AI assistant to build an audio plugin like it.

## 11. Cookbook

Three complete shapes, a TMDB catalog with no key in the plugin (Kino 0.9.53), then two short recipes for the
apiVersion 2 powers that need a line on the consent sheet, and three for live channels (apiVersion 3). The first and the third shapes are, nearly line for line, the two reference plugins
Kino's own tests run end to end against a fake server.

### An HTML site with a login and hidden links

The site has a login form, keeps the session in a cookie, lists titles as HTML with a "next" link,
and hides each video URL with AES-128-CBC. The person's user and password are settings.

```json
{
  "id": "mi-sitio", "name": "Mi sitio", "version": "1.0.0", "apiVersion": 1, "entry": "plugin.js",
  "hosts": ["sitio.example", "cdn.example.com"],
  "capabilities": ["search", "home", "browse", "resolve"],
  "settings": [
    { "key": "user", "label": "Usuario", "type": "text", "required": true },
    { "key": "password", "label": "Contraseña", "type": "password", "required": true }
  ]
}
```

```js
const BASE = "https://sitio.example";
const KEY = "0123456789abcdef";
const IV = "abcdef9876543210";

// The cookie jar keeps the session between calls (and across restarts): log in only when needed.
async function login() {
  const probe = await kino.fetch(BASE + "/session", { redirect: "manual" });
  if (probe.status === 200) return;
  const r = await kino.fetch(BASE + "/login", {
    method: "POST",
    body: { form: { user: kino.config.get("user"), password: kino.config.get("password") } },
    redirect: "manual",
  });
  if (r.status === 401) throw kino.error("auth_required", "usuario o contraseña incorrectos");
  if (r.status !== 302) throw kino.error("unavailable", "el sitio respondió " + r.status);
}

function cards(html) {
  return kino.html.select(html, "a.card").map((a) => ({
    id: a.attrs["data-id"], ref: a.attrs["data-link"], title: a.text, kind: "movie",
  }));
}

async function page(path) {
  await login();
  const r = await kino.fetch(BASE + path);
  if (r.status === 429) throw kino.error("rate_limited", "demasiadas peticiones");
  if (!r.ok) throw kino.error("unavailable", "el sitio respondió " + r.status);
  const html = r.text();
  const next = kino.html.select(html, "a.next").map((a) => a.attrs.href)[0];
  return { items: cards(html), next: next || undefined };
}

export async function search(query) {
  return (await page("/buscar?q=" + encodeURIComponent(query.q))).items;
}

export async function home() {
  const first = await page("/catalogo");
  return [{ id: "catalogo", title: "Catálogo", ref: "/catalogo", items: first.items }];
}

export async function browse(ref, cursor) {
  return page(cursor || ref);
}

export async function resolve(ref) {
  await null;
  const url = kino.crypto.decrypt("aes-128-cbc", { key: KEY, iv: IV, data: ref });
  return { url, mime: "video/mp4" };
}
```

`kino.html.select` exists only in the app, so test this one in Kino (or with `--replay` for the
parts that do not parse HTML).

### A JSON API with a token

The API wants a token it gives out for an API key. Keep the token in `kino.storage`, keyed by the
key it came from, and fetch a new one when the API says it expired.

```js
const API = "https://api.example.com/v1";
const tokenKey = () => "token:" + kino.config.get("apiKey");

async function token() {
  await null;
  const saved = kino.storage.get(tokenKey());
  if (saved) return saved;
  const r = await kino.fetch(API + "/token", { method: "POST", body: { json: { key: kino.config.get("apiKey") } } });
  if (r.status === 401) throw kino.error("auth_required", "la clave no sirve");
  if (!r.ok) throw kino.error("unavailable", "la API respondió " + r.status);
  const t = r.json().token;
  kino.storage.set(tokenKey(), t);
  return t;
}

async function api(path) {
  const r = await kino.fetch(API + path, { headers: { Authorization: "Bearer " + (await token()) } });
  if (r.status === 401) { kino.storage.remove(tokenKey()); throw kino.error("auth_required", "el token venció"); }
  if (r.status === 404) throw kino.error("not_found");
  if (r.status === 429) throw kino.error("rate_limited");
  if (r.status === 451) throw kino.error("geo_blocked");
  if (!r.ok) throw kino.error("unavailable", "la API respondió " + r.status);
  return r.json();
}

export async function search(query) {
  const p = await api("/search?q=" + encodeURIComponent(query.q) + (query.cursor ? "&page=" + query.cursor : ""));
  return {
    items: p.results.map((x) => ({ id: String(x.id), ref: String(x.id), title: x.title, kind: "movie", ids: { tmdb: x.tmdb } })),
    next: p.nextPage ? String(p.nextPage) : undefined,
  };
}

export async function resolve(ref) {
  const s = await api("/play/" + encodeURIComponent(ref));
  return { url: s.url, expiresInSeconds: 3600 };
}
```

Manifest: `"hosts": ["api.example.com"]`, `"capabilities": ["search", "browse", "resolve"]` (a
`next` in a search page needs `browse`), and one setting
`{ "key": "apiKey", "label": "Clave de la API", "type": "password", "required": true }`. Since
`browse` is declared it must be exported too; `export async function browse(ref, cursor) { throw
kino.error("not_found"); }` is enough when only search pages.

### The person's own server

A media server at home (Jellyfin, Emby, a NAS…): the person types its address, user and password.
The address becomes an allowed host for that install, `http` and a LAN address included; streams,
posters and stills may point at it. This is the published demo plugin **Tu servidor** 1.5.0
([kinotvapp/kino-plugin-own-server](https://github.com/kinotvapp/kino-plugin-own-server), with a
reference server to run it against), which uses every feature up to apiVersion 7 (Kino 0.9.51) a
server of your own can: seasons, `download`, `audioTracks`, `subtitles`, `durationMs` and `skip`,
`live` items, `kino.storage` with a TTL, `kino.rank`, `ids`, `channels` in every shape (a `ref`, an
inline `stream`, an M3U playlist with an XMLTV guide, a `resolve: true` playlist, `liveSearch` and
paging), the apiVersion 6 set (a section with tabs, Categorías tiles, `scopedSearch`, `migrate`,
`adult` entries, labelled and lazy copies, request-signed HLS, the full settings form, `telemetry`,
`userMessage`) and the apiVersion 7 capabilities `tracking` and `segments`, plus `meta` with a logo,
ratings and cast and `subtitles` with Kino 0.9.51's `file` hint. It is the reference plugin for
anything beyond the five basic capabilities; its README maps every feature to its function and to
the title of the reference server that exercises it. Its real
[`kino-plugin.json`](https://github.com/kinotvapp/kino-plugin-own-server/blob/main/kino-plugin.json):

```json
{
  "id": "own-server",
  "name": "Tu servidor",
  "version": "1.5.0",
  "apiVersion": 7,
  "entry": "plugin.js",
  "description": "Ve el contenido de tu propio servidor de video, con sus canales y subtítulos, y cuéntale qué ves. Necesita que escribas su dirección.",
  "author": "kinotvapp",
  "homepage": "https://github.com/kinotvapp/kino-plugin-own-server",
  "hosts": [],
  "capabilities": [
    "search",
    "home",
    "browse",
    "episodes",
    "resolve",
    "download",
    "channels",
    "scopedSearch",
    "migrate",
    "meta",
    "subtitles",
    "tracking",
    "segments"
  ],
  "categories": ["movies", "series", "live", "subtitles", "utilities"],
  "discoverable": true,
  "debug": false,
  "telemetry": true,
  "section": { "label": "Tu servidor" },
  "theme": { "accent": "#2BB68F", "onAccent": "#06201A", "background": "#0B1513", "surface": "#15241F", "highlight": "#E8F5F0" },
  "settings": [
    { "key": "cuenta", "label": "Tu servidor", "type": "section", "hint": "Escribe la dirección de tu servidor (Jellyfin, Emby, un NAS…) tal como la abres en el navegador de tu casa, con su puerto, y tu usuario y contraseña de ese servidor. Kino solo se conecta a esa dirección y a las otras que pongas abajo." },
    { "key": "server", "label": "Servidor", "type": "url", "required": true, "hint": "http://192.168.1.10:8096" },
    { "key": "user", "label": "Usuario", "type": "text", "required": true },
    { "key": "password", "label": "Contraseña", "type": "password", "required": true },
    { "key": "estado", "label": "Conexión", "type": "status" },
    { "key": "probar", "label": "Probar conexión", "type": "action" },
    { "key": "salir", "label": "Cerrar sesión", "type": "action", "confirm": "¿Cerrar la sesión en tu servidor? Kino vuelve a entrar con tu usuario la próxima vez." },
    { "key": "reproduccion", "label": "Reproducción", "type": "section", "hint": "Cómo pedir los videos y cada cuánto revisar lo nuevo de tu servidor." },
    { "key": "hd", "label": "Solo HD", "type": "toggle" },
    { "key": "homeTtl", "label": "Revisar lo nuevo", "type": "select", "default": "15",
      "options": [{ "value": "5", "label": "Cada 5 minutos" }, { "value": "15", "label": "Cada 15 minutos" }, { "value": "60", "label": "Cada hora" }] },
    { "key": "addresses", "label": "Otras direcciones del mismo servidor", "type": "list", "max": 5,
      "fields": [
        { "key": "url", "label": "Dirección", "type": "url", "required": true, "hint": "https://mi-servidor.example.org" },
        { "key": "label", "label": "Nombre", "type": "text", "hint": "Desde fuera de casa" }
      ] },
    { "key": "canales", "label": "Canales en vivo", "type": "section", "hint": "Algunos canales solo responden a un reproductor conocido: escribe aquí el User-Agent que piden." },
    { "key": "userAgent", "label": "User-Agent de los canales", "type": "text", "hint": "VLC/3.0.20 LibVLC/3.0.20" },
    { "key": "quitarAgente", "label": "Usar el User-Agent de Kino", "type": "action" },
    { "key": "avisos", "label": "Lo que ves", "type": "section", "hint": "Kino le cuenta a tu servidor qué ves en este aparato y cuándo lo terminas, para que marque lo visto como lo hace su propia app. Apágalo cuando quieras con el interruptor «Enviar lo que veo» de esta misma pestaña." },
    { "key": "ultimoAviso", "label": "Último aviso", "type": "status" }
  ],
  "color": "#1F8A70",
  "icon": "icon.png"
}
```

`hosts` is empty: the plugin reaches only the server the person types and the other addresses of
that server they list (allowed from apiVersion 2 with a `url` setting, see
[The person's own servers](#the-persons-own-servers)). Every channel list, guide and stream is on that
same server, so it needs no `"liveStreamHosts": "any"`. `"apiVersion": 7` makes Kino 0.9.50 and older
refuse it ("Este plugin necesita una versión más nueva de Kino"); declare the lowest number that has
what you use.

What follows is, line for line, the core of its real
[`plugin.js`](https://github.com/kinotvapp/kino-plugin-own-server/blob/main/plugin.js): the requests ([`reach`](https://github.com/kinotvapp/kino-plugin-own-server/blob/main/plugin.js#L56-L74) falls back to the other addresses,
`api` turns every status into a typed error), the listing and the playing. The rest -- copies,
signing, channels, the section, `migrate`, `meta`, `subtitles`, the settings form -- is in the same
file, one function per feature.

```js
const VERSION = "1.5.0";
const HLS = "application/vnd.apple.mpegurl";

const trimSlash = (u) => String(u).replace(/\/+$/, "");
const base = () => trimSlash(kino.config.get("server") || "");
const enc = encodeURIComponent;

// The other addresses of the SAME server (the `list` setting "addresses": its LAN address and its public
// name, say). Each `url` field is an allowed host too. Used three ways: the API falls back to them when
// the main address does not answer (`reach`), every file gets them as labelled copies (`withAddresses`),
// and the signed video as `alternateHosts` (`signedStream`).
const addresses = () =>
  (kino.config.get("addresses") || []).map((a) => ({ url: trimSlash(a.url), label: (a.label || "").trim() || new URL(a.url).host }));

// Everything cached in kino.storage belongs to one user on one server: storage survives a change
// in Configurar, so a key without them would hand the old server's answers to the new one.
const scope = () => kino.config.get("user") + "@" + base();

// The token does NOT change when only the password changes for the same user@server -- a
// still-valid token keeps working, exactly like a real session would, until the server rejects it.
const tokenKey = () => "token:" + scope();

// Who is asking, the way a Jellyfin client says it: Kino's version and language, this plugin's version, and
// a random id for this install (kino.crypto.uuid, kept in kino.storage: per device, never in a setting --
// settings travel to the person's other devices). Headers only, so the Node kit's recordings still match.
function clientHeaders() {
  let id = kino.storage.get("client-id");
  if (!id) kino.storage.set("client-id", (id = kino.crypto.uuid()));
  return {
    "X-Client": `Kino/${kino.appVersion} own-server/${VERSION} api/${kino.apiVersion}`,
    "X-Client-Id": id,
    "Accept-Language": kino.lang,
  };
}

// One request, to the main address and, when it does not answer at all (network or timeout), to the other
// addresses in order. A fallback is a degraded result even though the call works: kino.log.report tells
// Kino's error tracker (the manifest declares `"telemetry": true`), at most once an hour per area.
async function reach(path, init = {}) {
  const options = { ...init, headers: { ...clientHeaders(), ...init.headers } };
  try {
    return await kino.fetch(base() + path, options);
  } catch (e) {
    if (e.code !== "network" && e.code !== "timeout") throw e;
    const others = addresses();
    for (let i = 0; i < others.length; i++) {
      try {
        const r = await kino.fetch(others[i].url + path, options);
        kino.log.report("own_server:address", "main_unreachable", "fallback=" + (i + 1));
        return r;
      } catch (again) {
        if (again.code !== "network" && again.code !== "timeout") throw again;
      }
    }
    throw e;
  }
}

async function token() {
  await null;
  const saved = kino.storage.get(tokenKey());
  if (saved) return saved;
  const r = await reach("/auth", {
    method: "POST",
    body: { json: { user: kino.config.get("user"), password: kino.config.get("password") } },
  });
  if (r.status === 401) throw kino.error("auth_required", "usuario o contraseña incorrectos");
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  const t = r.json().token;
  kino.storage.set(tokenKey(), t);
  return t;
}

// Every request goes through here. A token invalidated server-side (expired, revoked, or a stale one
// from before a real password change) is forgotten and the request tried once more with a fresh login.
// A 429 that asks to wait at most 3 s is waited out once with kino.sleep (the wait counts inside the
// call's own time limit). Every other failure becomes one of Kino's typed errors.
async function api(path, { method = "GET", body, headers = {}, timeoutMs } = {}) {
  const send = async () => reach(path, { method, body, timeoutMs, headers: { ...headers, "X-Token": await token() } });
  let r = await send();
  if (r.status === 401) {
    kino.storage.remove(tokenKey());
    r = await send();
  }
  const wait = Number(r.headers["retry-after"]);
  if (r.status === 429 && wait > 0 && wait <= 3) {
    await kino.sleep(wait * 1000);
    r = await send();
  }
  if (r.status === 401) { kino.storage.remove(tokenKey()); throw kino.error("auth_required", "la sesión venció"); }
  if (r.status === 400 || r.status === 404) throw kino.error("not_found", "el servidor respondió " + r.status);
  if (r.status === 429) throw kino.error("rate_limited");
  // Kino words the other codes itself; this one says more, as "Mensaje de Tu servidor: …" (kino.error's userMessage).
  if (r.status === 451) throw kino.error("geo_blocked", "el servidor respondió 451", { userMessage: "Tu servidor no deja ver este título desde esta red." });
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  return r.status === 204 ? null : r.json();
}

// Artwork lives on the same typed server, so `http` and a LAN address are fine here too. Posters
// are 2:3 (the cards), backdrops 16:9 (the info page's background, and each episode's still), the
// logo a clear-logo on a transparent background (meta's `logo`).
const art = (shape, id) => base() + "/img/" + shape + "/" + enc(id) + ".png";
const poster = (id) => art("poster", id);
const backdrop = (id) => art("backdrop", id);

// `kind` comes from the server: "movie", "series" (one season of a show) or "live" (apiVersion 2).
// `ids` only when the server knows them: Kino then matches the title with TMDB and fills in its
// info page (cast, director, tagline...). `adult: true` (apiVersion 6) keeps it behind the person's 18+ code.
const item = (x) => ({
  id: x.id,
  ref: x.id,
  title: x.title,
  kind: x.kind,
  year: x.year,
  poster: poster(x.id),
  backdrop: backdrop(x.id),
  overview: x.overview,
  genres: x.genres ? x.genres.slice(0, 5) : undefined,
  rating: x.rating,
  runtimeMinutes: x.kind === "live" ? undefined : x.runtime,
  badges: x.badges,
  quality: x.quality,
  lang: x.lang,
  ids: x.tmdb || x.imdb ? { tmdb: x.tmdb, imdb: x.imdb } : undefined,
  adult: x.adult || undefined,
});

// A browse ref (a Home or section row, a Categorías tile) as the server's filter: a kind, or "genre:<id>".
function refFilter(ref) {
  if (ref === "movie" || ref === "series" || ref === "live") return "kind=" + ref;
  const genre = /^genre:([a-z0-9-]+)$/.exec(ref);
  return genre ? "genre=" + genre[1] : null;
}

// Home rows, one per kind; each row's ref is the kind, which browse() pages through. `genre` lines the
// rows up with other plugins' in Categorías and the En vivo filter (the live row leaves it to Kino's guess).
const ROWS = [
  { id: "novedades", title: "Novedades", kind: "movie", genre: "peliculas" },
  { id: "series", title: "Series", kind: "series", genre: "series" },
  { id: "en-vivo", title: "En vivo", kind: "live" },
];

// Home asks the server three times; the answer is kept with a storage TTL the person picks ("Revisar lo
// nuevo", a `select` setting), so opening Kino again right away costs no request. An expired entry reads
// as null by itself. A copy without TTL ("home-last:") is the fallback when the server is down.
export async function home() {
  const key = "home:" + scope();
  const cached = kino.storage.get(key);
  if (cached) return JSON.parse(cached);
  let rows;
  try {
    rows = [];
    for (const row of ROWS) {
      const p = await api("/items?limit=10&kind=" + row.kind);
      if (p.items.length) rows.push({ id: row.id, title: row.title, ref: row.kind, genre: row.genre, items: p.items.map(item) });
    }
  } catch (e) {
    const last = kino.storage.get("home-last:" + scope());
    if (!last || !["unavailable", "network", "timeout"].includes(e.code)) throw e;
    kino.log.report("own_server:home", "stale_rows", e.code);
    return JSON.parse(last);
  }
  const minutes = Number(kino.config.get("homeTtl")) || 15;
  kino.storage.set(key, JSON.stringify(rows), { ttlMs: minutes * 60 * 1000 });
  kino.storage.set("home-last:" + scope(), JSON.stringify(rows));
  return rows;
}

export async function browse(ref, cursor) {
  const filter = refFilter(ref);
  if (!filter) throw kino.error("not_found", "fila desconocida");
  const p = await api("/items?limit=10&" + filter + (cursor ? "&cursor=" + enc(cursor) : ""));
  return { items: p.items.map(item), next: p.next || undefined };
}

// The server matches ANY word of the query, so "Serie de prueba" also brings "Video de prueba 1".
// kino.rank turns that into a title search: ask with the title's head, drop the stray-word hits,
// best match first -- trying every form of the title Kino knows. `type` is only a hint: the kind it
// names goes first, nothing is dropped for it. The answer is a Page: its `next` gets "Ver más resultados".
// With `within` (the `scopedSearch` capability) the person is searching inside one of this plugin's
// "Ver más" pages: the server searches that row's kind or genre only; null for a ref it cannot search.
export async function search(query) {
  if (query.within !== undefined) {
    const filter = refFilter(query.within);
    if (!filter) return null;
    const p = await api("/items?limit=50&" + filter + "&q=" + enc(query.q) + (query.cursor ? "&cursor=" + enc(query.cursor) : ""));
    return { items: kino.rank.filterRelevant(p.items, query.q).map(item), next: p.next || undefined };
  }
  if (!query.q.trim()) return [];
  const titles = [query.q, query.originalTitle, ...(query.altTitles || [])].filter(Boolean);
  const p = await api("/items?limit=50&q=" + enc(kino.rank.shortQuery(query.q)) + (query.cursor ? "&cursor=" + enc(query.cursor) : ""));
  const best = kino.rank.sortBySimilarity(kino.rank.filterRelevant(p.items, titles), titles);
  const wanted = query.type === "movie" || query.type === "series" ? query.type : null;
  const ordered = wanted ? [...best.filter((x) => x.kind === wanted), ...best.filter((x) => x.kind !== wanted)] : best;
  return { items: ordered.map(item), next: p.next || undefined };
}

// Each season is its own title on this server, so the answer lists every season of the show in
// `seasons` (the one being answered marked `current`): Kino shows them as chips and calls
// episodes() again with the chosen season's ref.
export async function episodes(ref) {
  const x = await api("/items/" + enc(ref));
  if (x.kind !== "series") throw kino.error("not_found");
  return {
    series: { title: x.show.title, overview: x.show.overview, poster: poster(x.id), backdrop: backdrop(x.id), genres: x.genres, year: x.year },
    episodes: x.episodes.map((e) => ({
      season: x.season, number: e.number, ref: e.id, title: e.title, still: backdrop(e.id),
      overview: e.overview, airDate: e.airDate, runtimeMinutes: e.runtime,
    })),
    seasons: x.seasons.map((s) => ({
      id: s.id,
      ref: s.id,
      title: "Temporada " + s.number,
      number: s.number,
      current: s.id === x.id,
    })),
  };
}

// Movies and episodes are progressive mp4 files, so with `download` declared Kino can save them;
// the live channels are HLS and play as live (never downloadable). A movie with a separate audio
// file gets it as an `audioTracks` entry, merged by the player and picked in its audio menu; its
// subtitles go in `subtitles`; its length in `durationMs` and, when the server knows where THIS file's
// opening and ending are, `skip` ("Saltar intro" / "Saltar outro").
// `options.retry` (apiVersion 6) comes only after the origin refused a signed stream: see signedStream.
export async function resolve(ref, options) {
  // An entry of the list declared with `resolve: true` (liveCategories): its link needs the token.
  if (/\/channels\/[^/]+\/play$/.test(ref)) return resolveListEntry(ref);
  // A lazy copy's own ref ("<title>|<copy>", see below): Kino asks for it only when the person picks that
  // copy in the player's Servidor menu, the fallback reaches it or a download's copy choice does.
  if (ref.includes("|")) return resolveCopy(ref);
  const retry = options && options.retry;
  if (retry) kino.log("resolve: retry", retry.reason, retry.attempt, retry.status || "-");
  const x = await api("/items/" + enc(ref) + (retry ? "?fresh=1" : ""));
  if (x.kind === "live") return { url: base() + x.stream, mime: HLS, headers: agentHeaders() };
  if (x.hls) return signedStream(x);
  const path = x.stream + (kino.config.get("hd") ? "?quality=hd" : "");
  const stream = {
    url: base() + path,
    mime: "video/mp4",
    // The token is short-lived server-side (see server.mjs); resolve again once it's stale.
    expiresInSeconds: 600,
  };
  if (x.durationMs) stream.durationMs = x.durationMs;
  if (x.skip) stream.skip = x.skip;
  if (x.subtitles && x.subtitles.length) {
    stream.subtitles = x.subtitles.map((s) => ({ lang: s.lang, url: base() + s.file, format: s.format }));
  }
  if (x.audio && x.audio.length) {
    stream.audioTracks = x.audio.map((a) => ({ lang: a.lang, label: a.label, url: base() + a.stream }));
  }
  if (x.copies && x.copies.length) return withCopies(ref, stream, x.copies);
  return withAddresses(stream, path);
}
```

The apiVersion 7 exports, [`track and segments`](https://github.com/kinotvapp/kino-plugin-own-server/blob/main/plugin.js#L557-L591): the server marks what is in its library
as watched, like its own app, and knows where each title's intro and credits are.

```js
// `tracking` (apiVersion 7, approved in red: "Le contará al servidor que escribas en su configuración qué
// ves y cuándo lo terminas"): Kino calls track() for every movie or episode played on this device, from any
// source, and keeps the event in its own queue until it is delivered (offline, app closed...). The server
// marks what is in its library as watched, like its own app. The event id is the idempotency key. What the
// error codes mean to Kino: `unavailable`/`rate_limited` (and network trouble) retry later, in order;
// `auth_required`/`not_found` drop the event. Log the outcome, never the title.
export async function track(event) {
  const answer = await api("/playing", { method: "POST", body: { json: event }, headers: { "Idempotency-Key": event.id } });
  kino.log("track:", event.type, answer && answer.ignored ? "skipped" : "delivered");
  // A title the server does not have (it played from another source) is of no use to it: dropped, but not
  // counted as a delivery (only a real one clears the red "No pudo avisar…" line in Ajustes).
  return answer && answer.ignored ? { skipped: true } : { ok: true };
}

// `segments` (apiVersion 7): where a title's intro and credits are, for "Saltar intro" / "Saltar outro" on ANY
// movie or episode Kino knows by id, the way an intro-skipper plugin of a media server knows them. Asked in the
// background once the file plays; `durationMs` is that file's length, so the server answers for that cut.
// For an episode `ids` are the episode's own and may be empty: the show's ids + season + episode then.
// (This plugin's own files carry `skip` in their Stream instead, which wins over any segments answer.)
export async function segments({ kind, ids, show, season, episode, durationMs }) {
  const q = new URLSearchParams();
  let known = false;
  if (ids.imdb) { q.set("imdb", ids.imdb); known = true; }
  if (ids.tmdb) { q.set("tmdb", String(ids.tmdb)); known = true; }
  if (kind === "episode" && show) {
    if (show.ids.imdb) { q.set("showImdb", show.ids.imdb); known = true; }
    if (show.ids.tmdb) { q.set("showTmdb", String(show.ids.tmdb)); known = true; }
    q.set("season", String(season));
    q.set("episode", String(episode));
  }
  if (!known) return null;
  if (durationMs) q.set("duration", String(durationMs));
  const found = await api("/segments?" + q);
  return found.map((s) => ({ type: s.type, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) }));
}
```

Try it under Node against the bundled server (`node server.mjs`), with
`C="--config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t"` (or `sdk/config.json`, kept out of git), from your
computer's LAN address, not `127.0.0.1`: a loopback address is refused even as the person's own server.
`node sdk/run.mjs $C . home`, `… . resolve doblaje`, `… . live categories`, `… . track watched` and
`… . segments tt1254207 45000` then show what Kino would get; the repository's README lists every
command, and `node --test test/*.test.mjs` runs its tests offline.

### Sync providers: a server of your own (example: Sync Servidor)

[kinotvapp/kino-plugin-sync-server](https://github.com/kinotvapp/kino-plugin-sync-server), public (the plugin **Sync Servidor**, id `sync-server`; its source also lives here, in `docs/plugins/examples/sync-server/`) is a complete sync provider you can copy: a
single-file Node server with no dependencies (`GET /blob` / `PUT /blob` with `If-Match`, a 409 on a
version mismatch, a bearer token) and the plugin that talks to it (`"capabilities": ["syncProvider"]`
alone, `"fetchHosts": "any"`, `sync.keySecret` and `sync.provision`, a 409 thrown as `conflict`). The
person reaches the server through a Cloudflare tunnel, because a plugin only reaches public https
hosts. Its README (English and Spanish) walks a person through it end to end: starting the server,
the tunnel, installing the plugin from the server itself, Configurar, turning the provider on, sending
the settings to a second device, and what to do when the token changes. It declares `maxBlobBytes`
4194304 (4 MiB): inside `syncPull`/`syncPush`, `kino.fetch` takes a blob of that size in one request.
Its form carries a short [`help`](#configuration-aids-link-and-help-apiversion-12) (what the person
needs: the server's https address and its token) and a `link` to its guide. It is not listed in Kino:
people install it by pasting its repository address, `kinotvapp/kino-plugin-sync-server/plugin`.

### Sync providers: a Telegram bot of the person's own (example: Sync-Gram)

[kinotvapp/kino-plugin-sync-gram](https://github.com/kinotvapp/kino-plugin-sync-gram), public (the plugin **Sync-Gram**, id `sync-gram`; its source also lives here, in `docs/plugins/examples/sync-telegram/`; unofficial, not
affiliated with Telegram) syncs through a bot the person creates with @BotFather, with
`"hosts": ["api.telegram.org"]` only and no server of anyone's: the copy is a document pinned in the
person's private chat with the bot (`sendDocument`, `pinChatMessage`, `getChat` for the version and a
race check, `getFile` to read it back). It shows how to upload a binary file as multipart/form-data
through `kino.fetch` without decoding the blob (a `{ base64 }` body with your own `Content-Type`, the
framing spliced around the blob's base64), how to link the person's chat with `getUpdates` and
[`action.link`](#linking-is-this-you-actionlink-kino-0974-additive) ("Is this you, @ana?") with the
confirmed chat saved through [`setSettings`](#filling-your-own-settings-setsettings-kino-0974-additive)
so the person types nothing, a short `help` and a `link` to @BotFather, and how to keep the token out
of every error text. `sync.keySecret` is the bot token and `sync.provision` is
`["botToken", "chatId"]`. Its tests run against a local imitation of the Bot API; its README (English
and Spanish) walks a person through it.

### Sync providers: the person's own Telegram account (example: Sync-Gram Cuenta)

[kinotvapp/kino-plugin-sync-gram-account](https://github.com/kinotvapp/kino-plugin-sync-gram-account), public (the plugin **Sync-Gram Cuenta**, id `sync-gram-account`, apiVersion 13, Kino 0.9.74 or newer; its source also lives here, in `docs/plugins/examples/sync-telegram-account/`; unofficial, not
affiliated with Telegram) syncs through the person's **own Telegram account**, with no bot: the copy is one file,
`kino-sync.bin`, pinned and sent silently in their Saved Messages, through Telegram's MTProto API over
[`kino.ws`](#sockets-and-plugin-served-bytes-socket-and-bytesource-apiversion-13)
(`"capabilities": ["syncProvider", "socket", "storageLarge"]`, the five `*.web.telegram.org` hosts only). The person
brings their own `api_id` and `api_hash` from my.telegram.org. It shows the apiVersion 13 additions working together:
`sync.generateKey` (Kino makes the sync key, no "Create key" step), a two-step password that travels once to the TV as
a one-shot `"sync": false` password in `sync.provision`, the phone number as a `"sync": false` text, `settingsStatus`
`hide` by sign-in stage, and a `qr` login drawn on the TV only. The phone signs in with its number and a code and then
offers "Enviar configuración"; the TV taps "Recibir configuración" and shows a QR to scan with Telegram on the phone.
Its tests run against a local imitation of Telegram's servers; its README (English and Spanish) walks a person
through it. It is signed and not listed in Kino: people install it by pasting its repository address,
`kinotvapp/kino-plugin-sync-gram-account`.

### A TMDB catalog with no key in the plugin (Kino 0.9.53)

A plugin whose Home rows and search come from TMDB (trending, discover by genre, a title's seasons) used to ask every
person for a TMDB key in its own settings. With [`kino.tmdb`](#await-kinotmdbpath-params-tmdb-without-a-key-in-your-code-kino-0953)
Kino brings the key: its own first, behind its cache and limits, and the person's (the one in Ajustes, or the one of their
Stremio TMDB addon) only when Kino's fails. The plugin carries none and declares no TMDB host. The plugin's own setting
stays only for Kino 0.9.52 and older.

```json
{
  "id": "tmdb-catalog", "name": "Catálogo TMDB", "version": "1.0.0", "apiVersion": 1, "entry": "plugin.js",
  "hosts": ["api.themoviedb.org"],
  "capabilities": ["home", "search", "episodes", "resolve"],
  "catalogOnly": true,
  "settings": [{ "key": "tmdbKey", "type": "password", "label": "Llave de TMDB (Kino 0.9.52 o anterior)" }]
}
```

(`api.themoviedb.org` is in `hosts` only for the fallback's `kino.fetch` on older Kino; `kino.tmdb` itself needs none.
`"catalogOnly": true` sends its titles to the person's other sources on Kino 0.9.54+; `resolve` stays for older Kino, see
[Catalog-only plugins](#catalog-only-plugins-catalogonly-kino-0954).)

```js
const IMG = "https://image.tmdb.org/t/p/w500";

async function tmdb(path, params = {}) {
  if (typeof kino.tmdb === "function") return kino.tmdb(path, params);
  const key = kino.config.get("tmdbKey");                     // Kino 0.9.52 and older: the plugin's own setting
  if (!key) throw kino.error("auth_required", "falta la llave de TMDB");
  const r = await kino.fetch(`https://api.themoviedb.org/3${path}?${new URLSearchParams({ ...params, api_key: key })}`);
  if (!r.ok) throw kino.error(r.status === 404 ? "not_found" : "unavailable", "TMDB respondió " + r.status);
  return r.json();
}

const item = (m, kind) => ({
  id: `${kind}-${m.id}`, ref: JSON.stringify({ kind, id: m.id }), kind: kind === "tv" ? "series" : "movie",
  title: m.title || m.name, year: (m.release_date || m.first_air_date || "").slice(0, 4),
  poster: m.poster_path ? IMG + m.poster_path : undefined, overview: m.overview || undefined, ids: { tmdb: m.id },
});

export async function home() {
  try {
    const [movies, shows] = await Promise.all([
      tmdb("/trending/movie/week", { language: "es-MX" }),
      tmdb("/trending/tv/week", { language: "es-MX" }),
    ]);
    return [
      { id: "movies", title: "Películas en tendencia", items: movies.results.map((m) => item(m, "movie")) },
      { id: "shows", title: "Series en tendencia", items: shows.results.map((m) => item(m, "tv")) },
    ];
  } catch (e) {
    // No key at all (a Kino build without one, and no key of the person's): Home shows no rows instead of an error.
    if (e.code === "no_tmdb_key") return [];
    throw e;
  }
}

export async function search(query) {
  if (!query.q) return [];
  // Kino's key answers first, so this is rare. Uncaught, no_tmdb_key reaches the person as Kino's own sentence
  // ("Agrega tu llave de TMDB en Ajustes de todos los perfiles ▸ Llaves"): nothing to
  // word yourself.
  const r = await tmdb("/search/multi", { query: query.q, language: "es-MX", include_adult: false });
  return r.results.filter((m) => m.media_type === "movie" || m.media_type === "tv").map((m) => item(m, m.media_type));
}

export async function episodes(ref) {
  const { id } = JSON.parse(ref);
  const show = await tmdb(`/tv/${id}`, { language: "es-MX" });
  const out = [];
  for (const s of show.seasons.filter((x) => x.season_number > 0).slice(0, 10)) {
    const season = await tmdb(`/tv/${id}/season/${s.season_number}`, { language: "es-MX" });
    for (const e of season.episodes) {
      out.push({ season: e.season_number, number: e.episode_number, title: e.name, ref: JSON.stringify({ kind: "tv", id, s: e.season_number, e: e.episode_number }) });
    }
  }
  return { episodes: out };
}

export async function resolve(ref) {
  // Only Kino 0.9.53 and older call it ("catalogOnly" is ignored there): it says so in the person's words.
  throw kino.error("not_found", "catalog only", { userMessage: "Este catálogo no reproduce: busca el título en tus otros plugins." });
}
```

Try it without a key (as a Kino build with none), then with yours standing in for Kino's:

```sh
node sdk/run.mjs . home                                   # [] : no_tmdb_key is caught
KINO_TMDB_KEY=<your v3 key> node sdk/run.mjs . home       # the two rows
KINO_TMDB_FIXTURE=../kino/docs/plugins/fixtures/kino-services/tmdb.json node sdk/run.mjs . search matrix
```

### A Widevine-protected stream (apiVersion 2)

Your source serves DASH or HLS encrypted with Widevine and hands out a license from its own server.
Declare `"apiVersion": 2` and `"drm"` in `capabilities`, list the license server in `hosts`, and
return a `drm` block with the `Stream`:

```json
{
  "id": "mi-servicio", "name": "Mi servicio", "version": "1.0.0", "apiVersion": 2, "entry": "plugin.js",
  "hosts": ["api.example.com", "cdn.example.com", "license.example.com"],
  "capabilities": ["search", "resolve", "drm"]
}
```

```js
export async function resolve(ref) {
  const s = await api("/play/" + encodeURIComponent(ref)); // { mpd, licenseToken }
  return {
    url: s.mpd, // https://cdn.example.com/…/manifest.mpd
    mime: "application/dash+xml",
    drm: {
      type: "widevine",
      licenseUrl: "https://license.example.com/widevine",
      licenseHeaders: { Authorization: "Bearer " + s.licenseToken },
    },
    expiresInSeconds: 3600,
  };
}
```

What Kino does with it, and what it does not:

- `licenseUrl` must pass the same check as `url`: `https` on one of your `hosts` (or the person's own
  server as typed), never an IP or a local name; the license request itself goes through the same
  host gate as the segments, with `licenseHeaders` (filtered like `headers`, at most 20) on it and
  nothing else. `headers` are not sent to the license server, and `licenseHeaders` are not sent to
  the CDN.
- `type` must be `"widevine"`: PlayReady, FairPlay and ClearKey are not offered. Without the `drm`
  capability, or with any other DRM-shaped key (`license`, `licenseUrl`, `drmLicenseUrl`, `keySystem`,
  `widevine`) in the `Stream`, the stream is refused as it always was.
- Kino asks Widevine for security level **L3** (software) so the same player, surface and decoder
  as a clear stream are used, and plays **only if the device confirms L3**: a device that stays at
  L1 (or won't say) opens no session at all and shows the message below. A license server that
  refuses L3, or grants it only SD, gives the person SD or that same message: check your server's
  policy before you ship.
- `audioTracks` next to `drm`: the video is protected, the side audio files are played **clear** --
  no license is requested for them, so they must be plain, unencrypted files (an encrypted side
  file fails the whole playback with the message below). `subtitles` and `headers` work as always.
- When the license is refused, unreachable or expired, or the device has no Widevine (or no L3), the
  person reads "No se pudo abrir este video protegido" (after one more `resolve` if `expiresInSeconds`
  had passed, like any stream). A protected live channel reads the same at once on a device with no
  L3; its other license failures are cuts, re-resolved like any other (see Live channels). A protected title is **never downloadable** ("Este contenido no se puede
  descargar"), even with `download` declared, and is never offered for Chromecast or DLNA.
- The consent sheet adds "Reproduce video protegido (DRM)" when `drm` is declared, and an update that
  newly declares it waits for the person's approval ([section 8](#8-publishing-your-plugin)).

To test without a real service, a public Widevine test stream works: the manifest at
`https://storage.googleapis.com/wvmedia/cenc/h264/tears/tears.mpd` with the license server
`https://proxy.uat.widevine.com/proxy?provider=widevine_test` (declare `storage.googleapis.com` and
`proxy.uat.widevine.com` in `hosts`; no `licenseHeaders` needed).

### A site of yours without a certificate (apiVersion 2)

Your videos sit on a server of yours that only speaks plain `http` -- a CDN box with no certificate,
an old media server on a public name. Declare `"apiVersion": 2` and mark that one host
`insecureHttp` in `hosts`; nothing changes in your code beyond the scheme:

```json
{
  "id": "mi-cdn", "name": "Mi CDN", "version": "1.0.0", "apiVersion": 2, "entry": "plugin.js",
  "hosts": ["api.example.com", { "host": "cdn.example.com", "insecureHttp": true }],
  "capabilities": ["search", "resolve"]
}
```

```js
export async function resolve(ref) {
  const s = await api("/play/" + encodeURIComponent(ref)); // over https, api.example.com
  return {
    url: "http://cdn.example.com/videos/" + s.file,           // plain http: only because cdn.example.com is insecureHttp
    subtitles: s.subs.map((x) => ({ lang: x.lang, url: "http://cdn.example.com/subs/" + x.file })),
  };
}
```

What the flag does, and what it does not:

- Only `cdn.example.com`, exactly, accepts `http`: for `kino.fetch`, a `Stream`'s `url`, `subtitles`,
  `audioTracks` and a `drm` block's `licenseUrl`, and for every redirect hop that lands on it.
  `api.example.com` stays https-only, and so does `sub.cdn.example.com` (no wildcard, no subdomains).
  `https://cdn.example.com/…` keeps working too.
- Everything else about a declared host holds: a public DNS name (no IP, no `localhost`, nothing
  `.local`/`.lan`), and a name that resolves into the person's own network is refused at request
  time. For a server at home the person types in a `url` setting instead (see
  [The person's own server](#the-persons-own-server)): that path takes `http` without this flag.
- The consent sheet adds, in red, "Conexión sin cifrar con cdn.example.com", so the person knows
  that traffic can be read on the way; an update that newly marks an already-approved host
  `insecureHttp` waits for approval ([section 8](#8-publishing-your-plugin)). Prefer `https` whenever
  the server can: the flag is for the host that cannot.

### Live channels: three recipes (apiVersion 3)

Three ways to fill the En vivo tab, from the least code to the most control. Each is a complete
plugin (see [Channels in the En vivo tab](#channels-in-the-en-vivo-tab-apiversion-3) and
[Live channels](#live-channels-apiversion-3) for the rules).

**1. A plain M3U list the person types.** The person pastes the address of their list (and, if they
have one, of its guide) in Configurar; Kino downloads it, groups it and plays each entry itself.

```json
{
  "id": "mi-lista", "name": "Mi lista", "version": "1.0.0", "apiVersion": 3, "entry": "plugin.js",
  "hosts": [],
  "capabilities": ["home", "resolve", "channels"],
  "liveStreamHosts": "any",
  "settings": [
    { "key": "lista", "label": "Lista M3U", "type": "url", "required": true },
    { "key": "guia", "label": "Guía XMLTV", "type": "url" }
  ]
}
```

`"hosts": []` is enough: the list and the guide are on servers the person typed. Their streams are
not: an IPTV list points at dozens of servers nobody can declare ahead of time, which is what
`"liveStreamHosts": "any"` is for ([Channels from any server](#channels-from-any-server-livestreamhosts-apiversion-3)).
The person sees it on the consent sheet, in red: "Puede reproducir canales desde cualquier servidor
que indique su lista". Leave it out when every stream is on hosts you can declare.

```js
// Kino downloads the list (and the guide), groups it and plays each entry by itself.
export async function liveCategories() {
  const guia = kino.config.get("guia");
  return [{
    playlist: {
      url: kino.config.get("lista"),
      format: "m3u",
      epg: guia ? { url: guia, format: "xmltv" } : undefined,
      hideGroups: ["Compras"],
    },
  }];
}

// Every channel comes from the list: no categories of your own to page.
export async function liveChannels() {
  return { items: [] };
}

// The manifest needs search or home; a plugin with only channels has an empty home.
export async function home() {
  return [];
}

// A direct list never calls resolve: its entries play as they are.
export async function resolve() {
  await null;
  throw kino.error("not_found");
}
```

```
node sdk/run.mjs . --config lista=https://iptv-org.github.io/iptv/countries/co.m3u live categories
```

**2. A token per channel.** Your API lists the channels, and each play needs a freshly signed URL.
`liveChannels` returns `{ id, title, ref }` items; `resolve(ref)` signs the URL when the person
plays it. A channel's `expiresInSeconds` is ignored: when a live stream is cut, Kino simply calls
`resolve` again.

```json
{
  "id": "mi-tv", "name": "Mi TV", "version": "1.0.0", "apiVersion": 3, "entry": "plugin.js",
  "hosts": ["api.example.com", "cdn.example.com"],
  "capabilities": ["home", "resolve", "channels"],
  "settings": [{ "key": "token", "label": "Código de acceso", "type": "password", "required": true }]
}
```

```js
const API = "https://api.example.com";

async function api(path) {
  const r = await kino.fetch(API + path, { headers: { Authorization: "Bearer " + kino.config.get("token") } });
  if (r.status === 401) throw kino.error("auth_required", "código de acceso inválido");
  if (!r.ok) throw kino.error("unavailable", "la API respondió " + r.status);
  return r.json();
}

export async function home() {
  return [];
}

export async function liveCategories() {
  const cats = await api("/categorias"); // [{ slug, nombre }]
  return cats.map((c) => ({ id: c.slug, title: c.nombre }));
}

// One page of a category. The ref is only the channel's id: the signed URL is made on play.
export async function liveChannels({ categoryId, cursor }) {
  const page = await api("/canales?categoria=" + encodeURIComponent(categoryId) + (cursor ? "&pagina=" + encodeURIComponent(cursor) : ""));
  return {
    items: page.canales.map((c) => ({ id: c.id, title: c.nombre, categoryId, ref: c.id, logo: c.logo, number: c.numero })),
    next: page.siguiente || undefined,
  };
}

// Called on every play, and again when the stream is cut: always a fresh token.
export async function resolve(ref) {
  const s = await api("/firmar/" + encodeURIComponent(ref)); // { url: "https://cdn.example.com/…?token=…" }
  return { url: s.url, mime: "application/vnd.apple.mpegurl" };
}
```

```
node sdk/run.mjs . --config token=... live channels noticias
```

**3. Mixed.** Your own "Destacados" category with inline `stream` items (they play with no call to
your plugin, so zapping through them is instant), plus the provider's full list declared with
`resolve: true`: Kino downloads and groups it, and each of its entries plays through your
`resolve(<entry url>)`, which appends a token.

```json
{
  "id": "mi-mezcla", "name": "Mi mezcla", "version": "1.0.0", "apiVersion": 3, "entry": "plugin.js",
  "hosts": ["api.example.com", "live.example.com", "listas.example.com"],
  "capabilities": ["home", "resolve", "channels"]
}
```

```js
// Your own featured channels: inline streams, played with no call to the plugin (fast zapping).
const DESTACADOS = [
  { id: "noticias24", title: "Noticias 24", number: 1, url: "https://live.example.com/noticias24/index.m3u8" },
  { id: "deportes", title: "Deportes", number: 2, url: "https://live.example.com/deportes/index.m3u8" },
];

export async function home() {
  return [];
}

export async function liveCategories() {
  return [
    { id: "destacados", title: "Destacados" },
    // The provider's full list: Kino downloads and groups it; each entry plays through resolve().
    {
      playlist: {
        url: "https://listas.example.com/todos.m3u",
        format: "m3u",
        epg: { url: "https://listas.example.com/guia.xml.gz", format: "xmltv" },
        resolve: true,
      },
    },
  ];
}

export async function liveChannels({ categoryId }) {
  if (categoryId !== "destacados") return { items: [] };
  return {
    items: DESTACADOS.map((c) => ({ id: c.id, title: c.title, number: c.number, categoryId, stream: { url: c.url } })),
  };
}

// Only the list's entries get here (resolve: true), with the entry's URL as the ref.
export async function resolve(url) {
  const r = await kino.fetch("https://api.example.com/token");
  if (!r.ok) throw kino.error("unavailable", "no hay token");
  const { token } = r.json();
  return { url: url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) };
}
```

The list's streams must be on your `hosts` here (`live.example.com`), since this manifest does not
declare `"liveStreamHosts": "any"`; `live categories` counts the entries that are not as discarded.

```
node sdk/run.mjs . live categories
node sdk/run.mjs . live channels destacados
```

## 12. External resolver apps

Everything in this guide runs inside Kino's sandbox: a plugin reads a site, a JSON API or your own server and hands Kino a URL.
Some sources cannot be turned into a URL that way. They need a real program on the device: a download engine, a media pipeline
that converts a format the phone cannot decode, a helper that speaks a protocol the sandbox has no access to. Kino does not
contain such programs and does not know how any of them works. Instead it has a small **open protocol**: a plugin names *what* it
found, and an independently-installed Android app, an **external resolver**, turns it into something Kino can play.

This section is for three readers: the plugin author who wants to use a resolver, the developer who wants to build one, and anyone
who needs to know what to expect. The wire-level contract (the AIDL interface, the exact JSON, every limit) is
[`resolver-contract/PROTOCOL.md`](../../resolver-contract/PROTOCOL.md); this section is the guide to it.

### What it is, and what it is not

- **It is** one extra hop in the life of a `resolve()`: your plugin answers `{ external: { protocol, ref } }` instead of a `url`;
  Kino hands `protocol` and `ref` to an installed app that says it handles `protocol`; that app answers with the same kind of
  object a plugin answers with (`url`, `headers`, `subtitles`, `mime`… plus `media` and `portable`); Kino plays that.
- **It is not** a way to reach another app in general, a plugin API, or a back door around the host rules: Kino never sends the
  app anything but `protocol` and `ref`, never widens your plugin's approved hosts because of it, and the app never learns which
  plugin, title or person it is serving beyond what you put in `ref`.
- **It is not part of Kino.** Kino's own code never branches on the value of `protocol`; there is no registry of names. A protocol
  name is a string a plugin and a resolver agree on by convention (`my-protocol` in the examples). Who builds the resolver, how it
  gets its content and whether you may use it for yours is between you and its author.
- **It is not guaranteed to exist.** Nothing says an app is installed (see [What to expect](#what-to-expect)).

### Who does what

| Piece | Does | Never does |
| --- | --- | --- |
| **Your plugin** | Finds the title, produces an opaque `ref`, answers `{ external: { protocol, ref } }` (and may name the app: `resolver`, or the manifest's `externalResolver`). | See the app, its answer, or how it played. |
| **Kino** | Finds the app, asks the person once, binds it, shows live progress with *Cancelar*, validates the answer with the same rules as a plugin's, plays it (and casts it), shows the person a readable error. | Interpret `ref`, widen your hosts, retry a failure the app explained, ask an app for a download, a preload or a background refresh. |
| **The resolver app** | Does the real work, keeps its own server alive while the player reads, answers `onResult` / `onError`, may say why a later request failed. | Run in Kino's sandbox or talk to your plugin. |

### The flow, step by step

```
plugin  resolve("title-42")  ->  { external: { protocol: "my-protocol", ref: "<opaque>", resolver?: "com.example.resolver" } }
Kino    finds an app declaring "my-protocol"; first time: asks the person (Permitir / No permitir)
Kino    binds the app's service  ->  IExternalResolver.resolve("my-protocol", "<opaque>", callback)
app     onProgress(40, "Preparando…")  ...  Kino shows "Abriendo con <app>" with a bar and Cancelar
app     onResult(json)  or  onError(code, message)         (exactly one; Kino's own limit is 120 s for the whole call)
Kino    validates json like a plugin answer, unbinds right away, plays the url
player  reads the url while the app keeps serving (a foreground service)
```

1. **The answer.** `external` can be the whole `resolve()` answer (then `url` may be left out) or one entry of a Stream's
   `alternatives`, next to a concrete `{ url }` copy or a lazy `{ ref }` one (see
   [Letting another app resolve what you found](#letting-another-app-resolve-what-you-found-externalresolve-apiversion-11)).
   `protocol` is 1 to 64 characters from `a-z 0-9 . _ -`; `ref` is 1 to 2048 characters with no control characters; `resolver`
   is an Android package name. A plugin below `apiVersion` 11, or one that does not declare `externalResolve`, has `external`
   ignored and fails like an answer with no `url`. A malformed `external` is dropped, never half-read.
2. **Finding the app.** An installed app is a candidate when its manifest declares a `<service>` with the action
   `com.arkiv.player.action.RESOLVE_EXTERNAL` and a `<meta-data android:name="com.arkiv.player.meta.RESOLVER_PROTOCOLS"
   android:value="my-protocol,another">` naming `protocol`. When `resolver` (or the manifest's `externalResolver.package`) is
   set, only that app is a candidate; if it is not installed, Kino says so (or offers its download, see below).
3. **Consent.** The first time, the person is asked, naming your plugin and the app, and told the app is not Kino's. The answer is
   stored per *(plugin, protocol, app)*, applies from then on and can be revoked in Ajustes, in the "Fuentes externas" section. With more than one
   candidate and no `resolver`, the person picks ("Elige qué aplicación usar") and the pick is remembered as the same decision; Kino
   asks again only when it becomes ambiguous. A "no" is remembered too: that title then says "No autorizaste resolver este
   contenido con …". This is the only consent: your plugin's own install sheet does not change for `externalResolve`.
4. **Binding and the call.** Kino binds the service and calls `resolve(protocol, ref, callback)`. One call at a time per binding.
   The app answers with any number of `onProgress(percent, message)` and then exactly one of `onResult(json)` / `onError(code,
   message)`.
5. **Progress.** Kino shows the latest `onProgress` live: `percent` 0 to 100 as a bar (anything else means "indeterminate"),
   `message` as one short line (whitespace collapsed, control characters dropped, cut at 80 characters; blank shows Kino's own
   "Buscando…"). The person can press *Cancelar* or leave the player: Kino calls `cancel()`, unbinds and ignores anything the app
   sends afterwards.
6. **The deadline.** Past 120 s Kino calls `cancel()` and reports `timeout`.
7. **The result.** `onResult`'s JSON is validated by the same code that validates a plugin's `resolve()` answer. It differs only in
   hosts (below), in that **DRM is refused** and that a second `external` inside it is `bad_response`: one hop, never a chain.
8. **After the answer.** Kino unbinds at once. The app has to keep itself alive (a foreground service) for as long as the player
   reads from the URL. If it has to refuse a later request it says why in a response header (below).

### What a resolver app can do

Anything that ends in a URL Kino can play, for example:

- **Serve content it fetches as the player reads it.** A helper that downloads while you watch and answers with a URL on its own
  server on the device (the *loopback* case below).
- **Convert what the device cannot open.** A 10-bit video, an unusual container or an audio codec nobody decodes can be answered as
  an HLS of 8-bit H.264 and AAC, produced on demand, so the player still gets picture and sound.
- **Add tracks.** `subtitles` and `audioTracks` in the answer, or, for an HLS, renditions the manifest itself lists (`#EXT-X-MEDIA`).
- **Describe the file.** `media` says what the file holds (below), so Kino can show it and use it as a hint.
- **Offer a universal copy for TVs.** `portable` (below).
- **Explain failures** in a sentence the person reads, before the answer (`onError`) and after it (`X-Resolver-Error`).

Things it cannot do: change your plugin's approved hosts, ask the person for anything through Kino, reach other plugins, return
DRM, or be asked outside a person pressing play.

### The answer

`onResult` carries the same JSON shape as [a plugin's `resolve()` answer](#what-you-return):

| Field | Notes |
| --- | --- |
| `url` | The video. Required. See *Hosts* below. |
| `mime`, `headers`, `subtitles`, `audioTracks`, `durationMs`, `expiresInSeconds` | As for a plugin; `subtitles` and audio track URLs are checked like `url`. |
| `media` | Optional, advisory: what the file holds. See below. |
| `portable` | Optional: a universal HLS copy of the same video. See below. |
| `drm`, `external` | Refused (`bad_response`). |

**Hosts.** The `url` came from the app, not from your plugin, so your declared hosts do not apply: any public host is accepted,
over `https` or `http`, for the video, its subtitles and audio tracks and everything its manifest names while it plays; never an
address on the home network, a local name or a private IP. That allowance belongs to this one playback and is never added to your
plugin's approved hosts; Kino never asks the person to widen them for it.

**The loopback origin.** An app that has the content locally may answer with the URL of its own server on the device:
`http://127.0.0.1:<port>/…`, plain http, host exactly `127.0.0.1`, port 1024 or higher, no credentials. That one origin, taken from
this very answer, is accepted for that playback (never `localhost`, another address, IPv6, https on loopback or a low port; a
redirect from elsewhere into it is refused). Put an unguessable token in the path: any app on the device can reach loopback.

**`media`.** Optional and advisory (cleaned and bounded exactly as in [The `Stream` rules](#what-you-return): one-line text cut at
120 characters, at most 16 tracks, 4 `notes`, numbers clamped; nothing usable left means it is dropped, never an error):

```json
"media": {
  "title": "Movie.mkv", "sizeBytes": 1234567890, "container": "matroska,webm",
  "video": { "codec": "h264", "profile": "High 10", "width": 1920, "height": 1080, "fps": 23.976, "bitDepth": 10, "hdr": false },
  "audio": [ { "codec": "eac3", "channels": 6, "language": "eng", "title": "Original", "default": true } ],
  "subtitles": [ { "codec": "subrip", "language": "eng", "title": "", "text": true } ],
  "converted": true, "notes": ["no decoder for H.264 High 10 on this device"]
}
```

The tracks are the *file's*, whether or not the app converted them for the player (`converted`). Kino logs a summary (codecs and
counts, never a title or a note), carries `media` to the player and may use it as a hint when it decides how to cast. It never
trusts it for anything that could harm the person. Showing it in the player is not built yet.

**`portable`.** `{ "url": "…", "mime": "application/x-mpegURL" }`: **a universal version of the same video**, which the app can
make on demand and any TV receiver plays: HLS, H.264 8-bit up to 1080p, stereo AAC, its audio tracks and text subtitles as HLS
renditions. It must cost nothing until something reads it. It is checked like `url`; a non-HLS `mime`, or a URL that fails the
checks, drops the `portable` and keeps the rest of the answer. It is ignored next to DRM or request signing. The phone's own
player never uses it.

### Errors the person reads

| When | What the app sends | What the person sees |
| --- | --- | --- |
| Before the answer | `onError(code, message)`, `code` one of `unavailable`, `timeout`, `cancelled`, `unsupported`, `bad_response`, `other` (anything else is read as `other`) | "No se pudo resolver este contenido (`code`): `message`." The message is the app's own sentence, cleaned to one line of at most 120 characters and shown as the app's words, so keep it short and plain. |
| After the answer, when its server cannot serve a request | An HTTP 4xx/5xx with the header `X-Resolver-Error: <code>; <message>` (ASCII, at most 120 characters) | The player's error line "La aplicación que ofrece este video dijo: `message`", and Kino does not retry it. Only this origin's responses are read this way. |
| Kino's own failures | Nothing | Only the code: "No se pudo resolver este contenido (`unavailable`)" when the app cannot be bound, `timeout` past 120 s, `bad_response` for a JSON that fails the checks. Their English detail goes to the log, never the screen. |
| No app, a denial, the picked app gone | Nothing | "Este contenido necesita una aplicación externa que no tienes instalada.", "No autorizaste resolver este contenido con …", "La aplicación que elegiste ya no está instalada." |

### Casting a resolver's title (Chromecast and DLNA)

A TV can never reach `127.0.0.1`, so a title from a resolver is never handed to a TV by its own URL. Kino serves it through its
own cast proxy on the phone, which reads the resolver's origin and gives the TV a token URL on the local network. That means:

- the app's server must answer `GET` and `HEAD` with `Range`; every read through the proxy reaches it as an ordinary request (so it
  keeps an idle timer alive);
- an HLS answer is rewritten for the receiver, renditions included (`#EXT-X-MEDIA` audio and WebVTT subtitles), and a progressive
  file goes the way any plugin file does (proxy, or the phone's remux when the cast method asks for it);
- when the title's own route would need a conversion, or `media` says the video is not something a receiver takes as it is (not
  H.264, deeper than 8 bits, above 1080p, HDR, a DTS or TrueHD main audio) and the stream is not already a conversion, Kino casts
  the app's **`portable`** copy instead, when it offered one. The phone keeps playing the title itself;
- a title with DRM, request signing, a live channel or music never uses `portable`.

This is covered by Kino's tests with a fake resolver and was tried on one real Chromecast (a TV's built-in one): a direct H.264 file,
a converted HLS with audio and subtitle renditions (seeking from the phone works) and a `portable` copy of an HEVC file all play.
**DLNA** was tried on one real LG webOS TV, which lists no HLS in its formats yet plays it: Kino sends it the HLS playlist as it is, and both a converted HLS with audio and subtitle renditions and a muxed `portable` copy reached playing, with the real duration and a position that advances (pause and resume from the phone work). The "continuous MPEG-TS" route Kino uses for a TV that cannot play HLS does **not** play on that TV, so keep an HLS answer for it. Not tried: sending a plain progressive file from the first byte (one attempt stalled at the TV), seeking from the TV, other renderers, and confirming the picture on the screen. Other receivers, subtitles drawn on the TV and an app that survives the phone's screen turning off are also untried.

### What to expect

- **Maybe no app is installed.** Your plugin is not told. The person reads "Este contenido necesita una aplicación externa que no
  tienes instalada." (or, when your manifest names the app with an `apk`, is offered to download it). Say in your description that
  your plugin needs it, and give it a real fallback when you can: a `url` your own code can produce, with `external` kept to one of
  several `alternatives`.
- **Only while the person plays.** Never for a preload, a background refresh or a download: an externally-resolved title says it
  can only be played ("Este contenido lo abre una aplicación externa: solo se puede reproducir.").
- **120 seconds** for the whole call, one hop only, DRM never.
- **Every app is the person's choice, not yours.** They can say no, pick another, or revoke later.
- **You never learn which app handled it, or how.** Either the stream plays, or `resolve` fails like any other failure.
- **Offering the download.** When your manifest's `externalResolver` has an `apk` (`url` on a GitHub release asset, `sha256`, optional
  `label`) and the app is missing, Kino shows a sheet: it can download it from GitHub, checks the file has exactly that `sha256`
  (otherwise it is deleted and nothing is offered) and hands it to Android's installer, which asks the person as for any app. Kino
  does not check who signed it and has not reviewed it; the sheet says so.
- **Other ways to get the app.** The manifest's `externalResolver` may also say `"fdroid": true` (the same `package` is in F-Droid: Kino
  opens the F-Droid client for exactly that package, or its page on f-droid.org, or says what to search for) and/or
  `"downloader": { "code": "…" }` (3 to 10 digits: a code of the Downloader app that sideloads on a TV; Kino only **shows** it, with
  a button to open Downloader if it is installed, and installs nothing itself on that path). All three are independent and
  optional; Kino offers only what is declared for exactly that `package`, a phone leads with the buttons and a TV with the code. Be
  honest with your users: the official F-Droid client has no real Android TV support (it does not appear in the TV's launcher and
  some screens cannot be reached with a remote), so for a TV the Downloader code or the `apk` is the practical route. Kino has not
  verified a particular F-Droid client build against this link on a real device.
- **The app for a computer.** If your resolver also runs on a computer, the manifest's `externalResolver` may carry
  `"desktop": { "windows": { "url": "…", "sha256": "…" }, "linux": { … }, "macos": { … } }`: each a GitHub release asset (a zip, see
  `resolver-contract/PROTOCOL.md` "Desktop transport") and the `sha256` its bytes must have. Kino on a computer reads only the
  entry for its own system and never your `apk`; Kino on Android never reads `desktop`. Same rules as the `apk`: Kino downloads it
  from GitHub, checks the `sha256` (otherwise it is deleted and nothing is installed) and has not reviewed what is in it. A system
  you leave out simply has no app offered.

### Using a resolver from your plugin

1. **Manifest:** `"apiVersion": 11`, `"externalResolve"` in `capabilities` and, to name the app, `externalResolver`:

   ```json
   {
     "apiVersion": 11,
     "capabilities": ["search", "home", "resolve", "externalResolve"],
     "externalResolver": {
       "package": "com.example.resolver",
       "apk": { "url": "https://github.com/example/resolver/releases/download/v1.0.0/resolver.apk", "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "label": "My Resolver" },
       "fdroid": true,
       "downloader": { "code": "1234567" }
     }
   }
   ```

   `hosts` is still the set of sites *your* code reaches (your catalog), not what the resolver reaches. A manifest must name at
   least one, even if the plugin does no networking.
2. **`resolve(ref)`** answers the hand-off:

   ```js
   export async function resolve(ref) {
     const entry = CATALOG[ref];
     if (!entry) throw kino.error("not_found", "ya no está");
     return { external: { protocol: "my-protocol", ref: entry.reference } };   // add resolver: "com.example.resolver" to force that app
   }
   ```

3. **Several copies** (qualities, releases): as `alternatives`, each `{ label, ref }` lazy copy resolved by your own `resolve` and
   answering `external` again, or an entry `{ external, label }` directly (see
   [Labelled and lazy copies](#labelled-and-lazy-copies-apiversion-6)). The person moves to the next copy when one fails.
4. **Test offline** with the kit: `node sdk/run.mjs . resolve <ref>` applies Kino's output rules, so you see whether your `external`
   survives (it is ignored without `apiVersion` 11 and the capability) and how `media` and `portable` come out. The kit cannot run a
   resolver app: to see the whole hand-off you need the app installed on a device.

### Building a resolver

The other side is an Android app with one bound service. [`resolver-contract/PROTOCOL.md`](../../resolver-contract/PROTOCOL.md) has the
AIDL (`IExternalResolver`, `IExternalResolverCallback`), the manifest declaration, `ResolverWire`, every limit and a quick start. In
short: declare the service and the protocols it answers, implement `resolve(protocol, ref, callback)` (answer fast with progress, end
with exactly one `onResult` or `onError`), keep your server alive in a foreground service, make it answer `Range`, `HEAD` and a
readable `X-Resolver-Error`, and put an unguessable token in your URLs.

### Security model

- The protocol is **open**: nothing checks who signed the other app, and anyone may implement it. The person's per-app consent, and
  Android's own install prompt, are the trust decisions.
- Kino sends the app only `protocol` and `ref`, and only after consent.
- The app's text reaches the screen only as one cleaned, bounded line; its codes are whitelisted.
- Its URLs pass the plugin-answer checks; the only local address ever accepted is the one loopback origin of that answer, for that
  playback, for the first request (never as a redirect target).
- DRM and chains are refused; a failure is never retried once the app has explained it.

### FAQ

**Can my plugin check that a resolver is installed?** No. Kino tells the person; your plugin is not told. Ship a fallback.

**Does the resolver see my plugin's settings or secrets?** No. It receives `protocol` and `ref`, nothing else.

**Can one `ref` serve several apps?** Only by convention: `ref` is yours and the protocol name is a string you share with whoever
builds the app. Name the app in `externalResolver` when only one will do.

**Why is the `url` allowed to be `http://127.0.0.1:…`?** Because an app that serves the content from the device has to; it is accepted
for that one answer, with an unguessable path token in it, and for nothing else.

**Will it cast?** Through Kino's proxy: Chromecast and DLNA yes for an HLS answer (each tried on one real receiver, see above).

**Where do I see what `media` said?** In Kino's log, as a one-line summary. A screen for it is not built yet.

## 13. Screens (`screen`, apiVersion 14)

> **[User interface](ui.md)**: the catalogue of every component (layout, content, actions, forms, overlays, navigation),
> each with its properties, a JSON tree, the plugin code, its phone and TV behaviour and its limits, plus copy-paste
> recipes. The [gallery example](examples/screen-gallery/) draws all of them on a device.

A plugin can own a **full-screen canvas inside Kino**: a mini-app. The person presses your entry in the menu (or a button
on your settings page), and what opens is a blank screen with Kino's title bar (your plugin's name and a close button) whose
whole body your JavaScript describes: columns, rows, cards, lists, images, text fields, dropdowns, forms, tabs, tables, Home's
own poster cards and rows, pop-ups. Kino draws it with Kino's look, on the phone (touch) and on the TV (the remote and its
focus), and later on the desktop, **from the same JSON**: the contract names no Android type and no pixel unit only one
platform understands.

Three ideas carry the whole chapter:

- **You describe, Kino draws.** `screen()` returns a tree of plain objects (nodes). Kino validates it, drops what is wrong
  with a log line (never a crash), and draws the rest. You never touch a view, a colour value or a font.
- **The state lives in Kino.** Your runtime closes after a while idle, so nothing you keep in a variable survives. Kino keeps
  the screen's state, hands it to every call, and calls `screen()` again whenever an answer changes it.
- **The person always gets out.** The close button and Back are Kino's and always work, whatever your code answers or while
  it is still running.

Everything here needs `apiVersion: 14`, which arrives with the Kino version that introduces apiVersion 14 (the release is not
chosen yet; `contract.json` says `"14": "0.9.74"`). On an older Kino `kino.screen` is `undefined`; a plugin that must keep
installing there offers its screen through [`enhancements`](#screens-for-a-plugin-that-keeps-an-older-apiversion-enhancements).
The numbers below come from `contract.json` (`manifest.screen` and the blocks named in each section) and the shapes from
`kino.d.ts` (`KinoScreenNode`, `KinoScreenAnswer`...), which is the reference for every property.

### A first screen

`kino-plugin.json`:

```json
{
  "id": "hello-screen",
  "name": "Hola",
  "version": "1.0.0",
  "apiVersion": 14,
  "entry": "plugin.js",
  "hosts": ["example.org"],
  "capabilities": ["screen"],
  "screen": { "label": "Hola", "labelEn": "Hello", "icon": "star", "menuOpens": "screen" }
}
```

`plugin.js`:

```js
export async function screen({ state, lang }) {
  const children = [
    { type: "Text", text: "Hola", textEn: "Hello", style: "h1" },
    { type: "TextField", key: "name", labelText: "Tu nombre", labelTextEn: "Your name", onSubmitted: "greet" },
    { type: "ElevatedButton", labelText: "Saludar", labelTextEn: "Greet", onPressed: "greet" },
  ];
  if (state.greeting) children.push({ type: "Text", text: state.greeting, style: "h3", color: "primary" });
  return { type: "Column", padding: { compact: 16, expanded: 32 }, gap: 12, children };
}

export async function screenEvent({ name, state, lang }) {
  if (name !== "greet") return null;                 // the reserved "open" event comes first: nothing to load here
  const who = String(state.inputs.name ?? "").trim(); // every input's value, by its key
  if (!who) return { toast: lang === "es" ? "Escribe tu nombre" : "Type your name" };
  return { state: { greeting: (lang === "es" ? "Hola, " : "Hello, ") + who } }; // Kino merges it and calls screen() again
}
```

```
node sdk/validate.mjs .
node sdk/run.mjs . screen
node sdk/run.mjs --state '{"inputs":{"name":"Ana"}}' . screenEvent greet
node sdk/run.mjs --device tv . screen
```

A `screen` plugin needs no `resolve`, `search` or `home`: the capability may be its only one, and it adds **no consent line**
(it reaches nothing your `hosts` did not already). `hosts` still needs one entry when there is no `url` setting, even if the
screen never fetches (the calculator example names its docs site).

### The manifest's `screen` block

| Field | Rule |
| --- | --- |
| `label` | Required, 1 to 20 characters: the menu entry's name (`labelEn` the English one). |
| `icon` / `iconFile` | One of Kino's icon names (the 50 of the [icon table](ui.md#icon-names), `refresh` among them) or a 96×96 px PNG with a transparent background, at most 24 KB, never both. Not needed without `"menu"` in `opensFrom`. |
| `menuOpens` | What the menu entry opens: `"section"` (Kino's rows of cards, needs your `section`), `"screen"` (the canvas) or `"both"` (two entries, needs `section`). Default: `"section"` when you declare a `section` (nothing changes for an existing plugin), else `"screen"`. A target without its export is refused at install. |
| `opensFrom` | Where the screen opens from: `"menu"` (the icon: the TV sidebar, the phone's Inicio strip) and/or `"settings"` (a button at the top of your plugin's settings page). Default `["menu"]`, never empty. Without `"menu"` there is no icon and no entry: `icon`, `iconFile` and `menuOpens` are ignored. |
| `settingsButton` | `{ "label", "labelEn" }`, each 1 to 40 characters: that settings-page button's name (default Kino's «Abrir pantalla» / "Open screen"). |
| `settingsIn` | Where your settings show: `"settings"` (Kino's form in Ajustes), `"screen"` (only your screen: Kino hides its form in your tab, on your «Mis plugins» card and in a sync provider's Configurar while the screen can open, and those open your screen instead) or `"both"` (default). `"screen"` needs a way in (`menuOpens` `"screen"`/`"both"`, or `"settings"` in `opensFrom`); see [Settings inside a screen](#settings-inside-a-screen-settings-bind-and-config). |
| `replaces` | `["categories"]`: your screen takes the place of your group in Kino's Categorías; see [`go`](#where-a-screen-sends-the-person-go). Needs the `browse` capability and the `categories` export. |
| `every` | Timers that run while the screen is open, like a tree root's [`every`](#timers-every). A bad one is dropped and logged, never refused. |
| `adult` | `true`: the entry shows only while the person's 18+ code is unlocked. |

Where the entry shows: on the TV sidebar after Categorías and the sections (the first 3 plugin screens directly, the others
under «Más pantallas»), and as a chip on the phone's Inicio strip; only for an enabled plugin that needs no setup, like a
`section`. With `opensFrom: ["settings"]` the plugin has no icon at all: its settings page shows the button at the top, and
with `settingsIn: "screen"` that button is all the page shows besides Kino's own switches (the form comes back whenever the
screen cannot open: screens switched off, 18+ locked, settings to fill). Back returns to the settings page. Kino keeps a
remote switch for every plugin screen (`screensEnabled`): off, the entries hide at once and an open screen closes; the same
switch stops [rooms](#rooms-over-the-internet-room) and [jobs](#background-jobs-schedule-jobs-jobctx).

### The exports: `screen` and `screenEvent`

```js
export async function screen({ state, route, device, size, lang }) { return /* the root node */; }
export async function screenEvent({ name, arg, value, state, route, device, lang }) { return /* an answer, or null */; }
```

- **`screen` is a pure view.** Given the state, it returns the tree. Kino calls it when the screen opens, after every answer
  that carries a `state` patch, after a route change, and when the window changes size class (a rotation, a resize). Do no
  network work here: return what the state holds (a `Skeleton` while it loads).
- **`screenEvent` reacts.** Kino calls it when the person acts on a node that names an event. The first call after the
  screen opens is the **reserved event `open`**: load your data there (with `kino.fetch`, your cache), and answer a `state`
  patch. `open` is reserved: no node may use that name.
- **`state`**: Kino's copy, as JSON: your own keys, plus `inputs` (every input on screen by key, see
  [Actions, events and state](#actions-events-and-state)) and `ui` (what Kino did locally: `hidden`, `enabled`, `open`).
  At most 64 KB. It lives for this opening only: closing the screen drops it, so keep what must survive in `kino.storage`.
- **`route`**: `{ name, params, args? }`, `{ name: "main", params: {} }` at the root. An answer's
  `route: { push: "detail", params }` goes one screen deeper inside your canvas, `{ pop: true }` back; Back pops a pushed
  route before it closes the canvas. `args` come from a [`go.screen`](#where-a-screen-sends-the-person-go) that opened it.
- **`device`** `"phone"`, `"tv"` or `"desktop"`; **`size`** `{ widthClass, heightClass, orientation }` with the Material
  window classes (`compact` under 600 dp, `medium` 600 to 839, `expanded` 840 and up); **`lang`** `"es"` or `"en"`.
  You may return a different tree per device, but [per-size values](#layout-style-and-per-size-values) usually do it better.
- **One runtime per plugin.** `kino.storage`, `kino.config`, cookies and secrets are shared with your other exports, so a
  catalog (`home`, `search`...) can feed the screen and the reverse; calls are serialised with your other calls.
- **Failures.** A call that times out (20 s), or a first render Kino cannot draw, shows the screen's error state (your
  name, «Reintentar», close), never a blank screen; later, a render over budget keeps the last good frame and three failures
  in a row show the error state. A screen's timeout
  never counts toward "No responde": a broken mini-app never switches off your catalog, and the reverse.

**Mixing.** `screen` is one capability among the others, never a kind of plugin: one manifest may declare a catalog,
`channels`, `subtitles`, a `section`, the player `panel` and `screen` together. The exports have distinct names, so nothing
collides; with `menuOpens: "both"` the person gets your section and your screen as two entries.

### Nodes and widgets

Every node is `{ type, ...properties }`. These properties work on any node:

- `key`: its id, unique on the screen. **Required on inputs** (it names the value in `state.inputs`), on a `popup`, an
  `ExpansionTile` and a dismissible `MaterialBanner`; other nodes get a generated `auto-<n>` key (the `auto-` prefix is
  Kino's: do not use it). A missing or repeated input key drops the node.
- `onTap`, `onLongPress` (a button's tap is `onPressed`), `arg`: what a press does, see
  [Actions, events and state](#actions-events-and-state).
- `enabled`, `hidden`: the node's starting look; local `ui` operations and later trees change it.
- `devices` (`["tv"]`, `["phone", "desktop"]`) and `sizes` (`["expanded"]`): the node is drawn only there. An unknown name
  drops the node.
- `testKey` (1 to 64 characters): for tests and tooling, never drawn.
- Shared by a family of nodes, one meaning everywhere ([ui.md](ui.md#shared-properties)): `autofocus` (a node that takes
  focus: where focus goes when a render left it nowhere; the TV's remote lands there), `selected` (a button or a card with
  `onTap`: Kino's selected look; `ui` `set` and `toggle` with `prop: "selected"` change it) and `badge` (`"dot"` or
  `{ text, textEn?, color? }` on a button, a card with `onTap`, a `TabBar` tab and a panel's drawer tab).
- Task 17 (apiVersion stays 14): `visible: false` (hides it, as `hidden: true`) and `tooltip` (`tooltipEn`; a node that does
  something: Kino's hint on a long press, after a moment of TV focus and for a screen reader, at most 80 characters, never
  essential information) ([ui.md](ui.md#tooltip)). Style adds `alignSelf`, `textAlign`, `border`, `elevation`, `background`,
  `minWidth`/`maxWidth`/`maxHeight` ([box and text properties](ui.md#box-props)), `positioned` on a `Stack`'s child
  ([positioned](ui.md#positioned)), `opacity` and `animate` ([animations](ui.md#animate)). New nodes under Flutter's names:
  `FloatingActionButton` (one per screen, Kino draws it over the bottom), `ListTile`, `CircleAvatar`, `PageView` (with Kino's
  carousel, `viewportFraction`) and the `Scaffold` root with its `AppBar` and `NavigationBar`: its bar sits under Kino's own
  title bar, which no plugin replaces or covers ([Scaffold](ui.md#scaffold)).
- the style properties of the [next section](#layout-style-and-per-size-values).

Kino's own texts are always its own; yours take an English twin with the `En` suffix (`text`/`textEn`,
`labelText`/`labelTextEn`, `title`/`titleEn`...), picked by the person's language.

<!-- contract:screenWidgets:start -->
| Name | Older name | What it is | Its own properties | As an input |
| --- | --- | --- | --- | --- |
| `Column` | `col` | its children in a column |  |  |
| `Row` | `row` | its children in a row; `wrap: true` is the twelve-column layout | `stackOnNarrow`, `wrap` |  |
| `Stack` | `box` | its children stacked on each other |  |  |
| `Card` | `card` | Kino's card around its children | `variant`, `flush` |  |
| `Spacer`, `SizedBox` | `spacer` | empty space (`SizedBox` its `width`/`height`, `Spacer` its `flex` share) |  |  |
| `Divider` | `divider` | a thin rule |  |  |
| `SingleChildScrollView` | `scroll` | its children, scrolling | `direction` |  |
| `GridView` | `grid` | its children in `columns` | `columns` |  |
| `Text` | `text` | plain text (`text`, `textEn`) | `style`, `maxLines`, `bold`, `time`, `timeFormat` |  |
| `Image` | `image` | an https picture on a public host (`url`, `alt`, `fallback`) | `aspect` |  |
| `Icon` | `icon` | one of Kino's icons (`name`) |  |  |
| `Badge` | `badge` | a small label (`text`) |  |  |
| `LinearProgressIndicator` | `progress` | a progress bar (`value`, `labelText`) |  |  |
| `CircularProgressIndicator` | `loading` | Kino's spinner (`text`) |  |  |
| `ListView` | `list` | a lazy list of `items` (nodes), `empty` when there are none, load more | `columns`, `stickToBottom`, `onEndReached`, `loadingMore`, `done`, `newItemsHint` |  |
| `Button`, `ElevatedButton`, `TextButton`, `IconButton` | `button` | a button (`labelText`, `icon`, `onPressed`, `confirm`, `submit`) | `variant` |  |
| `TextField` | `textInput` | a text field (`kind`, `maxLength`, `value`, `onSubmitted`; a `trailingIcon` inside it with `trailingLabel` and `onTrailingTap`; `obscureText` masks it) | `trailingIcon`, `obscureText` | value in `state.inputs`; form rules: `required`, `minLength`, `maxLength`, `pattern`, `errorText`; `bind` holds a `text` setting |
| `TextField` (several lines) | `textArea` | a text field of several lines (`multiline: true` or `maxLines` above 1) |  | value in `state.inputs`; form rules: `required`, `minLength`, `maxLength`, `pattern`, `errorText`; `bind` holds a `text` setting |
| `DropdownButton` | `dropdown` | a choice among `options` |  | value in `state.inputs`; form rules: `required`, `errorText`; `bind` holds a `select` or `text` setting |
| `Switch` | `toggle` | an on/off switch |  | value in `state.inputs`; form rules: `required`, `errorText`; `bind` holds a `toggle` setting |
| `Checkbox` | `checkbox` | a check box |  | value in `state.inputs`; form rules: `required`, `errorText`; `bind` holds a `toggle` setting |
| `RadioGroup` | `radioGroup` | one choice among `options` |  | value in `state.inputs`; form rules: `required`, `errorText`; `bind` holds a `select` or `text` setting |
| `Slider` | `slider` | a number between `min` and `max` (`step`) |  | value in `state.inputs`; `bind` holds a `text` setting |
| `Chips` | `chips` | one or several (`multiple`) choices among `options` |  | value in `state.inputs`; form rules: `required`, `minLength`, `maxLength`, `errorText`; `bind` holds a `select` or `text` setting |
| `TabBar` | `tabs` | a row of tabs (`tabs`, `value`, `onChanged`); its value is NOT in `state.inputs` |  |  |
| `emptyState` | `emptyState` | Kino's empty state (`title`, `text`, `icon`) |  |  |
| `errorState` | `errorState` | Kino's error state (`title`, `text`, `icon`) |  |  |
| `titleCard` | `titleCard` | one Home poster card for an `item` | `size` |  |
| `titleRail` | `titleRail` | a Home row: `title`, `items`, `ref` for its "Ver más" | `size`, `onEndReached`, `loadingMore`, `done` |  |
| `titleGrid` | `titleGrid` | Home cards in a grid (`items`) | `columns`, `onEndReached`, `loadingMore`, `done` |  |
| `heroCard` | `heroCard` | a section's banner: `title`, `text`, `image`, at most 2 `buttons` |  |  |
| `popup`, `AlertDialog`, `BottomSheet`, `PopupMenuButton` | `popup` | a pop-up declared in the tree (`key`, `kind`), opened with a `ui` operation | `onClose`, `buttons`, `items`, `anchor` |  |
| `Form` | `form` | fields with one submit, checked by Kino before your code (`onSubmitted`) |  |  |
| `settings` | `settings` | Kino's own settings form for your plugin (`keys`, `onSaved`) | `onSaved` |  |
| `MaterialBanner` | `banner` | a line of news in a role's colour (`role`, `title`, `text`, `action`, `dismissible`) |  |  |
| `ExpansionTile` | `accordion` | sections that open and close (`key`, `items`, `multiple`) |  |  |
| `Skeleton` | `skeleton` | a placeholder while something loads | `shape`, `lines` |  |
| `QrImage` | `qr` | a QR code Kino draws on the device (`value`; `expiresInMs` or `expiresAt` with Kino's countdown, `onExpire`, `renewBeforeMs`) | `size`, `expiresInMs`, `expiresAt`, `renewBeforeMs`, `onExpire` |  |
| `NumberStepper` | `stepper` | a number drawn `[ − ] value [ + ]` (`min`, `max`, `step`, `decimals`, `editable`) |  | value in `state.inputs`; form rules: `required`, `errorText`; no `bind` |
| `DataTable` | `table` | a table of `TableRow`s holding `TableCell`s (`text` or `children`, `colSpan`, `crossAxisAlignment`) | `header`, `wrap`, `zebra`, `columns` |  |
| `FloatingActionButton` | `fab` | Kino's floating button over the screen's bottom (`icon`, `labelText`, `onPressed`), one per screen | `fabPosition` |  |
| `ListTile` | `listTile` | one row of a list: `leading`, `title`, `subtitle`, `trailing`, one press | `dense`, `leading`, `trailing`, `subtitle` |  |
| `CircleAvatar` | `avatar` | a circle with a picture, initials or an icon (`image`, `text`, `icon`, `backgroundColor`) | `borderRadius`, `backgroundColor` |  |
| `PageView` | `pageView` | pages swiped across with Kino's dots (`initialPage`, `onPageChanged`, `autoPlayMs`); `viewportFraction` < 1 is a carousel | `viewportFraction`, `padEnds`, `initialPage`, `onPageChanged`, `autoPlayMs` |  |
| `Scaffold` | `scaffold` | a screen's root with an `appBar`, a `body`, a `floatingActionButton` and a `bottomNavigationBar` (drawn in layout fill) |  |  |
| `AppBar` | `appBar` | a Scaffold's top bar: `title`, `leading`, up to four `actions`, a `bottom` TabBar |  |  |
| `NavigationBar` | `navigationBar` | a Scaffold's bottom bar of 2 to 5 `items` (`value`, `onChanged`) |  |  |
| `steps` | `steps` | a setup flow in Kino's look: `items` done, current (open, its `children`) or pending; `onStepTap` lets a done step be pressed | `items`, `onStepTap` |  |
<!-- contract:screenWidgets:end -->

An unknown `type` is dropped with a log line and the rest is drawn. **Feature-detect before you rely on a widget a newer
Kino adds**: `kino.screen.names` lists the type names this Kino draws as this guide spells them, `kino.screen.widgets` the
same by their older names, and `kino.screen.version` is the screen contract's own number (1 for now).

```js
const has = (name) => typeof kino.screen === "object" && kino.screen.names.includes(name);
const table = has("DataTable") ? { type: "DataTable", /* ... */ } : { type: "Column", /* the same rows as text */ };
```

Not here in this version (deferred by the owner): a positioned `Stack` (today's `Stack` only lays its children on each
other), `alignSelf`, text alignment of its own, borders, elevation, a background role, `minWidth`/`maxWidth`/`maxHeight`, a
floating action button, `ListTile`, `CircleAvatar`, `PageView`, animations, pull-to-refresh, segmented buttons, autocomplete,
date and time pickers, rich text, a password kind of `TextField`, and file inputs.

### Flutter-style names and the older ones

Authors who know Flutter find the same names: `Column`, `Row`, `Text`, `TextField`, `Switch`, `ListView`, `AlertDialog`,
and the properties `width`, `height`, `mainAxisAlignment`, `crossAxisAlignment`, `flex`, `borderRadius`, `onPressed`,
`onChanged`, `onSubmitted`, `hintText`, `labelText`. They are the documented spelling (this guide, `kino.d.ts`, the
examples). The older lowercase names (`col`, `row`, `textInput`, `w`, `justify`, `onTap` on a button...) stay accepted as
aliases: both spellings read to the same tree. Rules (contract.json `manifest.screen.aliases`):

- Give one spelling. When a node has both, the Flutter-style one wins and the clash is logged (a Flutter-style `null`
  counts as absent).
- A type that implies something sets it: `ElevatedButton`, `TextButton`, `IconButton` are a `Button` with `variant`
  `primary`, `text`, `icon`; `AlertDialog`, `BottomSheet`, `PopupMenuButton` are a `popup` with `kind` `dialog`, `sheet`,
  `menu`. A different value you give is replaced, logged. `secondary` has no other name: `{ type: "Button", variant: "secondary" }`.
- A `TextField` with `multiline: true` or a `maxLines` above 1 in any size class takes several lines.
- `onPressed` is a button's only; elsewhere it is ignored, logged.
- Only nodes are renamed. The fields of an answer's `dialog`, `sheet` and `menu`, a dialog's `buttons`, a menu's `items`,
  a banner's `action` and the entries of `options` and `tabs` keep `label` and `onTap`.
- Kino's own components keep their names (`titleCard`, `titleRail`, `titleGrid`, `heroCard`, `emptyState`, `errorState`,
  `popup`, `settings`).
- Flutter's `Stepper` is another widget (a wizard): that name is unknown here (dropped); the `[−] n [+]` control is
  `NumberStepper`. `OutlinedButton` and `Wrap` do not exist (a `Row` with `wrap: true` is the twelve-column layout).
- **Log lines name the older spelling** ("button dropped", "textInput needs a key"), the one Kino reads internally.

### Layout, style and per-size values

Style comes from fixed scales, never from free values; a value off its scale is dropped and logged.

<!-- contract:screenStyle:start -->
| Property | Older name | Values |
| --- | --- | --- |
| `padding` |  | 0, 4, 8, 12, 16, 24, 32, 48, or per side (`x`, `y`, `top`, `end`, `bottom`, `start`) |
| `margin` |  | 0, 4, 8, 12, 16, 24, 32, 48, or per side |
| `gap` |  | 0, 4, 8, 12, 16, 24, 32, 48 |
| `borderRadius` | `radius` | `none`, `small`, `medium`, `large`, `full`, or per corner (`topStart`, `topEnd`, `bottomStart`, `bottomEnd`; an omitted one `medium`) |
| `width` | `w` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `height` | `h` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `minHeight` | `minH` | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `fill` |  | `true`: the parent's whole width |
| `flex` | `weight` | 1 to 12: its share of a `Row` or `Column` |
| `crossAxisAlignment` | `align` | `start`, `center`, `end`, `stretch`: across the main axis (on a `Text`, the paragraph) |
| `mainAxisAlignment` | `justify` | `start`, `center`, `end`, `spaceBetween`, `spaceAround`: along the main axis |
| `color` |  | `primary`, `secondary`, `surface`, `muted`, `warning`, `error`, `onPrimary`, `primaryContainer`, `surfaceVariant` |
| `span` |  | 1 to 12 or `"auto"`, in a `Row` with `wrap: true` |
| `offset` |  | 0 to 11, in a `Row` with `wrap: true` |
| `maxWidthFraction` |  | 0.25 to 1 in steps of 0.05: at most that share of the parent's width (exactly, with `fill`) |
| `alignSelf` |  | `start`, `center`, `end`, `stretch`: this child across its `Row` or `Column` ([ui.md](ui.md#box-props)) |
| `textAlign` |  | `start`, `center`, `end`, `justify`: a text's paragraph |
| `border` |  | `{ width?, color? }` on a box: 0 to 8 dp, a colour role |
| `elevation` |  | 0 to 24 on a `Card` or a `Stack`: Kino's shadow |
| `background` |  | a colour role: a box's fill |
| `minWidth` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `maxWidth` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `maxHeight` |  | 16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640 |
| `positioned` |  | `{ top?, left?, right?, bottom?, width?, height? }` on a `Stack` child, dp or `"25%"` ([ui.md](ui.md#positioned)) |
| `opacity` |  | 0 to 1 ([ui.md](ui.md#animate)) |
| `animate` |  | `{ duration?, curve? }`: changes glide ([ui.md](ui.md#animate)) |
<!-- contract:screenStyle:end -->

**Every style or layout property of every node may be a per-size map**: `{ compact?, medium?, expanded? }`. A class missing
from the map takes the next smaller one that is present, else Kino's default. Kino resolves the maps before drawing, so a
renderer only ever sees plain values:

```js
{ type: "GridView", columns: { compact: 1, medium: 2, expanded: 3 }, gap: { compact: 8, expanded: 16 }, children }
```

Two consequences: a node whose value is invalid **in any one size class is dropped whole** (in every class), and a
per-size map that mixes classes with other keys is dropped. Use `devices`/`sizes` to draw a node only somewhere.

- `crossAxisAlignment` on a container aligns its children across its main axis (a `Row`'s height, a `Column`'s width); on
  a `Text` it is the paragraph's alignment. `stretch` in a plain `Row` draws as `start` (rows have no intrinsic measuring).
- **The canvas does not scroll by itself**: a root `Column` taller than the window is cut. Put a long page in a
  `SingleChildScrollView` (or a `ListView`, which is lazy). A `ListView` or a rail inside something that scrolls the same
  way is drawn all at once (and capped: 60 titles).
- **The twelve-column layout** (Bootstrap's grid): a `Row` with `wrap: true` lays its children on lines of 12 columns.
  Each child takes its `span` (1 to 12, or `"auto"`, the default) after its `offset`; one that does not fit what is left
  of a line starts the next; the `auto`s of a line share what the fixed spans leave, an `auto` button, `Badge` or `Icon`
  never under its own width (it starts the next line instead, its label never cut); `gap` goes between cells and between
  lines; a hidden child leaves no gap. A line is as tall as its tallest cell and, by default (or with
  `crossAxisAlignment: "stretch"`), every `Card` or container cell (`Column`, `Row`, `Stack`, `GridView`, `Form`) without
  a fixed `width`/`height` is drawn that tall, so a grid of cards is even; a button, a badge or an image with a size keeps
  its own height at the top; `start`, `center` or `end` keep every cell at its own height. A line holding something that
  cannot be measured (a lazy list, a rail, tabs, a table, the settings form) is left unstretched. In a wrapping row `flex`,
  `mainAxisAlignment` and `stackOnNarrow` mean nothing; a child takes its natural width unless `fill: true`. `span` and
  `offset` anywhere else are ignored, logged. Inside a sideways scroll the twelve columns are laid out on 600 dp.
- `Card` with `flush: true` drops its own padding and clips its children to its rounded shape, so an `Image` at its top
  runs edge to edge; pad the text children yourself.

A card grid, one card per line on a phone, two on a medium window, three on a TV:

```js
{ type: "Row", wrap: true, gap: 12, children: stories.map((s) => ({
  type: "Card", key: "story-" + s.id, flush: true, span: { compact: 12, medium: 6, expanded: 4 },
  onTap: { event: "read", arg: s.id },
  children: [
    // No picture: leave url out and the fallback is drawn (an empty url draws it too, but logs).
    { type: "Image", ...(s.image ? { url: s.image } : {}), aspect: "16:9", alt: s.title,
      fallback: { type: "Stack", color: "surface", children: [{ type: "Text", text: s.source, style: "h3" }] } },
    { type: "Column", padding: 12, gap: 4, children: [
      { type: "Text", text: s.title, style: "h4", maxLines: 3 },
      { type: "Text", text: s.source, style: "caption", color: "muted" },
    ] },
  ],
})) }
```

An `Image` takes only https URLs on a public host (no declaration needed, as every image in Kino). Its `fallback` is one
node drawn in the image's box when the picture fails or there is no `url` (with a fallback, an image whose `url` is missing
or refused is kept): only `Column`, `Row`, `Stack`, `Card`, `Spacer`, `SizedBox`, `Divider`, `Text`, `Icon`, `Badge`,
`Skeleton` and `Image`, at any depth, and nothing in it is pressed. Without one a failed picture shows Kino's mark.

### Text and colours

- A `Text`'s `style` is `h1` to `h5`, `p` (the default), `caption` or `label`; the older names `display`, `title`,
  `subtitle` and `body` read as `h1`, `h3`, `h4` and `p`, and an unknown one is `p`, logged. Kino maps them onto its own type
  scale (on the phone `h1` is headlineLarge down to `p` bodyMedium), and on the TV every step grows by 1.25, so the order
  holds at ten feet. The person's font scale is respected.
- Headings are bold already; `bold: true` makes any style bold, `bold: false` never thins a heading. `maxLines` cuts with
  an ellipsis.
- **A plugin never sets a font family, a size, italic or a free colour.** `color` takes a role (`primary`, `secondary`,
  `surface`, `muted`, `warning`, `error`, `onPrimary`, and the container roles `primaryContainer` and `surfaceVariant`,
  whose box gives its text the matching on-colour), painted with Kino's palette (your manifest's `theme` tints
  `primary` where it passes the contrast rules). A role that would not read on its surface is nudged toward the surface's
  own text colour until it does (4.5:1); `onPrimary`, which cannot read on a plain surface, falls back to the default,
  logged once per node.
- Text is plain: nothing in it is a link or markup, newlines are kept. Right-to-left follows the app.

### Actions, events and state

What a press does is an **action**: a node's `onTap`, `onLongPress`, `onPressed`, an input's `onChanged` and `onSubmitted`,
a form's `onSubmitted`. Four shapes:

```js
onTap: "refresh"                                        // an event for screenEvent; its arg is the node's arg
onTap: { event: "read", arg: "story-42" }               // an event with its arg (at most 4,096 characters)
onTap: { ui: [{ toggle: "details" }], event: "seen" }   // local operations first (no plugin call), then the event
onTap: { go: { title: { ref, kind: "movie" } } }        // somewhere in Kino, no plugin call (also { ui, go } and a bare go object)
```

**Local `ui` operations** run at once, with no round trip, on nodes of the same screen by `key`: `show`, `hide`,
`toggle`, `enable`, `disable`, `focus`, `set` (`{ set: { key, value } }`: a string up to 2,000 characters, a boolean, a
number, or up to 500 strings for `Chips`), `clear` (an input's value), and `open` / `close` (a declared pop-up). At most 8
per action; an unknown key is ignored, logged. What they do is kept in `state.ui` (`hidden` and `enabled` by key, `open` for
each `ExpansionTile`'s open items), so you see it on your next call and a re-render keeps it; you may set those keys
yourself in a `state` patch. A button's or a tappable card's `selected` is the one exception: `{ toggle: key, prop:
"selected" }` flips it and `set` with `true` or `false` sets it, kept only until your next render says it again.

**`screenEvent`** gets `name` (the event), `arg`, `value` (the value of the input that fired), `state`, `route`, `device`
and `lang`.

**`state.inputs`** holds every input on screen by key: what the person or your code set, else the value the tree shows
(filled in on every call, never stored, so a tree that changes a default is what the next call carries). Types: a
`TextField` a string, `Switch` and `Checkbox` a boolean, `Slider` a number, `DropdownButton` and `RadioGroup` the option's
value (or `null`), `Chips` a value (or a list with `multiple`), `NumberStepper` its value as text (`"2.50"`). To set what a
field shows (clear a search box, prefill a form, pick an option), answer `{ state: { inputs: { <key>: value } } }`: it
shows at once and fires no event. **A `TabBar` is not an input**: its `value` is not in `state.inputs`; keep the chosen tab
from its `onChanged` event's `value` in a state key of yours.

How events flow:

- One event at a time per screen; the next waits (at most 8 waiting) and they are spaced 100 ms apart, never dropped for
  coming fast. A newer `onChanged` of the same field replaces an older one still waiting. An answer that arrives after the
  screen closed is dropped.
- On the phone (and the desktop) a text field's `onChanged` is debounced (300 ms); on the TV it fires once, when the person
  accepts the text dialog ([On the TV](#on-the-tv-text-input-and-focus)).
- A `state` patch is merged key by key (`null` removes a key) into the state your answer was computed from; a patch that
  would take the state over 64 KB is refused and the old state kept, logged. `screen()` runs again only after an answer
  that carries `state` (or a route change).
- A call that times out shows the error state at once. A call that throws or answers something Kino cannot read counts:
  three in a row show the error state (the first one already, while there is no frame yet); a good answer resets the count.

### What an answer may carry

Every field is optional; `null` means nothing to do.

| Field | What it does |
| --- | --- |
| `state` | A patch merged into the state; then `screen()` runs again. |
| `toast` / `toastEn` | A short message at the bottom: a string, or `{ text, textEn?, role?, action?: { label, labelEn?, event, arg? }, ms? }` (`ms` 2,000 to 8,000, default 3,500). One at a time: a newer one replaces it; its action sends its event once. |
| `dialog`, `sheet`, `menu` | A pop-up built by the answer ([Pop-ups](#pop-ups-toasts-and-banners)). With more than one, the dialog wins, then the sheet. |
| `ui` | Local operations, the same as an action's (at most 8): `{ open: "story" }` opens a declared pop-up, `{ close: "story" }` closes it. |
| `go` | Somewhere in Kino ([`go`](#where-a-screen-sends-the-person-go)). |
| `route` | `{ push: "<name>", params? }` or `{ pop: true }`: a screen of your own deeper in the canvas. |
| `focus` | The `key` of the node that should take focus. |
| `close` | `true` closes the screen. |
| `config` | Your settings to write ([Settings inside a screen](#settings-inside-a-screen-settings-bind-and-config)). |

Some answers are not the person's, so they keep less: the answer to the reserved `open` drops its `go` (except
`go.screen`), so opening a screen never plays or pushes anything by itself; a [timer's](#timers-every) keeps only `state`,
`toast`, `close` and `config`; a load-more's never changes the route; a pop-up's `onClose` keeps no pop-up, `focus`, `go` or
`route`. Dropped fields are logged.

### Pop-ups, toasts and banners

One pop-up at a time; opening another replaces it; Back closes it before anything else; it never covers Kino's title bar,
and Kino always draws its close: an X alone (a screen reader says «Cerrar», «Close» in English). Two ways to show one:

- **From an answer**: `dialog` (`title`, `body` as text or nodes, at most 3 `buttons`; a button without `event` closes
  it), `sheet` (a bottom sheet on the phone, a side drawer on the TV; `body` text or nodes) or `menu` (1 to 8 `items`:
  `label`, `icon`, `onTap`; the menu closes first). An answer's pop-up never holds a `Form`, an `ExpansionTile`, `bind` or
  the `settings` node.
- **Declared in the tree**: a `popup` node (`AlertDialog`, `BottomSheet`, `PopupMenuButton`) with a `key`, hidden until a
  `ui` operation opens it. Its body is part of your tree: it can hold forms and inputs, and your next render updates it.

The robust way to open a declared pop-up with new content is **from the answer**, not from the tap: the tap sends the event,
the answer patches the state and carries `ui: [{ open: "story" }]`; Kino opens it once the new tree is drawn, so the pop-up
never shows the last story's body (Back before then cancels it). After the pop-up's own Save, close it the same way:

```js
// tap:            { type: "Card", onTap: { event: "read", arg: s.id }, ... }
// in screenEvent: case "read":  return { state: { reading: arg }, ui: [{ open: "story" }] };
//                 case "saved": return { state: { terms }, ui: [{ close: "addTerm" }], toast: "Guardado" };
{ type: "AlertDialog", key: "story", onClose: "storyClosed", children: [/* built from state.reading */],
  buttons: [{ label: "Cerrar", labelEn: "Close" }] }
```

- `onClose` (an event name, or `{ ui?, event?, arg? }`) runs after the **person** dismissed the pop-up (Back, Kino's close,
  a tap outside), never after its own buttons, a menu item, your `close` or another pop-up replacing it. Use it to clear
  `state.reading`. Its event is no press: no `kino.qr.scan`, no `go.titleByIds` or `go.url`, and its answer opens no pop-up,
  moves no focus and goes nowhere (dropped, logged); a `go`, `open` or `focus` inside `onClose` itself is dropped.
- `title` is optional: with one, Kino's X ends the title's row; without one (a blank one counts as none) no empty row is
  drawn and the X starts (left) the bottom row, your buttons together at its end (right), so the X never sits beside your
  main action; buttons that do not fit wrap to more lines, still at the end. Do not pass `" "` to hide it.
- A pop-up whose node is `hidden` cannot open. Whether a pop-up is open is not in `state.ui`.
- A menu is not anchored to what opened it: on the phone it is an action list at the bottom of the canvas, on the TV it is
  centred.
- On the TV a long body scrolls with Down and Up; keep a button at its end (the D-pad lands there after the text).

A **`MaterialBanner`** is a line of news across the screen in Kino's colour for its `role` (`info`, `warning`, `error`,
`success`), with an optional `title`, one `action` button and, when `dismissible` (it needs a `key`), Kino's close: that
hides it at once (`state.ui.hidden`) and sends the event `dismiss` with the banner's key as `arg`. A **toast** with an
`action` is reachable on the TV without stealing focus: Down from the bottom of the tree reaches it (Up or Back leaves it),
and the remote's Menu or Play/Pause key runs it; the toast says so in words.

### Lists, load more and Kino's own cards

A `ListView` is lazy: give it `items` (nodes, each with a `key` of its own, at most 500), an `empty` node for no items, and
`columns` for a grid of items. Load more with `onEndReached` on a `ListView`, `titleRail` or `titleGrid`:

```js
{ type: "ListView", items, onEndReached: { event: "more" }, loadingMore: state.loading === true, done: state.done === true }
```

Kino sends it once when the last item comes into view, and again only after you answered, the tree you asked for is drawn,
and the list grew or its `loadingMore` went from true to false (a load that finished with nothing new). Never more than once
a second per list, never while the screen is hidden (a title page or the player on top, the background: it asks once the
screen shows again), never for an empty list, never at 500 items (or 60 for a rail or grid drawn all at once). `loadingMore:
true` draws Kino's spinner after the items, `done: true` stops asking. Two consequences: a timer that turns `loadingMore`
off on every tick with nothing new makes Kino ask again once per tick, and a list a timer's render shrinks never asks again
until the person acts.

**Kino's own components** take data, never styling, in the very shape a `home` or `browse` row returns (`KinoItem`: `id`,
`ref`, `title`, `kind`, `poster`, `backdrop`, `year`, `rating`, `badges`, `progress`, `adult`), read by the same rules: a
series needs your `episodes` capability, posters and backdrops are https only (else Kino's placeholder), and 18+ items show
only while the person's 18+ code is unlocked.

- `titleCard` (one Home poster card; `size` small, medium or large), `titleRail` (a Home row with a `title` and, with a
  `ref`, its "Ver más"), `titleGrid` (cards in `columns`, default 3), `heroCard` (a section's banner: `title`, `text`, an
  https `image`, at most 2 buttons).
- A card's tap opens its title the way Home's card does, with that very item, so "Continuar viendo", the saved lists and
  the progress know it; `onTap` may replace it with an event, a `go` or `ui` operations. An item's `open: { screen }` starts
  your screen again at that route instead.
- At most 1,000 titles in a tree, and 60 in a grid or rail drawn all at once (inside a scroll, a list, a pop-up or a table
  cell).

### Forms and validation

A `Form` groups fields and gives them one submit, **checked by Kino before anything reaches your code**:

```js
{ type: "Form", key: "contact", onSubmitted: "send", children: [
  { type: "TextField", key: "email", kind: "email", labelText: "Correo", labelTextEn: "Email", required: true,
    pattern: "^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$", errorText: "Revisa el correo", errorTextEn: "Check the email" },
  { type: "TextField", key: "msg", labelText: "Mensaje", labelTextEn: "Message", multiline: true, maxLength: 500, required: true },
  { type: "ElevatedButton", labelText: "Enviar", labelTextEn: "Send", submit: true },
] }
```

- Fields: `TextField` (`required`, `minLength`, `maxLength`, `pattern`, `errorText`), `DropdownButton`, `Switch`,
  `Checkbox`, `RadioGroup`, `NumberStepper` (`required`, `errorText`), `Chips` (`required`, and `minLength`/`maxLength`
  count the chips picked). `required` means a text not blank, a choice made, a toggle on, a chip picked; an empty field
  that is not required passes every check. `errorText`/`errorTextEn` is what the person reads under a failing field, else
  Kino's own text; a `RadioGroup`'s or `Chips`' error shows on the group.
- The button with `submit: true` submits (its own `onPressed` is ignored); it is off while a required field is empty. An
  invalid form never calls your code: the errors show under each field and focus goes to the first. A valid one runs the
  form's `onSubmitted`, whose `value` is every field's value by key.
- **Enter does not submit a form**, and a field's own `onSubmitted` inside a form runs without the form's check. Rules on a
  field outside a form are not used. A form without `onSubmitted` is dropped; forms do not nest (the rule is strict:
  rewrite a nested form as two siblings); an answer's pop-up takes none.
- Values of fields that are `hidden` or disabled are still sent, unchecked; a required field in a hidden `TableRow` is not
  checked; a required field in a closed `ExpansionTile` item does not keep the button off, but the submit checks it and, if
  it fails, opens the item and focuses it. A `NumberStepper` always has a value, so its `required` always passes.
- **The pattern engine is Kino's own** (a linear-time matcher, the same in the app and the kit), never the platform's regex,
  so a hostile pattern cannot freeze the device. A pattern (at most 200 characters) must match the **whole** value, in a
  safe subset: literals, `.`, `^`, `$`, `|`, groups `( )` and `(?: )`, classes `[...]`, the escapes `\d \D \w \W \s \S \b
  \B \n \r \t` and escaped punctuation, the quantifiers `* + ? {n} {n,} {n,m}` (counts up to 1,000, optionally lazy), which
  may nest. No backreferences, no lookarounds. The meanings are ASCII: `\d` is `[0-9]`, `\w` `[A-Za-z0-9_]`, `\s` ASCII
  whitespace, `.` any character but a newline. A pattern may expand to at most 500 steps once its counts are expanded, so
  `[a-z]{1,600}` is refused: write `[a-z]+` and set `maxLength: 600`. A pattern outside the subset is dropped, logged (the
  field still checks its other rules). One submit runs at most 16 patterns and 4,000,000 matcher steps; past either, the
  remaining patterns pass. Kino's verdict is the one that counts: check again in your code only what your own logic needs.

### Settings inside a screen: `settings`, `bind` and `config`

Your screen can be your plugin's settings window, or hold it as one tab of a bigger interface. The values stay your real
settings (the same store, the same sync between the person's devices, read with `kino.config`); nothing is copied to
`kino.storage`.

- **The `settings` node** draws Kino's own settings form for your plugin, the very one Ajustes shows, on phone and TV:
  every setting type, `devices`, both languages, validation, Kino's fields for secrets and its buttons for actions (an
  `action` runs as it does there), "Enviar a otro aparato", its own save. `keys: [...]` shows only those settings, in that
  order. It sends you no event and your code never sees what is typed in it. Each setting shows at most once per screen,
  so several `settings` nodes are fine. Never inside a `Form` or an answer's pop-up.
- **`bind: "<settingKey>"`** on a field shows the stored value when the screen opens and writes the person's change back
  itself: a choice on change, a text on commit (the keyboard's action, focus leaving it, the TV dialog's accept), never per
  keystroke, only when it differs; you still get the field's events. What each field may hold is in the widget table's last
  column. A plain settings tab needs no JavaScript at all.
- **`config: { <settingKey>: value }`** in an answer writes settings from your code: only keys your manifest declares, at
  most 32 per answer, each value fitting its type (`text` a string, blank or `null` empties it unless required; `toggle` a
  boolean; `select` one of its option values; `list` an array of records of its fields).
- **Never from a screen:** a `url` setting (an address the person stores becomes a server your plugin may reach, the home
  network included, so only the person types one, in the `settings` node), a `password` (only the `settings` node holds a
  secret: drop `{ type: "settings", keys: ["password"] }` into a custom form for it), an `action` or a `help` setting, a
  value holding one of your sealed secrets, a `list` write that adds an address to a `url` field (entries may be removed,
  reordered or retitled), and a setting with [`unlockWith`](#a-setting-the-18-code-guards-unlockwith-apiversion-14) moved away
  from its default (a field never binds one; the `settings` node shows it and asks the code). All dropped, logged.
- **Pace:** each setting is written at most once every 500 ms per screen (the newest value wins, the last always lands, even
  when the screen closes mid-write); a timer's answer writes each at most once a minute. `kino.config` in the render an answer
  asked for may still read the previous value of a key written less than 500 ms before; when you need the new value at once,
  read it from your own state.
- **What a write costs:** every write restarts your runtime so `kino.config` reads the new value. A write of only toggles and
  selects keeps your plugin's web session (cookies); any other write is Kino's full Guardar, and the session is forgotten
  (a cookie login logs out).

### Where a screen sends the person: `go`

A node's action or an answer may carry `go`: one of twelve shapes, **always into this plugin's own content or one of Kino's
own pages**. No shape names an intent or an app, and only `liveChannel` names another plugin (an En vivo provider, for a
plugin whose player tab declares `"kinds": ["live"]`); anything else is dropped.

<!-- contract:screenGo:start -->
| `go` | What opens | Sent from |
| --- | --- | --- |
| `title` | this plugin's title page (`ref`, `kind`; `id`, `title` and `adult` for a title that is not on the canvas) | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `play` | plays this plugin's title (`ref`, `kind`, as `title`) | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `search` | Kino's search with `q` (at most 200 characters), only this plugin as the source | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `browse` | this plugin's "Ver más" list for a `ref` | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `section` | this plugin's section | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `categories` | Kino's Categorías with this plugin's group first (its own screen with `screen.replaces`) | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `close` | closes the screen | a tap, or the answer to an event (never the answer to `open`, to a timer or to a pop-up's `onClose`) |
| `screen` | this plugin's own screen at `route` (at most 64 characters) with `args` (at most 4,096 bytes of JSON) | a tap, or an answer, the answer to the reserved `open` included (never a timer's or a pop-up's `onClose`) |
| `titleByIds` | Kino's own title page for TMDB or IMDb ids, where the person picks any of their sources | only the person's own press or submit (a tap, a submit, the answer to one, a pop-up's button, a panel press) |
| `url` | an https link in the browser, after Kino's own confirmation sheet (a QR code on a TV) | only the person's own press or submit (a tap, a submit, the answer to one, a pop-up's button, a panel press) |
| `copy` | Kino puts the plugin's text on the clipboard and always shows its own «Copiado» toast (a TV cannot copy) | only the person's own press or submit (a tap, a submit, the answer to one, a pop-up's button, a panel press) |
| `liveChannel` | the player tunes to an En vivo provider's channel (`provider`, `code`), only for a plugin whose player tab declares `"kinds": ["live"]` | only the person's own press or submit (a tap, a submit, the answer to one, a pop-up's button, a panel press) |
<!-- contract:screenGo:end -->

- Kino's page opens over your screen; Back returns to it with its state. At most one page-opening `go` every 500 ms (a
  second one meanwhile is dropped, logged).
- **The 18+ gate holds everywhere**: a `title` or `play` of an `adult` item stays hidden while the person's 18+ code is
  locked. A `titleByIds` while it is locked opens only when TMDB says the title is not adult; adult, unknown, a failure or
  12 s passing shows Kino's locked message ("Contenido para adultos: desactiva el control parental en Ajustes").
- `title` / `play`: a title on the canvas opens with that very item (pass its `id` when two items share a `ref`). A title
  that is NOT on the canvas needs its `id` and `title` (and `adult: true` when it is 18+), or Kino cannot know which it is
  and shows its usual error. A live channel plays; a series opens its page (`kind: "episode"` alone and a `series` from a
  plugin without `episodes` show the error); a movie, a track or a podcast episode plays at once.
- `search` opens Kino's search with only your plugin as the source (the person sees its chip and may clear it); a plugin
  without `search` gets it refused. `categories` is refused, logged, for a plugin without its own Categorías tiles.
- `screen: { route?, args? }` opens **this plugin's** screen from its other surfaces: its player panel (answer or button),
  its `home`, `section` and `browse` items and rows (`open: { screen }`), the «Mis plugins» card. The screen gets `route:
  { name, params: {}, args }` (`name` is `"main"` without a route). From inside the screen it starts again at that route
  (pushed routes and an open pop-up go, the state stays) and the reserved `open` comes again with the new route, so one path
  loads what the args name whichever way the person came in; at most one restart a second. With screens off, a card or a
  row does what it did before.
- **`screen.replaces: ["categories"]`**: while your screen can open, a tile of your group in Kino's Categorías and a
  `categories` go open your screen at the route `categories` with `args: { from, category? }` (`from` is `categories`,
  `screen` or `panel`; `category` is the pressed tile's `ref`). Build it with `titleRail`, `titleGrid`, `heroCard`,
  `TabBar`, `Chips` and `go`. Kino's Categorías stays the fallback: with screens off, the screen hidden, or a FIRST opening
  that fails (Kino then shows the tile's own "Ver más" list and skips your screen for that app session). A `categories` go
  sent from the `categories` route opens Kino's own (no loop).
- **`titleByIds`** (`{ tmdb?, imdb?, kind, season?, episode?, title?, year? }`, at least one id) is how people with
  **different plugins** reach the same title: it opens Kino's own title page (the one a Home TMDB card opens), listing every
  source the person has. It names no plugin, ref or URL (any other field drops it), never plays, tells you nothing back;
  an `imdb` alone costs a TMDB lookup ("Buscando el título…", one at a time); the series opens whole (no episode focus yet).
- **`url`** (`{ href, title? }`, a "Ver noticia" button) asks Kino to open an https link in a browser. Nothing opens by
  itself: Kino shows **its own** sheet first («Abrir un enlace», «Lo pide: <your plugin>», the host with its end always
  visible, an international host as its punycode with a warning, your `title` under «Texto del plugin:», then «Cancelar»
  focused first and «Abrir», inert for its first 600 ms). On a TV, or a phone without a browser, the sheet shows the link as a
  QR code to scan with a phone. `href`: `https://` only, at most 2,048 characters of printable ASCII (percent-encode the
  rest), a public DNS name with a dot (never an IP address, `localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`, `nip.io`,
  `sslip.io` and the like), no `user:password@`, no port but 443. An answer that comes more than 5 s after the tap drops the
  link, and the same answer's own pop-ups are dropped so nothing covers Kino's sheet. Nothing comes back to you, not even
  whether the person opened it. No capability is needed.
- **From the screen opened over the player** (a panel's `go.screen`): `close` closes it; any other `go` closes it first and
  goes on; the video then does what it does when any Kino page covers it (the TV pauses, a live stream stops).

### Timers: `every`

The root of a tree (or the manifest's `screen.every`) may carry `{ ms, event }` or a list of them: Kino sends `screenEvent {
name: event }` every `ms` while the screen is open, shown and Kino in front (a pop-up does not stop it; a title page or the
player on top, or the background, pauses it). `ms` at least 1,000 (a shorter one is raised, logged), at most a day; at most
3 timers per screen (the manifest's first; an event named twice keeps the first).

- Ticks never cost the person anything: a tick runs only while none of the person's events waits or runs, a waiting tick is
  dropped when one arrives, and the next wait starts once the tick and its render are done (twice that time when it took
  longer than `ms`).
- **A tick is nobody's press.** Its answer keeps only `state`, `toast`, `close` and `config` (each setting at most once a
  minute); its pop-ups, `focus`, `go`, `route` and `ui` are dropped, logged. It cannot open the QR scanner, ask the AI, open
  or join a room.
- A tick that fails or times out counts for its timer only; 3 in a row switch that timer off for this opening (logged).
  Ticks never count toward "No responde".
- Typical uses: refresh a feed, poll a [room](#rooms-over-the-internet-room)'s `inbox`, advance a
  [work queue](#patterns) one small step.

### Accordion, skeleton, QR, number stepper and table

- **`ExpansionTile`** (`key` required): `items` (1 to 500, each `{ key, title, children, open? }`), one open at a time
  unless `multiple`. Which are open lives in `state.ui.open.<key>`, so it survives a re-render; `open` is only the first
  look. Toggling is Kino's (no call). Each item's header costs one node. When the node budget runs out right after it, the
  accordion is drawn with fewer items (possibly none).
- **`Skeleton`**: `shape` `line` (with `lines`, 1 to 6), `block`, `circle` or `card`, sized with `width`/`height`; Kino's
  muted colour, pulsing gently, still when the system's animations are off; read as "Cargando…".
- **`QrImage`**: `value` 1 to 1,000 characters, drawn as written by Kino's own generator (on the device, no network, black
  on white with its quiet zone), `size` small, medium or large. A value holding one of your plugin's secrets is never drawn
  (Kino's empty state shows, logged); Kino only recognises the secret as it is stored, not split up or re-encoded, so never
  build a QR from a secret. Never pressed, never focused; it may sit in a pop-up.
- **`NumberStepper`** (an input): `value`, `min`, `max` (min below max), `step` (default 1), `decimals` (0 to 6), drawn
  `[ − ] value [ + ]`; a button at its limit is off; holding it repeats, slowly faster. Its value in `state.inputs` is text
  (`"2.50"`). `editable: true` lets the person type it with Kino's digits-only entry, only with `decimals: 0` and a `min` of
  0 or more (else ignored, logged). Numbers at most 1e15 either way (clamped, logged). No `bind`.
- **`DataTable`**: `children` are `TableRow`s (1 to 200, each `{ key?, hidden?, children: [TableCell...] }`), a cell is a
  plain `text` (`textEn`) or `children`, with `colSpan` (1 to 8) and `crossAxisAlignment`. `columns` (at most 20, each with
  a `flex`) or as many as the widest row; `header: true` makes the first row the header; `zebra: true` stripes the rows;
  on a compact width the table scrolls sideways (at least 96 dp a column) unless `wrap: true`. Every property takes per-size
  maps (`colSpan: { compact: 1, expanded: 3 }`). A cell never holds a `ListView`, a `SingleChildScrollView` or a
  `DataTable` (nothing in a cell scrolls; tables do not nest); an `ExpansionTile` may sit in one. A row with fewer cells is
  padded; cells past the last column are dropped (logged). Each row and cell costs one node. A row's `key` lets `ui` show,
  hide or toggle it. It takes no focus: on the TV the D-pad walks what is focusable inside its cells.

### On the TV: text input and focus

**Text on the TV is a simulated input**, not a real field: a `TextField` draws as a row showing its value that, pressed,
opens Kino's TV text dialog with its on-screen keyboard (multi-line for a several-line `TextField`; the digits-only pad for
an editable `NumberStepper`). The event fires **once, when the dialog is accepted**: `onChanged` and then `onSubmitted`,
with the final value; there is no per-keystroke event. A hardware keyboard on a TV commits once on Enter or focus loss, the
same events. The phone and the desktop use normal fields (the phone's keyboard, a debounced `onChanged`). Your code cannot
tell how a value was entered and never needs to: it only reads `device`. Two differences to know: the TV sends the text
untrimmed, and a several-line `TextField` sends `onSubmitted` on the TV only (the phone's multi-line keyboard has no submit:
give it a button). The dialog's title is your plugin's name, drawn by Kino. Kino never autofills or suggests the person's
saved data in a plugin field.

**Focus is Kino's.** You name no focus order; the D-pad follows the tree, moving by what is drawn:

- The first focus goes to the first focusable node in tree order. An answer's `focus` or a `ui` `focus` moves it.
- A `TabBar` and a `Chips` row walk their items with Left and Right; at their end they go on to the next focusable beside
  them **in the same row** (tabs, then a refresh `IconButton`) and, with nothing there, stay put: never another row, never
  Kino's title bar. The twelve-column grid keeps Left and Right inside itself. Entering a `TabBar` or `Chips` row, from any
  side, lands on the picked item.
- A `Scroll`, `ListView` or grid of titles with a key of yours under the screen's first `TabBar` (a header `Row` counts)
  keeps its scroll per tab, also when you key each tab's body apart (`newsBody`, `settingsBody`).
- Moving onto a node scrolls only as much as it needs to show it whole: a node already in view scrolls nothing, so the
  first line under a header never ends up half hidden. Up (Down) with nothing more to focus that way inside a `Scroll`
  (or a player panel's body) scrolls it by most of a page until its start (end), so text above the first focusable or
  below the last is read with the D-pad alone; at the start (end) the key leaves as before.
- Stacked children (a `Column` of buttons and fields) lead Down and Up to the neighbour's nearest edge, so a narrow button
  under a full-width row is never skipped; button matrices keep their columns.
- A pop-up keeps focus inside (only the top one, when a dropdown's picker sits over it); its first focus is its first
  focusable node, else a body taller than the frame (it scrolls with Down and Up), else its first button, else its close;
  Left and Right move between Kino's X and your buttons; Back closes it and focus returns to what opened it.
- Every focused action has Kino's ring, and only it: never a pop-up's frame, a scrolling body or any other container. The
  same in any player panel, legacy or screen mode: a text, a section, a status, an image or a QR takes no focus on the TV
  (Up and Down page through it). A `NumberStepper` moves between −, the value (only when editable) and + with Left and
  Right, and its buttons at their limit stay focusable (drawn off), so holding OK never drops focus. An `ExpansionTile`
  header takes focus and OK toggles it; Down from an open header enters its content. A `QrImage` and a plain `DataTable`
  take none.
- A toast's action is reached with Down from the bottom of the tree, or run with the remote's Menu or Play/Pause key.
- A new frame that removed the focused node (an answer's new view): focus goes to the focusable now at or after its place,
  else the last one before it; with none, a `Scroll` (or a player panel's body) that scrolls takes focus itself, with no
  ring, so the D-pad still reads it. An answer's `focus` wins. Inside a player panel the TV's text is a step smaller than a
  full screen's (`h1` at `h3`'s size ... `p` 15 sp); the phone is unchanged.
- Back: the open pop-up first, then a pushed route, then the screen.

Design for the TV first: few focus stops, the important action first, short rows (a row of more than six items has not been
checked on a real TV box yet), and `onLongPress` only for extras the person can also reach another way.

### Screen limits

<!-- contract:screenLimits:start -->
| What | Limit |
| --- | --- |
| A tree | depth 10, 600 nodes (an accordion's header, a table's row and cell count as one each); in a panel in screen mode depth 6 and 200 nodes |
| Lists | 500 items in a list, rail, grid, accordion or a choice's `options`; 1000 titles in a whole tree, 60 in a rail or grid drawn all at once (inside a scroll, a list, a pop-up or a table cell) |
| Texts and keys | a text 2,000 characters; `testKey` 64; a text field's `trailingLabel` 40; a `ref` 4,096; the menu entry's `label` 20, the settings button's 40 |
| State | 64 KB as JSON (a bigger patch is refused, the old state kept) |
| Calls | `screen` and `screenEvent` 20 s each; events one at a time, at least 100 ms apart, at most 8 waiting |
| Answers | 8 `ui` operations per action or answer; 32 settings per `config`; 1 pop-up at a time; 3 buttons in a dialog; 8 items in a menu; 2 buttons in a `heroCard` |
| Layout | `flex` 1 to 12; `columns` 1 to 8; the twelve-column row: 12 columns |
| Patterns (forms) | a pattern at most 200 characters, a count at most 1,000, 500 steps once counts are expanded (and 20,000 units of work to read it); one submit runs at most 16 patterns and 4,000,000 matcher steps (past either, the rest pass) |
| Timers (`every`) | 3 per screen, every 1,000 ms to 86,400,000 ms (a day); 3 failures in a row switch one off; a tick's `config` writes a setting at most once every 60 s |
| Toasts | shown 2,000 to 8,000 ms (default 3,500) |
| `QrImage` | `value` 1 to 1,000 characters |
| `NumberStepper` | 6 decimals at most; numbers at most 1,000,000,000,000,000 either way |
| `Skeleton` | 1 to 6 lines |
| `DataTable` | 200 rows, 20 columns, `colSpan` 1 to 8 |
| `go` | `route` 64 characters, `args` 4,096 bytes; `titleByIds`: `tmdb` 1 to 2,147,483,647, `season` 0 to 999, `episode` 1 to 9999, `year` 1870 to 2100, `title` 120; `url`: `href` 2,048, `title` 60, one link a second for all plugins and 10 a minute per plugin, a QR code up to 1,000 characters; `copy`: `text` 500 characters in 6 lines, `label` 40, one copy every 500 ms and 20 a minute per plugin; at most one page-opening `go` every 500 ms |
| Search | `q` 200 characters |
<!-- contract:screenLimits:end -->

Everything else (`kino.fetch`, `kino.storage`, the memory) is the plugin's usual limits ([§6](#6-limits-and-engine-quirks)).

### The player panel built with the screen kit

The player panel (apiVersion 9: the manifest's `panel` and the `panel`, `panelAction` and `playerEvent` exports; guide:
[player panel](https://kinotvapp.github.io/kino-plugins/en/player-panel/)) can be built from the same nodes.

#### Legacy panels and screen mode

`panel(context)` may return `{ format: "screen", root, title?, titleEn?, tabs?, tab?, refreshMs?, accent?, player?, layout? }`: the
same drawer (its title, tabs, `refreshMs` and accent follow the legacy rules; a `tabs` entry may also carry the shared
`badge`, `"dot"` or `{ text, textEn?, color? }`, drawn beside its label) with a body that is a screen tree. A result
without `format` is the legacy panel, read and drawn exactly as before; the format may change from one call to the next, and
below apiVersion 14 a screen result is read as a legacy panel (logged). Differences from a screen:

- Limits: depth 6 and 200 nodes. A `popup` node is dropped (pop-ups belong to the screen, not to the drawer) unless it has an
  `anchor` (a popover beside one of the panel's nodes, drawn inside the drawer: [ui.md](ui.md#anchored-popup)), and `every` is
  dropped: `refreshMs` (2,000 to 60,000 ms, only while the panel is open) is THE periodic call.
- Calls: renders call `panel(context)`; the person's events call `panelAction({ event, context })` with
  `event = { key?, trigger, name, arg?, value?, values }` (`trigger` `press`, `change` or `submit`; `tab` and `open` stay
  reserved); there is no reserved `open` event. An apiVersion 14 plugin's `context` carries `state` (Kino's, kept for this
  title's playback) and `size` (the drawer's classes; Kino's estimate until it measured itself) **in every call, the first
  one included**, because Kino cannot know the format before your answer.
- Answers keep `state`, `toast`, `ui`, `config`, `focus`, `go` (every shape; all but `screen` and `close` close the panel
  first), `close`, and the legacy `player`, `message`, `pause` and `panel`; `dialog`, `sheet`, `menu` and `route` are not
  honoured, and `patch`, `values` and `save` are legacy-only (dropped, logged). A `playerEvent` answer's `panel` (either
  format) shows in that title's open panel, but its `state` is never applied: keep that in your own variables or storage.
- Answer a screen result only when `context.features` includes `"screen"`: Kino puts it there only while plugin screens
  are switched on; when they are off a screen result shows no panel, so answer a legacy one then.
- A failed event shows the drawer's error line at once; three in a row show the panel's error state. On the TV a toast's
  action runs from the remote's Menu or Play/Pause key (the drawer has no Down-to-toast).
- `layout` (Task 14): `"scroll"` (the default) scrolls the body and draws a list flat; `"fill"` draws the root at the body's
  size, `flex` takes the height left and a `ListView` with `flex` (and `stickToBottom`) scrolls itself, so a chat's input row
  stays at the bottom of the panel, above the keyboard. Too tall without the flex parts: drawn as `"scroll"`, logged once. A
  `screen()` answer may carry `layout` on its root object too (a full screen's root is always drawn at its size). See
  [Layout fill: a chat tab](ui.md#layout-fill-a-chat-tab).
- Kit: `node sdk/run.mjs --state '<json>' --screen <folder> panelAction <ref> <name> <press|change|submit>`.

#### A tab in another plugin's panel (`playerPanelTab`)

`"panel": { "contributes": true, "label"?, "labelEn"?, "icon"? | "iconFile"? }` with the capability `playerPanelTab` (each
needs the other; it exports `panel` and may stand alone) adds **your tab to the player panel of any plugin's title**. The
drawer becomes a tab host: Kino's own information tab first (fixed), then the playing plugin's panel (with its own tabs),
then the contributed tabs in the person's order (Ajustes, «Paneles del reproductor»), at most 6. Each tab shows its plugin's
name and icon, never Kino's info icon; a name that reads like "Kino" is shown as «Plugin «name»». Without a contribution the
drawer is exactly as before.

- **When you are called:** only while your tab is the selected one and the drawer is open (`refreshMs` only then), and
  `playerEvent` only while your tab is open. Nothing runs in the background: when the person switches tabs or closes the
  drawer, you stop (pin the panel to keep running, below).
- **What you see** (an allow-list, contract.json `manifest.panel.contributes.contextFields`): the title, year, season,
  episode, ids, position, duration, paused, the player's step, speed and resize, device, language, your tab, values,
  features, state and size; `foreign: true`; `source: { pluginId, name }` (the plugin that provides the stream); and
  `ref`, an **opaque** id: `"foreign:"` and 32 hex characters, the same for the same title on this install for your
  plugin, different for another plugin or install. It is opaque, **not secret**. Never the owner's `playing` copy or its
  `autoNext`.
- **Where not:** never on an 18+ title, any title of an 18+ plugin (an 18+ contributor only while the code is unlocked),
  your own titles (there you are the owner), M3U lists, own channels or other non-plugin content.
- **What you may do:** your `go.title` and `go.play` are dropped (you cannot open the playing plugin's content); `search`,
  `browse`, `section`, `categories`, `screen`, `titleByIds`, `url` and `close` work. Your player actions count only in the
  answer to a `panelAction` after a **press** in your tab, and only `seekToMs`; with [`playerControl`](#moving-the-video-playercontrol)
  also `pause` and `speed`, from any origin. Your episode list draws nothing.
- Kit: `node sdk/run.mjs --foreign <source plugin id>[:<name>] <folder> panel <ref>` gives your calls the foreign context.

#### Your tab on a live channel (`"kinds": ["live"]`)

Every En vivo channel has the same player panel (Right on the TV remote; the panel button in the live band on a phone), with
Kino's own **General** tab first (the favourite and the channel's brightness). Add `"kinds": ["title", "live"]` (or
`["live"]`) to your `"panel": { "contributes": true }` and your tab joins it after General (default `["title"]`: titles only,
as before). The consent is the same capability (`playerPanelTab`).

- **What you see** (contract.json `kinoLivePanel.contextFields`): `kind: "live"`, `live: true`, `channel: { provider, code,
  name }` (the plugin that lists the channel, its id there, its name), `foreign: true`, `source`, device, language, your tab,
  values (`video` is one set for every live channel: the session stays open across zaps), features, state and size. No ref, title, ids, position, duration, pause, stats or player:
  live has no seek and no pause that matters.
- **When:** as on a title, only while your tab is selected and the panel open. On a zap Kino calls `panel` again with the new
  channel (the panel stays open); there is no `playerEvent` on live.
- **Where not:** a channel its provider's own listing has not confirmed as not 18+, a channel of an 18+ provider, «Mis
  canales» (the person's own M3U lists and channels) and saved legacy channels: your tab is not there.
- **What you may do:** every `player` action is dropped (`live_channel`). [`go.liveChannel`](ui.md#go-live-channel)
  `{ provider, code }` tunes the player to a channel after the person's press (in the panel on live it changes in place):
  how a party guest watches the host's channel.
- Kit: `node sdk/run.mjs --live-channel <provider>:<code>[:<name>] <folder> panel -`.

#### The pinned panel

Kino's own, for every panel: «Fijar» / «Pin» in the panel's header (a pin icon alone on a TV) docks it next to the video
(the right third on a TV or a landscape window of 600 dp or more, below the video on an upright phone, whose video then gets
at least 300 dp or 38 % of the height for its controls; not offered in picture-in-picture, while casting, or
in a narrow landscape window). Docked, the video keeps playing and the panel's sessions, `refreshMs` and `playerEvent` keep
running while Kino is in front. The pin lasts for the playback: it survives a rotation and the next episodes played in the
player, and a new playback starts unpinned (it is not remembered, stored nor synced). The panel only opens when the person
opens it. On a TV: Right from the last control of the player's row (of either row, below) goes into the panel, on «Desfijar»
first, and with the controls hidden Right on the video does too; Left past its edge goes back to the controls; the first Back
hides the panel (it stays pinned: opened again, it docks again) and the next Back is the player's. A pop-up or dialog over the
panel takes that first Back. While the panel is docked on a TV or a phone held sideways, the player's two groups of buttons
sit one row under the other. Nothing in the plugin contract changes; a Watch Party tells its people to pin it for the
playback.

### Capabilities that go with screens

#### The consent model

A screen adds no consent line. The capabilities below add reach, so Kino asks the person **in its own words**, which you
cannot change or hide:

<!-- contract:screenConsents:start -->
| Capability | What the person reads | Red, waits for approval | The person's switch (your tab in Ajustes) |
| --- | --- | --- | --- |
| `screen` | nothing: no line of its own | no | none |
| `library` | "Podrá leer lo que has visto y guardado en Kino, y enviarlo a sus servicios" ("Can read what you have watched and saved in Kino, and send it to its services") | yes | "Dejar que lea lo que he visto y guardado" ("Let it read what I watched and saved") |
| `playerPanelTab` | "Su pestaña en el reproductor verá lo que estás viendo (título, año, identificadores y posición, o el canal en vivo) mientras la tengas abierta, y podrá enviarlo a sus servicios" ("Its tab in the player will see what you are watching (title, year, ids and position, or the live channel) while you have it open, and can send it to its services") | yes | "Mostrar en el reproductor" ("Show in the player") |
| `playerControl` | "Podrá pausar, reanudar y mover tu video por sí solo" ("Can pause, resume and move your video by itself") | yes | "Dejar que pause y mueva mi video" ("Let it pause and move my video") |
| `room` | "Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los mensajes de la sala a quienes entren" ("Can open a room that people reach over the Internet through this device, and send the room's messages to whoever joins") | yes | "Dejar que abra salas por internet" ("Let it open rooms over the Internet") |
| `schedule` | "Podrá ejecutarse en segundo plano cada cierto tiempo para actualizar sus datos, usando internet y batería" ("Can run in the background every so often to refresh its data, using your internet and battery") | yes | "Dejar que trabaje en segundo plano" ("Let it work in the background") |
| `ai` | "Podrá enviar texto a un servicio de IA de terceros (Kilo) para que lo resuma o clasifique; lo que envíe sale de tu aparato" ("Can send text to a third-party AI service (Kilo) to have it summarized or classified; what it sends leaves your device") | yes | "Dejar que use la IA de texto" ("Let it use the text AI") |
| `shared` | "Guarda unos pocos resultados que se sincronizan entre tus aparatos vinculados" ("Keeps a few small results that sync between your linked devices") | no | none |
<!-- contract:screenConsents:end -->

- A red line is asked at install and again on the update that adds it, **never approved by Kino on its own**; the kit's
  import starts it unticked. Until the person approves it the API refuses (`permission_denied`, `refused`), so always handle
  the refusal and work without it.
- Each switch is in your plugin's tab in Ajustes, covers the whole device and every profile, and syncs to the person's
  other devices; off, the API refuses at once (a room closes, a job's work is cancelled).
- Be honest in your own UI too: say what you send and where (the news example's settings say "Los titulares se envían al
  servicio de IA de terceros de Kino").
- These lines are the safeguard, not a technical wall: a plugin that can fetch can send what it reads to its hosts. The
  sheet lists your hosts beside the line for that reason.

#### Reading what the person watched (`library`)

`kino.library.watched({ limit?, kind?, sinceMs? })` and `kino.library.saved({ limit?, kind? })` answer what the **active
profile** watched and saved, newest first, one entry per title: `{ title, year?, kind, ids: { tmdb?, imdb? }, progress?,
watchedAtMs? }`. `kind` is `movie` or `series`; music and podcasts are left out.

- **Never**: a stream URL, a plugin ref, a Kino id, a position in seconds, a profile name, anything of another profile, or an
  18+ title (always left out, even with the 18+ code unlocked; a title whose source this device cannot place is left out
  too: it fails closed).
- **Coarse on purpose**: `watchedAtMs` and `sinceMs` are rounded down to the day (UTC), `progress` to steps of 0.01, so
  nothing finer can be probed. Titles watched on the same day come in Kino's own order.
- Only inside a call the person started: `screen`, `screenEvent` (timer ticks count while the screen is in front), `home`,
  `section`, `search`, and a [job](#background-jobs-schedule-jobs-jobctx) with this approval; never in prewarm or sync
  calls. A plugin with only `library` can therefore never read it. `limit` default 50, at most 100; 30 calls a minute.
- Errors: `permission_denied` (not approved, switched off), `rate_limited`, `bad_request`. Feature-detect with
  `typeof kino.library === "object"`, and still catch `permission_denied`: a plugin whose `library` came through an
  enhancement on a Kino updated after the install is asked only with its next version.
- Kino keeps nothing of an answer; a Home answer you build from it is cached like any Home answer.
- Kit: `KINO_LIBRARY_FIXTURE=<json>` stands in for the person's data, `KINO_LIBRARY_REVOKED=1` plays the switch off.

#### Moving the video (`playerControl`)

A declarative capability (no export), never on its own: only beside a panel (your own, or a contributed tab). Without it, the
plugin whose title plays keeps the rules of apiVersion 9: every `player` field after the person's press, change or submit and
in a `playerEvent` answer, but `pause` (`true` pauses, `false` resumes) only after a press; a panel result's own `player`
never counts; a contributed tab may only `seekToMs` after a press. **With it** every origin counts (press, change, submit,
`refresh`: a panel result's own `player`, the way a `refreshMs` tick keeps the video in step, and `event`: a `playerEvent`
answer), and a contributed tab may also pause and set the speed.

What Kino still enforces, the same for every plugin (contract.json `kinoPlayerControl`): one seek or pause a second per
plugin, always; an action kept only thanks to the capability is dropped while Kino is not in front (the player covered or in
the background), while one of Kino's dialogs is up or the person is seeking; on a live stream only pause; at most 30 a minute;
a pause is dropped while the phone's player is held for a cast, and when the video is already in that state (no notice, no
budget). When such an action does not come from the person's press, Kino shows a short notice naming your plugin ("Party Chat:
pausado", "Party Chat: reanudado, movido a 1:02:03"), which you cannot word or suppress. A contributed tab's speed is never
stored (it ends with the title; the person's own speed wins). Kit: `KINO_PLAYER_CONTROL_REVOKED=1`.

#### Rooms over the Internet (`room`)

A declarative capability, never on its own (a screen or a player-panel tab drives it). `kino.room` is a short-lived mailbox
**hosted on the person's own device** and reached from the Internet through the same Cloudflare quick tunnel Kino opens for
"Recibir configuración": no server of yours or Kino's, and your code never sees an address.

```js
const { code, words, expiresAtMs } = await kino.room.open({ ttlMin: 120, max: 6, name: "Ana" }); // the host, from a press
const { handle, memberId } = await kino.room.join({ words, code, name: "Beto" });                // a guest, from a press
await kino.room.send({ t: "chat", text: "hola" });                                               // a JSON object
const { events, last, more, reachable } = await kino.room.inbox({ since: state.last });          // poll it from a timer
```

- `open` gives `words` (public) and a 12-digit `code` (or `codeDigits`, 4 to 12, if you ask for a shorter one; the room's
  only secret: show it grouped, «1234 5678 9012», and as a
  QR); `join` takes both. `send(payload, { to?, session? })`: a JSON object of at most 8,192 bytes and 4 levels; the host
  writes to one member or everyone, a guest to the host or to `"all"` through the host. `inbox({ since, limit?, session? })`
  answers events (`msg`, `join`, `leave`, `closed`) after `since`; pass the answer's `last` next time; `reachable: false` (a
  guest's last poll of its host got no answer) is your failover cue. Also `members()`, `close()`, `state()`.
- **A short code (Task 8w).** `open({ codeDigits: 4 })` makes a code friends can type. It keeps strangers out only because the
  words cannot be guessed and the room closes itself after 30 wrong codes (Kino tells the person; your next calls get
  `room_closed`). Whoever captures the traffic and knows the words, the tunnel provider among them, recovers a 4-digit code
  offline in milliseconds: such a room is not private from the provider. The default 12 digits makes that expensive, not
  impossible. Keep a room's messages low-sensitivity either way.
- **When:** `open` and `join` only from the person's own press (`screenEvent`, `panelAction`; never a tick or a refresh),
  so a plugin can never move a person into a room, or open one, behind their back. `send`, `inbox` and `members` from your
  screen's or panel's calls, ticks included, only while Kino is in front. Never from a job.
- **Limits:** 5 messages a second, 100 and 256 KB a minute per member; 2 to 8 members; 10 to 240 minutes (default 120); a
  mailbox of 200 events or 15 minutes; per device 2 joined sessions and 1 hosted, at most 2 of them for one plugin
  (`room_busy`); 5 wrong codes lock joins for 60 s, doubling up to 30 minutes, and 30 wrong codes in all close the room. A room closes at its TTL, with `close()`, when
  the plugin is removed or switched off, when screens are switched off, and after 30 minutes of Kino in the background (Task
  8z: while the device hosts a room, Android shows Kino's own notification «Sala abierta · N personas» with «Cerrar sala»
  and keeps the room alive, so the host can step out to paste the invitation; the person swiping Kino away closes it).
  Errors carry Kino's own `userMessage` (`room_unreachable`: no internet, a network that blocks it, Cloudflare's rate limit).
- **Security, said plainly.** Every request is sealed (scrypt N=8192 r=8 of the code salted with the words, AES-256-GCM plus
  HMAC-SHA256, per-member keys) and messages are never stored, logged or executed by Kino. **The code protects against casual
  access, not against the tunnel provider**: a stranger can only guess online (and gets locked out), but the TLS-terminating
  provider, targeting a room, could crack a captured join offline (about 400 GPU-days on average on one high-end GPU) and
  then read it; there is no forward secrecy. Keep a room's messages low-sensitivity (a chat, a position). A
  password-authenticated exchange (CPace or SPAKE2) is recorded as future hardening.
- **Payloads are untrusted**: check every message's kind, exact fields, sizes and types; scrub names; cap texts; never
  execute or render one as markup. Never put the code in a message or a log.
- Who leads, what a message means, history and failover are yours. With `open({ code })` a member opens a second door to the
  same room with its own words (refused unless your plugin is in that room now or opened it); publish its words a few seconds
  later (a fresh name takes a moment to resolve). Send a goodbye before `close()`. The Watch Party example shows all of it.
- While the device hosts a room, your tab in Ajustes shows it with a button to close it. Kit: an in-memory room with two
  simulated members (`createKitRoom()` in tests: `say`, `leave`), `KINO_ROOM_REVOKED=1`.

#### Scanning a QR from a screen (`qrScan`)

[`kino.qr.scan`](#qr-scanning-kinoqrscan-qrscan-apiversion-13) works from a `screenEvent` that follows the person's tap or
submit (a root screen, a panel in screen mode, a tab you contribute in screen mode), never from the screen's `open`, a timer
tick, a load-more, a change, a `refreshMs` or a `playerEvent`. On a TV or a device without a camera it answers
`unavailable`: show your code as a `QrImage` there and scan it from the phone.

#### Background jobs (`schedule`, `jobs`, `job(ctx)`)

The capability `schedule`, the manifest's [`jobs`](#3-the-manifest) and the export `job` need each other; a job never stands
alone (it feeds what your screen or catalog shows):

```json
"capabilities": ["screen", "schedule", "shared"],
"jobs": [{ "id": "refresh", "label": { "es": "Actualizar", "en": "Refresh" }, "everyMin": 60,
           "everyOptions": [15, 60, 180, 1440], "runOn": "preferPhone" }]
```

```js
export async function job({ id, reason, lastRunMs, attempt }) {
  const data = await refreshSomething(); // a few requests, one at a time
  kino.storage.set("feed", JSON.stringify(data)); // or kino.shared, for "preferPhone"
}
```

- Kino runs `job(ctx)` headless, through Android's WorkManager, every `everyMin` minutes while the person has that job
  switched on: **each job starts off** (opt-in), and off again after any gap in its approval (uninstalled, an update without
  it). `ctx.reason` is `scheduled` or `manual` («Ejecutar ahora»). Its answer is never read and nothing of a job is shown:
  write to `kino.storage` (or `kino.shared`), and let your screen read it when it opens (stale-while-revalidate).
- **Caps per run:** 20 s, 10 requests made one at a time (the next answers `rate_limited`), 2 MB of answer bodies (an answer
  that would cross it is refused with `too_large`), 256 KB written to `kino.storage`; a cap crossed cuts the run (a failure).
  96 runs a day per plugin. A failure waits 15 minutes, doubling up to 6 h; 3 in a row pause the job until the person switches
  it off and on or a manual run succeeds. A run never starts while your screen, panel or catalog call runs (it waits up to
  30 s, then gives way). Works need a network and the battery not low; «Solo con Wi-Fi» is on by default.
- **An allow-list of APIs:** `kino.fetch`, `kino.storage`, `kino.log`, `kino.config` (read), `kino.cookies`, `kino.crypto`,
  `kino.sleep`, `kino.html`, `kino.secret`, `kino.error`, `kino.rank`, `kino.library` (with its own approval), `kino.ai` (with
  its own approval; each ask is one of the run's requests), `kino.shared` and `kino.seed` (Task 18: under its usual gate, sent
  only while the person's telemetry consent for your plugin is on), plus the plain values (`kino.device`...). Everything else
  (`kino.room`, `kino.qr`, `kino.browser`, `kino.ws`, `kino.meta`, `kino.tmdb`, `kino.nuvio`, `kino.catalog`, `kino.sync`, any
  later API) answers `not_allowed`. No UI, `go`, toast or player action can come out of a job.
- **`enabledBy` (Task 18):** a job may name one of your own `toggle` settings, `"enabledBy": "contribute"`: that setting is
  then the person's on/off for the job instead of the job's own opt-in switch (no second switch to find). The job is on while
  the setting is on (its `default` counts) and its row in Ajustes holds no OFF of the person's: the row still switches it off,
  and that OFF wins until the person switches the row on again; with the setting off the job never runs. Kino's row says which
  setting drives it. Anything but the key of one of your `toggle` settings refuses the manifest (`Each job's "enabledBy" must
  name one of the plugin's toggle settings`; in an `enhancements` block, the block is dropped). The consent line, the
  permission switch, the frequency, «Solo con Wi-Fi» and every cap stay as above.
- **Kino's rows** in your tab (you draw nothing): the job's switch, its frequency (only your `everyOptions`), «Solo con
  Wi-Fi», the last run, «Ejecutar ahora». The person's choices sync. An update never makes a job that is on run more often
  than before; when your new options leave nothing that slow, the job is switched off and its row asks the person to choose
  again.
- **`runOn: "preferPhone"`**: ONE of the person's linked devices runs it, a linked phone first; a TV never runs it while a
  phone that ran it successfully within two of its periods can, and takes over when the phone stops. Each device decides by
  itself from a synced record (no voting); a rare overlap runs it twice, harmless with last-writer-wins results. Write the
  result with [`kino.shared`](#results-shared-between-devices-shared) so the TV's screen reads it, and read `kino.device` to
  do a lighter batch when the TV does run it. The person may choose «Hacer el trabajo en: Este aparato». `runOn: "any"` (the
  default): every device runs its own.
- Kit: `node sdk/run.mjs <folder> job [jobId] [scheduled|manual]` runs one job with Kino's caps.

#### Results shared between devices (`shared`)

A declarative capability with a **plain** consent line (not red, never waiting: the person's own data on the person's own
devices; an update that adds only `shared` applies without a sheet). `kino.shared.get(key)` answers the value or `null` (it
never throws for a stored value); `kino.shared.set(key, value)` answers `true` when stored, `false` when it was already that
value (nothing written or sent); `set(key, null)` removes it. Synchronous, like `kino.storage`, from screens, panels,
settings and jobs.

- Up to 4 keys (`^[A-Za-z0-9_.-]{1,40}$`), each a strict JSON value of at most 64 KB and 16 levels, 128 KB in all; 30 writes
  a minute. Values sync between the person's linked devices, both ways, **per profile** (a TV that carries several people's
  profiles never hands one person's values to another's phone), last writer wins by a clock Kino assigns; a key's new value
  travels at most once a minute (and at most 4 of your keys a minute). They go when the plugin is removed.
- **Never put a secret there** (a token, a password, a cookie, a session): it is copied to every linked device. A key with a
  word like one (`token`, `secret`, `password`, `cookie`, `session`, `auth`, `apiKey`, plurals too) is refused, and so is a
  value holding a sealed secret.
- **What `get` answers is untrusted**: another device wrote it, maybe with another version of your plugin. Validate its
  shape, sizes and every field before you use it.
- Kit: `--device phone` / `--device tv` are two simulated devices sharing `.kino-shared.json`; `node sdk/run.mjs <folder>
  shared` shows what each holds.

#### Kino's text AI (`ai`)

`kino.ai.ask({ prompt, system?, json?, maxChars? })` sends one short text to Kino's text AI (Kilo's free models, the same fixed
destination as Kino's own assistant; no key and no server of yours) and answers `{ ok: true, text, model }` or `{ ok: false,
error, message }` (`unavailable`, `rate_limited`, `too_large`, `timeout`, `refused`). **It never throws.** One-shot: no
memory between asks, no streaming, no tools, no images; Kino adds no persona and keeps nothing (its logs carry sizes and
codes only).

- Prompt at most 8,192 UTF-8 bytes, `system` 2,048; the reply is cut at `maxChars` (1 to 4,096, default 2,048). Per plugin
  10 asks in any 60 s, 100 a day, one at a time, 20 s each; for every plugin of the device together 300 a day and 2 at once,
  so plugins never starve Kino's own assistant (which shares Kilo's anonymous quota).
- **Only after the person's own press** (a settings `action`, a `panelAction`, a `screenEvent` tap or submit; never a
  screen's `open`, a tick, a load-more, a change, a `playerEvent`, Home, search or play) **or from your job** (each ask one of
  the run's requests). A screen event is still bounded by its session's own 60 s: ask once per event and batch items into
  one prompt.
- `json: true` only ASKS for JSON; the text comes back as the model wrote it, parseable or not.
- **The reply is untrusted data.** The model read whatever you sent, and text you took from the web or from the person can
  steer it (prompt injection). Validate every field against what you sent (drop ids and categories you did not ask for),
  never execute it, never follow instructions found in it, never open a URL from it without checking it, and keep a fallback
  for when the AI is off or unavailable. Kino never shows a reply by itself.
- What you send leaves the device: say so in your own UI. Kit: `KINO_AI_REPLY`, `KINO_AI_ERROR`, `KINO_AI_REVOKED=1`.

#### Reading only the head of a page (`kino.fetch` `maxBytes` and `stopAt`)

From apiVersion 14, `kino.fetch(url, { maxBytes })` (1 to 2,000,000) reads the body up to that many bytes and stops: the rest
is never downloaded, and the answer's `truncated` is `true` when the body was cut (a cut text may end inside a character).
Use it to read a page's `<head>` (`maxBytes: 65536` for `og:image` and `og:description`) or the start of an article. **Check
`truncated` before you parse**: never `JSON.parse` a cut body. In a runtime that holds sealed values the body is read whole
(up to the usual 5 MB), redacted, and only then cut. Out of range: `invalid_request`; below apiVersion 14 the option is
ignored. See [`kino.fetch`](#await-kinofetchurl-options).

`stopAt` (apiVersion 14, a text answer only) ends the read as soon as the text holds a marker of 1 to 32 printable ASCII
characters, matched ignoring ASCII case; the marker is kept and `truncated` is `true` when more followed. With `maxBytes`,
whichever comes first wins. `{ stopAt: "</head>", maxBytes: 65536 }` reads a page's head and never more than 64 KB (the
news example does exactly this for each story's picture and summary). A byte answer with `stopAt` fails with
`invalid_request`.

#### Screens for a plugin that keeps an older apiVersion (`enhancements`)

A plugin that raises its `apiVersion` to 14 is refused by every older Kino. To keep those people, keep your `apiVersion` and
offer the screen in an optional block only a newer Kino reads:

```json
"apiVersion": 8,
"capabilities": ["search", "home", "resolve"],
"enhancements": { "14": { "capabilities": ["screen", "library"], "screen": { "label": "Inicio", "menuOpens": "both" } } }
```

An older Kino ignores the key and never calls `screen`/`screenEvent` (one JS file); this Kino merges the block and checks it at
apiVersion 14. A block that fails is dropped and logged, never a refusal. Only `screen`, `library`, `playerPanelTab`,
`playerControl`, `room`, `schedule` (with its `jobs`, in the same block: each needs the other), `shared` and `ai` can be added
this way. Every rule is in the [`enhancements` row](#3-the-manifest); `node sdk/validate.mjs` reports every block Kino would
drop.

```json
"apiVersion": 8,
"enhancements": { "14": {
  "capabilities": ["screen", "schedule", "shared"],
  "screen": { "label": "Mi plugin", "opensFrom": ["settings"] },
  "jobs": [{ "id": "refresh", "label": { "es": "Actualizar", "en": "Refresh" }, "everyMin": 180, "everyOptions": [60, 180, 360] }]
} }
```

The consent is a plain manifest's: `schedule` and `ai` are red lines asked at install and on the update that adds them (shown
first and open, below), never approved by Kino on its own and unticked in a kit import; `shared` is a plain line. Your script
must export `job` for the block to stay (else it is dropped, logged). On an older Kino none of it exists: keep the work your
plugin does without jobs where it already is.

**A `settings` list in a block** (Task 18 audit) is read at the block's apiVersion: its English texts (`labelEn`, `hintEn`,
`confirmEn`), `devices`, `linkOnly`, `help`, `link` and `qr` items, `"sync": false` and `unlockWith` all apply on a Kino that
read the block, and are ignored on an older one, which reads your base list. So: keep every key of the base list with its
type (else the block is dropped: `settingRetyped`) and its `sync` (`"settings" changes "sync" of the setting "<key>"`, also
dropped: a value that syncs on one Kino and stays on the device on another would differ between the person's devices); a NEW
key may say `"sync": false`. The two runtime features that depend on what the list may declare follow the list too: a
`settingsStatus` answer's `hide` and an action's `setSettings` filling a `password` (both from apiVersion 13) are read at the
block's apiVersion when the block replaced `settings`, and at your own apiVersion otherwise (a block that only adds a screen
changes nothing for them). `setSettings` still fills only a `password` the list in effect declares, still refuses the whole
field for an undeclared key or another type, never moves an `unlockWith` setting off its default, and the form saves the
value as a typed one (sealed, never shown back, device-only with `"sync": false`). What else reads your own apiVersion stays
so on purpose: the sealed `secrets` limit, the cipher key rules, Categorías, and every feature outside `settings`.

#### Updates: new consents come first

When an update of your plugin adds a red line (a capability above, `"fetchHosts": "any"`, `browser`, `tracking`...) or a new
host, Kino's update sheet shows it **first and open**, under «Nuevo en esta actualización», by severity (any-host first, then
the other capabilities, one grouped line for new insecure hosts, then the new hosts), each line a D-pad stop on the TV, with a
«Hay más abajo» cue; what the person already approved stays behind «Ver detalles». So one tap never approves something
unseen. The update waits for the person; a plain line (`shared`) does not hold it back. On a first install everything stays
behind «Ver detalles», as before. Describe in your release notes why you need the new reach.

### Testing screens with the kit

```
node sdk/validate.mjs <folder>                                    # the manifest, the exports, every consent line, enhancements
node sdk/run.mjs <folder> screen                                  # the tree as Kino reads it (aliases resolved, drops logged)
node sdk/run.mjs --device tv <folder> screen                      # as a TV
node sdk/run.mjs --state '{"inputs":{"q":"dune"}}' <folder> screenEvent search
node sdk/run.mjs --context '{"route":{"name":"categories","params":{},"args":{"from":"categories"}}}' <folder> screen
node sdk/run.mjs <folder> panel <ref>                             # a panel (legacy or screen format)
node sdk/run.mjs --state '{}' --screen <folder> panelAction <ref> <name> press
node sdk/run.mjs --foreign latino:Latino <folder> panel <ref>     # a tab you contribute to another plugin's title
node sdk/run.mjs --device phone <folder> job refresh manual       # one job run, with Kino's caps
node sdk/run.mjs --device tv <folder> screen                      # ...then read what the job shared, as the TV
node sdk/run.mjs <folder> shared                                  # what the simulated phone and TV hold
```

`run.mjs` prints the tree after Kino's rules (with the older names Kino reads internally, the per-size values resolved in
`byClass`), every dropped node and field, and the answer's fields; `validate.mjs` checks the tree and `go` objects like the
app. The environment variables `KINO_LIBRARY_FIXTURE`, `KINO_LIBRARY_REVOKED`, `KINO_ROOM_REVOKED`,
`KINO_PLAYER_CONTROL_REVOKED`, `KINO_AI_REPLY`, `KINO_AI_ERROR` and `KINO_AI_REVOKED` play the person's data and choices.
In `node --test` files, import the kit's helpers (`createKino`, `createKitRoom`...) as the examples' tests do. The shared
case files in `sdk/test/` (`screen-cases.json`, `room-cases.json`, `job-cases.json`, `ai-cases.json`, `shared-cases.json`,
`player-control-cases.json`, `panel-foreign-cases.json`, `qr-origin-cases.json`) are the very cases the app's tests run.

### Patterns

- **Compose with plain functions.** A screen is data: one function per tab or card (`newsTab(state)`, `card(story)`), a
  handler map for `screenEvent` (`const on = { open, read, more, save }; return on[name]?.(ev) ?? null;`). The plugin stays
  one file at run time.
- **Keep the state small.** It travels on every call and is capped at 64 KB: keep ids and choices there, and the bulk (a
  feed, articles) in `kino.storage` or `kino.shared`, read in `screen()` by the ids.
- **Work in small steps.** Never do everything in one call: a call has 20 s and a job 20 s and 10 requests. Write one pure
  function, `step(cache, fetch, settings, clock, budget)`, that moves a work queue forward a little (the next batch of
  searches, a few pictures) and stops on its budget, keeping a cursor in the cache. Call it from the job, from the screen's
  `open`, and from an `every` tick; each call resumes where the last stopped. With the clock and the budget as parameters
  your tests prove it stops and resumes. A lighter budget on a TV (`kino.device`).
- **Caches behind an adapter.** Read and write through one small object (`get`, `set`) that tries `kino.shared` and falls
  back to `kino.storage` when it is missing or refuses, so the same code runs with or without the capability, on an older
  Kino, and in tests.
- **Stale-while-revalidate.** Show the cache at once on `open`, then fetch only what is stale; a `Skeleton` for what is not
  there yet; a `MaterialBanner` with «Reintentar» when the network fails, with the old data still shown.
- **Every input is untrusted**: what `kino.shared` and a room answer, an AI reply, a page you fetched, a value from an
  older version of your plugin. Check shapes, sizes and fields; scrub control and direction characters from names.
- **Texts in Spanish and English.** Every text node takes its `En` twin; your toasts read `lang`. Kino's own words are its
  own (in both languages).
- **No secrets where they travel**: never in `kino.shared`, a room message, a `QrImage`, an AI prompt or a log line.
- **Feature-detect** (`kino.screen.names`, `typeof kino.library === "object"`...) and keep a way without each capability:
  the person may refuse it or switch it off.
- **Logic lives in the plugin.** Kino ships generic primitives (the screen kit, the tab host, rooms, player control,
  `titleByIds`, `library`, jobs, `shared`, `ai`); a feature such as a Watch Party is entirely a plugin's protocol on top of
  them.

### The examples

Four plugins in this repository show the chapter at work; each folder has a README (Spanish and English) and tests that run
without a network.

#### News (`screen-news`)

[`examples/screen-news`](examples/screen-news/): two tabs. **Noticias**: news about the movies and series the person watched
and their own terms, from Google News RSS, as a twelve-column grid of flush cards (one, two or three per line) with category
chips; a card's tap reads the story and the answer opens a declared pop-up (`ui: [{ open }]`) with the picture, the text
read from the outlet's page (`maxBytes`) and «Ver noticia» (`go.url`; on a TV also a QR). **Configuración**: the frequency,
pictures and texts, sorting with AI, «Usar lo que he visto» with removable rows, sample titles, and the person's own terms
added through a pop-up with a form. It demonstrates `library`, a `schedule` job with `runOn: "preferPhone"` writing to
`kino.shared` through a cache adapter with a `kino.storage` fallback, `ai` classification in the job or after «Clasificar
ahora» with strict validation and a keyword fallback, image `fallback`, `card.flush`, the twelve-column grid, `bind`, an
`every` timer stepping the work queue, and a TV budget. It shows its limits honestly: Google's article links are resolved
with an unofficial call that can break. Its source is split into `src/` and bundled into `plugin.js` (see
[Structure a bigger plugin in files and bundle it](#structure-a-bigger-plugin-in-files-and-bundle-it)).

#### Watch Party (`watch-party`)

[`examples/watch-party`](examples/watch-party/): «Party Chat», a tab contributed to the player panel of any plugin's title
(`playerPanelTab`), with `room`, `qrScan` and `playerControl`. A chat (text up to 300 characters and eight reactions) and the
playback kept in step: the host broadcasts its position; a guest follows only when its source plugin (`ctx.source`) and the
title's ids match, else «Abrir este título» (`go.titleByIds`). Sharing is the room's words and code and a QR of both. It
shows the room protocol a plugin owns: snapshots every 10 s, backup doors (`open({ code })`), an election with one tap to move
(because `join` needs a press), incremental chat replication, a TV seat linked from a phone, untrusted peers, and why the tab
must be pinned (for the playback) to keep running. Its source is split into `src/` and bundled into `plugin.js` (see
[Structure a bigger plugin in files and bundle it](#structure-a-bigger-plugin-in-files-and-bundle-it)).

#### Calculator (`screen-calculator`)

[`examples/screen-calculator`](examples/screen-calculator/): the opposite end: no network, no job, no settings. A display
card and twenty buttons in a `Row` with `wrap: true` (`span: 3`), sized with per-size maps for phone, medium and TV; a pure
view over `state.calc` and pure exported functions for the logic, tested with a 94-row table and a property test. On a TV the
D-pad walks the button matrix: a regression guard for focus on a grid. Each key is a JS round trip, so it is also the
latency probe of the screen kit.

#### Setup flow (`screen-setup-flow`)

[`examples/screen-setup-flow`](examples/screen-setup-flow/): a sign-in in three steps with no network, the pieces the
screen asks added: Kino's `steps` node (a done step pressed goes back), a `QrImage` that expires (Kino's own countdown and an
`onExpire` five seconds before the end that draws a new code), a `Form` with a masked `TextField` (`obscureText`) whose
text is written to the plugin's own `password` setting through `config` and never kept in the state, and a `settings` node
whose `onSaved` tells the screen the person saved. Pure exported functions, tested with the kit.

#### Gallery (`screen-gallery`)

[`examples/screen-gallery`](examples/screen-gallery/): every component of the [User interface](ui.md) reference on one
screen, a tab per group (Layout, Content, Actions, Forms, Overlays, Navigation, Data), each component in a section keyed by
its anchor in the reference, with interactive demos (pop-ups from an answer and declared, toasts, form validation, `ui`
operations, `bind` and `config`, `go.url`, `go.titleByIds` and `go.screen` with harmless targets, a timer). Its
`screenshot-map.json` says where each component is, for capturing the reference's pictures from the real renderer.

### Known limits and device checks

What this version does not do, and what has not been measured on real devices yet:

- A declared pop-up's body cannot be filled by a second answer: an answer cannot chain an event, so a story that needs a
  slow fetch is read before its pop-up opens (no skeleton-then-text inside one pop-up).
- A load-more's answer can still open a pop-up.
- A contributed tab (a Watch Party) does not work on M3U lists, own channels or other non-plugin content, and runs only
  while it is selected in an open or pinned drawer.
- `go.titleByIds` opens a series whole (no season or episode focus yet).
- No `bind` on a `NumberStepper`; the screen's state is dropped on close. A masked `TextField` (`obscureText`, the screen
  asks) keeps what was typed only in memory and only until the person's next tap or submit carries it (ui.md, Secret
  fields); its TV dialog and its phone eye were checked in render tests only, not yet on a real TV or phone.
- A screen whose fixed sizes are taller than the window does not scroll by itself: put the root in a `scroll` (or size it
  per `heightClass`), as the calculator example does in landscape.
- On a phone in landscape the pinned panel takes 32 % of the width but never less than 360 dp, so a narrow phone gets about
  59/41 (video/panel) instead of 68/32.
- The pin lasts for one playback (owner's choice): leaving the player forgets it.
- When even the stacked rows of player buttons do not fit (a very narrow video area), the least important buttons go to one
  more row under them, not to a «⋮» menu.
- Found on a phone (Redmi, debug build) and fixed in this version: the pinned or drawer panel's form under the keyboard; a
  tab switch keeping the previous tab's scroll (each tab now keeps its own); dim status icons and a light navigation bar on
  plugin screens (a plugin screen now draws light icons on a dark bar while it shows; Kino's own screens are unchanged);
  the phone banner squeezing its text (the action now goes under it); the install sheet saying a screen-only plugin adds
  nothing; the Ajustes tab's monogram instead of `screen.icon`; the job frequency chips overflowing; the link sheet's Abrir
  accepting a tap made before it appeared. The news example's job no longer crosses the 2 MB per-run cap (`maxBytes` and
  `stopAt` on every page) and keeps one frequency (the job's).
- Device checks still open (each passed the automated tests; the item is a check on real hardware):
  - **TV and D-pad:** a whole TV pass of this version (the second device pass was phone only): rows of more than six
    children on a real TV box; a root column taller than the window; the pop-up focus trap, its scrolling body and focus
    returning after a removed node; the toast's Down-to-toast handoff and Back on a focused toast; `onEndReached` end markers
    on a lazy list; `ExpansionTile` Down handoff and its last item; hold-to-repeat on a `NumberStepper` with a real remote;
    the link sheet's Cancel focused first and its QR; the job chips walked with the D-pad; a tab's scroll memory.
  - **Tables and settings:** a `DataTable` scrolling sideways on a phone, the D-pad into an off-screen column, zebra
    contrast on a TV and TalkBack's table reading; the phone's `settings` node with text, url and password fields.
  - **Over the player and in the panel:** the screen opened over the player (focus after Back, insets, jitter taps, auto-next
    under it); a panel in screen mode (TV focus after a refresh or an error); the pinned panel's focus region and layouts,
    and its form above the keyboard (portrait pinned, drawer, landscape pinned); on a TV, Right into the pinned panel from
    either row of buttons and from the hidden controls, Back hiding it first, Left out of the drawer, and the two stacked
    rows of buttons over the docked video (subtitles and the letterbox under them).
  - **Rooms:** two real phones (the second pass used one phone and a desktop test guest), joining by QR, a backup
    endpoint, a guest's pause or seek moving the host's video (`playerControl`), rooms on a TV, the 5-minute background
    close, a network change and a slow client through a real tunnel.
  - **Jobs, shared and AI:** a scheduled (not manual) run, the Wi-Fi-only condition, `runOn: "preferPhone"` routing to a
    linked phone and the TV reading its `kino.shared` result; jobs on a 1 GB TV box (a hostile busy loop is cut only by the
    run's timeout); sorting with `kino.ai.ask` switched on.
  - **Network:** `maxBytes` and `stopAt` against gzip and chunked servers.
  - **Text and system bars:** accent marks (tildes) not clipped at the top of tight lines; the plugin screen's status and
    navigation bars on a phone in light mode, after a rotation and back on Kino's Home; the update sheet at font scale 2.
  - **Release build:** everything above was seen on debug builds; an R8 (release) build has not been checked.

### Appendix: notes for the desktop port

For the maintainers of Kino's desktop port (Linux, Mac, Windows), which lives on its own branches and takes this work with its
next merge of `main`. The contract is the same JSON on every front end; these are the app-side members the desktop must
implement or wire, compiled from the build reports. Without them most features stay safely off (a no-op or a refusal), never
broken.

- **Renderer.** Draw resolved trees only (`resolveResponsive` per size class; tables are padded and fitted there). Widgets
  added after the first set: `banner`, the toast object, `accordion` (`state.ui.open`), `skeleton`, `qr`, `stepper`, `table`
  (`tr`/`td`), the twelve-column `wrap` row (Kino's `ScreenColumns` line breaking, cells stretched by intrinsics), `form`,
  `settings` (until the desktop draws it, pass `screensEnabled = null` or drop the node), `popup` with `onClose`,
  `Card.flush` and `Image.fallback` (a child node drawn in the image box; any tree walk must visit it; `Image.url` may be
  `""` with a fallback: treat it as failed, never request it). Text entry on the desktop is a normal field, like the phone.
- **Session and pop-ups.** A host that implements `ScreenEvents.dismissDialog` itself must call
  `PluginScreenSession.dismissPopup()` (not `closeRoute`), or `onClose` never reaches the plugin (`SessionScreenEvents`
  already does). `ScreenAnswer.ui` is filled for every answer; deferred `open` waits for the answer's tree.
- **Navigation.** Mount `PluginScreenLaunches` at the root (the settings button, `go.screen`, focus restore) and
  `rememberScreenGo` (the `ScreenGoRequests` consumer, `currentEntry` passed); handle `ScreenGo.KinoCategories`. Every
  exhaustive `when` over `ScreenGo` needs `TitleByIds` and `Url`. `ScreenNavigator.titleByIds` and `ScreenNavigator.url` have
  **silent no-op defaults**: wire `screenGoRoutes(openTitleByIds = ...)` (needs `TmdbApi.adultFlag`, `movieIdByImdb`,
  `seriesByImdb`, a `search?kind&tmdbId` route, `TitleByIdsOpener`) and `screenGoRoutes(askUrl = ...)` (reuse `ScreenUrl`,
  `UrlGoController`, `UrlGoLimiter.shared` and the sheet's text; open with `Desktop.browse`).
- **Player panel.** Handle `PanelUi.Screen` and `PanelUi.Hidden`; `PanelSession` lost `playerAllowed` and gained
  `playerControl` and `announce`; `PanelPlayerGate(held, casting, clock)`; `PanelAnswer.titleByIds` and `PanelAnswer.url`
  (defaulted); panel `go` is gated at 500 ms. The tab host (`PanelHost(outerBar, takeFocus, pin)`, `PanelSession(contributed)`,
  `rememberPluginPanelHook(prefs, foreignAllowed)`, `PlayerPanelDeps.prefs`) and the dock (`PanelDock`, `PanelDockFrame`,
  `LocalPanelDock`, `PanelDockFocus`, the `holdsInput` gate) are optional: without them the desktop keeps today's drawer.
  `PLUGIN_JOBS` needs a branch in any exhaustive `when` over `SyncedSetting`; `SyncedSetting.PANEL_PINNED`, the
  `panelPinned` setting and its sync and backup entries are gone (the pin lives in the player screen,
  `rememberPlaybackPanelDock`): a desktop branch that wired them drops them. The TV row's links are now `TvRowLinks` /
  `tvRowSlot` and the row is `TransportRow(stacked)` (`TvRowEnd`, `panelFocusLinks`, `transportRight` are gone);
  `TvDimButton`/`TvZoomButton` take the row's links; `PanelDrawerLinks`/`LocalPanelDrawerLinks` (optional) let the TV drawer
  hand focus back to the controls.
- **Capabilities.** `room`: no `QuickTunnelRooms` wiring on desktop, so rooms answer `permission_denied` until wired
  (`HttpsRoomTransport` and `PluginRoomServer` are plain JVM). Jobs: `PluginJobWorker`/`WorkManagerJobScheduler` are
  Android-only; the desktop needs its own `PluginJobScheduler` (a scheduled executor while the app runs) and wiring of
  `AppGraph.pluginJobKernel`. `kino.shared`/job runners take Android `SharedPreferences` (pass a prefs shim) and the AppGraph
  identity wiring; without it `kino.shared` answers `not_allowed`. `ai`: `PluginHost.ai` defaults to refused; give the
  desktop graph `PluginKinoServices(ai = ...)`, its own `PluginAiQuotaStore` and the plugins' own HTTP dispatcher. `qrScan`:
  the desktop has no scanner (`unavailable`, as a TV).
- **Strings.** The `Strings` interfaces gained members (room, `ScreenStrings` for the link sheet, `PanelStrings` for control
  notices and the pin, `SearchStrings.titleAdultLocked` and `noSourcesAnyQuery`, `PluginsStrings.consentNewInUpdate`):
  desktop catalogs that implement them must add the Spanish and English texts.
- **New data fields with defaults** that flow unchanged: `PluginCall.tick` and the press mark, `PluginHttp.Request.maxBytes`
  and `Response.truncated`, `InstalledRecord.roomOff`, `PluginReach.roomOff`, `ScreenNode.Popup.onClose`.
- Run the desktop compat check after the merge and fix what it reports as ATTENTION or BREAKS before shipping a desktop
  build.
