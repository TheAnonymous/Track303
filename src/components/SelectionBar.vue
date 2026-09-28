<script setup lang="ts">
import { computed, ref } from "vue";
import { LANES } from "../domain/types";
import { LANE_LABELS, rowLabel } from "../format";
import type { FillShape, Track303Store } from "../store";

const props = defineProps<{ store: Track303Store }>();

const FILLS: { shape: FillShape; label: string; hint: string }[] = [
  { shape: "all", label: "Jede", hint: "jede Zeile" },
  { shape: "2", label: "2.", hint: "jede zweite" },
  { shape: "4", label: "4.", hint: "jede vierte" },
  { shape: "offbeat", label: "Offbeat", hint: "zwischen den Schlägen" },
  { shape: "e3", label: "E 3/8", hint: "euklidisch 3 aus 8" },
  { shape: "e5", label: "E 5/8", hint: "euklidisch 5 aus 8" },
  { shape: "e7", label: "E 7/16", hint: "euklidisch 7 aus 16" },
];

const filling = ref(false);
const selection = computed(() => props.store.ui.value.selection!);
const lanes = computed(() => LANES.slice(selection.value.lanes[0], selection.value.lanes[1] + 1));
const rows = computed(() => selection.value.rows[1] - selection.value.rows[0] + 1);
const hasNotes = computed(() => lanes.value.includes("acid"));

function act(action: () => void): void {
  navigator.vibrate?.(8);
  action();
}

function fill(shape: FillShape): void {
  act(() => props.store.fillSelection(shape));
  filling.value = false;
}
</script>

<template>
  <section class="editor selection-bar" aria-label="Auswahl">
    <header class="where">
      <span data-selection-summary>Auswahl · {{ lanes.map((lane) => LANE_LABELS[lane]).join("–") }} · Zeile {{ rowLabel(selection.rows[0]) }}–{{ rowLabel(selection.rows[1]) }}</span>
      <strong>{{ rows }} {{ rows === 1 ? "Zeile" : "Zeilen" }}</strong>
    </header>

    <template v-if="!filling">
      <div class="tools">
        <button type="button" data-block="copy" @click="act(() => store.copySelection())">Kopieren</button>
        <button type="button" data-block="paste" :disabled="!store.hasBlock.value" @click="act(() => store.pasteBlock())">Einfügen</button>
        <button type="button" data-block="clear" @click="act(() => store.clearSelectionCells())">Leeren</button>
        <button type="button" data-block="all-rows" @click="store.selectAllRows()">Alle Zeilen</button>
      </div>
      <div class="tools">
        <button type="button" data-block="up" aria-label="Eine Zeile nach oben schieben" @click="act(() => store.shiftSelection(-1))"><small>schieben</small>▲</button>
        <button type="button" data-block="down" aria-label="Eine Zeile nach unten schieben" @click="act(() => store.shiftSelection(1))"><small>schieben</small>▼</button>
        <button type="button" data-block="tone-down" :disabled="!hasNotes" aria-label="Einen Ton tiefer" @click="act(() => store.transposeSelection(-1))"><small>Ton</small>−1</button>
        <button type="button" data-block="tone-up" :disabled="!hasNotes" aria-label="Einen Ton höher" @click="act(() => store.transposeSelection(1))"><small>Ton</small>+1</button>
        <button type="button" data-block="octave-down" :disabled="!hasNotes" aria-label="Eine Oktave tiefer" @click="act(() => store.transposeSelection(-7))"><small>Okt</small>−</button>
        <button type="button" data-block="octave-up" :disabled="!hasNotes" aria-label="Eine Oktave höher" @click="act(() => store.transposeSelection(7))"><small>Okt</small>+</button>
      </div>
      <div class="tools">
        <button type="button" class="fill-open" data-block="fill" @click="filling = true">Füllen …</button>
        <button type="button" class="done" data-block="done" @click="store.clearSelection()">Fertig</button>
      </div>
    </template>

    <template v-else>
      <p class="fill-hint">Füllt jede Spur mit ihrem zuletzt geschriebenen Wert, die übrigen Zeilen werden leer.</p>
      <div class="tools fills">
        <button v-for="option in FILLS" :key="option.shape" type="button" :data-fill="option.shape" :aria-label="`Füllen: ${option.hint}`" @click="fill(option.shape)">{{ option.label }}</button>
        <button type="button" class="done" data-fill-back @click="filling = false">Zurück</button>
      </div>
    </template>
  </section>
</template>
