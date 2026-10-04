// ============================================================================
// App store — zustand UI state + singleton Lab subscription.
// ============================================================================

import { create } from 'zustand';
import { useSyncExternalStore } from 'react';
import { Lab } from '../engine/lab';
import type { Dataset, LabSettings } from '../engine/lab';
import type { StrategyProfile } from '../engine/rules';
import type { DrawingTool } from '../chart/ChartManager';
import type { TimeframeId } from '../engine/types';
import type { StoredBacktest } from './db';

export const lab = new Lab();

/** React hook: re-render whenever lab.version changes */
export function useLabVersion(): number {
  return useSyncExternalStore(
    (cb) => lab.subscribe(cb),
    () => lab.version
  );
}

export type Route = 'terminal' | 'dashboard' | 'import' | 'strategies' | 'backtests' | 'settings';
export type ChartLayout = 1 | 2 | 4;
export type BottomTab = 'positions' | 'journal' | 'orders';
export type RightTab = 'trade' | 'checklist' | 'account';

interface UiState {
  route: Route;
  setRoute: (r: Route) => void;
  chartLayout: ChartLayout;
  setChartLayout: (l: ChartLayout) => void;
  layoutTfs: TimeframeId[]; // per pane (up to 4)
  setLayoutTf: (i: number, tf: TimeframeId) => void;
  bottomTab: BottomTab;
  setBottomTab: (t: BottomTab) => void;
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  drawingTool: DrawingTool;
  setDrawingTool: (t: DrawingTool) => void;
  drawingColor: string;
  setDrawingColor: (c: string) => void;
  strategies: StrategyProfile[];
  setStrategies: (s: StrategyProfile[]) => void;
  activeStrategyId: string | null;
  setActiveStrategyId: (id: string | null) => void;
  activeBacktest: StoredBacktest | null;
  setActiveBacktest: (b: StoredBacktest | null) => void;
  datasets: { id: string; symbol: string; baseTf: TimeframeId; candleCount: number; dateStart: number; dateEnd: number }[];
  setDatasets: (d: UiState['datasets']) => void;
  activeDatasetId: string | null;
  setActiveDatasetId: (id: string | null) => void;
  settings: LabSettings;
  setSettings: (s: LabSettings) => void;
  showEma: boolean;
  setShowEma: (v: boolean) => void;
  showSessions: boolean;
  setShowSessions: (v: boolean) => void;
  showFvgs: boolean;
  setShowFvgs: (v: boolean) => void;
  showLevels: boolean;
  setShowLevels: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  route: 'terminal',
  setRoute: (route) => set({ route }),
  chartLayout: 1,
  setChartLayout: (chartLayout) => set({ chartLayout }),
  layoutTfs: ['5m', '15m', '1h', '4h'] as TimeframeId[],
  setLayoutTf: (i, tf) => set((s) => {
    const t = [...s.layoutTfs];
    t[i] = tf;
    return { layoutTfs: t };
  }),
  bottomTab: 'positions',
  setBottomTab: (bottomTab) => set({ bottomTab }),
  rightTab: 'trade',
  setRightTab: (rightTab) => set({ rightTab }),
  drawingTool: null,
  setDrawingTool: (drawingTool) => set({ drawingTool }),
  drawingColor: '#60a5fa',
  setDrawingColor: (drawingColor) => set({ drawingColor }),
  strategies: [],
  setStrategies: (strategies) => set({ strategies }),
  activeStrategyId: null,
  setActiveStrategyId: (activeStrategyId) => set({ activeStrategyId }),
  activeBacktest: null,
  setActiveBacktest: (activeBacktest) => set({ activeBacktest }),
  datasets: [],
  setDatasets: (datasets) => set({ datasets }),
  activeDatasetId: null,
  setActiveDatasetId: (activeDatasetId) => set({ activeDatasetId }),
  settings: { ...lab.settings },
  setSettings: (settings) => {
    lab.updateSettings(settings);
    set({ settings });
  },
  showEma: true,
  setShowEma: (showEma) => set({ showEma }),
  showSessions: true,
  setShowSessions: (showSessions) => set({ showSessions }),
  showFvgs: true,
  setShowFvgs: (showFvgs) => set({ showFvgs }),
  showLevels: true,
  setShowLevels: (showLevels) => set({ showLevels }),
}));

export type { Dataset };
