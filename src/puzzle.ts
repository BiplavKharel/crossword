import type { Dir, Letters, Puzzle, RawPuzzle, Word } from './types';

export async function loadPuzzles(): Promise<RawPuzzle[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}puzzles.json`);
  const all: RawPuzzle[] = await res.json();
  return all.filter(p => p.size[0] === 5 && p.size[1] === 5);
}

/** Derives clue numbering and per-cell word lookups from the solution grid. */
export function buildPuzzle(raw: RawPuzzle): Puzzle {
  const n = raw.size[0];
  const open = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && !!raw.grid[r][c];
  const numbers = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const wordAt: Puzzle['wordAt'] = Array.from({ length: n }, () => Array.from({ length: n }, () => ({})));
  const words: Puzzle['words'] = { across: [], down: [] };

  let num = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!open(r, c)) continue;
      const starts: [Dir, boolean, number, number][] = [
        ['across', !open(r, c - 1) && open(r, c + 1), 0, 1],
        ['down', !open(r - 1, c) && open(r + 1, c), 1, 0],
      ];
      if (!starts.some(s => s[1])) continue;
      numbers[r][c] = ++num;
      for (const [dir, isStart, dr, dc] of starts) {
        if (!isStart) continue;
        const cells: Word['cells'] = [];
        for (let rr = r, cc = c; open(rr, cc); rr += dr, cc += dc) cells.push([rr, cc]);
        const text = raw.clues[dir].find(x => x.num === num)?.text ?? '';
        const word: Word = { dir, num, text, cells };
        words[dir].push(word);
        cells.forEach(([rr, cc]) => (wordAt[rr][cc][dir] = word));
      }
    }
  }
  return { date: raw.date, size: n, solution: raw.grid, numbers, words, wordAt };
}

export const emptyLetters = (n: number): Letters => Array.from({ length: n }, () => Array<string>(n).fill(''));

export const isSolved = (p: Puzzle, letters: Letters) =>
  p.solution.every((row, r) => row.every((v, c) => (v ?? '') === letters[r][c]));

export const wordSolved = (p: Puzzle, w: Word, letters: Letters) =>
  w.cells.every(([r, c]) => letters[r][c] === p.solution[r][c]);

export const playableCount = (p: Puzzle) => p.solution.flat().filter(Boolean).length;
