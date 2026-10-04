import { useEffect, useState } from 'react';
import { lab, useUi } from './store/store';
import { db } from './store/db';
import { detectCsv, parseAndValidate } from './engine/csv';
import { XAUUSD_SPEC } from './engine/types';
import type { TimeframeId } from './engine/types';
import { LONDON_SWEEP_TEMPLATE } from './engine/rules';
import { Terminal } from './ui/Terminal';
import { Dashboard } from './ui/Dashboard';
import { ImportWizard } from './ui/ImportWizard';
import { StrategyBuilder } from './ui/StrategyBuilder';
import { Backtests } from './ui/Backtests';
import { SettingsPage } from './ui/SettingsPage';
import { BarChart3, CandlestickChart, Database, ListChecks, Save, Settings } from 'lucide-react';

/** DecompressionStream-based .gz fetch (brotli/gzip supported by all modern browsers) */
async function fetchGzText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('fetch failed: ' + url);
  const ds = new DecompressionStream('gzip');
  const stream = res.body.pipeThrough(ds);
  return await new Response(stream).text();
}

export default function App() {
  const { route, setRoute, setStrategies, setDatasets, setActiveDatasetId } = useUi();
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootMsg, setBootMsg] = useState('Loading XAUUSD sample dataset…');

  useEffect(() => {
    // hash routing
    const onHash = () => {
      const h = location.hash.replace('#/', '') as typeof route;
      if (['terminal', 'dashboard', 'import', 'strategies', 'backtests', 'settings'].includes(h)) setRoute(h);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [setRoute]);

  useEffect(() => {
    (async () => {
      try {
        // strategies
        let strategies = await db.strategies.toArray();
        if (strategies.length === 0) {
          const tpl = LONDON_SWEEP_TEMPLATE();
          await db.strategies.put(tpl);
          strategies = [tpl];
        }
        setStrategies(strategies);

        // datasets already imported?
        const stored = await db.datasets.toArray();
        const meta = stored.map((d) => ({
          id: d.id, symbol: d.symbol, baseTf: d.baseTf, candleCount: d.candleCount,
          dateStart: d.dateStart, dateEnd: d.dateEnd,
        }));
        setDatasets(meta);

        if (stored.length > 0) {
          setBootMsg(`Loading dataset ${stored[0].symbol}…`);
          const d = stored[0];
          const det = detectCsv(d.rawCsv);
          if (det) {
            const parsed = parseAndValidate(d.rawCsv, det, d.symbol);
            lab.setDataset({
              id: d.id, symbol: d.symbol, baseTf: d.baseTf,
              candles: parsed.candles, spreads: parsed.spreads,
              spec: JSON.parse(d.specJson), importedAt: d.importedAt,
            });
            setActiveDatasetId(d.id);
          }
        } else {
          setBootMsg('Loading bundled XAUUSD 5m sample (Apr 2023 – Jan 2026)…');
          const text = await fetchGzText(import.meta.env.BASE_URL + 'data/XAUUSD_5m.csv.gz');
          setBootMsg('Parsing 192,508 candles…');
          const det = detectCsv(text);
          if (!det) throw new Error('Could not detect CSV format');
          const parsed = parseAndValidate(text, det, 'XAUUSD');
          const id = 'sample-xauusd-5m';
          lab.setDataset({
            id, symbol: 'XAUUSD', baseTf: (parsed.report.timeframe === 'unknown' ? '5m' : parsed.report.timeframe) as TimeframeId,
            candles: parsed.candles, spreads: parsed.spreads, spec: XAUUSD_SPEC, importedAt: Date.now(),
          });
          await db.datasets.put({
            id, symbol: 'XAUUSD', baseTf: '5m', rawCsv: text,
            candleCount: parsed.candles.length,
            dateStart: parsed.report.dateStart, dateEnd: parsed.report.dateEnd,
            importedAt: Date.now(), specJson: JSON.stringify(XAUUSD_SPEC),
          });
          setDatasets([{ id, symbol: 'XAUUSD', baseTf: '5m', candleCount: parsed.candles.length, dateStart: parsed.report.dateStart, dateEnd: parsed.report.dateEnd }]);
          setActiveDatasetId(id);
        }
        setBoot('ready');
      } catch (e) {
        console.error(e);
        setBoot('error');
        setBootMsg(String(e));
      }
    })();
  }, [setStrategies, setDatasets, setActiveDatasetId]);

  if (boot === 'loading') {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] text-gray-300 flex flex-col items-center justify-center gap-3">
        <CandlestickChart className="w-10 h-10 text-emerald-400 animate-pulse" />
        <div className="text-sm">{bootMsg}</div>
      </div>
    );
  }
  if (boot === 'error') {
    return (
      <div className="h-screen w-screen bg-[#0b0e14] text-red-300 flex items-center justify-center p-8 text-center">
        <div>
          <div className="text-lg mb-2">Failed to load dataset</div>
          <div className="text-sm text-gray-400">{bootMsg}</div>
        </div>
      </div>
    );
  }

  const nav = [
    { id: 'terminal' as const, icon: CandlestickChart, label: 'Terminal' },
    { id: 'dashboard' as const, icon: BarChart3, label: 'Analytics' },
    { id: 'import' as const, icon: Database, label: 'Data' },
    { id: 'strategies' as const, icon: ListChecks, label: 'Strategies' },
    { id: 'backtests' as const, icon: Save, label: 'Backtests' },
    { id: 'settings' as const, icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="h-screen w-screen bg-[#0b0e14] text-gray-200 flex overflow-hidden">
      <nav className="w-12 shrink-0 border-r border-[#1a1f2b] flex flex-col items-center py-2 gap-1">
        {nav.map((n) => (
          <a
            key={n.id}
            href={'#/' + n.id}
            title={n.label}
            className={`w-9 h-9 rounded flex items-center justify-center transition-colors ${
              route === n.id ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            <n.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          </a>
        ))}
        <div className="mt-auto text-[8px] text-gray-600 writing-vertical rotate-180 py-2 whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
          TradingView Lightweight Charts™
        </div>
      </nav>
      <main className="flex-1 min-w-0 h-full">
        {route === 'terminal' && <Terminal />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'import' && <ImportWizard />}
        {route === 'strategies' && <StrategyBuilder />}
        {route === 'backtests' && <Backtests />}
        {route === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
