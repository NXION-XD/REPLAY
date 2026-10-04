// ============================================================================
// ChecklistPanel — live PASS/FAIL/WARNING for the active strategy.
// ============================================================================

import { lab, useLabVersion, useUi } from '../store/store';
import { evaluateStrategy } from '../engine/rules';
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle } from 'lucide-react';

export function ChecklistPanel({ rr = 0, slDist = 0 }: { rr?: number; slDist?: number }) {
  useLabVersion();
  const { strategies, activeStrategyId } = useUi();
  const strategy = strategies.find((s) => s.id === activeStrategyId);

  if (!strategy) {
    return (
      <div className="p-3 text-xs text-gray-500">
        Select a strategy profile (Strategies page) to see the live trade checklist.
      </div>
    );
  }

  const ctx = lab.buildRuleContext(rr, slDist);
  const v = evaluateStrategy(strategy.tree, ctx, strategy.gradeA, strategy.gradeB);

  return (
    <div className="p-2 text-xs flex flex-col gap-1 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-gray-200">{strategy.name}</span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          v.verdict === 'ACCEPTED' ? 'bg-emerald-600/30 text-emerald-300'
          : v.verdict === 'WARNING' ? 'bg-amber-600/30 text-amber-300'
          : 'bg-red-600/30 text-red-300'
        }`}>{v.verdict}</span>
      </div>
      <div className="text-[10px] text-gray-500 mb-1">
        Quality score {Math.round(v.score * 100)}% → Grade {v.grade} (thresholds A≥{Math.round(strategy.gradeA * 100)}%, B≥{Math.round(strategy.gradeB * 100)}%)
      </div>
      {v.results.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-1 border-b border-[#161b26] last:border-0">
          {r.status === 'PASS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          {r.status === 'FAIL' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
          {r.status === 'N/A' && <MinusCircle className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-gray-300 truncate">{r.label}</div>
            <div className="text-[10px] text-gray-600 truncate">
              {r.severity}{r.actual !== undefined ? ` · actual: ${String(r.actual)}` : ''}
            </div>
          </div>
          {r.status === 'FAIL' && r.severity === 'warning' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
        </div>
      ))}
      {v.results.length === 0 && (
        <div className="text-gray-500">This strategy has no rules yet — edit it on the Strategies page.</div>
      )}
      <div className="mt-2 text-[10px] text-gray-600 leading-snug">
        The verdict is informational — it never blocks an order. Historical performance per verdict is measurable in Analytics → Trades.
      </div>
    </div>
  );
}
