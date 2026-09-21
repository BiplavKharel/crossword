import type { MatchResult } from '../match';
import { Modal } from './Modal';

interface Props {
  result: MatchResult;
  myCount: number;
  oppCount: number;
  total: number;
  opponentName: string;
  onExit: () => void;
  onClose: () => void;
}

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function summary(r: MatchResult, name: string, myCount: number, oppCount: number, total: number) {
  if (r.winner === 'me') {
    return r.reason === 'forfeit'
      ? `${name} left the game, so you win.`
      : `You solved it first. ${name} had filled ${oppCount} of ${total} squares.`;
  }
  return `${name} finished first. You had filled ${myCount} of ${total} squares.`;
}

export function EndScreen({ result, myCount, oppCount, total, opponentName, onExit, onClose }: Props) {
  const won = result.winner === 'me';
  return (
    <Modal labelledBy="end-title" onClose={onClose} className={won ? 'win' : 'lose'}>
      <h2 id="end-title">{won ? 'You won!' : `${opponentName} won`}</h2>
      <p className="modal-time">{formatTime(result.seconds)}</p>
      <p>{summary(result, opponentName, myCount, oppCount, total)}</p>
      <div className="modal-actions">
        <button data-autofocus onClick={onExit}>Back to lobby</button>
        <button className="ghost-btn" onClick={onClose}>View boards</button>
      </div>
    </Modal>
  );
}
