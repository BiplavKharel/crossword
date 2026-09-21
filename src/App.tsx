import { useCallback, useEffect, useRef, useState } from 'react';
import type { Puzzle } from './types';
import { buildPuzzle } from './puzzle';
import { fetchRandomPuzzle, UnauthorizedError } from './api';
import { Game } from './components/Game';
import type { Result } from './components/EndScreen';
import { Lobby } from './components/Lobby';
import { Login } from './components/Login';
import { Queue } from './components/Queue';
import { loadUser, saveUser, sessionStillValid, type User } from './auth';
import { loadStats, playedToday, recordResult } from './stats';

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

type Screen = 'lobby' | 'queue' | 'game';

export default function App() {
  const [user, setUser] = useState<User | null>(loadUser);
  const [screen, setScreen] = useState<Screen>('lobby');
  const [game, setGame] = useState<{ puzzle: Puzzle; opponent: string } | null>(null);
  const [error, setError] = useState('');
  const gameKey = useRef(0);

  const login = useCallback((u: User) => { saveUser(u); setUser(u); setScreen('lobby'); }, []);
  const logout = useCallback(() => {
    window.google?.accounts.id.disableAutoSelect();
    saveUser(null);
    setUser(null);
    setGame(null);
    setScreen('lobby');
  }, []);

  // A stored session is only trusted until the server says otherwise.
  useEffect(() => {
    const stored = loadUser();
    if (stored) sessionStillValid(stored).then(ok => { if (!ok) logout(); });
  }, [logout]);

  const play = () => {
    if (!user || playedToday(loadStats(user.id))) return;
    setError('');
    setScreen('queue');
  };

  const onMatched = useCallback(async (opponent: string) => {
    if (!user) return;
    try {
      const puzzle = buildPuzzle(await fetchRandomPuzzle(user));
      gameKey.current++;
      setGame({ puzzle, opponent });
      setScreen('game');
    } catch (e) {
      if (e instanceof UnauthorizedError) return logout();
      setError('Could not load a puzzle. Is the server running?');
      setScreen('lobby');
    }
  }, [user, logout]);

  const onFinish = useCallback((r: Result) => {
    if (user) recordResult(user.id, r.winner === 'me', r.seconds);
  }, [user]);

  const toLobby = useCallback(() => { setGame(null); setScreen('lobby'); }, []);

  if (!user) return <Login onLogin={login} />;

  return (
    <>
      <header>
        <h1>The Mini <em>1v1</em></h1>
        <span className="date">{screen === 'game' && game ? formatDate(game.puzzle.date) : ''}</span>
        <div className="user">
          {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
          <span>{user.name}</span>
          <button className="ghost-btn" onClick={logout}>Sign out</button>
        </div>
      </header>
      {error && <div className="status lose">{error}</div>}
      {screen === 'lobby' && <Lobby user={user} onPlay={play} />}
      {screen === 'queue' && <Queue onMatched={onMatched} onCancel={toLobby} />}
      {screen === 'game' && game && (
        <Game key={gameKey.current} puzzle={game.puzzle} user={user} opponentName={game.opponent} onFinish={onFinish} onExit={toLobby} />
      )}
    </>
  );
}
