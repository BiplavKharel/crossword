import type { ApiPuzzle, RawPuzzle } from '../src/types.js';
import { WINDOW_SECONDS, type Store } from './store.js';

export { WINDOW_SECONDS };

/** Strips the letters: players get the layout and clue text only. */
export const toPublic = (p: RawPuzzle): ApiPuzzle => ({
  id: p.date,
  date: p.date,
  size: p.size[0],
  mask: p.grid.map(row => row.map(Boolean)),
  clues: {
    across: p.clues.across.map(({ num, text }) => ({ num, text })),
    down: p.clues.down.map(({ num, text }) => ({ num, text })),
  },
});

/** An n x n grid of strings no longer than one character. */
export const isLetterGrid = (g: unknown, n: number): g is string[][] =>
  Array.isArray(g) && g.length === n && g.every(row => Array.isArray(row) && row.length === n && row.every(c => typeof c === 'string' && c.length <= 1));

/** An n x n grid of booleans (which squares are filled). */
export const isMask = (g: unknown, n: number): g is boolean[][] =>
  Array.isArray(g) && g.length === n && g.every(row => Array.isArray(row) && row.length === n && row.every(c => typeof c === 'boolean'));

export const isSolved = (puzzle: RawPuzzle, grid: string[][]) =>
  puzzle.grid.every((row, r) => row.every((answer, c) => (answer ?? '') === grid[r][c].toUpperCase()));

export type Verdict = 'solved' | 'wrong' | 'limited';

/**
 * Checks a grid and counts a wrong guess against the player, so the answers can't be brute-forced.
 * If the counter store is down we let the guess through (and log it) rather than break the game.
 */
export async function judge(store: Store, sub: string, puzzle: RawPuzzle, grid: string[][], maxWrong: number): Promise<Verdict> {
  try {
    if ((await store.wrongCount(sub, puzzle.date)) >= maxWrong) return 'limited';
  } catch (err) {
    console.error('attempt store read failed', err);
  }
  if (isSolved(puzzle, grid)) return 'solved';
  await store.addWrong(sub, puzzle.date).catch(err => console.error('attempt store write failed', err));
  return 'wrong';
}
