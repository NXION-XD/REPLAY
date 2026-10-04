// ============================================================================
// AccountPanel — balance/equity/risk + prop-firm challenge status.
// ============================================================================

import { lab, useLabVersion } from '../store/store';
import { pnlFor } from '../engine/execution';

export function AccountPanel() {
  useLabVersion();
  const c = lab.currentCandle();
  const floating = c ? lab.broker.floatingPnl(c) : 0;
  const s = lab.account.state(floating, lab.broker.usedRisk());
  const cfg = lab.accountCfg;
  const prop = lab.prop;

  // per-open-trade floating list
  const openFloat = lab.broker.open.map((t) => ({
    id: t.id,
    pnl: c ? pnlFor(t.direction, t.entryPrice, c.c, t.lots, lab.spec) : 0,
  }));

  return (
    <div className="p-2 text-xs space-y-3 overflow-y-auto h-full">
      <div>
        <div className="text-[10px] uppercase text-gray-500 mb-1">Account</div>
        <div className="grid grid-cols-2 gap-1">
          <Stat k="Balance" v={`$${s.balance.toFixed(2)}`} />
          <Stat k="Equity" v={`$${s.equity.toFixed(2)}`} highlight={s.equity >= s.balance} />
          <Stat k="Daily P&L" v={`${s.dailyPnl >= 0 ? '+' : ''}$${s.dailyPnl.toFixed(2)}`} colored={s.dailyPnl} />
          <Stat k="Weekly P&L" v={`${s.weeklyPnl >= 0 ? '+' : ''}$${s.weeklyPnl.toFixed(2)}`} colored={s.weeklyPnl} />
          <Stat k="Monthly P&L" v={`${s.monthlyPnl >= 0 ? '+' : ''}$${s.monthlyPnl.toFixed(2)}`} colored={s.monthlyPnl} />
          <Stat k="Drawdown" v={`$${s.drawdown.toFixed(2)} (${(s.drawdownPct * 100).toFixed(1)}%)`} />
          <Stat k="Used risk" v={`$${s.usedRisk.toFixed(2)}`} />
          <Stat k="Trades today" v={`${s.tradesToday}${cfg.maxTradesPerDay ? ' / ' + cfg.maxTradesPerDay : ''}`} />
          <Stat k="Consec. losses" v={`${s.consecLosses}${cfg.maxConsecLosses ? ' / ' + cfg.maxConsecLosses : ''}`} />
          <Stat k="Exposure" v={`${lab.broker.exposureLots().toFixed(2)} lots`} />
        </div>
      </div>

      {openFloat.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-gray-500 mb-1">Open P&L</div>
          {openFloat.map((o) => (
            <div key={o.id} className="flex justify-between py-0.5 border-b border-[#161b26] last:border-0">
              <span className="text-gray-500 font-mono text-[10px]">{o.id.slice(0, 8)}</span>
              <span className={o.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{o.pnl >= 0 ? '+' : ''}{o.pnl.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {prop && (
        <PropStatusCard />
      )}

      <div className="text-[10px] text-gray-600 leading-snug pt-2 border-t border-[#161b26]">
        Execution mode: <b className="text-gray-400">{lab.execution.mode}</b> · spread {lab.execution.spreadPoints} pts · commission ${lab.execution.commissionPerLot}/lot · slippage {lab.execution.slippagePoints} pts.
        Configure in Settings.
      </div>
    </div>
  );
}

function PropStatusCard() {
  useLabVersion();
  const prop = lab.prop!;
  const c = lab.currentCandle();
  const floating = c ? lab.broker.floatingPnl(c) : 0;
  const eq = lab.account.balance + floating;
  const st = prop.update(lab.currentCandle() ? dayKeyNow() : '', eq, lab.account.balance);
  const cfg = prop.cfg;

  return (
    <div className="rounded border border-[#232a38] bg-[#0d1119] p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase text-gray-500">Prop challenge</span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          st.status === 'ACTIVE' ? 'bg-blue-600/30 text-blue-300'
          : st.status === 'PASSED' ? 'bg-emerald-600/30 text-emerald-300'
          : 'bg-red-600/30 text-red-300'
        }`}>{st.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Stat k="Profit" v={`$${st.profit.toFixed(2)} (${st.profitPct.toFixed(1)}%)`} colored={st.profit} />
        <Stat k="Remaining" v={`$${st.remainingTarget.toFixed(2)}`} />
        <Stat k="Daily DD" v={`${st.dailyDdUsedPct.toFixed(2)}% / ${cfg.dailyDrawdownPct}%`} />
        <Stat k="Max DD" v={`${st.maxDdUsedPct.toFixed(2)}% / ${cfg.maxDrawdownPct}%`} />
        <Stat k="Trading days" v={`${st.tradingDays} / ${cfg.minTradingDays}`} />
      </div>
      {st.violations.length > 0 && (
        <div className="mt-1 text-[10px] text-red-300">
          {st.violations.map((v, i) => <div key={i}>⚠ {v}</div>)}
        </div>
      )}
    </div>
  );
}

function dayKeyNow(): string {
  const c = lab.currentCandle();
  if (!c) return '';
  const d = new Date(c.t * 1000);
  return d.toISOString().slice(0, 10);
}

function Stat({ k, v, highlight, colored }: { k: string; v: string; highlight?: boolean; colored?: number }) {
  let cls = 'text-gray-200';
  if (colored !== undefined) cls = colored >= 0 ? 'text-emerald-400' : 'text-red-400';
  else if (highlight) cls = 'text-emerald-300';
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{k}</span>
      <span className={cls}>{v}</span>
    </div>
  );
}
