// Shared test helpers: temp db + uploads, an in-process server, stubs for PayPal and AI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../../db.js';
import { createApp } from '../../server.js';
import { loadConfig } from '../../config.js';

export const testConfig = (extra = {}) => loadConfig({ ...process.env, NODE_ENV: 'test', TEST_AUTH: '1', APP_URL: '', ...extra });

export function tmpEnv(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  db.init(path.join(dir, 'db.json'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  return dir;
}

export async function startApp({ raw = false, ...stubs } = {}) {
  // Default: never call a live model from a test. S6 tests pass their own agentOpts.
  const app = createApp({ agentOpts: { forceFallback: true }, config: testConfig(), ...stubs });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const isForm = body instanceof FormData;
    headers = { origin: base, ...headers };
    const res = await fetch(base + url, {
      method,
      headers: isForm || body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, setCookie: res.headers.getSetCookie() };
  };
  const close = () => new Promise((r) => server.close(r));
  if (raw) return { call, close, base };
  const auto = await autoRoleCaller(call);
  return { call: auto, rawCall: call, cookies: auto.cookies, close, base };
}

/**
 * Legacy suites (s3-s8) were written before auth. This caller logs in a freelancer and a client and picks the
 * session per request: a legacy body saying party/from 'client' goes as the client; otherwise the freelancer,
 * retried as the client on 403 WRONG_ROLE. Projects it creates get the client joined. Real role enforcement is
 * tested in access.test.js, not here.
 */
async function autoRoleCaller(call) {
  const F = await login(call, 'Ploy');
  const C = await login(call, 'Nok');
  const caller = async (method, url, body, headers = {}) => {
    const legacyClient = body && !(body instanceof FormData) && (body.party === 'client' || body.from === 'client');
    let r = await (legacyClient ? C : F).call(method, url, body, headers);
    if (!legacyClient && r.status === 403 && r.body?.error === 'WRONG_ROLE') r = await C.call(method, url, body, headers);
    const pid = r.status === 201 && method === 'POST' && (url === '/api/projects' ? r.body?.project?.id : url === '/api/demo' ? r.body?.project_id : null);
    if (pid && !db.load().project_members.some((m) => m.project_id === pid && m.role === 'client')) {
      db.load().project_members.push({ project_id: pid, user_id: C.user.id, role: 'client', at: new Date().toISOString() });
      db.save();
    }
    return r;
  };
  caller.cookies = { freelancer: F.cookie, client: C.cookie };
  return caller;
}

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export function fakeExtraction({ currency = 'USD', amounts = [240000, 320000, 240000] } = {}) {
  const total = amounts.reduce((a, b) => a + b, 0);
  return {
    body: {
      title: 'Baan Kafe website', client_name: 'Nok', freelancer_name: 'Ploy', total_minor: total, currency,
      terms: ['scope', 'deliverables', 'price', 'deadline', 'payment', 'revisions', 'assets'].map((key) => ({
        key, label: key, value: key === 'revisions' ? null : `${key} value`, source_message_ids: [],
      })),
      gaps: [{ id: 'g1', text: 'No revision limit agreed.', fix_label: 'Set: 2 revision rounds per milestone',
        term_key: 'revisions', term_value: '2 rounds per milestone', fixed: false }],
      injection_flags: [], translations: { en: {} },
    },
    milestones: amounts.map((a, i) => ({
      label: `M${i + 1}`, seq: i + 1, title: `Part ${i + 1}`, amount_minor: a, currency,
      criteria: ['done'], start_day: i * 3, end_day: i * 3 + 3,
    })),
    usage: { model: 'stub', fallback: false, input_tokens: 10, output_tokens: 5, cost_usd: 0.001, latency_ms: 1 },
  };
}

/** AI stub: real parsing helpers, fake model calls. */
export async function aiStub(overrides = {}) {
  const real = await import('../../ai.js');
  const calls = { extract: 0, transcribe: 0 };
  return {
    calls,
    parseChatText: real.parseChatText,
    dedupeMessages: real.dedupeMessages,
    numberMessages: real.numberMessages,
    extractAgreement: async () => { calls.extract++; return fakeExtraction(); },
    transcribeImages: async (files) => {
      calls.transcribe++;
      return { messages: files.map((f) => ({ sender: 'Nok', me: false, time: null, text: `from ${f.name}`, source_file: f.name, page: null })), usage: {} };
    },
    ...overrides,
  };
}

export function paypalStub(overrides = {}) {
  const calls = { order: [], authorize: [], capture: [], void: [], getOrder: [] };
  let n = 0;
  return {
    calls,
    currency: () => 'USD',
    createAuthOrder: async (m, attempt) => { calls.order.push({ m: { ...m }, attempt }); return { id: `ORDER${++n}`, status: 'CREATED' }; },
    authorizeOrder: async (orderId) => {
      calls.authorize.push(orderId);
      return { authorization_id: `AUTH-${orderId}`, status: 'CREATED', expires_at: '2026-12-01T00:00:00Z' };
    },
    captureAuth: async (authId) => { calls.capture.push(authId); await new Promise((r) => setTimeout(r, 20)); return { id: `CAP-${authId}`, status: 'COMPLETED' }; },
    voidAuth: async (authId) => { calls.void.push(authId); return { status: 'VOIDED' }; },
    getOrder: async (orderId) => {
      calls.getOrder.push(orderId);
      return { id: orderId, status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: `AUTH-${orderId}`, status: 'CREATED', expiration_time: '2026-12-01T00:00:00Z' }] } }] };
    },
    total: () => calls.order.length + calls.authorize.length + calls.capture.length + calls.void.length + calls.getOrder.length,
    ...overrides,
  };
}

/** Create a project through the API and extract it; returns ids. */
export async function makeProject(call, chatText = 'Nok: hi\nPloy: hello') {
  const fd = new FormData();
  fd.set('chatText', chatText);
  const p = await call('POST', '/api/projects', fd);
  const pid = p.body.project.id;
  const ex = await call('POST', `/api/projects/${pid}/extract`);
  return { pid, agreement: ex.body.agreement, milestones: ex.body.milestones };
}

export async function approveBoth(call, agreementId) {
  const f = await call('POST', `/api/agreements/${agreementId}/approve`, { party: 'freelancer' });
  const c = await call('POST', `/api/agreements/${agreementId}/approve`, { party: 'client', content_hash: f.body.agreement.content_hash });
  return { f, c };
}

/** Log in through /auth/test-login. Returns the session cookie and a call() bound to it. */
export async function login(call, name) {
  const r = await call('POST', '/auth/test-login', { name });
  if (r.status !== 200) throw new Error(`login ${name} failed: ${r.status}`);
  const cookie = r.setCookie.find((c) => c.startsWith('mp_sid=')).split(';')[0];
  const as = (method, url, body, headers = {}) => call(method, url, body, { cookie, ...headers });
  return { cookie, user: r.body.user, call: as };
}
