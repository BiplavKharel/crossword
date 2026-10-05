import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { before, mock, test } from 'node:test';
import { OAuth2Client } from 'google-auth-library';
import { googleVerifier } from './verify.js';

// Exercises the real googleVerifier with locally signed tokens. Google's key
// endpoint is stubbed so the tests need no network.
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const KID = 'test-key';

const b64 = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

function mint(claims: Record<string, unknown> = {}, privateKey = keys.privateKey) {
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
  const payload = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '123',
    email: 'a@b.c',
    email_verified: true,
    name: 'A',
    iat: now(),
    exp: now() + 3600,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64(sig)}`;
}

const verify = googleVerifier(CLIENT_ID);

before(() => {
  mock.method(OAuth2Client.prototype, 'getFederatedSignonCertsAsync', async () => ({
    certs: { [KID]: keys.publicKey.export({ type: 'spki', format: 'pem' }) as string },
    format: 'PEM',
  }));
});

test('accepts a valid token and returns its claims', async () => {
  const user = await verify(mint({ picture: 'http://p' }));
  assert.equal(user.sub, '123');
  assert.equal(user.email, 'a@b.c');
  assert.equal(user.name, 'A');
  assert.equal(user.picture, 'http://p');
});

test('accepts the bare accounts.google.com issuer', async () => {
  await verify(mint({ iss: 'accounts.google.com' }));
});

test('falls back to email when name is missing', async () => {
  assert.equal((await verify(mint({ name: undefined }))).name, 'a@b.c');
});

test('rejects an expired token', async () => {
  await assert.rejects(verify(mint({ iat: now() - 7200, exp: now() - 3600 })));
});

test('rejects a token minted for another client ID', async () => {
  await assert.rejects(verify(mint({ aud: 'someone-else.apps.googleusercontent.com' })));
});

test('rejects an untrusted issuer', async () => {
  await assert.rejects(verify(mint({ iss: 'https://evil.example.com' })));
});

test('rejects a token signed by a different key', async () => {
  await assert.rejects(verify(mint({}, otherKeys.privateKey)));
});

test('rejects a tampered payload', async () => {
  const [h, , s] = mint().split('.');
  await assert.rejects(verify(`${h}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'admin', email: 'x@y.z', email_verified: true, exp: now() + 3600 })}.${s}`));
});

test('rejects an unverified email', async () => {
  await assert.rejects(verify(mint({ email_verified: false })), /unusable claims/);
});

test('rejects a token with no email', async () => {
  await assert.rejects(verify(mint({ email: undefined })), /unusable claims/);
});

test('rejects garbage and the dev guest token', async () => {
  await assert.rejects(verify('not-a-jwt'));
  await assert.rejects(verify('guest'));
  await assert.rejects(verify(''));
});
