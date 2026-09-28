<script setup lang="ts">
import { computed, ref } from "vue";
import { clock } from "../format";

export interface Take {
  blob: Blob;
  url: string;
  fileName: string;
  seconds: number;
}

const props = defineProps<{ take: Take }>();
const emit = defineEmits<{ close: [] }>();

const kept = ref(false);
const shareError = ref("");
const file = computed(() => new File([props.take.blob], props.take.fileName, { type: "audio/wav" }));
const canShare = computed(() => typeof navigator.canShare === "function" && navigator.canShare({ files: [file.value] }));

async function share(): Promise<void> {
  shareError.value = "";
  try {
    await navigator.share({ files: [file.value], title: "Track303" });
    kept.value = true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    shareError.value = "Teilen hat nicht geklappt. Speichern geht immer.";
  }
}
</script>

<template>
  <div class="help" role="dialog" aria-modal="true" aria-labelledby="take-title" data-take>
    <div class="sheet take">
      <h2 id="take-title">Aufnahme · <span data-take-length>{{ clock(take.seconds) }}</span></h2>
      <audio controls :src="take.url" preload="metadata"></audio>
      <p class="file">{{ take.fileName }}</p>
      <div class="take-actions">
        <a class="primary" :href="take.url" :download="take.fileName" data-take-save @click="kept = true">Speichern</a>
        <button v-if="canShare" type="button" data-take-share @click="share">Teilen</button>
      </div>
      <p v-if="shareError" class="note" role="status">{{ shareError }}</p>
      <button type="button" class="take-close" data-take-close @click="emit('close')">{{ kept ? "Fertig" : "Verwerfen" }}</button>
    </div>
  </div>
</template>
