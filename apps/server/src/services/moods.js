import { config } from "../config.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/http.js";
import { mapMood } from "../lib/serializers.js";
import { runtime } from "../runtime.js";
import { getHistory, normalizeHistoryLimit } from "./queue.js";
import { getActiveMoodId, setActiveMoodId } from "./settings.js";

const DEFAULT_HISTORY_MOOD_LIMIT = 25;

function dedupe(values) {
  return [...new Set(values)];
}

export async function listMoods() {
  const moods = await prisma.mood.findMany({
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { songs: true } } }
  });

  const activeMoodId = await getActiveMoodId();
  return moods.map((mood) => ({ ...mapMood(mood), isActive: mood.id === activeMoodId }));
}

export async function getMood(moodId) {
  const id = typeof moodId === "string" ? moodId.trim() : "";
  if (!id) throw httpError(400, "mood id is required");

  const mood = await prisma.mood.findUnique({
    where: { id },
    include: {
      _count: { select: { songs: true } },
      songs: { orderBy: { position: "asc" }, include: { song: true } }
    }
  });
  if (!mood) throw httpError(404, "Mood not found");

  const activeMoodId = await getActiveMoodId();
  return { ...mapMood(mood, { includeSongs: true }), isActive: mood.id === activeMoodId };
}

function normalizeMoodInput(body, { requireSongs }) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw httpError(400, "name is required");
  if (name.length > 80) throw httpError(400, "name must be 80 characters or fewer");

  if (body?.songIds === undefined || body?.songIds === null) {
    if (requireSongs) throw httpError(400, "songIds must be an array");
    return { name, songIds: null };
  }

  if (!Array.isArray(body.songIds)) throw httpError(400, "songIds must be an array");

  const songIds = body.songIds.map((songId) => (typeof songId === "string" ? songId.trim() : ""));
  if (songIds.some((songId) => !songId)) throw httpError(400, "Every songId must be a non-empty string");
  if (songIds.length > config.maxMoodSongs) {
    throw httpError(400, `A mood can contain up to ${config.maxMoodSongs} songs`);
  }
  if (new Set(songIds).size !== songIds.length) {
    throw httpError(400, "A mood cannot contain the same song more than once");
  }

  return { name, songIds };
}

async function assertSongsExist(songIds) {
  if (!songIds?.length) return;
  const songs = await prisma.song.findMany({ where: { id: { in: songIds } }, select: { id: true } });
  if (songs.length !== songIds.length) throw httpError(400, "One or more songs do not exist");
}

export async function createMood(body) {
  const input = normalizeMoodInput(body, { requireSongs: false });
  await assertSongsExist(input.songIds);

  const mood = await prisma.mood.create({
    data: {
      name: input.name,
      songs: { create: (input.songIds || []).map((songId, position) => ({ songId, position })) }
    },
    include: {
      _count: { select: { songs: true } },
      songs: { orderBy: { position: "asc" }, include: { song: true } }
    }
  });

  await runtime.realtime.broadcastMoods();
  return mapMood(mood, { includeSongs: true });
}

/**
 * Turns the recent playback history into a mood. Entries are saved in the order they were played
 * (oldest first) with duplicates collapsed to their first appearance. Pass `songIds` to save an
 * explicit selection instead of the whole window.
 */
export async function createMoodFromHistory(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw httpError(400, "name is required");

  let songIds;

  if (body?.songIds !== undefined && body?.songIds !== null) {
    if (!Array.isArray(body.songIds)) throw httpError(400, "songIds must be an array");
    songIds = dedupe(body.songIds.map((songId) => (typeof songId === "string" ? songId.trim() : "")));
    if (songIds.some((songId) => !songId)) throw httpError(400, "Every songId must be a non-empty string");
  } else {
    const limit = normalizeHistoryLimit(body?.limit, DEFAULT_HISTORY_MOOD_LIMIT);
    const history = await getHistory({ limit });
    // getHistory() is newest first; a mood should replay in the order the room heard it.
    songIds = dedupe(history.reverse().map((entry) => entry.song?.id).filter(Boolean));
  }

  if (!songIds.length) throw httpError(409, "There is no playback history to save yet");
  if (songIds.length > config.maxMoodSongs) songIds = songIds.slice(-config.maxMoodSongs);

  return createMood({ name, songIds });
}

export async function updateMood(moodId, body) {
  const id = typeof moodId === "string" ? moodId.trim() : "";
  if (!id) throw httpError(400, "mood id is required");

  const input = normalizeMoodInput(body, { requireSongs: false });
  const existing = await prisma.mood.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw httpError(404, "Mood not found");
  await assertSongsExist(input.songIds);

  const mood = await prisma.$transaction(async (tx) => {
    if (input.songIds) {
      await tx.moodSong.deleteMany({ where: { moodId: id } });
    }

    return tx.mood.update({
      where: { id },
      data: {
        name: input.name,
        ...(input.songIds
          ? { songs: { create: input.songIds.map((songId, position) => ({ songId, position })) } }
          : {})
      },
      include: {
        _count: { select: { songs: true } },
        songs: { orderBy: { position: "asc" }, include: { song: true } }
      }
    });
  });

  await runtime.realtime.broadcastMoods();
  return mapMood(mood, { includeSongs: true });
}

export async function deleteMood(moodId) {
  const id = typeof moodId === "string" ? moodId.trim() : "";
  if (!id) throw httpError(400, "mood id is required");

  const result = await prisma.mood.deleteMany({ where: { id } });
  if (!result.count) throw httpError(404, "Mood not found");

  if ((await getActiveMoodId()) === id) await setActiveMoodId(null);
  await runtime.realtime.broadcastMoods();
  return { ok: true };
}

/**
 * Selecting a mood replaces the upcoming queue with that mood's songs and makes it the mood that
 * upvotes save into.
 */
export async function selectMood(moodId, viewer) {
  const id = typeof moodId === "string" ? moodId.trim() : "";
  if (!id) throw httpError(400, "mood id is required");

  const result = await prisma.$transaction(async (tx) => {
    const mood = await tx.mood.findUnique({
      where: { id },
      include: { songs: { orderBy: { position: "asc" }, select: { songId: true } } }
    });
    if (!mood) return { error: "not-found" };
    if (!mood.songs.length) return { error: "empty" };

    const cleared = await tx.queueItem.updateMany({
      where: { status: "queued" },
      data: { status: "replaced" }
    });

    const queuedAt = Date.now();
    for (const [position, entry] of mood.songs.entries()) {
      await tx.queueItem.create({
        data: {
          songId: entry.songId,
          requestedBy: viewer.name,
          requesterKey: viewer.key,
          createdAt: new Date(queuedAt + position)
        }
      });
    }

    return { name: mood.name, queuedCount: mood.songs.length, replacedCount: cleared.count };
  });

  if (result.error === "not-found") throw httpError(404, "Mood not found");
  if (result.error === "empty") throw httpError(409, "This mood has no available songs");

  await setActiveMoodId(id);
  await runtime.realtime.broadcastQueue();
  await runtime.realtime.broadcastMoods();
  await runtime.player.start();
  return { ok: true, ...result };
}
