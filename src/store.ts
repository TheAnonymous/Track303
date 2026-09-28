import { shallowRef, type ShallowRef } from "vue";
import { createProject, emptyPattern, sanitizeProject } from "./domain/project";
import type { Cell, EditStep, Lane, Pattern, Project, RowCount } from "./domain/types";

const STORAGE_KEY = "track303.project.v1";
const BACKUP_KEY = "track303.project.v1.backup";
const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 1_200;

export type View = "pattern" | "sound";

export interface Cursor {
  lane: Lane;
  row: number;
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
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The project and what the screen shows of it. Every project change is an
 * undo step (a knob turn is one step, however many values it passes), saved
 * to local storage right away with the previous state as backup.
 */
export class Track303Store {
  readonly project: ShallowRef<Project>;
  readonly ui: ShallowRef<UiState>;
  readonly canUndo = shallowRef(false);
  readonly canRedo = shallowRef(false);
  readonly restoredFromBackup: boolean;
  private clipboard: Pattern | null = null;
  readonly hasClipboard = shallowRef(false);
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastMerge: { key: string; at: number } | null = null;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    const loaded = this.load();
    this.project = shallowRef(loaded.project);
    this.restoredFromBackup = loaded.fromBackup;
    this.ui = shallowRef<UiState>({ cursor: { lane: "acid", row: 0 }, focus: null, editStep: 1, view: "pattern", octave: 2, last: {} });
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

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(previous);
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project.value);
    this.lastMerge = null;
    this.commit(next);
    this.select(this.ui.value.cursor.lane, this.ui.value.cursor.row);
  }

  private commit(project: Project): void {
    this.project.value = project;
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
    this.save(project);
  }

  private save(project: Project): void {
    if (!this.storage) return;
    try {
      const current = this.storage.getItem(STORAGE_KEY);
      if (current) this.storage.setItem(BACKUP_KEY, current);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // Storage full or blocked: the session keeps working, it just is not saved.
    }
  }

  private load(): { project: Project; fromBackup: boolean } {
    for (const [key, fromBackup] of [[STORAGE_KEY, false], [BACKUP_KEY, true]] as const) {
      try {
        const raw = this.storage?.getItem(key);
        if (!raw) continue;
        const value = JSON.parse(raw) as unknown;
        if (typeof value === "object" && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 1) {
          return { project: sanitizeProject(value), fromBackup };
        }
      } catch {
        // Damaged JSON: fall through to the backup, then to a fresh project.
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
