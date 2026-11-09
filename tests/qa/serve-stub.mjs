// QA helper: real server + real routes, PayPal replaced by a stub (no network), agent in forced-fallback mode.
// Extraction and the scope classifier are stubbed too (extract replays fixtures/baan-kafe.extract.json), so a full
// browser journey runs with no API keys. Usage: DB_PATH=... UPLOAD_DIR=... TEST_AUTH=1 PORT=3056 node tests/qa/serve-stub.mjs
import fs from 'node:fs';
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
const cached = JSON.parse(fs.readFileSync(new URL('../../fixtures/baan-kafe.extract.json', import.meta.url), 'utf8'));
const extractAgreement = async () => structuredClone(cached);
const realAi = await import('../../ai.js');
const port = Number(process.env.PORT) || 3056;
createApp({ paypal, ai: { ...realAi, classifyChange, extractAgreement }, agentOpts: { forceFallback: true } }).listen(port, () => console.log('stub server on', port));
