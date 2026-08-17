/**
 * Test and development fixtures. Nothing here ships in a production render path; it
 * exists so the canvas (M1) and the density estimator have something with the right
 * shape to be built against (design.md §6.1).
 */

export { generateTimeline, makeRng } from './synthetic';
export type { SyntheticOptions } from './synthetic';
