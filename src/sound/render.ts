import { renderInChunks } from "klangwerk";
import type { Project } from "../domain/types";
import { songRows, songSeconds } from "../format";
import { TrackerEngine } from "./engine";
import { swapSound, useContext } from "klangwerk/tone";

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
 * the graph is prepared, the current context is the offline one.
 *
 * Scheduling everything before rendering would make every note of the song
 * exist from the first sample on, and the cost would grow with the square of
 * the length. Here the renderer suspends every two seconds and the transport
 * only schedules the next stretch, like live play (as in Kitty).
 */
export async function renderSong(project: Project, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const steps = songRows(project);
  const duration = renderSeconds(project);
  const context = new OfflineAudioContext(2, Math.ceil(duration * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const previous = useContext(context);
  let engine: TrackerEngine;
  try {
    engine = new TrackerEngine(project, { offline: true });
    await engine.scheduleOffline(steps);
  } finally {
    swapSound(previous);
  }
  const failures: unknown[] = [];
  const buffer = await renderInChunks(context, (until) => {
    try {
      engine.renderUntil(until);
    } catch (error) {
      failures.push(error);
    }
  }, duration, RENDER_CHUNK_SECONDS, onProgress);
  if (failures.length > 0) throw failures[0] instanceof Error ? failures[0] : new Error("Das Rendern ist fehlgeschlagen.");
  onProgress?.(1);
  return buffer;
}
