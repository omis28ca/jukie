import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const IS_WIN = process.platform === "win32";
const DEFAULT_AUDIO_OUTPUT_DEVICE_ID = "auto";

function normalizeAudioOutputDeviceId(value) {
  if (typeof value !== "string") {
    return DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  }

  const normalized = value.trim();
  return normalized || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
}

function resolvePlayerExec() {
  if (process.env.PLAYER_EXEC) {
    return process.env.PLAYER_EXEC;
  }

  if (IS_WIN) {
    const bundledWinMpv = join(process.cwd(), "../../mpv-x86_64-v3/mpv.exe");
    if (existsSync(bundledWinMpv)) {
      return bundledWinMpv;
    }
  }

  return "mpv";
}

const MPV_EXEC = resolvePlayerExec();

/**
 * Returns the IPC arg to pass to mpv and the path Node uses to connect.
 *
 * Windows: mpv creates \\.\pipe\<name> when given a bare name.
 * Linux/macOS: mpv creates a Unix domain socket at the given path.
 */
function makeSocketSpec(pid, ts) {
  if (IS_WIN) {
    const name = `mpv-jukebox-${pid}-${ts}`;
    return { ipcArg: name, connectPath: `\\\\.\\pipe\\${name}`, isNamedPipe: true };
  }
  const sockPath = join(process.env.TMPDIR || "/tmp", `mpv-jukebox-${pid}-${ts}.sock`);
  return { ipcArg: sockPath, connectPath: sockPath, isNamedPipe: false };
}

export function createPlayerService({ prisma, io, emitQueueUpdated = async () => {} }) {
  console.info(`[jukebox-player] mpv executable: ${MPV_EXEC}`);

  let mpvProcess = null;
  let mpvSocket = null;
  let socketSpec = null;
  let currentQueueItem = null;
  let state = "idle";
  let volume = 80;
  let isStopping = false;
  let isQueueStopped = false;
  let isLoopQueueEnabled = false;
  let playbackStartedAtMs = null;
  let elapsedBeforePauseSec = 0;
  let nextRequestId = 1;
  const pendingRequests = new Map();
  let preferredAudioOutputDeviceId = DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  let audioOutputApplyStatus = {
    applied: null,
    message: "Using system default output device.",
    lastAttemptAt: null
  };
  // Overrides the "played" status written on natural track exit
  let exitStatusOverride = null;

  // ─── State helpers ───────────────────────────────────────────────

  function emitState() {
    io.emit("player:state", getState());
  }

  function getPositionSeconds() {
    if (!currentQueueItem) {
      return 0;
    }

    const duration = Number(currentQueueItem.song?.duration);
    const hasDuration = Number.isFinite(duration) && duration > 0;
    let position = elapsedBeforePauseSec;

    if (state === "playing" && Number.isFinite(playbackStartedAtMs)) {
      position += (Date.now() - playbackStartedAtMs) / 1000;
    }

    if (!Number.isFinite(position) || position < 0) {
      position = 0;
    }

    if (hasDuration) {
      position = Math.min(position, duration);
    }

    return Math.round(position * 10) / 10;
  }

  function getState() {
    return {
      state,
      volume,
      nowPlaying: currentQueueItem?.song ?? null,
      positionSeconds: getPositionSeconds(),
      loopQueue: isLoopQueueEnabled,
      audioOutput: {
        deviceId: preferredAudioOutputDeviceId,
        applied: audioOutputApplyStatus.applied,
        message: audioOutputApplyStatus.message,
        lastAttemptAt: audioOutputApplyStatus.lastAttemptAt
      }
    };
  }

  // ─── mpv IPC ─────────────────────────────────────────────────────

  /**
   * Send a JSON command to the mpv IPC socket.
   * Resolves with the response data, or rejects on timeout/disconnection.
   */
  function sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!mpvSocket || mpvSocket.destroyed) {
        return reject(new Error("mpv IPC socket not available"));
      }
      const id = nextRequestId++;
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`IPC timeout: ${JSON.stringify(command)}`));
      }, 2000);
      pendingRequests.set(id, { resolve, reject, timeout });
      mpvSocket.write(JSON.stringify({ command, request_id: id }) + "\n");
    });
  }

  function handleIpcLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.request_id !== undefined && pendingRequests.has(msg.request_id)) {
      const { resolve, timeout } = pendingRequests.get(msg.request_id);
      clearTimeout(timeout);
      pendingRequests.delete(msg.request_id);
      resolve(msg.data ?? null);
    }
  }

  /**
   * Connect to mpv's Unix IPC socket, retrying until mpv creates it.
   * Returns the net.Socket on success or null after all retries.
   */
  async function connectIpc(path, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const sock = await new Promise((resolve, reject) => {
          const s = createConnection(path);
          s.once("connect", () => resolve(s));
          s.once("error", reject);
        });
        sock.setEncoding("utf8");
        let buf = "";
        sock.on("data", (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line) handleIpcLine(line);
          }
        });
        sock.once("error", () => { if (mpvSocket === sock) mpvSocket = null; });
        sock.once("close", () => { if (mpvSocket === sock) mpvSocket = null; });
        return sock;
      } catch {
        await sleep(150);
      }
    }
    return null;
  }

  async function waitForIpcReady(timeoutMs = 1000) {
    const startedAt = Date.now();
    while (!mpvSocket && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    return Boolean(mpvSocket);
  }

  async function setPreferredAudioOutputDevice(deviceId) {
    preferredAudioOutputDeviceId = normalizeAudioOutputDeviceId(deviceId);

    if (!mpvProcess) {
      audioOutputApplyStatus = {
        applied: null,
        message: "Saved. Will apply on next playback start.",
        lastAttemptAt: new Date().toISOString()
      };
      emitState();
      return { ...audioOutputApplyStatus, deviceId: preferredAudioOutputDeviceId };
    }

    if (!mpvSocket) {
      await waitForIpcReady(1200);
    }

    if (!mpvSocket) {
      audioOutputApplyStatus = {
        applied: false,
        message: "Saved, but could not apply immediately. If audio output does not change, set your OS default output device.",
        lastAttemptAt: new Date().toISOString()
      };
      emitState();
      return { ...audioOutputApplyStatus, deviceId: preferredAudioOutputDeviceId };
    }

    try {
      await sendCommand(["set_property", "audio-device", preferredAudioOutputDeviceId]);
      audioOutputApplyStatus = {
        applied: true,
        message: "Saved and applied to active playback.",
        lastAttemptAt: new Date().toISOString()
      };
    } catch {
      audioOutputApplyStatus = {
        applied: false,
        message: "Saved, but runtime apply is not supported in this environment. Set your OS default output device.",
        lastAttemptAt: new Date().toISOString()
      };
    }

    emitState();
    return { ...audioOutputApplyStatus, deviceId: preferredAudioOutputDeviceId };
  }

  function getAudioOutputPreference() {
    return {
      deviceId: preferredAudioOutputDeviceId,
      applied: audioOutputApplyStatus.applied,
      message: audioOutputApplyStatus.message,
      lastAttemptAt: audioOutputApplyStatus.lastAttemptAt
    };
  }

  // ─── Playback control ────────────────────────────────────────────

  async function ensurePlaying() {
    if (isStopping || isQueueStopped || mpvProcess || state === "playing" || state === "paused") return;
    await playNext();
  }

  async function playNext() {
    if (isStopping || isQueueStopped) return;

    const nextItem = await prisma.queueItem.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      include: { song: true }
    });

    if (!nextItem) {
      currentQueueItem = null;
      mpvProcess = null;
      mpvSocket = null;
      socketSpec = null;
      state = "idle";
      playbackStartedAtMs = null;
      elapsedBeforePauseSec = 0;
      emitState();
      io.emit("player:now-playing", null);
      return;
    }

    currentQueueItem = nextItem;
    exitStatusOverride = null;
    elapsedBeforePauseSec = 0;
    playbackStartedAtMs = Date.now();

    await prisma.queueItem.update({
      where: { id: nextItem.id },
      data: { status: "playing" }
    });

    await emitQueueUpdated();

    state = "playing";
    io.emit("player:now-playing", nextItem.song);
    emitState();

    // Unique socket/pipe per track to avoid stale connection conflicts
    socketSpec = makeSocketSpec(process.pid, Date.now());
    if (!socketSpec.isNamedPipe) {
      try { await rm(socketSpec.connectPath, { force: true }); } catch {}
    }

    mpvProcess = spawn(MPV_EXEC, [
      "--no-video",
      "--really-quiet",
      `--volume=${volume}`,
      `--audio-device=${preferredAudioOutputDeviceId}`,
      `--input-ipc-server=${socketSpec.ipcArg}`,
      nextItem.song.path
    ]);

    mpvProcess.once("error", (err) => {
      if (!exitStatusOverride) exitStatusOverride = "error";
      io.emit("player:error", { message: `mpv failed to start: ${err.message}` });
    });

    // Connect IPC asynchronously — mpv needs a moment to create the socket/pipe
    connectIpc(socketSpec.connectPath).then((sock) => {
      if (!sock || !mpvProcess) return;
      mpvSocket = sock;
      // Sync volume if it changed while IPC was still connecting
      sendCommand(["set_property", "volume", volume]).catch(() => {});
      // Best effort re-assertion in case runtime audio-device switching is supported.
      sendCommand(["set_property", "audio-device", preferredAudioOutputDeviceId]).catch(() => {});
    });

    const capturedItemId = nextItem.id;

    mpvProcess.once("exit", async () => {
      if (mpvSocket) { mpvSocket.destroy(); mpvSocket = null; }
      if (socketSpec && !socketSpec.isNamedPipe) {
        try { await rm(socketSpec.connectPath, { force: true }); } catch {}
      }

      if (currentQueueItem?.id === capturedItemId) {
        const finalStatus = exitStatusOverride || "played";
        const shouldLoopCurrentItem = finalStatus === "played" && isLoopQueueEnabled;
        try {
          await prisma.queueItem.update({
            where: { id: capturedItemId },
            data: shouldLoopCurrentItem
              ? {
                  status: "queued",
                  createdAt: new Date()
                }
              : { status: finalStatus }
          });
        } catch (error) {
          // The queue item may already be removed (for example when deleting a song mid-playback).
          if (error?.code !== "P2025") {
            throw error;
          }
        }
        currentQueueItem = null;
      }

      mpvProcess = null;
      playbackStartedAtMs = null;
      elapsedBeforePauseSec = 0;
      await emitQueueUpdated();
      if (isStopping) return;
      if (isQueueStopped) {
        state = "idle";
        emitState();
        io.emit("player:now-playing", null);
        return;
      }
      await playNext();
    });
  }

  // ─── Admin controls ──────────────────────────────────────────────

  async function skip() {
    if (!mpvProcess) return;
    exitStatusOverride = "skipped";
    if (mpvSocket) {
      try { await sendCommand(["quit"]); return; } catch {}
    }
    mpvProcess.kill("SIGTERM");
  }

  async function pause() {
    if (!mpvProcess) return;
    if (!mpvSocket) {
      await waitForIpcReady(1200);
    }

    if (mpvSocket) {
      try {
        await sendCommand(["set_property", "pause", true]);
      } catch {
        if (!IS_WIN) {
          mpvProcess.kill("SIGSTOP"); // Unix fallback
        } else {
          return;
        }
      }
    } else if (!IS_WIN) {
      mpvProcess.kill("SIGSTOP");
    } else {
      return;
    }

    elapsedBeforePauseSec = getPositionSeconds();
    playbackStartedAtMs = null;
    state = "paused";
    emitState();
  }

  async function resume() {
    if (!mpvProcess) return;
    if (!mpvSocket) {
      await waitForIpcReady(1200);
    }

    if (mpvSocket) {
      try {
        await sendCommand(["set_property", "pause", false]);
      } catch {
        if (!IS_WIN) {
          mpvProcess.kill("SIGCONT"); // Unix fallback
        } else {
          return;
        }
      }
    } else if (!IS_WIN) {
      mpvProcess.kill("SIGCONT");
    } else {
      return;
    }

    playbackStartedAtMs = Date.now();
    state = "playing";
    emitState();
  }

  async function setVolume(nextVolume) {
    if (!Number.isFinite(nextVolume)) return;
    volume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    if (mpvSocket) {
      try { await sendCommand(["set_property", "volume", volume]); } catch {}
    }
    emitState();
  }

  async function seek(positionSeconds) {
    if (!mpvProcess || !currentQueueItem) return;

    const normalizedPosition = Number(positionSeconds);
    if (!Number.isFinite(normalizedPosition)) return;

    const duration = Number(currentQueueItem.song?.duration);
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const targetPosition = hasDuration
      ? Math.min(Math.max(0, normalizedPosition), duration)
      : Math.max(0, normalizedPosition);

    if (!mpvSocket) {
      await waitForIpcReady(1200);
    }

    if (!mpvSocket) return;

    try {
      await sendCommand(["set_property", "time-pos", targetPosition]);
    } catch {
      return;
    }

    elapsedBeforePauseSec = targetPosition;
    playbackStartedAtMs = state === "playing" ? Date.now() : null;
    emitState();
  }

  async function stop() {
    if (isStopping) return;
    isQueueStopped = true;

    if (!mpvProcess) {
      currentQueueItem = null;
      state = "idle";
      playbackStartedAtMs = null;
      elapsedBeforePauseSec = 0;
      emitState();
      io.emit("player:now-playing", null);
      return;
    }

    exitStatusOverride = "stopped";
    if (mpvSocket) {
      try { await sendCommand(["quit"]); return; } catch {}
    }
    mpvProcess.kill("SIGTERM");
  }

  async function start() {
    if (isStopping) return;
    isQueueStopped = false;
    await ensurePlaying();
  }

  async function setLoopQueue(enabled) {
    isLoopQueueEnabled = Boolean(enabled);
    emitState();
  }

  async function shutdown() {
    isStopping = true;
    isQueueStopped = true;
    if (!mpvProcess) return;
    exitStatusOverride = "stopped";
    if (mpvSocket) {
      try { await sendCommand(["quit"]); return; } catch {}
    }
    mpvProcess.kill("SIGTERM");
  }

  return {
    ensurePlaying,
    skip,
    pause,
    resume,
    setVolume,
    seek,
    stop,
    start,
    setLoopQueue,
    setPreferredAudioOutputDevice,
    shutdown,
    getState,
    getAudioOutputPreference
  };
}
