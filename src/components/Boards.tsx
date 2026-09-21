import type { ReactNode } from 'react';
import type { Dir, Letters, Pos, Puzzle } from '../types';

// Board geometry, in SVG user units: 71-unit cells inside a 3-unit outer border.
const CELL = 71;
const PAD = 3;
const at = (i: number) => PAD + i * CELL;

function SvgBoard({ size, label, children }: { size: number; label: string; children: ReactNode }) {
  const span = size * CELL;
  const total = span + PAD * 2;
  const lines = Array.from({ length: size - 1 }, (_, i) => {
    const p = at(i + 1);
    return `M${PAD},${p} l${span},0 M${p},${PAD} l0,${span}`;
  }).join(' ');
  return (
    <svg className="board" viewBox={`0 0 ${total} ${total}`} preserveAspectRatio="xMidYMin meet" aria-label={label}>
      <g role="grid">{children}</g>
      <path d={lines} stroke="dimgray" vectorEffect="non-scaling-stroke" fill="none" />
      <rect x={PAD / 2} y={PAD / 2} width={span + PAD} height={span + PAD} stroke="black" strokeWidth={PAD} fill="none" />
    </svg>
  );
}

interface MineProps {
  puzzle: Puzzle;
  letters: Letters;
  sel: Pos;
  dir: Dir;
  onSelect: (pos: Pos) => void;
}

export function MyBoard({ puzzle, letters, sel, dir, onSelect }: MineProps) {
  const word = puzzle.wordAt[sel[0]][sel[1]][dir];
  const inWord = (r: number, c: number) => !!word?.cells.some(([wr, wc]) => wr === r && wc === c);
  return (
    <SvgBoard size={puzzle.size} label="Your puzzle board">
      {puzzle.solution.map((row, r) =>
        row.map((v, c) => {
          const x = at(c), y = at(r);
          if (!v) return <rect key={`${r}-${c}`} className="cell block" x={x} y={y} width={CELL} height={CELL} />;
          const isSel = r === sel[0] && c === sel[1];
          const cls = ['cell', isSel ? 'sel' : inWord(r, c) ? 'word' : ''].join(' ');
          const num = puzzle.numbers[r][c];
          return (
            <g key={`${r}-${c}`} role="row" onClick={() => onSelect([r, c])}>
              <rect className={cls} x={x} y={y} width={CELL} height={CELL} role="cell" aria-selected={isSel} />
              {num > 0 && <text className="cell-num" x={x + 2} y={y + 21} fontSize={CELL * 0.26}>{num}</text>}
              <text className="cell-letter" x={x + CELL / 2} y={y + CELL - 3} textAnchor="middle" fontSize={(CELL * 2) / 3}>
                {letters[r][c]}
              </text>
            </g>
          );
        }),
      )}
    </SvgBoard>
  );
}

interface OpponentProps {
  puzzle: Puzzle;
  /** Which cells the opponent has filled. Deliberately carries no letters. */
  filled: boolean[][];
}

export function OpponentBoard({ puzzle, filled }: OpponentProps) {
  return (
    <SvgBoard size={puzzle.size} label="Opponent's puzzle board, letters hidden">
      {puzzle.solution.map((row, r) =>
        row.map((v, c) => {
          const x = at(c), y = at(r);
          const cls = v ? (filled[r][c] ? 'cell filled' : 'cell') : 'cell block';
          return (
            <g key={`${r}-${c}`}>
              <rect className={cls} x={x} y={y} width={CELL} height={CELL} />
              {v && filled[r][c] && <circle className="cell-dot" cx={x + CELL / 2} cy={y + CELL / 2} r={CELL * 0.15} />}
            </g>
          );
        }),
      )}
    </SvgBoard>
  );
}
