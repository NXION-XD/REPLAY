// ============================================================================
// Persistence — Dexie (IndexedDB). Browser-local: data does NOT leave the
// user's browser and does not sync across devices.
// ============================================================================

import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { StrategyProfile } from '../engine/rules';
import type { TradeRecord } from '../engine/broker';
import type { LabSettings, Dataset } from '../engine/lab';
import type { AccountConfig, ExecutionConfig, PropFirmConfig, TimeframeId } from '../engine/types';

export interface StoredDataset {
  id: string;
  symbol: string;
  baseTf: TimeframeId;
  /** raw CSV text, kept verbatim (never silently modified) */
  rawCsv: string;
  candleCount: number;
  dateStart: number;
  dateEnd: number;
  importedAt: number;
  specJson: string;
}

export interface StoredBacktest {
  id: string;
  name: string;
  datasetId: string;
  symbol: string;
  baseTf: TimeframeId;
  startTime: number;
  endTime?: number;
  cursor: number;
  createdAt: number;
  updatedAt: number;
  settings: LabSettings;
  accountCfg: AccountConfig;
  execution: ExecutionConfig;
  propCfg: PropFirmConfig | null;
  strategyId?: string;
  trades: TradeRecord[];
}

export interface StoredDrawing {
  id: string;
  backtestId: string;
  tf: TimeframeId;
  kind: 'hline' | 'vline' | 'trendline' | 'rect' | 'long' | 'short' | 'text';
  /** anchor points: time (unix s) + price */
  p1: { t: number; price: number };
  p2?: { t: number; price: number };
  text?: string;
  color: string;
  lineWidth: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  name?: string;
}

export interface StoredSetting {
  key: string;
  value: unknown;
}

class LabDB extends Dexie {
  datasets!: Table<StoredDataset, string>;
  backtests!: Table<StoredBacktest, string>;
  strategies!: Table<StrategyProfile, string>;
  drawings!: Table<StoredDrawing, string>;
  settings!: Table<StoredSetting, string>;

  constructor() {
    super('fx-replay-lab');
    this.version(1).stores({
      datasets: 'id, symbol, importedAt',
      backtests: 'id, name, updatedAt',
      strategies: 'id, name',
      drawings: 'id, backtestId',
      settings: 'key',
    });
  }
}

export const db = new LabDB();

// ---------------------------------------------------------------------------
// Export helpers (CSV / JSON) — generated from actual stored data
// ---------------------------------------------------------------------------

export function tradesToCsv(trades: TradeRecord[]): string {
  const header = [
    'id', 'entry_time', 'exit_time', 'direction', 'entry', 'exit', 'sl', 'tp',
    'lots', 'pnl', 'commission', 'net', 'r', 'risk_money', 'mfe', 'mae',
    'session', 'condition', 'htf_bias', 'strategy', 'setup', 'verdict',
    'exit_reason', 'tags', 'mistakes', 'notes',
  ];
  const rows = trades.map((t) => [
    t.id,
    new Date(t.entryTime * 1000).toISOString(),
    t.exitTime ? new Date(t.exitTime * 1000).toISOString() : '',
    t.direction, t.entryPrice, t.exitPrice ?? '', t.sl, t.tp,
    t.lots, t.pnl.toFixed(2), t.commission.toFixed(2), (t.pnl - t.commission).toFixed(2),
    t.r.toFixed(3), t.riskMoney.toFixed(2), t.mfe.toFixed(4), t.mae.toFixed(4),
    t.session, t.condition, t.htfBias,
    t.meta.strategyName ?? '', t.meta.setup ?? '', t.verdict ?? '',
    t.exitReason ?? '', (t.meta.tags ?? []).join('|'), (t.meta.mistakes ?? []).join('|'),
    (t.meta.notes ?? '').replace(/[\r\n,]+/g, ' '),
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type { Dataset };
