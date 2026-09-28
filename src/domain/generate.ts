import { drum, note } from "./project";
import type { Cell, DrumCell, NoteCell, RowCount } from "./types";

/** A random number in [0, 1); tests pass a seeded one. */
export type Random = () => number;

function weighted<T>(options: readonly (readonly [T, number])[], random: Random): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = random() * total;
  for (const [value, weight] of options) {
    pick -= weight;
    if (pick < 0) return value;
  }
  return options[options.length - 1]![0];
}

/** Scale degrees an acid line leans on: the root most, then fifth, third and seventh. */
const DEGREES = [[0, 36], [4, 15], [2, 13], [6, 10], [3, 9], [5, 9], [1, 8]] as const;
const OCTAVES = [[2, 68], [3, 27], [1, 5]] as const;

function acidNote(random: Random, first: boolean): NoteCell {
  const cell = note(first ? 0 : weighted(DEGREES, random), first ? 2 : weighted(OCTAVES, random));
  cell.accent = random() < 0.26;
  cell.slide = !first && random() < 0.22;
  return cell;
}

/** Half a bar of acid: the phrase the line keeps coming back to. */
function phrase(random: Random): Cell[] {
  return Array.from({ length: 8 }, (_, row): Cell => (row === 0 || random() < 0.68 ? acidNote(random, row === 0) : null));
}

/** The phrase again with about a third of its rows changed, so it answers rather than repeats. */
function answer(question: Cell[], random: Random): Cell[] {
  return question.map((cell, row): Cell => {
    if (row === 0 || random() >= 0.34) return cell ? { ...cell } : null;
    return random() < 0.75 ? acidNote(random, false) : null;
  });
}

/**
 * A 303 line in the project's scale, built like a written one: a phrase of
 * half a bar and its answer (twice over, with a new answer, for 32 rows).
 */
export function randomAcidLine(rows: RowCount, random: Random = Math.random): Cell[] {
  const question = phrase(random);
  const line = [...question, ...answer(question, random)];
  const full = rows === 32 ? [...line, ...question.map((cell) => (cell ? { ...cell } : null)), ...answer(question, random)] : line;
  // A slide needs a sounding note before it to glide from.
  return full.map((cell, row) => (cell?.kind === "note" && cell.slide && !full[row - 1] ? { ...cell, slide: false } : cell));
}

/** Techno drums: four to the floor, claps on two and four, hats that vary. */
export function randomDrums(rows: RowCount, random: Random = Math.random): { bd: Cell[]; sd: Cell[]; hh: Cell[] } {
  const bd: Cell[] = Array.from({ length: rows }, () => null);
  const sd: Cell[] = Array.from({ length: rows }, () => null);
  const hh: Cell[] = Array.from({ length: rows }, () => null);
  const clapVoice = weighted([["clap", 3], ["snare", 1]] as const, random);
  const hatStyle = weighted([["offbeat", 4], ["sixteenths", 3], ["gallop", 2]] as const, random);
  for (let row = 0; row < rows; row += 1) {
    const step = row % 16;
    if (step % 4 === 0) bd[row] = drum("kick", step === 0);
    else if ((step === 14 || step === 7) && random() < 0.18) bd[row] = { ...drum("kick"), fx: { type: "VL", value: 2 } } satisfies DrumCell;
    if (step === 4 || step === 12) sd[row] = drum(clapVoice);
    else if (random() < 0.07) sd[row] = { ...drum("snare"), fx: { type: "VL", value: 1 } } satisfies DrumCell;
    if (hatStyle === "offbeat") {
      if (step % 4 === 2) hh[row] = drum("openHat");
      else if (step % 2 === 1 && random() < 0.55) hh[row] = { ...drum("closedHat"), chance: random() < 0.3 ? 0.75 : 1 };
    } else if (hatStyle === "sixteenths") {
      hh[row] = step % 4 === 2 ? drum("closedHat", true) : drum("closedHat");
      if (step % 4 !== 2 && random() < 0.35) hh[row] = { ...drum("closedHat"), fx: { type: "VL", value: 2 } };
    } else if (step % 4 !== 1) {
      hh[row] = drum(step % 4 === 2 ? "openHat" : "closedHat");
    }
  }
  return { bd, sd, hh };
}
