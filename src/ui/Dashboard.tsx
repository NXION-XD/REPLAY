// ============================================================================
// Dashboard — full analytics over the ACTUAL closed trades of the current
// session (and saved backtests for comparison). Every number is derived from
// the trade list; empty state is explicit.
// ============================================================================

import { useMemo, useState } from 'react';
import { lab, useLabVersion } from '../store/store';
import type { Trade } from '../engine/types';
import { coreStats, groupBy, equityCurve, drawdownPeriods, streakDistribution, histogram, whatIfTp, whatIfSl, excursionStats } from '../engine/stats';
import type { GroupStats } from '../engine/stats';
import { monteCarlo } from '../engine/montecarlo';
import { dayReports, periodReports, DEFAULT_THRESHOLDS } from '../engine/reports';
import type { TradeRecord } from '../engine/broker';
import { parts, fmtDateTime } from '../engine/tz';
import { BarChart, DataTable, Heatmap, Histogram, LineChart, StatCard } from './charts';
import { downloadText, tradesToCsv } from '../store/db';

const TABS = ['Overview', 'Trades', 'Calendar', 'Sessions', 'Time', 'Days', 'Conditions', 'Excursion', 'Monte Carlo', 'Reports', 'Compare'] as const;
type Tab = (typeof TABS)[number];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Dashboard() {
  useLabVersion();
  const [tab, setTab] = useState<Tab>('Overview');
  const trades = lab.broker.closed;
  const tz = lab.settings.timezone;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 border-b border-[#1a1f2b] px-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[11px] whitespace-nowrap ${tab === t ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-gray-500">{trades.length} closed trades in session</span>
          <button
            className="text-[10px] px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white"
            onClick={() => downloadText('trades.csv', tradesToCsv(trades), 'text/csv')}
          >CSV</button>
          <button
            className="text-[10px] px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white"
            onClick={() => downloadText('session.json', JSON.stringify({ trades, exportedAt: new Date().toISOString() }, null, 2), 'application/json')}
          >JSON</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {trades.length === 0 && tab !== 'Compare' ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
            <div className="text-sm">No closed trades in this session yet.</div>
            <div className="text-xs text-gray-600">Replay the market on the Terminal page, take trades, and every metric here is computed from them. Nothing here is synthetic.</div>
          </div>
        ) : (
          <>
            {tab === 'Overview' && <Overview trades={trades} />}
            {tab === 'Trades' && <TradesTab trades={trades} tz={tz} />}
            {tab === 'Calendar' && <CalendarTab trades={trades} tz={tz} />}
            {tab === 'Sessions' && <SessionsTab trades={trades} tz={tz} />}
            {tab === 'Time' && <TimeTab trades={trades} tz={tz} />}
            {tab === 'Days' && <DaysTab trades={trades} tz={tz} />}
            {tab === 'Conditions' && <ConditionsTab trades={trades} />}
            {tab === 'Excursion' && <ExcursionTab trades={trades} />}
            {tab === 'Monte Carlo' && <MonteCarloTab trades={trades} />}
            {tab === 'Reports' && <ReportsTab trades={trades} tz={tz} />}
            {tab === 'Compare' && <CompareTab />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SampleWarning({ n }: { n: number }) {
  if (n >= 30) return null;
  return (
    <div className="bg-amber-600/10 border border-amber-500/30 text-amber-300 text-[11px] rounded p-2 mb-3">
      ⚠ Sample size is low ({n} trades). Win rate, expectancy and drawdown estimates may be unstable — treat them as fragile until the sample grows. Historical backtest results never guarantee future results.
    </div>
  );
}

function Overview({ trades }: { trades: TradeRecord[] }) {
  const s = useMemo(() => coreStats(trades), [trades]);
  const curve = useMemo(() => equityCurve(trades, lab.accountCfg.initialBalance), [trades]);
  const dds = useMemo(() => drawdownPeriods(trades, lab.accountCfg.initialBalance), [trades]);
  const winStreaks = useMemo(() => streakDistribution(trades, 'win'), [trades]);
  const lossStreaks = useMemo(() => streakDistribution(trades, 'loss'), [trades]);
  const rHist = useMemo(() => histogram(trades.map((t) => t.r)), [trades]);
  const daily = useMemo(() => dayReports(trades, lab.settings.timezone), [trades]);

  return (
    <div className="space-y-4">
      <SampleWarning n={s.trades} />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        <StatCard label="Net P&L" value={`${s.netProfit >= 0 ? '+' : ''}$${s.netProfit.toFixed(2)}`} tone={s.netProfit >= 0 ? 'up' : 'down'} sub={`Gross +$${s.grossProfit.toFixed(0)} / -$${s.grossLoss.toFixed(0)}`} />
        <StatCard label="Win rate" value={`${(s.winRate * 100).toFixed(1)}%`} sub={`95% CI ${(s.winRateCI[0] * 100).toFixed(0)}–${(s.winRateCI[1] * 100).toFixed(0)}% · n=${s.trades}`} />
        <StatCard label="Profit factor" value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} />
        <StatCard label="Expectancy" value={`${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(2)}R`} sub={`$${s.expectancyMoney.toFixed(2)}/trade`} tone={s.expectancyR >= 0 ? 'up' : 'down'} />
        <StatCard label="Max drawdown" value={`$${s.maxDrawdown.toFixed(0)}`} sub={`${s.maxDrawdownR.toFixed(1)}R · avg $${s.avgDrawdown.toFixed(0)}`} tone="down" />
        <StatCard label="Recovery factor" value={isFinite(s.recoveryFactor) ? s.recoveryFactor.toFixed(2) : '∞'} />
        <StatCard label="Avg win / loss" value={`$${s.avgWin.toFixed(0)} / $${s.avgLoss.toFixed(0)}`} sub={`${s.avgWinR.toFixed(2)}R / ${s.avgLossR.toFixed(2)}R`} />
        <StatCard label="Largest W / L" value={`$${s.largestWin.toFixed(0)} / $${Math.abs(s.largestLoss).toFixed(0)}`} />
        <StatCard label="Streaks W/L" value={`${s.maxConsecWins} / ${s.maxConsecLosses}`} />
        <StatCard label="Sharpe (per-trade)" value={s.sharpe.toFixed(2)} sub="descriptive, not annualized" />
        <StatCard label="Sortino" value={s.sortino.toFixed(2)} />
        <StatCard label="Avg duration" value={`${s.avgDurationMin.toFixed(0)} min`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Equity curve ($)">
          <LineChart points={curve.map((p, i) => ({ x: i, y: p.equity }))} />
        </Panel>
        <Panel title="Cumulative R">
          <LineChart points={curve.map((p, i) => ({ x: i, y: p.cumR }))} color="#60a5fa" />
        </Panel>
        <Panel title="Drawdown ($)">
          <LineChart points={curve.map((p, i) => ({ x: i, y: -p.drawdown }))} color="#f87171" />
        </Panel>
        <Panel title="R distribution">
          <Histogram bins={rHist} />
        </Panel>
        <Panel title="Daily P&L ($)">
          <BarChart data={daily.map((d) => ({ label: d.dayKey.slice(5), value: d.netPnl }))} />
        </Panel>
        <Panel title="Win / loss streak distribution">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <div className="text-[10px] uppercase text-gray-500 mb-1">Winning streaks</div>
              {winStreaks.map((b) => <div key={b.length} className="flex justify-between"><span>{b.length} in a row</span><span className="text-gray-400">{b.count}×</span></div>)}
              {winStreaks.length === 0 && <div className="text-gray-600">—</div>}
            </div>
            <div>
              <div className="text-[10px] uppercase text-gray-500 mb-1">Losing streaks</div>
              {lossStreaks.map((b) => <div key={b.length} className="flex justify-between"><span>{b.length} in a row</span><span className="text-gray-400">{b.count}×</span></div>)}
              {lossStreaks.length === 0 && <div className="text-gray-600">—</div>}
            </div>
          </div>
        </Panel>
        <Panel title={`Drawdown periods (${dds.length})`}>
          <DataTable
            cols={[
              { key: 'start', label: 'Start' },
              { key: 'depth', label: 'Depth $', align: 'right' },
              { key: 'depthR', label: 'Depth R', align: 'right' },
              { key: 'durationTrades', label: 'Trades', align: 'right' },
              { key: 'recovered', label: 'Recovered' },
            ]}
            rows={dds.map((d) => ({
              start: new Date(d.startT * 1000).toISOString().slice(0, 10),
              depth: -d.depth.toFixed(0),
              depthR: -d.depthR.toFixed(1),
              durationTrades: d.durationTrades,
              recovered: d.recovered ? 'yes' : 'ongoing',
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function TradesTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  return (
    <DataTable
      cols={[
        { key: 'time', label: 'Entry' },
        { key: 'dir', label: 'Side' },
        { key: 'entry', label: 'Entry', align: 'right' },
        { key: 'exit', label: 'Exit', align: 'right' },
        { key: 'lots', label: 'Lots', align: 'right' },
        { key: 'net', label: 'Net $', align: 'right', fmt: (v) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{Number(v).toFixed(2)}</span> },
        { key: 'r', label: 'R', align: 'right', fmt: (v) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{Number(v).toFixed(2)}</span> },
        { key: 'mfe', label: 'MFE', align: 'right' },
        { key: 'mae', label: 'MAE', align: 'right' },
        { key: 'session', label: 'Session' },
        { key: 'setup', label: 'Setup' },
        { key: 'strategy', label: 'Strategy' },
        { key: 'verdict', label: 'Verdict' },
        { key: 'exitReason', label: 'Exit' },
        { key: 'tags', label: 'Tags' },
      ]}
      rows={trades.map((t) => ({
        time: fmtDateTime(t.entryTime, tz),
        dir: t.direction,
        entry: t.entryPrice.toFixed(2),
        exit: t.exitPrice?.toFixed(2) ?? '',
        lots: t.initialLots.toFixed(2),
        net: t.pnl - t.commission,
        r: t.r,
        mfe: '+' + t.mfe.toFixed(2),
        mae: '-' + t.mae.toFixed(2),
        session: t.session,
        setup: t.meta.setup ?? '',
        strategy: t.meta.strategyName ?? '',
        verdict: t.verdict ?? '',
        exitReason: t.exitReason ?? '',
        tags: (t.meta.tags ?? []).join(', '),
      }))}
      maxRows={1000}
    />
  );
}

function CalendarTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  const reports = useMemo(() => dayReports(trades, tz), [trades, tz]);
  const byDay = new Map(reports.map((r) => [r.dayKey, r]));
  const months = [...new Set(reports.map((r) => r.dayKey.slice(0, 7)))].sort();
  if (reports.length === 0) return <div className="text-gray-500 text-sm">No trading days yet.</div>;
  return (
    <div className="space-y-6">
      {months.map((m) => {
        const [y, mo] = m.split('-').map(Number);
        const first = new Date(Date.UTC(y, mo - 1, 1));
        const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const startCol = (first.getUTCDay() + 6) % 7; // Monday = 0
        const cells: (string | null)[] = [...Array(startCol).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
        while (cells.length % 7 !== 0) cells.push(null);
        return (
          <div key={m}>
            <div className="text-sm font-semibold text-gray-200 mb-2">{m}</div>
            <div className="grid grid-cols-7 gap-1 max-w-3xl">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-[9px] text-gray-600 text-center">{d}</div>
              ))}
              {cells.map((dk, i) => {
                if (!dk) return <div key={i} />;
                const r = byDay.get(dk);
                const bg = !r ? 'bg-[#0d1119]' : r.netPnl >= 0 ? 'bg-emerald-600/25' : 'bg-red-600/25';
                const intensity = !r ? 0 : Math.min(1, Math.abs(r.netPnl) / 500);
                return (
                  <div
                    key={i}
                    title={r ? `${dk}\nP&L ${r.netPnl.toFixed(2)} · ${r.netR.toFixed(1)}R · ${r.stats.trades} trades · WR ${(r.stats.winRate * 100).toFixed(0)}% · ${r.classification}` : dk}
                    className={`aspect-square rounded p-1 text-[9px] ${bg} border border-[#161b26] flex flex-col justify-between`}
                    style={r ? { backgroundColor: r.netPnl >= 0 ? `rgba(52,211,153,${0.1 + intensity * 0.45})` : `rgba(248,113,113,${0.1 + intensity * 0.45})` } : undefined}
                  >
                    <span className="text-gray-500">{dk.slice(8)}</span>
                    {r && (
                      <>
                        <span className={r.netPnl >= 0 ? 'text-emerald-200' : 'text-red-200'}>{r.netPnl >= 0 ? '+' : ''}{r.netPnl.toFixed(0)}</span>
                        <span className="text-gray-400">{r.stats.trades}t {(r.stats.winRate * 100).toFixed(0)}%</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionsTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  const bySession = useMemo(() => groupBy(trades, (t) => t.session || 'none'), [trades]);
  const sessionDow = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const t of trades) {
      const s = t.session || 'none';
      const d = String(parts(t.entryTime, tz).weekday);
      if (!map.has(s)) map.set(s, new Map());
      const inner = map.get(s)!;
      inner.set(d, (inner.get(d) ?? 0) + t.r);
    }
    return map;
  }, [trades, tz]);
  const sessions = [...new Set(trades.map((t) => t.session || 'none'))];
  const dows = [...new Set(trades.map((t) => String(parts(t.entryTime, tz).weekday)))].sort();
  return (
    <div className="space-y-4">
      <Panel title="Performance by session">
        <GroupTable gs={bySession} />
      </Panel>
      <Panel title="Session × weekday heatmap (net R)">
        <Heatmap
          rows={sessions}
          cols={dows.map((d) => DOW[Number(d)])}
          values={sessions.map((s) => dows.map((d) => sessionDow.get(s)?.get(d) ?? null))}
          fmt={(v) => v.toFixed(1)}
        />
      </Panel>
    </div>
  );
}

function TimeTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  const byHour = useMemo(() => groupBy(trades, (t) => String(parts(t.entryTime, tz).hour).padStart(2, '0') + ':00'), [trades, tz]);
  const byHalfHour = useMemo(() => groupBy(trades, (t) => {
    const p = parts(t.entryTime, tz);
    return `${String(p.hour).padStart(2, '0')}:${p.minute < 30 ? '00' : '30'}`;
  }), [trades, tz]);
  return (
    <div className="space-y-4">
      <Panel title="Net R by hour of day">
        <BarChart data={[...byHour].sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ label: g.key, value: g.netR }))} valueFmt={(v) => v.toFixed(1) + 'R'} />
      </Panel>
      <Panel title="30-minute blocks">
        <GroupTable gs={byHalfHour} sortKey />
      </Panel>
    </div>
  );
}

function DaysTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  const byDow = useMemo(() => groupBy(trades, (t) => DOW[parts(t.entryTime, tz).weekday]), [trades, tz]);
  const daily = useMemo(() => dayReports(trades, tz), [trades, tz]);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="space-y-4">
      <Panel title="Day-of-week performance">
        <GroupTable gs={[...byDow].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))} />
      </Panel>
      <Panel title={`Daily classification (good day = net R ≥ ${DEFAULT_THRESHOLDS.goodDayMinR}; flat = |R| < ${DEFAULT_THRESHOLDS.flatDayAbsR} — configurable in Settings)`}>
        <DataTable
          cols={[
            { key: 'dayKey', label: 'Date' },
            { key: 'trades', label: 'Trades', align: 'right' },
            { key: 'winRate', label: 'Win %', align: 'right', fmt: (v) => (Number(v) * 100).toFixed(0) + '%' },
            { key: 'netPnl', label: 'Net $', align: 'right', fmt: (v) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{Number(v).toFixed(2)}</span> },
            { key: 'netR', label: 'Net R', align: 'right', fmt: (v) => Number(v).toFixed(2) },
            { key: 'maxDd', label: 'Max DD', align: 'right', fmt: (v) => Number(v).toFixed(0) },
            { key: 'best', label: 'Best trade', align: 'right' },
            { key: 'worst', label: 'Worst trade', align: 'right' },
            { key: 'violations', label: 'Rule violations', align: 'right' },
            { key: 'classification', label: 'Day' },
            { key: 'quality', label: 'Quality' },
          ]}
          rows={daily.map((d) => ({
            dayKey: d.dayKey,
            trades: d.stats.trades,
            winRate: d.stats.winRate,
            netPnl: d.netPnl,
            netR: d.netR,
            maxDd: d.stats.maxDrawdown,
            best: d.bestTrade ? (d.bestTrade.pnl - d.bestTrade.commission).toFixed(0) : '',
            worst: d.worstTrade ? (d.worstTrade.pnl - d.worstTrade.commission).toFixed(0) : '',
            violations: d.ruleViolations,
            classification: d.classification,
            quality: d.quality,
          }))}
        />
      </Panel>
    </div>
  );
}

function ConditionsTab({ trades }: { trades: TradeRecord[] }) {
  const byCondition = useMemo(() => groupBy(trades, (t) => t.condition || 'unknown'), [trades]);
  const byVol = useMemo(() => groupBy(trades, (t) => (t.condition.split('/')[2] ?? 'unknown')), [trades]);
  const byTrend = useMemo(() => groupBy(trades, (t) => (t.condition.split('/')[0] ?? 'unknown')), [trades]);
  const byBias = useMemo(() => groupBy(trades, (t) => t.htfBias || 'unknown'), [trades]);
  const byMistake = useMemo(() => {
    const rows: { key: string; trades: number; winRate: number; netPnl: number; avgR: number }[] = [];
    const all = new Set<string>();
    trades.forEach((t) => (t.meta.mistakes ?? []).forEach((m) => all.add(m)));
    all.forEach((m) => {
      const sub = trades.filter((t) => (t.meta.mistakes ?? []).includes(m));
      const cs = coreStats(sub);
      rows.push({ key: m, trades: sub.length, winRate: cs.winRate, netPnl: cs.netProfit, avgR: cs.avgR });
    });
    return rows.sort((a, b) => a.netPnl - b.netPnl);
  }, [trades]);

  return (
    <div className="space-y-4">
      <Panel title="By composite market condition (trend/state/volatility)">
        <GroupTable gs={byCondition} />
      </Panel>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="Volatility regime"><GroupTable gs={byVol} /></Panel>
        <Panel title="Trend direction"><GroupTable gs={byTrend} /></Panel>
        <Panel title="HTF bias at entry"><GroupTable gs={byBias} /></Panel>
      </div>
      <Panel title="Mistake cost analysis (from journal tags)">
        {byMistake.length === 0 ? (
          <div className="text-[11px] text-gray-500">Tag mistakes on trades in the Journal to see what each mistake costs you.</div>
        ) : (
          <DataTable
            cols={[
              { key: 'key', label: 'Mistake' },
              { key: 'trades', label: 'Trades', align: 'right' },
              { key: 'winRate', label: 'Win %', align: 'right', fmt: (v) => (Number(v) * 100).toFixed(0) + '%' },
              { key: 'avgR', label: 'Avg R', align: 'right', fmt: (v) => Number(v).toFixed(2) },
              { key: 'netPnl', label: 'Net $', align: 'right', fmt: (v) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{Number(v).toFixed(2)}</span> },
            ]}
            rows={byMistake as unknown as Record<string, unknown>[]}
          />
        )}
      </Panel>
    </div>
  );
}

function ExcursionTab({ trades }: { trades: TradeRecord[] }) {
  const ex = useMemo(() => excursionStats(trades), [trades]);
  const tpWhatIf = useMemo(() => whatIfTp(trades, [1, 1.5, 2, 2.5, 3, 4]), [trades]);
  const slWhatIf = useMemo(() => whatIfSl(trades, [0.5, 0.75, 1, 1.5, 2]), [trades]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 max-w-xl">
        <StatCard label="Avg MFE" value={`+${ex.avgMfe.toFixed(2)}`} />
        <StatCard label="Avg MAE" value={`-${ex.avgMae.toFixed(2)}`} />
        <StatCard label="Winners w/ MAE ≤ 50% SL" value={`${(ex.winnersSmoothPct * 100).toFixed(0)}%`} sub="smooth winners" />
      </div>
      <Panel title="What-if: fixed R-multiple take profit (resimulated from recorded post-entry paths; conservative same-candle rule)">
        <DataTable
          cols={[
            { key: 'label', label: 'Scenario' },
            { key: 'wins', label: 'Wins', align: 'right' },
            { key: 'losses', label: 'Losses', align: 'right' },
            { key: 'winRate', label: 'Win %', align: 'right', fmt: (v) => (Number(v) * 100).toFixed(1) + '%' },
            { key: 'expectancyR', label: 'Expectancy R', align: 'right', fmt: (v) => Number(v).toFixed(3) },
            { key: 'netR', label: 'Net R', align: 'right', fmt: (v) => Number(v).toFixed(1) },
            { key: 'profitFactor', label: 'PF', align: 'right', fmt: (v) => isFinite(Number(v)) ? Number(v).toFixed(2) : '∞' },
          ]}
          rows={tpWhatIf as unknown as Record<string, unknown>[]}
        />
      </Panel>
      <Panel title="What-if: SL size multiplier (same TP, resimulated)">
        <DataTable
          cols={[
            { key: 'label', label: 'Scenario' },
            { key: 'wins', label: 'Wins', align: 'right' },
            { key: 'losses', label: 'Losses', align: 'right' },
            { key: 'winRate', label: 'Win %', align: 'right', fmt: (v) => (Number(v) * 100).toFixed(1) + '%' },
            { key: 'expectancyR', label: 'Expectancy R', align: 'right', fmt: (v) => Number(v).toFixed(3) },
            { key: 'netR', label: 'Net R', align: 'right', fmt: (v) => Number(v).toFixed(1) },
          ]}
          rows={slWhatIf as unknown as Record<string, unknown>[]}
        />
      </Panel>
      <div className="text-[10px] text-gray-600 max-w-2xl">
        What-if results are computed from the recorded candle path after each entry. We deliberately do not label any setting "optimal" — read the distributions.
      </div>
    </div>
  );
}

function MonteCarloTab({ trades }: { trades: Trade[] }) {
  const [result, setResult] = useState<ReturnType<typeof monteCarlo> | null>(null);
  const [sims, setSims] = useState(1000);
  const [target, setTarget] = useState(10);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">Simulations
          <input type="number" value={sims} onChange={(e) => setSims(Math.max(100, parseInt(e.target.value) || 1000))} className="w-20 bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1" />
        </label>
        <label className="flex items-center gap-1">Target (R)
          <input type="number" value={target} onChange={(e) => setTarget(parseFloat(e.target.value) || 10)} className="w-16 bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1" />
        </label>
        <button
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
          onClick={() => setResult(monteCarlo(trades, sims, [5, 10, 15, 20], target))}
        >
          Run bootstrap (resamples your {trades.length} actual trades)
        </button>
      </div>
      {result && result.simulations > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatCard label="Median final R" value={result.finalR.p50.toFixed(1) + 'R'} sub={`p5 ${result.finalR.p5.toFixed(1)} / p95 ${result.finalR.p95.toFixed(1)}`} />
            <StatCard label="Median max DD" value={result.maxDdR.p50.toFixed(1) + 'R'} sub={`p95 ${result.maxDdR.p95.toFixed(1)}R`} tone="down" />
            <StatCard label="Worst losing streak (p95)" value={String(result.maxConsecLosses.p95)} sub={`max observed ${result.maxConsecLosses.max}`} />
            <StatCard label={`P(reach ${target}R)`} value={(result.probTargetReached[0].probability * 100).toFixed(0) + '%'} />
          </div>
          <Panel title="25 sample resampled equity paths (R) — statistical scenarios, NOT predictions">
            <svg viewBox="0 0 600 160" className="w-full">
              {result.samplePaths.map((path, i) => {
                const maxY = Math.max(...path, 1);
                const minY = Math.min(...path, 0);
                const span = maxY - minY || 1;
                const d = path.map((y, x) => `${x === 0 ? 'M' : 'L'}${(x / (path.length - 1)) * 580 + 10},${150 - ((y - minY) / span) * 130}`).join(' ');
                return <path key={i} d={d} fill="none" stroke="#60a5fa" strokeWidth={0.8} opacity={0.35} />;
              })}
            </svg>
          </Panel>
          <Panel title="Drawdown risk">
            <div className="flex gap-4 text-xs">
              {result.probDdExceeds.map((p) => (
                <div key={p.thresholdR} className="bg-[#0d1119] border border-[#1a1f2b] rounded p-2">
                  <div className="text-[10px] text-gray-500">DD ≥ {p.thresholdR}R</div>
                  <div className={`font-semibold ${p.probability > 0.5 ? 'text-red-400' : 'text-gray-200'}`}>{(p.probability * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ReportsTab({ trades, tz }: { trades: TradeRecord[]; tz: string }) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const daily = useMemo(() => dayReports(trades, tz), [trades, tz]);
  const weekly = useMemo(() => periodReports(trades, tz, 'week'), [trades, tz]);
  const monthly = useMemo(() => periodReports(trades, tz, 'month'), [trades, tz]);
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['day', 'week', 'month'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded text-xs capitalize ${period === p ? 'bg-emerald-600/30 text-emerald-300' : 'bg-[#12161f] text-gray-500'}`}>{p}</button>
        ))}
      </div>
      {period === 'day' && (
        <div className="space-y-2">
          {[...daily].reverse().slice(0, 30).map((d) => (
            <div key={d.dayKey} className="bg-[#0d1119] border border-[#1a1f2b] rounded p-3 text-xs">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-gray-200">{d.dayKey}</span>
                <Badge tone={d.classification === 'positive' ? 'up' : d.classification === 'negative' ? 'down' : 'flat'}>{d.classification}</Badge>
                <span>Trades {d.stats.trades}</span>
                <span>WR {(d.stats.winRate * 100).toFixed(0)}%</span>
                <span className={d.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{d.netPnl >= 0 ? '+' : ''}${d.netPnl.toFixed(2)}</span>
                <span>{d.netR.toFixed(1)}R</span>
                <span className="text-gray-500">maxDD ${d.stats.maxDrawdown.toFixed(0)}</span>
                {d.ruleViolations > 0 && <span className="text-red-300">{d.ruleViolations} rule violation(s)</span>}
              </div>
              <div className="mt-1 text-gray-500 text-[11px]">
                What happened (measured): {d.bySession.map((s) => `${s.key}: ${s.trades}t ${s.netPnl >= 0 ? '+' : ''}$${s.netPnl.toFixed(0)}`).join(' · ') || 'no session data'}
                {d.bestTrade && <> · best {(d.bestTrade.pnl - d.bestTrade.commission).toFixed(0)} · worst {(d.worstTrade!.pnl - d.worstTrade!.commission).toFixed(0)}</>}
              </div>
            </div>
          ))}
        </div>
      )}
      {period !== 'day' && (
        <div className="space-y-2">
          {(period === 'week' ? weekly : monthly).slice().reverse().map((r) => (
            <div key={r.key} className="bg-[#0d1119] border border-[#1a1f2b] rounded p-3 text-xs">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-gray-200">{r.key}</span>
                <span>Trades {r.stats.trades}</span>
                <span>WR {(r.stats.winRate * 100).toFixed(0)}%</span>
                <span className={r.stats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{r.stats.netProfit >= 0 ? '+' : ''}${r.stats.netProfit.toFixed(2)}</span>
                <span>PF {isFinite(r.stats.profitFactor) ? r.stats.profitFactor.toFixed(2) : '∞'}</span>
                <span className="text-gray-500">maxDD ${r.stats.maxDrawdown.toFixed(0)}</span>
              </div>
              <div className="mt-1 text-gray-500 text-[11px]">
                Best day {r.bestDay ?? '—'} · worst day {r.worstDay ?? '—'} · best session {r.bestSession ?? '—'} · worst session {r.worstSession ?? '—'} · best setup {r.bestSetup ?? '—'} · worst setup {r.worstSetup ?? '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareTab() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [backtests, setBacktests] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<{ a: ReturnType<typeof coreStats>; b: ReturnType<typeof coreStats>; nameA: string; nameB: string } | null>(null);

  useState(() => {
    void import('../store/db').then(({ db }) => db.backtests.toArray().then((rows) => setBacktests(rows.map((r) => ({ id: r.id, name: r.name })))));
  });

  const run = async () => {
    const { db } = await import('../store/db');
    const ra = await db.backtests.get(a);
    const rb = await db.backtests.get(b);
    if (!ra || !rb) return;
    setStats({ a: coreStats(ra.trades), b: coreStats(rb.trades), nameA: ra.name, nameB: rb.name });
  };

  const rows: { label: string; get: (s: ReturnType<typeof coreStats>) => string }[] = [
    { label: 'Trades', get: (s) => String(s.trades) },
    { label: 'Win rate', get: (s) => (s.winRate * 100).toFixed(1) + '%' },
    { label: 'Expectancy R', get: (s) => s.expectancyR.toFixed(3) },
    { label: 'Profit factor', get: (s) => (isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') },
    { label: 'Net profit', get: (s) => '$' + s.netProfit.toFixed(2) },
    { label: 'Max drawdown', get: (s) => '$' + s.maxDrawdown.toFixed(0) },
    { label: 'Avg win / loss', get: (s) => `$${s.avgWin.toFixed(0)} / $${s.avgLoss.toFixed(0)}` },
    { label: 'Max consec. losses', get: (s) => String(s.maxConsecLosses) },
    { label: 'Sharpe (per-trade)', get: (s) => s.sharpe.toFixed(2) },
  ];

  return (
    <div className="space-y-3 text-xs">
      <div className="flex gap-2 items-center flex-wrap">
        <select value={a} onChange={(e) => setA(e.target.value)} className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1">
          <option value="">Strategy / backtest A…</option>
          {backtests.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
        </select>
        <span className="text-gray-500">vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1">
          <option value="">Strategy / backtest B…</option>
          {backtests.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
        </select>
        <button onClick={run} disabled={!a || !b} className="px-3 py-1.5 rounded bg-emerald-600 disabled:opacity-40 text-white">Compare</button>
      </div>
      {stats && (
        <table className="max-w-2xl w-full">
          <thead>
            <tr><th className="text-left text-[10px] uppercase text-gray-500 px-2 py-1">Metric</th><th className="text-right text-[10px] uppercase text-gray-500 px-2 py-1">{stats.nameA}</th><th className="text-right text-[10px] uppercase text-gray-500 px-2 py-1">{stats.nameB}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[#161b26]">
                <td className="px-2 py-1 text-gray-400">{r.label}</td>
                <td className="px-2 py-1 text-right font-mono">{r.get(stats.a)}</td>
                <td className="px-2 py-1 text-right font-mono">{r.get(stats.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {backtests.length === 0 && <div className="text-gray-500">Save backtests (Terminal → save button) to compare them here — e.g. A/B one rule at a time.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-3">
      <div className="text-[11px] font-semibold text-gray-300 mb-2">{title}</div>
      {children}
    </div>
  );
}

function GroupTable({ gs, sortKey }: { gs: GroupStats[]; sortKey?: boolean }) {
  const rows = sortKey ? [...gs].sort((a, b) => a.key.localeCompare(b.key)) : gs;
  return (
    <DataTable
      cols={[
        { key: 'key', label: 'Group' },
        { key: 'trades', label: 'Trades', align: 'right' },
        { key: 'winRate', label: 'Win %', align: 'right', fmt: (v) => (Number(v) * 100).toFixed(1) + '%' },
        { key: 'avgR', label: 'Avg R', align: 'right', fmt: (v) => Number(v).toFixed(2) },
        { key: 'netR', label: 'Net R', align: 'right', fmt: (v) => Number(v).toFixed(1) },
        { key: 'netPnl', label: 'Net $', align: 'right', fmt: (v) => <span className={Number(v) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{Number(v).toFixed(2)}</span> },
        { key: 'profitFactor', label: 'PF', align: 'right', fmt: (v) => isFinite(Number(v)) ? Number(v).toFixed(2) : '∞' },
        { key: 'expectancyR', label: 'Expect. R', align: 'right', fmt: (v) => Number(v).toFixed(3) },
      ]}
      rows={rows as unknown as Record<string, unknown>[]}
    />
  );
}

function Badge({ tone, children }: { tone: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  const cls = tone === 'up' ? 'bg-emerald-600/30 text-emerald-300' : tone === 'down' ? 'bg-red-600/30 text-red-300' : 'bg-gray-600/30 text-gray-300';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{children}</span>;
}
