# Instructions for the Build Agent

You are helping build an office jukebox.

The user is a full-stack developer and prefers Vue 3 over React. Do not switch the frontend to React.

## Build Priorities

1. Get a working local MVP first.
2. Keep the stack simple.
3. Use the Ubuntu host machine as the audio output.
4. Use local uploads before adding external music providers.
5. Do not overbuild authentication; use an admin PIN for the MVP.
6. Keep playback logic server-side.

## Key Decisions Already Made

- Frontend: Vue 3
- Backend: Node.js
- Database: SQLite
- Realtime: Socket.IO
- Playback: `mpv`
- Upload storage: local filesystem
- Deployment target: Ubuntu server

## Start Here

1. Read `/docs/product-requirements.md`
2. Read `/docs/architecture.md`
3. Read `/docs/api-contract.md`
4. Implement backend first
5. Confirm `mpv` can play audio from the Ubuntu server
6. Implement Vue screens after API works

## Important Implementation Warning

The included player service uses basic process control for pause/resume. For a robust version, upgrade to `mpv` IPC using `--input-ipc-server`.
