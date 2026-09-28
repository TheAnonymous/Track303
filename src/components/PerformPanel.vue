<script setup lang="ts">
import { computed, ref } from "vue";
import type { AcidKnobs, Lane } from "../domain/types";
import { LANES } from "../domain/types";
import { clock, LANE_LABELS, LANE_NAMES } from "../format";
import type { PerformanceState, TrackerEngine } from "../sound/engine";
import { ROWS_PER_BAR } from "../sound/performance-layer";
import type { Track303Store } from "../store";

const props = defineProps<{
  store: Track303Store;
  engine: TrackerEngine;
  performance: PerformanceState;
  /** Row of the sounding pattern, or `null` when stopped. */
  playRow: number | null;
  lit: readonly Lane[];
  recording: boolean;
  recordingSeconds: number;
}>();
const emit = defineEmits<{ record: [] }>();

const KEY_STEP = 0.02;
// The drag surfaces cancel their touches' default (`@touchstart.prevent`): pointer
// events still arrive, but Chrome starts no fling that would swallow the next tap.

/** Knobs under a thumb; saved as one undo step when the thumb lets go. */
const draft = ref<AcidKnobs | null>(null);
const knobs = computed(() => draft.value ?? props.store.project.value.knobs);
const filter = ref(0);
const beat = computed(() => props.playRow === null ? null : props.playRow % ROWS_PER_BAR);

/** Keeps a finger's moves on the surface it started on; a finger already gone is fine. */
function capture(event: PointerEvent): void {
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // The pointer ended before the capture; its pointerup still arrives.
  }
}

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function live(change: Partial<AcidKnobs>): void {
  draft.value = { ...knobs.value, ...change };
  props.engine.setLiveKnobs(draft.value);
}

function commit(): void {
  const settled = draft.value;
  if (!settled) return;
  props.store.edit((project) => { project.knobs = { ...settled }; });
  draft.value = null;
  props.engine.setLiveKnobs(null);
}

/* XY field: cutoff across, resonance up. */

let xyPointer: number | null = null;

function xyAt(event: PointerEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  live({ cutoff: round((event.clientX - rect.left) / rect.width), resonance: round(1 - (event.clientY - rect.top) / rect.height) });
}

function xyDown(event: PointerEvent): void {
  if (xyPointer !== null) return;
  xyPointer = event.pointerId;
  capture(event);
  navigator.vibrate?.(6);
  xyAt(event);
}

function xyMove(event: PointerEvent): void {
  if (event.pointerId === xyPointer) xyAt(event);
}

function xyUp(event: PointerEvent): void {
  if (event.pointerId !== xyPointer) return;
  xyPointer = null;
  commit();
}

function xyKey(event: KeyboardEvent): void {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[event.key];
  if (!move) return;
  event.preventDefault();
  const [dx, dy] = move as [number, number];
  const { cutoff, resonance } = knobs.value;
  props.store.edit((project) => {
    project.knobs.cutoff = round(cutoff + dx * KEY_STEP);
    project.knobs.resonance = round(resonance + dy * KEY_STEP);
  }, "perform:xy");
}

/* DJ filter: springs back to open when the thumb lets go. */

let filterPointer: number | null = null;

function filterAt(event: PointerEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const value = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
  // A small dead zone around the middle keeps a resting thumb neutral.
  filter.value = Math.abs(value) < 0.06 ? 0 : value;
  props.engine.setPerformanceFilter(filter.value);
}

function filterDown(event: PointerEvent): void {
  if (filterPointer !== null) return;
  filterPointer = event.pointerId;
  capture(event);
  filterAt(event);
}

function filterMove(event: PointerEvent): void {
  if (event.pointerId === filterPointer) filterAt(event);
}

function filterUp(event: PointerEvent): void {
  if (event.pointerId !== filterPointer) return;
  filterPointer = null;
  filter.value = 0;
  props.engine.setPerformanceFilter(0);
}

/* Break: hold, then let go for the drop. */

let breakPointer: number | null = null;

function breakDown(event: PointerEvent): void {
  if (breakPointer !== null) return;
  breakPointer = event.pointerId;
  capture(event);
  navigator.vibrate?.(10);
  props.engine.setBreak(true);
}

function breakUp(event: PointerEvent): void {
  if (event.pointerId !== breakPointer) return;
  breakPointer = null;
  props.engine.setBreak(false);
}

function breakKey(event: KeyboardEvent, down: boolean): void {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) props.engine.setBreak(down);
}

function muteState(lane: Lane): "pending" | "muted" | "on" {
  if (props.performance.pending.includes(lane)) return "pending";
  return props.performance.muted.includes(lane) ? "muted" : "on";
}

function toggleMute(lane: Lane): void {
  navigator.vibrate?.(8);
  props.engine.toggleMute(lane);
}

const breakLabel = computed(() => {
  if (props.performance.dropPending) return "Drop am nächsten Takt";
  if (props.performance.breakActive) return "Loslassen für den Drop";
  return "Break halten";
});
</script>

<template>
  <section class="perform" aria-label="Live">
    <div
      class="xy"
      :class="{ touched: draft !== null }"
      role="slider"
      tabindex="0"
      aria-label="Filter-Feld: Cutoff nach rechts, Resonanz nach oben"
      :aria-valuenow="Math.round(knobs.cutoff * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuetext="`Cutoff ${Math.round(knobs.cutoff * 100)}, Resonanz ${Math.round(knobs.resonance * 100)}`"
      data-xy
      @touchstart.prevent
      @pointerdown="xyDown"
      @pointermove="xyMove"
      @pointerup="xyUp"
      @pointercancel="xyUp"
      @keydown="xyKey"
    >
      <span class="line vertical" :style="{ left: `${knobs.cutoff * 100}%` }" aria-hidden="true"></span>
      <span class="line horizontal" :style="{ top: `${(1 - knobs.resonance) * 100}%` }" aria-hidden="true"></span>
      <span class="dot" :style="{ left: `${knobs.cutoff * 100}%`, top: `${(1 - knobs.resonance) * 100}%` }" aria-hidden="true"></span>
      <span class="axis x" aria-hidden="true">Cutoff →</span>
      <span class="axis y" aria-hidden="true">↑ Resonanz</span>
      <output class="readout" data-xy-readout>{{ Math.round(knobs.cutoff * 100) }} · {{ Math.round(knobs.resonance * 100) }}</output>
    </div>

    <label class="slider" data-live-knob="envMod">
      <span>Env Mod</span>
      <input type="range" min="0" max="1" step="0.01" :value="knobs.envMod" @input="live({ envMod: Number(($event.target as HTMLInputElement).value) })" @change="commit" />
      <output>{{ Math.round(knobs.envMod * 100) }}</output>
    </label>
    <label class="slider" data-live-knob="decay">
      <span>Decay</span>
      <input type="range" min="0" max="1" step="0.01" :value="knobs.decay" @input="live({ decay: Number(($event.target as HTMLInputElement).value) })" @change="commit" />
      <output>{{ Math.round(knobs.decay * 100) }}</output>
    </label>

    <div
      class="dj"
      :class="{ low: filter < 0, high: filter > 0 }"
      role="slider"
      aria-label="DJ-Filter: nach links Tiefpass, nach rechts Hochpass, springt beim Loslassen zurück"
      :aria-valuenow="Math.round(filter * 100)"
      aria-valuemin="-100"
      aria-valuemax="100"
      :data-value="Math.round(filter * 100)"
      data-dj
      @touchstart.prevent
      @pointerdown="filterDown"
      @pointermove="filterMove"
      @pointerup="filterUp"
      @pointercancel="filterUp"
    >
      <span class="fill" :style="{ left: `${50 + Math.min(0, filter) * 50}%`, width: `${Math.abs(filter) * 50}%` }" aria-hidden="true"></span>
      <span class="label left" aria-hidden="true">◀ Tiefpass</span>
      <span class="label mid" aria-hidden="true">Filter</span>
      <span class="label right" aria-hidden="true">Hochpass ▶</span>
    </div>

    <div class="bar" aria-hidden="true">
      <i v-for="row in ROWS_PER_BAR" :key="row" :class="{ now: beat === row - 1, beat: (row - 1) % 4 === 0 }"></i>
    </div>

    <div class="mutes" role="group" aria-label="Spuren stummschalten, am nächsten Takt">
      <button
        v-for="lane in LANES"
        :key="lane"
        type="button"
        class="mute"
        :class="[lane, { lit: lit.includes(lane) }]"
        :data-state="muteState(lane)"
        :data-mute="lane"
        :aria-pressed="performance.muted.includes(lane)"
        :aria-label="`${LANE_NAMES[lane]} ${performance.muted.includes(lane) ? 'einschalten' : 'stummschalten'}`"
        @click="toggleMute(lane)"
      >
        <i class="led" aria-hidden="true"></i>{{ LANE_LABELS[lane] }}
      </button>
    </div>

    <div class="performance-row">
    <button
      type="button"
      class="rec"
      :aria-pressed="recording"
      :aria-label="recording ? 'Aufnahme beenden' : 'Aufnahme starten'"
      data-rec
      @click="emit('record')"
    >
      <strong><i aria-hidden="true"></i>REC</strong><small data-rec-time>{{ clock(recordingSeconds) }}</small>
    </button>
    <button
      type="button"
      class="break"
      :data-state="performance.dropPending ? 'drop' : performance.breakActive ? 'break' : 'idle'"
      :aria-pressed="performance.breakActive"
      data-break
      @touchstart.prevent
      @pointerdown="breakDown"
      @pointerup="breakUp"
      @pointercancel="breakUp"
      @keydown="breakKey($event, true)"
      @keyup="breakKey($event, false)"
      @contextmenu.prevent
    >
      <strong>BREAK → DROP</strong><small>{{ breakLabel }}</small>
    </button>
    </div>
  </section>
</template>
