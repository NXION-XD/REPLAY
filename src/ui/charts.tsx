// ============================================================================
// Lightweight SVG chart helpers for analytics (equity, drawdown, histograms,
// heatmaps). Pure functions of the data — no chart library needed here.
// ============================================================================

import React from 'react';

export function LineChart({
  points, width = 600, height = 160, color = '#34d399', fill = true, yLabel,
}: {
  points: { x: number; y: number }[];
  width?: number; height?: number; color?: string; fill?: boolean; yLabel?: string;
}) {
  if (points.length < 2) return <Empty height={height} />;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (x: number) => ((x - minX) / spanX) * (width - 40) + 34;
  const py = (y: number) => height - 8 - ((y - minY) / spanY) * (height - 20);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${px(maxX).toFixed(1)},${py(minY).toFixed(1)} L${px(minX).toFixed(1)},${py(minY).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {fill && <path d={area} fill={color + '22'} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <line x1={px(minX)} x2={px(maxX)} y1={py(0)} y2={py(0)} stroke="#374151" strokeDasharray="3 3" />
      <text x={2} y={py(maxY) + 4} fontSize={9} fill="#6b7280">{maxY.toFixed(1)}</text>
      <text x={2} y={py(minY) + 4} fontSize={9} fill="#6b7280">{minY.toFixed(1)}</text>
      {yLabel && <text x={2} y={10} fontSize={9} fill="#6b7280">{yLabel}</text>}
    </svg>
  );
}

export function Histogram({
  bins, width = 600, height = 140, color = '#60a5fa',
}: {
  bins: { from: number; to: number; count: number }[];
  width?: number; height?: number; color?: string;
}) {
  if (bins.length === 0) return <Empty height={height} />;
  const maxC = Math.max(...bins.map((b) => b.count)) || 1;
  const bw = (width - 30) / bins.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {bins.map((b, i) => {
        const h = (b.count / maxC) * (height - 24);
        const mid = (b.from + b.to) / 2;
        return (
          <g key={i}>
            <rect x={30 + i * bw + 1} y={height - 16 - h} width={Math.max(1, bw - 2)} height={h} fill={mid >= 0 ? '#34d399' : '#f87171'} opacity={0.85} />
            {bins.length <= 25 && <text x={30 + i * bw + bw / 2} y={height - 4} fontSize={8} fill="#6b7280" textAnchor="middle">{mid.toFixed(1)}</text>}
          </g>
        );
      })}
      <text x={2} y={10} fontSize={9} fill={color}>n={bins.reduce((s, b) => s + b.count, 0)}</text>
    </svg>
  );
}

export function BarChart({
  data, width = 600, height = 160, valueFmt = (v: number) => v.toFixed(1),
}: {
  data: { label: string; value: number; color?: string }[];
  width?: number; height?: number; valueFmt?: (v: number) => string;
}) {
  if (data.length === 0) return <Empty height={height} />;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value))) || 1;
  const bw = (width - 30) / data.length;
  const zero = height / 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <line x1={26} x2={width} y1={zero} y2={zero} stroke="#374151" />
      {data.map((d, i) => {
        const h = (Math.abs(d.value) / maxAbs) * (height / 2 - 14);
        const y = d.value >= 0 ? zero - h : zero;
        return (
          <g key={i}>
            <rect x={30 + i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={Math.max(1, h)} fill={d.color ?? (d.value >= 0 ? '#34d399' : '#f87171')} opacity={0.85} />
            <text x={30 + i * bw + bw / 2} y={d.value >= 0 ? y - 3 : y + h + 9} fontSize={8} fill="#9ca3af" textAnchor="middle">{valueFmt(d.value)}</text>
            <text x={30 + i * bw + bw / 2} y={height - 2} fontSize={8} fill="#6b7280" textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Heatmap({
  rows, cols, values, fmt = (v: number) => v.toFixed(0), title,
}: {
  rows: string[];
  cols: string[];
  values: (number | null)[][]; // [row][col]
  fmt?: (v: number) => string;
  title?: string;
}) {
  const flat = values.flat().filter((v): v is number => v !== null);
  const maxAbs = Math.max(...flat.map(Math.abs), 1e-9);
  return (
    <div className="overflow-x-auto">
      {title && <div className="text-[10px] uppercase text-gray-500 mb-1">{title}</div>}
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="text-[9px] text-gray-500 px-1"></th>
            {cols.map((c) => <th key={c} className="text-[9px] text-gray-500 px-1 font-normal">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="text-[9px] text-gray-500 pr-1 text-right">{r}</td>
              {cols.map((c, ci) => {
                const v = values[ri]?.[ci];
                const intensity = v === null ? 0 : Math.min(1, Math.abs(v) / maxAbs);
                const bg = v === null ? 'transparent' : v >= 0 ? `rgba(52,211,153,${0.08 + intensity * 0.5})` : `rgba(248,113,113,${0.08 + intensity * 0.5})`;
                return (
                  <td key={c} className="text-[9px] text-center px-1.5 py-1 rounded-sm" style={{ background: bg, minWidth: 34 }}>
                    {v === null ? '' : <span className={v >= 0 ? 'text-emerald-200' : 'text-red-200'}>{fmt(v)}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div style={{ height }} className="flex items-center justify-center text-[11px] text-gray-600">
      No data yet — close some trades to populate this chart.
    </div>
  );
}

export function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="bg-[#0d1119] border border-[#1a1f2b] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-red-400' : 'text-gray-100'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

export function DataTable({ cols, rows, maxRows = 200 }: {
  cols: { key: string; label: string; align?: 'left' | 'right'; fmt?: (v: unknown) => React.ReactNode }[];
  rows: Record<string, unknown>[];
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [asc, setAsc] = React.useState(false);
  const sorted = React.useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
  }, [rows, sortKey, asc]);
  return (
    <div className="overflow-auto max-h-[420px]">
      <table className="w-full">
        <thead className="sticky top-0 bg-[#0d1119]">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => { setSortKey(c.key); setAsc(sortKey === c.key ? !asc : false); }}
                className={`px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-medium cursor-pointer hover:text-gray-300 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {c.label} {sortKey === c.key ? (asc ? '▲' : '▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, maxRows).map((r, i) => (
            <tr key={i} className="border-t border-[#161b26] hover:bg-white/[0.02]">
              {cols.map((c) => (
                <td key={c.key} className={`px-2 py-1 text-[11px] whitespace-nowrap ${c.align === 'right' ? 'text-right font-mono' : ''}`}>
                  {c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
