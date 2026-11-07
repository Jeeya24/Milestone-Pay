// Shared test helpers: temp db + uploads, an in-process server, stubs for PayPal and AI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../../db.js';
import { createApp } from '../../server.js';

export function tmpEnv(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  db.init(path.join(dir, 'db.json'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  return dir;
}

export async function startApp(stubs) {
  const app = createApp(stubs);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(base + url, {
      method,
      headers: isForm || body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json };
  };
  return { call, close: () => new Promise((r) => server.close(r)), base };
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
  const calls = { order: [], authorize: [] };
  let n = 0;
  return {
    calls,
    currency: () => 'USD',
    createAuthOrder: async (m, attempt) => { calls.order.push({ m: { ...m }, attempt }); return { id: `ORDER${++n}`, status: 'CREATED' }; },
    authorizeOrder: async (orderId) => {
      calls.authorize.push(orderId);
      return { authorization_id: `AUTH-${orderId}`, status: 'CREATED', expires_at: '2026-12-01T00:00:00Z' };
    },
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
