import { httpError, requireObjectBody } from "../lib/http.js";
import { createRateLimiter } from "../lib/http.js";
import { getRequester } from "../lib/identity.js";
import {
  cancelYoutubeDownload,
  getYoutubeDownloaderStatus,
  listYoutubeJobs,
  startYoutubeDownload,
  validateYoutubeRequest
} from "../services/ytdlp.js";

const downloadLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

export async function externalRoutes(fastify) {
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
