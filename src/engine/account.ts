// ============================================================================
// Account + risk limits + prop-firm rule evaluation.
// ============================================================================

import type { AccountConfig, DayKey, PropFirmConfig, PropStatus, Trade } from './types';

export interface AccountState {
  balance: number;
  equity: number;
  peakBalance: number;
  drawdown: number;
  drawdownPct: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  tradesToday: number;
  consecLosses: number;
  /** risk currently tied up in open trades (sum of riskMoney) */
  usedRisk: number;
}

export interface LimitBreach {
  rule: string;
  detail: string;
}

export class Account {
  cfg: AccountConfig;
  balance: number;
  peak: number;
  private dayKey = '';
  private weekKey = '';
  private monthKey = '';
  private dayStartBalance: number;
  private weekStartBalance: number;
  private monthStartBalance: number;
  private tradesToday = 0;
  private consecLosses = 0;

  constructor(cfg: AccountConfig) {
    this.cfg = cfg;
    this.balance = cfg.initialBalance;
    this.peak = cfg.initialBalance;
    this.dayStartBalance = cfg.initialBalance;
    this.weekStartBalance = cfg.initialBalance;
    this.monthStartBalance = cfg.initialBalance;
  }

  /** roll calendar counters when the replay day/week/month changes */
  roll(day: DayKey, week: string, month: string): void {
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayStartBalance = this.balance;
      this.tradesToday = 0;
    }
    if (week !== this.weekKey) {
      this.weekKey = week;
      this.weekStartBalance = this.balance;
    }
    if (month !== this.monthKey) {
      this.monthKey = month;
      this.monthStartBalance = this.balance;
    }
  }

  onTradeClosed(t: Trade): void {
    this.balance += t.pnl - t.commission;
    this.peak = Math.max(this.peak, this.balance);
    this.tradesToday++;
    this.consecLosses = t.pnl - t.commission < 0 ? this.consecLosses + 1 : 0;
  }

  state(floatingPnl: number, usedRisk: number): AccountState {
    const equity = this.balance + floatingPnl;
    const dd = this.peak - this.balance;
    return {
      balance: this.balance,
      equity,
      peakBalance: this.peak,
      drawdown: dd,
      drawdownPct: this.peak > 0 ? dd / this.peak : 0,
      dailyPnl: this.balance - this.dayStartBalance,
      weeklyPnl: this.balance - this.weekStartBalance,
      monthlyPnl: this.balance - this.monthStartBalance,
      tradesToday: this.tradesToday,
      consecLosses: this.consecLosses,
      usedRisk,
    };
  }

  /** Rebuild account state from scratch after a replay rewind. */
  rebuildFromTrades(
    trades: { pnl: number; commission: number; exitTime?: number }[],
    uptoTime: number, tz: string,
    keysOf: (t: number) => { day: string; week: string; month: string }
  ): void {
    this.balance = this.cfg.initialBalance;
    this.peak = this.cfg.initialBalance;
    this.dayKey = ''; this.weekKey = ''; this.monthKey = '';
    this.dayStartBalance = this.balance;
    this.weekStartBalance = this.balance;
    this.monthStartBalance = this.balance;
    this.tradesToday = 0;
    this.consecLosses = 0;
    const sorted = trades
      .filter((t) => t.exitTime !== undefined && t.exitTime <= uptoTime)
      .sort((a, b) => a.exitTime! - b.exitTime!);
    for (const t of sorted) {
      const k = keysOf(t.exitTime!);
      this.roll(k.day, k.week, k.month);
      this.balance += t.pnl - t.commission;
      this.peak = Math.max(this.peak, this.balance);
      this.tradesToday++;
      this.consecLosses = t.pnl - t.commission < 0 ? this.consecLosses + 1 : 0;
    }
    // set calendar to the rewind point so the next trade rolls correctly
    const now = keysOf(uptoTime);
    if (now.day !== this.dayKey) this.roll(now.day, now.week, now.month);
    void tz;
  }

  /** check risk limits before opening a new trade — returns breaches */
  checkLimits(openTrades: number, exposureLots: number): LimitBreach[] {
    const out: LimitBreach[] = [];
    const c = this.cfg;
    const s = this.state(0, 0);
    if (c.maxDailyLossPct > 0 && s.dailyPnl <= -c.maxDailyLossPct / 100 * this.dayStartBalance && this.dayStartBalance > 0)
      out.push({ rule: 'maxDailyLoss', detail: `Daily P&L ${s.dailyPnl.toFixed(2)} beyond limit` });
    if (c.maxTradesPerDay > 0 && s.tradesToday >= c.maxTradesPerDay)
      out.push({ rule: 'maxTradesPerDay', detail: `${s.tradesToday} trades today` });
    if (c.maxConsecLosses > 0 && s.consecLosses >= c.maxConsecLosses)
      out.push({ rule: 'maxConsecLosses', detail: `${s.consecLosses} consecutive losses` });
    if (c.maxOpenTrades > 0 && openTrades >= c.maxOpenTrades)
      out.push({ rule: 'maxOpenTrades', detail: `${openTrades} open` });
    if (c.maxExposureLots > 0 && exposureLots >= c.maxExposureLots)
      out.push({ rule: 'maxExposure', detail: `${exposureLots} lots exposure` });
    return out;
  }
}

// ---------------------------------------------------------------------------

export interface PropState {
  status: PropStatus;
  profit: number;
  profitPct: number;
  remainingTarget: number;
  dailyDdUsedPct: number;
  maxDdUsedPct: number;
  tradingDays: number;
  violations: string[];
}

export class PropFirm {
  cfg: PropFirmConfig;
  status: PropStatus = 'ACTIVE';
  private startBalance: number;
  private dayStartEquity: number;
  private dayKey = '';
  private minEquity: number;
  private tradingDays = new Set<string>();
  private dailyProfits = new Map<string, number>();
  private violations: string[] = [];

  constructor(cfg: PropFirmConfig) {
    this.cfg = cfg;
    this.startBalance = cfg.startingBalance;
    this.dayStartEquity = cfg.startingBalance;
    this.minEquity = cfg.startingBalance;
  }

  update(day: DayKey, equity: number, balance: number): PropState {
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayStartEquity = equity;
    }
    if (equity !== this.dayStartEquity || true) {
      this.minEquity = Math.min(this.minEquity, equity);
    }
    const dailyDd = this.dayStartEquity > 0 ? (this.dayStartEquity - equity) / this.dayStartEquity : 0;
    const maxDd = this.startBalance > 0 ? (this.startBalance - this.minEquity) / this.startBalance : 0;
    const profit = balance - this.startBalance;
    const profitPct = this.startBalance > 0 ? profit / this.startBalance : 0;

    if (this.status === 'ACTIVE') {
      if (this.cfg.dailyDrawdownPct > 0 && dailyDd * 100 >= this.cfg.dailyDrawdownPct) {
        this.status = 'FAILED';
        this.violations.push(`Daily drawdown limit hit (${(dailyDd * 100).toFixed(2)}% ≥ ${this.cfg.dailyDrawdownPct}%)`);
      }
      if (this.cfg.maxDrawdownPct > 0 && maxDd * 100 >= this.cfg.maxDrawdownPct) {
        this.status = 'FAILED';
        this.violations.push(`Max drawdown limit hit (${(maxDd * 100).toFixed(2)}% ≥ ${this.cfg.maxDrawdownPct}%)`);
      }
      if (profitPct * 100 >= this.cfg.profitTargetPct) {
        if (this.tradingDays.size >= this.cfg.minTradingDays) {
          this.status = 'PASSED';
        }
      }
    }
    return this.state(equity, balance, dailyDd, maxDd);
  }

  onTradeClosed(day: DayKey, pnl: number): void {
    this.tradingDays.add(day);
    this.dailyProfits.set(day, (this.dailyProfits.get(day) ?? 0) + pnl);
    if (this.status === 'ACTIVE' && this.cfg.consistencyPct > 0) {
      const total = [...this.dailyProfits.values()].filter((x) => x > 0).reduce((a, b) => a + b, 0);
      const best = Math.max(...this.dailyProfits.values(), 0);
      if (total > 0 && (best / total) * 100 > this.cfg.consistencyPct) {
        const msg = `Consistency: best day is ${((best / total) * 100).toFixed(0)}% of total profit (limit ${this.cfg.consistencyPct}%)`;
        if (!this.violations.includes(msg)) this.violations.push(msg);
      }
    }
  }

  checkOrderAllowed(lots: number): string | null {
    if (!this.cfg.enabled) return null;
    if (this.status !== 'ACTIVE') return `Challenge ${this.status}`;
    if (this.cfg.maxPositionLots > 0 && lots > this.cfg.maxPositionLots)
      return `Position ${lots} lots exceeds max ${this.cfg.maxPositionLots}`;
    return null;
  }

  private state(_equity: number, balance: number, dailyDd: number, maxDd: number): PropState {
    const profit = balance - this.startBalance;
    return {
      status: this.status,
      profit,
      profitPct: this.startBalance > 0 ? (profit / this.startBalance) * 100 : 0,
      remainingTarget: Math.max(0, (this.cfg.profitTargetPct / 100) * this.startBalance - profit),
      dailyDdUsedPct: dailyDd * 100,
      maxDdUsedPct: maxDd * 100,
      tradingDays: this.tradingDays.size,
      violations: [...this.violations],
    };
  }
}
