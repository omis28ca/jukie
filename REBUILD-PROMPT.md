# One-Prompt build Spec

Copy/paste everything below into a coding agent to recreate this application from scratch.

---

Build a complete, runnable full-stack app named **Office Jukebox** with this exact behavior and stack.

## Objective
Create a local-network office jukebox where users upload songs, browse a shared library, queue tracks, and see live now-playing/queue status. The server runs audio playback through `mpv` (Ubuntu host target).

## Stack (required)
- Frontend: Vue 3 + Vite + Pinia + Vue Router + Socket.IO client
- Backend: Node.js (ESM) + Fastify + Socket.IO + Prisma
- DB: SQLite
- Playback: `mpv` with IPC (`--input-ipc-server`)
- Metadata/artwork: `ffprobe` + `ffmpeg`

## Project structure
- `apps/server` (API, sockets, playback)
- `apps/web` (Vue UI)
- `docs` (architecture, API contract, deployment)
- `storage/uploads` and `storage/artwork` for persisted files

## Functional requirements

### Upload and metadata
- Upload endpoint supports one audio file and optional `title`, `artist`, `uploadedBy`.
- Allowed extensions configurable (default `.mp3,.wav,.m4a,.flac`).
- On upload, scan embedded metadata from file:
  - `title`, `artist`, `album`, `genre`, `year`, `duration`
- If embedded album art exists, extract and store it as an image file.
- Return song payload including `artworkUrl` when artwork exists.

### Library
- Show song cards with title/artist + album/year/genre when present.
- Show album art thumbnail when available.
- Search by title, artist, album, genre.
- Add-to-queue button.
- Delete button (admin PIN required).

### Queue rules
- QueueItem statuses include at least: `queued`, `playing`, `played`, `skipped`, `stopped`, `cleared`, `error`.
- Active statuses are `queued` and `playing`.
- Enforce max 20 active items per requester.
- `requesterKey` = `requestedBy` if provided, else `ip:<request.ip>`.

### Playback behavior
- Auto-play earliest queued item (`createdAt asc`).
- Expose player state with:
  - `state`, `volume`, `nowPlaying`, `positionSeconds`, `loopQueue`
- Controls: skip, pause, resume, stop, start, seek, volume, loop toggle.
- `stop` halts current playback and pauses queue progression.
- `start` resumes queue progression.
- If loop queue enabled, naturally finished track goes back to queue tail instead of becoming `played`.

### Song deletion
- Deleting a song must work even if queued/playing.
- If song is currently playing, skip it first.
- Remove dependent queue rows + song row transactionally.
- Delete audio file and extracted artwork file from disk.

### Realtime
- Server emits:
  - `queue:updated`
  - `player:state`
  - `player:now-playing`
  - `song:uploaded`
  - `player:error`
- Client emits:
  - `queue:refresh`
  - `player:refresh`

### UI routes
- `/` Now Playing view:
  - current song metadata/artwork
  - progress display + seek slider
  - admin controls: Start Queue, Loop Queue toggle, Skip, Pause/Resume, Stop, Clear Queue
  - upcoming queue list
- `/library` Library view:
  - requester name input
  - search field
  - song cards + Add/Delete actions
- `/upload` Upload view:
  - modern drag/drop zone + browse
  - optional metadata inputs
  - upload status + preview of extracted metadata/artwork
- `/admin` Admin view:
  - admin PIN field
  - volume slider + Set Volume button

## API (must implement)
- `GET /api/songs`
- `POST /api/songs/upload`
- `GET /api/songs/:id/artwork`
- `DELETE /api/songs/:id` (admin)
- `GET /api/queue`
- `POST /api/queue`
- `DELETE /api/queue` (admin)
- `GET /api/player`
- `POST /api/player/skip` (admin)
- `POST /api/player/pause` (admin)
- `POST /api/player/resume` (admin)
- `POST /api/player/stop` (admin)
- `POST /api/player/start` (admin)
- `POST /api/player/seek` (admin)
- `POST /api/player/volume` (admin)
- `POST /api/player/loop` (admin)

## Prisma schema requirements

### Song
- `id String @id @default(uuid())`
- `title String`
- `artist String?`
- `album String?`
- `genre String?`
- `year Int?`
- `filename String`
- `path String`
- `mimeType String?`
- `artworkFilename String?`
- `artworkMimeType String?`
- `artworkPath String?`
- `duration Int?`
- `uploadedBy String?`
- `createdAt DateTime @default(now())`

### QueueItem
- `id String @id @default(uuid())`
- `songId String`
- relation to Song
- `requestedBy String?`
- `requesterKey String @default("")`
- `status String @default("queued")`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- indexes:
  - `@@index([status, createdAt])`
  - `@@index([requesterKey, status])`

## Security and config
- Admin routes protected by header `x-admin-pin` only when `ADMIN_PIN` is set.
- Server env vars:
  - `PORT`, `DATABASE_URL`, `UPLOAD_DIR`, `ARTWORK_DIR`, `ADMIN_PIN`
  - `MAX_UPLOAD_MB`, `ALLOWED_AUDIO_EXTENSIONS`
  - `PLAYER_EXEC`, `AUDIO_PROBE_EXEC`, `AUDIO_TRANSCODE_EXEC`
- Web env vars:
  - `VITE_API_BASE`, `VITE_SOCKET_URL`

## Deliverables
- Complete source files for backend and frontend
- `package.json` scripts for install/dev/build/prisma
- Prisma schema + db push workflow
- Minimal but clear docs:
  - root `README.md`
  - `docs/api-contract.md`
  - `docs/architecture.md`
  - `docs/deployment-ubuntu.md`
- Working defaults in `.env.example` for server and web

## Validation to run before finishing
- Backend syntax check and Prisma setup
- Frontend production build
- Report any blockers explicitly (for example file-lock issues on Windows)

Do not switch to React. Do not omit realtime sockets. Do not move playback into the browser.

