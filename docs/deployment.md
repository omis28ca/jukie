# Deployment

## Ubuntu host

Install Node.js 20+, `mpv`, and FFmpeg:

```bash
sudo apt update
sudo apt install -y mpv ffmpeg
cd /opt/jukie/apps/server
cp .env.example .env
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm start
```

Set a private four-digit `ADMIN_PIN` in `.env`. Relative database and storage paths resolve from `apps/server`, so start the process from that directory. For a persistent service, configure systemd with `WorkingDirectory=/opt/jukie/apps/server`, `ExecStart=/usr/bin/npm start`, and restart-on-failure.

Keep `PLAYER_STATE_FILE` on persistent local storage (the default is `/opt/jukie/storage/player-state.json`). It records only the active mpv IPC endpoint and lets a restarted server stop orphaned playback before resuming the queue.

To bulk import a mood, copy a folder into `/opt/jukie/storage/imports` (or the configured `IMPORT_DIR`). The server recursively imports supported files in relative-path order, names the mood after the folder, then deletes that source folder. For slow network copies, use a `.uploading` suffix and rename the folder after copying completes. Ensure the service account can read, rename, and delete folders in the inbox and write to `UPLOAD_DIR` and `ARTWORK_DIR`.

External public-domain search requires outbound HTTPS access to `archive.org`. To enable official YouTube link search, create a restricted YouTube Data API v3 key and set `YOUTUBE_API_KEY`; YouTube content is not downloaded. Configure `EXTERNAL_IMPORT_MAX_MB` to cap each Internet Archive import and `EXTERNAL_LIBRARY_MAX_MB` to cap their total managed storage. When nginx runs on the same host, set `TRUST_PROXY=loopback` so per-client rate limits use the forwarded client IP without trusting arbitrary remote proxies.

Build the web app:

```bash
cd /opt/jukie/apps/web
cp .env.example .env
npm ci
npm run build
```

Serve `apps/web/dist` with nginx or another static server. Configure nginx to proxy `/api` and `/socket.io` to port 3000, or set `VITE_API_BASE` and `VITE_SOCKET_URL` before building. Vue Router uses history mode, so static hosting must fall back unknown paths to `index.html`.

## Windows development

```powershell
Set-Location "C:\Users\omis\src\jukie\apps\server"
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm ci
npm run prisma:generate
npm run prisma:push
npm run dev
```

In a second terminal:

```powershell
Set-Location "C:\Users\omis\src\jukie\apps\web"
Copy-Item .env.example .env -ErrorAction SilentlyContinue
npm ci
npm run dev
```

Set explicit `PLAYER_EXEC`, `AUDIO_PROBE_EXEC`, and `AUDIO_TRANSCODE_EXEC` paths if the tools are not on `PATH`.

## Existing databases

`prisma migrate deploy` is intended for databases created from the included migrations. For the pre-migration development database in an older checkout, back it up and run `npm run prisma:push` once to align foreign keys, or start with a new SQLite file.
