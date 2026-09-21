import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';

interface Props {
  labelledBy: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** Dialog with a focus trap, Escape to close, and focus restored on close. */
export function Modal({ labelledBy, onClose, className = '', children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = box.current!;
    const previous = document.activeElement as HTMLElement | null;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  return (
    <div className="overlay" onClick={() => close.current()}>
      <div ref={box} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
