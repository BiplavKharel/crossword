import { randomUUID } from 'node:crypto';
import type { RawPuzzle } from '../src/types.js';
import type { ClientMsg, ServerMsg, WireMatch } from '../src/matchProtocol.js';
import type { Claims } from './app.js';
import { isLetterGrid, isMask, judge, toPublic } from './puzzle.js';
import { applyResult, validDay } from './stats.js';
import type { Store } from './store.js';

/** One player's connection. The WebSocket glue (ws.ts) and the tests both implement this. */
export interface Conn {
  send(msg: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

export interface Session {
  /** `raw` is a parsed JSON value from the client; anything malformed is answered with an error. */
  handle(raw: unknown): Promise<void>;
  /** The connection went away. */
  disconnect(): void;
}

export interface MatchOptions {
  puzzles: RawPuzzle[];
  store: Store;
  maxWrongAttempts?: number;
  /** From pairing to the first keystroke. Includes the "opponent found" beat in the client. */
  countdownMs?: number;
  /** How long to wait for a human before playing a bot. */
  queueBotMs?: number;
  /** How long a disconnected player has to come back before they forfeit. */
  graceMs?: number;
  botTickMs?: number;
  /** How long a finished match stays resumable, so a refresh can still show its result. */
  keepFinishedMs?: number;
  random?: () => number;
}

const NAMES = ['Maya', 'Jonas', 'Priya', 'Theo', 'Amara', 'Luca', 'Sana', 'Felix'];
/** Chance the bot pauses on a tick, so it doesn't finish like clockwork. */
const BOT_STALL = 0.12;

interface Seat {
  sub: string;
  name: string;
  picture?: string;
  /** The player's local day, for streaks. */
  day: string;
  bot: boolean;
  conn?: Conn;
  filled: boolean[][];
  awayUntil?: number;
  awayTimer?: ReturnType<typeof setTimeout>;
}

interface Match {
  id: string;
  puzzle: RawPuzzle;
  startsAt: number;
  seats: [Seat, Seat];
  over: boolean;
  result?: { winner: Seat; seconds: number; reason: 'solved' | 'forfeit' };
  bot?: { seat: Seat; cells: [number, number][]; next: number; timer?: ReturnType<typeof setTimeout> };
  cleanup?: ReturnType<typeof setTimeout>;
}

interface SessionState {
  claims: Claims;
  conn: Conn;
  day: string;
  closed: boolean;
  queueTimer?: ReturnType<typeof setTimeout>;
}

const send = (conn: Conn | undefined, msg: ServerMsg) => {
  try {
    conn?.send(msg);
  } catch (err) {
    console.error('send failed', err); // a dying socket must not take the match down
  }
};

/** Shape-checks a client message; undefined if it isn't one we understand. */
export function parseClientMsg(raw: unknown): Exclude<ClientMsg, { type: 'auth' }> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'join': return typeof m.day === 'string' ? { type: 'join', day: m.day } : undefined;
    case 'leave': return { type: 'leave' };
    case 'forfeit': return { type: 'forfeit' };
    case 'progress': return Array.isArray(m.filled) ? { type: 'progress', filled: m.filled as boolean[][] } : undefined;
    case 'submit': return typeof m.reqId === 'number' && Array.isArray(m.letters) ? { type: 'submit', reqId: m.reqId, letters: m.letters as string[][] } : undefined;
    case 'resume': return typeof m.matchId === 'string' ? { type: 'resume', matchId: m.matchId } : undefined;
    default: return undefined;
  }
}

/**
 * Matchmaking and live matches. All state is in memory, so this assumes a single server task;
 * running two would need the queue and matches in a shared store.
 */
export class MatchManager {
  private sessions = new Map<string, SessionState>();
  private queue: SessionState[] = [];
  private matches = new Map<string, Match>();
  /** A player's latest match, running or recently finished. */
  private bySub = new Map<string, Match>();

  private playable: RawPuzzle[];
  private store: Store;
  private maxWrong: number;
  private countdownMs: number;
  private queueBotMs: number;
  private graceMs: number;
  private botTickMs: number;
  private keepFinishedMs: number;
  private random: () => number;

  constructor(o: MatchOptions) {
    this.playable = o.puzzles.filter(p => p.size[0] === 5 && p.size[1] === 5);
    this.store = o.store;
    this.maxWrong = o.maxWrongAttempts ?? 20;
    this.countdownMs = o.countdownMs ?? 8000;
    this.queueBotMs = o.queueBotMs ?? 30_000;
    this.graceMs = o.graceMs ?? 30_000;
    this.botTickMs = o.botTickMs ?? 2200;
    this.keepFinishedMs = o.keepFinishedMs ?? 5 * 60_000;
    this.random = o.random ?? Math.random;
  }

  /** Call once a connection has proved who it is. A newer connection for the same player replaces the old one. */
  attach(conn: Conn, claims: Claims): Session {
    const state: SessionState = { claims, conn, day: '', closed: false };
    const previous = this.sessions.get(claims.sub);
    if (previous) this.drop(previous, 'replaced by a newer connection');
    this.sessions.set(claims.sub, state);
    return { handle: raw => this.handle(state, raw), disconnect: () => this.drop(state) };
  }

  /** Stops every timer. For shutdown and tests. */
  close() {
    for (const s of this.queue) clearTimeout(s.queueTimer);
    for (const m of this.matches.values()) this.clearMatchTimers(m, true);
    this.queue = [];
    this.matches.clear();
    this.bySub.clear();
    this.sessions.clear();
  }

  // ---- connection lifecycle

  private drop(s: SessionState, closeReason?: string) {
    if (s.closed) return;
    s.closed = true;
    if (this.sessions.get(s.claims.sub) === s) this.sessions.delete(s.claims.sub);
    this.leaveQueue(s);
    const match = this.bySub.get(s.claims.sub);
    const seat = match && !match.over ? this.seatOf(match, s.claims.sub) : undefined;
    // Only the connection that currently owns the seat can take it away.
    if (match && seat && seat.conn === s.conn) {
      seat.conn = undefined;
      this.startGrace(match, seat);
    }
    if (closeReason) {
      try {
        s.conn.close(4000, closeReason);
      } catch {
        /* already gone */
      }
    }
  }

  private startGrace(match: Match, seat: Seat) {
    seat.awayUntil = Date.now() + this.graceMs;
    seat.awayTimer = setTimeout(() => void this.finish(match, this.opponentOf(match, seat), 'forfeit'), this.graceMs);
    send(this.opponentOf(match, seat).conn, { type: 'opponent-disconnected', graceSeconds: Math.ceil(this.graceMs / 1000) });
  }

  // ---- messages

  private async handle(s: SessionState, raw: unknown) {
    if (s.closed) return;
    const msg = parseClientMsg(raw);
    if (!msg) return send(s.conn, { type: 'error', message: 'unrecognised message' });
    switch (msg.type) {
      case 'join': return this.join(s, msg.day);
      case 'leave': return this.leaveQueue(s);
      case 'progress': return this.progress(s, msg.filled);
      case 'submit': return this.submit(s, msg.reqId, msg.letters);
      case 'forfeit': return this.forfeit(s);
      case 'resume': return this.resume(s, msg.matchId);
    }
  }

  private join(s: SessionState, day: string) {
    if (!validDay(day, Date.now())) return send(s.conn, { type: 'error', message: 'day must be a YYYY-MM-DD date' });
    const current = this.bySub.get(s.claims.sub);
    if (current && !current.over) return send(s.conn, { type: 'error', message: 'already in a match' });
    if (this.queue.includes(s)) return;
    s.day = day;
    if (!this.playable.length) return send(s.conn, { type: 'error', message: 'no puzzles available' });

    const other = this.queue.find(q => q.claims.sub !== s.claims.sub);
    if (other) {
      this.leaveQueue(other);
      return this.startMatch(other, s);
    }
    this.queue.push(s);
    // Nobody showed up: play a bot instead of leaving the player staring at a spinner.
    s.queueTimer = setTimeout(() => {
      this.leaveQueue(s);
      this.startMatch(s, undefined);
    }, this.queueBotMs);
  }

  private leaveQueue(s: SessionState) {
    clearTimeout(s.queueTimer);
    s.queueTimer = undefined;
    this.queue = this.queue.filter(q => q !== s);
  }

  private progress(s: SessionState, filled: unknown) {
    const match = this.bySub.get(s.claims.sub);
    if (!match || match.over) return;
    const seat = this.seatOf(match, s.claims.sub)!;
    if (!isMask(filled, match.puzzle.size[0])) return;
    seat.filled = filled;
    const opponent = this.opponentOf(match, seat);
    if (!opponent.bot) send(opponent.conn, { type: 'opponent-progress', filled });
  }

  private async submit(s: SessionState, reqId: number, letters: unknown) {
    const match = this.bySub.get(s.claims.sub);
    const reply = (solved: boolean, limited?: boolean) => send(s.conn, { type: 'submit-result', reqId, solved, ...(limited ? { limited } : {}) });
    // The server's clock decides when play starts; early submissions are just wrong.
    if (!match || match.over || Date.now() < match.startsAt) return reply(false);
    if (!isLetterGrid(letters, match.puzzle.size[0])) return reply(false);
    const seat = this.seatOf(match, s.claims.sub)!;

    const verdict = await judge(this.store, s.claims.sub, match.puzzle, letters, this.maxWrong);
    if (verdict === 'limited') return reply(false, true);
    reply(verdict === 'solved');
    if (verdict === 'solved') await this.finish(match, seat, 'solved');
  }

  private async forfeit(s: SessionState) {
    const match = this.bySub.get(s.claims.sub);
    if (!match || match.over) return;
    await this.finish(match, this.opponentOf(match, this.seatOf(match, s.claims.sub)!), 'forfeit');
  }

  /** Re-attach after a refresh or a dropped connection. */
  private resume(s: SessionState, matchId: string) {
    const match = this.matches.get(matchId);
    const seat = match && this.seatOf(match, s.claims.sub);
    if (!match || !seat) return send(s.conn, { type: 'match-lost' });

    seat.conn = s.conn;
    this.bySub.set(s.claims.sub, match);
    if (match.over) return this.sendResult(match, seat);

    const wasAway = seat.awayUntil !== undefined;
    clearTimeout(seat.awayTimer);
    seat.awayTimer = undefined;
    seat.awayUntil = undefined;
    send(s.conn, { type: 'resumed', serverNow: Date.now() });
    const opponent = this.opponentOf(match, seat);
    send(s.conn, { type: 'opponent-progress', filled: opponent.filled });
    if (opponent.awayUntil !== undefined) {
      send(s.conn, { type: 'opponent-disconnected', graceSeconds: Math.max(1, Math.ceil((opponent.awayUntil - Date.now()) / 1000)) });
    }
    if (wasAway) send(opponent.conn, { type: 'opponent-reconnected' });
  }

  // ---- matches

  private startMatch(a: SessionState, b: SessionState | undefined) {
    const puzzle = this.playable[Math.floor(this.random() * this.playable.length)];
    const n = puzzle.size[0];
    const empty = () => Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    const humanSeat = (s: SessionState): Seat => ({ sub: s.claims.sub, name: s.claims.name, picture: s.claims.picture, day: s.day, bot: false, conn: s.conn, filled: empty() });
    const botSeat = (): Seat => ({ sub: `bot:${randomUUID()}`, name: NAMES[Math.floor(this.random() * NAMES.length)], bot: true, day: '', filled: empty() });

    const seats: [Seat, Seat] = [humanSeat(a), b ? humanSeat(b) : botSeat()];
    const match: Match = { id: randomUUID(), puzzle, startsAt: Date.now() + this.countdownMs, seats, over: false };
    this.matches.set(match.id, match);
    for (const seat of seats) if (!seat.bot) this.bySub.set(seat.sub, match);

    if (!b) {
      const cells = puzzle.grid.flatMap((row, r) => row.flatMap((v, c) => (v ? [[r, c] as [number, number]] : [])));
      match.bot = { seat: seats[1], cells, next: 0 };
      match.bot.timer = setTimeout(() => this.botTick(match), match.startsAt - Date.now() + this.botTickMs);
    }
    for (const seat of seats) if (!seat.bot) send(seat.conn, { type: 'matched', match: this.wire(match, seat) });
  }

  private wire(match: Match, seat: Seat): WireMatch {
    const opponent = this.opponentOf(match, seat);
    return {
      matchId: match.id,
      opponent: { name: opponent.name, picture: opponent.picture },
      puzzle: toPublic(match.puzzle),
      startsAt: match.startsAt,
      serverNow: Date.now(),
    };
  }

  private botTick(match: Match) {
    const bot = match.bot;
    if (match.over || !bot) return;
    if (this.random() >= BOT_STALL) {
      bot.next++;
      const n = match.puzzle.size[0];
      const mask = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
      for (const [r, c] of bot.cells.slice(0, bot.next)) mask[r][c] = true;
      bot.seat.filled = mask;
      send(this.opponentOf(match, bot.seat).conn, { type: 'opponent-progress', filled: mask });
    }
    if (bot.next >= bot.cells.length) return void this.finish(match, bot.seat, 'solved');
    bot.timer = setTimeout(() => this.botTick(match), this.botTickMs);
  }

  /** Ends a match once: records stats for the humans, then tells whoever is still connected. */
  private async finish(match: Match, winner: Seat, reason: 'solved' | 'forfeit') {
    if (match.over) return;
    match.over = true;
    this.clearMatchTimers(match);
    const seconds = Math.max(0, Math.round((Date.now() - match.startsAt) / 1000));
    match.result = { winner, seconds, reason };

    // A win by forfeit earns no time, so quitting early can't set a record.
    await Promise.all(
      match.seats.filter(seat => !seat.bot).map(seat =>
        this.store
          .updateStats(seat.sub, s => applyResult(s, seat === winner, seat === winner && reason === 'solved' ? seconds : null, seat.day))
          .catch(err => console.error('stats write failed', err)),
      ),
    );
    for (const seat of match.seats) if (!seat.bot) this.sendResult(match, seat);

    match.cleanup = setTimeout(() => {
      this.matches.delete(match.id);
      for (const seat of match.seats) if (this.bySub.get(seat.sub) === match) this.bySub.delete(seat.sub);
    }, this.keepFinishedMs);
  }

  private sendResult(match: Match, seat: Seat) {
    const r = match.result;
    if (r) send(seat.conn, { type: 'result', result: { winner: r.winner === seat ? 'me' : 'opponent', seconds: r.seconds, reason: r.reason } });
  }

  private clearMatchTimers(match: Match, includeCleanup = false) {
    clearTimeout(match.bot?.timer);
    for (const seat of match.seats) {
      clearTimeout(seat.awayTimer);
      seat.awayTimer = undefined;
    }
    if (includeCleanup) clearTimeout(match.cleanup);
  }

  private seatOf(match: Match, sub: string) {
    return match.seats.find(s => !s.bot && s.sub === sub);
  }

  private opponentOf(match: Match, seat: Seat) {
    return match.seats[0] === seat ? match.seats[1] : match.seats[0];
  }
}
