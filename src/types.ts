export type Dir = 'across' | 'down';
export type Pos = [number, number];
export type Letters = string[][];

/** Full puzzle including solutions. Server-only: scrape.py writes this into server/puzzles.ts. */
export interface RawPuzzle {
  date: string;
  size: [number, number];
  grid: (string | null)[][];
  clues: Record<Dir, { num: number; text: string; answer: string }[]>;
}

/** What the API sends to players: layout and clue text, no letters. */
export interface ApiPuzzle {
  id: string;
  date: string;
  size: number;
  /** true where a letter goes, false for black squares. */
  mask: boolean[][];
  clues: Record<Dir, { num: number; text: string }[]>;
}

export interface Word {
  dir: Dir;
  num: number;
  text: string;
  cells: Pos[];
}

export interface Puzzle {
  id: string;
  date: string;
  size: number;
  playable: boolean[][];
  numbers: number[][];
  words: Record<Dir, Word[]>;
  wordAt: Partial<Record<Dir, Word>>[][];
}
