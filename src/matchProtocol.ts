// The WebSocket protocol between the browser and the match server. Types only, so both sides
// share one definition (the server image copies this file; see server/Dockerfile).
import type { ApiPuzzle, Letters } from './types.js';

export interface WireMatch {
  matchId: string;
  opponent: { name: string; picture?: string };
  puzzle: ApiPuzzle;
  /** Epoch ms on the server's clock when both players may start typing. */
  startsAt: number;
  /** The server's clock when this was sent, so the client can correct for its own clock. */
  serverNow: number;
}

export interface WireResult {
  /** From the receiving player's point of view. */
  winner: 'me' | 'opponent';
  /** Seconds from `startsAt` to the finish, timed by the server. */
  seconds: number;
  /** `forfeit` means the loser left (or timed out after disconnecting). */
  reason: 'solved' | 'forfeit';
}

export type ClientMsg =
  /** Must be the first message. `token` is a session token (or Google ID token). */
  | { type: 'auth'; token: string }
  /** `day` is the player's local calendar day, YYYY-MM-DD, for streaks. */
  | { type: 'join'; day: string }
  | { type: 'leave' }
  /** Which squares are filled. Never the letters. */
  | { type: 'progress'; filled: boolean[][] }
  | { type: 'submit'; reqId: number; letters: Letters }
  | { type: 'forfeit' }
  /** Re-attach to a running match after a refresh or a dropped connection. */
  | { type: 'resume'; matchId: string };

export type ServerMsg =
  | { type: 'authed' }
  | { type: 'matched'; match: WireMatch }
  | { type: 'resumed'; serverNow: number }
  | { type: 'match-lost' }
  | { type: 'opponent-progress'; filled: boolean[][] }
  | { type: 'opponent-disconnected'; graceSeconds: number }
  | { type: 'opponent-reconnected' }
  | { type: 'submit-result'; reqId: number; solved: boolean; limited?: boolean }
  | { type: 'result'; result: WireResult }
  | { type: 'error'; message: string; unauthorized?: boolean };
