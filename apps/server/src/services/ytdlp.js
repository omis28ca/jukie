import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { config } from "../config.js";
import { httpError } from "../lib/http.js";
import { runtime } from "../runtime.js";

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
const PROGRESS_PATTERN = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/;
const DESTINATION_PATTERN = /^\[(?:download|ExtractAudio|Merger)\]\s+(?:Destination|Merging formats into):\s*"?(.+?)"?$/;

const jobs = [];
let activeJob = null;
let availabilityCache = null;

/** Client-facing view of a job: the process handles never leave the server. */
function serializeJob(job) {
  const { cancel, cancelled, pid, ...rest } = job;
  return rest;
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
    busy: Boolean(activeJob)
  };
  return availabilityCache;
}

function buildArgs({ url, stagingDir, mode, playlist, playerClients }) {
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
async function downloadWithRetry(job, { stagingDir, url, mode, playlist }) {
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
      return await runYtdlp(job, buildArgs({ url, stagingDir, mode, playlist, playerClients }));
    } catch (error) {
      lastError = error;
      if (job.cancelled || error.statusCode === 503) throw error;
    }
  }

  throw lastError ?? new Error("yt-dlp did not run");
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
  if (activeJob) throw httpError(429, "Another YouTube download is already running; try again shortly");

  const status = await getYoutubeDownloaderStatus({ refresh: true });
  if (!status.available) {
    throw httpError(503, `yt-dlp is not available on the server (${status.error || "unknown error"})`);
  }

  const job = {
    id: randomUUID(),
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

  jobs.unshift(job);
  while (jobs.length > MAX_JOBS) jobs.pop();
  activeJob = job;
  publish(job);

  const stagingDir = join(config.importDir, `${STAGING_PREFIX}${job.id}`);

  // Fire and forget: the caller gets the job immediately and follows it over Socket.IO.
  (async () => {
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
    } finally {
      delete job.cancel;
      delete job.pid;
      activeJob = null;
      publish(job);
    }
  })();

  return serializeJob(job);
}

export function cancelYoutubeDownload(jobId) {
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) throw httpError(404, "Download not found");
  if (job.status !== "downloading") throw httpError(409, "That download is no longer running");

  job.cancel?.();
  job.message = "Cancelling…";
  publish(job);
  return serializeJob(job);
}
