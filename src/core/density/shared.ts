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
