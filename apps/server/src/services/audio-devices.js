import { spawn } from "node:child_process";
import { config } from "../config.js";

const CACHE_TTL_MS = 60 * 1000;
let cache = { expiresAt: 0, devices: [] };

function parseDeviceList(output) {
  const devices = [{ id: "auto", name: "System default" }];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    // mpv prints entries as: "'coreaudio/123' (Speakers)"
    const match = /^'?([\w.:/#-]+(?:\/[^']*)?)'?\s*(?:\((.*)\))?$/.exec(line);
    if (!match) continue;

    const id = match[1];
    if (!id || id === "auto" || !id.includes("/")) continue;
    devices.push({ id, name: match[2]?.trim() || id });
  }

  return devices;
}

/**
 * Asks mpv for the audio output devices it can target. Results are cached briefly because the
 * probe spawns a process.
 */
export async function listAudioOutputDevices() {
  if (cache.expiresAt > Date.now()) return cache.devices;

  const devices = await new Promise((resolve) => {
    let output = "";
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    let probe;
    try {
      probe = spawn(config.playerExec, ["--audio-device=help", "--no-config"]);
    } catch {
      return resolve([{ id: "auto", name: "System default" }]);
    }

    const timeout = setTimeout(() => {
      probe.kill();
      finish(parseDeviceList(output));
    }, 5000);

    probe.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    probe.once("error", () => finish([{ id: "auto", name: "System default" }]));
    probe.once("close", () => finish(parseDeviceList(output)));
  });

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, devices };
  return devices;
}
