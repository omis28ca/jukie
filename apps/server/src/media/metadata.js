import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

export const EMPTY_METADATA = Object.freeze({
  duration: null,
  title: null,
  artist: null,
  album: null,
  genre: null,
  year: null,
  hasEmbeddedArtwork: false,
  hasAudioStream: false,
  audioCodec: null,
  formatName: null
});

const MIME_TYPES = {
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".wav": "audio/wav"
};

export function getMimeTypeForExtension(extension) {
  return MIME_TYPES[String(extension).toLowerCase()] || "application/octet-stream";
}

function normalizeTags(tags) {
  const normalized = {};
  if (!tags || typeof tags !== "object") return normalized;

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) continue;
    const normalizedKey = String(key).trim().toLowerCase();
    const normalizedValue = String(value).trim();
    if (normalizedKey && normalizedValue) normalized[normalizedKey] = normalizedValue;
  }

  return normalized;
}

function parseYear(value) {
  if (!value) return null;
  const match = String(value).match(/(19|20)\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

export async function probeAudioMetadata(filePath) {
  return new Promise((resolve) => {
    const probe = spawn(config.audioProbeExec, [
      "-v",
      "error",
      "-show_streams",
      "-show_entries",
      "format=format_name,duration:format_tags",
      "-of",
      "json",
      filePath
    ]);

    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => {
      probe.kill();
      finish(null);
    }, 30000);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    }

    probe.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    probe.once("error", () => finish(null));

    probe.once("close", (code) => {
      if (code !== 0) return finish(null);

      try {
        const parsed = JSON.parse(stdout);
        const duration = Number(parsed?.format?.duration);
        const tags = normalizeTags(parsed?.format?.tags);
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
        const audioStream = streams.find((stream) => stream?.codec_type === "audio") || null;

        finish({
          duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
          title: tags.title || null,
          artist: tags.artist || tags.album_artist || null,
          album: tags.album || null,
          genre: tags.genre || null,
          year: parseYear(tags.date || tags.year || tags.originaldate),
          hasEmbeddedArtwork: streams.some(
            (stream) => stream?.codec_type === "video" && Number(stream?.disposition?.attached_pic) === 1
          ),
          hasAudioStream: Boolean(audioStream),
          audioCodec: typeof audioStream?.codec_name === "string" ? audioStream.codec_name : null,
          formatName: typeof parsed?.format?.format_name === "string" ? parsed.format.format_name : null
        });
      } catch {
        finish({ ...EMPTY_METADATA });
      }
    });
  });
}

export async function extractEmbeddedArtwork(inputPath, outputSeed) {
  const artworkFilename = `${outputSeed}.jpg`;
  const artworkPath = join(config.artworkDir, artworkFilename);

  return new Promise((resolve) => {
    const ffmpeg = spawn(config.audioTranscodeExec, [
      "-y",
      "-v",
      "error",
      "-i",
      inputPath,
      "-an",
      "-map",
      "0:v:0",
      "-vf",
      "scale=2000:2000:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-fs",
      "10485760",
      artworkPath
    ]);

    let settled = false;
    const timeout = setTimeout(() => {
      ffmpeg.kill();
      finish(null);
    }, 30000);

    async function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!result) await rm(artworkPath, { force: true }).catch(() => {});
      resolve(result);
    }

    ffmpeg.once("error", () => finish(null));
    ffmpeg.once("close", (code) => {
      if (code !== 0) return finish(null);
      finish({ artworkFilename, artworkPath, artworkMimeType: "image/jpeg" });
    });
  });
}
