<script setup lang="ts">
import { computed, ref } from "vue";
import { storagePersisted } from "../pwa";
import type { Track303Store } from "../store";

const props = defineProps<{ store: Track303Store }>();
const emit = defineEmits<{ close: []; notice: [text: string] }>();

const CONFIRM_MS = 3_000;

const entries = computed(() => [...props.store.library.value].sort((a, b) => b.updatedAt - a.updatedAt));
const active = computed(() => props.store.activeEntry);
const confirmDelete = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const formatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function when(time: number): string {
  return time ? formatter.format(new Date(time)) : "";
}

function open(id: string): void {
  props.store.openProject(id);
  emit("close");
}

function remove(id: string): void {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmDelete.value = null; }, CONFIRM_MS);
    return;
  }
  confirmDelete.value = null;
  props.store.deleteProject(id);
}

function save(): void {
  const { fileName, json } = props.store.exportProject();
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  emit("notice", `${fileName} liegt in deinen Downloads.`);
}

async function load(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    props.store.importProject(await file.text(), file.name);
    emit("notice", `„${props.store.activeEntry.name}“ ist geöffnet.`);
    emit("close");
  } catch (error) {
    emit("notice", error instanceof Error ? error.message : "Die Datei ließ sich nicht öffnen.");
  }
}
</script>

<template>
  <div class="help" role="dialog" aria-modal="true" aria-labelledby="projects-title" data-projects>
    <div class="sheet projects">
      <div class="projects-head">
        <h2 id="projects-title">Projekte</h2>
        <button type="button" class="take-close inline" data-projects-close @click="emit('close')">Schließen</button>
      </div>

      <label class="project-name">
        <span>Name</span>
        <input type="text" maxlength="40" :value="active.name" data-project-name @change="store.renameProject(($event.target as HTMLInputElement).value)" />
      </label>

      <ul class="project-list">
        <li v-for="entry in entries" :key="entry.id" :class="{ active: entry.id === active.id }">
          <button type="button" class="project-open" :data-project="entry.name" :aria-current="entry.id === active.id" @click="open(entry.id)">
            <strong>{{ entry.name }}</strong><small>{{ entry.id === active.id ? "geöffnet · " : "" }}{{ when(entry.updatedAt) }}</small>
          </button>
          <button
            v-if="entries.length > 1"
            type="button"
            class="project-delete"
            :class="{ confirm: confirmDelete === entry.id }"
            :aria-label="`${entry.name} löschen`"
            :data-project-delete="entry.name"
            @click="remove(entry.id)"
          >
            {{ confirmDelete === entry.id ? "Wirklich?" : "⌫" }}
          </button>
        </li>
      </ul>

      <div class="project-actions">
        <button type="button" data-project-new="starter" @click="store.createNewProject('starter'); emit('close')">＋ Neu mit Start-Groove</button>
        <button type="button" data-project-new="empty" @click="store.createNewProject('empty'); emit('close')">＋ Neu und leer</button>
        <button type="button" data-project-duplicate @click="store.duplicateProject(); emit('close')">Duplizieren</button>
        <button type="button" data-project-save @click="save">Als Datei speichern</button>
        <button type="button" data-project-load @click="fileInput?.click()">Datei öffnen …</button>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden data-project-file @change="load" />
      </div>

      <p class="note">
        Projekte liegen nur auf diesem Handy.
        {{ storagePersisted === true ? "Chrome behält sie dauerhaft." : "Sichere wichtige Tracks als Datei; Chrome räumt Speicher sonst womöglich auf, wenn er knapp wird." }}
      </p>
    </div>
  </div>
</template>
