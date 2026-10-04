// ============================================================================
// Statistics engine. Every metric derives from the actual closed-trade list.
// Nothing here is synthetic; empty input → zeroed/empty outputs.
// ============================================================================

import type { Trade } from './types';
import type { TradeRecord } from './broker';

export interface CoreStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  winRateCI: [number, number]; // Wilson 95%
  avgR: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  expectancyMoney: number;
  expectancyR: number;
  profitFactor: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  maxDrawdown: number;
  avgDrawdown: number;
  maxDrawdownR: number;
  recoveryFactor: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  avgDurationMin: number;
  sharpe: number;   // per-trade mean/std (descriptive, not annualized)
  sortino: number;
  avgWinR: number;
  avgLossR: number;
}

const net = (t: Trade): number => t.pnl - t.commission;

export function coreStats(trades: Trade[]): CoreStats {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, winRateCI: [0, 0],
      avgR: 0, avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
      expectancyMoney: 0, expectancyR: 0, profitFactor: 0, grossProfit: 0, grossLoss: 0,
      netProfit: 0, maxDrawdown: 0, avgDrawdown: 0, maxDrawdownR: 0, recoveryFactor: 0,
      maxConsecWins: 0, maxConsecLosses: 0, avgDurationMin: 0, sharpe: 0, sortino: 0,
      avgWinR: 0, avgLossR: 0,
    };
  }
  const nets = trades.map(net);
  const rs = trades.map((t) => t.r);
  const wins = trades.filter((t) => net(t) > 0.005);
  const losses = trades.filter((t) => net(t) < -0.005);
  const be = n - wins.length - losses.length;
  const grossProfit = wins.reduce((s, t) => s + net(t), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + net(t), 0));
  const netProfit = nets.reduce((a, b) => a + b, 0);
  const p = wins.length / n;
  const winR = wins.map((t) => t.r);
  const lossR = losses.map((t) => t.r);

  // equity curve + drawdowns (trade-by-trade)
  let eq = 0, peak = 0, maxDd = 0, ddSum = 0, ddCount = 0, inDd = false, curDd = 0;
  let maxCw = 0, maxCl = 0, cw = 0, cl = 0;
  let maxDdR = 0, eqR = 0, peakR = 0;
  for (let i = 0; i < n; i++) {
    eq += nets[i];
    eqR += rs[i];
    peak = Math.max(peak, eq);
    peakR = Math.max(peakR, eqR);
    const dd = peak - eq;
    maxDd = Math.max(maxDd, dd);
    maxDdR = Math.max(maxDdR, peakR - eqR);
    if (dd > 0) { inDd = true; curDd = dd; } else if (inDd) { ddSum += curDd; ddCount++; inDd = false; curDd = 0; }
    if (nets[i] > 0.005) { cw++; cl = 0; maxCw = Math.max(maxCw, cw); }
    else if (nets[i] < -0.005) { cl++; cw = 0; maxCl = Math.max(maxCl, cl); }
  }
  if (inDd) { ddSum += curDd; ddCount++; }

  const mean = netProfit / n;
  const variance = nets.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const downside = losses.map(net);
  const dMean = downside.length ? downside.reduce((a, b) => a + b, 0) / downside.length : 0;
  const dVar = downside.length ? downside.reduce((s, x) => s + (x - dMean) ** 2, 0) / downside.length : 0;

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    breakeven: be,
    winRate: p,
    winRateCI: wilsonCI(wins.length, n),
    avgR: rs.reduce((a, b) => a + b, 0) / n,
    avgWin,
    avgLoss,
    largestWin: nets.length ? Math.max(...nets) : 0,
    largestLoss: nets.length ? Math.min(...nets) : 0,
    expectancyMoney: mean,
    expectancyR: rs.reduce((a, b) => a + b, 0) / n,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    grossProfit, grossLoss, netProfit,
    maxDrawdown: maxDd,
    avgDrawdown: ddCount ? ddSum / ddCount : 0,
    maxDrawdownR: maxDdR,
    recoveryFactor: maxDd > 0 ? netProfit / maxDd : netProfit > 0 ? Infinity : 0,
    maxConsecWins: maxCw,
    maxConsecLosses: maxCl,
    avgDurationMin: avgDuration(trades),
    sharpe: std > 0 ? mean / std : 0,
    sortino: dVar > 0 ? mean / Math.sqrt(dVar) : 0,
    avgWinR: winR.length ? winR.reduce((a, b) => a + b, 0) / winR.length : 0,
    avgLossR: lossR.length ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0,
  };
}

function avgDuration(trades: Trade[]): number {
  const durs = trades.filter((t) => t.exitTime).map((t) => (t.exitTime! - t.entryTime) / 60);
  return durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilsonCI(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

// ---------------------------------------------------------------------------
// Grouped breakdowns
// ---------------------------------------------------------------------------

export interface GroupStats {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  netR: number;
  avgR: number;
  profitFactor: number;
  expectancyR: number;
}

export function groupBy(trades: Trade[], keyFn: (t: Trade) => string): GroupStats[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  const out: GroupStats[] = [];
  map.forEach((arr, key) => {
    const cs = coreStats(arr);
    out.push({
      key, trades: arr.length, wins: cs.wins, losses: cs.losses, winRate: cs.winRate,
      netPnl: cs.netProfit, netR: cs.avgR * arr.length, avgR: cs.avgR,
      profitFactor: cs.profitFactor, expectancyR: cs.expectancyR,
    });
  });
  return out.sort((a, b) => b.trades - a.trades);
}

// ---------------------------------------------------------------------------
// Equity / drawdown curves
// ---------------------------------------------------------------------------

export interface EquityPoint {
  t: number;
  equity: number;
  balance: number;
  drawdown: number;
  cumR: number;
}

export function equityCurve(trades: Trade[], initialBalance: number): EquityPoint[] {
  const pts: EquityPoint[] = [];
  let bal = initialBalance;
  let peak = initialBalance;
  let cumR = 0;
  const sorted = [...trades].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  for (const t of sorted) {
    bal += net(t);
    peak = Math.max(peak, bal);
    cumR += t.r;
    pts.push({ t: t.exitTime ?? t.entryTime, equity: bal, balance: bal, drawdown: peak - bal, cumR });
  }
  return pts;
}

export interface DrawdownPeriod {
  startT: number;
  endT?: number; // undefined = still in drawdown
  depth: number;
  depthR: number;
  durationTrades: number;
  recovered: boolean;
}

export function drawdownPeriods(trades: Trade[], initialBalance: number): DrawdownPeriod[] {
  const out: DrawdownPeriod[] = [];
  let bal = initialBalance, peak = initialBalance;
  let cur: DrawdownPeriod | null = null;
  let cumR = 0, peakR = 0;
  const sorted = [...trades].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  for (const t of sorted) {
    bal += net(t);
    cumR += t.r;
    if (bal >= peak) {
      if (cur) { cur.endT = t.exitTime; cur.recovered = true; out.push(cur); cur = null; }
      peak = bal; peakR = cumR;
    } else {
      if (!cur) cur = { startT: t.exitTime ?? t.entryTime, depth: 0, depthR: 0, durationTrades: 0, recovered: false };
      cur.depth = Math.max(cur.depth, peak - bal);
      cur.depthR = Math.max(cur.depthR, peakR - cumR);
      cur.durationTrades++;
    }
  }
  if (cur) out.push(cur);
  return out.sort((a, b) => b.depth - a.depth);
}

// ---------------------------------------------------------------------------
// Streak distributions
// ---------------------------------------------------------------------------

export interface StreakBucket { length: number; count: number; }

export function streakDistribution(trades: Trade[], kind: 'win' | 'loss'): StreakBucket[] {
  const buckets = new Map<number, number>();
  let cur = 0;
  const match = (t: Trade) => (kind === 'win' ? net(t) > 0.005 : net(t) < -0.005);
  for (const t of trades) {
    if (match(t)) cur++;
    else {
      if (cur > 0) buckets.set(cur, (buckets.get(cur) ?? 0) + 1);
      cur = 0;
    }
  }
  if (cur > 0) buckets.set(cur, (buckets.get(cur) ?? 0) + 1);
  return [...buckets.entries()].map(([length, count]) => ({ length, count })).sort((a, b) => a.length - b.length);
}

// ---------------------------------------------------------------------------
// MFE/MAE & what-if SL/TP resimulation (uses the recorded post-entry path)
// ---------------------------------------------------------------------------

export interface ExcursionStats {
  avgMfe: number;
  avgMae: number;
  /** fraction of winners whose MAE never exceeded X% of SL distance */
  winnersSmoothPct: number;
}

export function excursionStats(trades: Trade[]): ExcursionStats {
  if (!trades.length) return { avgMfe: 0, avgMae: 0, winnersSmoothPct: 0 };
  const mfe = trades.reduce((s, t) => s + t.mfe, 0) / trades.length;
  const mae = trades.reduce((s, t) => s + t.mae, 0) / trades.length;
  const winners = trades.filter((t) => net(t) > 0.005);
  const smooth = winners.filter((t) => {
    const slDist = Math.abs(t.entryPrice - t.sl);
    return slDist > 0 && t.mae <= slDist * 0.5;
  });
  return { avgMfe: mfe, avgMae: mae, winnersSmoothPct: winners.length ? smooth.length / winners.length : 0 };
}

export interface WhatIfResult {
  label: string; // e.g. "TP 2R"
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  expectancyR: number;
  profitFactor: number;
}

/**
 * Resimulate each trade with a fixed R-multiple TP using the recorded
 * post-entry candle path. Conservative: when both SL and the hypothetical TP
 * sit inside one candle's range, SL is assumed first.
 */
export function whatIfTp(trades: TradeRecord[], rMultiples: number[]): WhatIfResult[] {
  return rMultiples.map((rm) => {
    let wins = 0, losses = 0, sumR = 0, gp = 0, gl = 0;
    for (const t of trades) {
      const slDist = Math.abs(t.entryPrice - t.sl);
      if (slDist <= 0 || t.path.length === 0) continue;
      const tpPrice = t.direction === 'long' ? t.entryPrice + slDist * rm : t.entryPrice - slDist * rm;
      let outcome = 0; // R multiple
      for (const c of t.path) {
        if (t.direction === 'long') {
          const slHit = c.l <= t.sl;
          const tpHit = c.h >= tpPrice;
          if (slHit && tpHit) { outcome = -1; break; }
          if (slHit) { outcome = -1; break; }
          if (tpHit) { outcome = rm; break; }
        } else {
          const slHit = c.h >= t.sl;
          const tpHit = c.l <= tpPrice;
          if (slHit && tpHit) { outcome = -1; break; }
          if (slHit) { outcome = -1; break; }
          if (tpHit) { outcome = rm; break; }
        }
      }
      // neither hit within recorded path → count actual result direction
      if (outcome === 0) outcome = t.r > 0 ? Math.min(t.r, rm) : t.r;
      sumR += outcome;
      if (outcome > 0) { wins++; gp += outcome; } else if (outcome < 0) { losses++; gl += Math.abs(outcome); }
    }
    const n = wins + losses;
    return {
      label: `TP ${rm}R`,
      wins, losses,
      winRate: n ? wins / n : 0,
      netR: sumR,
      expectancyR: n ? sumR / n : 0,
      profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    };
  });
}

export interface WhatIfSlResult extends WhatIfResult {}

export function whatIfSl(trades: TradeRecord[], slFractions: number[]): WhatIfSlResult[] {
  return slFractions.map((f) => {
    let wins = 0, losses = 0, sumR = 0, gp = 0, gl = 0;
    for (const t of trades) {
      const slDist = Math.abs(t.entryPrice - t.sl);
      if (slDist <= 0 || t.path.length === 0 || t.tp <= 0) continue;
      const newSlDist = slDist * f;
      const newSl = t.direction === 'long' ? t.entryPrice - newSlDist : t.entryPrice + newSlDist;
      const rMultipleToTp = Math.abs(t.tp - t.entryPrice) / newSlDist;
      let outcome = 0;
      for (const c of t.path) {
        if (t.direction === 'long') {
          const slHit = c.l <= newSl;
          const tpHit = c.h >= t.tp;
          if (slHit && tpHit) { outcome = -1; break; }
          if (slHit) { outcome = -1; break; }
          if (tpHit) { outcome = rMultipleToTp; break; }
        } else {
          const slHit = c.h >= newSl;
          const tpHit = c.l <= t.tp;
          if (slHit && tpHit) { outcome = -1; break; }
          if (slHit) { outcome = -1; break; }
          if (tpHit) { outcome = rMultipleToTp; break; }
        }
      }
      if (outcome === 0) outcome = t.r > 0 ? Math.min(t.r, rMultipleToTp) : Math.max(t.r, -1);
      sumR += outcome;
      if (outcome > 0) { wins++; gp += outcome; } else if (outcome < 0) { losses++; gl += Math.abs(outcome); }
    }
    const n = wins + losses;
    return { label: `SL ×${f}`, wins, losses, winRate: n ? wins / n : 0, netR: sumR, expectancyR: n ? sumR / n : 0, profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0 };
  });
}

// ---------------------------------------------------------------------------
// P&L distribution
// ---------------------------------------------------------------------------

export interface HistogramBin { from: number; to: number; count: number; }

export function histogram(values: number[], bins = 20): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const w = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const v of values) {
    const i = Math.min(bins - 1, Math.floor((v - min) / w));
    out[i].count++;
  }
  return out;
}
