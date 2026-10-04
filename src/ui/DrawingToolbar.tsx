// ============================================================================
// DrawingToolbar — left rail of drawing tools + selected-drawing properties.
// ============================================================================

import { useUi } from '../store/store';
import { useDrawings } from '../store/drawings';
import type { DrawingTool } from '../chart/ChartManager';
import {
  ArrowUpRight, CircleDollarSign, GripHorizontal, Minus, MousePointer, Type, Trash2, Lock, Unlock, Eye, EyeOff, MoveVertical,
} from 'lucide-react';

const TOOLS: { id: Exclude<DrawingTool, null>; icon: React.ElementType; label: string }[] = [
  { id: 'hline', icon: Minus, label: 'Horizontal line' },
  { id: 'vline', icon: MoveVertical, label: 'Vertical line' },
  { id: 'trendline', icon: ArrowUpRight, label: 'Trend line (2 clicks)' },
  { id: 'rect', icon: GripHorizontal, label: 'Rectangle (2 clicks)' },
  { id: 'long', icon: CircleDollarSign, label: 'Long position box (2 clicks)' },
  { id: 'short', icon: CircleDollarSign, label: 'Short position box (2 clicks)' },
  { id: 'text', icon: Type, label: 'Text note' },
];

export function DrawingToolbar() {
  const { drawingTool, setDrawingTool, drawingColor, setDrawingColor } = useUi();
  const { drawings, selectedId, patch, remove } = useDrawings();
  const selected = drawings.find((d) => d.id === selectedId);

  return (
    <div className="w-10 shrink-0 border-r border-[#1a1f2b] flex flex-col items-center py-1 gap-0.5">
      <button
        title="Select / move"
        onClick={() => setDrawingTool(null)}
        className={`w-8 h-8 rounded flex items-center justify-center ${drawingTool === null ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
      >
        <MousePointer className="w-4 h-4" />
      </button>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => setDrawingTool(drawingTool === t.id ? null : t.id)}
          className={`w-8 h-8 rounded flex items-center justify-center ${drawingTool === t.id ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <t.icon className={`w-4 h-4 ${t.id === 'short' ? 'text-red-400' : t.id === 'long' ? 'text-emerald-400' : ''}`} />
        </button>
      ))}
      <input
        type="color"
        value={drawingColor}
        onChange={(e) => setDrawingColor(e.target.value)}
        className="w-6 h-6 mt-1 rounded cursor-pointer bg-transparent"
        title="Drawing color"
      />

      {selected && (
        <div className="mt-2 flex flex-col gap-1 border-t border-[#1a1f2b] pt-2">
          <button title={selected.locked ? 'Unlock' : 'Lock'} onClick={() => patch(selected.id, { locked: !selected.locked })} className="w-8 h-8 rounded flex items-center justify-center text-gray-400 hover:text-white">
            {selected.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button title={selected.hidden ? 'Show' : 'Hide'} onClick={() => patch(selected.id, { hidden: !selected.hidden })} className="w-8 h-8 rounded flex items-center justify-center text-gray-400 hover:text-white">
            {selected.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button title="Delete" onClick={() => remove(selected.id)} className="w-8 h-8 rounded flex items-center justify-center text-red-400 hover:text-red-300">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
