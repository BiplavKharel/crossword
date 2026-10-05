import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, mock, test } from 'node:test';
import type { RawPuzzle } from '../src/types.js';
import { createApp, type AppOptions, type Verifier } from './app.js';
import { memoryStore, type Store } from './store.js';

const verify: Verifier = async t => {
  if (t !== 'google') throw new Error('bad');
  return { sub: 'u1', email: 'a@b.c', name: 'A', exp: 9e9 };
};

const grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 0 && c === 0 ? null : 'A')));
const puzzle: RawPuzzle = {
  date: '2026-01-01',
  size: [5, 5],
  grid,
  clues: { across: [{ num: 1, text: 'Clue', answer: 'AAAA' }], down: [{ num: 1, text: 'Clue', answer: 'AAAA' }] },
};
const solution: string[][] = grid.map(row => row.map(v => v ?? ''));
const wrong = solution.map(r => [...r]);
wrong[2][2] = 'B';

const closers: (() => void)[] = [];
afterEach(() => {
  mock.timers.reset();
  closers.splice(0).forEach(c => c());
});

function serve(opts: Partial<AppOptions> = {}) {
  const s = createApp(verify, { puzzles: [puzzle], ...opts }).listen(0);
  closers.push(() => s.close());
  const base = `http://localhost:${(s.address() as AddressInfo).port}`;
  const call = (path: string, token?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call };
}

async function login(call: ReturnType<typeof serve>['call']) {
  const body = await (await call('/api/auth/google', undefined, { credential: 'google' })).json();
  return body as { user: { id: string; exp: number }; token: string };
}

// ---- sessions

test('login issues a session token that works like the Google one', async () => {
  const { call } = serve();
  const { user, token } = await login(call);
  assert.match(token!, /^cw_[\w-]{43}$/);
  assert.equal(user.id, 'u1');
  assert.equal((await call('/api/me', token)).status, 200);
  assert.equal((await call('/api/me', 'google')).status, 200); // Google tokens keep working during the migration
});

test('session lasts the configured time and the user object reports it', async () => {
  const { call } = serve({ sessionSeconds: 1000 });
  const { user } = await login(call);
  const left = user.exp - Date.now() / 1000;
  assert.ok(left > 990 && left <= 1000, `expected ~1000s, got ${left}`);
});

test('the store only ever sees a hash of the token', async () => {
  const seen: string[] = [];
  const base = memoryStore();
  const { call } = serve({ store: { ...base, putSession: async (h, c) => (seen.push(h), base.putSession(h, c)) } });
  const { token } = await login(call);
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], token);
  assert.equal(seen[0], createHash('sha256').update(token!).digest('hex'));
});

test('unknown, expired and revoked sessions are rejected', async () => {
  const { call } = serve();
  assert.equal((await call('/api/me', 'cw_forged')).status, 401);

  const expired = serve({ sessionSeconds: -10 });
  const old = await login(expired.call);
  assert.equal((await expired.call('/api/me', old.token)).status, 401);

  const { token } = await login(call);
  assert.equal((await call('/api/auth/logout', token, {})).status, 204);
  assert.equal((await call('/api/me', token)).status, 401);
});

test('a bad Google credential gets no session', async () => {
  const { call } = serve();
  assert.equal((await call('/api/auth/google', undefined, { credential: 'forged' })).status, 401);
  assert.equal((await call('/api/auth/google', undefined, {})).status, 400);
});

test('sign-in still works when the session store is down', async () => {
  const down = async () => { throw new Error('ddb down'); };
  const { call } = serve({ store: { ...memoryStore(), putSession: down } });
  const res = await call('/api/auth/google', undefined, { credential: 'google' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.id, 'u1');
  assert.equal(body.token, undefined);
});

test('a session lookup outage is a 503, not a sign-out', async () => {
  const { call } = serve({ store: { ...memoryStore(), getSession: async () => { throw new Error('ddb down'); } } });
  assert.equal((await call('/api/me', 'cw_anything')).status, 503);
});

// ---- stats

const DAY = '2023-11-14'; // 1_700_000_000_000 ms is 22:13 UTC on this day
const T0 = 1_700_000_000_000;

async function playAndSolve(call: ReturnType<typeof serve>['call'], token: string, solveAfterMs = 0) {
  await call('/api/puzzles/random', token);
  if (solveAfterMs) mock.timers.tick(solveAfterMs);
  return (await (await call('/api/puzzles/2026-01-01/verify', token, { letters: solution })).json()) as { solved: boolean };
}

test('stats start empty and need a signed-in user', async () => {
  const { call } = serve();
  assert.equal((await call('/api/stats')).status, 401);
  const { token } = await login(call);
  assert.deepEqual((await (await call('/api/stats', token)).json()).stats, { played: 0, wins: 0, streak: 0, bestTime: null, lastPlayed: null });
});

test('a verified win is recorded and survives across sessions', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  assert.equal((await playAndSolve(call, token)).solved, true);
  const res = await call('/api/stats/result', token, { won: true, seconds: 42, day: DAY });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).stats, { played: 1, wins: 1, streak: 1, bestTime: 42, lastPlayed: DAY });

  const second = await login(call); // a new sign-in (another device) sees the same stats
  assert.equal((await (await call('/api/stats', second.token)).json()).stats.wins, 1);
});

test('a win cannot be reported without a verified solve, or twice', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  assert.equal((await call('/api/stats/result', token, { won: true, seconds: 5, day: DAY })).status, 409);

  await call('/api/puzzles/random', token);
  await call('/api/puzzles/2026-01-01/verify', token, { letters: wrong }); // a wrong grid is not a solve
  assert.equal((await call('/api/stats/result', token, { won: true, seconds: 5, day: DAY })).status, 409);

  await playAndSolve(call, token);
  assert.equal((await call('/api/stats/result', token, { won: true, seconds: 5, day: DAY })).status, 200);
  assert.equal((await call('/api/stats/result', token, { won: true, seconds: 5, day: DAY })).status, 409);
  assert.equal((await (await call('/api/stats', token)).json()).stats.wins, 1);
});

test('a forged fast time is raised to what the server clock allows', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  await playAndSolve(call, token, 100_000); // the puzzle took 100s by the server's clock
  const { stats } = await (await call('/api/stats/result', token, { won: true, seconds: 1, day: DAY })).json();
  assert.equal(stats.bestTime, 85); // 100s minus the 15s countdown allowance, not the claimed 1s
});

test('a claimed win expires if it is not reported in time', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  await playAndSolve(call, token);
  mock.timers.tick(11 * 60 * 1000);
  assert.equal((await call('/api/stats/result', token, { won: true, seconds: 30, day: DAY })).status, 409);
});

test('losses reset the streak and leave the best time alone', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  await playAndSolve(call, token);
  await call('/api/stats/result', token, { won: true, seconds: 60, day: DAY });
  const lost = await (await call('/api/stats/result', token, { won: false, seconds: 0, day: DAY })).json();
  assert.deepEqual(lost.stats, { played: 2, wins: 1, streak: 0, bestTime: 60, lastPlayed: DAY });
});

test('streaks continue on consecutive days and break after a gap', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const { call } = serve();
  const { token } = await login(call);
  const win = async (day: string) => {
    await playAndSolve(call, token);
    return (await (await call('/api/stats/result', token, { won: true, seconds: 30, day })).json()).stats;
  };
  assert.equal((await win('2023-11-13')).streak, 1);
  assert.equal((await win('2023-11-14')).streak, 2);
  // Day 2023-11-14 is also today in UTC, so skipping a day means reporting the 16th from a UTC+14 player.
  mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal((await win('2023-11-16')).streak, 1);
});

test('result input is validated', async () => {
  const { call } = serve();
  const { token } = await login(call);
  const bad = (body: object) => call('/api/stats/result', token, body).then(r => r.status);
  assert.equal(await bad({ won: 'yes', seconds: 1, day: DAY }), 400);
  assert.equal(await bad({ won: false, seconds: -1, day: DAY }), 400);
  assert.equal(await bad({ won: false, seconds: 'x', day: DAY }), 400);
  assert.equal(await bad({ won: false, seconds: 1e9, day: DAY }), 400);
  assert.equal(await bad({ won: false, seconds: 1, day: '2023-13-01' }), 400);
  assert.equal(await bad({ won: false, seconds: 1, day: 'yesterday' }), 400);
  assert.equal(await bad({ won: false, seconds: 1 }), 400);
  assert.equal(await bad({ won: false, seconds: 1, day: '1999-01-01' }), 400); // nowhere near today
});

test('a stats outage is a 503 and does not break verify', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  const down = async () => { throw new Error('ddb down'); };
  const store: Store = { ...memoryStore(), getStats: down, updateStats: down, getPlay: down, putPlay: down };
  const { call } = serve({ store });
  const { token } = await login(call);
  assert.equal((await call('/api/stats', token)).status, 503);
  assert.equal((await call('/api/stats/result', token, { won: false, seconds: 0, day: DAY })).status, 503);
  assert.equal((await call('/api/puzzles/random', token)).status, 200);
  assert.equal(((await (await call('/api/puzzles/2026-01-01/verify', token, { letters: solution })).json()) as { solved: boolean }).solved, true);
});

// ---- history

const record = (n: number) => ({
  matchId: `m${n}`, at: 1_700_000_000_000 + n * 1000, opponent: 'Maya', vsBot: true, won: n % 2 === 0, reason: 'solved' as const, seconds: 30 + n, puzzleDate: '2026-01-01',
});

test('history needs a signed-in user and starts empty', async () => {
  const { call } = serve();
  assert.equal((await call('/api/history')).status, 401);
  const { token } = await login(call);
  assert.deepEqual(await (await call('/api/history', token)).json(), { matches: [] });
});

test('history returns only your own matches, newest first, in pages', async () => {
  const store = memoryStore();
  for (let n = 1; n <= 5; n++) await store.putMatch('u1', record(n));
  await store.putMatch('someone-else', record(9));
  const { call } = serve({ store });
  const { token } = await login(call);

  const first = await (await call('/api/history?limit=2', token)).json();
  assert.deepEqual(first.matches.map((m: { matchId: string }) => m.matchId), ['m5', 'm4']);
  assert.ok(first.next);
  const second = await (await call(`/api/history?limit=2&before=${encodeURIComponent(first.next)}`, token)).json();
  assert.deepEqual(second.matches.map((m: { matchId: string }) => m.matchId), ['m3', 'm2']);
  const last = await (await call(`/api/history?limit=2&before=${encodeURIComponent(second.next)}`, token)).json();
  assert.deepEqual(last.matches.map((m: { matchId: string }) => m.matchId), ['m1']);
  assert.equal(last.next, undefined);
  assert.equal((await (await call('/api/history', token)).json()).matches.length, 5); // default page holds them all
});

test('history rejects bad paging parameters', async () => {
  const { call } = serve();
  const { token } = await login(call);
  for (const q of ['limit=0', 'limit=51', 'limit=abc', 'limit=1.5', 'before=nonsense', 'before=MATCH%23x', 'before=MATCH%23123%23a&before=b']) {
    assert.equal((await call(`/api/history?${q}`, token)).status, 400, q);
  }
});

test('a history outage is a 503', async () => {
  const { call } = serve({ store: { ...memoryStore(), listMatches: async () => { throw new Error('ddb down'); } } });
  const { token } = await login(call);
  assert.equal((await call('/api/history', token)).status, 503);
});
