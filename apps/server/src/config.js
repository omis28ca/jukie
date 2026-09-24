import "dotenv/config";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const IS_WIN = process.platform === "win32";

function resolveDir(value, fallback) {
  const setting = String(value || fallback);
  return isAbsolute(setting) ? setting : join(process.cwd(), setting);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function minimumNumber(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function resolveExec(envValue, bundledWindowsPath, fallback) {
  if (envValue) return envValue;
  if (IS_WIN) {
    const bundled = join(process.cwd(), bundledWindowsPath);
    if (existsSync(bundled)) return bundled;
  }
  return fallback;
}

/** Splits an argument string on whitespace while keeping "quoted values" together. */
function splitArgs(value) {
  const matches = String(value || "").match(/"[^"]*"|\S+/g) || [];
  return matches.map((entry) => entry.replace(/^"|"$/g, ""));
}

const maxUploadMb = positiveNumber(process.env.MAX_UPLOAD_MB, 5 * 1024);
const externalImportMaxMb = positiveNumber(process.env.EXTERNAL_IMPORT_MAX_MB, 250);
const externalLibraryMaxMb = positiveNumber(process.env.EXTERNAL_LIBRARY_MAX_MB, 5120);
const trustProxySetting = String(process.env.TRUST_PROXY || "").trim();

/**
 * Storage layout. `STORAGE_ROOT` sets the drive/folder that holds the music library; the three
 * sub-directories can still be pinned individually for unusual setups. An admin can override the
 * root at runtime (persisted in `AppSetting`), which rewrites the three directories below.
 */
const envStorageRoot = resolveDir(process.env.STORAGE_ROOT, "../../storage");
const envUploadDir = resolveDir(process.env.UPLOAD_DIR, join(envStorageRoot, "uploads"));
const envArtworkDir = resolveDir(process.env.ARTWORK_DIR, join(envStorageRoot, "artwork"));
const envImportDir = resolveDir(process.env.IMPORT_DIR, join(envStorageRoot, "imports"));

export const STORAGE_SUBDIRS = {
  uploadDir: "uploads",
  artworkDir: "artwork",
  importDir: "imports"
};

export const config = {
  isWindows: IS_WIN,
  port: positiveNumber(process.env.PORT, 3000),
  host: String(process.env.HOST || "0.0.0.0"),
  publicUrl: String(process.env.PUBLIC_URL || "").trim(),
  adminPin: String(process.env.ADMIN_PIN || "").trim(),
  trustProxy: trustProxySetting === "true" ? true : trustProxySetting || false,

  storageRoot: envStorageRoot,
  uploadDir: envUploadDir,
  artworkDir: envArtworkDir,
  importDir: envImportDir,
  /** Immutable snapshot of what the environment asked for, used to reset the admin override. */
  envStorage: {
    root: envStorageRoot,
    uploadDir: envUploadDir,
    artworkDir: envArtworkDir,
    importDir: envImportDir
  },
  webDist: resolveDir(process.env.WEB_DIST_DIR, "../web/dist"),

  importSettleMs: minimumNumber(process.env.IMPORT_SETTLE_MS, 10000, 0),
  importPollMs: minimumNumber(process.env.IMPORT_POLL_MS, 5000, 100),

  maxUploadMb,
  uploadMaxBytes: maxUploadMb * 1024 * 1024,
  externalImportMaxBytes: externalImportMaxMb * 1024 * 1024,
  externalLibraryMaxBytes: externalLibraryMaxMb * 1024 * 1024,
  youtubeApiKey: String(process.env.YOUTUBE_API_KEY || "").trim(),

  allowedAudioExtensions: new Set(
    String(process.env.ALLOWED_AUDIO_EXTENSIONS || ".mp3,.mp4,.wav,.m4a,.flac")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))
  ),

  playerExec: resolveExec(process.env.PLAYER_EXEC, "../../mpv-x86_64-v3/mpv.exe", "mpv"),
  audioProbeExec: resolveExec(process.env.AUDIO_PROBE_EXEC, "../../ffmpeg-8.1.2/bin/ffprobe.exe", "ffprobe"),
  audioTranscodeExec: resolveExec(process.env.AUDIO_TRANSCODE_EXEC, "../../ffmpeg-8.1.2/bin/ffmpeg.exe", "ffmpeg"),

  /** yt-dlp downloads land in the folder-import inbox and become moods. */
  ytdlpExec: resolveExec(process.env.YTDLP_EXEC, "../../yt-dlp/yt-dlp.exe", "yt-dlp"),
  ytdlpMaxFileMb: positiveNumber(process.env.YTDLP_MAX_FILE_MB, 500),
  ytdlpMaxPlaylistItems: positiveNumber(process.env.YTDLP_MAX_PLAYLIST_ITEMS, 50),
  ytdlpTimeoutMs: positiveNumber(process.env.YTDLP_TIMEOUT_MS, 30 * 60 * 1000),
  /**
   * YouTube regularly blocks whichever client yt-dlp picks first (HTTP 403 / "no formats"), so a
   * failed attempt is retried once with these extractor clients.
   */
  ytdlpFallbackClients: String(process.env.YTDLP_FALLBACK_CLIENTS ?? "android,mweb,tv_simply").trim(),
  ytdlpExtraArgs: splitArgs(process.env.YTDLP_ARGS),

  mqtt: {
    url: String(process.env.MQTT_URL || "").trim(),
    username: String(process.env.MQTT_USERNAME || "").trim(),
    password: String(process.env.MQTT_PASSWORD || "").trim(),
    topicPrefix: String(process.env.MQTT_TOPIC_PREFIX || "jukie").trim().replace(/\/+$/, "") || "jukie"
  },

  maxMoodSongs: 10000,
  activeQueueStatuses: ["queued", "playing"]
};

export const SETTING_KEYS = {
  audioOutputDeviceId: "player.audioOutputDeviceId",
  activeMoodId: "player.activeMoodId",
  storageRoot: "storage.root"
};
