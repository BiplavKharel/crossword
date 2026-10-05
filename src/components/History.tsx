import { useCallback, useEffect, useState } from 'react';
import { fetchHistory, UnauthorizedError, type HistoryMatch } from '../api';
import type { User } from '../auth';
import { formatTime } from './EndScreen';

interface Props {
  user: User;
  onBack: () => void;
  onUnauthorized: () => void;
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function note(m: HistoryMatch) {
  if (m.reason === 'forfeit') return m.won ? 'Opponent left' : 'You left';
  return m.won ? 'Solved first' : 'Finished second';
}

export function History({ user, onBack, onUnauthorized }: Props) {
  const [rows, setRows] = useState<HistoryMatch[] | null>(null);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError('');
    try {
      const page = await fetchHistory(user, before);
      setRows(r => (before ? [...(r ?? []), ...page.matches] : page.matches));
      setNext(page.next);
    } catch (e) {
      if (e instanceof UnauthorizedError) return onUnauthorized();
      setError("Couldn't load your history.");
    } finally {
      setLoading(false);
    }
  }, [user, onUnauthorized]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="lobby">
      <div className="card history">
        <p className="eyebrow">Your games</p>
        <h2 className="lobby-name">History</h2>

        {rows === null && !error && <p className="lobby-note" role="status">Loading…</p>}
        {rows?.length === 0 && <p className="lobby-note">No games yet. Finish a match and it will show up here.</p>}

        {!!rows?.length && (
          <ul className="history-list">
            {rows.map(m => (
              <li key={m.matchId} className="history-row">
                <span className={`history-badge ${m.won ? 'win' : 'lose'}`}>{m.won ? 'Won' : 'Lost'}</span>
                <span className="history-main">
                  <b>vs {m.opponent}{m.vsBot && <small> (bot)</small>}</b>
                  <span className="history-sub">{when(m.at)} · {note(m)}</span>
                </span>
                <span className="history-time" aria-label={m.reason === 'forfeit' ? 'Forfeit' : 'Time'}>
                  {m.reason === 'forfeit' ? '–' : formatTime(m.seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}
        <div className="modal-actions">
          {(next || error) && <button onClick={() => void load(error ? undefined : next)} disabled={loading}>{loading ? 'Loading…' : error ? 'Try again' : 'Load more'}</button>}
          <button className="ghost-btn" onClick={onBack}>Back to lobby</button>
        </div>
      </div>
    </div>
  );
}
