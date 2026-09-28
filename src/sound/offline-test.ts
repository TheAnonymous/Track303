import * as Tone from "tone";
import { createProject } from "../domain/project";
import type { Lane, Project } from "../domain/types";
import { LANES } from "../domain/types";
import { TrackerEngine } from "./engine";

export interface RenderMetrics {
  peak: number;
  rmsDb: number;
  /** Share of 10 ms windows louder than -60 dBFS. */
  activeShare: number;
  nonFinite: number;
}

export interface NodeCount {
  total: number;
  constantSources: number;
}

export interface Track303AudioTestApi {
  /** Renders the starter project, optionally with only some lanes, for `seconds`. */
  render(lanes?: Lane[], seconds?: number, change?: Partial<Project["knobs"]>): Promise<RenderMetrics>;
  countEngineNodes(): Promise<NodeCount>;
}

function metrics(buffer: Tone.ToneAudioBuffer): RenderMetrics {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const window = Math.round(buffer.sampleRate * 0.01);
  let peak = 0;
  let sum = 0;
  let nonFinite = 0;
  let active = 0;
  let windows = 0;
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
      }
    }
    sum += windowSum;
    const windowRms = Math.sqrt(windowSum / ((end - start) * channels.length));
    if (windowRms > 10 ** (-60 / 20)) active += 1;
    windows += 1;
  }
  const rms = Math.sqrt(sum / (buffer.length * channels.length));
  return { peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity, activeShare: windows ? active / windows : 0, nonFinite };
}

async function render(lanes: Lane[] = [...LANES], seconds = 4, change: Partial<Project["knobs"]> = {}): Promise<RenderMetrics> {
  const project = createProject();
  project.knobs = { ...project.knobs, ...change };
  // The engine lives in the offline context and is dropped with it; disposing it
  // afterwards would reach for the live context's transport.
  const buffer = await Tone.Offline(async () => {
    const engine = new TrackerEngine(project);
    for (const lane of LANES) engine.setMuted(lane, !lanes.includes(lane));
    await engine.start();
  }, seconds, 2, 44_100);
  return metrics(buffer);
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
  const original = Tone.getContext();
  Tone.setContext(new Tone.OfflineContext(native as never));
  const engine = new TrackerEngine(createProject());
  try {
    await engine.prepare();
  } finally {
    engine.dispose();
    Tone.setContext(original);
  }
  return { total: Object.values(counts).reduce((sum, count) => sum + count, 0), constantSources: counts.createConstantSource ?? 0 };
}

export function installAudioTestApi(): void {
  window.__track303AudioTest = { render, countEngineNodes };
  document.documentElement.dataset.audioTest = "ready";
}
