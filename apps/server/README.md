# Jukebox Backend (MVP)

Fastify + Prisma + SQLite backend for the Office Jukebox.

## Features

- Audio upload endpoint with file type and size guardrails
- Embedded metadata + album artwork scanning during uploads
- Song library and queue APIs
- Queue fairness rule: up to 20 active queued/playing requests per requester (`requestedBy` or fallback IP)
- Server-side playback orchestration with `mpv`
- Admin PIN middleware for skip/pause/resume/stop/start/seek/loop/volume/clear
- Socket.IO events for queue/player updates

## Environment

Copy `.env.example` to `.env` and adjust values:

- `PORT`
- `DATABASE_URL`
- `UPLOAD_DIR`
- `ARTWORK_DIR`
- `ADMIN_PIN`
- `MAX_UPLOAD_MB` (default `5120`, i.e. 5 GB)
- `ALLOWED_AUDIO_EXTENSIONS`
- `PLAYER_EXEC` (optional; path to `mpv` binary)
- `AUDIO_PROBE_EXEC` (optional; defaults to `ffprobe`)
- `AUDIO_TRANSCODE_EXEC` (optional; defaults to `ffmpeg`)

On Windows dev machines, if `PLAYER_EXEC` is unset, the server auto-detects `../../mpv-x86_64-v3/mpv.exe` (from `apps/server`) before falling back to `mpv` on `PATH`.
If `AUDIO_PROBE_EXEC` is unset, the server auto-detects `../../ffmpeg-8.1.2/bin/ffprobe.exe` (from `apps/server`) before falling back to `ffprobe` on `PATH`.

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

