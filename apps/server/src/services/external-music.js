import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const ARCHIVE_PROVIDER = "archive";
const YOUTUBE_PROVIDER = "youtube";
const PUBLIC_DOMAIN_LICENSES = new Map([
  ["https://creativecommons.org/publicdomain/mark/1.0/", "Public Domain Mark 1.0"],
  ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0 1.0"]
]);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asString(value) {
  if (Array.isArray(value)) return asString(value[0]);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLicenseUrl(value) {
  const normalized = asString(value).replace(/^http:/i, "https:").replace(/\/?$/, "/");
  return PUBLIC_DOMAIN_LICENSES.has(normalized) ? normalized : "";
}

function escapeArchiveQuery(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function decodeYouTubeText(value) {
  return asString(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function buildArchiveDownloadUrl(identifier, filename) {
  if (typeof filename !== "string" || filename.includes("\\") || filename.includes("\0")) return "";
  const segments = filename.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  const encodedIdentifier = encodeURIComponent(identifier);
  const encodedFilename = segments.map(encodeURIComponent).join("/");
  const url = new URL(`https://archive.org/download/${encodedIdentifier}/${encodedFilename}`);
  if (!url.pathname.startsWith(`/download/${encodedIdentifier}/`)) return "";
  return url.toString();
}

async function fetchJson(fetchImpl, url, timeoutMs = 15000) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "Jukie/1.0 external music search" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) return response.json();
      if (response.status < 500 || attempt === 2) {
        throw httpError(502, `Music provider request failed with status ${response.status}`);
      }
    } catch (error) {
      if (error?.statusCode || attempt === 2) {
        throw error?.statusCode ? error : httpError(502, `Music provider request failed: ${error.message}`);
      }
    }
    await sleep(250 * (attempt + 1));
  }
  throw httpError(502, "Music provider request failed");
}

class ByteLimitTransform extends Transform {
  constructor(maxBytes) {
    super();
    this.maxBytes = maxBytes;
    this.totalBytes = 0;
  }

  _transform(chunk, encoding, callback) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxBytes) {
      callback(httpError(413, "External audio exceeds the configured import limit"));
      return;
    }
    callback(null, chunk);
  }
}

async function downloadAudio(fetchImpl, url, outputPath, maxBytes) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        headers: { "User-Agent": "Jukie/1.0 public-domain audio import" },
        signal: AbortSignal.timeout(600000)
      });
      if (!response.ok || !response.body) {
        throw httpError(502, `Audio download failed with status ${response.status}`);
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw httpError(413, "External audio exceeds the configured import limit");
      }
      await pipeline(
        Readable.fromWeb(response.body),
        new ByteLimitTransform(maxBytes),
        createWriteStream(outputPath)
      );
      return;
    } catch (error) {
      await rm(outputPath, { force: true }).catch(() => {});
      if (error?.statusCode === 413 || attempt === 2) {
        throw error?.statusCode ? error : httpError(502, `Audio download failed: ${error.message}`);
      }
      await sleep(500 * (attempt + 1));
    }
  }
}

function listArchiveMp3s(files, maxBytes) {
  return [...files]
    .filter((file) => {
      const size = Number(file?.size);
      return typeof file?.name === "string"
        && file.name.toLowerCase().endsWith(".mp3")
        && /mp3/i.test(file.format || "")
        && Boolean(buildArchiveDownloadUrl("item", file.name))
        && file.private !== "true"
        && Number.isFinite(size)
        && size > 0
        && size <= maxBytes;
    })
    .sort((left, right) => {
      const score = (file) =>
        (file.source === "original" ? 100 : 0)
        + (/vbr mp3/i.test(file.format || "") ? 20 : 0)
        + (/128kbps mp3/i.test(file.format || "") ? 10 : 0);
      return score(right) - score(left) || left.name.localeCompare(right.name, undefined, { numeric: true });
    });
}

export function createExternalMusicService({
  prisma,
  uploadDir,
  maxImportBytes,
  maxLibraryBytes,
  youtubeApiKey,
  probeAudioMetadata,
  extractEmbeddedArtwork,
  fetchImpl = fetch
}) {
  const searchCache = new Map();

  async function getExternalLibraryUsageBytes() {
    const songs = await prisma.song.findMany({
      where: { sourceProvider: ARCHIVE_PROVIDER },
      select: { path: true, artworkPath: true }
    });
    const paths = songs.flatMap((song) => [song.path, song.artworkPath].filter(Boolean));
    const sizes = await Promise.all(paths.map((path) => stat(path).then((details) => details.size).catch(() => 0)));
    return sizes.reduce((total, size) => total + size, 0);
  }

  async function searchArchive(query) {
    const escapedQuery = escapeArchiveQuery(query);
    const publicDomainFilter = [
      '"https://creativecommons.org/publicdomain/mark/1.0/"',
      '"https://creativecommons.org/publicdomain/zero/1.0/"'
    ].join(" OR ");
    const searchQuery = `(title:"${escapedQuery}" OR creator:"${escapedQuery}") AND mediatype:audio AND licenseurl:(${publicDomainFilter})`;
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", searchQuery);
    for (const field of ["identifier", "title", "creator", "licenseurl", "downloads"]) {
      url.searchParams.append("fl[]", field);
    }
    url.searchParams.set("rows", "12");
    url.searchParams.set("page", "1");
    url.searchParams.append("sort[]", "downloads desc");
    url.searchParams.set("output", "json");

    const data = await fetchJson(fetchImpl, url);
    const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
    const hydratedItems = await Promise.all(docs.map(async (doc) => {
      const identifier = asString(doc.identifier);
      if (!identifier) return null;
      const item = await fetchJson(fetchImpl, `https://archive.org/metadata/${encodeURIComponent(identifier)}`, 30000);
      const licenseUrl = normalizeLicenseUrl(item?.metadata?.licenseurl);
      if (!licenseUrl) return null;
      return { doc, identifier, item, licenseUrl };
    }));
    const candidates = hydratedItems.flatMap((entry) => {
      if (!entry) return [];
      return listArchiveMp3s(Array.isArray(entry.item?.files) ? entry.item.files : [], maxImportBytes).map((file) => ({
        ...entry,
        file,
        sourceKey: `${entry.identifier}/${file.name}`
      }));
    }).slice(0, 12);
    const sourceKeys = candidates.map((candidate) => candidate.sourceKey);
    const existingSongs = sourceKeys.length
      ? await prisma.song.findMany({
          where: { sourceProvider: ARCHIVE_PROVIDER, sourceId: { in: sourceKeys } },
          select: { id: true, sourceId: true }
        })
      : [];
    const existingBySourceId = new Map(existingSongs.map((song) => [song.sourceId, song.id]));

    return candidates.map(({ doc, identifier, item, licenseUrl, file, sourceKey }) => {
      const itemMetadata = item.metadata || {};
      return {
        provider: ARCHIVE_PROVIDER,
        providerName: "Internet Archive",
        id: sourceKey,
        sourceId: identifier,
        sourceFile: file.name,
        title: asString(file.title) || asString(doc.title) || identifier,
        artist: asString(file.artist || file.creator) || asString(doc.creator || itemMetadata.creator) || "Unknown creator",
        artworkUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
        externalUrl: buildArchiveDownloadUrl(identifier, file.name),
        licenseUrl,
        licenseName: PUBLIC_DOMAIN_LICENSES.get(licenseUrl),
        importable: true,
        importedSongId: existingBySourceId.get(sourceKey) || null
      };
    });
  }

  async function searchYouTube(query) {
    if (!youtubeApiKey) {
      throw httpError(503, "YouTube search is not configured on this server");
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoCategoryId", "10");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("safeSearch", "moderate");
    url.searchParams.set("maxResults", "12");
    url.searchParams.set("q", query);
    url.searchParams.set("key", youtubeApiKey);
    const data = await fetchJson(fetchImpl, url);

    return (Array.isArray(data?.items) ? data.items : []).flatMap((item) => {
      const id = asString(item?.id?.videoId);
      if (!id) return [];
      return [{
        provider: YOUTUBE_PROVIDER,
        providerName: "YouTube",
        id,
        title: decodeYouTubeText(item?.snippet?.title) || "YouTube video",
        artist: decodeYouTubeText(item?.snippet?.channelTitle) || "Unknown channel",
        artworkUrl: asString(item?.snippet?.thumbnails?.medium?.url),
        externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
        licenseUrl: null,
        licenseName: null,
        importable: false,
        importReason: "YouTube permits official links and embeds, not audio downloads."
      }];
    });
  }

  async function refreshArchiveImportedState(results) {
    const sourceKeys = results.map((result) => result.id);
    if (!sourceKeys.length) return results;
    const existingSongs = await prisma.song.findMany({
      where: { sourceProvider: ARCHIVE_PROVIDER, sourceId: { in: sourceKeys } },
      select: { id: true, sourceId: true }
    });
    const existingBySourceId = new Map(existingSongs.map((song) => [song.sourceId, song.id]));
    return results.map((result) => ({
      ...result,
      importedSongId: existingBySourceId.get(result.id) || null
    }));
  }

  async function search(provider, query) {
    const cacheKey = `${provider}:${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const results = structuredClone(cached.results);
      return provider === ARCHIVE_PROVIDER ? refreshArchiveImportedState(results) : results;
    }

    let results;
    if (provider === ARCHIVE_PROVIDER) results = await searchArchive(query);
    else if (provider === YOUTUBE_PROVIDER) results = await searchYouTube(query);
    else throw httpError(400, "Unsupported music provider");

    searchCache.set(cacheKey, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    if (searchCache.size > 200) {
      for (const [key, value] of searchCache) {
        if (value.expiresAt <= Date.now()) searchCache.delete(key);
      }
    }
    const clonedResults = structuredClone(results);
    return provider === ARCHIVE_PROVIDER ? refreshArchiveImportedState(clonedResults) : clonedResults;
  }

  async function importArchiveItem(sourceId, sourceFileName) {
    if (!/^[a-z0-9._-]{1,160}$/i.test(sourceId)) {
      throw httpError(400, "Invalid Internet Archive item");
    }
    if (typeof sourceFileName !== "string" || !sourceFileName || sourceFileName.length > 500) {
      throw httpError(400, "Invalid Internet Archive audio file");
    }
    const sourceKey = `${sourceId}/${sourceFileName}`;

    const existing = await prisma.song.findUnique({
      where: { sourceProvider_sourceId: { sourceProvider: ARCHIVE_PROVIDER, sourceId: sourceKey } }
    });
    if (existing) return { song: existing, alreadyImported: true };

    const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(sourceId)}`;
    const item = await fetchJson(fetchImpl, metadataUrl, 30000);
    const licenseUrl = normalizeLicenseUrl(item?.metadata?.licenseurl);
    if (!licenseUrl) {
      throw httpError(403, "This item is not marked CC0 or Public Domain and cannot be imported");
    }

    const sourceFile = listArchiveMp3s(Array.isArray(item?.files) ? item.files : [], maxImportBytes)
      .find((file) => file.name === sourceFileName);
    if (!sourceFile) {
      throw httpError(422, "No importable MP3 was found within the configured size limit");
    }
    const currentUsageBytes = await getExternalLibraryUsageBytes();
    if (currentUsageBytes + Number(sourceFile.size) > maxLibraryBytes) {
      throw httpError(507, "External music library storage quota has been reached");
    }
    const remainingLibraryBytes = maxLibraryBytes - currentUsageBytes;

    const safeBaseName = basename(sourceFile.name, ".mp3").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "archive-track";
    const storedFilename = `${randomUUID()}-${safeBaseName}.mp3`;
    const storedPath = join(uploadDir, storedFilename);
    const downloadUrl = buildArchiveDownloadUrl(sourceId, sourceFile.name);
    if (!downloadUrl) throw httpError(400, "Invalid Internet Archive audio path");
    let extractedArtwork = null;

    try {
      await downloadAudio(fetchImpl, downloadUrl, storedPath, Math.min(maxImportBytes, remainingLibraryBytes));

      const audioMetadata = await probeAudioMetadata(storedPath);
      if (
        !audioMetadata?.hasAudioStream
        || audioMetadata.audioCodec !== "mp3"
        || !String(audioMetadata.formatName || "").split(",").includes("mp3")
      ) {
        throw httpError(422, "Downloaded file is not a valid MP3");
      }
      extractedArtwork = audioMetadata?.hasEmbeddedArtwork
        ? await extractEmbeddedArtwork(storedPath, randomUUID())
        : null;
      const importedSizes = await Promise.all([
        stat(storedPath).then((details) => details.size),
        extractedArtwork?.artworkPath
          ? stat(extractedArtwork.artworkPath).then((details) => details.size)
          : Promise.resolve(0)
      ]);
      if (currentUsageBytes + importedSizes[0] + importedSizes[1] > maxLibraryBytes) {
        throw httpError(507, "External music library storage quota has been reached");
      }
      const itemMetadata = item.metadata || {};
      const releasedYear = Number.parseInt(asString(itemMetadata.date || itemMetadata.year).slice(0, 4), 10);
      const song = await prisma.song.create({
        data: {
          title: asString(sourceFile.title) || audioMetadata?.title || asString(itemMetadata.title) || sourceId,
          artist: asString(sourceFile.artist || sourceFile.creator) || audioMetadata?.artist || asString(itemMetadata.creator) || null,
          album: asString(sourceFile.album) || audioMetadata?.album || null,
          genre: asString(sourceFile.genre) || audioMetadata?.genre || null,
          year: Number.isInteger(releasedYear) ? releasedYear : audioMetadata?.year || null,
          filename: storedFilename,
          path: storedPath,
          mimeType: "audio/mpeg",
          artworkFilename: extractedArtwork?.artworkFilename || null,
          artworkMimeType: extractedArtwork?.artworkMimeType || null,
          artworkPath: extractedArtwork?.artworkPath || null,
          duration: audioMetadata?.duration || Math.round(Number(sourceFile.length)) || null,
          uploadedBy: "Internet Archive import",
          sourceProvider: ARCHIVE_PROVIDER,
          sourceId: sourceKey,
          sourceUrl: downloadUrl,
          licenseUrl
        }
      });
      return { song, alreadyImported: false };
    } catch (error) {
      await Promise.all([
        rm(storedPath, { force: true }).catch(() => {}),
        extractedArtwork?.artworkPath ? rm(extractedArtwork.artworkPath, { force: true }).catch(() => {}) : Promise.resolve()
      ]);
      if (error?.code === "P2002") {
        const duplicate = await prisma.song.findUnique({
          where: { sourceProvider_sourceId: { sourceProvider: ARCHIVE_PROVIDER, sourceId: sourceKey } }
        });
        if (duplicate) return { song: duplicate, alreadyImported: true };
      }
      throw error;
    }
  }

  async function importTrack(provider, sourceId, sourceFile) {
    if (provider !== ARCHIVE_PROVIDER) {
      throw httpError(400, "This provider does not permit importing audio");
    }
    return importArchiveItem(sourceId, sourceFile);
  }

  return { search, importTrack };
}
