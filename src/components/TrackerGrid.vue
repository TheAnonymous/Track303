<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Cell, Lane, Pattern, Project } from "../domain/types";
import { LANES } from "../domain/types";
import { cellCode, cellDescription, cellFlags, chanceCode, hasDepth, LANE_LABELS, LANE_NAMES, ratchetCode, rowLabel } from "../format";
import { horizontalSwipeGuard } from "../horizontal-swipe";
import type { Cursor } from "../store";

export type Column = "main" | "accent" | "slide" | "chance" | "ratchet";

const props = defineProps<{
  project: Project;
  pattern: Pattern;
  cursor: Cursor;
  focus: Lane | null;
  /** Row the music is on in this pattern, or `null` when it plays another one or is stopped. */
  playRow: number | null;
  lit: readonly Lane[];
}>();

const emit = defineEmits<{
  select: [lane: Lane, row: number];
  repeat: [lane: Lane, row: number];
  clear: [lane: Lane, row: number];
  toggle: [lane: Lane, row: number, column: Exclude<Column, "main">];
  focus: [lane: Lane | null];
}>();

const SWIPE_PX = 36;
const TAP_SLOP_PX = 12;
const DOUBLE_TAP_MS = 320;
/** After a touch the grid stops following the playhead for a while, so the row under the thumb stays put. */
const FOLLOW_PAUSE_MS = 3_000;

const rows = computed(() => Array.from({ length: props.pattern.rows }, (_, row) => row));
const columns = computed<Column[]>(() => props.focus === "acid" ? ["main", "accent", "slide", "chance", "ratchet"] : ["main", "accent", "chance", "ratchet"]);
const COLUMN_LABELS: Record<Column, string> = { main: "Note", accent: "Akz", slide: "Sld", chance: "Chn", ratchet: "Wdh" };

function cellAt(lane: Lane, row: number): Cell {
  return props.pattern.lanes[lane][row] ?? null;
}

function columnText(lane: Lane, row: number, column: Column): string {
  const cell = cellAt(lane, row);
  switch (column) {
    case "main": return cellCode(cell, props.project);
    case "accent": return cell?.accent ? "!" : "·";
    case "slide": return cell?.kind === "note" && cell.slide ? "~" : "·";
    case "chance": return chanceCode(cell);
    case "ratchet": return ratchetCode(cell);
  }
}

function columnSet(lane: Lane, row: number, column: Column): boolean {
  const cell = cellAt(lane, row);
  if (!cell) return false;
  switch (column) {
    case "main": return true;
    case "accent": return cell.accent;
    case "slide": return cell.kind === "note" && cell.slide;
    case "chance": return cell.chance < 1;
    case "ratchet": return cell.ratchet > 1;
  }
}

const scroller = ref<HTMLElement | null>(null);
const swipeGuard = horizontalSwipeGuard();
let gesture: { id: number; x: number; y: number; lane: Lane; row: number; column: Column } | null = null;
let lastTap: { lane: Lane; row: number; at: number } | null = null;
let touchedAt = -Infinity;

function target(event: Event): { lane: Lane; row: number; column: Column } | null {
  const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-lane][data-row]");
  if (!element) return null;
  const lane = element.dataset.lane as Lane;
  const row = Number(element.dataset.row);
  return LANES.includes(lane) && Number.isInteger(row) ? { lane, row, column: (element.dataset.column as Column | undefined) ?? "main" } : null;
}

function down(event: PointerEvent): void {
  touchedAt = performance.now();
  if (!event.isPrimary) return;
  const hit = target(event);
  gesture = hit ? { id: event.pointerId, x: event.clientX, y: event.clientY, ...hit } : null;
}

function up(event: PointerEvent): void {
  touchedAt = performance.now();
  const start = gesture;
  gesture = null;
  if (!start || event.pointerId !== start.id) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (dx < -SWIPE_PX && Math.abs(dy) < Math.abs(dx) / 2) {
    lastTap = null;
    emit("clear", start.lane, start.row);
    return;
  }
  if (Math.hypot(dx, dy) > TAP_SLOP_PX) return;
  tap(start.lane, start.row, start.column);
}

function tap(lane: Lane, row: number, column: Column): void {
  const now = performance.now();
  const repeat = column === "main" && lastTap?.lane === lane && lastTap.row === row && now - lastTap.at < DOUBLE_TAP_MS;
  lastTap = repeat ? null : { lane, row, at: now };
  if (repeat) {
    emit("repeat", lane, row);
    return;
  }
  emit("select", lane, row);
  if (column !== "main") emit("toggle", lane, row, column);
}

/** Keyboard and screen-reader activation; pointer taps are handled above. */
function click(event: MouseEvent): void {
  if (event.detail !== 0) return;
  const hit = target(event);
  if (hit) tap(hit.lane, hit.row, hit.column);
}

function reveal(row: number, force: boolean): void {
  if (!force && performance.now() - touchedAt < FOLLOW_PAUSE_MS) return;
  const element = scroller.value?.querySelector<HTMLElement>(`[data-row-line="${row}"]`);
  element?.scrollIntoView({ block: "nearest" });
}

watch(() => [props.cursor.row, props.cursor.lane, props.focus] as const, ([row]) => void nextTick(() => reveal(row, true)));
watch(() => props.playRow, (row) => { if (row !== null) reveal(row, false); });
</script>

<template>
  <section class="grid" :class="{ focused: focus, 'focus-acid': focus === 'acid' }" :aria-label="focus ? `Spur ${LANE_NAMES[focus]}` : 'Pattern'">
    <div v-if="!focus" class="head">
      <span class="rownum" aria-hidden="true"></span>
      <button v-for="lane in LANES" :key="lane" type="button" class="lanehead" :class="[lane, { lit: lit.includes(lane) }]" :data-focus-lane="lane" :aria-label="`${LANE_NAMES[lane]} aufzoomen`" @click="emit('focus', lane)">
        <i class="led" aria-hidden="true"></i>{{ LANE_LABELS[lane] }}
      </button>
    </div>
    <template v-else>
      <div class="head tabs">
        <button type="button" class="back" data-overview @click="emit('focus', null)">‹ Alle</button>
        <button v-for="lane in LANES" :key="lane" type="button" class="lanehead" :class="[lane, { active: lane === focus, lit: lit.includes(lane) }]" :data-focus-lane="lane" :aria-pressed="lane === focus" @click="emit('focus', lane)">
          <i class="led" aria-hidden="true"></i>{{ LANE_LABELS[lane] }}
        </button>
      </div>
      <div class="head columns" :class="focus" aria-hidden="true">
        <span class="rownum"></span>
        <span v-for="column in columns" :key="column" class="colhead">{{ COLUMN_LABELS[column] }}</span>
      </div>
    </template>

    <div ref="scroller" class="rows" @touchstart="swipeGuard.start" @touchmove="swipeGuard.move" @pointerdown="down" @pointerup="up" @pointercancel="gesture = null" @click="click">
      <div v-for="row in rows" :key="row" class="line" :class="{ beat: row % 4 === 0, playhead: row === playRow, current: row === cursor.row }" :data-row-line="row">
        <span class="rownum">{{ rowLabel(row) }}</span>
        <template v-if="!focus">
          <button
            v-for="lane in LANES"
            :key="lane"
            type="button"
            class="cell"
            :class="[lane, { on: cellAt(lane, row), cursor: cursor.lane === lane && cursor.row === row, accent: cellAt(lane, row)?.accent }]"
            :data-lane="lane"
            :data-row="row"
            :aria-label="cellDescription(lane, row, cellAt(lane, row), project)"
          >
            <span class="code">{{ cellCode(cellAt(lane, row), project) }}</span><span class="flags">{{ cellFlags(cellAt(lane, row)) }}</span><span v-if="hasDepth(cellAt(lane, row))" class="depth" aria-hidden="true">•</span>
          </button>
        </template>
        <template v-else>
          <button
            v-for="column in columns"
            :key="column"
            type="button"
            class="cell"
            :class="[focus, `col-${column}`, { on: cellAt(focus, row), set: columnSet(focus, row, column), cursor: cursor.lane === focus && cursor.row === row && column === 'main', accent: column === 'main' && cellAt(focus, row)?.accent }]"
            :data-lane="focus"
            :data-row="row"
            :data-column="column"
            :aria-label="column === 'main' ? cellDescription(focus, row, cellAt(focus, row), project) : `${COLUMN_LABELS[column]} Zeile ${rowLabel(row)}`"
          >
            <span class="code">{{ columnText(focus, row, column) }}</span>
          </button>
        </template>
      </div>
    </div>
  </section>
</template>
