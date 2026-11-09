// Per-project roles on every route (Task 3). F = freelancer, C = client, S = stranger.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject, PNG } from './helpers.js';

let app; let pp; let F; let C; let S;
beforeEach(async () => {
  tmpEnv('mp-access-');
  pp = paypalStub();
  app = await startApp({ paypal: pp, ai: await aiStub(), raw: true });
  F = await login(app.call, 'Ploy');
  C = await login(app.call, 'Nok');
  S = await login(app.call, 'Sam');
});
afterEach(() => app.close());

const joinClient = (pid, user) => { db.load().project_members.push({ project_id: pid, user_id: user.id, role: 'client', at: new Date().toISOString() }); db.save(); };

/** Project with M1 submitted and a pending release proposal. */
async function journey() {
  const { pid, agreement, milestones } = await makeProject(F.call);
  joinClient(pid, C.user);
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${agreement.id}/approve`);
  assert.equal(fa.status, 200, JSON.stringify(fa.body));
  const ca = await C.call('POST', `/api/agreements/${agreement.id}/approve`, { content_hash: fa.body.agreement.content_hash });
  assert.equal(ca.status, 200, JSON.stringify(ca.body));
  const m1 = milestones[0].id;
  const o = await C.call('POST', `/api/milestones/${m1}/order`);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const au = await C.call('POST', `/api/milestones/${m1}/authorize`, { order_id: o.body.order_id });
  assert.equal(au.status, 200, JSON.stringify(au.body));
  const fd = new FormData(); fd.append('files', new Blob([PNG]), 'a.png');
  const up = await F.call('POST', `/api/milestones/${m1}/deliverables`, fd);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const sub = await F.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return { pid, agreement, m1, m2: milestones[1].id, proposal: sub.body.proposal, dlv: up.body.deliverables[0].id };
}

test('unauthenticated /api calls get 401 (except /api/config)', async () => {
  assert.equal((await app.call('GET', '/api/projects')).status, 401);
  assert.equal((await app.call('GET', '/api/config')).status, 200);
});

test('stranger gets 404 on every route family', async () => {
  const j = await journey();
  const probes = [
    ['GET', `/api/projects/${j.pid}`],
    ['POST', `/api/projects/${j.pid}/extract`],
    ['POST', `/api/agreements/${j.agreement.id}/approve`, {}],
    ['POST', `/api/agreements/${j.agreement.id}/gaps/g1/fix`],
    ['PATCH', `/api/milestones/${j.m2}`, { amount_minor: 1 }],
    ['POST', `/api/milestones/${j.m2}/order`],
    ['POST', `/api/milestones/${j.m1}/authorize`, { order_id: 'x' }],
    ['POST', `/api/milestones/${j.m1}/deliverables`],
    ['POST', `/api/milestones/${j.m1}/submit`],
    ['GET', `/api/deliverables/${j.dlv}/download`],
    ['POST', `/api/milestones/${j.m1}/revision`, { note: 'please change' }],
    ['POST', `/api/proposals/${j.proposal.id}/approve`, {}],
    ['POST', `/api/proposals/${j.proposal.id}/cancel`, {}],
    ['POST', `/api/projects/${j.pid}/change-requests`, { message: 'add a page please' }],
    ['POST', `/api/projects/${j.pid}/refresh`],
    ['POST', '/api/agent/run', { event: 'milestone.submitted', milestone_id: j.m1 }],
    ['POST', '/api/agent/guardrail-test', { milestone_id: j.m1 }],
  ];
  for (const [method, url, body] of probes) {
    const r = await S.call(method, url, body);
    assert.equal(r.status, 404, `${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal(pp.calls.capture.length, 0);
});

test('role matrix: wrong role gets 403 WRONG_ROLE', async () => {
  const j = await journey();
  const cases = [
    [C, 'POST', `/api/milestones/${j.m1}/submit`],
    [C, 'POST', `/api/projects/${j.pid}/extract`],
    [F, 'POST', `/api/proposals/${j.proposal.id}/approve`, {}],
    [F, 'POST', `/api/proposals/${j.proposal.id}/cancel`, {}],
    [F, 'POST', `/api/milestones/${j.m1}/revision`, { note: 'please change' }],
    [F, 'POST', `/api/milestones/${j.m2}/order`],
  ];
  for (const [who, method, url, body] of cases) {
    const r = await who.call(method, url, body);
    assert.equal(r.status, 403, `${who.user.name} ${method} ${url} -> ${r.status}`);
    assert.equal(r.body.error, 'WRONG_ROLE');
  }
  assert.equal(pp.calls.capture.length, 0);
});

test('party in body is ignored: the session decides the role', async () => {
  const { pid, agreement } = await makeProject(F.call);
  joinClient(pid, C.user);
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const r = await F.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'client', content_hash: 'x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.status, 'sent');
  const ap = db.load().approvals.filter((a) => a.agreement_id === agreement.id);
  assert.deepEqual(ap.map((a) => a.party), ['freelancer']);
  assert.equal(ap[0].user_id, F.user.id);
});

test('dashboard lists only member projects with my_role; totals cover freelancer projects', async () => {
  const j = await journey();
  const mine = await makeProject(S.call); // S is freelancer on their own project
  const f = await F.call('GET', '/api/projects');
  assert.deepEqual(f.body.projects.map((p) => [p.id, p.my_role]), [[j.pid, 'freelancer']]);
  assert.ok(f.body.totals.held_minor > 0);
  const c = await C.call('GET', '/api/projects');
  assert.deepEqual(c.body.projects.map((p) => [p.id, p.my_role]), [[j.pid, 'client']]);
  assert.equal(c.body.totals.held_minor, 0);
  const s = await S.call('GET', '/api/projects');
  assert.deepEqual(s.body.projects.map((p) => p.id), [mine.pid]);
});

test('project view has my_role and members (names only, no emails)', async () => {
  const j = await journey();
  const v = await C.call('GET', `/api/projects/${j.pid}`);
  assert.equal(v.body.my_role, 'client');
  assert.deepEqual(v.body.members.map((m) => [m.role, m.name]).sort(), [['client', 'Nok'], ['freelancer', 'Ploy']]);
  assert.ok(!JSON.stringify(v.body.members).includes('@'));
});

test('X-Act-As: client is ignored on non-demo projects', async () => {
  const j = await journey();
  const r = await F.call('POST', `/api/proposals/${j.proposal.id}/approve`, {}, { 'x-act-as': 'client' });
  assert.equal(r.status, 403);
  assert.equal(pp.calls.capture.length, 0);
});

test('authorize with an order made for another milestone -> 409 ORDER_MISMATCH', async () => {
  const j = await journey();
  const r = await C.call('POST', `/api/milestones/${j.m2}/authorize`, { order_id: db.load().payments[0].order_id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ORDER_MISMATCH');
});

test('approvals, payments and proposals record who acted', async () => {
  const j = await journey();
  const pay = db.load().payments.find((p) => p.milestone_id === j.m1);
  assert.equal(pay.payer_user_id, C.user.id);
  const r = await C.call('POST', `/api/proposals/${j.proposal.id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const prop = db.load().proposals.find((p) => p.id === j.proposal.id);
  assert.equal(prop.approved_by_user, C.user.id);
  assert.equal(pp.calls.capture.length, 1);
});

test('capture refused when the approval was not made by the client member', async () => {
  const realAgent = await import('../../agent.js');
  const j = await journey();
  const prop = db.load().proposals.find((p) => p.id === j.proposal.id);
  Object.assign(prop, { status: 'approved', approved_by: 'client', approved_by_user: F.user.id }); // forged
  db.save();
  const direct = await realAgent.captureExecutor({ milestone_id: j.m1, proposal_id: prop.id }, { paypal: pp });
  assert.equal(direct.error, 'NO_APPROVAL');
  await realAgent.runAgent('proposal.approved', j.m1, { paypal: pp, forceFallback: true });
  assert.equal(pp.calls.capture.length, 0);
  assert.equal(db.load().milestones.find((m) => m.id === j.m1).status, 'submitted');
});

test('new project makes the creator its freelancer', async () => {
  const { pid } = await makeProject(S.call);
  const p = db.load().projects.find((x) => x.id === pid);
  assert.equal(p.owner_id, S.user.id);
  assert.equal(p.is_demo, false);
  assert.equal(p.payee_merchant_id, null);
  assert.deepEqual(db.load().project_members.filter((m) => m.project_id === pid).map((m) => [m.role, m.user_id]), [['freelancer', S.user.id]]);
});
