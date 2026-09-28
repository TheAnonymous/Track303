<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { MAX_SONG_LENGTH, PATTERN_COUNT } from "../domain/types";
import { clock, rowLabel, songSeconds, usedLanes } from "../format";
import { horizontalSwipeGuard } from "../horizontal-swipe";
import type { Track303Store } from "../store";

const props = defineProps<{
  store: Track303Store;
  /** Song entry that plays, or `null`. */
  playEntry: number | null;
}>();
const emit = defineEmits<{ playFrom: [entry: number] }>();

const SWIPE_PX = 36;
const TAP_SLOP_PX = 12;
const FOLLOW_PAUSE_MS = 3_000;

const project = computed(() => props.store.project.value);
const song = computed(() => project.value.song);
const cursor = computed(() => props.store.ui.value.songCursor);
const atEnd = computed(() => cursor.value >= song.value.length);
const selected = computed(() => atEnd.value ? null : song.value[cursor.value]!);
const duration = computed(() => clock(songSeconds(project.value)));
const bars = computed(() => song.value.reduce((sum, index) => sum + (project.value.patterns[index]?.rows ?? 16), 0) / 16);

const list = ref<HTMLElement | null>(null);
const swipeGuard = horizontalSwipeGuard();
let gesture: { id: number; x: number; y: number; index: number } | null = null;
let touchedAt = -Infinity;

function target(event: Event): number | null {
  const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-index]");
  const index = element ? Number(element.dataset.index) : Number.NaN;
  return Number.isInteger(index) ? index : null;
}

function down(event: PointerEvent): void {
  touchedAt = performance.now();
  const index = event.isPrimary ? target(event) : null;
  gesture = index === null ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, index };
}

function up(event: PointerEvent): void {
  touchedAt = performance.now();
  const start = gesture;
  gesture = null;
  if (!start || event.pointerId !== start.id) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (dx < -SWIPE_PX && Math.abs(dy) < Math.abs(dx) / 2) {
    if (start.index < song.value.length && song.value.length > 1) {
      navigator.vibrate?.(12);
      props.store.selectSong(start.index);
      props.store.songDelete(start.index);
    }
    return;
  }
  if (Math.hypot(dx, dy) <= TAP_SLOP_PX) props.store.selectSong(start.index);
}

/** Keyboard and screen-reader activation; pointer taps are handled above. */
function click(event: MouseEvent): void {
  if (event.detail !== 0) return;
  const index = target(event);
  if (index !== null) props.store.selectSong(index);
}

function write(pattern: number): void {
  navigator.vibrate?.(8);
  props.store.songWrite(pattern);
}

function reveal(index: number, force: boolean): void {
  if (!force && performance.now() - touchedAt < FOLLOW_PAUSE_MS) return;
  list.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
}

watch(cursor, (index) => void nextTick(() => reveal(index, true)));
watch(() => props.playEntry, (index) => { if (index !== null) reveal(index, false); });
</script>

<template>
  <section class="song" aria-label="Song">
    <header class="song-head">
      <span data-song-summary>{{ song.length }} {{ song.length === 1 ? "Eintrag" : "Einträge" }} · {{ bars }} {{ bars === 1 ? "Takt" : "Takte" }} · {{ duration }}</span>
      <span class="hint" data-song-hint>{{ store.ui.value.playMode === "song" ? "▶ spielt den Song" : "▶ spielt Loop" }}</span>
    </header>

    <div ref="list" class="entries" @touchstart="swipeGuard.start" @touchmove="swipeGuard.move" @pointerdown="down" @pointerup="up" @pointercancel="gesture = null" @click="click">
      <button
        v-for="(pattern, index) in song"
        :key="index"
        type="button"
        class="entry"
        :class="{ cursor: cursor === index, playhead: playEntry === index }"
        :data-index="index"
        :data-song-entry="index"
        :aria-label="`Eintrag ${rowLabel(index)}: Pattern ${pattern + 1}`"
      >
        <span class="num">{{ rowLabel(index) }}</span>
        <span class="chip">P{{ pattern + 1 }}</span>
        <span class="lanes" aria-hidden="true"><i v-for="lane in usedLanes(project.patterns[pattern])" :key="lane" :class="lane"></i></span>
        <span class="len">{{ project.patterns[pattern]?.rows ?? 16 }} Z.</span>
      </button>
      <button
        type="button"
        class="entry end"
        :class="{ cursor: atEnd }"
        :data-index="song.length"
        data-song-end
        :disabled="song.length >= MAX_SONG_LENGTH"
      >
        + ans Ende
      </button>
    </div>

    <section class="editor song-editor" aria-label="Song-Editor">
      <header class="where">
        <span>{{ atEnd ? "Neuer Eintrag am Ende" : `Eintrag ${rowLabel(cursor)}` }}</span>
        <strong>{{ selected === null ? "" : `P${selected + 1}` }}</strong>
      </header>
      <div class="pads patterns8">
        <button
          v-for="index in PATTERN_COUNT"
          :key="index"
          type="button"
          class="pad"
          :class="{ active: selected === index - 1, empty: !usedLanes(project.patterns[index - 1]).length }"
          :data-song-pad="index - 1"
          :aria-label="`Pattern ${index} ${atEnd ? 'anhängen' : 'eintragen'}`"
          :disabled="atEnd && song.length >= MAX_SONG_LENGTH"
          @click="write(index - 1)"
        >
          {{ index }}
        </button>
      </div>
      <div class="tools">
        <button type="button" class="nav" aria-label="Eintrag hoch" @click="store.selectSong(cursor - 1)">▲</button>
        <button type="button" class="nav" aria-label="Eintrag runter" @click="store.selectSong(cursor + 1)">▼</button>
        <button type="button" data-song-tool="repeat" :disabled="song.length >= MAX_SONG_LENGTH" @click="store.songInsert()"><small>Eintrag</small>wiederholen</button>
        <button type="button" class="clear" data-song-tool="delete" aria-label="Eintrag löschen" :disabled="atEnd || song.length <= 1" @click="store.songDelete()">⌫</button>
        <button type="button" class="play-from" data-song-tool="play-from" @click="emit('playFrom', Math.min(cursor, song.length - 1))"><small>Song</small>▶ ab hier</button>
      </div>
    </section>
  </section>
</template>
