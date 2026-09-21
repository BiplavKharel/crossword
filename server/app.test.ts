import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { RawPuzzle } from '../src/types.js';
import { createApp, type Verifier } from './app.js';

const verify: Verifier = async t => {
  if (t !== 'good') throw new Error('bad');
  return { sub: '1', email: 'a@b.c', name: 'A', exp: 9e9 };
};

// 5x5 with a black square at the top-left; every other square is "A".
const grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 0 && c === 0 ? null : 'A')));
const puzzle: RawPuzzle = {
  date: '2026-01-01',
  size: [5, 5],
  grid,
  clues: { across: [{ num: 1, text: 'Clue', answer: 'AAAA' }], down: [{ num: 1, text: 'Clue', answer: 'AAAA' }] },
};
const solution: string[][] = grid.map(row => row.map(v => v ?? ''));

let base = '';
let close: () => void;
let closeStrict: () => void;
let baseGuest = '';
before(() => {
  const s = createApp(verify, { puzzles: [puzzle, { ...puzzle, date: 'big', size: [7, 7] }] }).listen(0);
  base = `http://localhost:${(s.address() as AddressInfo).port}`;
  close = () => s.close();
  const g = createApp(verify, { puzzles: [puzzle], allowGuest: true }).listen(0);
  baseGuest = `http://localhost:${(g.address() as AddressInfo).port}`;
  closeStrict = () => g.close();
});
after(() => { close(); closeStrict(); });

const authed = { authorization: 'Bearer good', 'content-type': 'application/json' };
const post = (path: string, body: unknown, headers: Record<string, string> = authed, b = base) =>
  fetch(`${b}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('valid credential returns the verified user', async () => {
  const res = await post('/api/auth/google', { credential: 'good' }, { 'content-type': 'application/json' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, 'a@b.c');
});
test('invalid or missing credential is rejected', async () => {
  assert.equal((await post('/api/auth/google', { credential: 'forged' }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('/api/auth/google', {}, { 'content-type': 'application/json' })).status, 400);
});
test('/api/me needs a valid bearer token', async () => {
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer forged' } })).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: authed })).status, 200);
});

test('puzzle endpoint requires auth and never leaks letters', async () => {
  assert.equal((await fetch(`${base}/api/puzzles/random`)).status, 401);
  const res = await fetch(`${base}/api/puzzles/random`, { headers: authed });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.size, 5); // the 7x7 is filtered out
  assert.equal(body.mask[0][0], false);
  assert.equal(body.mask[1][1], true);
  assert.ok(!JSON.stringify(body).includes('answer'), 'response must not contain answers');
  assert.ok(!('grid' in body));
});

test('verify: correct grid is solved, lowercase is accepted', async () => {
  assert.deepEqual(await (await post('/api/puzzles/2026-01-01/verify', { letters: solution })).json(), { solved: true });
  const lower = solution.map(r => r.map(c => c.toLowerCase()));
  assert.deepEqual(await (await post('/api/puzzles/2026-01-01/verify', { letters: lower })).json(), { solved: true });
});
test('verify: wrong or incomplete grid is not solved', async () => {
  const wrong = solution.map(r => [...r]);
  wrong[2][2] = 'B';
  assert.deepEqual(await (await post('/api/puzzles/2026-01-01/verify', { letters: wrong })).json(), { solved: false });
  const blank = solution.map(r => [...r]);
  blank[4][4] = '';
  assert.deepEqual(await (await post('/api/puzzles/2026-01-01/verify', { letters: blank })).json(), { solved: false });
});
test('verify: rejects unauthenticated, unknown puzzle and malformed bodies', async () => {
  assert.equal((await post('/api/puzzles/2026-01-01/verify', { letters: solution }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('/api/puzzles/nope/verify', { letters: solution })).status, 404);
  assert.equal((await post('/api/puzzles/big/verify', { letters: solution })).status, 404); // filtered out
  assert.equal((await post('/api/puzzles/2026-01-01/verify', { letters: [['A']] })).status, 400);
  assert.equal((await post('/api/puzzles/2026-01-01/verify', { letters: solution.map(r => r.map(() => 'AB')) })).status, 400);
  assert.equal((await post('/api/puzzles/2026-01-01/verify', {})).status, 400);
});

test('guest token only works when explicitly allowed', async () => {
  const guest = { authorization: 'Bearer guest' };
  assert.equal((await fetch(`${base}/api/me`, { headers: guest })).status, 401);
  assert.equal((await fetch(`${baseGuest}/api/me`, { headers: guest })).status, 200);
});
