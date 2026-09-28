import type { DrumVoice, SoundPresetMap } from "../sound/kitty-types";

export const SCHEMA_VERSION = 1 as const;
export const LANES = ["bd", "sd", "hh", "acid"] as const;
export const PATTERN_COUNT = 8;
/** Entries in the song list: patterns in playing order. */
export const MAX_SONG_LENGTH = 64;
export const ROW_COUNTS = [16, 32] as const;
export const MIN_TEMPO = 90;
export const MAX_TEMPO = 180;
export const MAX_SWING = 0.35;
export const ROOT_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const SCALES = ["minor", "phrygian", "dorian"] as const;
/** How likely a row plays on each pass. */
export const CHANCES = [1, 0.75, 0.5, 0.25] as const;
/** Fast repeats a row splits into. */
export const RATCHETS = [1, 2, 3, 4] as const;
export const OCTAVES = [1, 2, 3, 4] as const;
export const EDIT_STEPS = [0, 1, 2, 4] as const;
export const KITS = ["warehouse", "steel", "rumble"] as const satisfies readonly SoundPresetMap["drums"][];
export const ACID_VOICES = ["silverbox", "venom", "rubber"] as const satisfies readonly SoundPresetMap["acid"][];

/** Which drum voices each drum lane can play. */
export const LANE_VOICES = {
  bd: ["kick"],
  sd: ["snare", "clap", "tom"],
  hh: ["closedHat", "openHat"],
} as const satisfies Record<Exclude<Lane, "acid">, readonly DrumVoice[]>;

export type Lane = (typeof LANES)[number];
export type DrumLane = Exclude<Lane, "acid">;
export type RowCount = (typeof ROW_COUNTS)[number];
export type RootNote = (typeof ROOT_NOTES)[number];
export type Scale = (typeof SCALES)[number];
export type Kit = (typeof KITS)[number];
export type AcidVoice = (typeof ACID_VOICES)[number];
export type EditStep = (typeof EDIT_STEPS)[number];

export interface DrumCell {
  kind: "drum";
  voice: DrumVoice;
  accent: boolean;
  chance: number;
  ratchet: number;
}

export interface NoteCell {
  kind: "note";
  /** Position in the scale, 0–6. */
  degree: number;
  octave: number;
  accent: boolean;
  slide: boolean;
  chance: number;
  ratchet: number;
}

export type Cell = DrumCell | NoteCell | null;

export interface Pattern {
  rows: RowCount;
  lanes: Record<Lane, Cell[]>;
}

/** The TB-303's own controls, 0–1 each, plus the room around it. */
export interface AcidKnobs {
  cutoff: number;
  resonance: number;
  envMod: number;
  decay: number;
  accent: number;
  drive: number;
  space: number;
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  tempo: number;
  swing: number;
  root: RootNote;
  scale: Scale;
  kit: Kit;
  acidVoice: AcidVoice;
  knobs: AcidKnobs;
  volume: number;
  patterns: Pattern[];
  activePattern: number;
  /** The song: pattern indices in playing order, at least one. */
  song: number[];
}
