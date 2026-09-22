import { ref } from 'vue';

const activeSongId = ref('');

/**
 * Shared preview coordination: only one in-browser preview may play at a time.
 * Previews never touch room playback.
 */
export function usePreview() {
  return {
    activeSongId,
    start(songId) {
      activeSongId.value = songId;
    },
    stop(songId) {
      if (!songId || activeSongId.value === songId) activeSongId.value = '';
    },
    stopAll() {
      activeSongId.value = '';
    }
  };
}
