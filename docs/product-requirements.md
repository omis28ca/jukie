# Product Requirements

## Goal

Build a web-based office jukebox where employees can upload songs and add songs to a shared playback queue. The Ubuntu server hosting the app is also the physical audio output source.

## Users

### Employee
- Upload a song
- Browse uploaded songs
- Add a song to the queue
- View current song
- View upcoming queue

### Admin
- Skip current song
- Pause/resume playback
- Adjust volume
- Clear queue
- Optionally delete songs

## MVP Features

1. Song upload
2. Song library
3. Add song to queue
4. Live shared queue
5. Now playing display
6. Automatic next-song playback
7. Admin playback controls

## Recommended Guardrails

- Allowed file types: `.mp3`, `.wav`, `.m4a`, `.flac`
- Max upload size: configurable, recommended 50–100 MB
- One active queued song per user/IP at a time
- Admin PIN or password for admin controls
- Sanitize filenames
- Store uploads outside public web root
- Serve audio files only if needed by backend, not by direct static directory exposure

## Non-Goals for MVP

- Spotify integration
- YouTube integration
- User accounts
- Mobile app
- Lyrics
- Voting
- Complex permissions
- Remote cloud storage
