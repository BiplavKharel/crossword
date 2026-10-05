import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMsg } from '../src/matchProtocol.js';
import type { Claims } from './app.js';
import type { MatchManager, Session } from './match.js';

export interface WsOptions {
  /** Same comma-separated list as the CORS setting. Browsers always send an Origin; native apps send none. */
  allowedOrigins?: string;
  path?: string;
  /** How long a new socket has to authenticate. */
  authTimeoutMs?: number;
  /** Ping interval. Idle sockets get cut by proxies (CloudFront closes quiet ones), so keep them warm. */
  heartbeatMs?: number;
  /** Most messages one socket may send per second before it is cut off. */
  maxMessagesPerSecond?: number;
}

/** WebSocket frame sizes: a progress mask or a full grid is well under 1 KB. */
const MAX_PAYLOAD = 16 * 1024;

/**
 * Serves the match protocol at `/ws`. The first message must be `{type:'auth', token}`; the token
 * travels in a message, not the URL, so it never lands in access logs.
 */
export function attachWebSocket(
  server: Server,
  manager: MatchManager,
  authenticate: (token: string) => Promise<Claims | undefined>,
  { allowedOrigins, path = '/ws', authTimeoutMs = 10_000, heartbeatMs = 25_000, maxMessagesPerSecond = 60 }: WsOptions = {},
) {
  const origins = allowedOrigins?.split(',').map(o => o.trim());
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (origins && origin && !origins.includes(origin)) return ws.close(1008, 'origin not allowed');

    const reply = (msg: ServerMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    let session: Session | undefined;
    let authenticating = false;
    let alive = true;
    let windowStart = Date.now();
    let inWindow = 0;

    const authTimer = setTimeout(() => { if (!session) ws.close(4001, 'auth timeout'); }, authTimeoutMs);
    ws.on('pong', () => { alive = true; });

    ws.on('message', async data => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; inWindow = 0; }
      if (++inWindow > maxMessagesPerSecond) return ws.close(1008, 'too many messages');

      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return ws.close(1003, 'not JSON');
      }

      if (session) return void session.handle(msg).catch(err => console.error('message failed', err));

      // Anything before a successful auth must be the auth message itself.
      const token = (msg as { type?: unknown; token?: unknown } | null);
      if (authenticating || token?.type !== 'auth' || typeof token.token !== 'string') return ws.close(4001, 'auth required');
      authenticating = true;
      try {
        const claims = await authenticate(token.token);
        if (!claims) {
          reply({ type: 'error', message: 'unauthorized', unauthorized: true });
          return ws.close(4001, 'unauthorized');
        }
        if (ws.readyState !== WebSocket.OPEN) return;
        clearTimeout(authTimer);
        session = manager.attach(
          { send: reply, close: (code, reason) => ws.close(code, reason) },
          claims,
        );
        reply({ type: 'authed' });
      } catch (err) {
        console.error('ws auth failed', err);
        reply({ type: 'error', message: 'try again' });
        ws.close(1011, 'auth unavailable');
      }
    });

    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, heartbeatMs);

    ws.on('error', err => console.error('ws error', err.message));
    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      session?.disconnect();
    });
  });

  return wss;
}
