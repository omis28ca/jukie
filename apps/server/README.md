# Jukebox Backend (MVP)

Fastify + Prisma + SQLite backend for the Office Jukebox.

## Features

- Audio upload endpoint with file type and size guardrails
- Song library and queue APIs
- Queue fairness rule: one active queued/playing request per requester (`requestedBy` or fallback IP)
- Server-side playback orchestration with `mpv`
- Admin PIN middleware for skip/pause/resume/volume/clear
- Socket.IO events for queue/player updates

## Environment

Copy `.env.example` to `.env` and adjust values:

- `PORT`
- `DATABASE_URL`
- `UPLOAD_DIR`
- `ADMIN_PIN`
- `MAX_UPLOAD_MB`
- `ALLOWED_AUDIO_EXTENSIONS`

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

