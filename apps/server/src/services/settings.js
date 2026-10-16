import { prisma } from "../db.js";
import { SETTING_KEYS } from "../config.js";

const DEFAULT_AUDIO_OUTPUT_DEVICE_ID = "auto";

export function normalizeAudioOutputDeviceId(value) {
  if (typeof value !== "string") return DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  return value.trim() || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
}

export async function getSetting(key) {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  return setting?.value ?? null;
}

export async function setSetting(key, value) {
  if (value === null) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return null;
  }

  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
  return value;
}

export async function getAudioOutputSetting() {
  return normalizeAudioOutputDeviceId(await getSetting(SETTING_KEYS.audioOutputDeviceId));
}

export async function setAudioOutputSetting(deviceId) {
  const normalized = normalizeAudioOutputDeviceId(deviceId);
  await setSetting(SETTING_KEYS.audioOutputDeviceId, normalized);
  return normalized;
}

export async function getVolumeSetting() {
  const raw = await getSetting(SETTING_KEYS.volume);
  const volume = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : null;
}

export async function setVolumeSetting(volume) {
  return setSetting(SETTING_KEYS.volume, String(volume));
}

export async function getActiveMoodId() {
  return getSetting(SETTING_KEYS.activeMoodId);
}

export async function setActiveMoodId(moodId) {
  return setSetting(SETTING_KEYS.activeMoodId, moodId || null);
}
