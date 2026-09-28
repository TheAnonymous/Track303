import * as Tone from "tone";
import type { Project } from "../domain/types";
import { songRows, songSeconds } from "../format";
import { TrackerEngine } from "./engine";

export const RENDER_SAMPLE_RATE = 44_100;
/** Room for echoes and reverb to ring out after the last row. */
export const RENDER_TAIL_SECONDS = 3;
/** Seconds of music the clock schedules ahead of the renderer, as live playback's lookahead does. */
const RENDER_CHUNK_SECONDS = 2;

export function renderSeconds(project: Project): number {
  return songSeconds(project) + RENDER_TAIL_SECONDS;
}

/**
 * Renders the song once through the same engine, sounds and swing as live
 * playback, faster than real time. Live playback must be stopped first: while
 * the graph is prepared, Tone's global context points at the offline one.
 *
 * Tone's own offline render runs the whole clock before rendering, so every
 * note of the song exists from the first sample on and the cost grows with the
 * square of the length. Here the renderer suspends every two seconds and the
 * clock only schedules the next stretch, like live play (as in Kitty).
 */
export async function renderSong(project: Project, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const steps = songRows(project);
  const duration = renderSeconds(project);
  // Firefox cannot suspend an offline render; it renders in one go, as Tone.Offline does.
  if (typeof OfflineAudioContext.prototype.suspend !== "function") return renderAtOnce(project, steps, duration, onProgress);
  const native = new OfflineAudioContext(2, Math.ceil(duration * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const context = new Tone.OfflineContext(native as never);
  const original = Tone.getContext();
  Tone.setContext(context);
  try {
    const engine = new TrackerEngine(project, { offline: true });
    await engine.scheduleOffline(steps);
    Tone.getTransport().start(0);
  } finally {
    Tone.setContext(original);
  }
  const clock = context as unknown as { _currentTime: number; emit(event: "tick"): void };
  const quantum = 128 / RENDER_SAMPLE_RATE;
  // The same loop as Tone's OfflineContext clock, stopped at `end`.
  const advanceClock = (end: number) => {
    Tone.setContext(context);
    try {
      while (clock._currentTime < Math.min(end, duration)) {
        clock.emit("tick");
        clock._currentTime += quantum;
      }
    } finally {
      Tone.setContext(original);
    }
  };
  advanceClock(2 * RENDER_CHUNK_SECONDS);
  const failures: unknown[] = [];
  for (let time = RENDER_CHUNK_SECONDS; time < duration; time += RENDER_CHUNK_SECONDS) {
    void native.suspend(time).then(() => {
      try {
        advanceClock(time + 2 * RENDER_CHUNK_SECONDS);
        onProgress?.(time / duration);
      } catch (error) {
        failures.push(error);
      }
      return native.resume();
    });
  }
  const buffer = await native.startRendering();
  if (failures.length > 0) throw failures[0] instanceof Error ? failures[0] : new Error("Das Rendern ist fehlgeschlagen.");
  onProgress?.(1);
  return buffer;
}

async function renderAtOnce(project: Project, steps: number, duration: number, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const original = Tone.getContext();
  const context = new Tone.OfflineContext(2, duration, RENDER_SAMPLE_RATE);
  Tone.setContext(context);
  try {
    const engine = new TrackerEngine(project, { offline: true });
    await engine.scheduleOffline(steps);
    Tone.getTransport().start(0);
  } catch (error) {
    Tone.setContext(original);
    throw error;
  }
  const rendering = context.render(false);
  Tone.setContext(original);
  const buffer = (await rendering).get();
  if (!buffer) throw new Error("Das Rendern lieferte kein Audio.");
  onProgress?.(1);
  return buffer;
}
