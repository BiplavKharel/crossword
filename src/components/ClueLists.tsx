import type { Letters, Puzzle, Word } from '../types';
import { wordSolved } from '../puzzle';

interface Props {
  puzzle: Puzzle;
  letters: Letters;
  current?: Word;
  /** The word crossing the selected cell in the other direction. */
  crossing?: Word;
  onJump: (w: Word) => void;
}

export function ClueLists({ puzzle, letters, current, crossing, onJump }: Props) {
  return (
    <div className="clues">
      {(['across', 'down'] as const).map(dir => (
        <div key={dir}>
          <h3>{dir}</h3>
          <ul>
            {puzzle.words[dir].map(w => (
              <li
                key={w.num}
                className={[w === current && 'active', w === crossing && 'cross', wordSolved(puzzle, w, letters) && 'done'].filter(Boolean).join(' ')}
                onClick={() => onJump(w)}
              >
                <span className="label">{w.num}</span>
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
