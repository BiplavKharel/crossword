import type { User } from '../auth';
import { API } from '../auth';
import type { ClientMsg, ServerMsg } from '../matchProtocol';
import { dayString } from '../stats';
import type { Letters } from '../types';
import type { MatchClient, MatchEvent } from './types';

const SUBMIT_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 5000;
/** While still searching, give up after this many failed connection attempts. */
const QUEUE_RETRIES = 3;

export const matchSocketUrl = () => `${(API || window.location.origin).replace(/^http/, 'ws')}/ws`;

interface Pending {
  resolve: (solved: boolean) => void;
  reject: (e: Error) => void;
  timer: number;
}

/**
 * Real matchmaking and gameplay over a WebSocket. The server owns the clock, the opponent and the
 * result, and records the stats; this class only relays. If the connection drops mid-match it
 * reconnects and resumes, and the server forfeits the match only after its grace period.
 */
export class WsMatchClient implements MatchClient {
  readonly recordsResults = true;

  private handlers = new Set<(e: MatchEvent) => void>();
  private ws?: WebSocket;
  private ready = false;
  private inQueue = false;
  private matchId?: string;
  private over = false;
  private fatal = false;
  private disposed = false;
  private reconnecting = false;
  private retries = 0;
  private retryTimer?: number;
  private nextReq = 1;
  private pending = new Map<number, Pending>();

  constructor(private user: User) {
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
  }

  private onOffline = () => this.emit({ type: 'connection', status: 'offline' });
  private onOnline = () => {
    // Don't wait out the backoff once the network is back.
    if (this.retryTimer !== undefined) { clearTimeout(this.retryTimer); this.retryTimer = undefined; this.connect(); }
    else if (!this.reconnecting) this.emit({ type: 'connection', status: 'online' });
  };

  subscribe(handler: (e: MatchEvent) => void) {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(e: MatchEvent) {
    this.handlers.forEach(h => h(e));
  }

  // ---- MatchClient

  joinQueue() {
    this.inQueue = true;
    this.over = false;
    this.matchId = undefined;
    this.retries = 0;
    this.connect();
    this.send({ type: 'join', day: dayString() });
  }

  leaveQueue() {
    this.inQueue = false;
    this.send({ type: 'leave' });
  }

  resume(match: { matchId: string }) {
    this.matchId = match.matchId;
    this.over = false;
    this.connect();
    this.send({ type: 'resume', matchId: match.matchId });
  }

  sendProgress(filled: boolean[][]) {
    this.send({ type: 'progress', filled }); // dropped while offline; the next keystroke sends fresh state
  }

  submit(letters: Letters): Promise<boolean> {
    if (!this.ready) return Promise.reject(new Error('not connected'));
    const reqId = this.nextReq++;
    return new Promise<boolean>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(reqId); reject(new Error('timed out')); }, SUBMIT_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
      this.send({ type: 'submit', reqId, letters });
    });
  }

  forfeit() {
    this.over = true;
    this.send({ type: 'forfeit' });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.failPending(new Error('closed'));
    this.handlers.clear();
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    this.ws?.close();
    this.ws = undefined;
  }

  // ---- socket

  private connect() {
    if (this.disposed || this.fatal || this.ws) return;
    const ws = new WebSocket(matchSocketUrl());
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.user.credential ?? '' } satisfies ClientMsg));
    ws.onmessage = e => {
      try {
        this.onMessage(JSON.parse(e.data as string) as ServerMsg);
      } catch {
        /* ignore a malformed frame */
      }
    };
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => { /* a close always follows */ };
  }

  /** Sends if the socket is authenticated; otherwise `authed` replays the queue/match state. */
  private send(msg: ClientMsg) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private failPending(err: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'authed':
        this.ready = true;
        this.retries = 0;
        // Pick up where we were: searching, or in a match that survived the drop.
        if (this.inQueue) this.send({ type: 'join', day: dayString() });
        if (this.matchId && !this.over) this.send({ type: 'resume', matchId: this.matchId });
        else if (this.reconnecting) { this.reconnecting = false; this.emit({ type: 'connection', status: 'online' }); }
        break;
      case 'matched': {
        this.inQueue = false;
        this.matchId = msg.match.matchId;
        this.over = false;
        // Express the server's start time on this device's clock, so a wrong local clock can't skew the countdown.
        const startsAt = msg.match.startsAt - msg.match.serverNow + Date.now();
        this.emit({ type: 'matched', match: { matchId: msg.match.matchId, opponent: msg.match.opponent, puzzle: msg.match.puzzle, startsAt } });
        break;
      }
      case 'resumed':
        this.reconnecting = false;
        this.emit({ type: 'connection', status: 'online' });
        break;
      case 'match-lost':
        this.matchId = undefined;
        this.reconnecting = false;
        this.emit({ type: 'match-lost' });
        break;
      case 'opponent-progress':
      case 'opponent-disconnected':
      case 'opponent-reconnected':
        this.emit(msg);
        break;
      case 'submit-result': {
        const p = this.pending.get(msg.reqId);
        if (!p) break;
        clearTimeout(p.timer);
        this.pending.delete(msg.reqId);
        if (msg.limited) p.reject(new Error('too many wrong attempts'));
        else p.resolve(msg.solved);
        break;
      }
      case 'result':
        this.over = true;
        this.emit({ type: 'result', result: msg.result });
        break;
      case 'error':
        if (msg.unauthorized) this.fatal = true;
        this.emit({ type: 'error', message: msg.message, unauthorized: !!msg.unauthorized });
        break;
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = undefined;
    this.ready = false;
    this.failPending(new Error('connection lost'));
    if (this.disposed || this.fatal) return;

    const inMatch = !!this.matchId && !this.over;
    if (!inMatch && !this.inQueue) return;
    if (!inMatch && this.retries >= QUEUE_RETRIES) {
      this.inQueue = false;
      this.emit({ type: 'error', message: "Couldn't reach the server. Check your connection and try again.", unauthorized: false });
      return;
    }
    if (inMatch && !this.reconnecting) { this.reconnecting = true; this.emit({ type: 'connection', status: 'reconnecting' }); }
    this.retryTimer = window.setTimeout(() => { this.retryTimer = undefined; this.connect(); }, Math.min(1000 * 2 ** this.retries, MAX_BACKOFF_MS));
    this.retries++;
  }
}
