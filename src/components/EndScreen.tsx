import { useEffect, useRef } from 'react';

export interface Result {
  winner: 'me' | 'opponent';
  seconds: number;
}

interface Props {
  result: Result;
  myCount: number;
  oppCount: number;
  total: number;
  opponentName: string;
  onExit: () => void;
  onClose: () => void;
}

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function EndScreen({ result, myCount, oppCount, total, opponentName, onExit, onClose }: Props) {
  const won = result.winner === 'me';
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${won ? 'win' : 'lose'}`} role="dialog" aria-modal="true" aria-labelledby="end-title" onClick={e => e.stopPropagation()}>
        <h2 id="end-title">{won ? 'You won!' : `${opponentName} won`}</h2>
        <p className="modal-time">{formatTime(result.seconds)}</p>
        <p>
          {won
            ? `You solved it first. ${opponentName} had filled ${oppCount} of ${total} squares.`
            : `${opponentName} finished first. You had filled ${myCount} of ${total} squares.`}
        </p>
        <div className="modal-actions">
          <button ref={primary} onClick={onExit}>Back to lobby</button>
          <button className="ghost-btn" onClick={onClose}>View boards</button>
        </div>
      </div>
    </div>
  );
}
