# API Contract

Base path: `/api`

## Songs

### Upload Song

`POST /api/songs/upload`

Multipart form fields:
- `file`: audio file
- `title`: optional
- `artist`: optional
- `uploadedBy`: optional

Response:

```json
{
  "id": "song_uuid",
  "title": "Song Title",
  "artist": "Artist",
  "album": "Album Name",
  "genre": "Rock",
  "year": 2021,
  "artworkUrl": "/api/songs/song_uuid/artwork",
  "filename": "stored-file-name.mp3"
}
```

If embedded tags/artwork exist in the uploaded file, the server scans and returns them.

### List Songs

`GET /api/songs`

Response:

```json
[
  {
    "id": "song_uuid",
    "title": "Song Title",
    "artist": "Artist",
    "album": "Album Name",
    "genre": "Rock",
    "year": 2021,
    "artworkUrl": "/api/songs/song_uuid/artwork",
    "duration": 210,
    "createdAt": "2026-05-02T00:00:00.000Z"
  }
]
```

`duration` is in seconds and may be `null` when probing metadata is unavailable.

### Delete Song (Admin)

`DELETE /api/songs/:id`

Headers:
- `x-admin-pin`: required when `ADMIN_PIN` is configured

Responses:

```json
{
  "ok": true
}
```

Possible errors:
- `401` Unauthorized
- `404` Song not found

Notes:
- Deleting a song removes its queue entries (`queued`, `playing`, and history statuses).
- If the song is currently playing, playback is skipped and the queue advances automatically.

### Get Song Artwork

`GET /api/songs/:id/artwork`

Returns embedded/extracted album artwork for the song when available.

## Queue

### Get Queue

`GET /api/queue`

Response:

```json
[
  {
    "id": "queue_item_uuid",
    "status": "queued",
    "requestedBy": "Robert",
    "song": {
      "id": "song_uuid",
      "title": "Song Title",
      "artist": "Artist"
    }
  }
]
```

### Add Song to Queue

`POST /api/queue`

Body:

```json
{
  "songId": "song_uuid",
  "requestedBy": "Robert"
}
```

Response:

```json
{
  "id": "queue_item_uuid",
  "status": "queued"
}
```

Notes:

- A requester can have up to 20 active songs in the queue (`status: "queued"` or `"playing"`).
- If this limit is exceeded, the API returns `409 Conflict`:

```json
{
  "error": "You can only have up to 20 active songs in the queue"
}
```

### Clear Queue

`DELETE /api/queue`

Admin-only in production.

Clears upcoming queued entries (`status: "queued"`) and does not stop the currently playing track.

## Player

### Get Player State

`GET /api/player`

Response:

```json
{
  "state": "playing",
  "nowPlaying": {
    "id": "song_uuid",
    "title": "Song Title",
    "artist": "Artist"
  },
  "volume": 80,
  "positionSeconds": 42.3,
  "loopQueue": true
}
```

`positionSeconds` is the current playback position in seconds.

### Skip

`POST /api/player/skip`

### Pause

`POST /api/player/pause`

### Resume

`POST /api/player/resume`

### Stop

`POST /api/player/stop`

Stops current playback and leaves the queue paused until started again.

### Start

`POST /api/player/start`

### Loop Queue

`POST /api/player/loop`

Body:

```json
{
  "enabled": true
}
```

When enabled, tracks that finish naturally are recycled back into the queue instead of being marked as `played`.

### Seek

`POST /api/player/seek`

Body:

```json
{
  "positionSeconds": 95.5
}
```

### Set Volume

`POST /api/player/volume`

Body:

```json
{
  "volume": 75
}
```

## WebSocket Events

Server emits:

```txt
queue:updated
player:now-playing
player:state
song:uploaded
```

Client emits:

```txt
queue:refresh
player:refresh
```
