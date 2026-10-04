// ============================================================================
// Shared engine types. Pure TypeScript — no DOM, no React. Unit-testable.
// ============================================================================

/** A single OHLC(V) candle. `t` = bucket START time as unix seconds (UTC). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export type TimeframeId = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface TimeframeDef {
  id: TimeframeId;
  seconds: number;
  label: string;
}

export const TIMEFRAMES: TimeframeDef[] = [
  { id: '1m', seconds: 60, label: '1m' },
  { id: '3m', seconds: 180, label: '3m' },
  { id: '5m', seconds: 300, label: '5m' },
  { id: '15m', seconds: 900, label: '15m' },
  { id: '30m', seconds: 1800, label: '30m' },
  { id: '1h', seconds: 3600, label: '1H' },
  { id: '4h', seconds: 14400, label: '4H' },
  { id: '1d', seconds: 86400, label: '1D' },
];

export const tfSeconds = (id: TimeframeId): number =>
  TIMEFRAMES.find((t) => t.id === id)!.seconds;

/** Instrument specification — drives point/pip math and money conversion. */
export interface InstrumentSpec {
  symbol: string;
  /** decimal places for price display */
  digits: number;
  /** size of one "point" in price units (XAU: 0.01, EURUSD: 0.00001) */
  point: number;
  /** "pip" size in price units (XAU: 0.1, EURUSD: 0.0001) */
  pip: number;
  /** units per 1.00 lot (XAU: 100 oz, FX: 100000 base units) */
  contractSize: number;
  currency: string;
}

export const XAUUSD_SPEC: InstrumentSpec = {
  symbol: 'XAUUSD',
  digits: 2,
  point: 0.01,
  pip: 0.1,
  contractSize: 100,
  currency: 'USD',
};

export type Direction = 'long' | 'short';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'cancelled';
export type TradeStatus = 'open' | 'closed';
export type ExitReason =
  | 'tp'
  | 'sl'
  | 'manual'
  | 'breakeven'
  | 'trailing'
  | 'partial'
  | 'session_end'
  | 'replay_end';

export interface PendingOrder {
  id: string;
  type: 'limit' | 'stop';
  direction: Direction;
  price: number;
  lots: number;
  sl?: number;
  tp?: number;
  createdAt: number;
  status: OrderStatus;
  comment?: string;
  /** strategy/checklist snapshot at creation */
  meta?: TradeMeta;
}

export interface TradeMeta {
  strategyId?: string;
  strategyName?: string;
  setup?: string;
  tags: string[];
  mistakes: string[];
  emotionBefore?: string;
  emotionAfter?: string;
  confidence?: number; // 1-10
  planFollowed?: boolean;
  notes?: string;
  checklistScore?: number; // user-defined score 0..N
  checklistGrade?: string;
  wouldTakeAgain?: boolean;
}

export interface Trade {
  id: string;
  backtestId: string;
  direction: Direction;
  status: TradeStatus;
  entryTime: number;
  entryPrice: number;
  lots: number;
  initialLots: number;
  sl: number;
  tp: number;
  exitTime?: number;
  exitPrice?: number;
  exitReason?: ExitReason;
  /** realized pnl in account currency (after commission, includes partials) */
  pnl: number;
  commission: number;
  /** risk in account currency at entry (entry→SL distance) */
  riskMoney: number;
  /** realized R multiple (pnl / riskMoney) */
  r: number;
  mfe: number; // max favorable excursion in price units
  mae: number; // max adverse excursion in price units (positive number)
  mfeTime?: number;
  maeTime?: number;
  /** post-entry candle path {h,l} pairs for what-if resimulation (capped) */
  path: { h: number; l: number }[];
  session: string;
  condition: string; // market condition label at entry
  htfBias: string;
  entryTf: TimeframeId;
  meta: TradeMeta;
  /** decision of the rule engine at entry time */
  verdict?: 'ACCEPTED' | 'REJECTED' | 'WARNING';
  slMoved: boolean;
  tpMoved: boolean;
  breakEvenAt?: number;
  trailingActive: boolean;
}

export interface ExecutionConfig {
  mode: 'ideal' | 'realistic';
  /** spread in points (added half/half around mid for buys/sells) */
  spreadPoints: number;
  /** commission per lot per side, account currency */
  commissionPerLot: number;
  /** slippage in points applied to market orders & SL fills */
  slippagePoints: number;
  /** same-candle ambiguity: which is assumed hit first */
  sameCandleRule: 'sl_first' | 'tp_first';
}

export interface AccountConfig {
  initialBalance: number;
  currency: string;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxMonthlyLossPct: number;
  maxTradesPerDay: number;
  maxConsecLosses: number;
  maxOpenTrades: number;
  maxExposureLots: number;
}

export interface PropFirmConfig {
  enabled: boolean;
  startingBalance: number;
  profitTargetPct: number;
  dailyDrawdownPct: number;
  maxDrawdownPct: number;
  minTradingDays: number;
  maxPositionLots: number;
  /** simple consistency: one day may not exceed X% of total profit */
  consistencyPct: number; // 0 = disabled
  weekendHoldAllowed: boolean;
}

export type PropStatus = 'ACTIVE' | 'PASSED' | 'FAILED';

export interface SessionDef {
  id: string;
  name: string;
  /** minutes from midnight in the DISPLAY timezone; may cross midnight */
  startMin: number;
  endMin: number;
  color: string;
}

export interface ReplaySpeed {
  label: string;
  /** candles per second */
  cps: number;
}

export const REPLAY_SPEEDS: ReplaySpeed[] = [
  { label: '0.25x', cps: 0.25 },
  { label: '0.5x', cps: 0.5 },
  { label: '1x', cps: 1 },
  { label: '2x', cps: 2 },
  { label: '5x', cps: 5 },
  { label: '10x', cps: 10 },
  { label: '50x', cps: 50 },
  { label: '100x', cps: 100 },
];

/** Normalized "day key" (YYYY-MM-DD in display tz) → used for daily grouping. */
export type DayKey = string;

export const fmtPrice = (v: number, spec: InstrumentSpec): string =>
  v.toFixed(spec.digits);

export const priceToPips = (d: number, spec: InstrumentSpec): number =>
  d / spec.pip;

export const money = (v: number): string =>
  (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
