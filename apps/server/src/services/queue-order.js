function normalizeArtist(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function artistAwareOrder(items, previousArtist = "") {
  const remaining = [...items];
  const ordered = [];
  let lastArtist = normalizeArtist(previousArtist);

  while (remaining.length) {
    let pickIndex = remaining.findIndex((item) => normalizeArtist(item.song?.artist) !== lastArtist);
    if (pickIndex < 0) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    ordered.push(picked);
    lastArtist = normalizeArtist(picked.song?.artist);
  }

  return ordered;
}

/**
 * Queue policy:
 * 1) `playNext` tracks still win and keep their FIFO order.
 * 2) Remaining tracks keep their queued order (or a manual shuffle order), then are reordered to
 *    avoid consecutive artists when an alternative exists.
 */
export function orderQueuedItems(items, { previousArtist = "" } = {}) {
  const queue = Array.isArray(items) ? items : [];
  const playNext = queue
    .filter((item) => item.playNext)
    .sort((a, b) => Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  const regular = queue.filter((item) => !item.playNext);

  const orderedRegular = [...regular].sort(
    (a, b) => Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)) || String(a.id).localeCompare(String(b.id))
  );

  const initialArtist = playNext.length
    ? normalizeArtist(playNext[playNext.length - 1].song?.artist)
    : normalizeArtist(previousArtist);

  return [...playNext, ...artistAwareOrder(orderedRegular, initialArtist)];
}
