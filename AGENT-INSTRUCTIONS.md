# Build Agent Instructions

Use this file as the implementation contract when rebuilding the entire app from scratch.

## Non-Negotiable Constraints

1. Frontend must be **Vue 3** (no React migration).
2. Keep playback logic server-side; browser must not stream and mix tracks itself.
3. Use local filesystem uploads for MVP.
4. Use admin PIN middleware instead of full auth for MVP.
5. Target local Ubuntu-hosted playback via `mpv`.

## Required Stack

- Backend: Node.js + Fastify + Socket.IO + Prisma + SQLite
- Frontend: Vue 3 + Vite + Pinia + Vue Router + Socket.IO client
- Tooling: `ffprobe` for metadata and `ffmpeg` for embedded artwork extraction

## Required Features

### Upload and Library
- Drag-and-drop uploader + browse fallback
- Accept configurable audio extensions
- Scan embedded tags on upload: title, artist, album, genre, year, duration
- Extract embedded album art to local artwork directory
- Library search by title/artist/album/genre
- Library cards show artwork + metadata

### Queue and Playback
- Add to queue from library
- Shared queue with realtime updates
- Auto-play next queued track in `createdAt` order
- Player state includes: `state`, `volume`, `nowPlaying`, `positionSeconds`, `loopQueue`
- Controls: start, stop, skip, pause, resume, seek, volume, loop toggle
- Stop pauses queue progression until explicit start
- Loop mode recycles naturally played track to queue tail
- Clear queue clears only `queued` items

### Fairness and Safety
- Per requester max 20 active items (`queued` + `playing`)
- Requester key from `requestedBy` else fallback `ip:<request.ip>`
- Song deletion must work even if song is queued/playing
- Deletion must remove dependent queue rows and uploaded files/artwork files

## Data Model Requirements

### Song fields
- `id`, `title`, `artist`, `album`, `genre`, `year`
- `filename`, `path`, `mimeType`
- `artworkFilename`, `artworkMimeType`, `artworkPath`
- `duration`, `uploadedBy`, `createdAt`

### QueueItem fields
- `id`, `songId`, `requestedBy`, `requesterKey`, `status`, `createdAt`, `updatedAt`
- indexes on `(status, createdAt)` and `(requesterKey, status)`

## API Surface (must exist)

### Songs
- `GET /api/songs`
- `POST /api/songs/upload`
- `GET /api/songs/:id/artwork`
- `DELETE /api/songs/:id` (admin)

### Queue
- `GET /api/queue`
- `POST /api/queue`
- `DELETE /api/queue` (admin)

### Player
- `GET /api/player`
- `POST /api/player/skip`
- `POST /api/player/pause`
- `POST /api/player/resume`
- `POST /api/player/stop`
- `POST /api/player/start`
- `POST /api/player/seek`
- `POST /api/player/volume`
- `POST /api/player/loop`

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

## UI Route Requirements

- `/` Now Playing: artwork, progress, queue list, admin transport controls
- `/library` Library: search, add-to-queue, delete (admin)
- `/upload` Upload: drag/drop uploader + metadata preview
- `/admin` Admin: PIN and volume control

## Environment Requirements

Server `.env` must support:
- `PORT`, `DATABASE_URL`, `UPLOAD_DIR`, `ARTWORK_DIR`, `ADMIN_PIN`
- `MAX_UPLOAD_MB`, `ALLOWED_AUDIO_EXTENSIONS`
- `PLAYER_EXEC`, `AUDIO_PROBE_EXEC`, `AUDIO_TRANSCODE_EXEC`

Web `.env` must support:
- `VITE_API_BASE`, `VITE_SOCKET_URL`

## Delivery Checklist

1. Create runnable backend + frontend projects.
2. Include Prisma schema and migration/push workflow.
3. Include docs (`README`, API contract, deployment notes).
4. Provide local startup commands for Windows PowerShell and Ubuntu.
5. Verify frontend build and backend syntax/start.


