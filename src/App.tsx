import { useCallback, useEffect, useState } from 'react';
import type { Puzzle, RawPuzzle } from './types';
import { buildPuzzle, loadPuzzles } from './puzzle';
import { Game } from './components/Game';
import { Login } from './components/Login';
import { loadUser, saveUser, sessionStillValid, type User } from './auth';

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export default function App() {
  const [pool, setPool] = useState<RawPuzzle[]>([]);
  const [game, setGame] = useState<{ puzzle: Puzzle; id: number } | null>(null);
  const [error, setError] = useState('');
  const [user, setUser] = useState<User | null>(loadUser);

  const login = useCallback((u: User) => { saveUser(u); setUser(u); }, []);
  const logout = () => { window.google?.accounts.id.disableAutoSelect(); saveUser(null); setUser(null); };

  const pickNext = (from: RawPuzzle[], id: number) =>
    setGame({ puzzle: buildPuzzle(from[Math.floor(Math.random() * from.length)]), id });

  // A stored session is only trusted until the server says otherwise.
  useEffect(() => {
    const stored = loadUser();
    if (stored) sessionStillValid(stored).then(ok => { if (!ok) logout(); });
  }, []);

  useEffect(() => {
    if (!user) return;
    loadPuzzles()
      .then(p => { setPool(p); pickNext(p, 0); })
      .catch(() => setError('Could not load puzzles.json'));
  }, [user]);

  if (!user) return <Login onLogin={login} />;

  return (
    <>
      <header>
        <h1>The Mini <em>1v1</em></h1>
        <span className="date">{game && formatDate(game.puzzle.date)}</span>
        <div className="user">
          {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
          <span>{user.name}</span>
          <button className="ghost-btn" onClick={logout}>Sign out</button>
        </div>
        <button onClick={() => pickNext(pool, (game?.id ?? 0) + 1)} disabled={!pool.length}>New puzzle</button>
      </header>
      {error && <div className="status lose">{error}</div>}
      {game && <Game key={game.id} puzzle={game.puzzle} />}
    </>
  );
}
