import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import * as realAgent from '../../agent.js';
import { tmpEnv, startApp, aiStub, paypalStub, makeProject, approveBoth } from './helpers.js';

let app, ai, summaries;
afterEach(() => app.close());

const draft = { label: 'M4', title: 'Online ordering page', deliverables: ['Order page', 'Cart'], amount_minor: 20000, price_basis: '$800 / 4 pages' };
const verdict = (over = {}) => ({
  classification: 'new_work', reason: 'Not in the 4 pages', reason_source_ids: ['m3'], ai_draft: structuredClone(draft),
  usage: {}, ...over,
});

async function setup({ approved = true, result } = {}) {
  tmpEnv('mp-s7-');
  summaries = [];
  ai = await aiStub({ classifyChange: async (s, text) => { summaries.push({ s, text }); return result ?? verdict(); } });
  const pp = paypalStub();
  app = await startApp({ paypal: pp, ai, agent: realAgent });
  const proj = await makeProject(app.call);
  if (approved) await approveBoth(app.call, proj.agreement.id);
  return { ...proj, pp };
}
const create = (pid, message = 'Can you add an online ordering page?', from = 'client') =>
  app.call('POST', `/api/projects/${pid}/change-requests`, { message, from });

test('create: stores ai_draft and a copy in draft; classifier sees the frozen summary, never the chat', async () => {
  const { pid } = await setup();
  db.load().messages.push({ project_id: pid, msg_id: 'm77', seq: 77, sender: 'Nok', me: false, time: null, text: 'CHATSECRET' });
  const r = await create(pid);
  assert.equal(r.status, 201);
  const c = r.body.change_request;
  assert.match(c.id, /^cr_/);
  assert.equal(c.status, 'open');
  assert.equal(c.from, 'client');
  assert.equal(c.classification, 'new_work');
  assert.deepEqual(c.ai_draft, draft);
  assert.deepEqual(c.draft, draft);
  assert.notEqual(c.draft, c.ai_draft);
  assert.equal(c.sent_version, null);
  assert.equal(summaries[0].text, 'Can you add an online ordering page?');
  assert.deepEqual(summaries[0].s.milestones.map((m) => [m.label, m.amount_minor, m.status]), [['M1', 240000, 'agreed'], ['M2', 320000, 'agreed'], ['M3', 240000, 'agreed']]);
  assert.equal(summaries[0].s.total_minor, 800000);
  assert.ok(!JSON.stringify(summaries).includes('CHATSECRET'));
  const g = (await app.call('GET', `/api/projects/${pid}`)).body;
  assert.equal(g.change_requests.length, 1);
  assert.deepEqual(g.project.open_change_request, { id: c.id, from: 'client', status: 'open' });
  const dash = (await app.call('GET', '/api/projects')).body.projects.find((p) => p.id === pid);
  assert.deepEqual(dash.open_change_request, { id: c.id, from: 'client', status: 'open' });
  assert.ok(g.notifications.some((n) => n.to === 'freelancer'));
});

test('create: validation errors', async () => {
  const { pid } = await setup();
  assert.equal((await create(pid, 'hey')).body.error, 'MESSAGE_TOO_SHORT');
  // `from` in the body is ignored now: the session's role decides (see access.test.js)
  assert.equal((await create('prj_nope')).status, 404);
  assert.equal(summaries.length, 0);
  const long = await create(pid, 'x'.repeat(5000));
  assert.equal(long.body.change_request.text.length, 1000);
});

test('create before the agreement is approved: AGREEMENT_NOT_APPROVED', async () => {
  const { pid } = await setup({ approved: false });
  const r = await create(pid);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'AGREEMENT_NOT_APPROVED');
});

test('a second open request returns 409 OPEN_REQUEST_EXISTS (also while sent, and concurrently)', async () => {
  const { pid } = await setup();
  const [a, b] = await Promise.all([create(pid), create(pid)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(summaries.length, 1);
  const c = a.status === 201 ? a.body.change_request : b.body.change_request;
  await app.call('POST', `/api/change-requests/${c.id}/send`);
  const again = await create(pid, 'another thing please');
  assert.equal(again.body.error, 'OPEN_REQUEST_EXISTS');
  await app.call('POST', `/api/change-requests/${c.id}/close`);
  assert.equal((await create(pid, 'another thing please')).status, 201);
});

test('PATCH trims and edits the draft; after send it is 409 FROZEN; ai_draft stays untouched', async () => {
  const { pid } = await setup();
  const c = (await create(pid)).body.change_request;
  const long = 'y'.repeat(300);
  const p = await app.call('PATCH', `/api/change-requests/${c.id}`, { title: `  <img src=x onerror=alert(1)> ${long}  `, deliverables: [' one ', '', long], amount_minor: 25000 });
  assert.equal(p.status, 200);
  assert.equal(p.body.change_request.draft.title.length, 120);
  assert.ok(p.body.change_request.draft.title.startsWith('<img src=x'));
  assert.deepEqual(p.body.change_request.draft.deliverables, ['one', 'y'.repeat(120)]);
  assert.equal(p.body.change_request.draft.amount_minor, 25000);
  assert.deepEqual(p.body.change_request.ai_draft, draft);
  assert.equal((await app.call('PATCH', `/api/change-requests/${c.id}`, { amount_minor: 1.5 })).body.error, 'BAD_AMOUNT');
  const s = await app.call('POST', `/api/change-requests/${c.id}/send`);
  assert.equal(s.status, 200);
  const late = await app.call('PATCH', `/api/change-requests/${c.id}`, { amount_minor: 1 });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'FROZEN');
});

test('send: TITLE_REQUIRED, DELIVERABLE_REQUIRED, NOT_NEW_WORK; stores sent_version AND ai_draft', async () => {
  const { pid } = await setup();
  const c = (await create(pid)).body.change_request;
  await app.call('PATCH', `/api/change-requests/${c.id}`, { title: '   ' });
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/send`)).body.error, 'TITLE_REQUIRED');
  await app.call('PATCH', `/api/change-requests/${c.id}`, { title: 'Ordering', deliverables: [' '] });
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/send`)).body.error, 'DELIVERABLE_REQUIRED');
  await app.call('PATCH', `/api/change-requests/${c.id}`, { deliverables: ['Page'], amount_minor: 30000 });
  const s = await app.call('POST', `/api/change-requests/${c.id}/send`);
  assert.equal(s.body.change_request.status, 'sent');
  assert.deepEqual(s.body.change_request.sent_version, { label: 'M4', title: 'Ordering', deliverables: ['Page'], amount_minor: 30000, price_basis: '$800 / 4 pages' });
  assert.deepEqual(s.body.change_request.ai_draft, draft);
  assert.deepEqual(db.load().change_requests[0].ai_draft, draft);
  assert.ok(db.load().notifications.some((n) => n.to === 'client' && /quote/.test(n.text)));
  const rep = await app.call('POST', `/api/change-requests/${c.id}/send`); // repeat
  assert.equal(rep.status, 200);
});

test('in_scope / revision verdicts: no draft, cannot be sent, can be closed', async () => {
  const { pid } = await setup({ result: verdict({ classification: 'in_scope', ai_draft: null }) });
  const c = (await create(pid, 'Phone number on the contact page')).body.change_request;
  assert.equal(c.ai_draft, null);
  assert.equal(c.draft, null);
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/send`)).body.error, 'NOT_NEW_WORK');
  assert.equal((await app.call('PATCH', `/api/change-requests/${c.id}`, { title: 'x' })).body.error, 'NOT_NEW_WORK');
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: true })).body.error, 'NOT_SENT');
  const cl = await app.call('POST', `/api/change-requests/${c.id}/close`);
  assert.equal(cl.body.change_request.status, 'closed');
  const g = (await app.call('GET', `/api/projects/${pid}`)).body;
  assert.equal(g.project.open_change_request, null);
});

test('decide: NOT_SENT before send; accept creates M4 in agreed (not funded); M4 is current only after M3 is paid', async () => {
  const { pid, pp } = await setup();
  const c = (await create(pid)).body.change_request;
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: true })).body.error, 'NOT_SENT');
  await app.call('PATCH', `/api/change-requests/${c.id}`, { amount_minor: 25000 });
  await app.call('POST', `/api/change-requests/${c.id}/send`);
  const [a, b] = await Promise.all([
    app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: true }),
    app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: true }),
  ]);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  const m4 = a.body.milestone;
  assert.equal(m4.label, 'M4');
  assert.equal(m4.seq, 4);
  assert.equal(m4.status, 'agreed');
  assert.equal(m4.amount_minor, 25000);
  assert.equal(m4.title, 'Online ordering page');
  assert.deepEqual(m4.criteria, ['Order page', 'Cart']);
  assert.equal(a.body.change_request.status, 'accepted');
  assert.equal(a.body.change_request.milestone_id, m4.id);
  assert.equal(db.load().milestones.filter((m) => m.label === 'M4').length, 1);
  assert.equal(db.load().payments.length, 0); // nothing charged

  // not current yet: M1 is
  assert.equal(m4.is_current, false);
  assert.equal(m4.fundable, false);
  assert.equal((await app.call('POST', `/api/milestones/${m4.id}/order`)).body.error, 'NOT_CURRENT');
  assert.equal(pp.calls.order.length, 0);

  // pay M1..M3 directly in the db, M4 becomes current and fundable
  for (const m of db.load().milestones.filter((x) => x.seq <= 3)) { m.status = 'paid'; }
  db.save();
  const g = (await app.call('GET', `/api/projects/${pid}`)).body;
  const view = g.milestones.find((m) => m.id === m4.id);
  assert.equal(view.is_current, true);
  assert.equal(view.fundable, true);
  const o = await app.call('POST', `/api/milestones/${m4.id}/order`);
  assert.equal(o.status, 200);
  assert.equal(pp.calls.order[0].m.amount_minor, 25000); // amount from the db (sent_version), not a request
  assert.equal(g.project.open_change_request, null);
  assert.ok(g.notifications.some((n) => n.to === 'freelancer' && /accepted/.test(n.text)));
});

test('decide: decline leaves the agreement unchanged; repeat is idempotent; wrong decision after is NOT_SENT', async () => {
  const { pid } = await setup();
  const c = (await create(pid)).body.change_request;
  await app.call('POST', `/api/change-requests/${c.id}/send`);
  const d = await app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: false });
  assert.equal(d.status, 200);
  assert.equal(d.body.change_request.status, 'declined');
  assert.equal(d.body.milestone, null);
  assert.equal(db.load().milestones.length, 3);
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: false })).status, 200);
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/decide`, { accept: true })).body.error, 'NOT_SENT');
  assert.equal((await app.call('POST', `/api/change-requests/${c.id}/decide`, {})).body.error, 'BAD_REQUEST');
  assert.equal((await create(pid, 'a new request please')).status, 201); // declined is no longer open
  assert.equal((await app.call('POST', '/api/change-requests/cr_nope/send')).status, 404);
  void pid;
});
