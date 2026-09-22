import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { getUser } from '../functions/_lib/auth.js';

const domain = 'sample.cloudflareaccess.com';
const env = { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: 'app-a,app-b', ALLOWED_EMAILS: 'alice@example.com,bob@example.com' };
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
async function token({ email = 'ALICE@EXAMPLE.COM', audience = 'app-a', expires = '1h' } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(`https://${domain}`).setAudience(audience).setIssuedAt().setExpirationTime(expires).sign(privateKey);
}
const request = (url, value) => new Request(url, { headers: value ? { 'Cf-Access-Jwt-Assertion': value } : {} });

test('valid Access JWT resolves lowercased allowed identity', async () => {
  assert.deepEqual(await getUser(request('https://app.example.com/', await token()), env, { jwks }), { email: 'alice@example.com' });
});
test('expired, wrong audience, unlisted email and missing JWT are rejected', async () => {
  for (const value of [await token({ expires: '-1h' }), await token({ audience: 'wrong' }), await token({ email: 'mallory@example.com' }), null]) {
    await assert.rejects(getUser(request('https://app.example.com/', value), env, { jwks }));
  }
});
test('DEV_USER_EMAIL bypass exists only on localhost and 127.0.0.1', async () => {
  const localEnv = { ...env, DEV_USER_EMAIL: 'Dev@Example.com' };
  assert.equal((await getUser(request('http://localhost:8788/'), localEnv)).email, 'dev@example.com');
  assert.equal((await getUser(request('http://127.0.0.1:8788/'), localEnv)).email, 'dev@example.com');
  await assert.rejects(getUser(request('https://app.example.com/'), localEnv, { jwks }));
});
