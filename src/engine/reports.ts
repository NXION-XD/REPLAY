// ============================================================================
// Period reports: daily / weekly / monthly analysis + configurable
// good/bad/flat day classification. All derived from closed trades.
// ============================================================================

import type { Trade } from './types';
import { coreStats, groupBy } from './stats';
import type { CoreStats, GroupStats } from './stats';
import { parts, weekKey, monthKey } from './tz';

export interface DayReport {
  dayKey: string;
  stats: CoreStats;
  netPnl: number;
  netR: number;
  bestTrade?: Trade;
  worstTrade?: Trade;
  bySession: GroupStats[];
  byStrategy: GroupStats[];
  ruleViolations: number; // trades whose verdict was REJECTED
  classification: 'positive' | 'negative' | 'flat';
  quality: 'high' | 'normal' | 'low';
}

export interface ReportThresholds {
  goodDayMinR: number;   // netR >= → positive day (user-defined)
  flatDayAbsR: number;   // |netR| below → flat
  highQualityMinTrades: number;
  highQualityMinWinRate: number;
}

export const DEFAULT_THRESHOLDS: ReportThresholds = {
  goodDayMinR: 2,
  flatDayAbsR: 0.25,
  highQualityMinTrades: 3,
  highQualityMinWinRate: 0.6,
};

const net = (t: Trade) => t.pnl - t.commission;

export function dayReports(trades: Trade[], tz: string, th: ReportThresholds = DEFAULT_THRESHOLDS): DayReport[] {
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = parts(t.entryTime, tz).dayKey;
    const arr = byDay.get(k) ?? [];
    arr.push(t);
    byDay.set(k, arr);
  }
  const out: DayReport[] = [];
  byDay.forEach((arr, dayKey) => {
    const stats = coreStats(arr);
    const netR = arr.reduce((s, t) => s + t.r, 0);
    const sorted = [...arr].sort((a, b) => net(b) - net(a));
    const winRateOk = stats.winRate >= th.highQualityMinWinRate;
    out.push({
      dayKey,
      stats,
      netPnl: stats.netProfit,
      netR,
      bestTrade: sorted[sorted.length - 1],
      worstTrade: sorted[0],
      bySession: groupBy(arr, (t) => t.session || 'none'),
      byStrategy: groupBy(arr, (t) => t.meta.strategyName || 'unassigned'),
      ruleViolations: arr.filter((t) => t.verdict === 'REJECTED').length,
      classification: netR >= th.goodDayMinR ? 'positive' : Math.abs(netR) < th.flatDayAbsR ? 'flat' : 'negative',
      quality: arr.length >= th.highQualityMinTrades && winRateOk ? 'high' : arr.length >= th.highQualityMinTrades ? 'normal' : 'low',
    });
  });
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

export interface PeriodReport {
  key: string;
  stats: CoreStats;
  netR: number;
  bestDay?: string;
  worstDay?: string;
  bestSession?: string;
  worstSession?: string;
  bestSetup?: string;
  worstSetup?: string;
  byDay: GroupStats[];
  bySession: GroupStats[];
  bySetup: GroupStats[];
}

export function periodReports(
  trades: Trade[], tz: string, period: 'week' | 'month'
): PeriodReport[] {
  const keyFn = period === 'week' ? weekKey : monthKey;
  const byPeriod = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t.entryTime, tz);
    const arr = byPeriod.get(k) ?? [];
    arr.push(t);
    byPeriod.set(k, arr);
  }
  const out: PeriodReport[] = [];
  byPeriod.forEach((arr, key) => {
    const stats = coreStats(arr);
    const byDay = groupBy(arr, (t) => parts(t.entryTime, tz).dayKey);
    const bySession = groupBy(arr, (t) => t.session || 'none');
    const bySetup = groupBy(arr, (t) => t.meta.setup || t.meta.strategyName || 'unassigned');
    const best = (gs: GroupStats[]) => [...gs].sort((a, b) => b.netPnl - a.netPnl)[0]?.key;
    const worst = (gs: GroupStats[]) => [...gs].sort((a, b) => a.netPnl - b.netPnl)[0]?.key;
    out.push({
      key,
      stats,
      netR: arr.reduce((s, t) => s + t.r, 0),
      bestDay: best(byDay), worstDay: worst(byDay),
      bestSession: best(bySession), worstSession: worst(bySession),
      bestSetup: best(bySetup), worstSetup: worst(bySetup),
      byDay, bySession, bySetup,
    });
  });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Calendar cells for the calendar view */
export interface CalendarCell {
  dayKey: string;
  pnl: number;
  r: number;
  trades: number;
  winRate: number;
  classification: DayReport['classification'];
}

export function calendarCells(trades: Trade[], tz: string, th: ReportThresholds = DEFAULT_THRESHOLDS): CalendarCell[] {
  return dayReports(trades, tz, th).map((d) => ({
    dayKey: d.dayKey,
    pnl: d.netPnl,
    r: d.netR,
    trades: d.stats.trades,
    winRate: d.stats.winRate,
    classification: d.classification,
  }));
}
