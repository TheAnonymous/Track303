import { noteMidi, trackerNote } from "./domain/music";
import type { Cell, Fx, FxType, FxValue, Lane, Pattern, Project } from "./domain/types";
import { LANES } from "./domain/types";
import type { DrumVoice } from "./sound/kitty-types";

export const LANE_LABELS: Record<Lane, string> = { bd: "BD", sd: "SD", hh: "HH", acid: "303" };
export const LANE_NAMES: Record<Lane, string> = { bd: "Bassdrum", sd: "Snare", hh: "Hi-Hat", acid: "303" };
/** Three letters per drum voice, as a tracker cell shows it. */
export const VOICE_CODES: Record<DrumVoice, string> = { kick: "KCK", snare: "SNR", clap: "CLP", tom: "TOM", closedHat: "CHH", openHat: "OHH" };
export const VOICE_LABELS: Record<DrumVoice, string> = { kick: "Kick", snare: "Snare", clap: "Clap", tom: "Tom", closedHat: "Hat zu", openHat: "Hat offen" };
export const EMPTY_CELL = "···";

/** The main column of a cell: a drum code, a tracker note ("A-2") or dots. */
export function cellCode(cell: Cell, project: Pick<Project, "root" | "scale">): string {
  if (!cell) return EMPTY_CELL;
  if (cell.kind === "drum") return VOICE_CODES[cell.voice];
  return trackerNote(noteMidi(project.root, project.scale, cell.degree, cell.octave));
}

/** Accent `!` and slide `~`, as the 303's own sequencer marks them. */
export function cellFlags(cell: Cell): string {
  if (!cell) return "";
  return `${cell.accent ? "!" : ""}${cell.kind === "note" && cell.slide ? "~" : ""}`;
}

/** Whether a cell uses the deeper columns (chance, repeats, an effect), shown as a dot in the overview. */
export function hasDepth(cell: Cell): boolean {
  return Boolean(cell && (cell.chance < 1 || cell.ratchet > 1 || cell.fx));
}

export const FX_LABELS: Record<FxType, string> = { EC: "Echo", DL: "Später", VL: "Leiser", GT: "Länge", FL: "Filter", AR: "Arp" };

/** What values 1–3 mean for each effect, as the value buttons say it. */
export const FX_VALUE_LABELS: Record<FxType, Record<FxValue, string>> = {
  EC: { 1: "wenig", 2: "mittel", 3: "viel" },
  DL: { 1: "¼ Zeile", 2: "½ Zeile", 3: "¾ Zeile" },
  VL: { 1: "30 %", 2: "55 %", 3: "80 %" },
  GT: { 1: "sehr kurz", 2: "kurz", 3: "lang" },
  FL: { 1: "+1", 2: "+2", 3: "+3" },
  AR: { 1: "Dreiklang", 2: "Quinte", 3: "Oktave" },
};

/** "EC2", or dots. */
export function fxCode(cell: Cell): string {
  return cell?.fx ? `${cell.fx.type}${cell.fx.value}` : "···";
}

export function fxDescription(fx: Fx): string {
  return `${FX_LABELS[fx.type]} ${FX_VALUE_LABELS[fx.type][fx.value]}`;
}

export function chanceCode(cell: Cell): string {
  return cell && cell.chance < 1 ? String(Math.round(cell.chance * 100)) : "··";
}

export function ratchetCode(cell: Cell): string {
  return cell && cell.ratchet > 1 ? `×${cell.ratchet}` : "··";
}

export function chanceLabel(chance: number): string {
  return `${Math.round(chance * 100)} %`;
}

/** Spoken form of a cell for screen readers and tests: "303 Zeile 3: A-2, Akzent, Slide". */
export function cellDescription(lane: Lane, row: number, cell: Cell, project: Pick<Project, "root" | "scale">): string {
  const parts: string[] = [];
  if (!cell) parts.push("leer");
  else {
    parts.push(cell.kind === "drum" ? VOICE_LABELS[cell.voice] : cellCode(cell, project));
    if (cell.accent) parts.push("Akzent");
    if (cell.kind === "note" && cell.slide) parts.push("Slide");
    if (cell.chance < 1) parts.push(`Chance ${chanceLabel(cell.chance)}`);
    if (cell.ratchet > 1) parts.push(`${cell.ratchet}-fach`);
    if (cell.fx) parts.push(fxDescription(cell.fx));
  }
  return `${LANE_LABELS[lane]} Zeile ${rowLabel(row)}: ${parts.join(", ")}`;
}

/** Rows count from 00 as in trackers, in decimal so beats read as 00, 04, 08, 12. */
export function rowLabel(row: number): string {
  return String(row).padStart(2, "0");
}

/** Song length in seconds: every entry's rows as sixteenths at the project tempo. */
export function songSeconds(project: Pick<Project, "song" | "patterns" | "tempo">): number {
  const rows = project.song.reduce((sum, index) => sum + (project.patterns[index]?.rows ?? 16), 0);
  return (rows * 15) / project.tempo;
}

/** "1:05" */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Lanes that have anything in a pattern, for the song list's little lane marks. */
export function usedLanes(pattern: Pattern | undefined): Lane[] {
  return pattern ? LANES.filter((lane) => pattern.lanes[lane].some(Boolean)) : [];
}
