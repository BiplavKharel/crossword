import type { ApiPuzzle, Dir, Letters, Puzzle, Word } from './types';

/** Derives clue numbering and per-cell word lookups from the black-square mask. */
export function buildPuzzle(api: ApiPuzzle): Puzzle {
  const n = api.size;
  const open = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && api.mask[r][c];
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
        const text = api.clues[dir].find(x => x.num === num)?.text ?? '';
        const word: Word = { dir, num, text, cells };
        words[dir].push(word);
        cells.forEach(([rr, cc]) => (wordAt[rr][cc][dir] = word));
      }
    }
  }
  return { id: api.id, date: api.date, size: n, playable: api.mask, numbers, words, wordAt };
}

export const emptyLetters = (n: number): Letters => Array.from({ length: n }, () => Array<string>(n).fill(''));

export const playableCount = (p: Puzzle) => p.playable.flat().filter(Boolean).length;

/** Every white square has a letter (says nothing about whether they're right; the server decides that). */
export const allFilled = (p: Puzzle, letters: Letters) =>
  p.playable.every((row, r) => row.every((open, c) => !open || letters[r][c] !== ''));

export const wordFilled = (w: Word, letters: Letters) => w.cells.every(([r, c]) => letters[r][c] !== '');
