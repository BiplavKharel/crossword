// Vercel serverless entry: vercel.json rewrites /api/* here, so the site and API share an origin.
import { createApp } from '../server/app.js';
import { puzzles } from '../server/puzzles.js';
import { clientIdFromEnv, googleVerifier } from '../server/verify.js';

export default createApp(googleVerifier(clientIdFromEnv()), { puzzles });
