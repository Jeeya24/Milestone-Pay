// Log in with PayPal, sessions, config (Task 2).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as db from '../../db.js';
import { createApp } from '../../server.js';
import { loadConfig } from '../../config.js';
import { tmpEnv } from './helpers.js';

const AUTHZ = 'https://www.sandbox.paypal.com/signin/authorize';

function identityStub(info = { user_id: 'https://www.paypal.com/webapps/auth/identity/user/AAA', email: 'nok@example.com', name: 'Nok P' }) {
  const calls = { exchange: [], userInfo: [] };
  return {
    calls,
    exchangeCode: async (code, redirectUri) => { calls.exchange.push({ code, redirectUri }); return { access_token: 'AT-' + code }; },
    userInfo: async (token) => { calls.userInfo.push(token); return info; },
  };
}

let server; let base; let identity;
async function boot(cfg = {}, id = identityStub()) {
  identity = id;
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(40), TEST_AUTH: '1', ...cfg });
  const app = createApp({ identity, config, agentOpts: { forceFallback: true } });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}
beforeEach(() => tmpEnv('mp-auth-'));
afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });

const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie, origin: base } : { origin: base } });
const post = (path, body, cookie) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body ?? {}),
});
const cookiesOf = (res) => res.headers.getSetCookie();
const pick = (res, name) => cookiesOf(res).find((c) => c.startsWith(name + '='));
const pair = (setCookie) => setCookie.split(';')[0];

async function startLogin(next = '/') {
  const res = await get('/auth/paypal/start?next=' + encodeURIComponent(next));
  const loc = new URL(res.headers.get('location'));
  return { res, loc, state: loc.searchParams.get('state'), oauth: pair(pick(res, 'mp_oauth')) };
}
async function fullLogin(next = '/') {
  const { state, oauth } = await startLogin(next);
  const res = await get(`/auth/paypal/callback?code=C1&state=${state}`, oauth);
  return { res, sid: pick(res, 'mp_sid') };
}

test('start sets signed state and redirects to the sandbox authorize URL', async () => {
  await boot();
  const { res, loc, state, oauth } = await startLogin('/#/p/prj_1');
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('location').startsWith(AUTHZ + '?'));
  assert.match(res.headers.get('location'), /scope=openid%20email%20profile/);
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('redirect_uri'), `${base}/auth/paypal/callback`);
  assert.ok(state && state.length >= 20);
  assert.match(pick(res, 'mp_oauth'), /HttpOnly/i);
  assert.ok(oauth.includes('.'), 'cookie carries a signature');
});

test('callback rejects a bad state and creates no session', async () => {
  await boot();
  const { oauth } = await startLogin();
  const res = await get('/auth/paypal/callback?code=C1&state=forged', oauth);
  assert.equal(res.status, 302, 'a browser lands on the login screen, not raw JSON');
  assert.equal(res.headers.get('location'), '/?login=failed');
  assert.equal(db.load().sessions.length, 0);
  assert.equal(identity.calls.exchange.length, 0);
});

test('callback rejects a tampered state cookie', async () => {
  await boot();
  const { state, oauth } = await startLogin();
  const [v] = oauth.split('.');
  const res = await get(`/auth/paypal/callback?code=C1&state=${state}`, `${v}.AAAA`);
  assert.equal(res.headers.get('location'), '/?login=failed');
  assert.equal(db.load().sessions.length, 0);
});

test('user cancels at PayPal: callback with error=access_denied redirects to login, not 500', async () => {
  await boot();
  const { state, oauth } = await startLogin();
  const res = await get(`/auth/paypal/callback?error=access_denied&state=${state}`, oauth);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?login=cancelled');
});

test('callback happy path: upserts user, sets session cookie, redirects to next', async () => {
  await boot();
  const a = await fullLogin('/#/p/prj_1');
  assert.equal(a.res.status, 302);
  assert.equal(a.res.headers.get('location'), '/#/p/prj_1');
  assert.match(a.sid, /HttpOnly/i);
  assert.match(a.sid, /SameSite=Lax/i);
  assert.doesNotMatch(a.sid, /Secure/i); // APP_URL is not https here
  assert.equal(identity.calls.exchange[0].redirectUri, `${base}/auth/paypal/callback`);
  const me = await (await get('/api/me', pair(a.sid))).json();
  assert.equal(me.user.name, 'Nok P');
  assert.equal(me.user.email, 'nok@example.com');
  assert.ok(me.user.id.startsWith('usr_'));
  const b = await fullLogin();
  assert.equal(db.load().users.length, 1, 'same PayPal user, one row');
  assert.notEqual(pair(a.sid), pair(b.sid), 'a new session token per login');
});

test('next must be an internal path (no open redirect)', async () => {
  await boot();
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const { res } = await fullLogin(bad);
    assert.equal(res.headers.get('location'), '/', bad);
  }
});

test('sessions are stored hashed, never the raw token', async () => {
  await boot();
  const { sid } = await fullLogin();
  const raw = pair(sid).split('=')[1];
  const rows = JSON.stringify(db.load().sessions);
  assert.ok(!rows.includes(raw));
  assert.ok(rows.includes(crypto.createHash('sha256').update(raw).digest('hex')));
});

test('PayPal token exchange failure redirects to login with an error', async () => {
  const id = identityStub();
  id.exchangeCode = async () => { throw new Error('PayPal 401'); };
  await boot({}, id);
  const { state, oauth } = await startLogin();
  const res = await get(`/auth/paypal/callback?code=C1&state=${state}`, oauth);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?login=failed');
});

test('expired session gets 401 and is pruned', async () => {
  await boot();
  const { sid } = await fullLogin();
  db.load().sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const res = await get('/api/me', pair(sid));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'UNAUTHENTICATED');
  assert.equal(db.load().sessions.length, 0);
});

test('logout deletes the session; /api/me is then 401', async () => {
  await boot();
  const { sid } = await fullLogin();
  const out = await post('/auth/logout', {}, pair(sid));
  assert.equal(out.status, 200);
  assert.match(pick(out, 'mp_sid'), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal(db.load().sessions.length, 0);
  assert.equal((await get('/api/me', pair(sid))).status, 401);
});

test('test-login works with TEST_AUTH and is absent in production', async () => {
  await boot();
  const r = await post('/auth/test-login', { name: 'Ploy' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.name, 'Ploy');
  await new Promise((res) => server.close(res));
  await boot({
    NODE_ENV: 'production', TEST_AUTH: '1', DATABASE_URL: 'postgres://x', APP_URL: 'https://a.example',
    PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', GOOGLE_GENERATIVE_AI_API_KEY: 'c',
  });
  assert.equal((await post('/auth/test-login', { name: 'Ploy' })).status, 404);
});

test('loadConfig lists every missing production var by name, never values', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', PAYPAL_CLIENT_SECRET: 'supersecretvalue' }),
    (e) => {
      for (const k of ['DATABASE_URL', 'APP_URL', 'SESSION_SECRET', 'PAYPAL_CLIENT_ID', 'GOOGLE_GENERATIVE_AI_API_KEY']) assert.match(e.message, new RegExp(k));
      assert.doesNotMatch(e.message, /supersecretvalue/);
      assert.doesNotMatch(e.message, /PAYPAL_CLIENT_SECRET/);
      return true;
    },
  );
  assert.equal(loadConfig({ NODE_ENV: 'production', TEST_AUTH: '1', DATABASE_URL: 'x', APP_URL: 'https://a', SESSION_SECRET: 's'.repeat(32), PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', GOOGLE_GENERATIVE_AI_API_KEY: 'c' }).testAuth, false);
  assert.ok(loadConfig({}).sessionSecret.length >= 32, 'dev gets a random secret');
});

test('Secure cookie when APP_URL is https', async () => {
  await boot({ APP_URL: 'https://milestone-pay.example' });
  const r = await post('/auth/test-login', { name: 'Ploy' });
  assert.match(pick(r, 'mp_sid'), /Secure/);
});

test('cancel and failure keep the screen the user was going to (invite link survives)', async () => {
  await boot();
  let { state, oauth } = await startLogin('/#/invite/tok_123');
  let res = await get(`/auth/paypal/callback?error=access_denied&state=${state}`, oauth);
  assert.equal(res.headers.get('location'), '/?login=cancelled#/invite/tok_123');
  ({ state, oauth } = await startLogin('/?judge=1#/p/prj_1'));
  res = await get(`/auth/paypal/callback?error=access_denied&state=${state}`, oauth);
  assert.equal(res.headers.get('location'), '/?judge=1&login=cancelled#/p/prj_1');
});

test('production is assumed when DATABASE_URL and an https APP_URL are set, even without NODE_ENV', () => {
  const env = { TEST_AUTH: '1', RATE_LIMITS: 'off', DATABASE_URL: 'postgres://x', APP_URL: 'https://a.example', SESSION_SECRET: 's'.repeat(32), PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', GOOGLE_GENERATIVE_AI_API_KEY: 'c' };
  const c = loadConfig(env);
  assert.equal(c.prod, true);
  assert.equal(c.testAuth, false);
  assert.ok(c.rateLimits);
  assert.throws(() => loadConfig({ ...env, SESSION_SECRET: '' }), /SESSION_SECRET/);
});
