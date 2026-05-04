# Jukebox Frontend (Vue 3)

Vue 3 + Vite + Pinia frontend for the Office Jukebox.

## Features

- Live `Now Playing` and queue updates via Socket.IO
- Library browsing with search and add-to-queue
- Song upload form with status feedback
- Admin controls (PIN): skip, pause, resume, volume, clear queue
- Connection status and global error/success messaging

## Environment

Create `apps/web/.env` as needed:

```dotenv
VITE_API_BASE=http://localhost:3000
```

If omitted, the frontend calls the same origin.

## Run

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
npm run preview
```

