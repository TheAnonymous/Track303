import { describe, expect, it } from "vitest";
import { automationAt, clearAutomation, hasAutomation, sanitizeAutomation, writeAutomation } from "../src/domain/automation";
import { createProject, emptyPattern, sanitizeProject } from "../src/domain/project";
import { Track303Store, type Storage } from "../src/store";

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

describe("filter ride data", () => {
  it("keeps valid rows fitted to the pattern and drops the rest", () => {
    expect(sanitizeAutomation({ cutoff: [0.5, 2, -1, "x", null, 0.333] }, 4)).toEqual({ cutoff: [0.5, 1, 0, null] });
    expect(sanitizeAutomation({ cutoff: [null, null], wobble: [1] }, 16)).toBeUndefined();
    expect(sanitizeAutomation("nope", 16)).toBeUndefined();
    const project = createProject();
    project.patterns[0]!.automation = { resonance: Array.from({ length: 16 }, (_, row) => (row % 2 ? null : 0.8)) };
    expect(sanitizeProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(sanitizeProject(createProject()).patterns[0]).not.toHaveProperty("automation");
  });

  it("writes, reads and clears rows", () => {
    const pattern = emptyPattern();
    expect(hasAutomation(pattern)).toBe(false);
    writeAutomation(pattern, 3, { cutoff: 0.9, decay: 0.2 });
    expect(automationAt(pattern, 3)).toEqual({ cutoff: 0.9, decay: 0.2 });
    expect(automationAt(pattern, 4)).toEqual({});
    expect(hasAutomation(pattern)).toBe(true);
    clearAutomation(pattern, 3, 3);
    expect(pattern).not.toHaveProperty("automation");
  });
});

describe("filter rides in the store", () => {
  it("records a gesture as one undo step and a second gesture as another", () => {
    const store = new Track303Store(new MemoryStorage());
    for (let row = 0; row < 4; row += 1) store.recordAutomation(0, row, { cutoff: 0.2 + row * 0.1 }, 1);
    store.recordAutomation(0, 8, { cutoff: 1 }, 2);
    expect(automationAt(store.pattern, 3)).toEqual({ cutoff: 0.5 });
    expect(store.project.value.knobs.cutoff, "the knob itself stays").toBe(0.42);
    store.undo();
    expect(automationAt(store.pattern, 8)).toEqual({});
    expect(automationAt(store.pattern, 3)).toEqual({ cutoff: 0.5 });
    store.undo();
    expect(hasAutomation(store.pattern)).toBe(false);
  });

  it("clears one row or the whole ride, and travels with length changes and block tools", () => {
    const store = new Track303Store(new MemoryStorage());
    for (let row = 0; row < 16; row += 1) store.recordAutomation(0, row, { cutoff: row / 16 }, 1);
    store.clearRide(5);
    expect(automationAt(store.pattern, 5)).toEqual({});
    store.setRows(32);
    expect(automationAt(store.pattern, 20)).toEqual({ cutoff: 0.25 });
    store.startSelection("acid", 0);
    store.extendSelection("acid", 3);
    store.shiftSelection(1);
    expect(automationAt(store.pattern, 0)).toEqual({ cutoff: 0.19 });
    store.copySelection();
    store.showPattern(1);
    store.startSelection("acid", 8);
    store.pasteBlock();
    expect(automationAt(store.pattern, 8)).toEqual({ cutoff: 0.19 });
    expect(automationAt(store.pattern, 9)).toEqual({ cutoff: 0 });
    store.clearSelectionCells();
    expect(hasAutomation(store.pattern)).toBe(false);
    store.showPattern(0);
    store.clearRide();
    expect(hasAutomation(store.pattern)).toBe(false);
  });
});
