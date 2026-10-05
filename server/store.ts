import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/** Wrong-guess counters, used to stop answer brute-forcing on the verify endpoint. */
export interface AttemptStore {
  /** Wrong guesses by this user on this puzzle in the current window. */
  wrongCount(sub: string, puzzleId: string): Promise<number>;
  addWrong(sub: string, puzzleId: string): Promise<void>;
}

export const WINDOW_SECONDS = 60 * 60;

const bucket = (nowMs: number) => Math.floor(nowMs / 1000 / WINDOW_SECONDS);

/** Per-process counters for tests and local dev. Not shared across server instances. */
export function memoryStore(now: () => number = Date.now): AttemptStore {
  const counts = new Map<string, number>();
  const key = (sub: string, puzzleId: string) => `${sub}#${puzzleId}#${bucket(now())}`;
  return {
    async wrongCount(sub, puzzleId) {
      return counts.get(key(sub, puzzleId)) ?? 0;
    },
    async addWrong(sub, puzzleId) {
      const k = key(sub, puzzleId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
  };
}

/** Anything with a DocumentClient-shaped `send`, so tests can stub it. */
export type DocClient = Pick<DynamoDBDocumentClient, 'send'>;

export const dynamoClient = (): DocClient => DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * One item per user + puzzle + hour: pk USER#<sub>, sk ATTEMPTS#<puzzle>#<hour>.
 * Each window is a fresh item, so stale counters never need resetting; DynamoDB TTL
 * sweeps them up later (lazily, so reads never rely on it).
 */
export function dynamoStore(table: string, doc: DocClient = dynamoClient(), now: () => number = Date.now): AttemptStore {
  const keyOf = (sub: string, puzzleId: string) => ({
    pk: `USER#${sub}`,
    sk: `ATTEMPTS#${puzzleId}#${bucket(now())}`,
  });
  return {
    async wrongCount(sub, puzzleId) {
      const out = await doc.send(new GetCommand({ TableName: table, Key: keyOf(sub, puzzleId), ConsistentRead: true }));
      return (out.Item?.n as number | undefined) ?? 0;
    },
    async addWrong(sub, puzzleId) {
      const expires = (bucket(now()) + 2) * WINDOW_SECONDS;
      await doc.send(
        new UpdateCommand({
          TableName: table,
          Key: keyOf(sub, puzzleId),
          UpdateExpression: 'ADD n :one SET #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': expires },
        }),
      );
    },
  };
}
