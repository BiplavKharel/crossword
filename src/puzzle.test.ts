import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allFilled, buildPuzzle, emptyLetters, playableCount, wordFilled } from './puzzle';
import { apiPuzzle } from './testing';

test('numbers an open 5x5 like a real crossword', () => {
  const p = buildPuzzle(apiPuzzle());
  assert.deepEqual(p.numbers[0], [1, 2, 3, 4, 5]);
  assert.deepEqual([1, 2, 3, 4].map(r => p.numbers[r][0]), [6, 7, 8, 9]);
  assert.equal(p.words.across.length, 5);
  assert.equal(p.words.down.length, 5);
  assert.equal(p.words.across[0].cells.length, 5);
  assert.equal(p.words.across[0].text, 'Clue 1');
});

test('black squares split words and are not playable', () => {
  const p = buildPuzzle(apiPuzzle([[0, 0], [0, 4]]));
  assert.equal(playableCount(p), 23);
  assert.equal(p.numbers[0][0], 0);
  assert.equal(p.wordAt[0][0].across, undefined);
  assert.equal(p.words.across[0].cells.length, 3); // top row is now 3 wide
});

test('allFilled ignores black squares and wordFilled checks one word', () => {
  const p = buildPuzzle(apiPuzzle([[0, 0]]));
  const letters = emptyLetters(5);
  assert.equal(allFilled(p, letters), false);
  p.playable.forEach((row, r) => row.forEach((open, c) => { if (open) letters[r][c] = 'A'; }));
  assert.equal(allFilled(p, letters), true);
  assert.equal(wordFilled(p.words.across[0], letters), true);
  letters[0][2] = '';
  assert.equal(wordFilled(p.words.across[0], letters), false);
});
