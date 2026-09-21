import { useEffect, useState } from 'react';
import type { User } from '../auth';
import { currentStreak, loadStats, msUntilTomorrow, playedToday, resetStats } from '../stats';
import { formatTime } from './EndScreen';
import { HowToPlay } from './HowToPlay';

const SEEN_KEY = 'crossword.seenHowTo';
const seenHowTo = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ } };

function countdown(ms: number) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function Tile({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={`tile ${hero ? 'hero' : ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

export function Lobby({ user, onPlay }: { user: User; onPlay: () => void }) {
  const [stats, setStats] = useState(() => loadStats(user.id));
  const [wait, setWait] = useState(msUntilTomorrow);
  const [showHow, setShowHow] = useState(() => !seenHowTo());
  const closeHow = () => { markSeen(); setShowHow(false); };
  const locked = playedToday(stats);

  useEffect(() => {
    const id = setInterval(() => setWait(msUntilTomorrow()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rate = stats.played ? `${Math.round((100 * stats.wins) / stats.played)}%` : '–';

  return (
    <div className="lobby">
      <div className="card">
        <p className="eyebrow">Welcome back</p>
        <h2 className="lobby-name">{user.name.split(' ')[0]}</h2>

        <div className="tiles">
          <Tile hero label="Win streak" value={String(currentStreak(stats))} />
          <Tile label="Played" value={String(stats.played)} />
          <Tile label="Wins" value={String(stats.wins)} />
          <Tile label="Win rate" value={rate} />
          <Tile label="Best time" value={stats.bestTime === null ? '–' : formatTime(stats.bestTime)} />
        </div>

        <button className="play" onClick={onPlay} disabled={locked}>Play</button>
        <p className="lobby-note">
          {locked ? `You've played today. Next game in ${countdown(wait)}.` : 'One game a day. Win each day to build your streak.'}
        </p>

        <button className="link" onClick={() => setShowHow(true)}>How to play</button>

        {import.meta.env.DEV && (
          <button className="ghost-btn dev" onClick={() => { resetStats(user.id); setStats(loadStats(user.id)); }}>
            Reset stats (dev only)
          </button>
        )}
      </div>
      {showHow && <HowToPlay onClose={closeHow} />}
    </div>
  );
}
