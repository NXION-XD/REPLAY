// ============================================================================
// Backtests — save / load / duplicate / delete replay sessions.
// ============================================================================

import { useEffect, useState } from 'react';
import { lab, useUi } from '../store/store';
import { db } from '../store/db';
import type { StoredBacktest } from '../store/db';
import { useDrawings } from '../store/drawings';
import { fmtDateTime, parts, weekKey, monthKey } from '../engine/tz';
import { coreStats } from '../engine/stats';

export function Backtests() {
  const { activeBacktest, setActiveBacktest } = useUi();
  const [rows, setRows] = useState<StoredBacktest[]>([]);
  const [name, setName] = useState('');

  const refresh = () => db.backtests.toArray().then((r) => setRows(r.sort((a, b) => b.updatedAt - a.updatedAt)));
  useEffect(() => { void refresh(); }, []);

  const saveCurrent = async (asNew = false) => {
    if (!lab.dataset) return;
    const id = asNew || !activeBacktest ? 'bt-' + Date.now().toString(36) : activeBacktest.id;
    const bt: StoredBacktest = {
      id,
      name: name || activeBacktest?.name || `Backtest ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      datasetId: lab.dataset.id,
      symbol: lab.dataset.symbol,
      baseTf: lab.dataset.baseTf,
      startTime: activeBacktest?.startTime ?? lab.currentCandle()?.t ?? 0,
      endTime: lab.currentCandle()?.t,
      cursor: lab.cursor,
      createdAt: activeBacktest?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      settings: lab.settings,
      accountCfg: lab.accountCfg,
      execution: lab.execution,
      propCfg: lab.prop?.cfg ?? null,
      strategyId: useUi.getState().activeStrategyId ?? undefined,
      trades: lab.broker.closed,
    };
    await db.backtests.put(bt);
    setActiveBacktest(bt);
    useDrawings.getState().load(id);
    await refresh();
  };

  const load = async (bt: StoredBacktest) => {
    // dataset must match
    if (!lab.dataset || lab.dataset.id !== bt.datasetId) {
      const d = await db.datasets.get(bt.datasetId);
      if (d) {
        const { detectCsv, parseAndValidate } = await import('../engine/csv');
        const det = detectCsv(d.rawCsv);
        if (det) {
          const p = parseAndValidate(d.rawCsv, det, d.symbol);
          lab.setDataset({ id: d.id, symbol: d.symbol, baseTf: d.baseTf, candles: p.candles, spreads: p.spreads, spec: JSON.parse(d.specJson), importedAt: d.importedAt });
        }
      }
    }
    lab.updateSettings(bt.settings);
    lab.setAccountCfg(bt.accountCfg);
    lab.setExecution(bt.execution);
    lab.enablePropFirm(bt.propCfg);
    lab.broker.closed = bt.trades.map((t) => ({ ...t }));
    lab.broker.open = [];
    lab.broker.orders = [];
    lab.activeBacktestId = bt.id;
    setActiveBacktest(bt);
    useDrawings.getState().load(bt.id);
    lab.replayTo(bt.cursor);
    lab.account.rebuildFromTrades(lab.broker.closed, lab.currentCandle()?.t ?? 0, lab.settings.timezone, (t) => ({
      day: parts(t, lab.settings.timezone).dayKey,
      week: weekKey(t, lab.settings.timezone),
      month: monthKey(t, lab.settings.timezone),
    }));
    useUi.getState().setRoute('terminal');
    location.hash = '#/terminal';
  };

  const duplicate = async (bt: StoredBacktest) => {
    const copy = { ...bt, id: 'bt-' + Date.now().toString(36), name: bt.name + ' (copy)', createdAt: Date.now(), updatedAt: Date.now() };
    await db.backtests.put(copy);
    await refresh();
  };

  const remove = async (id: string) => {
    await db.backtests.delete(id);
    await db.drawings.where('backtestId').equals(id).delete();
    if (activeBacktest?.id === id) setActiveBacktest(null);
    await refresh();
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto text-xs space-y-4">
      <h1 className="text-lg font-semibold text-gray-100">Backtests</h1>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={activeBacktest ? activeBacktest.name : 'Name this backtest…'}
          className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1.5 text-gray-200 w-72"
        />
        <button onClick={() => saveCurrent(false)} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">
          {activeBacktest ? 'Save' : 'Save new'}
        </button>
        <button onClick={() => saveCurrent(true)} className="px-3 py-1.5 rounded bg-[#12161f] border border-[#232a38] text-gray-300">Save as…</button>
        {activeBacktest && (
          <button onClick={() => { setActiveBacktest(null); lab.activeBacktestId = ''; }} className="px-3 py-1.5 rounded bg-[#12161f] border border-[#232a38] text-gray-300">Detach (new unsaved session)</button>
        )}
      </div>
      <div className="space-y-2">
        {rows.map((bt) => {
          const s = coreStats(bt.trades);
          return (
            <div key={bt.id} className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-3 flex items-center gap-4 flex-wrap">
              <div>
                <div className="font-semibold text-gray-200">{bt.name}</div>
                <div className="text-[10px] text-gray-500">
                  {bt.symbol} · {bt.baseTf} · {fmtDateTime(bt.startTime, 'UTC').slice(0, 10)} → {bt.endTime ? fmtDateTime(bt.endTime, 'UTC').slice(0, 10) : '…'} · updated {new Date(bt.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-4 text-[11px] text-gray-400">
                <span>{s.trades} trades</span>
                <span>WR {(s.winRate * 100).toFixed(0)}%</span>
                <span className={s.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.netProfit >= 0 ? '+' : ''}${s.netProfit.toFixed(0)}</span>
                <span>PF {isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</span>
                <span>maxDD ${s.maxDrawdown.toFixed(0)}</span>
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={() => load(bt)} className="px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40">Load</button>
                <button onClick={() => duplicate(bt)} className="px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white">Duplicate</button>
                <button onClick={() => remove(bt.id)} className="px-2 py-1 rounded bg-red-600/20 text-red-300 border border-red-500/30 hover:bg-red-600/40">Delete</button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-gray-500">No saved backtests yet. Trades, settings, drawings and the replay cursor are stored per backtest.</div>}
      </div>
      <p className="text-[10px] text-gray-600">Storage is browser-local (IndexedDB). It persists across visits in this browser only — no sync across devices, and clearing browser data erases it. Use Analytics → CSV/JSON export for durable copies.</p>
    </div>
  );
}
