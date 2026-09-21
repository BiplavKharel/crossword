import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Pos, Puzzle } from '../types';
import { initGame, reduce } from '../game';
import { isSolved, playableCount } from '../puzzle';
import { useBot } from '../useBot';
import { ClueLists } from './ClueLists';
import { MyBoard, OpponentBoard } from './Boards';

function Progress({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="progress">
      <div className="progress-row"><span>{label}</span><span>{count}/{total}</span></div>
      <div className="bar"><div style={{ width: `${(100 * count) / total}%` }} /></div>
    </div>
  );
}

const countTrue = (g: boolean[][]) => g.flat().filter(Boolean).length;

export function Game({ puzzle }: { puzzle: Puzzle }) {
  const [state, dispatch] = useReducer((s: ReturnType<typeof initGame>, a: Parameters<typeof reduce>[2]) => reduce(puzzle, s, a), puzzle, initGame);
  const [winner, setWinner] = useState<'me' | 'opponent' | null>(null);
  const ghost = useRef<HTMLInputElement>(null);
  const over = winner !== null;

  const oppFilled = useBot(puzzle, !over, () => setWinner(w => w ?? 'opponent'));

  useEffect(() => {
    if (isSolved(puzzle, state.letters)) setWinner(w => w ?? 'me');
  }, [puzzle, state.letters]);

  useEffect(() => {
    if (over) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) dispatch({ type: 'type', ch: k.toUpperCase() });
      else if (k === 'Backspace') dispatch({ type: 'backspace' });
      else if (k.startsWith('Arrow')) dispatch({ type: 'arrow', key: k as 'ArrowLeft' });
      else if (k === 'Tab') dispatch({ type: 'nextClue', back: e.shiftKey });
      else if (k === ' ') dispatch({ type: 'toggleDir' });
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [over]);

  const focus = useCallback(() => ghost.current?.focus({ preventScroll: true }), []);
  useEffect(focus, [focus]);

  const total = playableCount(puzzle);
  const myFilled = state.letters.flat().filter(Boolean).length;
  const current = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir];
  const crossing = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir === 'across' ? 'down' : 'across'];
  const select = (pos: Pos) => { dispatch({ type: 'select', pos }); focus(); };

  return (
    <>
      <div className={`status ${winner === 'me' ? 'win' : winner === 'opponent' ? 'lose' : ''}`}>
        {winner === 'me' && 'You solved it first. You win!'}
        {winner === 'opponent' && 'Your opponent finished first.'}
      </div>
      <main>
        <section className="side me">
          <div className="banner">
            {current && <><b>{current.num}{current.dir[0].toUpperCase()}</b><span>{current.text}</span></>}
          </div>
          <MyBoard puzzle={puzzle} letters={state.letters} sel={state.sel} dir={state.dir} onSelect={select} />
          <Progress label="You" count={myFilled} total={total} />
        </section>
        <section className="side opp">
          <div className="banner muted"><span>Opponent's board · letters hidden</span></div>
          <OpponentBoard puzzle={puzzle} filled={oppFilled} />
          <Progress label="Opponent" count={countTrue(oppFilled)} total={total} />
        </section>
      </main>
      <ClueLists puzzle={puzzle} letters={state.letters} current={current} crossing={crossing} onJump={w => { dispatch({ type: 'jump', word: w }); focus(); }} />
      {/* Mobile virtual keyboards don't send useful keydown events, so read from an input. */}
      <input
        ref={ghost}
        className="ghost"
        autoComplete="off"
        autoCapitalize="characters"
        onInput={e => {
          const ch = e.currentTarget.value.slice(-1);
          e.currentTarget.value = '';
          if (!over && /^[a-zA-Z]$/.test(ch)) dispatch({ type: 'type', ch: ch.toUpperCase() });
        }}
      />
    </>
  );
}
