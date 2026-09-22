function buildArtworkUrl(song) {
  if (!song?.artworkFilename) return null;
  return `/api/songs/${encodeURIComponent(song.id)}/artwork`;
}

export function mapSong(song) {
  if (!song) return null;

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    genre: song.genre,
    year: song.year,
    duration: song.duration,
    artworkUrl: buildArtworkUrl(song),
    mediaUrl: `/api/songs/${encodeURIComponent(song.id)}/media`,
    filename: song.filename,
    mimeType: song.mimeType,
    uploadedBy: song.uploadedBy,
    sourceProvider: song.sourceProvider,
    sourceUrl: song.sourceUrl,
    licenseUrl: song.licenseUrl,
    createdAt: song.createdAt
  };
}

export function mapQueueItem(item, viewer = null) {
  if (!item) return null;

  const votes = Array.isArray(item.votes) ? item.votes : [];

  return {
    id: item.id,
    status: item.status,
    playNext: Boolean(item.playNext),
    requestedBy: item.requestedBy,
    isMine: viewer ? item.requesterKey === viewer.key : false,
    canControl: viewer ? item.requesterKey === viewer.key || viewer.isAdmin : false,
    downvotes: votes.length,
    hasDownvoted: viewer ? votes.some((vote) => vote.voterKey === viewer.key) : false,
    createdAt: item.createdAt,
    song: mapSong(item.song)
  };
}

/** A finished queue item (played through or skipped) as shown in the playback history. */
export function mapHistoryItem(item) {
  if (!item) return null;

  return {
    id: item.id,
    status: item.status,
    requestedBy: item.requestedBy,
    queuedAt: item.createdAt,
    endedAt: item.updatedAt,
    song: mapSong(item.song)
  };
}

export function mapMood(mood, { includeSongs = false } = {}) {
  if (!mood) return null;

  const songs = Array.isArray(mood.songs) ? mood.songs : [];

  return {
    id: mood.id,
    name: mood.name,
    songCount: typeof mood._count?.songs === "number" ? mood._count.songs : songs.length,
    createdAt: mood.createdAt,
    updatedAt: mood.updatedAt,
    ...(includeSongs ? { songs: songs.map((entry) => mapSong(entry.song)) } : {})
  };
}
