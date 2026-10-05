import { createHash, randomBytes } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { RawPuzzle } from '../src/types.js';
import { isLetterGrid, judge, toPublic, WINDOW_SECONDS } from './puzzle.js';
import { applyResult, validDay } from './stats.js';
import { memoryStore, type Store } from './store.js';

export interface Claims {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

/** Throws if the token is invalid, expired, or not meant for this app. */
export type Verifier = (idToken: string) => Promise<Claims>;

export interface AppOptions {
  puzzles: RawPuzzle[];
  /** Origins allowed to call the API (comma-separated). A native mobile app sends no Origin header, so it isn't affected by this. */
  allowedOrigins?: string;
  /** Local development only: accepts `Bearer guest` as a signed-in user. */
  allowGuest?: boolean;
  /** Sessions, stats and rate-limit counters; defaults to per-process memory. */
  store?: Store;
  /** Wrong guesses allowed per user, puzzle and hour before verify answers 429. */
  maxWrongAttempts?: number;
  /** How long a server-issued session lasts. */
  sessionSeconds?: number;
}

const GUEST: Claims = { sub: 'guest', email: '', name: 'Guest', exp: Number.MAX_SAFE_INTEGER };

const SESSION_PREFIX = 'cw_';
/** Slack for the match countdown, which runs between the puzzle being served and the clock starting. */
const COUNTDOWN_SLACK_SECONDS = 15;
/** A win can be reported this long after the verify that confirmed it. */
const SOLVE_CLAIM_MS = 10 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newSessionToken = () => SESSION_PREFIX + randomBytes(32).toString('base64url');

const toUser = (c: Claims) => ({ id: c.sub, name: c.name, email: c.email, picture: c.picture, exp: c.exp });

/**
 * Turns a bearer token into a user: our session token, or (while clients migrate) a Google ID token.
 * Undefined means the token is not valid; it throws if the session store can't be reached.
 */
export function authenticator(verify: Verifier, store: Store, allowGuest = false) {
  return async (token: string): Promise<Claims | undefined> => {
    if (allowGuest && token === 'guest') return GUEST;
    if (token.startsWith(SESSION_PREFIX)) return store.getSession(sha256(token));
    try {
      return await verify(token);
    } catch {
      return undefined;
    }
  };
}

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];

export function createApp(
  verify: Verifier,
  { puzzles, allowedOrigins, allowGuest = false, store = memoryStore(), maxWrongAttempts = 20, sessionSeconds = 30 * 24 * 60 * 60 }: AppOptions,
) {
  const playable = puzzles.filter(p => p.size[0] === 5 && p.size[1] === 5);
  const app = express();
  app.use(express.json());
  if (allowedOrigins) {
    const origins = allowedOrigins.split(',').map(o => o.trim());
    app.use(cors({ origin: origins }));
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const authenticate = authenticator(verify, store, allowGuest);
  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return void res.status(401).json({ error: 'missing token' });
    try {
      const claims = await authenticate(token);
      if (!claims) return void res.status(401).json({ error: 'invalid token' });
      res.locals.user = claims;
      next();
    } catch (err) {
      console.error('session lookup failed', err);
      res.status(503).json({ error: 'try again' });
    }
  };

  // Exchange a Google credential for the verified user and a longer-lived session token.
  app.post('/api/auth/google', async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== 'string') return void res.status(400).json({ error: 'credential required' });
    let claims: Claims;
    try {
      claims = await verify(credential);
    } catch {
      return void res.status(401).json({ error: 'invalid token' });
    }
    const session: Claims = { ...claims, exp: Math.floor(Date.now() / 1000) + sessionSeconds };
    const token = newSessionToken();
    try {
      await store.putSession(sha256(token), session);
      res.json({ user: toUser(session), token });
    } catch (err) {
      // Sign-in still works without a session: the client keeps using the Google token until it expires.
      console.error('session create failed', err);
      res.json({ user: toUser(claims) });
    }
  });

  // Revoke the session behind this token. Harmless for Google tokens, which just expire.
  app.post('/api/auth/logout', requireUser, async (req, res) => {
    const token = bearer(req)!;
    if (token.startsWith(SESSION_PREFIX)) await store.deleteSession(sha256(token)).catch(err => console.error('session delete failed', err));
    res.status(204).end();
  });

  // Re-check a stored token on later visits.
  app.get('/api/me', requireUser, (_req, res) => res.json({ user: toUser(res.locals.user) }));

  app.get('/api/puzzles/random', requireUser, async (_req, res) => {
    if (!playable.length) return void res.status(503).json({ error: 'no puzzles available' });
    const puzzle = playable[Math.floor(Math.random() * playable.length)];
    // Start the server's clock for this player. Losing it only costs them a verified win later.
    await store.putPlay(res.locals.user.sub, { puzzleId: puzzle.date, startedAt: Date.now() }).catch(err => console.error('play start failed', err));
    res.json(toPublic(puzzle));
  });

  // The server holds the solution, so it is the only place a win can be confirmed.
  app.post('/api/puzzles/:id/verify', requireUser, async (req, res) => {
    const puzzle = playable.find(p => p.date === req.params.id);
    if (!puzzle) return void res.status(404).json({ error: 'unknown puzzle' });
    const grid: unknown = req.body?.letters;
    if (!isLetterGrid(grid, puzzle.size[0])) return void res.status(400).json({ error: 'letters must be an n x n grid of single characters' });

    const sub: string = res.locals.user.sub;
    const verdict = await judge(store, sub, puzzle, grid, maxWrongAttempts);
    if (verdict === 'limited') {
      res.set('Retry-After', String(WINDOW_SECONDS));
      return void res.status(429).json({ error: 'too many wrong attempts, try again later' });
    }
    const solved = verdict === 'solved';
    if (solved) {
      // Remember the first confirmed solve; it is what lets the player report a win.
      try {
        const play = await store.getPlay(sub);
        if (play && play.puzzleId === puzzle.date && !play.solvedAt) await store.putPlay(sub, { ...play, solvedAt: Date.now() });
      } catch (err) {
        console.error('solve record failed', err);
      }
    }
    res.json({ solved });
  });

  app.get('/api/stats', requireUser, async (_req, res) => {
    try {
      res.json({ stats: await store.getStats(res.locals.user.sub) });
    } catch (err) {
      console.error('stats read failed', err);
      res.status(503).json({ error: 'try again' });
    }
  });

  // Record a finished game. A loss is taken at the player's word (it only hurts them); a win
  // needs a solve the server confirmed, and its time can't beat the server's own clock.
  app.post('/api/stats/result', requireUser, async (req, res) => {
    const sub: string = res.locals.user.sub;
    const { won, seconds, day } = req.body ?? {};
    if (typeof won !== 'boolean') return void res.status(400).json({ error: 'won must be a boolean' });
    if (!validDay(day, Date.now())) return void res.status(400).json({ error: 'day must be a YYYY-MM-DD date' });
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 60 * 60) return void res.status(400).json({ error: 'seconds out of range' });

    try {
      let time = Math.round(seconds);
      if (won) {
        const play = await store.getPlay(sub);
        if (!play?.solvedAt || Date.now() - play.solvedAt > SOLVE_CLAIM_MS) return void res.status(409).json({ error: 'no verified solve to record' });
        time = Math.max(time, Math.round((play.solvedAt - play.startedAt) / 1000) - COUNTDOWN_SLACK_SECONDS);
        await store.deletePlay(sub); // one verified solve backs one reported win
      }
      res.json({ stats: await store.updateStats(sub, s => applyResult(s, won, time, day)) });
    } catch (err) {
      console.error('stats write failed', err);
      res.status(503).json({ error: 'try again' });
    }
  });

  return app;
}
