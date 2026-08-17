/**
 * Gaussian smoothing by three successive box filters.
 *
 * Three boxes converge on a Gaussian quickly (it is the central limit theorem
 * applied to a uniform), leaving a shape error of a few percent — invisible in a
 * density render, and bought at O(n) per pass regardless of bandwidth. A direct
 * convolution would be O(n · σ), which is the difference between a fraction of a
 * millisecond and blowing the frame budget when zoomed far out.
 *
 * Boundaries are treated as zero. Callers pad the grid so that no mass belonging
 * inside the viewport is smoothed off the end of the array.
 */

/** Box widths whose three-fold convolution best matches a Gaussian of `sigma`. */
export function boxSizesForGaussian(sigma: number, passes = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;

  const mIdeal =
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) /
    (-4 * lower - 4);
  const m = Math.round(mIdeal);

  const sizes: number[] = [];
  for (let i = 0; i < passes; i++) sizes.push(i < m ? lower : upper);
  return sizes;
}

/** One normalised box pass of odd width `2r+1`, zero outside the array. */
function boxPass(src: Float64Array, dst: Float64Array, r: number): void {
  const n = src.length;
  const w = 2 * r + 1;
  let sum = 0;

  for (let j = 0; j <= r && j < n; j++) sum += src[j] as number;

  for (let i = 0; i < n; i++) {
    dst[i] = sum / w;
    const entering = i + r + 1;
    const leaving = i - r;
    if (entering < n) sum += src[entering] as number;
    if (leaving >= 0) sum -= src[leaving] as number;
  }
}

/**
 * Smooths `data` in place. `sigma` is in array cells. A sigma below half a cell
 * is a no-op: there is nothing a filter can add below the sampling resolution.
 */
export function gaussianBlur(data: Float64Array, sigma: number): void {
  if (!(sigma > 0.5)) return;

  // Annotated because `new Float64Array(n)` narrows its buffer type, which then
  // will not swap with the caller's array.
  let src: Float64Array<ArrayBufferLike> = data;
  let dst: Float64Array<ArrayBufferLike> = new Float64Array(data.length);

  for (const size of boxSizesForGaussian(sigma)) {
    const r = (size - 1) / 2;
    if (r < 1) continue;
    boxPass(src, dst, r);
    const swap = src;
    src = dst;
    dst = swap;
  }

  if (src !== data) data.set(src);
}
