import { describe, expect, it } from "vitest";
import { createProject, drum, emptyPattern, note } from "../src/domain/project";
import { cellCode, cellDescription, cellFlags, chanceCode, clock, EMPTY_CELL, hasDepth, ratchetCode, rowLabel, songSeconds, usedLanes } from "../src/format";

const key = { root: "A", scale: "minor" } as const;

describe("cell text", () => {
  it("shows drums as three letters and notes in tracker spelling", () => {
    expect(cellCode(null, key)).toBe(EMPTY_CELL);
    expect(cellCode(drum("kick"), key)).toBe("KCK");
    expect(cellCode(drum("openHat"), key)).toBe("OHH");
    expect(cellCode(note(2, 3), key)).toBe("C-4");
  });

  it("marks accent and slide the way the 303 does", () => {
    expect(cellFlags(note(0, 2, { accent: true, slide: true }))).toBe("!~");
    expect(cellFlags(drum("clap", true))).toBe("!");
    expect(cellFlags(null)).toBe("");
  });

  it("shows the deeper columns only when they are used", () => {
    const cell = { ...note(0), chance: 0.5, ratchet: 3 };
    expect(hasDepth(note(0))).toBe(false);
    expect(hasDepth(cell)).toBe(true);
    expect(chanceCode(cell)).toBe("50");
    expect(ratchetCode(cell)).toBe("×3");
    expect(chanceCode(note(0))).toBe("··");
  });

  it("describes cells in words", () => {
    expect(cellDescription("acid", 3, note(0, 2, { accent: true, slide: true }), key)).toBe("303 Zeile 03: A-2, Akzent, Slide");
    expect(cellDescription("bd", 0, null, key)).toBe("BD Zeile 00: leer");
    expect(rowLabel(15)).toBe("15");
  });
});

describe("song helpers", () => {
  it("adds up the song's length from its patterns at the project tempo", () => {
    const project = createProject();
    project.tempo = 120;
    project.patterns[1] = emptyPattern(32);
    project.song = [0, 1, 0];
    // 16 + 32 + 16 sixteenths at 120 BPM are eight seconds.
    expect(songSeconds(project)).toBe(8);
    expect(clock(65.9)).toBe("1:05");
  });

  it("names the lanes a pattern uses", () => {
    const project = createProject();
    expect(usedLanes(project.patterns[0])).toEqual(["bd", "sd", "hh", "acid"]);
    expect(usedLanes(project.patterns[1])).toEqual([]);
  });
});
