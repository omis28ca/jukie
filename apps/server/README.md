# Jukebox Backend (MVP)

Fastify + Prisma + SQLite backend for the Office Jukebox.

## Features

- Configurable audio/MP4 upload endpoint with file type and size guardrails
- Embedded metadata + album artwork scanning during uploads
- Automatic folder-to-mood imports from a configurable server inbox
- External search with public-domain Internet Archive imports and official YouTube links
- Song library and queue APIs
- Queue fairness rule: up to 20 active queued/playing requests per requester (`requestedBy` or fallback IP)
- Server-side playback orchestration with `mpv`
- Listener controls for skip/pause/resume/seek/loop and PIN-gated delete/stop/start/volume/clear actions
- Byte-range media streaming for browser audio/video previews
- Socket.IO events for queue/player updates

## Environment

Copy `.env.example` to `.env` and adjust values:

- `PORT`
- `DATABASE_URL`
- `UPLOAD_DIR`
- `ARTWORK_DIR`
- `IMPORT_DIR` (default `../../storage/imports`)
- `IMPORT_SETTLE_MS` (default `10000`)
- `IMPORT_POLL_MS` (default `5000`)
- `ADMIN_PIN`
- `MAX_UPLOAD_MB` (default `5120`, i.e. 5 GB)
- `ALLOWED_AUDIO_EXTENSIONS`
- `YOUTUBE_API_KEY` (optional; enables official YouTube Data API search)
- `EXTERNAL_IMPORT_MAX_MB` (default `250`)
- `EXTERNAL_LIBRARY_MAX_MB` (default `5120`)
- `TRUST_PROXY` (optional; use `loopback` for a same-host nginx proxy)
- `PLAYER_EXEC` (optional; path to `mpv` binary)
- `PLAYER_STATE_FILE` (default `../../storage/player-state.json`)
- `AUDIO_PROBE_EXEC` (optional; defaults to `ffprobe`)
- `AUDIO_TRANSCODE_EXEC` (optional; defaults to `ffmpeg`)

On Windows dev machines, if `PLAYER_EXEC` is unset, the server auto-detects `../../mpv-x86_64-v3/mpv.exe` (from `apps/server`) before falling back to `mpv` on `PATH`.
If `AUDIO_PROBE_EXEC` is unset, the server auto-detects `../../ffmpeg-8.1.2/bin/ffprobe.exe` (from `apps/server`) before falling back to `ffprobe` on `PATH`.

## Folder imports

Copy each playlist folder into `IMPORT_DIR` (by default, `storage/imports` at the repository root). The server waits until its supported media files have stopped changing, recursively imports them in relative-path order, and creates or replaces a mood named after the top-level folder.

Imported media is copied into `UPLOAD_DIR`, so the source folder is deleted after the complete mood succeeds. Unsupported files in that folder are ignored and removed with the source folder. If any song or database operation fails, newly imported songs are rolled back and the source folder remains for an automatic retry.

For especially slow or intermittent network copies, copy the folder with an `.uploading` suffix and rename it when the copy finishes (for example, `Road Trip.uploading` to `Road Trip`). These folders are ignored until renamed. Otherwise, increase `IMPORT_SETTLE_MS`. Up to 10,000 supported songs may be imported into one mood.

## External music search

Library search can query Internet Archive audio explicitly marked with CC0 or the Public Domain Mark. The server returns exact MP3 tracks, revalidates the selected file and license metadata, downloads it into managed storage, records the source and license URLs, and prevents duplicate imports. Internet Archive metadata is uploader-supplied, so users should review the linked source and license attribution. Imports are serialized, rate-limited per IP, and constrained by per-file and total-library storage limits.

Set `YOUTUBE_API_KEY` to enable official YouTube search links. YouTube media is never downloaded, cached, or audio-extracted because the YouTube API policies prohibit importing it into the jukebox library.

## Local Setup

```powershell
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

## Notes

- `pause`/`resume`/`volume` use `mpv` IPC (`--input-ipc-server`) with a Unix socket.
- If the IPC socket is not yet ready (first ~1s of a track), SIGSTOP/SIGCONT are used as a fallback for pause/resume.
- IPC socket files are written to `$TMPDIR` (typically `/tmp`) and cleaned up after each track.
- Volume changes mid-track apply immediately via IPC; they also persist to the next track.
- Shutdown waits for mpv to exit before disconnecting the database. The active IPC endpoint is persisted so startup can stop orphaned playback before resuming the queue.
