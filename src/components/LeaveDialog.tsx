import { Modal } from './Modal';

interface Props {
  opponentName: string;
  onStay: () => void;
  onLeave: () => void;
}

export function LeaveDialog({ opponentName, onStay, onLeave }: Props) {
  return (
    <Modal labelledBy="leave-title" onClose={onStay}>
      <h2 id="leave-title">Leave this game?</h2>
      <p>Leaving forfeits the match. It counts as a loss, and {opponentName} wins.</p>
      <div className="modal-actions">
        <button data-autofocus onClick={onStay}>Keep playing</button>
        <button className="ghost-btn" onClick={onLeave}>Leave and forfeit</button>
      </div>
    </Modal>
  );
}
