# Jukebox Frontend (Vue 3)

Vue 3 + Vite + Pinia frontend for the Office Jukebox.

## Features

- Unified catalog-first workspace with a responsive sidebar and persistent player
- Featured releases plus search, genre/artwork filters, sorting, and requester names
- Live now-playing state and shared queue updates via Socket.IO
- Drag-and-drop upload panel with extracted metadata and artwork preview
- Queue drawer with requester details, play-next, per-item removal, looping, refresh, and clear-upcoming controls
- In-browser audio/video previews that do not affect room playback
- Listener pause, resume, skip, seek, and loop controls plus PIN-protected start, stop, volume, delete, clear, and output-device controls
- Responsive desktop, tablet, and mobile layouts with keyboard-accessible controls

The required URLs remain available as entry points into the same workspace:

- `/` and `/library` open the catalog
- `/upload` opens the upload panel over the catalog
- `/admin` opens Studio Controls over the catalog

Press `Ctrl+K` (or `Cmd+K`) to focus library search from anywhere in the workspace.

## Environment

Create `apps/web/.env` as needed:

```dotenv
VITE_API_BASE=http://localhost:3000
```

If omitted, the frontend calls the same origin.

## Run

```powershell
npm ci
npm run dev
```

## Build

```powershell
npm run build
npm run preview
```

