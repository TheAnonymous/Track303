import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, drum, note } from "../src/domain/project";
import { euclid, Track303Store, type Storage } from "../src/store";

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
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
    storage.setItem(`track303.project.${store.activeId.value}`, "{broken");
    const again = new Track303Store(storage);
    expect(again.project.value.tempo).toBe(140);
    expect(again.restoredFromBackup).toBe(true);
  });

  it("moves the project saved before the library into it as 'Mein Track'", () => {
    const old = createProject();
    old.tempo = 128;
    storage.setItem("track303.project.v1", JSON.stringify(old));
    const store = new Track303Store(storage);
    expect(store.library.value.map((entry) => entry.name)).toEqual(["Mein Track"]);
    expect(store.project.value.tempo).toBe(128);
    store.edit((project) => { project.tempo = 129; });
    expect(new Track303Store(storage).project.value.tempo, "saved under the library from now on").toBe(129);
  });

  it("keeps several projects: new, duplicate, rename, open, delete", () => {
    const store = new Track303Store(storage);
    const first = store.activeId.value;
    store.edit((project) => { project.tempo = 150; });
    store.createNewProject("empty");
    expect(store.library.value).toHaveLength(2);
    expect(store.activeEntry.name).toBe("Track 2");
    expect(store.project.value.patterns[0]!.lanes.bd.every((cell) => cell === null)).toBe(true);
    expect(store.canUndo.value, "a fresh history per project").toBe(false);
    store.renameProject("  Acid Nacht  ");
    expect(store.activeEntry.name).toBe("Acid Nacht");
    store.duplicateProject();
    expect(store.activeEntry.name).toBe("Acid Nacht (Kopie)");
    store.openProject(first);
    expect(store.project.value.tempo).toBe(150);

    const again = new Track303Store(storage);
    expect(again.activeId.value, "the open project is remembered").toBe(first);
    expect(again.library.value.map((entry) => entry.name)).toEqual(["Mein Track", "Acid Nacht", "Acid Nacht (Kopie)"]);

    again.deleteProject(first);
    expect(again.library.value).toHaveLength(2);
    expect(again.activeId.value).not.toBe(first);
    expect(storage.getItem(`track303.project.${first}`)).toBeNull();
    for (const entry of [...again.library.value]) again.deleteProject(entry.id);
    expect(again.library.value, "the last project stays").toHaveLength(1);
  });

  it("exports the open project as a file and imports it again as a new one", () => {
    const store = new Track303Store(storage);
    store.renameProject("Säure Tanz");
    store.edit((project) => { project.tempo = 144; });
    const file = store.exportProject();
    expect(file.fileName).toBe("saure-tanz.track303.json");
    expect(JSON.parse(file.json)).toMatchObject({ format: "track303", version: 1, name: "Säure Tanz", project: { tempo: 144 } });

    const other = new Track303Store(new MemoryStorage());
    other.importProject(file.json, file.fileName);
    expect(other.library.value).toHaveLength(2);
    expect(other.activeEntry.name).toBe("Säure Tanz");
    expect(other.project.value.tempo).toBe(144);
    other.importProject(JSON.stringify(createProject()), "roh.json");
    expect(other.activeEntry.name).toBe("roh");
    expect(() => other.importProject("{nope", "x.json")).toThrow("kein Track303-Projekt");
    expect(() => other.importProject(JSON.stringify({ hello: 1 }), "x.json")).toThrow("kein Track303-Projekt");
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

  it("writes, appends, repeats and deletes song entries", () => {
    const store = new Track303Store(storage);
    expect(store.project.value.song).toEqual([0]);
    store.selectSong(1);
    store.songWrite(1);
    store.songWrite(2);
    expect(store.project.value.song).toEqual([0, 1, 2]);
    expect(store.ui.value.songCursor).toBe(3);
    store.selectSong(1);
    store.songWrite(4);
    expect(store.project.value.song).toEqual([0, 4, 2]);
    expect(store.ui.value.songCursor).toBe(2);
    store.songInsert();
    expect(store.project.value.song).toEqual([0, 4, 2, 2]);
    expect(store.ui.value.songCursor).toBe(3);
    store.songDelete(0);
    expect(store.project.value.song).toEqual([4, 2, 2]);
    store.undo();
    expect(store.project.value.song).toEqual([0, 4, 2, 2]);
    store.selectSong(99);
    expect(store.ui.value.songCursor).toBe(4);
  });

  it("keeps at least one song entry and at most the limit", () => {
    const store = new Track303Store(storage);
    store.songDelete(0);
    expect(store.project.value.song).toEqual([0]);
    for (let index = 0; index < 80; index += 1) store.songInsert();
    expect(store.project.value.song).toHaveLength(64);
    store.selectSong(64);
    store.songWrite(3);
    expect(store.project.value.song).toHaveLength(64);
  });

  it("sets, changes and removes a row's effect, and a new note keeps it", () => {
    const store = new Track303Store(storage);
    store.select("acid", 0);
    store.setFx({ type: "EC", value: 2 });
    expect(store.pattern.lanes.acid[0]).toMatchObject({ fx: { type: "EC", value: 2 } });
    store.setFx({ type: "EC", value: 3 });
    expect(store.pattern.lanes.acid[0]?.fx).toEqual({ type: "EC", value: 3 });
    store.setFx(null);
    expect(store.pattern.lanes.acid[0]).not.toHaveProperty("fx");
    store.undo();
    expect(store.pattern.lanes.acid[0]?.fx).toEqual({ type: "EC", value: 3 });
    store.select("acid", 1);
    store.setFx({ type: "GT", value: 1 });
    expect(store.pattern.lanes.acid[1], "an empty row takes no effect").toBeNull();
  });

  it("marks a block by long press and a second tap, in any direction", () => {
    const store = new Track303Store(storage);
    store.startSelection("acid", 6);
    expect(store.ui.value.selection).toEqual({ lanes: [3, 3], rows: [6, 6] });
    store.extendSelection("sd", 2);
    expect(store.ui.value.selection).toEqual({ lanes: [1, 3], rows: [2, 6] });
    expect(store.selectedLanes).toEqual(["sd", "hh", "acid"]);
    store.selectAllRows();
    expect(store.ui.value.selection?.rows).toEqual([0, 15]);
    store.showPattern(1);
    expect(store.ui.value.selection, "another pattern drops the block").toBeNull();
  });

  it("copies a block and pastes it elsewhere, leaving out what a lane cannot play", () => {
    const store = new Track303Store(storage);
    store.startSelection("hh", 0);
    store.extendSelection("acid", 3);
    store.copySelection();
    store.showPattern(1);
    store.startSelection("sd", 8);
    store.pasteBlock();
    const lanes = store.pattern.lanes;
    expect(lanes.sd.slice(8, 12), "hats do not fit the snare lane").toEqual([null, null, null, null]);
    expect(lanes.hh.slice(8, 12), "the 303 line does not fit the hats").toEqual([null, null, null, null]);
    store.startSelection("hh", 8);
    store.pasteBlock();
    expect(store.ui.value.selection, "the pasted block stays marked").toEqual({ lanes: [2, 3], rows: [8, 11] });
    expect(store.pattern.lanes.hh.slice(8, 12)).toEqual(store.project.value.patterns[0]!.lanes.hh.slice(0, 4));
    expect(store.pattern.lanes.acid.slice(8, 12)).toEqual(store.project.value.patterns[0]!.lanes.acid.slice(0, 4));
    store.undo();
    expect(store.pattern.lanes.acid.slice(8, 12), "a paste is one undo step").toEqual([null, null, null, null]);
  });

  it("transposes notes in the scale, shifts rows around and clears a block", () => {
    const store = new Track303Store(storage);
    store.startSelection("acid", 0);
    store.extendSelection("acid", 3);
    store.transposeSelection(1);
    expect(store.pattern.lanes.acid[0]).toMatchObject({ degree: 1, octave: 2 });
    expect(store.pattern.lanes.acid[3]).toMatchObject({ degree: 3, octave: 2 });
    store.transposeSelection(7);
    expect(store.pattern.lanes.acid[0]).toMatchObject({ degree: 1, octave: 3 });
    const before = store.pattern.lanes.acid.slice(0, 4);
    store.shiftSelection(1);
    expect(store.pattern.lanes.acid.slice(0, 4)).toEqual([before[3], before[0], before[1], before[2]]);
    store.shiftSelection(-1);
    expect(store.pattern.lanes.acid.slice(0, 4)).toEqual(before);
    store.clearSelectionCells();
    expect(store.pattern.lanes.acid.slice(0, 4)).toEqual([null, null, null, null]);
    expect(store.pattern.lanes.acid[4], "outside the block stays").not.toBeNull();
  });

  it("fills with the lane's last value in straight and euclidean shapes", () => {
    expect(euclid(3, 8)).toEqual([true, false, false, true, false, false, true, false]);
    expect(euclid(5, 8).filter(Boolean)).toHaveLength(5);
    expect(euclid(7, 16).filter(Boolean)).toHaveLength(7);
    const store = new Track303Store(storage);
    store.showPattern(1);
    store.startSelection("hh", 0);
    store.extendSelection("hh", 15);
    store.fillSelection("2");
    const hats = (store.pattern.lanes.hh as ({ voice: string } | null)[]).map((cell) => cell?.voice ?? ".");
    expect(hats.filter((voice) => voice === "closedHat")).toHaveLength(8);
    expect(hats[1]).toBe(".");
    store.select("hh", 0);
    store.enter({ kind: "drum", voice: "openHat", accent: false, chance: 1, ratchet: 1 });
    store.startSelection("hh", 0);
    store.extendSelection("hh", 7);
    store.fillSelection("e3");
    expect(store.pattern.lanes.hh.slice(0, 8).map((cell) => (cell ? "x" : "."))).toEqual(["x", ".", ".", "x", ".", ".", "x", "."]);
    expect(store.pattern.lanes.hh[0]).toMatchObject({ voice: "openHat" });
  });

  it("nudges a note through the scale and a drum through its voices, as one undo step per drag", () => {
    const store = new Track303Store(storage);
    store.nudgeCell("acid", 0, 1, 1);
    store.nudgeCell("acid", 0, 1, 1);
    expect(store.pattern.lanes.acid[0]).toMatchObject({ degree: 2 });
    store.nudgeCell("acid", 0, 1, 2);
    store.undo();
    expect(store.pattern.lanes.acid[0], "a second drag is its own step").toMatchObject({ degree: 2 });
    store.undo();
    expect(store.pattern.lanes.acid[0]).toMatchObject({ degree: 0 });
    store.nudgeCell("sd", 4, 1);
    expect(store.pattern.lanes.sd[4]).toMatchObject({ voice: "tom" });
    store.nudgeCell("sd", 4, 1);
    expect(store.pattern.lanes.sd[4]).toMatchObject({ voice: "snare" });
    store.nudgeCell("bd", 1, 1);
    expect(store.pattern.lanes.bd[1], "an empty row stays empty").toBeNull();
  });
});
