// ============================================================================
// Lab — the central orchestrator: dataset + replay cursor + all engines.
//
// NO LOOK-AHEAD CONTRACT:
//  - The chart and every consumer only receive candles[0..cursor].
//  - HTF bias uses only HTF candles whose bucket CLOSED before time t.
//  - Structure/swing events are timestamped at confirmation index.
//  - Session highs/lows are tracked incrementally from seen candles only.
//  - Statistics are computed from closed trades only.
// ============================================================================

import { XAUUSD_SPEC, tfSeconds } from './types';
import type { AccountConfig, Candle, ExecutionConfig, InstrumentSpec, PropFirmConfig, SessionDef, TimeframeId } from './types';
import { aggregate, bucketStart } from './timeframes';
import { Account, PropFirm } from './account';
import { Broker } from './broker';
import type { TradeRecord } from './broker';
import { SessionTracker, DEFAULT_SESSIONS, sessionAt } from './sessions';
import { ConditionEngine, DEFAULT_CONDITION_CONFIG } from './conditions';
import type { ConditionConfig } from './conditions';
import { detectStructure, detectFvgs, detectSweep, fvgStatusAt } from './structure';
import type { StructureConfig, StructureEvent, Fvg, SweepEvent } from './structure';
import { emaSeries } from './indicators';
import type { SwingPoint } from './indicators';
import { evaluateStrategy } from './rules';
import type { RuleContext, StrategyProfile, RuleVerdict } from './rules';
import { parts, monthKey, weekKey } from './tz';

export interface Dataset {
  id: string;
  symbol: string;
  baseTf: TimeframeId;
  candles: Candle[];
  spreads: (number | undefined)[];
  spec: InstrumentSpec;
  importedAt: number;
}

export interface LabSettings {
  timezone: string;
  sessions: SessionDef[];
  structure: StructureConfig;
  fvgMinPoints: number;
  condition: ConditionConfig;
  sweepWindowCandles: number;
  equalLevelTolerancePoints: number;
  htfPrimary: TimeframeId;
  htfSecondary: TimeframeId;
  /** ghost future candles on chart (display only, off by default) */
  showFutureGhost: boolean;
  goodDayMinR: number; // user-defined "good day" threshold in R
  flatDayAbsR: number; // |R| below → flat day
}

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  timezone: 'UTC',
  sessions: DEFAULT_SESSIONS,
  structure: { left: 2, right: 2, closeBreaks: false },
  fvgMinPoints: 10,
  condition: DEFAULT_CONDITION_CONFIG,
  sweepWindowCandles: 48,
  equalLevelTolerancePoints: 15,
  htfPrimary: '4h',
  htfSecondary: '1h',
  showFutureGhost: false,
  goodDayMinR: 2,
  flatDayAbsR: 0.25,
};

export type LabListener = () => void;

export class Lab {
  dataset: Dataset | null = null;
  settings: LabSettings = { ...DEFAULT_LAB_SETTINGS };

  // replay state
  cursor = -1; // index of latest visible candle (-1 = none)
  playing = false;
  speedCps = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  // engines (rebuilt on dataset/settings change)
  private condition: ConditionEngine | null = null;
  private structureEvents: StructureEvent[] = [];
  private swings: SwingPoint[] = [];
  private fvgs: Fvg[] = [];
  private htfCache = new Map<TimeframeId, Candle[]>();
  private htfBiasCache = new Map<TimeframeId, { emaFast: number[]; emaSlow: number[] }>();
  private sessionTracker: SessionTracker | null = null;
  private sweepEvents: SweepEvent[] = [];
  private swingIdxByConfirm: number[] = []; // count of swings confirmed ≤ i (prefix)
  private emaFastBase: number[] = [];
  private emaSlowBase: number[] = [];
  /** incremental day/week level state — O(1) per candle, no backward scans */
  private lvlState: {
    dayKey: string; weekKey: string;
    curDayH?: number; curDayL?: number;
    prevDayH?: number; prevDayL?: number;
    curWeekH?: number; curWeekL?: number;
    prevWeekH?: number; prevWeekL?: number;
  } | null = null;

  broker: Broker;
  account: Account;
  prop: PropFirm | null = null;
  execution: ExecutionConfig = {
    mode: 'realistic', spreadPoints: 20, commissionPerLot: 7, slippagePoints: 2, sameCandleRule: 'sl_first',
  };
  accountCfg: AccountConfig = {
    initialBalance: 10000, currency: 'USD', riskPerTradePct: 1, maxDailyLossPct: 5,
    maxWeeklyLossPct: 10, maxMonthlyLossPct: 20, maxTradesPerDay: 10, maxConsecLosses: 5,
    maxOpenTrades: 3, maxExposureLots: 5,
  };

  private listeners = new Set<LabListener>();
  /** monotonically increasing version, bumped on every state change */
  version = 0;

  constructor() {
    this.broker = new Broker(this.execution, XAUUSD_SPEC);
    this.account = new Account(this.accountCfg);
  }

  /** force a state broadcast (after broker mutations outside candle ticks) */
  notify(): void {
    this.emit();
  }

  // ---------------- subscription ----------------

  subscribe(fn: LabListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ---------------- dataset ----------------

  setDataset(ds: Dataset): void {
    this.pause();
    this.dataset = ds;
    this.cursor = -1;
    this.htfCache.clear();
    this.htfBiasCache.clear();
    this.broker = new Broker(this.execution, ds.spec);
    this.account = new Account(this.accountCfg);
    this.prop = null;
    this.rebuildEngines();
    this.emit();
  }

  setExecution(cfg: ExecutionConfig): void {
    this.execution = cfg;
    this.broker.setExecutionConfig(cfg);
    this.emit();
  }

  setAccountCfg(cfg: AccountConfig): void {
    this.accountCfg = cfg;
    this.emit();
  }

  enablePropFirm(cfg: PropFirmConfig | null): void {
    this.prop = cfg ? new PropFirm(cfg) : null;
    this.emit();
  }

  updateSettings(patch: Partial<LabSettings>): void {
    const rebuild = patch.structure !== undefined || patch.condition !== undefined ||
      patch.fvgMinPoints !== undefined || patch.sessions !== undefined || patch.timezone !== undefined;
    this.settings = { ...this.settings, ...patch };
    if (rebuild) {
      this.rebuildEngines();
      this.replayTo(this.cursor, true); // re-sync trackers up to cursor
    }
    this.emit();
  }

  private rebuildEngines(): void {
    if (!this.dataset) return;
    const candles = this.dataset.candles;
    this.condition = new ConditionEngine(candles, this.settings.condition);
    const st = detectStructure(candles, this.settings.structure);
    this.structureEvents = st.events;
    this.swings = st.swings;
    this.fvgs = detectFvgs(candles, { minSizePoints: this.settings.fvgMinPoints, point: this.dataset.spec.point });
    // prefix counts of structure events/swings by confirmation index
    this.swingIdxByConfirm = new Array(candles.length).fill(0);
    for (const s of this.swings) if (s.confirmedAt < candles.length) this.swingIdxByConfirm[s.confirmedAt]++;
    for (let i = 1; i < candles.length; i++) this.swingIdxByConfirm[i] += this.swingIdxByConfirm[i - 1];
    this.sessionTracker = new SessionTracker(this.settings.timezone, this.settings.sessions);
    this.sweepEvents = [];
    this.lvlState = { dayKey: '', weekKey: '' };
  }

  // ---------------- replay ----------------

  get candleCount(): number {
    return this.dataset?.candles.length ?? 0;
  }

  currentCandle(): Candle | null {
    if (!this.dataset || this.cursor < 0) return null;
    return this.dataset.candles[this.cursor];
  }

  /** visible candles = candles[0..cursor] — the ONLY data consumers may see */
  visibleCandles(): Candle[] {
    if (!this.dataset || this.cursor < 0) return [];
    return this.dataset.candles.slice(0, this.cursor + 1);
  }

  play(): void {
    if (!this.dataset || this.playing) return;
    this.playing = true;
    const tfSec = tfSeconds(this.dataset.baseTf);
    this.scheduleTimer(tfSec);
    this.emit();
  }

  private scheduleTimer(tfSec: number): void {
    if (this.timer) clearInterval(this.timer);
    const msPerCandle = (tfSec * 1000) / this.speedCps;
    if (msPerCandle >= 40) {
      this.timer = setInterval(() => this.tick(1), msPerCandle);
    } else {
      // multiple candles per 40ms tick
      const perTick = Math.max(1, Math.round(40 / msPerCandle));
      this.timer = setInterval(() => this.tick(perTick), 40);
    }
  }

  private tick(steps: number): void {
    if (!this.playing || !this.dataset) return;
    for (let i = 0; i < steps; i++) {
      if (!this.stepForwardInternal()) {
        this.pause();
        return;
      }
    }
    this.emit();
  }

  pause(): void {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit();
  }

  setSpeed(cps: number): void {
    this.speedCps = cps;
    if (this.playing && this.dataset) this.scheduleTimer(tfSeconds(this.dataset.baseTf));
    this.emit();
  }

  stepForward(): boolean {
    const ok = this.stepForwardInternal();
    this.emit();
    return ok;
  }

  stepBack(): boolean {
    if (this.cursor <= 0) return false;
    this.replayTo(this.cursor - 1);
    this.emit();
    return true;
  }

  /** Move cursor, rebuilding incremental state to remain causal. */
  replayTo(index: number, silent = false): void {
    if (!this.dataset) return;
    const target = Math.max(-1, Math.min(index, this.dataset.candles.length - 1));
    // stepping back invalidates broker/account/session state → full resync
    this.resyncTo(target);
    if (!silent) this.emit();
  }

  seekToTime(t: number): void {
    if (!this.dataset) return;
    const candles = this.dataset.candles;
    // binary search: last candle with time <= t
    let lo = 0, hi = candles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    this.replayTo(ans);
  }

  randomStart(): number {
    if (!this.dataset || this.dataset.candles.length < 100) return -1;
    const idx = Math.floor(Math.random() * (this.dataset.candles.length - 100));
    this.replayTo(idx);
    return idx;
  }

  randomSessionStart(): number {
    if (!this.dataset) return -1;
    for (let tries = 0; tries < 50; tries++) {
      const idx = this.randomStart();
      if (idx < 0) return -1;
      const s = sessionAt(this.dataset.candles[idx].t, this.settings.timezone, this.settings.sessions);
      if (s) return idx;
    }
    return this.cursor;
  }

  /**
   * Full causal resync: reset incremental engines and replay candles 0..target
   * through the session tracker and sweep detector. Trades entered AFTER the
   * target time belong to a rewritten future and are discarded; trades opened
   * before and still open are flattened at the target candle's close; account
   * and prop-firm state are rebuilt from surviving closed trades.
   */
  private resyncTo(target: number): void {
    if (!this.dataset) return;
    const candles = this.dataset.candles;
    const targetTime = target >= 0 ? candles[target].t : -1;

    // 1) drop trades from the "future"
    this.broker.closed = this.broker.closed.filter((t) => t.entryTime <= targetTime);
    this.broker.orders = this.broker.orders.filter((o) => o.createdAt <= targetTime);
    for (const tr of [...this.broker.open]) {
      if (tr.entryTime > targetTime) {
        this.broker.open = this.broker.open.filter((x) => x.id !== tr.id);
      } else if (target >= 0) {
        // flatten survivors at the target candle close (mid)
        this.broker.closeTrade(tr.id, 1, 'replay_end', targetTime, candles[target].c);
      }
    }

    // 2) rebuild account + prop from surviving trades
    this.account = new Account(this.accountCfg);
    this.account.rebuildFromTrades(this.broker.closed, targetTime, this.settings.timezone, (t) => ({
      day: parts(t, this.settings.timezone).dayKey,
      week: weekKey(t, this.settings.timezone),
      month: monthKey(t, this.settings.timezone),
    }));
    if (this.prop) {
      const cfg = this.prop.cfg;
      const np = new PropFirm(cfg);
      const byDay = new Map<string, number>();
      for (const t of this.broker.closed) {
        if (t.exitTime === undefined) continue;
        const dk = parts(t.exitTime, this.settings.timezone).dayKey;
        byDay.set(dk, (byDay.get(dk) ?? 0) + (t.pnl - t.commission));
      }
      byDay.forEach((pnl, day) => np.onTradeClosed(day, pnl));
      this.prop = np;
    }

    // 3) rebuild incremental market engines causally
    this.sessionTracker = new SessionTracker(this.settings.timezone, this.settings.sessions);
    this.sweepEvents = [];
    this.lvlState = { dayKey: '', weekKey: '' };
    this.cursor = -1;
    for (let i = 0; i <= target; i++) this.advanceOne(candles[i], i, false);
    this.cursor = target;
  }

  private stepForwardInternal(): boolean {
    if (!this.dataset || this.cursor >= this.dataset.candles.length - 1) return false;
    this.cursor++;
    this.advanceOne(this.dataset.candles[this.cursor], this.cursor, true);
    return true;
  }

  /** feed one candle into incremental engines; broker only when live */
  private advanceOne(c: Candle, i: number, live: boolean): void {
    this.sessionTracker?.push(c);
    this.pushLevelState(c);
    // sweep detection against known levels
    const levels = this.levelsFromState(c.t);
    for (const [id, lvl] of Object.entries(levels)) {
      if (lvl === undefined) continue;
      const kind = id.toLowerCase().includes('high') ? 'high' : 'low';
      const ev = detectSweep(this.dataset!.candles, i, lvl, kind, id);
      if (ev) this.sweepEvents.push(ev);
    }
    if (live) {
      this.broker.processCandle(c, i);
      // account calendar roll
      const p = parts(c.t, this.settings.timezone);
      this.account.roll(p.dayKey, weekKey(c.t, this.settings.timezone), monthKey(c.t, this.settings.timezone));
      // close events → account + prop
      for (const ev of this.broker.events.splice(0)) {
        if (ev.type === 'closed' && ev.trade) {
          ev.trade.backtestId = this.activeBacktestId;
          this.account.onTradeClosed(ev.trade);
          this.prop?.onTradeClosed(p.dayKey, ev.trade.pnl - ev.trade.commission);
        }
      }
      if (this.prop) {
        const eq = this.account.balance + this.broker.floatingPnl(c);
        this.prop.update(p.dayKey, eq, this.account.balance);
      }
    } else {
      this.broker.events.length = 0;
    }
  }

  activeBacktestId = '';

  // ---------------- derived context (all causal) ----------------

  htfCandles(tf: TimeframeId): Candle[] {
    if (!this.dataset) return [];
    let arr = this.htfCache.get(tf);
    if (!arr) {
      arr = aggregate(this.dataset.candles, tf);
      this.htfCache.set(tf, arr);
    }
    return arr;
  }

  /**
   * HTF candles visible at current cursor: closed candles with bucket end <= t,
   * plus the forming candle aggregated from visible base candles only.
   */
  htfVisible(tf: TimeframeId): Candle[] {
    if (!this.dataset || this.cursor < 0) return [];
    const step = tfSeconds(tf);
    const baseStep = tfSeconds(this.dataset.baseTf);
    if (baseStep >= step) return this.visibleCandles();
    const t = this.dataset.candles[this.cursor].t;
    const all = this.htfCandles(tf);
    const curBucket = bucketStart(t, step);
    // closed: bucket start < current bucket start
    let hi = all.length - 1, lo = 0, lastClosed = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mc = all[mid]!; if (mc.t < curBucket) { lastClosed = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const closed = all.slice(0, lastClosed + 1);
    // forming: aggregate base candles in [curBucket..t]
    const base = this.dataset.candles;
    let start = this.cursor;
    while (start > 0 && base[start - 1]!.t >= curBucket) start--;
    if (start <= this.cursor) {
      let o = base[start]!.o, h = -Infinity, l = Infinity, cc = base[this.cursor]!.c, v = 0;
      for (let i = start; i <= this.cursor; i++) {
        h = Math.max(h, base[i]!.h);
        l = Math.min(l, base[i]!.l);
        if (base[i]!.v) v += base[i]!.v ?? 0;
      }
      closed.push({ t: curBucket, o, h, l, c: cc, v: v || undefined });
    }
    return closed;
  }

  private htfBiasAt(tf: TimeframeId): 'bullish' | 'bearish' | 'neutral' {
    if (!this.dataset || this.cursor < 0) return 'neutral';
    const vis = this.htfVisible(tf).filter((c) => c.t < bucketStart(this.dataset!.candles[this.cursor].t, tfSeconds(tf)));
    // use closed candles only for bias
    const closedOnly = this.htfCandles(tf).filter((c) => c.t + tfSeconds(tf) <= this.dataset!.candles[this.cursor].t);
    const arr = closedOnly.length > 0 ? closedOnly : vis;
    if (arr.length < 60) return 'neutral';
    const key = tf;
    let cache = this.htfBiasCache.get(key);
    if (!cache) {
      const full = this.htfCandles(tf);
      cache = { emaFast: emaSeries(full, 20), emaSlow: emaSeries(full, 50) };
      this.htfBiasCache.set(key, cache);
    }
    // index of last closed candle in the FULL htf array
    const lastT = arr[arr.length - 1].t;
    const full = this.htfCandles(tf);
    let idx = -1;
    let lo = 0, hi = full.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (full[mid].t <= lastT) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return 'neutral';
    const f = cache.emaFast[idx], s = cache.emaSlow[idx];
    if (isNaN(f) || isNaN(s)) return 'neutral';
    if (f > s) return 'bullish';
    if (f < s) return 'bearish';
    return 'neutral';
  }

  /**
   * Liquidity levels at the current cursor. Maintained incrementally by
   * advanceOne — O(1) per candle, causal (only seen candles contribute).
   */
  currentLiquidityLevels(): Record<string, number | undefined> {
    if (!this.dataset || this.cursor < 0 || !this.lvlState) return {};
    return this.levelsFromState(this.dataset.candles[this.cursor].t);
  }

  /** O(1) day/week high-low tracker; previous periods roll over on boundary. */
  private pushLevelState(c: Candle): void {
    if (!this.lvlState) this.lvlState = { dayKey: '', weekKey: '' };
    const tz = this.settings.timezone;
    const p = parts(c.t, tz);
    const wk = weekKey(c.t, tz);
    const s = this.lvlState;
    if (s.dayKey !== p.dayKey) {
      if (s.dayKey !== '') { s.prevDayH = s.curDayH; s.prevDayL = s.curDayL; }
      s.dayKey = p.dayKey;
      s.curDayH = c.h; s.curDayL = c.l;
    } else {
      s.curDayH = Math.max(s.curDayH!, c.h);
      s.curDayL = Math.min(s.curDayL!, c.l);
    }
    if (s.weekKey !== wk) {
      if (s.weekKey !== '') { s.prevWeekH = s.curWeekH; s.prevWeekL = s.curWeekL; }
      s.weekKey = wk;
      s.curWeekH = c.h; s.curWeekL = c.l;
    } else {
      s.curWeekH = Math.max(s.curWeekH!, c.h);
      s.curWeekL = Math.min(s.curWeekL!, c.l);
    }
  }

  private levelsFromState(t: number): Record<string, number | undefined> {
    const s = this.lvlState;
    if (!s) return {};
    const snap = this.sessionTracker?.snapshot();
    const asia = snap?.active.find((a) => a.sessionId === 'asia') ?? this.lastCompletedBefore('asia');
    const curSession = sessionAt(t, this.settings.timezone, this.settings.sessions);
    const curSess = curSession ? snap?.active.find((a) => a.sessionId === curSession.id) : undefined;
    return {
      prevDayHigh: s.prevDayH, prevDayLow: s.prevDayL,
      prevWeekHigh: s.prevWeekH, prevWeekLow: s.prevWeekL,
      asiaHigh: asia?.high, asiaLow: asia?.low,
      sessionHigh: curSess?.high, sessionLow: curSess?.low,
      dayHigh: s.curDayH, dayLow: s.curDayL,
    };
  }

  private lastCompletedBefore(sessionId: string) {
    return this.sessionTracker?.lastCompleted(sessionId);
  }

  recentSweeps(windowCandles?: number): SweepEvent[] {
    const w = windowCandles ?? this.settings.sweepWindowCandles;
    return this.sweepEvents.filter((e) => e.at > this.cursor - w && e.at <= this.cursor);
  }

  recentStructure(types: StructureEvent['type'][], windowCandles = 48): StructureEvent[] {
    return this.structureEvents.filter(
      (e) => types.includes(e.type) && e.at <= this.cursor && e.at > this.cursor - windowCandles
    );
  }

  visibleFvgs(maxAge = 500): Fvg[] {
    if (!this.dataset) return [];
    const from = Math.max(0, this.cursor - maxAge);
    return this.fvgs
      .filter((f) => f.at >= from && f.at <= this.cursor)
      .map((f) => fvgStatusAt(f, this.dataset!.candles, this.cursor))
      .filter((f) => !f.filled);
  }

  visibleSwings(maxCount = 20): SwingPoint[] {
    if (this.cursor < 0) return [];
    const count = this.swingIdxByConfirm[this.cursor];
    return this.swings.slice(Math.max(0, count - maxCount), count);
  }

  conditionAt(i?: number) {
    const idx = i ?? this.cursor;
    return this.condition?.at(idx) ?? null;
  }

  sessionNow() {
    const c = this.currentCandle();
    if (!c) return null;
    return sessionAt(c.t, this.settings.timezone, this.settings.sessions);
  }

  /** Build the rule context for the trade panel / checklist. */
  buildRuleContext(rr = 0, slDistancePoints = 0): RuleContext | null {
    const c = this.currentCandle();
    if (!c || !this.dataset) return null;
    const cond = this.conditionAt()!;
    const p = parts(c.t, this.settings.timezone);
    const sweeps = this.recentSweeps();
    const struct = this.recentStructure(['CHOCH_UP', 'CHOCH_DOWN', 'BOS_UP', 'BOS_DOWN']);
    const fvgs = this.visibleFvgs();
    const spread = this.dataset.spreads[this.cursor];
    const ef = this.emaFastBase[this.cursor];
    const es = this.emaSlowBase[this.cursor];
    return {
      session: this.sessionNow()?.id ?? 'none',
      minutesIntoSession: (() => {
        const s = this.sessionNow();
        if (!s) return 0;
        const m = p.minOfDay;
        if (s.startMin <= s.endMin) return m - s.startMin;
        return m >= s.startMin ? m - s.startMin : 1440 - s.startMin + m;
      })(),
      hour: p.hour,
      minute: p.minute,
      dayOfWeek: p.weekday,
      htfBias: this.htfBiasAt(this.settings.htfPrimary),
      htfBiasSecondary: this.htfBiasAt(this.settings.htfSecondary),
      sweptAsiaHigh: sweeps.some((s) => s.levelId === 'asiaHigh'),
      sweptAsiaLow: sweeps.some((s) => s.levelId === 'asiaLow'),
      sweptPrevDayHigh: sweeps.some((s) => s.levelId === 'prevDayHigh'),
      sweptPrevDayLow: sweeps.some((s) => s.levelId === 'prevDayLow'),
      mssUp: struct.some((e) => e.type === 'CHOCH_UP'),
      mssDown: struct.some((e) => e.type === 'CHOCH_DOWN'),
      bosUp: struct.some((e) => e.type === 'BOS_UP'),
      bosDown: struct.some((e) => e.type === 'BOS_DOWN'),
      fvgBullish: fvgs.some((f) => f.direction === 'bullish' && Math.abs(f.top - c.c) / (cond.atr || 1) < 3),
      fvgBearish: fvgs.some((f) => f.direction === 'bearish' && Math.abs(f.bottom - c.c) / (cond.atr || 1) < 3),
      insideFvg: fvgs.some((f) => c.c <= f.top && c.c >= f.bottom),
      trend: cond.trend,
      rangeState: cond.range,
      volatility: cond.volatility,
      atr: cond.atr,
      atrPercentile: cond.atrPercentile,
      rr,
      slDistancePoints,
      priceAboveFastEma: isNaN(ef) ? false : c.c > ef,
      priceAboveSlowEma: isNaN(es) ? false : c.c > es,
      spreadPoints: spread ?? this.execution.spreadPoints,
    };
  }

  evaluateStrategy(strategy: StrategyProfile, rr = 0, slDistancePoints = 0): RuleVerdict {
    return evaluateStrategy(strategy.tree, this.buildRuleContext(rr, slDistancePoints), strategy.gradeA, strategy.gradeB);
  }

  /** closed + open trades for stats */
  allTrades(): TradeRecord[] {
    return this.broker.closed;
  }

  // ---------------- chart-facing getters ----------------

  emaAt(i: number, which: 'fast' | 'slow'): number {
    const arr = which === 'fast' ? this.emaFastBase : this.emaSlowBase;
    return arr[i] ?? NaN;
  }

  get emaPeriods(): { fast: number; slow: number } {
    return { fast: this.settings.condition.emaFast, slow: this.settings.condition.emaSlow };
  }

  sessionSnapshot() {
    return this.sessionTracker?.snapshot() ?? { active: [], completed: [] };
  }

  spreadAt(i?: number): number | undefined {
    return this.dataset?.spreads[i ?? this.cursor];
  }

  get sweeps(): SweepEvent[] {
    return this.sweepEvents;
  }

  get structure(): StructureEvent[] {
    return this.structureEvents;
  }

  get spec(): InstrumentSpec {
    return this.dataset?.spec ?? XAUUSD_SPEC;
  }
}
