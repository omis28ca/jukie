import { io } from "socket.io-client";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
let socket = null;

export function getSocket() {
  if (socket) return socket;

  socket = io(API_BASE, {
	autoConnect: true,
	reconnection: true,
	transports: ["websocket", "polling"]
  });

  return socket;
}

