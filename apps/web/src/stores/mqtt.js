import { defineStore } from 'pinia';
import { usePlayerStore } from './player';
import { useQueueStore } from './queue';
import { useUiStore } from './ui';

const MQTT_URL = import.meta.env.VITE_MQTT_URL || '';
const PREFIX = (import.meta.env.VITE_MQTT_TOPIC_PREFIX || 'jukie').replace(/\/+$/, '');

let client = null;
let unsubscribePlayer = null;
let publishTimer = null;

export const useMqttStore = defineStore('mqtt', {
  state: () => ({
    enabled: Boolean(MQTT_URL),
    url: MQTT_URL,
    prefix: PREFIX,
    connected: false,
    lastError: '',
    lastCommand: null
  }),
  getters: {
    commandTopic: (state) => `${state.prefix}/command`,
    stateTopic: (state) => `${state.prefix}/state`
  },
  actions: {
    /** No-op unless VITE_MQTT_URL is configured — the bridge stays dormant. */
    async connect() {
      if (!this.enabled || client) return;
      const ui = useUiStore();
      let mqtt;
      try {
        mqtt = (await import('mqtt/dist/mqtt.esm')).default;
      } catch (error) {
        this.lastError = 'Failed to load the MQTT client';
        ui.error(this.lastError);
        return;
      }

      try {
        client = mqtt.connect(this.url, {
          clientId: `jukie-web-${Math.random().toString(16).slice(2, 10)}`,
          reconnectPeriod: 5000,
          connectTimeout: 10000
        });
      } catch (error) {
        this.lastError = error?.message || 'MQTT connection failed';
        client = null;
        return;
      }

      client.on('connect', () => {
        this.connected = true;
        this.lastError = '';
        client.subscribe(this.commandTopic, (error) => {
          if (error) this.lastError = error.message;
        });
        this.publishState();
      });

      client.on('reconnect', () => {
        this.connected = false;
      });

      client.on('close', () => {
        this.connected = false;
      });

      client.on('error', (error) => {
        this.lastError = error?.message || 'MQTT error';
        this.connected = false;
      });

      client.on('message', (topic, payload) => {
        if (topic !== this.commandTopic) return;
        let message;
        try {
          message = JSON.parse(payload.toString());
        } catch {
          this.lastError = 'Received a non-JSON MQTT command';
          return;
        }
        this.handleCommand(message);
      });

      const player = usePlayerStore();
      unsubscribePlayer = player.$subscribe(() => this.schedulePublish());
    },

    async handleCommand(message) {
      const player = usePlayerStore();
      const ui = useUiStore();
      const action = String(message?.action || '').toLowerCase();
      const value = message?.value;
      this.lastCommand = { action, value, at: Date.now() };

      try {
        switch (action) {
          case 'play':
          case 'resume':
            await player.play();
            break;
          case 'pause':
            await player.pause();
            break;
          case 'toggle':
          case 'playpause':
            await player.toggle();
            break;
          case 'stop':
            await player.stop();
            break;
          case 'start':
            await player.start();
            break;
          case 'skip':
          case 'next':
            await player.skip();
            break;
          case 'seek':
            await player.seek(Number(value) || 0);
            break;
          case 'volume':
            await player.setVolume(Number(value) || 0);
            break;
          case 'loop':
            await player.setLoop(value === undefined ? !player.loopQueue : Boolean(value));
            break;
          default:
            this.lastError = `Unknown MQTT action “${action}”`;
            return;
        }
        this.publishState();
      } catch (error) {
        ui.error(error?.message || 'MQTT command failed');
      }
    },

    schedulePublish() {
      if (!this.connected) return;
      if (publishTimer) clearTimeout(publishTimer);
      publishTimer = setTimeout(() => this.publishState(), 400);
    },

    publishState() {
      if (!client || !this.connected) return;
      const player = usePlayerStore();
      const queue = useQueueStore();
      const payload = {
        state: player.state,
        volume: player.volume,
        positionSeconds: Math.round(player.positionSeconds),
        loopQueue: player.loopQueue,
        queueStopped: player.queueStopped,
        queueLength: queue.queue.length,
        nowPlaying: player.nowPlaying
          ? {
              id: player.nowPlaying.id,
              title: player.nowPlaying.title,
              artist: player.nowPlaying.artist,
              album: player.nowPlaying.album,
              duration: player.nowPlaying.duration
            }
          : null,
        updatedAt: new Date().toISOString()
      };
      client.publish(this.stateTopic, JSON.stringify(payload), { retain: true });
    },

    disconnect() {
      if (publishTimer) {
        clearTimeout(publishTimer);
        publishTimer = null;
      }
      if (unsubscribePlayer) {
        unsubscribePlayer();
        unsubscribePlayer = null;
      }
      if (client) {
        client.end(true);
        client = null;
      }
      this.connected = false;
    }
  }
});
