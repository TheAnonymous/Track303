import type { AcidKnobs, Pattern } from "./types";

/** The 303 knobs a filter ride records: what the live view's field and sliders turn. */
export const AUTO_PARAMS = ["cutoff", "resonance", "envMod", "decay"] as const;
export type AutoParam = (typeof AUTO_PARAMS)[number];

/** Per knob one value (0–1) per row, `null` where the ride leaves the knob alone. */
export type Automation = Partial<Record<AutoParam, (number | null)[]>>;

function unit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : null;
}

/** Keeps valid rows only, fitted to the pattern length; `undefined` when nothing is left. */
export function sanitizeAutomation(value: unknown, rows: number): Automation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const clean: Automation = {};
  for (const param of AUTO_PARAMS) {
    const values = Array.isArray(source[param]) ? (source[param] as unknown[]) : [];
    const fitted = Array.from({ length: rows }, (_, row) => unit(values[row]));
    if (fitted.some((entry) => entry !== null)) clean[param] = fitted;
  }
  return Object.keys(clean).length ? clean : undefined;
}

/** The ride's knob values on one row. */
export function automationAt(pattern: Pattern, row: number): Partial<AcidKnobs> {
  const values: Partial<AcidKnobs> = {};
  for (const param of AUTO_PARAMS) {
    const value = pattern.automation?.[param]?.[row];
    if (value !== null && value !== undefined) values[param] = value;
  }
  return values;
}

export function hasAutomation(pattern: Pattern): boolean {
  return AUTO_PARAMS.some((param) => pattern.automation?.[param]?.some((value) => value !== null));
}

/** Writes values into a pattern's ride (mutating it); a knob's row array is made on first use. */
export function writeAutomation(pattern: Pattern, row: number, values: Partial<AcidKnobs>): void {
  for (const param of AUTO_PARAMS) {
    const value = values[param];
    if (value === undefined) continue;
    pattern.automation ??= {};
    const rows = (pattern.automation[param] ??= Array.from({ length: pattern.rows }, () => null));
    rows[row] = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
  }
}

/** Clears the ride on some rows (all rows without a range); drops what is left empty. */
export function clearAutomation(pattern: Pattern, from = 0, to = pattern.rows - 1): void {
  if (!pattern.automation) return;
  for (const param of AUTO_PARAMS) {
    const rows = pattern.automation[param];
    if (!rows) continue;
    for (let row = from; row <= to; row += 1) rows[row] = null;
    if (!rows.some((value) => value !== null)) delete pattern.automation[param];
  }
  if (!Object.keys(pattern.automation).length) delete pattern.automation;
}
