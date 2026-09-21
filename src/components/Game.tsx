import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Letters, Pos } from '../types';
import type { User } from '../auth';
import { initGame, reduce } from '../game';
import { useNow } from '../hooks';
import type { ConnectionStatus, MatchClient, MatchInfo, MatchResult } from '../match';
import { saveMatch } from '../match/persist';
import { allFilled, buildPuzzle, playableCount } from '../puzzle';
import { ClueLists } from './ClueLists';
import { MyBoard, OpponentBoard } from './Boards';
import { EndScreen, formatTime } from './EndScreen';
import { Keyboard } from './Keyboard';

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
  client: MatchClient;
  match: MatchInfo;
  user: User;
  /** True when re-entering a match after a page refresh. */
  resumed: boolean;
  initialLetters?: Letters;
  onFinish: (r: MatchResult) => void;
  onExit: () => void;
}

export function Game({ client, match, user, resumed, initialLetters, onFinish, onExit }: Props) {
  const puzzle = useMemo(() => buildPuzzle(match.puzzle), [match]);
  const opponentName = match.opponent.name;
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initGame>, a: Parameters<typeof reduce>[2]) => reduce(puzzle, s, a),
    puzzle,
    p => initGame(p, initialLetters),
  );
  const [oppFilled, setOppFilled] = useState<boolean[][]>(() => puzzle.playable.map(r => r.map(() => false)));
  const [oppAwayUntil, setOppAwayUntil] = useState<number | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('online');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState('');
  const [announce, setAnnounce] = useState('');
  const ghost = useRef<HTMLInputElement>(null);
  const reported = useRef(false);

  const over = result !== null;
  const now = useNow(250, !over);
  const remaining = match.startsAt - now;
  const phase = over ? 'over' : remaining > 0 ? 'countdown' : 'playing';
  const playing = phase === 'playing';
  const seconds = result ? result.seconds : Math.max(0, Math.floor((now - match.startsAt) / 1000));

  // Everything the server/opponent tells us arrives as an event.
  useEffect(() => {
    const off = client.subscribe(e => {
      if (e.type === 'opponent-progress') setOppFilled(e.filled);
      else if (e.type === 'opponent-disconnected') setOppAwayUntil(Date.now() + e.graceSeconds * 1000);
      else if (e.type === 'opponent-reconnected') setOppAwayUntil(null);
      else if (e.type === 'connection') setConnection(e.status);
      else if (e.type === 'result') setResult(r => r ?? e.result);
    });
    if (resumed) client.resume(match);
    return off;
  }, [client, match, resumed]);

  useEffect(() => {
    if (result && !reported.current) {
      reported.current = true;
      onFinish(result);
    }
  }, [result, onFinish]);

  // Save progress so a refresh can resume, and tell the opponent how full our board is.
  useEffect(() => {
    if (over) return;
    saveMatch(user.id, match, state.letters);
    client.sendProgress(state.letters.map(row => row.map(ch => ch !== '')));
  }, [over, user.id, match, client, state.letters]);

  // Once the grid is full, the server decides whether it's a win.
  useEffect(() => {
    if (!playing) return;
    if (!allFilled(puzzle, state.letters)) { setNotice(''); return; }
    let stale = false;
    client.submit(state.letters)
      .then(ok => { if (!stale && !ok) setNotice('Not quite. One or more squares are wrong.'); })
      .catch(() => { if (!stale) setNotice("Couldn't check your answer. Change a letter to try again."); });
    return () => { stale = true; };
  }, [playing, puzzle, state.letters, client]);

  const type = useCallback((ch: string) => dispatch({ type: 'type', ch }), []);
  const backspace = useCallback(() => dispatch({ type: 'backspace' }), []);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) type(k.toUpperCase());
      else if (k === 'Backspace') backspace();
      else if (k.startsWith('Arrow')) dispatch({ type: 'arrow', key: k as 'ArrowLeft' });
      else if (k === 'Tab') dispatch({ type: 'nextClue', back: e.shiftKey });
      else if (k === ' ') dispatch({ type: 'toggleDir' });
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [playing, type, backspace]);

  const focus = useCallback(() => ghost.current?.focus({ preventScroll: true }), []);
  useEffect(focus, [focus]);

  // Screen-reader announcements for things that happen without a user action.
  const count = Math.ceil(remaining / 1000);
  useEffect(() => {
    if (phase === 'countdown' && count <= 3) setAnnounce(String(count));
    else if (phase === 'playing') setAnnounce('Go!');
  }, [phase, count]);
  useEffect(() => {
    if (oppAwayUntil) setAnnounce(`${opponentName} disconnected.`);
    else if (announce.endsWith('disconnected.')) setAnnounce(`${opponentName} is back.`);
  }, [oppAwayUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (result) setAnnounce(result.winner === 'me' ? 'You won!' : `${opponentName} won.`);
  }, [result, opponentName]);

  const total = playableCount(puzzle);
  const myFilled = state.letters.flat().filter(Boolean).length;
  const oppCount = countTrue(oppFilled);
  const current = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir];
  const crossing = puzzle.wordAt[state.sel[0]][state.sel[1]][state.dir === 'across' ? 'down' : 'across'];
  const select = (pos: Pos) => { dispatch({ type: 'select', pos }); focus(); };
  const awayFor = oppAwayUntil ? Math.max(0, Math.ceil((oppAwayUntil - now) / 1000)) : null;

  return (
    <>
      {connection !== 'online' && (
        <div className="conn" role="alert">
          {connection === 'offline' ? "You're offline. Your progress is saved on this device." : 'Connection lost. Reconnecting…'}
        </div>
      )}
      <div className="clock" role="timer" aria-label="Elapsed time">{phase === 'countdown' ? '0:00' : formatTime(seconds)}</div>
      <div className={`status ${result ? (result.winner === 'me' ? 'win' : 'lose') : notice ? 'warn' : ''}`}>
        {result ? (
          <>
            {result.winner === 'me' ? 'You won' : `${opponentName} won`}
            <button onClick={onExit}>Back to lobby</button>
          </>
        ) : notice}
      </div>
      <div className="stage">
        <main className={phase === 'countdown' ? 'waiting' : ''}>
          <section className="side me">
            <div className="banner" aria-live="polite">
              <button className="clue-nav" aria-label="Previous clue" onClick={() => dispatch({ type: 'nextClue', back: true })}>‹</button>
              <div className="clue-text">
                {current && <><b>{current.num}{current.dir[0].toUpperCase()}</b><span>{current.text}</span></>}
              </div>
              <button className="clue-nav" aria-label="Next clue" onClick={() => dispatch({ type: 'nextClue', back: false })}>›</button>
            </div>
            <MyBoard puzzle={puzzle} letters={state.letters} sel={state.sel} dir={state.dir} onSelect={select} />
            <Progress label="You" count={myFilled} total={total} />
          </section>
          <section className="side opp">
            <div className={`banner muted ${awayFor !== null ? 'away' : ''}`}>
              <span>
                {awayFor !== null ? `${opponentName} disconnected · ${awayFor}s to return` : `${opponentName}'s board · letters hidden`}
              </span>
            </div>
            <OpponentBoard puzzle={puzzle} filled={oppFilled} name={opponentName} />
            <Progress label={opponentName} count={oppCount} total={total} />
          </section>
        </main>
        {phase === 'countdown' && (
          <div className="countdown" aria-hidden="true">
            <p className="eyebrow">vs {opponentName}</p>
            <div className="count">{count > 3 ? 'Get ready' : count}</div>
          </div>
        )}
      </div>
      <ClueLists puzzle={puzzle} letters={state.letters} current={current} crossing={crossing} onJump={w => { dispatch({ type: 'jump', word: w }); focus(); }} />
      <Keyboard onLetter={type} onBackspace={backspace} disabled={!playing} />
      <div className="sr-only" aria-live="assertive">{announce}</div>
      {/* Hardware keyboards on touch devices still work; inputMode none stops the native keyboard opening. */}
      <input
        ref={ghost}
        className="ghost"
        inputMode="none"
        autoComplete="off"
        autoCapitalize="characters"
        aria-label="Type letters here"
        onInput={e => {
          const ch = e.currentTarget.value.slice(-1);
          e.currentTarget.value = '';
          if (playing && /^[a-zA-Z]$/.test(ch)) type(ch.toUpperCase());
        }}
      />
      {result && !dismissed && (
        <EndScreen result={result} myCount={myFilled} oppCount={oppCount} total={total} opponentName={opponentName} onExit={onExit} onClose={() => setDismissed(true)} />
      )}
    </>
  );
}
