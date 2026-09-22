<script setup>
import { computed, ref } from 'vue';
import ArtThumb from './ArtThumb.vue';
import { useQueueStore } from '../stores/queue';
import { useSessionStore } from '../stores/session';
import { formatTime } from '../lib/format';

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, default: 0 }
});

const queue = useQueueStore();
const session = useSessionStore();
const busy = ref('');

const song = computed(() => props.item.song || {});
const canRemove = computed(() => props.item.isMine || session.isAdmin);

async function run(key, fn) {
  busy.value = key;
  try {
    await fn();
  } catch {
    /* toast already raised */
  } finally {
    busy.value = '';
  }
}

const upvote = () => run('up', () => queue.upvote(props.item.id));
const downvote = () => run('down', () => queue.downvote(props.item.id));
const playNext = () => run('next', () => queue.playNext(props.item.id));
const removePlayNext = () => run('unnext', () => queue.removePlayNext(props.item.id));

function remove() {
  if (!window.confirm(`Remove “${song.value.title}” from the queue?`)) return;
  run('del', () => queue.remove(props.item.id));
}
</script>

<template>
  <li class="qitem" :class="{ playing: item.status === 'playing', next: item.playNext }">
    <span class="qindex" aria-hidden="true">
      {{ item.status === 'playing' ? '▶' : index + 1 }}
    </span>

    <ArtThumb class="qart" :song="song" size="48px" />

    <div class="qmeta">
      <span class="qtitle truncate" :title="song.title">{{ song.title || 'Unknown track' }}</span>
      <span class="qsub truncate muted">
        {{ song.artist || 'Unknown artist' }}
        <template v-if="item.requestedBy"> • requested by {{ item.requestedBy }}</template>
      </span>
    </div>

    <div class="qtags">
      <span v-if="item.playNext" class="badge badge-accent">Play next</span>
      <span v-if="item.isMine" class="badge">Yours</span>
      <span v-if="item.downvotes" class="badge" :title="`${item.downvotes} downvote(s)`">
        ▼ {{ item.downvotes }}
      </span>
      <span class="qtime faint">{{ formatTime(song.duration) }}</span>
    </div>

    <div class="qactions">
      <button
        class="btn btn-sm"
        type="button"
        :disabled="busy === 'up'"
        :aria-label="`Upvote ${song.title}: play next and save to the active mood`"
        title="Upvote — plays next and saves to the active mood"
        @click="upvote"
      >
        ▲ Up
      </button>

      <button
        class="btn btn-sm"
        type="button"
        :disabled="busy === 'down' || item.hasDownvoted"
        :aria-label="`Downvote ${song.title} to remove it from the queue`"
        :title="item.hasDownvoted ? 'You already downvoted this' : 'Downvote — removes from the queue'"
        @click="downvote"
      >
        ▼ Down
      </button>

      <button
        v-if="!item.playNext"
        class="btn btn-sm"
        type="button"
        :disabled="busy === 'next'"
        :aria-label="`Move ${song.title} to the play-next slot`"
        @click="playNext"
      >
        Play next
      </button>
      <button
        v-else
        class="btn btn-sm"
        type="button"
        :disabled="busy === 'unnext'"
        :aria-label="`Remove ${song.title} from the play-next slot`"
        @click="removePlayNext"
      >
        Unpin
      </button>

      <button
        v-if="canRemove"
        class="btn btn-sm btn-danger"
        type="button"
        :disabled="busy === 'del'"
        :aria-label="`Remove ${song.title} from the queue`"
        @click="remove"
      >
        Remove
      </button>
    </div>
  </li>
</template>

<style scoped>
.qitem {
  display: grid;
  grid-template-columns: 26px 48px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

.qitem + .qitem {
  margin-top: 0.3rem;
}

.qitem:hover {
  background: var(--surface-2);
}

.qitem.playing {
  background: var(--surface-2);
  border-color: var(--accent);
}

.qitem.next {
  border-color: rgba(79, 209, 197, 0.35);
}

.qindex {
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.qart {
  width: 48px;
  height: 48px;
  flex: none;
}

.qmeta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qtitle {
  font-size: 0.9rem;
  font-weight: 600;
}

.qsub {
  font-size: 0.76rem;
}

.qtags {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.qtime {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.qactions {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .qitem {
    grid-template-columns: 22px 48px minmax(0, 1fr);
    grid-template-rows: auto auto;
    row-gap: 0.45rem;
  }

  .qtags {
    grid-column: 3;
    grid-row: 2;
  }

  .qactions {
    grid-column: 1 / -1;
    grid-row: 3;
    justify-content: flex-start;
  }
}
</style>
