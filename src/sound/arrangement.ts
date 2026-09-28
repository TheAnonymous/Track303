/** Loop plays the shown pattern (switches wait for its end); song follows the song list. */
export type PlayMode = "loop" | "song";

export interface Position {
  pattern: number;
  /** Entry of the song list that plays, or `null` in loop mode. */
  songIndex: number | null;
}

export interface Arrangement {
  mode: PlayMode;
  song: readonly number[];
  /** Song entry to start from (the song view's cursor). */
  songStart: number;
}

function clampEntry(song: readonly number[], index: number): number {
  return Math.max(0, Math.min(song.length - 1, index));
}

/** Where playback starts. */
export function startPosition(arrangement: Arrangement, activePattern: number): Position {
  if (arrangement.mode === "song" && arrangement.song.length) {
    const songIndex = clampEntry(arrangement.song, arrangement.songStart);
    return { pattern: arrangement.song[songIndex]!, songIndex };
  }
  return { pattern: activePattern, songIndex: null };
}

/**
 * Where playback goes when a pattern ends: the next song entry (the song
 * repeats from the top), or in loop mode the queued pattern or the same one.
 * Switching to song mode while playing starts the song at `songStart`.
 */
export function nextPosition(current: Position, arrangement: Arrangement, queued: number | null): Position {
  const { song } = arrangement;
  if (arrangement.mode === "song" && song.length) {
    const songIndex = current.songIndex === null ? clampEntry(song, arrangement.songStart) : (current.songIndex + 1) % song.length;
    return { pattern: song[songIndex]!, songIndex };
  }
  return { pattern: queued ?? current.pattern, songIndex: null };
}
