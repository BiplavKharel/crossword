import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { currentStreak, dayString, loadStats, playedToday, recordResult, resetStats } from './stats';
import { stubLocalStorage } from './testing';

const store = stubLocalStorage();
const daysAgo = (n: number) => dayString(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
const seed = (over: object) => store.set('crossword.stats.u', JSON.stringify({ played: 5, wins: 5, streak: 3, bestTime: 90, lastPlayed: daysAgo(1), ...over }));
beforeEach(() => store.clear());

test('a first win starts a streak and sets best time', () => {
  const s = recordResult('u', true, 75);
  assert.deepEqual([s.played, s.wins, s.streak, s.bestTime], [1, 1, 1, 75]);
  assert.equal(playedToday(s), true);
});

test('winning the day after extends the streak; best time only improves', () => {
  seed({});
  const s = recordResult('u', true, 120);
  assert.equal(s.streak, 4);
  assert.equal(s.bestTime, 90);
  seed({});
  assert.equal(recordResult('u', true, 60).bestTime, 60);
});

test('a loss resets the streak and keeps best time', () => {
  seed({});
  const s = recordResult('u', false, 200);
  assert.deepEqual([s.streak, s.wins, s.played, s.bestTime], [0, 5, 6, 90]);
});

test('a missed day breaks the streak, and a win then starts again at 1', () => {
  seed({ lastPlayed: daysAgo(2) });
  assert.equal(currentStreak(loadStats('u')), 0);
  assert.equal(recordResult('u', true, 100).streak, 1);
});

test('stats are per user and reset clears them', () => {
  recordResult('u', true, 50);
  assert.equal(loadStats('other').played, 0);
  resetStats('u');
  assert.equal(loadStats('u').played, 0);
});
