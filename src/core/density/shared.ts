/** Shared vocabulary for the density module (docs/design.md §3). */

export interface DensityOptions {
  /** Kernel bandwidth in pixels — β in §3.1. */
  beta?: number;
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

/**
 * Kernel bandwidth in pixels — β in §3.1.
 *
 * Three, not the design's five. β and the height exponent `p` cannot be chosen
 * independently: the drawn hill is `λ^p`, and raising a Gaussian to the power
 * `p` widens it by exactly `√(1/p)`, so at `p = 1/3` every feature reaches the
 * eye √3 ≈ 1.73 times wider than the density says it is. Measured against the
 * synthetic corpus, a lone day-granularity event at β = 5 painted a hill 30 px
 * across — 107 years at full extent, for something that happened on a Tuesday.
 *
 * Three keeps a lone event's peak at `1/(β√2π) = 0.133`, comfortably under the
 * 0.25 floor of the crossfade, so an isolated event still dissolves into a mark
 * rather than sitting there as a permanent bump; and the far view stays an
 * order of magnitude smoother than the width at which the grid starts to comb.
 */
export const DEFAULT_BETA = 3;
export const DEFAULT_LAMBDA_REF = 8;
export const DEFAULT_SUPERSAMPLE = 4;

/**
 * Compression applied to λ before it becomes a height (§3.4).
 *
 * Set by eye against the synthetic corpus, as §9 anticipated. A square root —
 * the design's first guess — is not enough: a realistic personal timeline spans
 * roughly 500:1 between the Second World War and the early middle ages, which
 * √ only flattens to 22:1, leaving everything before 1000 AD as a sliver at the
 * bottom of the frame and most of the canvas empty. A cube root brings that to
 * 8:1, which shows antiquity's structure while keeping the modern peak plainly
 * dominant — the ordering stays honest, the detail becomes visible.
 */
export const DEFAULT_MASS_EXPONENT = 1 / 3;
