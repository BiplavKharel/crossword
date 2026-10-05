import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Claims } from './app.js';
import { emptyStats, type Stats } from './stats.js';

/** The game a player is in the middle of: the server's clock for their solve time. */
export interface Play {
  puzzleId: string;
  /** Epoch ms when the puzzle was served. */
  startedAt: number;
  /** Epoch ms of the first correct verify, if any. */
  solvedAt?: number;
}

/** One finished match, from one player's point of view. */
export interface MatchRecord {
  matchId: string;
  /** Epoch ms when the match ended. */
  at: number;
  opponent: string;
  vsBot: boolean;
  won: boolean;
  /** `forfeit` means the loser left, or timed out after disconnecting. */
  reason: 'solved' | 'forfeit';
  seconds: number;
  puzzleDate: string;
}

export interface HistoryPage {
  /** Newest first. */
  matches: MatchRecord[];
  /** Pass back as `before` for the next (older) page. Absent on the last page. */
  next?: string;
}

export interface Store {
  /** Wrong guesses by this user on this puzzle in the current window. */
  wrongCount(sub: string, puzzleId: string): Promise<number>;
  addWrong(sub: string, puzzleId: string): Promise<void>;

  /** Sessions are keyed by a hash of the bearer token, so a leaked table can't be replayed. */
  putSession(tokenHash: string, claims: Claims): Promise<void>;
  /** Undefined when unknown or expired. */
  getSession(tokenHash: string): Promise<Claims | undefined>;
  deleteSession(tokenHash: string): Promise<void>;

  getStats(sub: string): Promise<Stats>;
  /** Atomic read-modify-write; `fn` may run more than once under contention. */
  updateStats(sub: string, fn: (s: Stats) => Stats): Promise<Stats>;

  getPlay(sub: string): Promise<Play | undefined>;
  putPlay(sub: string, play: Play): Promise<void>;
  deletePlay(sub: string): Promise<void>;

  putMatch(sub: string, record: MatchRecord): Promise<void>;
  /** A player's matches, newest first. `before` is a cursor from a previous page's `next`. */
  listMatches(sub: string, limit: number, before?: string): Promise<HistoryPage>;
}

export const WINDOW_SECONDS = 60 * 60;
const PLAY_TTL_SECONDS = 24 * 60 * 60;
/** Match history is kept for a year, then DynamoDB's TTL sweeps it away. */
const HISTORY_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Sorts by end time: fixed-width milliseconds, then the match id to break ties. */
export const matchKey = (r: Pick<MatchRecord, 'at' | 'matchId'>) => `MATCH#${String(r.at).padStart(13, '0')}#${r.matchId}`;

const bucket = (nowMs: number) => Math.floor(nowMs / 1000 / WINDOW_SECONDS);

/** Per-process storage for tests and local dev. Not shared across server instances. */
export function memoryStore(now: () => number = Date.now): Store {
  const counts = new Map<string, number>();
  const sessions = new Map<string, Claims>();
  const stats = new Map<string, Stats>();
  const plays = new Map<string, Play>();
  const history = new Map<string, MatchRecord[]>();
  const key = (sub: string, puzzleId: string) => `${sub}#${puzzleId}#${bucket(now())}`;
  return {
    async wrongCount(sub, puzzleId) {
      return counts.get(key(sub, puzzleId)) ?? 0;
    },
    async addWrong(sub, puzzleId) {
      const k = key(sub, puzzleId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
    async putSession(hash, claims) {
      sessions.set(hash, claims);
    },
    async getSession(hash) {
      const c = sessions.get(hash);
      return c && c.exp * 1000 > now() ? c : undefined;
    },
    async deleteSession(hash) {
      sessions.delete(hash);
    },
    async getStats(sub) {
      return stats.get(sub) ?? emptyStats();
    },
    async updateStats(sub, fn) {
      const next = fn(stats.get(sub) ?? emptyStats());
      stats.set(sub, next);
      return next;
    },
    async getPlay(sub) {
      return plays.get(sub);
    },
    async putPlay(sub, play) {
      plays.set(sub, play);
    },
    async deletePlay(sub) {
      plays.delete(sub);
    },
    async putMatch(sub, record) {
      history.set(sub, [...(history.get(sub) ?? []).filter(r => r.matchId !== record.matchId), record]);
    },
    async listMatches(sub, limit, before) {
      const newestFirst = [...(history.get(sub) ?? [])].sort((a, b) => (matchKey(a) < matchKey(b) ? 1 : -1));
      const older = before ? newestFirst.filter(r => matchKey(r) < before) : newestFirst;
      const matches = older.slice(0, limit);
      return older.length > limit ? { matches, next: matchKey(matches[matches.length - 1]) } : { matches };
    },
  };
}

/** Anything with a DocumentClient-shaped `send`, so tests can stub it. */
export type DocClient = Pick<DynamoDBDocumentClient, 'send'>;

export const dynamoClient = (): DocClient =>
  DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

const toStats = (i: Record<string, unknown>): Stats => ({
  played: i.played as number,
  wins: i.wins as number,
  streak: i.streak as number,
  bestTime: (i.bestTime as number | null | undefined) ?? null,
  lastPlayed: (i.lastPlayed as string | null | undefined) ?? null,
});

const toMatch = (i: Record<string, unknown>): MatchRecord => ({
  matchId: i.matchId as string,
  at: i.at as number,
  opponent: i.opponent as string,
  vsBot: i.vsBot as boolean,
  won: i.won as boolean,
  reason: i.reason as 'solved' | 'forfeit',
  seconds: i.seconds as number,
  puzzleDate: i.puzzleDate as string,
});

const isConditionFailure = (e: unknown) => (e as { name?: string })?.name === 'ConditionalCheckFailedException';

/**
 * Single-table layout (all items carry a `ttl` where they should expire; DynamoDB's TTL sweep is
 * lazy, so reads never rely on it):
 *   USER#<sub>      ATTEMPTS#<puzzle>#<hour>   wrong-guess counter, one item per window
 *   USER#<sub>      STATS                      Stats + `version` for optimistic locking
 *   USER#<sub>      PLAY                       the game in progress
 *   SESSION#<hash>  SESSION                    session claims
 */
export function dynamoStore(table: string, doc: DocClient = dynamoClient(), now: () => number = Date.now): Store {
  const user = (sub: string, sk: string) => ({ pk: `USER#${sub}`, sk });
  const session = (hash: string) => ({ pk: `SESSION#${hash}`, sk: 'SESSION' });
  const get = (Key: Record<string, string>) => doc.send(new GetCommand({ TableName: table, Key, ConsistentRead: true }));

  return {
    async wrongCount(sub, puzzleId) {
      const out = await get(user(sub, `ATTEMPTS#${puzzleId}#${bucket(now())}`));
      return (out.Item?.n as number | undefined) ?? 0;
    },
    async addWrong(sub, puzzleId) {
      const expires = (bucket(now()) + 2) * WINDOW_SECONDS;
      await doc.send(
        new UpdateCommand({
          TableName: table,
          Key: user(sub, `ATTEMPTS#${puzzleId}#${bucket(now())}`),
          UpdateExpression: 'ADD n :one SET #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': expires },
        }),
      );
    },

    async putSession(hash, claims) {
      await doc.send(new PutCommand({ TableName: table, Item: { ...session(hash), ...claims, ttl: claims.exp } }));
    },
    async getSession(hash) {
      const { Item: i } = await get(session(hash));
      if (!i || (i.exp as number) * 1000 <= now()) return undefined;
      return { sub: i.sub, email: i.email, name: i.name, picture: i.picture, exp: i.exp };
    },
    async deleteSession(hash) {
      await doc.send(new DeleteCommand({ TableName: table, Key: session(hash) }));
    },

    async getStats(sub) {
      const { Item: i } = await get(user(sub, 'STATS'));
      return i ? toStats(i) : emptyStats();
    },
    async updateStats(sub, fn) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { Item: i } = await get(user(sub, 'STATS'));
        const version = (i?.version as number | undefined) ?? 0;
        const next = fn(i ? toStats(i) : emptyStats());
        try {
          await doc.send(
            new PutCommand({
              TableName: table,
              Item: { ...user(sub, 'STATS'), ...next, version: version + 1 },
              ...(i
                ? { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': version } }
                : { ConditionExpression: 'attribute_not_exists(pk)' }),
            }),
          );
          return next;
        } catch (e) {
          if (!isConditionFailure(e)) throw e; // someone else wrote first: re-read and retry
        }
      }
      throw new Error('stats update contention');
    },

    async getPlay(sub) {
      const { Item: i } = await get(user(sub, 'PLAY'));
      return i && { puzzleId: i.puzzleId, startedAt: i.startedAt, solvedAt: i.solvedAt };
    },
    async putPlay(sub, play) {
      await doc.send(
        new PutCommand({ TableName: table, Item: { ...user(sub, 'PLAY'), ...play, ttl: Math.floor(play.startedAt / 1000) + PLAY_TTL_SECONDS } }),
      );
    },
    async deletePlay(sub) {
      await doc.send(new DeleteCommand({ TableName: table, Key: user(sub, 'PLAY') }));
    },

    async putMatch(sub, record) {
      await doc.send(
        new PutCommand({
          TableName: table,
          Item: { ...user(sub, matchKey(record)), ...record, ttl: Math.floor(record.at / 1000) + HISTORY_TTL_SECONDS },
        }),
      );
    },
    async listMatches(sub, limit, before) {
      // One extra row tells us whether there is another page without an empty round trip.
      const out = await doc.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND sk BETWEEN :lo AND :hi',
          ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':lo': 'MATCH#', ':hi': 'MATCH#\uffff' },
          ScanIndexForward: false,
          Limit: limit + 1,
          ...(before ? { ExclusiveStartKey: { pk: `USER#${sub}`, sk: before } } : {}),
        }),
      );
      const rows = out.Items ?? [];
      const matches = rows.slice(0, limit).map(toMatch);
      return rows.length > limit ? { matches, next: rows[limit - 1].sk as string } : { matches };
    },
  };
}
