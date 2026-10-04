// ============================================================================
// PositionsPanel — open trades (with management actions), pending orders,
// and the trade journal with inline editing + "replay this trade".
// ============================================================================

import { Fragment, useState } from 'react';
import { lab, useLabVersion } from '../store/store';
import type { TradeRecord } from '../engine/broker';
import type { Candle, InstrumentSpec } from '../engine/types';
import { fmtDateTime } from '../engine/tz';
import { pnlFor } from '../engine/execution';
import { MISTAKES } from './TradePanel';
import { downloadText, tradesToCsv } from '../store/db';
import { X, Percent, ArrowRightLeft, Repeat } from 'lucide-react';

const th = 'px-2 py-1 text-left text-[10px] uppercase tracking-wide text-gray-500 font-medium whitespace-nowrap';
const td = 'px-2 py-1 whitespace-nowrap text-[11px]';

export function PositionsPanel({ tab }: { tab: 'positions' | 'journal' | 'orders' }) {
  useLabVersion();
  const spec = lab.spec;
  const candle = lab.currentCandle();

  return (
    <div className="h-full overflow-auto">
      {tab === 'positions' && <OpenPositions spec={spec} now={candle} />}
      {tab === 'orders' && <PendingOrders spec={spec} />}
      {tab === 'journal' && <JournalTable spec={spec} />}
    </div>
  );
}

function OpenPositions({ spec, now }: { spec: InstrumentSpec; now: Candle | null }) {
  const [, force] = useState(0);
  const open = lab.broker.open;
  if (open.length === 0) return <div className="p-3 text-xs text-gray-500">No open positions.</div>;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-[#0d1119]">
        <tr>
          <th className={th}>Side</th><th className={th}>Lots</th><th className={th}>Entry</th>
          <th className={th}>SL</th><th className={th}>TP</th><th className={th}>Floating</th>
          <th className={th}>MFE/MAE</th><th className={th}>Strategy</th><th className={th}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {open.map((t) => {
          const fl = now ? pnlFor(t.direction, t.entryPrice, now.c, t.lots, spec) - t.commission : 0;
          return (
            <tr key={t.id} className="border-t border-[#161b26] hover:bg-white/[0.02]">
              <td className={`${td} font-bold ${t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.direction.toUpperCase()}</td>
              <td className={td}>{t.lots.toFixed(2)}</td>
              <td className={`${td} font-mono`}>{t.entryPrice.toFixed(spec.digits)}</td>
              <td className={`${td} font-mono text-red-300`}>
                {t.sl.toFixed(spec.digits)}{t.trailingActive && <Repeat className="w-3 h-3 inline ml-1 text-blue-400" />}
              </td>
              <td className={`${td} font-mono text-emerald-300`}>{t.tp > 0 ? t.tp.toFixed(spec.digits) : '—'}</td>
              <td className={`${td} font-mono ${fl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fl >= 0 ? '+' : ''}{fl.toFixed(2)}</td>
              <td className={`${td} text-gray-400`}>+{t.mfe.toFixed(spec.digits)} / -{t.mae.toFixed(spec.digits)}</td>
              <td className={`${td} text-gray-400`}>{t.meta.strategyName ?? '—'}</td>
              <td className={`${td}`}>
                <div className="flex gap-1">
                  <IconBtn title="Close" onClick={() => { const c = lab.currentCandle(); if (c) lab.broker.closeTrade(t.id, 1, 'manual', c.t, c.c); lab.notify(); force((x) => x + 1); }}>
                    <X className="w-3 h-3" />
                  </IconBtn>
                  <IconBtn title="Close 50%" onClick={() => { const c = lab.currentCandle(); if (c) lab.broker.closeTrade(t.id, 0.5, 'partial', c.t, c.c); lab.notify(); force((x) => x + 1); }}>
                    <Percent className="w-3 h-3" />
                  </IconBtn>
                  <IconBtn title="Break-even" onClick={() => { lab.broker.breakEven(t.id, 0); lab.notify(); force((x) => x + 1); }}>
                    <ArrowRightLeft className="w-3 h-3" />
                  </IconBtn>
                  <button
                    className="px-1.5 py-0.5 rounded bg-[#12161f] border border-[#232a38] text-[10px] text-gray-400 hover:text-white"
                    title="Set trailing stop (points)"
                    onClick={() => {
                      const v = window.prompt('Trailing distance (points):', '200');
                      if (v) { lab.broker.setTrailing(t.id, parseFloat(v)); lab.notify(); force((x) => x + 1); }
                    }}
                  >TR</button>
                  <button
                    className="px-1.5 py-0.5 rounded bg-[#12161f] border border-[#232a38] text-[10px] text-gray-400 hover:text-white"
                    onClick={() => {
                      const v = window.prompt('New SL price:', String(t.sl));
                      if (v) { lab.broker.moveSl(t.id, parseFloat(v)); lab.notify(); force((x) => x + 1); }
                    }}
                  >SL</button>
                  <button
                    className="px-1.5 py-0.5 rounded bg-[#12161f] border border-[#232a38] text-[10px] text-gray-400 hover:text-white"
                    onClick={() => {
                      const v = window.prompt('New TP price:', String(t.tp));
                      if (v) { lab.broker.moveTp(t.id, parseFloat(v)); lab.notify(); force((x) => x + 1); }
                    }}
                  >TP</button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PendingOrders({ spec }: { spec: InstrumentSpec }) {
  const orders = lab.broker.orders;
  if (orders.length === 0) return <div className="p-3 text-xs text-gray-500">No pending orders.</div>;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-[#0d1119]">
        <tr><th className={th}>Type</th><th className={th}>Side</th><th className={th}>Price</th><th className={th}>Lots</th><th className={th}>SL</th><th className={th}>TP</th><th className={th}></th></tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-t border-[#161b26]">
            <td className={`${td} uppercase`}>{o.type}</td>
            <td className={`${td} ${o.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{o.direction}</td>
            <td className={`${td} font-mono`}>{o.price.toFixed(spec.digits)}</td>
            <td className={td}>{o.lots.toFixed(2)}</td>
            <td className={`${td} font-mono`}>{o.sl?.toFixed(spec.digits) ?? '—'}</td>
            <td className={`${td} font-mono`}>{o.tp?.toFixed(spec.digits) ?? '—'}</td>
            <td className={td}>
              <IconBtn title="Cancel" onClick={() => { lab.broker.cancelOrder(o.id); lab.notify(); }}>
                <X className="w-3 h-3" />
              </IconBtn>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JournalTable({ spec }: { spec: InstrumentSpec }) {
  useLabVersion();
  const [expanded, setExpanded] = useState<string | null>(null);
  const trades = [...lab.broker.closed].reverse();
  const tz = lab.settings.timezone;

  return (
    <div>
      <div className="flex justify-end p-1">
        <button
          className="text-[10px] px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white"
          onClick={() => downloadText('trades.csv', tradesToCsv(lab.broker.closed), 'text/csv')}
        >
          Export CSV
        </button>
      </div>
      {trades.length === 0 && <div className="p-3 text-xs text-gray-500">No closed trades yet. Trades appear here automatically with full metadata.</div>}
      <table className="w-full">
        <thead className="sticky top-0 bg-[#0d1119]">
          <tr>
            <th className={th}>Time</th><th className={th}>Side</th><th className={th}>Lots</th>
            <th className={th}>Entry</th><th className={th}>Exit</th><th className={th}>Net</th>
            <th className={th}>R</th><th className={th}>Session</th><th className={th}>Verdict</th><th className={th}>Exit</th><th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 500).map((t) => {
            const net = t.pnl - t.commission;
            const isExp = expanded === t.id;
            return (
              <Fragment key={t.id}>
                <tr className="border-t border-[#161b26] hover:bg-white/[0.02] cursor-pointer" onClick={() => setExpanded(isExp ? null : t.id)}>
                  <td className={`${td} text-gray-400`}>{fmtDateTime(t.entryTime, tz)}</td>
                  <td className={`${td} font-bold ${t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.direction === 'long' ? 'BUY' : 'SELL'}</td>
                  <td className={td}>{t.initialLots.toFixed(2)}</td>
                  <td className={`${td} font-mono`}>{t.entryPrice.toFixed(spec.digits)}</td>
                  <td className={`${td} font-mono`}>{t.exitPrice?.toFixed(spec.digits) ?? '—'}</td>
                  <td className={`${td} font-mono ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{net >= 0 ? '+' : ''}{net.toFixed(2)}</td>
                  <td className={`${td} font-mono ${t.r >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{t.r.toFixed(2)}R</td>
                  <td className={`${td} text-gray-400`}>{t.session || '—'}</td>
                  <td className={td}>
                    {t.verdict && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        t.verdict === 'ACCEPTED' ? 'bg-emerald-600/30 text-emerald-300'
                        : t.verdict === 'WARNING' ? 'bg-amber-600/30 text-amber-300'
                        : 'bg-red-600/30 text-red-300'
                      }`}>{t.verdict}</span>
                    )}
                  </td>
                  <td className={`${td} text-gray-400`}>{t.exitReason}</td>
                  <td className={td}>
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/40"
                      onClick={(e) => {
                        e.stopPropagation();
                        // replay this trade: move cursor to a few candles before entry
                        const step = lab.dataset ? lab.dataset.candles[1].t - lab.dataset.candles[0].t : 300;
                        lab.pause();
                        lab.seekToTime(t.entryTime - 20 * step);
                      }}
                    >
                      ▶ Replay
                    </button>
                  </td>
                </tr>
                {isExp && (
                  <tr key={t.id + '-x'} className="border-t border-[#161b26] bg-[#0d1119]">
                    <td colSpan={11} className="p-3">
                      <JournalEditor trade={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JournalEditor({ trade }: { trade: TradeRecord }) {
  const [, force] = useState(0);
  const tz = lab.settings.timezone;
  const m = trade.meta;
  const set = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) => {
    m[k] = v;
    force((x) => x + 1);
  };
  const toggleMistake = (mk: string) => {
    const cur = new Set(m.mistakes);
    if (cur.has(mk)) cur.delete(mk); else cur.add(mk);
    m.mistakes = [...cur];
    force((x) => x + 1);
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
      <div className="space-y-1 text-gray-400">
        <div className="font-semibold text-gray-200 mb-1">Facts</div>
        <div>ID: {trade.id}</div>
        <div>Entry: {fmtDateTime(trade.entryTime, tz)} @ {trade.entryPrice}</div>
        <div>Exit: {trade.exitTime ? fmtDateTime(trade.exitTime, tz) : '—'} @ {trade.exitPrice ?? '—'}</div>
        <div>MFE: +{trade.mfe.toFixed(2)} · MAE: -{trade.mae.toFixed(2)}</div>
        <div>Risk: ${trade.riskMoney.toFixed(2)} · R: {trade.r.toFixed(2)}</div>
        <div>Condition: {trade.condition || '—'}</div>
        <div>HTF bias: {trade.htfBias || '—'}</div>
        <div>Session: {trade.session || '—'}</div>
        <div>Verdict: {trade.verdict ?? '—'}</div>
        <div>Duration: {trade.exitTime ? Math.round((trade.exitTime - trade.entryTime) / 60) + ' min' : '—'}</div>
        {trade.partials.length > 0 && <div>Partials: {trade.partials.length}</div>}
      </div>
      <div className="space-y-2">
        <div className="font-semibold text-gray-200">Classification</div>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase">Setup</span>
          <input value={m.setup ?? ''} onChange={(e) => set('setup', e.target.value)} className={jeInput} />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase">Tags (comma-separated)</span>
          <input value={(m.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} className={jeInput} />
        </label>
        <div>
          <span className="text-[10px] text-gray-500 uppercase">Mistakes</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {MISTAKES.map((mk) => (
              <button
                key={mk}
                onClick={() => toggleMistake(mk)}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${m.mistakes.includes(mk) ? 'bg-red-600/30 text-red-300 border-red-500/40' : 'bg-[#12161f] text-gray-500 border-[#232a38]'}`}
              >
                {mk}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="font-semibold text-gray-200">Psychology (separate from market stats)</div>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase">Emotion before</span>
          <input value={m.emotionBefore ?? ''} onChange={(e) => set('emotionBefore', e.target.value)} className={jeInput} />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase">Emotion after</span>
          <input value={m.emotionAfter ?? ''} onChange={(e) => set('emotionAfter', e.target.value)} className={jeInput} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={m.planFollowed ?? false} onChange={(e) => set('planFollowed', e.target.checked)} />
          <span>Plan followed</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={m.wouldTakeAgain ?? false} onChange={(e) => set('wouldTakeAgain', e.target.checked)} />
          <span>Would take again</span>
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase">Notes</span>
          <textarea value={m.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3} className={jeInput} />
        </label>
      </div>
    </div>
  );
}

const jeInput = 'w-full bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1 text-gray-200 outline-none focus:border-emerald-500/60';

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="p-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white">
      {children}
    </button>
  );
}
