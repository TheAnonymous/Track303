import { createProject } from "../domain/project";
import { AUTO_PARAMS, type AutoParam } from "../domain/automation";
import type { Fx, Lane, Project, Waveform } from "../domain/types";
import { LANES } from "../domain/types";
import { TrackerEngine } from "./engine";
import { soundContext, swapSound, useContext } from "klangwerk/tone";

export interface RenderMetrics {
  peak: number;
  rmsDb: number;
  /** Share of 10 ms windows louder than -60 dBFS. */
  activeShare: number;
  /** Mean sample-to-sample change over mean level: rises with the high frequencies (a brighter filter). */
  brightness: number;
  nonFinite: number;
}

export interface NodeCount {
  total: number;
  constantSources: number;
}

export interface RenderOptions {
  /** Holds the break for the whole render. */
  break?: boolean;
  /** Puts this effect on every cell of the lane. */
  fx?: Partial<Record<Lane, Fx>>;
  waveform?: Waveform;
  /** A filter ride holding these knob values on every row of the first pattern. */
  ride?: Partial<Record<AutoParam, number>>;
}

export interface Track303AudioTestApi {
  /** Renders the starter project, optionally with only some lanes, other knobs or a held break, for `seconds`. */
  render(lanes?: Lane[], seconds?: number, change?: Partial<Project["knobs"]>, perform?: RenderOptions): Promise<RenderMetrics>;
  countEngineNodes(): Promise<NodeCount>;
  /** Takes the sound away from the live app, as a phone call would. */
  interruptLiveAudio(): Promise<void>;
}

function metrics(buffer: AudioBuffer): RenderMetrics {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const window = Math.round(buffer.sampleRate * 0.01);
  let peak = 0;
  let sum = 0;
  let nonFinite = 0;
  let active = 0;
  let windows = 0;
  let change = 0;
  let level = 0;
  for (let start = 0; start < buffer.length; start += window) {
    let windowSum = 0;
    const end = Math.min(buffer.length, start + window);
    for (const data of channels) {
      for (let index = start; index < end; index += 1) {
        const sample = data[index]!;
        if (!Number.isFinite(sample)) {
          nonFinite += 1;
          continue;
        }
        peak = Math.max(peak, Math.abs(sample));
        windowSum += sample * sample;
        level += Math.abs(sample);
        if (index > 0) change += Math.abs(sample - (data[index - 1] ?? 0));
      }
    }
    sum += windowSum;
    const windowRms = Math.sqrt(windowSum / ((end - start) * channels.length));
    if (windowRms > 10 ** (-60 / 20)) active += 1;
    windows += 1;
  }
  const rms = Math.sqrt(sum / (buffer.length * channels.length));
  return { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity, activeShare: windows ? active / windows : 0, nonFinite, brightness: level > 0 ? change / level : 0 };
}

async function render(lanes: Lane[] = [...LANES], seconds = 4, change: Partial<Project["knobs"]> = {}, perform: RenderOptions = {}): Promise<RenderMetrics> {
  const project = createProject();
  project.knobs = { ...project.knobs, ...change };
  if (perform.waveform) project.waveform = perform.waveform;
  if (perform.ride) {
    const pattern = project.patterns[0]!;
    pattern.automation = Object.fromEntries(AUTO_PARAMS.flatMap((param) => {
      const value = perform.ride?.[param];
      return value === undefined ? [] : [[param, Array.from({ length: pattern.rows }, () => value)]];
    }));
  }
  for (const [lane, fx] of Object.entries(perform.fx ?? {}) as [Lane, Fx][]) {
    for (const cell of project.patterns[0]!.lanes[lane]) if (cell) cell.fx = { ...fx };
  }
  // Everything is scheduled before the render starts (as Tone.Offline did); the
  // engine lives in the offline context and is dropped with it.
  const context = new OfflineAudioContext(2, seconds * 44_100, 44_100);
  const previous = useContext(context);
  try {
    const engine = new TrackerEngine(project, { offline: true });
    for (const lane of LANES) engine.setMuted(lane, !lanes.includes(lane));
    await engine.start();
    if (perform.break) engine.setBreak(true);
    engine.renderUntil(seconds);
  } finally {
    swapSound(previous);
  }
  return metrics(await context.startRendering());
}

/**
 * Counts the native nodes a playing session creates. Chromium spends
 * audio-thread time on every connected node, which matters most on phones.
 */
async function countEngineNodes(): Promise<NodeCount> {
  const native = new OfflineAudioContext(2, 44_100, 44_100);
  const counts: Record<string, number> = {};
  for (const key of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (!key.startsWith("create") || key === "createBuffer" || key === "createPeriodicWave") continue;
    const create = (native as unknown as Record<string, (...args: unknown[]) => unknown>)[key]!.bind(native);
    (native as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      counts[key] = (counts[key] ?? 0) + 1;
      return create(...args);
    };
  }
  const previous = useContext(native);
  const engine = new TrackerEngine(createProject());
  try {
    await engine.prepare();
  } finally {
    engine.dispose();
    swapSound(previous);
  }
  return { total: Object.values(counts).reduce((sum, count) => sum + count, 0), constantSources: counts.createConstantSource ?? 0 };
}

export function installAudioTestApi(): void {
  window.__track303AudioTest = {
    render,
    countEngineNodes,
    interruptLiveAudio: () => (soundContext() as AudioContext).suspend(),
  };
  document.documentElement.dataset.audioTest = "ready";
}
