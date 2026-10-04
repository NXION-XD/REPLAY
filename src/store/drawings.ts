// ============================================================================
// Drawings store — in-memory per backtest, debounced persistence to IndexedDB.
// ============================================================================

import { create } from 'zustand';
import { db } from './db';
import type { StoredDrawing } from './db';

interface DrawingsState {
  drawings: StoredDrawing[];
  selectedId: string | null;
  backtestKey: string; // activeBacktest id or 'scratch'
  load: (backtestKey: string) => Promise<void>;
  add: (d: StoredDrawing) => void;
  update: (d: StoredDrawing) => void;
  remove: (id: string) => void;
  setSelected: (id: string | null) => void;
  patch: (id: string, patch: Partial<StoredDrawing>) => void;
  clear: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(get: () => DrawingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { drawings, backtestKey } = get();
    void (async () => {
      await db.drawings.where('backtestId').equals(backtestKey).delete();
      await db.drawings.bulkPut(drawings.map((d) => ({ ...d, backtestId: backtestKey })));
    })();
  }, 400);
}

export const useDrawings = create<DrawingsState>((set, get) => ({
  drawings: [],
  selectedId: null,
  backtestKey: 'scratch',
  load: async (backtestKey) => {
    const rows = await db.drawings.where('backtestId').equals(backtestKey).toArray();
    set({ drawings: rows, backtestKey, selectedId: null });
  },
  add: (d) => {
    set((s) => ({ drawings: [...s.drawings, d] }));
    persist(get);
  },
  update: (d) => {
    set((s) => ({ drawings: s.drawings.map((x) => (x.id === d.id ? d : x)) }));
    persist(get);
  },
  patch: (id, patch) => {
    set((s) => ({ drawings: s.drawings.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    persist(get);
  },
  remove: (id) => {
    set((s) => ({ drawings: s.drawings.filter((x) => x.id !== id), selectedId: s.selectedId === id ? null : s.selectedId }));
    persist(get);
  },
  setSelected: (selectedId) => set({ selectedId }),
  clear: () => {
    set({ drawings: [], selectedId: null });
    persist(get);
  },
}));
