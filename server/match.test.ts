import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { RawPuzzle } from '../src/types.js';
import type { ServerMsg } from '../src/matchProtocol.js';
import type { Claims } from './app.js';
import { MatchManager, parseClientMsg, type Conn, type Session } from './match.js';
import { memoryStore, type Store } from './store.js';

const T0 = 1_700_000_000_000; // 2023-11-14 22:13 UTC
const DAY = '2023-11-14';

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
const mask = (on: boolean, upTo = 25) => Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => on && r * 5 + c < upTo));

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed?: { code?: number; reason?: string };
  send(m: ServerMsg) { this.msgs.push(m); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  of<T extends ServerMsg['type']>(type: T) { return this.msgs.filter((m): m is Extract<ServerMsg, { type: T }> => m.type === type); }
}

const claims = (sub: string): Claims => ({ sub, email: `${sub}@x.y`, name: sub.toUpperCase(), exp: 9e9 });
const flush = () => new Promise<void>(r => setImmediate(r)); // real setImmediate: only setTimeout and Date are mocked

let manager: MatchManager;
let store: Store;

function setup(opts: Partial<ConstructorParameters<typeof MatchManager>[0]> = {}) {
  store = opts.store ?? memoryStore();
  manager = new MatchManager({ puzzles: [puzzle], random: () => 0.5, ...opts, store });
}

function player(sub: string): { conn: FakeConn; s: Session } {
  const conn = new FakeConn();
  return { conn, s: manager.attach(conn, claims(sub)) };
}

const join = (p: { s: Session }) => p.s.handle({ type: 'join', day: DAY });
const submit = (p: { s: Session }, letters: string[][], reqId = 1) => p.s.handle({ type: 'submit', reqId, letters });
const startPlaying = () => mock.timers.tick(8000);
/** Moves the clock in small steps so timers that re-arm themselves (the bot) fire as they would for real. */
const advance = (ms: number, step = 100) => { for (let t = 0; t < ms; t += step) mock.timers.tick(Math.min(step, ms - t)); };

/** Two players paired and past the countdown. */
async function pairedMatch() {
  const a = player('a');
  const b = player('b');
  await join(a);
  await join(b);
  startPlaying();
  return { a, b, matchId: a.conn.of('matched')[0].match.matchId };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  setup();
});
afterEach(() => {
  manager.close();
  mock.timers.reset();
});

// ---- pairing

test('two waiting players are paired on the same puzzle', async () => {
  const a = player('a');
  const b = player('b');
  await join(a);
  assert.equal(a.conn.of('matched').length, 0);
  await join(b);

  const [ma] = a.conn.of('matched');
  const [mb] = b.conn.of('matched');
  assert.equal(ma.match.matchId, mb.match.matchId);
  assert.equal(ma.match.puzzle.id, mb.match.puzzle.id);
  assert.deepEqual([ma.match.opponent.name, mb.match.opponent.name], ['B', 'A']);
  assert.equal(ma.match.startsAt, T0 + 8000);
  assert.equal(ma.match.serverNow, T0);
  assert.ok(!JSON.stringify(ma).includes('answer'), 'the puzzle sent to players must not contain answers');
});

test('a lone player gets a bot after 30 seconds, not before', async () => {
  const a = player('a');
  await join(a);
  mock.timers.tick(29_999);
  assert.equal(a.conn.of('matched').length, 0);
  mock.timers.tick(1);
  const matched = a.conn.of('matched');
  assert.equal(matched.length, 1);
  assert.match(matched[0].match.opponent.name, /^(Maya|Jonas|Priya|Theo|Amara|Luca|Sana|Felix)$/);
  assert.equal(matched[0].match.startsAt, T0 + 30_000 + 8000);
});

test('leaving the queue cancels the bot, and a later joiner is not paired with a ghost', async () => {
  const a = player('a');
  await join(a);
  await a.s.handle({ type: 'leave' });
  mock.timers.tick(60_000);
  assert.equal(a.conn.of('matched').length, 0);

  const b = player('b');
  await join(b);
  assert.equal(b.conn.of('matched').length, 0);
});

test('reconnecting replaces the old connection and its queue spot', async () => {
  const a1 = player('a');
  await join(a1);
  const a2 = player('a');
  assert.deepEqual(a1.conn.closed?.code, 4000);

  const b = player('b');
  await join(b);
  assert.equal(b.conn.of('matched').length, 0); // the old queue entry is gone, so b waits
  await join(a2);
  assert.equal(a2.conn.of('matched').length, 1);
});

test('join checks the day and refuses a second match', async () => {
  const a = player('a');
  await a.s.handle({ type: 'join', day: '1999-01-01' });
  await a.s.handle({ type: 'join' });
  assert.equal(a.conn.of('error').length, 2);

  const { b } = await pairedMatch();
  await join(b);
  assert.match(b.conn.of('error').slice(-1)[0]!.message, /already in a match/);
});

test('malformed messages are answered with an error', async () => {
  const a = player('a');
  for (const bad of [null, 'x', 42, {}, { type: 'nope' }, { type: 'submit' }, { type: 'resume' }]) await a.s.handle(bad);
  assert.equal(a.conn.of('error').length, 7);
  assert.equal(parseClientMsg({ type: 'leave' })?.type, 'leave');
});

// ---- play

test('progress goes to the opponent only, and bad masks are ignored', async () => {
  const { a, b } = await pairedMatch();
  await a.s.handle({ type: 'progress', filled: mask(true, 7) });
  assert.deepEqual(b.conn.of('opponent-progress').slice(-1)[0]?.filled, mask(true, 7));
  assert.equal(a.conn.of('opponent-progress').length, 0);
  await a.s.handle({ type: 'progress', filled: [[true]] });
  await a.s.handle({ type: 'progress', filled: 'lots' });
  assert.equal(b.conn.of('opponent-progress').length, 1);
});

test('answers before the countdown ends are not accepted', async () => {
  const a = player('a');
  const b = player('b');
  await join(a);
  await join(b);
  await submit(a, solution);
  assert.deepEqual(a.conn.of('submit-result'), [{ type: 'submit-result', reqId: 1, solved: false }]);
  assert.equal(a.conn.of('result').length, 0);
});

test('the first correct answer wins, with server timing and stats for both players', async () => {
  const { a, b } = await pairedMatch();
  mock.timers.tick(42_400);
  await submit(a, solution);

  assert.deepEqual(a.conn.of('submit-result'), [{ type: 'submit-result', reqId: 1, solved: true }]);
  assert.deepEqual(a.conn.of('result'), [{ type: 'result', result: { winner: 'me', seconds: 42, reason: 'solved' } }]);
  assert.deepEqual(b.conn.of('result'), [{ type: 'result', result: { winner: 'opponent', seconds: 42, reason: 'solved' } }]);
  assert.deepEqual(await store.getStats('a'), { played: 1, wins: 1, streak: 1, bestTime: 42, lastPlayed: DAY });
  assert.deepEqual(await store.getStats('b'), { played: 1, wins: 0, streak: 0, bestTime: null, lastPlayed: DAY });
});

test('a wrong answer does not end the match, and wrong guesses are capped', async () => {
  setup({ maxWrongAttempts: 2 });
  const { a, b } = await pairedMatch();
  await submit(a, wrong, 1);
  await submit(a, wrong, 2);
  await submit(a, wrong, 3);
  assert.deepEqual(a.conn.of('submit-result').map(m => [m.solved, m.limited]), [[false, undefined], [false, undefined], [false, true]]);
  assert.equal(a.conn.of('result').length, 0);

  await submit(b, solution); // the other player is unaffected
  assert.equal(b.conn.of('result')[0].result.winner, 'me');
});

test('two answers at once produce one winner and one result each', async () => {
  const { a, b } = await pairedMatch();
  mock.timers.tick(10_000);
  await Promise.all([submit(a, solution), submit(b, solution)]);
  assert.equal(a.conn.of('result').length, 1);
  assert.equal(b.conn.of('result').length, 1);
  assert.notEqual(a.conn.of('result')[0].result.winner, b.conn.of('result')[0].result.winner);
});

test('a failing stats store does not stop the result', async () => {
  const down = async () => { throw new Error('ddb down'); };
  setup({ store: { ...memoryStore(), updateStats: down } });
  const { a, b } = await pairedMatch();
  await submit(a, solution);
  assert.equal(a.conn.of('result').length, 1);
  assert.equal(b.conn.of('result').length, 1);
});

// ---- leaving

test('forfeiting loses the match, and the other player earns no best time', async () => {
  const { a, b } = await pairedMatch();
  mock.timers.tick(5000);
  await a.s.handle({ type: 'forfeit' });
  assert.deepEqual(b.conn.of('result'), [{ type: 'result', result: { winner: 'me', seconds: 5, reason: 'forfeit' } }]);
  assert.deepEqual(await store.getStats('b'), { played: 1, wins: 1, streak: 1, bestTime: null, lastPlayed: DAY });
  assert.equal((await store.getStats('a')).wins, 0);
});

test('a dropped connection forfeits only after the 30 second grace', async () => {
  const { a, b } = await pairedMatch();
  a.s.disconnect();
  assert.deepEqual(b.conn.of('opponent-disconnected'), [{ type: 'opponent-disconnected', graceSeconds: 30 }]);
  mock.timers.tick(29_999);
  await flush();
  assert.equal(b.conn.of('result').length, 0);
  mock.timers.tick(1);
  await flush();
  assert.equal(b.conn.of('result')[0].result.reason, 'forfeit');
  assert.equal(b.conn.of('result')[0].result.winner, 'me');
});

test('coming back within the grace keeps the match alive', async () => {
  const { a, b, matchId } = await pairedMatch();
  await a.s.handle({ type: 'progress', filled: mask(true, 4) });
  await b.s.handle({ type: 'progress', filled: mask(true, 9) });
  a.s.disconnect();
  mock.timers.tick(20_000);

  const a2 = player('a'); // a refreshed page: a new connection resumes the same match
  await a2.s.handle({ type: 'resume', matchId });
  assert.equal(a2.conn.of('resumed').length, 1);
  assert.deepEqual(a2.conn.of('opponent-progress').slice(-1)[0]?.filled, mask(true, 9));
  assert.equal(b.conn.of('opponent-reconnected').length, 1);

  mock.timers.tick(60_000);
  await flush();
  assert.equal(b.conn.of('result').length, 0);
  assert.equal(a2.conn.of('result').length, 0);
});

test('a replaced connection counts as a drop until the new one resumes', async () => {
  const { a, b, matchId } = await pairedMatch();
  const a2 = player('a'); // second tab
  assert.equal(a.conn.closed?.code, 4000);
  assert.equal(b.conn.of('opponent-disconnected').length, 1);
  await a2.s.handle({ type: 'resume', matchId });
  assert.equal(b.conn.of('opponent-reconnected').length, 1);
  a.s.disconnect(); // the old socket finally closing must not forfeit the new tab
  mock.timers.tick(60_000);
  await flush();
  assert.equal(b.conn.of('result').length, 0);
});

test('resuming a finished match returns its result; an unknown match is lost', async () => {
  const { a, matchId } = await pairedMatch();
  await a.s.handle({ type: 'forfeit' });
  a.s.disconnect();

  const a2 = player('a');
  await a2.s.handle({ type: 'resume', matchId });
  assert.equal(a2.conn.of('result')[0].result.winner, 'opponent');
  await a2.s.handle({ type: 'resume', matchId: 'nope' });
  assert.equal(a2.conn.of('match-lost').length, 1);

  mock.timers.tick(5 * 60_000 + 1); // finished matches are forgotten after five minutes
  await a2.s.handle({ type: 'resume', matchId });
  assert.equal(a2.conn.of('match-lost').length, 2);
});

test('someone who is not in a match cannot resume it', async () => {
  const { matchId } = await pairedMatch();
  const c = player('c');
  await c.s.handle({ type: 'resume', matchId });
  assert.equal(c.conn.of('match-lost').length, 1);
});

// ---- bot

async function botMatch(sub = 'a') {
  const a = player(sub);
  await join(a);
  // Separate ticks: the mock clock jumps to the end of a tick before running callbacks, which would skew the bot's timers.
  mock.timers.tick(30_000); // the bot fallback fires
  mock.timers.tick(8000); // the countdown
  return a;
}

test('the bot fills squares over time and wins if you are slower', async () => {
  const a = await botMatch();
  assert.equal(a.conn.of('opponent-progress').length, 0);
  mock.timers.tick(2200);
  assert.equal(a.conn.of('opponent-progress').slice(-1)[0]?.filled.flat().filter(Boolean).length, 1);

  advance(2200 * 23); // 24 open squares in total
  await flush();
  assert.deepEqual(a.conn.of('result')[0].result, { winner: 'opponent', seconds: 53, reason: 'solved' });
  assert.deepEqual(await store.getStats('a'), { played: 1, wins: 0, streak: 0, bestTime: null, lastPlayed: DAY });
});

test('you can beat the bot, and it stops playing', async () => {
  const a = await botMatch();
  mock.timers.tick(10_000);
  await submit(a, solution);
  assert.equal(a.conn.of('result')[0].result.winner, 'me');
  const seen = a.conn.of('opponent-progress').length;
  advance(120_000);
  await flush();
  assert.equal(a.conn.of('opponent-progress').length, seen);
  assert.equal(a.conn.of('result').length, 1);
  assert.equal((await store.getStats('a')).bestTime, 10);
});

test('the bot carries on while you are away, and you can come back to the result', async () => {
  const a = await botMatch();
  const matchId = a.conn.of('matched')[0].match.matchId;
  a.s.disconnect();
  advance(25_000);
  const a2 = player('a');
  await a2.s.handle({ type: 'resume', matchId });
  const progress = a2.conn.of('opponent-progress').slice(-1)[0]!.filled.flat().filter(Boolean).length;
  assert.ok(progress > 5, `the bot should have filled squares while we were away, got ${progress}`);
});

test('abandoning a bot match forfeits it after the grace', async () => {
  const a = await botMatch();
  a.s.disconnect();
  mock.timers.tick(30_000);
  await flush();
  assert.equal((await store.getStats('a')).played, 1);
  assert.equal((await store.getStats('a')).wins, 0);
});

// ---- history

test('a finished match is recorded for each human, from their own side', async () => {
  const { a, b, matchId } = await pairedMatch();
  mock.timers.tick(12_000);
  await submit(a, solution);
  const [ra] = (await store.listMatches('a', 10)).matches;
  const [rb] = (await store.listMatches('b', 10)).matches;
  assert.deepEqual(ra, { matchId, at: T0 + 8000 + 12_000, opponent: 'B', vsBot: false, won: true, reason: 'solved', seconds: 12, puzzleDate: '2026-01-01' });
  assert.deepEqual(rb, { ...ra, opponent: 'A', won: false });
  assert.equal(b.conn.of('result').length, 1);
});

test('forfeits and bot matches are recorded too', async () => {
  const { a } = await pairedMatch();
  await a.s.handle({ type: 'forfeit' });
  assert.deepEqual((await store.listMatches('a', 10)).matches.map(m => [m.won, m.reason, m.vsBot]), [[false, 'forfeit', false]]);
  assert.deepEqual((await store.listMatches('b', 10)).matches.map(m => [m.won, m.reason]), [[true, 'forfeit']]);

  const c = await botMatch('c');
  mock.timers.tick(5000);
  await submit(c, solution);
  const [rc] = (await store.listMatches('c', 10)).matches;
  assert.equal(rc.vsBot, true);
  assert.equal(rc.won, true);
  assert.match(rc.opponent, /^(Maya|Jonas|Priya|Theo|Amara|Luca|Sana|Felix)$/);
});

test('a player who plays twice has both matches, newest first', async () => {
  const { a } = await pairedMatch();
  await a.s.handle({ type: 'forfeit' });
  mock.timers.tick(1000);
  await join(a);
  await join(player('c'));
  mock.timers.tick(8000);
  await submit(a, solution);
  assert.deepEqual((await store.listMatches('a', 10)).matches.map(m => m.won), [true, false]);
});

test('a failing history store does not stop the result', async () => {
  const down = async () => { throw new Error('ddb down'); };
  setup({ store: { ...memoryStore(), putMatch: down } });
  const { a, b } = await pairedMatch();
  await submit(a, solution);
  assert.equal(a.conn.of('result').length, 1);
  assert.equal(b.conn.of('result').length, 1);
  assert.equal((await store.getStats('a')).wins, 1); // stats are still recorded
});
