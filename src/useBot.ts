import { useEffect, useRef, useState } from 'react';
import type { Letters, Puzzle } from './types';
import { emptyLetters, isSolved } from './puzzle';

const randomLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));

/**
 * Local stand-in for the remote player. Returns only which cells are filled
 * (never the letters), which is exactly what a server would send later.
 */
export function useBot(puzzle: Puzzle, active: boolean, onFinish: () => void) {
  const letters = useRef<Letters>(emptyLetters(puzzle.size));
  const [filled, setFilled] = useState<boolean[][]>(() => letters.current.map(row => row.map(() => false)));
  const finish = useRef(onFinish);
  finish.current = onFinish;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const L = letters.current;
      const cell = puzzle.solution.flatMap((row, r) => row.map((v, c) => [r, c, v] as const)).find(([r, c, v]) => v && L[r][c] !== v);
      if (!cell) return;
      const [r, c, v] = cell;
      L[r][c] = Math.random() < 0.12 ? randomLetter() : (v as string);
      setFilled(L.map(row => row.map(x => x !== '')));
      if (isSolved(puzzle, L)) finish.current();
    }, 2200);
    return () => clearInterval(id);
  }, [puzzle, active]);

  return filled;
}
