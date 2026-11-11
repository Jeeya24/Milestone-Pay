// PayPal sandbox smoke for the money flow: fund = capture the order (the client is charged, Milestone Pay holds it),
// then refund one of the two held captures. Checks that a funded order carries a capture and no authorization
// (so nothing can expire).
// Usage: node scripts/smoke.js   (USD by default; API_CURRENCY=THB to override)
//        node scripts/smoke.js --fund   (against a running server at BASE_URL, default http://localhost:3000:
//        funds the current milestone of the newest non-lab project; a human approves the PayPal popup URL)
// Prints ids only; never prints credentials or auth headers.
import 'dotenv/config';
import crypto from 'node:crypto';
import { toMoney, currency, createCaptureOrder, captureOrder, refundCapture, getOrder, _call } from '../paypal.js';

const POLL_MS = 5000, TIMEOUT_MS = 10 * 60 * 1000;
const rid = () => `ms_smoke_${crypto.randomBytes(5).toString('hex')}`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let path = 'url';

// ---- test-only helper: card-funded CAPTURE order (PayPal published sandbox test card). With a card attached PayPal
// captures as soon as the order is created. Production createCaptureOrder never carries card fields.
async function testCardOrder(m) {
  return _call('POST', '/v2/checkout/orders', {
    requestId: `order-${m.id}-card`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: m.id, amount: toMoney(m.amount_minor, currency()) }],
      payment_source: { card: { number: '4111111111111111', expiry: '2030-12', security_code: '123', name: 'Smoke Test' } },
    },
  });
}

async function makeOrder(m, tryCard) {
  if (tryCard) {
    try {
      const o = await testCardOrder(m);
      log(`card path: order ${o.id} status=${o.status}`);
      return { order: o, card: true };
    } catch (e) {
      log(`card path refused: ${e.paypal_name} status=${e.status} debug_id=${e.paypal_debug_id}`,
        JSON.stringify((e.details || []).map((d) => d.issue)));
    }
  }
  const o = await createCaptureOrder(m, 1);
  const approve = (o.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  log(`APPROVE: ${approve?.href}   (order ${o.id}, ${m.id})`);
  return { order: o, card: false };
}

async function waitApproved(orderId) {
  const t0 = Date.now();
  for (;;) {
    const o = await getOrder(orderId);
    if (o.status === 'APPROVED') return;
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error(`timeout: order ${orderId} not approved after 10 min (status ${o.status})`);
    await sleep(POLL_MS);
  }
}

async function fund() {
  const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const api = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${j?.error || ''} ${j?.message || ''}`);
    return j;
  };
  const { projects } = await api('GET', '/api/projects'); // newest first, lab projects hidden
  if (!projects.length) throw new Error('no projects found; run npm run seed first');
  const view = await api('GET', `/api/projects/${projects[0].id}`);
  const m = view.milestones.find((x) => x.fundable);
  if (!m) throw new Error(`project ${view.project.id} has no fundable milestone right now`);
  log(`project ${view.project.id}: funding ${m.label} "${m.title}" (${m.amount_minor} minor units)`);
  const { order_id: orderId } = await api('POST', `/api/milestones/${m.id}/order`);
  log(`ORDER ${orderId}`);
  log(`APPROVE (open in a normal browser, log in as the sandbox buyer): https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`);
  log('Waiting for approval (polls every 5s, up to 10 min)...');
  await waitApproved(orderId);
  const auth = await api('POST', `/api/milestones/${m.id}/authorize`, { order_id: orderId });
  log('capture_id', auth.payment.capture_id, 'status', auth.payment.status, 'expires_at', auth.payment.expires_at);
  const after = await api('GET', `/api/projects/${view.project.id}`);
  log('ledger row', JSON.stringify(after.ledger.filter((l) => l.milestone_id === m.id).pop()));
  log('FUND PASS');
}

async function main() {
  if (process.argv.includes('--fund')) return fund();
  const cur = currency();
  log(`currency=${cur}`);
  const m1 = { id: rid(), title: 'Smoke fund and hold', amount_minor: 15000 };
  // Not 99.00: the sandbox refuses to refund a card capture of exactly that amount (REFUND_NOT_ALLOWED), while
  // 98.00 and 150.00 refund fine.
  const m2 = { id: rid(), title: 'Smoke fund and refund', amount_minor: 9800 };

  const r1 = await makeOrder(m1, true);
  path = r1.card ? 'card' : 'url';
  const r2 = r1.card ? await makeOrder(m2, true) : await makeOrder(m2, false);
  ids.order1 = r1.order.id; ids.order2 = r2.order.id; ids.path = r1.card && r2.card ? 'card' : 'url';

  if (!r1.card) await waitApproved(r1.order.id);
  if (!r2.card) await waitApproved(r2.order.id);

  /** Fund: capture the order. A card order is already captured by PayPal when it is created. */
  const fundOrder = async (r) => {
    if (!r.card) {
      const c = await captureOrder(r.order.id);
      const again = await captureOrder(r.order.id); // same PayPal-Request-Id: the same capture, never a second charge
      if (again.capture_id !== c.capture_id) throw new Error('funding capture not idempotent');
      return c;
    }
    const c = r.order.purchase_units?.[0]?.payments?.captures?.[0];
    if (!c) throw new Error(`card order ${r.order.id} has no capture (status ${r.order.status})`);
    return { capture_id: c.id, status: c.status };
  };
  /** A held payment is a completed capture with no authorization, so there is nothing that can expire. */
  const assertHeld = async (orderId, captureId) => {
    const o = await getOrder(orderId);
    const pay = o.purchase_units?.[0]?.payments || {};
    const cap = (pay.captures || []).find((x) => x.id === captureId);
    if (o.status !== 'COMPLETED' || cap?.status !== 'COMPLETED') throw new Error(`order ${orderId} not held: order=${o.status} capture=${cap?.status}`);
    if ((pay.authorizations || []).length) throw new Error(`order ${orderId} still has an authorization`);
    return o;
  };

  // Flow 1: fund -> held (stays captured on the Milestone Pay account)
  const c1 = await fundOrder(r1);
  log('flow1 funded', c1);
  if (c1.status !== 'COMPLETED') throw new Error(`funding capture status ${c1.status}`);
  ids.capture1 = c1.capture_id;
  await assertHeld(r1.order.id, c1.capture_id);
  log('flow1 held: capture COMPLETED, no authorization, no expiry');

  // Flow 2: fund -> refund (what an accepted refund request does)
  const c2 = await fundOrder(r2);
  log('flow2 funded', c2);
  if (c2.status !== 'COMPLETED') throw new Error(`funding capture status ${c2.status}`);
  ids.capture2 = c2.capture_id;
  await assertHeld(r2.order.id, c2.capture_id);
  const rf = await refundCapture(c2.capture_id);
  log('flow2 refunded', rf);
  if (!['COMPLETED', 'PENDING'].includes(rf.status)) throw new Error(`refund status ${rf.status}`);
  ids.refund = rf.id;
  const rfb = await refundCapture(c2.capture_id); // idempotent repeat
  if (rfb.id !== rf.id) throw new Error('refund not idempotent');
  const cap2 = await _call('GET', `/v2/payments/captures/${c2.capture_id}`);
  log('flow2 capture after refund', cap2.status);
  if (!['REFUNDED', 'PARTIALLY_REFUNDED'].includes(cap2.status) && rf.status === 'COMPLETED') throw new Error(`capture ${c2.capture_id} is ${cap2.status} after the refund`);

  log('IDS', JSON.stringify(ids));
  log(`PATH=${ids.path} CURRENCY=${cur}`);
  log('SMOKE PASS');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e.message, e.paypal_name || '', e.paypal_debug_id ? `debug_id=${e.paypal_debug_id}` : '',
    e.details ? JSON.stringify(e.details.map((d) => d.issue)) : '', JSON.stringify(ids));
  process.exit(1);
});
