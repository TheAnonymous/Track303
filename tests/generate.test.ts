import { describe, expect, it } from "vitest";
import { randomAcidLine, randomDrums } from "../src/domain/generate";
import { sanitizeProject, createProject } from "../src/domain/project";
import type { Cell, NoteCell } from "../src/domain/types";

/** A small seeded generator, so every run rolls the same dice. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const notes = (line: Cell[]) => line.filter((cell): cell is NoteCell => cell?.kind === "note");

describe("randomAcidLine", () => {
  it("writes a playable line in the scale that starts on the root", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const line = randomAcidLine(16, seeded(seed));
      expect(line).toHaveLength(16);
      expect(line[0]).toMatchObject({ kind: "note", degree: 0, octave: 2 });
      const played = notes(line);
      expect(played.length).toBeGreaterThanOrEqual(6);
      for (const cell of played) {
        expect(cell.degree).toBeGreaterThanOrEqual(0);
        expect(cell.degree).toBeLessThanOrEqual(6);
        expect([1, 2, 3]).toContain(cell.octave);
      }
      line.forEach((cell, row) => {
        if (cell?.kind === "note" && cell.slide) expect(line[row - 1], `seed ${seed}: slide ${row} has a note before it`).toBeTruthy();
      });
    }
  });

  it("answers its first half, so the line sounds written", () => {
    let alike = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const line = randomAcidLine(16, seeded(seed));
      alike += line.slice(0, 8).filter((cell, row) => JSON.stringify(cell) === JSON.stringify(line[row + 8])).length;
    }
    expect(alike / (40 * 8)).toBeGreaterThan(0.45);
  });

  it("fills 32 rows and survives the sanitizer unchanged", () => {
    const project = createProject();
    project.patterns[0]!.rows = 32;
    project.patterns[0]!.lanes.acid = randomAcidLine(32, seeded(7));
    for (const lane of ["bd", "sd", "hh"] as const) project.patterns[0]!.lanes[lane] = Array.from({ length: 32 }, () => null);
    Object.assign(project.patterns[0]!.lanes, randomDrums(32, seeded(8)));
    expect(sanitizeProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
});

describe("randomDrums", () => {
  it("keeps four to the floor and the backbeat, and varies the hats", () => {
    const styles = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const { bd, sd, hh } = randomDrums(16, seeded(seed));
      for (const row of [0, 4, 8, 12]) expect(bd[row]).toMatchObject({ voice: "kick" });
      for (const row of [4, 12]) expect(["clap", "snare"]).toContain((sd[row] as { voice: string }).voice);
      expect(hh.filter(Boolean).length).toBeGreaterThanOrEqual(4);
      styles.add(hh.map((cell) => (cell ? "x" : ".")).join(""));
    }
    expect(styles.size, "the hats come out differently").toBeGreaterThan(3);
  });
});
