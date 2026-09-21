import type { Dir, Letters, Pos, Puzzle, Word } from './types';
import { emptyLetters } from './puzzle';

export interface GameState {
  letters: Letters;
  sel: Pos;
  dir: Dir;
}

export type Action =
  | { type: 'select'; pos: Pos }
  | { type: 'toggleDir' }
  | { type: 'jump'; word: Word }
  | { type: 'type'; ch: string }
  | { type: 'backspace' }
  | { type: 'arrow'; key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' }
  | { type: 'nextClue'; back: boolean };

export function initGame(p: Puzzle): GameState {
  for (let r = 0; r < p.size; r++) {
    for (let c = 0; c < p.size; c++) {
      if (p.playable[r][c]) return { letters: emptyLetters(p.size), sel: [r, c], dir: p.wordAt[r][c].across ? 'across' : 'down' };
    }
  }
  throw new Error('puzzle has no open cells');
}

const other = (d: Dir): Dir => (d === 'across' ? 'down' : 'across');
const firstEmpty = (w: Word, letters: Letters): Pos => w.cells.find(([r, c]) => !letters[r][c]) ?? w.cells[0];

/** Move within the current word by delta cells, staying put at the ends. */
function step(p: Puzzle, s: GameState, delta: number): Pos {
  const w = p.wordAt[s.sel[0]][s.sel[1]][s.dir];
  if (!w) return s.sel;
  const i = w.cells.findIndex(([r, c]) => r === s.sel[0] && c === s.sel[1]) + delta;
  return w.cells[i] ?? s.sel;
}

/** Keep `dir` valid for the selected cell (e.g. a cell that only has a down word). */
const fixDir = (p: Puzzle, s: GameState): GameState =>
  p.wordAt[s.sel[0]][s.sel[1]][s.dir] ? s : { ...s, dir: other(s.dir) };

function setLetter(s: GameState, [r, c]: Pos, ch: string): Letters {
  const letters = s.letters.map(row => [...row]);
  letters[r][c] = ch;
  return letters;
}

export function reduce(p: Puzzle, s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'select': {
      if (!p.playable[a.pos[0]][a.pos[1]]) return s;
      const same = a.pos[0] === s.sel[0] && a.pos[1] === s.sel[1];
      const next = { ...s, sel: a.pos };
      return same && p.wordAt[a.pos[0]][a.pos[1]][other(s.dir)] ? { ...next, dir: other(s.dir) } : fixDir(p, next);
    }
    case 'toggleDir':
      return p.wordAt[s.sel[0]][s.sel[1]][other(s.dir)] ? { ...s, dir: other(s.dir) } : s;
    case 'jump':
      return { ...s, dir: a.word.dir, sel: firstEmpty(a.word, s.letters) };
    case 'type': {
      const letters = setLetter(s, s.sel, a.ch);
      return { ...s, letters, sel: step(p, s, 1) };
    }
    case 'backspace': {
      if (s.letters[s.sel[0]][s.sel[1]]) return { ...s, letters: setLetter(s, s.sel, '') };
      const prev = step(p, s, -1);
      return { ...s, sel: prev, letters: setLetter(s, prev, '') };
    }
    case 'arrow': {
      const [dr, dc] = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[a.key];
      const axis: Dir = dr === 0 ? 'across' : 'down';
      // First press only turns to face that axis; the next press moves.
      if (s.dir !== axis) return fixDir(p, { ...s, dir: axis });
      let r = s.sel[0] + dr, c = s.sel[1] + dc;
      while (r >= 0 && c >= 0 && r < p.size && c < p.size) {
        if (p.playable[r][c]) return fixDir(p, { ...s, sel: [r, c] });
        r += dr; c += dc;
      }
      return s;
    }
    case 'nextClue': {
      const list = [...p.words.across, ...p.words.down];
      const cur = p.wordAt[s.sel[0]][s.sel[1]][s.dir];
      const i = (list.indexOf(cur as Word) + (a.back ? -1 : 1) + list.length) % list.length;
      return { ...s, dir: list[i].dir, sel: firstEmpty(list[i], s.letters) };
    }
  }
}
