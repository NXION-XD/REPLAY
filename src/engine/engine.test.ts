// ============================================================================
// Engine unit tests — known cases with manually verifiable expected results.
// Run: npx vitest run
// ============================================================================

import { describe, it, expect } from 'vitest';
import { detectCsv, parseAndValidate } from '../engine/csv';
import { aggregate, bucketStart, derivableTimeframes } from '../engine/timeframes';
import { XAUUSD_SPEC } from '../engine/types';
import type { Candle, ExecutionConfig } from '../engine/types';
import { parts, zonedTimeToUtc, fmtDateTime } from '../engine/tz';
import { checkExit, lotsForRisk, marketFill, pnlFor, riskFor } from '../engine/execution';
import { Broker } from '../engine/broker';
import { coreStats, wilsonCI, whatIfTp } from '../engine/stats';
import { evaluateStrategy } from '../engine/rules';
import type { Condition } from '../engine/rules';
import { sessionAt, DEFAULT_SESSIONS } from '../engine/sessions';
import { Lab } from '../engine/lab';

// ---------------------------------------------------------------------------

const SAMPLE_CSV = `Date;Open;High;Low;Close;Volume
2025.01.06 00:00;100;101;99;100.5;10
2025.01.06 00:01;100.5;102;100.4;101.8;20
2025.01.06 00:02;101.8;101.9;100.9;101.2;15`;

describe('CSV import', () => {
  it('detects semicolon delimiter, header, and YMD.HM timestamp', () => {
    const det = detectCsv(SAMPLE_CSV)!;
    expect(det.delimiter).toBe(';');
    expect(det.hasHeader).toBe(true);
    expect(det.columns).toMatchObject({ time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 });
  });

  it('parses valid rows and reports READY', () => {
    const det = detectCsv(SAMPLE_CSV)!;
    const r = parseAndValidate(SAMPLE_CSV, det, 'XAUUSD');
    expect(r.candles.length).toBe(3);
    expect(r.candles[0].t).toBe(Date.UTC(2025, 0, 6, 0, 0) / 1000);
    expect(r.report.status).toBe('READY');
    expect(r.report.timeframe).toBe('1m');
  });

  it('removes duplicates and flags invalid candles without mutating input', () => {
    const bad = SAMPLE_CSV + '\n2025.01.06 00:01;100.5;102;100.4;101.8;20' + '\n2025.01.06 00:03;50;40;60;55;5';
    const det = detectCsv(bad)!;
    const r = parseAndValidate(bad, det, 'X');
    expect(r.candles.length).toBe(3); // dupe removed, invalid (high<low) removed
    expect(r.report.duplicates).toBe(1);
    expect(r.report.invalidCandles).toBe(1);
    expect(bad.split('\n').length).toBe(6); // original untouched
  });

  it('detects unix-ms timestamps', () => {
    const csv = 'time,o,h,l,c\n1704067200000,1,2,0.5,1.5\n1704067260000,1.5,2.5,1.4,2';
    const det = detectCsv(csv)!;
    expect(det.timeFormat).toBe('unix-ms');
    const r = parseAndValidate(csv, det, 'X');
    expect(r.candles[0].t).toBe(1704067200);
  });
});

// ---------------------------------------------------------------------------

function mkCandles(start: number, step: number, n: number, priceFn: (i: number) => [number, number, number, number]): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const [o, h, l, c] = priceFn(i);
    return { t: start + i * step, o, h, l, c };
  });
}

describe('Timeframe aggregation', () => {
  const base = mkCandles(0, 60, 6, (i) => [100 + i, 101 + i, 99 + i, 100.5 + i]);

  it('1m → 3m merges exactly 3 candles', () => {
    const agg = aggregate(base, '3m');
    expect(agg.length).toBe(2);
    expect(agg[0]).toMatchObject({ t: 0, o: 100, h: 103, l: 99, c: 102.5 });
  });

  it('bucketStart floors to bucket boundary', () => {
    expect(bucketStart(7 * 300 + 33, 300)).toBe(7 * 300);
  });

  it('derivation only allows exact multiples', () => {
    expect(derivableTimeframes('5m')).toContain('15m');
    expect(derivableTimeframes('5m')).toContain('4h');
    expect(derivableTimeframes('15m')).not.toContain('5m');
    expect(derivableTimeframes('5m')).not.toContain('3m');
  });

  it('rejects aggregation when base step >= target', () => {
    const hourly = mkCandles(0, 3600, 3, (i) => [i, i + 1, i - 1, i]);
    expect(aggregate(hourly, '15m')).toEqual(hourly);
  });
});

// ---------------------------------------------------------------------------

describe('Timezone engine', () => {
  it('converts zoned wall time to UTC with DST correctness (New York)', () => {
    // 2025-07-01 09:30 in New York (EDT, UTC-4) = 13:30 UTC
    expect(zonedTimeToUtc(2025, 7, 1, 9, 30, 'America/New_York')).toBe(Date.UTC(2025, 6, 1, 13, 30) / 1000);
    // 2025-01-15 09:30 in New York (EST, UTC-5) = 14:30 UTC
    expect(zonedTimeToUtc(2025, 1, 15, 9, 30, 'America/New_York')).toBe(Date.UTC(2025, 0, 15, 14, 30) / 1000);
  });

  it('parts returns correct day key and weekday', () => {
    const t = Date.UTC(2025, 0, 6, 12, 0) / 1000; // Monday 2025-01-06 12:00 UTC
    const p = parts(t, 'UTC');
    expect(p.dayKey).toBe('2025-01-06');
    expect(p.weekday).toBe(1);
    expect(p.minOfDay).toBe(720);
  });

  it('fmtDateTime renders in target tz', () => {
    const t = Date.UTC(2025, 0, 6, 12, 0) / 1000;
    expect(fmtDateTime(t, 'Asia/Tokyo')).toBe('2025-01-06 21:00');
  });
});

// ---------------------------------------------------------------------------

describe('Sessions', () => {
  it('matches default sessions in UTC', () => {
    const london = Date.UTC(2025, 0, 6, 9, 0) / 1000;
    expect(sessionAt(london, 'UTC', DEFAULT_SESSIONS)?.id).toBe('london');
    const asia = Date.UTC(2025, 0, 6, 3, 0) / 1000;
    expect(sessionAt(asia, 'UTC', DEFAULT_SESSIONS)?.id).toBe('asia');
  });

  it('handles midnight-crossing sessions', () => {
    const sessions = [{ id: 'x', name: 'X', startMin: 22 * 60, endMin: 2 * 60, color: '#fff' }];
    const t1 = Date.UTC(2025, 0, 6, 23, 0) / 1000;
    const t2 = Date.UTC(2025, 0, 7, 1, 0) / 1000;
    expect(sessionAt(t1, 'UTC', sessions)?.id).toBe('x');
    expect(sessionAt(t2, 'UTC', sessions)?.id).toBe('x');
  });
});

// ---------------------------------------------------------------------------

const realistic: ExecutionConfig = { mode: 'realistic', spreadPoints: 20, commissionPerLot: 7, slippagePoints: 2, sameCandleRule: 'sl_first' };
const ideal: ExecutionConfig = { mode: 'ideal', spreadPoints: 0, commissionPerLot: 0, slippagePoints: 0, sameCandleRule: 'sl_first' };
const spec = XAUUSD_SPEC; // point 0.01

describe('Execution engine', () => {
  it('market fill pays half-spread + slippage for buys in realistic mode', () => {
    const c: Candle = { t: 0, o: 100, h: 101, l: 99, c: 100.5 };
    // half spread = 20*0.01/2 = 0.10, slip = 0.02
    expect(marketFill('long', c, realistic, spec)).toBeCloseTo(100.12, 6);
    expect(marketFill('short', c, realistic, spec)).toBeCloseTo(99.88, 6);
    expect(marketFill('long', c, ideal, spec)).toBe(100);
  });

  it('SL first on both-hit candles (conservative)', () => {
    const c: Candle = { t: 0, o: 100, h: 103, l: 98, c: 100 };
    const ex = checkExit('long', 99, 102, c, ideal, spec);
    expect(ex.hit).toBe('both');
  });

  it('gap through SL fills at open, not at SL', () => {
    // long, SL 99, candle opens at 97 (gap down)
    const c: Candle = { t: 0, o: 97, h: 98, l: 96, c: 97.5 };
    const ex = checkExit('long', 99, 110, c, ideal, spec);
    expect(ex.hit).toBe('sl');
    expect(ex.slPrice).toBe(97); // ideal: at open
  });

  it('pnl math: 1 lot XAU long +2.00 = $200', () => {
    expect(pnlFor('long', 100, 102, 1, spec)).toBeCloseTo(200, 6);
    expect(pnlFor('short', 100, 98, 0.5, spec)).toBeCloseTo(100, 6);
  });

  it('risk sizing: $100 risk, 1.00 SL distance → 1.00 lot', () => {
    expect(lotsForRisk(100, 100, 99, spec)).toBeCloseTo(1, 2);
    expect(riskFor(100, 99, 1, spec)).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------

describe('Broker lifecycle', () => {
  it('opens, tracks MFE/MAE, closes at TP with correct R', () => {
    const b = new Broker(ideal, spec);
    const c0: Candle = { t: 0, o: 100, h: 100, l: 100, c: 100 };
    const tr = b.placeMarket('long', 1, 99, 102, c0, { tags: [], mistakes: [] }, undefined, 'london', '', 'bullish', '5m');
    expect(tr.entryPrice).toBe(100);
    b.processCandle({ t: 60, o: 100, h: 101, l: 99.5, c: 100.8 }, 1);
    expect(tr.mfe).toBeCloseTo(1, 6);
    expect(tr.mae).toBeCloseTo(0.5, 6);
    b.processCandle({ t: 120, o: 100.8, h: 102.5, l: 100.7, c: 102.2 }, 2);
    expect(b.open.length).toBe(0);
    expect(b.closed.length).toBe(1);
    expect(b.closed[0].exitReason).toBe('tp');
    expect(b.closed[0].pnl).toBeCloseTo(200, 4);
    expect(b.closed[0].r).toBeCloseTo(2, 4);
  });

  it('partial close realizes fraction and keeps remainder', () => {
    const b = new Broker(ideal, spec);
    const c0: Candle = { t: 0, o: 100, h: 100, l: 100, c: 100 };
    b.placeMarket('long', 1, 99, 105, c0, { tags: [], mistakes: [] });
    const tr = b.open[0];
    b.closeTrade(tr.id, 0.5, 'partial', 60, 101);
    expect(b.open[0].lots).toBeCloseTo(0.5, 6);
    expect(b.open[0].pnl).toBeCloseTo(50, 4); // (101-100) × 100 oz × 0.5 lots
  });

  it('break-even converts SL exit to breakeven reason', () => {
    const b = new Broker(ideal, spec);
    const c0: Candle = { t: 0, o: 100, h: 100, l: 100, c: 100 };
    b.placeMarket('long', 1, 99, 105, c0, { tags: [], mistakes: [] });
    const tr = b.open[0];
    b.breakEven(tr.id);
    b.processCandle({ t: 60, o: 100.2, h: 100.3, l: 99.9, c: 100 }, 1);
    expect(b.closed[0]?.exitReason).toBe('breakeven');
  });

  it('trailing stop ratchets up on closes', () => {
    const b = new Broker(ideal, spec);
    const c0: Candle = { t: 0, o: 100, h: 100, l: 100, c: 100 };
    b.placeMarket('long', 1, 99, 110, c0, { tags: [], mistakes: [] });
    const tr = b.open[0];
    b.setTrailing(tr.id, 100); // 100 points = 1.00
    b.processCandle({ t: 60, o: 100, h: 102, l: 99.8, c: 102 }, 1);
    expect(tr.sl).toBeCloseTo(101, 6);
    expect(tr.trailingActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('Statistics', () => {
  const mkTrade = (pnl: number, r: number, exitTime: number): import('../engine/types').Trade => ({
    id: String(exitTime), backtestId: '', direction: 'long', status: 'closed',
    entryTime: exitTime - 3600, entryPrice: 100, lots: 1, initialLots: 1, sl: 99, tp: 101,
    exitTime, exitPrice: 100 + pnl, exitReason: pnl > 0 ? 'tp' : 'sl',
    pnl, commission: 0, riskMoney: 100, r, mfe: 0, mae: 0, path: [],
    session: 'london', condition: '', htfBias: '', entryTf: '5m',
    meta: { tags: [], mistakes: [] }, slMoved: false, tpMoved: false, trailingActive: false,
  });

  it('core stats: 2W/1L known values', () => {
    const trades = [mkTrade(200, 2, 1000), mkTrade(100, 1, 2000), mkTrade(-100, -1, 3000)];
    const s = coreStats(trades);
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3, 6);
    expect(s.netProfit).toBeCloseTo(200, 6);
    expect(s.profitFactor).toBeCloseTo(3, 6);
    expect(s.expectancyR).toBeCloseTo(2 / 3, 6);
    expect(s.maxConsecLosses).toBe(1);
  });

  it('wilson CI is conservative for small n', () => {
    const [lo, hi] = wilsonCI(7, 10);
    expect(lo).toBeLessThan(0.7);
    expect(hi).toBeGreaterThan(0.7);
    expect(lo).toBeGreaterThan(0.3);
    expect(hi).toBeLessThan(0.95);
  });

  it('whatIfTp: MFE 3R winner would have hit 2R target', () => {
    const tr = mkTrade(250, 2.5, 2000);
    tr.path = [{ h: 104, l: 99.5 }]; // 4 above entry, never below SL(99)
    const res = whatIfTp([{ ...tr, partials: [] } as never], [2]);
    expect(res[0].wins).toBe(1);
    expect(res[0].netR).toBeCloseTo(2, 6);
  });
});

// ---------------------------------------------------------------------------

describe('Rule engine', () => {
  it('evaluates nested AND/OR/NOT correctly', () => {
    const tree: Condition = {
      kind: 'group', op: 'and', children: [
        { kind: 'leaf', feature: 'session', comparator: 'eq', value: 'london', severity: 'required' },
        { kind: 'group', op: 'or', children: [
          { kind: 'leaf', feature: 'rr', comparator: 'gte', value: 2, severity: 'required' },
          { kind: 'leaf', feature: 'rr', comparator: 'gte', value: 5, severity: 'required' },
        ]},
        { kind: 'group', op: 'not', children: [
          { kind: 'leaf', feature: 'volatility', comparator: 'eq', value: 'extreme', severity: 'warning' },
        ]},
      ],
    };
    const ctx = {
      session: 'london', minutesIntoSession: 30, hour: 9, minute: 0, dayOfWeek: 1,
      htfBias: 'bullish', htfBiasSecondary: 'neutral',
      sweptAsiaHigh: false, sweptAsiaLow: false, sweptPrevDayHigh: false, sweptPrevDayLow: false,
      mssUp: false, mssDown: false, bosUp: false, bosDown: false,
      fvgBullish: false, fvgBearish: false, insideFvg: false,
      trend: 'bullish', rangeState: 'trending', volatility: 'normal',
      atr: 2, atrPercentile: 0.5, rr: 3, slDistancePoints: 100,
      priceAboveFastEma: true, priceAboveSlowEma: true, spreadPoints: 20,
    } as const;
    const v = evaluateStrategy(tree, { ...ctx });
    expect(v.verdict).toBe('ACCEPTED');
    const v2 = evaluateStrategy(tree, { ...ctx, rr: 1 });
    expect(v2.verdict).toBe('REJECTED');
    const v3 = evaluateStrategy(tree, { ...ctx, volatility: 'extreme' });
    expect(v3.verdict).toBe('WARNING'); // required pass, warning fails
  });
});

// ---------------------------------------------------------------------------

describe('No look-ahead (Lab)', () => {
  function makeLab(): Lab {
    const lab = new Lab();
    const candles = mkCandles(Date.UTC(2025, 0, 6, 0, 0) / 1000, 300, 500, (i) => {
      const base = 100 + Math.sin(i / 10) * 2 + i * 0.01;
      return [base, base + 0.3, base - 0.3, base + 0.1];
    });
    lab.setDataset({
      id: 'test', symbol: 'TEST', baseTf: '5m', candles,
      spreads: candles.map(() => undefined), spec, importedAt: 0,
    });
    return lab;
  }

  it('HTF visible data never includes candles closing after cursor time', () => {
    const lab = makeLab();
    lab.replayTo(37); // 5m bars → cursor time = start + 37*300
    const curT = lab.currentCandle()!.t;
    const htf = lab.htfVisible('1h');
    for (const c of htf.slice(0, -1)) {
      expect(c.t + 3600).toBeLessThanOrEqual(curT + 300); // closed before current bucket
    }
    // forming candle must equal current bucket start
    expect(htf[htf.length - 1].t).toBe(bucketStart(curT, 3600));
  });

  it('forming HTF candle only aggregates visible base candles', () => {
    const lab = makeLab();
    lab.replayTo(10);
    const curT = lab.currentCandle()!.t;
    const forming = lab.htfVisible('1h').pop()!;
    expect(forming.t).toBe(bucketStart(curT, 3600));
    // 10 bars of 5m → all within first hour bucket (start is 00:00)
    const expectedHigh = Math.max(...lab.visibleCandles().map((c) => c.h));
    expect(forming.h).toBeCloseTo(expectedHigh, 9);
  });

  it('structure events at cursor only include events confirmed ≤ cursor', () => {
    const lab = makeLab();
    lab.replayTo(100);
    const recent = lab.recentStructure(['BOS_UP', 'BOS_DOWN', 'CHOCH_UP', 'CHOCH_DOWN'], 10_000);
    for (const e of recent) expect(e.at).toBeLessThanOrEqual(100);
  });

  it('stepping back discards future trades', () => {
    const lab = makeLab();
    lab.replayTo(50);
    const c = lab.currentCandle()!;
    lab.broker.placeMarket('long', 1, c.c - 1, c.c + 2, c, { tags: [], mistakes: [] });
    lab.stepForward(); lab.stepForward(); lab.stepForward();
    const tr = lab.broker.open[0] ?? lab.broker.closed[0];
    expect(tr).toBeDefined();
    const entryT = tr.entryTime;
    lab.replayTo(10); // before entry
    expect(lab.broker.closed.find((t) => t.entryTime === entryT)).toBeUndefined();
    expect(lab.broker.open.length).toBe(0);
  });
});
