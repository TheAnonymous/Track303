import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, drum, note } from "../src/domain/project";
import { Track303Store, type Storage } from "../src/store";

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Track303Store", () => {
  it("starts from the starter project", () => {
    const store = new Track303Store(storage);
    expect(store.project.value).toEqual(createProject());
    expect(store.canUndo.value).toBe(false);
  });

  it("writes at the cursor, remembers the value and moves on by the edit step", () => {
    const store = new Track303Store(storage);
    store.showPattern(1);
    store.select("acid", 0);
    store.enter(note(4, 3));
    expect(store.pattern.lanes.acid[0]).toEqual(note(4, 3));
    expect(store.ui.value.cursor).toEqual({ lane: "acid", row: 1 });
    expect(store.ui.value.last.acid).toEqual(note(4, 3));
    store.setUi({ editStep: 4 });
    store.enter(note(1));
    expect(store.ui.value.cursor.row).toBe(5);
    store.setUi({ editStep: 0 });
    store.enter(note(2));
    expect(store.ui.value.cursor.row).toBe(5);
  });

  it("wraps the cursor around the pattern", () => {
    const store = new Track303Store(storage);
    store.select("bd", -1);
    expect(store.ui.value.cursor.row).toBe(15);
    store.select("bd", 16);
    expect(store.ui.value.cursor.row).toBe(0);
  });

  it("undoes and redoes edits", () => {
    const store = new Track303Store(storage);
    store.select("sd", 1);
    store.enter(drum("snare"));
    store.select("sd", 1);
    store.modify((cell) => { cell.accent = true; });
    expect(store.pattern.lanes.sd[1]).toEqual(drum("snare", true));
    store.undo();
    expect(store.pattern.lanes.sd[1]).toEqual(drum("snare"));
    store.undo();
    expect(store.pattern.lanes.sd[1]).toBeNull();
    expect(store.canUndo.value).toBe(false);
    store.redo();
    store.redo();
    expect(store.pattern.lanes.sd[1]).toEqual(drum("snare", true));
    expect(store.canRedo.value).toBe(false);
  });

  it("makes one undo step of a knob turn", () => {
    vi.useFakeTimers();
    const store = new Track303Store(storage);
    for (const cutoff of [0.5, 0.6, 0.7, 0.8]) {
      store.edit((project) => { project.knobs.cutoff = cutoff; }, "knob:cutoff");
      vi.advanceTimersByTime(100);
    }
    store.undo();
    expect(store.project.value.knobs.cutoff).toBe(createProject().knobs.cutoff);
    store.edit((project) => { project.knobs.cutoff = 0.9; }, "knob:cutoff");
    vi.advanceTimersByTime(2_000);
    store.edit((project) => { project.knobs.cutoff = 0.1; }, "knob:cutoff");
    store.undo();
    expect(store.project.value.knobs.cutoff).toBe(0.9);
  });

  it("ignores edits that change nothing", () => {
    const store = new Track303Store(storage);
    expect(store.edit(() => undefined)).toBe(false);
    store.select("bd", 1);
    store.clear();
    expect(store.canUndo.value).toBe(false);
  });

  it("switches patterns without an undo step, and undo returns to where the change was", () => {
    const store = new Track303Store(storage);
    store.select("bd", 2);
    store.enter(drum("kick"));
    store.showPattern(3);
    expect(store.project.value.activePattern).toBe(3);
    store.undo();
    expect(store.project.value.activePattern).toBe(0);
    expect(store.pattern.lanes.bd[2]).toBeNull();
  });

  it("saves every change and loads it again", () => {
    const store = new Track303Store(storage);
    store.select("acid", 1);
    store.enter(note(6, 1, { accent: true }));
    const again = new Track303Store(storage);
    expect(again.project.value).toEqual(store.project.value);
    expect(again.restoredFromBackup).toBe(false);
  });

  it("falls back to the previous save when the last one is damaged", () => {
    const store = new Track303Store(storage);
    store.edit((project) => { project.tempo = 140; });
    store.edit((project) => { project.tempo = 150; });
    storage.setItem("track303.project.v1", "{broken");
    const again = new Track303Store(storage);
    expect(again.project.value.tempo).toBe(140);
    expect(again.restoredFromBackup).toBe(true);
  });

  it("keeps working when storage fails", () => {
    const failing: Storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    const store = new Track303Store(failing);
    store.edit((project) => { project.tempo = 150; });
    expect(store.project.value.tempo).toBe(150);
  });

  it("copies, pastes and clears patterns", () => {
    const store = new Track303Store(storage);
    store.copyPattern();
    store.showPattern(2);
    store.pastePattern();
    expect(store.pattern).toEqual(store.project.value.patterns[0]);
    store.clearPattern();
    expect(store.pattern.lanes.bd.every((cell) => cell === null)).toBe(true);
    expect(store.project.value.patterns[0]!.lanes.bd[0]).not.toBeNull();
  });

  it("doubles a pattern to 32 rows by repeating it, and halves it again", () => {
    const store = new Track303Store(storage);
    const original = structuredClone(store.pattern);
    store.setRows(32);
    expect(store.pattern.rows).toBe(32);
    expect(store.pattern.lanes.acid.slice(16)).toEqual(original.lanes.acid);
    store.select("acid", 31);
    store.setRows(16);
    expect(store.pattern).toEqual(original);
    expect(store.ui.value.cursor.row).toBe(15);
  });
});
