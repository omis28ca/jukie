import { config } from "../config.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/http.js";
import { mapHistoryItem, mapQueueItem } from "../lib/serializers.js";
import { runtime } from "../runtime.js";
import { getActiveMoodId } from "./settings.js";
import { orderQueuedItems } from "./queue-order.js";

/** Statuses of tracks that actually reached the speakers, newest first in the history feed. */
export const HISTORY_STATUSES = ["played", "skipped"];

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

export function normalizeHistoryLimit(value, fallback = DEFAULT_HISTORY_LIMIT) {
  if (value === undefined || value === null || value === "") return fallback;

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw httpError(400, `limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}`);
  }
  return limit;
}

/**
 * Recently finished tracks, newest first. Songs deleted from the library drop out with their
 * queue items, so every entry always has a song attached.
 */
export async function getHistory({ limit } = {}) {
  const take = normalizeHistoryLimit(limit);

  const items = await prisma.queueItem.findMany({
    where: { status: { in: HISTORY_STATUSES } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    include: { song: true }
  });

  return items.map(mapHistoryItem);
}

export async function getActiveQueueRaw() {
  return prisma.queueItem.findMany({
    where: { status: { in: config.activeQueueStatuses } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { song: true, votes: true }
  });
}

export function snapshotQueue(rawItems, viewer = null) {
  const nowPlaying = rawItems.find((item) => item.status === "playing") || null;
  const queued = rawItems.filter((item) => item.status === "queued");
  const orderedQueued = orderQueuedItems(queued, { previousArtist: nowPlaying?.song?.artist });

  return {
    queue: orderedQueued.map((item) => mapQueueItem(item, viewer)),
    nowPlaying: mapQueueItem(nowPlaying, viewer)
  };
}

export async function getQueueSnapshot(viewer = null) {
  return snapshotQueue(await getActiveQueueRaw(), viewer);
}

async function loadItem(queueItemId) {
  const id = typeof queueItemId === "string" ? queueItemId.trim() : "";
  if (!id) throw httpError(400, "queue item id is required");

  const item = await prisma.queueItem.findUnique({ where: { id }, include: { song: true, votes: true } });
  if (!item) throw httpError(404, "Queue item not found");
  return item;
}

function assertControl(item, viewer) {
  if (viewer.isAdmin) return;
  if (item.requesterKey !== viewer.key) {
    throw httpError(403, "Only the requester or an admin can control this track");
  }
}

function assertActive(item) {
  if (!config.activeQueueStatuses.includes(item.status)) {
    throw httpError(409, "This track is no longer in the queue");
  }
}

export async function enqueueSong({ songId, viewer, playNext = false }) {
  const normalizedSongId = typeof songId === "string" ? songId.trim() : "";
  if (!normalizedSongId) throw httpError(400, "songId is required");
  if (typeof playNext !== "boolean") throw httpError(400, "playNext must be a boolean");

  const song = await prisma.song.findUnique({ where: { id: normalizedSongId }, select: { id: true } });
  if (!song) throw httpError(404, "Song not found");

  const item = await prisma.queueItem.create({
    data: {
      songId: normalizedSongId,
      requestedBy: viewer.name,
      requesterKey: viewer.key,
      playNext
    },
    include: { song: true, votes: true }
  });

  await runtime.realtime.broadcastQueue();
  await runtime.player.ensurePlaying();
  return mapQueueItem(item, viewer);
}

export async function removeQueueItem(queueItemId, viewer) {
  const item = await loadItem(queueItemId);
  assertControl(item, viewer);
  if (item.status !== "queued") throw httpError(409, "Only upcoming tracks can be removed");

  await prisma.queueItem.update({ where: { id: item.id }, data: { status: "removed" } });
  await runtime.realtime.broadcastQueue();
  return { ok: true };
}

export async function clearQueue(viewer) {
  const where = viewer.isAdmin ? { status: "queued" } : { status: "queued", requesterKey: viewer.key };
  const result = await prisma.queueItem.updateMany({ where, data: { status: "cleared" } });

  await runtime.realtime.broadcastQueue();
  return { ok: true, clearedCount: result.count };
}

/**
 * Randomizes the upcoming queue order while preserving `playNext` pins.
 */
export async function shuffleQueue(viewer) {
  if (!viewer?.isAdmin) {
    throw httpError(403, "Only an admin can shuffle the queue");
  }

  const queued = await prisma.queueItem.findMany({
    where: { status: "queued", playNext: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true }
  });
  if (queued.length < 2) return { ok: true, shuffledCount: queued.length };

  const shuffled = [...queued];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const baseMs = Date.now();
  await prisma.$transaction(
    shuffled.map((item, index) =>
      prisma.queueItem.update({
        where: { id: item.id },
        data: { createdAt: new Date(baseMs + index) }
      })
    )
  );

  await runtime.realtime.broadcastQueue();
  return { ok: true, shuffledCount: shuffled.length };
}

export async function setPlayNext(queueItemId, viewer, enabled) {
  const item = await loadItem(queueItemId);
  assertControl(item, viewer);
  assertActive(item);
  if (item.status !== "queued") throw httpError(409, "This track is already playing");

  await prisma.queueItem.update({
    where: { id: item.id },
    data: { playNext: Boolean(enabled), ...(enabled ? { createdAt: new Date() } : {}) }
  });

  await runtime.realtime.broadcastQueue();
  return { ok: true, playNext: Boolean(enabled) };
}

/**
 * A downvote removes the track: one vote per person per track, and a vote on the playing track
 * skips it.
 */
export async function downvoteQueueItem(queueItemId, viewer) {
  const item = await loadItem(queueItemId);
  assertActive(item);

  if (item.votes.some((vote) => vote.voterKey === viewer.key)) {
    throw httpError(409, "You have already voted on this track");
  }

  await prisma.queueItemVote.create({
    data: { queueItemId: item.id, voterKey: viewer.key, kind: "down" }
  });

  if (item.status === "playing") {
    await runtime.player.skip();
  } else {
    await prisma.queueItem.update({ where: { id: item.id }, data: { status: "removed" } });
  }

  await removeSongFromActiveMood(item.songId);
  await runtime.realtime.broadcastQueue();
  return { ok: true, removed: true };
}

/**
 * An upvote promotes the track to play next and saves it to the active mood when it is missing.
 */
export async function upvoteQueueItem(queueItemId, viewer) {
  const item = await loadItem(queueItemId);
  assertActive(item);

  await prisma.queueItemVote.deleteMany({ where: { queueItemId: item.id, voterKey: viewer.key } });
  await prisma.queueItemVote.create({
    data: { queueItemId: item.id, voterKey: viewer.key, kind: "up" }
  });

  if (item.status === "queued") {
    await prisma.queueItem.update({
      where: { id: item.id },
      data: { playNext: true, createdAt: new Date() }
    });
  }

  const savedToMood = await addSongToActiveMood(item.songId);
  await runtime.realtime.broadcastQueue();
  return { ok: true, playNext: item.status === "queued", savedToMood };
}

export async function playNow(queueItemId, viewer) {
  const item = await loadItem(queueItemId);
  assertControl(item, viewer);
  assertActive(item);

  if (item.status === "playing") return { ok: true, alreadyPlaying: true };

  await prisma.queueItem.update({
    where: { id: item.id },
    data: { playNext: true, createdAt: new Date(0) }
  });
  await runtime.player.skip();
  await runtime.player.ensurePlaying();
  await runtime.realtime.broadcastQueue();
  return { ok: true };
}

export async function getPlayingItem() {
  return prisma.queueItem.findFirst({ where: { status: "playing" }, include: { song: true, votes: true } });
}

/**
 * Transport actions issued from a queue row only apply to the track that is actually playing.
 */
export async function authorizeTransport(queueItemId, viewer) {
  const item = await loadItem(queueItemId);
  assertControl(item, viewer);
  assertActive(item);
  return item;
}

async function addSongToActiveMood(songId) {
  const moodId = await getActiveMoodId();
  if (!moodId) return false;

  const mood = await prisma.mood.findUnique({ where: { id: moodId }, select: { id: true } });
  if (!mood) return false;

  const existing = await prisma.moodSong.findFirst({ where: { moodId, songId }, select: { id: true } });
  if (existing) return false;

  const last = await prisma.moodSong.findFirst({
    where: { moodId },
    orderBy: { position: "desc" },
    select: { position: true }
  });
  if ((last?.position ?? -1) + 1 >= config.maxMoodSongs) return false;

  await prisma.moodSong.create({ data: { moodId, songId, position: (last?.position ?? -1) + 1 } });
  await runtime.realtime.broadcastMoods();
  return true;
}

async function removeSongFromActiveMood(songId) {
  const moodId = await getActiveMoodId();
  if (!moodId) return false;

  const removed = await prisma.moodSong.deleteMany({ where: { moodId, songId } });
  if (!removed.count) return false;

  await runtime.realtime.broadcastMoods();
  return true;
}
