# Office Jukebox

This repository is a complete local-network jukebox for an office:
- users upload audio files,
- users queue tracks from a shared library,
- an Ubuntu host plays audio through `mpv`,
- everyone sees live queue/player state in real time.

The project is intentionally optimized for **simple local deployment**, not internet-scale auth or cloud complexity.

## Tech Stack

- Frontend: Vue 3 + Vite + Pinia + Vue Router + Socket.IO client
- Backend: Node.js (ESM) + Fastify + Socket.IO
- Data: SQLite + Prisma
- Playback engine: `mpv` (server-side process)
- Metadata/artwork tools: `ffprobe` + `ffmpeg`

## Core Product Behavior

### User capabilities
- Upload audio (`.mp3`, `.wav`, `.m4a`, `.flac`; configurable)
- Drag/drop upload UI with post-upload metadata preview
- Browse/search library (title/artist/album/genre)
- Add songs to queue
- Watch now playing + queue updates live

### Admin capabilities (PIN-gated)
- Start/stop queue playback
- Skip track
- Pause/resume
- Seek position
- Set volume
- Toggle loop queue on/off
- Clear queued entries
- Delete songs (including while playing)

### Queue rules
- Active statuses: `queued`, `playing`
- Per-requester active cap: **20 songs**
- Requester identity: provided name or fallback `ip:<request.ip>`
- Loop mode: naturally finished tracks return to queue tail instead of falling off

## High-Level Architecture

- `apps/server` exposes REST + Socket.IO and controls `mpv`
- `apps/web` provides UI routes:
  - `/` now playing + queue + transport/admin controls
  - `/library` searchable songs + enqueue + delete (admin)
  - `/upload` drag/drop uploader
  - `/admin` PIN + volume control
- `storage/uploads` stores audio files
- `storage/artwork` stores extracted cover images

## Data Model (Prisma)

### `Song`
- `id`, `title`, `artist`, `album`, `genre`, `year`
- file fields: `filename`, `path`, `mimeType`
- artwork fields: `artworkFilename`, `artworkMimeType`, `artworkPath`
- `duration`, `uploadedBy`, `createdAt`

### `QueueItem`
- `id`, `songId` relation, `requestedBy`, `requesterKey`, `status`
- `createdAt`, `updatedAt`
- indexes on `(status, createdAt)` and `(requesterKey, status)`

## API Summary

Base path: `/api`

### Songs
- `GET /api/songs`
- `POST /api/songs/upload` (multipart: `file`, optional `title`, `artist`, `uploadedBy`)
- `GET /api/songs/:id/artwork`
- `DELETE /api/songs/:id` (admin)

### Queue
- `GET /api/queue`
- `POST /api/queue`
- `DELETE /api/queue` (admin clear queued items)

### Player
- `GET /api/player`
- `POST /api/player/skip|pause|resume|stop|start`
- `POST /api/player/seek`
- `POST /api/player/volume`
- `POST /api/player/loop`

For complete request/response shapes, see `docs/api-contract.md`.

## WebSocket Contract

Server emits:
- `queue:updated`
- `player:state`
- `player:now-playing`
- `song:uploaded`
- `player:error`

Client emits:
- `queue:refresh`
- `player:refresh`

## Environment Variables

### Server (`apps/server/.env`)
- `PORT`
- `DATABASE_URL`
- `UPLOAD_DIR`
- `ARTWORK_DIR`
- `ADMIN_PIN`
- `MAX_UPLOAD_MB`
- `ALLOWED_AUDIO_EXTENSIONS`
- `PLAYER_EXEC` (optional)
- `AUDIO_PROBE_EXEC` (optional)
- `AUDIO_TRANSCODE_EXEC` (optional)

### Web (`apps/web/.env`)
- `VITE_API_BASE`
- `VITE_SOCKET_URL`

## Local Run

### Backend
```powershell
Set-Location "C:\Users\omar\src\pm-jukebox\apps\server"
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

### Frontend
```powershell
Set-Location "C:\Users\omar\src\pm-jukebox\apps\web"
npm install
npm run dev
```

## Rebuild This App From Scratch

If another agent must rebuild everything from one prompt, use:
- `AGENT-INSTRUCTIONS.md` for exact constraints and delivery requirements
- `REBUILD-PROMPT.md` for a copy/paste, single-shot implementation prompt

## Acceptance Criteria

A rebuild is considered complete when:
- all routes/views above exist and function,
- uploads support drag/drop and scan embedded metadata/artwork,
- queue/player state syncs in real time via sockets,
- playback controls work against server-side `mpv`,
- loop mode recycles naturally completed tracks,
- per-requester queue cap enforcement works,
- deleting currently playing tracks is handled safely,
- frontend build and backend startup succeed locally.
