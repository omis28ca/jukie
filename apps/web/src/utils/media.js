import { resolveApiUrl } from "../services/api";

export function formatDuration(totalSeconds) {
  const value = Number(totalSeconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";

  const seconds = Math.floor(value % 60);
  const minutes = Math.floor(value / 60) % 60;
  const hours = Math.floor(value / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getSongArtworkUrl(song) {
  if (!song) return "";
  if (song.artworkUrl) return resolveApiUrl(song.artworkUrl);
  if (song.artworkFilename && song.id) {
    return resolveApiUrl(`/api/songs/${encodeURIComponent(song.id)}/artwork`);
  }
  return "";
}

export function getSongInitials(song) {
  const title = String(song?.title || "").trim();
  const artist = String(song?.artist || "").trim();
  return `${title[0] || "J"}${artist[0] || "B"}`.toUpperCase();
}

export function getSongCoverStyle(song) {
  const seed = `${song?.id || "none"}:${song?.title || "untitled"}:${song?.artist || "unknown"}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return {
    background: `linear-gradient(145deg, hsl(${hue} 68% 49%), hsl(${(hue + 48) % 360} 65% 23%))`
  };
}
