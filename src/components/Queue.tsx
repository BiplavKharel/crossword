import { useEffect, useState } from 'react';
import type { MatchClient, MatchInfo } from '../match';
import { formatTime } from './EndScreen';

interface Props {
  client: MatchClient;
  onMatched: (match: MatchInfo) => void;
  onCancel: () => void;
  onError: (message: string, unauthorized: boolean) => void;
}

export function Queue({ client, onMatched, onCancel, onError }: Props) {
  const [seconds, setSeconds] = useState(0);
  const [found, setFound] = useState<MatchInfo | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSeconds(0);
    setTimedOut(false);
    const off = client.subscribe(e => {
      if (e.type === 'matched') setFound(e.match);
      else if (e.type === 'queue-timeout') setTimedOut(true);
      else if (e.type === 'error') onError(e.message, e.unauthorized);
    });
    client.joinQueue();
    return () => { off(); client.leaveQueue(); };
  }, [client, attempt, onError]);

  useEffect(() => {
    if (found || timedOut) return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [found, timedOut, attempt]);

  // Short beat to show who you're playing before the game screen takes over.
  useEffect(() => {
    if (!found) return;
    const id = setTimeout(() => onMatched(found), 1200);
    return () => clearTimeout(id);
  }, [found, onMatched]);

  return (
    <div className="lobby">
      <div className="card queue" role="status" aria-live="polite">
        {found ? (
          <>
            <p className="eyebrow">Opponent found</p>
            <h2 className="lobby-name">{found.opponent.name}</h2>
            <p className="lobby-note">Get ready…</p>
          </>
        ) : timedOut ? (
          <>
            <h2 className="lobby-name">No opponent found</h2>
            <p className="lobby-note">Nobody else is looking for a game right now. Try again in a moment.</p>
            <div className="modal-actions">
              <button onClick={() => setAttempt(a => a + 1)}>Try again</button>
              <button className="ghost-btn" onClick={onCancel}>Back to lobby</button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" aria-hidden="true" />
            <h2 className="lobby-name">Finding an opponent…</h2>
            <p className="queue-time">{formatTime(seconds)}</p>
            <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
