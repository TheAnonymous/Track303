import { shallowRef, type ShallowRef } from "vue";
import { randomAcidLine, randomDrums, type Random } from "./domain/generate";
import { shiftDegree } from "./domain/music";
import { createProject, drum, emptyPattern, note, sanitizeProject } from "./domain/project";
import type { Cell, EditStep, Fx, Lane, Pattern, Project, RowCount } from "./domain/types";
import { LANE_VOICES, LANES, MAX_SONG_LENGTH } from "./domain/types";
import type { PlayMode } from "./sound/arrangement";

/** The single project saved before the project library existed; read once to migrate it. */
const LEGACY_KEY = "track303.project.v1";
const LIBRARY_KEY = "track303.library.v1";
const HISTORY_LIMIT = 100;
const NAME_LIMIT = 40;
export const FILE_FORMAT = "track303";

function projectKey(id: string): string {
  return `track303.project.${id}`;
}

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface ProjectEntry {
  id: string;
  name: string;
  updatedAt: number;
}
const MERGE_WINDOW_MS = 1_200;

export type View = "pattern" | "song" | "sound" | "perform";

export interface Cursor {
  lane: Lane;
  row: number;
}

/** A block of rows across one or more neighbouring lanes (indices into LANES), inclusive. */
export interface Selection {
  lanes: [number, number];
  rows: [number, number];
}

/** How "Füllen" spreads hits over the selected rows. */
export type FillShape = "all" | "2" | "4" | "offbeat" | "e3" | "e5" | "e7";

/** Euclidean rhythm: `hits` spread as evenly as possible over `length` steps (Bjorklund's result, rotated to start on a hit). */
export function euclid(hits: number, length: number): boolean[] {
  return Array.from({ length }, (_, step) => Math.floor(((step + 1) * hits) / length) !== Math.floor((step * hits) / length)).map((_, step, all) => all[(step + length - 1) % length]!);
}

function fillShape(shape: FillShape, length: number): boolean[] {
  switch (shape) {
    case "all": return Array.from({ length }, () => true);
    case "2": return Array.from({ length }, (_, step) => step % 2 === 0);
    case "4": return Array.from({ length }, (_, step) => step % 4 === 0);
    case "offbeat": return Array.from({ length }, (_, step) => step % 4 === 2);
    // Euclidean shapes repeat per half bar (3 and 5 of 8) or per bar (7 of 16).
    case "e3": return Array.from({ length }, (_, step) => euclid(3, 8)[step % 8]!);
    case "e5": return Array.from({ length }, (_, step) => euclid(5, 8)[step % 8]!);
    case "e7": return Array.from({ length }, (_, step) => euclid(7, 16)[step % 16]!);
  }
}

/** What a lane gets when nothing was entered there yet. */
export function laneDefault(lane: Lane, octave = 2): NonNullable<Cell> {
  return { bd: drum("kick"), sd: drum("clap"), hh: drum("closedHat"), acid: note(0, octave) }[lane];
}

export interface UiState {
  cursor: Cursor;
  /** A lane zoomed to full width with all its columns, or `null` for the four-lane overview. */
  focus: Lane | null;
  /** Rows the cursor moves on after entering a value (0 keeps it in place). */
  editStep: EditStep;
  view: View;
  /** Octave the note pad enters on the 303 lane. */
  octave: number;
  /** The last value entered per lane, repeated by a double tap. */
  last: Partial<Record<Lane, Cell>>;
  /** Selected song entry; `song.length` is the slot after the last one, where new entries go. */
  songCursor: number;
  playMode: PlayMode;
  /** What the thumb editor's pads enter: notes (or drum voices) or effects. */
  editorMode: "notes" | "fx";
  /** A marked block (long press, then tap the other corner), or `null`. */
  selection: Selection | null;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * The open project and what the screen shows of it, plus the library of all
 * projects on this phone. Every project change is an undo step (a knob turn
 * is one step, however many values it passes), saved to local storage right
 * away with the previous state as backup.
 */
export class Track303Store {
  readonly project: ShallowRef<Project>;
  readonly ui: ShallowRef<UiState>;
  readonly canUndo = shallowRef(false);
  readonly canRedo = shallowRef(false);
  readonly library = shallowRef<ProjectEntry[]>([]);
  readonly activeId = shallowRef("");
  restoredFromBackup: boolean;
  private clipboard: Pattern | null = null;
  readonly hasClipboard = shallowRef(false);
  /** Copied block: one column of cells per lane, left to right. */
  private block: { lanes: Lane[]; cells: Cell[][] } | null = null;
  readonly hasBlock = shallowRef(false);
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastMerge: { key: string; at: number } | null = null;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    const { library, active } = this.loadLibrary();
    this.library.value = library;
    this.activeId.value = active;
    const loaded = this.loadProject(active);
    this.project = shallowRef(loaded.project);
    this.restoredFromBackup = loaded.fromBackup;
    this.ui = shallowRef<UiState>({ cursor: { lane: "acid", row: 0 }, focus: null, editStep: 1, view: "pattern", octave: 2, last: {}, songCursor: 0, playMode: "loop", editorMode: "notes", selection: null });
    this.saveLibrary();
  }

  get activeEntry(): ProjectEntry {
    return this.library.value.find((entry) => entry.id === this.activeId.value) ?? { id: this.activeId.value, name: "Mein Track", updatedAt: Date.now() };
  }

  /** Switches to another saved project; undo starts afresh. */
  openProject(id: string): void {
    if (id === this.activeId.value || !this.library.value.some((entry) => entry.id === id)) return;
    const loaded = this.loadProject(id);
    this.activeId.value = id;
    this.restoredFromBackup = loaded.fromBackup;
    this.replaceProject(loaded.project);
    this.saveLibrary();
  }

  /** Starts a new project, from the starter groove or empty, and opens it. */
  createNewProject(kind: "starter" | "empty"): void {
    const project = createProject();
    if (kind === "empty") project.patterns[0] = emptyPattern();
    this.addProject(project, this.freshName("Track"));
  }

  duplicateProject(): void {
    this.addProject(structuredClone(this.project.value), `${this.activeEntry.name} (Kopie)`.slice(0, NAME_LIMIT));
  }

  renameProject(name: string): void {
    const clean = name.trim().slice(0, NAME_LIMIT) || this.activeEntry.name;
    this.library.value = this.library.value.map((entry) => entry.id === this.activeId.value ? { ...entry, name: clean } : entry);
    this.saveLibrary();
  }

  /** Removes a project for good; the library keeps at least one. */
  deleteProject(id: string): void {
    const rest = this.library.value.filter((entry) => entry.id !== id);
    if (!rest.length || rest.length === this.library.value.length) return;
    if (id === this.activeId.value) {
      const next = [...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0]!;
      const loaded = this.loadProject(next.id);
      this.activeId.value = next.id;
      this.replaceProject(loaded.project);
    }
    this.library.value = rest;
    this.saveLibrary();
    try {
      this.storage?.removeItem?.(projectKey(id));
      this.storage?.removeItem?.(`${projectKey(id)}.backup`);
    } catch {
      // Left-over data only costs space.
    }
  }

  /** The open project as a file: its name and a JSON document other phones can open. */
  exportProject(): { fileName: string; json: string } {
    const name = this.activeEntry.name;
    const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";
    return {
      fileName: `${slug}.track303.json`,
      json: JSON.stringify({ format: FILE_FORMAT, version: 1, name, project: this.project.value }, null, 1),
    };
  }

  /** Opens a project file (or a bare saved project) as a new project; throws a readable error otherwise. */
  importProject(text: string, fileName = ""): void {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Die Datei ist kein Track303-Projekt.");
    }
    const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const wrapped = source.format === FILE_FORMAT && typeof source.project === "object" && source.project !== null;
    const raw = wrapped ? source.project : value;
    if (typeof raw !== "object" || raw === null || (raw as { schemaVersion?: unknown }).schemaVersion !== 1) {
      throw new Error("Die Datei ist kein Track303-Projekt.");
    }
    const fromFile = fileName.replace(/\.track303\.json$|\.json$/i, "").trim();
    const name = typeof source.name === "string" && source.name.trim() ? source.name : fromFile || this.freshName("Track");
    this.addProject(sanitizeProject(raw), name.slice(0, NAME_LIMIT));
  }

  get pattern() {
    const project = this.project.value;
    return project.patterns[project.activePattern]!;
  }

  /** Applies `change` to a copy of the project; returns whether anything changed. */
  edit(change: (project: Project) => void, mergeKey?: string): boolean {
    const before = this.project.value;
    const next = structuredClone(before);
    change(next);
    const clean = sanitizeProject(next);
    if (JSON.stringify(clean) === JSON.stringify(before)) return false;
    const now = Date.now();
    const merged = mergeKey !== undefined && this.lastMerge?.key === mergeKey && now - this.lastMerge.at < MERGE_WINDOW_MS;
    this.lastMerge = mergeKey === undefined ? null : { key: mergeKey, at: now };
    if (!merged) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.commit(clean);
    return true;
  }

  setUi(change: Partial<UiState>): void {
    this.ui.value = { ...this.ui.value, ...change };
  }

  select(lane: Lane, row: number): void {
    const rows = this.pattern.rows;
    this.setUi({ cursor: { lane, row: ((row % rows) + rows) % rows } });
  }

  /** Writes a value into the cursor cell, remembers it and moves on by the edit step. */
  enter(cell: Cell): void {
    const { cursor } = this.ui.value;
    this.edit((project) => {
      project.patterns[project.activePattern]!.lanes[cursor.lane][cursor.row] = cell;
    });
    this.setUi({ last: { ...this.ui.value.last, [cursor.lane]: cell } });
    this.advance();
  }

  /** Changes the cell under the cursor in place (accent, slide, chance, …). */
  modify(change: (cell: NonNullable<Cell>) => void, mergeKey?: string): void {
    const { cursor } = this.ui.value;
    this.edit((project) => {
      const cell = project.patterns[project.activePattern]!.lanes[cursor.lane][cursor.row];
      if (cell) change(cell);
    }, mergeKey);
  }

  /** Sets or changes the effect of the cell under the cursor; `null` removes it. */
  setFx(fx: Fx | null): void {
    this.modify((cell) => {
      if (fx) cell.fx = { ...fx };
      else delete cell.fx;
    });
  }

  clear(lane = this.ui.value.cursor.lane, row = this.ui.value.cursor.row): void {
    this.edit((project) => {
      project.patterns[project.activePattern]!.lanes[lane][row] = null;
    });
  }

  advance(): void {
    const { cursor, editStep } = this.ui.value;
    if (editStep > 0) this.select(cursor.lane, cursor.row + editStep);
  }

  /** Shows another pattern. Not an undo step of its own; undo returns to where a change was made. */
  showPattern(index: number): void {
    const project = this.project.value;
    if (index === project.activePattern || index < 0 || index >= project.patterns.length) return;
    this.commit({ ...project, activePattern: index });
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
    this.clearSelection();
  }

  copyPattern(): void {
    this.clipboard = structuredClone(this.pattern);
    this.hasClipboard.value = true;
  }

  pastePattern(): void {
    const clipboard = this.clipboard;
    if (!clipboard) return;
    this.edit((project) => {
      project.patterns[project.activePattern] = structuredClone(clipboard);
    });
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
  }

  clearPattern(): void {
    this.edit((project) => {
      project.patterns[project.activePattern] = emptyPattern(project.patterns[project.activePattern]!.rows);
    });
  }

  /** Starts marking a block at one cell (a long press). */
  startSelection(lane: Lane, row: number): void {
    const index = LANES.indexOf(lane);
    this.select(lane, row);
    this.setUi({ selection: { lanes: [index, index], rows: [row, row] } });
  }

  /** Moves the block's other corner to this cell. */
  extendSelection(lane: Lane, row: number): void {
    const selection = this.ui.value.selection;
    if (!selection) return this.startSelection(lane, row);
    const anchor = { lane: this.ui.value.cursor.lane, row: this.ui.value.cursor.row };
    const lanes = [LANES.indexOf(anchor.lane), LANES.indexOf(lane)].sort((a, b) => a - b) as [number, number];
    const rows = [anchor.row, row].sort((a, b) => a - b) as [number, number];
    this.setUi({ selection: { lanes, rows } });
  }

  /** Widens the block to every row of the pattern. */
  selectAllRows(): void {
    const selection = this.ui.value.selection;
    if (selection) this.setUi({ selection: { lanes: selection.lanes, rows: [0, this.pattern.rows - 1] } });
  }

  clearSelection(): void {
    this.setUi({ selection: null });
  }

  get selectedLanes(): Lane[] {
    const selection = this.ui.value.selection;
    return selection ? LANES.slice(selection.lanes[0], selection.lanes[1] + 1) : [];
  }

  copySelection(): void {
    const selection = this.ui.value.selection;
    if (!selection) return;
    const [from, to] = selection.rows;
    this.block = { lanes: this.selectedLanes, cells: this.selectedLanes.map((lane) => structuredClone(this.pattern.lanes[lane].slice(from, to + 1))) };
    this.hasBlock.value = true;
  }

  /** Pastes the copied block with its top left corner at the selection (or the cursor); cells a lane cannot play are left out. */
  pasteBlock(): void {
    const block = this.block;
    if (!block) return;
    const selection = this.ui.value.selection;
    const startLane = selection ? selection.lanes[0] : LANES.indexOf(this.ui.value.cursor.lane);
    const startRow = selection ? selection.rows[0] : this.ui.value.cursor.row;
    this.edit((project) => {
      const pattern = project.patterns[project.activePattern]!;
      block.cells.forEach((column, offset) => {
        const lane = LANES[startLane + offset];
        if (!lane) return;
        column.forEach((cell, row) => {
          if (startRow + row < pattern.rows && (!cell || (cell.kind === "note") === (lane === "acid"))) pattern.lanes[lane][startRow + row] = structuredClone(cell);
        });
      });
    });
    // The pasted block stays marked, ready to be shifted or transposed.
    const endLane = Math.min(LANES.length - 1, startLane + block.lanes.length - 1);
    const endRow = Math.min(this.pattern.rows - 1, startRow + (block.cells[0]?.length ?? 1) - 1);
    this.setUi({ selection: { lanes: [startLane, endLane], rows: [startRow, endRow] } });
  }

  clearSelectionCells(): void {
    this.editSelection((cells) => cells.map(() => null));
  }

  /** Moves the 303 notes in the block by scale steps (7 is an octave). */
  transposeSelection(steps: number): void {
    this.editSelection((cells) => cells.map((cell) => (cell?.kind === "note" ? { ...cell, ...shiftDegree(cell.degree, cell.octave, steps) } : cell)));
  }

  /** Rotates the block's rows by one: -1 moves everything up, 1 down, the edge row wraps around. */
  shiftSelection(direction: -1 | 1): void {
    this.editSelection((cells) => (direction === 1 ? [cells[cells.length - 1]!, ...cells.slice(0, -1)] : [...cells.slice(1), cells[0]!]));
  }

  /** Writes each lane's last value (or its default) on the rows the shape picks, and clears the others. */
  fillSelection(shape: FillShape): void {
    const hits = fillShape(shape, (this.ui.value.selection?.rows[1] ?? 0) - (this.ui.value.selection?.rows[0] ?? 0) + 1);
    this.editSelection((cells, lane) => cells.map((_, index) => (hits[index] ? structuredClone(this.ui.value.last[lane] ?? laneDefault(lane, this.ui.value.octave)) : null)));
  }

  /** Changes one cell by a thumb drag (`gesture` numbers it: one undo step per drag). */
  nudgeCell(lane: Lane, row: number, steps: number, gesture = 0): void {
    this.edit((project) => {
      const cells = project.patterns[project.activePattern]!.lanes[lane];
      const cell = cells[row];
      if (!cell) return;
      if (cell.kind === "note") Object.assign(cell, shiftDegree(cell.degree, cell.octave, steps));
      else if (lane !== "acid") {
        const voices = LANE_VOICES[lane] as readonly string[];
        const index = voices.indexOf(cell.voice);
        cell.voice = voices[(((index + steps) % voices.length) + voices.length) % voices.length] as typeof cell.voice;
      }
    }, `nudge:${gesture}:${lane}:${row}`);
  }

  private editSelection(change: (cells: Cell[], lane: Lane) => Cell[]): void {
    const selection = this.ui.value.selection;
    if (!selection) return;
    const [from, to] = selection.rows;
    const lanes = this.selectedLanes;
    this.edit((project) => {
      const pattern = project.patterns[project.activePattern]!;
      for (const lane of lanes) {
        const updated = change(pattern.lanes[lane].slice(from, to + 1), lane);
        pattern.lanes[lane].splice(from, updated.length, ...updated);
      }
    });
  }

  /** A new random 303 line for the shown pattern; one undo step brings the old one back. */
  rollAcidLine(random: Random = Math.random): void {
    this.edit((project) => {
      const pattern = project.patterns[project.activePattern]!;
      pattern.lanes.acid = randomAcidLine(pattern.rows, random);
    });
  }

  /** New random drums (kick, clap/snare, hats) for the shown pattern. */
  rollDrums(random: Random = Math.random): void {
    this.edit((project) => {
      const pattern = project.patterns[project.activePattern]!;
      Object.assign(pattern.lanes, randomDrums(pattern.rows, random));
    });
  }

  /** Changes the pattern length; 16 to 32 repeats the first half, 32 to 16 keeps the first half. */
  setRows(rows: RowCount): void {
    this.edit((project) => {
      const pattern = project.patterns[project.activePattern]!;
      for (const cells of Object.values(pattern.lanes)) {
        const source = [...cells];
        cells.length = 0;
        for (let row = 0; row < rows; row += 1) cells.push(structuredClone(source[row % source.length] ?? null));
      }
      pattern.rows = rows;
    });
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
  }

  selectSong(index: number): void {
    this.setUi({ songCursor: Math.max(0, Math.min(this.project.value.song.length, Math.round(index))) });
  }

  /** Writes a pattern into the selected song entry (or appends it at the end) and moves on. */
  songWrite(pattern: number): void {
    const index = this.ui.value.songCursor;
    const changed = this.edit((project) => {
      if (index < project.song.length) project.song[index] = pattern;
      else if (project.song.length < MAX_SONG_LENGTH) project.song.push(pattern);
    });
    if (changed || index < this.project.value.song.length) this.selectSong(index + 1);
  }

  /** Repeats the selected entry right after it (the last one, at the end slot). */
  songInsert(): void {
    const song = this.project.value.song;
    if (song.length >= MAX_SONG_LENGTH) return;
    const index = Math.min(this.ui.value.songCursor, song.length - 1);
    this.edit((project) => { project.song.splice(index + 1, 0, project.song[index]!); });
    this.selectSong(index + 1);
  }

  /** Removes a song entry; the song keeps at least one. */
  songDelete(index = this.ui.value.songCursor): void {
    if (this.project.value.song.length <= 1 || index >= this.project.value.song.length) return;
    this.edit((project) => { project.song.splice(index, 1); });
    this.selectSong(Math.min(this.ui.value.songCursor, this.project.value.song.length - 1));
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(previous);
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
    this.selectSong(this.ui.value.songCursor);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(next);
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
    this.selectSong(this.ui.value.songCursor);
  }

  private commit(project: Project): void {
    this.project.value = project;
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
    this.save(project);
  }

  /** Shows another project with a fresh history and cursor. */
  private replaceProject(project: Project): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastMerge = null;
    this.project.value = project;
    this.canUndo.value = false;
    this.canRedo.value = false;
    this.setUi({ cursor: { lane: "acid", row: 0 }, focus: null, songCursor: 0, editorMode: "notes", last: {}, selection: null });
  }

  private addProject(project: Project, name: string): void {
    const id = newId();
    this.write(projectKey(id), JSON.stringify(project));
    this.library.value = [...this.library.value, { id, name, updatedAt: Date.now() }];
    this.activeId.value = id;
    this.restoredFromBackup = false;
    this.replaceProject(project);
    this.saveLibrary();
  }

  private freshName(base: string): string {
    const names = new Set(this.library.value.map((entry) => entry.name));
    let number = this.library.value.length + 1;
    while (names.has(`${base} ${number}`)) number += 1;
    return `${base} ${number}`;
  }

  private save(project: Project): void {
    const key = projectKey(this.activeId.value);
    try {
      const current = this.storage?.getItem(key);
      if (current) this.write(`${key}.backup`, current);
    } catch {
      // Unreadable storage: the save below reports nothing either.
    }
    this.write(key, JSON.stringify(project));
    this.library.value = this.library.value.map((entry) => entry.id === this.activeId.value ? { ...entry, updatedAt: Date.now() } : entry);
    this.saveLibrary();
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Storage full or blocked: the session keeps working, it just is not saved.
    }
  }

  private saveLibrary(): void {
    this.write(LIBRARY_KEY, JSON.stringify({ active: this.activeId.value, projects: this.library.value }));
  }

  private read(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  }

  /** The saved library; the pre-library single project becomes its first entry. */
  private loadLibrary(): { library: ProjectEntry[]; active: string } {
    const saved = this.read(LIBRARY_KEY) as { active?: unknown; projects?: unknown } | null;
    const projects = Array.isArray(saved?.projects)
      ? (saved.projects as unknown[]).flatMap((entry) => {
          const source = entry as Partial<ProjectEntry> | null;
          return source && typeof source.id === "string" && source.id.startsWith("p-") && typeof source.name === "string"
            ? [{ id: source.id, name: source.name.slice(0, NAME_LIMIT) || "Track", updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : 0 }]
            : [];
        })
      : [];
    if (projects.length) {
      const active = projects.some((entry) => entry.id === saved?.active) ? (saved!.active as string) : projects[0]!.id;
      return { library: projects, active };
    }
    const id = newId();
    const legacy = this.read(LEGACY_KEY) ?? this.read(`${LEGACY_KEY}.backup`);
    if (legacy) this.write(projectKey(id), JSON.stringify(legacy));
    return { library: [{ id, name: "Mein Track", updatedAt: Date.now() }], active: id };
  }

  private loadProject(id: string): { project: Project; fromBackup: boolean } {
    for (const [key, fromBackup] of [[projectKey(id), false], [`${projectKey(id)}.backup`, true]] as const) {
      const value = this.read(key);
      if (typeof value === "object" && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 1) {
        return { project: sanitizeProject(value), fromBackup };
      }
    }
    return { project: createProject(), fromBackup: false };
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
