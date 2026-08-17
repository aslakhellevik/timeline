/**
 * Normal distribution primitives.
 *
 * The fast estimator in `index.ts` does not need these — it rasterises exact
 * trapezoids and convolves once. They exist for the reference implementation the
 * tests check the fast path against, and for anything that later wants a closed
 * form.
 */

const INV_SQRT_2PI = 0.3989422804014327;

export function normalPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal CDF, via Hart's rational approximation (West's arrangement).
 *
 * Absolute error stays below about 1e-16 everywhere, and relative error is near
 * machine precision through the central region, loosening to ~1e-9 out in the far
 * tail. Absolute accuracy is the one that matters here: a value 6σ out is
 * negligible beside the peak, so relative precision there would buy nothing. What
 * it does buy is a reference evaluator precise enough that test tolerances
 * measure the code under test rather than the approximation checking it.
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;

  if (z > 37) {
    c = 0;
  } else {
    const e = Math.exp(-0.5 * z * z);
    if (z < 7.07106781186547) {
      let b = 3.52624965998911e-2 * z + 0.700383064443688;
      b = b * z + 6.37396220353165;
      b = b * z + 33.912866078383;
      b = b * z + 112.079291497871;
      b = b * z + 221.213596169931;
      b = b * z + 220.206867912376;

      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;

      c = (e * b) / d;
    } else {
      // Continued fraction for the far tail.
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      c = e / (b * 2.506628274631);
    }
  }

  return x > 0 ? 1 - c : c;
}

/**
 * Ψ(x) = ∫_{-∞}^{x} Φ(u) du = x·Φ(x) + φ(x).
 *
 * The antiderivative of the normal CDF. Convolving a *ramp* with a Gaussian
 * produces it, which is what makes the general trapezoid closed-form (see
 * `reference.ts`). Behaves at both tails: Ψ(x) → 0 as x → −∞ and Ψ(x) → x as
 * x → +∞, with no cancellation in either limit.
 */
export function psi(x: number): number {
  return x * normalCdf(x) + normalPdf(x);
}
