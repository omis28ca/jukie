# Architecture

## High-Level Flow

```txt
Employee browser / phone
        |
        v
Vue 3 frontend
        |
REST API + WebSocket
        |
Node.js backend
        |
SQLite database + local uploads
        |
mpv playback process
        |
Ubuntu server audio output
```

## Recommended Components

### Frontend

- Vue 3
- Vite
- Pinia
- Vue Router
- Socket.IO client

Pages:
- `/` — now playing + queue
- `/library` — list songs and add to queue
- `/upload` — upload song
- `/admin` — playback controls

### Backend

- Node.js
- Fastify
- Socket.IO
- Prisma
- SQLite
- Multer or Fastify multipart
- `child_process` to control `mpv`

### Playback

Use `mpv` installed on Ubuntu:

```bash
sudo apt update
sudo apt install mpv
```

Initial MVP can spawn `mpv` per track. Later improvement: run `mpv` with IPC socket for better pause/resume/volume control.

## Suggested Deployment

- Run backend as a `systemd` service
- Backend serves the built Vue frontend
- Use Nginx reverse proxy later if desired
- Store uploads in `/var/lib/office-jukebox/uploads`
- Store SQLite DB in `/var/lib/office-jukebox/db.sqlite`
