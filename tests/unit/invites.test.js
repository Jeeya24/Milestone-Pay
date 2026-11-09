// Client invite links, demo project, Judge act-as (Task 4).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as db from '../../db.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject } from './helpers.js';

let app; let pp; let F; let C; let S;
beforeEach(async () => {
  tmpEnv('mp-inv-');
  pp = paypalStub();
  app = await startApp({ paypal: pp, ai: await aiStub(), raw: true });
  F = await login(app.call, 'Ploy');
  C = await login(app.call, 'Nok');
  S = await login(app.call, 'Sam');
});
afterEach(() => app.close());

const tokenOf = (url) => new URL(url).pathname.split('/').pop();
async function invite(pid) {
  const r = await F.call('POST', `/api/projects/${pid}/invites`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.url, new RegExp(`^${app.base}/invite/[A-Za-z0-9_-]{40,}$`));
  return tokenOf(r.body.url);
}

test('invite then accept: the user becomes the client', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  const peek = await C.call('GET', `/api/invites/${t}`);
  assert.equal(peek.status, 200);
  assert.equal(peek.body.project.id, pid);
  assert.equal(peek.body.freelancer.name, 'Ploy');
  const acc = await C.call('POST', `/api/invites/${t}/accept`);
  assert.equal(acc.status, 200);
  assert.equal(acc.body.project_id, pid);
  const v = await C.call('GET', `/api/projects/${pid}`);
  assert.equal(v.body.my_role, 'client');
});

test('only the freelancer can create invites', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  await C.call('POST', `/api/invites/${t}/accept`);
  const r = await C.call('POST', `/api/projects/${pid}/invites`);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'WRONG_ROLE');
  assert.equal((await S.call('POST', `/api/projects/${pid}/invites`)).status, 404);
});

test('freelancer opening their own invite gets SELF_INVITE', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  const r = await F.call('POST', `/api/invites/${t}/accept`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'SELF_INVITE');
});

test('a second person using a claimed link gets INVITE_USED and the client stays', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  await C.call('POST', `/api/invites/${t}/accept`);
  const r = await S.call('POST', `/api/invites/${t}/accept`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'INVITE_USED');
  assert.equal((await S.call('GET', `/api/projects/${pid}`)).status, 404);
  assert.equal((await C.call('GET', `/api/projects/${pid}`)).body.my_role, 'client');
});

test('accepting the same link twice as the client is fine', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  await C.call('POST', `/api/invites/${t}/accept`);
  const again = await C.call('POST', `/api/invites/${t}/accept`);
  assert.equal(again.status, 200);
  assert.equal(again.body.project_id, pid);
});

test('a new invite revokes the old one', async () => {
  const { pid } = await makeProject(F.call);
  const t1 = await invite(pid);
  await invite(pid);
  const r = await C.call('POST', `/api/invites/${t1}/accept`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'INVITE_USED');
});

test('a fresh invite after the client joined gets CLIENT_TAKEN', async () => {
  const { pid } = await makeProject(F.call);
  await C.call('POST', `/api/invites/${await invite(pid)}/accept`);
  const r = await S.call('POST', `/api/invites/${await invite(pid)}/accept`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'CLIENT_TAKEN');
});

test('expired and unknown invites', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  db.load().invites[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const r = await C.call('POST', `/api/invites/${t}/accept`);
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'INVITE_EXPIRED');
  assert.equal((await C.call('GET', '/api/invites/nope')).status, 404);
});

test('invite tokens are stored hashed', async () => {
  const { pid } = await makeProject(F.call);
  const t = await invite(pid);
  const rows = JSON.stringify(db.load().invites);
  assert.ok(!rows.includes(t));
  assert.ok(rows.includes(crypto.createHash('sha256').update(t).digest('hex')));
});

test('GET /invite/:token redirects into the app', async () => {
  const res = await fetch(`${app.base}/invite/abc_DEF-123`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/invite/abc_DEF-123');
});

test('demo project: freelancer is the user, demo client attached, Judge act-as runs client steps', async () => {
  const r = await F.call('POST', '/api/demo');
  assert.equal(r.status, 201);
  const pid = r.body.project_id;
  const p = db.load().projects.find((x) => x.id === pid);
  assert.equal(p.is_demo, true);
  const v = await F.call('GET', `/api/projects/${pid}`);
  assert.equal(v.body.my_role, 'freelancer');
  assert.equal(v.body.project.is_demo, true);
  assert.equal((await F.call('GET', '/api/projects')).body.projects[0].is_demo, true);
  assert.deepEqual(v.body.members.map((m) => m.role).sort(), ['client', 'freelancer']);
  const a = v.body.agreement;
  for (const g of a.body.gaps) await F.call('POST', `/api/agreements/${a.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${a.id}/approve`);
  const actAs = { 'x-act-as': 'client' };
  const ca = await F.call('POST', `/api/agreements/${a.id}/approve`, { content_hash: fa.body.agreement.content_hash }, actAs);
  assert.equal(ca.status, 200, JSON.stringify(ca.body));
  assert.equal(ca.body.agreement.status, 'approved');
  const m1 = ca.body.milestones[0].id;
  const o = await F.call('POST', `/api/milestones/${m1}/order`, undefined, actAs);
  assert.equal(o.status, 200);
  const au = await F.call('POST', `/api/milestones/${m1}/authorize`, { order_id: o.body.order_id }, actAs);
  assert.equal(au.status, 200);
  assert.equal(db.load().payments[0].payer_user_id, 'usr_demo_client');
  // the demo client can never log in
  assert.equal((await app.call('POST', '/auth/test-login', { name: 'Nok (demo)' })).body.user.id === 'usr_demo_client', false);
});
