// ============================================================================
// Lightweight Charts v5 custom primitives: session boxes, FVG zones,
// and user drawings (hline/vline/trendline/rect/position boxes).
// Rendering uses ISeriesPrimitive.paneViews() + CanvasRenderingTarget2D.
// ============================================================================

import type { IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';
import type { SessionStats } from '../engine/sessions';
import type { Fvg } from '../engine/structure';
import type { StoredDrawing } from '../store/db';

export interface PrimitiveHost {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  requestUpdate: () => void;
}

abstract class PrimitiveBase implements ISeriesPrimitive<Time> {
  protected host: PrimitiveHost | null = null;
  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.host = {
      chart: param.chart as IChartApi,
      series: param.series as ISeriesApi<'Candlestick'>,
      requestUpdate: param.requestUpdate,
    };
  }
  detached(): void {
    this.host = null;
  }
  updateAllViews(): void {
    this._views = null;
    this._priceViews = null;
  }
  protected px(time: number): number | null {
    if (!this.host) return null;
    const x = this.host.chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    return x === null ? null : (x as number);
  }
  protected py(price: number): number | null {
    if (!this.host) return null;
    const y = this.host.series.priceToCoordinate(price);
    return y === null ? null : (y as number);
  }
  protected _views: IPrimitivePaneView[] | null = null;
  protected _priceViews: ISeriesPrimitiveAxisView[] | null = null;
}

function makeView(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, zOrder: 'bottom' | 'normal' | 'top' = 'normal'): IPrimitivePaneView {
  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize }) => {
        draw(ctx, bitmapSize.width, bitmapSize.height);
      });
    },
  };
  return { zOrder: () => zOrder, renderer: () => renderer };
}

// ---------------------------------------------------------------------------
// Session boxes
// ---------------------------------------------------------------------------

export class SessionBoxesPrimitive extends PrimitiveBase {
  private boxes: (SessionStats & { color: string; endT: number })[] = [];

  setBoxes(boxes: (SessionStats & { color: string; endT: number })[]): void {
    this.boxes = boxes;
    this.host?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._views) {
      const boxes = this.boxes;
      this._views = [makeView((ctx, w, h) => {
        void w; void h;
        for (const b of boxes) {
          const x1 = this.px(b.startT);
          const x2 = this.px(b.endT);
          const y1 = this.py(b.high);
          const y2 = this.py(b.low);
          if (x1 === null || y1 === null || y2 === null) continue;
          const xEnd = x2 === null ? ctx.canvas.width : x2;
          ctx.fillStyle = b.color + '14';
          ctx.strokeStyle = b.color + '55';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(x1, y1, xEnd - x1, y2 - y1);
          ctx.fill();
          ctx.stroke();
        }
      }, 'bottom')];
    }
    return this._views;
  }
}

// ---------------------------------------------------------------------------
// FVG zones
// ---------------------------------------------------------------------------

export class FvgPrimitive extends PrimitiveBase {
  private fvgs: (Fvg & { endT: number })[] = [];
  private maxShow = 30;

  setFvgs(fvgs: (Fvg & { endT: number })[]): void {
    this.fvgs = fvgs.slice(-this.maxShow);
    this.host?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._views) {
      const fvgs = this.fvgs;
      this._views = [makeView((ctx) => {
        for (const f of fvgs) {
          const x1 = this.px(f.t);
          const y1 = this.py(f.top);
          const y2 = this.py(f.bottom);
          if (x1 === null || y1 === null || y2 === null) continue;
          const x2 = this.px(f.endT) ?? ctx.canvas.width;
          const color = f.direction === 'bullish' ? '#22d3ee' : '#f472b6';
          ctx.fillStyle = color + '1f';
          ctx.strokeStyle = color + '66';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(x1, y1, x2 - x1, y2 - y1);
          ctx.fill();
          ctx.stroke();
        }
      })];
    }
    return this._views;
  }
}

// ---------------------------------------------------------------------------
// Liquidity level lines (PDH/PDL/Asia etc.) — dashed rays from level origin
// ---------------------------------------------------------------------------

export interface LevelLine {
  id: string;
  price: number;
  color: string;
  label: string;
}

export class LevelsPrimitive extends PrimitiveBase {
  private levels: LevelLine[] = [];

  setLevels(levels: LevelLine[]): void {
    this.levels = levels;
    this.host?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._views) {
      const levels = this.levels;
      this._views = [makeView((ctx, w) => {
        for (const lv of levels) {
          const y = this.py(lv.price);
          if (y === null) continue;
          ctx.strokeStyle = lv.color + 'aa';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '10px sans-serif';
          ctx.fillStyle = lv.color;
          ctx.fillText(lv.label, 6, y - 3);
        }
      }, 'top')];
    }
    return this._views;
  }
}

// ---------------------------------------------------------------------------
// User drawings
// ---------------------------------------------------------------------------

export class DrawingsPrimitive extends PrimitiveBase {
  drawings: StoredDrawing[] = [];
  selectedId: string | null = null;

  setDrawings(d: StoredDrawing[]): void {
    this.drawings = d;
    this.host?.requestUpdate();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.host?.requestUpdate();
  }

  private withAlpha(color: string, alpha: number): string {
    if (color.startsWith('#') && color.length === 7) {
      const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
      return color + a;
    }
    return color;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this._views) {
      this._views = [makeView((ctx, w, h) => {
        for (const d of this.drawings) {
          if (d.hidden) continue;
          const sel = d.id === this.selectedId;
          const col = this.withAlpha(d.color, d.opacity ?? 1);
          ctx.strokeStyle = col;
          ctx.fillStyle = col;
          ctx.lineWidth = d.lineWidth + (sel ? 1 : 0);
          ctx.setLineDash(d.locked ? [2, 3] : []);

          if (d.kind === 'hline') {
            const y = this.py(d.p1.price);
            if (y === null) continue;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          } else if (d.kind === 'vline') {
            const x = this.px(d.p1.t);
            if (x === null) continue;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
          } else if (d.kind === 'trendline' && d.p2) {
            const x1 = this.px(d.p1.t), y1 = this.py(d.p1.price);
            const x2 = this.px(d.p2.t), y2 = this.py(d.p2.price);
            if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            // anchor handles
            ctx.beginPath(); ctx.arc(x1, y1, 3.5, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.arc(x2, y2, 3.5, 0, 7); ctx.fill();
          } else if ((d.kind === 'rect' || d.kind === 'long' || d.kind === 'short') && d.p2) {
            const x1 = this.px(d.p1.t), x2 = this.px(d.p2.t);
            const y1 = this.py(d.p1.price), y2 = this.py(d.p2.price);
            if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
            const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
            const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
            const base = d.kind === 'long' ? '#22c55e' : d.kind === 'short' ? '#ef4444' : d.color;
            ctx.fillStyle = this.withAlpha(base, 0.12 * (d.opacity ?? 1));
            ctx.strokeStyle = this.withAlpha(base, 0.8 * (d.opacity ?? 1));
            ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.fill(); ctx.stroke();
          } else if (d.kind === 'text') {
            const x = this.px(d.p1.t), y = this.py(d.p1.price);
            if (x === null || y === null) continue;
            ctx.font = '12px sans-serif';
            ctx.fillText(d.text ?? 'text', x, y);
          }
          ctx.setLineDash([]);
          if (d.name) {
            const x = this.px(d.p1.t);
            const y = this.py(d.p1.price);
            if (x !== null && y !== null) {
              ctx.font = '10px sans-serif';
              ctx.fillText(d.name, x + 4, y - 4);
            }
          }
        }
      }, 'top')];
    }
    return this._views;
  }

  /** hit test against drawing geometry; returns drawing id */
  hitTestId(x: number, y: number): string | null {
    const TOL = 6;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.hidden) continue;
      if (d.kind === 'hline') {
        const py = this.py(d.p1.price);
        if (py !== null && Math.abs(y - py) < TOL) return d.id;
      } else if (d.kind === 'vline') {
        const px = this.px(d.p1.t);
        if (px !== null && Math.abs(x - px) < TOL) return d.id;
      } else if (d.kind === 'trendline' && d.p2) {
        const x1 = this.px(d.p1.t), y1 = this.py(d.p1.price);
        const x2 = this.px(d.p2.t), y2 = this.py(d.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
        const dist = pointToSegment(x, y, x1, y1, x2, y2);
        if (dist < TOL) return d.id;
      } else if ((d.kind === 'rect' || d.kind === 'long' || d.kind === 'short') && d.p2) {
        const x1 = this.px(d.p1.t), x2 = this.px(d.p2.t);
        const y1 = this.py(d.p1.price), y2 = this.py(d.p2.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        const rx = Math.min(x1, x2), rx2 = Math.max(x1, x2);
        const ry = Math.min(y1, y2), ry2 = Math.max(y1, y2);
        const onEdge = x >= rx - TOL && x <= rx2 + TOL && y >= ry - TOL && y <= ry2 + TOL &&
          (Math.abs(x - rx) < TOL || Math.abs(x - rx2) < TOL || Math.abs(y - ry) < TOL || Math.abs(y - ry2) < TOL);
        if (onEdge) return d.id;
      } else if (d.kind === 'text') {
        const px = this.px(d.p1.t), py = this.py(d.p1.price);
        if (px !== null && py !== null && Math.abs(x - px) < 30 && Math.abs(y - py) < 10) return d.id;
      }
    }
    return null;
  }
}

function pointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
