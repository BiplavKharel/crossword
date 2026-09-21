import type { User } from '../auth';
import { MockMatchClient, type Scenario } from './mockClient';
import type { MatchClient } from './types';

const SCENARIOS: Scenario[] = ['timeout', 'left', 'disconnect', 'offline'];

/** The one place that picks the transport. Swap in the WebSocket client here. */
export function createMatchClient(user: User): MatchClient {
  const requested = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mock') : null;
  return new MockMatchClient(user, SCENARIOS.find(s => s === requested) ?? 'normal');
}

export type { MatchClient, MatchEvent, MatchInfo, MatchResult, ConnectionStatus } from './types';
