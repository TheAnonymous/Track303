import type { RootNote, Scale } from "./types";
import { ROOT_NOTES } from "./types";

const SCALE_OFFSETS: Record<Scale, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

export const SCALE_LABELS: Record<Scale, string> = { minor: "Moll", phrygian: "Phrygisch", dorian: "Dorisch" };
export const ROOT_LABELS: Record<RootNote, string> = Object.fromEntries(ROOT_NOTES.map((note) => [note, note.replace("#", "♯")])) as Record<RootNote, string>;

/** MIDI note of a scale position, as Kitty's acid line counts: octave 2 starts at MIDI 36. */
export function noteMidi(root: RootNote, scale: Scale, degree: number, octave: number): number {
  const offsets = SCALE_OFFSETS[scale];
  const position = Math.max(0, Math.min(6, Math.round(degree)));
  return 12 + Math.max(1, Math.min(4, Math.round(octave))) * 12 + ROOT_NOTES.indexOf(root) + (offsets[position] ?? 0);
}

/** Tracker spelling in three characters: "A-2", "C#3". */
export function trackerNote(midi: number): string {
  const name = ROOT_NOTES[((Math.round(midi) % 12) + 12) % 12] ?? "C";
  return `${name.length === 1 ? `${name}-` : name}${Math.floor(Math.round(midi) / 12) - 1}`;
}

/** Note names of the seven scale positions in one octave, for the note pad. */
export function scaleNames(root: RootNote, scale: Scale): string[] {
  return SCALE_OFFSETS[scale].map((_, degree) => trackerNote(noteMidi(root, scale, degree, 2)).slice(0, 2).replace("-", ""));
}
