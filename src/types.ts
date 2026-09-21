export type Dir = 'across' | 'down';
export type Pos = [number, number];
export type Letters = string[][];

/** Shape of an entry in public/puzzles.json (written by scrape.py). */
export interface RawPuzzle {
  date: string;
  size: [number, number];
  grid: (string | null)[][];
  clues: Record<Dir, { num: number; text: string; answer: string }[]>;
}

export interface Word {
  dir: Dir;
  num: number;
  text: string;
  cells: Pos[];
}

export interface Puzzle {
  date: string;
  size: number;
  solution: (string | null)[][];
  numbers: number[][];
  words: Record<Dir, Word[]>;
  wordAt: Partial<Record<Dir, Word>>[][];
}
