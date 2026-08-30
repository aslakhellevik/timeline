/** Shared vocabulary for the density module (docs/design.md §3). */

export interface DensityOptions {
  /** Kernel bandwidth in pixels — β in §3.1. */
  beta?: number;
  /**
   * Sub-pixel cells per pixel used when rasterising event shapes. Higher is more
   * faithful for events a few pixels wide; the cost is linear and tiny.
   */
  supersample?: number;
  /**
   * Time → pixel position, when the axis is not linear (§6.7).
   *
   * Everything downstream of this mapping — deposit, the double prefix sum, the
   * blur, the column sums — already works in screen space, so a nonlinear axis
   * needs nothing else. Two properties survive any monotone mapping: each event
   * still carries exactly unit mass, because the trapezoid's height is derived
   * from its width *in cells*; and the kernel bandwidth stays β **pixels**,
   * which is the property the whole design rests on (§3.1).
   *
   * The approximation it introduces: a trapezoid's ramps are straight in cell
   * space, and a warp curves them. Corner positions stay exact and mass stays
   * exact, so only the interior shape of a very wide fuzzy event is affected,
   * and then only slightly.
   */
  toPixel?: (t: number) => number;
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
