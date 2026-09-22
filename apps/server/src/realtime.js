import { Server } from "socket.io";
import { config } from "./config.js";
import { runtime } from "./runtime.js";
import { getActiveQueueRaw, snapshotQueue } from "./services/queue.js";
import { listMoods } from "./services/moods.js";
import { chatSnapshot, trackChatPresence } from "./services/chat.js";

function viewerOfSocket(socket) {
  const auth = socket.handshake?.auth || {};
  const name = typeof auth.name === "string" ? auth.name.trim().slice(0, 40) : "";
  const pin = typeof auth.pin === "string" ? auth.pin.trim() : "";
  const address = socket.handshake?.address || "unknown";

  return {
    name: name || null,
    key: name || `ip:${address}`,
    isAdmin: Boolean(pin) && pin === config.adminPin && /^\d{4}$/.test(config.adminPin)
  };
}

export function createRealtime(httpServer) {
  const io = new Server(httpServer, { cors: { origin: true } });
  const broadcastHooks = new Set();

  // Lets other subsystems (the MQTT bridge) observe everything broadcast to clients.
  const originalEmit = io.emit.bind(io);
  io.emit = (event, ...args) => {
    for (const hook of broadcastHooks) {
      try {
        hook(event, ...args);
      } catch (error) {
        runtime.logger.error?.({ error, event }, "Broadcast hook failed");
      }
    }
    return originalEmit(event, ...args);
  };

  async function broadcastQueue() {
    const rawItems = await getActiveQueueRaw();
    for (const socket of io.sockets.sockets.values()) {
      socket.emit("queue:updated", snapshotQueue(rawItems, viewerOfSocket(socket)));
    }
  }

  async function broadcastMoods() {
    io.emit("moods:updated", { moods: await listMoods() });
  }

  function emitError(message) {
    io.emit("player:error", { message });
  }

  io.on("connection", async (socket) => {
    const viewer = viewerOfSocket(socket);
    const releasePresence = trackChatPresence(socket, viewer);
    socket.on("disconnect", releasePresence);

    try {
      socket.emit("player:state", runtime.player?.getState() ?? null);
      socket.emit("queue:updated", snapshotQueue(await getActiveQueueRaw(), viewer));
      socket.emit("moods:updated", { moods: await listMoods() });
      socket.emit("chat:snapshot", chatSnapshot());
    } catch (error) {
      runtime.logger.error?.({ error }, "Failed to send initial realtime state");
    }

    socket.on("queue:refresh", async () => {
      socket.emit("queue:updated", snapshotQueue(await getActiveQueueRaw(), viewerOfSocket(socket)));
    });

    socket.on("player:refresh", () => {
      socket.emit("player:state", runtime.player?.getState() ?? null);
    });

    socket.on("moods:refresh", async () => {
      socket.emit("moods:updated", { moods: await listMoods() });
    });

    socket.on("chat:refresh", () => {
      socket.emit("chat:snapshot", chatSnapshot());
    });
  });

  return {
    io,
    broadcastQueue,
    broadcastMoods,
    emitError,
    onBroadcast(hook) {
      broadcastHooks.add(hook);
      return () => broadcastHooks.delete(hook);
    }
  };
}
