// ============================================================================
// ImportWizard — CSV upload with auto-detection and a validation report that
// must be confirmed before import. The original file is never modified.
// ============================================================================

import { useCallback, useState } from 'react';
import { detectCsv, parseAndValidate } from '../engine/csv';
import type { CsvDetection, ParsedCsv } from '../engine/csv';
import { TIMEFRAMES, XAUUSD_SPEC } from '../engine/types';
import type { TimeframeId } from '../engine/types';
import { fmtDateTime } from '../engine/tz';
import { lab, useUi } from '../store/store';
import { db } from '../store/db';
import { UploadCloud } from 'lucide-react';

export function ImportWizard() {
  const { datasets, setDatasets, setActiveDatasetId, setRoute } = useUi();
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [det, setDet] = useState<CsvDetection | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [tfOverride, setTfOverride] = useState<TimeframeId | ''>('');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const handleFile = useCallback((f: File) => {
    setError('');
    setFileName(f.name);
    const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]?(1m|3m|5m|15m|30m|1h|4h|1d).*$/i, '');
    if (base) setSymbol(base.toUpperCase().slice(0, 12));
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result);
      setText(content);
      const d = detectCsv(content);
      setDet(d);
      if (!d) {
        setError('Could not detect CSV structure (need time, open, high, low, close columns).');
        setParsed(null);
        return;
      }
      setParsed(parseAndValidate(content, d, symbol || 'XAUUSD', tfOverride || undefined));
    };
    reader.readAsText(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tfOverride]);

  const revalidate = (sym: string, tf: TimeframeId | '') => {
    if (text && det) setParsed(parseAndValidate(text, det, sym, tf || undefined));
  };

  const doImport = async () => {
    if (!text || !parsed || parsed.candles.length === 0) return;
    setImporting(true);
    try {
      const id = 'ds-' + Date.now().toString(36);
      const baseTf = (parsed.report.timeframe === 'unknown' ? (tfOverride || '5m') : parsed.report.timeframe) as TimeframeId;
      await db.datasets.put({
        id, symbol, baseTf, rawCsv: text,
        candleCount: parsed.candles.length,
        dateStart: parsed.report.dateStart, dateEnd: parsed.report.dateEnd,
        importedAt: Date.now(), specJson: JSON.stringify(XAUUSD_SPEC),
      });
      lab.setDataset({
        id, symbol, baseTf, candles: parsed.candles, spreads: parsed.spreads,
        spec: XAUUSD_SPEC, importedAt: Date.now(),
      });
      setDatasets([...datasets, { id, symbol, baseTf, candleCount: parsed.candles.length, dateStart: parsed.report.dateStart, dateEnd: parsed.report.dateEnd }]);
      setActiveDatasetId(id);
      setRoute('terminal');
      location.hash = '#/terminal';
    } finally {
      setImporting(false);
    }
  };

  const switchDataset = async (id: string) => {
    const d = await db.datasets.get(id);
    if (!d) return;
    const det2 = detectCsv(d.rawCsv);
    if (!det2) return;
    const p = parseAndValidate(d.rawCsv, det2, d.symbol);
    lab.setDataset({ id: d.id, symbol: d.symbol, baseTf: d.baseTf, candles: p.candles, spreads: p.spreads, spec: JSON.parse(d.specJson), importedAt: d.importedAt });
    setActiveDatasetId(id);
    setRoute('terminal');
    location.hash = '#/terminal';
  };

  const removeDataset = async (id: string) => {
    await db.datasets.delete(id);
    setDatasets(datasets.filter((d) => d.id !== id));
  };

  const r = parsed?.report;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto text-xs space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">Historical data import</h1>
        <p className="text-gray-500">CSV with time, open, high, low, close (+ optional volume/spread). Delimiter, columns and timestamp format are auto-detected. The original file is never modified — a copy is stored in your browser (IndexedDB).</p>
      </div>

      {/* drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-2 transition-colors ${dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-[#232a38] bg-[#0d1119]'}`}
      >
        <UploadCloud className="w-8 h-8 text-gray-500" />
        <div className="text-gray-400">Drag & drop a CSV here, or</div>
        <label className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
          Choose file
          <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </label>
        {fileName && <div className="text-gray-500">{fileName}</div>}
      </div>

      {error && <div className="bg-red-600/10 border border-red-500/30 text-red-300 rounded p-3">{error}</div>}

      {/* detection + validation report */}
      {det && r && (
        <div className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase text-gray-500">Data validation</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'READY' ? 'bg-emerald-600/30 text-emerald-300' : r.status === 'WARNINGS' ? 'bg-amber-600/30 text-amber-300' : 'bg-red-600/30 text-red-300'}`}>{r.status}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <VRow k="Symbol" v={<input value={symbol} onChange={(e) => { setSymbol(e.target.value); revalidate(e.target.value, tfOverride); }} className="bg-[#0b0e14] border border-[#232a38] rounded px-2 py-1 w-28" />} />
            <VRow k="Timeframe" v={
              <span className="flex items-center gap-1">
                <b className="text-gray-200">{r.timeframe}</b>
                <select value={tfOverride} onChange={(e) => { const v = e.target.value as TimeframeId | ''; setTfOverride(v); revalidate(symbol, v); }} className="bg-[#0b0e14] border border-[#232a38] rounded px-1 py-0.5 text-gray-400">
                  <option value="">auto</option>
                  {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </span>
            } />
            <VRow k="Rows parsed" v={`${r.parsedRows.toLocaleString()} / ${r.rows.toLocaleString()}`} />
            <VRow k="Date range" v={`${fmtDateTime(r.dateStart, 'UTC')} → ${fmtDateTime(r.dateEnd, 'UTC')}`} />
            <VRow k="Delimiter" v={JSON.stringify(det.delimiter)} />
            <VRow k="Header" v={det.hasHeader ? det.header.join(' | ') : 'none (positional)'} />
            <VRow k="Timestamp format" v={det.timeFormat} />
            <VRow k="Timezone" v="UTC (assumed)" />
            <VRow k="Missing candles" v={String(r.missingCandles)} warn={r.missingCandles > 0} />
            <VRow k="Duplicates removed" v={String(r.duplicates)} warn={r.duplicates > 0} />
            <VRow k="Invalid skipped" v={String(r.invalidCandles)} warn={r.invalidCandles > 0} />
            <VRow k="Unsorted rows" v={String(r.unsortedRows)} warn={r.unsortedRows > 0} />
            {r.avgSpread !== undefined && <VRow k="Avg spread" v={r.avgSpread.toFixed(1)} />}
          </div>
          {r.issues.length > 0 && (
            <ul className="list-disc list-inside text-amber-300/90 space-y-0.5">
              {r.issues.map((i, k) => <li key={k}>{i}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={doImport}
              disabled={importing || parsed.candles.length === 0}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold"
            >
              {importing ? 'Importing…' : `Import ${parsed.candles.length.toLocaleString()} candles`}
            </button>
            <button onClick={() => { setText(null); setDet(null); setParsed(null); }} className="px-4 py-2 rounded bg-[#12161f] border border-[#232a38] text-gray-400">Cancel</button>
          </div>
        </div>
      )}

      {/* existing datasets */}
      <div>
        <h2 className="text-sm font-semibold text-gray-200 mb-2">Datasets in this browser</h2>
        <div className="space-y-1">
          {datasets.map((d) => (
            <div key={d.id} className="flex items-center gap-3 bg-[#0d1119] border border-[#1a1f2b] rounded px-3 py-2">
              <span className="font-semibold text-gray-200">{d.symbol}</span>
              <span className="text-gray-500">{d.baseTf}</span>
              <span className="text-gray-500">{d.candleCount.toLocaleString()} candles</span>
              <span className="text-gray-500">{fmtDateTime(d.dateStart, 'UTC').slice(0, 10)} → {fmtDateTime(d.dateEnd, 'UTC').slice(0, 10)}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => switchDataset(d.id)} className="px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40">Load</button>
                {d.id !== 'sample-xauusd-5m' && (
                  <button onClick={() => removeDataset(d.id)} className="px-2 py-1 rounded bg-red-600/20 text-red-300 border border-red-500/30 hover:bg-red-600/40">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VRow({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase text-gray-500">{k}</span>
      <span className={warn ? 'text-amber-300' : 'text-gray-200'}>{v}</span>
    </div>
  );
}
