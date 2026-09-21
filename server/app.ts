import cors from 'cors';
import express, { type Request } from 'express';

export interface Claims {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

/** Throws if the token is invalid, expired, or not meant for this app. */
export type Verifier = (idToken: string) => Promise<Claims>;

const toUser = (c: Claims) => ({ id: c.sub, name: c.name, email: c.email, picture: c.picture, exp: c.exp });

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];

export function createApp(verify: Verifier, allowedOrigin?: string) {
  const app = express();
  app.use(express.json());
  if (allowedOrigin) app.use(cors({ origin: allowedOrigin }));

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
  app.get('/api/me', async (req, res) => {
    const token = bearer(req);
    if (!token) return void res.status(401).json({ error: 'missing token' });
    try {
      res.json({ user: toUser(await verify(token)) });
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  });

  return app;
}
