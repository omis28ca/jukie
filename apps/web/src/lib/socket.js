import { io } from 'socket.io-client';
import { API_BASE } from './api';

let socket = null;

export function getSocket() {
  return socket;
}

function authPayload(sessionStore) {
  return {
    name: sessionStore?.name || '',
    pin: sessionStore?.pin || ''
  };
}

/**
 * Creates the single shared socket and wires server events onto the stores.
 * The handshake carries the identity so the server can personalise `queue:updated`
 * (`isMine`, `canControl`, `hasDownvoted`) exactly like the REST endpoints do.
 */
export function initSocket({ queueStore, playerStore, libraryStore, moodsStore, uiStore, sessionStore, youtubeStore, chatStore }) {
  if (socket) return socket;

  const options = {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: authPayload(sessionStore)
  };

  socket = API_BASE ? io(API_BASE, options) : io(options);

  socket.on('connect', () => {
    uiStore.setConnected(true);
    socket.emit('queue:refresh');
    socket.emit('player:refresh');
  });

  socket.on('disconnect', () => uiStore.setConnected(false));
  socket.on('connect_error', () => uiStore.setConnected(false));

  socket.on('queue:updated', (payload) => queueStore.applySnapshot(payload));
  socket.on('player:state', (state) => playerStore.applyServerState(state));
  socket.on('player:now-playing', (song) => {
    playerStore.applyNowPlaying(song);
    queueStore.refreshHistory();
  });
  socket.on('song:uploaded', (song) => libraryStore.upsertSong(song));
  socket.on('ytdlp:job', (job) => youtubeStore?.applyJob(job));
  socket.on('chat:snapshot', (payload) => chatStore?.applySnapshot(payload, true));
  socket.on('chat:message', (message) => chatStore?.applyMessage(message));
  socket.on('chat:presence', (payload) => chatStore?.applyPresence(payload));
  socket.on('chat:cleared', () => chatStore?.clearLocal());
  socket.on('moods:updated', (payload) => moodsStore.applyMoods(payload?.moods ?? []));
  socket.on('player:error', (payload) => uiStore.error(payload?.message || 'Player error'));

  return socket;
}

export function refreshAll() {
  if (!socket || !socket.connected) return;
  socket.emit('queue:refresh');
  socket.emit('player:refresh');
}

/**
 * Socket.IO only reads `auth` during the handshake, so a name or PIN change needs a reconnect.
 */
export function updateSocketIdentity({ name = '', pin = '' } = {}) {
  if (!socket) return;
  const next = { name: name || '', pin: pin || '' };
  const current = socket.auth || {};
  if (current.name === next.name && current.pin === next.pin) return;

  socket.auth = next;
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function disposeSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
