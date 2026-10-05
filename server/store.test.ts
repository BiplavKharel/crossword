import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoStore, memoryStore, WINDOW_SECONDS, type DocClient } from './store.js';

const HOUR = WINDOW_SECONDS * 1000;

test('memory store counts per user and puzzle', async () => {
  const s = memoryStore();
  await s.addWrong('u1', 'p1');
  await s.addWrong('u1', 'p1');
  await s.addWrong('u1', 'p2');
  assert.equal(await s.wrongCount('u1', 'p1'), 2);
  assert.equal(await s.wrongCount('u1', 'p2'), 1);
  assert.equal(await s.wrongCount('u2', 'p1'), 0);
});

test('memory store resets in the next hour window', async () => {
  let t = 10 * HOUR;
  const s = memoryStore(() => t);
  await s.addWrong('u', 'p');
  assert.equal(await s.wrongCount('u', 'p'), 1);
  t += HOUR;
  assert.equal(await s.wrongCount('u', 'p'), 0);
});

// A DocumentClient stand-in that records commands and answers GETs from a canned item.
function fakeDoc(item?: Record<string, unknown>) {
  const sent: unknown[] = [];
  const doc = { send: async (cmd: unknown) => (sent.push(cmd), cmd instanceof GetCommand ? { Item: item } : {}) } as unknown as DocClient;
  return { doc, sent };
}

test('dynamo store reads the current window item with a consistent read', async () => {
  const { doc, sent } = fakeDoc({ n: 4 });
  const s = dynamoStore('tbl', doc, () => 3 * HOUR + 5);
  assert.equal(await s.wrongCount('u1', 'p1'), 4);
  const cmd = sent[0] as GetCommand;
  assert.equal(cmd.input.TableName, 'tbl');
  assert.deepEqual(cmd.input.Key, { pk: 'USER#u1', sk: 'ATTEMPTS#p1#3' });
  assert.equal(cmd.input.ConsistentRead, true);
});

test('dynamo store treats a missing item as zero', async () => {
  assert.equal(await dynamoStore('tbl', fakeDoc().doc).wrongCount('u', 'p'), 0);
});

test('dynamo store increments atomically and sets a TTL past the window', async () => {
  const { doc, sent } = fakeDoc();
  await dynamoStore('tbl', doc, () => 3 * HOUR + 5).addWrong('u1', 'p1');
  const { input } = sent[0] as UpdateCommand;
  assert.deepEqual(input.Key, { pk: 'USER#u1', sk: 'ATTEMPTS#p1#3' });
  assert.equal(input.UpdateExpression, 'ADD n :one SET #ttl = :ttl');
  assert.equal(input.ExpressionAttributeValues?.[':one'], 1);
  // Window 3 ends at 4h; the item is kept one extra hour before expiring.
  assert.equal(input.ExpressionAttributeValues?.[':ttl'], 5 * WINDOW_SECONDS);
});

// ---- sessions, stats and plays through the DynamoDB store

/** A tiny table that understands the commands the store sends, including its conditional puts. */
function fakeTable(opts: { failPuts?: number } = {}) {
  const items = new Map<string, Record<string, unknown>>();
  const id = (k: Record<string, unknown>) => `${k.pk}|${k.sk}`;
  let failPuts = opts.failPuts ?? 0;
  const doc = {
    send: async (cmd: unknown) => {
      if (cmd instanceof GetCommand) return { Item: items.get(id(cmd.input.Key!)) };
      if (cmd instanceof DeleteCommand) {
        items.delete(id(cmd.input.Key!));
        return {};
      }
      if (cmd instanceof PutCommand) {
        const item = cmd.input.Item!;
        const cur = items.get(id(item));
        const cond = cmd.input.ConditionExpression;
        const ok = !cond || (cond === 'attribute_not_exists(pk)' ? !cur : cur?.version === cmd.input.ExpressionAttributeValues?.[':v']);
        if (!ok || failPuts-- > 0) throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
        items.set(id(item), item);
        return {};
      }
      throw new Error(`unexpected ${(cmd as object).constructor.name}`);
    },
  } as unknown as DocClient;
  return { doc, items };
}

const claims = { sub: 'u1', email: 'a@b.c', name: 'A', picture: undefined, exp: 2000 };

test('dynamo sessions round-trip, expire, and delete', async () => {
  const { doc, items } = fakeTable();
  let now = 1_000_000; // ms
  const s = dynamoStore('tbl', doc, () => now);
  await s.putSession('hash1', claims);
  assert.equal(items.get('SESSION#hash1|SESSION')?.ttl, 2000); // DynamoDB sweeps it when it expires
  assert.deepEqual(await s.getSession('hash1'), claims);
  assert.equal(await s.getSession('nope'), undefined);
  now = 2_000_000; // exactly at exp: no longer valid even before the TTL sweep runs
  assert.equal(await s.getSession('hash1'), undefined);
  now = 1_000_000;
  await s.deleteSession('hash1');
  assert.equal(await s.getSession('hash1'), undefined);
});

test('dynamo stats start empty, then create and update with a version', async () => {
  const { doc, items } = fakeTable();
  const s = dynamoStore('tbl', doc);
  assert.deepEqual(await s.getStats('u1'), { played: 0, wins: 0, streak: 0, bestTime: null, lastPlayed: null });
  const first = await s.updateStats('u1', x => ({ ...x, played: x.played + 1, wins: 1, bestTime: 50 }));
  assert.equal(first.played, 1);
  assert.equal(items.get('USER#u1|STATS')?.version, 1);
  await s.updateStats('u1', x => ({ ...x, played: x.played + 1 }));
  assert.equal(items.get('USER#u1|STATS')?.version, 2);
  assert.deepEqual(await s.getStats('u1'), { played: 2, wins: 1, streak: 0, bestTime: 50, lastPlayed: null });
});

test('dynamo stats retry when another writer got there first', async () => {
  const { doc } = fakeTable({ failPuts: 2 });
  let runs = 0;
  const out = await dynamoStore('tbl', doc).updateStats('u1', x => (runs++, { ...x, played: x.played + 1 }));
  assert.equal(out.played, 1);
  assert.equal(runs, 3); // recomputed on each retry
});

test('dynamo stats give up under constant contention instead of looping', async () => {
  const { doc } = fakeTable({ failPuts: 99 });
  await assert.rejects(dynamoStore('tbl', doc).updateStats('u1', x => x), /contention/);
});

test('dynamo play record round-trips with a TTL, and can be dropped', async () => {
  const { doc, items } = fakeTable();
  const s = dynamoStore('tbl', doc);
  assert.equal(await s.getPlay('u1'), undefined);
  await s.putPlay('u1', { puzzleId: 'p', startedAt: 5_000_000 });
  assert.equal(items.get('USER#u1|PLAY')?.ttl, 5000 + 86400);
  assert.deepEqual(await s.getPlay('u1'), { puzzleId: 'p', startedAt: 5_000_000, solvedAt: undefined });
  await s.deletePlay('u1');
  assert.equal(await s.getPlay('u1'), undefined);
});
