import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config.js";
import { mapSong } from "../lib/serializers.js";
import { orderQueuedItems } from "./queue-order.js";

const IS_WIN = process.platform === "win32";
const DEFAULT_AUDIO_OUTPUT_DEVICE_ID = "auto";

function normalizeAudioOutputDeviceId(value) {
  if (typeof value !== "string") {
    return DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  }

  const normalized = value.trim();
  return normalized || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
}

const MPV_EXEC = config.playerExec;
const playerStateSetting = process.env.PLAYER_STATE_FILE || "../../storage/player-state.json";
const PLAYER_STATE_PATH = isAbsolute(playerStateSetting)
  ? playerStateSetting
  : join(process.cwd(), playerStateSetting);

async function readPersistedPlayerState() {
  try {
    return JSON.parse(await readFile(PLAYER_STATE_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return null;
  }
}

async function persistPlayerState(state) {
  await mkdir(dirname(PLAYER_STATE_PATH), { recursive: true });
  const temporaryPath = `${PLAYER_STATE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state), "utf8");
  await rename(temporaryPath, PLAYER_STATE_PATH);
}

async function clearPersistedPlayerState(expectedConnectPath = null) {
  if (expectedConnectPath) {
    const persisted = await readPersistedPlayerState();
    if (persisted?.connectPath && persisted.connectPath !== expectedConnectPath) return;
  }
  await rm(PLAYER_STATE_PATH, { force: true });
}

async function connectToPersistedIpc(path, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

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

export function createPlayerService({ prisma, io, emitQueueUpdated = async () => {}, deferStartup = false }) {
  console.info(`[jukebox-player] mpv executable: ${MPV_EXEC}`);

  let mpvProcess = null;
  let mpvSocket = null;
  let socketSpec = null;
  let currentQueueItem = null;
  let state = "idle";
  let volume = 80;
  let isStopping = false;
  let isAdvancing = false;
  let advancementPromise = Promise.resolve();
  let isStartupReady = !deferStartup;
  let isQueueStopped = false;
  let isLoopQueueEnabled = false;
  let playbackStartedAtMs = null;
  let elapsedBeforePauseSec = 0;
  let nextRequestId = 1;
  let closeHandlingPromise = Promise.resolve();
  let processClosePromise = Promise.resolve();
  let persistStatePromise = Promise.resolve();
  let orphanCleanupPromise = Promise.resolve();
  const pendingRequests = new Map();
  let preferredAudioOutputDeviceId = DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  let lastPlayedArtist = "";
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
      nowPlaying: mapSong(currentQueueItem?.song ?? null),
      positionSeconds: getPositionSeconds(),
      loopQueue: isLoopQueueEnabled,
      queueStopped: isQueueStopped,
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
    if (isAdvancing) return advancementPromise;
    if (!isStartupReady || isStopping || isQueueStopped || mpvProcess) return;
    isAdvancing = true;
    advancementPromise = (async () => {
      try {
        await playNext();
      } finally {
        isAdvancing = false;
      }
    })();
    return advancementPromise;
  }

  async function cancelPendingPlaybackStart(itemId) {
    await prisma.queueItem.update({
      where: { id: itemId },
      data: { status: "queued" }
    });
    currentQueueItem = null;
    state = "idle";
    playbackStartedAtMs = null;
    elapsedBeforePauseSec = 0;
    await emitQueueUpdated();
  }

  async function playNext() {
    if (isStopping || isQueueStopped) return;

    const queuedItems = await prisma.queueItem.findMany({
      where: { status: "queued" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { song: true }
    });
    const nextItem =
      orderQueuedItems(queuedItems, { previousArtist: currentQueueItem?.song?.artist || lastPlayedArtist })[0] ?? null;

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
    if (isStopping || isQueueStopped) return;

    currentQueueItem = nextItem;
    exitStatusOverride = null;
    elapsedBeforePauseSec = 0;
    playbackStartedAtMs = Date.now();

    await prisma.queueItem.update({
      where: { id: nextItem.id },
      data: { status: "playing", playNext: false }
    });

    await emitQueueUpdated();
    if (isStopping || isQueueStopped) {
      await cancelPendingPlaybackStart(nextItem.id);
      return;
    }

    state = "playing";
    io.emit("player:now-playing", mapSong(nextItem.song));
    emitState();

    // Unique socket/pipe per track to avoid stale connection conflicts
    socketSpec = makeSocketSpec(process.pid, Date.now());
    if (!socketSpec.isNamedPipe) {
      try { await rm(socketSpec.connectPath, { force: true }); } catch {}
    }
    if (isStopping || isQueueStopped) {
      await cancelPendingPlaybackStart(nextItem.id);
      return;
    }

    persistStatePromise = persistPlayerState({
      connectPath: socketSpec.connectPath,
      isNamedPipe: socketSpec.isNamedPipe,
      pid: null,
      createdAt: new Date().toISOString()
    });
    await persistStatePromise;
    if (isStopping || isQueueStopped) {
      await clearPersistedPlayerState(socketSpec.connectPath);
      await cancelPendingPlaybackStart(nextItem.id);
      return;
    }

    mpvProcess = spawn(MPV_EXEC, [
      "--really-quiet",
      `--volume=${volume}`,
      `--audio-device=${preferredAudioOutputDeviceId}`,
      `--input-ipc-server=${socketSpec.ipcArg}`,
      nextItem.song.path
    ]);
    const launchedProcess = mpvProcess;
    processClosePromise = new Promise((resolve) => launchedProcess.once("close", resolve));
    const capturedSocketSpec = socketSpec;
    mpvProcess.once("error", (err) => {
      if (!exitStatusOverride) exitStatusOverride = "error";
      io.emit("player:error", { message: `mpv failed to start: ${err.message}` });
    });
    persistStatePromise = persistPlayerState({
      connectPath: capturedSocketSpec.connectPath,
      isNamedPipe: capturedSocketSpec.isNamedPipe,
      pid: launchedProcess.pid,
      createdAt: new Date().toISOString()
    }).catch((error) => {
      console.warn(`[jukebox-player] failed to persist player state: ${error.message}`);
    });

    // Connect IPC asynchronously — mpv needs a moment to create the socket/pipe
    connectIpc(socketSpec.connectPath).then((sock) => {
      if (!sock) return;
      if (mpvProcess !== launchedProcess) {
        sock.destroy();
        return;
      }
      mpvSocket = sock;
      // Sync volume if it changed while IPC was still connecting
      sendCommand(["set_property", "volume", volume]).catch(() => {});
      // Best effort re-assertion in case runtime audio-device switching is supported.
      sendCommand(["set_property", "audio-device", preferredAudioOutputDeviceId]).catch(() => {});
    });

    const capturedItemId = nextItem.id;

    mpvProcess.once("close", (code) => {
      closeHandlingPromise = (async () => {
        if (mpvSocket) { mpvSocket.destroy(); mpvSocket = null; }
        if (!capturedSocketSpec.isNamedPipe) {
          try { await rm(capturedSocketSpec.connectPath, { force: true }); } catch {}
        }
        await persistStatePromise.catch(() => {});
        await clearPersistedPlayerState(capturedSocketSpec.connectPath).catch((error) => {
          console.warn(`[jukebox-player] failed to clear player state: ${error.message}`);
        });

        if (currentQueueItem?.id === capturedItemId) {
          if (!exitStatusOverride && code !== 0) {
            exitStatusOverride = "error";
            io.emit("player:error", { message: `mpv exited with code ${code ?? "unknown"}` });
          }
          const finalStatus = exitStatusOverride || "played";
          const shouldLoopCurrentItem = finalStatus === "played" && isLoopQueueEnabled;
          try {
            await prisma.queueItem.update({
              where: { id: capturedItemId },
              data: shouldLoopCurrentItem
                ? {
                    status: "queued",
                    playNext: false,
                    createdAt: new Date()
                  }
                : { status: finalStatus }
            });
          } catch (error) {
            if (error?.code !== "P2025") {
              io.emit("player:error", { message: `Failed to update completed queue item: ${error.message}` });
            }
          }
          lastPlayedArtist = currentQueueItem.song?.artist || "";
          currentQueueItem = null;
        }

        if (mpvProcess === launchedProcess) mpvProcess = null;
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
        await ensurePlaying();
      })().catch((error) => {
        io.emit("player:error", { message: `Player cleanup failed: ${error.message}` });
      });
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

  async function terminateActivePlayback(finalStatus) {
    const targetProcess = mpvProcess;
    if (!targetProcess) {
      await processClosePromise;
      await closeHandlingPromise;
      return;
    }

    exitStatusOverride = finalStatus;
    let quitRequested = false;
    if (mpvSocket) {
      try {
        await sendCommand(["quit"]);
        quitRequested = true;
      } catch {}
    }
    if (!quitRequested && targetProcess.exitCode === null) {
      targetProcess.kill("SIGTERM");
    }

    let closed = await Promise.race([
      processClosePromise.then(() => true),
      sleep(3000).then(() => false)
    ]);
    if (!closed && targetProcess.exitCode === null) {
      targetProcess.kill("SIGTERM");
      closed = await Promise.race([
        processClosePromise.then(() => true),
        sleep(2000).then(() => false)
      ]);
    }
    if (!closed && targetProcess.exitCode === null) {
      targetProcess.kill("SIGKILL");
      closed = await Promise.race([
        processClosePromise.then(() => true),
        sleep(2000).then(() => false)
      ]);
    }
    if (!closed) {
      throw new Error("mpv did not exit after forced termination");
    }
    await closeHandlingPromise;
  }

  async function stop() {
    if (isStopping) return;
    isQueueStopped = true;
    await advancementPromise;

    if (!mpvProcess) {
      currentQueueItem = null;
      state = "idle";
      playbackStartedAtMs = null;
      elapsedBeforePauseSec = 0;
      emitState();
      io.emit("player:now-playing", null);
      return;
    }

    await terminateActivePlayback("stopped");
  }

  async function start() {
    if (isStopping) return;
    isQueueStopped = false;
    await ensurePlaying();
  }

  async function activate() {
    isStartupReady = true;
    await ensurePlaying();
  }

  async function setLoopQueue(enabled) {
    isLoopQueueEnabled = Boolean(enabled);
    emitState();
  }

  async function shutdown() {
    isStopping = true;
    isQueueStopped = true;
    await orphanCleanupPromise.catch(() => {});
    await advancementPromise;
    if (!mpvProcess) {
      await processClosePromise;
      await closeHandlingPromise;
      return;
    }
    await terminateActivePlayback("stopped");
  }

  async function performOrphanedPlaybackCleanup() {
    const persisted = await readPersistedPlayerState();
    if (!persisted?.connectPath || typeof persisted.connectPath !== "string") {
      if (persisted) await clearPersistedPlayerState();
      return false;
    }

    const persistedPid = typeof persisted.pid === "number"
      && Number.isInteger(persisted.pid)
      && persisted.pid > 0
      ? persisted.pid
      : null;
    if (persistedPid && !isProcessAlive(persistedPid)) {
      if (!persisted.isNamedPipe) await rm(persisted.connectPath, { force: true }).catch(() => {});
      await clearPersistedPlayerState(persisted.connectPath);
      return false;
    }

    let orphanedSocket = null;
    for (let attempt = 0; attempt < 10 && !orphanedSocket; attempt += 1) {
      orphanedSocket = await connectToPersistedIpc(persisted.connectPath, 300);
      if (!orphanedSocket) await sleep(200);
    }
    if (!orphanedSocket) {
      if (!persistedPid) {
        throw new Error("Unresolved pre-launch mpv state; refusing to risk duplicate playback");
      }
      if (isProcessAlive(persistedPid)) {
        throw new Error(`Cannot contact orphaned mpv process ${persistedPid}; refusing to start duplicate playback`);
      }
      await clearPersistedPlayerState(persisted.connectPath);
      return false;
    }

    const socketClosedPromise = new Promise((resolve) => {
      orphanedSocket.once("close", resolve);
      orphanedSocket.once("error", resolve);
    });
    orphanedSocket.write(`${JSON.stringify({ command: ["quit"] })}\n`);
    await Promise.race([socketClosedPromise, sleep(3000)]);

    let exited = Number.isInteger(persistedPid)
      ? await waitForProcessExit(persistedPid, 3000)
      : orphanedSocket.destroyed;
    if (!exited && isProcessAlive(persistedPid)) {
      process.kill(persistedPid, "SIGTERM");
      exited = await waitForProcessExit(persistedPid, 2000);
    }
    if (!exited && isProcessAlive(persistedPid)) {
      process.kill(persistedPid, "SIGKILL");
      exited = await waitForProcessExit(persistedPid, 2000);
    }
    orphanedSocket.destroy();
    if (!exited) {
      throw new Error(`Orphaned mpv process ${persistedPid || "unknown"} did not exit`);
    }
    if (!persisted.isNamedPipe) {
      await rm(persisted.connectPath, { force: true }).catch(() => {});
    }
    await clearPersistedPlayerState(persisted.connectPath);
    if (orphanedSocket) {
      console.info(`[jukebox-player] stopped orphaned mpv process ${persisted.pid || "unknown"}`);
    }
    return Boolean(orphanedSocket);
  }

  function cleanupOrphanedPlayback() {
    orphanCleanupPromise = performOrphanedPlaybackCleanup();
    return orphanCleanupPromise;
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
    activate,
    setPreferredAudioOutputDevice,
    cleanupOrphanedPlayback,
    shutdown,
    getState,
    getAudioOutputPreference
  };
}
