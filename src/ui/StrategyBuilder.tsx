// ============================================================================
// StrategyBuilder — visual nested rule editor over the feature registry.
// ============================================================================

import { useEffect, useState } from 'react';
import { FEATURES, emptyTree, makeLeaf } from '../engine/rules';
import type { Condition, GroupCondition, LeafCondition, StrategyProfile } from '../engine/rules';
import { db } from '../store/db';
import { useUi } from '../store/store';
import { Plus, Trash2, Save, Check } from 'lucide-react';

const COMPARATORS: { id: LeafCondition['comparator']; label: string }[] = [
  { id: 'eq', label: '=' }, { id: 'neq', label: '≠' }, { id: 'gt', label: '>' }, { id: 'lt', label: '<' },
  { id: 'gte', label: '≥' }, { id: 'lte', label: '≤' }, { id: 'in', label: 'in list' },
  { id: 'is_true', label: 'is true' }, { id: 'is_false', label: 'is false' },
];

export function StrategyBuilder() {
  const { strategies, setStrategies, activeStrategyId, setActiveStrategyId } = useUi();
  const [editing, setEditing] = useState<StrategyProfile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!editing && strategies.length > 0) {
      setEditing(JSON.parse(JSON.stringify(strategies.find((s) => s.id === activeStrategyId) ?? strategies[0])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies]);

  const save = async () => {
    if (!editing) return;
    await db.strategies.put(editing);
    const all = await db.strategies.toArray();
    setStrategies(all);
    setActiveStrategyId(editing.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const createNew = () => {
    const s: StrategyProfile = {
      id: 'strat-' + Date.now().toString(36),
      name: 'New strategy',
      tree: emptyTree(),
      gradeA: 0.85, gradeB: 0.65,
      createdAt: Date.now(),
    };
    setEditing(s);
  };

  const remove = async (id: string) => {
    await db.strategies.delete(id);
    const all = await db.strategies.toArray();
    setStrategies(all);
    if (editing?.id === id) setEditing(null);
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-xs">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Strategy rule builder</h1>
          <span className="text-gray-500 text-[11px]">Rules are evaluated live on the replay candle. Nothing is forced — verdicts are informational.</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          {strategies.map((s) => (
            <div key={s.id} className={`flex items-center gap-1 rounded border px-2 py-1 ${s.id === activeStrategyId ? 'border-emerald-500/50 bg-emerald-600/10' : 'border-[#232a38] bg-[#0d1119]'}`}>
              <button
                onClick={() => { setActiveStrategyId(s.id); setEditing(JSON.parse(JSON.stringify(s))); }}
                className="text-gray-200"
              >
                {s.name}
              </button>
              {s.id === activeStrategyId && <Check className="w-3 h-3 text-emerald-400" />}
              <button onClick={() => remove(s.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
          <button onClick={createNew} className="flex items-center gap-1 px-2 py-1 rounded border border-dashed border-[#232a38] text-gray-400 hover:text-white">
            <Plus className="w-3 h-3" /> New
          </button>
        </div>

        {editing && (
          <div className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1.5 text-gray-100 font-semibold"
              />
              <label className="flex items-center gap-1 text-gray-400">
                Grade A ≥ <input type="number" min={0} max={100} value={Math.round(editing.gradeA * 100)} onChange={(e) => setEditing({ ...editing, gradeA: (parseInt(e.target.value) || 85) / 100 })} className="w-14 bg-[#0b0e14] border border-[#232a38] rounded px-1 py-1" />%
              </label>
              <label className="flex items-center gap-1 text-gray-400">
                Grade B ≥ <input type="number" min={0} max={100} value={Math.round(editing.gradeB * 100)} onChange={(e) => setEditing({ ...editing, gradeB: (parseInt(e.target.value) || 65) / 100 })} className="w-14 bg-[#0b0e14] border border-[#232a38] rounded px-1 py-1" />%
              </label>
              <button onClick={save} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">
                {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} {saved ? 'Saved' : 'Save'}
              </button>
            </div>
            <GroupEditor
              group={editing.tree as GroupCondition}
              onChange={(g) => setEditing({ ...editing, tree: g })}
              depth={0}
            />
            <div className="text-[10px] text-gray-600">
              "required" rules failing → REJECTED. "warning" rules failing → WARNING. Grade = share of applicable rules passing (your definition — the app does not claim predictive meaning).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupEditor({ group, onChange, depth }: { group: GroupCondition; onChange: (g: GroupCondition) => void; depth: number }) {
  const setChild = (i: number, c: Condition) => {
    const children = [...group.children];
    children[i] = c;
    onChange({ ...group, children });
  };
  const removeChild = (i: number) => {
    onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  };
  return (
    <div className={`rounded border border-[#232a38] p-2 space-y-2 ${depth > 0 ? 'ml-4 bg-[#0b0e14]' : ''}`}>
      <div className="flex items-center gap-2">
        <select
          value={group.op}
          onChange={(e) => onChange({ ...group, op: e.target.value as GroupCondition['op'] })}
          className="bg-[#12161f] border border-[#232a38] rounded px-1.5 py-1 text-amber-300 font-bold uppercase text-[10px]"
        >
          <option value="and">AND — all must pass</option>
          <option value="or">OR — any passes</option>
          <option value="not">NOT — invert</option>
        </select>
        <button
          onClick={() => onChange({ ...group, children: [...group.children, makeLeaf('session')] })}
          className="text-[10px] px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white"
        >+ condition</button>
        {group.op !== 'not' && (
          <button
            onClick={() => onChange({ ...group, children: [...group.children, { kind: 'group', op: 'and', children: [] }] })}
            className="text-[10px] px-2 py-1 rounded bg-[#12161f] border border-[#232a38] text-gray-400 hover:text-white"
          >+ group</button>
        )}
      </div>
      {group.children.map((c, i) => (
        <div key={i} className="flex items-start gap-2">
          {c.kind === 'leaf' ? (
            <LeafEditor leaf={c} onChange={(l) => setChild(i, l)} />
          ) : (
            <div className="flex-1"><GroupEditor group={c} onChange={(g) => setChild(i, g)} depth={depth + 1} /></div>
          )}
          <button onClick={() => removeChild(i)} className="text-gray-600 hover:text-red-400 mt-1.5"><Trash2 className="w-3 h-3" /></button>
        </div>
      ))}
      {group.children.length === 0 && <div className="text-[10px] text-gray-600">Empty group — add conditions.</div>}
    </div>
  );
}

function LeafEditor({ leaf, onChange }: { leaf: LeafCondition; onChange: (l: LeafCondition) => void }) {
  const feature = FEATURES.find((f) => f.id === leaf.feature);
  const needsValue = !['is_true', 'is_false'].includes(leaf.comparator);
  return (
    <div className="flex items-center gap-1.5 flex-wrap flex-1 bg-[#12161f] rounded border border-[#232a38] px-2 py-1.5">
      <select
        value={leaf.feature}
        onChange={(e) => { const nl = makeLeaf(e.target.value); nl.severity = leaf.severity; onChange(nl); }}
        className="bg-[#0b0e14] border border-[#232a38] rounded px-1.5 py-1 text-gray-200"
      >
        {FEATURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <select
        value={leaf.comparator}
        onChange={(e) => onChange({ ...leaf, comparator: e.target.value as LeafCondition['comparator'] })}
        className="bg-[#0b0e14] border border-[#232a38] rounded px-1 py-1 text-gray-300 w-20"
      >
        {COMPARATORS.filter((c) => {
          if (feature?.type === 'boolean') return ['is_true', 'is_false'].includes(c.id);
          if (feature?.type === 'enum') return ['eq', 'neq', 'in'].includes(c.id);
          return true;
        }).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {needsValue && feature?.type === 'enum' && leaf.comparator !== 'in' && (
        <select
          value={String(leaf.value ?? feature.options?.[0])}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          className="bg-[#0b0e14] border border-[#232a38] rounded px-1.5 py-1 text-gray-200"
        >
          {feature.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {needsValue && feature?.type === 'enum' && leaf.comparator === 'in' && (
        <input
          value={Array.isArray(leaf.value) ? leaf.value.join(',') : String(leaf.value ?? '')}
          onChange={(e) => onChange({ ...leaf, value: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
          placeholder="a,b,c"
          className="bg-[#0b0e14] border border-[#232a38] rounded px-1.5 py-1 text-gray-200 w-28"
        />
      )}
      {needsValue && feature?.type === 'number' && (
        <input
          type="number"
          value={Number(leaf.value ?? 0)}
          onChange={(e) => onChange({ ...leaf, value: parseFloat(e.target.value) || 0 })}
          className="bg-[#0b0e14] border border-[#232a38] rounded px-1.5 py-1 text-gray-200 w-20"
        />
      )}
      {needsValue && !feature && (
        <input
          value={String(leaf.value ?? '')}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          className="bg-[#0b0e14] border border-[#232a38] rounded px-1.5 py-1 text-gray-200 w-20"
        />
      )}
      <button
        onClick={() => onChange({ ...leaf, severity: leaf.severity === 'required' ? 'warning' : 'required' })}
        title="Click to toggle severity"
        className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${leaf.severity === 'required' ? 'bg-red-600/20 text-red-300' : 'bg-amber-600/20 text-amber-300'}`}
      >
        {leaf.severity}
      </button>
    </div>
  );
}
