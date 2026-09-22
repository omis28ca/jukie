import { config } from "../config.js";
import { httpError, requireObjectBody } from "../lib/http.js";
import { createRateLimiter } from "../lib/http.js";
import { getRequester } from "../lib/identity.js";
import { mapSong } from "../lib/serializers.js";
import { runtime } from "../runtime.js";
import { createExternalMusicService } from "../services/external-music.js";
import {
  cancelYoutubeDownload,
  getYoutubeDownloaderStatus,
  listYoutubeJobs,
  startYoutubeDownload,
  validateYoutubeRequest
} from "../services/ytdlp.js";
import { prisma } from "../db.js";
import { extractEmbeddedArtwork, probeAudioMetadata } from "../media/metadata.js";

const searchLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const importLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 });
const downloadLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

let externalMusicService = null;
let externalMusicUploadDir = null;

/** Rebuilt when the admin moves the library so imports follow the configured storage drive. */
function externalMusic() {
  if (!externalMusicService || externalMusicUploadDir !== config.uploadDir) {
    externalMusicUploadDir = config.uploadDir;
    externalMusicService = createExternalMusicService({
      prisma,
      uploadDir: config.uploadDir,
      maxImportBytes: config.externalImportMaxBytes,
      maxLibraryBytes: config.externalLibraryMaxBytes,
      youtubeApiKey: config.youtubeApiKey,
      probeAudioMetadata,
      extractEmbeddedArtwork
    });
  }
  return externalMusicService;
}

let importInProgress = false;

function normalizeResult(result) {
  return {
    ...result,
    watchUrl: result.externalUrl || null,
    sourceUrl: result.externalUrl || null
  };
}

export async function externalRoutes(fastify) {
  fastify.get("/api/external/search", async (request) => {
    const query = typeof request.query?.q === "string" ? request.query.q.trim() : "";
    const provider = typeof request.query?.provider === "string" ? request.query.provider.trim().toLowerCase() : "";

    if (query.length < 2) throw httpError(400, "Search query must contain at least 2 characters");
    if (query.length > 100) throw httpError(400, "Search query must be 100 characters or fewer");
    if (!searchLimiter(request.ip)) throw httpError(429, "Too many external searches; try again shortly");

    if (provider) {
      const results = await externalMusic().search(provider, query);
      return { results: results.map(normalizeResult) };
    }

    const providers = config.youtubeApiKey ? ["archive", "youtube"] : ["archive"];
    const settled = await Promise.allSettled(providers.map((entry) => externalMusic().search(entry, query)));
    const results = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));

    return { results: results.map(normalizeResult) };
  });

  fastify.post("/api/external/import", async (request, reply) => {
    requireObjectBody(request.body);

    const provider = String(request.body.provider ?? "").trim().toLowerCase();
    const compositeId = String(request.body.id ?? "").trim();
    const separatorIndex = compositeId.indexOf("/");
    const sourceId = String(request.body.sourceId ?? (separatorIndex > 0 ? compositeId.slice(0, separatorIndex) : "")).trim();
    const sourceFile = String(
      request.body.sourceFile ?? (separatorIndex > 0 ? compositeId.slice(separatorIndex + 1) : "")
    ).trim();

    if (!provider) throw httpError(400, "provider is required");
    if (!sourceId) throw httpError(400, "sourceId is required");
    if (!sourceFile) throw httpError(400, "sourceFile is required");
    if (!importLimiter(request.ip)) throw httpError(429, "External import limit reached; try again later");
    if (importInProgress) throw httpError(429, "Another external song is being imported; try again shortly");

    importInProgress = true;
    try {
      const result = await externalMusic().importTrack(provider, sourceId, sourceFile);
      const song = mapSong(result.song);
      if (!result.alreadyImported) runtime.realtime.io.emit("song:uploaded", song);
      return reply.code(result.alreadyImported ? 200 : 201).send({ song, alreadyImported: result.alreadyImported });
    } finally {
      importInProgress = false;
    }
  });

  /** Is yt-dlp usable on this server, and what are the current download limits? */
  fastify.get("/api/external/youtube", async () => {
    return getYoutubeDownloaderStatus({ refresh: true });
  });

  fastify.get("/api/external/youtube/jobs", async () => {
    return { jobs: listYoutubeJobs() };
  });

  /**
   * Hands a YouTube link to yt-dlp. The finished folder is dropped into the import inbox, where the
   * folder importer turns it into a mood.
   */
  fastify.post("/api/external/youtube/download", async (request, reply) => {
    requireObjectBody(request.body);

    const requester = getRequester(request);
    const mode = typeof request.body.mode === "string" ? request.body.mode.trim().toLowerCase() : "audio";
    const playlist = request.body.playlist ?? false;

    // Validate before spending a rate-limit slot so typos do not lock a guest out for an hour.
    validateYoutubeRequest({ url: request.body.url, mode, playlist });

    if (!requester.isAdmin && !downloadLimiter(request.ip)) {
      throw httpError(429, "YouTube download limit reached; try again later");
    }

    const job = await startYoutubeDownload({
      url: request.body.url,
      folderName: request.body.folderName,
      mode,
      playlist,
      requestedBy: requester.name
    });

    return reply.code(202).send({ job });
  });

  fastify.delete("/api/external/youtube/jobs/:id", async (request) => {
    return { job: cancelYoutubeDownload(String(request.params?.id || "")) };
  });
}
