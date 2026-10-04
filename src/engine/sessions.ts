// ============================================================================
// Sessions: definitions, current-session lookup, incremental session stats.
// All times are minutes-of-day in the DISPLAY timezone. Midnight crossing OK.
// ============================================================================

import type { Candle, SessionDef } from './types';
import { parts } from './tz';

export const DEFAULT_SESSIONS: SessionDef[] = [
  { id: 'asia', name: 'Asia', startMin: 0, endMin: 420, color: '#8b5cf6' },        // 00:00–07:00
  { id: 'london', name: 'London', startMin: 420, endMin: 960, color: '#3b82f6' },   // 07:00–16:00
  { id: 'newyork', name: 'New York', startMin: 780, endMin: 1320, color: '#f59e0b' }, // 13:00–22:00
];

export function sessionAt(t: number, tz: string, sessions: SessionDef[]): SessionDef | null {
  const m = parts(t, tz).minOfDay;
  for (const s of sessions) {
    if (s.startMin <= s.endMin) {
      if (m >= s.startMin && m < s.endMin) return s;
    } else {
      // crosses midnight
      if (m >= s.startMin || m < s.endMin) return s;
    }
  }
  return null;
}

/** minutes elapsed since the current session opened (0 if outside sessions) */
export function minutesIntoSession(t: number, tz: string, sessions: SessionDef[]): number {
  const m = parts(t, tz).minOfDay;
  for (const s of sessions) {
    if (s.startMin <= s.endMin) {
      if (m >= s.startMin && m < s.endMin) return m - s.startMin;
    } else if (m >= s.startMin || m < s.endMin) {
      return m >= s.startMin ? m - s.startMin : 1440 - s.startMin + m;
    }
  }
  return 0;
}

export interface SessionStats {
  sessionId: string;
  dayKey: string;
  open: number;
  high: number;
  low: number;
  close: number;
  startT: number;
}

/**
 * Incremental session tracker. Feed candles in time order; at any cursor
 * position it knows the current day's per-session OHLC — using ONLY candles
 * seen so far. Completed sessions are finalized when a candle outside the
 * session (or a new day) arrives.
 */
export class SessionTracker {
  private tz: string;
  private sessions: SessionDef[];
  /** key: sessionId|dayKey — the dayKey of the session's OPEN time */
  private active = new Map<string, SessionStats & { sk: string }>();
  completed: SessionStats[] = [];
  /** version counter so UI can memoize */
  version = 0;

  constructor(tz: string, sessions: SessionDef[]) {
    this.tz = tz;
    this.sessions = sessions;
  }

  reset(): void {
    this.active.clear();
    this.completed = [];
    this.version++;
  }

  push(c: Candle): void {
    const p = parts(c.t, this.tz);
    const s = sessionAt(c.t, this.tz, this.sessions);
    // close any active session this candle no longer belongs to
    this.active.forEach((st, key) => {
      const def = this.sessions.find((x) => x.id === st.sessionId)!;
      const stillInside =
        s?.id === st.sessionId && this.sameSessionDay(st, p.dayKey, def);
      if (!stillInside) {
        this.completed.push(st);
        this.active.delete(key);
      }
    });
    if (!s) {
      this.version++;
      return;
    }
    // the session's owning day = day of its start time
    const owningDay = this.sessionOwningDay(p.dayKey, p.minOfDay, s);
    const key = s.id + '|' + owningDay;
    const cur = this.active.get(key);
    if (!cur) {
      this.active.set(key, {
        sessionId: s.id, dayKey: owningDay, sk: key,
        open: c.o, high: c.h, low: c.l, close: c.c, startT: c.t,
      });
    } else {
      cur.high = Math.max(cur.high, c.h);
      cur.low = Math.min(cur.low, c.l);
      cur.close = c.c;
    }
    this.version++;
  }

  private sameSessionDay(st: SessionStats, currentDay: string, def: SessionDef): boolean {
    void def;
    return st.dayKey === currentDay || this.dayAfter(st.dayKey) === currentDay;
  }

  private dayAfter(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d) + 86400000);
    return next.toISOString().slice(0, 10);
  }

  private sessionOwningDay(dayKey: string, minOfDay: number, s: SessionDef): string {
    if (s.startMin <= s.endMin) return dayKey;
    // crosses midnight: before-midnight part belongs to today's session
    if (minOfDay >= s.startMin) return dayKey;
    // after midnight: belongs to yesterday's session
    const [y, m, d] = dayKey.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d) - 86400000);
    return prev.toISOString().slice(0, 10);
  }

  /** snapshot of active + completed for UI rendering */
  snapshot(): { active: SessionStats[]; completed: SessionStats[] } {
    return { active: [...this.active.values()], completed: this.completed };
  }

  /** most recent completed stats for a session id */
  lastCompleted(sessionId: string): SessionStats | undefined {
    for (let i = this.completed.length - 1; i >= 0; i--) {
      if (this.completed[i].sessionId === sessionId) return this.completed[i];
    }
    return undefined;
  }
}
