import type { DrumVoice } from "../sound/kitty-types";
import type { AcidKnobs, Cell, DrumCell, Fx, Lane, NoteCell, Pattern, Project, RowCount } from "./types";
import {
  ACID_VOICES,
  ACID_WAVEFORMS,
  CHANCES,
  FX_VALUES,
  KITS,
  LANE_FX,
  LANE_VOICES,
  LANES,
  MAX_SONG_LENGTH,
  MAX_SWING,
  MAX_TEMPO,
  MIN_TEMPO,
  OCTAVES,
  PATTERN_COUNT,
  RATCHETS,
  ROOT_NOTES,
  ROW_COUNTS,
  SCALES,
  SCHEMA_VERSION,
  WAVEFORMS,
} from "./types";

export const DEFAULT_KNOBS: AcidKnobs = { cutoff: 0.42, resonance: 0.62, envMod: 0.55, decay: 0.4, accent: 0.6, drive: 0.35, space: 0.25 };

export function drum(voice: DrumVoice, accent = false): DrumCell {
  return { kind: "drum", voice, accent, chance: 1, ratchet: 1 };
}

export function note(degree: number, octave = 2, options: { accent?: boolean; slide?: boolean } = {}): NoteCell {
  return { kind: "note", degree, octave, accent: options.accent ?? false, slide: options.slide ?? false, chance: 1, ratchet: 1 };
}

export function emptyPattern(rows: RowCount = 16): Pattern {
  return { rows, lanes: Object.fromEntries(LANES.map((lane) => [lane, Array.from({ length: rows }, () => null)])) as Record<Lane, Cell[]> };
}

/** A first acid groove to start from: four to the floor, claps, open hats and a squelchy line in A minor. */
export function starterPattern(): Pattern {
  const pattern = emptyPattern(16);
  for (const row of [0, 4, 8, 12]) pattern.lanes.bd[row] = drum("kick", row === 0);
  for (const row of [4, 12]) pattern.lanes.sd[row] = drum("clap");
  for (const row of [2, 6, 10, 14]) pattern.lanes.hh[row] = drum("openHat");
  for (const row of [1, 3, 5, 7, 9, 11, 13, 15]) pattern.lanes.hh[row] ??= drum("closedHat");
  const line: [number, number, number, boolean, boolean][] = [
    [0, 0, 2, true, false], [2, 0, 3, false, false], [3, 2, 2, false, true], [4, 4, 2, false, false],
    [6, 0, 2, true, false], [7, 6, 2, false, true], [8, 0, 3, false, false], [10, 3, 2, true, false],
    [11, 4, 2, false, true], [12, 0, 2, false, false], [14, 5, 2, true, true], [15, 4, 2, false, false],
  ];
  for (const [row, degree, octave, accent, slide] of line) pattern.lanes.acid[row] = note(degree, octave, { accent, slide });
  return pattern;
}

export function createProject(): Project {
  const patterns = Array.from({ length: PATTERN_COUNT }, () => emptyPattern());
  patterns[0] = starterPattern();
  return {
    schemaVersion: SCHEMA_VERSION,
    tempo: 136,
    swing: 0.06,
    root: "A",
    scale: "minor",
    kit: "warehouse",
    acidVoice: "silverbox",
    waveform: "sawtooth",
    knobs: { ...DEFAULT_KNOBS },
    volume: 0.85,
    patterns,
    activePattern: 0,
    song: [0],
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function unit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** An effect the lane offers, with a valid value; anything else is dropped. */
function sanitizeFx(value: unknown, lane: Lane): Fx | null {
  const source = record(value);
  const type = LANE_FX[lane].find((candidate) => candidate === source.type);
  const level = FX_VALUES.find((candidate) => candidate === source.value);
  return type && level ? { type, value: level } : null;
}

function sanitizeCell(value: unknown, lane: Lane): Cell {
  const source = record(value);
  if (value === null || typeof value !== "object") return null;
  const chance = pick(source.chance, CHANCES, 1);
  const ratchet = pick(source.ratchet, RATCHETS, 1);
  const accent = source.accent === true;
  const fx = sanitizeFx(source.fx, lane);
  let cell: DrumCell | NoteCell;
  if (lane === "acid") {
    if (source.kind !== "note") return null;
    const degree = typeof source.degree === "number" ? Math.max(0, Math.min(6, Math.round(source.degree))) : 0;
    cell = { kind: "note", degree, octave: pick(source.octave, OCTAVES, 2), accent, slide: source.slide === true, chance, ratchet };
  } else {
    const voices: readonly DrumVoice[] = LANE_VOICES[lane];
    if (source.kind !== "drum" || !voices.includes(source.voice as DrumVoice)) return null;
    cell = { kind: "drum", voice: source.voice as DrumVoice, accent, chance, ratchet };
  }
  if (fx) cell.fx = fx;
  return cell;
}

function sanitizePattern(value: unknown): Pattern {
  const source = record(value);
  const rows = pick(source.rows, ROW_COUNTS, 16);
  const lanes = record(source.lanes);
  return {
    rows,
    lanes: Object.fromEntries(LANES.map((lane) => {
      const cells = Array.isArray(lanes[lane]) ? (lanes[lane] as unknown[]) : [];
      return [lane, Array.from({ length: rows }, (_, row) => sanitizeCell(cells[row], lane))];
    })) as Record<Lane, Cell[]>,
  };
}

function sanitizeSong(value: unknown): number[] {
  const entries = Array.isArray(value) ? value : [];
  const song = entries
    .filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < PATTERN_COUNT)
    .slice(0, MAX_SONG_LENGTH);
  return song.length ? song : [0];
}

/** Any stored or imported value becomes a complete, valid project. */
export function sanitizeProject(value: unknown): Project {
  const source = record(value);
  const fallback = createProject();
  const knobs = record(source.knobs);
  const patterns = Array.isArray(source.patterns) ? source.patterns : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    tempo: typeof source.tempo === "number" && Number.isFinite(source.tempo) ? Math.round(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, source.tempo))) : fallback.tempo,
    swing: typeof source.swing === "number" && Number.isFinite(source.swing) ? Math.max(0, Math.min(MAX_SWING, source.swing)) : fallback.swing,
    root: pick(source.root, ROOT_NOTES, fallback.root),
    scale: pick(source.scale, SCALES, fallback.scale),
    kit: pick(source.kit, KITS, fallback.kit),
    acidVoice: pick(source.acidVoice, ACID_VOICES, fallback.acidVoice),
    waveform: pick(source.waveform, WAVEFORMS, ACID_WAVEFORMS[pick(source.acidVoice, ACID_VOICES, fallback.acidVoice)]),
    knobs: Object.fromEntries(Object.entries(DEFAULT_KNOBS).map(([key, value]) => [key, unit(knobs[key], value)])) as unknown as AcidKnobs,
    volume: unit(source.volume, fallback.volume),
    patterns: patterns
      ? Array.from({ length: PATTERN_COUNT }, (_, index) => sanitizePattern(patterns[index]))
      : fallback.patterns,
    activePattern: typeof source.activePattern === "number" ? Math.max(0, Math.min(PATTERN_COUNT - 1, Math.round(source.activePattern))) : 0,
    song: sanitizeSong(source.song),
  };
}
