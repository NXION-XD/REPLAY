// ============================================================================
// Market structure, FVG, liquidity — event detectors with CONFIRMATION times.
// Every event carries `at` = the candle index at which it became knowable.
// Replay at cursor i exposes only events with at <= i. No look-ahead.
// ============================================================================

import type { Candle } from './types';
import { swingPoints } from './indicators';
import type { SwingPoint } from './indicators';

export type StructureEventType = 'BOS_UP' | 'BOS_DOWN' | 'CHOCH_UP' | 'CHOCH_DOWN' | 'HH' | 'HL' | 'LH' | 'LL';

export interface StructureEvent {
  type: StructureEventType;
  at: number; // candle index where confirmed/knowable
  t: number; // time
  price: number; // level broken or swing price
  swingT: number; // time of the swing bar itself
}

export interface StructureConfig {
  left: number;
  right: number;
  /** close must break level (true) or wick break counts (false) */
  closeBreaks: boolean;
}

/**
 * Swing-based structure: tracks the alternating sequence of swing highs/lows,
 * labels HH/HL/LH/LL, and emits BOS/CHOCH when price breaks the relevant
 * swing. CHOCH = break against prevailing trend; BOS = with trend.
 */
export function detectStructure(candles: Candle[], cfg: StructureConfig): {
  swings: SwingPoint[];
  events: StructureEvent[];
} {
  const swings = swingPoints(candles, cfg.left, cfg.right);
  const events: StructureEvent[] = [];
  const confirmed: SwingPoint[] = [];
  let trend: 'up' | 'down' | null = null;
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  let prevHigh: SwingPoint | null = null;
  let prevLow: SwingPoint | null = null;

  // process chronologically: swings become known at confirmedAt
  const byConfirm = [...swings].sort((a, b) => a.confirmedAt - b.confirmedAt);
  let scanFrom = 0;
  for (const sw of byConfirm) {
    // scan candles since last confirmation for level breaks
    for (let i = Math.max(scanFrom, sw.index + 1); i <= Math.min(sw.confirmedAt, candles.length - 1); i++) {
      const c = candles[i];
      const breakPrice = cfg.closeBreaks ? c.c : null;
      if (lastHigh && trend !== 'up') {
        const broken = cfg.closeBreaks ? breakPrice! > lastHigh.price : c.h > lastHigh.price;
        if (broken) {
          events.push({ type: trend === 'down' ? 'CHOCH_UP' : 'BOS_UP', at: i, t: c.t, price: lastHigh.price, swingT: candles[lastHigh.index].t });
          trend = 'up';
          lastHigh = null; // consumed
          break;
        }
      }
      if (lastLow && trend !== 'down') {
        const broken = cfg.closeBreaks ? breakPrice! < lastLow.price : c.l < lastLow.price;
        if (broken) {
          events.push({ type: trend === 'up' ? 'CHOCH_DOWN' : 'BOS_DOWN', at: i, t: c.t, price: lastLow.price, swingT: candles[lastLow.index].t });
          trend = 'down';
          lastLow = null;
          break;
        }
      }
    }
    scanFrom = sw.confirmedAt + 1;

    // label swing vs previous same-kind swing
    if (sw.kind === 'high') {
      if (lastHigh) prevHigh = lastHigh;
      if (prevHigh) {
        events.push({
          type: sw.price > prevHigh.price ? 'HH' : 'LH',
          at: sw.confirmedAt, t: candles[sw.confirmedAt].t, price: sw.price, swingT: candles[sw.index].t,
        });
      }
      lastHigh = sw;
      if (!trend && prevHigh) trend = sw.price > prevHigh.price ? 'up' : 'down';
    } else {
      if (lastLow) prevLow = lastLow;
      if (prevLow) {
        events.push({
          type: sw.price < prevLow.price ? 'LL' : 'HL',
          at: sw.confirmedAt, t: candles[sw.confirmedAt].t, price: sw.price, swingT: candles[sw.index].t,
        });
      }
      lastLow = sw;
    }
    confirmed.push(sw);
  }
  return { swings, events };
}

// ---------------------------------------------------------------------------

export interface Fvg {
  direction: 'bullish' | 'bearish';
  /** index where the 3rd candle closed = when the FVG becomes knowable */
  at: number;
  t: number;
  top: number;
  bottom: number;
  size: number;
  filled: boolean;
  filledAt?: number;
  mitigatedAt?: number; // first touch
}

export interface FvgConfig {
  minSizePoints: number;
  point: number;
}

/** Classic 3-candle FVG. Knowable when candle i closes (gap between i-2 & i). */
export function detectFvgs(candles: Candle[], cfg: FvgConfig): Fvg[] {
  const out: Fvg[] = [];
  const minSize = cfg.minSizePoints * cfg.point;
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (c.l - a.h > minSize) {
      out.push({ direction: 'bullish', at: i, t: c.t, top: c.l, bottom: a.h, size: c.l - a.h, filled: false });
    }
    if (a.l - c.h > minSize) {
      out.push({ direction: 'bearish', at: i, t: c.t, top: a.l, bottom: c.h, size: a.l - c.h, filled: false });
    }
  }
  return out;
}

/**
 * Fill status as of cursor — computed causally by scanning only candles
 * up to `upto`. Called on demand per visible FVG set (bounded work).
 */
export function fvgStatusAt(fvg: Fvg, candles: Candle[], upto: number): Fvg {
  const res = { ...fvg };
  for (let i = fvg.at + 1; i <= upto && i < candles.length; i++) {
    const c = candles[i];
    if (fvg.direction === 'bullish') {
      if (res.mitigatedAt === undefined && c.l <= fvg.top) res.mitigatedAt = i;
      if (c.l <= fvg.bottom) {
        res.filled = true;
        res.filledAt = i;
        break;
      }
    } else {
      if (res.mitigatedAt === undefined && c.h >= fvg.bottom) res.mitigatedAt = i;
      if (c.h >= fvg.top) {
        res.filled = true;
        res.filledAt = i;
        break;
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------

export interface LiquidityLevels {
  prevDayHigh?: number;
  prevDayLow?: number;
  prevWeekHigh?: number;
  prevWeekLow?: number;
  asiaHigh?: number;
  asiaLow?: number;
  sessionHigh?: number;
  sessionLow?: number;
  dayHigh?: number;
  dayLow?: number;
}

export interface SweepEvent {
  levelId: string; // e.g. 'asiaHigh', 'prevDayHigh', 'swingHigh@t'
  kind: 'high' | 'low';
  at: number; // index where the sweep is knowable (close back inside)
  t: number;
  level: number;
  extreme: number; // how far price went beyond the level
}

/**
 * Detect a sweep of a level: candle's wick exceeds `level` but the candle
 * CLOSES back on the original side. Knowable at that candle's close.
 */
export function detectSweep(
  candles: Candle[], idx: number, level: number, kind: 'high' | 'low', levelId: string
): SweepEvent | null {
  const c = candles[idx];
  if (kind === 'high' && c.h > level && c.c < level) {
    return { levelId, kind, at: idx, t: c.t, level, extreme: c.h - level };
  }
  if (kind === 'low' && c.l < level && c.c > level) {
    return { levelId, kind, at: idx, t: c.t, level, extreme: level - c.l };
  }
  return null;
}

/** Equal highs/lows among swing points within tolerance (points). */
export function equalLevels(
  swings: SwingPoint[], kind: 'high' | 'low', tolerancePoints: number, point: number, uptoConfirm: number
): { price: number; times: number[] }[] {
  const tol = tolerancePoints * point;
  const pts = swings.filter((s) => s.kind === kind && s.confirmedAt <= uptoConfirm);
  const groups: { price: number; times: number[] }[] = [];
  for (const s of pts) {
    const g = groups.find((g) => Math.abs(g.price - s.price) <= tol);
    if (g) {
      g.times.push(s.index);
      g.price = (g.price * (g.times.length - 1) + s.price) / g.times.length;
    } else {
      groups.push({ price: s.price, times: [s.index] });
    }
  }
  return groups.filter((g) => g.times.length >= 2);
}
