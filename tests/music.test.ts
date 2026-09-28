import { describe, expect, it } from "vitest";
import { noteMidi, scaleNames, shiftDegree, trackerNote } from "../src/domain/music";

describe("noteMidi", () => {
  it("counts octave 2 from MIDI 36 like Kitty's acid line", () => {
    expect(noteMidi("C", "minor", 0, 2)).toBe(36);
    expect(noteMidi("A", "minor", 0, 2)).toBe(45);
    expect(noteMidi("A", "minor", 0, 3)).toBe(57);
  });

  it("locks every degree to the scale", () => {
    expect(Array.from({ length: 7 }, (_, degree) => noteMidi("A", "minor", degree, 2) - 45)).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(noteMidi("A", "phrygian", 1, 2) - 45).toBe(1);
    expect(noteMidi("A", "dorian", 5, 2) - 45).toBe(9);
  });

  it("clamps degree and octave instead of producing wild notes", () => {
    expect(noteMidi("C", "minor", 12, 9)).toBe(noteMidi("C", "minor", 6, 4));
    expect(noteMidi("C", "minor", -3, 0)).toBe(noteMidi("C", "minor", 0, 1));
  });
});

describe("trackerNote", () => {
  it("spells notes in three characters", () => {
    expect(trackerNote(45)).toBe("A-2");
    expect(trackerNote(49)).toBe("C#3");
    expect(trackerNote(36)).toBe("C-2");
    expect(trackerNote(60)).toBe("C-4");
  });
});

describe("scaleNames", () => {
  it("names the seven pads of the note pad", () => {
    expect(scaleNames("A", "minor")).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(scaleNames("E", "phrygian")).toEqual(["E", "F", "G", "A", "B", "C", "D"]);
    expect(scaleNames("F#", "minor")[0]).toBe("F#");
  });
});

describe("shiftDegree", () => {
  it("walks up the scale and carries into the next octave", () => {
    expect(shiftDegree(0, 2, 2)).toEqual({ degree: 2, octave: 2 });
    expect(shiftDegree(5, 2, 4)).toEqual({ degree: 2, octave: 3 });
    expect(shiftDegree(3, 2, 7)).toEqual({ degree: 3, octave: 3 });
  });

  it("stays on the note instead of leaving the four octaves", () => {
    expect(shiftDegree(4, 4, 7)).toEqual({ degree: 4, octave: 4 });
  });
});
