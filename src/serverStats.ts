import type { User } from './auth';
import { fetchStats, postResult } from './api';
import { dayString, recordResult, saveStats, type Stats } from './stats';

// Kept apart from stats.ts, which stays free of network code so its tests run without a browser.

/** The last result still on its way to the server, so a sync never reads stats from before it. */
let inflight: Promise<unknown> = Promise.resolve();

/** Pulls the server's stats into the local cache. Null when the server can't be reached. */
export async function syncStats(user: User): Promise<Stats | null> {
  await inflight;
  try {
    const stats = await fetchStats(user);
    saveStats(user.id, stats);
    return stats;
  } catch {
    return null;
  }
}

/** Records a finished game here at once, then on the server, whose answer wins. */
export function reportResult(user: User, won: boolean, seconds: number): Promise<void> {
  recordResult(user.id, won, seconds);
  const send = postResult(user, won, seconds, dayString())
    .then(stats => saveStats(user.id, stats))
    .catch(() => { /* offline or rejected: the next sync restores the server's numbers */ });
  inflight = send;
  return send;
}
