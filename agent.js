// Milestone Agent (S6). Money moves here, so the gates live in code, not in the prompt.
//
// The model only ever receives the event name plus a state JSON (milestone, payment ids/status, proposals,
// next milestone). Never chat, revision notes, change-request text or file names.
// The client is charged when they fund a milestone; the captured money stays on the Milestone Pay account with no
// expiry. release_payment (pay the freelancer out) and refund_payment (send it back to the client) execute only
// against an APPROVED proposal row (checked below), else they return { error: 'NO_APPROVAL' } and make zero PayPal
// calls. A release is approved by the client; a refund is asked for by the client and approved by the freelancer. Notification text is fixed templates.
// If the model call fails, times out (8 s), is over budget, or ends without the required money tool, the same
// sequence runs in code and the run is marked mode:'fallback'.
import { generateText, tool } from 'ai';
import { z } from 'zod';
import * as db from './db.js';
import * as realPaypal from './paypal.js';
import { loadPrompt } from './ai.js';
import { MODELS, MAX_OUT, TEMPERATURE, costUsd } from './models.js';
import { issueInvoice } from './invoice.js';

export const AGENT_TIMEOUT_MS = 8000;
// Spec says maxSteps 4. Gemini 3.x rejects a follow-up step that replays function calls without their
// thought_signature (@ai-sdk/google v1 does not carry it), so the model gets ONE response in which it emits all
// its tool calls (up to 4, run in order); anything it leaves out is completed by the code below.
export const MAX_STEPS = 1;
export const EVENTS = ['milestone.submitted', 'proposal.approved', 'proposal.refund_accepted'];
const HELD_STATES = ['authorized', 'submitted', 'revision_requested'];
export const NOTIFY_TEMPLATES = ['paid_freelancer', 'fund_next_client', 'refunded_both', 'review_client', 'problem_freelancer'];

const now = () => new Date().toISOString();
const usd = (minor, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100);

function milestoneOrThrow(id) {
  const m = db.load().milestones.find((x) => x.id === id);
  if (!m) throw new db.AppError('NOT_FOUND', 'Milestone not found', 404);
  return m;
}
const paymentOf = (m) => [...db.load().payments].reverse().find((p) => p.milestone_id === m.id) || null;
const nextOf = (m) => db.load().milestones
  .filter((x) => x.project_id === m.project_id && x.seq > m.seq).sort((a, b) => a.seq - b.seq)
  .find((x) => x.status !== 'paid') || null;

// ---------------------------------------------------------------------------
// The state the model sees. Whitelist of fields; nothing else is copied.

export function buildState(m) {
  const d = db.load();
  const pay = paymentOf(m);
  const next = nextOf(m);
  return {
    milestone: { id: m.id, label: m.label, title: m.title, amount_minor: m.amount_minor, currency: m.currency, status: m.status },
    project: { id: m.project_id },
    payment: pay ? { order_id: pay.order_id, authorization_id: pay.authorization_id || null, capture_id: pay.capture_id || null, status: pay.status } : null,
    proposals: d.proposals.filter((p) => p.milestone_id === m.id).map((p) => ({ id: p.id, action: p.action, status: p.status })),
    next_milestone: next ? { id: next.id, label: next.label, title: next.title, amount_minor: next.amount_minor, status: next.status } : null,
  };
}

export const modelInput = (event, m) => `event: ${event}\nstate:\n${JSON.stringify(buildState(m))}`;

// ---------------------------------------------------------------------------
// Gated executors. One in-flight promise per authorization so a model run that timed out and the fallback
// that follows can never both talk to PayPal.

const inflight = new Map();
const single = (key, fn) => {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
};

const paypalFail = (err) => ({ error: 'PAYPAL_ERROR', message: String(err?.message || err).slice(0, 200), paypal_debug_id: err?.paypal_debug_id ?? null });

/**
 * Release a held payment to the freelancer. The money was captured when the client funded the milestone, so this
 * makes no capture call: it marks the payment released and sends the payout. Payments made before capture-at-funding
 * are still PayPal authorizations (status AUTHORIZED) and are captured here first.
 */
export async function releaseExecutor({ milestone_id, proposal_id }, { paypal = realPaypal } = {}) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestone_id);
  const prop = typeof proposal_id === 'string' ? d.proposals.find((p) => p.id === proposal_id) : null;
  if (!m || !prop || prop.milestone_id !== m.id || prop.action !== 'release' || !['approved', 'executed'].includes(prop.status)) {
    return { error: 'NO_APPROVAL' };
  }
  const pay = [...d.payments].reverse().find((p) => p.milestone_id === m.id && ['CAPTURED', 'HELD', 'AUTHORIZED'].includes(p.status));
  if (pay?.status === 'CAPTURED' && pay.capture_id) return { ok: true, capture_id: pay.capture_id, status: 'CAPTURED', already: true };
  if (prop.status !== 'approved' || m.status !== 'submitted' || !approvedByClient(prop, m)) return { error: 'NO_APPROVAL' };
  if (!pay || (pay.status === 'HELD' ? !pay.capture_id : !pay.authorization_id)) return { error: 'NO_PAYMENT' };

  return single(`rel:${pay.id || pay.order_id}`, async () => {
    if (pay.status === 'CAPTURED') return { ok: true, capture_id: pay.capture_id, status: 'CAPTURED', already: true };
    if (pay.status === 'AUTHORIZED') { // funded before capture-at-funding
      let cap;
      try { cap = await paypal.captureAuth(pay.authorization_id); } catch (err) { return paypalFail(err); }
      if (!['COMPLETED', 'PENDING'].includes(cap?.status)) return { error: 'PAYPAL_ERROR', message: `Capture status ${cap?.status}`, paypal_debug_id: null };
      pay.capture_id = cap.id;
    }
    db.transition(m, 'paid');
    pay.status = 'CAPTURED';
    prop.status = 'executed';
    for (const p of d.proposals) if (p.milestone_id === m.id && p.action === 'refund' && p.status === 'pending') p.status = 'withdrawn';
    db.save();
    db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'CAPTURED', paypal_id: pay.capture_id, amount_minor: m.amount_minor });
    db.activity(m.project_id, 'agent', `${m.label} ${usd(m.amount_minor, m.currency)} released to the freelancer (capture ${pay.capture_id})`);
    const payout = await payoutFor(m.id, { paypal });
    return { ok: true, capture_id: pay.capture_id, status: 'CAPTURED', payout: payout.status };
  });
}

/**
 * Milestone Pay holds the client's payment; once it is captured this sends it on to the freelancer's own PayPal
 * (the email they log in with). Same gate as the release: the milestone must be paid through an executed release
 * proposal. Never throws and never undoes the release: a failed payout is recorded and retried from
 * "Check with PayPal". The batch id is derived from the capture id, so PayPal cannot pay it twice.
 */
export async function payoutFor(milestoneId, { paypal = realPaypal } = {}) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestoneId);
  const pay = m && [...d.payments].reverse().find((p) => p.milestone_id === m.id && p.status === 'CAPTURED' && p.capture_id);
  const released = m && d.proposals.some((p) => p.milestone_id === m.id && p.action === 'release' && p.status === 'executed');
  if (!m || m.status !== 'paid' || !pay || !released) return { status: 'NO_APPROVAL' };
  if (pay.payout_status === 'SENT') return { status: 'SENT', already: true };
  if (typeof paypal.createPayout !== 'function') return { status: 'SKIPPED' };
  return single(`payout:${pay.capture_id}`, async () => {
    if (pay.payout_status === 'SENT') return { status: 'SENT', already: true };
    const member = d.project_members.find((x) => x.project_id === m.project_id && x.role === 'freelancer');
    const email = d.users.find((u) => u.id === member?.user_id)?.email || null;
    if (!email) {
      Object.assign(pay, { payout_status: 'FAILED', payout_error: 'NO_PAYPAL_EMAIL' });
      db.save();
      return { status: 'FAILED' };
    }
    try {
      const out = await paypal.createPayout({ batchId: `payout-${pay.capture_id}`, email, amount_minor: m.amount_minor, cur: m.currency, note: `${m.label} ${m.title}` });
      Object.assign(pay, { payout_status: 'SENT', payout_batch_id: out.batch_id, payout_error: null });
      db.save();
      db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'PAID_OUT', paypal_id: out.batch_id, amount_minor: m.amount_minor });
      db.activity(m.project_id, 'pp', `${m.label} ${usd(m.amount_minor, m.currency)} sent to the freelancer's PayPal account (payout ${out.batch_id})`);
      issueInvoice(m.id); // funded, approved, captured and paid out: the invoice is due now
      return { status: 'SENT' };
    } catch (err) {
      Object.assign(pay, { payout_status: 'FAILED', payout_error: String(err?.paypal_name || err?.message || 'ERROR').slice(0, 80) });
      db.save();
      db.activity(m.project_id, 'pp', `${m.label}: sending the payment on to the freelancer's PayPal did not go through yet. It will be retried.`);
      return { status: 'FAILED' };
    }
  });
}

/**
 * Send a held payment back to the client. Needs a refund proposal the client asked for and the freelancer approved.
 * A payment captured at funding is refunded; an older PayPal authorization is voided instead (never charged).
 */
export async function refundExecutor({ milestone_id, proposal_id }, { paypal = realPaypal } = {}) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestone_id);
  const prop = typeof proposal_id === 'string' ? d.proposals.find((p) => p.id === proposal_id) : null;
  if (!m || !prop || prop.milestone_id !== m.id || prop.action !== 'refund' || !['approved', 'executed'].includes(prop.status)) {
    return { error: 'NO_APPROVAL' };
  }
  const pay = [...d.payments].reverse().find((p) => p.milestone_id === m.id && ['REFUNDED', 'VOIDED', 'HELD', 'AUTHORIZED'].includes(p.status));
  if (['REFUNDED', 'VOIDED'].includes(pay?.status) && m.status === 'voided') return { ok: true, status: pay.status, already: true };
  if (prop.status !== 'approved' || !HELD_STATES.includes(m.status) || !refundAgreed(prop, m)) return { error: 'NO_APPROVAL' };
  if (!pay || (pay.status === 'HELD' ? !pay.capture_id : !pay.authorization_id)) return { error: 'NO_PAYMENT' };

  return single(`refund:${pay.id || pay.order_id}`, async () => {
    if (['REFUNDED', 'VOIDED'].includes(pay.status)) return { ok: true, status: pay.status, already: true };
    let paypalId; let event;
    if (pay.status === 'HELD') {
      let rf;
      try { rf = await paypal.refundCapture(pay.capture_id); } catch (err) { return paypalFail(err); }
      if (!['COMPLETED', 'PENDING'].includes(rf?.status)) return { error: 'PAYPAL_ERROR', message: `Refund status ${rf?.status}`, paypal_debug_id: null };
      Object.assign(pay, { status: 'REFUNDED', refund_id: rf.id });
      paypalId = rf.id; event = 'REFUNDED';
    } else { // funded before capture-at-funding: release the authorization, the client was never charged
      try { await paypal.voidAuth(pay.authorization_id); } catch (err) { return paypalFail(err); }
      pay.status = 'VOIDED';
      paypalId = pay.authorization_id; event = 'VOIDED';
    }
    db.transition(m, 'voided');
    prop.status = 'executed';
    for (const p of d.proposals) if (p.milestone_id === m.id && p.status === 'pending') p.status = 'withdrawn';
    db.save();
    db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event, paypal_id: paypalId, amount_minor: m.amount_minor });
    db.activity(m.project_id, 'agent', event === 'REFUNDED'
      ? `${m.label} ${usd(m.amount_minor, m.currency)} refunded to the client (refund ${paypalId})`
      : `${m.label} authorization voided; the hold is returned to the client`);
    return { ok: true, status: pay.status };
  });
}

// Fixed notification templates. The model picks a template name; it never writes text.
function renderNotify(template, m) {
  const d = db.load();
  const project = d.projects.find((p) => p.id === m.project_id);
  const free = project?.freelancer || project?.freelancer_name || 'the freelancer';
  const next = nextOf(m);
  switch (template) {
    case 'paid_freelancer':
      return [{ to: 'freelancer', text: `${m.label} is paid. ${usd(m.amount_minor, m.currency)} has been released to you.` }];
    case 'fund_next_client':
      return [{
        to: 'client',
        text: next
          ? `${m.label} is paid. Fund ${next.label} ${next.title} (${usd(next.amount_minor, next.currency)}) so ${free} can start.`
          : `${m.label} is paid. Every milestone in this project is now paid.`,
      }];
    case 'refunded_both': {
      const amt = usd(m.amount_minor, m.currency);
      return paymentOf(m)?.status === 'REFUNDED' ? [
        { to: 'client', text: `${m.label} was cancelled. ${amt} has been refunded to your PayPal account.` },
        { to: 'freelancer', text: `${m.label} was cancelled. You accepted the refund request, so ${amt} went back to the client and no payment will be made for it.` },
      ] : [
        { to: 'client', text: `${m.label} was cancelled. The ${amt} hold on your PayPal account has been released.` },
        { to: 'freelancer', text: `${m.label} was cancelled. You accepted the refund request, so the ${amt} hold was released and no payment will be made for it.` },
      ];
    }
    case 'review_client':
      return [{ to: 'client', text: `${m.label} was delivered. Review the files and approve to pay ${usd(m.amount_minor, m.currency)}.` }];
    case 'problem_freelancer':
      return [{ to: 'freelancer', text: `The payment agent could not finish its step for ${m.label}. Nothing else was changed; please try again or contact support.` }];
    default:
      return null;
  }
}

function notifyExecutor({ milestone_id, template }) {
  const m = milestoneOrThrow(milestone_id);
  const rows = renderNotify(template, m);
  if (!rows) return { error: 'UNKNOWN_TEMPLATE' };
  // A template may only describe something that actually happened.
  const applies = {
    paid_freelancer: m.status === 'paid', fund_next_client: m.status === 'paid',
    refunded_both: m.status === 'voided', review_client: m.status === 'submitted', problem_freelancer: true,
  }[template];
  if (!applies) return { error: 'NOT_APPLICABLE' };
  const d = db.load();
  const sent = [];
  for (const row of rows) {
    // The submit route already tells the client "was delivered"; do not send the same line twice in a row.
    const last = [...d.notifications].reverse().find((n) => n.project_id === m.project_id && n.to === row.to);
    if (template === 'review_client' && last?.text === row.text) continue;
    db.notify(m.project_id, row.to, row.text);
    sent.push(row.to);
  }
  return { ok: true, template, sent };
}

function proposeExecutor({ milestone_id }) {
  const m = milestoneOrThrow(milestone_id);
  if (m.status !== 'submitted') return { error: 'NOT_SUBMITTED' };
  const d = db.load();
  let p = d.proposals.find((x) => x.milestone_id === m.id && x.action === 'release' && x.status === 'pending');
  if (!p) {
    p = {
      id: db.id('prop'), project_id: m.project_id, milestone_id: m.id, action: 'release', status: 'pending',
      reason: `Work submitted for ${m.label}; client to review`, approved_by: null, created_at: now(),
    };
    d.proposals.push(p);
    db.save();
    db.activity(m.project_id, 'agent', `Agent proposed releasing ${m.label} (${usd(m.amount_minor, m.currency)}) to the freelancer, waiting for the client`);
  }
  return { ok: true, proposal_id: p.id };
}

async function getOrderExecutor({ milestone_id }, { paypal }) {
  const m = milestoneOrThrow(milestone_id);
  const pay = paymentOf(m);
  if (!pay?.order_id) return { error: 'NO_ORDER' };
  try {
    const o = await paypal.getOrder(pay.order_id);
    const a = o?.purchase_units?.[0]?.payments?.authorizations?.[0];
    const c = o?.purchase_units?.[0]?.payments?.captures?.[0];
    return { order_status: o?.status ?? null, authorization_status: a?.status ?? null, capture_status: c?.status ?? null };
  } catch (err) { return paypalFail(err); }
}

// ---------------------------------------------------------------------------
// Run context: records every step, and refuses tool calls once the run is closed (late model calls).

function makeCtx(event, m, paypal) {
  const steps = [];
  const ctx = {
    steps, closed: false, queue: Promise.resolve(),
    called: (name) => steps.some((s) => s.tool === name),
    // Tool calls from one model response run in the order the model emitted them (the SDK starts them in parallel).
    step(name, args, fn, allowedEvents) {
      const p = ctx.queue.then(() => ctx.runStep(name, args, fn, allowedEvents));
      ctx.queue = p.catch(() => {});
      return p;
    },
    async runStep(name, args, fn, allowedEvents) {
      if (ctx.closed) return { error: 'RUN_CLOSED' };
      let result; let ok = true;
      if (allowedEvents && !allowedEvents.includes(event)) result = { error: 'NOT_ALLOWED_FOR_EVENT' };
      else {
        try { result = await fn(); } catch (err) { result = { error: 'TOOL_FAILED', message: String(err?.message || err).slice(0, 200) }; }
      }
      if (result?.error) ok = false;
      steps.push({ tool: name, args, result, ok });
      return result;
    },
  };
  ctx.exec = {
    get_order: () => ctx.step('get_order', {}, () => getOrderExecutor({ milestone_id: m.id }, { paypal })),
    propose_release: () => ctx.step('propose_release', {}, () => proposeExecutor({ milestone_id: m.id }), ['milestone.submitted']),
    release_payment: (proposal_id) => ctx.step('release_payment', { proposal_id },
      () => releaseExecutor({ milestone_id: m.id, proposal_id }, { paypal }), ['proposal.approved']),
    refund_payment: (proposal_id) => ctx.step('refund_payment', { proposal_id },
      () => refundExecutor({ milestone_id: m.id, proposal_id }, { paypal }), ['proposal.refund_accepted']),
    notify: (template) => ctx.step('notify', { template }, () => notifyExecutor({ milestone_id: m.id, template })),
  };
  return ctx;
}

function makeTools(ctx) {
  return {
    get_order: tool({ description: 'Read the PayPal order and payment status for this milestone. Read only.', parameters: z.object({}), execute: async () => ctx.exec.get_order() }),
    propose_release: tool({ description: 'Create a release proposal for this milestone. Asks the client; moves no money.', parameters: z.object({}), execute: async () => ctx.exec.propose_release() }),
    release_payment: tool({
      description: 'Release the held payment (pays the freelancer out). Needs the id of an approved release proposal from the state.',
      parameters: z.object({ proposal_id: z.string() }), execute: async ({ proposal_id }) => ctx.exec.release_payment(proposal_id),
    }),
    refund_payment: tool({
      description: 'Refund the held payment to the client. Needs the id of an approved refund proposal from the state.',
      parameters: z.object({ proposal_id: z.string() }), execute: async ({ proposal_id }) => ctx.exec.refund_payment(proposal_id),
    }),
    notify: tool({
      description: `Send a fixed-template in-app message. template is one of: ${NOTIFY_TEMPLATES.join(', ')}.`,
      parameters: z.object({ template: z.enum(NOTIFY_TEMPLATES) }), execute: async ({ template }) => ctx.exec.notify(template),
    }),
  };
}

// ---------------------------------------------------------------------------
// What must have happened for the run to count as done, and the deterministic sequence.

/** An approved proposal counts only if the project's client member approved it (projects with members). */
function approvedByClient(p, m) {
  const client = db.load().project_members.find((x) => x.project_id === m.project_id && x.role === 'client');
  const hasMembers = db.load().project_members.some((x) => x.project_id === m.project_id);
  return !hasMembers || (!!client && p.approved_by_user === client.user_id);
}
/** A refund counts only if the client asked for it and the freelancer accepted it (projects with members). */
function refundAgreed(p, m) {
  const members = db.load().project_members.filter((x) => x.project_id === m.project_id);
  if (!members.length) return p.requested_by === 'client' && p.approved_by === 'freelancer';
  const client = members.find((x) => x.role === 'client');
  const freelancer = members.find((x) => x.role === 'freelancer');
  return !!client && !!freelancer && p.requested_by_user === client.user_id && p.approved_by_user === freelancer.user_id;
}
const approvedProposal = (m, action) => db.load().proposals.find((p) => p.milestone_id === m.id && p.action === action && p.status === 'approved'
  && (action === 'refund' ? refundAgreed(p, m) : approvedByClient(p, m)));

/** True when the money tool the event calls for is still outstanding. */
function moneyOutstanding(event, m) {
  if (event === 'milestone.submitted') return m.status === 'submitted' && !db.load().proposals.some((p) => p.milestone_id === m.id && p.action === 'release' && ['pending', 'approved', 'executed'].includes(p.status));
  if (event === 'proposal.approved') return !!approvedProposal(m, 'release') && m.status === 'submitted';
  if (event === 'proposal.refund_accepted') return !!approvedProposal(m, 'refund') && HELD_STATES.includes(m.status);
  return false;
}

async function deterministic(event, m, ctx) {
  if (event === 'milestone.submitted') {
    await ctx.exec.get_order();
    await ctx.exec.propose_release();
    await ctx.exec.notify('review_client');
  } else if (event === 'proposal.approved') {
    const p = approvedProposal(m, 'release') || db.load().proposals.find((x) => x.milestone_id === m.id && x.action === 'release' && x.status === 'executed');
    if (p) {
      const r = await ctx.exec.release_payment(p.id);
      if (r?.ok) { await ctx.exec.notify('paid_freelancer'); await ctx.exec.notify('fund_next_client'); }
      else if (r?.error === 'PAYPAL_ERROR') await ctx.exec.notify('problem_freelancer');
    }
  } else if (event === 'proposal.refund_accepted') {
    const p = approvedProposal(m, 'refund') || db.load().proposals.find((x) => x.milestone_id === m.id && x.action === 'refund' && x.status === 'executed');
    if (p) {
      const r = await ctx.exec.refund_payment(p.id);
      if (r?.ok) await ctx.exec.notify('refunded_both');
      else if (r?.error === 'PAYPAL_ERROR') await ctx.exec.notify('problem_freelancer');
    }
  }
}

/** After a model run: send any notification the rules require that the model skipped. */
async function completeNotifies(event, m, ctx) {
  const sent = (t) => ctx.steps.some((s) => s.tool === 'notify' && s.args.template === t && s.ok);
  const ok = (t) => ctx.steps.some((s) => s.tool === t && s.ok);
  if (event === 'proposal.approved' && ok('release_payment')) {
    if (!sent('paid_freelancer')) await ctx.exec.notify('paid_freelancer');
    if (!sent('fund_next_client')) await ctx.exec.notify('fund_next_client');
  } else if (event === 'proposal.refund_accepted' && ok('refund_payment') && !sent('refunded_both')) {
    await ctx.exec.notify('refunded_both');
  } else if (event === 'milestone.submitted' && ok('propose_release') && !sent('review_client')) {
    await ctx.exec.notify('review_client');
  }
}

// ---------------------------------------------------------------------------

function timeout(ms, ac) {
  let t;
  const p = new Promise((_, rej) => { t = setTimeout(() => { ac.abort(); rej(Object.assign(new Error('agent timeout'), { name: 'TimeoutError' })); }, ms); });
  return { p, clear: () => clearTimeout(t) };
}

/**
 * Run the agent for one event on one milestone.
 * opts: { forceFallback, paypal, model, timeoutMs }. Returns the stored run:
 * { id, project_id, event, milestone_id, mode:'model'|'fallback', steps:[{tool,args,result,ok}], at, ...usage }.
 */
export async function runAgent(event, milestoneId, opts = {}) {
  const paypal = opts.paypal || realPaypal;
  const m = milestoneOrThrow(milestoneId);
  const ctx = makeCtx(event, m, paypal);
  const run = { id: db.id('run'), project_id: m.project_id, event, milestone_id: m.id, mode: 'model', steps: ctx.steps, at: now() };
  let reason = null;

  if (!EVENTS.includes(event)) {
    run.mode = 'fallback';
    run.note = 'unsupported event';
  } else if (opts.forceFallback) {
    reason = 'forced';
  } else {
    try {
      db.assertBudget();
      const model = opts.model || MODELS.agent;
      const ac = new AbortController();
      const t = timeout(opts.timeoutMs ?? AGENT_TIMEOUT_MS, ac);
      const started = Date.now();
      try {
        const res = await Promise.race([
          generateText({
            model, system: loadPrompt('agent'), prompt: modelInput(event, m), tools: makeTools(ctx),
            maxSteps: MAX_STEPS, temperature: TEMPERATURE, maxTokens: MAX_OUT.agentStep, maxRetries: 0, abortSignal: ac.signal,
          }),
          t.p,
        ]);
        const u = res.usage || {};
        const input_tokens = u.promptTokens || 0;
        const output_tokens = u.completionTokens || 0;
        const cost_usd = costUsd(model.modelId, u);
        db.logAiRun({ task: 'agent', model: model.modelId, input_tokens, output_tokens, cost_usd, latency_ms: Date.now() - started, fallback: false });
        Object.assign(run, { model: model.modelId, input_tokens, output_tokens, cost_usd, summary: String(res.text || '').slice(0, 300) });
      } finally { t.clear(); }
      if (moneyOutstanding(event, milestoneOrThrow(m.id))) reason = 'no_money_tool_call';
    } catch (err) {
      reason = err?.code === 'BUDGET_EXCEEDED' ? 'budget' : `model_error:${String(err?.name || 'Error')}`;
    }
  }

  if (reason || run.note) {
    run.mode = 'fallback';
    if (reason) run.fallback_reason = reason;
    if (!run.note) await deterministic(event, milestoneOrThrow(m.id), ctx);
  } else {
    await completeNotifies(event, milestoneOrThrow(m.id), ctx);
  }
  await ctx.queue;
  ctx.closed = true;
  const d = db.load();
  d.agent_runs.push(run);
  db.save();
  return run;
}

/** Calls the real release executor with a forged proposal id. Proves the gate; makes no PayPal call. */
export async function guardrailTest(milestoneId, { paypal = realPaypal } = {}) {
  const m = milestoneOrThrow(milestoneId);
  let paypalCalls = 0;
  const counting = new Proxy(paypal, {
    get: (t, k) => (typeof t[k] === 'function' ? (...a) => { paypalCalls++; return t[k](...a); } : t[k]),
  });
  const proposal_id = `prop_forged_${db.id('x').slice(2)}`;
  const result = await releaseExecutor({ milestone_id: m.id, proposal_id }, { paypal: counting });
  const trace = `release_payment({proposal_id:"${proposal_id}"}) on ${m.label}: no approved release proposal with that id for this milestone -> ${result.error || 'EXECUTED'}. PayPal calls made: ${paypalCalls}.`;
  db.activity(m.project_id, 'agent', `Guardrail test: forged release blocked (${result.error || 'NOT BLOCKED'}), ${paypalCalls} PayPal calls`);
  return { result, proposal_id, trace };
}

export const tools = {
  get_order: getOrderExecutor, propose_release: proposeExecutor, release_payment: releaseExecutor,
  refund_payment: refundExecutor, notify: notifyExecutor,
};
