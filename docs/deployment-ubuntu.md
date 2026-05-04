# Ubuntu Deployment Notes

## Install Dependencies

```bash
sudo apt update
sudo apt install -y nodejs npm mpv sqlite3
```

Prefer using Node from `nvm`, `fnm`, or NodeSource for a current LTS version.

## Create App Directories

```bash
sudo mkdir -p /var/lib/office-jukebox/uploads
sudo mkdir -p /var/lib/office-jukebox/db
sudo chown -R $USER:$USER /var/lib/office-jukebox
```

## Environment Variables

Create `.env` for the server:

```env
PORT=3000
DATABASE_URL="file:/var/lib/office-jukebox/db/db.sqlite"
UPLOAD_DIR="/var/lib/office-jukebox/uploads"
ADMIN_PIN="change-me"
```

## Run Server

```bash
npm install
npm run dev
```

## Audio Output Checks

Test audio from the Ubuntu server:

```bash
mpv --no-video /path/to/test-song.mp3
```

If running as a systemd service, audio permissions may require extra setup depending on whether the server uses PipeWire, PulseAudio, or ALSA.
