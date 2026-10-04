// ============================================================================
// ChartManager — one Lightweight Charts v5 instance wired for replay.
// Data contract: setCandles receives ONLY candles visible at replay time.
// ============================================================================

import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time, UTCTimestamp, IPriceLine } from 'lightweight-charts';
import type { Candle } from '../engine/types';
import { DrawingsPrimitive, FvgPrimitive, LevelsPrimitive, SessionBoxesPrimitive } from './primitives';
import type { LevelLine } from './primitives';
import type { SessionStats } from '../engine/sessions';
import type { Fvg } from '../engine/structure';
import type { StoredDrawing } from '../store/db';

export interface ChartTheme {
  upColor: string;
  downColor: string;
  wickUp: string;
  wickDown: string;
}

export const DARK_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: '#0b0e14' },
    textColor: '#9ca3af',
    fontSize: 11,
    attributionLogo: true, // required TradingView attribution
  },
  grid: {
    vertLines: { color: '#1a1f2b' },
    horzLines: { color: '#1a1f2b' },
  },
  crosshair: {
    vertLine: { color: '#4b5563', labelBackgroundColor: '#374151' },
    horzLine: { color: '#4b5563', labelBackgroundColor: '#374151' },
  },
  rightPriceScale: { borderColor: '#1f2430' },
  timeScale: { borderColor: '#1f2430', timeVisible: true, secondsVisible: false },
} as const;

export type DrawingTool = 'hline' | 'vline' | 'trendline' | 'rect' | 'long' | 'short' | 'text' | null;

export interface ChartCallbacks {
  onDrawingCreated?: (d: StoredDrawing) => void;
  onDrawingMoved?: (d: StoredDrawing) => void;
  onDrawingClicked?: (d: StoredDrawing | null) => void;
  onChartClick?: (t: number, price: number) => void;
}

export class ChartManager {
  readonly chart: IChartApi;
  readonly series: ISeriesApi<'Candlestick'>;
  private volumeSeries: ISeriesApi<'Histogram'>;
  private emaFastSeries: ISeriesApi<'Line'>;
  private emaSlowSeries: ISeriesApi<'Line'>;
  private markersApi: ISeriesMarkersPluginApi<Time>;
  private priceLines = new Map<string, IPriceLine>();

  readonly sessionBoxes = new SessionBoxesPrimitive();
  readonly fvgZones = new FvgPrimitive();
  readonly levels = new LevelsPrimitive();
  readonly drawingsPrim = new DrawingsPrimitive();

  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private drawingTool: DrawingTool = null;
  private pendingAnchor: { t: number; price: number } | null = null;
  private dragging: { id: string; startT: number; startPrice: number } | null = null;
  private callbacks: ChartCallbacks = {};
  private lastBarTf = 300;
  private newDrawingDefaults = { color: '#60a5fa', lineWidth: 1, opacity: 1 };

  constructor(container: HTMLElement, callbacks: ChartCallbacks = {}, showEma = true) {
    this.container = container;
    this.callbacks = callbacks;
    this.chart = createChart(container, {
      ...DARK_THEME,
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
    });
    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      borderVisible: false,
    });
    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    this.chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    this.emaFastSeries = this.chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, visible: showEma,
    });
    this.emaSlowSeries = this.chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, visible: showEma,
    });

    this.markersApi = createSeriesMarkers(this.series, []);
    this.series.attachPrimitive(this.sessionBoxes);
    this.series.attachPrimitive(this.fvgZones);
    this.series.attachPrimitive(this.levels);
    this.series.attachPrimitive(this.drawingsPrim);

    this.resizeObserver = new ResizeObserver(() => {
      this.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    this.resizeObserver.observe(container);

    container.addEventListener('mousedown', this.onMouseDown);
    container.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.container.removeEventListener('mousedown', this.onMouseDown);
    this.container.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.chart.remove();
  }

  setCallbacks(cb: ChartCallbacks): void {
    this.callbacks = cb;
  }

  // ---------------- data ----------------

  /** full visible candle set (already causal — sliced upstream) */
  setCandles(candles: Candle[], tfSeconds: number, extras?: { emaFast?: number[]; emaSlow?: number[] }): void {
    this.lastBarTf = tfSeconds;
    const data = candles.map((c) => ({
      time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    this.series.setData(data);
    this.volumeSeries.setData(candles.filter((c) => c.v !== undefined).map((c) => ({
      time: c.t as UTCTimestamp, value: c.v!, color: c.c >= c.o ? '#26a69a44' : '#ef535044',
    })));
    if (extras?.emaFast) {
      this.emaFastSeries.setData(candles.map((c, i) => ({ time: c.t as UTCTimestamp, value: extras.emaFast![i] })).filter((d) => !isNaN(d.value)));
    }
    if (extras?.emaSlow) {
      this.emaSlowSeries.setData(candles.map((c, i) => ({ time: c.t as UTCTimestamp, value: extras.emaSlow![i] })).filter((d) => !isNaN(d.value)));
    }
  }

  /** incremental last-candle update during play */
  updateLast(c: Candle, emaFast?: number, emaSlow?: number): void {
    this.series.update({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });
    if (c.v !== undefined) {
      this.volumeSeries.update({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? '#26a69a44' : '#ef535044' });
    }
    if (emaFast !== undefined && !isNaN(emaFast)) this.emaFastSeries.update({ time: c.t as UTCTimestamp, value: emaFast });
    if (emaSlow !== undefined && !isNaN(emaSlow)) this.emaSlowSeries.update({ time: c.t as UTCTimestamp, value: emaSlow });
  }

  setMarkers(markers: SeriesMarker<Time>[]): void {
    this.markersApi.setMarkers(markers);
  }

  // ---------------- overlays ----------------

  setPriceLine(id: string, price: number, color: string, title: string, style: LineStyle = LineStyle.Solid): void {
    this.removePriceLine(id);
    const pl = this.series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true });
    this.priceLines.set(id, pl);
  }

  removePriceLine(id: string): void {
    const pl = this.priceLines.get(id);
    if (pl) {
      this.series.removePriceLine(pl);
      this.priceLines.delete(id);
    }
  }

  clearPriceLines(prefix?: string): void {
    this.priceLines.forEach((pl, id) => {
      if (!prefix || id.startsWith(prefix)) {
        this.series.removePriceLine(pl);
        this.priceLines.delete(id);
      }
    });
  }

  setSessionBoxes(boxes: (SessionStats & { color: string; endT: number })[]): void {
    this.sessionBoxes.setBoxes(boxes);
  }

  setFvgs(fvgs: (Fvg & { endT: number })[]): void {
    this.fvgZones.setFvgs(fvgs);
  }

  setLevels(levels: LevelLine[]): void {
    this.levels.setLevels(levels);
  }

  setDrawings(d: StoredDrawing[]): void {
    this.drawingsPrim.setDrawings(d);
  }

  setSelectedDrawing(id: string | null): void {
    this.drawingsPrim.setSelected(id);
  }

  setDrawingTool(tool: DrawingTool, color?: string): void {
    this.drawingTool = tool;
    this.pendingAnchor = null;
    if (color) this.newDrawingDefaults.color = color;
    this.chart.applyOptions({
      crosshair: { vertLine: { labelVisible: true } },
    });
  }

  // ---------------- interaction ----------------

  private eventToPoint(e: MouseEvent): { t: number; price: number; x: number; y: number } | null {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = this.series.coordinateToPrice(y);
    const time = this.chart.timeScale().coordinateToTime(x);
    if (price === null) return null;
    let t: number;
    if (time === null) {
      // extrapolate beyond last bar using logical range
      const logical = this.chart.timeScale().coordinateToLogical(x);
      if (logical === null) return null;
      const vis = this.chart.timeScale().getVisibleLogicalRange();
      void vis;
      // logical index → approximate time using last known bar time
      const lastLogical = (this.series.data().length - 1);
      const lastTime = this.series.data().length
        ? (this.series.data()[lastLogical].time as number)
        : 0;
      t = lastTime + Math.round((logical - lastLogical)) * this.lastBarTf;
    } else {
      t = typeof time === 'number' ? time : Date.parse(time as string) / 1000;
    }
    return { t, price: price as number, x, y };
  }

  private onMouseDown = (e: MouseEvent): void => {
    const pt = this.eventToPoint(e);
    if (!pt) return;
    if (this.drawingTool) {
      if (!this.pendingAnchor && (this.drawingTool === 'trendline' || this.drawingTool === 'rect' || this.drawingTool === 'long' || this.drawingTool === 'short')) {
        this.pendingAnchor = { t: pt.t, price: pt.price };
        return;
      }
      const d: StoredDrawing = {
        id: 'drw-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        backtestId: '',
        tf: '5m',
        kind: this.drawingTool,
        p1: this.pendingAnchor ?? { t: pt.t, price: pt.price },
        p2: this.pendingAnchor ? { t: pt.t, price: pt.price } : undefined,
        text: this.drawingTool === 'text' ? 'note' : undefined,
        ...this.newDrawingDefaults,
        locked: false, hidden: false,
      };
      this.pendingAnchor = null;
      this.callbacks.onDrawingCreated?.(d);
      return;
    }
    // selection / drag
    const hit = this.drawingsPrim.hitTestId(pt.x, pt.y);
    if (hit) {
      const d = this.drawingsPrim.drawings.find((x) => x.id === hit);
      this.callbacks.onDrawingClicked?.(d ?? null);
      if (d && !d.locked) {
        this.dragging = { id: hit, startT: pt.t, startPrice: pt.price };
      }
    } else {
      this.callbacks.onDrawingClicked?.(null);
      this.callbacks.onChartClick?.(pt.t, pt.price);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const pt = this.eventToPoint(e);
    if (!pt) return;
    const d = this.drawingsPrim.drawings.find((x) => x.id === this.dragging!.id);
    if (!d) return;
    const dt = pt.t - this.dragging.startT;
    const dp = pt.price - this.dragging.startPrice;
    const snapT = (t: number) => Math.round(t / this.lastBarTf) * this.lastBarTf;
    d.p1 = { t: snapT(d.p1.t + dt), price: d.p1.price + dp };
    if (d.p2) d.p2 = { t: snapT(d.p2.t + dt), price: d.p2.price + dp };
    this.dragging.startT = pt.t;
    this.dragging.startPrice = pt.price;
    this.drawingsPrim.setDrawings([...this.drawingsPrim.drawings]);
  };

  private onMouseUp = (): void => {
    if (this.dragging) {
      const d = this.drawingsPrim.drawings.find((x) => x.id === this.dragging!.id);
      if (d) this.callbacks.onDrawingMoved?.(d);
      this.dragging = null;
    }
  };

  // ---------------- viewport ----------------

  scrollToTime(t: number): void {
    const ts = this.chart.timeScale();
    const logical = ts.getVisibleLogicalRange();
    void logical;
    ts.scrollToPosition(5, false);
    // ensure time is visible: set visible range ending shortly after t
    const data = this.series.data();
    if (!data.length) return;
    // find logical index of t via binary search on data times
    let lo = 0, hi = data.length - 1, idx = data.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mt = data[mid].time as number;
      if (mt <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const barsVisible = 120;
    ts.setVisibleLogicalRange({ from: idx - barsVisible + 20, to: idx + 20 });
  }

  fit(): void {
    this.chart.timeScale().fitContent();
  }

  subscribeCrosshair(fn: (param: MouseEventParams) => void): void {
    this.chart.subscribeCrosshairMove(fn);
  }
}
