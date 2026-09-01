<script setup>
import { computed } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const pinLength = computed(() => store.adminPrompt.pin.length);
const ready = computed(() => pinLength.value === 4);

function addDigit(digit) {
  store.appendAdminPinDigit(digit);
  if (store.adminPrompt.pin.length === 4) {
    store.submitAdminPinPrompt();
  }
}
</script>

<template>
  <div v-if="store.adminPrompt.open" class="sheet-backdrop pin-keypad-backdrop" @click.self="store.cancelAdminPinPrompt()">
    <section class="pin-keypad" role="dialog" aria-modal="true" aria-labelledby="pin-keypad-title">
      <h2 id="pin-keypad-title">Admin PIN</h2>
      <p>Enter the 4-digit admin PIN to authorize this action.</p>

      <div class="pin-dots" aria-label="PIN entry">
        <span v-for="index in 4" :key="index" :class="{ active: index <= pinLength }">•</span>
      </div>

      <div class="pin-keypad-grid">
        <button v-for="digit in [1, 2, 3, 4, 5, 6, 7, 8, 9]" :key="digit" type="button" @click="addDigit(digit)">
          {{ digit }}
        </button>
        <button type="button" class="muted" @click="store.removeAdminPinDigit()">⌫</button>
        <button type="button" @click="addDigit(0)">0</button>
        <button type="button" class="muted" @click="store.clearAdminPinEntry()">C</button>
      </div>

      <div class="pin-actions">
        <button class="button button-secondary" type="button" @click="store.cancelAdminPinPrompt()">Cancel</button>
        <button class="button button-primary" type="button" :disabled="!ready" @click="store.submitAdminPinPrompt()">Unlock</button>
      </div>
    </section>
  </div>
</template>
