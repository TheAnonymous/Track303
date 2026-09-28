import type { Lane } from "../domain/types";
import { LANES } from "../domain/types";

/** Rows per bar: four beats of sixteenth rows. */
export const ROWS_PER_BAR = 16;

/** Live-only layer on top of the project: nothing here is saved or undoable. */
export interface PerformanceState {
  /** Lanes silenced right now. */
  muted: Lane[];
  /** Lanes whose mute flips at the next bar line. */
  pending: Lane[];
  /** Held break: the kick is out and the highpass rises. */
  breakActive: boolean;
  /** The break was let go; the drop lands on the next bar line. */
  dropPending: boolean;
}

/**
 * Mutes that change on the bar line and the break/drop, as in Kitty's live
 * bar. Without a running transport there is no bar line to wait for, so
 * changes apply at once.
 */
export class PerformanceLayer {
  private readonly muted = new Set<Lane>();
  private readonly pending = new Map<Lane, boolean>();
  private breakActive = false;
  private dropPending = false;

  /** Asks for `lane` to be muted or not; returns whether the change waits for the bar line. */
  requestMute(lane: Lane, muted: boolean, playing: boolean): boolean {
    if (this.muted.has(lane) === muted) {
      this.pending.delete(lane);
      return false;
    }
    if (!playing) {
      this.setMute(lane, muted);
      return false;
    }
    this.pending.set(lane, muted);
    return true;
  }

  /** Flips the lane's (pending) mute state. */
  toggleMute(lane: Lane, playing: boolean): boolean {
    const target = this.pending.has(lane) ? this.muted.has(lane) : !this.muted.has(lane);
    return this.requestMute(lane, target, playing);
  }

  /** Mutes at once, for renders and tests. */
  setMute(lane: Lane, muted: boolean): void {
    this.pending.delete(lane);
    if (muted) this.muted.add(lane);
    else this.muted.delete(lane);
  }

  /** Holding starts the break; letting go asks for the drop (at once when stopped). Returns what the sound must do. */
  setBreak(active: boolean, playing: boolean): "rise" | "drop" | null {
    if (active) {
      const rises = !this.breakActive || this.dropPending;
      this.breakActive = true;
      this.dropPending = false;
      return rises ? "rise" : null;
    }
    if (!this.breakActive || this.dropPending) return null;
    if (!playing) {
      this.breakActive = false;
      return "drop";
    }
    this.dropPending = true;
    return null;
  }

  /** Applies everything that waits for a bar line; returns whether the drop lands now and whether anything changed. */
  barLine(): { drop: boolean; changed: boolean } {
    const changed = this.pending.size > 0 || this.dropPending;
    for (const [lane, muted] of this.pending) {
      if (muted) this.muted.add(lane);
      else this.muted.delete(lane);
    }
    this.pending.clear();
    const drop = this.dropPending;
    if (drop) {
      this.breakActive = false;
      this.dropPending = false;
    }
    return { drop, changed };
  }

  /** On stop: waiting mutes apply, a break ends. Returns whether a break had to end. */
  settle(): boolean {
    const hadBreak = this.breakActive;
    this.barLine();
    this.breakActive = false;
    this.dropPending = false;
    return hadBreak;
  }

  /** Whether `lane` stays silent on this row. */
  silences(lane: Lane): boolean {
    return this.muted.has(lane) || (this.breakActive && lane === "bd");
  }

  get state(): PerformanceState {
    return {
      muted: LANES.filter((lane) => this.muted.has(lane)),
      pending: LANES.filter((lane) => this.pending.has(lane)),
      breakActive: this.breakActive,
      dropPending: this.dropPending,
    };
  }
}
