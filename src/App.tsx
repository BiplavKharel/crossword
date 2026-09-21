import { useCallback, useEffect, useRef, useState } from 'react';
import type { Letters } from './types';
import { Game } from './components/Game';
import { LeaveDialog } from './components/LeaveDialog';
import { Lobby } from './components/Lobby';
import { Login } from './components/Login';
import { Queue } from './components/Queue';
import { loadUser, saveUser, sessionStillValid, type User } from './auth';
import { createMatchClient, type MatchClient, type MatchInfo, type MatchResult } from './match';
import { clearMatch, loadMatch, saveMatch } from './match/persist';
import { emptyLetters } from './puzzle';
import { gameIdFromRoute, gameRoute, readRoute, useRoute } from './router';
import { loadStats, playedToday, recordResult } from './stats';

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export default function App() {
  const [user, setUser] = useState<User | null>(loadUser);
  const [route, navigate] = useRoute();
  const [client, setClient] = useState<MatchClient | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [restored, setRestored] = useState<Letters | null>(null); // set when resuming after a refresh
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  // Read from the hashchange handler, so it must update synchronously (not via state).
  const activeRoute = useRef<string | null>(null);

  const login = useCallback((u: User) => { saveUser(u); setUser(u); navigate('/', { replace: true }); }, [navigate]);
  const logout = useCallback(() => {
    window.google?.accounts.id.disableAutoSelect();
    saveUser(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) { setClient(null); return; }
    const c = createMatchClient(user);
    setClient(c);
    return () => c.dispose();
  }, [user]);

  // A stored session is only trusted until the server says otherwise.
  useEffect(() => {
    const stored = loadUser();
    if (stored) sessionStillValid(stored).then(ok => { if (!ok) logout(); });
  }, [logout]);

  const startMatch = useCallback((m: MatchInfo, letters: Letters | null) => {
    activeRoute.current = gameRoute(m.matchId);
    setMatch(m);
    setRestored(letters);
    setFinished(false);
    navigate(gameRoute(m.matchId), { replace: letters !== null });
  }, [navigate]);

  const endMatch = useCallback(() => {
    activeRoute.current = null;
    clearMatch();
    setMatch(null);
    setRestored(null);
    setFinished(false);
    setLeaving(false);
  }, []);

  // Refresh mid-game: drop back into the saved match.
  useEffect(() => {
    if (!user) return;
    const saved = loadMatch(user.id);
    if (saved) startMatch(saved.match, saved.letters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Browser Back/URL edits during a live game: stay put and ask before forfeiting.
  useEffect(() => {
    const onHash = () => {
      const g = activeRoute.current;
      if (g && readRoute() !== g) {
        window.location.replace(`#${g}`);
        setLeaving(true);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const gameId = gameIdFromRoute(route);

  // Direct visits to routes that don't make sense right now.
  useEffect(() => {
    if (!user) return;
    if (route === '/queue' && playedToday(loadStats(user.id))) navigate('/', { replace: true });
    else if (gameId && match?.matchId !== gameId && !loadMatch(user.id)) navigate('/', { replace: true });
    else if (route !== '/' && route !== '/queue' && !gameId) navigate('/', { replace: true });
  }, [user, route, gameId, match, navigate]);

  const play = () => {
    if (user && !playedToday(loadStats(user.id))) { setError(''); navigate('/queue'); }
  };

  const onQueueError = useCallback((message: string, unauthorized: boolean) => {
    if (unauthorized) return logout();
    setError(message);
    navigate('/', { replace: true });
  }, [logout, navigate]);

  const onMatched = useCallback((m: MatchInfo) => {
    if (user) saveMatch(user.id, m, emptyLetters(m.puzzle.size));
    startMatch(m, null);
  }, [user, startMatch]);

  const onFinish = useCallback((r: MatchResult) => {
    if (!user) return;
    recordResult(user.id, r.winner === 'me', r.seconds);
    activeRoute.current = null; // the game is over; leaving no longer forfeits anything
    clearMatch();
    setFinished(true);
  }, [user]);

  const exitToLobby = useCallback(() => { endMatch(); navigate('/', { replace: true }); }, [endMatch, navigate]);

  const confirmLeave = () => {
    if (user && match) {
      client?.forfeit();
      recordResult(user.id, false, Math.max(0, Math.round((Date.now() - match.startsAt) / 1000)));
    }
    exitToLobby();
  };

  if (!user) return <Login onLogin={login} />;

  const inGame = !!gameId && !!match && !!client && match.matchId === gameId;

  return (
    <>
      <header>
        <h1>Cross<em>Duel</em></h1>
        <span className="date">{inGame ? formatDate(match.puzzle.date) : ''}</span>
        <div className="user">
          {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
          <span>{user.name}</span>
          {inGame && !finished
            ? <button className="ghost-btn" onClick={() => setLeaving(true)}>Leave game</button>
            : <button className="ghost-btn" onClick={logout}>Sign out</button>}
        </div>
      </header>
      {error && <div className="status lose" role="alert">{error}</div>}
      {client && route === '/' && <Lobby user={user} onPlay={play} />}
      {client && route === '/queue' && <Queue client={client} onMatched={onMatched} onCancel={() => navigate('/', { replace: true })} onError={onQueueError} />}
      {inGame && (
        <Game key={match.matchId} client={client} match={match} user={user} resumed={restored !== null} initialLetters={restored ?? undefined} onFinish={onFinish} onExit={exitToLobby} />
      )}
      {leaving && match && <LeaveDialog opponentName={match.opponent.name} onStay={() => setLeaving(false)} onLeave={confirmLeave} />}
    </>
  );
}
