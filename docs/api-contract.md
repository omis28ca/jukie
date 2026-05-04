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
  "filename": "stored-file-name.mp3"
}
```

### List Songs

`GET /api/songs`

Response:

```json
[
  {
    "id": "song_uuid",
    "title": "Song Title",
    "artist": "Artist",
    "duration": 210,
    "createdAt": "2026-05-02T00:00:00.000Z"
  }
]
```

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

### Clear Queue

`DELETE /api/queue`

Admin-only in production.

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
  "volume": 80
}
```

### Skip

`POST /api/player/skip`

### Pause

`POST /api/player/pause`

### Resume

`POST /api/player/resume`

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
