import type { DrumVoice, SoundPresetMap, Step, StepLength, TrackKind } from "./kitty-types";

export interface TrackChannelRecipe {
  highpass: number;
  eq: { low: number; mid: number; high: number; lowFrequency: number; highFrequency: number };
  compressor: { attack: number; release: number };
  delayTime: string;
  reverb: { decay: number; preDelay: number };
  duckDb: number;
}

export const TRACK_CHANNEL_RECIPES: Record<TrackKind, TrackChannelRecipe> = {
  drums: {
    highpass: 24,
    eq: { low: 1.25, mid: -0.6, high: 0.35, lowFrequency: 105, highFrequency: 6_800 },
    compressor: { attack: 0.012, release: 0.105 },
    delayTime: "16n",
    reverb: { decay: 0.72, preDelay: 0.008 },
    duckDb: 0,
  },
  acid: {
    highpass: 32,
    eq: { low: 0.7, mid: 1.1, high: -0.45, lowFrequency: 115, highFrequency: 4_800 },
    compressor: { attack: 0.008, release: 0.09 },
    delayTime: "8n",
    reverb: { decay: 1.15, preDelay: 0.014 },
    duckDb: -4.5,
  },
  stab: {
    highpass: 118,
    eq: { low: -1.8, mid: 0.9, high: 0.5, lowFrequency: 180, highFrequency: 5_600 },
    compressor: { attack: 0.006, release: 0.13 },
    delayTime: "8n.",
    reverb: { decay: 1.65, preDelay: 0.019 },
    duckDb: -6,
  },
  rave: {
    highpass: 96,
    eq: { low: -1.2, mid: 0.7, high: 0.65, lowFrequency: 165, highFrequency: 5_900 },
    compressor: { attack: 0.009, release: 0.15 },
    delayTime: "8n",
    reverb: { decay: 1.9, preDelay: 0.024 },
    duckDb: -5,
  },
  texture: {
    highpass: 138,
    eq: { low: -2.2, mid: -0.2, high: 1.1, lowFrequency: 210, highFrequency: 6_400 },
    compressor: { attack: 0.018, release: 0.24 },
    delayTime: "4n",
    reverb: { decay: 3.4, preDelay: 0.032 },
    duckDb: -3.5,
  },
};

export const TRACK_TIMING_OFFSETS_MS: Record<Exclude<TrackKind, "drums">, number> = {
  acid: 0,
  stab: 5,
  rave: 2,
  texture: 8,
};

export const DRUM_TIMING_OFFSETS_MS: Record<DrumVoice, number> = {
  kick: 0,
  snare: 8,
  clap: 8,
  closedHat: 3,
  openHat: 6,
  tom: 5,
};

export const DUCK_ATTACK_SECONDS = 0.004;
export const DUCK_HOLD_SECONDS = 0.012;

export interface DuckEnvelope {
  gain: number;
  attack: number;
  hold: number;
  release: number;
  end: number;
}

export function duckEnvelope(track: TrackKind, tempo: number): DuckEnvelope {
  const release = 30 / clamp(tempo, 40, 300);
  const duckDb = TRACK_CHANNEL_RECIPES[track].duckDb;
  return {
    gain: dbToGain(duckDb),
    attack: DUCK_ATTACK_SECONDS,
    hold: DUCK_HOLD_SECONDS,
    release,
    end: DUCK_ATTACK_SECONDS + DUCK_HOLD_SECONDS + release,
  };
}

/** Persisted 0..1 values stay untouched; only their audible interpretation changes. */
export function faderGain(value: number): number {
  const safe = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  return safe * safe;
}

export function dbMeterValue(db: number): number {
  return clamp((finite(db, -60) + 60) / 60, 0, 1);
}

export function rmsToDb(rms: number): number {
  return rms > 0 && Number.isFinite(rms) ? Math.max(-120, 20 * Math.log10(rms)) : -120;
}

export function positionalVelocity(bar: number, step: number): number {
  const position = Math.max(0, Math.round(bar)) * 16 + Math.max(0, Math.round(step));
  const cycle = [-0.04, 0.02, -0.01, 0.05, -0.025, 0.01, -0.055, 0.035] as const;
  return 1 + cycle[position % cycle.length]!;
}

export function performanceOffsetSeconds(track: TrackKind, drumVoice?: DrumVoice): number {
  const milliseconds = track === "drums"
    ? DRUM_TIMING_OFFSETS_MS[drumVoice ?? "kick"]
    : TRACK_TIMING_OFFSETS_MS[track];
  return milliseconds / 1_000;
}

export function riserDurationSeconds(length: StepLength, tempo: number): number {
  const beat = 60 / clamp(tempo, 40, 300);
  return length === "short" ? beat : length === "long" ? beat * 4 : beat * 2;
}

export function stepDurationSeconds(length: StepLength, tempo: number): number {
  const sixteenth = 15 / clamp(tempo, 40, 300);
  return length === "short" ? sixteenth * 0.5 : length === "long" ? sixteenth * 2 : sixteenth;
}

export interface AcidLegatoContext {
  legato: boolean;
  continues: boolean;
}

export function acidLegatoContext(
  bars: readonly { steps: readonly Step[] }[],
  bar: number,
  step: number,
  loopSteps = bars.length * 16,
): AcidLegatoContext {
  const currentIndex = bar * 16 + step;
  const current = stepAt(bars, currentIndex);
  const previous = currentIndex > 0 ? stepAt(bars, currentIndex - 1) : undefined;
  const next = currentIndex < Math.min(loopSteps, bars.length * 16) - 1 ? stepAt(bars, currentIndex + 1) : undefined;
  return {
    legato: Boolean(current?.enabled && current.slide && previous?.enabled),
    continues: Boolean(current?.enabled && next?.enabled && next.slide),
  };
}

export function stabVoicing(preset: SoundPresetMap["stab"], closeTriad: readonly number[]): number[] {
  const root = closeTriad[0];
  const third = closeTriad[1];
  const fifth = closeTriad[2];
  if (root === undefined || third === undefined || fifth === undefined) return [...closeTriad];
  if (preset === "chord") return [root, fifth, third + 12, root + 24];
  return [root, third, fifth];
}

function stepAt(bars: readonly { steps: readonly Step[] }[], index: number): Step | undefined {
  const bar = Math.floor(index / 16);
  return bars[bar]?.steps[index % 16];
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
