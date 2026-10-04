// ============================================================================
// ReplayBar — symbol / TF / time / speed / transport controls.
// ============================================================================

import { lab, useLabVersion, useUi } from '../store/store';
import { REPLAY_SPEEDS, TIMEFRAMES, tfSeconds } from '../engine/types';
import type { TimeframeId } from '../engine/types';
import { fmtDateTime, fmtTime, parts, zonedTimeToUtc } from '../engine/tz';
import { derivableTimeframes } from '../engine/timeframes';
import { Pause, Play, SkipBack, SkipForward, RotateCcw, Shuffle, Clock, LayoutGrid } from 'lucide-react';
import { useState } from 'react';

export function ReplayBar() {
  useLabVersion();
  const { chartLayout, setChartLayout, layoutTfs, setLayoutTf, settings } = useUi();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpDate, setJumpDate] = useState('');

  const ds = lab.dataset;
  const c = lab.currentCandle();
  const tz = settings.timezone;
  const session = lab.sessionNow();
  const acct = lab.account.state(lab.currentCandle() ? lab.broker.floatingPnl(lab.currentCandle()!) : 0, lab.broker.usedRisk());
  const derivable = ds ? derivableTimeframes(ds.baseTf) : [];

  const doJump = () => {
    if (!jumpDate) return;
    const [d, tm] = jumpDate.split('T');
    if (!d) return;
    const [y, m, dd] = d.split('-').map(Number);
    const [hh, mm] = (tm ?? '00:00').split(':').map(Number);
    const t = zonedTimeToUtc(y, m, dd, hh || 0, mm || 0, tz);
    lab.seekToTime(t);
    setJumpOpen(false);
  };

  return (
    <div className="h-11 shrink-0 border-b border-[#1a1f2b] flex items-center gap-2 px-2 text-xs overflow-x-auto">
      <div className="font-semibold text-gray-100">{ds?.symbol ?? '—'}</div>

      {/* primary TF */}
      <select
        value={layoutTfs[0]}
        onChange={(e) => setLayoutTf(0, e.target.value as TimeframeId)}
        className="bg-[#12161f] border border-[#232a38] rounded px-1.5 py-1 text-gray-300"
        title="Primary chart timeframe (replay granularity = dataset base TF)"
      >
        {TIMEFRAMES.filter((t) => derivable.includes(t.id)).map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      {/* transport */}
      <div className="flex items-center gap-0.5 bg-[#12161f] border border-[#232a38] rounded px-1 py-0.5">
        <button className="p-1 hover:text-white text-gray-400" title="Step back" onClick={() => lab.stepBack()}>
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          className={`p-1 ${lab.playing ? 'text-amber-400' : 'text-emerald-400'} hover:opacity-80`}
          title={lab.playing ? 'Pause' : 'Play'}
          onClick={() => (lab.playing ? lab.pause() : lab.play())}
        >
          {lab.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button className="p-1 hover:text-white text-gray-400" title="Step forward" onClick={() => lab.stepForward()}>
          <SkipForward className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:text-white text-gray-400"
          title="Reset to dataset start"
          onClick={() => { lab.pause(); lab.replayTo(-1); lab.stepForward(); }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* speed */}
      <select
        value={String(lab.speedCps)}
        onChange={(e) => lab.setSpeed(Number(e.target.value))}
        className="bg-[#12161f] border border-[#232a38] rounded px-1.5 py-1 text-gray-300"
        title="Replay speed"
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s.label} value={String(s.cps)}>{s.label}</option>
        ))}
      </select>

      {/* jump / random */}
      <div className="relative">
        <button className="p-1.5 hover:text-white text-gray-400 bg-[#12161f] border border-[#232a38] rounded" title="Jump to date" onClick={() => setJumpOpen(!jumpOpen)}>
          <Clock className="w-3.5 h-3.5" />
        </button>
        {jumpOpen && (
          <div className="absolute top-8 left-0 z-50 bg-[#12161f] border border-[#232a38] rounded p-2 flex flex-col gap-2 w-56">
            <input
              type="datetime-local"
              value={jumpDate}
              onChange={(e) => setJumpDate(e.target.value)}
              className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1 text-gray-200"
            />
            <button onClick={doJump} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded px-2 py-1">Jump ({tz})</button>
          </div>
        )}
      </div>
      <button className="p-1.5 hover:text-white text-gray-400 bg-[#12161f] border border-[#232a38] rounded" title="Random date" onClick={() => lab.randomStart()}>
        <Shuffle className="w-3.5 h-3.5" />
      </button>
      <button
        className="p-1.5 hover:text-white text-gray-400 bg-[#12161f] border border-[#232a38] rounded"
        title="Random session start"
        onClick={() => lab.randomSessionStart()}
      >
        <span className="text-[10px] font-bold">RS</span>
      </button>

      {/* layout */}
      <div className="flex items-center gap-0.5 ml-1 bg-[#12161f] border border-[#232a38] rounded px-1">
        {([1, 2, 4] as const).map((n) => (
          <button
            key={n}
            onClick={() => setChartLayout(n)}
            className={`px-1.5 py-1 rounded text-[10px] ${chartLayout === n ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
            title={`${n} chart${n > 1 ? 's' : ''}`}
          >
            <LayoutGrid className="w-3.5 h-3.5 inline" /> {n}
          </button>
        ))}
      </div>

      {/* status */}
      <div className="ml-auto flex items-center gap-3 text-gray-400 whitespace-nowrap">
        {c && ds && (
          <>
            <span className="text-gray-200 font-mono">{fmtDateTime(c.t, tz)}</span>
            <span className="font-mono">{lab.spec.digits ? c.c.toFixed(lab.spec.digits) : c.c}</span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: session?.color ?? '#374151' }} />
              {session?.name ?? 'off-session'}
            </span>
            {lab.spreadAt() !== undefined && <span>spr {lab.spreadAt()}</span>}
            <span className={acct.equity - lab.accountCfg.initialBalance >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              Eq {acct.equity.toFixed(2)}
            </span>
            <span className="text-gray-500">Bal {acct.balance.toFixed(2)}</span>
            <span>{lab.broker.open.length} open</span>
          </>
        )}
      </div>

      {/* progress */}
      {ds && (
        <div className="w-28 h-1.5 bg-[#12161f] rounded overflow-hidden" title={`Candle ${lab.cursor + 1} / ${ds.candles.length}`}>
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${((lab.cursor + 1) / ds.candles.length) * 100}%` }}
          />
        </div>
      )}
      {c && (
        <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">
          {parts(c.t, tz).dayKey} {fmtTime(c.t, tz)} · bar {lab.cursor + 1}
        </span>
      )}
      {ds && lab.cursor >= 0 && (
        <span className="sr-only">{tfSeconds(ds.baseTf)}</span>
      )}
    </div>
  );
}
