# One-Prompt build (Short)

Use this exact prompt with a coding agent:

---

Rebuild **Office Jukebox** from scratch as a full-stack app.

## Stack (required)
- Frontend: Vue 3 + Vite + Pinia + Vue Router + Socket.IO client
- Backend: Node.js (ESM) + Fastify + Socket.IO + Prisma
- DB: SQLite
- Playback: `mpv` server-side via IPC
- Metadata/artwork: `ffprobe` + `ffmpeg`

Do not use React. Do not move playback to browser.

## Must-have features
1. **Upload**
   - Drag/drop + browse upload UI
   - Optional title/artist/uploader inputs
   - Scan embedded metadata on upload: title, artist, album, genre, year, duration
   - Extract embedded album art and store locally
2. **Library**
   - Search by title/artist/album/genre
   - Show artwork + metadata
   - Add to queue
   - Delete song (admin PIN)
3. **Queue/Playback**
   - Shared queue + realtime updates
   - Auto-play queued songs in order
   - Controls: start, stop, skip, pause, resume, seek, volume, loop queue
   - Stop pauses progression until start is pressed
   - Loop queue recycles naturally finished songs to queue tail
   - Per-requester limit: max 20 active songs (`queued` + `playing`)
4. **Now Playing UI**
   - Cover art, progress slider (seek), upcoming queue, admin transport controls

## Required API
- Songs: `GET /api/songs`, `POST /api/songs/upload`, `GET /api/songs/:id/artwork`, `DELETE /api/songs/:id`
- Queue: `GET /api/queue`, `POST /api/queue`, `DELETE /api/queue`
- Player: `GET /api/player`, `POST /api/player/skip`, `/pause`, `/resume`, `/stop`, `/start`, `/seek`, `/volume`, `/loop`

Admin endpoints require `x-admin-pin` when `ADMIN_PIN` is set.

## Required websockets
Server emits: `queue:updated`, `player:state`, `player:now-playing`, `song:uploaded`, `player:error`
Client emits: `queue:refresh`, `player:refresh`

## Required data model
### Song
`id,title,artist,album,genre,year,filename,path,mimeType,artworkFilename,artworkMimeType,artworkPath,duration,uploadedBy,createdAt`

### QueueItem
`id,songId,requestedBy,requesterKey,status,createdAt,updatedAt`
Indexes: `(status,createdAt)` and `(requesterKey,status)`

## Required routes
- `/` now playing
- `/library` library
- `/upload` uploader
- `/admin` pin + volume

## Environment
Server env: `PORT,DATABASE_URL,UPLOAD_DIR,ARTWORK_DIR,ADMIN_PIN,MAX_UPLOAD_MB,ALLOWED_AUDIO_EXTENSIONS,PLAYER_EXEC,AUDIO_PROBE_EXEC,AUDIO_TRANSCODE_EXEC`
Web env: `VITE_API_BASE,VITE_SOCKET_URL`

## Deliverables
- Complete source in `apps/server` and `apps/web`
- Prisma schema + working scripts
- Docs: root `README.md`, `docs/api-contract.md`, `docs/architecture.md`, `docs/deployment-ubuntu.md`
- `.env.example` files for server/web

## Verification before done
- Backend syntax passes
- Prisma push/generate configured
- Frontend build passes
- Report blockers clearly if any

---

Reference details: `REBUILD-PROMPT.md` (full version) and `AGENT-INSTRUCTIONS.md`.

