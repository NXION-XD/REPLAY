// ============================================================================
// Realistic execution: spread, slippage, gaps, same-candle ambiguity.
// Candle data is treated as MID prices; buys pay ask, sells receive bid.
// ============================================================================

import type { Candle, Direction, ExecutionConfig, InstrumentSpec } from './types';

export const halfSpread = (cfg: ExecutionConfig, spec: InstrumentSpec): number =>
  (cfg.mode === 'realistic' ? cfg.spreadPoints : 0) * spec.point / 2;

const slip = (cfg: ExecutionConfig, spec: InstrumentSpec): number =>
  (cfg.mode === 'realistic' ? cfg.slippagePoints : 0) * spec.point;

/** Fill price for a market/pending order placed at candle `c`. */
export function marketFill(
  direction: Direction, c: Candle, cfg: ExecutionConfig, spec: InstrumentSpec
): number {
  const hs = halfSpread(cfg, spec);
  const s = slip(cfg, spec);
  return direction === 'long' ? c.o + hs + s : c.o - hs - s;
}

/** Limit order: fills at limit price or better (open if gapped). */
export function limitFill(
  direction: Direction, limitPrice: number, c: Candle, cfg: ExecutionConfig, spec: InstrumentSpec
): number | null {
  const hs = halfSpread(cfg, spec);
  if (direction === 'long') {
    const askLow = c.l + hs; // worst ask seen this candle
    if (askLow <= limitPrice) return Math.min(limitPrice, c.o + hs);
  } else {
    const bidHigh = c.h - hs;
    if (bidHigh >= limitPrice) return Math.max(limitPrice, c.o - hs);
  }
  return null;
}

/** Stop order: fills at stop price or worse (open if gapped) plus slippage. */
export function stopFill(
  direction: Direction, stopPrice: number, c: Candle, cfg: ExecutionConfig, spec: InstrumentSpec
): number | null {
  const hs = halfSpread(cfg, spec);
  const s = slip(cfg, spec);
  if (direction === 'long') {
    const askHigh = c.h + hs;
    if (askHigh >= stopPrice) return Math.max(stopPrice, c.o + hs) + s;
  } else {
    const bidLow = c.l - hs;
    if (bidLow <= stopPrice) return Math.min(stopPrice, c.o - hs) - s;
  }
  return null;
}

export interface ExitCheck {
  hit: 'sl' | 'tp' | 'both' | null;
  slPrice: number; // fill price if SL taken
  tpPrice: number; // fill price if TP taken
}

/**
 * Evaluate SL/TP against one candle for an open position.
 * Handles gaps (fill at open when beyond level) and the both-hit ambiguity
 * via cfg.sameCandleRule ('sl_first' = conservative default).
 */
export function checkExit(
  direction: Direction, sl: number, tp: number, c: Candle,
  cfg: ExecutionConfig, spec: InstrumentSpec
): ExitCheck {
  const hs = halfSpread(cfg, spec);
  const s = slip(cfg, spec);

  // exit side: longs exit at bid, shorts at ask
  const exitLow = direction === 'long' ? c.l - hs : c.l + hs;
  const exitHigh = direction === 'long' ? c.h - hs : c.h + hs;
  const exitOpen = direction === 'long' ? c.o - hs : c.o + hs;

  let slHit = false;
  let tpHit = false;
  let slPrice = sl;
  let tpPrice = tp;

  if (direction === 'long') {
    slHit = exitLow <= sl;
    tpHit = tp > 0 && exitHigh >= tp;
    if (slHit) slPrice = Math.min(sl, exitOpen) - s; // gap → open, plus slippage
    if (tpHit) tpPrice = Math.max(tp, exitOpen);     // gap in favor → open (better)
  } else {
    slHit = exitHigh >= sl;
    tpHit = tp > 0 && exitLow <= tp;
    if (slHit) slPrice = Math.max(sl, exitOpen) + s;
    if (tpHit) tpPrice = Math.min(tp, exitOpen);
  }

  return {
    hit: slHit && tpHit ? 'both' : slHit ? 'sl' : tpHit ? 'tp' : null,
    slPrice,
    tpPrice,
  };
}

/** Resolve the 'both hit in one candle' ambiguity to a single outcome. */
export function resolveBoth(cfg: ExecutionConfig): 'sl' | 'tp' {
  return cfg.sameCandleRule === 'tp_first' ? 'tp' : 'sl';
}

/** P&L in account currency for a (partial) position. */
export function pnlFor(
  direction: Direction, entry: number, exit: number, lots: number, spec: InstrumentSpec
): number {
  const diff = direction === 'long' ? exit - entry : entry - exit;
  return diff * spec.contractSize * lots;
}

/** Money at risk between entry and SL for `lots`. */
export function riskFor(
  entry: number, sl: number, lots: number, spec: InstrumentSpec
): number {
  return Math.abs(entry - sl) * spec.contractSize * lots;
}

/** Position size (lots) for a given money risk and SL distance. */
export function lotsForRisk(
  riskMoney: number, entry: number, sl: number, spec: InstrumentSpec
): number {
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return 0;
  const lots = riskMoney / (dist * spec.contractSize);
  return Math.max(0.01, Math.floor(lots * 100) / 100); // round down to 0.01
}
