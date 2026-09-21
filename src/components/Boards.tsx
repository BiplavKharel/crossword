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
    <svg className="board" viewBox={`0 0 ${total} ${total}`} preserveAspectRatio="xMidYMin meet" role="group" aria-label={label}>
      {children}
      <path className="board-lines" d={lines} vectorEffect="non-scaling-stroke" fill="none" />
      <rect className="board-frame" x={PAD / 2} y={PAD / 2} width={span + PAD} height={span + PAD} strokeWidth={PAD} fill="none" />
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
      <g role="grid" aria-label="Crossword grid">
        {puzzle.playable.map((row, r) => (
          <g key={r} role="row">
            {row.map((open, c) => {
              const x = at(c), y = at(r);
              if (!open) return <rect key={c} className="cell block" x={x} y={y} width={CELL} height={CELL} aria-hidden="true" />;
              const isSel = r === sel[0] && c === sel[1];
              const num = puzzle.numbers[r][c];
              const label = `${num ? `${num}, ` : ''}row ${r + 1}, column ${c + 1}, ${letters[r][c] || 'blank'}`;
              return (
                <g key={c} role="gridcell" aria-label={label} aria-selected={isSel} onClick={() => onSelect([r, c])}>
                  <rect className={`cell ${isSel ? 'sel' : inWord(r, c) ? 'word' : ''}`} x={x} y={y} width={CELL} height={CELL} />
                  {num > 0 && <text className="cell-num" x={x + 2} y={y + 21} fontSize={CELL * 0.26} aria-hidden="true">{num}</text>}
                  <text className={`cell-letter ${isSel ? 'on-sel' : ''}`} x={x + CELL / 2} y={y + CELL - 3} textAnchor="middle" fontSize={(CELL * 2) / 3} aria-hidden="true">
                    {letters[r][c]}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </g>
    </SvgBoard>
  );
}

interface OpponentProps {
  puzzle: Puzzle;
  /** Which cells the opponent has filled. Deliberately carries no letters. */
  filled: boolean[][];
  name: string;
}

export function OpponentBoard({ puzzle, filled, name }: OpponentProps) {
  return (
    <SvgBoard size={puzzle.size} label={`${name}'s board. Letters are hidden.`}>
      {puzzle.playable.map((row, r) =>
        row.map((open, c) => {
          const x = at(c), y = at(r);
          return (
            <g key={`${r}-${c}`} aria-hidden="true">
              <rect className={`cell ${open ? (filled[r][c] ? 'filled' : '') : 'block'}`} x={x} y={y} width={CELL} height={CELL} />
              {open && filled[r][c] && <circle className="cell-dot" cx={x + CELL / 2} cy={y + CELL / 2} r={CELL * 0.15} />}
            </g>
          );
        }),
      )}
    </SvgBoard>
  );
}
