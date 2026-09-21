import type { Letters } from '../types';
import type { MatchInfo } from './types';

// Lets a refresh drop you back into the match you were playing.
const KEY = 'crossword.activeMatch';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface Saved {
  userId: string;
  match: MatchInfo;
  letters: Letters;
}

export function saveMatch(userId: string, match: MatchInfo, letters: Letters) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, match, letters } satisfies Saved));
  } catch {
    /* storage unavailable; a refresh will just lose the game */
  }
}

export function loadMatch(userId: string): Saved | null {
  try {
    const s: Saved | null = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!s || s.userId !== userId || Date.now() - s.match.startsAt > MAX_AGE_MS) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearMatch() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
