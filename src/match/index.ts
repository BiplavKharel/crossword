import type { User } from '../auth';
import { MockMatchClient, type Scenario } from './mockClient';
import type { MatchClient } from './types';
import { WsMatchClient } from './wsClient';

const SCENARIOS: Scenario[] = ['timeout', 'left', 'disconnect', 'offline'];

/**
 * The one place that picks the transport: real matchmaking over a WebSocket. In dev, adding
 * `?mock` (or `?mock=timeout|left|disconnect|offline`) to the URL uses the scripted offline bot instead.
 */
export function createMatchClient(user: User): MatchClient {
  const requested = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mock') : null;
  if (requested === null) return new WsMatchClient(user);
  return new MockMatchClient(user, SCENARIOS.find(s => s === requested) ?? 'normal');
}

export type { MatchClient, MatchEvent, MatchInfo, MatchResult, ConnectionStatus } from './types';
