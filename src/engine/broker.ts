// ============================================================================
// Broker: pending orders + open positions + fills, processed candle-by-candle.
// All decisions at candle i use only candle i and prior information.
// ============================================================================

import type { Candle, Direction, ExecutionConfig, InstrumentSpec, PendingOrder, Trade, TradeMeta } from './types';
import {
  checkExit, limitFill, marketFill, pnlFor, resolveBoth, riskFor, stopFill,
} from './execution';

let idCounter = 1;
const nextId = () => 'T' + idCounter++ + '-' + Math.random().toString(36).slice(2, 7);

export interface PartialFill {
  time: number;
  price: number;
  lots: number;
  pnl: number;
  reason: string;
}

export interface BrokerExtras {
  partials: PartialFill[];
  trailingDistance?: number; // price units
}

export type TradeRecord = Trade & { partials: PartialFill[]; trailingDistance?: number };

export interface BrokerEvent {
  type: 'filled' | 'closed' | 'partial' | 'sl_moved' | 'tp_moved' | 'order_placed' | 'order_cancelled';
  trade?: TradeRecord;
  order?: PendingOrder;
  detail?: string;
}

const PATH_CAP = 1500;

export class Broker {
  private cfg: ExecutionConfig;
  private spec: InstrumentSpec;
  orders: PendingOrder[] = [];
  open: TradeRecord[] = [];
  closed: TradeRecord[] = [];
  events: BrokerEvent[] = [];

  constructor(cfg: ExecutionConfig, spec: InstrumentSpec) {
    this.cfg = cfg;
    this.spec = spec;
  }

  setExecutionConfig(cfg: ExecutionConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.orders = [];
    this.open = [];
    this.closed = [];
    this.events = [];
  }

  // ---------------- order placement ----------------

  placeMarket(
    direction: Direction, lots: number, sl: number, tp: number,
    candle: Candle, meta: TradeMeta, verdict?: Trade['verdict'],
    session = '', condition = '', htfBias = '', entryTf: Trade['entryTf'] = '5m'
  ): TradeRecord {
    const entry = marketFill(direction, candle, this.cfg, this.spec);
    const commission = this.cfg.mode === 'realistic' ? this.cfg.commissionPerLot * lots : 0;
    const trade: TradeRecord = {
      id: nextId(),
      backtestId: '',
      direction,
      status: 'open',
      entryTime: candle.t,
      entryPrice: entry,
      lots,
      initialLots: lots,
      sl, tp,
      pnl: 0,
      commission,
      riskMoney: riskFor(entry, sl, lots, this.spec),
      r: 0,
      mfe: 0, mae: 0,
      path: [],
      session, condition, htfBias, entryTf,
      meta,
      verdict,
      slMoved: false, tpMoved: false, trailingActive: false,
      partials: [],
    };
    this.open.push(trade);
    this.events.push({ type: 'filled', trade, detail: `Market ${direction} @ ${entry.toFixed(this.spec.digits)}` });
    return trade;
  }

  placePending(
    type: 'limit' | 'stop', direction: Direction, price: number, lots: number,
    sl: number, tp: number, candle: Candle, meta: TradeMeta, verdict?: Trade['verdict']
  ): PendingOrder {
    const order: PendingOrder = {
      id: nextId(), type, direction, price, lots, sl, tp,
      createdAt: candle.t, status: 'pending', meta,
    };
    this.orders.push(order);
    this.events.push({ type: 'order_placed', order, detail: `${type} ${direction} @ ${price}` });
    void verdict;
    return order;
  }

  cancelOrder(id: string): void {
    const o = this.orders.find((x) => x.id === id);
    if (o) {
      o.status = 'cancelled';
      this.orders = this.orders.filter((x) => x.id !== id);
      this.events.push({ type: 'order_cancelled', order: o });
    }
  }

  // ---------------- per-candle processing ----------------

  processCandle(c: Candle, index: number): void {
    // 1) pending orders
    for (const o of [...this.orders]) {
      const fill = o.type === 'limit'
        ? limitFill(o.direction, o.price, c, this.cfg, this.spec)
        : stopFill(o.direction, o.price, c, this.cfg, this.spec);
      if (fill !== null) {
        o.status = 'filled';
        this.orders = this.orders.filter((x) => x.id !== o.id);
        const commission = this.cfg.mode === 'realistic' ? this.cfg.commissionPerLot * o.lots : 0;
        const trade: TradeRecord = {
          id: nextId(), backtestId: '', direction: o.direction, status: 'open',
          entryTime: c.t, entryPrice: fill, lots: o.lots, initialLots: o.lots,
          sl: o.sl ?? 0, tp: o.tp ?? 0, pnl: 0, commission,
          riskMoney: o.sl ? riskFor(fill, o.sl, o.lots, this.spec) : 0,
          r: 0, mfe: 0, mae: 0, path: [],
          session: '', condition: '', htfBias: '', entryTf: '5m',
          meta: o.meta ?? { tags: [], mistakes: [] },
          slMoved: false, tpMoved: false, trailingActive: false, partials: [],
        };
        this.open.push(trade);
        this.events.push({ type: 'filled', trade, detail: `${o.type} filled @ ${fill.toFixed(this.spec.digits)}` });
      }
    }

    // 2) open positions: exits first (conservative), then MFE/MAE, then trailing
    for (const tr of [...this.open]) {
      const ex = checkExit(tr.direction, tr.sl, tr.tp, c, this.cfg, this.spec);
      if (ex.hit) {
        const which = ex.hit === 'both' ? resolveBoth(this.cfg) : ex.hit;
        const price = which === 'sl' ? ex.slPrice : ex.tpPrice;
        this.closeTrade(tr.id, 1, which === 'sl' ? (tr.breakEvenAt !== undefined && Math.abs(tr.sl - tr.entryPrice) < 1e-9 ? 'breakeven' : tr.trailingActive ? 'trailing' : 'sl') : 'tp', c.t, price);
        continue;
      }
      // MFE/MAE
      if (tr.direction === 'long') {
        if (c.h - tr.entryPrice > tr.mfe) { tr.mfe = c.h - tr.entryPrice; tr.mfeTime = c.t; }
        if (tr.entryPrice - c.l > tr.mae) { tr.mae = tr.entryPrice - c.l; tr.maeTime = c.t; }
      } else {
        if (tr.entryPrice - c.l > tr.mfe) { tr.mfe = tr.entryPrice - c.l; tr.mfeTime = c.t; }
        if (c.h - tr.entryPrice > tr.mae) { tr.mae = c.h - tr.entryPrice; tr.maeTime = c.t; }
      }
      if (tr.path.length < PATH_CAP) tr.path.push({ h: c.h, l: c.l });
      // trailing stop (evaluated on candle close)
      if (tr.trailingDistance && tr.trailingDistance > 0) {
        if (tr.direction === 'long') {
          const ns = c.c - tr.trailingDistance;
          if (ns > tr.sl) { tr.sl = ns; tr.trailingActive = true; tr.slMoved = true; this.events.push({ type: 'sl_moved', trade: tr, detail: 'trail' }); }
        } else {
          const ns = c.c + tr.trailingDistance;
          if (tr.sl === 0 || ns < tr.sl) { tr.sl = ns; tr.trailingActive = true; tr.slMoved = true; this.events.push({ type: 'sl_moved', trade: tr, detail: 'trail' }); }
        }
      }
    }
    void index;
  }

  // ---------------- manual actions ----------------

  closeTrade(id: string, fraction = 1, reason: Trade['exitReason'] = 'manual', time?: number, priceOverride?: number): TradeRecord | null {
    const tr = this.open.find((x) => x.id === id);
    if (!tr) return null;
    const price = priceOverride ?? tr.entryPrice;
    const lots = Math.min(tr.lots, Math.max(0.01, Math.floor(tr.lots * fraction * 100) / 100));
    const gross = pnlFor(tr.direction, tr.entryPrice, price, lots, this.spec);
    tr.pnl += gross;
    tr.lots -= lots;
    const isFull = tr.lots < 0.005 || fraction >= 1;
    if (isFull) {
      tr.status = 'closed';
      tr.exitTime = time;
      tr.exitPrice = price;
      tr.exitReason = reason;
      tr.r = tr.riskMoney > 0 ? (tr.pnl - tr.commission) / tr.riskMoney : 0;
      this.open = this.open.filter((x) => x.id !== id);
      this.closed.push(tr);
      this.events.push({ type: 'closed', trade: tr, detail: reason });
    } else {
      tr.partials.push({ time: time ?? 0, price, lots, pnl: gross, reason: 'partial' });
      tr.r = tr.riskMoney > 0 ? (tr.pnl - tr.commission) / tr.riskMoney : 0;
      this.events.push({ type: 'partial', trade: tr, detail: `closed ${lots} lots` });
    }
    return tr;
  }

  moveSl(id: string, price: number): void {
    const tr = this.open.find((x) => x.id === id);
    if (tr) { tr.sl = price; tr.slMoved = true; this.events.push({ type: 'sl_moved', trade: tr }); }
  }

  moveTp(id: string, price: number): void {
    const tr = this.open.find((x) => x.id === id);
    if (tr) { tr.tp = price; tr.tpMoved = true; this.events.push({ type: 'tp_moved', trade: tr }); }
  }

  breakEven(id: string, offsetPoints = 0): void {
    const tr = this.open.find((x) => x.id === id);
    if (!tr) return;
    const off = offsetPoints * this.spec.point * (tr.direction === 'long' ? 1 : -1);
    tr.sl = tr.entryPrice + off;
    tr.breakEvenAt = Date.now();
    tr.slMoved = true;
    this.events.push({ type: 'sl_moved', trade: tr, detail: 'breakeven' });
  }

  setTrailing(id: string, distancePoints: number): void {
    const tr = this.open.find((x) => x.id === id);
    if (tr) tr.trailingDistance = distancePoints * this.spec.point;
  }

  floatingPnl(c: Candle): number {
    let sum = 0;
    for (const tr of this.open) sum += pnlFor(tr.direction, tr.entryPrice, c.c, tr.lots, this.spec);
    return sum;
  }

  usedRisk(): number {
    return this.open.reduce((s, t) => s + t.riskMoney, 0);
  }

  exposureLots(): number {
    return this.open.reduce((s, t) => s + t.lots, 0);
  }
}
