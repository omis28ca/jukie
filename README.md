# Jukie

Jukie is a local-network jukebox for a home automation system. Guests scan a QR code, open the web
app in a browser, enter a name or alias, and start requesting music. An Ubuntu host plays the audio
through `mpv`, and everyone sees live queue and player state in real time.

The project is intentionally optimized for **simple local deployment**: one server, one shared media
library, and a basic four-digit PIN for admin actions.

---

## Table of Contents

- [Feature Overview](#feature-overview)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Local Setup](#local-setup)
- [Configuration](#configuration)
- [Media Ingestion](#media-ingestion)
- [Room Chat](#room-chat)
- [Playback Behavior](#playback-behavior)
- [Data Model](#data-model)
- [HTTP API](#http-api)
- [WebSocket Contract](#websocket-contract)
- [Operational Notes](#operational-notes)

---

## Feature Overview

### Everyone

- Join by scanning a QR code and entering a name or alias (fallback identity is `ip:<request.ip>`).
- Browse and search the shared library by title, artist, album, or genre.
- Preview a track in the browser without affecting room playback (byte-range streaming).
- Add a track to the queue, or promote/demote it in the "play next" slot.
- Upvote a track: plays it next and saves it to the active mood if it is not already there.
- Downvote a track: removes it from the queue/playlist.
- Select a mood playlist to play.
- Upload audio or video (`.mp3`, `.mp4`, `.wav`, `.m4a`, `.flac`) via drag/drop, with a metadata
  preview after upload.
- Search external sources and import public-domain tracks from the Internet Archive (YouTube search
  results are links only — see [External search](#external-search)).
- Download a YouTube link with yt-dlp straight into the folder-import inbox, with live progress and
  cancel (see [YouTube downloads](#youtube-downloads-yt-dlp)).
- Watch now-playing and queue updates live.
- Chat with the room and see who is connected, right on the home screen (see
  [Room Chat](#room-chat)).

### Requester or admin

- Pause / resume
- Seek
- Skip
- Toggle queue loop
- Set volume
- Clear their own queued entry

### Admin only (PIN-gated)

- Delete songs, including the one currently playing.
- Clear the entire queue.
- Clear the room chat.
- Start and stop queue playback.
- Create, update, delete, and select moods.
- Save the current playback history as a new mood, either whole or as a hand-picked selection.
- Set the server's audio output device.
- Manage storage: delete uploaded files and artwork, and prune orphaned files.
- Choose the drive or folder that holds the music, with optional migration of the existing library.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Vue 3, Vite, Pinia, Vue Router, Socket.IO client, MQTT |
| Backend | Node.js (ESM), Fastify, Socket.IO |
| Data | SQLite via Prisma |
| Playback | `mpv` as a server-side process controlled over IPC |
| Media tooling | `ffprobe` and `ffmpeg` for metadata and artwork, `yt-dlp` for YouTube downloads |

MQTT is used for home-automation remote control and audio-output control.

---

## Repository Layout

```
apps/
  server/            Fastify + Prisma + Socket.IO backend that drives mpv
    prisma/          Prisma schema and SQLite database
    src/
      routes/        HTTP route plugins (songs, queue, player, moods, admin, external, chat, info)
      services/      player (mpv IPC), queue, moods, library, imports, external music, yt-dlp, chat, MQTT
      media/         ffprobe/ffmpeg metadata and artwork extraction
      lib/           identity, serializers, HTTP helpers
  web/               Vue 3 + Vite single-page app served to guests
docs/                Project documentation and the GUI reference
storage/
  uploads/           Uploaded and imported media files
  artwork/           Extracted cover images
  imports/           Drop folders for mood imports
```

In production the server also serves `apps/web/dist`, so one process answers the API, the WebSocket,
and the web app.

### Web routes

| Route | Purpose |
| --- | --- |
| `/` | Now playing, queue, room chat, transport and admin controls |
| `/library` | Searchable song list, enqueue, preview, external search, YouTube download, delete (admin) |
| `/upload` | Drag/drop uploader |
| `/moods` | Browse moods and their songs, select a mood to play |
| `/admin` | PIN entry, volume, moods, mood-from-history, audio output, storage management |

---

## Local Setup

Prerequisites: Node.js (ESM-capable LTS), `mpv`, and `ffmpeg`/`ffprobe` available on `PATH` or
configured explicitly (see [Configuration](#configuration)). `yt-dlp` is optional and only needed for
the YouTube download tab.

Backend:

```powershell
cd apps\server
copy .env.example .env
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

Frontend (second terminal):

```powershell
cd apps\web
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000`. For a single-process
deployment, run `npm run build` in `apps/web` and start only the server — it serves `apps/web/dist`
automatically.

Server scripts:

| Script | Description |
| --- | --- |
| `npm run dev` | Start the server with file watching |
| `npm start` | Start the server |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:push` | Push the schema to SQLite without migrations |
| `npm run prisma:migrate` | Create and apply a development migration |
| `npm run prisma:migrate:deploy` | Apply pending migrations in production |

Web scripts:

| Script | Description |
| --- | --- |
| `npm run dev` | Start Vite with the API/WebSocket proxy |
| `npm run build` | Build the production bundle into `dist/` |
| `npm run preview` | Preview the production bundle |

---

## Configuration

Copy `apps/server/.env.example` to `apps/server/.env` and adjust the values below.

### Core

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATABASE_URL` | `file:./dev.db` | Prisma SQLite connection string |
| `ADMIN_PIN` | `1234` | Four-digit PIN for admin actions |
| `PUBLIC_URL` | auto-detected | Absolute URL encoded into the join QR code |
| `TRUST_PROXY` | unset | Set to `loopback` when nginx on the same host proxies requests, so client-IP rate limits stay accurate |
| `WEB_DIST_DIR` | `../web/dist` | Built web app served by the server when present |

### Storage and uploads

| Variable | Default | Description |
| --- | --- | --- |
| `STORAGE_ROOT` | `../../storage` | Drive/folder holding the music library; `uploads/`, `artwork/` and `imports/` are created inside it |
| `UPLOAD_DIR` | `<STORAGE_ROOT>/uploads` | Media file storage (override only if it must live outside the root) |
| `ARTWORK_DIR` | `<STORAGE_ROOT>/artwork` | Extracted cover art |
| `MAX_UPLOAD_MB` | `5120` (5 GB) | Maximum upload size |
| `ALLOWED_AUDIO_EXTENSIONS` | `.mp3,.mp4,.wav,.m4a,.flac` | Accepted media extensions |

An admin can repoint the library at another drive at runtime from the Admin page; that choice is
stored in the database and takes precedence over these variables on the next start. See
[Choosing the music storage drive](#choosing-the-music-storage-drive).

### Folder imports

| Variable | Default | Description |
| --- | --- | --- |
| `IMPORT_DIR` | `<STORAGE_ROOT>/imports` | Watched drop folder for mood imports |
| `IMPORT_SETTLE_MS` | `10000` | How long a folder must be unchanged before import starts |
| `IMPORT_POLL_MS` | `5000` | Poll interval for the import watcher |

### External search and imports

| Variable | Default | Description |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | unset | Enables official YouTube Data API v3 search (links only) |
| `EXTERNAL_IMPORT_MAX_MB` | `250` | Per-file limit for public-domain imports |
| `EXTERNAL_LIBRARY_MAX_MB` | `5120` | Total storage quota for external imports |

### YouTube downloads (yt-dlp)

| Variable | Default | Description |
| --- | --- | --- |
| `YTDLP_EXEC` | bundled `yt-dlp/yt-dlp.exe` on Windows, otherwise `yt-dlp` on `PATH` | Full path to the `yt-dlp` binary |
| `YTDLP_MAX_FILE_MB` | `500` | Per-file cap passed as `--max-filesize` |
| `YTDLP_MAX_PLAYLIST_ITEMS` | `50` | Maximum items fetched when playlist mode is enabled |
| `YTDLP_TIMEOUT_MS` | `1800000` | Hard timeout before a download is killed |
| `YTDLP_FALLBACK_CLIENTS` | `android,mweb,tv_simply` | Player clients retried once when YouTube rejects the default one; empty disables the retry |
| `YTDLP_ARGS` | unset | Extra arguments appended to every `yt-dlp` call (for example `--cookies /path/cookies.txt`) |

### External binaries

| Variable | Default | Description |
| --- | --- | --- |
| `PLAYER_EXEC` | `mpv` on `PATH` | Full path to the `mpv` binary |
| `PLAYER_STATE_FILE` | `../../storage/player-state.json` | IPC ownership record used to stop orphaned playback after a restart |
| `AUDIO_PROBE_EXEC` | `ffprobe` on `PATH` | Full path to `ffprobe` |
| `AUDIO_TRANSCODE_EXEC` | `ffmpeg` on `PATH` | Full path to `ffmpeg`, used to extract embedded artwork |

On Windows development machines the server auto-detects bundled binaries before falling back to
`PATH`:

- `PLAYER_EXEC` → `../../mpv-x86_64-v3/mpv.exe`
- `AUDIO_PROBE_EXEC` → `../../ffmpeg-8.1.2/bin/ffprobe.exe`

On Ubuntu, leave these unset; the packaged binaries are already on `PATH`.

### MQTT bridge (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `MQTT_URL` | unset | Broker URL (for example `mqtt://homeassistant.local:1883`). The bridge stays off when unset |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | unset | Broker credentials |
| `MQTT_TOPIC_PREFIX` | `jukie` | Publishes retained state to `<prefix>/state`, listens on `<prefix>/command` |

Commands are JSON objects such as `{"action":"pause"}` or `{"action":"volume","value":40}`.
Supported actions: `play`/`start`, `resume`, `pause`, `stop`, `skip`/`next`, `volume`, `seek`,
`loop`, `audio-output`.

### Web app (`apps/web/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE` | same origin | API base URL when the web app is hosted separately |
| `VITE_MQTT_URL` | unset | Optional browser MQTT (WebSocket) broker URL |
| `VITE_MQTT_TOPIC_PREFIX` | `jukie` | Topic prefix for the browser bridge |

---

## Media Ingestion

### Choosing the music storage drive

Everything Jukie stores — uploaded media, extracted artwork and the folder-import inbox — lives under
one root directory. It defaults to `storage/` at the repository root (or `STORAGE_ROOT`), and an
admin can move it to a different disk at any time from **Admin → Music storage drive**.

The panel lists the drives the server can see with their free space, pre-fills a suggested folder
such as `/mnt/music/jukie-music` or `D:\jukie-music`, and accepts any absolute path. Jukie creates
`uploads/`, `artwork/` and `imports/` inside the folder you choose.

- **Move the existing library** (checked by default) relocates the stored media, artwork and pending
  imports, then rewrites every stored file path so old songs keep playing. Leave it unchecked to
  keep the current files where they are and only send *new* media to the new drive.
- A move is refused with `409` while a track is playing — stop playback first, because the player
  holds the current file open.
- The new folder must be writable and cannot sit inside the current storage folder.
- The choice is saved in the database, so it survives restarts and outranks `STORAGE_ROOT`. If the
  drive is missing at boot (an unplugged USB disk), Jukie logs a warning and falls back to the
  configured default instead of refusing to start.
- **Reset to default** clears the override and returns to the `STORAGE_ROOT` layout.

```bash
curl -s localhost:3000/api/admin/storage/location -H 'x-admin-pin: 1234'

curl -s -X POST localhost:3000/api/admin/storage/location \
  -H 'content-type: application/json' -H 'x-admin-pin: 1234' \
  -d '{"root":"/mnt/music/jukie","move":true}'
```

### Uploads

Uploads run through a configurable endpoint with file-type and size guardrails. Embedded metadata
and album artwork are scanned during upload, and the UI shows a metadata preview afterwards.

### Folder imports (one folder per mood)

Copy a playlist folder into `IMPORT_DIR` (by default `storage/imports` at the repository root). The
server waits until the folder's supported media files stop changing, imports them recursively in
relative-path order, and creates or replaces a mood named after the top-level folder.

- Imported media is copied into `UPLOAD_DIR`, so the source folder is deleted once the whole mood
  succeeds.
- Unsupported files are ignored and removed along with the source folder.
- If any song or database operation fails, newly imported songs are rolled back and the source
  folder remains for an automatic retry.
- Up to 10,000 supported songs may be imported into a single mood.

For slow or intermittent network copies, copy the folder with an `.uploading` suffix and rename it
when the copy finishes (for example, `Road Trip.uploading` → `Road Trip`). Folders with that suffix
are ignored until renamed. Alternatively, increase `IMPORT_SETTLE_MS`.

### External search

Library search can query Internet Archive audio that is explicitly marked CC0 or Public Domain Mark.
The server returns exact MP3 tracks, revalidates the selected file and its license metadata,
downloads it into managed storage, records the source and license URLs, and blocks duplicate
imports. Imports are serialized, rate-limited per IP, and bounded by `EXTERNAL_IMPORT_MAX_MB` and
`EXTERNAL_LIBRARY_MAX_MB`.

Internet Archive metadata is uploader-supplied, so users should review the linked source and license
attribution.

Setting `YOUTUBE_API_KEY` enables official YouTube search results. Search results stay links only —
nothing is downloaded from a search hit. Downloading a YouTube link is a separate, deliberate action
on the **YouTube download** tab described below.

### YouTube downloads (yt-dlp)

The third tab in `/library` accepts a YouTube link and hands it to
[yt-dlp](https://github.com/yt-dlp/yt-dlp), which writes the result into the folder-import inbox so
the normal [folder importer](#folder-imports-one-folder-per-mood) turns it into a mood.

- Accepted links: `youtube.com/watch`, `youtu.be`, `/shorts`, `/embed`, `/live`, `youtube-nocookie.com`
  and `music.youtube.com`. Everything else is rejected before any process starts.
- **Audio** mode extracts M4A (best audio, embedded metadata); **video** mode keeps the merged MP4.
- Optional **mood name** overrides the folder name; otherwise the video (or playlist) title is used.
  As with any folder import, an existing mood with that name is replaced.
- **Playlist** mode downloads up to `YTDLP_MAX_PLAYLIST_ITEMS` entries into one folder, numbered by
  playlist position.
- yt-dlp writes into a hidden staging folder, and the finished folder is renamed through an
  `.uploading` suffix, so the importer never sees a half-written download.
- One download runs at a time. Progress, the resolved title, and failures stream to every client over
  the `ytdlp:job` Socket.IO event, and a running job can be cancelled. The server keeps the last 20
  jobs in memory.
- Non-admin callers are limited to 5 downloads per hour per IP.
- If YouTube refuses the default player client, the download is retried once using
  `YTDLP_FALLBACK_CLIENTS`.

yt-dlp is not bundled: install it (`pipx install yt-dlp`, `pip install -U yt-dlp`, or a distro
package) and keep it updated, or point `YTDLP_EXEC` at the binary. The tab shows the detected version
and disables itself when yt-dlp is missing. Video/merged output also needs `ffmpeg`.

> Downloading from YouTube may violate YouTube's Terms of Service and the rights of the copyright
> holder. Only download material you own or that is licensed for reuse; you are responsible for what
> you put in the jukebox.

---

## Room Chat

The home screen carries a small live chat so the room can talk without shouting over the music.

- Everyone who has a socket open is listed under "people online". Presence is keyed the same way
  queue requests are (display name, falling back to `ip:<address>`), so several tabs from one person
  count once, and the row shows how many connections they have.
- Messages carry the sender's name, a timestamp and an `admin` badge when the sender is
  authenticated with the PIN. A display name is required — anonymous guests cannot post.
- Limits: 280 characters per message, one message per 750 ms per person, 30 messages per minute, and
  only the last 100 messages are kept.
- Admins can wipe the board with `DELETE /api/chat`, which clears every connected screen.
- Chat is **in-memory only**. Nothing is written to the database, so a server restart empties both
  the message list and the presence list — it is party banter, not library data.

---

## Playback Behavior

- Active queue statuses: `queued` and `playing`. Finished rows are retained as `played`, `skipped`,
  `removed`, `cleared`, `replaced`, or `error`.
- Requester identity: the name entered on the join screen (sent as the `x-jukebox-user` header),
  with fallback `ip:<request.ip>`.
- Queue order: tracks flagged `playNext` play first, then oldest request first.
- Queue fairness: up to 20 active `queued`/`playing` requests per requester.
- Loop mode: tracks that finish naturally return to the tail of the queue instead of falling off.
- Downvoting removes a track immediately (and skips it when it is playing), removes it from the
  active mood, and each person may vote once per queue item.
- Upvoting promotes a track to play next and appends it to the active mood when it is missing.
- Selecting a mood replaces the upcoming queue with that mood and makes it the active mood that
  upvotes save into.
- Playback history: every track that finishes (`played`) or is skipped (`skipped`) stays queryable
  through `GET /api/queue/history`, newest first. Admins can turn that history into a mood in one
  step — see [Saving a mood from the playback history](#saving-a-mood-from-the-playback-history).

### Saving a mood from the playback history

A good night is easier to recreate than to plan. Once tracks have played, an admin can turn them
into a reusable playlist from **Admin → Save a mood from what was played**:

1. The panel lists recent plays, newest first, each one ticked by default.
2. Untick anything that did not land.
3. Name the mood and save it.

Rules:

- Tracks are stored in the order the room heard them (oldest first), not in the order shown.
- A song that played several times is saved once, at its first appearance.
- Songs deleted from the library disappear from the history with their queue items.
- The result is an ordinary mood: it can be renamed, selected, or deleted like any other.

The same thing over HTTP — the whole window, or an explicit selection:

```http
POST /api/moods/from-history
x-admin-pin: 1234
Content-Type: application/json

{ "name": "Friday night set", "limit": 25 }
{ "name": "Friday night set", "songIds": ["<song-id>", "<song-id>"] }
```

---

## Data Model

Prisma models backed by SQLite.

### `Song`

- Identity: `id`, `title`, `artist`, `album`, `genre`, `year`
- File: `filename`, `path`, `mimeType`
- Artwork: `artworkFilename`, `artworkMimeType`, `artworkPath`
- Metadata: `duration`, `uploadedBy`, `createdAt`
- External provenance: `sourceProvider`, `sourceId`, `sourceUrl`, `licenseUrl`
  (unique on `(sourceProvider, sourceId)` so an import cannot be duplicated)

### `QueueItem`

- `id`, `songId` (relation to `Song`), `requestedBy`, `requesterKey`, `status`, `playNext`
- `createdAt`, `updatedAt`
- Indexes: `(status, playNext, createdAt)`, `(status, createdAt)` and `(requesterKey, status)`

### `QueueItemVote`

- `queueItemId`, `voterKey`, `kind` (`down` or `up`), `createdAt`
- Unique constraint on `(queueItemId, voterKey)` so a requester cannot vote twice on the same item

### `Mood` / `MoodSong`

- `Mood`: `id`, `name`, `createdAt`, `updatedAt`
- `MoodSong`: ordered join rows (`moodId`, `songId`, `position`), unique per position and per song

### `AppSetting` / `FolderImport`

- `AppSetting`: key/value store for the selected audio output device and active mood
- `FolderImport`: in-flight folder import bookkeeping used for crash recovery

---

## HTTP API

Base path: `/api`. Requests identify the caller with headers:

| Header | Purpose |
| --- | --- |
| `x-jukebox-user` | Display name/alias chosen on the join screen |
| `x-admin-pin` | Four-digit admin PIN; unlocks admin-only endpoints |

Errors are returned as `{ "error": "message" }` with a matching HTTP status.

### Server info

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/info` | Server name, version, and `joinUrl` for the QR code |
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/config` | Upload limits, allowed extensions, enabled integrations |

### Songs

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/songs?search=&genre=` | Search by title/artist/album/genre |
| `GET` | `/api/songs/genres` | Distinct genres for filter chips |
| `POST` | `/api/songs/upload` | Multipart: `file`, optional `title`, `artist`, `uploadedBy` |
| `GET` | `/api/songs/:id/artwork` | Cover image |
| `GET` | `/api/songs/:id/media` | Byte-range streaming for browser previews |
| `DELETE` | `/api/songs/:id` | Admin |

### Queue

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/queue` | `{ queue, nowPlaying }` from the caller's perspective |
| `GET` | `/api/queue/history?limit=` | Recently played or skipped tracks, newest first (`limit` 1-200, default 50) |
| `POST` | `/api/queue` | Enqueue `{ songId, playNext? }` |
| `DELETE` | `/api/queue/:id` | Remove one upcoming item (requester or admin) |
| `DELETE` | `/api/queue` | Admin clears everything; a guest clears only their own entries |
| `POST` | `/api/queue/:id/vote` | Downvote (removes the track) |
| `POST` | `/api/queue/:id/upvote` | Upvote (play next + save to the active mood) |
| `POST` | `/api/queue/:id/play-next` | Admin or requester |
| `POST` | `/api/queue/:id/remove-play-next` | Admin or requester |
| `POST` | `/api/queue/:id/skip` | Admin or requester |
| `POST` | `/api/queue/:id/seek` | Admin or requester |
| `POST` | `/api/queue/:id/loop` | Admin or requester |
| `POST` | `/api/queue/:id/volume` | Admin or requester |
| `POST` | `/api/queue/:id/pause` | Admin or requester |
| `POST` | `/api/queue/:id/resume` | Admin or requester |
| `POST` | `/api/queue/:id/start` | Admin or requester |
| `POST` | `/api/queue/:id/stop` | Admin or requester |
| `POST` | `/api/queue/:id/clear` | Admin or requester |
| `POST` | `/api/queue/:id/now-playing` | Play this track immediately |

### Player

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/player` | Current player state |
| `POST` | `/api/player/skip` | Requester of the current track or admin |
| `POST` | `/api/player/pause` | Requester of the current track or admin |
| `POST` | `/api/player/resume` | Requester of the current track or admin |
| `POST` | `/api/player/stop` | Admin |
| `POST` | `/api/player/start` | Admin |
| `POST` | `/api/player/seek` | `{ positionSeconds }` |
| `POST` | `/api/player/volume` | `{ volume }` (0-100) |
| `POST` | `/api/player/loop` | `{ enabled }` |

### Moods

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/moods` | List moods with song counts |
| `GET` | `/api/moods/:id` | Mood with its ordered songs |
| `POST` | `/api/moods` | Admin |
| `POST` | `/api/moods/from-history` | Admin — build a mood from the playback history: `{ name, limit? }` or `{ name, songIds }` |
| `PUT` | `/api/moods/:id` | Admin |
| `DELETE` | `/api/moods/:id` | Admin |
| `POST` | `/api/moods/:id/select` | Replace the queue with this mood and make it active |

### Admin

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/admin/auth` | Validate a PIN before storing it in the browser |
| `GET` | `/api/admin/settings/audio-output` | Current device plus the devices mpv reports |
| `POST` | `/api/admin/settings/audio-output` | `{ deviceId }`, applied live when possible |
| `GET` | `/api/admin/storage` | Upload/artwork file counts, bytes, and orphan counts |
| `POST` | `/api/admin/storage/prune` | Delete files no song references any more |
| `GET` | `/api/admin/storage/location` | Current music folder, free/total space, and the detected drives |
| `POST` | `/api/admin/storage/location` | `{ root, move? }` or `{ useDefault: true, move? }` to repoint the library |

### External music

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/external/search?q=&provider=` | Internet Archive (importable) and YouTube (links only) |
| `POST` | `/api/external/import` | `{ provider, id }` or `{ provider, sourceId, sourceFile }` |
| `GET` | `/api/external/youtube` | yt-dlp availability, version and limits |
| `GET` | `/api/external/youtube/jobs` | Recent download jobs (newest first) |
| `POST` | `/api/external/youtube/download` | `{ url, folderName?, mode: "audio"\|"video", playlist? }` → `202` with the job |
| `DELETE` | `/api/external/youtube/jobs/:id` | Cancel a queued or running download |

### Chat

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/chat` | `{ messages, presence }` — the last 100 messages and who is connected |
| `POST` | `/api/chat` | `{ body }` — post a message (a display name is required) |
| `DELETE` | `/api/chat` | Admin clears the board |

---

## WebSocket Contract

Socket.IO is used for live updates. Clients pass their name (and PIN, when known) in the connection
`auth` payload so queue broadcasts are personalized.

**Server → client**

- `queue:updated` — `{ queue, nowPlaying }`
- `player:state` — full player state
- `player:now-playing` — the playing song or `null`
- `song:uploaded` — a newly uploaded or imported song
- `songs:updated` — the library changed (import or deletion)
- `moods:updated` — `{ moods }`
- `chat:snapshot` — `{ messages, presence }`, sent on connect
- `chat:message` — one new chat message
- `chat:presence` — `{ presence }` whenever somebody connects or disconnects
- `chat:cleared` — an admin wiped the chat board
- `ytdlp:job` — a YouTube download job snapshot (progress, status, resulting mood name)
- `player:error` — `{ message }`

**Client → server**

- `queue:refresh`
- `player:refresh`
- `moods:refresh`
- `chat:refresh`

---

## Operational Notes

- `pause`, `resume`, and `volume` use `mpv` IPC via `--input-ipc-server` over a Unix socket (a named
  pipe on Windows).
- If the IPC socket is not ready yet (roughly the first second of a track), pause/resume falls back
  to `SIGSTOP`/`SIGCONT`.
- IPC socket files are written to `$TMPDIR` (typically `/tmp`) and cleaned up after each track.
- Volume changes mid-track apply immediately over IPC and persist to the next track.
- Shutdown waits for `mpv` to exit before disconnecting the database. The active IPC endpoint is
  persisted so startup can stop orphaned playback before resuming the queue.
