/*
 * The sound vocabulary shared with Kitty: its track kinds, presets and step
 * shape, which the sound modules copied from Kitty (lean voices, channel
 * strips, presets) are written against. Track303's own model lives in ../domain.
 */

export const TRACK_KINDS = ["drums", "acid", "stab", "rave", "texture"] as const;
export const DYNAMICS = ["ghost", "normal", "accent"] as const;
export const STEP_LENGTHS = ["short", "normal", "long"] as const;
export const DRUM_VOICES = ["kick", "snare", "clap", "closedHat", "openHat", "tom"] as const;
export const SOUND_PRESETS = {
  drums: ["warehouse", "steel", "rumble"],
  acid: ["silverbox", "venom", "rubber"],
  stab: ["concrete", "chord", "flash"],
  rave: ["hoover", "pulse", "siren"],
  texture: ["noise", "drone", "riser"],
} as const;

export type TrackKind = (typeof TRACK_KINDS)[number];
export type StepDynamics = (typeof DYNAMICS)[number];
export type StepLength = (typeof STEP_LENGTHS)[number];
export type DrumVoice = (typeof DRUM_VOICES)[number];
export type SoundPresetId = (typeof SOUND_PRESETS)[TrackKind][number];
export type SoundPresetMap = { [K in TrackKind]: (typeof SOUND_PRESETS)[K][number] };

export interface Step {
  enabled: boolean;
  drumVoices: DrumVoice[];
  degree: number;
  octave: number;
  dynamics: StepDynamics;
  length: StepLength;
  slide: boolean;
}

export interface TrackMacros {
  color: number;
  pressure: number;
  space: number;
  motion: number;
  density: number;
}
