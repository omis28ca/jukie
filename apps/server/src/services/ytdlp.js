import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/http.js";
import { mapSong } from "../lib/serializers.js";
import { EMPTY_METADATA, extractEmbeddedArtwork, getMimeTypeForExtension, probeAudioMetadata } from "../media/metadata.js";
import { runtime } from "../runtime.js";
import { enqueueSong } from "./queue.js";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com"
]);

/** Hidden so the folder importer ignores downloads that are still in flight. */
const STAGING_PREFIX = ".yt-dlp-";
const MAX_JOBS = 20;
const MAX_PENDING_JOBS = 20;
const YOUTUBE_PROVIDER = "youtube";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SEARCH_RESULT_COUNT = 10;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const SEARCH_TIMEOUT_MS = 45 * 1000;
const MAX_CONCURRENT_SEARCHES = 2;
const FILTERED_PATTERN = /does not pass filter/i;
// Noise YouTube uploaders append to song titles; stripped so the library reads like a music library.
const TITLE_NOISE_PATTERN =
  /\s*[([](?:official\s*)?(?:hd\s*|4k\s*|hq\s*)?(?:music\s*|lyrics?\s*|audio\s*|visuali[sz]er\s*)?(?:video|audio|lyrics?|visuali[sz]er|hd|hq|4k|remastered(?:\s*\d{4})?)\s*[)\]]/gi;
const PROGRESS_PATTERN = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/;
const DESTINATION_PATTERN = /^\[(?:download|ExtractAudio|Merger)\]\s+(?:Destination|Merging formats into):\s*"?(.+?)"?$/;

const jobs = [];
const pendingJobs = [];
let activeJob = null;
let availabilityCache = null;
const searchCache = new Map();
let runningSearches = 0;

/** Client-facing view of a job: the process handles never leave the server. */
function serializeJob(job) {
  const { cancel, cancelled, pid, run, requests, filtered, ...rest } = job;
  return { ...rest, requestCount: requests?.length ?? 0 };
}

function publish(job) {
  job.updatedAt = new Date().toISOString();
  runtime.realtime?.io?.emit("ytdlp:job", serializeJob(job));
  return job;
}

export function listYoutubeJobs() {
  return jobs.map(serializeJob);
}

/** Accepts any YouTube watch/short/playlist link and returns the canonical URL plus its ids. */
export function normalizeYoutubeUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw httpError(400, "A YouTube link is required");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(400, "That does not look like a URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw httpError(400, "Only http(s) links are supported");
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw httpError(400, "Only YouTube links are supported here");
  }

  const playlistId = parsed.searchParams.get("list") || "";
  let videoId = parsed.searchParams.get("v") || "";
  if (!videoId) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) || "";
    if (parsed.hostname.toLowerCase().endsWith("youtu.be")) videoId = last;
    else if (["shorts", "embed", "live", "v"].includes(segments[0])) videoId = last;
  }

  if (!videoId && !playlistId) throw httpError(400, "That YouTube link has no video or playlist id");

  const url = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${
        playlistId ? `&list=${encodeURIComponent(playlistId)}` : ""
      }`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;

  return { url, videoId: videoId || null, playlistId: playlistId || null };
}

export function sanitizeFolderName(value, fallback = "YouTube download") {
  const cleaned = String(value ?? "")
    // Strip path separators, Windows-reserved characters and control codes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

async function uniqueFolderPath(name) {
  let candidate = name;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const taken = await readdir(config.importDir)
      .then((entries) => entries.includes(candidate) || entries.includes(`${candidate}.uploading`))
      .catch(() => false);
    if (!taken) break;
    candidate = `${name} (${attempt})`;
  }
  return { name: candidate, path: join(config.importDir, candidate) };
}

/** Confirms the yt-dlp binary can run, so the UI can explain itself instead of failing downloads. */
export async function getYoutubeDownloaderStatus({ refresh = false } = {}) {
  if (availabilityCache && !refresh) return availabilityCache;

  const status = await new Promise((resolve) => {
    let stdout = "";
    let child;
    try {
      child = spawn(config.ytdlpExec, ["--version"], { windowsHide: true });
    } catch (error) {
      resolve({ available: false, version: null, error: error.message });
      return;
    }
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", (error) => resolve({ available: false, version: null, error: error.message }));
    child.on("close", (code) =>
      resolve(
        code === 0
          ? { available: true, version: stdout.trim() || null, error: null }
          : { available: false, version: null, error: `yt-dlp exited with code ${code}` }
      )
    );
  });

  availabilityCache = {
    ...status,
    exec: config.ytdlpExec,
    importDir: config.importDir,
    maxFileMb: config.ytdlpMaxFileMb,
    maxPlaylistItems: config.ytdlpMaxPlaylistItems,
    maxSongMinutes: config.ytdlpMaxSongMinutes,
    busy: Boolean(activeJob)
  };
  return availabilityCache;
}

function buildArgs({ url, stagingDir, mode, playlist, playerClients, kind = "folder" }) {
  const args = [
    "--ignore-config",
    "--no-colors",
    "--newline",
    "--no-cache-dir",
    "--no-overwrites",
    "--retries",
    "3",
    "--max-filesize",
    `${config.ytdlpMaxFileMb}M`
  ];

  // --ffmpeg-location wants a path; a bare command name only works via PATH, which yt-dlp finds itself.
  if (/[\\/]/.test(config.audioTranscodeExec)) {
    args.push("--ffmpeg-location", config.audioTranscodeExec);
  }

  if (playerClients) args.push("--extractor-args", `youtube:player_client=${playerClients}`);

  if (kind === "song") {
    // One library track: prefer YouTube's native AAC stream so no transcode is needed, split
    // "Artist - Title" uploads into proper tags, and keep the thumbnail as cover art.
    args.push(
      "--no-playlist",
      "--match-filter",
      `!is_live & duration <= ${config.ytdlpMaxSongMinutes * 60}`,
      "-o",
      join(stagingDir, "%(id)s.%(ext)s"),
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
      "--parse-metadata",
      "title:%(artist)s - %(title)s",
      "--embed-metadata",
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg"
    );
    args.push(...config.ytdlpExtraArgs, url);
    return args;
  }

  if (playlist) {
    args.push(
      "--yes-playlist",
      "--playlist-items",
      `1-${config.ytdlpMaxPlaylistItems}`,
      "-o",
      join(stagingDir, "%(playlist_title,title)s", "%(playlist_index)s - %(title)s.%(ext)s")
    );
  } else {
    args.push("--no-playlist", "-o", join(stagingDir, "%(title)s", "%(title)s.%(ext)s"));
  }

  if (mode === "video") {
    args.push("-f", "bv*+ba/b", "--merge-output-format", "mp4", "--embed-metadata");
  } else {
    args.push("-f", "bestaudio/best", "-x", "--audio-format", "m4a", "--audio-quality", "0", "--embed-metadata");
  }

  args.push(...config.ytdlpExtraArgs, url);
  return args;
}

function runYtdlp(job, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytdlpExec, args, { windowsHide: true });
    const errorLines = [];
    let stdoutRest = "";
    let stderrRest = "";
    let settled = false;

    job.pid = child.pid ?? null;

    const timeout = setTimeout(() => {
      job.message = "Download timed out; stopping yt-dlp";
      child.kill();
    }, config.ytdlpTimeoutMs);
    timeout.unref?.();

    job.cancel = () => {
      job.cancelled = true;
      child.kill();
    };

    function handleLine(line) {
      const text = line.trim();
      if (!text) return;

      if (FILTERED_PATTERN.test(text)) job.filtered = true;

      const progress = PROGRESS_PATTERN.exec(text);
      if (progress) {
        job.progressPercent = Math.min(100, Number(progress[1]));
        job.message = text.replace(/\s+/g, " ");
        publish(job);
        return;
      }

      const destination = DESTINATION_PATTERN.exec(text);
      if (destination) {
        const name = basename(destination[1]);
        job.title = job.title || name.replace(extname(name), "");
        job.message = `Writing ${name}`;
        publish(job);
        return;
      }

      if (text.startsWith("[")) {
        job.message = text.replace(/\s+/g, " ").slice(0, 200);
        publish(job);
      }
    }

    child.stdout.on("data", (chunk) => {
      const parts = (stdoutRest + chunk.toString()).split(/\r?\n/);
      stdoutRest = parts.pop() ?? "";
      for (const line of parts) handleLine(line);
    });

    child.stderr.on("data", (chunk) => {
      const parts = (stderrRest + chunk.toString()).split(/\r?\n/);
      stderrRest = parts.pop() ?? "";
      for (const line of parts) {
        const text = line.trim();
        if (!text) continue;
        errorLines.push(text);
        if (errorLines.length > 20) errorLines.shift();
        runtime.logger?.warn?.({ jobId: job.id, line: text }, "yt-dlp");
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        error.code === "ENOENT"
          ? httpError(503, `yt-dlp was not found at "${config.ytdlpExec}". Install it or set YTDLP_EXEC.`)
          : error
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdoutRest) handleLine(stdoutRest);
      if (code === 0 || code === 101) {
        // 101 is yt-dlp's "download stopped early" (e.g. --max-downloads/--max-filesize).
        resolve({ code, errorLines });
        return;
      }
      if (job.cancelled) {
        reject(new Error("Download cancelled"));
        return;
      }
      reject(new Error(errorLines.at(-1) || `yt-dlp exited with code ${code}`));
    });
  });
}

async function collectDownload(stagingDir) {
  const entries = await readdir(stagingDir, { withFileTypes: true }).catch(() => []);
  const folders = entries.filter((entry) => entry.isDirectory());
  const looseFiles = entries.filter((entry) => entry.isFile());

  // yt-dlp writes <staging>/<title|playlist>/<files>; fall back to loose files if a template misses.
  if (!folders.length && !looseFiles.length) return null;
  if (!folders.length) return { sourceDir: stagingDir, suggestedName: null };
  return { sourceDir: join(stagingDir, folders[0].name), suggestedName: folders[0].name };
}

async function countPlayableFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter(
    (entry) => entry.isFile() && config.allowedAudioExtensions.has(extname(entry.name).toLowerCase())
  ).length;
}

/**
 * Runs yt-dlp, retrying once with explicit extractor clients. YouTube frequently blocks whichever
 * client yt-dlp reaches for first, which surfaces as HTTP 403 or "requested format is not available".
 */
async function downloadWithRetry(job, { stagingDir, url, mode, playlist, kind }) {
  const attempts = [null];
  if (config.ytdlpFallbackClients) attempts.push(config.ytdlpFallbackClients);

  let lastError = null;
  for (const [index, playerClients] of attempts.entries()) {
    if (job.cancelled) break;
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(stagingDir, { recursive: true });

    if (index > 0) {
      job.progressPercent = 0;
      job.message = "YouTube refused that download; retrying with another client…";
      publish(job);
    }

    try {
      return await runYtdlp(job, buildArgs({ url, stagingDir, mode, playlist, playerClients, kind }));
    } catch (error) {
      lastError = error;
      if (job.cancelled || error.statusCode === 503) throw error;
    }
  }

  throw lastError ?? new Error("yt-dlp did not run");
}

/**
 * Downloads run one at a time (yt-dlp is heavy on a small board); everything else waits its turn
 * in FIFO order so several guests can add songs at once without being told to retry.
 */
function scheduleJob(job, run) {
  if (pendingJobs.length >= MAX_PENDING_JOBS) {
    throw httpError(429, "The download queue is full; try again in a few minutes");
  }

  job.run = run;
  jobs.unshift(job);
  while (jobs.length > MAX_JOBS) jobs.pop();
  pendingJobs.push(job);
  if (activeJob) {
    job.status = "queued";
    job.message = "Waiting for the current download to finish…";
  }
  publish(job);
  pumpJobs();
}

function pumpJobs() {
  if (activeJob) return;
  const job = pendingJobs.shift();
  if (!job) return;

  activeJob = job;
  job.status = "downloading";
  job.message = "Starting yt-dlp…";
  publish(job);

  const run = job.run;
  delete job.run;
  run(job).finally(() => {
    delete job.cancel;
    delete job.pid;
    activeJob = null;
    publish(job);
    pumpJobs();
  });
}

async function moveFile(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    // The import inbox and the library can live on different drives.
    if (error.code !== "EXDEV") throw error;
    await copyFile(source, destination);
    await rm(source, { force: true });
  }
}

export function cleanSongTitle(value) {
  const cleaned = String(value ?? "").replace(TITLE_NOISE_PATTERN, "").replace(/\s+/g, " ").trim();
  return cleaned || String(value ?? "").trim();
}

/**
 * Shared validation for the download request so a bad link is rejected before it costs the caller a
 * rate-limit slot.
 */
export function validateYoutubeRequest({ url, mode = "audio", playlist = false } = {}) {
  if (mode !== "audio" && mode !== "video") throw httpError(400, 'mode must be "audio" or "video"');
  if (typeof playlist !== "boolean") throw httpError(400, "playlist must be a boolean");

  const target = normalizeYoutubeUrl(url);
  if (playlist && !target.playlistId) throw httpError(400, "That link does not contain a playlist");
  return target;
}

/**
 * Downloads a YouTube link with yt-dlp into the folder-import inbox. The finished folder is handed
 * to the normal import watcher, which turns it into a mood named after the folder.
 */
export async function startYoutubeDownload({ url, folderName, mode = "audio", playlist = false, requestedBy } = {}) {
  const target = validateYoutubeRequest({ url, mode, playlist });

  const status = await getYoutubeDownloaderStatus({ refresh: true });
  if (!status.available) {
    throw httpError(503, `yt-dlp is not available on the server (${status.error || "unknown error"})`);
  }

  const job = {
    id: randomUUID(),
    kind: "folder",
    url: target.url,
    videoId: target.videoId,
    playlistId: playlist ? target.playlistId : null,
    playlist,
    mode,
    requestedBy: requestedBy || null,
    requestedName: folderName ? sanitizeFolderName(folderName) : null,
    title: null,
    folderName: null,
    moodName: null,
    fileCount: 0,
    status: "downloading",
    progressPercent: 0,
    message: "Starting yt-dlp…",
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Fire and forget: the caller gets the job immediately and follows it over Socket.IO.
  scheduleJob(job, async () => {
    const stagingDir = join(config.importDir, `${STAGING_PREFIX}${job.id}`);
    try {
      await downloadWithRetry(job, { stagingDir, url: target.url, mode, playlist });

      const collected = await collectDownload(stagingDir);
      if (!collected) throw new Error("yt-dlp finished but produced no files");

      const playable = await countPlayableFiles(collected.sourceDir);
      if (!playable) {
        throw new Error("The download contains no files the jukebox can play");
      }

      const wanted = sanitizeFolderName(
        job.requestedName || collected.suggestedName || job.title || "YouTube download"
      );
      const { name, path } = await uniqueFolderPath(wanted);

      // Rename in two steps: ".uploading" is ignored by the importer, so the folder only becomes
      // visible to it once it is completely in place.
      const pendingPath = `${path}.uploading`;
      await rename(collected.sourceDir, pendingPath);
      await rm(stagingDir, { recursive: true, force: true });
      await rename(pendingPath, path);

      job.folderName = name;
      job.moodName = name;
      job.fileCount = playable;
      job.progressPercent = 100;
      job.status = "completed";
      job.message = `Saved ${playable} file${playable === 1 ? "" : "s"} to the import folder; the mood “${name}” appears once the import finishes.`;
      runtime.logger?.info?.({ jobId: job.id, folder: name, files: playable }, "yt-dlp download ready for import");
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      job.status = job.cancelled ? "cancelled" : "failed";
      job.error = job.cancelled ? "Cancelled" : error.message || "Download failed";
      job.message = job.error;
      runtime.logger?.error?.({ jobId: job.id, error }, "yt-dlp download failed");
    }
  });

  return serializeJob(job);
}

export function cancelYoutubeDownload(jobId) {
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) throw httpError(404, "Download not found");
  if (job.status === "queued") {
    const index = pendingJobs.indexOf(job);
    if (index !== -1) pendingJobs.splice(index, 1);
    delete job.run;
    job.status = "cancelled";
    job.error = "Cancelled";
    job.message = "Cancelled";
    publish(job);
    return serializeJob(job);
  }
  if (job.status !== "downloading") throw httpError(409, "That download is no longer running");

  job.cancel?.();
  job.message = "Cancelling…";
  publish(job);
  return serializeJob(job);
}

/** Runs yt-dlp once and returns its JSON output; used for search, which never downloads. */
function runYtdlpJson(args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.ytdlpExec, args, { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), SEARCH_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        error.code === "ENOENT"
          ? httpError(503, `yt-dlp was not found at "${config.ytdlpExec}". Install it or set YTDLP_EXEC.`)
          : error
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const lastLine = stderr.trim().split(/\r?\n/).filter((line) => line.startsWith("ERROR")).at(-1);
        reject(httpError(502, lastLine?.replace(/^ERROR:\s*/, "") || "YouTube search failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(httpError(502, "yt-dlp returned results Jukie could not read"));
      }
    });
  });
}

function toSearchResult(entry) {
  const videoId = String(entry?.id ?? "");
  if (!VIDEO_ID_PATTERN.test(videoId)) return null;
  const duration = Number.isFinite(entry.duration) ? Math.round(entry.duration) : null;
  const isLive = entry.live_status === "is_live" || entry.live_status === "is_upcoming" || entry.is_live === true;
  return {
    videoId,
    title: String(entry.title ?? "Untitled"),
    channel: entry.channel || entry.uploader || null,
    duration,
    isLive,
    tooLong: duration !== null && duration > config.ytdlpMaxSongMinutes * 60,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

/**
 * Searches YouTube through yt-dlp, so no API key is needed. A pasted YouTube link resolves to that
 * one video. Results are cached briefly because each search costs several seconds of CPU.
 */
export async function searchYoutube(rawQuery) {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (query.length < 2) throw httpError(400, "Search for at least 2 characters");
  if (query.length > 200) throw httpError(400, "Search must be 200 characters or fewer");

  let linkedVideo = null;
  try {
    linkedVideo = normalizeYoutubeUrl(query).videoId;
  } catch {
    /* not a link: a plain text search */
  }

  const cacheKey = linkedVideo ? `video:${linkedVideo}` : `q:${query.toLowerCase()}`;
  let cached = searchCache.get(cacheKey);
  if (!cached || Date.now() - cached.at > SEARCH_CACHE_TTL_MS) {
    if (runningSearches >= MAX_CONCURRENT_SEARCHES) {
      throw httpError(429, "YouTube is busy with other searches; try again in a moment");
    }
    runningSearches += 1;
    try {
      const target = linkedVideo
        ? `https://www.youtube.com/watch?v=${linkedVideo}`
        : `ytsearch${SEARCH_RESULT_COUNT}:${query}`;
      const data = await runYtdlpJson([
        "--ignore-config",
        "--no-warnings",
        "--no-cache-dir",
        "--no-playlist",
        "--flat-playlist",
        "--skip-download",
        "-J",
        ...config.ytdlpExtraArgs,
        target
      ]);
      const entries = Array.isArray(data?.entries) ? data.entries : [data];
      cached = { at: Date.now(), results: entries.map(toSearchResult).filter(Boolean) };
    } finally {
      runningSearches -= 1;
    }
    searchCache.delete(cacheKey);
    searchCache.set(cacheKey, cached);
    while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  }

  // Library membership changes between searches, so it is looked up fresh every time.
  const ids = cached.results.map((result) => result.videoId);
  const existing = ids.length
    ? await prisma.song.findMany({
        where: { sourceProvider: YOUTUBE_PROVIDER, sourceId: { in: ids } },
        select: { id: true, sourceId: true }
      })
    : [];
  const songIds = new Map(existing.map((song) => [song.sourceId, song.id]));
  return cached.results.map((result) => ({ ...result, songId: songIds.get(result.videoId) ?? null }));
}

export function assertVideoId(value) {
  const videoId = typeof value === "string" ? value.trim() : "";
  if (!VIDEO_ID_PATTERN.test(videoId)) throw httpError(400, "A valid YouTube video id is required");
  return videoId;
}

export async function findYoutubeSong(videoId) {
  return prisma.song.findUnique({
    where: { sourceProvider_sourceId: { sourceProvider: YOUTUBE_PROVIDER, sourceId: videoId } }
  });
}

/** Turns the finished download into a library song (or reuses one that won a race to exist). */
async function storeYoutubeSong(job, stagingDir) {
  const entries = await readdir(stagingDir, { withFileTypes: true }).catch(() => []);
  const audio = entries.find(
    (entry) => entry.isFile() && config.allowedAudioExtensions.has(extname(entry.name).toLowerCase())
  );
  if (!audio) {
    throw new Error(
      job.filtered
        ? `That video is live or longer than ${config.ytdlpMaxSongMinutes} minutes`
        : "yt-dlp finished but produced no playable audio"
    );
  }
  const thumbnail = entries.find((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".jpg");

  const extension = extname(audio.name).toLowerCase();
  const songId = randomUUID();
  const storedFilename = `${songId}-youtube-${job.videoId}${extension}`;
  const storedPath = join(config.uploadDir, storedFilename);
  let artwork = null;

  try {
    await moveFile(join(stagingDir, audio.name), storedPath);
    const metadata = (await probeAudioMetadata(storedPath)) || EMPTY_METADATA;

    if (thumbnail) {
      const artworkFilename = `${randomUUID()}.jpg`;
      const artworkPath = join(config.artworkDir, artworkFilename);
      await moveFile(join(stagingDir, thumbnail.name), artworkPath);
      artwork = { artworkFilename, artworkMimeType: "image/jpeg", artworkPath };
    } else if (metadata.hasEmbeddedArtwork) {
      artwork = await extractEmbeddedArtwork(storedPath, randomUUID());
    }

    const song = await prisma.song.create({
      data: {
        id: songId,
        title: cleanSongTitle(metadata.title || job.title || "Untitled"),
        artist: metadata.artist || job.channel || null,
        album: metadata.album || null,
        genre: metadata.genre || null,
        year: metadata.year,
        uploadedBy: job.requestedBy || "YouTube",
        filename: storedFilename,
        path: storedPath,
        mimeType: getMimeTypeForExtension(extension),
        artworkFilename: artwork?.artworkFilename || null,
        artworkMimeType: artwork?.artworkMimeType || null,
        artworkPath: artwork?.artworkPath || null,
        duration: metadata.duration,
        sourceProvider: YOUTUBE_PROVIDER,
        sourceId: job.videoId,
        sourceUrl: job.url
      }
    });
    runtime.realtime.io.emit("song:uploaded", mapSong(song));
    return song;
  } catch (error) {
    await Promise.all([
      rm(storedPath, { force: true }).catch(() => {}),
      artwork?.artworkPath ? rm(artwork.artworkPath, { force: true }).catch(() => {}) : null
    ]);
    // P2002: the same video was stored by another path meanwhile; use that copy instead.
    if (error?.code === "P2002") {
      const existing = await findYoutubeSong(job.videoId);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Adds one YouTube video to the library and queues it for everyone who asked. A video that is
 * already being downloaded just gains another requester instead of downloading twice.
 */
export async function addYoutubeSong({ videoId, title, channel, viewer, playNext = false }) {
  if (typeof playNext !== "boolean") throw httpError(400, "playNext must be a boolean");
  const request = { viewer, playNext };

  const inFlight = jobs.find(
    (job) => job.kind === "song" && job.videoId === videoId && (job.status === "queued" || job.status === "downloading")
  );
  if (inFlight) {
    inFlight.requests.push(request);
    return serializeJob(inFlight);
  }

  const status = await getYoutubeDownloaderStatus();
  if (!status.available) {
    throw httpError(503, `yt-dlp is not available on the server (${status.error || "unknown error"})`);
  }

  const job = {
    id: randomUUID(),
    kind: "song",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    playlistId: null,
    playlist: false,
    mode: "audio",
    requestedBy: viewer.name || null,
    requestedName: null,
    title: typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null,
    channel: typeof channel === "string" && channel.trim() ? channel.trim().slice(0, 200) : null,
    folderName: null,
    moodName: null,
    songId: null,
    fileCount: 0,
    status: "downloading",
    progressPercent: 0,
    message: "Starting yt-dlp…",
    error: null,
    requests: [request],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  scheduleJob(job, async () => {
    const stagingDir = join(config.importDir, `${STAGING_PREFIX}${job.id}`);
    try {
      await downloadWithRetry(job, { stagingDir, url: job.url, mode: "audio", playlist: false, kind: "song" });
      const song = await storeYoutubeSong(job, stagingDir);

      job.songId = song.id;
      job.title = song.title;
      job.fileCount = 1;
      job.progressPercent = 100;
      job.status = "completed";
      job.message = `Added “${song.title}” to the library and the queue`;

      for (const entry of job.requests) {
        try {
          await enqueueSong({ songId: song.id, viewer: entry.viewer, playNext: entry.playNext });
        } catch (error) {
          runtime.logger?.error?.({ jobId: job.id, error }, "Downloaded YouTube song could not be queued");
        }
      }
      runtime.logger?.info?.({ jobId: job.id, songId: song.id, videoId: job.videoId }, "YouTube song added");
    } catch (error) {
      job.status = job.cancelled ? "cancelled" : "failed";
      job.error = job.cancelled ? "Cancelled" : error.message || "Download failed";
      job.message = job.error;
      runtime.logger?.error?.({ jobId: job.id, error }, "YouTube song download failed");
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  return serializeJob(job);
}
