/**
 * Adapted from the WEBSTER engine (seanwebsters/ipgenerator).
 * Statistics for audience analytics and experiments. Pure functions,
 * unit-tested. Everything reports uncertainty; nothing extrapolates.
 */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Wilson score interval for a proportion. */
export function wilson(successes: number, n: number, z = 1.96): { rate: number | null; low: number | null; high: number | null } {
  if (n <= 0) return { rate: null, low: null, high: null };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface TwoProportionResult {
  diff: number;
  ciLow: number;
  ciHigh: number;
  z: number;
  pValue: number;
}

/** Two-sided z-test for difference in proportions (B − A), pooled SE for the test, unpooled for the CI. */
export function twoProportion(xA: number, nA: number, xB: number, nB: number): TwoProportionResult | null {
  if (nA <= 0 || nB <= 0) return null;
  const pA = xA / nA;
  const pB = xB / nB;
  const pooled = (xA + xB) / (nA + nB);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  const seDiff = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const diff = pB - pA;
  const z = sePooled === 0 ? 0 : diff / sePooled;
  const pValue = sePooled === 0 ? 1 : 2 * (1 - normCdf(Math.abs(z)));
  return { diff, ciLow: diff - 1.96 * seDiff, ciHigh: diff + 1.96 * seDiff, z, pValue };
}

/** Per-arm sample size to detect an absolute lift `mde` from baseline `p` (two-sided). */
export function sampleSizePerArm(p: number, mde: number, alpha = 0.05, power = 0.8): number {
  const za = alpha === 0.05 ? 1.959964 : 2.575829;
  const zb = power === 0.8 ? 0.841621 : 1.281552;
  const p2 = Math.min(0.999, Math.max(0.001, p + mde));
  const pbar = (p + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p * (1 - p) + p2 * (1 - p2))) ** 2 / (mde * mde);
  return Math.ceil(n);
}

export type Conclusion = "INSUFFICIENT_DATA" | "NO_DETECTABLE_DIFFERENCE" | "VARIANT_BETTER" | "CONTROL_BETTER";

export function conclude(result: TwoProportionResult | null, nA: number, nB: number, minPerArm: number, alpha = 0.05): Conclusion {
  if (!result || nA < minPerArm || nB < minPerArm) return "INSUFFICIENT_DATA";
  if (result.pValue >= alpha) return "NO_DETECTABLE_DIFFERENCE";
  return result.diff > 0 ? "VARIANT_BETTER" : "CONTROL_BETTER";
}

/** Confidence label is capped by sample size so small samples can never read as "HIGH". */
export function confidenceFor(n: number, pValue?: number | null): "LOW" | "MEDIUM" | "HIGH" {
  if (n < 100) return "LOW";
  if (pValue != null && pValue < 0.01 && n >= 400) return "HIGH";
  return "MEDIUM";
}
