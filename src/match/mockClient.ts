import type { User } from '../auth';
import { fetchRandomPuzzle, UnauthorizedError, verifySolution } from '../api';
import type { Letters } from '../types';
import type { MatchClient, MatchEvent, MatchInfo } from './types';

/** Dev-only scripted situations, chosen with `?mock=<name>` in the URL. */
export type Scenario = 'normal' | 'timeout' | 'left' | 'disconnect' | 'offline';

const NAMES = ['Maya', 'Jonas', 'Priya', 'Theo', 'Amara', 'Luca', 'Sana', 'Felix'];
const BOT_MS = 2200;
const COUNTDOWN_MS = 6000;

/** Fake matchmaking and opponent. Puzzle fetching and win checking hit the real API. */
export class MockMatchClient implements MatchClient {
  private handlers = new Set<(e: MatchEvent) => void>();
  private queueTimer: number | undefined;
  private botTimers = new Set<number>();
  private user: User;
  private scenario: Scenario;
  private match: MatchInfo | undefined;
  private cells: [number, number][] = [];
  private next = 0;
  private paused = false;
  private over = false;

  constructor(user: User, scenario: Scenario = 'normal') {
    this.user = user;
    this.scenario = scenario;
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
  }

  private onOffline = () => this.emit({ type: 'connection', status: 'offline' });
  private onOnline = () => this.emit({ type: 'connection', status: 'online' });

  subscribe(handler: (e: MatchEvent) => void) {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(e: MatchEvent) {
    this.handlers.forEach(h => h(e));
  }

  private botLater(ms: number, fn: () => void) {
    const id = window.setTimeout(() => { this.botTimers.delete(id); fn(); }, ms);
    this.botTimers.add(id);
  }

  private clearBot() {
    this.botTimers.forEach(id => clearTimeout(id));
    this.botTimers.clear();
  }

  private clearQueue() {
    clearTimeout(this.queueTimer);
    this.queueTimer = undefined;
  }

  joinQueue() {
    this.clearQueue();
    if (this.scenario === 'timeout') {
      this.queueTimer = window.setTimeout(() => this.emit({ type: 'queue-timeout' }), 8000);
      return;
    }
    this.queueTimer = window.setTimeout(async () => {
      try {
        const puzzle = await fetchRandomPuzzle(this.user);
        const match: MatchInfo = {
          matchId: crypto.randomUUID(),
          opponent: { name: NAMES[Math.floor(Math.random() * NAMES.length)] },
          puzzle,
          startsAt: Date.now() + COUNTDOWN_MS,
        };
        this.begin(match, 0);
        this.emit({ type: 'matched', match });
      } catch (e) {
        this.emit({ type: 'error', message: 'Could not start a match. Is the server running?', unauthorized: e instanceof UnauthorizedError });
      }
    }, 2500 + Math.random() * 3500);
  }

  leaveQueue() {
    this.clearQueue();
  }

  resume(match: MatchInfo) {
    const open = match.puzzle.mask.flat().filter(Boolean).length;
    const elapsed = Date.now() - match.startsAt;
    // The mock opponent kept "playing" while we were away, at its usual pace.
    const idx = Math.min(open, Math.max(0, Math.floor((elapsed / BOT_MS) * 0.88)));
    this.begin(match, idx);
    this.emit({ type: 'opponent-progress', filled: this.mask() });
  }

  private begin(match: MatchInfo, startIndex: number) {
    this.clearBot();
    this.match = match;
    this.over = false;
    this.paused = false;
    this.cells = match.puzzle.mask.flatMap((row, r) => row.flatMap((open, c) => (open ? [[r, c] as [number, number]] : [])));
    this.next = startIndex;
    const untilStart = Math.max(0, match.startsAt - Date.now());
    this.botLater(untilStart + BOT_MS, this.tick);
    this.script(untilStart);
  }

  private mask(): boolean[][] {
    const n = this.match!.puzzle.size;
    const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    this.cells.slice(0, this.next).forEach(([r, c]) => { m[r][c] = true; });
    return m;
  }

  private seconds() {
    return Math.max(0, Math.round((Date.now() - this.match!.startsAt) / 1000));
  }

  private tick = () => {
    if (this.over || !this.match) return;
    if (!this.paused && Math.random() >= 0.12) {
      this.next++;
      this.emit({ type: 'opponent-progress', filled: this.mask() });
    }
    if (this.next >= this.cells.length) {
      this.over = true;
      this.emit({ type: 'result', result: { winner: 'opponent', seconds: this.seconds(), reason: 'solved' } });
      return;
    }
    this.botLater(BOT_MS, this.tick);
  };

  /** Scripted edge cases for exercising the UI states. Times are relative to the start. */
  private script(untilStart: number) {
    if (this.scenario === 'left') {
      this.botLater(untilStart + 10_000, () => {
        this.over = true;
        this.emit({ type: 'result', result: { winner: 'me', seconds: this.seconds(), reason: 'forfeit' } });
      });
    } else if (this.scenario === 'disconnect') {
      this.botLater(untilStart + 8_000, () => { this.paused = true; this.emit({ type: 'opponent-disconnected', graceSeconds: 30 }); });
      this.botLater(untilStart + 20_000, () => { this.paused = false; this.emit({ type: 'opponent-reconnected' }); });
    } else if (this.scenario === 'offline') {
      this.botLater(untilStart + 6_000, () => this.emit({ type: 'connection', status: 'reconnecting' }));
      this.botLater(untilStart + 12_000, () => this.emit({ type: 'connection', status: 'online' }));
    }
  }

  sendProgress() {
    /* nothing to send: the mock opponent doesn't watch us */
  }

  async submit(letters: Letters) {
    const m = this.match;
    if (!m || this.over) return false;
    const solved = await verifySolution(this.user, m.puzzle.id, letters);
    if (solved && !this.over) {
      this.over = true;
      this.clearBot();
      this.emit({ type: 'result', result: { winner: 'me', seconds: this.seconds(), reason: 'solved' } });
    }
    return solved;
  }

  forfeit() {
    this.over = true;
    this.clearBot();
  }

  dispose() {
    this.clearQueue();
    this.clearBot();
    this.handlers.clear();
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
  }
}
