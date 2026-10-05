import { createApp } from './app.js';
import { puzzles } from './puzzles.js';
import { dynamoStore, memoryStore } from './store.js';
import { clientIdFromEnv, googleVerifier } from './verify.js';

const port = Number(process.env.PORT ?? 8787);
// DDB_TABLE is set on AWS; without it (local dev) counters live in memory.
const attempts = process.env.DDB_TABLE ? dynamoStore(process.env.DDB_TABLE) : memoryStore();
const app = createApp(googleVerifier(clientIdFromEnv()), {
  puzzles,
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  allowGuest: process.env.ALLOW_GUEST === '1',
  attempts,
});
app.listen(port, err => {
  // Express 5 reports listen failures (e.g. port in use) here rather than throwing.
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`API listening on :${port}`);
});
