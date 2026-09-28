<script setup lang="ts">
import { computed } from "vue";
import { scaleNames } from "../domain/music";
import type { Cell, DrumCell, FxType, FxValue, NoteCell } from "../domain/types";
import { CHANCES, EDIT_STEPS, FX_VALUES, LANE_FX, LANE_VOICES, OCTAVES, RATCHETS } from "../domain/types";
import { cellCode, cellFlags, chanceLabel, FX_LABELS, FX_VALUE_LABELS, fxCode, LANE_NAMES, rowLabel, VOICE_LABELS } from "../format";
import type { DrumVoice } from "../sound/kitty-types";
import type { Track303Store } from "../store";

const props = defineProps<{ store: Track303Store }>();
const emit = defineEmits<{ entered: [cell: Cell] }>();

const project = computed(() => props.store.project.value);
const ui = computed(() => props.store.ui.value);
const lane = computed(() => ui.value.cursor.lane);
const cell = computed<Cell>(() => props.store.pattern.lanes[lane.value][ui.value.cursor.row] ?? null);
const names = computed(() => scaleNames(project.value.root, project.value.scale));
const voices = computed<readonly DrumVoice[]>(() => lane.value === "acid" ? [] : LANE_VOICES[lane.value]);
const fxMode = computed(() => ui.value.editorMode === "fx");
const effects = computed(() => LANE_FX[lane.value]);
const fx = computed(() => cell.value?.fx ?? null);

function setMode(mode: "notes" | "fx"): void {
  props.store.setUi({ editorMode: mode });
}

function chooseFx(type: FxType): void {
  haptic();
  props.store.setFx({ type, value: fx.value?.value ?? 2 });
}

function chooseValue(value: FxValue): void {
  if (!fx.value) return;
  haptic();
  props.store.setFx({ type: fx.value.type, value });
}

function next<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length]!;
}

function haptic(): void {
  navigator.vibrate?.(8);
}

function enterNote(degree: number): void {
  const previous = cell.value?.kind === "note" ? cell.value : null;
  const entered: NoteCell = {
    kind: "note",
    degree,
    octave: ui.value.octave,
    accent: previous?.accent ?? false,
    slide: previous?.slide ?? false,
    chance: previous?.chance ?? 1,
    ratchet: previous?.ratchet ?? 1,
    ...(previous?.fx ? { fx: previous.fx } : {}),
  };
  haptic();
  props.store.enter(entered);
  emit("entered", entered);
}

function enterDrum(voice: DrumVoice): void {
  const previous = cell.value?.kind === "drum" ? cell.value : null;
  const entered: DrumCell = { kind: "drum", voice, accent: previous?.accent ?? false, chance: previous?.chance ?? 1, ratchet: previous?.ratchet ?? 1, ...(previous?.fx ? { fx: previous.fx } : {}) };
  haptic();
  props.store.enter(entered);
  emit("entered", entered);
}

function shiftOctave(delta: number): void {
  const octave = Math.max(OCTAVES[0], Math.min(OCTAVES[OCTAVES.length - 1]!, ui.value.octave + delta));
  props.store.setUi({ octave });
}

function move(delta: number): void {
  props.store.select(lane.value, ui.value.cursor.row + delta);
}
</script>

<template>
  <section class="editor" :class="lane" aria-label="Editor">
    <header class="where">
      <span>{{ LANE_NAMES[lane] }} · Zeile {{ rowLabel(ui.cursor.row) }}</span>
      <strong data-cursor-value>{{ cellCode(cell, project) }}{{ cellFlags(cell) }}<span v-if="fx" class="fx-code">{{ fxCode(cell) }}</span></strong>
    </header>

    <template v-if="fxMode">
      <div class="pads fx-pads">
        <button
          v-for="type in effects"
          :key="type"
          type="button"
          class="pad fx"
          :class="{ active: fx?.type === type }"
          :disabled="!cell"
          :data-fx="type"
          :aria-label="`Effekt ${FX_LABELS[type]}`"
          @click="chooseFx(type)"
        >
          {{ type }}<small>{{ FX_LABELS[type] }}</small>
        </button>
        <button type="button" class="pad mode-switch" data-editor-mode="notes" aria-label="Zurück zu den Noten" @click="setMode('notes')">♪<small>Noten</small></button>
      </div>
      <div class="tools">
        <button
          v-for="value in FX_VALUES"
          :key="value"
          type="button"
          class="fx-value"
          :aria-pressed="fx?.value === value"
          :disabled="!fx"
          :data-fx-value="value"
          @click="chooseValue(value)"
        >
          <small>{{ value }}</small>{{ fx ? FX_VALUE_LABELS[fx.type][value] : "–" }}
        </button>
        <button type="button" class="clear" :disabled="!fx" data-fx-off aria-label="Effekt entfernen" @click="haptic(); store.setFx(null)">FX ✕</button>
      </div>
    </template>

    <div v-else class="pads" :class="{ notes: lane === 'acid', drums: lane !== 'acid' }">
      <template v-if="lane === 'acid'">
        <button
          v-for="(name, degree) in names"
          :key="degree"
          type="button"
          class="pad"
          :class="{ active: cell?.kind === 'note' && cell.degree === degree, root: degree === 0 }"
          :data-degree="degree"
          :aria-label="`${name} Oktave ${ui.octave} eintragen`"
          @click="enterNote(degree)"
        >
          {{ name }}
        </button>
      </template>
      <template v-else>
        <button
          v-for="voice in voices"
          :key="voice"
          type="button"
          class="pad"
          :class="{ active: cell?.kind === 'drum' && cell.voice === voice }"
          :data-voice="voice"
          @click="enterDrum(voice)"
        >
          {{ VOICE_LABELS[voice] }}
        </button>
      </template>
      <button type="button" class="pad mode-switch" data-editor-mode="fx" aria-label="Effekte" @click="setMode('fx')">FX</button>
    </div>

    <div v-if="!fxMode" class="tools">
      <div v-if="lane === 'acid'" class="octave" role="group" aria-label="Oktave zum Eintragen">
        <button type="button" aria-label="Oktave tiefer" :disabled="ui.octave <= OCTAVES[0]" @click="shiftOctave(-1)">−</button>
        <span data-octave>Okt {{ ui.octave }}</span>
        <button type="button" aria-label="Oktave höher" :disabled="ui.octave >= OCTAVES[OCTAVES.length - 1]!" @click="shiftOctave(1)">+</button>
      </div>
      <button type="button" class="toggle accent" :aria-pressed="Boolean(cell?.accent)" :disabled="!cell" data-tool="accent" @click="store.modify((target) => { target.accent = !target.accent; })">
        ! Akzent
      </button>
      <button
        v-if="lane === 'acid'"
        type="button"
        class="toggle slide"
        :aria-pressed="cell?.kind === 'note' && cell.slide"
        :disabled="cell?.kind !== 'note'"
        data-tool="slide"
        @click="store.modify((target) => { if (target.kind === 'note') target.slide = !target.slide; })"
      >
        ~ Slide
      </button>
      <button type="button" class="clear" :disabled="!cell" data-tool="clear" aria-label="Zeile löschen" @click="store.clear(); haptic()">⌫</button>
    </div>

    <div class="tools">
      <button type="button" class="nav" aria-label="Zeile hoch" @click="move(-1)">▲</button>
      <button type="button" class="nav" aria-label="Zeile runter" @click="move(1)">▼</button>
      <button type="button" data-tool="step" :aria-label="`Schrittweite ${ui.editStep}`" @click="store.setUi({ editStep: next(EDIT_STEPS, ui.editStep) })">
        <small>Schritt</small>{{ ui.editStep }}
      </button>
      <button type="button" :disabled="!cell" data-tool="chance" @click="store.modify((target) => { target.chance = next(CHANCES, target.chance as (typeof CHANCES)[number]); })">
        <small>Chance</small>{{ chanceLabel(cell?.chance ?? 1) }}
      </button>
      <button type="button" :disabled="!cell" data-tool="ratchet" @click="store.modify((target) => { target.ratchet = next(RATCHETS, target.ratchet as (typeof RATCHETS)[number]); })">
        <small>Wdh</small>×{{ cell?.ratchet ?? 1 }}
      </button>
    </div>
  </section>
</template>
