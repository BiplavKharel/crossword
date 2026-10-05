import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import type { RawPuzzle } from '../src/types.js';
import type { ClientMsg, ServerMsg } from '../src/matchProtocol.js';
import { authenticator, createApp, type Verifier } from './app.js';
import { MatchManager } from './match.js';
import { memoryStore } from './store.js';
import { attachWebSocket } from './ws.js';
import type { WebSocketServer } from 'ws';

// Real sockets against a real HTTP server: covers the framing, auth and limits that match.test.ts skips.
const verify: Verifier = async t => {
  if (t === 'tok-a' || t === 'tok-b') return { sub: t, email: `${t}@x.y`, name: t.toUpperCase(), exp: 9e9 };
  throw new Error('bad');
};

const grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 0 && c === 0 ? null : 'A')));
const puzzle: RawPuzzle = {
  date: '2026-01-01',
  size: [5, 5],
  grid,
  clues: { across: [{ num: 1, text: 'Clue', answer: 'AAAA' }], down: [{ num: 1, text: 'Clue', answer: 'AAAA' }] },
};
const solution = grid.map(row => row.map(v => v ?? ''));
const today = new Date().toISOString().slice(0, 10);

let server: Server;
let url = '';
let manager: MatchManager;
let wss: WebSocketServer;

before(async () => {
  const store = memoryStore();
  manager = new MatchManager({ puzzles: [puzzle], store, countdownMs: 50, queueBotMs: 150 });
  server = createApp(verify, { puzzles: [puzzle], store }).listen(0);
  wss = attachWebSocket(server, manager, authenticator(verify, store), {
    allowedOrigins: 'https://good.example',
    authTimeoutMs: 300,
    maxMessagesPerSecond: 20,
  });
  url = `ws://localhost:${(server.address() as AddressInfo).port}/ws`;
});
after(() => {
  manager.close();
  for (const c of wss.clients) c.terminate();
  server.closeAllConnections();
  server.close();
});

class Client {
  msgs: ServerMsg[] = [];
  closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];
  constructor(public ws: WebSocket) {
    ws.on('message', d => { this.msgs.push(JSON.parse(d.toString())); this.waiters.splice(0).forEach(w => w()); });
    this.closed = new Promise(res => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
  }
  send(m: ClientMsg | object) { this.ws.send(JSON.stringify(m)); }
  /** Resolves with the first message of `type` seen so far or arriving within `ms`. */
  async next<T extends ServerMsg['type']>(type: T, ms = 2000): Promise<Extract<ServerMsg, { type: T }>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.msgs.find(m => m.type === type);
      if (hit) return hit as Extract<ServerMsg, { type: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no ${type} within ${ms}ms; got ${JSON.stringify(this.msgs)}`);
      await new Promise<void>(r => { this.waiters.push(r); setTimeout(r, left); });
    }
  }
}

const open = async (headers: Record<string, string> = {}) => {
  const ws = new WebSocket(url, { headers });
  const c = new Client(ws);
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  return c;
};
const login = async (token: string) => {
  const c = await open();
  c.send({ type: 'auth', token });
  await c.next('authed');
  return c;
};

test('a valid token authenticates', async () => {
  const c = await login('tok-a');
  c.ws.close();
});

test('a bad token gets an unauthorized error and is disconnected', async () => {
  const c = await open();
  c.send({ type: 'auth', token: 'forged' });
  assert.deepEqual(await c.next('error'), { type: 'error', message: 'unauthorized', unauthorized: true });
  assert.equal((await c.closed).code, 4001);
});

test('anything before auth is refused', async () => {
  const c = await open();
  c.send({ type: 'join', day: today });
  assert.equal((await c.closed).code, 4001);
});

test('a silent socket is cut off when the auth window passes', async () => {
  const c = await open();
  assert.equal((await c.closed).code, 4001);
});

test('a browser from another origin is refused', async () => {
  const c = await open({ origin: 'https://evil.example' });
  assert.equal((await c.closed).code, 1008);
  const ok = await open({ origin: 'https://good.example' });
  ok.send({ type: 'auth', token: 'tok-a' });
  await ok.next('authed');
  ok.ws.close();
});

test('garbage and oversized frames close the socket', async () => {
  const bad = await open();
  bad.ws.send('not json');
  assert.equal((await bad.closed).code, 1003);

  const big = await open();
  big.ws.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(20_000) }));
  assert.equal((await big.closed).code, 1009);
});

test('flooding a socket gets it disconnected', async () => {
  const c = await login('tok-a');
  for (let i = 0; i < 40; i++) c.send({ type: 'leave' });
  assert.equal((await c.closed).code, 1008);
});

test('two players are matched, play, and the first correct grid wins', async () => {
  const a = await login('tok-a');
  const b = await login('tok-b');
  a.send({ type: 'join', day: today });
  b.send({ type: 'join', day: today });

  const ma = (await a.next('matched')).match;
  const mb = (await b.next('matched')).match;
  assert.equal(ma.matchId, mb.matchId);
  assert.deepEqual([ma.opponent.name, mb.opponent.name], ['TOK-B', 'TOK-A']);

  a.send({ type: 'progress', filled: Array.from({ length: 5 }, () => Array(5).fill(true)) });
  assert.equal((await b.next('opponent-progress')).filled[2][2], true);

  await new Promise(r => setTimeout(r, 80)); // wait out the countdown
  a.send({ type: 'submit', reqId: 7, letters: solution });
  assert.deepEqual(await a.next('submit-result'), { type: 'submit-result', reqId: 7, solved: true });
  assert.equal((await a.next('result')).result.winner, 'me');
  assert.equal((await b.next('result')).result.winner, 'opponent');
  a.ws.close();
  b.ws.close();
});

test('a lone player is given a bot after the queue wait', async () => {
  const a = await login('tok-a');
  a.send({ type: 'join', day: today });
  const { match } = await a.next('matched', 3000);
  assert.ok(match.opponent.name.length > 0);
  a.send({ type: 'forfeit' }); // leave cleanly, or the dropped connection would hold a grace period open
  await a.next('result');
  a.ws.close();
});

test('closing the socket mid-match tells the opponent', async () => {
  const a = await login('tok-a');
  const b = await login('tok-b');
  a.send({ type: 'join', day: today });
  b.send({ type: 'join', day: today });
  await a.next('matched');
  await b.next('matched');
  a.ws.close();
  assert.equal((await b.next('opponent-disconnected')).graceSeconds, 30);
  b.send({ type: 'forfeit' });
  await b.next('result');
  b.ws.close();
});
