// ============================================================================
// Incremental indicators — value at index i depends ONLY on candles[0..i].
// Precomputing full arrays is safe: each element is causal by construction.
// ============================================================================

import type { Candle } from './types';

/** Wilder ATR. atr[i] uses candles[0..i] only. First `period` values = simple avg. */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  const trs = new Array<number>(n).fill(0);
  trs[0] = candles[0].h - candles[0].l;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const pc = candles[i - 1].c;
    trs[i] = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  }
  if (n <= period) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += trs[i];
      out[i] = s / (i + 1);
    }
    return out;
  }
  let s = 0;
  for (let i = 0; i < period; i++) s += trs[i];
  out[period - 1] = s / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

/** Standard EMA seeded with SMA of first `period` values. */
export function emaSeries(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += candles[i].c;
  out[period - 1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) out[i] = candles[i].c * k + out[i - 1] * (1 - k);
  return out;
}

export interface SwingPoint {
  /** index of the swing bar itself */
  index: number;
  /** index at which the swing became CONFIRMED (needs `right` later bars) */
  confirmedAt: number;
  price: number;
  kind: 'high' | 'low';
}

/**
 * Fractal swings with `left`/`right` strength. A swing at bar i is only
 * knowable at bar i+right — callers must use `confirmedAt` for causality.
 */
export function swingPoints(candles: Candle[], left = 2, right = 2): SwingPoint[] {
  const out: SwingPoint[] = [];
  const n = candles.length;
  for (let i = left; i < n - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, confirmedAt: i + right, price: candles[i].h, kind: 'high' });
    if (isLow) out.push({ index: i, confirmedAt: i + right, price: candles[i].l, kind: 'low' });
  }
  return out;
}

/** Rolling percentile of `series[i]` within window [i-win+1..i]. Causal. */
export function rollingPercentile(series: number[], win: number): number[] {
  const n = series.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0 || win <= 0) return out;
  // coordinate compression + Fenwick tree over sliding-window counts → O(n log n)
  const uniq = Array.from(new Set(series)).sort((a, b) => a - b);
  const comp = new Map<number, number>();
  uniq.forEach((v, i) => comp.set(v, i));
  const m = uniq.length;
  const bit = new Int32Array(m + 1);
  const add = (idx: number, delta: number): void => {
    for (let x = idx + 1; x <= m; x += x & -x) bit[x] += delta;
  };
  const prefixLe = (idx: number): number => {
    let s = 0;
    for (let x = idx + 1; x > 0; x -= x & -x) s += bit[x];
    return s;
  };
  const minWin = Math.max(10, Math.floor(win / 2));
  for (let i = 0; i < n; i++) {
    add(comp.get(series[i])!, 1);
    if (i >= win) add(comp.get(series[i - win])!, -1);
    const size = Math.min(i + 1, win);
    if (size >= minWin) out[i] = prefixLe(comp.get(series[i])!) / size;
  }
  return out;
}

/** Efficiency ratio: |close[i]-close[i-lb]| / sum(|close diffs|). 0..1, causal. */
export function efficiencyRatio(closes: number[], lb: number): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = lb; i < n; i++) {
    let denom = 0;
    for (let j = i - lb + 1; j <= i; j++) denom += Math.abs(closes[j] - closes[j - 1]);
    out[i] = denom === 0 ? 0 : Math.abs(closes[i] - closes[i - lb]) / denom;
  }
  return out;
}
