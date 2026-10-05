import { authenticator, createApp } from './app.js';
import { MatchManager } from './match.js';
import { puzzles } from './puzzles.js';
import { dynamoStore, memoryStore } from './store.js';
import { clientIdFromEnv, googleVerifier } from './verify.js';
import { attachWebSocket } from './ws.js';

const port = Number(process.env.PORT ?? 8787);
// DDB_TABLE is set on AWS; without it (local dev) counters live in memory.
const store = process.env.DDB_TABLE ? dynamoStore(process.env.DDB_TABLE) : memoryStore();
const verify = googleVerifier(clientIdFromEnv());
const allowGuest = process.env.ALLOW_GUEST === '1';
const allowedOrigins = process.env.ALLOWED_ORIGINS;

const app = createApp(verify, { puzzles, allowedOrigins, allowGuest, store });
// Matches live in this process's memory, so run a single task (see infra/ecs.tf desired_count).
const matches = new MatchManager({ puzzles, store });

const server = app.listen(port, err => {
  // Express 5 reports listen failures (e.g. port in use) here rather than throwing.
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`API listening on :${port}`);
});
const wss = attachWebSocket(server, matches, authenticator(verify, store, allowGuest), { allowedOrigins });

// ECS sends SIGTERM on deploys. Close promptly; clients reconnect and resume within the grace period.
process.on('SIGTERM', () => {
  matches.close();
  for (const client of wss.clients) client.close(1012, 'server restarting'); // 1012: reconnect shortly
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
