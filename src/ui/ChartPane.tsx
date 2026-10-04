// ============================================================================
// ChartPane — one chart instance synchronized with the Lab replay cursor.
// Incremental updates while playing; full causal refresh on seek/jump.
// ============================================================================

import { useEffect, useRef } from 'react';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { lab, useLabVersion, useUi } from '../store/store';
import { useDrawings } from '../store/drawings';
import { ChartManager } from '../chart/ChartManager';
import type { DrawingTool } from '../chart/ChartManager';
import { tfSeconds } from '../engine/types';
import type { Candle, TimeframeId } from '../engine/types';
import { emaSeries } from '../engine/indicators';
import type { StoredDrawing } from '../store/db';

interface Props {
  tf: TimeframeId;
  primary?: boolean;
}

interface PaneCache {
  lastTime: number;
  lastCount: number;
  emaFast: number[];
  emaSlow: number[];
  fullRefreshedAtVersion: number;
}

export function ChartPane({ tf, primary = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mgrRef = useRef<ChartManager | null>(null);
  const cacheRef = useRef<PaneCache>({ lastTime: 0, lastCount: 0, emaFast: [], emaSlow: [], fullRefreshedAtVersion: -1 });
  const version = useLabVersion();
  const { drawingTool, drawingColor, setDrawingTool, showEma, showSessions, showFvgs, showLevels, settings } = useUi();
  const { drawings, add, update, setSelected } = useDrawings();
  const activeTf = tf;

  // create/destroy chart
  useEffect(() => {
    if (!ref.current) return;
    const mgr = new ChartManager(ref.current, {
      onDrawingCreated: (d) => {
        d.backtestId = useDrawings.getState().backtestKey;
        d.tf = activeTf;
        d.color = useUi.getState().drawingColor;
        add(d);
        setDrawingTool(null);
      },
      onDrawingMoved: (d) => update(d),
      onDrawingClicked: (d) => setSelected(d?.id ?? null),
    });
    mgrRef.current = mgr;
    cacheRef.current = { lastTime: 0, lastCount: 0, emaFast: [], emaSlow: [], fullRefreshedAtVersion: -1 };
    return () => {
      mgr.destroy();
      mgrRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTf]);

  useEffect(() => {
    mgrRef.current?.setDrawingTool(drawingTool as DrawingTool, drawingColor);
  }, [drawingTool, drawingColor]);

  // sync with lab
  useEffect(() => {
    const mgr = mgrRef.current;
    if (!mgr || !lab.dataset) return;
    const baseTf = lab.dataset.baseTf;
    const isBase = activeTf === baseTf || tfSeconds(activeTf) <= tfSeconds(baseTf);
    const candles: Candle[] = isBase ? lab.visibleCandles() : lab.htfVisible(activeTf);
    if (candles.length === 0) return;

    const cache = cacheRef.current;
    const last = candles[candles.length - 1];
    const incremental =
      cache.lastTime !== 0 &&
      (candles.length === cache.lastCount || candles.length === cache.lastCount + 1) &&
      candles[candles.length - 1].t >= cache.lastTime &&
      cache.fullRefreshedAtVersion > -1;

    if (incremental) {
      // update forming/last candle + maybe new candle
      const emaF = cache.emaFast;
      const emaS = cache.emaSlow;
      const kF = 2 / (lab.emaPeriods.fast + 1);
      const kS = 2 / (lab.emaPeriods.slow + 1);
      const ef = last.c * kF + (emaF[emaF.length - 1] ?? last.c) * (1 - kF);
      const es = last.c * kS + (emaS[emaS.length - 1] ?? last.c) * (1 - kS);
      if (candles.length === cache.lastCount) {
        emaF[emaF.length - 1] = ef;
        emaS[emaS.length - 1] = es;
      } else {
        emaF.push(ef);
        emaS.push(es);
      }
      mgr.updateLast(last, ef, es);
    } else {
      const emaF = emaSeries(candles, lab.emaPeriods.fast);
      const emaS = emaSeries(candles, lab.emaPeriods.slow);
      cache.emaFast = emaF;
      cache.emaSlow = emaS;
      mgr.setCandles(candles, tfSeconds(activeTf), showEma ? { emaFast: emaF, emaSlow: emaS } : { emaFast: [], emaSlow: [] });
      cache.fullRefreshedAtVersion = version;
    }
    cache.lastTime = last.t;
    cache.lastCount = candles.length;

    // markers: trades + recent structure/sweeps (primary pane only)
    if (primary) {
      const markers: SeriesMarker<Time>[] = [];
      const now = lab.cursor;
      for (const tr of lab.broker.closed.slice(-150)) {
        if (isBase) {
          markers.push({
            time: tr.entryTime as never,
            position: tr.direction === 'long' ? 'belowBar' : 'aboveBar',
            color: tr.direction === 'long' ? '#22c55e' : '#ef4444',
            shape: tr.direction === 'long' ? 'arrowUp' : 'arrowDown',
            text: `${tr.direction === 'long' ? 'B' : 'S'} ${tr.lots}`,
            size: 1,
          });
          if (tr.exitTime && tr.exitTime <= (lab.currentCandle()?.t ?? 0)) {
            const netP = tr.pnl - tr.commission;
            markers.push({
              time: tr.exitTime as never,
              position: tr.direction === 'long' ? 'aboveBar' : 'belowBar',
              color: netP >= 0 ? '#22c55e' : '#ef4444',
              shape: 'circle',
              text: `${netP >= 0 ? '+' : ''}${tr.r.toFixed(1)}R`,
              size: 0.5,
            });
          }
        }
      }
      for (const tr of lab.broker.open) {
        markers.push({
          time: tr.entryTime as never,
          position: tr.direction === 'long' ? 'belowBar' : 'aboveBar',
          color: '#eab308',
          shape: tr.direction === 'long' ? 'arrowUp' : 'arrowDown',
          text: `OPEN ${tr.lots}`,
          size: 1,
        });
      }
      // recent structure events (windowed)
      for (const ev of lab.structure.slice(-400)) {
        if (ev.at > now || ev.at < now - 800) continue;
        const isUp = ev.type.endsWith('UP') || ev.type === 'HH' || ev.type === 'HL';
        if (!['BOS_UP', 'BOS_DOWN', 'CHOCH_UP', 'CHOCH_DOWN'].includes(ev.type)) continue;
        markers.push({
          time: ev.t as never,
          position: isUp ? 'belowBar' : 'aboveBar',
          color: ev.type.startsWith('CHOCH') ? '#a78bfa' : '#64748b',
          shape: 'square',
          text: ev.type.replace('_UP', '↑').replace('_DOWN', '↓'),
          size: 0.5,
        });
      }
      // recent sweeps
      for (const sw of lab.sweeps.slice(-60)) {
        if (sw.at > now) continue;
        markers.push({
          time: sw.t as never,
          position: sw.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: '#f472b6',
          shape: 'square',
          text: 'sweep',
          size: 0.4,
        });
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      mgr.setMarkers(markers);

      // price lines for open trades + pending orders
      mgr.clearPriceLines('pos-');
      for (const tr of lab.broker.open) {
        mgr.setPriceLine(`pos-${tr.id}-sl`, tr.sl, '#ef4444', 'SL');
        if (tr.tp > 0) mgr.setPriceLine(`pos-${tr.id}-tp`, tr.tp, '#22c55e', 'TP');
        mgr.setPriceLine(`pos-${tr.id}-e`, tr.entryPrice, '#eab308', tr.direction.toUpperCase());
      }
      for (const o of lab.broker.orders) {
        mgr.setPriceLine(`pos-${o.id}-o`, o.price, '#60a5fa', o.type.toUpperCase());
      }
    }

    // session boxes (from incremental tracker; end at current candle)
    if (showSessions && isBase) {
      const snap = lab.sessionSnapshot();
      const nowT = last.t;
      const boxes = [
        ...snap.completed.slice(-20).map((s) => ({ ...s, color: settings.sessions.find((x) => x.id === s.sessionId)?.color ?? '#666', endT: s.startT + 4 * 3600 })),
        ...snap.active.map((s) => ({ ...s, color: settings.sessions.find((x) => x.id === s.sessionId)?.color ?? '#666', endT: nowT })),
      ];
      mgr.setSessionBoxes(boxes);
    } else {
      mgr.setSessionBoxes([]);
    }

    // FVGs
    if (showFvgs && isBase) {
      const nowT = last.t;
      mgr.setFvgs(lab.visibleFvgs().map((f) => ({ ...f, endT: nowT })));
    } else {
      mgr.setFvgs([]);
    }

    // liquidity levels
    if (showLevels && isBase) {
      const lv = lab.currentLiquidityLevels();
      const lines = [
        lv.prevDayHigh !== undefined && { id: 'pdh', price: lv.prevDayHigh, color: '#f59e0b', label: 'PDH' },
        lv.prevDayLow !== undefined && { id: 'pdl', price: lv.prevDayLow, color: '#f59e0b', label: 'PDL' },
        lv.prevWeekHigh !== undefined && { id: 'pwh', price: lv.prevWeekHigh, color: '#d97706', label: 'PWH' },
        lv.prevWeekLow !== undefined && { id: 'pwl', price: lv.prevWeekLow, color: '#d97706', label: 'PWL' },
        lv.asiaHigh !== undefined && { id: 'ah', price: lv.asiaHigh, color: '#8b5cf6', label: 'Asia H' },
        lv.asiaLow !== undefined && { id: 'al', price: lv.asiaLow, color: '#8b5cf6', label: 'Asia L' },
      ].filter(Boolean) as { id: string; price: number; color: string; label: string }[];
      mgr.setLevels(lines);
    } else {
      mgr.setLevels([]);
    }

    // drawings for this tf
    mgr.setDrawings(drawings.filter((d) => d.tf === activeTf || !d.tf));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, activeTf, showEma, showSessions, showFvgs, showLevels, drawings]);

  // selected drawing highlight
  useEffect(() => {
    mgrRef.current?.setSelectedDrawing(useDrawings.getState().selectedId);
  }, [drawings]);

  return <div ref={ref} className="w-full h-full min-h-0" />;
}

export type { StoredDrawing };
