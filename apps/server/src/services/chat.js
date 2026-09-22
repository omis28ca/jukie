import { randomUUID } from "node:crypto";
import { runtime } from "../runtime.js";
import { httpError } from "../lib/http.js";

const MAX_MESSAGES = 100;
const MAX_BODY_LENGTH = 280;
const MIN_INTERVAL_MS = 750;

/**
 * Room chat. Messages live in memory only: this is throwaway party banter, not library data, so a
 * restart clears the board on purpose. Presence is derived from the live Socket.IO connections,
 * keyed the same way queue votes are (display name, falling back to `ip:<address>`), so one person
 * with three tabs open is still one person.
 */
const messages = [];
const presence = new Map();
const lastPostAt = new Map();

function serializeMessage(message) {
  return {
    id: message.id,
    name: message.name,
    body: message.body,
    isAdmin: message.isAdmin,
    createdAt: message.createdAt
  };
}

function serializePresence(entry) {
  return {
    key: entry.key,
    name: entry.name,
    isAdmin: entry.isAdmin,
    connections: entry.sockets.size,
    since: entry.since
  };
}

export function listChatMessages() {
  return messages.map(serializeMessage);
}

export function listChatPresence() {
  return [...presence.values()]
    .map(serializePresence)
    .sort((a, b) => (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff") || a.key.localeCompare(b.key));
}

export function chatSnapshot() {
  return { messages: listChatMessages(), presence: listChatPresence() };
}

function publishPresence() {
  runtime.realtime?.io?.emit("chat:presence", { presence: listChatPresence() });
}

/**
 * Registers a connected socket and returns the matching cleanup function.
 */
export function trackChatPresence(socket, viewer) {
  const key = viewer.key;
  const entry = presence.get(key) ?? { key, name: viewer.name, isAdmin: viewer.isAdmin, sockets: new Set(), since: new Date().toISOString() };
  entry.name = viewer.name ?? entry.name;
  entry.isAdmin = viewer.isAdmin || entry.isAdmin;
  entry.sockets.add(socket.id);
  presence.set(key, entry);
  publishPresence();

  return () => {
    const current = presence.get(key);
    if (!current) return;
    current.sockets.delete(socket.id);
    if (current.sockets.size === 0) presence.delete(key);
    publishPresence();
  };
}

export function postChatMessage({ requester, body }) {
  const text = typeof body === "string" ? body.trim().replace(/\s+/g, " ") : "";
  if (!text) throw httpError(400, "Message cannot be empty");
  if (text.length > MAX_BODY_LENGTH) throw httpError(400, `Message must be ${MAX_BODY_LENGTH} characters or fewer`);
  if (!requester.name) throw httpError(400, "Pick a name before chatting");

  const now = Date.now();
  const previous = lastPostAt.get(requester.key) ?? 0;
  if (now - previous < MIN_INTERVAL_MS) throw httpError(429, "Slow down a little");
  lastPostAt.set(requester.key, now);

  const message = {
    id: randomUUID(),
    name: requester.name,
    body: text,
    isAdmin: requester.isAdmin,
    createdAt: new Date().toISOString()
  };

  messages.push(message);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);

  const payload = serializeMessage(message);
  runtime.realtime?.io?.emit("chat:message", payload);
  return payload;
}

export function clearChatMessages() {
  messages.length = 0;
  lastPostAt.clear();
  runtime.realtime?.io?.emit("chat:cleared", {});
  return { cleared: true };
}
