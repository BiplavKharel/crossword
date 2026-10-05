/** Per-user stats. The rules mirror the browser's `src/stats.ts`, which becomes a cache of these. */
export interface Stats {
  played: number;
  wins: number;
  /** Consecutive wins as of `lastPlayed`. */
  streak: number;
  /** Fastest win in seconds. */
  bestTime: number | null;
  /** Player's calendar day (YYYY-MM-DD) of the last finished game. */
  lastPlayed: string | null;
}

export const emptyStats = (): Stats => ({ played: 0, wins: 0, streak: 0, bestTime: null, lastPlayed: null });

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseDay = (day: string) => {
  const m = DAY.exec(day);
  if (!m) return undefined;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(t).toISOString().slice(0, 10) === day ? t : undefined; // rejects 2026-02-31
};

const formatDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const dayBefore = (day: string) => formatDay((parseDay(day) ?? 0) - DAY_MS);

/**
 * The client reports its local calendar day (streaks are per player timezone). Any real
 * timezone is within a day of UTC, so anything further out is rejected.
 */
export function validDay(day: unknown, nowMs: number): day is string {
  if (typeof day !== 'string') return false;
  const t = parseDay(day);
  return t !== undefined && Math.abs(t - Date.parse(formatDay(nowMs))) <= DAY_MS;
}

/** A streak survives only if the last game was today or yesterday. */
export const liveStreak = (s: Stats, today: string) =>
  s.lastPlayed === today || s.lastPlayed === dayBefore(today) ? s.streak : 0;

export function applyResult(s: Stats, won: boolean, seconds: number, today: string): Stats {
  return {
    played: s.played + 1,
    wins: s.wins + (won ? 1 : 0),
    streak: won ? liveStreak(s, today) + 1 : 0,
    bestTime: won ? Math.min(s.bestTime ?? Infinity, seconds) : s.bestTime,
    lastPlayed: today,
  };
}
