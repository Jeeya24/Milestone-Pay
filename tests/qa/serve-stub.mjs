// QA helper: real server + real routes, PayPal replaced by a stub (no network), agent in forced-fallback mode.
// Usage: DB_PATH=... UPLOAD_DIR=... PORT=3056 node tests/qa/serve-stub.mjs
import { createApp } from '../../server.js';
let n = 0;
const paypal = {
  currency: () => 'USD',
  createAuthOrder: async () => ({ id: `STUBORDER${++n}`, status: 'CREATED' }),
  authorizeOrder: async (o) => ({ authorization_id: `STUBAUTH-${o}`, status: 'CREATED', expires_at: '2027-01-01T00:00:00Z' }),
  captureAuth: async (a) => ({ id: `STUBCAP-${a}`, status: 'COMPLETED' }),
  voidAuth: async () => ({ status: 'VOIDED' }),
  getOrder: async (o) => ({ id: o, status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: `STUBAUTH-${o}`, status: 'CREATED' }] } }] }),
};
const classifyChange = async () => ({ classification: 'new_work', reason: 'Not in the agreed scope.', reason_source_ids: [],
  ai_draft: { label: 'M4', title: 'Online ordering page', deliverables: ['Ordering page'], amount_minor: 20000, price_basis: 'stub' } });
const realAi = await import('../../ai.js');
const port = Number(process.env.PORT) || 3056;
createApp({ paypal, ai: { ...realAi, classifyChange }, agentOpts: { forceFallback: true } }).listen(port, () => console.log('stub server on', port));
