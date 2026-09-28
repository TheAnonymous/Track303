import * as Tone from "tone";
import type { AcidKnobs, AcidVoice, Kit } from "../domain/types";
import type { DrumVoice } from "./kitty-types";
import { CharacterSaturator } from "./graph";
import { LeanFilter, SleepyOutput } from "./lean";
import { LeanEnvelope, LeanTone, OneShotTone, type BasicWave } from "./lean-voices";
import { performanceOffsetSeconds } from "./polish";
import { presetDefinition } from "./sound-presets";

/*
 * The drum kit and the 303, adapted from Kitty's drum and acid banks: the same
 * lean voices and recipes, driven by tracker rows instead of Kitty's steps,
 * and the 303 by its own five knobs instead of Kitty's macros.
 */

const SLEEP_MARGIN_SECONDS = 0.5;
/** The cutoff knob's range above the preset's base (cutoff 0 sits an octave below it). */
const CUTOFF_OCTAVES = 5;
/** Time constant of live knob moves: fast enough to follow a thumb, slow enough not to click. */
const KNOB_SMOOTHING_SECONDS = 0.012;
/** Longest drum decay (sub tail 0.68 s + release 0.32 s) plus margin. */
const DRUM_TAIL_SECONDS = 1.5;

export interface DrumKit {
  trigger(voice: DrumVoice, time: number, velocity: number, long?: boolean): void;
  release(time: number): void;
  dispose(): void;
}

export interface Acid303 {
  /** One note; `glide` slides from the sounding note, `hold` keeps it sounding into the next row. */
  trigger(midi: number, time: number, options: { accent: boolean; glide: boolean; hold: boolean; seconds: number; velocity: number; filterKick?: number }): void;
  /** Cutoff and resonance move at once; the other knobs shape the next note. */
  setKnobs(knobs: AcidKnobs): void;
  release(time: number): void;
  dispose(): void;
}

export function createDrumKit(preset: Kit, destination: Tone.ToneAudioNode, alwaysAwake: boolean): DrumKit {
  const definition = presetDefinition("drums", preset);
  const recipe = definition.synthesis;
  const output = new Tone.Gain(definition.level);
  const sleep = new SleepyOutput(output, destination, alwaysAwake);
  const panScale = preset === "steel" ? 2.15 : preset === "rumble" ? 0.42 : 1;
  const strip = (filter: LeanFilter, pan: number) => {
    const panner = new Tone.Panner(pan * panScale).connect(output);
    filter.connect(panner);
    return panner;
  };
  const snareFilter = new LeanFilter({ type: "highpass", frequency: recipe.snare.highpass, rolloff: -12 });
  const clapFilter = new LeanFilter({ type: "highpass", frequency: recipe.clap.highpass, rolloff: -24 });
  const closedHatFilter = new LeanFilter({ type: "highpass", frequency: recipe.hats.closedHighpass, rolloff: -24 });
  const openHatFilter = new LeanFilter({ type: "highpass", frequency: recipe.hats.openHighpass, rolloff: -24 });
  const tomFilter = new LeanFilter({ type: "lowpass", frequency: recipe.tom.lowpass, rolloff: -12 });
  const panners = [strip(snareFilter, -0.08), strip(clapFilter, 0.17), strip(closedHatFilter, -0.23), strip(openHatFilter, 0.27), strip(tomFilter, -0.12)];
  const kick = new OneShotTone({ kind: "basic", type: recipe.kick.oscillator as BasicWave }, {
    pitch: { octaves: recipe.kick.octaves, pitchDecay: recipe.kick.pitchDecay },
    envelope: { ...definition.envelope, sustain: 0.01, attackCurve: "exponential" },
  }).connect(output);
  const snareBody = new OneShotTone({ kind: "basic", type: "triangle" }, {
    pitch: { octaves: 2.6, pitchDecay: 0.022 },
    envelope: { attack: 0.001, decay: recipe.snare.bodyDecay, sustain: 0, release: 0.09, attackCurve: "exponential" },
  }).connect(snareFilter);
  const tom = new OneShotTone({ kind: "basic", type: "triangle" }, {
    pitch: { octaves: 2.4, pitchDecay: 0.032 },
    envelope: { attack: 0.001, decay: recipe.tom.decay, sustain: 0, release: 0.13, attackCurve: "exponential" },
  }).connect(tomFilter);
  // One shared noise source feeds independent envelopes, as in Kitty.
  const noise = new Tone.Noise(recipe.snare.noise).start();
  const snareNoise = new LeanEnvelope({ attack: 0.001, decay: recipe.snare.decay, sustain: 0, release: 0.07 }).connect(snareFilter);
  const clapNoises = Array.from({ length: 3 }, () => new LeanEnvelope({ attack: 0.001, decay: recipe.clap.decay, sustain: 0, release: 0.04 }).connect(clapFilter));
  const closedHat = new LeanEnvelope({ attack: 0.001, decay: recipe.hats.closedDecay, sustain: 0, release: Math.max(0.025, recipe.hats.closedDecay * 0.45) }).connect(closedHatFilter);
  const openHat = new LeanEnvelope({ attack: 0.001, decay: recipe.hats.openDecay, sustain: 0, release: Math.max(0.025, recipe.hats.openDecay * 0.45) }).connect(openHatFilter);
  noise.fan(snareNoise, ...clapNoises, closedHat, openHat);
  // A click on top of the kick keeps it audible on phone speakers, which cannot play its body.
  const transient = new LeanEnvelope({ attack: 0.0005, decay: 0.018, sustain: 0, release: 0.012 }).connect(output);
  noise.connect(transient);
  const transientLevel = Math.max(recipe.kick.transient, 0.18);
  const subTail = recipe.kick.subTail;
  const subChain = subTail
    ? (() => {
        const highpass = new LeanFilter({ type: "highpass", frequency: 40, rolloff: -24 });
        const lowpass = new LeanFilter({ type: "lowpass", frequency: subTail.cutoff, rolloff: -24 });
        const saturator = new CharacterSaturator("density");
        highpass.chain(lowpass, saturator, output);
        saturator.setAmount(0.19, 0.001);
        const voice = new OneShotTone({ kind: "basic", type: "triangle" }, {
          pitch: { octaves: 1.6, pitchDecay: 0.018 },
          envelope: { attack: 0.003, decay: subTail.decay, sustain: 0, release: subTail.release, attackCurve: "exponential" },
        }).connect(highpass);
        return { voice, nodes: [voice, highpass, lowpass, saturator] as Tone.ToneAudioNode[] };
      })()
    : null;
  const hertz = (note: Tone.Unit.Frequency) => Tone.Frequency(note).toFrequency();
  const seconds = (time: Tone.Unit.Time) => Tone.Time(time).toSeconds();
  const nodes: Tone.ToneAudioNode[] = [kick, snareBody, tom, noise, snareNoise, ...clapNoises, closedHat, openHat, transient, snareFilter, clapFilter, closedHatFilter, openHatFilter, tomFilter, ...panners, output, ...(subChain?.nodes ?? [])];
  return {
    trigger: (voice, time, velocity, long = false) => {
      sleep.wake(time, time + DRUM_TAIL_SECONDS);
      const at = time + performanceOffsetSeconds("drums", voice);
      if (voice === "kick") {
        kick.triggerAttackRelease(hertz(recipe.kick.note), seconds(long ? "8n" : "16n"), at, velocity * recipe.kick.velocity);
        transient.triggerAttackRelease(0.018, at, velocity * transientLevel);
        if (subChain && subTail) subChain.voice.triggerAttackRelease(hertz(subTail.note), subTail.decay, at + 0.018, velocity * subTail.level);
      } else if (voice === "snare") {
        snareNoise.triggerAttackRelease(recipe.snare.decay, at, velocity * recipe.snare.noiseLevel);
        snareBody.triggerAttackRelease(hertz(recipe.snare.bodyNote), seconds("32n"), at, velocity * recipe.snare.bodyLevel);
      } else if (voice === "clap") {
        [0, recipe.clap.spacing, recipe.clap.spacing * 2].forEach((offset, index) => clapNoises[index]!.triggerAttackRelease(recipe.clap.decay, at + offset, velocity * recipe.clap.level * (1 - index * 0.14)));
      } else if (voice === "closedHat") {
        closedHat.triggerAttackRelease(seconds("32n"), at, velocity * recipe.hats.level);
      } else if (voice === "openHat") {
        openHat.triggerAttackRelease(seconds("8n"), at, velocity * recipe.hats.level * 0.82);
      } else {
        tom.triggerAttackRelease(hertz(recipe.tom.note), seconds("8n"), at, velocity * recipe.tom.level);
      }
    },
    release: (time) => {
      [kick, snareBody, tom, snareNoise, ...clapNoises, transient, closedHat, openHat, subChain?.voice].forEach((voice) => voice?.triggerRelease(time));
    },
    dispose: () => {
      sleep.dispose();
      nodes.forEach((node) => node.dispose());
    },
  };
}

export function createAcid303(preset: AcidVoice, knobs: AcidKnobs, destination: Tone.ToneAudioNode, alwaysAwake: boolean): Acid303 {
  const definition = presetDefinition("acid", preset);
  const recipe = definition.synthesis;
  const output = new Tone.Gain(definition.level);
  const sleep = new SleepyOutput(output, destination, alwaysAwake);
  const amp = new LeanEnvelope(definition.envelope).connect(output);
  const drive = new CharacterSaturator(definition.channel.saturationCurve);
  drive.connect(amp);
  const filter = new LeanFilter({ type: "lowpass", frequency: recipe.filterBase, Q: recipe.filterQ, rolloff: -24 }).connect(drive);
  // The envelope sweeps up from the cutoff-0 frequency; the cutoff knob itself
  // shifts the whole filter through detune, so it moves continuously and at
  // once, also in the middle of a note.
  const reference = recipe.filterBase / 2;
  const envelope = new Tone.FrequencyEnvelope({
    attack: 0.002,
    decay: recipe.filterDecay,
    sustain: recipe.filterSustain,
    release: definition.envelope.release,
    baseFrequency: reference,
    octaves: recipe.filterOctaves,
    exponent: 2.35,
  });
  filter.modulateFrequency(envelope);
  const oscillator = new LeanTone(output.context, { kind: "basic", type: recipe.oscillator }, 110).start(output.context.currentTime);
  oscillator.output.connect(filter.input);
  let current = knobs;
  let sounding = false;

  /** Cutoff and resonance follow the knobs right away, between notes too. */
  const follow = (next: AcidKnobs, timeConstant: number) => {
    const now = output.context.currentTime;
    filter.detune.cancelAndHoldAtTime(now);
    filter.detune.setTargetAtTime(next.cutoff * CUTOFF_OCTAVES * 1200, now, timeConstant);
    filter.Q.cancelAndHoldAtTime(now);
    filter.Q.setTargetAtTime(1.2 + next.resonance * (definition.effects.resonanceBase + definition.effects.resonancePressure), now, timeConstant);
  };
  follow(knobs, 0.001);

  /** Env mod, decay, accent and drive shape each note as it starts. */
  /** `filterKick` (0–3, the FL effect) opens the envelope further for this note only. */
  const shape = (accent: boolean, time: number, filterKick: number) => {
    const accentAmount = accent ? current.accent : 0;
    const base = reference * 2 ** (current.cutoff * CUTOFF_OCTAVES);
    const octaves = recipe.filterOctaves * (0.25 + current.envMod * 1.25) * (1 + (recipe.accent.filterBoost - 1) * accentAmount * 2) * (1 + filterKick * 0.3);
    envelope.octaves = Math.max(0.2, Math.min(octaves, Math.log2(16_000 / base)));
    envelope.decay = recipe.filterDecay * 2 ** ((current.decay - 0.5) * 3) * (accent ? recipe.accent.decayMultiplier : 1);
    drive.setAmount(0.02 + current.drive * 0.42 + accentAmount * recipe.accent.saturationBoost, 0.012, time);
  };

  return {
    trigger: (midi, time, options) => {
      sleep.wake(time, time + options.seconds + definition.envelope.release + SLEEP_MARGIN_SECONDS);
      const frequency = Tone.Frequency(midi, "midi").toFrequency();
      oscillator.frequency.cancelAndHoldAtTime(time);
      if (options.glide && sounding) oscillator.frequency.exponentialRampToValueAtTime(frequency, time + recipe.slidePortamento);
      else oscillator.frequency.setValueAtTime(frequency, time);
      shape(options.accent, time, options.filterKick ?? 0);
      if (!options.glide || !sounding) {
        const boost = options.accent ? 1 + (recipe.accent.velocityBoost - 1) + current.accent * 0.25 : 1;
        amp.triggerAttack(time, Math.min(1, options.velocity * boost));
        envelope.triggerAttack(time, options.accent ? 1 : 0.86);
        sounding = true;
      }
      if (!options.hold) {
        amp.triggerRelease(time + options.seconds);
        envelope.triggerRelease(time + options.seconds);
        sounding = false;
      }
    },
    setKnobs: (knobs) => {
      const moved = knobs.cutoff !== current.cutoff || knobs.resonance !== current.resonance;
      current = knobs;
      if (moved) follow(knobs, KNOB_SMOOTHING_SECONDS);
    },
    release: (time) => {
      amp.triggerRelease(time);
      envelope.triggerRelease(time);
      sounding = false;
    },
    dispose: () => {
      sleep.dispose();
      oscillator.stop(output.context.currentTime);
      oscillator.dispose();
      [envelope, filter, drive, amp, output].forEach((node) => node.dispose());
    },
  };
}
