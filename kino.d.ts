// TypeScript declarations for Kino plugins (apiVersion 1 to 14; 14 adds the screen capability (screen, screenEvent and the manifest's screen block: a full-screen canvas the plugin builds), library, playerPanelTab, playerControl, room (kino.room, a mailbox hosted on the person's device over the Internet), schedule (background jobs: the manifest's jobs and the job export) and the manifest's enhancements; 13 adds the socket capability (kino.ws, outbound WebSockets) and the byteSource capability (a stream whose bytes the plugin serves through its read export) and the storageLarge capability (a 16 MiB kino.storage for a plugin that keeps a catalog) and the catalog capability (kino.catalog, a searchable SQLite catalog of up to 100,000 items per plugin in a 64 MiB file) and the qrScan capability (kino.qr.scan, the phone's camera scanner for a QR code) and the settings form's qr setting (a QR whose text settingsStatus gives, refreshed every refreshMs) and the kino.crypto operations aesIge, modPow, gunzip, convert and aesIgeVerify and the imageSource capability (a poster, backdrop, still or hero image the plugin serves through its image export, KinoImageRef); 12 adds the syncProvider capability (syncPull, syncPush, syncStatus and the manifest's sync block); 11 adds the externalResolve capability (a stream's `external` hand-off to a resolver app, the manifest's externalResolver) and, from Kino 0.9.66, a stream's advisory `media` and its `portable` universal copy; 10 adds the playlists capability; 9 adds the player panel (panel, panelAction, playerEvent, the manifest's panel and settingsLayout), fetchHosts "any" for hand-written plugins, English setting texts and kino.meta by title; 8 adds the audio item kinds music and podcast; 7 adds tracking and segments; apiVersion 5 only adds the manifest's signature, 6 the plain-plugin SDK: typed and larger secrets, migrate, signed streams, the settings form, debug, telemetry, section, categories, theme and scopedSearch). Reference them from plugin.js
// with `/// <reference path="./kino.d.ts" />` for editor help; Kino itself runs plain JavaScript.
// The numbers in the comments come from contract.json, which is authoritative. The app checks that
// every `kino` member declared here exists in its runtime and nothing else does (KinoDtsTest).

// ---------- what your functions receive and return ----------

/**
 * `search(query)`: `type` is a hint, never a filter. `cursor` is null on the first page. `"music"` and `"podcast"`
 * (apiVersion 8) when Kino leans towards audio; `"any"` includes them.
 */
interface KinoSearchQuery {
  q: string;
  type: "movie" | "series" | "music" | "podcast" | "any";
  year: number;
  season: number;
  episode: number;
  tmdbId: number;
  /** TMDB's original title when it differs from `q`, else "". */
  originalTitle: string;
  /** Other known titles, at most 5, each at most 200 characters. */
  altTitles: string[];
  cursor: string | null;
  /**
   * apiVersion 6, capability "scopedSearch": the browse `ref` of the "Ver más" page the person searches inside (a Home
   * row, a section row, a category), exactly as you gave it; absent on a plain search. Return null when you cannot
   * search there: Kino then filters the page's loaded titles itself.
   */
  within?: string;
}

interface KinoItem {
  /** ^[A-Za-z0-9._~-]{1,128}$, stable: the library keys the title by it. */
  id: string;
  /** Your own opaque reference, at most 4096 characters. */
  ref: string;
  title: string;
  /**
   * `"live"` needs `"apiVersion": 2` (a v1 plugin's live item is dropped): a live channel, whose
   * `ref` goes to `resolve` and plays as live straight from its card, with an "EN VIVO" badge; it
   * has no `runtimeMinutes` (ignored) and no episodes, is never saved to the library, never resumed
   * and never downloaded.
   *
   * `"music"` (an album, playlist or single track) and `"podcast"` (a show or an audiobook) need `"apiVersion": 8`
   * (below it they are dropped, with a log line, and the rest of the answer stays) and NOT the `episodes` capability.
   * With `episodes` declared, Kino calls `episodes(ref)` with an audio item's `ref` for its tracks or episodes (a single
   * track answers one entry: `number` = track number, `still` = cover, `runtimeMinutes`), each entry's `ref` going to
   * `resolve`; without it, the item's own `ref` goes straight to `resolve` and plays as one track, like a movie's.
   * `runtimeMinutes` is kept.
   */
  kind: "movie" | "series" | "live" | "music" | "podcast";
  /**
   * apiVersion 8, `music` and `podcast` only: the artist (music) or the host/author (podcast). Trimmed, at most 200
   * characters; ignored on any other kind. The album or podcast page shows it as the line under the title; without it
   * there is no such line (Kino never guesses one from `overview` or `genres`).
   */
  artist?: string;
  year?: string | number;
  /**
   * http or https, at most 2048 characters; a public name or a public IPv4 address, never the home network or a local name
   * (over http not even a name without a dot), except the person's own server. apiVersion 13 with "imageSource": or an
   * image reference ({@link KinoImageRef}) whose bytes your `image` export serves.
   */
  poster?: string | KinoImageRef;
  /** Like `poster`: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  backdrop?: string | KinoImageRef;
  overview?: string;
  originalTitle?: string;
  /** At most 5, each at most 30 characters. */
  genres?: string[];
  /** 0..10 */
  rating?: number;
  /** 1..1000; ignored on a `live` item. */
  runtimeMinutes?: number;
  ids?: { tmdb?: number; /** ^tt\d{5,10}$ */ imdb?: string };
  lang?: string;
  quality?: string;
  /** At most 3, each at most 20 characters; shown as chips. */
  badges?: string[];
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. */
  adult?: boolean;
  /**
   * Task 7g (with the `screen` capability): a tap on the card opens this plugin's own screen at that route instead of the
   * title's page, while the screen can open; otherwise (screens off, the screen hidden or failing) the tap does what it always
   * did. Anything but `{ screen }` is ignored and logged, the item kept.
   */
  open?: { screen: KinoScreenOpen };
}

/** A Home row. `ref` needs the `browse` capability: the row gets "Ver más", which calls browse(ref, null). */
type KinoGenre =
  | "peliculas" | "series" | "anime" | "infantil" | "documentales"
  | "deportes" | "noticias" | "musica" | "entretenimiento" | "otros";

interface KinoRow {
  id: string;
  title: string;
  /**
   * Items of kind "live" (channels) stay in a Home row from apiVersion 6, as channel cards with the "En vivo" badge
   * that open like a channel from En vivo (a 18+ one only while the person's code is unlocked); below 6 they are
   * dropped from Home. A row left with nothing to show is not shown.
   */
  items: KinoItem[];
  ref?: string;
  /** Task 7g: the row's "Ver mas" opens this plugin's own screen while it can, else follows `ref` as before (none: no "Ver mas"). */
  open?: { screen: KinoScreenOpen };
  /**
   * What the row (or category, or list) is about, from Kino's closed vocabulary: "peliculas", "series", "anime",
   * "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento" or "otros". Kino groups Categorías
   * by it and filters En vivo by it across plugins. Optional: without it Kino guesses from the title; a value outside
   * the list is ignored. Kino versions before this field ignore it.
   */
  genre?: KinoGenre;
}

/** `next` (at most 2048 characters, opaque) needs the `browse` capability; the app passes it back as the cursor. */
interface KinoPage {
  items: KinoItem[];
  next?: string;
}

interface KinoEpisode {
  /** 1..999, default 1. */
  season?: number;
  /** 1..99999 */
  number: number;
  ref: string;
  title?: string;
  /** Like an item's `poster`: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  still?: string | KinoImageRef;
  overview?: string;
  /** YYYY-MM-DD. Since Kino 0.9.55 shown under the episode in the list (phone and TV), worded in the app's language. */
  airDate?: string;
  /** 1..1000. Since Kino 0.9.55 shown under the episode in the list, next to `airDate` ("12 mar 2024 · 48 min"). */
  runtimeMinutes?: number;
}

interface KinoSeriesInfo {
  title?: string;
  /** Like an item's: a URL, or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  poster?: string | KinoImageRef;
  backdrop?: string | KinoImageRef;
  overview?: string;
  genres?: string[];
  year?: string | number;
  /** Kino 0.9.54: 0 to 10, like an item's. */
  rating?: number;
  /** `tmdb`, `imdb`; Kino 0.9.54: also an anime's `mal`, `anilist`, `kitsu` (whole numbers), for AniList and meta plugins. */
  ids?: { tmdb?: number; imdb?: string; mal?: number; anilist?: number; kitsu?: number };
  /** Kino 0.9.54: a movie's length (in a `details` answer); a series' is per episode and ignored. */
  runtimeMinutes?: number;
}

/**
 * One season of a series, for a source that keeps each season as its own `series` item: that item's
 * `id` and `ref` (`episodes(ref)` lists it). `title` is what the season selector shows ("Temporada 2");
 * `current` marks the season whose episodes came in the same answer (Kino also recognizes it by `id`).
 */
interface KinoSeason {
  /** The season's own item id, same pattern as an item id. */
  id: string;
  /** The season's own series ref, at most 4096 characters. */
  ref: string;
  title: string;
  /** 1..999; leave it out when the source has no numbering. */
  number?: number;
  current?: boolean;
}

interface KinoEpisodes {
  series?: KinoSeriesInfo;
  episodes: KinoEpisode[];
  /**
   * Only when each season is a separate item: every season of the show, this one included, at most
   * 50. Leave it out when `episodes` already holds every season (Kino reads the seasons from them).
   */
  seasons?: KinoSeason[];
}

interface KinoStream {
  /**
   * https on a declared host (http only on one declared `insecureHttp`), or the person's own server exactly as typed.
   * A live channel's stream of a plugin approved for `"liveStreamHosts": "any"` may be on any public host, http or https.
   * Ignored when `external` is given instead (apiVersion 11): then `url` may be omitted or left empty.
   */
  url: string;
  mime?: string;
  /**
   * Sent with every request the player makes for this stream (and, for a plugin that declares the
   * `download` capability, with the request that saves it to the device). At most 20.
   */
  headers?: Record<string, string>;
  subtitles?: { lang: string; url: string; format?: "vtt" | "srt" }[];
  /**
   * Separately-hosted audio tracks (a dub, an alternate mix), at most 8: Kino plays your video with
   * each merged in as its own track, offered and auto-picked by the person's audio-language
   * preference exactly like the container's own. `lang` is a short code like `subtitles`' (up to 16
   * characters; blank becomes `"und"`); `label`, if given (up to 40 characters), is shown verbatim
   * instead of a name guessed from `lang`. Checked the same way as `subtitles`: https on a declared
   * host, or the person's own server exactly as typed; a bad entry is dropped and the rest survive,
   * and so is a `url` already listed (the first entry wins). Ignored for a `live` item's stream: a
   * channel's other languages go inside its manifest.
   */
  audioTracks?: { lang: string; url: string; label?: string }[];
  /** Ignored for a `live` item's stream: a channel has no length. */
  durationMs?: number;
  /** 30..86400: after that long, a failed playback calls resolve() once more. */
  expiresInSeconds?: number;
  /**
   * apiVersion 2, and only with the `drm` capability declared: the stream is Widevine-protected and
   * Kino fetches its license from `licenseUrl` (checked exactly like `url`: https on a declared host, http only on one declared `insecureHttp`)
   * sending `licenseHeaders` (filtered like `headers`, at most 20) with the license request only.
   * Without the capability any DRM-shaped key refuses the stream. A protected title never downloads.
   * Kino negotiates Widevine at security level L3 (software), and only when the device confirms L3:
   * the license server must allow it. `audioTracks` next to `drm` are played clear (no license for
   * them): plain, unencrypted files only.
   */
  drm?: { type: "widevine"; licenseUrl: string; licenseHeaders?: Record<string, string> };
  /**
   * apiVersion 6: `"request"` makes Kino sign every playlist and segment request of this stream with your
   * `sign()` export, right before sending it, through a local proxy. HLS only (an HLS `mime` or a `.m3u8`
   * path); never with `drm` or `audioTracks`; not on an inline `liveChannels` stream (use `resolve()`).
   */
  signing?: "request";
  /**
   * apiVersion 6, with `signing`: up to 4096 characters `sign()` gets back as `context` (it can't read kino.storage).
   * Never a `kino.secret()` marker (refused): a marker only works in the runtime that made it, so call
   * `kino.secret()` inside `sign()` itself.
   */
  signContext?: string;
  /**
   * apiVersion 6, with `signing`: other hosts serving this same stream at the same path and scheme, up
   * to 6, each `"host"` or `"host:port"` (no scheme, no path, no IPv6). Kino tries the playlist on each
   * (3 rounds, the one that served last first) and moves a segment, key or map to another one when its
   * own fails 3 times. `sign()` always gets the URL of the host being asked, so pick that host's token
   * from `context`. Each entry meets the same host rule as `url` (declared hosts, or any public host
   * under `liveStreamHosts: "any"`); one that fails it, repeats `url`'s host or another entry, or comes
   * after the sixth is dropped. Not an array of strings: the stream is refused. Ignored without `signing`.
   */
  alternateHosts?: string[];
  /**
   * apiVersion 6: this copy's short name, e.g. "Latino · Streamwish", shown in the player's "Servidor" menu (phone and
   * TV) and in logs. Trimmed; at most 48 characters, no control characters, or it is dropped (the copy still plays).
   * Ignored below apiVersion 6.
   */
  label?: string;
  /**
   * Other copies of the same video, best first, at most 8: when `url` cannot play on the device (a codec it lacks, a broken
   * file) or is gone, Kino moves on to the next one by itself, at the same spot, before showing any error. Each is checked
   * exactly like `url`, `mime` and `headers`; a bad entry is dropped. They share this stream's subtitles and audio tracks.
   * Ignored next to `drm`, with `signing` (use `alternateHosts`) and for a live channel.
   *
   * apiVersion 6: each may carry a `label` (same rules as the Stream's), and may be `{ label, ref }` instead of a URL: a
   * lazy copy. `ref` (a non-blank string of at most 512 characters) goes to your `resolve(ref)` ONLY when that copy is
   * needed -- the person picks it in the "Servidor" menu, the automatic fallback reaches it, or a download's copy choice
   * probes it within its 30 s budget. That call is a normal `resolve` (same time limit, same checks,
   * `kino.browser.capture` allowed); only its `url`, `headers`, `mime`, `subtitles`, `expiresInSeconds` and `skip` are
   * used, never its own `alternatives`. Its `skip` applies while that copy plays and is never saved (the Stream's `skip`
   * stays the episode's). A failure moves on to the next copy. Below apiVersion 6 a ref-only entry has no `url` and is
   * dropped.
   */
  alternatives?: KinoStreamAlternative[];
  /**
   * Where THIS file's opening and ending are, in ms from its start: Kino's "Saltar intro" shows from
   * `openingStartMs` (0 when left out or null) to `openingEndMs`, "Saltar outro" from `endingStartMs`. Each a
   * finite number in 0..`durationMs` (0..86 400 000 without `durationMs`); the opening needs its end,
   * after its start; the ending not before the opening's end. A bad part is dropped, never the stream.
   * A person's hand correction wins over it; it wins over AniSkip. Ignored for a live channel.
   */
  skip?: { openingStartMs?: number; openingEndMs?: number; endingStartMs?: number };
  /**
   * apiVersion 11: instead of a playable `url`, hand this stream to an independently-installed app that declares it
   * can resolve `protocol` (Kino never interprets `protocol` or `ref` itself). `ref` is opaque, 1..2048 characters,
   * never logged in full. When `external` is present, `url` is ignored. See the External Source Resolver guide.
   */
  external?: {
    protocol: string;
    ref: string;
    /**
     * Android package of the one resolver app this stream wants. Overrides the manifest's `externalResolver.package`.
     * Kino asks only that app (the person still has to allow it) and never another one in its place; if it isn't
     * installed and the manifest doesn't name a download for it, the stream fails.
     */
    resolver?: string;
  };
  /**
   * Kino 0.9.66, optional and ADVISORY: what you know about the file itself. Kino shows and logs it and may use it as a
   * hint (for a cast), never for anything that could harm the person. Every field is optional; text is one line cut at 120
   * characters (`codec`/`container` 40, `language` 20), numbers are clamped, at most 16 tracks and 4 `notes`; an object with
   * nothing usable left is dropped, and a bad `media` never refuses the stream. Older Kino ignores it.
   */
  media?: KinoStreamMedia;
  /**
   * Kino 0.9.66, optional: a universal copy of THIS video, for a source that can make one on demand (an external resolver app
   * that converts): HLS, H.264 8-bit up to 1080p, stereo AAC, playable by any TV receiver. Checked exactly like `url`
   * (anything else, a non-HLS `mime` included, drops it and the rest still counts); ignored next to `drm`, request signing or
   * `external`. The phone's own player never uses it; Kino casts it when the title's own cast route needs a conversion or the
   * stream is likely not playable as it is. See the External Source Resolver guide.
   */
  portable?: { url: string; mime?: "application/x-mpegURL" | "application/vnd.apple.mpegurl" };
}

/**
 * apiVersion 13, capability "byteSource": a stream whose bytes the plugin itself serves, instead of a URL. Kino pulls them
 * by calling the plugin's `read` export (see `KinoPlugin.read`). `handle` is opaque to Kino (1..512 characters, the plugin
 * decides what it means); `size` is the total byte length; `mime` the media type (e.g. "video/mp4"). It casts to a
 * Chromecast or a DLNA TV (served from the phone over the LAN, every byte still from `read`) when `mime` is a video or audio
 * file type other than MPEG-TS; it is never downloaded (declaring "download" is pointless for such streams).
 */
interface KinoPluginByteStream {
  source: "plugin";
  handle: string;
  size: number;
  mime: string;
}

/**
 * apiVersion 13, capability "imageSource": a picture whose bytes your plugin serves, instead of a URL. Accepted wherever
 * an item's `poster` or `backdrop`, an episode's `still`, a series' (or `details`') `poster`/`backdrop` or a section hero's
 * `image` is read; anywhere else (a channel logo, a category's art, a `meta` answer, a layout image), and from a plugin
 * that does not declare "imageSource", it is ignored like a bad URL. `handle` is yours and opaque to Kino: 1 to 512
 * characters, no control characters (a malformed reference is simply no image, the item stays).
 *
 * When a card with such an image comes on screen, Kino calls your `image({ handle })` export ({@link KinoPlugin.image}),
 * at most one call at a time for your plugin, never while one of your byte streams is open or your `read` runs (it waits
 * for that to end, at most 20 s), and keeps the picture in its image cache: the same handle of the same installed version is asked once.
 * Make handles stable (the same picture, the same handle) and never put a secret in one: Kino stores it like a poster URL
 * wherever the title is saved (library, history), which sync to the person's other devices and go into backups. There it
 * shows the placeholder, and a saved row keeps it (Kino never rewrites it): a reference only loads on the device whose Kino
 * read it from your answer.
 *
 * @example
 * export async function home() {
 *   return [{ id: "new", title: "New", items: [
 *     { id: "v1", ref: "video:1", title: "Holiday", kind: "movie", poster: { source: "plugin", handle: "thumb:1" } },
 *   ] }];
 * }
 * export async function image({ handle }) {
 *   const bytes = kino.storage.get(handle);              // a base64 JPEG you saved when you indexed the video
 *   if (!bytes) throw kino.error("not_found", "no thumbnail");
 *   return { bytes, mime: "image/jpeg" };
 * }
 */
interface KinoImageRef {
  source: "plugin";
  handle: string;
}

/**
 * What `image({ handle })` answers (apiVersion 13, "imageSource"): the picture, base64-encoded (canonical: the standard
 * alphabet, padded, no whitespace), at most 262,144 bytes (256 KB) once decoded, and its type, one of "image/jpeg",
 * "image/png" or "image/webp", which the bytes must really be (their first bytes are checked). Anything else, a throw or
 * no answer within 10 s shows the card's placeholder, and Kino does not ask for that handle again for 5 minutes; two
 * timeouts in a row pause all your images for 5 minutes.
 */
interface KinoImageAnswer {
  bytes: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/** What a stream's source says about the media itself (`KinoStream.media`). */
interface KinoStreamMedia {
  /** The file's own name or a title for it. */
  title?: string;
  /** Bytes of the file being served (0..2^50). */
  sizeBytes?: number;
  /** The container as the source names it ("matroska,webm", "mp4"…). Display only: never given to the player. */
  container?: string;
  video?: {
    codec?: string;
    profile?: string;
    width?: number;
    height?: number;
    fps?: number;
    /** 0..16 */
    bitDepth?: number;
    hdr?: boolean;
  };
  /** The FILE's audio tracks, converted or not. */
  audio?: { codec?: string; channels?: number; language?: string; title?: string; default?: boolean }[];
  /** The FILE's subtitle tracks; `text` is true for the text formats (SubRip, ASS, WebVTT…) as opposed to bitmaps (PGS…). */
  subtitles?: { codec?: string; language?: string; title?: string; text?: boolean }[];
  /** The source re-encoded the file to make it playable: what it serves is not what the file holds. */
  converted?: boolean;
  /** Short plain remarks in the source's own words, at most 4. */
  notes?: string[];
}

/**
 * One of a Stream's `alternatives`: a URL (labelled from apiVersion 6), (apiVersion 6) a lazy `{ label, ref }`, or
 * (apiVersion 11) an external hand-off.
 */
type KinoStreamAlternative =
  | { url: string; mime?: string; headers?: Record<string, string>; label?: string }
  | { ref: string; label?: string }
  | { external: { protocol: string; ref: string; resolver?: string }; label?: string };

/** apiVersion 3, capability "channels": a section of the En vivo tab. */
interface KinoLiveCategory {
  id: string;
  title: string;
  /** ISO 3166 alpha-2, e.g. "CO". Informational. */
  country?: string;
  /**
   * What the row (or category, or list) is about, from Kino's closed vocabulary: "peliculas", "series", "anime",
   * "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento" or "otros". Kino groups Categorías
   * by it and filters En vivo by it across plugins. Optional: without it Kino guesses from the title; a value outside
   * the list is ignored. Kino versions before this field ignore it.
   */
  genre?: KinoGenre;
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. Every channel listed in it is 18+ too. */
  adult?: boolean;
}

/**
 * apiVersion 3: an M3U playlist Kino downloads itself (from a declared host only, never under
 * `liveStreamHosts: "any"`), with an optional XMLTV guide. Put it next to your categories in the
 * `liveCategories()` answer, or return it alone. At most 10 per answer. `refreshHours` is 1..168,
 * default 12. `hideGroups` are group titles not to show (case-insensitive), at most 50. With
 * `resolve: true` each entry plays through your `resolve(<entry url>)` instead of directly.
 */
interface KinoPlaylist {
  playlist: {
    url: string;
    format: "m3u";
    headers?: Record<string, string>;
    /**
     * Headers the PLAYER sends for every channel of the list: a `User-Agent` some channels only answer to, a
     * `Referer`. Filtered like a Stream's `headers` (at most 20). Kept apart from `headers` on purpose: those carry
     * the list's own credentials and go only to the list's host, never to the hosts the channels are on. A header an
     * M3U entry names itself (`#EXTVLCOPT:http-user-agent=...`) wins. Kino versions before this field ignore it.
     */
    streamHeaders?: Record<string, string>;
    /** The [genre](KinoLiveCategory) of every group this list produces; without it Kino guesses from each group's title. */
    genre?: KinoGenre;
    epg?: { url: string; format: "xmltv" };
    refreshHours?: number;
    hideGroups?: string[];
    resolve?: boolean;
  };
}

/**
 * apiVersion 10, capability "playlists": one of the person's own playlists on that plugin's service
 * (not an M3U/IPTV channel list — see {@link KinoPlaylist} for that, an unrelated, older concept).
 */
interface KinoHostedPlaylist {
  id: string;
  title: string;
  itemCount: number;
}

/**
 * One channel: give `ref` (resolved on play, exactly like a `live` item's) or `stream` (played as
 * is, checked like `resolve()`'s answer). With both, the stream plays and `ref` is the fallback.
 * An `id` starting with `~` is reserved for Kino and dropped.
 */
interface KinoLiveChannel {
  id: string;
  title: string;
  ref?: string;
  stream?: KinoStream;
  /**
   * In liveChannels, informational: the channel is listed under the category it was asked for. Not a valid id = empty.
   * In a liveSearch hit (apiVersion 6), the category it belongs to: one of your 18+ categories makes it 18+, a plain one
   * makes it plain. A hit with neither `categoryId` nor `adult` counts as 18+ when you have any 18+ category.
   */
  categoryId?: string;
  /** https image, like a poster. */
  logo?: string;
  /** 1..9999. */
  number?: number;
  /**
   * apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental).
   * Below apiVersion 6 it is dropped. On a liveSearch hit, `false` says it is plain (needed when your categories can't be
   * read and it carries no `categoryId`): mark every hit with `adult` or `categoryId`.
   */
  adult?: boolean;
}

interface KinoLiveChannelPage {
  items: KinoLiveChannel[];
  /** Opaque cursor for the next page; omit or null at the end. */
  next?: string | null;
}

/** One programme. `start`/`end` are epoch milliseconds. */
interface KinoGuideEntry {
  channelId: string;
  title: string;
  start: number;
  end: number;
  description?: string;
}

/** apiVersion 6, capability "migrate": one value Kino stored and can no longer open. */
type KinoMigrateInput =
  | { kind: "title"; ref: string }
  | { kind: "chapter"; ref: string; season: number | null; episode: number | null }
  | { kind: "live"; provider: string; code: string };

/**
 * Your answer: the same id/ref you would return from search() today. `ref` never starts with "plg1:".
 * "music" and "podcast" need apiVersion 8 (below it such an answer is no claim). They move in the shape your
 * plugin saves them in: with the "episodes" capability as an album or show, chapter by chapter like a series;
 * without it as a lone track, like a movie, and only when one row is saved.
 */
type KinoMigrateAnswer =
  | { kind: "movie" | "series" | "music" | "podcast"; id: string; ref: string }
  | { kind: "episode"; ref: string; season?: number; number: number }
  | { kind: "live"; code: string };

/** apiVersion 6, with `"section": { "label" }` in the manifest: your own section (TV sidebar, chip atop Inicio on the phone). Kino 0.9.55: an optional `"labelEn"` (same 20-character limit) is the entry's text when the app is in English; `label` stays the Spanish default and the fallback. */
interface KinoSectionAnswer {
  /** At most 8; each `id` matches the item id pattern, each `label` at most 24 characters. */
  tabs?: { id: string; label: string }[];
  /** The tab this answer is for; an unknown or missing one reads as the first tab. */
  tab?: string;
  /** A banner above the rows: `title` as an item title, `text` at most 300 characters, `image` http or https (the Images rule), or with "imageSource" (apiVersion 13) a {@link KinoImageRef}. */
  hero?: { title: string; image?: string | KinoImageRef; text?: string };
  /** The same shape and limits as `home`. */
  rows: KinoRow[];
}

/** apiVersion 6, optional, needs the `browse` capability: a tile of your Categorías group; it opens `browse(ref, null)`. */
interface KinoCategory {
  /** The item id pattern. */
  id: string;
  /** At most 40 characters. */
  title: string;
  /** http or https image (the Images rule), same rules as a poster. */
  art?: string;
  /** At most 4096 characters. */
  ref: string;
  /** apiVersion 6: true = an 18+ entry, shown only while the person's 18+ code is unlocked on that device (Ajustes ▸ Control parental). Below apiVersion 6 it is dropped. */
  adult?: boolean;
}

// ---------- apiVersion 9 (Kino 0.9.55): the player panel ----------
// A button in the player, shown only while YOUR content plays, opens a panel you describe with `panel(context)`. Kino
// validates every answer; an invalid element is dropped (and logged), a panel that is not an object shows nothing. The
// kit runs the same validation: node sdk/run.mjs <plugin dir> panel|panelAction|playerEvent. Layout limits: at most 40
// top-level elements, 120 nodes in all, 4 levels deep, 6 children per row.

/** What the player knows about the title playing when `panel`, `panelAction` or `playerEvent` is called (exactly these keys; an absent optional is left out). */
interface KinoPanelContext {
  kind: "movie" | "episode" | "live";
  /** The ref of the title that plays, exactly as you gave it. */
  ref: string;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  ids: { tmdb?: number; imdb?: string; tvdb?: number; mal?: number; anilist?: number; kitsu?: number };
  /** The copy playing now. */
  playing: { label?: string; lang?: string; quality?: string; server?: string };
  positionMs: number;
  /** Absent for live or while the player does not know it. */
  durationMs?: number;
  paused: boolean;
  /** The back/forward step in effect, ms. */
  seekStepMs: number;
  /** Read-only playback stats; only what the player knows. */
  stats: {
    width?: number; height?: number; videoCodec?: string; audioCodec?: string; bitrateKbps?: number; bufferedMs?: number;
    droppedFrames?: number; network?: "wifi" | "ethernet" | "cellular" | "other"; stallsThisSession?: number;
  };
  device: "tv" | "phone";
  /** The app's language, "es-CO" or "en-US" style. */
  lang: string;
  /** The tab the person asked for (a tab press calls `panel` again with it). */
  tab?: string;
  /** What you saved with `values`/`save`: per title (`video`) and for the whole plugin (`plugin`). */
  values: { video: Record<string, KinoPanelValue>; plugin: Record<string, KinoPanelValue> };
  /** The player's own properties in effect: the step, the speed, the resize mode and your `autoNext` when you set one. */
  player: { seekStepMs: number; speed?: number; resize?: KinoPlayerResize; autoNext?: { enabled: boolean; countdownS: number; nextRef?: string } };
  /**
   * Kino 0.9.64 (additive): what this Kino draws beyond apiVersion 9's panel; `"loading"`: the `loading` element. Absent on
   * an older Kino, which drops that element: check it before you answer with one.
   */
  features?: ("loading" | "screen")[];
  /**
   * apiVersion 14 (Task 8k), only in a tab YOUR plugin contributes to another plugin's title (`"panel": { "contributes": true }`
   * and the `playerPanelTab` capability): `true`. Then `ref` is an opaque id (`"foreign:"` and 32 hex characters, keyed by the
   * install: the same title gives you the same id on that device, never the other plugin's ref; opaque, not secret), `playing`
   * is empty, `player.autoNext` is left out, and `values` are your own. `title`, `year`, `ids`, `season`, `episode` and the
   * position are given. Only a plugin's title (never an 18+ one, nor M3U lists or the person's own channels).
   */
  foreign?: true;
  /**
   * apiVersion 14 (Task 8k), with `foreign`: the plugin that provides the stream playing, its public id and name (so a tab can
   * tell whether two people watch through the SAME source). Never its ref.
   */
  source?: { pluginId: string; name: string };
}

type KinoPanelValue = string | boolean | number | null;
type KinoPlayerResize = "fit" | "fill" | "zoom" | "4:3" | "16:9" | "21:9";
/** `scope` of an input: `plugin` (default) is one value for all your titles, `video` one per title. */
type KinoPanelScope = "video" | "plugin";

/**
 * Rows, columns and cards around leaves (the one layout model of the player panel and of `settingsLayout`). `hidden: true`
 * keeps a node out of sight, `enabled: false` greys it out and takes it out of focus (a settings layout ignores both).
 * Limits: depth 4, a row keeps 6 children, `col.weight` 1 to 12 (else 1), 120 nodes in all, card `title` 60 characters.
 */
type KinoLayoutNode<Leaf> =
  | { type: "row"; children: KinoLayoutNode<Leaf>[]; gap?: "none" | "small" | "medium" | "large"; align?: "start" | "center" | "end" | "stretch"; stackOnNarrow?: boolean; enabled?: boolean; hidden?: boolean }
  | { type: "col"; children: KinoLayoutNode<Leaf>[]; weight?: number; gap?: "none" | "small" | "medium" | "large"; align?: "start" | "center" | "end" | "stretch"; enabled?: boolean; hidden?: boolean }
  | { type: "card"; title?: string; titleEn?: string; children: KinoLayoutNode<Leaf>[]; style?: "plain" | "outlined" | "filled"; enabled?: boolean; hidden?: boolean }
  | (Leaf & { enabled?: boolean; hidden?: boolean });

/**
 * A leaf of a panel. `key` (1 to 128 of A-Z a-z 0-9 . _ ~ -) names what holds a value or can be pressed and is unique
 * across the whole panel; a label is 1 to 40 characters. Every text has an optional `...En` twin shown when the app is in English.
 */
type KinoPanelElement =
  | { type: "section"; title: string; titleEn?: string; text?: string; textEn?: string }
  | { type: "text"; text: string; textEn?: string }
  /** At most 200 characters. */
  | { type: "status"; text: string; textEn?: string }
  /** https only, on a public host; `alt` up to 200 characters. */
  | { type: "image"; url: string; aspect?: "16:9" | "2:3" | "1:1" | "banner"; alt?: string; altEn?: string }
  /** `confirm` (up to 160 characters) asks first. Pressing calls `panelAction` with trigger "press". */
  | { type: "button"; key: string; label: string; labelEn?: string; confirm?: string; confirmEn?: string;
      /** Task 7g: the press opens this plugin's own screen over the player, no panelAction call; `pause` pauses the video. */
      go?: { screen: KinoScreenOpen }; pause?: boolean }
  /** `autoSave: true` saves each change by itself (trigger "change"). `hint` up to 80 characters. */
  | { type: "toggle"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; hint?: string; hintEn?: string; autoSave?: boolean }
  /** 1 to 20 options, `value` and `label` 1 to 40 characters, values distinct. */
  | { type: "select"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; options: { value: string; label: string; labelEn?: string }[]; hint?: string; hintEn?: string; autoSave?: boolean }
  /** `placeholder` up to 40 characters; Enter calls `panelAction` with trigger "submit". */
  | { type: "text-input"; key: string; label: string; labelEn?: string; scope?: KinoPanelScope; hint?: string; hintEn?: string; placeholder?: string; placeholderEn?: string }
  /** https, up to 512 characters, on a public host with a dot, or a public IPv4 address (never the device or the home network: no single-label or local name, private address or IPv6 literal). */
  | { type: "qr"; url: string; label?: string; labelEn?: string }
  /**
   * Kino 0.9.64 (additive, any apiVersion): a spinner, with `text` beside it (else Kino's «Cargando…»). Answer at once
   * with the tab's shell and this element, and set `refreshMs` so Kino asks again for the finished tab. Send it only when
   * `context.features` includes "loading": an older Kino drops it as an unknown element (answer a `status` line there).
   */
  | { type: "loading"; text?: string; textEn?: string }
  /** The series' episodes, the current one highlighted; choosing one plays it. */
  | { type: "episodes"; ref: string }
  /** Not in this Kino: dropped ("needs a newer Kino"). Reserved for a later version. */
  | { type: "ai"; [field: string]: unknown }
  /** Not in this Kino: dropped ("needs a newer Kino"). Reserved for a later version. */
  | { type: "chat"; [field: string]: unknown };

/** What `panel(context)` returns. A tab press calls it again with `context.tab`; `refreshMs` calls it again by itself. */
interface KinoPanel {
  /** Up to 60 characters. */
  title?: string;
  titleEn?: string;
  /**
   * Accepted for compatibility; both values look the same: the panel is a drawer over the whole player
   * (from the right on TV and a phone held sideways, from the bottom on a phone held upright). The video keeps playing.
   */
  presentation?: "modal" | "panel";
  /** `#RRGGBB`; kept only when it passes the same rules as the manifest theme's `accent`. */
  accent?: string;
  /** Asks Kino to call `panel` again every so often: 2000 to 60000 ms (clamped). */
  refreshMs?: number;
  /** At most 6: `id` as a key, `label` up to 24 characters. */
  tabs?: { id: string; label: string; labelEn?: string; badge?: KinoScreenBadge }[];
  /** The tab shown; the first one when absent or unknown. */
  tab?: string;
  elements: KinoLayoutNode<KinoPanelElement>[];
  /**
   * Task 8j (apiVersion 14): a player action of the result itself, e.g. a `refreshMs` tick that keeps the video in step with
   * something. It is not the person's press, so it counts only with the `playerControl` capability (see `KinoPlayerAction`).
   */
  player?: KinoPlayerAction;
}

/** Why `panelAction` is called: a button pressed, an input changed or submitted. "tab" and "open" are reserved: this Kino never sends them. */
interface KinoPanelEvent {
  /** The element's key. */
  key: string;
  trigger: "press" | "change" | "submit" | "tab" | "open";
  /** Every input's value on screen now (saved or not yet). */
  values: Record<string, KinoPanelValue>;
  /** The new value, for "change" and "submit". */
  value?: KinoPanelValue;
}

/**
 * What the plugin asks the player to do (every field optional). Bounds below are applied by Kino, which clamps or drops what is
 * outside them.
 *
 * A plugin that plays nothing (a player-panel tab, say) may declare `playerControl` only beside a `panel` (its own, or
 * `"contributes": true` with `playerPanelTab`); without one it is refused (contract.json `capabilities.playerControlNeedsPanelMessage`).
 *
 * Who may ask what (contract.json `kinoPlayerControl`, Task 8j): the plugin whose title plays may use every field after the
 * person's press, change or submit in its panel and in a `playerEvent` answer, except `pause`, which needs a press; a panel
 * result's own `player` (`KinoPanel.player`, a `refreshMs` tick) never counts. A tab contributed to another plugin's title may
 * only `seekToMs`, after a press in it. With the `playerControl` capability (approved by the person on a red line, revocable in
 * Ajustes: never assume it) every origin counts, and a contributed tab may also `pause` and set the `speed` (never stored: it
 * ends with the title, and the person's own speed wins). Such an action is announced to the person with a short notice naming
 * your plugin ("Party Chat: pausado"), which you cannot word or hide; it is dropped while Kino is not in front (the app in the
 * background, a Kino page over the player), one of Kino's dialogs is up or the person is seeking, on live only `pause` counts,
 * at most 30 a minute and one a second. One seek or pause a second, always. A `pause` is dropped while the video is cast
 * (Chromecast or DLNA) and when the video is already in that state (check `context.paused`). A `panel` inside an answer carries
 * no `player` of its own.
 */
interface KinoPlayerAction {
  /** Ms from the start, clamped to 0..duration; ignored on live. At most one seek or pause per second. */
  seekToMs?: number;
  /** Task 8j: `true` pauses the video, `false` resumes it (anything else is dropped). Never stored; at most one seek or pause per second. */
  pause?: boolean;
  /** The back/forward step: 5000 to 120000, whole seconds. */
  seekStepMs?: number;
  /** One of 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2. */
  speed?: number;
  resize?: KinoPlayerResize;
  /** The same block as a Stream's `skip`: the skip-intro/outro button. */
  skip?: { openingStartMs?: number; openingEndMs?: number; endingStartMs?: number };
  /** At most 30 dots on the progress bar; `label` up to 24 characters; selecting one seeks there. */
  markers?: { atMs: number; label: string }[];
  /** The end-of-episode countdown: `countdownS` 0 to 30, required when `enabled` (left out it is 0 when disabled). */
  autoNext?: { enabled: boolean; countdownS?: number; nextRef?: string };
}

/** What `panelAction` (and, for `player`, `message` and `panel`, `playerEvent`) may return. `null` is "nothing to do". */
interface KinoPanelAnswer {
  /** A whole new panel (Task 8i: either format, `KinoPanelScreenResult` too; in a `playerEvent` answer it shows in the open panel). */
  panel?: KinoPanel | KinoPanelScreenResult;
  /** Replaces single elements in place, by key (at most 40 entries); each is one node, validated like any element. */
  patch?: Record<string, KinoLayoutNode<KinoPanelElement>>;
  /** Values to show now (at most 120 keys; strings up to 500 characters). */
  values?: Record<string, KinoPanelValue>;
  /** Keys of `values` (or on-screen inputs) to keep: at most 50. */
  save?: string[];
  /** The key to move focus to. */
  focus?: string;
  /** A short toast for the person (up to 160 characters); shown only when it passes the rules a `userMessage` does. */
  message?: string;
  player?: KinoPlayerAction;
  /**
   * Task 7g: opens this plugin's own screen over the player (the panel closes). Task 8m: or `titleByIds`, Kino's own title page
   * by ids ([KinoScreenTitleByIds]), honoured only in the answer to the person's press or submit (a change's and a
   * `playerEvent`'s are dropped, logged). Task 8s: or `url`, a link Kino asks the person about first ([KinoScreenUrl]), under
   * the same press-only rule. Task 8x: or `copy` ([KinoScreenCopy]), the same rule, the panel stays open. No other shape.
   */
  go?: { screen: KinoScreenOpen } | { titleByIds: KinoScreenTitleByIds } | { url: KinoScreenUrl } | { copy: KinoScreenCopy };
  /** With `go`: pause the video under the screen. Default false: it keeps playing. */
  pause?: boolean;
}

/** What `playerEvent` is told. `failed` carries `kind`; `copyChanged` carries `automatic`, `label` and, after an automatic change, the last copy's failure `kind`. */
interface KinoPlayerEvent {
  type: "started" | "paused" | "resumed" | "ended" | "failed" | "copyChanged";
  kind?: string;
  label?: string;
  automatic?: boolean;
}

/**
 * One of Kino's icons by name (Material Symbols, outlined; tinted by the colour role around it). The first sixteen since
 * apiVersion 9; the rest (Task 8v, `refresh` the circular arrow among them) from apiVersion 14: below it such a name is an
 * unknown one (a panel button draws `tune`). The screen surface (apiVersion 14) knows every name. The User interface guide
 * lists what each one means.
 */
type KinoIconName =
  | "info" | "tune" | "settings" | "star" | "bolt" | "language" | "subtitles" | "list" | "magic" | "heart" | "movie"
  | "tv" | "sports" | "music" | "bookmark" | "help"
  // apiVersion 14:
  | "refresh" | "sync" | "add" | "remove" | "delete" | "edit" | "search" | "close" | "check" | "share" | "play"
  | "pause" | "download" | "upload" | "link" | "open_in_new" | "home" | "person" | "lock" | "notifications"
  | "warning" | "error" | "visibility" | "copy" | "arrow_back" | "arrow_forward" | "expand_more" | "expand_less"
  | "more_vert" | "filter_list" | "calendar" | "schedule" | "send" | "mood";

/**
 * The manifest's `panel` (apiVersion 9): the player's button. `label` 1 to 24 characters (`labelEn` the English one),
 * and `icon` (a [KinoIconName]; another name, or a name of the larger set below apiVersion 14, draws tune) or
 * `iconFile`, a relative .png of exactly 96x96 px with an alpha channel, at most 24 KB (only its alpha is drawn), never both. Declaring it makes `panel` required.
 */
interface KinoManifestPanel {
  label: string; labelEn?: string; icon?: KinoIconName; iconFile?: string;
  /**
   * apiVersion 14 (Task 8k): `true` adds a TAB to the player panel of ANY plugin's title (never an 18+ one), after Kino's own
   * and the playing plugin's, in the person's order (Ajustes, «Paneles del reproductor»), at most 6 tabs in all. Needs the
   * `playerPanelTab` capability (and it needs this), which the person approves with a red line (your tab SEES what they watch
   * while it is open) and can hide again («Mostrar en el reproductor»). `label` may then be left out (your plugin's name stands
   * in); the tab is always labelled with your plugin's name and icon. Your `panel(context)` is the same contract, with
   * `context.foreign` and `context.source`; it is called only while your tab is the selected one and the drawer is open, and
   * `playerEvent` reaches you only then too (it stops when your tab or the drawer closes). Your tab reads your plugin's name
   * and icon (never Kino's `info` icon; a name like "Kino" is shown as "Plugin «<name>»"). Your `player` actions count only in
   * the answer to a `panelAction` after a press in your tab, and only `seekToMs` (with the `playerControl` capability, Task 8j:
   * from any origin, and `pause` and `speed` too); `go.title` / `go.play` are dropped.
   */
  contributes?: boolean;
  /**
   * apiVersion 14 (Task 11), only with `contributes: true`: which content your tab joins. "title": a plugin's title (the rule
   * above); "live": an En vivo channel, after Kino's own «General» tab, with `context.kind === "live"` (`KinoLivePanelContext`:
   * the channel, never a position) and `go.liveChannel` to tune. Default `["title"]`; a non-empty list of these two (an
   * unknown value or an empty list refuses the install).
   */
  kinds?: ("title" | "live")[];
}

/**
 * The manifest's `settingsLayout` (apiVersion 9): where the settings of the form go. A list of rows, columns and cards
 * around `{ setting: "<key>" }`, `{ type: "text", text }` and `{ type: "image", url }` leaves. Settings left out are
 * added at the end in manifest order; an unknown or repeated key is ignored by Kino (and refused by the kit's validate).
 */
type KinoSettingsLayoutLeaf = { setting: string } | { type: "text"; text: string; textEn?: string } | { type: "image"; url: string; aspect?: "16:9" | "2:3" | "1:1" | "banner" };
type KinoSettingsLayout = KinoLayoutNode<KinoSettingsLayoutLeaf>[];

/**
 * The manifest's `screen` (apiVersion 14, capability `"screen"`): the menu entry of the plugin's full-screen canvas.
 * `label` 1 to 20 characters (`labelEn` the English one), `icon` (a [KinoIconName]) or `iconFile` (a 96x96 .png, never both).
 * `menuOpens` says what the entry opens: `"section"` (the rows of cards, needs the `section` field), `"screen"` (the canvas) or
 * `"both"` (two entries, needs `section`); default `"section"` when `section` is declared, else `"screen"`. `adult: true` shows
 * the entry only while the 18+ code is unlocked. The capability may stand alone and needs the exports `screen` and `screenEvent`.
 * `settingsIn` says where the plugin's settings show: `"settings"` (Kino's settings list), `"screen"` (only the plugin's own
 * screen: Kino hides the settings form in its settings list while the screen can be opened; refused with `menuOpens: "section"`)
 * or `"both"` (the default). Either way they are the same, real settings (`kino.config`). `every`: timers that run whenever
 * the screen is open, as a tree root's `every` (KinoScreenTimer); a bad one is dropped and logged, never refused.
 * `opensFrom` (Task 7g) says where the screen opens from: `"menu"` (the icon: TV sidebar, phone Inicio strip) and/or
 * `"settings"` (a button at the top of the plugin's own settings page); default `["menu"]`, never empty. Without `"menu"` there
 * is no icon and no entry: `icon`, `iconFile` and `menuOpens` are not needed and are ignored (a `section` keeps its entry as
 * today). `settingsIn: "screen"` needs some way in: `menuOpens` `"screen"`/`"both"` or `"settings"` in `opensFrom`; its settings
 * page then shows only the button (and Kino's own switches) while the screen can open, and the form whenever it cannot.
 * `settingsButton` names that button (`label`, `labelEn`, each 1 to 40 characters once control characters are removed);
 * default Kino's «Abrir pantalla» / "Open screen".
 */
interface KinoManifestScreen {
  label: string; labelEn?: string; icon?: KinoIconName; iconFile?: string; menuOpens?: "section" | "screen" | "both"; adult?: boolean;
  settingsIn?: "settings" | "screen" | "both"; every?: KinoScreenTimer | KinoScreenTimer[];
  opensFrom?: ("menu" | "settings")[]; settingsButton?: { label?: string; labelEn?: string };
  /**
   * Task 8: what the screen takes the place of. `["categories"]`: while the screen can open, every place Kino opens THIS plugin's
   * categories (a tile of its group in Kino's Categorías, a `go: { categories: true }` from its other routes or from the player
   * panel's screen) opens the screen at the route `categories` with `args: { from: "categories" | "screen" | "panel", category? }`
   * (`category`: the tile's `ref`, when a tile was pressed; `from: "panel"` when its screen over the player asks, which then
   * starts again in place there). With screens switched off or the screen hidden (18+ locked, plugin off), Kino's own
   * Categorías shows instead. When its FIRST opening fails (`screen()` throws, times out, an invalid tree), Kino shows the
   * pressed tile's own "Ver más" list instead (no tile: Kino's Categorías), logs it, and the plugin's tiles skip the screen
   * until the app restarts; a failure later, while it is in use, keeps the screen's error state and its «Reintentar». A
   * `go: { categories: true }` sent FROM that `categories` route
   * opens Kino's own screen (never itself again). Needs a catalog to fall back on: the `browse` capability and the
   * `categories` export (refused at install otherwise). Build it from `titleRail`, `titleGrid`, `heroCard`, `TabBar`, `Chips` and
   * `go` (`browse` a category, `title`, `search`).
   */
  replaces?: "categories"[];
}

/**
 * The manifest's `enhancements` (read from the Kino of apiVersion 14; contract.json `manifest.enhancements`): features of a
 * newer apiVersion offered WITHOUT raising the plugin's own `apiVersion`, so a Kino that does not know them (it ignores this
 * key) still installs and runs the plugin as before. Keyed by the apiVersion that brought the feature, e.g.
 * `"enhancements": { "14": { "capabilities": ["screen", "library"], "screen": { "label": "Inicio" } } }` in a plugin that keeps
 * `"apiVersion": 8`. A Kino that knows a key merges its block over the manifest, keys in numeric order: `capabilities` are
 * ADDED (only `"screen"`, `"library"`, `"playerPanelTab"`, `"playerControl"`, `"room"`, `"schedule"`, `"shared"` and `"ai"`), `screen`,
 * `settings` (the whole list), `panel` and `jobs` REPLACE the manifest's (`"playerPanelTab"` and a `panel` with `"contributes": true`
 * come together in one block, and so do `"schedule"` and its `jobs`; Task 18: a top-level `jobs` below apiVersion 14 is never
 * read); then everything is
 * checked at that apiVersion with the very same rules as the plain fields. A plugin is NEVER refused because of an
 * enhancement: a block is dropped and logged, and the plugin runs as its own manifest says, when it fails those rules (a bad
 * screen, a capability that can't be added, any other field), when its key is at or below the plugin's own `apiVersion`
 * (declare a feature once), when its `settings` change the type of a setting the manifest declares (keep the list a superset
 * of the manifest's: values sync by key with devices on an older Kino), when its `screen.replaces` names Categorías the
 * plugin's own apiVersion lacks (below 6), and when the script lacks an export the block newly needs (`screen` and
 * `screenEvent`, `settingsStatus` or `action` for such settings; checked at install and at every start). A key above the
 * Kino's apiVersion is ignored. The plugin's `apiVersion` never moves, so everything else keeps its old behaviour; the JS
 * stays one file and its `screen`/`screenEvent` exports are simply never called by an older Kino. The added capabilities'
 * consent lines (the red ones of library, playerPanelTab, playerControl, room, schedule and ai; shared's plain one) are asked at
 * install and at the update that adds them, like any other, never approved by Kino on its own; their features follow the block
 * (featureApiVersion): jobs run, `kino.shared` and `kino.ai` exist, only on a Kino that read it. `kino.library`
 * exists on every Kino of apiVersion 14, but until the person approves the line its calls reject with `permission_denied`:
 * a plugin installed on an older Kino, whose person then updates Kino, is asked only with its NEXT version. So
 * `typeof kino.library === "object"` is not enough: catch the refusal and work without it. `node sdk/validate.mjs` reports
 * every block the app would drop as a problem.
 */
interface KinoManifestEnhancements {
  [apiVersion: string]: { capabilities?: ("screen" | "library" | "playerPanelTab" | "playerControl" | "room" | "schedule" | "shared" | "ai")[]; screen?: KinoManifestScreen; settings?: unknown[]; panel?: KinoManifestPanel; jobs?: unknown[] };
}

/**
 * A screen's timer: Kino sends `screenEvent { name: event }` every `ms` milliseconds (at least 1000: a shorter one is raised,
 * at most a day) while the screen is open, shown and the app in front (a pop-up does not stop it; the background does). At
 * most 3 timers per screen (the manifest's and the root's together). The next wait starts once a tick and the render it
 * asked for are done (twice what that took when longer); a tick never runs beside or ahead of the person's events. A timer
 * whose ticks fail or time out 3 times in a row is switched off for that opening (logged). Timer calls never count toward
 * the plugin's "No responde". A tick's answer keeps only `state`, `toast`, `close` and `config` (its pop-ups, `focus`, `go`
 * and `route` are dropped), and its `config` writes each setting at most once a minute.
 */
interface KinoScreenTimer { ms: number; event: string }

/** What a banner or a toast is about: Kino paints it with its own colour and icon for that role. */
type KinoScreenRole = "info" | "warning" | "error" | "success";

/**
 * Load more on a `ListView`, `titleRail` or `titleGrid`: `onEndReached` is sent once when the person reaches the last item, and
 * again only after the plugin answered and the tree it asked for is drawn, and then only once the list grew or its
 * `loadingMore` went from true to false (a load that finished with nothing new; turning it on never asks again). Never more
 * than once a second per list (an end reached within that second asks by itself once it is over), never while the screen
 * is hidden or the app in the background (it asks once the screen shows again), never for an empty list, never at 500
 * items (the cap stays, and 60 for a rail or grid drawn inside a scroll). A load-more's answer never changes the route:
 * its `route` is dropped (logged). Set `loadingMore: true` to show Kino's spinner after the items and `done: true` to stop
 * asking.
 */
/** Screen asks: the `value` of a `QrImage`'s `onExpire` event. */
interface KinoScreenQrExpire {
  /** `renew`: `renewBeforeMs` before the end; `expired`: the end came (no lead time, or the screen was hidden past it). */
  phase: "renew" | "expired";
  /** What was left when Kino sent it (0 once expired). */
  remainingMs: number;
}

/** Screen asks: the `value` of a `settings` node's `onSaved` event. Keys only: a value, a password's least of all, never. */
interface KinoScreenSettingsOutcome {
  kind: "save" | "action";
  ok: boolean;
  /** The settings that changed (sorted): edited and saved, or cleared or set by the action. */
  keys: string[];
  /** The action button's key, for `kind: "action"`. */
  action?: string;
  /** Why not `ok`: your validateSettings refused, it could not check, Kino's store refused, or the action failed. */
  reason?: "rejected" | "checkFailed" | "refused" | "failed";
}

interface KinoScreenPaging { onEndReached?: { event: string; arg?: string }; loadingMore?: boolean; done?: boolean }

/** A device Kino draws a screen on (`ctx.device`, a node's `devices`). */
type KinoScreenDevice = "phone" | "tv" | "desktop";
/** A width class (Material window size classes: compact < 600 dp, medium 600-839, expanded >= 840); a node's `sizes`. */
type KinoScreenSizeClass = "compact" | "medium" | "expanded";
/**
 * A style or layout property: a plain value or a per-size map. A class missing from the map takes the next smaller one
 * present, else Kino's default; each class's value is checked like a plain one. Kino resolves them before drawing.
 */
type KinoScreenResponsive<T> = T | { compact?: T; medium?: T; expanded?: T };
/** The spacing scale (`padding`, `margin`, `gap`); a value off it is dropped and logged. */
type KinoScreenSpacing = 0 | 4 | 8 | 12 | 16 | 24 | 32 | 48;
/** The size scale (`width`, `height`, `minHeight`), in the same units as the spacing. */
type KinoScreenSize = 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 120 | 160 | 200 | 240 | 320 | 400 | 480 | 560 | 640;
/** Every side, or some of them (`x` = start and end, `y` = top and bottom; `start`/`end` follow the reading direction). */
type KinoScreenEdges = KinoScreenSpacing | { x?: KinoScreenSpacing; y?: KinoScreenSpacing; top?: KinoScreenSpacing; end?: KinoScreenSpacing; bottom?: KinoScreenSpacing; start?: KinoScreenSpacing };
/**
 * Colors only by role, painted with Kino's palette (never a hex value). Task 15: `primaryContainer` (the surface tinted with the
 * primary; a manifest `theme` tints it as it tints `primary`) and `surfaceVariant` (Kino's raised surface): on a box they are
 * its fill and its text and icons take the matching on-colour; on a `Text` or an `Icon` the colour, nudged to read.
 */
type KinoScreenColorRole = "primary" | "secondary" | "surface" | "muted" | "warning" | "error" | "onPrimary" | "primaryContainer" | "surfaceVariant";
/** A radius token. */
type KinoScreenRadius = "none" | "small" | "medium" | "large" | "full";
/**
 * Task 15: `borderRadius` per corner: each a token, an omitted corner `medium`; `start` and `end` follow the reading direction.
 * Fills, clips, outlines and the TV's focus ring follow it.
 */
type KinoScreenCorners = { topStart?: KinoScreenRadius; topEnd?: KinoScreenRadius; bottomStart?: KinoScreenRadius; bottomEnd?: KinoScreenRadius };
/**
 * Task 15: the shared `badge` (the `Badge` node's value): `"dot"`, or a short count or word (at most 12 characters, cut beyond)
 * with an optional colour role (Kino's primary by default). Drawn on the node's top end corner (beside a tab's label); a screen
 * reader reads it after the node's name. Set it again on each render.
 */
type KinoScreenBadge = "dot" | { text: string; textEn?: string; color?: KinoScreenColorRole };
/** The style every node takes; each property may be a per-size map. */
interface KinoScreenStyle {
  padding?: KinoScreenResponsive<KinoScreenEdges>; margin?: KinoScreenResponsive<KinoScreenEdges>; gap?: KinoScreenResponsive<KinoScreenSpacing>;
  borderRadius?: KinoScreenResponsive<KinoScreenRadius | KinoScreenCorners>;
  width?: KinoScreenResponsive<KinoScreenSize>; height?: KinoScreenResponsive<KinoScreenSize>; minHeight?: KinoScreenResponsive<KinoScreenSize>;
  /** Take the parent's whole width. */
  fill?: KinoScreenResponsive<boolean>;
  /** Share of a `Row` or `Column`, 1..12 (Flutter's `Expanded(flex:)`). */
  flex?: KinoScreenResponsive<number>;
  /** Across the main axis (a `Row`'s height, a `Column`'s width). */
  crossAxisAlignment?: KinoScreenResponsive<"start" | "center" | "end" | "stretch">;
  /** Along the main axis. */
  mainAxisAlignment?: KinoScreenResponsive<"start" | "center" | "end" | "spaceBetween" | "spaceAround">;
  color?: KinoScreenResponsive<KinoScreenColorRole>;
  /**
   * In a `Row` with `wrap: true` (the twelve-column layout, Bootstrap's grid), how many of the line's 12 columns this child
   * takes: 1..12, or `"auto"` (the autos of a line share what the fixed spans leave, equally). A child without one is `auto`.
   * Above 12 it is 12 (logged); anything else is dropped (logged). Only on a child of a row that wraps (in some size class):
   * anywhere else it is ignored and logged. Per size, like `col-md-6`:
   * `span: { compact: 12, medium: 6, expanded: 4 }`.
   */
  span?: KinoScreenResponsive<number | "auto">;
  /**
   * In a wrapping row, the empty columns before this child (0..11; above 11 it is 11, logged), never past what its span
   * leaves (lowered, logged). Per size as `span`.
   */
  offset?: KinoScreenResponsive<number>;
  /**
   * Task 15: at most this share of the width the parent offers, 0.25 to 1 in steps of 0.05 (off the scale: dropped, logged);
   * the node still wraps its content, so it is a maximum. With `fill: true` it takes exactly that share. Where it sits is the
   * parent's `crossAxisAlignment` (a chat's bubbles: `0.75`, their column aligned `end` or `start`).
   */
  maxWidthFraction?: KinoScreenResponsive<number>;
  /**
   * Task 17: where this child of a `Row` or `Column` (a `Card`, a `Form`, a scroll) sits across it, over the parent's
   * `crossAxisAlignment`; `stretch` in a row draws as `start`. Elsewhere ignored, logged.
   */
  alignSelf?: KinoScreenResponsive<"start" | "center" | "end" | "stretch">;
  /** Task 17: the paragraph of a `Text`, a button's label, `Chips`, a `TextField` or a `ListTile`; elsewhere ignored, logged. */
  textAlign?: KinoScreenResponsive<"start" | "center" | "end" | "justify">;
  /**
   * Task 17: an outline on a box (`Column`, `Row`, `Stack`, `Card`, a scroll, `GridView`, `Form`, `ListTile`, `PageView`): `width`
   * 0 to 8 dp (default 1, clamped), `color` a role (default Kino's outline); it follows `borderRadius`.
   */
  border?: KinoScreenResponsive<{ width?: number; color?: KinoScreenColorRole }>;
  /** Task 17: Kino's shadow (a card's tonal lift too) on a `Card` or a `Stack`, 0 to 24 (clamped). */
  elevation?: KinoScreenResponsive<number>;
  /** Task 17: a box's fill (over `color`); its text and icons read in the role's on-colour. */
  background?: KinoScreenResponsive<KinoScreenColorRole>;
  /** Task 17: size limits beside `minHeight`; a minimum above its maximum drops the maximum, logged. */
  minWidth?: KinoScreenResponsive<KinoScreenSize>; maxWidth?: KinoScreenResponsive<KinoScreenSize>; maxHeight?: KinoScreenResponsive<KinoScreenSize>;
  /**
   * Task 17: Flutter's `Positioned`, on a child of a `Stack` only: each side or size in dp (0 to 1280, clamped) or a share of
   * the stack written `"25%"`. With `left` and `right` (or `top` and `bottom`) the size between them; a `width` given too is
   * ignored, logged. Kept inside the stack (clipped, never pressed outside it); drawn and focused in child order.
   */
  positioned?: KinoScreenResponsive<{ top?: number | string; left?: number | string; right?: number | string; bottom?: number | string; width?: number | string; height?: number | string }>;
  /** Task 17: 0 to 1 (clamped); below 0.38 the node takes no press and no focus. */
  opacity?: KinoScreenResponsive<number>;
  /**
   * Task 17: on a box or a positioned child, changes of size, opacity, fill, place and visibility between renders glide:
   * `duration` 100 to 600 ms (default 250, clamped), `curve` `standard` (default), `ease` or `decelerate`. Off when the device
   * turns animations off; never delays a press or focus; at most 24 animating nodes a screen (the rest drop it, logged).
   */
  animate?: KinoScreenResponsive<{ duration?: number; curve?: "standard" | "ease" | "decelerate" }>;
}

/** The kind of a `go.title` / `go.play` ref: what this plugin's `home`/`search`/`browse` said it was. */
type KinoScreenKind = "movie" | "series" | "episode" | "live" | "music" | "podcast";
/**
 * The title a `go.title` / `go.play` opens (Task 8), only ever this plugin's own: `ref` and `kind` as its lists gave them. A
 * title on the canvas (a `titleCard`, `titleRail`, `titleGrid` item) is opened with that very item, so the page, "Continuar
 * viendo", the saved lists and the progress know it as Home does: pass its `id` when two items share a `ref`. A title that is
 * NOT on the canvas needs its `id` (an item id) and `title` (at most 200 characters), and `adult: true` when it is 18+ (hidden
 * while the 18+ code is locked, as on Home); without them Kino cannot know which title it is and shows its usual error. A
 * `go.play` of a live channel plays it, of a series opens its page (an episode needs its series: `kind: "episode"` alone
 * shows the error, and so does a `series` from a plugin without `episodes`, which Home never lists); a movie, a track or a
 * podcast episode plays at once. A bad `id`, `title` or `adult` drops the go (logged). A card whose item has `open: { screen }`
 * starts the screen again at that route instead (in place, like a `go.screen`).
 */
type KinoScreenTitleRef = { ref: string; kind: KinoScreenKind; id?: string; title?: string; adult?: boolean };
/**
 * Where a node or an answer sends the person, always into this plugin's own content or one of Kino's own pages: exactly one
 * of these ten shapes (anything else, a bare URL string or an intent, is dropped; a link goes only through `url`, behind
 * Kino's own sheet). `ref` at most 4096 characters, `q` at most 200.
 * Task 8: `search` opens Kino's search with `q` filled in and ONLY this plugin as the source (the person sees its chip and
 * may clear it; a plugin without `search` gets it refused); `browse` its "Ver más" list for that ref; `section` its section;
 * `categories` Kino's Categorías showing this plugin's group first (its own screen when `screen.replaces` names them;
 * refused and logged when the plugin has no Categorías tiles: the `categories` export, `browse`, usable). Kino's page opens
 * over the screen: Back returns to the screen with its state. At most one such page every 500 ms: a second go sent meanwhile
 * is dropped and logged. From the screen opened over the player, the screen closes first and the video then does what it
 * does whenever a Kino page covers the player (the TV pauses, a live stream stops); `play` plays the new title in the player.
 * The answer to the reserved `open` event never leaves the screen: its `go` (other than `screen`) is dropped and logged,
 * as a timer's is, so opening a screen never plays or pushes anything by itself. A tap's go is never affected.
 */
type KinoScreenGo =
  | { title: KinoScreenTitleRef }
  | { play: KinoScreenTitleRef }
  | { search: { q: string } }
  | { browse: { ref: string; title?: string; titleEn?: string } }
  | { section: true }
  | { categories: true }
  | { close: true }
  | { screen: KinoScreenOpen }
  | { titleByIds: KinoScreenTitleByIds }
  | { url: KinoScreenUrl }
  | { copy: KinoScreenCopy }
  | { liveChannel: KinoScreenLiveChannel };

/**
 * `go: { liveChannel: { provider, code } }` (Task 11, apiVersion 14, the twelfth shape): Kino tunes the player to the channel
 * `code` (an item id, 1 to 128 of `A-Z a-z 0-9 . _ ~ -`) of the En vivo provider plugin `provider` (a plugin id, never `own`).
 *
 * - Only for a plugin whose approved contributed tab declares `"kinds": ["live"]` (else dropped, logged `needs_live_tab`), and
 *   only after the person's own tap or press (as `go.url` and `go.copy`).
 * - The provider must be installed, usable and list live channels; an 18+ provider only while the 18+ code is unlocked; an
 *   18+ channel is not found while it is locked (Kino's usual message).
 * - From the player panel on a live channel the channel changes in place (the panel and its pin stay); from anywhere else the
 *   panel or screen closes and the player opens the channel. Nothing comes back: the next context says the channel.
 */
type KinoScreenLiveChannel = { provider: string; code: string };

/**
 * `go: { copy: { text, label?, sensitive? } }` (Task 8x, the eleventh shape): a «Copiar» button. Kino puts `text` on the
 * clipboard itself (clip label «Kino») and ALWAYS shows its own toast, «Copiado» / «Copied», or «Copiado: <label>», so nothing
 * is copied unseen; Kino never reads the clipboard and nothing comes back to you. No capability.
 *
 * - `text`: 1 to 500 characters in at most 6 lines, once control (a newline stays), direction, zero-width and line-separator
 *   characters are removed and it is trimmed. `label`: what was copied, at most 40 characters, named in the toast.
 *   `sensitive: true` hides it from the clipboard's preview on Android 13+ (a room code). Anything else drops the go, logged
 *   (never the text).
 * - Only after the person's own tap or press (a node's tap, a form's submit, the answer to either, a pop-up's button, a player
 *   panel press, a contributed tab's press); from `open`, a timer, a load-more, a change, a `refreshMs`, a pop-up's `onClose`
 *   or a `playerEvent` it is dropped, logged. A panel stays open.
 * - One copy every 500 ms (all plugins) and 20 a minute per plugin.
 * - On a TV nothing is copied: Kino's toast says «No se puede copiar en este aparato». Hide the button there (`kino.device`).
 */
type KinoScreenCopy = { text: string; label?: string; sensitive?: boolean };

/**
 * `go: { url: { href, title? } }` (Task 8s, the tenth shape): asks Kino to open a link in the phone's browser (a "Ver noticia"
 * button). Nothing opens by itself and it needs no capability: Kino first shows ITS OWN sheet: its heading "Abrir un enlace",
 * "Lo pide: <your plugin's name>" (cut at 24 characters; a tab you contribute to another plugin's panel shows YOUR name, never
 * the title's plugin), the link's host (wrapping, its end always drawn; an international one as its punycode with a warning to
 * check it, never decoded), your `title` under Kino's "Texto del plugin:" label, and Cancelar (focused first) and Abrir (which
 * does nothing for its first 600 ms). Only Abrir opens it, and only in a browser (never another app's link filter). On a TV, or
 * a phone with no browser, the sheet shows the link as a QR code to scan with a phone instead (a link over 1000 characters: a
 * line saying it is too long for one), and a Close button.
 *
 * - `href`: `https://` only, at most 2048 characters of printable ASCII (an international host written as punycode
 *   `xn--...`, everything else percent-encoded); a public DNS name with a dot (never an IP address, `localhost`, `.local`,
 *   `.internal`, `.lan`, `.home.arpa`, the loopback wildcard names `nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`
 *   or a single label), no `user:password@`, no port but 443. Kino keeps
 *   `https://<host lower-cased><the rest as written>` (`/` added when the rest is empty). A bad href drops the go, logged
 *   with its host at most, never the address.
 * - `title`: optional, at most 60 characters once control, direction and line-separator characters are removed and runs of
 *   combining marks cut to 2.
 * - Only after the person's own tap or press (a node's tap, a form's submit, the answer to a tap or a submit, a pop-up's
 *   button, a player panel press, a contributed tab's press). From the reserved `open`, a timer, a load-more, a change, a
 *   `refreshMs`, a pop-up's `onClose` or a `playerEvent` it is dropped, logged.
 * - At most one link a second (all plugins) and 10 a minute per plugin; one sheet at a time (a link while one is asked about
 *   is dropped). An answer that comes more than 5 s after the tap drops the link (logged); the same answer's own pop-ups
 *   (`dialog`, `sheet`, `menu`, `ui` `open`) are dropped so nothing covers Kino's sheet. Nothing comes back to you: not whether
 *   the person opened it.
 * - Desktop opens it with its own opener (same sheet and rules).
 */
type KinoScreenUrl = { href: string; title?: string };

/**
 * `go: { titleByIds: {...} }` (Task 8m, the ninth shape): opens KINO'S OWN title page for the title these ids name (the page a
 * Home TMDB card opens), where the person picks any of THEIR sources. It never opens your content or another plugin's by ref,
 * never plays, carries no URL, needs no capability, and nothing comes back to you (not even which plugins the person has).
 * Use it when people with different plugins should reach the same title (a shared room, a list of recommendations).
 *
 * - At least one of `tmdb` (a whole number from 1 to 2147483647) and `imdb` (`tt` and 7 to 10 digits); with only `imdb`,
 *   Kino asks TMDB for the title (an unknown one shows Kino's usual "No se pudo abrir"; never a title search).
 * - `season` (0 to 999) and `episode` (1 to 9999, needs `season`) only with `kind: "series"`; today the page opens the series
 *   whole. `year` 1870 to 2100. `title` at most 120 characters once control, direction and zero-width characters and U+FEFF are removed (for your
 *   own logs: the page shows TMDB's). Any other field (a `ref`, a `source`, a URL) drops the whole go, logged.
 * - Only after the person's own tap or press: a node's tap, a form's submit, the answer to a tap or a submit, a player panel
 *   press. From the reserved `open`, a timer, a load-more, a change, a `refreshMs` or a `playerEvent` it is dropped, logged.
 * - 18+: while the person's parental control is on, Kino opens it only when TMDB says the title is not adult; adult or
 *   unknown shows Kino's locked message.
 * - While Kino asks TMDB it shows "Buscando el título…"; one lookup at a time (a tap meanwhile is dropped), and if the person
 *   has moved on when it answers, nothing opens.
 * - At most one page-opening go every 500 ms. From the player panel (yours or a tab you contribute to another plugin's title)
 *   the panel closes first, then the page covers the player as any Kino page does.
 */
type KinoScreenTitleByIds = {
  tmdb?: number; imdb?: string; kind: "movie" | "series"; season?: number; episode?: number; title?: string; year?: number;
};

/**
 * `go: { screen: {...} }` (Task 7g): opens THIS plugin's own screen, never another plugin's, a URL or an intent. `route` (a name,
 * 1 to 64 of `A-Z a-z 0-9 . _ ~ -`) and `args` (an object, at most 4096 bytes of JSON) reach `screen()` and the reserved `open`
 * event as `route: { name, params: {}, args }` (`name` `"main"` when no `route`), so a deep link lands on the right tab. From
 * inside the screen it starts again at that route (the state stays): `screen()` runs, then the reserved `open` event comes
 * again with the new route, so load what the args name there, exactly as when another surface opened it. At most one such
 * restart a second (a sooner one is dropped and logged), so an `open` that answers `go.screen` cannot loop. Accepted in a screen, in the player panel's answers and
 * buttons (`pause: true` beside it pauses the video; default it keeps playing under the screen) and as an item's or a row's
 * `open` in `home`, `section` and `browse` answers. With screens switched off, or the screen hidden or failing, a card or row
 * does what it did before; a plugin without a screen gets it refused and logged.
 */
type KinoScreenOpen = { route?: string; args?: Record<string, unknown> };

/**
 * A local operation Kino runs at once, with no plugin call, on another node of the same screen by its `key` (kept in the
 * state under `ui`). `set` gives an input a value: a string (at most 2000 characters), a boolean, a number, or a list of
 * at most 500 strings (chips).
 */
type KinoScreenUiOp =
  | { show: string } | { hide: string } | { enable: string } | { disable: string } | { focus: string }
  /**
   * Shows or hides a node; Task 15: `prop: "selected"` flips the `selected` state of a button or a card with `onTap` instead
   * (`"hidden"`, the default, is the same as none). Any other `prop` drops the operation, logged.
   */
  | { toggle: string; prop?: "hidden" | "selected" }
  /** Task 15: on a button or a card with `onTap`, `value: true | false` sets its `selected` state (anything else is ignored, logged). */
  | { set: { key: string; value: string | boolean | number | string[] } }
  | { clear: string }
  /** Opens the `popup` node of that key (replacing any open pop-up); `close` closes it when it is the one open. */
  | { open: string } | { close: string };
/**
 * What a tap, long press, change or submit does: an event name for `screenEvent` (the shorthand string, its `arg` from the
 * node's `arg`), or ui operations (at most 8, run first) followed by an event or a go, or a bare go object. The event name
 * `open` is reserved; `arg` at most 4096 characters.
 */
type KinoScreenAction = string | {
  ui?: KinoScreenUiOp[]; event?: string; arg?: string;
  /**
   * Task 18: on a press (`onPressed`, `onTap`, `onLongPress`, `onSubmitted`, `onTrailingTap`) with an event, its call's own
   * budget, 1000 to 30000 ms (clamped; the default stays 20000), honoured only when the person's own press or submit sends it.
   */
  timeoutMs?: number;
} | { ui?: KinoScreenUiOp[]; go: KinoScreenGo } | KinoScreenGo;
/**
 * A declared `popup`'s `onClose` (apiVersion 14, Task 7i-2): what runs after the person dismissed it (Back, Kino's close, a
 * tap outside), never after one of its buttons, a menu item, an answer's `close` or another pop-up replaced it. An event name
 * (its `arg` from the popup's `arg`) or `{ ui?, event?, arg? }`; a `go`, an `open` and a `focus` are dropped (closing a
 * pop-up never navigates, opens one nor moves focus). Back always closes: the event is not the person's press (no
 * `kino.qr.scan`), and its answer's `dialog`, `sheet`, `menu`, `focus`, `go`, `route` and `ui` open and focus operations
 * are dropped, logged; its `state`, `toast`, `config`,
 * `close` and other `ui` operations apply. A popup's `title` is optional: without one (or a blank one) no empty row is drawn
 * and Kino's close (an X alone) starts the bottom row, the pop-up's own buttons together at its end (Task 7k); with a title
 * the X ends the title's row.
 */
type KinoScreenPopupClose = string | { ui?: KinoScreenUiOp[]; event?: string; arg?: string };

/** What every node takes. `key` is required (and unique) on inputs; other nodes get a generated one. */
interface KinoScreenBase extends KinoScreenStyle {
  key?: string;
  /** For tests and tooling, never drawn: 1..64 characters. */
  testKey?: string;
  enabled?: boolean; hidden?: boolean;
  /** A tap on the node (a button's is `onPressed`). */
  onTap?: KinoScreenAction; onLongPress?: KinoScreenAction;
  /** The event arg of a shorthand-string action. */
  arg?: string;
  /** Drawn only on these devices / width classes; an unknown name drops the node. */
  devices?: KinoScreenDevice[]; sizes?: KinoScreenSizeClass[];
  /**
   * Task 15, on a node that takes focus (a button, an input, a `TabBar`, a `titleCard`, or any node with `onTap` or
   * `onLongPress`): on a render (a tick or an answer) that left focus nowhere or on a node that is gone, focus goes to the first
   * `autofocus` node in tree order (the remote lands on the one way forward). An answer's own `focus` wins; a node that still
   * holds focus keeps it; on a phone a text field is never autofocused (no keyboard opens). Elsewhere ignored, logged.
   */
  autofocus?: boolean;
  /**
   * Task 15, on a button or a card with `onTap`: Kino's selected look (filled-tonal; a card: an outline in the primary colour),
   * read as selected. State, not an action: `ui` `set` (true or false) and `toggle` with `prop: "selected"` change it without a
   * round trip until your next render says it again. `Chips` and `TabBar` say theirs with `value`.
   */
  selected?: boolean;
  /** Task 15, on a button or a card with `onTap`: a count or a dot on the top end corner ([KinoScreenBadge]). */
  badge?: KinoScreenBadge;
  /** Task 17: `false` hides the node as `hidden: true` does (with `animate`, it fades and folds out). */
  visible?: boolean;
  /**
   * Task 17, on a node that does something (a button, an input, a `FloatingActionButton`, any node with `onTap` or
   * `onLongPress`): Kino's hint, at most 80 characters (`tooltipEn` the English one): a phone shows it on a long press (none on a
   * node with its own `onLongPress`), a TV after about 800 ms of focus, a screen reader as the long press's label. Never put
   * essential information in it. Elsewhere ignored, logged.
   */
  tooltip?: string; tooltipEn?: string;
  /**
   * Task 18, on a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: Kino's busy look (a spinner in the icon's
   * place, no press, read as busy; a TV keeps its focus there). Kino draws the same look by itself on the node the person pressed
   * while its call runs past 400 ms, until your answer.
   */
  loading?: boolean;
  /**
   * Task 18, on a button, a `FloatingActionButton`, a card or a `ListTile` with `onTap`: epoch ms; drawn off until that time on the
   * device's clock, then on by itself (no call to you). Pair it with a `Text` of the same `time` and `timeFormat: "countdown"`.
   */
  enabledAt?: number;
  /**
   * Task 22 (Flutter's name), on any node: `true` makes a node with no focus of its own (a status `Card`, a `Text`, a `Row`, a
   * `DataTable`) a D-pad stop on the TV, so the remote can rest on it to read it: Kino's row look (a tint and an underline), no
   * press, read by a screen reader. Ignored on a node that already takes focus and on the phone. Without it the TV pages a
   * scrolling body (80% of its height) before focus moves past a block that has not shown yet.
   */
  canRequestFocus?: boolean;
}
/** One choice of a `DropdownButton`, `RadioGroup`, `Chips` or `TabBar` (values distinct, at most 500); a tab also takes a `badge` (Task 15). */
interface KinoScreenOption { value: string; label: string; labelEn?: string; badge?: KinoScreenBadge }
/**
 * What every input takes; its value lives in the state under `inputs.<key>`. `bind`: the key of one of the plugin's own
 * settings: the field shows its stored value when the screen opens and writes the person's change back to it through Kino's
 * settings (the same store and sync as Kino's settings screen) -- a choice on change, a text on commit (keyboard action, focus
 * leaving it, the TV dialog's accept), never per keystroke, and only when the value differs from the stored one; the plugin still
 * gets the field's events. A `Switch` or `Checkbox` holds a `toggle` setting, a `TextField` a `text` one, a `DropdownButton`,
 * `RadioGroup` or single `Chips` a `select` or `text` one, a `Slider` a `text` one (its number as text). Never a `url` (only the person types an
 * address: the `settings` node), a `password`, an `action` or a `help` setting; any other bind, or one inside an answer's pop-up,
 * is dropped, logged. Each setting is written at most once every 500 ms (the newest value wins, the last one always lands).
 */
interface KinoScreenInput extends KinoScreenBase {
  key: string; labelText?: string; labelTextEn?: string; hintText?: string; hintTextEn?: string; onChanged?: KinoScreenAction; bind?: string;
  /**
   * Task 18: Flutter's `forceErrorText` (`forceErrorTextEn`): your own verdict, drawn under the field as Kino's errors are, until the
   * person edits it (your answer to their next press, or a new text, shows it again). At most 200 characters; never blocks a submit.
   */
  forceErrorText?: string; forceErrorTextEn?: string;
}
/** The kinds of a `TextField` (no password kind). */
type KinoScreenInputKind = "text" | "number" | "email" | "url" | "search";
/**
 * A field's rules inside a `Form`, checked by Kino before anything reaches the plugin. `required`: a text not blank, a
 * choice made, a toggle or checkbox on, a chip picked. An empty field that is not required passes every check.
 * `errorText` (and `errorTextEn`) is what the person reads under the field when it fails, else Kino's own text.
 */
interface KinoScreenFieldRules { required?: boolean; errorText?: string; errorTextEn?: string }
/**
 * A `TextField`'s rules: `minLength` characters (1..its `maxLength`); `pattern` (at most 200 characters) must match the
 * WHOLE value, in a safe subset: literals, `.`, `^`, `$`, `|`, `( )`, `(?: )`, `[...]`, the escapes \d \D \w \W
 * \s \S \b \B \n \r \t and escaped punctuation, the quantifiers `* + ? {n} {n,} {n,m}` (at most 1000, optionally lazy).
 * Quantifiers nest freely (`^\w+(\.\w+)?$`). No backreferences, no lookarounds; at most 500 steps once counts are
 * expanded. A pattern outside the subset is dropped and logged. Kino matches it with its own linear-time matcher (\d is
 * [0-9], \w [A-Za-z0-9_], \s ASCII whitespace), never with the platform's regex; one submit runs at most 16 patterns and 4,000,000 matcher steps (past either, the rest pass).
 */
interface KinoScreenTextRules extends KinoScreenFieldRules { minLength?: number; pattern?: string }

/**
 * One node of a screen tree: depth at most 10, at most 600 nodes, lists of at most 500 items, plain text of at most 2000
 * characters (`...En` the English twin). An invalid node is dropped and logged; the rest is drawn.
 */
type KinoScreenNode =
  | (KinoScreenBase & { type: "Column" | "Stack"; children?: KinoScreenNode[] })
  /**
   * `wrap: true`: the twelve-column layout. Each child takes its `span` columns after its `offset`; one that does not fit
   * what is left of a line starts the next; `gap` (the spacing scale) between cells and between lines, the columns lined
   * up from line to line. A line is as tall as its tallest child, and by default (or with `crossAxisAlignment: "stretch"`)
   * every Card or container child (Column, Row, Stack, GridView, Form) with no fixed `width` or `height` is drawn that tall,
   * so a grid of cards is even; any other child (a button, a badge, an Image with a size...) keeps its own height at the top
   * of the line. `start`, `center` or `end` keep every child at its own height, at the top, middle or bottom of its line. A hidden child leaves no gap. A child takes its natural width at
   * the start of its columns unless it has `fill: true` (then the cell's whole width). `flex`, `mainAxisAlignment` and
   * `stackOnNarrow` mean nothing there; without `wrap` a row is as before (`flex` shares it). On the TV focus follows the
   * tree, the D-pad moving by what is drawn.
   */
  | (KinoScreenBase & { type: "Row"; children?: KinoScreenNode[]; stackOnNarrow?: KinoScreenResponsive<boolean>; wrap?: KinoScreenResponsive<boolean> })
  /**
   * `flush: true` (apiVersion 14): no padding of the card's own (its `padding` is not used either) and its children clipped
   * to its rounded shape, so an `Image` at its top runs to its edges; pad the text children with their own `padding`.
   */
  | (KinoScreenBase & { type: "Card"; children?: KinoScreenNode[]; variant?: KinoScreenResponsive<"plain" | "outlined" | "filled">; flush?: KinoScreenResponsive<boolean> })
  | (KinoScreenBase & { type: "SingleChildScrollView"; children?: KinoScreenNode[]; direction?: KinoScreenResponsive<"vertical" | "horizontal"> })
  | (KinoScreenBase & { type: "GridView"; children?: KinoScreenNode[]; columns?: KinoScreenResponsive<number> })
  /** `SizedBox` is an empty box of its `width`/`height`; `Spacer` an empty one that takes its `flex` share. */
  | (KinoScreenBase & { type: "Spacer" | "SizedBox" | "Divider" })
  /**
   * Task 15: `time` (epoch ms) is written by Kino in the app's language: `timeFormat: "relative"` (the default: «ahora»,
   * «hace 2 min», «ayer», rewritten every minute while shown, never a call to you) or `"clock"` («18:42», the device's 12/24 h).
   * With a `time`, `text` is optional and is its prefix («Actualizado hace 5 min»).
   */
  | (KinoScreenBase & { type: "Text"; text: string; textEn?: string; style?: KinoScreenResponsive<"h1" | "h2" | "h3" | "h4" | "h5" | "p" | "caption" | "label">; maxLines?: KinoScreenResponsive<number>; bold?: KinoScreenResponsive<boolean>; time?: number; timeFormat?: "relative" | "clock" | "countdown" })
  | (KinoScreenBase & { type: "Text"; text?: string; textEn?: string; style?: KinoScreenResponsive<"h1" | "h2" | "h3" | "h4" | "h5" | "p" | "caption" | "label">; maxLines?: KinoScreenResponsive<number>; bold?: KinoScreenResponsive<boolean>; time: number; timeFormat?: "relative" | "clock" | "countdown" })
  /**
   * `fallback` (apiVersion 14): one node drawn in the image's box, at its size, when the picture fails to load or there is
   * no `url` (with a fallback, an image whose `url` is missing or not https on a public host is kept and draws it). It may
   * hold only Column, Row, Stack, Card, Spacer, SizedBox, Divider, Text, Icon, Badge, Skeleton and Image, at any depth, and
   * nothing in it is pressed (`onTap`/`onLongPress` there are ignored). Without one a failed picture shows Kino's mark.
   */
  | (KinoScreenBase & { type: "Image"; url?: string; aspect?: KinoScreenResponsive<"16:9" | "2:3" | "1:1" | "banner">; alt?: string; altEn?: string; fallback?: KinoScreenNode })
  | (KinoScreenBase & { type: "Icon"; name: KinoIconName })
  | (KinoScreenBase & { type: "Badge"; text: string; textEn?: string })
  | (KinoScreenBase & { type: "LinearProgressIndicator"; value?: number; labelText?: string; labelTextEn?: string })
  | (KinoScreenBase & { type: "CircularProgressIndicator"; text?: string; textEn?: string })
  | (KinoScreenBase & KinoScreenPaging & { type: "ListView"; items?: KinoScreenNode[]; empty?: KinoScreenNode; columns?: KinoScreenResponsive<number>;
      /**
       * Task 14: opens at the last item; while the person is at the end (or one item from it) a new last item scrolls into view;
       * scrolled up it stays put until they come back. One column, in a list that scrolls itself (a full screen, or a panel with
       * `layout: "fill"`); drawn flat it does nothing (logged once).
       */
      stickToBottom?: KinoScreenResponsive<boolean>;
      /**
       * Task 15: items appended while the person is not at the end show Kino's own chip («↓ Nuevos» / «↓ New», never your text)
       * over the list's bottom; a tap goes to the end and it hides once the end shows. One column, a list that scrolls itself.
       * On the TV it is a focus stop: Down from the list region reaches it before your controls under the list.
       */
      newItemsHint?: boolean })
  /**
   * A button: `ElevatedButton` (Kino's primary), `TextButton`, `IconButton` (needs `icon`), or `Button` with its `variant`
   * (`secondary` has no other name). `submit: true` inside a `Form`: Kino checks the form, then runs the form's `onSubmitted`
   * (the button's own `onPressed` is ignored).
   */
  | (KinoScreenButton & { type: "ElevatedButton" | "TextButton" | "IconButton" })
  | (KinoScreenButton & { type: "Button"; variant?: KinoScreenResponsive<"primary" | "secondary" | "text" | "icon"> })
  /** A `TextField` with `maxLines` above 1 (in any size class) or `multiline: true` takes several lines. */
  | (KinoScreenInput & KinoScreenTextRules & { type: "TextField"; kind?: KinoScreenInputKind; maxLength?: number; value?: string; maxLines?: KinoScreenResponsive<number>; multiline?: boolean; onSubmitted?: KinoScreenAction;
      /**
       * Task 8y: an icon inside the field's box at its end (one-line fields only), all three or none: `trailingIcon`,
       * `trailingLabel` (what a screen reader says, at most 40 characters; `trailingLabelEn` in English) and `onTrailingTap`
       * (sent like `onSubmitted`, the field's current text as the event's `value`). Never shown on a disabled field.
       */
      trailingIcon?: KinoScreenResponsive<KinoIconName>; trailingLabel?: string; trailingLabelEn?: string; onTrailingTap?: KinoScreenAction;
      /**
       * Screen asks: a masked one-line field (a password, a token), drawn with dots on the phone and the TV. What is typed never
       * enters the state or a render: it goes only with the person's own tap or submit (`state.inputs.<key>` and, for the
       * form's or the field's own submit, `value`), and is cleared once that call ends unless the answer gives one back in
       * `state.inputs.<key>`. `value` and `onChanged` are ignored on it; with several lines (or not a boolean) the field is
       * dropped. `bind` takes only a `password` setting, and writes it on commit (an empty field never clears it).
       */
      obscureText?: boolean })
  | (KinoScreenInput & KinoScreenFieldRules & { type: "DropdownButton" | "RadioGroup"; options: KinoScreenOption[]; value?: string })
  /** `minLength` / `maxLength` count the chips picked. */
  | (KinoScreenInput & KinoScreenFieldRules & { type: "Chips"; options: KinoScreenOption[]; multiple?: boolean; value?: string | string[]; minLength?: number; maxLength?: number })
  | (KinoScreenInput & KinoScreenFieldRules & { type: "Switch" | "Checkbox"; value?: boolean })
  | (KinoScreenInput & { type: "Slider"; min?: number; max?: number; step?: number; value?: number })
  | (KinoScreenBase & { type: "TabBar"; tabs: KinoScreenOption[]; value?: string; onChanged?: KinoScreenAction })
  | (KinoScreenBase & { type: "emptyState" | "errorState"; title: string; titleEn?: string; text?: string; textEn?: string; icon?: KinoIconName })
  // Kino's own components: data only, drawn with Home's cards and rows. Items are what `home` rows return (KinoItem),
  // read by the same rules (a series needs the episodes capability; posters and backdrops https only, else Kino's
  // placeholder); 18+ items show only while the 18+ code is unlocked. At most 1000 titles per tree, and at most 60 in a
  // grid inside a scroll, list or pop-up, or a rail inside a horizontal scroll (drawn all at once there).
  /** One Home poster card; without `onTap` it opens the title's page (`go: { title: { ref, kind } }`). */
  | (KinoScreenBase & { type: "titleCard"; item: KinoItem; size?: KinoScreenResponsive<KinoScreenCardSize> })
  /** A Home row: a title, 1..500 items, and "Ver más" (`go: { browse: { ref } }`) when `ref` is set. */
  | (KinoScreenBase & KinoScreenPaging & { type: "titleRail"; title: string; titleEn?: string; items: KinoItem[]; ref?: string; size?: KinoScreenResponsive<KinoScreenCardSize> })
  /** Home cards in a grid (default 3 columns), 1..500 items. */
  | (KinoScreenBase & KinoScreenPaging & { type: "titleGrid"; items: KinoItem[]; columns?: KinoScreenResponsive<number> })
  /** A section's banner: title, text, an https image and at most 2 buttons. */
  | (KinoScreenBase & { type: "heroCard"; title: string; titleEn?: string; text?: string; textEn?: string; image?: string; buttons?: ((KinoScreenButton & { type: "ElevatedButton" | "TextButton" | "IconButton" }) | (KinoScreenButton & { type: "Button"; variant?: KinoScreenResponsive<"primary" | "secondary" | "text" | "icon"> }))[] })
  /**
   * A pop-up declared in the tree (`key` required), drawn only once a `{ open: key }` ui operation opens it. One pop-up at
   * a time; Back closes it first. An `AlertDialog` or `BottomSheet` takes `children` (an `AlertDialog` also `buttons`); a
   * `PopupMenuButton` takes 1..8 `items`. `popup` with its `kind` is the same thing.
   * Task 15 `anchor` (a node's key): drawn next to that node (above it when there is more room above, else below), sized to
   * its content, over the content and taking no layout space, with no close of its own (Back and a tap outside close it; on
   * the TV focus goes in, stays there and Back gives it back to the anchor). With no room above or below, or the anchor not on
   * screen, it falls back to its kind's own place (logged once). A screen-format panel draws a pop-up only with an `anchor`.
   */
  | (KinoScreenBase & { type: "AlertDialog"; key: string; title?: string; titleEn?: string; children?: KinoScreenNode[]; buttons?: KinoScreenDialog["buttons"]; anchor?: string })
  | (KinoScreenBase & { type: "BottomSheet"; key: string; title?: string; titleEn?: string; children?: KinoScreenNode[]; anchor?: string })
  | (KinoScreenBase & { type: "PopupMenuButton"; key: string; title?: string; titleEn?: string; items: KinoScreenMenuItem[]; anchor?: string })
  | (KinoScreenBase & { type: "popup"; key: string; kind: "dialog" | "sheet"; title?: string; titleEn?: string; children?: KinoScreenNode[]; buttons?: KinoScreenDialog["buttons"]; onClose?: KinoScreenPopupClose; anchor?: string })
  | (KinoScreenBase & { type: "popup"; key: string; kind: "menu"; title?: string; titleEn?: string; items: KinoScreenMenuItem[]; onClose?: KinoScreenPopupClose; anchor?: string })
  /**
   * A form: its `children` drawn as a column; its fields (every input in it, a pop-up's body excepted) take the rules of
   * KinoScreenFieldRules. A `submit: true` button submits it: Kino checks every field first, and an invalid form never
   * calls the plugin (the error shows under each failing field, focus goes to the first). While a required field is
   * empty the submit button is off. A valid form runs `onSubmitted`: its event's `value` is every field's value by key.
   * Forms do not nest and an answer's pop-up takes none.
   */
  | (KinoScreenBase & { type: "Form"; children?: KinoScreenNode[]; onSubmitted: KinoScreenAction })
  /**
   * Kino's own settings form for this plugin, the same one Kino's settings screen shows: every setting type, `devices`,
   * both languages, validation, Kino's own fields for secrets and its buttons for actions, with its own save. `keys`
   * shows only those settings, in that order (none: all of them); each setting shows at most once per screen, so a custom
   * form can drop one in for a secret (`keys: ["password"]`). Its JavaScript never sees what is typed in it. Never inside a
   * `Form` or an answer's pop-up. `onSaved` (screen asks): sent after this form saved or one of its action buttons finished,
   * its event's `value` a KinoScreenSettingsOutcome (setting keys only, never a value); a nobody's-press event that waits in
   * the queue like the person's (a timer's tick never runs before it); a save merged with a still-waiting earlier one.
   */
  /**
   * Task 18: `autoSave: true` saves its toggles and selects as the person changes them (no `validateSettings`; a locked one only
   * after its code); with only those shown, no Guardar. A node whose keys hold no valued setting (`keys: ["logout"]`) draws its
   * buttons and no Guardar. Screen asks: each autosave that changed something sends `onSaved` too (`kind: "save"`, the key),
   * as a Guardar does; one that changed nothing sends none.
   */
  | (KinoScreenBase & { type: "settings"; keys?: string[]; autoSave?: boolean; onSaved?: string | { event: string; arg?: string } })
  /**
   * A line of news across the screen in Kino's colour for its `role` (default info), with an optional title, a button
   * (`action`) and, when `dismissible` (it needs a `key` of its own), Kino's close: it hides the banner at once (in
   * `state.ui.hidden`) and sends the event `dismiss` with the banner's key as `arg`.
   */
  | (KinoScreenBase & { type: "MaterialBanner"; role?: KinoScreenRole; title?: string; titleEn?: string; text: string; textEn?: string; action?: { label: string; labelEn?: string; onTap: KinoScreenAction; arg?: string }; dismissible?: boolean })
  /**
   * Sections that open and close: each item's header (its `title`) shows or hides its `children`; one open at a time
   * unless `multiple`. `key` is required: which items are open lives in `state.ui.open.<key>` (the open item keys), so it
   * survives a re-render, and the plugin may set it there too; `open` is only the first look. 1..500 items, item keys
   * valid and distinct. Each item's header and its children count toward the depth and node limits. A required field in a
   * closed item does not keep a form's submit button off; the submit still checks it and, when it fails, opens its item and
   * focuses it. Never in an answer's pop-up. On the TV each
   * header takes focus and OK toggles it.
   */
  | (KinoScreenBase & { type: "ExpansionTile"; key: string; items: { key: string; title: string; titleEn?: string; children?: KinoScreenNode[]; open?: boolean }[]; multiple?: boolean })
  /**
   * A placeholder while something loads, in Kino's muted colour: a `line` (`lines` bars, 1..6), a `block`, a `circle` or a
   * `card` (a poster and its lines); size it with `width`/`height`. It pulses gently, and stands still when the system's
   * animations are off; a screen reader says Kino's "Loading".
   */
  | (KinoScreenBase & { type: "Skeleton"; shape?: KinoScreenResponsive<"line" | "block" | "circle" | "card">; lines?: KinoScreenResponsive<number> })
  /**
   * A QR code drawn by Kino itself (on the device, no network), black on white with its quiet zone, at one of Kino's three
   * sizes. `value`: 1..1000 characters, drawn as written; an empty or longer one is dropped (logged). A value holding one
   * of your plugin's secrets is never drawn: Kino shows its empty state instead (logged). `labelText` is what a screen
   * reader says. Never pressable (its `onTap` and `onLongPress` are ignored) and never focused; it may sit in an answer's
   * `dialog` or `sheet` body or a declared pop-up.
   *
   * Screen asks: a code that expires. `expiresInMs` (1000..3600000, from when Kino first draws this value) or `expiresAt` (epoch
   * ms, read against the device's clock once, at most an hour away): Kino draws a bar and the seconds left under the code,
   * ticked by itself between your calls, and dims the code under «Código caducado» at zero. The same value sent again never
   * restarts it; a new value starts a new countdown. `onExpire` is sent ONCE per value, `value` a KinoScreenQrExpire:
   * `renewBeforeMs` before the end (phase `renew`, below the lifetime, else half of it), else at zero (`expired`); never while
   * the screen is hidden (it goes once it shows again), never for a withheld code. Its answer keeps what a timer's keeps.
   */
  | (KinoScreenBase & { type: "QrImage"; value: string; labelText?: string; labelTextEn?: string; size?: KinoScreenResponsive<KinoScreenCardSize>;
      expiresInMs?: number; expiresAt?: number; onExpire?: string | { event: string; arg?: string }; renewBeforeMs?: number })
  /**
   * Screen asks: a setup flow in Kino's own look, for any plugin. One `current` step is open (its `children` drawn under it), a
   * `done` one collapses to its `subtitle` (else Kino's «Listo»), a `pending` one is dimmed. 1..12 items with valid, distinct
   * keys and a title. None current while one is to do: the first not done is; several: the first; an unknown state reads as
   * pending (all logged). `onStepTap` makes a done step pressable (touch, or OK on the TV): its event goes with the step's
   * key as `arg`. A screen reader reads each header as «Paso 2 de 3: Código, actual».
   */
  | (KinoScreenBase & { type: "steps"; items: { key: string; title: string; titleEn?: string; subtitle?: string; subtitleEn?: string; state?: "done" | "current" | "pending"; children?: KinoScreenNode[] }[]; onStepTap?: string | { event: string } })
  /**
   * A number drawn `[ − ] value [ + ]` (not Flutter's `Stepper`, a wizard: that name is unknown here): each press moves it
   * by `step` (default 1), kept within `min`..`max` (min below max) and rounded to `decimals` places (0..6); a button at its
   * limit is off; holding it repeats, slowly faster. Its value is in `state.inputs.<key>` as text: a `.` for decimals, no
   * grouping, exactly `decimals` places ("2.50"). `onChanged` goes with each press (the newest of a quick run, like any
   * change). `editable: true` also lets the person type it, with Kino's digits-only entry (the TV's number pad, the phone's
   * number keyboard): only with `decimals` 0 and a `min` of 0 or more, otherwise ignored (logged). Inside a `Form` it is a
   * field (`required`, `errorText`). No `bind` in this version (ignored, logged). Its numbers are at most 1e15 either way
   * (larger ones are clamped, logged). On the TV Left and Right move between −, the value and +.
   */
  | (Omit<KinoScreenInput, "bind"> & KinoScreenFieldRules & { type: "NumberStepper"; value?: number; min?: number; max?: number; step?: number; decimals?: number; editable?: boolean })
  /**
   * A table in Kino's own look: `children` are `TableRow`s (1..200), each with `TableCell`s. `columns` (at most 20) gives
   * each column its share of the width (`flex` 1..12, default 1); without it the table has as many columns as its widest row
   * spans. `header: true` makes the first row the header (bold, read as headings, a stronger rule under it); a rule under
   * every row; `zebra: true` paints every other row with Kino's surface. On a compact width the table scrolls sideways
   * (the table at least 96 dp per column, shared by flex) unless `wrap: true`. A row with fewer cells is padded; cells past the last column are
   * dropped and a span past it is cut (logged), for each size class with its own columns. Each row and each cell counts
   * toward the 600 nodes. Every property takes a per-size map: the flags, `columns`, a column's `flex`, a cell's `colSpan`
   * and `crossAxisAlignment`. It takes no focus: on the TV the D-pad walks only what is focusable inside its cells.
   */
  | (KinoScreenBase & { type: "DataTable"; columns?: KinoScreenResponsive<{ key?: string; flex?: KinoScreenResponsive<number> }[]>; header?: KinoScreenResponsive<boolean>; wrap?: KinoScreenResponsive<boolean>; zebra?: KinoScreenResponsive<boolean>; children: KinoScreenTableRow[] })
  /**
   * Task 17: Kino's floating button, one per screen, drawn over the bottom end (or centre) of your area (above a Scaffold's
   * bottom bar), never in place, never under the system bars or the keyboard; never inside a list, a table, a pop-up, a
   * `ListTile` or an image's fallback. `labelText` makes it the extended form. Takes `selected`, `badge`, `autofocus`, `tooltip`.
   */
  | (Omit<KinoScreenBase, "onTap"> & { type: "FloatingActionButton"; icon: KinoIconName; labelText?: string; labelTextEn?: string; onPressed: KinoScreenAction; fabPosition?: KinoScreenResponsive<"end" | "center"> })
  /**
   * Task 17: one row of a list (56 dp, 72 with a subtitle, 48 `dense`); `leading` and `trailing` one small node each (an `Icon`,
   * a `CircleAvatar`, an `Image`, a `Badge`, a `Text` or a `CircularProgressIndicator`), never pressed themselves; the whole tile
   * is one press and one TV stop; `selected` (with an `onTap`) fills it with primaryContainer.
   */
  | (KinoScreenBase & { type: "ListTile"; title: string; titleEn?: string; subtitle?: string; subtitleEn?: string; leading?: KinoScreenNode; trailing?: KinoScreenNode; dense?: KinoScreenResponsive<boolean> })
  /** Task 17: a circle with a picture, else initials (at most 3), else an icon; `radius` 12..64 dp (default 20). No `borderRadius`. */
  | (KinoScreenBase & { type: "CircleAvatar"; image?: string; text?: string; textEn?: string; icon?: KinoIconName; radius?: KinoScreenResponsive<number>; backgroundColor?: KinoScreenColorRole; labelText?: string; labelTextEn?: string })
  /**
   * Task 17: pages (at most 24) swiped across on a phone, Left and Right on a TV, Kino's dots under them; `onPageChanged`'s
   * `value` is the settled page's index; `initialPage` the first look only; `autoPlayMs` 3000..60000 (paused while touched or
   * focused, and with animations off); `viewportFraction` 0.3..1 (below 1: Kino's carousel), `padEnds` (default true). Never
   * inside a sideways scroll or a table cell.
   */
  | (KinoScreenBase & { type: "PageView"; children: KinoScreenNode[]; initialPage?: number; onPageChanged?: KinoScreenAction; autoPlayMs?: number; viewportFraction?: KinoScreenResponsive<number>; padEnds?: KinoScreenResponsive<boolean> })
  /**
   * Task 17 item G: only a result's root. The `appBar` sits under Kino's own title bar (never replacing or covering it), the
   * `body` takes the bounded height left (drawn in `layout: "fill"`), the button sits above the `bottomNavigationBar`.
   */
  | (KinoScreenBase & { type: "Scaffold"; appBar?: KinoScreenAppBar; body: KinoScreenNode; floatingActionButton?: KinoScreenNode; bottomNavigationBar?: KinoScreenNavigationBar });

/**
 * Task 17 item G: a Scaffold's top bar: `leading` and up to four `actions` are `IconButton`s with a `labelText`; `bottom` a `TabBar`.
 * `title` is a string (with its `titleEn` twin) or, Flutter's way, any node (a `TabBar`, a `Row` of buttons, an `Image`...; at
 * most 40 nodes) drawn in the room left of the actions: a `TabBar` there shares one row with the actions.
 */
type KinoScreenAppBar = KinoScreenBase & { type: "AppBar"; title?: string | KinoScreenNode; titleEn?: string; leading?: KinoScreenNode; actions?: KinoScreenNode[]; bottom?: KinoScreenNode; centerTitle?: boolean; backgroundColor?: KinoScreenColorRole };
/** Task 17 item G: a Scaffold's bottom bar of 2..5 items; `onChanged`'s `value` is the item's key (keep it in your state). */
type KinoScreenNavigationBar = KinoScreenBase & { type: "NavigationBar"; items: { key: string; icon: KinoIconName; label: string; labelEn?: string; badge?: KinoScreenBadge }[]; value?: string; selectedIndex?: number; onChanged?: KinoScreenAction };

/** What every button takes: `labelText` (not for an `IconButton`), `icon` (a Kino icon name), `onPressed`. */
type KinoScreenButton = Omit<KinoScreenBase, "onTap"> & { labelText?: string; labelTextEn?: string; icon?: KinoIconName; confirm?: string; confirmEn?: string; submit?: boolean; onPressed?: KinoScreenAction };

/**
 * A table row: its cells (at most 20), whose `colSpan`s fill the table's columns. `key` (unique among the screen's keys) lets a
 * `ui` show, hide or toggle operation name the row; `hidden` starts it hidden.
 */
interface KinoScreenTableRow { type: "TableRow"; key?: string; hidden?: boolean; children?: KinoScreenTableCell[] }
/**
 * A table cell: a plain `text` (`textEn` its English twin) or `children` (nodes, one level below the table: no `ListView`,
 * `SingleChildScrollView` or `DataTable` at any depth, those are dropped and logged; an `ExpansionTile` may sit there and
 * grows its row; with a `text` the children are ignored). `crossAxisAlignment` places its content across its width (start);
 * `colSpan` 1..8 (default 1; above 8 it is 8). Both may be per-size maps.
 */
interface KinoScreenTableCell { type: "TableCell"; text?: string; textEn?: string; children?: KinoScreenNode[]; crossAxisAlignment?: KinoScreenResponsive<"start" | "center" | "end">; colSpan?: KinoScreenResponsive<number> }

/*
 * The older spellings, still accepted (Kino reads them as the names above; nothing changes in what is drawn): the types
 * `col` (Column), `row`, `box` (Stack), `card`, `spacer` (Spacer and SizedBox), `divider`, `scroll` (SingleChildScrollView),
 * `grid` (GridView), `text`, `image`, `icon`, `badge`, `progress` (LinearProgressIndicator), `loading`
 * (CircularProgressIndicator), `list` (ListView), `button` (Button), `textInput` and `textArea` (TextField), `dropdown`
 * (DropdownButton), `toggle` (Switch), `checkbox`, `radioGroup`, `slider`, `chips`, `tabs` (TabBar), `popup` with `kind`
 * (AlertDialog, BottomSheet, PopupMenuButton), `form`, `banner` (MaterialBanner), `accordion` (ExpansionTile), `skeleton`,
 * `qr` (QrImage), `stepper` (NumberStepper), `table`, `tr`, `td` (DataTable, TableRow, TableCell); the properties `w`, `h`,
 * `minH`, `justify`, `align`, `weight`, `radius`, `onChange`, `onSubmit`, `hint`, `label` (and their `...En`), and a button's
 * `onTap`. Give one spelling: when a node has both, the Flutter-style one wins and Kino logs the clash. Log lines name the
 * older spelling. A name Kino does not know (Flutter's `Stepper` too) drops the node, logged.
 */

/**
 * How a player panel's body holds the tree (Task 14, apiVersion 14). "scroll" (the default): the body scrolls, the tree has no
 * height limit (a `ListView` draws flat, `flex` does nothing). "fill": the root is drawn at the body's size with no body scroll;
 * `flex` shares the height left and a `ListView` with `flex` is lazy and scrolls itself (a chat: messages over an input row at
 * the bottom). When the parts without `flex` alone are taller, that render is drawn as "scroll" (logged once). A full screen's
 * root is always drawn at the screen's size. Any other value is logged and read as "scroll".
 */
type KinoScreenLayout = "scroll" | "fill";

/** `screen` may return its tree with `every` on the root (the screen's timers, KinoScreenTimer) and its `layout` (Task 14). */
type KinoScreenRoot = KinoScreenNode & { every?: KinoScreenTimer | KinoScreenTimer[]; layout?: KinoScreenLayout };

/** A title card's or rail's size. */
type KinoScreenCardSize = "small" | "medium" | "large";
/** One action of a menu pop-up: a label, an optional Kino icon, and what a press does (the menu closes first). */
interface KinoScreenMenuItem { label: string; labelEn?: string; icon?: KinoIconName; onTap: KinoScreenAction; arg?: string }

/** A pop-up drawn by Kino over the canvas: `body` is text or nodes; at most 3 buttons, one without `event` closes it. */
interface KinoScreenDialog {
  title?: string; titleEn?: string; body?: string | KinoScreenNode[]; bodyEn?: string;
  buttons?: { label: string; labelEn?: string; event?: string; arg?: string; variant?: "primary" | "secondary" | "text" }[];
}

/**
 * What `screenEvent` answers; every field optional, `null` means nothing to do. `state` is a patch merged key by key
 * (`null` removes a key; at most 64 KB) after which Kino calls `screen` again; `route` goes to another screen of this plugin.
 */
interface KinoScreenAnswer {
  state?: Record<string, unknown> | null;
  /** One pop-up at a time: with more than one of dialog, sheet and menu, the dialog wins, then the sheet. */
  dialog?: KinoScreenDialog | null;
  /** A bottom sheet on the phone, a side drawer on the TV. */
  sheet?: { title?: string; titleEn?: string; body?: string | KinoScreenNode[]; bodyEn?: string } | null;
  /** A short list of actions (1..8). */
  menu?: { title?: string; titleEn?: string; items: KinoScreenMenuItem[] } | null;
  /**
   * A short message at the bottom (one at a time: a newer one replaces it). A string, or `{ text, role, action, ms }`: `ms`
   * 2000..8000 (default 3500), `action` a button whose event (with its `arg`) Kino sends once. On the TV the toast never takes
   * focus by itself: Down from the bottom of the screen reaches its action, and the remote's Menu (or Play/Pause) runs it.
   */
  toast?: string | { text: string; textEn?: string; role?: KinoScreenRole; action?: { label: string; labelEn?: string; event: string; arg?: string }; ms?: number } | null; toastEn?: string;
  go?: KinoScreenGo | null;
  route?: { push: string; params?: Record<string, unknown> } | { pop: true } | null;
  close?: boolean;
  focus?: string | null;
  /**
   * The plugin's own settings to write, by key, through Kino's settings (the same store and sync as its settings screen;
   * written before the `screen` call the answer asks for, so `kino.config` reads the new value). Only keys the manifest
   * declares in `settings`, at most 32 (sorted), with a value that fits: a `text` a string (trimmed; blank or `null` empties
   * it, unless required), a `toggle` a boolean, a `select` one of its option values, a `list` an array of records of its
   * fields that adds no address to its `url` fields (entries may be removed, reordered or retitled). Never a `url` (only the
   * person types an address, in the `settings` node), a `password`, an `action` or a `help` setting, and never a value holding
   * one of the plugin's secrets. Anything else is dropped and logged. Toggles and selects keep the plugin's web session; any
   * other write restarts it as Kino's Guardar does. Each setting is written at most once every 500 ms.
   */
  /**
   * Your settings to write (at most 32 keys). Screen asks: a `password` setting takes a string, kept exactly as given
   * (null or blanks empty it, never a required one), saved and synced as Ajustes saves a typed one, never read back.
   */
  config?: Record<string, string | boolean | Record<string, string>[] | null> | null;
  /**
   * Local operations the answer runs (apiVersion 14, Task 7i-2), the same as an action's `ui` (at most 8). `{ open: key }`
   * opens a declared `popup`; when the answer also changes `state`, it opens once the new tree is drawn, so the pop-up shows
   * its new body from its first frame (Back before then cancels it). `{ close: key }` closes it at once, for example after
   * the pop-up's Save. A timer's answer drops `ui`.
   */
  ui?: KinoScreenUiOp[];
}

/** The screen the person is on: `{ name: "main", params: {} }` at the root, else the last `route.push` and its params. */
/** `args` only on the route the screen opened at, when a `go.screen` gave it some (Task 7g). */
type KinoScreenRoute = { name: string; params: Record<string, unknown>; args?: Record<string, unknown> };

/**
 * `screen` -- required with the capability "screen": a pure view, the tree for this state (called on open and after every state patch).
 * `state.ui` holds what Kino did locally: `hidden` and `enabled` (by node key) and `open` (each accordion's open item keys).
 * `state.inputs` holds every input on screen by key: what the person or the plugin set, else the value the last tree shows
 * (toggle/checkbox a boolean, slider a number, dropdown/radioGroup the option value or null, chips an array when multiple,
 * stepper its value as text).
 * Events arrive one at a time, spaced 100 ms apart, never dropped for coming fast. Inside `screen` and `screenEvent`,
 * `kino.config.get/all` read the settings as stored now (a bound field's write or a `config` answer included).
 */
type KinoScreenFn = (arg: {
  state: Record<string, unknown>; route: KinoScreenRoute; device: KinoScreenDevice;
  size: { widthClass: KinoScreenSizeClass; heightClass: KinoScreenSizeClass; orientation: "portrait" | "landscape" };
  lang: "es" | "en";
}) => Promise<KinoScreenRoot>;

/**
 * apiVersion 14, capability "schedule" (Task 8q): what `job(ctx)` receives. `id` is the manifest job's id; `reason` is
 * "scheduled" (its periodic work fired) or "manual" (the person pressed "Ejecutar ahora"); `lastRunMs` is when this job last ran
 * on this device (null before its first run); `attempt` is 1 plus its failures in a row.
 */
interface JobContext {
  id: string;
  reason: "scheduled" | "manual";
  lastRunMs: number | null;
  attempt: number;
}

/**
 * One entry of the manifest's `jobs` (apiVersion 14, Task 8q; `runOn`, Task 8q-2). `runOn: "any"` (the default): every device
 * that has the plugin runs it, for its own `kino.storage`. `runOn: "preferPhone"`: ONE of the person's linked devices runs it, a
 * linked phone first (a TV never runs it while a fresh phone can; it takes over when the phone stops for two periods), and the
 * job writes its result with `kino.shared` so the other devices read it. Read `kino.device` in the job to pick a lighter batch on
 * a TV (Kino enforces nothing extra; the job's caps apply). `enabledBy` (Task 18): the key of one of the plugin's own `toggle`
 * settings that is the person's on/off for this job, instead of its own opt-in switch: on while that setting is on (its default
 * counts) and the job's row in Ajustes holds no OFF of the person's (that OFF wins until they switch the row on again); the
 * setting off is always off. Anything else refuses the manifest.
 */
interface KinoJobDecl {
  id: string;
  label: { es: string; en?: string };
  everyMin: number;
  everyOptions: number[];
  runOn?: "any" | "preferPhone";
  enabledBy?: string;
}

/**
 * `job` -- required with the capability "schedule": one background run, headless (no screen, nothing shown; its answer is never
 * read). Keep what you fetched in `kino.storage`; your screens read it when they open. At most 20 s, 10 `kino.fetch`es (one at a
 * time), 2 MB of answer bodies (an answer that would cross it is refused with `too_large`) and 256 KB (UTF-8) written to
 * `kino.storage` per run (a cap crossed cuts the run: a failure). An allow-list: only `kino.fetch`, `kino.storage`, `kino.log`,
 * `kino.config` (read), `kino.cookies`, `kino.crypto`, `kino.sleep`, `kino.html`, `kino.secret`, `kino.error`, `kino.rank` and
 * `kino.library` (with its own approval), `kino.ai` (with its own approval), `kino.shared` (Task 8q-2) and `kino.seed` (Task 18:
 * under its usual telemetry-consent gate) work, plus the plain values (`kino.apiVersion`, `kino.device`...); everything else
 * (`kino.room`, `kino.qr`, `kino.browser`, `kino.ws`, `kino.meta`, `kino.tmdb`, `kino.nuvio`, `kino.catalog`, `kino.sync` and
 * any later API) rejects with `not_allowed`.
 */
type KinoJobFn = (ctx: JobContext) => Promise<unknown>;

/** `screenEvent` -- required with the capability "screen": a node's event (the first one is the reserved `open`). */
type KinoScreenEventFn = (arg: {
  name: string; arg?: string; value?: unknown; state: Record<string, unknown>; route: KinoScreenRoute; device: KinoScreenDevice; lang: "es" | "en";
}) => Promise<KinoScreenAnswer | null>;

// ---------- the player panel built with the screen kit (Task 8i, opt-in per result, apiVersion 14) ----------

/**
 * What `panel(context)` may return instead of a `KinoPanel`: the same drawer (its title, tabs and `refreshMs`) with a body built
 * from the screen nodes (`root`: Flutter-style names or aliases, forms, tabs, lists, tables, the settings node, qr, banner...).
 * A result without `format` is the legacy panel, unchanged; the format may change from one call to the next. Needs apiVersion
 * 14 (below it Kino reads the result as a legacy panel, logged). Answer it only when `context.features` includes "screen":
 * Kino puts it there only while plugin screens are on (with them switched off a screen-format result shows no panel, so
 * answer a legacy one then); an older Kino never sends it.
 * Limits: depth 6, 200 nodes (the legacy panel keeps its own); a `popup` node is dropped (pop-ups belong to the screen, not
 * to the drawer). `refreshMs` (2000..60000) is THE periodic call, as in the legacy panel: `every` is dropped here, logged. With
 * plugin screens switched off a screen-format result shows no panel (a legacy one still does).
 */
interface KinoPanelScreenResult {
  format: "screen";
  root: KinoScreenNode;
  /** Up to 60 characters. */
  title?: string; titleEn?: string;
  /** `#RRGGBB`, the legacy panel's rule. */
  accent?: string;
  /** Kino calls `panel` again every so often (2000..60000 ms), only while the panel is open: e.g. live scores. */
  refreshMs?: number;
  /** At most 6, as the legacy panel's; a tab press calls `panel` again with `context.tab`. */
  tabs?: { id: string; label: string; labelEn?: string; badge?: KinoScreenBadge }[];
  tab?: string;
  /** Task 8j: as `KinoPanel.player`: counts only with the `playerControl` capability. */
  player?: KinoPlayerAction;
  /** Task 14: how the body holds `root` (KinoScreenLayout); "fill" for a chat tab. Here, never on `root`. */
  layout?: KinoScreenLayout;
}

/**
 * The context of an apiVersion 14 plugin's panel calls: exactly `KinoPanelContext` (`device` "tv" | "phone", `lang` "es-CO"
 * style) plus the screen part, in every call, the first one included (Kino cannot know the format before the answer):
 * `state` (Kino's, kept for this title's playback: `inputs`, `ui` and your keys, as a screen's) and `size` (the drawer's size
 * classes; before the drawer measured itself, Kino's estimate). `playerEvent`'s context stays the legacy one.
 */
interface KinoPanelScreenContext extends KinoPanelContext {
  state: Record<string, unknown>;
  size: { widthClass: KinoScreenSizeClass; heightClass: KinoScreenSizeClass; orientation: "portrait" | "landscape" };
}

/**
 * Task 11 (apiVersion 14): the context of a tab you contribute (`"kinds": ["live"]`) on an En vivo channel. Exactly these keys:
 * live has no ref, title, ids, position, duration, pause, stats or player block. `channel.provider` is the id of the plugin
 * that lists the channel, `channel.code` its id there, `channel.name` its listed name: pass the first two to
 * `go.liveChannel` to tune another device to it. Sent only for a channel its provider's listing confirmed as not 18+, never
 * for «Mis canales» (the person's own lists). On a zap Kino calls `panel` again with the new channel (a render, never a
 * press); the panel stays open. Your `player` actions are dropped whole (live_channel); no `playerEvent` on live.
 * `values.video` is one set for every live channel (the session stays open across zaps). In screen mode `state` and `size` come too, as in `KinoPanelScreenContext`.
 */
interface KinoLivePanelContext {
  kind: "live";
  live: true;
  channel: { provider: string; code: string; name: string };
  foreign: true;
  source: { pluginId: string; name: string };
  device: "tv" | "phone";
  lang: string;
  tab?: string;
  values: { video: Record<string, KinoPanelValue>; plugin: Record<string, KinoPanelValue> };
  features?: ("loading" | "screen")[];
  state?: Record<string, unknown>;
  size?: { widthClass: KinoScreenSizeClass; heightClass: KinoScreenSizeClass; orientation: "portrait" | "landscape" };
}

/**
 * A screen-format panel's event to `panelAction(event, context)`: a node's action. `trigger` is "press" (a tap or a long
 * press), "change" or "submit"; `name` and `arg` are the node's event; `key` the input that fired (absent for a tap); `values`
 * the inputs' values (`context.state.inputs`). "tab" and "open" stay reserved.
 */
interface KinoPanelScreenEvent {
  key?: string;
  trigger: "press" | "change" | "submit";
  name: string;
  arg?: string;
  value?: unknown;
  values: Record<string, unknown>;
}

/**
 * What `panelAction` answers while the panel is in screen mode (`null` is nothing to do): the screen answer's fields that make
 * sense in a drawer, and the legacy panel's `player`, `message`, `pause` and `panel`. `state` is merged and `panel` asked again
 * with it; `ui` runs Kino's local operations; `config` writes your settings (the screen's rules); `go` takes every shape
 * (title, play, search, browse, section, categories: the panel closes and Kino goes there; `screen`: your screen over the
 * player, `pause` pauses the video; `close`, like `close: true`, closes the panel). `panel` is a whole new result, either format.
 * `dialog`, `sheet`, `menu` and `route` are not honoured inside the panel; `patch`, `values` and `save` are legacy-only: all
 * dropped, logged. A `playerEvent` answer's `panel` (either format) shows in the open panel of that title too (apiVersion 14
 * and later; logged when no panel of that title is open), but a `playerEvent` answer's `state` is never applied: keep it in
 * your own variables (or `kino.storage`) or answer a `panel` built from it. A toast's action on the TV runs from the remote's
 * Menu or Play/Pause key, wherever focus is in the drawer (it never takes focus).
 */
interface KinoPanelScreenAnswer {
  state?: Record<string, unknown> | null;
  toast?: KinoScreenAnswer["toast"]; toastEn?: string;
  ui?: KinoScreenUiOp[];
  config?: KinoScreenAnswer["config"];
  go?: KinoScreenGo | null;
  close?: boolean;
  focus?: string | null;
  player?: KinoPlayerAction;
  message?: string;
  pause?: boolean;
  panel?: KinoPanel | KinoPanelScreenResult;
}

/**
 * Configuration aids in the manifest's `settings` (apiVersion 12; no value, never in kino.config, never required).
 * `link`: a button that opens `url` through the system ONLY when the person taps it (https only, no user info, at most 2048
 * characters; https://t.me/... opens Telegram when installed), with Kino's "Abrir enlace" and the host under it; on TV the
 * address as text plus a QR to open on a phone. Kino makes no request to that host. An address holding one of your secrets is
 * not shown. `help`: a button (your `label`, else Kino's "Ayuda" / "Help") that opens a modal titled with your plugin's name with
 * `title` (at most 60) and `body` (at most 2000; `body` or `bodyEn` required), plain text only: newlines are kept, markup is
 * shown literally, nothing is clickable (use a `link` for an address); scrubbed of your secrets; a missing Spanish or English
 * text falls back to the other. At most 4 of each per plugin; they count among the sections, statuses and actions.
 */
type KinoLinkSetting = { key: string; type: "link"; label: string; labelEn?: string; url: string; hint?: string; hintEn?: string; devices?: KinoSettingDevice[] };
type KinoHelpSetting = { key: string; type: "help"; label?: string; labelEn?: string; title?: string; titleEn?: string; body?: string; bodyEn?: string; devices?: KinoSettingDevice[] };

/**
 * apiVersion 12 (additive): `devices` on any settings item, the devices whose Kino draws it: `["phone"]`, `["tv"]` or both
 * (absent = every device; an unknown device, an empty list or a repeat refuses the manifest). Host side only: on a device it
 * leaves out the item is neither drawn nor checked, but its value is still stored, saved back unchanged, synced, provisioned
 * and read through `kino.config`. Use it for setup a TV cannot do (a token pasted on the phone, sent with "Enviar
 * configuración"). Ignored below apiVersion 12.
 */
type KinoSettingDevice = "phone" | "tv";

/** One entry of the manifest's `settings` (the manifest is JSON: this documents its shape, a `settings` array holds these). */
type KinoManifestSetting =
  | {
      key: string; label: string; labelEn?: string;
      type: "text" | "url" | "password" | "toggle" | "select" | "list" | "section" | "status" | "action";
      hint?: string; hintEn?: string; required?: boolean; default?: string | boolean;
      options?: { value: string; label: string; labelEn?: string }[];
      fields?: { key: string; label: string; labelEn?: string; type: "text" | "url"; hint?: string; hintEn?: string; required?: boolean }[];
      max?: number; confirm?: string; confirmEn?: string;
      devices?: KinoSettingDevice[];
      /**
       * apiVersion 12, on an `action` only: never drawn on any device; it runs only as the `confirm` of another action's `link`,
       * after Kino's own "¿Eres tú?" (a find-then-confirm pair shows the person one button).
       */
      linkOnly?: boolean;
      /**
       * apiVersion 13, on a `password` or a `text` only: `false` keeps the value on the device where it was typed (never sent to a
       * paired device, never set or cleared by one, in no backup or kit). A password one may still be named in a sync `provision`
       * for a one-shot secret (stored device-only on the receiver too), never as the `keySecret`; a text one never in a provision.
       * A text one is still drawn as a plain text field (nothing masked). Default `true`.
       */
      sync?: boolean;
      /**
       * apiVersion 14, on a `toggle` or a `select` only: `"adultCode"` makes Kino ask the device's 18+ code (its own prompt, phone
       * and TV) before the person moves this setting AWAY from its `default` in Kino's settings form (Ajustes, or a screen's or
       * panel's `settings` node); back toward the default never asks. A wrong code or Cancelar keeps the old value; you never see
       * the code. Your own writes may only move it toward the default (an answer's `config` or an action's `setSettings` away
       * from it is refused), and no field may `bind` it: show it with `{ type: "settings", keys: ["<key>"] }`. The value syncs
       * like any setting; the code is asked on each device at the moment of the change.
       */
      unlockWith?: "adultCode";
    }
  | KinoLinkSetting
  | KinoHelpSetting;
type KinoManifestSettings = KinoManifestSetting[];

/** Your module's exports. `resolve` is required, and at least one of `search`/`home` (a catalog-only plugin: see [KinoCatalogOnlyPlugin]). */
interface KinoPlugin {
  /** apiVersion 6, capability "migrate". Return null for anything that is not yours. 10 s per call. */
  migrate?(input: KinoMigrateInput): Promise<KinoMigrateAnswer | null>;
  /** apiVersion 6, required when the manifest declares `section`. `tab` is null the first time. 20 s per call. */
  section?(arg: { tab: string | null }): Promise<KinoSectionAnswer>;
  /**
   * apiVersion 9, required when the manifest declares `panel`: the panel the button opens. Called with the context when it
   * opens, on a tab press and every `refreshMs`. 20 s per call; a panel that is not an object shows nothing.
   */
  panel?(context: KinoPanelContext | KinoPanelScreenContext | KinoLivePanelContext): Promise<KinoPanel | KinoPanelScreenResult>;
  /**
   * apiVersion 9, optional: a button pressed, an input changed or submitted. Called with TWO arguments, `(event, context)`. 20 s
   * per call. While the panel is in screen mode (Task 8i) the event is a `KinoPanelScreenEvent` and the answer a `KinoPanelScreenAnswer`.
   */
  panelAction?(event: KinoPanelEvent | KinoPanelScreenEvent, context: KinoPanelContext | KinoPanelScreenContext | KinoLivePanelContext): Promise<KinoPanelAnswer | KinoPanelScreenAnswer | null | void>;
  /**
   * apiVersion 9, optional, needs no `panel`: told about the playing title's player events (fire and forget: 5 s, at most one
   * in flight, events coalesce). May answer a `player` action, a `message` or (Task 8i, apiVersion 14 and later) a new
   * `panel` for the open panel; anything else is ignored (a `state` is never applied; below apiVersion 14 a `panel` too).
   * `(event, context)`.
   */
  playerEvent?(event: KinoPlayerEvent, context: KinoPanelContext): Promise<KinoPanelAnswer | null | void>;
  /**
   * apiVersion 14, required with "schedule" (Task 8q): one run of one of the manifest's `jobs`, in the background (see
   * `KinoJobFn` and `JobContext`). 20 s per run; the answer is ignored.
   */
  job?(ctx: JobContext): Promise<unknown>;
  /** apiVersion 6, optional, needs `browse`: up to 24 tiles in Categorías, in your order. 20 s per call. */
  categories?(arg: null): Promise<KinoCategory[]>;
  /** With `query.within` (capability "scopedSearch", apiVersion 6): null = "can't search inside this page". 15 s per call. */
  search?(query: KinoSearchQuery): Promise<KinoItem[] | KinoPage | null>;
  home?(): Promise<KinoRow[]>;
  browse?(ref: string, cursor: string | null): Promise<KinoPage>;
  episodes?(ref: string): Promise<KinoEpisodes>;
  /** Kino 0.9.54, optional, no capability, asked only from apiVersion 8 (a RESERVED export name from apiVersion 8): a movie item's details for its title page. 20 s. */
  details?(ref: string): Promise<KinoSeriesInfo | null>;
  /** `options.retry` (apiVersion 6) only when Kino resolves again after the origin refused your stream. `attempt` is 1 to 3; `status` is the origin's HTTP status when Kino heard one. */
  resolve(ref: string, options?: { retry?: { reason: "conflict" | "expired"; attempt: number; status?: 401 | 403 | 409 } }): Promise<KinoStream | KinoPluginByteStream>;
  /**
   * apiVersion 13, required with "byteSource". Kino calls it to play a `{ source: "plugin" }` stream: `handle` is the one
   * you returned, `offset` is a multiple of 4096, `length` is at most 1048576 (1 MiB). Answer with the bytes of that range,
   * base64-encoded; fewer than `length` only at the end of the data.
   */
  read?(arg: { handle: string; offset: number; length: number }): Promise<{ bytes: string }>;
  /**
   * apiVersion 13, required with "imageSource". Kino calls it to draw a {@link KinoImageRef} you returned: `handle` is
   * yours. Answer the picture as {@link KinoImageAnswer} within 10 s. It runs in the background (nobody is asked
   * anything, a slow answer never marks your plugin "No responde"), one call at a time for your plugin and never while
   * one of your byte streams is open; a call that started always runs to its end, so a connection you keep stays open. A
   * timeout discards your sandbox (QuickJS cannot be interrupted), and with it that connection.
   */
  image?(arg: { handle: string }): Promise<KinoImageAnswer>;
  /**
   * apiVersion 6, needed when a stream says `signing: "request"`: headers for one request, computed with
   * kino.crypto / kino.secret only. kino.fetch answers host_not_allowed; kino.storage, kino.cookies and
   * kino.sleep fail with not_allowed. 1.5 s limit.
   */
  sign?(request: { url: string; kind: "playlist" | "segment"; ref: string; context: string }): Promise<{ headers: Record<string, string> }>;
  /** apiVersion 3, capability "channels" (required with it). At most 200 categories. */
  liveCategories?(): Promise<Array<KinoLiveCategory | KinoPlaylist> | KinoPlaylist>;
  /**
   * apiVersion 3, capability "channels" (required with it). At most 500 per page. Kino asks 10
   * pages at first and 5 more each time the person scrolls near the end, up to 10,000 channels.
   */
  liveChannels?(arg: { categoryId: string; cursor: string | null }): Promise<KinoLiveChannelPage | KinoLiveChannel[]>;
  /**
   * apiVersion 3, optional with "channels": channels whose name matches `query`, listed or not (the
   * En vivo search, while some of your channels were never listed). At most 100 kept; `next` ignored.
   * apiVersion 6 with an 18+ category: give every hit `adult` or `categoryId`; an unmarked hit counts as 18+.
   */
  liveSearch?(arg: { query: string }): Promise<KinoLiveChannelPage | KinoLiveChannel[]>;
  /** apiVersion 3, optional with "channels". At most 50 channels and a 24 h window per call. */
  guide?(arg: { channelIds: string[]; from: number; to: number }): Promise<KinoGuideEntry[]>;
  /**
   * apiVersion 10, capability "playlists" (optional with it, like every function below). The
   * playlists already in the person's account on this service.
   */
  playlists?(): Promise<KinoHostedPlaylist[]>;
  /**
   * apiVersion 10, optional with "playlists". A page of one playlist's items, the same shape as
   * {@link KinoPlugin.browse}.
   */
  playlistItems?(arg: { playlistId: string; cursor: string | null }): Promise<KinoPage | KinoItem[]>;
  /**
   * apiVersion 10, optional with "playlists". Absent means Kino never offers "crear lista nueva" for
   * this plugin.
   */
  playlistCreate?(arg: { title: string }): Promise<{ id: string }>;
  /** apiVersion 10, optional with "playlists", independently of playlistRemoveItem. */
  playlistAddItem?(arg: { playlistId: string; ref: string }): Promise<void>;
  /** apiVersion 10, optional with "playlists", independently of playlistAddItem. */
  playlistRemoveItem?(arg: { playlistId: string; ref: string }): Promise<void>;
  /** apiVersion 10, optional with "playlists". The new full order, as a list of every item's `ref`. */
  playlistReorder?(arg: { playlistId: string; refs: string[] }): Promise<void>;
  /**
   * The settings form's texts (manifest, not code): since Kino 0.9.55 a setting may add `labelEn`, `hintEn` and (an action,
   * next to `confirm`) `confirmEn`, an option and a list field `labelEn` (a field also `hintEn`), each with the base field's
   * limits. Kino shows them when the app is in English; the base texts stay the Spanish default and the fallback. apiVersion 9
   * (Kino 0.9.55): below it the keys are unknown and ignored. Your code never sees them: keys and values are the same in both languages.
   */
  /**
   * apiVersion 6: required when a setting has `type: "status"` (or, apiVersion 13, `type: "qr"`). One text per status setting
   * key, shown as-is (at most 200 characters; a missing key or a non-text reads "Sin información"). 10 s. A `qr` setting's
   * key holds the text its QR encodes: 1 to 512 characters, no control character, an http(s) address only https on a public
   * host; anything else (or a text holding a sealed secret) draws no QR. Asked when the form opens, after every action and,
   * with a `qr` setting's `refreshMs`, every that many ms while the form is on screen (never while the previous call runs).
   * apiVersion 13 `hide`: keys of your own settings the form does not draw while this answer is current (values kept, at most
   * 32 read, unknown keys ignored). A `qr` setting with no text draws nothing.
   */
  settingsStatus?(): Promise<{ [key: string]: string | string[] | undefined; hide?: string[] }>;
  /** apiVersion 6: required when a setting has `type: "action"`. Runs when the person presses that button (30 s); the `message` (at most 300 characters, default "Listo") is shown; settingsStatus() is asked again after every action (and when the form opens); `refresh: true` is still accepted and changes nothing. `clearSettings` (up to 12 keys of your own optional, valued settings: not a `required` one, not a section/status/action) is emptied by Kino right after a successful action, as if the person had emptied the field and saved (a password leaves the Keystore; your sandbox closes as for any saved change; `kino.storage` survives); anything else in it is dropped. A throwing action clears nothing. `link` (Kino 0.9.74, additive `action.link`): Kino asks the person with its OWN question ("¿Eres tú, <candidate>?" / "Is this you, <candidate>?", naming your plugin by its manifest `name`) and runs the `confirm` action exactly once only if they confirm; Cancel runs nothing and your plugin hears nothing. `candidate`: 1 to 64 characters after trimming, runs of spaces collapsed; no control or invisible formatting characters, no space but the ASCII one, no blank fillers (U+115F, U+1160, U+3164, U+FFA0, U+2800); scrubbed of your secrets and shown as plain text. `confirm`: the key of ANOTHER `action` setting of this plugin that declares no `confirm`/`confirmEn` question of its own. Anything else refuses the link: your `message` still shows, with Kino's generic error. A `link` in the confirm action's own answer is ignored. `setSettings` (Kino 0.9.74, additive `action.setSettings`): up to 8 of your own `text` or `select` settings and, from apiVersion 13, `password` settings (never a `url`: only the person types a server; never a toggle or list) with string values, checked like typed values (a required one is never emptied; your `validateSettings` is not run); Kino saves them through the form's own save, so they reach the person's other devices like typed values. An unknown or secret key, a non-string, a bad value, a key also in `clearSettings`, a value holding one of your secrets or more than 8 keys refuse the whole field: nothing is applied and the form shows Kino's generic error under your message. A password filled this way (apiVersion 13, a "Create key" action) is stored sealed exactly like a typed one, never logged, and scrubbed from this answer's `message` and `link`, so it is never shown back. */
  action?(key: string): Promise<{ message?: string; refresh?: boolean; clearSettings?: string[]; setSettings?: Record<string, string>; link?: { candidate: string; confirm: string } } | null | void>;
  /**
   * apiVersion 6, optional: checks the values BEFORE Kino saves them (20 s). `null` accepts; `{ key: "mensaje" }`
   * refuses with the message under that field (a key that is not one of your valued settings refuses too, as a
   * general message); a text refuses with that text. If it throws, times out or answers anything else, nothing is
   * saved and the person may "Guardar sin comprobar".
   */
  validateSettings?(values: Record<string, string | boolean | Array<Record<string, string>>>): Promise<Record<string, string> | string | null>;
}

/** A subtitles() track: a Stream's `subtitles` entry plus an optional `label` and `translated` (a machine translation). */
interface KinoSubtitleTrack { lang: string; url: string; format?: "vtt" | "srt"; label?: string; translated?: boolean }

/**
 * `subtitles` -- optional for any plugin (Kino asks every plugin that exports it), required with the capability
 * "subtitles". Tracks for a title Kino knows by IMDb or TMDB id (an episode's ids are the series'); `languages` are ISO
 * 639-1, best first. Checked like a Stream's `subtitles`: 30 kept, then only the person's languages are listed. 10 s, a
 * background call.
 */
type KinoSubtitlesFn = (arg: {
  imdbId?: string; tmdbId?: number; kind: "movie" | "series"; season?: number; episode?: number;
  title?: string; year?: number; languages: string[];
  /**
   * The file playing (Kino 0.9.51+), only what is known, absent when nothing is; never its URL. `hash`: the 16-hex
   * OpenSubtitles hash and `size` the bytes it was computed with; `name`: the file name with its extension.
   */
  file?: { hash?: string; size?: number; name?: string };
}) => Promise<KinoSubtitleTrack[]>;

/** Ids a tracking event carries, each only when known. */
interface KinoTrackingIds { imdb?: string; tmdb?: number; tvdb?: number; anilist?: number; mal?: number }

/**
 * `track(event)`'s argument (apiVersion 7, the "tracking" capability): what the person plays on this device. For a movie
 * `ids` are the movie's; for an episode `ids` are the EPISODE's own (may be `{}`) and the show's are in `show.ids` -- never
 * use the show's ids as the episode's. `watched` fires once, with 3 minutes or less left and at least 90% played.
 */
interface KinoTrackingEvent {
  /** Stable across retries of this event: the idempotency key. */
  id: string;
  type: "start" | "progress" | "stop" | "watched";
  /** When it happened on the device, epoch ms. */
  at: number;
  kind: "movie" | "episode";
  ids: KinoTrackingIds;
  /** A movie's name, or an episode's own name when TMDB has one. */
  title?: string;
  year?: number;
  show?: { title: string; year?: number; ids: KinoTrackingIds };
  season?: number;
  episode?: number;
  positionMs?: number;
  durationMs?: number;
  /** positionMs / durationMs, 0..1. */
  progress?: number;
  /** A `progress` sent because the person paused. */
  paused?: true;
}

/**
 * `track` -- required with the capability "tracking" (apiVersion 7). Return anything (`{ ok: true }`) when delivered; throw
 * `kino.error(code)` otherwise: `timeout`/`network`/`unavailable`/`rate_limited` retry later (in order, with backoff),
 * `auth_required`/`invalid_request`/`not_found`/`geo_blocked`/`host_not_allowed`/`too_large` drop the event. 10 s, a
 * background call.
 */
type KinoTrackFn = (event: KinoTrackingEvent) => Promise<unknown>;

/**
 * `segments(query)`'s argument (apiVersion 7, the "segments" capability): the title that started playing. For a movie `ids`
 * are the movie's; for an episode `ids` are the EPISODE's own (maybe `{}`) and the show's are in `show.ids`.
 */
interface KinoSegmentsQuery {
  kind: "movie" | "episode";
  ids: KinoTrackingIds;
  show?: { ids: KinoTrackingIds };
  season?: number;
  episode?: number;
  /** The playing file's length: answer for that cut. */
  durationMs?: number;
}

/** One segment of the file, in whole ms. Kino uses `intro` and the first `outro`/`credits`; `recap` and `preview` have no button yet. */
interface KinoSegment { type: "intro" | "outro" | "recap" | "credits" | "preview"; startMs: number; endMs: number }

/**
 * `segments` -- required with the capability "segments" (apiVersion 7). Each bad entry is dropped on its own (unknown type,
 * not whole ms, under 1 s, past the file's end, overlapping one of its type); 10 kept. 8 s, a background call.
 */
type KinoSegmentsFn = (query: KinoSegmentsQuery) => Promise<KinoSegment[] | null>;

/** A plugin that plays (`resolve` required, as above), optionally finding subtitles, tracking or segments too. */
interface KinoPlayingPlugin extends KinoPlugin { subtitles?: KinoSubtitlesFn; track?: KinoTrackFn; segments?: KinoSegmentsFn; meta?: KinoMetaFn }

/** A subtitle provider: capabilities only "subtitles" (and maybe "tracking" or "segments"), so `subtitles` is its export. */
interface KinoSubtitleProvider { subtitles: KinoSubtitlesFn; track?: KinoTrackFn; segments?: KinoSegmentsFn }

/** A tracker: capabilities only "tracking" (and maybe "subtitles" or "segments"). */
interface KinoTracker { track: KinoTrackFn; subtitles?: KinoSubtitlesFn; segments?: KinoSegmentsFn }

/** A segment source: capabilities only "segments" (and maybe "subtitles" or "tracking"). */
interface KinoSegmentSource { segments: KinoSegmentsFn; subtitles?: KinoSubtitlesFn; track?: KinoTrackFn }

/**
 * Kino 0.9.54, `"catalogOnly": true` in kino-plugin.json (additive: no new apiVersion, an older Kino ignores the field): a
 * catalog that lists and describes titles and plays none. Kino sends its titles to the person's other sources ("Buscar
 * dónde verlo"), never lists it as a source of a title and never calls its `resolve`. Needs one of `home`, `browse`,
 * `search`, `meta`; refuses `download`, `drm`, `channels`, `streamHosts` and `"browser": true` (`"pages"` is fine). To install
 * on Kino 0.9.53 and older too, keep declaring and exporting `resolve` (throw `kino.error("not_found", …, { userMessage })`)
 * and declare `search` or `home`: those apps ignore the field and require both.
 */
interface KinoCatalogOnlyPlugin extends Omit<KinoPlugin, "resolve" | "sign" | "liveCategories" | "liveChannels" | "liveSearch" | "guide"> {
  /** Only for Kino 0.9.53 and older (which require it): never called from Kino 0.9.54 on. */
  resolve?: KinoPlugin["resolve"];
  subtitles?: KinoSubtitlesFn;
  track?: KinoTrackFn;
  segments?: KinoSegmentsFn;
  meta?: KinoMetaFn;
}

/** Your module's exports: one of these. */
type KinoPluginModule = KinoPlayingPlugin | KinoCatalogOnlyPlugin | KinoSubtitleProvider | KinoTracker | KinoSegmentSource;

// ---------- the kino API ----------

type KinoErrorCode = "auth_required" | "not_found" | "geo_blocked" | "rate_limited" | "unavailable";
type KinoFetchErrorCode = "host_not_allowed" | "timeout" | "network" | "too_large" | "invalid_request" | "rate_limited";
/** Kino 0.9.53: what `kino.meta` and `kino.tmdb` throw besides the fetch codes (see contract.json `kinoMeta`/`kinoTmdb`). */
type KinoServiceErrorCode = "rate_limited" | "not_allowed" | "no_tmdb_key" | "not_found" | "unavailable";

/** Kino 0.9.71, `kino.nuvio.scrapers(query)`: `repo` is a GitHub `owner/repo` or the https address of a Nuvio `manifest.json`, as the person added it. */
interface KinoNuvioScrapersRequest {
  repo: string;
  /** Only these scraper ids (at most 64). */
  scrapers?: string[];
}

/** Kino 0.9.71, `kino.nuvio.streams(query)`: the title by its TMDB id; a series needs `season` and `episode`. */
interface KinoNuvioStreamsRequest extends KinoNuvioScrapersRequest {
  type: "movie" | "series" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  /** How long each scraper may take, 2000 to 60000 ms (default 60000): a scraper that hangs answers `timeout` and hides nothing. */
  timeoutMs?: number;
}

interface KinoNuvioScraper { id: string; name: string }

/** One scraper a repository offers (`kino.nuvio.available`). */
interface KinoNuvioOffered extends KinoNuvioScraper { description: string; types: string[]; languages: string[]; compatible: boolean; installed: boolean }

/** One copy a scraper found: a `Stream`'s fields, copies included; a lazy copy (no address yet) is left out. */
interface KinoNuvioStream {
  url: string;
  mime?: string;
  headers?: Record<string, string>;
  label?: string;
  expiresInSeconds?: number;
  subtitles?: { lang: string; url: string; format?: "vtt" | "srt" }[];
  alternatives?: { url: string; mime?: string; headers?: Record<string, string>; label?: string }[];
}

type KinoNuvioResult =
  | { scraper: KinoNuvioScraper; ok: true; stream: KinoNuvioStream }
  | { scraper: KinoNuvioScraper; ok: false; code: string; message: string };

interface KinoNuvioStreamsAnswer { results: KinoNuvioResult[]; truncated: boolean }

/**
 * Kino 0.9.53, `kino.meta(query)`: the title to ask about. `type` and at least one id; ids are positive integers up to
 * 2147483647 (a number or a digit string) except `imdb` ("tt0133093"). `lang` ("es", "es-MX") goes to the person's meta
 * plugins. Anything else is `invalid_request`; the whole query as JSON is at most 4096 characters.
 */
interface KinoMetaRequest {
  type: "movie" | "series";
  ids: { imdb?: string; tmdb?: number | string; tvdb?: number | string; kitsu?: number | string; mal?: number | string; anilist?: number | string };
  lang?: string;
}

/**
 * Kino 0.9.55, apiVersion 9 (check `kino.meta.byTitle === true` first; below apiVersion 9 or on an older Kino the title is dropped and the query answers `invalid_request`): the title to ask about by
 * name when you have no id. `title` 1..200 characters, `year` 1870..2100 (a number or a 4-digit string; only with `title`).
 * Kino searches TMDB (the type's own search, es-MX, first page) and keeps the hit whose es-MX or original title equals
 * yours once both are normalised (lowercase, no accents, punctuation as spaces); with `year`, that exact year wins, else
 * one a year off. Two hits that tie (same title and year, or same title and no year) or no match: the answer is null,
 * never a guess. Then it answers exactly as for ids (same shape, `ids` filled in, same cache, budget and timeout). With
 * `ids` too, the ids win.
 */
interface KinoMetaTitleRequest {
  type: "movie" | "series";
  title: string;
  year?: number | string;
  lang?: string;
}

/**
 * Kino 0.9.53, what `kino.meta` answers (or null: nobody knew the title). Merged the way Kino's info page merges: Kino's
 * own TMDB lookup first (Spanish, es-MX), AniList for an anime, then the person's other `meta` plugins, each only filling
 * what the earlier ones left empty (ratings add up). Every field but `ids` and `sources` appears only when known.
 */
interface KinoMetaAnswer {
  title?: string;
  /** Up to 2000 characters, HTML stripped. */
  overview?: string;
  /** "1999". */
  year?: string;
  poster?: string;
  backdrop?: string;
  /** A clear-logo of the title (its name drawn as art). */
  logo?: string;
  /** At most 5. */
  genres?: string[];
  /** A movie's runtime, 1..1000 (never a series'). */
  runtimeMinutes?: number;
  tagline?: string;
  /** Age rating ("12+", "PG-13"). */
  certification?: string;
  /** A movie's directors, or a series' creators. */
  directors?: string[];
  /** A series' episodes, at most 5000 (trimmed from the end to keep the answer under 1,000,000 characters); `id` is the Stremio-style video id ("tt0944947:1:1"). */
  episodes?: { season: number; number: number; title?: string; overview?: string; still?: string; airDate?: string; id?: string }[];
  /** Every id Kino knows for the title, the ones you asked with included. */
  ids: { imdb?: string; tmdb?: number; tvdb?: number; kitsu?: number; mal?: number; anilist?: number };
  /** At most 6, one per source; TMDB's own vote is `{ source: "tmdb" }`. */
  ratings?: { source: "imdb" | "tmdb" | "rottentomatoes" | "metacritic" | "letterboxd" | "mal" | "anilist" | "trakt"; value: string }[];
  /** At most 20. */
  cast?: { name: string; character?: string; photo?: string }[];
  /** Who contributed to this answer. */
  sources: ("tmdb" | "anilist" | "plugin")[];
}
type KinoEncoding = "utf8" | "hex" | "base64";
type KinoKeyType = "ec" | "ed25519" | "x25519";
/** A public key as a JWK, in WebCrypto's key order: EC `{ crv, kty: "EC", x, y }`, OKP `{ crv: "Ed25519" | "X25519", kty: "OKP", x }` (base64url, no padding). */
interface KinoJwk { readonly crv: string; readonly kty: "EC" | "OKP"; readonly x: string; readonly y?: string }
/** apiVersion 6: a handle to a private key that lives only inside Kino, in this runtime. */
interface KinoPrivateKey { readonly type: KinoKeyType; readonly namedCurve?: "P-256" | "P-384"; readonly handle: string }
/** apiVersion 6: `spki` is DER as base64; `raw` is base64 (an uncompressed point 04||x||y for ec, 32 bytes otherwise). */
interface KinoPublicKey { readonly type: KinoKeyType; readonly namedCurve?: "P-256" | "P-384"; readonly jwk: KinoJwk; readonly spki: string; readonly raw: string }

interface KinoError extends Error {
  /** `KinoError_<code>` (e.g. `KinoError_not_found`). */
  readonly name: string;
  readonly code: KinoErrorCode | KinoFetchErrorCode | KinoServiceErrorCode | "crypto_error" | "unknown";
  /**
   * The sentence you passed as `{ userMessage }`, cut at 161 characters; absent when you passed none. On a `no_tmdb_key`
   * from `kino.tmdb` (Kino 0.9.53) it is Kino's own sentence for the person, in their language: show it as is.
   */
  readonly userMessage?: string;
  /**
   * Kino 0.9.55: on a `host_not_allowed` from `kino.fetch`, the host Kino refused (at most 253 characters), so you never
   * have to read it out of the message. Absent on older Kino and when no one host was refused (the signing lane).
   */
  readonly host?: string;
}

interface KinoErrorOptions {
  /**
   * Your own sentence for the person, shown INSTEAD of Kino's line for the code as "Mensaje de <plugin>: <sentence>",
   * only when: your plugin's name has no ":", no digit glued to a letter, spells no Kino and uses only the characters
   * below; the code is one of
   * the five `KinoErrorCode`s; it is 1..160 characters once trimmed, made only of Basic Latin and Latin-1 letters
   * (á é í ó ú ü ñ ç ã õ…, not ø æ ð þ ß), digits 0-9, the plain space and . , : ; ¿ ? ¡ ! ' ’ ‘ “ ” « » ( ) % - – — ▸
   * (; only before a space); it reads as
   * plain words (two or more, no URL, no "TypeError:" prefix, no undefined/null/NaN, not ending in : , ; -); fewer than
   * 6 digits in all and none glued to a letter; no domain (site.app, site .app, site. app, www, punto/dot + com, app…);
   * no "kino" once 1 l ! ¡ read as
   * i, 0 as o and non-letters dropped; no credential, money or contact stem (pag…, abon…, recarg…, transfer…,
   * contraseñ…, passw…, clave…, token…, tarjeta, PIN, Nequi, Daviplata, WhatsApp, Telegram, SMS/verification code);
   * and none of the person's passwords or a sealed value. Otherwise Kino's line stays. A host the person refused still
   * wins, whatever the code. It counts only for the call that built the error. Older Kino builds ignore it. Plugins
   * that use it to ask for money, credentials or contact outside Kino are removed from the catalog.
   */
  userMessage?: string;
}

interface KinoFetchOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** A string, or JSON, a form, or raw bytes as base64. URL + headers + body at most 1,048,576 characters. */
  body?: string | { json: unknown } | { form: Record<string, string | number | boolean> } | { base64: string };
  /** "follow" (default, at most 10 hops, each host-checked) or "manual" (returns the 3xx). */
  redirect?: "follow" | "manual";
  /** true (default): send and store cookies from the plugin's jar. */
  cookies?: boolean;
  /** Default 15000, at most 30000. */
  timeoutMs?: number;
  /**
   * apiVersion 14: read at most this many bytes of the body (1 to 2,000,000), then stop: the rest is never downloaded and
   * the answer's `truncated` is true (a plugin with sealed `secrets` gets the same answer, but the body is read whole, up to
   * 5 MB, and redacted before the cut). Bytes after decompression; a cut text may end inside a character. Out of range:
   * `invalid_request`. Below apiVersion 14 the option is ignored.
   */
  maxBytes?: number;
  /**
   * apiVersion 14: end the read as soon as the text holds this marker (1 to 32 printable ASCII characters, ASCII
   * case-insensitive), keeping everything up to and including it; `truncated` is true when more followed. Text responses
   * only (a byte answer fails with `invalid_request`). With `maxBytes`, whichever comes first. Below apiVersion 14 ignored.
   * Example: `{ stopAt: "</head>", maxBytes: 65536 }` reads a page's head and nothing more.
   */
  stopAt?: string;
}

interface KinoResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
  /** Lower-cased names; repeated headers joined with ", "; never set-cookie. */
  readonly headers: Readonly<Record<string, string>>;
  text(): string;
  json(): any;
  /** The body bytes (at most 5 MB) as base64. */
  base64(): string;
  /** apiVersion 14: true when the body was cut at the request's `maxBytes` (false otherwise; absent below 14). */
  readonly truncated?: boolean;
}

interface KinoHtmlMatch {
  text: string;
  html: string;
  attrs: Record<string, string>;
}

interface KinoCipherOptions {
  key: string;
  iv?: string;
  data: string;
  /** CBC/ECB only. Default "pkcs7". */
  padding?: "pkcs7" | "none";
  /** GCM only: additional authenticated data. */
  aad?: string;
  /** Default utf8 to encrypt, base64 to decrypt. */
  inputEncoding?: KinoEncoding;
  /** Default base64 from encrypt, utf8 from decrypt. */
  outputEncoding?: KinoEncoding;
  keyEncoding?: KinoEncoding;
  ivEncoding?: KinoEncoding;
  aadEncoding?: KinoEncoding;
}

type KinoCipher =
  | "aes-128-cbc" | "aes-192-cbc" | "aes-256-cbc"
  | "aes-128-ecb" | "aes-192-ecb" | "aes-256-ecb"
  | "aes-128-ctr" | "aes-192-ctr" | "aes-256-ctr"
  | "aes-128-gcm" | "aes-192-gcm" | "aes-256-gcm"
  | "des-ede3-cbc" | "des-ede3-ecb";

/** apiVersion 6: `kino.browser.capture` options. */
interface KinoBrowserCaptureOptions {
  /** 1..25000 ms; default 18000. */
  timeoutMs?: number;
  /** Extra headers for the first page load only (a `Referer` an embed insists on). */
  headers?: Record<string, string>;
  /** A regular expression (case-insensitive, up to 500 characters) for what counts as the video request; default: m3u8, mpd, mp4, `master.txt`, `videoplayback`, `/hls/`. */
  match?: string;
  /** Default true: mute and start the page's player, click common play buttons, tap the middle. Off with `waitForCookie`. */
  autoplay?: boolean;
  /**
   * Kino 0.9.54 (check `kino.browser.captureAll` first; older Kino ignores it): collect EVERY request matching `match`
   * (or the default media pattern) or one of `alsoMatch`, deduplicated by URL, at most 20, until the page settles (the
   * first match was seen and nothing new matched for 1 s) or `timeoutMs`. The answer then has `requests`.
   */
  captureAll?: boolean;
  /** Kino 0.9.54, only with `captureAll`: 1..10 more patterns (up to 500 characters each, case-insensitive) whose requests are collected too, never held back from the page. */
  alsoMatch?: (string | RegExp)[];
  /**
   * Kino 0.9.54: a cookie name (an HTTP token, e.g. `"cf_clearance"`) the page must also hold for its current host.
   * Without `match` no request is needed: the page ends as soon as the cookie is there (a cookie-only page). Kino never
   * autoplays or taps a page that waits for a cookie. With `captureAll` it needs a `match`.
   */
  waitForCookie?: string;
  /** Kino 0.9.54: a page that runs out of time answers what it had, with `timedOut: true`, instead of throwing `timeout`. */
  returnCookiesOnTimeout?: boolean;
}

/** apiVersion 6: what `kino.browser.capture` saw. */
interface KinoBrowserCapture {
  /** At most 8, manifests first. `headers` carries Referer, User-Agent and, when the request had them, Origin and Cookie. */
  media: { url: string; mime?: string; headers: Record<string, string> }[];
  /** `.vtt`/`.srt` requests the page made, at most 10. */
  subtitles: { url: string; lang?: string }[];
  /** The top page's last address. */
  finalUrl: string;
  /**
   * Kino 0.9.54, only when the call used `captureAll`, `waitForCookie` or `returnCookiesOnTimeout`: the matching requests
   * (at most 20) with the method and headers the page sent, the first match first. On a timeout answer without a match,
   * only `alsoMatch` hits (or none): check each URL against your own patterns.
   */
  requests?: { url: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"; headers: Record<string, string> }[];
  /** Kino 0.9.54, same condition: the final page's cookies (at most 64, 16,384 characters in all, Cloudflare's `cf_*`/`__cf*` kept first). */
  cookies?: Record<string, string>;
  /** Kino 0.9.54, same condition: the hidden page's user agent (the one Cloudflare ties `cf_clearance` to). */
  userAgent?: string;
  /** Kino 0.9.54, same condition: true only for a `returnCookiesOnTimeout` page that ran out of time. */
  timedOut?: boolean;
}

/** apiVersion 6, `"browser": "pages"`: `kino.browser.page` options. */
interface KinoBrowserPageOptions {
  /**
   * 1..25000 ms; default 15000. Counts inside your call's own time limit; Kino cuts it to what is left of that limit
   * minus 1.5 s. Pass about 12000 in `search` (15 s for the whole call).
   */
  timeoutMs?: number;
  /**
   * A JavaScript regular expression (source string or RegExp, whose `m` and `s` flags are kept; matched
   * case-insensitively against the page's HTML, up to 500 characters): the page is returned only once it matches. Without it, as soon as the page is loaded and is no
   * longer the site's browser check page. Use it for pages that fill in their list with scripts.
   */
  waitFor?: string | RegExp;
}

/** apiVersion 6, `"browser": "pages"`: what `kino.browser.page` read. */
interface KinoBrowserPage {
  /** The doctype and the DOM's outerHTML (after the page's scripts ran), at most 2,000,000 characters. Feed it to `kino.html.select`. */
  html: string;
  /** The top page's last address (after redirects and the browser check). */
  finalUrl: string;
  /** The HTTP status of the top page's last load: 200 unless that load answered an error. */
  status: number;
  /** True when `html` was cut at 2,000,000 characters. */
  truncated: boolean;
}

/** `kino.cloudstream` (converted plugins only): one result of a CloudStream provider's search or main page. */
interface CsItem {
  name: string;
  url: string;
  type?: string;
  poster?: string;
  posterHeaders?: Record<string, string>;
  year?: number;
  quality?: string;
  provider?: string;
}

/** `kino.cloudstream` (converted plugins only): what a CloudStream provider's `load` says about a title. */
interface CsTitle {
  name: string;
  url: string;
  type?: string;
  plot?: string;
  poster?: string;
  background?: string;
  year?: number;
  tags?: string[];
  rating?: number;
  durationMin?: number;
  kind?: string;
}

/** `kino.cloudstream` (converted plugins only): one episode of a title; `data` is what `loadLinks` takes. */
interface CsEpisode {
  data: string;
  season?: number;
  episode?: number;
  name?: string;
  poster?: string;
  description?: string;
  date?: number;
  dubStatus?: string;
}

/** `kino.cloudstream` (converted plugins only): a playable link, already filtered (public https only) and ranked by Kino. */
interface CsLink {
  url: string;
  name: string;
  quality: number;
  linkType: "VIDEO" | "M3U8" | "DASH";
  headers: Record<string, string>;
}

/** apiVersion 14, capability `"ai"` (Task 8r): what `kino.ai.ask` takes (contract.json `kinoAi`). */
interface KinoAiAskOptions {
  /** The text to send: a non-empty string of at most 8192 UTF-8 bytes. It leaves the device: say so in your own UI. */
  prompt: string;
  /** Your instructions to the model, at most 2048 UTF-8 bytes. Kino adds no persona of its own. */
  system?: string;
  /** true ASKS the model for JSON only; the reply still comes back as the model wrote it, parseable or not. */
  json?: boolean;
  /** The reply is cut at this many characters: a whole number from 1 to 4096 (default 2048). */
  maxChars?: number;
}

/**
 * apiVersion 14, capability `"ai"`: what `kino.ai.ask` answers. Never thrown: a failure is `ok: false` with one of the codes;
 * `message` is Kino's English detail for you, never for the person. `model` is only the name of the model that answered.
 */
type KinoAiAnswer =
  | { ok: true; text: string; model: string }
  | { ok: false; error: "unavailable" | "rate_limited" | "too_large" | "timeout" | "refused"; message: string };

/**
 * apiVersion 14, capability `"library"`: one title the person watched or saved, as `kino.library` gives it (contract.json
 * `kinoLibrary`). Nothing else ever comes: no stream, no plugin ref, no Kino id, no profile.
 */
interface KinoLibraryEntry {
  /** The title's name as Kino shows it (TMDB's when Kino identified it), at most 200 characters. */
  title: string;
  /** Only when Kino knows it (a saved title's card year); usually absent on a watched one. */
  year?: number;
  kind: "movie" | "series";
  /** Each only when Kino knows it; may be empty. */
  ids: { tmdb?: number; imdb?: string };
  /** `watched` only: how far the most recent playback of this title went, 0..1 in steps of 0.01 (1 when finished). */
  progress?: number;
  /** `watched` only: when it was last played, rounded down to the day (UTC midnight, ms since the epoch). */
  watchedAtMs?: number;
}

/** `kino.library.watched`'s options: `limit` 1..100 (default 50; above 100 gives 100), `kind` filters, `sinceMs` keeps titles played on that day (UTC) or later: it is rounded down to the day, like `watchedAtMs`. A number that is not finite is `bad_request`. */
interface KinoLibraryWatchedOptions { limit?: number; kind?: "movie" | "series"; sinceMs?: number }

/** `kino.library.saved`'s options: `limit` 1..100 (default 50), `kind` filters. */
interface KinoLibrarySavedOptions { limit?: number; kind?: "movie" | "series" }

/** What `kino.library` throws (contract.json `kinoLibrary.errorCodes`). */
type KinoLibraryErrorCode = "permission_denied" | "rate_limited" | "bad_request";

/** apiVersion 14, `kino.room.open`'s options. */
interface KinoRoomOpenOptions {
  /** Minutes the room lives, 10..240 (default 120). The endpoint and its internet route close when it is over. */
  ttlMin?: number;
  /** Members including you (the host), 2..8 (default 6). */
  max?: number;
  /** Your name as the guests see it, at most 40 characters (control and direction characters removed). */
  name?: string;
  /**
   * Task 8w: a shorter numeric code, 4..12 digits (default 12; anything else is `bad_request`). A short code (a friends'
   * Watch Party) keeps strangers out only because the words cannot be guessed and the room closes itself after 30 wrong codes;
   * whoever captures the traffic and knows the words (the tunnel provider) recovers a 4-digit code offline in milliseconds,
   * so such a room is NOT private from the provider. The default 12 digits makes that expensive, not impossible.
   */
  codeDigits?: number;
  /**
   * Open ANOTHER door to a room you are in (a backup endpoint with its own words): the room's code. Refused
   * (`permission_denied`) unless this plugin is a member of a room with that code right now, or opened it itself. Its
   * expiry is capped at the room's.
   */
  code?: string;
}

/** What `kino.room.open` answers. Show `words` and `code` to the person (or send `words` to the members in a message). Never a URL. */
interface KinoRoomOpened {
  /** The room's secret: 12 digits, or the `codeDigits` you asked for. Show it grouped (`1234 5678 9012`); spaces and hyphens are ignored on `join`. */
  code: string;
  /** The endpoint's public words (`brave-river-cat-moon`). Anyone may see them; the code is what lets people in. */
  words: string;
  expiresAtMs: number;
}

/** apiVersion 14, `kino.room.join`'s options: the words and code the host's person shared, and the name the others see (at most 24 characters). */
interface KinoRoomJoinOptions { words: string; code: string; name?: string }

/** What `kino.room.join` answers. Keep `handle`: it names this session in `send`, `inbox`, `members` and `close`. */
interface KinoRoomJoined {
  handle: string;
  memberId: string;
  host: { name: string };
  expiresAtMs: number;
}

/** `"hosted"` (the room this device hosts) or a `handle` from `join`. Absent: the first joined session, else the hosted one. */
type KinoRoomSession = string;

/** `kino.room.send`'s options. The host may write to one `memberId` or everyone (absent or `"all"`); a guest to the host (absent or `"host"`) or `"all"`. */
interface KinoRoomSendOptions { to?: string; session?: KinoRoomSession }

/** `kino.room.inbox`'s options: events after `since` (pass the last answer's `last`), at most `limit` (1..50, default 50). */
interface KinoRoomInboxOptions { since?: number; limit?: number; session?: KinoRoomSession }

/** One mailbox event: a message, someone joining or leaving, or the room closing. `seq` only grows. */
interface KinoRoomEvent {
  seq: number;
  /** A `memberId`, or `"host"`. */
  from: string;
  kind: "msg" | "join" | "leave" | "closed";
  /** `msg` only: the object the sender passed to `send`, as Kino re-serialised it. Never executed by Kino; treat it as untrusted data. */
  payload?: object;
  /** `join` only: the member's display name. */
  name?: string;
}

/** What `kino.room.inbox` answers. `reachable` is false when a guest's last poll of its host got no answer (your failover cue). */
interface KinoRoomInbox { events: KinoRoomEvent[]; last: number; more: boolean; reachable: boolean }

/** A room member: never an address, only the id Kino gave it, its chosen name, and whether it is the host. */
interface KinoRoomMember { memberId: string; name: string; host: boolean }

/** What `kino.room.state` answers: this plugin's sessions on this device. */
interface KinoRoomState {
  role: "host" | "guest" | "none";
  joined: { handle: string; memberId: string; host: { name: string }; expiresAtMs: number; reachable: boolean }[];
  hosted: { code: string; words: string; expiresAtMs: number; members: number } | null;
}

/** What `kino.room` throws (contract.json `kinoRoom.errorCodes`); `room_unreachable` and the room refusals carry Kino's own `userMessage`. */
type KinoRoomErrorCode = "room_denied" | "room_closed" | "room_full" | "room_unreachable" | "room_busy" | "rate_limited" | "permission_denied" | "bad_request";

/** apiVersion 13, `kino.ws.open`: a connected WebSocket carrying binary messages. */
interface KinoWebSocket {
  /** Sends one binary message of at most 786000 bytes (`"too_large"` above). `await` it: it rejects with code `"closed"` when the socket is no longer open. */
  send(data: Uint8Array): Promise<void>;
  /**
   * Sends one binary message given as a string in `encoding`: `"hex"` (an even number of digits, either case) or `"base64"`
   * (standard alphabet, padded, no whitespace). Kino decodes it natively, so no JavaScript loop touches the bytes: for a
   * binary protocol whose bytes already live as hex in your code (`kino.crypto` results, a packet you built), this is the
   * fast path. The 786000-byte cap is on the decoded bytes (`"too_large"`); a string that is not exactly that encoding
   * rejects with `"invalid_request"`, as does an `encoding` other than these two.
   * @example
   * await ws.send("efefefef", { encoding: "hex" });
   * await ws.send(kino.crypto.aesIge("encrypt", key, iv, plain, { keyEncoding: "hex", ivEncoding: "hex", inputEncoding: "hex", outputEncoding: "hex" }), { encoding: "hex" });
   */
  send(data: string, options: { encoding: "hex" | "base64" }): Promise<void>;
  /**
   * Waits up to `timeoutMs` (default 30000, at most 60000) for the next message: resolves with it, or with null when none
   * came in time. Rejects with code `"closed"` once the socket is closed and nothing is left queued (`"limit"` when it was
   * closed for holding more than 8 MiB of unread messages).
   */
  recv(timeoutMs?: number): Promise<Uint8Array | null>;
  /**
   * As `recv(timeoutMs)`, but the message comes as a string in `encoding`, `"hex"` (lower case) or `"base64"` (padded),
   * encoded natively by Kino. Building a `Uint8Array` costs a JavaScript pass over every byte (QuickJS interprets each
   * iteration); for anything big prefer an encoded frame and hand it on as it is, e.g. to `kino.crypto` with the same
   * `inputEncoding`. Rejects with `"invalid_request"` for an `encoding` other than these two, before waiting.
   * @example
   * const hex = await ws.recv(10000, { encoding: "hex" });   // "0a1b..." (2 characters per byte), or null
   */
  recv(timeoutMs: number | undefined, options: { encoding: "hex" | "base64" }): Promise<string | null>;
  /** Closes the socket; later calls reject with `"closed"`. Closing twice is harmless. */
  close(): Promise<void>;
}

/**
 * apiVersion 13, `kino.catalog`: one item as you give it to `upsert`. Only these four fields are kept; anything else is
 * dropped before it reaches Kino.
 */
interface KinoCatalogUpsertItem {
  /**
   * Your own key for the item (a message id, a video id, a URL), 1 to 128 characters (longer is `"too_large"`, empty or not a
   * string is `"invalid_request"`). Upserting an id that is already there REPLACES that item whole (title, sort and data).
   */
  id: string;
  /**
   * What `search` matches and what the "title" order sorts by: at most 300 characters (longer is `"too_large"`). Kino keeps
   * a copy lower-cased and without accents for the search ("Película" is found by "pelicula", "PELICULA" or "película").
   */
  title: string;
  /**
   * A whole number for the "newest" (descending) and "oldest" (ascending) orders, for example a date in ms or a message id.
   * Default 0. Must be a safe integer (at most 2^53 - 1 in size); a fraction, `NaN` or `Infinity` is `"invalid_request"`.
   */
  sort?: number;
  /**
   * Small display fields you want back with the item (a poster URL, a duration, a file reference), a plain object whose
   * JSON is at most 4,096 bytes in UTF-8 (`"too_large"` above; an array, a string or a number is `"invalid_request"`).
   * Not searched. Not a place for blobs or credentials.
   */
  data?: Record<string, unknown> | null;
}

/** apiVersion 13, `kino.catalog`: one stored item as `search` and `get` answer it. */
interface KinoCatalogItem {
  id: string;
  title: string;
  /** 0 when you gave none. */
  sort: number;
  /** The object you stored, parsed again; null when you gave none. */
  data: Record<string, unknown> | null;
}

/** apiVersion 13, `kino.catalog.search`'s options. Every field is optional; anything else is dropped. */
interface KinoCatalogSearchOptions {
  /**
   * Words to find, at most 256 characters (`"too_large"` above). Split on whitespace; EVERY word must appear somewhere in
   * the title (AND, any order, as a substring: "gat roj" finds "Gato rojo"), ignoring case, accents and control characters
   * other than whitespace (a NUL, an escape code). `%`, `_` and `\`
   * are plain characters, never wildcards. Empty, blank or absent lists everything.
   */
  q?: string;
  /** Items per page: default 50, at most 100 (`"too_large"` above, `"invalid_request"` below 1, for a fraction, `NaN` or `Infinity`). */
  limit?: number;
  /** Items to skip: default 0, at most 1,000,000 (`"too_large"` above, `"invalid_request"` for a negative, fractional or non-finite number). */
  offset?: number;
  /**
   * "newest" (default): `sort` descending, then `id`; "oldest": `sort` ascending, then `id`; "title": the title without case
   * or accents, then the title as written, then `id`. Ties are always broken by `id`, so paging is stable.
   */
  order?: "newest" | "oldest" | "title";
}

/** apiVersion 13, `kino.catalog.search`'s answer: one page and the count of every match. */
interface KinoCatalogPage {
  /** At most `limit` items, in the order asked. */
  items: KinoCatalogItem[];
  /** How many items match `q` in all (not just this page): compare it with `offset + items.length` to know if there is more. */
  total: number;
}

declare namespace kino {
  const apiVersion: number;
  /** Kino's version name, for example "0.9.56" ("sdk" in the Node kit). */
  const appVersion: string;
  /**
   * The language Kino speaks now, as a tag: "es-CO" or "en-US" (`kino.lang.slice(0, 2)` for the bare "es"/"en"). It follows
   * the person's choice in Ajustes ▸ App ▸ Idioma: on a change Kino closes the plugin's runtime and the next call opens a
   * new one with the new value (a `sign()` lane keeps the old one), so read it per call, not into a long-lived cache.
   */
  const lang: string;
  /**
   * Kino 0.9.55+: the UI Kino shows on this device, `"tv"` (remote control, ten-foot screen) or `"phone"` (touch; a
   * tablet gets whatever Kino shows it, usually `"phone"`). Same value for every apiVersion and every call while Kino
   * runs; no permission, it says nothing about the person. `undefined` on an older Kino. The Node kit says `"phone"`
   * unless `run.mjs --device tv` or `KINO_DEVICE=tv`.
   */
  const device: "tv" | "phone" | undefined;
  /**
   * Kino 0.9.55+: `true` when THIS install's `kino.fetch` may reach any public host -- the manifest declares
   * `"fetchHosts": "any"`, the plugin qualifies (apiVersion 9 or later, or converted from a Nuvio scraper) and the
   * person approved its red consent line. `false` otherwise; `undefined` on an older Kino (keep your own fallback).
   */
  const fetchAnyHost: boolean | undefined;

  /**
   * Only to the manifest's hosts over https (http only on a host declared `insecureHttp`), or to the person's own server as typed.
   * With `fetchAnyHost` true, also any PUBLIC host over https on port 443, at a public IPv4 address or a dotted name (never
   * the home network, never a single-label name; a sealed secret still only goes to the manifest's own hosts over https).
   * Those requests spend a budget kept for the whole app: at most 60 a minute per site and 600 every 10 minutes per plugin
   * (250 / 2,500 for a converted Nuvio scraper), then `rate_limited`; declared hosts never spend it (declare your main
   * sites). From Kino 0.9.55; a hidden page's start address and a capture's top-level navigations to a host reachable
   * only through the grant follow the same https / port 443 / dotted-name rule (declared hosts keep theirs); its
   * subresources do not.
   * Never throws for a non-2xx status.
   */
  function fetch(url: string, options?: KinoFetchOptions): Promise<KinoResponse>;

  /**
   * `throw kino.error("not_found", "…")`: the app words the message; yours is a detail of at most 200 characters.
   * `throw kino.error("not_found", "…", { userMessage: "Este capítulo ya no está disponible." })`: your own sentence
   * for the person, shown instead of Kino's line when it is safe (see `KinoErrorOptions`).
   */
  function error(code: KinoErrorCode, message?: string, options?: KinoErrorOptions): KinoError;

  /** 0..5000 ms, counts inside the call's own timeout. */
  function sleep(ms: number): Promise<void>;

  /**
   * Kino 0.9.53 (no new apiVersion: absent on older Kino, so check `typeof kino.meta === "function"` first). Asks Kino about
   * a title and answers what it knows, without your plugin ever touching a TMDB key: Kino's own TMDB lookup (its app
   * feature, the one its info page uses), AniList for an anime, then the person's installed `meta` plugins (never yours,
   * and none at all when called from your own `meta` export). Null when nobody knows the title (never an error).
   * At most 30 calls a minute per plugin (`rate_limited`); 8 s at most, inside your call's own time limit; cached 30 min.
   * Throws `invalid_request` (a bad query), `rate_limited`, `not_allowed` (from `sign()`).
   */
  function meta(query: KinoMetaRequest | KinoMetaTitleRequest): Promise<KinoMetaAnswer | null>;
  namespace meta {
    /** Kino 0.9.55, apiVersion 9: true when `kino.meta` takes `{ type, title, year? }` (KinoMetaTitleRequest); absent before. */
    const byTitle: true | undefined;
  }

  /**
   * Kino 0.9.53 (no new apiVersion: check `typeof kino.tmdb === "function"` first). A GET to TMDB's v3 API
   * (`https://api.themoviedb.org/3` + `path`) with no key in your plugin. Kino's own TMDB key goes first, behind Kino's
   * TMDB cache, a shared in-flight request and its own limits (at most 20 calls per 10 s per plugin and 60 per 10 s for
   * all plugins on Kino's key). Only when Kino's key fails (TMDB answers 401/403/429 for it, or one of those limits is
   * spent) does the same request go again with the PERSON'S key: the one they typed in Ajustes ("Tu llave de TMDB",
   * optional), else the one they configured in an installed Stremio addon (once they agree). With neither, a cached copy
   * up to 7 days old, else `rate_limited`. A key your plugin keeps in its own settings is never used. Your plugin never
   * sees any key and needs no `hosts` entry for TMDB. `path` starts with /discover, /trending, /search, /movie, /tv,
   * /find, /genre, /configuration, /person or /collection, without the version and without a query string; `params` (at
   * most 20; never `api_key` or a session) become the query. Answers the parsed JSON body (a cached copy when TMDB is down
   * or unreachable). At most 40 calls per 10 s per plugin whichever key; bodies up to 2 MiB; cached 10 min in memory by
   * path and params, and on disk with Kino's TMDB cache. Throws `no_tmdb_key` (only on a Kino build without a key of its
   * own and a person without one: `e.userMessage` is Kino's sentence telling the person what to do), `invalid_request`,
   * `rate_limited`, `not_found`, `too_large`, `timeout`, `network`, `unavailable`, `not_allowed` (from `sign()`).
   */
  function tmdb(path: string, params?: Record<string, string | number | boolean>): Promise<any>;

  /**
   * Kino 0.9.71, apiVersion 11, needs `"nuvio"` in the manifest's `capabilities` (a declarative capability; the consent sheet says "Instala y usa
   * scrapers de Nuvio del repositorio que indica para buscar enlaces"; check `typeof kino.nuvio === "object"` first). EXPERIMENT. You name
   * your Nuvio repositories in the manifest's `nuvioRepos` (1 to 4, `owner/repo`; the capability needs it) and `kino.nuvio` refuses any other (`not_allowed`).
   * The scrapers you install are yours: Kino does not list them among the person's plugins, counts them under yours and removes them with it. The app installs the scrapers you ask for exactly as the importer does for a person (same reader, same conversion, same
   * torrent filter: a P2P-only scraper is listed as not compatible and never installed), with nothing for the person to do, then asks each for a
   * title and hands you what it found, to sort, merge and label as you like. Nothing is run or downloaded by your plugin: every scraper keeps
   * the importer's own hosts, request budget and 75 s limit, and a plugin that declares `nuvio` gets the same 75 s for its own `resolve`.
   * Only inside one of your functions. At most 20 calls a minute; up to 12 scrapers per `use` or `streams` call (`streams` asks 4 at a time).
   * Throws `invalid_request` (a bad query), `rate_limited`, `unavailable` (the repository cannot be read), `not_allowed` (the capability is
   * not declared, or from `sign()`).
   */
  namespace nuvio {
    /** What `repo` offers, read by the importer: each scraper's id, name, types (`movie`, `tv`, `anime`) and languages, whether it is `compatible` and whether it is already `installed`. */
    function available(query: { repo: string }): Promise<KinoNuvioOffered[]>;
    /**
     * Makes sure each scraper in `scrapers` (at most 12) is installed, installing the missing ones one after another (up to 45 s each). A scraper that
     * cannot be installed is in `failed` (`refused` for a torrent-based one, `not_found`, `timeout`, `failed`) and the rest go on.
     */
    function use(query: { repo: string; scrapers: string[] }): Promise<{ ready: string[]; failed: { id: string; code: string; message: string }[] }>;
    /** The scrapers of `repo` that are installed and on right now (18+ ones are never listed), in install order. */
    function scrapers(query: KinoNuvioScrapersRequest): Promise<KinoNuvioScraper[]>;
    /**
     * One answer per scraper asked, in install order. A scraper that fails or takes longer than 60 s is an entry with `ok: false`, never a
     * throw, so one slow source hides nothing. `truncated` is true when more than 12 scrapers were installed and only the first 12 were asked.
     */
    function streams(query: KinoNuvioStreamsRequest): Promise<KinoNuvioStreamsAnswer>;
  }

  /**
   * apiVersion 14, needs `"library"` in the manifest's `capabilities` (declarative, no export). What the person watched and saved
   * in Kino, read-only, from the profile in use: never another profile, never an 18+ title (even with the 18+ code unlocked),
   * never a stream URL or another plugin's ref. Newest first, one entry per title (a series' chapters fold into one).
   * The person approves it at install, and again on the update that adds it, on a RED consent line: "Podrá leer lo que has
   * visto y guardado en Kino, y enviarlo a sus servicios" / "Can read what you have watched and saved in Kino, and send it to
   * its services", next to your declared hosts. They can switch it off later in your tab in Ajustes; every call then rejects
   * with `permission_denied` until they switch it back on. Only inside a call the person started (`screen`, `screenEvent`,
   * `home`, `section`, `search`); any other call (background, prewarm, sync, `resolve`) rejects with `permission_denied`.
   * At most 30 calls a minute per plugin (both functions together), then `rate_limited`; a wrong option is `bad_request`. A
   * screen's timer ticks (`screen.every`) count as the person's use while the screen is in front. A call Kino has abandoned
   * (timed out, or its screen closed) gets `permission_denied`. If you build Home rows from these titles, Kino caches that answer
   * like any Home.
   * Kino keeps nothing for you: store only what you need, and only in your own storage. Present on every apiVersion 14 runtime:
   * feature-detect with `typeof kino.library === "object"` (the Node kit answers from `KINO_LIBRARY_FIXTURE`).
   */
  namespace library {
    /** The titles played, most recent first. */
    function watched(options?: KinoLibraryWatchedOptions): Promise<KinoLibraryEntry[]>;
    /** The titles saved (the heart on a title's page), most recently saved first: no `progress` and no `watchedAtMs`. */
    function saved(options?: KinoLibrarySavedOptions): Promise<KinoLibraryEntry[]>;
  }

  /**
   * apiVersion 14, capability `room` (Task 8l): a short-lived mailbox hosted on the person's OWN device and reached from the
   * Internet through the same Cloudflare quick tunnel Kino opens for "Recibir configuración". Kino is only the transport: who
   * leads, what a message means and failover are yours. The person approves it at install, and again on the update that adds
   * it, on a RED consent line: "Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los
   * mensajes de la sala a quienes entren" / "Can open a room that people reach over the Internet through this device, and send
   * the room's messages to whoever joins". They can switch it off in your tab in Ajustes ("Dejar que abra salas por internet"),
   * which closes your rooms at once; every call then rejects with `permission_denied`.
   *
   * - `open` and `join` only from the person's own action: a `screenEvent` or a `panelAction` (never a screen timer tick or a
   *   panel refresh). `send`, `inbox` and `members` from an open screen or panel (`screen`, `screenEvent`, `panel`,
   *   `panelAction`, `playerEvent`; ticks and `refreshMs` included), with Kino in front. Never a background call.
   * - Poll `inbox` from your panel's `refreshMs` (2000 or more) or a screen's `every`; nothing is pushed into a closed runtime.
   * - A payload is a JSON object of at most 8192 UTF-8 bytes and 4 levels; at most 5 messages a second, 100 and 256 KB a
   *   minute per member. Kino never executes or stores it.
   * - A device holds at most two joined sessions and one hosted room, and one plugin at most two of those three (`room_busy`);
   *   a `join` with the code of a session you
   *   are in replaces it (moving to a backup endpoint). Publish a backup's `words` a few seconds after `open` (a fresh name
   *   takes a moment to resolve; `join` retries for 20 s).
   * - The room closes on `close`, at its TTL, if your plugin is removed, disabled or switched off, or if Kino stays in the
   *   background 30 minutes (while your room is hosted, Android shows Kino's notification «Sala abierta · N personas» with
   *   «Cerrar sala» and keeps it alive meanwhile). Guests silent for 2 minutes are dropped (`leave`).
   * - Five wrong codes lock new joins for 60 s, then 120 s, ... (`rate_limited`, with Kino's `userMessage`); members already in
   *   keep going. After 30 wrong codes in all the room closes itself: Kino tells the person and your next calls get
   *   `room_closed`.
   * - The code keeps out whoever does not have it (guessing is online only); it does not protect against the tunnel provider
   *   (Cloudflare) targeting a room. Keep a room's messages low-sensitivity (a chat, playback positions).
   * - While this device hosts your room, Kino shows it in your tab in Ajustes with a button that closes it.
   *
   * Present on every apiVersion 14 runtime: feature-detect with `typeof kino.room === "object"` (the Node kit runs an
   * in-memory room with two simulated members).
   */
  namespace room {
    function open(options?: KinoRoomOpenOptions): Promise<KinoRoomOpened>;
    function join(options: KinoRoomJoinOptions): Promise<KinoRoomJoined>;
    function send(payload: object, options?: KinoRoomSendOptions): Promise<void>;
    function inbox(options?: KinoRoomInboxOptions): Promise<KinoRoomInbox>;
    function members(options?: { session?: KinoRoomSession }): Promise<KinoRoomMember[]>;
    function close(options?: { session?: KinoRoomSession }): Promise<void>;
    function state(): Promise<KinoRoomState>;
  }

  /**
   * apiVersion 14, capability `ai` (Task 8r, declarative, never on its own): one short, one-shot ask to Kino's text AI (Kilo's
   * free models, the same fixed destination Kino's own assistant uses; no key, no server of yours or Kino's). No conversation
   * memory, no streaming, no tools, no images, no files; Kino keeps nothing and logs only sizes. The person approves it at install,
   * and again on the update that adds it, on a RED consent line: "Podrá enviar texto a un servicio de IA de terceros (Kilo) para
   * que lo resuma o clasifique; lo que envíe sale de tu aparato" / "Can send text to a third-party AI service (Kilo) to have it
   * summarized or classified; what it sends leaves your device". They can switch it off in your tab in Ajustes: every ask is then
   * `refused`. Only from the person's own press (a settings `action`, a `panelAction`, a `screenEvent` tap or submit; never a
   * screen's open, a timer tick, a load-more, a `playerEvent`, Home or search) or from your scheduled `job`, where each ask is one
   * of the run's requests. At most 10 asks in any 60 s and 100 a day per plugin, one at a time, and 300 a day and 2 at once for
   * every plugin of the device together (`rate_limited`), 20 s each
   * (`timeout`). Ask once per screen event and batch items into one prompt: the screen's own 60 s still bounds the event.
   * `unavailable`: no model could answer now; keep a fallback.
   *
   * The reply is UNTRUSTED DATA: the model read whatever you sent (titles from the web, the person's words) and can be steered by
   * it (prompt injection). Validate every field against what you sent, drop what you did not ask for, never execute it, never
   * follow instructions found in it, never open a URL from it unchecked. Present on every apiVersion 14 runtime: feature-detect
   * with `typeof kino.ai === "object"` (the Node kit answers canned text: `KINO_AI_REPLY`, `KINO_AI_ERROR`, `KINO_AI_REVOKED=1`).
   */
  namespace ai {
    function ask(options: KinoAiAskOptions): Promise<KinoAiAnswer>;
  }

  /**
   * apiVersion 14, capability "shared" (Task 8q-2; a plain consent line, not red): a small store of your plugin's, per profile,
   * that syncs between the person's own linked devices, both ways, last writer wins by a clock Kino assigns. Typical use: a `preferPhone`
   * job on the phone writes its result, the TV's screen reads it. Synchronous, like `kino.storage`; usable from screens, panels,
   * settings and jobs.
   *
   * `get(key)`: the value, or null (never throws: a stored value this engine cannot read answers null). `set(key, value)`: JSON values only (stored as their JSON text): at most 64 KB each, 16 levels
   * deep, 4 keys and 128 KB per plugin; true when stored, false when it was already that value (nothing written or sent);
   * `set(key, null)` removes the key. A key's new value reaches the other devices at most once a minute (this device reads it at
   * once), and at most 4 of your keys travel in any minute. Keys are 1 to 40 of `A-Z a-z 0-9 _ . -`. At most 30 writes a minute.
   *
   * NEVER put a secret here (a token, a password, a cookie, a session): it is copied to every linked device. A key with a word
   * like one (token, secret, password, cookie, session, auth, apiKey..., plurals too; `author` is fine) is refused, and so is a value holding a sealed secret. What `get`
   * answers is UNTRUSTED: another device wrote it (maybe another version of your plugin): validate its shape, its sizes and every
   * field before you use it. Errors: `not_allowed`, `bad_request`, `too_large`, `rate_limited`. Feature-detect with
   * `typeof kino.shared === "object"` (the Node kit simulates two devices: `node sdk/run.mjs <folder> shared`).
   */
  namespace shared {
    function get(key: string): unknown;
    function set(key: string, value: unknown): boolean;
  }

  /**
   * Kino 0.9.55: share ONE anonymous, free guest session of your source's portal, so people in regions that can't log in
   * have live sessions to seed from. `session` is a plain object of the session's own fields (its ids and token); Kino keeps
   * only the known seed fields, drops everything else, and sends it to Kino's own error board — but only when the
   * person's plugin-telemetry consent is on (the same consent `kino.log.report` rides on). It is anonymous: it names no
   * account and carries nothing about the person. Best-effort and synchronous; it answers nothing and never throws. Mint a
   * BRAND-NEW guest session for this, never the person's own, and send it only after you confirmed it works. Absent on a
   * Kino older than 0.9.55 (feature-detect with `typeof kino.seed === "function"`).
   */
  function seed(session: Record<string, string | number>): void;

  /**
   * Kino 0.9.74, additive: a `"sync": { "mode": "realtime" }` provider that can learn of a remote change tells Kino, so Kino pulls
   * at once. Synchronous, cheap, answers nothing. Kino accepts at most one signal every 30 seconds and drops one that arrives while
   * a pull is already running (that pull sees the remote), so call it when you notice the change, not in a loop. Throws
   * `{ code: "not_allowed" }` unless the plugin declares the `syncProvider` capability with `mode: "realtime"`. Your code only runs
   * while Kino calls it, so you cannot hold a connection open between calls: the place to notice a change and signal is
   * `syncStatus` (not `syncPull`). Kino also keeps pulling every `pullEveryMs`. Feature-detect with `typeof kino.sync === "object"`.
   */
  namespace sync {
    function remoteChanged(): void;
  }

  /**
   * apiVersion 14, additive: what this Kino's screen canvas draws, for feature detection (`typeof kino.screen === "object"`;
   * `undefined` on an older Kino). `names` lists the `type` names it validates and draws, as these docs spell them
   * (`Column`, `TextField`, `titleRail`...); a node of any other type is dropped with a log line, so check it before relying
   * on a widget a newer Kino adds. `widgets` lists the same widgets by their older names. `version` is the screen contract's
   * own number (1 for now), raised only when a widget or an answer field changes meaning. The Node kit reports the
   * contract's lists.
   */
  namespace screen {
    const names: readonly string[];
    const widgets: readonly string[];
    const version: number;
  }

  /**
   * apiVersion 6, with `"browser": true` (or `"pages"`) in the manifest (the person approves it in red): from `resolve` only, and only
   * a `resolve` the person started (they pressed play, or they started a download; never a background one), opens
   * `url` in a hidden web view, lets the page run its own player (muted; with `autoplay`, the default, it also clicks the
   * usual play buttons and taps the middle of the page), and answers the video requests the page made, HLS/DASH first,
   * each with the headers to play it with (put them in your Stream's `headers`). The start `url` must be a host your
   * `kino.fetch` may reach; the page may then load from any public server, never the home network. One page at a
   * time in the whole app (a download's capture never waits: `busy` at once). Throws a typed error: `browser_unavailable`
   * (no WebView on this device, and always under the Node kit), `timeout` (no video in `timeoutMs`, default 18000, at
   * most 25000), `blocked`, `busy`, `not_allowed` (no approved `"browser": true`, not inside `resolve`, or a `resolve`
   * nobody started), `invalid_request`.
   */
  namespace browser {
    function capture(url: string, options?: KinoBrowserCaptureOptions): Promise<KinoBrowserCapture>;
    /** Kino 0.9.54+: `true` when `capture` takes `captureAll`, `alsoMatch`, `waitForCookie` and `returnCookiesOnTimeout`; absent before. */
    const captureAll: true | undefined;
    /**
     * apiVersion 6, with `"browser": "pages"` in the manifest (`true` is capture-only and answers `not_allowed` here; the
     * person approves "Puede abrir páginas web ocultas para mostrar contenido y
     * encontrar el video", in red): from `search`, `home`, `browse`, `episodes`, `section` or `resolve`, only
     * while the person is using the app (never a background call), loads `url` in the same hidden web view and returns its
     * HTML once the page is past the site's automatic browser check (Cloudflare's "Just a moment…") and matches `waitFor`.
     * Kino never clicks, taps, types or scrolls in it and never solves a captcha: a page that asks for a human answers
     * `blocked` at once, and one still on its check page when the time runs out answers `blocked` too. The top document
     * must stay on your hosts: a redirect or navigation elsewhere answers `blocked`, never that site's HTML. Same start-host
     * rule, same one page at a time, fresh cookies per call; at most 20 page reads per minute per plugin. Throws a typed
     * error: `browser_unavailable` (always under the Node kit: keep a plain `kino.fetch` path), `timeout`, `blocked`,
     * `busy` (another page is open, or the person pressed play and the read was ended), `not_allowed`, `rate_limited`,
     * `invalid_request`.
     */
    function page(url: string, options?: KinoBrowserPageOptions): Promise<KinoBrowserPage>;
  }

  /**
   * Present only in plugins Kino generates from a CloudStream repository. Hand-written plugins never have it.
   * Each call runs the CloudStream provider at index `provider` inside the CloudStream bridge app. Throws a typed
   * error: `not_found` (the provider itself failed), `unavailable` (no bridge, an incompatible plugin, a timeout or a
   * refused request; the message says which), `invalid_request` (the request is over 1 MB).
   */
  namespace cloudstream {
    function search(provider: number, query: string): Promise<{ items: CsItem[] }>;
    function mainPage(provider: number, index: number, page: number): Promise<{ rows: { name: string; items: CsItem[] }[]; hasNext: boolean }>;
    function load(provider: number, url: string): Promise<{ title: CsTitle; episodes: CsEpisode[] }>;
    function loadLinks(provider: number, data: string): Promise<{ links: CsLink[]; subtitles: { lang: string; url: string }[] }>;
  }

  /** apiVersion 4: a marker for a secret the manifest's `secrets` declares (throws for any other name). Kino swaps it for the value in `kino.fetch`, toward the manifest's own hosts only; your code never sees the value. apiVersion 6: a secret declared `{ seal, use: "cipher-key", encoding }` is accepted as the whole `key` of any `kino.crypto.encrypt`/`decrypt` (des-ede3 included), read with the manifest's encoding; it is refused everywhere else, including `kino.fetch`. */
  function secret(name: string): string;

  /** Writes to Kino's log (and console.* does the same); lines are cut at 2000 characters. When a call of a plugin whose manifest says `"telemetry": true` or `"verbose"` (apiVersion 6) fails (a plugin that does not declare it never sends a line; a later Kino build adds a per-device "Enviar registros de errores y de reproducción" switch, on by default, that stops them) (sign and the settings exports included), the last 30 lines it logged (cut at 300 characters, scrubbed of URLs, hosts, ids, secrets and the person's text, 2 KB in all) go with the failure report; never for a call that succeeds. Log what happened, never what the person typed. */
  function log(...args: unknown[]): void;
  namespace log {
    /** apiVersion 6, with `"telemetry": true`: a log line that also tells Kino's error tracker your plugin served a degraded result (a fallback account, a backup source). The line's first word is its area (`[a-z0-9_:]`, with a `_` or `:`, up to 24 characters; anything else is filed as "other"); at most one report per area an hour and 3 per plugin per session, scrubbed like any line. Without telemetry (or, once the per-device switch exists, with it off) it is only a log line. With `"telemetry": "verbose"` a plugin's playback metrics, live/cast problems and edge cases also reach the board (see the README). In a debug build, or while the plugin's "Modo debug" switch is on (every plugin has one in Ajustes; `"debug": true` only makes it on by default), every line is in logcat under `KinoPlugin/<id>` and Kino's playback lines under `KinoPlay`. */
    function report(...args: unknown[]): void;
  }

  namespace html {
    /** Jsoup CSS selectors; at most 500 matches. Only inside Kino. */
    function select(html: string, css: string): KinoHtmlMatch[];
  }

  /**
   * 256 KB in total for this plugin. apiVersion 13, capability "storageLarge" (declarative, nothing to export): 16 MiB in
   * total, 2 MiB per value, at most 1000 keys of at most 256 characters instead, for a plugin that keeps a catalog (shard
   * it into values of about 512 KB); the same API and TTL rules, one file per value on the device. Going over throws
   * code `"too_large"`: "plugin storage full (256 KB)", or with storageLarge "plugin storage full (16 MB)" /
   * "plugin storage full (2 MB per value)" / "plugin storage full (1000 keys)"; a longer key is `"invalid_request"`.
   * The storageLarge store is device-only: never synced and NOT in backups. Declaring storageLarge moves the plugin's
   * existing keys into it, out of the backed-up 256 KB store: keep credentials and sessions in sealed secrets or the
   * person's settings, or in a plugin without the capability.
   */
  namespace storage {
    /** Returns `null` once the entry has expired (see `set`). */
    function get(key: string): string | null;
    /**
     * `options.ttlMs` makes the entry expire: after that many milliseconds, `get` returns `null` and
     * `keys()` leaves it out, even across a restart of the app. A whole number greater than 0,
     * at most 2,592,000,000 ms (30 days); anything else throws before the entry is touched. Leave
     * out `options` (or `ttlMs`) for a permanent entry, exactly as before this option existed. An
     * expired entry never counts against the cap (256 KB, or 16 MiB with storageLarge): it is dropped the next time your plugin
     * reads or writes storage.
     */
    function set(key: string, value: string, options?: { ttlMs?: number }): void;
    function remove(key: string): void;
    /** Expired keys are already gone. */
    function keys(): string[];
  }

  namespace config {
    /** A setting's value (string; boolean for a toggle; an array of `{ [field.key]: string }` for a `list`, apiVersion 4); undefined when unset with no default (a `url` setting never has one). Read-only. */
    function get(key: string): string | boolean | Array<Record<string, string>> | undefined;
    function all(): Record<string, string | boolean | Array<Record<string, string>>>;
  }

  /**
   * apiVersion 13, capability "socket": an outbound WebSocket. `url` must be wss:// (port 443) on a host the manifest declares and the
   * person approved -- never the local network or an IP literal. At most 4 open sockets per plugin and 8 MiB queued unread.
   */
  namespace ws {
    /**
     * Opens the socket and resolves once it is connected. Rejects with an error whose `code` is `"host_not_allowed"` (it
     * also carries the offending `host`), `"not_https"` (not a wss:// address) or `"limit"` (4 sockets already open); also `"network"` and `"timeout"` when the connection cannot be made.
     */
    function open(url: string, options?: { protocol?: string }): Promise<KinoWebSocket>;
  }

  /**
   * apiVersion 13, capability "catalog" (declarative, nothing to export, no consent line): a searchable catalog of your own
   * items, kept by Kino in ONE SQLite database file for your plugin alone, so you can index and search thousands of videos
   * without holding them in your 64 MB of QuickJS memory. Undefined without the capability, and inside `sign()`.
   *
   * Limits (contract.json `catalog`): at most 100,000 items per plugin; `id` 1 to 128 characters; `title` at most 300
   * characters; `data` at most 4,096 bytes of JSON; at most 500 items per `upsert` and 500 ids per `get` or `remove`;
   * `search` `limit` default 50, at most 100, `offset` at most 1,000,000, `q` at most 256 characters; the file at most 64 MiB.
   * Both item limits hold at once: 100,000 items fit only at about 670 bytes of file per item on average (measured with a
   * 50-character title: about 370 bytes with no `data`, about 920 with 500 bytes of `data`, about 4,850 with 4,000 bytes,
   * so only about 13,800 items at that size). Keep `data` small.
   *
   * Every refusal is a KinoError whose `code` says what to do: `"invalid_request"` (a wrong shape or type: fix the call),
   * `"too_large"` (one value or one batch over its limit, named in the message: split it or shorten it), `"limit"` (the
   * catalog is full, 100,000 items or 64 MiB: remove old items first) and `"unavailable"` (Kino could not read or write the
   * file right now: try again later; the message says "damaged and has been reset to empty" when the file was corrupt and
   * Kino started an empty one: rebuild it). A refused `upsert` writes nothing of its batch.
   *
   * Isolation and privacy: no other plugin can read or change your catalog, and your plugin never writes SQL (only these
   * six operations, every value bound). It stays on the device: never synced and NOT in backups, so after a restore or a
   * reinstall it is empty: rebuild it from your source. Credentials and sessions never belong here.
   */
  namespace catalog {
    /**
     * Adds or replaces up to 500 items in one transaction (all or nothing: one bad item refuses its whole batch, so clean
     * them first). Answers how many items were written.
     * @example
     *   const items = videos
     *     .filter((v) => String(v.id).length <= 128)
     *     .map((v) => ({ id: String(v.id), title: String(v.caption || "").slice(0, 300).replace(/[\uD800-\uDBFF]$/, "") || "Video " + v.id, sort: Number.isSafeInteger(v.date) ? v.date : 0, data: { file: String(v.fileRef) } }));
     *   for (let i = 0; i < items.length; i += 500) await kino.catalog.upsert(items.slice(i, i + 500));
     */
    function upsert(items: KinoCatalogUpsertItem[]): Promise<{ count: number }>;
    /**
     * One page of the items whose title holds every word of `q` (case and accents ignored), plus `total`, the count of
     * every match. Reads only the page asked for.
     * @example
     *   const offset = 40;
     *   const page = await kino.catalog.search({ q: "pelicula 2001", limit: 20, offset, order: "newest" });
     *   const more = page.total > offset + page.items.length;
     */
    function search(options?: KinoCatalogSearchOptions): Promise<KinoCatalogPage>;
    /**
     * The items with these ids (at most 500 per call), in the order asked; an id that is not there is skipped and a repeated
     * one comes once.
     * @example
     *   const [item] = await kino.catalog.get([ref]); // ref: the catalog id your resolve(ref) got
     */
    function get(ids: string[]): Promise<KinoCatalogItem[]>;
    /**
     * Deletes the items with these ids (at most 500 per call). Answers how many were there and are now gone.
     * @example
     *   await kino.catalog.remove(staleIds);
     */
    function remove(ids: string[]): Promise<{ count: number }>;
    /**
     * Deletes every item: Kino deletes the file itself, so the space goes back to the device.
     * @example
     *   await kino.catalog.clear(); // then upsert everything again
     */
    function clear(): Promise<void>;
    /**
     * How many items the catalog holds.
     * @example
     *   if ((await kino.catalog.count()) === 0) await rebuild();
     */
    function count(): Promise<number>;
  }

  /**
   * apiVersion 13, capability "qrScan" (declarative, nothing to export, no consent line): ask the person to scan a QR code
   * with the phone's camera. Undefined without the capability, and inside `sign()`.
   *
   * Kino opens its own camera scanner full screen over whatever the person was doing. At the top it shows, from the top:
   * "<your plugin's installed name> wants to read a QR code", your `title` (your `titleEn` when Kino speaks English, else
   * `title`; each at most 80 characters, at most two lines on screen, with no control, bidi or format character), and
   * Kino's instruction; a close button beside them. The first code the camera decodes that holds 1 to 4,096 characters
   * answers the call; a longer one is ignored, the scanner says "This code is not valid for <your plugin>" and keeps looking.
   *
   * Rules: only from a settings `action`, a `panelAction` or a `screenEvent` that follows the person's press (they pressed
   * one of your buttons), never from Home, search, a play, a list, a title page, your section, `settingsStatus` or any
   * background call. In a screen (apiVersion 14: a root screen, a screen-mode panel, a contributed tab in screen mode),
   * only the event of the person's own tap or submit counts: never the open event, a timer tick (`every`), a load-more, a
   * change, a panel's `refreshMs` or a `playerEvent`. The settings node inside a screen runs its `action` as Ajustes does.
   * That call's own time limit stops while the scanner is up. At most one scan on screen at a time, for the whole app.
   * The scanner closes by itself after 120 s. On a device without a camera, and on Kino's TV interface, it never opens.
   *
   * Errors (a KinoError whose `code` says what to do): `"busy"` (a scan is already open, yours or another plugin's: wait
   * for it), `"timeout"` (nothing was scanned in 120 s: offer to try again), `"unavailable"` (this device cannot scan: no
   * camera, or a TV: show the code another way, such as a settings `qr` setting), `"not_allowed"` (called from anything
   * else: "kino.qr.scan only runs from a settings action, panelAction or screenEvent the person pressed"; scan from a
   * button), `"permission_denied"` (the person did not give Kino the camera: say they can allow it in the phone's
   * settings) and `"invalid_request"` (a `title` or `titleEn` that is not a string, is over 80 characters or holds a
   * control or formatting character: fix the call).
   *
   * Privacy: you get only the decoded text of the code the person pointed the camera at, never an image; it is data from
   * the world (check it before you trust it), and only your plugin gets it.
   *
   * To SHOW a QR instead (say, on the new device a login is for), use a settings `qr` setting: `{ "key": "login", "label":
   * "...", "type": "qr", "refreshMs": 5000 }`, whose text is your `settingsStatus()` answer under that key (at most 512
   * characters); Kino asks again when the form opens, after every action and every `refreshMs` (2000 to 60000) while the
   * form is on screen, so a code that expires is replaced in place.
   */
  namespace qr {
    /**
     * Opens the scanner; resolves with the scanned text, or null when the person closed the scanner (the close button,
     * Back, leaving the screen).
     * @example
     *   // In action("link"): the person pressed "Vincular otro aparato" in your settings.
     *   let text;
     *   try {
     *     text = await kino.qr.scan({ title: "Escanea el código del otro aparato", titleEn: "Scan the other device's code" });
     *   } catch (e) {
     *     if (e.code === "unavailable") return { message: "Este aparato no puede escanear: usa tu teléfono" };
     *     if (e.code === "permission_denied") return { message: "Permite la cámara en los ajustes del teléfono" };
     *     throw e;
     *   }
     *   if (text === null) return { message: "Cancelado" };
     *   if (!text.startsWith("exampleapp://login?token=")) return { message: "Ese no es un código de inicio de sesión" };
     *   await acceptLogin(text);
     *   return { message: "Listo: el otro aparato ya entró" };
     */
    function scan(options?: { title?: string; titleEn?: string }): Promise<string | null>;
  }

  namespace cookies {
    /** The value of cookie `name` for `url` (a host the plugin may reach), or null. */
    function get(url: string, name: string): string | null;
    /** Forgets every cookie of this plugin (they also go when its settings change). */
    function clear(): void;
  }

  namespace crypto {
    /** Default input utf8, output hex. Data at most 5 MB. Errors carry code "crypto_error". */
    function hash(alg: "md5" | "sha1" | "sha256" | "sha512", data: string, options?: { inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    function hmac(alg: "md5" | "sha1" | "sha256" | "sha512", key: string, data: string, options?: { keyEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /** GCM appends the 16-byte tag to the ciphertext. */
    function encrypt(alg: KinoCipher, options: KinoCipherOptions): string;
    /** GCM expects the 16-byte tag appended. */
    function decrypt(alg: KinoCipher, options: KinoCipherOptions): string;
    /** iterations at most 100000, keyLength at most 64 bytes. Password uses keyEncoding, salt inputEncoding. */
    function pbkdf2(hash: "sha1" | "sha256" | "sha512", password: string, salt: string, iterations: number, keyLength: number, options?: { keyEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13: MTProto's AES-256-IGE (`c_i = E(m_i xor c_{i-1}) xor m_{i-1}`). `dir` is "encrypt" or "decrypt"; `key` is
     * 32 bytes, `iv` 32 bytes (two blocks) and `data` a multiple of 16 bytes, each read with its encoding (key and iv with
     * keyEncoding/ivEncoding, data with inputEncoding; default utf8). Output base64 by default. Anything malformed fails
     * with the fixed text "invalid crypto operation". A sealed value is refused in every field.
     */
    function aesIge(dir: "encrypt" | "decrypt", key: string, iv: string, data: string, options?: { keyEncoding?: KinoEncoding; ivEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13: `base ^ exp mod mod` over big-endian hex strings (no 0x prefix; each at most 4096 bits). The answer is hex,
     * left-padded with zeros to the modulus' byte width. A zero modulus or an empty string in any of the three fails with
     * "invalid crypto operation" (write zero as "0").
     */
    function modPow(base: string, exp: string, mod: string): string;
    /** apiVersion 13: inflates a gzip stream (input base64 by default, output utf8 by default); the output is at most 5 MB. */
    function gunzip(data: string, options?: { inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /**
     * apiVersion 13 (Kino's own version, not the manifest's: feature-detect with `typeof kino.crypto.convert === "function"`):
     * `data` read in `from` and written in `to` (`"hex"` to `"base64"` and back, `"utf8"` to bytes...), in native
     * code: no JavaScript loop over the bytes. Hex comes out lower case, base64 padded with the standard alphabet; base64 in may
     * be URL-safe or unpadded. At most 5 MB of bytes. A bad input fails with `"data" is not valid hex` / `base64`, an unknown
     * encoding with `unknown encoding: <name>`. A sealed value is refused.
     */
    function convert(data: string, from: KinoEncoding, to: KinoEncoding): string;
    /**
     * apiVersion 13 (Kino's own version, not the manifest's: feature-detect with `typeof kino.crypto.aesIgeVerify === "function"`):
     * AES-256-IGE decryption (as `aesIge("decrypt", ...)`) checked by a MAC in the same call: the SHA-256 digest of
     * `macPrefix` followed by the plaintext, bytes `macOffset` to `macOffset + mac.length` (1 to 32 bytes inside the 32-byte digest),
     * must equal `mac`, compared in constant time. On a match it answers the plaintext (base64 by default); on a mismatch it fails
     * with the fixed text "the mac doesn't match" and answers nothing. `mac` and `macPrefix` are read with `macEncoding` (default
     * hex), `key`/`iv`/`data` as in `aesIge`. MTProto 2.0's msg_key check is `macPrefix` = 32 bytes of the auth key, `macOffset` 8,
     * `mac` = the 16-byte msg_key. Anything malformed (sizes, an offset that is not a whole number or runs past the digest) fails
     * with "invalid crypto operation". A sealed value is refused in every field.
     */
    function aesIgeVerify(key: string, iv: string, data: string, options: { mac: string; macPrefix?: string; macOffset?: number; macEncoding?: KinoEncoding; keyEncoding?: KinoEncoding; ivEncoding?: KinoEncoding; inputEncoding?: KinoEncoding; outputEncoding?: KinoEncoding }): string;
    /** 1..1024 bytes, hex by default. */
    function randomBytes(n: number, outputEncoding?: KinoEncoding): string;
    /** A random (v4) UUID. */
    function uuid(): string;
    /**
     * apiVersion 6: a new key pair. The private key stays inside Kino: you get a handle that works only in this
     * runtime (not in sign()'s signing lane, not after the plugin restarts) and is gone when it closes; at most 64
     * live at once (a new one drops the oldest). Node's generateKeyPairSync / WebCrypto's generateKey map here.
     */
    function generateKeyPair(options: { type: "ec"; namedCurve: "P-256" | "P-384" } | { type: "ed25519" } | { type: "x25519" }): { readonly privateKey: KinoPrivateKey; readonly publicKey: KinoPublicKey };
    /** apiVersion 6: a peer's public key (jwk object, spki base64, or raw base64 with `type` and, for ec, `namedCurve`). Private keys cannot be imported. */
    function importKey(options: { format: "jwk"; key: KinoJwk } | { format: "spki"; key: string } | { format: "raw"; key: string; type: KinoKeyType; namedCurve?: "P-256" | "P-384" }): KinoPublicKey;
    /**
     * apiVersion 6: signs `data` (read with `encoding`, default utf8) with your private key; base64 by default.
     * ec: `hash` "SHA-256" (default) or "SHA-384"; `format` "der" (default, Node's crypto.sign) or "ieee-p1363"
     * (r||s, 64 bytes on P-256, 96 on P-384: WebCrypto's). ed25519: 64 bytes, no `hash`. x25519 does not sign.
     */
    function sign(options: { key: KinoPrivateKey | string; data: string; encoding?: KinoEncoding; hash?: "SHA-256" | "SHA-384"; format?: "der" | "ieee-p1363"; outputEncoding?: "base64" | "hex" }): string;
    /** apiVersion 6: true when `signature` (base64 by default) is valid for `data`; a malformed signature is false. `key`: a public key, a `{ jwk }`, or your own private key. */
    function verify(options: { key: KinoPublicKey | { jwk: KinoJwk } | KinoPrivateKey | string; data: string; encoding?: KinoEncoding; signature: string; signatureEncoding?: KinoEncoding; hash?: "SHA-256" | "SHA-384"; format?: "der" | "ieee-p1363" }): boolean;
    /** apiVersion 6: ECDH (ec, same curve) or X25519: the shared secret, base64 by default (32 bytes; 48 on P-384). */
    function deriveSharedSecret(options: { privateKey: KinoPrivateKey | string; publicKey: KinoPublicKey | { jwk: KinoJwk }; outputEncoding?: "base64" | "hex" }): string;
  }

  namespace rank {
    /**
     * The title's HEAD, up to its first `:`, `,`, `|`, en dash or em dash -- for a search backend
     * that ranks a short query better than a long one. A one- or two-letter head identifies
     * nothing, so the whole (trimmed) text comes back instead; a plain "-" is never a cut point (it
     * would split a hyphenated word like "Spider-Man").
     */
    function shortQuery(query: string): string;
    /**
     * Reorders `items` so the ones sharing the most words with `query` come first; ties keep
     * `items`' own order. `query` is a title, or several forms of one (try `query.q`,
     * `query.originalTitle` and `query.altTitles` together: a backend may only know a title in one
     * language). `getTitle` reads a title off an item, string or array of them; it defaults to
     * `(item) => item.title`. Never throws: `items` not an array answers `[]`; an item with no
     * usable title (missing, not a string, or `getTitle` itself failing) sorts after every item
     * that has one, in `items`' own order among themselves.
     */
    function sortBySimilarity(items: any[], query: string | string[], getTitle?: (item: any) => string | string[]): any[];
    /**
     * Drops items sharing too few words with `query` (under 60% of its distinctive words of 3+
     * letters), and any item with no usable title along with them. Never throws: `items` not an
     * array answers `[]`. Reordering alone (`sortBySimilarity`) still shows a full page of near-misses when
     * the title genuinely is not on the backend, so an absent title comes back with 0 results
     * instead.
     */
    function filterRelevant(items: any[], query: string | string[], getTitle?: (item: any) => string | string[]): any[];
  }
}

// ---------- web globals Kino adds (QuickJS has none of them natively) ----------
// URL, URLSearchParams, atob, btoa, TextEncoder and TextDecoder (UTF-8 only) behave like the
// browser's, without IDN/punycode. Use the lib "dom" typings, or declare them in your editor.

/**
 * The manifest's optional `categories` (every apiVersion; read only by Kino's plugin marketplace for its category chips).
 * A list without repeats; when present it replaces what Kino guesses from the capabilities.
 */
type KinoManifestCategory = "movies" | "series" | "anime" | "live" | "radio" | "subtitles" | "utilities" | "adult";

/**
 * apiVersion 6, capability "meta": what `meta(query)` is asked about a title ANOTHER source listed (never one of your own),
 * as the app's TitleMetaQuery builds it. Keys appear only when known; Kino asks nobody about a title with no id at all.
 */
interface KinoMetaQuery {
  type: "movie" | "series";
  /** Every id Kino knows for the title (from the card, TMDB or its anime mapping); each one only when known, never 0 or "". */
  ids: { imdb?: string; tmdb?: number; kitsu?: number; mal?: number; anilist?: number };
  /** The title's own Stremio-style id in its source ("kitsu:1376", "tt0944947"), only for a Stremio addon's title. */
  id?: string;
  /** The person's language ("es"). */
  lang?: string;
}

/**
 * `meta`'s answer (or null: a title you do not know -- not a failure). Every field optional; Kino only fills what TMDB and
 * AniList left empty, and an answer with only `year` and/or `runtimeMinutes` counts as none. Text fields may also be numbers
 * (read as text); each is trimmed and cut, and anything Kino cannot use is dropped on its own (`node sdk/run.mjs . meta`
 * says which and why). Images follow an item's poster rule: http(s), a public name or IPv4 (http never to a name without
 * a dot), or the person's own server; a URL longer than 2048 characters is dropped, so keep them shorter. Fields not
 * listed here are ignored.
 */
interface KinoTitleMeta {
  /** Read (up to 200 characters) but not shown: the page keeps the source's own title. */
  title?: string | number;
  /** Up to 2000 characters; HTML tags are stripped on the page. */
  overview?: string | number;
  poster?: string;
  backdrop?: string;
  /** Only its first 9 characters are read, and their first four digits are the year: 1999, "1999", "1999-2003". */
  year?: string | number;
  /** Strings only, trimmed, up to 30 characters each; the first 5 non-empty ones. */
  genres?: string[];
  /** 1..1000 (a numeric string or a decimal is read as Android's JSON optInt does). Shown only for a movie. */
  runtimeMinutes?: number | string;
  /**
   * At most 5000 entries read (invalid ones count); `season` 0..999 (0 kept, but never listed on the page), `number`
   * 1..99999, one per season and number (the first wins), sorted. Texts as an item's; `airDate` "YYYY-MM-DD";
   * `id` (up to 4096 characters) the episode's Stremio-style video id.
   */
  episodes?: { season: number | string; number: number | string; title?: string | number; overview?: string | number; still?: string; airDate?: string; id?: string | number }[];
  /** Kino 0.9.51+: a clear-logo of the title, shown instead of its name on the info page. */
  logo?: string;
  /**
   * Kino 0.9.51+: one per source (the first valid one wins; `source` is case-insensitive), at most 6 kept; added to the
   * page's score, never replacing it (a `tmdb` one is left out when the page has a score). `value`: up to 3 digits, up to 2
   * decimals with "." or ",", then optionally "%" or "/N" ("8.8", "94%", "4.1/5", "72/100"); a number >= 0 is written
   * without trailing zeros (8.80 is "8.8").
   */
  ratings?: { source: "imdb" | "tmdb" | "rottentomatoes" | "metacritic" | "letterboxd" | "mal" | "anilist" | "trakt"; value: string | number }[];
  /**
   * Kino 0.9.51+: at most 20 with a name, one per name (the first wins); `name` and `character` up to 60 characters.
   * Shown only when TMDB has no cast, as "Reparto:" with the first 5 names; `character` and `photo` are kept, not shown.
   */
  cast?: { name: string | number; character?: string | number; photo?: string }[];
}

/**
 * `meta` -- required with the capability "meta" (apiVersion 6). Asked with every other meta plugin at once; the first
 * answer in install order wins, within 6 s (a timeout or a throw is just no answer, never shown), remembered 30 minutes.
 */
type KinoMetaFn = (query: KinoMetaQuery) => Promise<KinoTitleMeta | null>;

/**
 * apiVersion 11, manifest field `"externalResolver"` (needs the `externalResolve` capability): the resolver app this
 * plugin wants by default, and optionally where to get it when it isn't installed.
 *
 *     "externalResolver": {
 *       "package": "com.example.resolver",
 *       "apk": { "url": "https://github.com/acme/resolver/releases/download/v1.0/resolver.apk", "sha256": "<64 hex>", "label": "Example Resolver" },
 *       "fdroid": true,
 *       "downloader": { "code": "1234567" }
 *     }
 *
 * `apk.url` must be a GitHub release asset (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`) or an archive.org
 * file (`https://archive.org/download/<item>/<file>`); nothing else is
 * ever downloaded. It is offered only for exactly `package`, and only handed to the installer if the file's sha256 matches.
 * Three independent ways to get the app when it is not installed, each optional: `apk` (above); `fdroid: true` (the same
 * `package` is listed in F-Droid: Kino opens F-Droid for exactly that package; the official F-Droid client has no real Android TV
 * support, so on a TV prefer the others); `downloader.code` (3 to 10 digits: a Downloader code for TV sideloading, which Kino only
 * SHOWS, with a button to open the Downloader app when it is installed). Kino offers only what the manifest declares for exactly
 * `package`. With none of them (or if the stream names another package) a missing resolver just fails with "resolver not found".
 * A stream's `external.resolver` overrides `package`; without either, any installed app declaring the protocol may be asked.
 */
interface KinoManifestExternalResolver {
  package: string;
  apk?: { url: string; sha256: string; label?: string };
  /** Only `true` means anything: this `package` is listed in F-Droid. */
  fdroid?: true;
  /** A Downloader app code (3 to 10 digits) that fetches the app, for a TV. Shown, never installed by Kino. */
  downloader?: { code: string };
}

/**
 * apiVersion 12, capability `"syncProvider"`: the plugin is the transport of the person's cross-device sync. Kino keeps the logic
 * (what is synced, merging, when to run) and encrypts the snapshot before handing it over; the plugin only stores and returns an
 * opaque blob, byte for byte. Needs the exports `syncPull` and `syncPush`; `syncStatus` is optional.
 * Who can read the data: the key is derived from one of your own settings (`sync.keySecret`, required), which your code reads, so
 * the plugin and its service CAN read the synced data; the install sheet says so in red ("Sincronizará tus datos a través de su
 * servicio: el plugin y su servicio podrán leerlos"). An update that adds the capability waits for the person's approval again.
 */
interface KinoSyncContext {
  /**
   * The largest blob, in bytes after decoding, Kino will send or accept: the manifest's `maxBlobBytes`, at most 4194304 (4 MiB).
   * Kino 0.9.74: while `syncPull`/`syncPush` run (only then), `kino.fetch` requests and response bodies, and the call's answer,
   * may reach ceil(maxBlobBytes * 4/3) + 65536 characters/bytes instead of 1 MB / 5 MB, so the base64 blob fits in one request.
   */
  maxBlobBytes: number;
}

/**
 * `syncPull` -- required with the capability "syncProvider". The latest stored blob and its version, or null when nothing is stored yet.
 * Every sync export receives ONE argument (an object, or null for `syncStatus`). `blob` is standard base64 (RFC 4648, `+` and `/`,
 * padded) WITHOUT line breaks, in both directions.
 */
type KinoSyncPullFn = (arg: KinoSyncContext) => Promise<{ blob: string /* base64 ciphertext */; version: string } | null>;

/**
 * `syncPush` -- required with the capability "syncProvider". Store `blob` (base64 ciphertext, sealed with the key Kino derives from `sync.keySecret`) and return
 * the new opaque `version`. `arg.expectedVersion` is the version Kino last pulled (null if none): a provider that can detect that the remote
 * changed since throws `{ code: "conflict" }` and Kino pulls, merges and pushes again; one that cannot ignores it.
 */
type KinoSyncPushFn = (arg: KinoSyncContext & { blob: string; expectedVersion: string | null }) => Promise<{ version: string }>;

/** `syncStatus` -- optional with the capability "syncProvider": the status line of the plugin's sync settings. */
type KinoSyncStatusFn = (arg: null) => Promise<{ ready: boolean; message?: string }>;

/**
 * apiVersion 12, manifest field `"sync"` (needs the `syncProvider` capability; refused without it). Required with that capability:
 * a provider without a `sync` block or without `keySecret` is refused. Every key but `keySecret` and `provision` is optional:
 *
 *     "sync": { "mode": "poll", "pullEveryMs": 600000, "pushDebounceMs": 300000, "maxBlobBytes": 4194304,
 *               "keySecret": "botToken", "provision": ["botToken", "chatId"] }
 *
 * `mode` is `"poll"` (default: Kino pulls on foreground and every `pullEveryMs`) or `"realtime"` (the provider signals remote changes).
 * Both times are positive whole milliseconds (defaults 600000 and 300000); Kino clamps them to its own floors. `maxBlobBytes` is the
 * largest blob the provider accepts (default and maximum 4194304).
 *
 * `keySecret` (required) is the `key` of one of the plugin's own `"password"` settings (anything else refuses the manifest). Kino
 * derives the sync key from that setting's value on each device (HKDF-SHA256, host side), so the key never travels: a second device
 * only needs the same settings (for example the same bot token). The derivation is public and your code reads the setting, so the
 * plugin and its service CAN read the synced data (the consent sheet says so in red). It must be a long random token
 * (a bot token, an API key), never a password a person picks: anyone holding a stored blob can try guesses offline. That setting
 * must not declare a `default` (the manifest is refused): the person types it, and until then Kino runs no sync round. There is no
 * key without it: a key one device made up could never reach another. Changing that setting's value changes the key: the copy
 * stored remotely then no longer opens until the person resets sync on one device and gives the new value to the others.
 *
 * `provision` (required) lists the `key`s of your own settings (secret or not, at most 8, no repeats) that pairing hands to another
 * device so it can run the same provider, for example `["botToken", "chatId"]`. It must include `keySecret`. From apiVersion 13 it
 * may name a `"sync": false` password (a one-shot secret such as a 2FA password): sent only while it holds a value, named by its
 * label on both screens, stored sealed and device-only on the receiver (never synced nor backed up); your plugin clears it once
 * used. `keySecret` itself can never be a `"sync": false` password.
 *
 * `generateKey` (apiVersion 13, default false): Kino makes the `keySecret` value itself, 32 random bytes as 64 lower-case hex
 * characters, while that setting is empty: when the person switches the provider on, and when they press "Enviar configuración"
 * (before the values are read, so an empty key never hides that button). It is saved sealed like a typed password, never
 * logged and never drawn in your form; a value that exists is never replaced, and one received from another device replaces it.
 */
interface KinoManifestSync {
  mode?: "poll" | "realtime";
  pullEveryMs?: number;
  pushDebounceMs?: number;
  maxBlobBytes?: number;
  keySecret: string;
  provision: string[];
  generateKey?: boolean;
}
