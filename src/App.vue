<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import DragValue from "./components/DragValue.vue";
import PerformPanel from "./components/PerformPanel.vue";
import RecordingSheet, { type Take } from "./components/RecordingSheet.vue";
import SongPanel from "./components/SongPanel.vue";
import SoundPanel from "./components/SoundPanel.vue";
import ThumbEditor from "./components/ThumbEditor.vue";
import TrackerGrid, { type Column } from "./components/TrackerGrid.vue";
import { drum, note } from "./domain/project";
import type { Cell, Lane, RowCount } from "./domain/types";
import { CHANCES, MAX_TEMPO, MIN_TEMPO, PATTERN_COUNT, RATCHETS, ROW_COUNTS } from "./domain/types";
import { clock } from "./format";
import type { PlayMode } from "./sound/arrangement";
import { TrackerEngine, type EngineStatus, type PerformanceState } from "./sound/engine";
import { MAX_RECORDING_SECONDS } from "./sound/recorder";
import { audibleRange, encodePcm16Wav } from "./sound/wav";
import { Track303Store } from "./store";
import { PlaybackWakeLock } from "./wake-lock";

const HELP_SEEN_KEY = "track303.help.seen";

const store = new Track303Store();
const engine = new TrackerEngine(store.project.value, { latencyHint: "balanced" });
const wakeLock = new PlaybackWakeLock();

const project = store.project;
const ui = store.ui;
const pattern = computed(() => project.value.patterns[project.value.activePattern]!);
const status = ref<EngineStatus>("idle");
const playingPattern = ref<number | null>(null);
const playRow = ref<number | null>(null);
const playEntry = ref<number | null>(null);
const recording = ref(false);
const recordingSeconds = ref(0);
const take = shallowRef<Take | null>(null);
let recordingTimer: ReturnType<typeof setInterval> | undefined;
const queued = ref<number | null>(null);
const lit = shallowRef<readonly Lane[]>([]);
const performance = shallowRef<PerformanceState>(engine.performanceState);
const menuOpen = ref(false);
const helpOpen = ref(!readFlag(HELP_SEEN_KEY));
const notice = ref(store.restoredFromBackup ? "Der letzte Stand war beschädigt, die Sicherung davor ist geladen." : "");

const playing = computed(() => status.value === "playing");
const visibleRow = computed(() => playingPattern.value === project.value.activePattern ? playRow.value : null);

watch(project, (value) => engine.syncProject(value));

const stopPlayhead = engine.onPlayhead((event) => {
  playingPattern.value = event.pattern;
  playEntry.value = event.songIndex;
  playRow.value = event.row;
  queued.value = engine.queuedPattern;
  lit.value = event.triggered;
});
const stopPerformance = engine.onPerformance((state) => {
  performance.value = state;
});
const stopStatus = engine.onStatus((next) => {
  status.value = next;
  wakeLock.playing = next === "playing";
  if (next === "suspended") notice.value = "Der Browser hat den Ton blockiert. Tippe noch einmal auf Play.";
  if (next === "error") notice.value = "Der Ton konnte nicht starten. Lade die Seite neu und versuche es noch einmal.";
  if (next === "playing") notice.value = "";
  if (next !== "playing") {
    playingPattern.value = null;
    playEntry.value = null;
    playRow.value = null;
    queued.value = null;
    lit.value = [];
  }
});

async function togglePlay(): Promise<void> {
  if (engine.playing) {
    engine.stop();
    return;
  }
  engine.setArrangement(ui.value.playMode, 0);
  await engine.start().catch((error: unknown) => console.error(error));
}

/** Plays the song from one entry on, restarting if something already plays. */
async function playFrom(entry: number): Promise<void> {
  store.setUi({ playMode: "song" });
  if (engine.playing) engine.stop();
  engine.setArrangement("song", entry);
  await engine.start().catch((error: unknown) => console.error(error));
}

/** Loop plays the shown pattern, song the song list; while playing the switch waits for the pattern's end. */
function setPlayMode(mode: PlayMode): void {
  store.setUi({ playMode: mode });
  engine.setArrangement(mode, 0);
  queued.value = engine.queuedPattern;
}

function choosePattern(index: number): void {
  store.showPattern(index);
  if (engine.playing) {
    engine.queuePattern(index);
    queued.value = engine.queuedPattern;
  }
}

async function toggleRecording(): Promise<void> {
  if (recording.value) {
    await finishRecording();
    return;
  }
  try {
    await engine.startRecording();
  } catch (error) {
    console.error(error);
    notice.value = "Die Aufnahme konnte nicht starten. Tippe einmal auf Play und versuche es noch einmal.";
    return;
  }
  recording.value = true;
  recordingSeconds.value = 0;
  recordingTimer = setInterval(() => {
    recordingSeconds.value = engine.recordingSeconds;
    if (recordingSeconds.value >= MAX_RECORDING_SECONDS) void finishRecording("Nach 10 Minuten automatisch beendet.");
  }, 250);
}

async function finishRecording(note = ""): Promise<void> {
  if (!recording.value) return;
  recording.value = false;
  clearInterval(recordingTimer);
  const pcm = await engine.stopRecording();
  recordingSeconds.value = 0;
  const range = audibleRange(pcm);
  if (!range) {
    notice.value = "Die Aufnahme war still. Starte die Musik und nimm noch einmal auf.";
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const blob = new Blob([encodePcm16Wav(pcm, range.start, range.end)], { type: "audio/wav" });
  discardTake();
  take.value = { blob, url: URL.createObjectURL(blob), fileName: `track303-${stamp}.wav`, seconds: (range.end - range.start) / pcm.sampleRate };
  if (note) notice.value = note;
}

function discardTake(): void {
  if (take.value) URL.revokeObjectURL(take.value.url);
  take.value = null;
}

function preview(lane: Lane, cell: Cell): void {
  if (!engine.playing) void engine.preview(lane, cell).catch((error: unknown) => console.error(error));
}

function select(lane: Lane, row: number): void {
  store.select(lane, row);
  preview(lane, pattern.value.lanes[lane][row] ?? null);
}

/** A double tap repeats the lane's last entered value, or a sensible first one. */
function repeat(lane: Lane, row: number): void {
  store.select(lane, row);
  const fallback: Record<Lane, Cell> = { bd: drum("kick"), sd: drum("clap"), hh: drum("closedHat"), acid: note(0, ui.value.octave) };
  const cell = structuredClone(ui.value.last[lane] ?? fallback[lane]);
  navigator.vibrate?.(8);
  store.enter(cell);
  preview(lane, cell);
}

function clear(lane: Lane, row: number): void {
  if (!pattern.value.lanes[lane][row]) return;
  navigator.vibrate?.(12);
  store.clear(lane, row);
}

function toggle(lane: Lane, row: number, column: Exclude<Column, "main">): void {
  if (!pattern.value.lanes[lane][row]) return;
  store.modify((cell) => {
    if (column === "accent") cell.accent = !cell.accent;
    else if (column === "slide" && cell.kind === "note") cell.slide = !cell.slide;
    else if (column === "chance") cell.chance = CHANCES[(CHANCES.indexOf(cell.chance as (typeof CHANCES)[number]) + 1) % CHANCES.length]!;
    else if (column === "ratchet") cell.ratchet = RATCHETS[(RATCHETS.indexOf(cell.ratchet as (typeof RATCHETS)[number]) + 1) % RATCHETS.length]!;
  });
}

function setRows(rows: RowCount): void {
  store.setRows(rows);
  menuOpen.value = false;
}

function patternAction(action: "copy" | "paste" | "clear"): void {
  if (action === "copy") store.copyPattern();
  else if (action === "paste") store.pastePattern();
  else store.clearPattern();
  menuOpen.value = false;
}

function openHelp(): void {
  menuOpen.value = false;
  helpOpen.value = true;
}

function closeHelp(): void {
  helpOpen.value = false;
  writeFlag(HELP_SEEN_KEY);
}

function keydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, select, textarea, [role='spinbutton']")) return;
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === " ") {
    event.preventDefault();
    void togglePlay();
  } else if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    store.redo();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    store.select(ui.value.cursor.lane, ui.value.cursor.row + (event.key === "ArrowUp" ? -1 : 1));
  } else if (event.key === "Backspace" || event.key === "Delete") {
    store.clear();
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Without storage the help simply shows again next time.
  }
}

onMounted(() => window.addEventListener("keydown", keydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", keydown);
  clearInterval(recordingTimer);
  discardTake();
  stopPlayhead();
  stopPerformance();
  stopStatus();
  wakeLock.playing = false;
  engine.dispose();
});
</script>

<template>
  <div class="app" :class="{ playing }">
    <header class="topbar">
      <button type="button" class="play" :class="{ on: playing }" :aria-pressed="playing" data-play @click="togglePlay">
        <span aria-hidden="true">{{ playing ? "■" : "▶" }}</span>
        <span class="sr">{{ playing ? "Stopp" : "Play" }}</span>
      </button>
      <DragValue :value="project.tempo" :min="MIN_TEMPO" :max="MAX_TEMPO" label="BPM" @change="(tempo) => store.edit((draft) => { draft.tempo = tempo; }, 'tempo')" />
      <button
        type="button"
        class="mode"
        :class="`is-${ui.playMode}`"
        :aria-pressed="ui.playMode === 'song'"
        :aria-label="ui.playMode === 'song' ? 'Spielt den Song; umschalten auf Loop' : 'Spielt das Pattern im Loop; umschalten auf Song'"
        data-mode
        @click="setPlayMode(ui.playMode === 'song' ? 'loop' : 'song')"
      >
        <small>Play</small>{{ ui.playMode === "song" ? "SONG" : "LOOP" }}
      </button>
      <button v-if="recording" type="button" class="rec-indicator" data-rec-indicator aria-label="Aufnahme beenden" @click="toggleRecording">
        <i aria-hidden="true"></i>{{ clock(recordingSeconds) }}
      </button>
      <div class="history">
        <button type="button" :disabled="!store.canUndo.value" aria-label="Rückgängig" data-undo @click="store.undo()">↶</button>
        <button type="button" :disabled="!store.canRedo.value" aria-label="Wiederholen" data-redo @click="store.redo()">↷</button>
      </div>
    </header>

    <nav class="patterns" aria-label="Patterns">
      <button
        v-for="index in PATTERN_COUNT"
        :key="index"
        type="button"
        class="pattern"
        :class="{ active: project.activePattern === index - 1, sounding: playingPattern === index - 1, queued: queued === index - 1 }"
        :aria-pressed="project.activePattern === index - 1"
        :data-pattern="index - 1"
        @click="choosePattern(index - 1)"
      >
        {{ index }}
      </button>
      <button type="button" class="pattern more" :aria-expanded="menuOpen" aria-label="Mehr: Pattern-Werkzeuge und Hilfe" data-pattern-menu @click="menuOpen = !menuOpen">⋯</button>
    </nav>

    <div v-if="menuOpen" class="menu" role="menu">
      <p>Pattern {{ project.activePattern + 1 }}</p>
      <div class="segmented" role="group" aria-label="Länge">
        <button v-for="rows in ROW_COUNTS" :key="rows" type="button" :aria-pressed="pattern.rows === rows" :data-rows="rows" @click="setRows(rows)">{{ rows }} Zeilen</button>
      </div>
      <button type="button" role="menuitem" data-pattern-action="copy" @click="patternAction('copy')">Kopieren</button>
      <button type="button" role="menuitem" data-pattern-action="paste" :disabled="!store.hasClipboard.value" @click="patternAction('paste')">Einfügen</button>
      <button type="button" role="menuitem" data-pattern-action="clear" @click="patternAction('clear')">Leeren</button>
      <button type="button" role="menuitem" class="help-item" data-help-open @click="openHelp">? Hilfe</button>
    </div>

    <p v-if="notice" class="notice" role="status" @click="notice = ''">{{ notice }}</p>

    <main>
      <TrackerGrid
        v-if="ui.view === 'pattern'"
        :project="project"
        :pattern="pattern"
        :cursor="ui.cursor"
        :focus="ui.focus"
        :play-row="visibleRow"
        :lit="lit"
        @select="select"
        @repeat="repeat"
        @clear="clear"
        @toggle="toggle"
        @focus="(lane) => store.setUi({ focus: lane })"
      />
      <SongPanel v-else-if="ui.view === 'song'" :store="store" :play-entry="playEntry" @play-from="playFrom" />
      <SoundPanel v-else-if="ui.view === 'sound'" :store="store" />
      <PerformPanel
        v-else
        :store="store"
        :engine="engine"
        :performance="performance"
        :play-row="playRow"
        :lit="lit"
        :recording="recording"
        :recording-seconds="recordingSeconds"
        @record="toggleRecording"
      />
    </main>

    <ThumbEditor v-if="ui.view === 'pattern'" :store="store" @entered="(cell) => preview(ui.cursor.lane, cell)" />

    <nav class="viewbar" role="tablist" aria-label="Ansicht">
      <button type="button" role="tab" :aria-selected="ui.view === 'pattern'" data-view="pattern" @click="store.setUi({ view: 'pattern' })">Muster</button>
      <button type="button" role="tab" :aria-selected="ui.view === 'song'" data-view="song" @click="store.setUi({ view: 'song' })">Song</button>
      <button type="button" role="tab" :aria-selected="ui.view === 'sound'" data-view="sound" @click="store.setUi({ view: 'sound' })">Klang</button>
      <button type="button" role="tab" :aria-selected="ui.view === 'perform'" data-view="perform" @click="store.setUi({ view: 'perform' })">Live</button>
    </nav>

    <RecordingSheet v-if="take" :take="take" @close="discardTake" />

    <div v-if="helpOpen" class="help" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="sheet">
        <h2 id="help-title">Track303</h2>
        <p>Ein Acid-Tracker für den Daumen. Die Zeit läuft nach unten, jede Spalte ist eine Spur.</p>
        <ul>
          <li><b>Tippen</b> wählt eine Zeile. Die Tasten unten schreiben hinein und springen weiter.</li>
          <li><b>Doppelt tippen</b> setzt den zuletzt geschriebenen Wert der Spur.</li>
          <li><b>Nach links wischen</b> löscht.</li>
          <li><b>Spurkopf antippen</b> zeigt alle Spalten der Spur: Akzent <code>!</code>, Slide <code>~</code>, Chance und Wiederholungen.</li>
          <li><b>BPM</b> ziehst du mit dem Daumen hoch oder runter.</li>
          <li><b>Song</b> reiht Patterns aneinander: Tasten 1–8 schreiben, nach links wischen löscht, „ab hier“ spielt den Song von dort. Oben schaltest du Play zwischen <b>LOOP</b> (das gezeigte Pattern) und <b>SONG</b> um.</li>
          <li><b>Klang</b> hat die Regler der 303, Kits und Tonart.</li>
          <li><b>Live</b> ist zum Spielen: Im Feld ziehst du Cutoff (quer) und Resonanz (hoch), der DJ-Filter federt zurück, Mutes schalten am nächsten Takt, <b>Break</b> halten nimmt die Kick raus, loslassen bringt den Drop. <b>REC</b> nimmt auf, was du hörst; danach kannst du es anhören, speichern oder teilen.</li>
        </ul>
        <p>Alles wird bei jeder Änderung auf diesem Handy gespeichert. Diese Hilfe findest du wieder unter <b>⋯</b>.</p>
        <button type="button" class="primary" data-help-close @click="closeHelp">Los geht's</button>
      </div>
    </div>
  </div>
</template>
