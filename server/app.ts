import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ApiPuzzle, RawPuzzle } from '../src/types.js';

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
}

const GUEST: Claims = { sub: 'guest', email: '', name: 'Guest', exp: Number.MAX_SAFE_INTEGER };

const toUser = (c: Claims) => ({ id: c.sub, name: c.name, email: c.email, picture: c.picture, exp: c.exp });

/** Strips the letters: players get the layout and clue text only. */
const toPublic = (p: RawPuzzle): ApiPuzzle => ({
  id: p.date,
  date: p.date,
  size: p.size[0],
  mask: p.grid.map(row => row.map(Boolean)),
  clues: {
    across: p.clues.across.map(({ num, text }) => ({ num, text })),
    down: p.clues.down.map(({ num, text }) => ({ num, text })),
  },
});

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];

export function createApp(verify: Verifier, { puzzles, allowedOrigins, allowGuest = false }: AppOptions) {
  const playable = puzzles.filter(p => p.size[0] === 5 && p.size[1] === 5);
  const app = express();
  app.use(express.json());
  if (allowedOrigins) {
    const origins = allowedOrigins.split(',').map(o => o.trim());
    app.use(cors({ origin: origins }));
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return void res.status(401).json({ error: 'missing token' });
    if (allowGuest && token === 'guest') {
      res.locals.user = GUEST;
      return next();
    }
    try {
      res.locals.user = await verify(token);
      next();
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  };

  // Exchange a Google credential for the verified user.
  app.post('/api/auth/google', async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== 'string') return void res.status(400).json({ error: 'credential required' });
    try {
      res.json({ user: toUser(await verify(credential)) });
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  });

  // Re-check a stored token on later visits.
  app.get('/api/me', requireUser, (_req, res) => res.json({ user: toUser(res.locals.user) }));

  app.get('/api/puzzles/random', requireUser, (_req, res) => {
    if (!playable.length) return void res.status(503).json({ error: 'no puzzles available' });
    res.json(toPublic(playable[Math.floor(Math.random() * playable.length)]));
  });

  // The server holds the solution, so it is the only place a win can be confirmed.
  app.post('/api/puzzles/:id/verify', requireUser, (req, res) => {
    const puzzle = playable.find(p => p.date === req.params.id);
    if (!puzzle) return void res.status(404).json({ error: 'unknown puzzle' });
    const n = puzzle.size[0];
    const letters: unknown = req.body?.letters;
    const wellFormed =
      Array.isArray(letters) &&
      letters.length === n &&
      letters.every(row => Array.isArray(row) && row.length === n && row.every(c => typeof c === 'string' && c.length <= 1));
    if (!wellFormed) return void res.status(400).json({ error: 'letters must be an n x n grid of single characters' });
    const grid = letters as string[][];
    const solved = puzzle.grid.every((row, r) => row.every((answer, c) => (answer ?? '') === grid[r][c].toUpperCase()));
    res.json({ solved });
  });

  return app;
}
