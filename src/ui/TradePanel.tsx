// ============================================================================
// TradePanel — order ticket with full risk math + live strategy verdict.
// ============================================================================

import { useMemo, useState } from 'react';
import { lab, useLabVersion, useUi } from '../store/store';
import type { Direction, OrderType } from '../engine/types';
import { lotsForRisk, riskFor } from '../engine/execution';
import { evaluateStrategy } from '../engine/rules';
import type { TradeMeta } from '../engine/types';

const SETUPS = ['London Sweep', 'Asia Reversal', 'NY Continuation', 'Breakout', 'FVG Entry', 'MSS Retrace', 'Range Fade', 'Other'];
const MISTAKES = ['FOMO', 'Late entry', 'Early entry', 'Overtrading', 'Moved SL', 'Moved TP', 'Ignored setup', 'Ignored HTF', 'Wrong session', 'Revenge trade', 'No confirmation', 'Bad R:R'];

export function TradePanel() {
  useLabVersion();
  const { strategies, activeStrategyId, setRightTab } = useUi();
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [pendingPrice, setPendingPrice] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [riskMoney, setRiskMoney] = useState('');
  const [lots, setLots] = useState('');
  const [sizeMode, setSizeMode] = useState<'risk' | 'lots'>('risk');
  const [setup, setSetup] = useState('');
  const [tags, setTags] = useState('');
  const [emotion, setEmotion] = useState('');
  const [confidence, setConfidence] = useState('7');
  const [lastMsg, setLastMsg] = useState('');

  const candle = lab.currentCandle();
  const price = candle?.c ?? 0;
  const spec = lab.spec;
  const strategy = strategies.find((s) => s.id === activeStrategyId) ?? null;

  const slNum = parseFloat(sl) || 0;
  const tpNum = parseFloat(tp) || 0;
  const entryForCalc = orderType === 'market' ? price : parseFloat(pendingPrice) || price;

  const rr = useMemo(() => {
    const d = Math.abs(entryForCalc - slNum);
    if (d <= 0 || tpNum <= 0) return 0;
    return Math.abs(tpNum - entryForCalc) / d;
  }, [entryForCalc, slNum, tpNum]);

  const slDistPoints = Math.abs(entryForCalc - slNum) / spec.point;

  const computed = useMemo(() => {
    if (!candle || slNum <= 0) return null;
    const balance = lab.account.balance;
    const risk$ = sizeMode === 'risk'
      ? (riskMoney ? parseFloat(riskMoney) : balance * (parseFloat(riskPct) || 0) / 100)
      : riskFor(entryForCalc, slNum, parseFloat(lots) || 0, spec);
    const computedLots = sizeMode === 'risk'
      ? lotsForRisk(risk$, entryForCalc, slNum, spec)
      : parseFloat(lots) || 0.01;
    const commission = lab.execution.mode === 'realistic' ? lab.execution.commissionPerLot * computedLots : 0;
    const reward$ = tpNum > 0 ? Math.abs(tpNum - entryForCalc) * spec.contractSize * computedLots : 0;
    return { risk$, lots: computedLots, commission, reward$ };
  }, [candle, slNum, entryForCalc, riskPct, riskMoney, lots, sizeMode, tpNum, spec]);

  // live rule evaluation
  const verdict = useMemo(() => {
    if (!strategy || !candle) return null;
    const ctx = lab.buildRuleContext(rr, slDistPoints);
    return evaluateStrategy(strategy.tree, ctx, strategy.gradeA, strategy.gradeB);
  }, [strategy, candle, rr, slDistPoints]);

  const place = (direction: Direction) => {
    if (!candle || !computed || computed.lots <= 0 || slNum <= 0) {
      setLastMsg('Set a valid stop loss first.');
      return;
    }
    const breaches = lab.account.checkLimits(lab.broker.open.length, lab.broker.exposureLots());
    if (breaches.length > 0) {
      setLastMsg('⛔ ' + breaches.map((b) => b.detail).join('; '));
      return;
    }
    if (lab.prop) {
      const notAllowed = lab.prop.checkOrderAllowed(computed.lots);
      if (notAllowed) {
        setLastMsg('⛔ Prop: ' + notAllowed);
        return;
      }
    }
    const meta: TradeMeta = {
      strategyId: strategy?.id,
      strategyName: strategy?.name,
      setup: setup || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      mistakes: [],
      emotionBefore: emotion || undefined,
      confidence: parseInt(confidence) || undefined,
      notes: undefined,
    };
    const cond = lab.conditionAt();
    const session = lab.sessionNow()?.id ?? 'none';
    const htfBias = lab.buildRuleContext()?.htfBias ?? 'neutral';

    if (orderType === 'market') {
      const tr = lab.broker.placeMarket(direction, computed.lots, slNum, tpNum, candle, meta, verdict?.verdict, session, cond?.label ?? '', htfBias, lab.dataset!.baseTf);
      setLastMsg(`✓ ${direction.toUpperCase()} ${tr.lots} @ ${tr.entryPrice.toFixed(spec.digits)}`);
    } else {
      const px = parseFloat(pendingPrice);
      if (!px) {
        setLastMsg('Set pending order price.');
        return;
      }
      lab.broker.placePending(orderType, direction, px, computed.lots, slNum, tpNum, candle, meta, verdict?.verdict);
      setLastMsg(`✓ ${orderType} ${direction} @ ${px}`);
    }
    // lab emits via version bump (broker is part of lab)
    lab.notify();
  };

  return (
    <div className="flex flex-col gap-2 p-2 text-xs h-full overflow-y-auto">
      {/* order type */}
      <div className="flex gap-1">
        {(['market', 'limit', 'stop'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`flex-1 py-1 rounded capitalize ${orderType === t ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'bg-[#12161f] text-gray-400 border border-[#232a38]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {orderType !== 'market' && (
        <Field label={`${orderType} price`}>
          <input value={pendingPrice} onChange={(e) => setPendingPrice(e.target.value)} className={inputCls} placeholder={price ? price.toFixed(spec.digits) : ''} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Stop loss">
          <input value={sl} onChange={(e) => setSl(e.target.value)} className={inputCls} placeholder={price ? (price - 5).toFixed(spec.digits) : ''} />
        </Field>
        <Field label="Take profit">
          <input value={tp} onChange={(e) => setTp(e.target.value)} className={inputCls} placeholder={price ? (price + 10).toFixed(spec.digits) : ''} />
        </Field>
      </div>

      {/* sizing */}
      <div className="flex gap-1 text-[10px]">
        <button onClick={() => setSizeMode('risk')} className={`px-2 py-0.5 rounded ${sizeMode === 'risk' ? 'bg-emerald-600/30 text-emerald-300' : 'bg-[#12161f] text-gray-500'}`}>by Risk</button>
        <button onClick={() => setSizeMode('lots')} className={`px-2 py-0.5 rounded ${sizeMode === 'lots' ? 'bg-emerald-600/30 text-emerald-300' : 'bg-[#12161f] text-gray-500'}`}>by Lots</button>
      </div>
      {sizeMode === 'risk' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Risk %">
            <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} className={inputCls} />
          </Field>
          <Field label="or Risk $">
            <input value={riskMoney} onChange={(e) => setRiskMoney(e.target.value)} className={inputCls} placeholder="auto" />
          </Field>
        </div>
      ) : (
        <Field label="Lots">
          <input value={lots} onChange={(e) => setLots(e.target.value)} className={inputCls} placeholder="0.10" />
        </Field>
      )}

      {/* computed */}
      {computed && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 bg-[#12161f] rounded p-2 text-[11px]">
          <Stat k="Size" v={`${computed.lots.toFixed(2)} lots`} />
          <Stat k="Risk" v={`$${computed.risk$.toFixed(2)}`} />
          <Stat k="Reward" v={tpNum > 0 ? `$${computed.reward$.toFixed(2)}` : '—'} />
          <Stat k="R:R" v={rr > 0 ? rr.toFixed(2) : '—'} highlight={rr >= 2} />
          <Stat k="SL dist" v={`${slDistPoints.toFixed(0)} pts`} />
          <Stat k="Commission" v={`$${computed.commission.toFixed(2)}`} />
        </div>
      )}

      {/* verdict */}
      {strategy && verdict && (
        <button
          onClick={() => setRightTab('checklist')}
          className={`rounded p-2 text-center font-semibold border ${
            verdict.verdict === 'ACCEPTED'
              ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
              : verdict.verdict === 'WARNING'
              ? 'bg-amber-600/20 text-amber-300 border-amber-500/40'
              : 'bg-red-600/20 text-red-300 border-red-500/40'
          }`}
        >
          {strategy.name}: {verdict.verdict} · {verdict.passed}/{verdict.total} · Grade {verdict.grade}
        </button>
      )}
      {!strategy && (
        <div className="text-[10px] text-gray-500 text-center">No strategy selected — select one in Strategies to get ACCEPT/REJECT verdicts.</div>
      )}

      {/* meta */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Setup">
          <select value={setup} onChange={(e) => setSetup(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Confidence 1-10">
          <input value={confidence} onChange={(e) => setConfidence(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Tags (comma-separated)">
        <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="london, sweep, fvg" />
      </Field>
      <Field label="Emotion (before)">
        <input value={emotion} onChange={(e) => setEmotion(e.target.value)} className={inputCls} placeholder="calm / anxious / fomo…" />
      </Field>

      {/* actions */}
      <div className="grid grid-cols-2 gap-2 mt-1">
        <button onClick={() => place('long')} className="py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm">
          BUY {price ? `@ ${price.toFixed(spec.digits)}` : ''}
        </button>
        <button onClick={() => place('short')} className="py-2.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-sm">
          SELL {price ? `@ ${price.toFixed(spec.digits)}` : ''}
        </button>
      </div>
      {lastMsg && <div className="text-[11px] text-gray-400 text-center">{lastMsg}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function Stat({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{k}</span>
      <span className={highlight ? 'text-emerald-300 font-semibold' : 'text-gray-200'}>{v}</span>
    </div>
  );
}

const inputCls = 'bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1.5 text-gray-200 outline-none focus:border-emerald-500/60 w-full';

export { MISTAKES };
