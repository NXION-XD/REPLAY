// ============================================================================
// Terminal — the main replay workspace.
// ============================================================================

import { lab, useLabVersion, useUi } from '../store/store';
import { ReplayBar } from './ReplayBar';
import { ChartPane } from './ChartPane';
import { TradePanel } from './TradePanel';
import { ChecklistPanel } from './ChecklistPanel';
import { PositionsPanel } from './PositionsPanel';
import { AccountPanel } from './AccountPanel';
import { DrawingToolbar } from './DrawingToolbar';
import { TIMEFRAMES } from '../engine/types';
import type { TimeframeId } from '../engine/types';
import { derivableTimeframes } from '../engine/timeframes';

export function Terminal() {
  useLabVersion();
  const {
    chartLayout, layoutTfs, setLayoutTf, bottomTab, setBottomTab, rightTab, setRightTab,
  } = useUi();

  const ds = lab.dataset;
  const derivable = ds ? derivableTimeframes(ds.baseTf) : [];
  const panes = layoutTfs.slice(0, chartLayout);

  return (
    <div className="h-full flex flex-col">
      <ReplayBar />
      <div className="flex-1 min-h-0 flex">
        <DrawingToolbar />
        <div className={`flex-1 min-w-0 grid ${chartLayout === 1 ? 'grid-cols-1' : chartLayout === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'} gap-px bg-[#1a1f2b]`}>
          {panes.map((tf, i) => (
            <div key={i} className="relative bg-[#0b0e14] min-h-0">
              <div className="absolute top-1 left-2 z-10 flex items-center gap-1">
                {i > 0 ? (
                  <select
                    value={tf}
                    onChange={(e) => setLayoutTf(i, e.target.value as TimeframeId)}
                    className="bg-black/50 text-[10px] text-gray-300 rounded px-1 py-0.5 border border-[#232a38]"
                  >
                    {TIMEFRAMES.filter((t) => derivable.includes(t.id)).map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="bg-black/50 text-[10px] text-gray-400 rounded px-1.5 py-0.5">{tf} · primary</span>
                )}
              </div>
              <ChartPane tf={tf} primary={i === 0} />
            </div>
          ))}
        </div>
        {/* right panel */}
        <div className="w-[300px] shrink-0 border-l border-[#1a1f2b] flex flex-col min-h-0">
          <div className="flex border-b border-[#1a1f2b]">
            {(['trade', 'checklist', 'account'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={`flex-1 py-1.5 text-[11px] capitalize ${rightTab === t ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'trade' && <TradePanel />}
            {rightTab === 'checklist' && <ChecklistPanel />}
            {rightTab === 'account' && <AccountPanel />}
          </div>
        </div>
      </div>
      {/* bottom panel */}
      <div className="h-[220px] shrink-0 border-t border-[#1a1f2b] flex flex-col min-h-0">
        <div className="flex border-b border-[#1a1f2b]">
          {(['positions', 'orders', 'journal'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setBottomTab(t)}
              className={`px-4 py-1.5 text-[11px] capitalize ${bottomTab === t ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {t === 'positions' ? `Positions (${lab.broker.open.length})` : t === 'orders' ? `Orders (${lab.broker.orders.length})` : `Journal (${lab.broker.closed.length})`}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          <PositionsPanel tab={bottomTab} />
        </div>
      </div>
    </div>
  );
}
