import type { ApiPuzzle, Letters } from '../types';

/**
 * The seam between the UI and matchmaking/gameplay transport. The UI only talks to
 * this interface; today `MockMatchClient` implements it, later a WebSocket client will.
 */

export interface Opponent {
  name: string;
  picture?: string;
}

export interface MatchInfo {
  matchId: string;
  opponent: Opponent;
  puzzle: ApiPuzzle;
  /** Epoch ms (server clock) when both players may start typing. */
  startsAt: number;
}

export type ConnectionStatus = 'online' | 'reconnecting' | 'offline';

export interface MatchResult {
  winner: 'me' | 'opponent';
  /** Seconds from `startsAt` to the finish, as timed by the server. */
  seconds: number;
  /** `forfeit` means the other player left. */
  reason: 'solved' | 'forfeit';
}

export type MatchEvent =
  | { type: 'matched'; match: MatchInfo }
  | { type: 'queue-timeout' }
  | { type: 'opponent-progress'; filled: boolean[][] }
  | { type: 'opponent-disconnected'; graceSeconds: number }
  | { type: 'opponent-reconnected' }
  | { type: 'result'; result: MatchResult }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'error'; message: string; unauthorized: boolean };

export interface MatchClient {
  subscribe(handler: (e: MatchEvent) => void): () => void;
  joinQueue(): void;
  leaveQueue(): void;
  /** Re-attach to an in-progress match after a page refresh. */
  resume(match: MatchInfo): void;
  /** Tell the server which squares I've filled (never the letters). */
  sendProgress(filled: boolean[][]): void;
  /** Ask the server whether this grid solves the puzzle. A win also emits a `result` event. */
  submit(letters: Letters): Promise<boolean>;
  forfeit(): void;
  dispose(): void;
}
