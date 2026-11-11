// PayPal REST helpers. Server-side only. Amounts are integer satang (amount_minor);
// toMoney() is the only place that makes a decimal string.
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';

const BASE = 'https://api-m.sandbox.paypal.com';

export function currency() {
  return process.env.API_CURRENCY || 'USD';
}

/** satang (integer) -> { currency_code, value:"2400.00" }. Integer arithmetic only. */
export function toMoney(amount_minor, cur = currency()) {
  if (!Number.isSafeInteger(amount_minor) || amount_minor < 0) {
    throw new Error('toMoney: amount_minor must be a non-negative integer');
  }
  const major = Math.floor(amount_minor / 100);
  const minor = amount_minor % 100;
  return { currency_code: cur, value: `${major}.${String(minor).padStart(2, '0')}` };
}

function buildToolkit() {
  return new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    configuration: {
      actions: { orders: { get: true }, payments: { createRefund: true, getRefunds: true } },
      context: { sandbox: true },
    },
  });
}

// Whitelisted toolkit: orders.get + payments.createRefund/getRefunds only.
export let toolkit = buildToolkit();

/** Auth headers come from the toolkit client (it caches its OAuth token). */
async function headers(extra = {}) {
  const h = await toolkit.client.getHeaders();
  return { ...h, ...extra };
}

class PayPalError extends Error {
  constructor(status, body, debugId) {
    super(`PayPal ${status}: ${body?.name || body?.error || 'ERROR'}`);
    this.status = status;
    this.paypal_name = body?.name || body?.error;
    this.details = body?.details;
    this.paypal_debug_id = debugId;
  }
}

async function call(method, path, { body, requestId } = {}) {
  const run = async () => {
    const h = await headers(requestId ? { 'PayPal-Request-Id': requestId } : {});
    return fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  };
  let res = await run();
  if (res.status === 401) { toolkit = buildToolkit(); res = await run(); } // token expired
  const debugId = res.headers.get('paypal-debug-id');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new PayPalError(res.status, data, debugId);
  return data;
}

/** Test/spike support: raw call exposing the same auth + error handling. */
export const _call = call;

export async function createAuthOrder(milestone, attempt = 1) {
  const cur = currency();
  return call('POST', '/v2/checkout/orders', {
    requestId: `order-${milestone.id}-${attempt}`,
    body: {
      intent: 'AUTHORIZE',
      purchase_units: [{
        custom_id: milestone.id,
        description: milestone.title,
        amount: toMoney(milestone.amount_minor, cur),
      }],
      payment_source: {
        paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } },
      },
    },
  });
}

/** Funding order: the client is charged when they confirm, and the money sits on the Milestone Pay account. */
export async function createCaptureOrder(milestone, attempt = 1) {
  const cur = currency();
  return call('POST', '/v2/checkout/orders', {
    requestId: `order-${milestone.id}-${attempt}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: milestone.id,
        description: milestone.title,
        amount: toMoney(milestone.amount_minor, cur),
      }],
      payment_source: {
        paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } },
      },
    },
  });
}

/** Capture an approved funding order. A capture has no expiry: the money stays until it is paid out or refunded. */
export async function captureOrder(orderId) {
  const d = await call('POST', `/v2/checkout/orders/${orderId}/capture`, {
    requestId: `ordcap-${orderId}`, body: {},
  });
  const c = d.purchase_units?.[0]?.payments?.captures?.[0];
  if (!c) throw new PayPalError(502, { name: 'NO_CAPTURE' }, null);
  return { capture_id: c.id, status: c.status };
}

export async function authorizeOrder(orderId) {
  const d = await call('POST', `/v2/checkout/orders/${orderId}/authorize`, {
    requestId: `auth-${orderId}`, body: {},
  });
  const a = d.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!a) throw new PayPalError(502, { name: 'NO_AUTHORIZATION' }, null);
  return { authorization_id: a.id, status: a.status, expires_at: a.expiration_time };
}

export async function captureAuth(authId) {
  const d = await call('POST', `/v2/payments/authorizations/${authId}/capture`, {
    requestId: `cap-${authId}`, body: { final_capture: true },
  });
  return { id: d.id, status: d.status };
}

export async function voidAuth(authId) {
  // PayPal returns 204 with no body on success.
  await call('POST', `/v2/payments/authorizations/${authId}/void`, { requestId: `void-${authId}` });
  const a = await call('GET', `/v2/payments/authorizations/${authId}`);
  return { status: a.status };
}

export async function refundCapture(captureId, amount_minor) {
  const body = amount_minor == null ? {} : { amount: toMoney(amount_minor) };
  const d = await call('POST', `/v2/payments/captures/${captureId}/refund`, {
    requestId: `ref-${captureId}`, body,
  });
  return { id: d.id, status: d.status };
}

/**
 * Send a captured milestone payment on to the freelancer's PayPal (Payouts API). batchId is the idempotency key:
 * PayPal refuses a second batch with the same sender_batch_id, so a retry can never pay twice.
 */
export async function createPayout({ batchId, email, amount_minor, cur = currency(), note = '' }) {
  const { currency_code, value } = toMoney(amount_minor, cur);
  const d = await call('POST', '/v1/payments/payouts', {
    requestId: batchId,
    body: {
      sender_batch_header: { sender_batch_id: batchId, email_subject: 'You have a payment from Milestone Pay' },
      items: [{ recipient_type: 'EMAIL', receiver: email, amount: { value, currency: currency_code }, note: String(note).slice(0, 200), sender_item_id: batchId }],
    },
  });
  return { batch_id: d?.batch_header?.payout_batch_id ?? null, status: d?.batch_header?.batch_status ?? null };
}

export async function getOrder(orderId) {
  return call('GET', `/v2/checkout/orders/${orderId}`);
}
