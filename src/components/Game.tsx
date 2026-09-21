import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Pos, Puzzle } from '../types';
import type { User } from '../auth';
import { verifySolution } from '../api';
import { initGame, reduce } from '../game';
import { allFilled, playableCount } from '../puzzle';
import { useBot } from '../useBot';
import { ClueLists } from './ClueLists';
import { MyBoard, OpponentBoard } from './Boards';
import { EndScreen, formatTime, type Result } from './EndScreen';

function Progress({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="progress">
      <div className="progress-row"><span>{label}</span><span>{count}/{total}</span></div>
      <div className="bar"><div style={{ width: `${(100 * count) / total}%` }} /></div>
    </div>
  );
}

const countTrue = (g: boolean[][]) => g.flat().filter(Boolean).length;

interface Props {
  puzzle: Puzzle;
  user: User;
  opponentName: string;
  /** Called once when the game ends, with the outcome. */
  onFinish: (r: Result) => void;
  onExit: () => void;
}

export function Game({ puzzle, user, opponentName, onFinish, onExit }: Props) {
  const [state, dispatch] = useReducer((s: ReturnType<typeof initGame>, a: Parameters<typeof reduce>[2]) => reduce(puzzle, s, a), puzzle, initGame);
  const [result, setResult] = useState<Result | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState('');
  const started = useRef(Date.now());
  const ghost = useRef<HTMLInputElement>(null);
  const over = result !== null;

  // First finisher wins; later calls are ignored.
  const finish = useCallback((winner: Result['winner']) => {
    const seconds = Math.round((Date.now() - started.current) / 1000);
    setResult(r => r ?? { winner, seconds });
  }, []);

  const reported = useRef(false);
  useEffect(() => {
    if (result && !reported.current) {
      reported.current = true;
      onFinish(result);
    }
  }, [result, onFinish]);

  const oppFilled = useBot(puzzle, !over, () => finish('opponent'));

  // Once the grid is full, the server (which holds the solution) decides if it's a win.
  useEffect(() => {
    if (over) return;
    if (!allFilled(puzzle, state.letters)) { setNotice(''); return; }
    let stale = false;
    verifySolution(user, puzzle.id, state.letters)
      .then(ok => {
        if (stale) return;
        if (ok) finish('me'); else setNotice('Not quite. One or more squares are wrong.');
      })
      .catch(() => { if (!stale) setNotice("Couldn't check your answer. Change a letter to try again."); });
    return () => { stale = true; };
  }, [over, puzzle, state.letters, user, finish]);

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
  const oppCount = countTrue(oppFilled);
  const current = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir];
  const crossing = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir === 'across' ? 'down' : 'across'];
  const select = (pos: Pos) => { dispatch({ type: 'select', pos }); focus(); };

  return (
    <>
      <div className={`status ${result ? (result.winner === 'me' ? 'win' : 'lose') : notice ? 'warn' : ''}`}>
        {result ? (
          <>
            {result.winner === 'me' ? 'You won' : `${opponentName} won`} · {formatTime(result.seconds)}
            <button onClick={onExit}>Back to lobby</button>
          </>
        ) : notice}
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
          <div className="banner muted"><span>{opponentName}'s board · letters hidden</span></div>
          <OpponentBoard puzzle={puzzle} filled={oppFilled} />
          <Progress label={opponentName} count={oppCount} total={total} />
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
      {result && !dismissed && (
        <EndScreen result={result} myCount={myFilled} oppCount={oppCount} total={total} opponentName={opponentName} onExit={onExit} onClose={() => { setDismissed(true); }} />
      )}
    </>
  );
}
