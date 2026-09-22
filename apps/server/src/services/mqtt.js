import mqtt from "mqtt";
import { config } from "../config.js";
import { runtime } from "../runtime.js";
import { setAudioOutputSetting } from "./settings.js";

/**
 * Optional home-automation bridge. Publishes retained player state to `<prefix>/state` and accepts
 * JSON commands (`{ "action": "pause" }`) on `<prefix>/command`.
 */
export function createMqttBridge(logger = console) {
  const { url, username, password, topicPrefix } = config.mqtt;
  if (!url) {
    return { start: async () => false, stop: async () => {}, publishState: () => {}, enabled: false };
  }

  const stateTopic = `${topicPrefix}/state`;
  const commandTopic = `${topicPrefix}/command`;
  let client = null;

  async function handleCommand(payload) {
    const action = String(payload?.action || "").trim().toLowerCase();
    const value = payload?.value;
    const player = runtime.player;
    if (!player) return;

    switch (action) {
      case "play":
      case "start":
        await player.start();
        break;
      case "resume":
        await player.resume();
        break;
      case "pause":
        await player.pause();
        break;
      case "stop":
        await player.stop();
        break;
      case "skip":
      case "next":
        await player.skip();
        break;
      case "volume":
        await player.setVolume(Number(value));
        break;
      case "seek":
        await player.seek(Number(value));
        break;
      case "loop":
        await player.setLoopQueue(Boolean(value));
        break;
      case "audio-output":
        await player.setPreferredAudioOutputDevice(await setAudioOutputSetting(String(value ?? "auto")));
        break;
      default:
        logger.warn?.({ action }, "Ignored unknown MQTT command");
    }
  }

  function publishState(state) {
    if (!client?.connected) return;
    client.publish(stateTopic, JSON.stringify(state ?? {}), { retain: true, qos: 0 });
  }

  async function start() {
    client = mqtt.connect(url, {
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      reconnectPeriod: 5000,
      clientId: `jukie-server-${Math.random().toString(16).slice(2, 10)}`
    });

    client.on("connect", () => {
      logger.info?.({ url, topicPrefix }, "MQTT bridge connected");
      client.subscribe(commandTopic, (error) => {
        if (error) logger.error?.({ error, commandTopic }, "MQTT subscribe failed");
      });
      publishState(runtime.player?.getState());
    });

    client.on("message", (topic, message) => {
      if (topic !== commandTopic) return;
      let payload = null;
      try {
        payload = JSON.parse(message.toString());
      } catch {
        payload = { action: message.toString() };
      }
      handleCommand(payload).catch((error) => logger.error?.({ error }, "MQTT command failed"));
    });

    client.on("error", (error) => logger.error?.({ error }, "MQTT bridge error"));
    return true;
  }

  async function stop() {
    if (!client) return;
    await new Promise((resolve) => client.end(true, {}, resolve));
    client = null;
  }

  return { start, stop, publishState, enabled: true };
}
