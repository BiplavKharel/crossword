const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

interface Props {
  onLetter: (ch: string) => void;
  onBackspace: () => void;
  disabled: boolean;
}

/** On-screen keyboard for touch devices (hidden on desktop by CSS). */
export function Keyboard({ onLetter, onBackspace, disabled }: Props) {
  // pointerdown preventDefault keeps focus where it is instead of jumping to the key.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return (
    <div className="osk" role="group" aria-label="On-screen keyboard">
      {ROWS.map((row, i) => (
        <div className="osk-row" key={row}>
          {[...row].map(ch => (
            <button key={ch} className="key" disabled={disabled} onPointerDown={keep} onClick={() => onLetter(ch)}>{ch}</button>
          ))}
          {i === 2 && <button className="key wide" disabled={disabled} aria-label="Backspace" onPointerDown={keep} onClick={onBackspace}>⌫</button>}
        </div>
      ))}
    </div>
  );
}
