import { Modal } from './Modal';

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal labelledBy="how-title" onClose={onClose} className="how">
      <h2 id="how-title">How to play</h2>
      <ol className="how-list">
        <li>You and an opponent get the <b>same 5×5 mini crossword</b> at the same moment.</li>
        <li>Fill in the squares. Click a square, or use the arrow keys. <b>Tab</b> jumps to the next clue and <b>Space</b> flips across/down.</li>
        <li>You can see <b>how many squares your opponent has filled</b>, but never their letters.</li>
        <li>The <b>first to solve it correctly wins</b>. If your grid is full but wrong, you'll be told and can keep fixing it.</li>
        <li>You get <b>one game a day</b>. Win each day to build your streak.</li>
      </ol>
      <button data-autofocus onClick={onClose}>Got it</button>
    </Modal>
  );
}
