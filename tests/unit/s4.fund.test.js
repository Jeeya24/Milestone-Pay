import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import { tmpEnv, startApp, aiStub, paypalStub, makeProject, approveBoth } from './helpers.js';

let app, pp;
async function setup(ppOverrides) {
  tmpEnv('mp-s4-');
  pp = paypalStub(ppOverrides);
  app = await startApp({ paypal: pp, ai: await aiStub() });
  const proj = await makeProject(app.call);
  await approveBoth(app.call, proj.agreement.id);
  const ms = (await app.call('GET', `/api/projects/${proj.pid}`)).body.milestones;
  return { ...proj, ms };
}
afterEach(() => app.close());

test('/order on M2 while M1 is unpaid returns 409 NOT_CURRENT and never calls PayPal', async () => {
  const { ms } = await setup();
  const r = await app.call('POST', `/api/milestones/${ms[1].id}/order`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'NOT_CURRENT');
  assert.equal(pp.calls.order.length, 0);
});

test('/order before the agreement is approved returns 409 AGREEMENT_NOT_APPROVED', async () => {
  tmpEnv('mp-s4b-');
  pp = paypalStub();
  app = await startApp({ paypal: pp, ai: await aiStub() });
  const { milestones } = await makeProject(app.call);
  const r = await app.call('POST', `/api/milestones/${milestones[0].id}/order`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'AGREEMENT_NOT_APPROVED');
});

test('amount_minor in the /order body is ignored: PayPal sees the db amount', async () => {
  const { ms } = await setup();
  const r = await app.call('POST', `/api/milestones/${ms[0].id}/order`, { amount_minor: 1, currency: 'THB' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { order_id: 'ORDER1', status: 'CREATED' });
  assert.equal(pp.calls.order[0].m.amount_minor, 240000);
  assert.equal(pp.calls.order[0].m.id, ms[0].id);
  assert.equal(pp.calls.order[0].attempt, 1);
});

test('a second /order returns the same order_id with one PayPal call (even concurrently)', async () => {
  const { ms } = await setup();
  const [a, b] = await Promise.all([
    app.call('POST', `/api/milestones/${ms[0].id}/order`),
    app.call('POST', `/api/milestones/${ms[0].id}/order`),
  ]);
  const c = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  assert.equal(a.body.order_id, b.body.order_id);
  assert.equal(a.body.order_id, c.body.order_id);
  assert.equal(pp.calls.order.length, 1);
});

test('/order PayPal failure is 502 PAYPAL_ERROR with the debug id', async () => {
  const { ms } = await setup({
    createCaptureOrder: async () => { const e = new Error('x'); e.paypal_debug_id = 'dbg123'; throw e; },
  });
  const r = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'PAYPAL_ERROR');
  assert.equal(r.body.paypal_debug_id, 'dbg123');
});

test('/authorize: charges the client, stores the capture, ledger HELD, no expiry, activity, notification, status authorized', async () => {
  const { pid, ms } = await setup();
  const { body: o } = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  const r = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id });
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.status, 'authorized');
  assert.deepEqual(r.body.payment, {
    order_id: o.order_id, authorization_id: null, status: 'HELD', expires_at: null, capture_id: `CAP-${o.order_id}`, refund_id: null, payout_status: null, payout_batch_id: null,
  });
  const d = db.load();
  assert.equal(d.ledger.length, 1);
  assert.equal(d.ledger[0].event, 'HELD');
  assert.equal(d.ledger[0].paypal_id, `CAP-${o.order_id}`);
  assert.deepEqual(pp.calls.fund, [o.order_id]);
  assert.equal(pp.calls.authorize.length, 0);
  assert.equal(d.ledger[0].amount_minor, 240000);
  assert.ok(d.activity.some((a) => a.who === 'pp'));
  const n = d.notifications.find((x) => x.to === 'freelancer');
  assert.match(n.text, /^M1 is funded/);
  const g = await app.call('GET', `/api/projects/${pid}`);
  assert.equal(g.body.milestones[0].payment.status, 'HELD');
  assert.equal(g.body.milestones[0].fundable, false);
  assert.equal((await app.call('GET', '/api/projects')).body.totals.held_minor, 240000);
});

test('double /authorize returns the same capture with one PayPal call', async () => {
  const { ms } = await setup();
  const { body: o } = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  const [a, b] = await Promise.all([
    app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id }),
    app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id }),
  ]);
  const c = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);
  assert.ok(a.body.payment.capture_id);
  assert.equal(a.body.payment.capture_id, c.body.payment.capture_id);
  assert.equal(pp.calls.fund.length, 1);
  assert.equal(db.load().ledger.length, 1);
});

test('ORDER_MISMATCH for a foreign or missing order id', async () => {
  const { ms } = await setup();
  await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  let r = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: 'SOMETHING-ELSE' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ORDER_MISMATCH');
  r = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, {});
  assert.equal(r.body.error, 'ORDER_MISMATCH');
  assert.equal(pp.calls.fund.length, 0);
});

test('a PayPal error on /authorize leaves the milestone agreed and the retry reuses the order', async () => {
  let fail = true;
  const { pid, ms } = await setup({
    captureOrder: async (id) => {
      if (fail) { const e = new Error('declined'); e.paypal_debug_id = 'dbg9'; throw e; }
      return { capture_id: `CAP-${id}`, status: 'COMPLETED' };
    },
  });
  const { body: o } = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  const r = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'PAYPAL_ERROR');
  assert.equal(r.body.paypal_debug_id, 'dbg9');
  const g = await app.call('GET', `/api/projects/${pid}`);
  assert.equal(g.body.milestones[0].status, 'agreed');
  assert.equal(db.load().ledger.length, 0);
  const again = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  assert.equal(again.body.order_id, o.order_id);
  fail = false;
  const ok = await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.milestone.status, 'authorized');
});

test('after M1 is authorized, /order on M1 is NOT_CURRENT-style 409 and M2 is still locked', async () => {
  const { ms } = await setup();
  const { body: o } = await app.call('POST', `/api/milestones/${ms[0].id}/order`);
  await app.call('POST', `/api/milestones/${ms[0].id}/authorize`, { order_id: o.order_id });
  assert.equal((await app.call('POST', `/api/milestones/${ms[0].id}/order`)).status, 409);
  assert.equal((await app.call('POST', `/api/milestones/${ms[1].id}/order`)).body.error, 'NOT_CURRENT');
  assert.equal(pp.calls.order.length, 1);
});
