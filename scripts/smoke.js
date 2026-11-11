// PayPal sandbox smoke: order->authorize->capture, order->authorize->void, capture->refund.
// Usage: node scripts/smoke.js   (USD by default; API_CURRENCY=THB to override)
//        node scripts/smoke.js --fund   (against a running server at BASE_URL, default http://localhost:3000:
//        funds the current milestone of the newest non-lab project; a human approves the PayPal popup URL)
// Prints ids only; never prints credentials or auth headers.
import 'dotenv/config';
import crypto from 'node:crypto';
import { toMoney, currency, createAuthOrder, authorizeOrder, captureAuth, voidAuth,
  refundCapture, getOrder, _call } from '../paypal.js';

const POLL_MS = 5000, TIMEOUT_MS = 10 * 60 * 1000;
const rid = () => `ms_smoke_${crypto.randomBytes(5).toString('hex')}`;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let path = 'url';

// ---- test-only helper: card-funded AUTHORIZE order (PayPal published sandbox test card).
// Production createAuthOrder never carries card fields.
async function testCardOrder(m) {
  return _call('POST', '/v2/checkout/orders', {
    requestId: `order-${m.id}-card`,
    body: {
      intent: 'AUTHORIZE',
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
  const o = await createAuthOrder(m, 1);
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
  log('authorization_id', auth.payment.authorization_id, 'status', auth.payment.status);
  const after = await api('GET', `/api/projects/${view.project.id}`);
  log('ledger row', JSON.stringify(after.ledger.filter((l) => l.milestone_id === m.id).pop()));
  log('FUND PASS');
}

async function main() {
  if (process.argv.includes('--fund')) return fund();
  const cur = currency();
  log(`currency=${cur}`);
  const m1 = { id: rid(), title: 'Smoke capture', amount_minor: 15000 };
  const m2 = { id: rid(), title: 'Smoke void', amount_minor: 9900 };

  const r1 = await makeOrder(m1, true);
  path = r1.card ? 'card' : 'url';
  const r2 = r1.card ? await makeOrder(m2, true) : await makeOrder(m2, false);
  ids.order1 = r1.order.id; ids.order2 = r2.order.id; ids.path = r1.card && r2.card ? 'card' : 'url';

  if (!r1.card) await waitApproved(r1.order.id);
  if (!r2.card) await waitApproved(r2.order.id);

  // Flow 1: authorize -> capture
  const a1 = await authorizeOrder(r1.order.id);
  log('flow1 authorized', a1);
  if (a1.status !== 'CREATED') throw new Error(`unexpected auth status ${a1.status}`);
  ids.auth1 = a1.authorization_id;
  const c1 = await captureAuth(a1.authorization_id);
  log('flow1 captured', c1);
  if (c1.status !== 'COMPLETED') throw new Error(`capture status ${c1.status}`);
  ids.capture = c1.id;
  // idempotent repeat returns the same capture
  const c1b = await captureAuth(a1.authorization_id);
  if (c1b.id !== c1.id) throw new Error('capture not idempotent');

  // Flow 2: authorize -> void
  const a2 = await authorizeOrder(r2.order.id);
  log('flow2 authorized', a2);
  ids.auth2 = a2.authorization_id;
  const v = await voidAuth(a2.authorization_id);
  log('flow2 voided', v);
  if (v.status !== 'VOIDED') throw new Error(`void status ${v.status}`);
  ids.void = a2.authorization_id;

  // Flow 3: refund the capture from flow 1
  const rf = await refundCapture(c1.id);
  log('flow3 refunded', rf);
  if (!['COMPLETED', 'PENDING'].includes(rf.status)) throw new Error(`refund status ${rf.status}`);
  ids.refund = rf.id;

  log('IDS', JSON.stringify(ids));
  log(`PATH=${ids.path} CURRENCY=${cur}`);
  log('SMOKE PASS');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e.message, e.paypal_name || '', e.paypal_debug_id ? `debug_id=${e.paypal_debug_id}` : '',
    e.details ? JSON.stringify(e.details.map((d) => d.issue)) : '', JSON.stringify(ids));
  process.exit(1);
});
