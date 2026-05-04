# Implementation Plan

## Phase 1 — Backend Foundation

1. Create Node/Fastify server
2. Add Prisma + SQLite
3. Create Song and QueueItem models
4. Add song upload endpoint
5. Add song library endpoint
6. Save files to local upload directory

## Phase 2 — Queue

1. Add queue table
2. Add queue item endpoint
3. Add get queue endpoint
4. Emit `queue:updated` over Socket.IO whenever queue changes

## Phase 3 — Playback

1. Install `mpv` on Ubuntu
2. Create player service in Node
3. Play first queued song automatically
4. Mark queue item as `playing`
5. On process exit, mark as `played` and start next queued song
6. Emit `player:now-playing` and `queue:updated`

## Phase 4 — Vue 3 App

1. Create Vite Vue app
2. Add Pinia store
3. Add pages:
   - Now Playing
   - Library
   - Upload
   - Admin
4. Connect REST API
5. Connect Socket.IO client for live updates

## Phase 5 — Admin Controls

1. Add admin PIN/password middleware
2. Add skip
3. Add pause/resume
4. Add volume
5. Add clear queue

## Phase 6 — Deployment

1. Build frontend
2. Serve built frontend from backend
3. Create `systemd` service
4. Configure upload/db paths
5. Test server audio output
