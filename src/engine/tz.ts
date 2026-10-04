// ============================================================================
// Timezone engine. All candle timestamps are unix seconds (UTC instant).
// Display/session/day grouping happens in ONE user-selected IANA timezone.
// Uses Intl.DateTimeFormat — real IANA tz data, DST-correct.
// ============================================================================

export interface TzParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number;
  weekday: number; // 0=Sunday .. 6=Saturday
  /** minutes since midnight in this tz */
  minOfDay: number;
  /** YYYY-MM-DD in this tz */
  dayKey: string;
}

export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Australia/Sydney',
];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** parts cache — parts(t) is extremely hot during replay */
const partsCache = new Map<string, TzParts>();
const PARTS_CACHE_MAX = 20000;

export function parts(t: number, tz: string): TzParts {
  const key = tz + '|' + t;
  const hit = partsCache.get(key);
  if (hit) return hit;
  const f = getFormatter(tz);
  const segs = f.formatToParts(new Date(t * 1000));
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, weekday = 0;
  for (const s of segs) {
    switch (s.type) {
      case 'year': year = +s.value; break;
      case 'month': month = +s.value; break;
      case 'day': day = +s.value; break;
      case 'hour': hour = +s.value % 24; break; // '24' can appear for midnight
      case 'minute': minute = +s.value; break;
      case 'second': second = +s.value; break;
      case 'weekday': weekday = WD[s.value] ?? 0; break;
    }
  }
  const p: TzParts = {
    year, month, day, hour, minute, second, weekday,
    minOfDay: hour * 60 + minute,
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
  if (partsCache.size > PARTS_CACHE_MAX) partsCache.clear();
  partsCache.set(key, p);
  return p;
}

export function clearTzCaches(): void {
  partsCache.clear();
  weekKeyCache.clear();
}

/** Format like "2025-03-14 08:30" in the given tz. */
export function fmtDateTime(t: number, tz: string): string {
  const p = parts(t, tz);
  return `${p.dayKey} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function fmtTime(t: number, tz: string): string {
  const p = parts(t, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function fmtDate(t: number, tz: string): string {
  return parts(t, tz).dayKey;
}

/** week key like 2025-W11 (ISO-ish, Monday based in display tz) — cached per day */
const weekKeyCache = new Map<string, string>();
export function weekKey(t: number, tz: string): string {
  const p = parts(t, tz);
  const ck = tz + '|' + p.dayKey;
  const hit = weekKeyCache.get(ck);
  if (hit) return hit;
  // shift to monday
  const shift = (p.weekday + 6) % 7;
  const monday = t - shift * 86400;
  const mp = parts(monday, tz);
  const wk = `${mp.year}-W${mp.month}${String(mp.day).padStart(2, '0')}`;
  weekKeyCache.set(ck, wk);
  return wk;
}

export function monthKey(t: number, tz: string): string {
  const p = parts(t, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Convert a local date+time specified IN timezone `tz` to a unix instant. */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, tz: string
): number {
  // iterative approach: guess UTC = wall time as-if-UTC, then correct by measured offset
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let guess = wallAsUtc;
  for (let i = 0; i < 4; i++) {
    const p = parts(guess, tz);
    const measuredWall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000;
    const offset = measuredWall - guess; // tz offset in seconds
    const next = wallAsUtc - offset;
    if (Math.abs(next - guess) < 1) break;
    guess = next;
  }
  return Math.round(guess);
}

/** Current tz offset (in seconds, tz = utc + offset) at instant t. */
export function tzOffsetSeconds(t: number, tz: string): number {
  const p = parts(t, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return wall - t;
}
