import { execFile } from "node:child_process";
import { readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { httpError } from "../lib/http.js";
import { runtime } from "../runtime.js";

/**
 * Wi-Fi management through NetworkManager's `nmcli`. Pairs with deploy/wifi-setup: that daemon
 * raises the "IrDJ-Setup" hotspot when the box is offline, and writes what it needs the server to
 * know (hotspot credentials, the last scan) into RUN_DIR.
 */
const RUN_DIR = "/run/irdj-wifi";
const HOTSPOT_STATE_FILE = join(RUN_DIR, "hotspot.json");
const SCAN_FILE = join(RUN_DIR, "scan.txt");
const CONNECTING_MARKER = join(RUN_DIR, "connecting");
const CONNECT_WAIT_SECONDS = 40;

let lastAttempt = null;
let connectInFlight = false;

function nmcli(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("nmcli", args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === "ENOENT") {
          reject(httpError(503, "NetworkManager (nmcli) is not installed on this server"));
          return;
        }
        const message = String(stderr || error.message)
          .trim()
          .replace(/^Error:\s*/i, "");
        reject(httpError(/not authorized|insufficient privileges/i.test(message) ? 503 : 502, message || "nmcli failed"));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Splits one line of `nmcli -t` output, honouring its `\:` and `\\` escapes. */
export function splitTerse(line) {
  const fields = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) {
      current += line[index + 1];
      index += 1;
    } else if (char === ":") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function terseRows(output) {
  return output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter(Boolean)
    .map(splitTerse);
}

async function readHotspotState() {
  try {
    return JSON.parse(await readFile(HOTSPOT_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function publishStatus(status) {
  runtime.realtime?.io?.emit("wifi:status", status);
}

async function wifiDevice() {
  const rows = terseRows(await nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]));
  const devices = rows.map(([device, type, state, connection]) => ({ device, type, state, connection }));
  return {
    wifi: devices.find((entry) => entry.type === "wifi") ?? null,
    ethernet: devices.filter((entry) => entry.type === "ethernet" && entry.state === "connected")
  };
}

/** Current Wi-Fi state, whether the setup hotspot is up, and the last connect attempt. */
export async function getWifiStatus() {
  const { wifi, ethernet } = await wifiDevice();
  const hotspot = await readHotspotState();
  const hotspotActive = Boolean(hotspot) && wifi?.connection === config.wifiHotspotConnection;

  let ssid = null;
  let signal = null;
  let address = null;
  if (wifi && wifi.state === "connected" && !hotspotActive) {
    const visible = terseRows(
      await nmcli(["-t", "-f", "IN-USE,SSID,SIGNAL", "device", "wifi", "list", "ifname", wifi.device, "--rescan", "no"])
    );
    const current = visible.find(([inUse]) => inUse === "*");
    ssid = current?.[1] || null;
    signal = current ? Number(current[2]) : null;
    address = (await nmcli(["-g", "IP4.ADDRESS", "device", "show", wifi.device])).split("\n")[0].split("/")[0] || null;
  }

  return {
    available: Boolean(wifi),
    device: wifi?.device ?? null,
    state: wifi?.state ?? "unavailable",
    connection: hotspotActive ? null : wifi?.connection || null,
    ssid,
    signal,
    address,
    ethernetConnected: ethernet.length > 0,
    hotspot: hotspotActive ? { ssid: hotspot.ssid, address: hotspot.address, url: hotspot.url } : null,
    lastAttempt
  };
}

/**
 * Hotspot credentials for the kiosk screen, so the person standing at the box can join it. Only
 * returned while the setup hotspot is actually up.
 */
export async function getHotspotSetupInfo() {
  const hotspot = await readHotspotState();
  if (!hotspot) return null;
  try {
    const { wifi } = await wifiDevice();
    if (wifi?.connection !== config.wifiHotspotConnection) return null;
  } catch {
    return null;
  }
  return hotspot;
}

/** Nearby networks, strongest first. While the hotspot is up the radio cannot scan, so the scan
 * the setup daemon saved just before raising it is used instead. */
export async function scanWifi({ rescan = false } = {}) {
  const { wifi } = await wifiDevice();
  if (!wifi) throw httpError(503, "This box has no Wi-Fi adapter");

  let rows;
  let cached = false;
  if (wifi.connection === config.wifiHotspotConnection) {
    rows = terseRows(await readFile(SCAN_FILE, "utf8").catch(() => ""));
    cached = true;
  } else {
    rows = terseRows(
      await nmcli(
        ["-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", wifi.device, "--rescan", rescan ? "yes" : "auto"],
        { timeoutMs: 30000 }
      )
    );
  }

  const saved = new Set((await listSavedWifi()).map((entry) => entry.ssid));
  const strongest = new Map();
  for (const [ssid, signal, security] of rows) {
    if (!ssid) continue; // hidden networks have no name to show
    const entry = {
      ssid,
      signal: Number(signal) || 0,
      secure: Boolean(security && security !== "--"),
      security: security && security !== "--" ? security : null,
      saved: saved.has(ssid)
    };
    const existing = strongest.get(ssid);
    if (!existing || entry.signal > existing.signal) strongest.set(ssid, entry);
  }

  return { cached, networks: [...strongest.values()].sort((a, b) => b.signal - a.signal) };
}

export async function listSavedWifi() {
  const rows = terseRows(await nmcli(["-t", "-f", "NAME,UUID,TYPE,ACTIVE", "connection", "show"]));
  const saved = [];
  for (const [name, uuid, type, active] of rows) {
    if (type !== "802-11-wireless" || name === config.wifiHotspotConnection) continue;
    const [ssid = name, mode = ""] = (await nmcli(["-g", "802-11-wireless.ssid,802-11-wireless.mode", "connection", "show", uuid]))
      .split("\n")
      .map((line) => line.trim());
    if (mode === "ap") continue;
    saved.push({ name, uuid, ssid: ssid || name, active: active === "yes" });
  }
  return saved;
}

async function markConnecting(active) {
  if (!active) {
    await rm(CONNECTING_MARKER, { force: true }).catch(() => {});
    return;
  }
  // Tells the setup daemon not to re-raise the hotspot while we switch networks.
  await writeFile(CONNECTING_MARKER, String(Date.now())).catch(() => {});
  const now = new Date();
  await utimes(CONNECTING_MARKER, now, now).catch(() => {});
}

async function runConnect({ ssid, password, hidden, device, hotspotWasUp }) {
  connectInFlight = true;
  lastAttempt = { ssid, status: "connecting", error: null, at: new Date().toISOString() };
  publishStatus({ lastAttempt });
  await markConnecting(true);

  try {
    if (hotspotWasUp) {
      await nmcli(["connection", "down", config.wifiHotspotConnection]).catch(() => {});
    }

    const existing = (await listSavedWifi()).find((entry) => entry.ssid === ssid);
    const wait = String(CONNECT_WAIT_SECONDS);
    const timeoutMs = (CONNECT_WAIT_SECONDS + 10) * 1000;
    if (existing && !password) {
      await nmcli(["--wait", wait, "connection", "up", existing.uuid, "ifname", device], { timeoutMs });
    } else if (existing) {
      await nmcli(["connection", "modify", existing.uuid, "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password]);
      await nmcli(["--wait", wait, "connection", "up", existing.uuid, "ifname", device], { timeoutMs });
    } else {
      const args = ["--wait", wait, "device", "wifi", "connect", ssid];
      if (password) args.push("password", password);
      if (hidden) args.push("hidden", "yes");
      args.push("ifname", device);
      await nmcli(args, { timeoutMs });
    }

    lastAttempt = { ssid, status: "connected", error: null, at: new Date().toISOString() };
    runtime.logger?.info?.({ ssid }, "Joined Wi-Fi network");
  } catch (error) {
    lastAttempt = { ssid, status: "failed", error: error.message || "Could not join that network", at: new Date().toISOString() };
    runtime.logger?.warn?.({ ssid, error: lastAttempt.error }, "Wi-Fi connect failed");
    // A failed attempt from the hotspot puts the hotspot back so the phone can try again.
    if (hotspotWasUp) {
      await nmcli(["--wait", "30", "connection", "up", config.wifiHotspotConnection], { timeoutMs: 40000 }).catch(() => {});
    }
  } finally {
    await markConnecting(false);
    connectInFlight = false;
    publishStatus({ lastAttempt });
  }
  return lastAttempt;
}

/**
 * Joins a Wi-Fi network. From the setup hotspot the phone loses its connection the moment the
 * radio switches over, so that case answers immediately and finishes in the background; the
 * result shows on the kiosk screen (and on the phone if the hotspot has to come back).
 */
export async function connectWifi({ ssid, password, hidden = false }) {
  const name = typeof ssid === "string" ? ssid.trim() : "";
  if (!name || name.length > 32) throw httpError(400, "Enter the network name (up to 32 characters)");
  const secret = typeof password === "string" ? password : "";
  if (secret && (secret.length < 8 || secret.length > 63)) {
    throw httpError(400, "Wi-Fi passwords are 8 to 63 characters");
  }
  if (typeof hidden !== "boolean") throw httpError(400, "hidden must be a boolean");
  if (connectInFlight) throw httpError(409, "Already joining a network; wait a moment");

  const { wifi } = await wifiDevice();
  if (!wifi) throw httpError(503, "This box has no Wi-Fi adapter");
  const hotspotWasUp = wifi.connection === config.wifiHotspotConnection;
  const job = { ssid: name, password: secret, hidden, device: wifi.device, hotspotWasUp };

  if (hotspotWasUp) {
    // Give the HTTP response a moment to reach the phone before the hotspot disappears.
    setTimeout(() => runConnect(job), 1500);
    return { pending: true, lastAttempt: { ssid: name, status: "connecting", error: null, at: new Date().toISOString() } };
  }
  return { pending: false, lastAttempt: await runConnect(job) };
}

export async function forgetWifi(uuid) {
  const target = (await listSavedWifi()).find((entry) => entry.uuid === uuid);
  if (!target) throw httpError(404, "That saved network was not found");
  await nmcli(["connection", "delete", target.uuid]);
  return { ok: true };
}
