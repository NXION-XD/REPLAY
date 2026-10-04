// ============================================================================
// Monte Carlo — bootstrap resampling of the ACTUAL trade sequence.
// Results are statistical scenarios over recorded trades, never predictions.
// ============================================================================

import type { Trade } from './types';

export interface MonteCarloResult {
  simulations: number;
  /** percentiles of final net R */
  finalR: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** percentiles of max drawdown (R) */
  maxDdR: { p5: number; p50: number; p95: number };
  maxConsecLosses: { p50: number; p95: number; max: number };
  /** probability (fraction of sims) of hitting a given drawdown depth in R */
  probDdExceeds: { thresholdR: number; probability: number }[];
  probTargetReached: { targetR: number; probability: number }[];
  /** a few sample equity paths (R) for charting */
  samplePaths: number[][];
}

export function monteCarlo(
  trades: Trade[], simulations = 1000, ddThresholdsR = [5, 10, 15, 20], targetR = 10,
  seed?: number
): MonteCarloResult {
  const rs = trades.map((t) => t.r);
  const n = rs.length;
  if (n === 0) {
    return {
      simulations: 0,
      finalR: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      maxDdR: { p5: 0, p50: 0, p95: 0 },
      maxConsecLosses: { p50: 0, p95: 0, max: 0 },
      probDdExceeds: [], probTargetReached: [], samplePaths: [],
    };
  }
  // simple seeded PRNG (mulberry32) for reproducibility when seed given
  let s = seed ?? (Date.now() % 2147483647);
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const finals: number[] = [];
  const dds: number[] = [];
  const streaks: number[] = [];
  const ddHit = new Array(ddThresholdsR.length).fill(0);
  let targetHit = 0;
  const samplePaths: number[][] = [];

  for (let sim = 0; sim < simulations; sim++) {
    let eq = 0, peak = 0, maxDd = 0, cl = 0, maxCl = 0;
    const path: number[] = sim < 25 ? [0] : [];
    for (let i = 0; i < n; i++) {
      const r = rs[Math.floor(rand() * n)];
      eq += r;
      peak = Math.max(peak, eq);
      maxDd = Math.max(maxDd, peak - eq);
      if (r < 0) { cl++; maxCl = Math.max(maxCl, cl); } else cl = 0;
      if (sim < 25) path.push(eq);
    }
    finals.push(eq);
    dds.push(maxDd);
    streaks.push(maxCl);
    ddThresholdsR.forEach((th, i) => { if (maxDd >= th) ddHit[i]++; });
    if (eq >= targetR) targetHit++;
    if (sim < 25) samplePaths.push(path);
  }

  const pct = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  };

  return {
    simulations,
    finalR: { p5: pct(finals, 0.05), p25: pct(finals, 0.25), p50: pct(finals, 0.5), p75: pct(finals, 0.75), p95: pct(finals, 0.95) },
    maxDdR: { p5: pct(dds, 0.05), p50: pct(dds, 0.5), p95: pct(dds, 0.95) },
    maxConsecLosses: { p50: pct(streaks, 0.5), p95: pct(streaks, 0.95), max: Math.max(...streaks) },
    probDdExceeds: ddThresholdsR.map((th, i) => ({ thresholdR: th, probability: ddHit[i] / simulations })),
    probTargetReached: [{ targetR, probability: targetHit / simulations }],
    samplePaths,
  };
}

// ---------------------------------------------------------------------------
// Walk-forward split: in-sample vs out-of-sample comparison (honest split by
// trade exit time; the engine never tunes anything itself).
// ---------------------------------------------------------------------------

export interface WalkForwardSplit {
  inSample: Trade[];
  outOfSample: Trade[];
  splitTime: number;
}

export function walkForwardSplit(trades: Trade[], inSampleFraction = 0.7): WalkForwardSplit {
  const sorted = [...trades].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  const cut = Math.floor(sorted.length * inSampleFraction);
  return {
    inSample: sorted.slice(0, cut),
    outOfSample: sorted.slice(cut),
    splitTime: sorted[cut]?.exitTime ?? 0,
  };
}
