// ============================================================================
// CSV import: delimiter/header/column/timestamp auto-detection + validation.
// The original text is NEVER mutated — detection reads, import builds new data.
// ============================================================================

import { TIMEFRAMES } from './types';
import type { Candle, TimeframeId } from './types';

export interface ColumnMap {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // -1 if absent
  spread: number; // -1 if absent
}

export interface CsvDetection {
  delimiter: string;
  hasHeader: boolean;
  header: string[];
  columns: ColumnMap;
  timeFormat: string; // descriptive label
  /** parse a raw time cell into unix seconds (UTC per chosen assumption) */
  parseTime: (s: string) => number | null;
}

export interface ValidationReport {
  symbol: string;
  timeframe: TimeframeId | 'unknown';
  rows: number;
  parsedRows: number;
  dateStart: number;
  dateEnd: number;
  missingCandles: number;
  duplicates: number;
  invalidCandles: number;
  unsortedRows: number;
  zeroVolumeRows: number;
  avgSpread?: number;
  status: 'READY' | 'WARNINGS' | 'FAILED';
  issues: string[];
}

const DELIMS = [';', ',', '\t', '|'];

const COL_SYNONYMS: Record<keyof Omit<ColumnMap, never>, string[]> = {
  time: ['time', 'date', 'datetime', 'timestamp', 'date/time', 'gmt time', 'utc'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'last'],
  volume: ['volume', 'vol', 'v', 'tickvol', 'tick volume', 'tick_volume'],
  spread: ['spread', 'spr'],
};

function detectDelimiter(sampleLines: string[]): string {
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMS) {
    const counts = sampleLines.map((l) => l.split(d).length);
    const min = Math.min(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const score = consistent ? min : 0;
    if (score > bestScore && min >= 2) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function matchColumn(header: string[], kind: keyof ColumnMap): number {
  const syns = COL_SYNONYMS[kind];
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const s of syns) {
    const i = lower.indexOf(s);
    if (i >= 0) return i;
  }
  // partial match fallback
  for (const s of syns) {
    const i = lower.findIndex((h) => h.includes(s) && s.length > 1);
    if (i >= 0) return i;
  }
  return -1;
}

type TimeParser = (s: string) => number | null;

/** Build parsers for known timestamp formats. Return null on no match. */
function buildTimeParser(sample: string): { label: string; parse: TimeParser } | null {
  const s = sample.trim();

  // unix seconds or ms (pure digits)
  if (/^\d{9,10}$/.test(s)) {
    return { label: 'unix-seconds', parse: (x) => parseInt(x.trim(), 10) };
  }
  if (/^\d{13}$/.test(s)) {
    return { label: 'unix-ms', parse: (x) => Math.floor(parseInt(x.trim(), 10) / 1000) };
  }

  // YYYY.MM.DD HH:mm / YYYY-MM-DD HH:mm / YYYY/MM/DD HH:mm[:ss]
  let m = s.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    return {
      label: 'YMD separated',
      parse: (x) => {
        const mm = x
          .trim()
          .match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!mm) return null;
        return Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +mm[4], +mm[5], +(mm[6] ?? 0)) / 1000;
      },
    };
  }

  // DD.MM.YYYY HH:mm / DD/MM/YYYY
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return {
      label: 'DMY separated',
      parse: (x) => {
        const mm = x
          .trim()
          .match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!mm) return null;
        return Date.UTC(+mm[3], +mm[2] - 1, +mm[1], +mm[4], +mm[5], +(mm[6] ?? 0)) / 1000;
      },
    };
  }

  // MT4/MT5 bar export without time (date only) — treat as midnight
  m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m) {
    return {
      label: 'date-only',
      parse: (x) => {
        const mm = x.trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
        if (!mm) return null;
        return Date.UTC(+mm[1], +mm[2] - 1, +mm[3]) / 1000;
      },
    };
  }

  // ISO 8601 with timezone — Date.parse handles it
  const d = Date.parse(s);
  if (!isNaN(d)) {
    return {
      label: 'Date.parse',
      parse: (x) => {
        const dd = Date.parse(x.trim());
        return isNaN(dd) ? null : Math.floor(dd / 1000);
      },
    };
  }
  return null;
}

export function detectCsv(text: string): CsvDetection | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const sample = lines.slice(0, 10);
  const delimiter = detectDelimiter(sample);
  const first = sample[0].split(delimiter).map((c) => c.trim());

  // header = first row contains any known column synonym OR any non-numeric cell
  const lower = first.map((c) => c.toLowerCase());
  const synonymHit = lower.some((c) =>
    Object.values(COL_SYNONYMS).flat().includes(c)
  );
  const nonNumeric = first.some((c) => c !== '' && isNaN(Number(c)) && buildTimeParser(c) === null);
  const hasHeader = synonymHit || nonNumeric;

  let columns: ColumnMap;
  let header: string[];
  if (hasHeader) {
    header = first;
    columns = {
      time: matchColumn(header, 'time'),
      open: matchColumn(header, 'open'),
      high: matchColumn(header, 'high'),
      low: matchColumn(header, 'low'),
      close: matchColumn(header, 'close'),
      volume: matchColumn(header, 'volume'),
      spread: matchColumn(header, 'spread'),
    };
  } else {
    header = [];
    // positional guess: time,o,h,l,c[,v][,spread]
    const n = first.length;
    columns = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: n >= 6 ? 5 : -1, spread: n >= 7 ? 6 : -1 };
  }

  if (columns.time < 0 || columns.open < 0 || columns.high < 0 || columns.low < 0 || columns.close < 0) {
    return null;
  }

  // find first data row to sample time format
  const dataStart = hasHeader ? 1 : 0;
  let timeFmt: { label: string; parse: TimeParser } | null = null;
  for (let i = dataStart; i < Math.min(lines.length, dataStart + 20); i++) {
    const cells = lines[i].split(delimiter);
    const cell = (cells[columns.time] ?? '').trim();
    if (!cell) continue;
    timeFmt = buildTimeParser(cell);
    if (timeFmt) break;
  }
  if (!timeFmt) return null;

  return { delimiter, hasHeader, header, columns, timeFormat: timeFmt.label, parseTime: timeFmt.parse };
}

export interface ParsedCsv {
  candles: Candle[];
  spreads: (number | undefined)[]; // aligned with candles, points if provided
  report: ValidationReport;
}

export function parseAndValidate(
  text: string,
  det: CsvDetection,
  symbol: string,
  timeframeOverride?: TimeframeId
): ParsedCsv {
  const lines = text.split(/\r?\n/);
  const candles: Candle[] = [];
  const spreads: (number | undefined)[] = [];
  let invalid = 0;
  let unsorted = 0;
  let zeroVol = 0;
  const issues: string[] = [];
  let prevT = -Infinity;
  let spreadSum = 0;
  let spreadCount = 0;

  const start = det.hasHeader ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(det.delimiter);
    if (cells.length <= det.columns.close) {
      invalid++;
      continue;
    }
    const t = det.parseTime(cells[det.columns.time] ?? '');
    const o = Number(cells[det.columns.open]);
    const h = Number(cells[det.columns.high]);
    const l = Number(cells[det.columns.low]);
    const c = Number(cells[det.columns.close]);
    const v = det.columns.volume >= 0 ? Number(cells[det.columns.volume]) : undefined;
    const sp = det.columns.spread >= 0 ? Number(cells[det.columns.spread]) : undefined;

    if (t === null || !isFinite(t) || [o, h, l, c].some((x) => !isFinite(x))) {
      invalid++;
      continue;
    }
    if (h < l || h < o || h < c || l > o || l > c || o <= 0 || c <= 0) {
      invalid++;
      continue;
    }
    if (t < prevT) unsorted++;
    prevT = Math.max(prevT, t);
    if (v !== undefined && isFinite(v) && v === 0) zeroVol++;
    if (sp !== undefined && isFinite(sp)) {
      spreadSum += sp;
      spreadCount++;
    }
    candles.push({ t, o, h, l, c, v: v !== undefined && isFinite(v) ? v : undefined });
    spreads.push(sp !== undefined && isFinite(sp) ? sp : undefined);
  }

  // Pair candles with spreads BEFORE sorting so they stay aligned.
  const pairs = candles.map((c, i) => ({ c, s: spreads[i] }));
  pairs.sort((a, b) => a.c.t - b.c.t);
  const seen = new Set<number>();
  let duplicates = 0;
  const finalCandles: Candle[] = [];
  const finalSpreads: (number | undefined)[] = [];
  for (const p of pairs) {
    if (seen.has(p.c.t)) {
      duplicates++;
      continue;
    }
    seen.add(p.c.t);
    finalCandles.push(p.c);
    finalSpreads.push(p.s);
  }

  // timeframe detection: modal diff
  let timeframe: TimeframeId | 'unknown' = 'unknown';
  if (finalCandles.length > 1) {
    const diffs = new Map<number, number>();
    for (let i = 1; i < Math.min(finalCandles.length, 2000); i++) {
      const d = finalCandles[i].t - finalCandles[i - 1].t;
      diffs.set(d, (diffs.get(d) ?? 0) + 1);
    }
    let bestD = 0;
    let bestN = 0;
    diffs.forEach((n, d) => {
      if (n > bestN) {
        bestN = n;
        bestD = d;
      }
    });
    const tf = TIMEFRAMES.find((t) => t.seconds === bestD);
    timeframe = tf ? tf.id : 'unknown';
  }
  if (timeframeOverride) timeframe = timeframeOverride;

  // missing candles vs modal step (only count gaps that are exact multiples)
  let missing = 0;
  if (timeframe !== 'unknown') {
    const step = TIMEFRAMES.find((t) => t.id === timeframe)!.seconds;
    for (let i = 1; i < finalCandles.length; i++) {
      const d = finalCandles[i].t - finalCandles[i - 1].t;
      if (d > step && d % step === 0 && d <= step * 5) {
        missing += d / step - 1;
      }
      // larger gaps are likely weekends/market close — not counted as missing
    }
  }

  if (invalid > 0) issues.push(`${invalid} invalid candle(s) skipped (bad OHLC or timestamp)`);
  if (duplicates > 0) issues.push(`${duplicates} duplicate timestamp(s) removed (kept first)`);
  if (unsorted > 0) issues.push(`${unsorted} out-of-order row(s) — sorted by time on import`);
  if (missing > 0) issues.push(`${missing} missing candle(s) detected inside trading hours`);
  if (timeframe === 'unknown') issues.push('Could not detect a standard timeframe from spacing');

  const status: ValidationReport['status'] =
    finalCandles.length === 0 ? 'FAILED' : invalid > finalCandles.length * 0.05 || timeframe === 'unknown' ? 'WARNINGS' : issues.length > 0 ? 'WARNINGS' : 'READY';

  const report: ValidationReport = {
    symbol,
    timeframe,
    rows: lines.filter((l) => l.trim()).length - (det.hasHeader ? 1 : 0),
    parsedRows: finalCandles.length,
    dateStart: finalCandles[0]?.t ?? 0,
    dateEnd: finalCandles[finalCandles.length - 1]?.t ?? 0,
    missingCandles: missing,
    duplicates,
    invalidCandles: invalid,
    unsortedRows: unsorted,
    zeroVolumeRows: zeroVol,
    avgSpread: spreadCount > 0 ? spreadSum / spreadCount : undefined,
    status,
    issues,
  };
  return { candles: finalCandles, spreads: finalSpreads, report };
}
