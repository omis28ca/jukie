# Jukie Web

The guest-facing frontend for the Jukie local-network jukebox. Vue 3 + Vite + Pinia + Vue Router,
Socket.IO for live state, and an optional MQTT bridge for home automation.

## Requirements

- Node.js LTS (ESM)
- The Jukie backend listening on `http://localhost:3000` (see the repository root README)

## Getting started

```powershell
cd apps\web
npm install
copy .env.example .env   # optional
npm run dev
```

The dev server runs on <http://localhost:5173> and proxies:

| Path | Target | Notes |
| --- | --- | --- |
| `/api` | `http://localhost:3000` | REST API |
| `/socket.io` | `http://localhost:3000` | WebSocket upgrade (`ws: true`) |

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start Vite with the API/WebSocket proxy |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

## Environment variables

All variables are read at build time by Vite and must be prefixed with `VITE_`.

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE` | *(empty)* | Absolute API origin. Leave empty to use the same origin (recommended — the dev proxy and production single-origin deploy both rely on this). |
| `VITE_MQTT_URL` | *(unset)* | WebSocket MQTT broker URL, e.g. `ws://homeassistant.local:9001`. **When unset the MQTT store stays dormant and never attempts a connection.** |
| `VITE_MQTT_TOPIC_PREFIX` | `jukie` | Topic prefix for the bridge. |

### MQTT bridge

When `VITE_MQTT_URL` is set the app:

- subscribes to `<prefix>/command` and accepts JSON `{ "action": "...", "value": ... }` messages.
  Supported actions: `play`, `resume`, `pause`, `toggle`, `stop`, `start`, `skip`/`next`,
  `seek` (value = seconds), `volume` (value = 0–100), `loop` (value = boolean, omit to toggle).
- publishes the current player state (retained) to `<prefix>/state`.

## Identity and admin

- The first load shows a full-screen join gate; the chosen name is stored in `localStorage` under
  `jukie.name` and sent on every request as the `x-jukebox-user` header (URL-encoded if non-ASCII).
  "Change name" lives in the sidebar footer.
- The admin PIN is validated through `POST /api/admin/auth`, stored as `jukie.pin`, and sent as the
  `x-admin-pin` header. Admin-only UI stays disabled until the server accepts the PIN.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Now playing hero, live queue with per-item actions, moods row, recently added row |
| `/library` | Debounced search, genre chips, card grid with add/play-next/preview/delete, external search tab |
| `/upload` | Drag & drop uploader with progress and a metadata preview |
| `/moods` | Browse moods and their songs, select a mood to play |
| `/admin` | PIN entry, volume, queue start/stop/clear, mood CRUD, audio output, storage management |

Browser previews on `/library` and `/moods` use a plain `<audio>` element against
`GET /api/songs/:id/media`; they are local to your device only and never affect room playback. Only
one preview plays at a time.

## Project layout

```
src/
  lib/        api.js (fetch wrapper + headers), socket.js (shared Socket.IO client), format.js, preview.js
  stores/     session, player, queue, library, moods, ui, mqtt
  components/ AppSidebar, PlayerBar, JoinGate, ToastHost, SongCard, QueueItemRow, MoodCard, ArtThumb
  views/      HomeView, LibraryView, UploadView, MoodsView, AdminView
```

## Production

```powershell
npm run build
```

The output in `dist/` is a static bundle — serve it from the Jukie backend (or any static host) on
the same origin as `/api` and `/socket.io`.
