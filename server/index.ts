import { createApp } from './app.js';
import { clientIdFromEnv, googleVerifier } from './verify.js';

const port = Number(process.env.PORT ?? 8787);
createApp(googleVerifier(clientIdFromEnv()), process.env.ALLOWED_ORIGIN).listen(port, () =>
  console.log(`API listening on :${port}`),
);
