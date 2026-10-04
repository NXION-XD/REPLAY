// ============================================================================
// Market-condition classifier — objective, configurable, causal.
// Combines ATR-percentile (volatility regime) + efficiency ratio (trend
// vs range) + EMA alignment (direction). Every label is derived from
// measurable quantities with user-visible thresholds.
// ============================================================================

import type { Candle } from './types';
import { atrSeries, efficiencyRatio, emaSeries, rollingPercentile } from './indicators';

export interface ConditionConfig {
  atrPeriod: number;
  atrPercentileWindow: number;
  /** ATR percentile thresholds */
  lowVolPct: number;   // below → 'low'
  highVolPct: number;  // above → 'high'
  extremeVolPct: number; // above → 'extreme'
  /** efficiency ratio */
  erLookback: number;
  erTrend: number;     // above → trending
  erRange: number;     // below → ranging
  emaFast: number;
  emaSlow: number;
}

export const DEFAULT_CONDITION_CONFIG: ConditionConfig = {
  atrPeriod: 14,
  atrPercentileWindow: 2000,
  lowVolPct: 0.25,
  highVolPct: 0.75,
  extremeVolPct: 0.95,
  erLookback: 20,
  erTrend: 0.35,
  erRange: 0.15,
  emaFast: 20,
  emaSlow: 50,
};

export type VolatilityRegime = 'low' | 'normal' | 'high' | 'extreme';
export type TrendState = 'bullish' | 'bearish' | 'neutral';
export type RangeState = 'trending' | 'ranging' | 'transition';

export interface ConditionSnapshot {
  volatility: VolatilityRegime;
  trend: TrendState;
  range: RangeState;
  atr: number;
  atrPercentile: number;
  er: number;
  label: string; // compact composite label
}

export class ConditionEngine {
  private atr: number[];
  private atrPct: number[];
  private er: number[];
  private emaFast: number[];
  private emaSlow: number[];
  private cfg: ConditionConfig;

  constructor(candles: Candle[], cfg: ConditionConfig) {
    this.cfg = cfg;
    this.atr = atrSeries(candles, cfg.atrPeriod);
    this.atrPct = rollingPercentile(this.atr.map((a) => (isNaN(a) ? 0 : a)), cfg.atrPercentileWindow);
    this.er = efficiencyRatio(candles.map((c) => c.c), cfg.erLookback);
    this.emaFast = emaSeries(candles, cfg.emaFast);
    this.emaSlow = emaSeries(candles, cfg.emaSlow);
  }

  at(i: number): ConditionSnapshot {
    const cfg = this.cfg;
    const atrP = this.atrPct[i];
    const er = this.er[i];
    const f = this.emaFast[i];
    const s = this.emaSlow[i];

    const volatility: VolatilityRegime = isNaN(atrP)
      ? 'normal'
      : atrP >= cfg.extremeVolPct ? 'extreme'
      : atrP >= cfg.highVolPct ? 'high'
      : atrP <= cfg.lowVolPct ? 'low' : 'normal';

    const trend: TrendState = isNaN(f) || isNaN(s) ? 'neutral' : f > s ? 'bullish' : f < s ? 'bearish' : 'neutral';
    const range: RangeState = isNaN(er) ? 'transition' : er >= cfg.erTrend ? 'trending' : er <= cfg.erRange ? 'ranging' : 'transition';

    return {
      volatility, trend, range,
      atr: this.atr[i], atrPercentile: atrP, er,
      label: `${trend}/${range}/${volatility}-vol`,
    };
  }

  atrAt(i: number): number {
    return this.atr[i];
  }
}
