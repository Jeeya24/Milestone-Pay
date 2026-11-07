// End-to-end journey, in-process, with an injected PayPal stub that records every call.
// Usage: node scripts/e2e.js [--live-ai]
//   default    cached demo extraction, stubbed scope classifier, scripted agent model (free, deterministic)
//   --live-ai  real Gemini for the scope classifier and the agent (needs GOOGLE_GENERATIVE_AI_API_KEY)
// Uses a temp DB_PATH / UPLOAD_DIR; never touches ./db.json or ./uploads. Never calls real PayPal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV1 } from 'ai/test';
import * as db from '../db.js';

const LIVE = process.argv.includes('--live-ai');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-e2e-'));
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.DB_PATH = path.join(dir, 'db.json');
db.init(process.env.DB_PATH);
const { createApp } = await import('../server.js');
const realAi = await import('../ai.js');
const realAgent = await import('../agent.js');

// ---- reporting -------------------------------------------------------------
let pass = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); } else {
    failures.push(name); console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  }
  return !!cond;
}
const section = (s) => console.log(`\n== ${s}`);

// ---- PayPal stub that records everything -------------------------------------
const calls = { order: [], authorize: [], capture: [], void: [], getOrder: [], other: [] };
let n = 0;
const paypal = {
  currency: () => 'USD',
  createAuthOrder: async (m, attempt) => { calls.order.push({ amount_minor: m.amount_minor, id: m.id, attempt }); return { id: `ORDER${++n}`, status: 'CREATED' }; },
  authorizeOrder: async (o) => { calls.authorize.push(o); return { authorization_id: `AUTH-${o}`, status: 'CREATED', expires_at: '2027-01-01T00:00:00Z' }; },
  captureAuth: async (a) => { calls.capture.push(a); await new Promise((r) => setTimeout(r, 25)); return { id: `CAP-${a}`, status: 'COMPLETED' }; },
  voidAuth: async (a) => { calls.void.push(a); return { status: 'VOIDED' }; },
  getOrder: async (o) => { calls.getOrder.push(o); return { id: o, status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: `AUTH-${o}`, status: 'CREATED' }] } }] }; },
  refundCapture: async (...a) => { calls.other.push(['refund', ...a]); throw new Error('refund must not be called'); },
};
const ppTotal = () => Object.values(calls).reduce((s, a) => s + a.length, 0);
const ppNoGet = () => calls.order.length + calls.authorize.length + calls.capture.length + calls.void.length;

// ---- the model the agent sees (scripted, records every prompt) ----------------
const seenPrompts = [];
const scriptedModel = () => new MockLanguageModelV1({
  modelId: 'gemini-3.1-flash-lite',
  doGenerate: async (o) => {
    const text = JSON.stringify(o.prompt);
    seenPrompts.push(text);
    const user = o.prompt.filter((p) => p.role === 'user').map((p) => p.content.map((c) => c.text || '').join('')).join('\n');
    const event = /event: (\S+)/.exec(user)?.[1];
    const state = JSON.parse(user.slice(user.indexOf('state:') + 6));
    const find = (action, status) => state.proposals.find((p) => p.action === action && p.status === status);
    let calls_ = [];
    if (event === 'milestone.submitted') calls_ = [['get_order', {}], ['propose_release', {}], ['notify', { template: 'review_client' }]];
    else if (event === 'proposal.approved') calls_ = [['capture_authorization', { proposal_id: find('release', 'approved')?.id }], ['notify', { template: 'paid_freelancer' }], ['notify', { template: 'fund_next_client' }]];
    else if (event === 'proposal.voided') calls_ = [['void_authorization', { proposal_id: find('void', 'approved')?.id }], ['notify', { template: 'voided_both' }]];
    return {
      rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: 'tool-calls', usage: { promptTokens: 600, completionTokens: 40 },
      toolCalls: calls_.map((c, k) => ({ toolCallType: 'function', toolCallId: `c${seenPrompts.length}-${k}`, toolName: c[0], args: JSON.stringify(c[1]) })),
    };
  },
});
const throwingModel = () => new MockLanguageModelV1({ modelId: 'gemini-3.1-flash-lite', doGenerate: async () => { throw new Error('forced model failure'); } });

// ---- classifier stub ------------------------------------------------------------
const classifySeen = [];
const classifyStub = async (summary, request) => {
  classifySeen.push({ summary: JSON.stringify(summary), request });
  return {
    classification: 'new_work', reason: 'An online ordering page is not in the agreed scope.', reason_source_ids: [],
    ai_draft: { label: 'M4', title: 'Online ordering page', deliverables: ['Ordering page with menu and cart'], amount_minor: 20000, price_basis: '$800 / 4 pages' },
  };
};

const agentOpts = LIVE ? {} : { model: scriptedModel() };
const app = createApp({ paypal, ai: LIVE ? realAi : { ...realAi, classifyChange: classifyStub }, agent: realAgent, agentOpts });
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, body) => {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method, headers: isForm || body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body: json, text };
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const upload = (mid, name = 'work.png') => {
  const fd = new FormData(); fd.append('files', new Blob([PNG], { type: 'image/png' }), name);
  return call('POST', `/api/milestones/${mid}/deliverables`, fd);
};
const view = async (pid) => (await call('GET', `/api/projects/${pid}`)).body;
const ms = (v, label) => v.milestones.find((m) => m.label === label);

const REV_NOTE = 'Please change the logo <img src=x onerror=alert(1)> REVNOTE-MARKER';
const CR_TEXT = 'Can you add an online ordering page? <script>alert(1)</script> CRTEXT-MARKER';

async function newReadyProject({ fixG1 = true } = {}) {
  const d = await call('POST', '/api/demo');
  const pid = d.body.project_id;
  const v = await view(pid);
  if (fixG1) await call('POST', `/api/agreements/${v.agreement.id}/gaps/g1/fix`);
  const f = await call('POST', `/api/agreements/${v.agreement.id}/approve`, { party: 'freelancer' });
  const c = await call('POST', `/api/agreements/${v.agreement.id}/approve`, { party: 'client', content_hash: f.body.agreement.content_hash });
  return { pid, v, f, c, aid: v.agreement.id };
}
async function fundAuthorize(mid) {
  const o = await call('POST', `/api/milestones/${mid}/order`, { amount_minor: 1 /* tampering must be ignored */ });
  const a = await call('POST', `/api/milestones/${mid}/authorize`, { order_id: o.body?.order_id });
  return { o, a };
}
async function submitWork(mid) {
  const u = await upload(mid);
  const s = await call('POST', `/api/milestones/${mid}/submit`);
  return { u, s };
}

try {
  // =========================================================================
  section('Steps 1-4: demo, review, approve');
  const demo = await call('POST', '/api/demo');
  check('demo project created (201)', demo.status === 201 && /^prj_/.test(demo.body?.project_id || ''), demo.body);
  const pid = demo.body.project_id;
  let v = await view(pid);
  const aid = v.agreement.id;
  check('3 milestones M1-M3 in draft, sum = total ($800)', v.milestones.length === 3 && v.milestones.every((m) => m.status === 'draft') && v.milestones.reduce((s, m) => s + m.amount_minor, 0) === v.agreement.body.total_minor && v.agreement.body.total_minor === 80000);
  check('m9 injection line flagged', v.agreement.body.injection_flags.some((f) => f.msg_id === 'm9'), v.agreement.body.injection_flags);
  check('m9 flag changed nothing (no payments, no proposals, nothing approved)', v.milestones.every((m) => m.payment === null) && v.agreement.status === 'draft' && ppTotal() === 0);
  check('g1 (revision gap) is unfixed, rev_limit null', v.agreement.body.gaps.some((g) => g.id === 'g1' && !g.fixed) && v.milestones.every((m) => m.rev_limit === null));
  const fix = await call('POST', `/api/agreements/${aid}/gaps/g1/fix`);
  check('fix g1 -> 200, rev_limit = 2 on every milestone', fix.status === 200 && fix.body.milestones.every((m) => m.rev_limit === 2), fix.body?.error);

  const m1id = ms(v, 'M1').id, m2id = ms(v, 'M2').id, m3id = ms(v, 'M3').id;
  const bad = await call('PATCH', `/api/milestones/${m1id}`, { amount_minor: 25000 });
  check('PATCH M1 to mismatch -> mismatch:true', bad.status === 200 && bad.body.mismatch === true, bad.body);
  const rej = await call('POST', `/api/agreements/${aid}/approve`, { party: 'freelancer' });
  check('freelancer approve with mismatch = 409 AMOUNT_MISMATCH', rej.status === 409 && rej.body.error === 'AMOUNT_MISMATCH', rej.body);
  check('PATCH non-integer -> 400 BAD_AMOUNT', (await call('PATCH', `/api/milestones/${m1id}`, { amount_minor: 12.5 })).body?.error === 'BAD_AMOUNT');
  const fixed = await call('PATCH', `/api/milestones/${m1id}`, { amount_minor: 24000 });
  check('PATCH back to 24000 -> mismatch:false', fixed.body.mismatch === false);
  check('client approve before freelancer = 409 NOT_SENT', (await call('POST', `/api/agreements/${aid}/approve`, { party: 'client', content_hash: 'x' })).body?.error === 'NOT_SENT');
  const fa = await call('POST', `/api/agreements/${aid}/approve`, { party: 'freelancer' });
  const hash = fa.body.agreement?.content_hash;
  check('freelancer approve -> status sent, sha256 hash, client_url', fa.status === 200 && fa.body.agreement.status === 'sent' && /^sha256:[0-9a-f]{64}$/.test(hash) && fa.body.client_url.includes(pid), fa.body);
  check('PATCH after freelancer approval = 409 AGREEMENT_FROZEN', (await call('PATCH', `/api/milestones/${m1id}`, { amount_minor: 99999 })).body?.error === 'AGREEMENT_FROZEN');
  check('re-extract after approval = 409 AGREEMENT_FROZEN', (await call('POST', `/api/projects/${pid}/extract`)).body?.error === 'AGREEMENT_FROZEN');
  check('client wrong hash = 409 HASH_MISMATCH', (await call('POST', `/api/agreements/${aid}/approve`, { party: 'client', content_hash: 'sha256:00' })).body?.error === 'HASH_MISMATCH');
  check('unknown party = 400 BAD_PARTY', (await call('POST', `/api/agreements/${aid}/approve`, { party: 'robot' })).body?.error === 'BAD_PARTY');
  const early = await call('POST', `/api/milestones/${m1id}/order`);
  check('order before client approval = 409 AGREEMENT_NOT_APPROVED', early.status === 409 && early.body.error === 'AGREEMENT_NOT_APPROVED', early.body);
  const ca = await call('POST', `/api/agreements/${aid}/approve`, { party: 'client', content_hash: hash });
  check('client approve with hash -> approved, milestones agreed, no PayPal call', ca.status === 200 && ca.body.agreement.status === 'approved' && ca.body.milestones.every((m) => m.status === 'agreed') && ppTotal() === 0, ca.body?.error);

  // =========================================================================
  section('Step 5: M1 fund (only the current milestone)');
  const notCur = await call('POST', `/api/milestones/${m2id}/order`);
  check('ordering M2 while M1 unpaid = 409 NOT_CURRENT', notCur.status === 409 && notCur.body.error === 'NOT_CURRENT', notCur.body);
  const o1 = await call('POST', `/api/milestones/${m1id}/order`, { amount_minor: 1 });
  check('M1 order created; amount from db (24000), body amount ignored', o1.status === 200 && calls.order.length === 1 && calls.order[0].amount_minor === 24000 && calls.order[0].attempt !== undefined, calls.order);
  const o1b = await call('POST', `/api/milestones/${m1id}/order`);
  check('second /order returns the same order, no new PayPal order', o1b.body.order_id === o1.body.order_id && calls.order.length === 1);
  const bogus = await call('POST', `/api/milestones/${m1id}/authorize`, { order_id: 'WRONGORDER' });
  check('authorize with a different order id = 409 ORDER_MISMATCH, 0 authorize calls', bogus.status === 409 && bogus.body.error === 'ORDER_MISMATCH' && calls.authorize.length === 0, bogus.body);
  const a1 = await call('POST', `/api/milestones/${m1id}/authorize`, { order_id: o1.body.order_id });
  check('M1 authorize -> AUTHORIZED with authorization_id', a1.status === 200 && a1.body.payment.status === 'AUTHORIZED' && a1.body.payment.authorization_id === `AUTH-${o1.body.order_id}`, a1.body);
  const a1b = await call('POST', `/api/milestones/${m1id}/authorize`, { order_id: o1.body.order_id });
  check('repeat authorize = same payment, still 1 authorize call', a1b.status === 200 && a1b.body.payment.authorization_id === a1.body.payment.authorization_id && calls.authorize.length === 1);
  v = await view(pid);
  check('ledger has AUTHORIZED for M1', v.ledger.some((l) => l.label === 'M1' && l.event === 'AUTHORIZED' && l.amount_minor === 24000));
  check('submit before any upload = 409 NO_FILES', (await call('POST', `/api/milestones/${m1id}/submit`)).body?.error === 'NO_FILES');
  const badFile = new FormData(); badFile.append('files', new Blob(['not a png'], { type: 'image/png' }), 'fake.png');
  check('fake PNG (bad magic bytes) = 400 BAD_FILE', (await call('POST', `/api/milestones/${m1id}/deliverables`, badFile)).body?.error === 'BAD_FILE');

  // =========================================================================
  section('Steps 6-7: M1 submit, approve & pay');
  const u1 = await upload(m1id);
  check('upload PNG -> 201 version 1', u1.status === 201 && u1.body.version === 1 && u1.body.deliverables.length === 1, u1.body);
  const s1 = await call('POST', `/api/milestones/${m1id}/submit`);
  const prop1 = s1.body.proposal;
  check('submit -> submitted, pending release proposal, agent run', s1.status === 200 && s1.body.milestone.status === 'submitted' && prop1?.status === 'pending' && prop1?.action === 'release' && s1.body.agent_run, s1.body?.error);
  check('submit made zero money calls', calls.capture.length === 0 && calls.void.length === 0);
  const ap1 = await call('POST', `/api/proposals/${prop1.id}/approve`, { party: 'client' });
  check('approve & pay M1 -> CAPTURED, 1 capture call', ap1.status === 200 && ap1.body.payment.status === 'CAPTURED' && ap1.body.payment.capture_id === `CAP-AUTH-${o1.body.order_id}` && calls.capture.length === 1, ap1.body);
  check('next = M2', ap1.body.next?.label === 'M2' && ap1.body.next.milestone_id === m2id, ap1.body.next);
  v = await view(pid);
  check('ledger CAPTURED for M1 with capture id', v.ledger.some((l) => l.label === 'M1' && l.event === 'CAPTURED' && l.paypal_id === ap1.body.payment.capture_id));
  check('client notification names M2', v.notifications.some((x) => x.to === 'client' && /M2/.test(x.text) && /fund/i.test(x.text)), v.notifications.map((x) => x.text));
  check('freelancer notified M1 paid', v.notifications.some((x) => x.to === 'freelancer' && /M1/.test(x.text)));
  const ap1b = await call('POST', `/api/proposals/${prop1.id}/approve`, { party: 'client' });
  check('second approve = same result, still 1 capture', ap1b.status === 200 && ap1b.body.payment.capture_id === ap1.body.payment.capture_id && calls.capture.length === 1, { s: ap1b.status, c: calls.capture.length, b: ap1b.body?.error });
  const [ra, rb] = await Promise.all([1, 2].map(() => call('POST', `/api/proposals/${prop1.id}/approve`, { party: 'client' })));
  check('concurrent approves still 1 capture', calls.capture.length === 1 && ra.status < 300 && rb.status < 300);
  check('approve with party=freelancer = 400 BAD_PARTY', (await call('POST', `/api/proposals/${prop1.id}/approve`, { party: 'freelancer' })).body?.error === 'BAD_PARTY');

  // =========================================================================
  section('M2 with one revision round');
  const f2 = await fundAuthorize(m2id);
  check('M2 order + authorize', f2.a.status === 200 && f2.a.body.payment.status === 'AUTHORIZED', f2.a.body);
  const w2 = await submitWork(m2id);
  const prop2 = w2.s.body.proposal;
  check('M2 submitted with pending proposal', w2.s.status === 200 && prop2?.status === 'pending', w2.s.body);
  check('revision note too short = 400 NOTE_TOO_SHORT', (await call('POST', `/api/milestones/${m2id}/revision`, { note: 'no' })).body?.error === 'NOTE_TOO_SHORT');
  const rev = await call('POST', `/api/milestones/${m2id}/revision`, { note: REV_NOTE });
  check('revision -> revision_requested, rev_count 1, note stored raw', rev.status === 200 && rev.body.milestone.status === 'revision_requested' && rev.body.milestone.rev_count === 1 && rev.body.milestone.rev_note === REV_NOTE, rev.body);
  const stale = await call('POST', `/api/proposals/${prop2.id}/approve`, { party: 'client' });
  check('approving the withdrawn proposal = 409 PROPOSAL_NOT_PENDING, no capture', stale.status === 409 && stale.body.error === 'PROPOSAL_NOT_PENDING' && calls.capture.length === 1, stale.body);
  const u2 = await upload(m2id, 'v2.png');
  check('re-upload is version 2', u2.status === 201 && u2.body.version === 2, u2.body);
  const s2 = await call('POST', `/api/milestones/${m2id}/submit`);
  const prop2b = s2.body.proposal;
  check('re-submit -> new pending proposal', s2.status === 200 && prop2b?.status === 'pending' && prop2b.id !== prop2.id, s2.body?.error);
  const ap2 = await call('POST', `/api/proposals/${prop2b.id}/approve`, { party: 'client' });
  check('approve & pay M2 -> CAPTURED, captures = 2, next = M3', ap2.status === 200 && ap2.body.payment.status === 'CAPTURED' && calls.capture.length === 2 && ap2.body.next?.label === 'M3', ap2.body?.error);

  // =========================================================================
  section('Step 8: scope creep (M3 is current, unpaid)');
  const tooShort = await call('POST', `/api/projects/${pid}/change-requests`, { message: 'hi', from: 'client' });
  check('short change request = 400 MESSAGE_TOO_SHORT', tooShort.body?.error === 'MESSAGE_TOO_SHORT');
  const cr = await call('POST', `/api/projects/${pid}/change-requests`, { message: CR_TEXT, from: 'client' });
  const crId = cr.body.change_request?.id;
  check('client change request -> 201 open, new_work with draft', cr.status === 201 && cr.body.change_request.status === 'open' && cr.body.change_request.classification === 'new_work' && !!cr.body.change_request.draft, cr.body);
  if (LIVE) console.log('NOTE  --live-ai: classification came from Gemini:', cr.body.change_request?.classification);
  check('second open request = 409 OPEN_REQUEST_EXISTS', (await call('POST', `/api/projects/${pid}/change-requests`, { message: 'Another one please', from: 'client' })).body?.error === 'OPEN_REQUEST_EXISTS');
  check('decide before send = 409 NOT_SENT', (await call('POST', `/api/change-requests/${crId}/decide`, { accept: true })).body?.error === 'NOT_SENT');
  const ed = await call('PATCH', `/api/change-requests/${crId}`, { title: 'Online ordering page', amount_minor: 20000, deliverables: ['Ordering page with menu and cart'] });
  check('freelancer edits draft (PATCH)', ed.status === 200 && ed.body.change_request.draft.amount_minor === 20000, ed.body);
  const sent = await call('POST', `/api/change-requests/${crId}/send`);
  check('send -> status sent, sent_version frozen', sent.status === 200 && sent.body.change_request.status === 'sent' && sent.body.change_request.sent_version.amount_minor === 20000, sent.body);
  check('PATCH after send = 409 FROZEN', (await call('PATCH', `/api/change-requests/${crId}`, { amount_minor: 1 })).body?.error === 'FROZEN');
  const acc = await call('POST', `/api/change-requests/${crId}/decide`, { accept: true });
  const m4id = acc.body.milestone?.id;
  check('client accepts -> M4 created in agreed, $200', acc.status === 200 && acc.body.milestone.label === 'M4' && acc.body.milestone.status === 'agreed' && acc.body.milestone.amount_minor === 20000, acc.body);
  const acc2 = await call('POST', `/api/change-requests/${crId}/decide`, { accept: true });
  check('second accept = same M4, no duplicate', acc2.status === 200 && acc2.body.milestone?.id === m4id && (await view(pid)).milestones.length === 4);
  const m4early = await call('POST', `/api/milestones/${m4id}/order`);
  check('M4 not current until M3 paid: order = 409 NOT_CURRENT', m4early.status === 409 && m4early.body.error === 'NOT_CURRENT', m4early.body);

  section('M3, then M4');
  const f3 = await fundAuthorize(m3id);
  const w3 = await submitWork(m3id);
  const ap3 = await call('POST', `/api/proposals/${w3.s.body.proposal.id}/approve`, { party: 'client' });
  check('M3 funded, submitted, paid; next = M4', f3.a.status === 200 && ap3.status === 200 && ap3.body.payment.status === 'CAPTURED' && ap3.body.next?.label === 'M4' && calls.capture.length === 3, ap3.body?.error);
  const f4 = await fundAuthorize(m4id);
  check('M4 order uses db amount (20000), authorize ok', f4.a.status === 200 && calls.order.at(-1).amount_minor === 20000, calls.order.at(-1));
  const w4 = await submitWork(m4id);
  const ap4 = await call('POST', `/api/proposals/${w4.s.body.proposal.id}/approve`, { party: 'client' });
  check('M4 paid; next = null; 4 captures total', ap4.status === 200 && ap4.body.payment.status === 'CAPTURED' && ap4.body.next === null && calls.capture.length === 4, ap4.body);
  const dash = await call('GET', '/api/projects');
  check('dashboard: paid = $1000, held = 0, project completed', dash.body.totals.paid_minor === 100000 && dash.body.totals.held_minor === 0 && dash.body.projects.find((p) => p.id === pid)?.status === 'completed', { totals: dash.body.totals, st: dash.body.projects.find((p) => p.id === pid)?.status });
  v = await view(pid);
  check('ledger: 4 AUTHORIZED + 4 CAPTURED, no VOIDED', v.ledger.filter((l) => l.event === 'AUTHORIZED').length === 4 && v.ledger.filter((l) => l.event === 'CAPTURED').length === 4 && !v.ledger.some((l) => l.event === 'VOIDED'));
  const refresh = await call('POST', `/api/projects/${pid}/refresh`);
  check('refresh from PayPal -> 200 with a row per payment', refresh.status === 200 && refresh.body.payments.length === 4, refresh.body);

  // =========================================================================
  section('Second project: authorize -> cancel & release hold (void)');
  const P2 = await newReadyProject();
  const p2m1 = ms(await view(P2.pid), 'M1').id;
  const capBefore = calls.capture.length;
  const f21 = await fundAuthorize(p2m1);
  check('P2 M1 authorized', f21.a.status === 200);
  const w21 = await submitWork(p2m1);
  const prop21 = w21.s.body.proposal;
  check('P2 M1 submitted with pending proposal', !!prop21 && prop21.status === 'pending', w21.s.body?.error);

  section('Guardrail: forged capture');
  const before = ppTotal();
  const gt = await call('POST', '/api/agent/guardrail-test', { milestone_id: p2m1 });
  check('forged capture = NO_APPROVAL, 0 PayPal calls', gt.status === 200 && gt.body.result.error === 'NO_APPROVAL' && /^prop_forged_/.test(gt.body.proposal_id) && ppTotal() === before && calls.capture.length === capBefore, gt.body);
  const run = await call('POST', '/api/agent/run', { event: 'proposal.approved', milestone_id: p2m1 });
  check('agent run proposal.approved on a PENDING (unapproved) proposal captures nothing', run.status === 200 && calls.capture.length === capBefore, { s: run.status, c: calls.capture.length });
  check('forged-capture activity logged', (await view(P2.pid)).activity.some((a) => /Guardrail test/.test(a.text)));

  const cancel = await call('POST', `/api/proposals/${prop21.id}/cancel`, { party: 'client' });
  check('cancel -> VOIDED, milestone voided, 1 void call', cancel.status === 200 && cancel.body.payment.status === 'VOIDED' && cancel.body.milestone.status === 'voided' && calls.void.length === 1 && calls.void[0] === `AUTH-${f21.o.body.order_id}`, cancel.body);
  const cancel2 = await call('POST', `/api/proposals/${prop21.id}/cancel`, { party: 'client' });
  check('second cancel = same result, still 1 void', cancel2.status === 200 && calls.void.length === 1, cancel2.body);
  check('client never captured on P2', calls.capture.length === capBefore);
  v = await view(P2.pid);
  check('P2 ledger has VOIDED, no CAPTURED', v.ledger.some((l) => l.event === 'VOIDED') && !v.ledger.some((l) => l.event === 'CAPTURED'));
  const stopped = (await call('GET', '/api/projects')).body;
  check('P2 status = stopped; later milestone cannot be funded', stopped.projects.find((p) => p.id === P2.pid).status === 'stopped' && (await call('POST', `/api/milestones/${ms(v, 'M2').id}/order`)).status === 409);
  check('dashboard held = 0 after void; paid unchanged ($1000)', stopped.totals.held_minor === 0 && stopped.totals.paid_minor === 100000, stopped.totals);

  // =========================================================================
  section('Agent forced fallback (model throws)');
  const realModel = agentOpts.model;
  agentOpts.model = throwingModel();
  const P3 = await newReadyProject();
  const p3m1 = ms(await view(P3.pid), 'M1').id;
  await fundAuthorize(p3m1);
  const w31 = await submitWork(p3m1);
  const runS = w31.s.body.agent_run;
  check('model failure on submit -> run mode=fallback, proposal still created', w31.s.status === 200 && runS?.mode === 'fallback' && /model_error/.test(runS.fallback_reason || '') && w31.s.body.proposal?.status === 'pending', { mode: runS?.mode, why: runS?.fallback_reason });
  const capB = calls.capture.length;
  const ap31 = await call('POST', `/api/proposals/${w31.s.body.proposal.id}/approve`, { party: 'client' });
  check('fallback still captures exactly once on approve', ap31.status === 200 && ap31.body.agent_run.mode === 'fallback' && ap31.body.payment.status === 'CAPTURED' && calls.capture.length === capB + 1, ap31.body?.error);
  if (realModel) agentOpts.model = realModel; else delete agentOpts.model;
  const ff = await call('POST', '/api/agent/run', { event: 'milestone.submitted', milestone_id: p3m1, forceFallback: true });
  check('POST /agent/run forceFallback -> fallback, no new proposal needed, no capture', ff.status === 200 && ff.body.agent_run.mode === 'fallback' && calls.capture.length === capB + 1, ff.body);

  // =========================================================================
  section('Untrusted text never reaches the agent');
  if (LIVE) {
    console.log('SKIP  prompt spy (live model; prompts are not captured). Run without --live-ai for this check.');
  } else {
    const all = seenPrompts.join('\n');
    check(`agent saw ${seenPrompts.length} prompts, all state-only`, seenPrompts.length >= 9);
    check('revision note never in an agent prompt', !all.includes('REVNOTE-MARKER') && !all.includes('onerror'));
    check('change request text never in an agent prompt', !all.includes('CRTEXT-MARKER') && !all.includes('online ordering page?'));
    check('chat text (m9 injection, names) never in an agent prompt', !/release all|ignore the contract|Nok|Ploy|Baan Kafe|work\.png|v2\.png/i.test(all), all.match(/release all|ignore the contract|Nok|Ploy|Baan Kafe|work\.png|v2\.png/i)?.[0]);
    check('classifier got summary + request, but not the revision note', classifySeen.length === 1 && classifySeen[0].request.includes('CRTEXT-MARKER') && !classifySeen[0].summary.includes('REVNOTE-MARKER'));
  }

  // =========================================================================
  section('Totals and PayPal call counts');
  console.log('PayPal stub calls:', JSON.stringify(Object.fromEntries(Object.entries(calls).map(([k, a]) => [k, a.length]))));
  check('exact PayPal write counts: 6 orders (P1x4 + P2 + P3), 6 authorizes, 5 captures, 1 void', calls.order.length === 6 && calls.authorize.length === 6 && calls.capture.length === 5 && calls.void.length === 1 && calls.other.length === 0, Object.fromEntries(Object.entries(calls).map(([k, a]) => [k, a.length])));
  const ai = await call('GET', '/api/ai-runs');
  const byTask = {};
  for (const r of ai.body.runs) byTask[r.task] = (byTask[r.task] || 0) + 1;
  check('ai_runs logged per call with model, tokens and cost', ai.body.runs.length > 0 && ai.body.runs.every((r) => r.model && typeof r.cost_usd === 'number' && r.input_tokens >= 0));
  console.log(`ai_runs: ${ai.body.runs.length} calls ${JSON.stringify(byTask)}, total cost $${ai.body.total_cost_usd.toFixed(6)}${LIVE ? ' (live)' : ' (scripted agent model; classifier stubbed; extraction cached)'}`);
  check('whole journey < $0.05', ai.body.total_cost_usd < 0.05, ai.body.total_cost_usd);
  const raw = fs.readFileSync(process.env.DB_PATH, 'utf8');
  check('db.json has no float money (amount_minor all integers)', JSON.parse(raw).milestones.every((m) => Number.isInteger(m.amount_minor)));
} catch (err) {
  console.log(`FAIL  uncaught: ${err.stack || err}`);
  failures.push('uncaught exception');
} finally {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${failures.length} failed${failures.length ? ': ' + failures.join(' | ') : ''}`);
process.exit(failures.length ? 1 : 0);
