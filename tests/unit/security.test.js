// Headers, origin check, rate limits, budgets, logs, healthz, lab gating, account deletion (Task 5).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import { runWithUser } from '../../context.js';
import { createApp } from '../../server.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject, testConfig } from './helpers.js';

let app; let pp;
beforeEach(async () => {
  tmpEnv('mp-sec-');
  pp = paypalStub();
});
afterEach(async () => { if (app) await app.close(); app = null; });

async function boot(extra = {}, more = {}) {
  app = await startApp({ paypal: pp, ai: await aiStub(), raw: true, config: testConfig(extra), ...more });
  return app;
}

test('security headers: CSP allows the PayPal sandbox, nosniff, referrer policy', async () => {
  await boot();
  const res = await fetch(app.base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /https:\/\/www\.sandbox\.paypal\.com/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  assert.equal(res.headers.get('strict-transport-security'), null); // not https here
});

test('HSTS when APP_URL is https', async () => {
  await boot({ APP_URL: 'https://milestone-pay.example' });
  assert.match((await fetch(app.base + '/')).headers.get('strict-transport-security'), /max-age=15552000/);
});

test('cross-site and origin-less writes are refused with 403 BAD_ORIGIN', async () => {
  await boot();
  const evil = await fetch(app.base + '/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"name":"x"}' });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).error, 'BAD_ORIGIN');
  const none = await fetch(app.base + '/api/projects', { method: 'POST' });
  assert.equal(none.status, 403);
  const get = await fetch(app.base + '/api/config');
  assert.equal(get.status, 200, 'GET needs no Origin');
});

test('auth routes: the 21st request in a minute from one IP gets 429', async () => {
  await boot();
  for (let i = 0; i < 20; i++) assert.equal((await app.call('POST', '/auth/test-login', { name: `u${i}` })).status, 200);
  const r = await app.call('POST', '/auth/test-login', { name: 'u21' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'RATE_LIMITED');
});

test('AI routes: 10 per minute per user; another user is unaffected', async () => {
  await boot();
  const A = await login(app.call, 'A');
  const B = await login(app.call, 'B');
  const { pid } = await makeProject(A.call); // 2 AI-route calls (create + extract)
  for (let i = 0; i < 8; i++) assert.equal((await A.call('POST', `/api/projects/${pid}/extract`)).status, 200, `call ${i}`);
  const over = await A.call('POST', `/api/projects/${pid}/extract`);
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'RATE_LIMITED');
  const fd = new FormData(); fd.set('chatText', 'Nok: hi\nPloy: hello');
  assert.equal((await B.call('POST', '/api/projects', fd)).status, 201);
});

test('per-user AI budget: one user over the cap is blocked, others are not', async () => {
  await boot({ AI_USER_DAILY_USD: '0.001' });
  runWithUser('usr_a', () => db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.002 }));
  assert.equal(db.load().ai_runs[0].user_id, 'usr_a');
  assert.throws(() => runWithUser('usr_a', () => db.assertBudget()), (e) => e.code === 'BUDGET_EXCEEDED' && e.status === 429);
  assert.doesNotThrow(() => runWithUser('usr_b', () => db.assertBudget()));
});

test('/api/ai-runs shows only the caller\'s runs', async () => {
  await boot();
  const A = await login(app.call, 'A');
  runWithUser(A.user.id, () => db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.01 }));
  runWithUser('usr_other', () => db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.5 }));
  const r = await A.call('GET', '/api/ai-runs');
  assert.equal(r.body.runs.length, 1);
  assert.equal(r.body.total_cost_usd, 0.01);
});

test('/healthz is 200 with the backend name', async () => {
  await boot();
  const r = await app.call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, db: 'file' });
});

test('lab is not mounted in production', async () => {
  const config = testConfig();
  const prod = { ...config, prod: true, nodeEnv: 'production', testAuth: false };
  await boot({}, { config: prod });
  const page = await fetch(app.base + '/lab.html');
  assert.equal(page.status, 404);
  const s = await fetch(app.base + '/api/lab/anything', { headers: { origin: app.base } });
  assert.ok([401, 404].includes(s.status));
  const r = await fetch(app.base + '/api/lab/projects', { method: 'POST', headers: { origin: app.base } });
  assert.notEqual(r.status, 200);
});

test('request log never contains query strings, codes or cookies', async () => {
  const lines = [];
  await boot({}, { logSink: (l) => lines.push(l) });
  await fetch(app.base + '/auth/paypal/callback?code=SECRETCODE&state=x', { redirect: 'manual', headers: { cookie: 'mp_sid=SECRETSID' } });
  const all = lines.join('\n');
  assert.ok(lines.length >= 1);
  assert.ok(!all.includes('SECRETCODE') && !all.includes('SECRETSID'), all);
  const row = JSON.parse(lines[lines.length - 1]);
  assert.deepEqual(Object.keys(row).sort(), ['method', 'ms', 'path', 'status', 't', 'user']);
});

test('DELETE /api/me: refused while a hold is active, otherwise removes projects and sessions', async () => {
  await boot();
  const F = await login(app.call, 'Ploy');
  const C = await login(app.call, 'Nok');
  const { pid, agreement, milestones } = await makeProject(F.call);
  db.load().project_members.push({ project_id: pid, user_id: C.user.id, role: 'client', at: 'x' }); db.save();
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${agreement.id}/approve`);
  await C.call('POST', `/api/agreements/${agreement.id}/approve`, { content_hash: fa.body.agreement.content_hash });
  const o = await C.call('POST', `/api/milestones/${milestones[0].id}/order`);
  await C.call('POST', `/api/milestones/${milestones[0].id}/authorize`, { order_id: o.body.order_id });
  const blocked = await F.call('DELETE', '/api/me');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'ACTIVE_HOLDS');

  const S = await login(app.call, 'Sam');
  const mine = await makeProject(S.call);
  const del = await S.call('DELETE', '/api/me');
  assert.equal(del.status, 200);
  assert.equal(db.load().projects.some((p) => p.id === mine.pid), false);
  assert.equal(db.load().messages.some((m) => m.project_id === mine.pid), false);
  assert.equal(db.load().sessions.some((s) => s.user_id === S.user.id), false);
  const u = db.load().users.find((x) => x.id === S.user.id);
  assert.ok(u.deleted_at);
  assert.equal(u.email, null);
  assert.equal((await S.call('GET', '/api/me')).status, 401);

  // the client cannot leave either while their payment is on hold (it would strand the hold)
  const cdel = await C.call('DELETE', '/api/me');
  assert.equal(cdel.status, 409);
  assert.equal(db.load().projects.some((p) => p.id === pid), true);
});

test('createApp with a production config refuses test-login', async () => {
  const prod = { ...testConfig(), prod: true, nodeEnv: 'production', testAuth: false };
  const a = createApp({ config: prod });
  const server = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/auth/test-login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r.status, 404);
  await new Promise((r2) => server.close(r2));
});

test('index.html carries a per-request CSP nonce that the PayPal SDK can use', async () => {
  await boot();
  const one = await fetch(app.base + '/');
  const html = await one.text();
  const meta = /<meta name="csp-nonce" content="([A-Za-z0-9+/=]{20,})">/.exec(html)?.[1];
  assert.ok(meta, 'nonce meta present');
  assert.ok(one.headers.get('content-security-policy').includes(`'nonce-${meta}'`));
  assert.ok(!html.includes('{{CSP_NONCE}}'));
  const two = await (await fetch(app.base + '/index.html')).text();
  assert.notEqual(/content="([^"]+)">/.exec(two.match(/<meta name="csp-nonce"[^>]*>/)[0])[1], meta);
});

test('DELETE /api/me refused while the user is the client on a milestone with money on hold', async () => {
  await boot();
  const F = await login(app.call, 'Ploy');
  const C = await login(app.call, 'Nok');
  const { pid, agreement, milestones } = await makeProject(F.call);
  db.load().project_members.push({ project_id: pid, user_id: C.user.id, role: 'client', at: 'x' }); db.save();
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${agreement.id}/approve`);
  await C.call('POST', `/api/agreements/${agreement.id}/approve`, { content_hash: fa.body.agreement.content_hash });
  const o = await C.call('POST', `/api/milestones/${milestones[0].id}/order`);
  await C.call('POST', `/api/milestones/${milestones[0].id}/authorize`, { order_id: o.body.order_id });
  const r = await C.call('DELETE', '/api/me');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ACTIVE_HOLDS');
  assert.ok(db.load().project_members.some((m) => m.user_id === C.user.id));
});

test('public /api/config exposes no platform-wide AI spend', async () => {
  await boot();
  const r = await app.call('GET', '/api/config');
  assert.equal(r.body.budget?.today_cost_usd, undefined);
  assert.equal(typeof r.body.budget.blocked, 'boolean');
});

test('project ai_cost counts only runs by the project\'s members', async () => {
  await boot();
  const F = await login(app.call, 'Ploy');
  const { pid } = await makeProject(F.call);
  runWithUser(F.user.id, () => db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.01 }));
  runWithUser('usr_other', () => db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.5 }));
  const v = await F.call('GET', `/api/projects/${pid}`);
  assert.equal(v.body.ai_cost.calls, 1);
  assert.equal(v.body.ai_cost.cost_usd, 0.01);
});

test('rate limits key on the real client IP behind Cloudflare (CF-Connecting-IP), not the proxy hop', async () => {
  await boot();
  const hit = (ip) => fetch(app.base + '/auth/paypal/start?next=/', { redirect: 'manual', headers: { 'cf-connecting-ip': ip } });
  for (let i = 0; i < 20; i++) assert.equal((await hit('203.0.113.7')).status, 302);
  assert.equal((await hit('203.0.113.7')).status, 429, 'same client is limited');
  assert.equal((await hit('198.51.100.9')).status, 302, 'another client is not');
});
