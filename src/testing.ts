import type { ApiPuzzle } from './types';

/** A tiny in-memory localStorage for tests. */
export function stubLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
  return data;
}

/** 5x5, all white unless `blacks` lists [row, col] squares. */
export function apiPuzzle(blacks: [number, number][] = []): ApiPuzzle {
  const mask = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => !blacks.some(([br, bc]) => br === r && bc === c)));
  const clue = (n: number) => ({ num: n, text: `Clue ${n}` });
  return { id: 'test', date: '2026-01-01', size: 5, mask, clues: { across: [1, 6, 7, 8, 9].map(clue), down: [1, 2, 3, 4, 5].map(clue) } };
}
