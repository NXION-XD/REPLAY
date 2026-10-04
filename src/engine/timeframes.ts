// ============================================================================
// Multi-timeframe aggregation — strictly causal (no look-ahead).
//
// Conventions:
//  - A closed HTF candle is keyed by its bucket START time.
//  - `aggregate` builds closed candles from base data.
//  - `HtfBuilder` incrementally builds the *forming* candle as base candles
//    arrive, so at replay time t the HTF series only reflects base candles
//    whose time <= t. The forming candle is never mistaken for a closed one.
// ============================================================================

import { tfSeconds } from './types';
import type { Candle, TimeframeId } from './types';

export function bucketStart(t: number, tfSeconds_: number): number {
  return Math.floor(t / tfSeconds_) * tfSeconds_;
}

/** Full aggregation of a base series into a higher timeframe (closed candles). */
export function aggregate(base: Candle[], tf: TimeframeId): Candle[] {
  const step = tfSeconds(tf);
  if (base.length === 0) return [];
  const baseStep = base.length > 1 ? base[1].t - base[0].t : step;
  if (baseStep >= step) return base.slice(); // already >= target
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  for (const c of base) {
    const b = bucketStart(c.t, step);
    if (b !== curBucket) {
      if (cur) out.push(cur);
      curBucket = b;
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else if (cur) {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      if (c.v !== undefined) cur.v = (cur.v ?? 0) + c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Incremental higher-timeframe view driven by the replay cursor.
 * Feed base candles one-by-one (in time order); at any moment,
 * `closed` holds all fully closed HTF candles and `forming` the live one.
 */
export class HtfBuilder {
  readonly tf: TimeframeId;
  private step: number;
  closed: Candle[] = [];
  forming: Candle | null = null;
  private bucket = -1;

  constructor(tf: TimeframeId) {
    this.tf = tf;
    this.step = tfSeconds(tf);
  }

  reset(): void {
    this.closed = [];
    this.forming = null;
    this.bucket = -1;
  }

  push(c: Candle): void {
    const b = bucketStart(c.t, this.step);
    if (b !== this.bucket) {
      if (this.forming) this.closed.push(this.forming);
      this.bucket = b;
      this.forming = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else if (this.forming) {
      this.forming.h = Math.max(this.forming.h, c.h);
      this.forming.l = Math.min(this.forming.l, c.l);
      this.forming.c = c.c;
      if (c.v !== undefined) this.forming.v = (this.forming.v ?? 0) + c.v;
    }
  }

  /** All candles visible at this moment: closed + forming (if any). */
  visible(): Candle[] {
    return this.forming ? [...this.closed, this.forming] : this.closed.slice();
  }
}

/**
 * Which higher timeframes can be derived from a base timeframe.
 * Valid when target is an exact multiple of base.
 */
export function derivableTimeframes(base: TimeframeId): TimeframeId[] {
  const b = tfSeconds(base);
  const order: TimeframeId[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  return order.filter((tf) => {
    const s = tfSeconds(tf);
    return s >= b && s % b === 0;
  });
}
