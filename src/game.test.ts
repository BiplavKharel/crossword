import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initGame, reduce, type Action, type GameState } from './game';
import { buildPuzzle } from './puzzle';
import { apiPuzzle } from './testing';

const p = buildPuzzle(apiPuzzle());
const run = (s: GameState, ...actions: Action[]) => actions.reduce((st, a) => reduce(p, st, a), s);
const start = () => initGame(p);

test('starts on the first open square, across', () => {
  const s = start();
  assert.deepEqual(s.sel, [0, 0]);
  assert.equal(s.dir, 'across');
});

test('typing fills the square and advances within the word, stopping at its end', () => {
  let s = run(start(), { type: 'type', ch: 'A' }, { type: 'type', ch: 'B' });
  assert.equal(s.letters[0][0], 'A');
  assert.equal(s.letters[0][1], 'B');
  assert.deepEqual(s.sel, [0, 2]);
  s = run(s, ...['C', 'D', 'E', 'F'].map(ch => ({ type: 'type', ch }) as Action));
  assert.deepEqual(s.sel, [0, 4]); // stays on the last square
  assert.equal(s.letters[0][4], 'F'); // overwrites it
});

test('backspace clears in place when filled, otherwise steps back and clears', () => {
  let s = run(start(), { type: 'type', ch: 'A' }, { type: 'type', ch: 'B' });
  s = run(s, { type: 'backspace' }); // (0,2) is empty -> back to (0,1), clear it
  assert.deepEqual(s.sel, [0, 1]);
  assert.equal(s.letters[0][1], '');
  s = run(s, { type: 'type', ch: 'X' }, { type: 'backspace' }); // now on empty (0,2)... step back to X and clear
  assert.equal(s.letters[0][1], '');
});

test('first arrow press only turns, the next one moves', () => {
  let s = run(start(), { type: 'arrow', key: 'ArrowDown' });
  assert.equal(s.dir, 'down');
  assert.deepEqual(s.sel, [0, 0]);
  s = run(s, { type: 'arrow', key: 'ArrowDown' });
  assert.deepEqual(s.sel, [1, 0]);
});

test('clicking the selected square toggles direction; another square just selects', () => {
  let s = run(start(), { type: 'select', pos: [0, 0] });
  assert.equal(s.dir, 'down');
  s = run(s, { type: 'select', pos: [2, 3] });
  assert.deepEqual(s.sel, [2, 3]);
  assert.equal(s.dir, 'down');
});

test('nextClue walks across then down and wraps', () => {
  let s = start();
  s = run(s, { type: 'nextClue', back: false });
  assert.deepEqual([s.dir, s.sel], ['across', [1, 0]]);
  for (let i = 0; i < 9; i++) s = run(s, { type: 'nextClue', back: false });
  assert.equal(s.dir, 'across'); // wrapped past 10 clues, back at the first
  assert.deepEqual(s.sel, [0, 0]);
  assert.equal(run(start(), { type: 'nextClue', back: true }).dir, 'down');
});

test('jump lands on the first empty square of the word', () => {
  const s = run(start(), { type: 'type', ch: 'A' }, { type: 'type', ch: 'B' }, { type: 'jump', word: p.words.across[0] });
  assert.deepEqual(s.sel, [0, 2]);
});
