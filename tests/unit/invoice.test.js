// Invoices: one per milestone, only after it was funded, approved by the client, captured and paid out.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import { issueInvoice } from '../../invoice.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject, PNG } from './helpers.js';

let app; let F; let C; let S;
async function boot(overrides = {}) {
  tmpEnv('mp-inv2-');
  app = await startApp({ paypal: paypalStub(overrides), ai: await aiStub(), raw: true });
  F = await login(app.call, 'Ploy'); C = await login(app.call, 'Nok'); S = await login(app.call, 'Sam');
}
afterEach(() => app.close());

async function approved() {
  const p = await makeProject(F.call);
  const inv = await F.call('POST', `/api/projects/${p.pid}/invites`);
  await C.call('POST', `/api/invites/${new URL(inv.body.url).pathname.split('/').pop()}/accept`);
  for (const g of p.agreement.body.gaps) await F.call('POST', `/api/agreements/${p.agreement.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${p.agreement.id}/approve`);
  await C.call('POST', `/api/agreements/${p.agreement.id}/approve`, { content_hash: fa.body.agreement.content_hash });
  return p;
}
async function fund(m) { const o = await C.call('POST', `/api/milestones/${m.id}/order`); return C.call('POST', `/api/milestones/${m.id}/authorize`, { order_id: o.body.order_id }); }
async function deliver(m) {
  const fd = new FormData(); fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'home.png');
  await F.call('POST', `/api/milestones/${m.id}/deliverables`, fd);
  return F.call('POST', `/api/milestones/${m.id}/submit`);
}
const get = (who, url) => fetch(app.base + url, { headers: { cookie: who.cookie } });
const ms = async (who, pid, i = 0) => (await who.call('GET', `/api/projects/${pid}`)).body.milestones[i];

test('no invoice at any step before the payout; one invoice after it, for both people', async () => {
  await boot({ createPayout: async () => ({ batch_id: 'BATCH-1', status: 'PENDING' }) });
  const p = await approved(); const m = p.milestones[0];
  const notReady = async (step) => {
    assert.equal((await ms(F, p.pid)).invoice, null, step);
    const r = await F.call('GET', `/api/milestones/${m.id}/invoice`);
    assert.equal(r.status, 409, step); assert.equal(r.body.error, 'INVOICE_NOT_READY', step);
    assert.equal(issueInvoice(m.id), null, step);
  };
  await notReady('agreed');
  await fund(m); await notReady('funded');
  const sub = await deliver(m); await notReady('delivered');
  await F.call('PATCH', '/api/me', { display_name: 'Ploy <b>Design</b>' });
  await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);

  const fm = await ms(F, p.pid); const cm = await ms(C, p.pid);
  assert.match(fm.invoice.number, /^INV-\d{8}-[A-Z0-9]{1,8}$/);
  assert.deepEqual(cm.invoice, fm.invoice);
  assert.equal(fm.invoice.url, `/api/milestones/${m.id}/invoice`);
  assert.equal((await ms(F, p.pid, 1)).invoice, null);

  for (const who of [F, C]) {
    const res = await get(who, fm.invoice.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(res.headers.get('content-disposition'), /^inline; filename="INV-/);
    const html = await res.text();
    for (const s of [fm.invoice.number, 'Paid in full', 'M1 · Part 1', '2,400.00 USD', 'Nok', 'ORDER1', 'CAP-AUTH-ORDER1', 'BATCH-1', 'Paid out to the freelancer']) assert.ok(html.includes(s), s);
    // user text is escaped, and no email is printed
    assert.ok(html.includes('Ploy &lt;b&gt;Design&lt;/b&gt;') && !html.includes('<b>Design</b>'));
    assert.ok(!html.includes('test.local'));
  }
  const dl = await get(C, `${fm.invoice.url}?download=1`);
  assert.equal(dl.headers.get('content-disposition'), `attachment; filename="${fm.invoice.number}.html"`);
  assert.equal((await get(S, fm.invoice.url)).status, 404);

  // issued once: the number and the names on it never change afterwards
  await F.call('PATCH', '/api/me', { display_name: 'Someone Else' });
  await F.call('POST', `/api/projects/${p.pid}/refresh`);
  assert.equal((await ms(F, p.pid)).invoice.number, fm.invoice.number);
  assert.ok((await (await get(F, fm.invoice.url)).text()).includes('Ploy &lt;b&gt;Design&lt;/b&gt;'));
  assert.equal(db.load().payments.filter((x) => x.invoice).length, 1);
  assert.equal(db.load().activity.filter((a) => /invoice INV-/.test(a.text)).length, 1);
});

test('captured but not paid out: no invoice until the payout goes through', async () => {
  let fail = true;
  await boot({ createPayout: async () => { if (fail) throw new Error('nope'); return { batch_id: 'BATCH-2', status: 'PENDING' }; } });
  const p = await approved(); const m = p.milestones[0];
  await fund(m); const sub = await deliver(m);
  await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);
  const paid = await ms(C, p.pid);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.invoice, null);
  assert.equal((await C.call('GET', `/api/milestones/${m.id}/invoice`)).body.error, 'INVOICE_NOT_READY');
  fail = false;
  await F.call('POST', `/api/projects/${p.pid}/refresh`);
  const after = await ms(C, p.pid);
  assert.ok(after.invoice?.number);
  assert.equal((await get(C, after.invoice.url)).status, 200);
});

test('a cancelled milestone never gets an invoice', async () => {
  await boot({ createPayout: async () => ({ batch_id: 'BATCH-3', status: 'PENDING' }) });
  const p = await approved(); const m = p.milestones[0];
  await fund(m); const sub = await deliver(m);
  await C.call('POST', `/api/proposals/${sub.body.proposal.id}/cancel`);
  assert.equal((await ms(C, p.pid)).status, 'voided');
  assert.equal((await ms(C, p.pid)).invoice, null);
  assert.equal((await C.call('GET', `/api/milestones/${m.id}/invoice`)).status, 409);
});
