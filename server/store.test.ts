import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
