# Office Jukebox — Agent Handoff Pack

This project is a local office jukebox with a Vue 3 web interface and an Ubuntu server as the audio output source.

Employees can:
- Upload songs
- Browse the music library
- Add songs to a shared queue
- See the live queue and current song

Admins can:
- Skip songs
- Pause/resume playback
- Change volume
- Clear the queue

Preferred frontend: **Vue 3**, not React.

Recommended MVP stack:
- Vue 3 + Vite + Pinia
- Node.js + Fastify
- Socket.IO for live queue/player updates
- SQLite + Prisma
- Local file uploads
- `mpv` on Ubuntu for playback

Start with the documents in `/docs`, then implement from the scaffold.
