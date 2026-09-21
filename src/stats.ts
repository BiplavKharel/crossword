// Placeholder persistence: stats live in this browser's localStorage, keyed by user.
// Replace with server-side storage once there is a database.

export interface Stats {
  played: number;
  wins: number;
  /** Consecutive daily wins as of `lastPlayed`. Use `currentStreak` for the live value. */
  streak: number;
  bestTime: number | null;
  /** Local calendar day (YYYY-MM-DD) of the last finished game. */
  lastPlayed: string | null;
}

const empty = (): Stats => ({ played: 0, wins: 0, streak: 0, bestTime: null, lastPlayed: null });
const key = (userId: string) => `crossword.stats.${userId}`;

export const dayString = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const yesterday = () => dayString(new Date(Date.now() - 24 * 60 * 60 * 1000));

export function loadStats(userId: string): Stats {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(key(userId)) ?? '{}') };
  } catch {
    return empty();
  }
}

function save(userId: string, s: Stats) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(s));
  } catch {
    /* storage unavailable; stats just won't persist */
  }
}

export function recordResult(userId: string, won: boolean, seconds: number): Stats {
  const s = loadStats(userId);
  const next: Stats = {
    played: s.played + 1,
    wins: s.wins + (won ? 1 : 0),
    streak: won ? currentStreak(s) + 1 : 0,
    bestTime: won ? Math.min(s.bestTime ?? Infinity, seconds) : s.bestTime,
    lastPlayed: dayString(),
  };
  save(userId, next);
  return next;
}

export function resetStats(userId: string) {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}

// Daily play limit disabled for now — always report as not played today.
export const playedToday = (_s: Stats) => false;

/** A streak survives only if the last game was today or yesterday. */
export const currentStreak = (s: Stats) => (s.lastPlayed === dayString() || s.lastPlayed === yesterday() ? s.streak : 0);

export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}
