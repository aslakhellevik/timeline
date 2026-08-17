/** Shared vocabulary for the density module (docs/design.md §3). */

export interface DensityOptions {
  /** Kernel bandwidth in pixels — β in §3.1. */
  beta?: number;
  /** Events per pixel column at which mass reaches full height — λ_ref in §3.4. */
  lambdaRef?: number;
  /**
   * Sub-pixel cells per pixel used when rasterising event shapes. Higher is more
   * faithful for events a few pixels wide; the cost is linear and tiny.
   */
  supersample?: number;
}

export interface DensityResult {
  /** Length === rounded viewport width. Expected events per pixel column (λ). */
  lambda: Float64Array;
  lambdaMax: number;
  /** Total mass falling inside the viewport. Equals the event count when all are visible. */
  total: number;
}

export const DEFAULT_BETA = 5;
export const DEFAULT_LAMBDA_REF = 8;
export const DEFAULT_SUPERSAMPLE = 4;

/**
 * Compression applied to λ before it becomes a height (§3.4).
 *
 * Set by eye against the synthetic corpus, as §10 anticipated. A square root —
 * the design's first guess — is not enough: a realistic personal timeline spans
 * roughly 500:1 between the Second World War and the early middle ages, which
 * √ only flattens to 22:1, leaving everything before 1000 AD as a sliver at the
 * bottom of the frame and most of the canvas empty. A cube root brings that to
 * 8:1, which shows antiquity's structure while keeping the modern peak plainly
 * dominant — the ordering stays honest, the detail becomes visible.
 */
export const DEFAULT_MASS_EXPONENT = 1 / 3;
