import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp, type Verifier } from './app.js';

const verify: Verifier = async t => {
  if (t !== 'good') throw new Error('bad');
  return { sub: '1', email: 'a@b.c', name: 'A', exp: 9e9 };
};

let base = '';
let close: () => void;
before(() => {
  const server = createApp(verify).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

const post = (body: unknown) =>
  fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('valid credential returns the verified user', async () => {
  const res = await post({ credential: 'good' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, 'a@b.c');
});
test('invalid credential is rejected', async () => assert.equal((await post({ credential: 'forged' })).status, 401));
test('missing credential is a bad request', async () => assert.equal((await post({})).status, 400));
test('/api/me needs a valid bearer token', async () => {
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer forged' } })).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: 'Bearer good' } })).status, 200);
});
