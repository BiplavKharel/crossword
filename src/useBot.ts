import { useEffect, useRef, useState } from 'react';
import type { Puzzle } from './types';

/**
 * Local stand-in for the remote player. It never knows the answers; it just fills
 * squares one at a time, sometimes losing a beat to a "typo". It returns only which
 * squares are filled, which is what a real opponent's server would send too.
 */
export function useBot(puzzle: Puzzle, active: boolean, onFinish: () => void) {
  const cells = useRef(puzzle.playable.flatMap((row, r) => row.flatMap((open, c) => (open ? [[r, c] as const] : []))));
  const next = useRef(0);
  const [filled, setFilled] = useState<boolean[][]>(() => puzzle.playable.map(row => row.map(() => false)));
  const finish = useRef(onFinish);
  finish.current = onFinish;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (Math.random() < 0.12) return;
      const cell = cells.current[next.current++];
      if (!cell) return;
      setFilled(f => f.map((row, r) => row.map((v, c) => v || (r === cell[0] && c === cell[1]))));
      if (next.current >= cells.current.length) finish.current();
    }, 2200);
    return () => clearInterval(id);
  }, [active]);

  return filled;
}
