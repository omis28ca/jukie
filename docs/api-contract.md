# API Contract

Base URL: `/api`. JSON errors use `{ "error": "message" }`. Admin routes require `x-admin-pin` matching the configured four-digit `ADMIN_PIN`.

## Songs

- `GET /songs` returns newest-first song objects. Each includes metadata plus `artworkUrl`, `mediaUrl`, `mimeType`, and `duration`.
- `POST /songs/upload` accepts multipart fields `file` (exactly one), optional `title`, `artist`, and `uploadedBy`; returns the created song with status 201. Allowed extensions and maximum size are configured by the server.
- `GET /songs/:id/artwork` returns extracted embedded artwork or 404.
- `GET /songs/:id/media` streams uploaded media and supports a single HTTP byte range (`206`, `Content-Range`) for browser seeking.
- `DELETE /songs/:id` is admin-only and deletes the song, every queue history row, media, and artwork. Deleting the active song safely advances playback.

## External music

- `GET /external/search?provider=archive&q=...` returns Internet Archive audio tagged CC0 or Public Domain. Results include source/license attribution and whether the item is already imported.
- `GET /external/search?provider=youtube&q=...` uses the configured official YouTube Data API and returns link-only results. YouTube media is not importable.
- `POST /external/import` accepts `{ "provider": "archive", "sourceId": "identifier", "sourceFile": "track.mp3" }`. The server revalidates the exact file and public-domain metadata, downloads a quota-limited MP3 into managed storage, and returns `{ song, alreadyImported }`. Searches and imports are rate-limited.

## Moods

- `GET /moods` returns name-sorted moods with their songs in playlist order.
- Admin-only `POST /moods` creates a mood from `{ "name": "Friday energy", "songIds": ["uuid"] }`.
- Admin-only `PUT /moods/:id` replaces a mood's name and ordered songs using the same body.
- Admin-only `DELETE /moods/:id` deletes a mood without deleting its songs.
- `POST /moods/:id/select` accepts `{ "requestedBy": "optional" }`. Anyone may select a mood; selection atomically replaces all upcoming queue items without interrupting the currently playing song.

## Queue

- `GET /queue` returns active `playing` and `queued` items in playback order.
- `POST /queue` accepts `{ "songId": "uuid", "requestedBy": "optional", "playNext": false }`. `playNext: true` inserts before existing queued items. Requesters may have at most 20 active items.
- `DELETE /queue/:id` removes one item only while it is `queued`.
- `DELETE /queue` is admin-only and marks all `queued` items cleared without interrupting the playing item.

## Player

- `GET /player` returns `{ state, volume, nowPlaying, positionSeconds, loopQueue, audioOutput }`.
- `POST /player/skip`, `/pause`, and `/resume` are listener controls with no body.
- Admin-only `POST /player/stop` and `/start` have no body.
- `POST /player/seek` accepts `{ "positionSeconds": 0 }`.
- Admin-only `POST /player/volume` accepts `{ "volume": 0..100 }`.
- `POST /player/loop` accepts `{ "enabled": true }`.
- Admin-only `GET|POST /admin/settings/audio-output` reads or writes `{ "deviceId": "auto" }`.

## Socket.IO

The server emits `queue:updated`, `moods:updated`, `player:state`, `player:now-playing`, `song:uploaded`, `songs:updated`, and `player:error`. Clients may emit `queue:refresh`, `moods:refresh`, and `player:refresh` to request current snapshots.
