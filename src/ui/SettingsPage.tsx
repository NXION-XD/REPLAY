// ============================================================================
// Settings — timezone, sessions, execution, account, prop firm, analysis
// thresholds. Everything configurable; nothing hardcoded.
// ============================================================================

import { useState } from 'react';
import { lab, useLabVersion, useUi } from '../store/store';
import { COMMON_TIMEZONES } from '../engine/tz';
import type { SessionDef } from '../engine/types';
import { TIMEFRAMES } from '../engine/types';
import type { TimeframeId } from '../engine/types';
import type { AccountConfig, ExecutionConfig, PropFirmConfig } from '../engine/types';

export function SettingsPage() {
  useLabVersion();
  const { settings, setSettings } = useUi();
  const [exec, setExec] = useState<ExecutionConfig>({ ...lab.execution });
  const [acct, setAcct] = useState<AccountConfig>({ ...lab.accountCfg });
  const [prop, setProp] = useState<PropFirmConfig>(lab.prop?.cfg ?? {
    enabled: false, startingBalance: 10000, profitTargetPct: 10, dailyDrawdownPct: 5,
    maxDrawdownPct: 10, minTradingDays: 3, maxPositionLots: 5, consistencyPct: 40, weekendHoldAllowed: false,
  });
  const [savedMsg, setSavedMsg] = useState('');

  const save = (msg: string) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 1500);
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-xs">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        {savedMsg && <div className="text-emerald-400">{savedMsg}</div>}

        <Section title="Timezone & sessions" desc="All session, journal, report and calendar grouping uses this timezone (IANA, DST-correct).">
          <label className="flex items-center gap-2">
            Display timezone
            <select
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              className={inp}
            >
              {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
          <SessionEditor
            sessions={settings.sessions}
            onChange={(sessions) => setSettings({ ...settings, sessions })}
          />
        </Section>

        <Section title="Execution model" desc="Realistic mode applies spread, commission and slippage. Ideal mode assumes perfect mid-price fills. Compare both by re-running the same trades.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">Mode
              <select value={exec.mode} onChange={(e) => setExec({ ...exec, mode: e.target.value as ExecutionConfig['mode'] })} className={inp}>
                <option value="ideal">Ideal backtest</option>
                <option value="realistic">Realistic backtest</option>
              </select>
            </label>
            <Num label="Spread (points)" v={exec.spreadPoints} set={(v) => setExec({ ...exec, spreadPoints: v })} />
            <Num label="Commission $/lot/side" v={exec.commissionPerLot} set={(v) => setExec({ ...exec, commissionPerLot: v })} />
            <Num label="Slippage (points)" v={exec.slippagePoints} set={(v) => setExec({ ...exec, slippagePoints: v })} />
            <label className="flex flex-col gap-1">Same-candle SL+TP rule
              <select value={exec.sameCandleRule} onChange={(e) => setExec({ ...exec, sameCandleRule: e.target.value as ExecutionConfig['sameCandleRule'] })} className={inp}>
                <option value="sl_first">SL first (conservative)</option>
                <option value="tp_first">TP first (optimistic)</option>
              </select>
            </label>
          </div>
          <Btn onClick={() => { lab.setExecution(exec); save('Execution settings applied.'); }}>Apply execution</Btn>
        </Section>

        <Section title="Account & risk limits" desc="New trades are blocked when limits are breached.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Num label="Initial balance" v={acct.initialBalance} set={(v) => setAcct({ ...acct, initialBalance: v })} />
            <Num label="Risk per trade %" v={acct.riskPerTradePct} set={(v) => setAcct({ ...acct, riskPerTradePct: v })} />
            <Num label="Max daily loss % (0=off)" v={acct.maxDailyLossPct} set={(v) => setAcct({ ...acct, maxDailyLossPct: v })} />
            <Num label="Max weekly loss % (0=off)" v={acct.maxWeeklyLossPct} set={(v) => setAcct({ ...acct, maxWeeklyLossPct: v })} />
            <Num label="Max monthly loss % (0=off)" v={acct.maxMonthlyLossPct} set={(v) => setAcct({ ...acct, maxMonthlyLossPct: v })} />
            <Num label="Max trades/day (0=off)" v={acct.maxTradesPerDay} set={(v) => setAcct({ ...acct, maxTradesPerDay: v })} />
            <Num label="Max consecutive losses (0=off)" v={acct.maxConsecLosses} set={(v) => setAcct({ ...acct, maxConsecLosses: v })} />
            <Num label="Max open trades (0=off)" v={acct.maxOpenTrades} set={(v) => setAcct({ ...acct, maxOpenTrades: v })} />
            <Num label="Max exposure lots (0=off)" v={acct.maxExposureLots} set={(v) => setAcct({ ...acct, maxExposureLots: v })} />
          </div>
          <Btn onClick={() => { lab.setAccountCfg(acct); lab.account.cfg = acct; save('Account settings applied.'); }}>Apply account</Btn>
        </Section>

        <Section title="Prop-firm challenge (optional)" desc="Fully configurable rules — no specific firm is hardcoded.">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prop.enabled} onChange={(e) => setProp({ ...prop, enabled: e.target.checked })} />
            Enable prop-firm mode
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Num label="Starting balance" v={prop.startingBalance} set={(v) => setProp({ ...prop, startingBalance: v })} />
            <Num label="Profit target %" v={prop.profitTargetPct} set={(v) => setProp({ ...prop, profitTargetPct: v })} />
            <Num label="Daily drawdown %" v={prop.dailyDrawdownPct} set={(v) => setProp({ ...prop, dailyDrawdownPct: v })} />
            <Num label="Max drawdown %" v={prop.maxDrawdownPct} set={(v) => setProp({ ...prop, maxDrawdownPct: v })} />
            <Num label="Min trading days" v={prop.minTradingDays} set={(v) => setProp({ ...prop, minTradingDays: v })} />
            <Num label="Max position lots" v={prop.maxPositionLots} set={(v) => setProp({ ...prop, maxPositionLots: v })} />
            <Num label="Consistency % (0=off)" v={prop.consistencyPct} set={(v) => setProp({ ...prop, consistencyPct: v })} />
          </div>
          <Btn onClick={() => { lab.enablePropFirm(prop.enabled ? prop : null); save(prop.enabled ? 'Prop challenge started.' : 'Prop mode disabled.'); }}>Apply prop rules</Btn>
        </Section>

        <Section title="Market structure & detection thresholds" desc="These thresholds define swing sensitivity, FVG size and the trend/volatility classifiers. Changing them re-labels history — by design, they are YOUR definitions.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Num label="Swing left bars" v={settings.structure.left} set={(v) => setSettings({ ...settings, structure: { ...settings.structure, left: Math.round(v) } })} />
            <Num label="Swing right bars" v={settings.structure.right} set={(v) => setSettings({ ...settings, structure: { ...settings.structure, right: Math.round(v) } })} />
            <label className="flex items-center gap-2 mt-4">
              <input type="checkbox" checked={settings.structure.closeBreaks} onChange={(e) => setSettings({ ...settings, structure: { ...settings.structure, closeBreaks: e.target.checked } })} />
              BOS requires close beyond level
            </label>
            <Num label="FVG min size (points)" v={settings.fvgMinPoints} set={(v) => setSettings({ ...settings, fvgMinPoints: v })} />
            <Num label="Sweep window (candles)" v={settings.sweepWindowCandles} set={(v) => setSettings({ ...settings, sweepWindowCandles: Math.round(v) })} />
            <Num label="ATR period" v={settings.condition.atrPeriod} set={(v) => setSettings({ ...settings, condition: { ...settings.condition, atrPeriod: Math.round(v) } })} />
            <Num label="Low-vol percentile" v={settings.condition.lowVolPct} step={0.05} set={(v) => setSettings({ ...settings, condition: { ...settings.condition, lowVolPct: v } })} />
            <Num label="High-vol percentile" v={settings.condition.highVolPct} step={0.05} set={(v) => setSettings({ ...settings, condition: { ...settings.condition, highVolPct: v } })} />
            <Num label="ER trend threshold" v={settings.condition.erTrend} step={0.05} set={(v) => setSettings({ ...settings, condition: { ...settings.condition, erTrend: v } })} />
            <Num label="ER range threshold" v={settings.condition.erRange} step={0.05} set={(v) => setSettings({ ...settings, condition: { ...settings.condition, erRange: v } })} />
          </div>
        </Section>

        <Section title="HTF bias timeframes" desc="EMA 20/50 alignment on these timeframes defines HTF bias (closed candles only — no look-ahead).">
          <div className="flex gap-3">
            <label className="flex items-center gap-2">Primary
              <select value={settings.htfPrimary} onChange={(e) => setSettings({ ...settings, htfPrimary: e.target.value as TimeframeId })} className={inp}>
                {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Secondary
              <select value={settings.htfSecondary} onChange={(e) => setSettings({ ...settings, htfSecondary: e.target.value as TimeframeId })} className={inp}>
                {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
        </Section>

        <Section title="Day classification" desc="Used by the Good/Bad day analyzer and calendar.">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Num label="Good day: net R ≥" v={settings.goodDayMinR} step={0.5} set={(v) => setSettings({ ...settings, goodDayMinR: v })} />
            <Num label="Flat day: |net R| <" v={settings.flatDayAbsR} step={0.05} set={(v) => setSettings({ ...settings, flatDayAbsR: v })} />
          </div>
        </Section>

        <div className="text-[10px] text-gray-600 pt-4 border-t border-[#1a1f2b]">
          Charting by TradingView Lightweight Charts™ (Apache-2.0). Historical backtest results do not guarantee future performance.
        </div>
      </div>
    </div>
  );
}

function SessionEditor({ sessions, onChange }: { sessions: SessionDef[]; onChange: (s: SessionDef[]) => void }) {
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const parse = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return (
    <div className="space-y-1">
      {sessions.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 flex-wrap">
          <input value={s.name} onChange={(e) => { const n = [...sessions]; n[i] = { ...s, name: e.target.value }; onChange(n); }} className={`${inp} w-28`} />
          <input type="time" value={fmt(s.startMin)} onChange={(e) => { const n = [...sessions]; n[i] = { ...s, startMin: parse(e.target.value) }; onChange(n); }} className={inp} />
          <span className="text-gray-500">→</span>
          <input type="time" value={fmt(s.endMin)} onChange={(e) => { const n = [...sessions]; n[i] = { ...s, endMin: parse(e.target.value) }; onChange(n); }} className={inp} />
          <input type="color" value={s.color} onChange={(e) => { const n = [...sessions]; n[i] = { ...s, color: e.target.value }; onChange(n); }} className="w-6 h-6 rounded bg-transparent" />
          <button onClick={() => onChange(sessions.filter((_, j) => j !== i))} className="text-red-400 text-[10px]">remove</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...sessions, { id: 'custom-' + Date.now().toString(36), name: 'Custom', startMin: 0, endMin: 480, color: '#22d3ee' }])}
        className="text-[11px] text-gray-400 hover:text-white"
      >+ add session (midnight-crossing supported)</button>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
        {desc && <p className="text-[11px] text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Num({ label, v, set, step = 1 }: { label: string; v: number; set: (v: number) => void; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-gray-500">{label}</span>
      <input type="number" step={step} value={v} onChange={(e) => set(parseFloat(e.target.value) || 0)} className={inp} />
    </label>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">{children}</button>;
}

const inp = 'bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1.5 text-gray-200 outline-none focus:border-emerald-500/60';
