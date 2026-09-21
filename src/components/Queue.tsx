import { useEffect, useState } from 'react';
import { formatTime } from './EndScreen';

const NAMES = ['Maya', 'Jonas', 'Priya', 'Theo', 'Amara', 'Luca', 'Sana', 'Felix'];

interface Props {
  onMatched: (opponentName: string) => void;
  onCancel: () => void;
}

/**
 * Fake matchmaking: "finds" an opponent after a few seconds. Swap the timers for a
 * real queue connection later; the props are the contract the rest of the app uses.
 */
export function Queue({ onMatched, onCancel }: Props) {
  const [seconds, setSeconds] = useState(0);
  const [opponent, setOpponent] = useState<string | null>(null);

  useEffect(() => {
    if (opponent) return;
    const tick = setInterval(() => setSeconds(s => s + 1), 1000);
    const find = setTimeout(() => setOpponent(NAMES[Math.floor(Math.random() * NAMES.length)]), 2500 + Math.random() * 3500);
    return () => { clearInterval(tick); clearTimeout(find); };
  }, [opponent]);

  useEffect(() => {
    if (!opponent) return;
    const go = setTimeout(() => onMatched(opponent), 1400);
    return () => clearTimeout(go);
  }, [opponent, onMatched]);

  return (
    <div className="lobby">
      <div className="card queue" role="status" aria-live="polite">
        {opponent ? (
          <>
            <p className="eyebrow">Opponent found</p>
            <h2 className="lobby-name">{opponent}</h2>
            <p className="lobby-note">Starting your game…</p>
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
