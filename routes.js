// REST routes for projects, agreements and funding (docs/api.md steps 1-5 and 9).
// createRoutes({ paypal, ai }) takes the PayPal and AI modules as arguments so tests can pass stubs.
// Amounts always come from db.json; nothing from a request body ever reaches PayPal.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import * as db from './db.js';
import { need, membersOf, roleOf, memberWithRole } from './access.js';
import { userView } from './auth.js';
import { issueInvoice, invoiceView, invoiceData, renderInvoiceHtml } from './invoice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const uploadsRoot = () => process.env.UPLOAD_DIR || path.join(HERE, 'uploads');

const E = (code, message, status = 400) => new db.AppError(code, message, status);
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Hashing

export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function agreementHash(agreement, milestones) {
  const { translations: _t, ...body } = agreement.body;
  const ms = [...milestones].sort((a, b) => a.seq - b.seq).map((m) => ({
    label: m.label, title: m.title, amount_minor: m.amount_minor, criteria: m.criteria, rev_limit: m.rev_limit,
  }));
  return `sha256:${crypto.createHash('sha256').update(canonicalJson({ body, milestones: ms })).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// File validation (extension AND magic bytes)

const EXT_KIND = { '.txt': 'txt', '.jpg': 'image', '.jpeg': 'image', '.png': 'image' };

function checkFile(f) {
  const ext = path.extname(f.originalname).toLowerCase();
  const kind = EXT_KIND[ext];
  const bad = () => E('BAD_FILE', `"${f.originalname}" is not a valid ${ext || 'chat'} file. Use .txt, .jpg or .png.`);
  if (!kind) throw bad();
  const b = f.buffer;
  if (ext === '.png') {
    if (!(b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) throw bad();
    return { kind, mime: 'image/png' };
  }
  if (kind === 'image') {
    if (!(b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) throw bad();
    return { kind, mime: 'image/jpeg' };
  }
  if (b.includes(0)) throw bad();
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { throw bad(); }
  return { kind, mime: 'text/plain' };
}

const safeName = (n) => path.basename(n).replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_BYTES, fields: 10 },
  fileFilter: (_req, file, cb) => {
    // multer decodes names as latin1; keep the raw bytes' meaning for display
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!EXT_KIND[path.extname(file.originalname).toLowerCase()]) {
      return cb(E('BAD_FILE', `"${file.originalname}" is not allowed. Use .txt, .jpg or .png.`));
    }
    cb(null, true);
  },
}).any();

function parseUpload(req, res, up = uploader) {
  return new Promise((resolve, reject) => {
    up(req, res, (err) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return reject(E('FILE_TOO_LARGE', 'A file is larger than 20 MB.', 413));
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return reject(E('TOO_MANY_FILES', `Upload at most ${MAX_FILES} files.`));
        }
        return reject(E('BAD_FILE', err.message));
      }
      reject(err);
    });
  });
}


// ---- Deliverables (extension AND magic bytes) ------------------------------
const DLV_EXT = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.zip': 'application/zip', '.mp4': 'video/mp4',
};
const DLV_ALLOWED_MSG = 'Use .pdf, .png, .jpg, .jpeg, .zip or .mp4.';
const startsWith = (b, bytes, at = 0) => b.length >= at + bytes.length && bytes.every((x, i) => b[at + i] === x);

function checkDeliverable(f) {
  const ext = path.extname(f.originalname).toLowerCase();
  const mime = DLV_EXT[ext];
  const b = f.buffer;
  const ok = {
    '.pdf': () => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
    '.png': () => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
    '.jpg': () => startsWith(b, [0xff, 0xd8, 0xff]),
    '.jpeg': () => startsWith(b, [0xff, 0xd8, 0xff]),
    '.zip': () => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
    '.mp4': () => startsWith(b, [0x66, 0x74, 0x79, 0x70], 4),
  }[ext];
  if (!mime || !ok() || b.length === 0) {
    throw E('BAD_FILE', `"${f.originalname}" is not a valid ${ext || 'deliverable'} file. ${DLV_ALLOWED_MSG}`);
  }
  return mime;
}

const deliverableUploader = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_BYTES, fields: 10 },
  fileFilter: (_req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!DLV_EXT[path.extname(file.originalname).toLowerCase()]) {
      return cb(E('BAD_FILE', `"${file.originalname}" is not allowed. ${DLV_ALLOWED_MSG}`));
    }
    cb(null, true);
  },
}).any();

// ---------------------------------------------------------------------------
// Shapes

const D = () => db.load();
export const DEMO_CLIENT_ID = 'usr_demo_client';
const bodyMilestone = (req) => String(req.body?.milestone_id ?? '');
const bySeq = (a, b) => a.seq - b.seq;

function getProject(id) {
  const p = D().projects.find((x) => x.id === id && x.source !== 'lab' && !x.deleted_at);
  if (!p) throw E('NOT_FOUND', 'Project not found', 404);
  return p;
}
const agreementOf = (pid) => D().agreements.find((a) => a.project_id === pid) || null;
const milestonesOf = (pid) => D().milestones.filter((m) => m.project_id === pid).sort(bySeq);
const isFrozen = (a) => !!a && (a.status !== 'draft' || D().approvals.some((x) => x.agreement_id === a.id && x.party === 'freelancer'));

function getAgreement(id) {
  const a = D().agreements.find((x) => x.id === id);
  if (!a) throw E('NOT_FOUND', 'Agreement not found', 404);
  return a;
}
function getMilestone(id) {
  const m = D().milestones.find((x) => x.id === id && !x.source);
  if (!m) throw E('NOT_FOUND', 'Milestone not found', 404);
  return m;
}

function paymentView(p) {
  return p ? {
    order_id: p.order_id, authorization_id: p.authorization_id || null, expires_at: p.expires_at || null,
    capture_id: p.capture_id || null, refund_id: p.refund_id || null, status: p.status,
    payout_status: p.payout_status || null, payout_batch_id: p.payout_batch_id || null,
  } : null;
}

export function proposalView(p) {
  return p && {
    id: p.id, milestone_id: p.milestone_id, action: p.action, status: p.status,
    reason: p.reason, requested_by: p.requested_by ?? null, approved_by: p.approved_by ?? null, created_at: p.created_at,
  };
}

export function milestoneView(m) {
  const d = D();
  const current = db.currentMilestone(m.project_id);
  const agreement = agreementOf(m.project_id);
  const is_current = current?.id === m.id;
  const pays = d.payments.filter((p) => p.milestone_id === m.id);
  const dels = d.deliverables.filter((x) => x.milestone_id === m.id);
  const versions = dels.reduce((v, x) => Math.max(v, x.version), 0);
  const version = m.rev_count + 1; // current version: empty after a revision request until the freelancer re-uploads
  return {
    id: m.id, project_id: m.project_id, label: m.label, seq: m.seq, title: m.title,
    amount_minor: m.amount_minor, currency: m.currency, status: m.status,
    criteria: m.criteria, rev_count: m.rev_count, rev_limit: m.rev_limit, rev_note: m.rev_note ?? null,
    is_current, fundable: is_current && m.status === 'agreed' && agreement?.status === 'approved',
    start_day: m.start_day, end_day: m.end_day,
    payment: paymentView(pays[pays.length - 1]),
    deliverables: dels.filter((x) => x.version === version).map((x) => ({
      id: x.id, version: x.version, filename: x.filename, size: x.size, mime: x.mime, sha256: x.sha256,
      download_url: `/api/deliverables/${x.id}/download`,
    })),
    versions,
    proposal: proposalView([...d.proposals].reverse().find((p) => p.milestone_id === m.id && p.action !== 'refund' && (p.status === 'pending' || p.status === 'approved'))) ?? null,
    // The client's latest refund request: pending (waiting for the freelancer), approved (refund in progress) or declined.
    refund_request: proposalView([...d.proposals].reverse().find((p) => p.milestone_id === m.id && p.action === 'refund' && ['pending', 'approved', 'declined'].includes(p.status))) ?? null,
    invoice: invoiceView(m),
  };
}

function agreementView(a) {
  return a && { id: a.id, project_id: a.project_id, version: a.version, status: a.status, content_hash: a.content_hash, body: a.body };
}

function projectView(p) {
  const a = agreementOf(p.id);
  const ms = milestonesOf(p.id);
  let status = 'draft';
  if (a?.status === 'sent') status = 'sent';
  else if (a?.status === 'approved') {
    status = ms.every((m) => m.status === 'paid') ? 'completed'
      : ms.some((m) => m.status === 'voided') ? 'stopped' : 'active';
  }
  return {
    id: p.id, title: p.title ?? null, status, freelancer: p.freelancer ?? p.freelancer_name,
    client: p.client ?? null, freelancer_name: p.freelancer_name, created_at: p.created_at, is_demo: !!p.is_demo,
  };
}

const VOIDABLE_STATES = ['authorized', 'submitted', 'revision_requested'];
const termOf = (a, key) => a?.body?.terms?.find((t) => t.key === key)?.value ?? null;
/** Name shown to the other party: the profile's display name, else the PayPal name. */
const displayName = (u) => (u ? u.display_name || u.name || null : null);
const memberName = (projectId, role) => displayName(D().users.find((u) => u.id === memberWithRole(projectId, role)?.user_id));

/** What the agreement link shows before sign-in: who sent it and the total. Throws like usableInvite. */
export function invitePreview(token) {
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const i = typeof token === 'string' && token ? D().invites.find((x) => x.token_hash === sha(token)) : null;
  const p = i && D().projects.find((x) => x.id === i.project_id && !x.deleted_at);
  if (!p) throw E('NOT_FOUND', 'This invite link is not valid.', 404);
  if (i.revoked) throw E('INVITE_USED', 'This invite link was replaced. Ask the freelancer for the current one.', 409);
  if (i.expires_at && Date.parse(i.expires_at) <= Date.now()) throw E('INVITE_EXPIRED', 'This invite link has expired. Ask the freelancer for a new one.', 410);
  const a = agreementOf(p.id);
  const ms = milestonesOf(p.id);
  return {
    project: { id: p.id, title: p.title ?? a?.body?.title ?? null },
    freelancer: { name: memberName(p.id, 'freelancer') ?? p.freelancer_name ?? null },
    total_minor: ms.reduce((t, m) => t + m.amount_minor, 0), currency: a?.body?.currency ?? ms[0]?.currency ?? null, parts: ms.length,
  };
}

const ProfileBody = z.object({
  role: z.enum(['freelancer', 'client']).optional(),
  add_role: z.enum(['freelancer', 'client']).optional(),
  display_name: z.string().trim().min(1).max(60).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  bio: z.string().trim().max(160).optional(),
  client_type: z.enum(['individual', 'business']).optional(),
  hire_for: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  finish: z.boolean().optional(),
}).strict();
const avatarUrl = (u) => (u?.avatar?.data ? `/api/users/${u.id}/avatar?v=${Date.parse(u.avatar.at) || 0}` : null);
const MilestoneBody = z.object({
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  criteria: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
}); // unknown keys (status, ids...) are dropped, never applied
const MAX_MILESTONES = 12;
const DELETE_AFTER_DAYS = 15;

/** Remove projects with every row and uploaded file that belongs to them. */
function removeProjects(ids) {
  if (!ids.size) return;
  const d = D();
  const ags = new Set(d.agreements.filter((a) => ids.has(a.project_id)).map((a) => a.id));
  const ms = new Set(d.milestones.filter((m) => ids.has(m.project_id)).map((m) => m.id));
  for (const c of db.COLLECTIONS) {
    if (c === 'users' || c === 'ai_runs' || c === 'sessions') continue;
    d[c] = d[c].filter((row) => !((c === 'projects' && ids.has(row.id)) || ids.has(row.project_id) || ags.has(row.agreement_id) || ms.has(row.milestone_id)));
  }
  db.save();
  for (const pid of ids) fs.rmSync(path.join(uploadsRoot(), pid), { recursive: true, force: true });
}

const hasHolds = (uid) => {
  const d = D();
  const mine = new Set(d.project_members.filter((m) => m.user_id === uid).map((m) => m.project_id));
  return d.milestones.some((m) => mine.has(m.project_id) && VOIDABLE_STATES.includes(m.status));
};

/** Erase a user for good: their freelance projects (rows and files), memberships, sessions and profile. */
export function purgeUser(uid) {
  const d = D();
  const u = d.users.find((x) => x.id === uid);
  if (!u) return 0;
  const own = new Set(d.project_members.filter((m) => m.user_id === uid && m.role === 'freelancer').map((m) => m.project_id));
  removeProjects(own);
  d.sessions = d.sessions.filter((s) => s.user_id !== uid);
  d.project_members = d.project_members.filter((m) => m.user_id !== uid);
  for (const k of Object.keys(u)) if (!['id', 'created_at'].includes(k)) delete u[k];
  Object.assign(u, { deleted_at: now(), email: null, name: null, paypal_user_id: null });
  db.save();
  return own.size;
}

/** Erase every deleted project whose 15-day restore window is over. Returns how many were erased. */
export function purgeDueProjects(at = Date.now()) {
  const due = new Set(D().projects.filter((p) => p.deleted_at && p.delete_after && Date.parse(p.delete_after) <= at).map((p) => p.id));
  removeProjects(due);
  return due.size;
}

/**
 * Erase every account whose 15-day wait is over. Logging in during the wait cancels it (auth.js).
 * An account with money on hold waits until the hold is settled. Returns how many were erased.
 */
export function purgeDueAccounts(at = Date.now()) {
  let n = 0;
  for (const u of [...D().users]) {
    if (u.deleted_at || !u.delete_after || Date.parse(u.delete_after) > at || hasHolds(u.id)) continue;
    purgeUser(u.id);
    n++;
  }
  return n;
}

const lastPaymentOf = (mid) => [...D().payments].reverse().find((p) => p.milestone_id === mid) ?? null;
const money = (minor, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100);

// ---------------------------------------------------------------------------

export function createRoutes({ paypal, ai, agent, agentOpts = {}, fixturesDir = process.env.FIXTURES_DIR || FIXTURES, config = {} }) {
  const r = express.Router();
  const runAgent = (event, id, extra = {}) => agent.runAgent(event, id, { paypal, ...agentOpts, ...extra });

  /** Run a PayPal call; any failure becomes 502 PAYPAL_ERROR with the debug id. */
  async function pp(fn) {
    try { return await fn(); } catch (err) {
      if (err instanceof db.AppError) throw err;
      const e = E('PAYPAL_ERROR', 'PayPal could not complete this step. Nothing was charged; please try again.', 502);
      e.paypal_debug_id = err.paypal_debug_id ?? null;
      e.paypal_name = err.paypal_name;
      throw e;
    }
  }

  // De-duplicate concurrent double clicks: callers with the same key share one in-flight promise.
  const inflight = new Map();
  // Serialize work per key (a milestone's money moves never overlap).
  const chains = new Map();
  const serial = (key, fn) => {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return next;
  };
  const once = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  /** Replace the draft agreement + milestones of a project with an extraction result. */
  function applyExtraction(project, out) {
    const d = D();
    const cur = paypal.currency();
    if (String(out.body.currency).toUpperCase() !== cur) {
      throw E('CURRENCY_MISMATCH',
        `This chat's price is in ${out.body.currency}, but payments in this app are in ${cur}. Write the price in ${cur} (for example "Total $800") and try again.`, 422);
    }
    if (!out.milestones.length || out.milestones.some((m) => !(m.amount_minor > 0))) {
      throw E('EXTRACT_INCOMPLETE', 'Could not find a price for each part of the work. Add a line that states the total price and try again.', 422);
    }
    const old = agreementOf(project.id);
    if (old) {
      d.agreements = d.agreements.filter((a) => a.id !== old.id);
      d.approvals = d.approvals.filter((a) => a.agreement_id !== old.id);
    }
    d.milestones = d.milestones.filter((m) => m.project_id !== project.id);
    const agreement = {
      id: db.id('agr'), project_id: project.id, version: 1, status: 'draft', content_hash: null,
      body: out.body, created_at: now(),
    };
    d.agreements.push(agreement);
    for (const m of out.milestones) {
      d.milestones.push({
        id: db.id('ms'), project_id: project.id, agreement_id: agreement.id, label: m.label, seq: m.seq,
        title: m.title, amount_minor: m.amount_minor, currency: m.currency || out.body.currency,
        status: 'draft', criteria: m.criteria || [], rev_count: 0, rev_limit: null, rev_note: null,
        start_day: m.start_day ?? 0, end_day: m.end_day ?? 0,
      });
    }
    project.title = out.body.title;
    project.client = out.body.client_name;
    project.freelancer = out.body.freelancer_name || project.freelancer_name;
    db.save();
    db.activity(project.id, 'ai', 'Agreement drafted from the chat');
    return agreement;
  }

  const aiRunView = (u) => ({
    model: u?.model ?? null, input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0,
    cost_usd: u?.cost_usd ?? 0, fallback: !!u?.fallback,
  });

  // ---- Config helpers ------------------------------------------------------
  r.get('/sandbox-login', (req, res) => {
    if (!isLocal(req)) throw E('FORBIDDEN', 'Only available on localhost', 403);
    res.json({
      email: process.env.PAYPAL_SANDBOX_BUYER_EMAIL || '',
      password: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD || '',
    });
  });

  // ---- Step 1: dashboard ---------------------------------------------------
  r.get('/projects', (req, res) => {
    const d = D();
    const myRows = d.project_members.filter((m) => m.user_id === req.user.id);
    const myRole = new Map(myRows.map((m) => [m.project_id, m.role]));
    const archived = new Set(myRows.filter((m) => m.archived_at).map((m) => m.project_id));
    const projects = d.projects.filter((p) => p.source !== 'lab' && !p.deleted_at && myRole.has(p.id));
    const ids = new Set(projects.filter((p) => myRole.get(p.id) === 'freelancer').map((p) => p.id)); // totals: my freelance work
    const latest = new Map(); // milestone_id -> latest ledger event
    let paid = 0;
    const released = new Set(); // milestones whose payment was released to the freelancer
    for (const l of d.ledger) {
      if (!ids.has(l.project_id) || !l.event) continue;
      latest.set(l.milestone_id, l.event);
      if (l.event === 'CAPTURED') { paid += l.amount_minor; released.add(l.milestone_id); }
      // A refund of a payment that was only held never counted as paid, so it takes nothing off.
      if (l.event === 'REFUNDED' && released.has(l.milestone_id)) paid -= l.amount_minor;
    }
    let held = 0, notFunded = 0;
    for (const m of d.milestones) {
      if (!ids.has(m.project_id)) continue;
      if (['HELD', 'AUTHORIZED'].includes(latest.get(m.id))) held += m.amount_minor;
      if (m.status === 'draft' || m.status === 'agreed') notFunded += m.amount_minor;
    }
    res.json({
      projects: projects.map((p) => {
        const ms = milestonesOf(p.id);
        const cr = d.change_requests.find((c) => c.project_id === p.id && (c.status === 'open' || c.status === 'sent'));
        const v = projectView(p);
        const a = agreementOf(p.id);
        const cur = ms.find((m) => m.status !== 'paid');
        const last = d.activity.filter((x) => x.project_id === p.id).at(-1);
        return {
          id: p.id, my_role: myRole.get(p.id), is_demo: v.is_demo, title: v.title, archived: archived.has(p.id),
          freelancer: memberName(p.id, 'freelancer') ?? v.freelancer, client: memberName(p.id, 'client') ?? v.client,
          total_minor: ms.reduce((s, m) => s + m.amount_minor, 0), status: v.status,
          currency: a?.body?.currency ?? ms[0]?.currency ?? null, deadline: termOf(a, 'deadline'),
          agreement_status: a?.status ?? null,
          held_minor: ms.filter((m) => VOIDABLE_STATES.includes(m.status)).reduce((s, m) => s + m.amount_minor, 0),
          paid_minor: ms.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amount_minor, 0),
          paid_count: ms.filter((m) => m.status === 'paid').length,
          current: cur ? { id: cur.id, label: cur.label, title: cur.title, status: cur.status, amount_minor: cur.amount_minor,
            fundable: cur.status === 'agreed' && a?.status === 'approved' } : null,
          milestones: ms.map((m) => ({ id: m.id, label: m.label, title: m.title, status: m.status, amount_minor: m.amount_minor })),
          open_change_request: cr ? { id: cr.id, from: cr.from, status: cr.status } : null,
          updated_at: last?.at ?? p.created_at ?? null,
        };
      }).reverse(),
      totals: { held_minor: held, paid_minor: paid, not_funded_minor: notFunded },
      client_totals: (() => {
        const mine = new Set(projects.filter((p) => myRole.get(p.id) === 'client').map((p) => p.id));
        const cms = d.milestones.filter((m) => mine.has(m.project_id));
        return {
          held_minor: cms.filter((m) => VOIDABLE_STATES.includes(m.status)).reduce((s, m) => s + m.amount_minor, 0),
          paid_minor: cms.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amount_minor, 0),
        };
      })(),
    });
  });

  // ---- Step 2: paste chat --------------------------------------------------
  r.post('/projects', async (req, res) => {
    await parseUpload(req, res);
    const files = req.files || [];
    const chatText = String(req.body?.chatText ?? '');
    const freelancer = String(req.body?.freelancer_name ?? '').trim().slice(0, 60) || 'Ploy';
    if (!chatText.trim() && !files.length) throw E('EMPTY_CHAT', 'Paste the chat or upload a file first.');

    const checked = files.map((f) => ({ f, ...checkFile(f) }));
    const pid = db.id('prj');
    const dir = path.join(uploadsRoot(), pid);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });

    try {
      let textMsgs = chatText.trim() ? ai.parseChatText(chatText, { freelancerName: freelancer }) : [];
      const importFiles = [];
      const images = [];
      fs.mkdirSync(dir, { recursive: true });
      for (const [i, c] of checked.entries()) {
        const name = c.f.originalname;
        const disk = path.join(dir, `${i + 1}-${safeName(name)}`);
        fs.writeFileSync(disk, c.f.buffer);
        if (c.kind === 'txt') {
          const parsed = ai.parseChatText(c.f.buffer.toString('utf8'), { freelancerName: freelancer, source_file: name });
          textMsgs = textMsgs.concat(parsed);
          importFiles.push({ name, kind: 'txt', messages: parsed.length });
        } else {
          images.push({ path: disk, name, mime: c.mime });
          importFiles.push({ name, kind: 'image', messages: 0 });
        }
      }

      let imageMsgs = [];
      let deduped = 0;
      if (images.length) {
        try {
          const t = await ai.transcribeImages(images, { freelancerName: freelancer });
          const dd = ai.dedupeMessages(t.messages);
          imageMsgs = dd.messages;
          deduped = dd.removed;
        } catch (err) {
          if (err?.code === 'BUDGET_EXCEEDED') throw err;
          throw E('AI_FAILED', 'Could not read the screenshots. Please paste the text instead.', 502);
        }
      }

      const messages = ai.numberMessages([...textMsgs, ...imageMsgs]);
      if (!messages.length) throw E('EMPTY_CHAT', 'No chat messages found. Each line should look like "Name: message".');
      for (const f of importFiles) {
        if (f.kind === 'image') f.messages = messages.filter((m) => m.source_file === f.name).length;
      }

      const d = D();
      const project = {
        id: pid, title: null, status: 'draft', freelancer_name: freelancer, created_at: now(),
        owner_id: req.user.id, is_demo: false, payee_merchant_id: null,
      };
      d.projects.push(project);
      d.project_members.push({ project_id: pid, user_id: req.user.id, role: 'freelancer', at: now() });
      for (const m of messages) d.messages.push({ ...m, project_id: pid });
      db.save();
      db.activity(pid, 'sys', `Chat imported (${messages.length} messages)`);
      res.status(201).json({
        project: { id: pid, title: null, status: 'draft' },
        messages,
        import: { deduped, files: importFiles },
      });
    } catch (err) {
      if (!D().projects.some((p) => p.id === pid)) cleanup();
      throw err;
    }
  });

  const projectMessages = (pid) => D().messages.filter((m) => m.project_id === pid).sort(bySeq)
    .map(({ project_id: _p, ...m }) => m);

  // ---- Step 3: agreement review -------------------------------------------
  r.post('/projects/:id/extract', need('project', 'freelancer'), async (req, res) => {
    const project = getProject(req.params.id);
    const old = agreementOf(project.id);
    if (isFrozen(old)) throw E('AGREEMENT_FROZEN', 'The freelancer already approved this agreement.', 409);
    const messages = projectMessages(project.id);
    if (!messages.length) throw E('EMPTY_CHAT', 'This project has no chat messages.');
    let out;
    try {
      out = await ai.extractAgreement(messages);
    } catch (err) {
      if (err?.code === 'BUDGET_EXCEEDED') throw err;
      console.error('extract failed:', err?.message);
      throw E('AI_FAILED', 'The AI could not read this chat. Please try again.', 502);
    }
    const agreement = applyExtraction(project, out);
    res.json({
      agreement: agreementView(agreement),
      milestones: milestonesOf(project.id).map(milestoneView),
      ai_run: aiRunView(out.usage),
    });
  });

  r.post('/agreements/:id/gaps/:gapId/fix', need('agreement', 'freelancer'), (req, res) => {
    const a = getAgreement(req.params.id);
    if (isFrozen(a)) throw E('AGREEMENT_FROZEN', 'The freelancer already approved this agreement.', 409);
    const gap = a.body.gaps.find((g) => g.id === req.params.gapId);
    if (!gap) throw E('NOT_FOUND', 'No such gap', 404);
    if (!gap.fixed) {
      gap.fixed = true;
      if (gap.term_key) {
        const term = a.body.terms.find((t) => t.key === gap.term_key);
        if (term) term.value = gap.term_value;
      }
      if (gap.term_key === 'revisions') {
        const n = Number(/\d+/.exec(gap.term_value || '')?.[0]) || 2;
        for (const m of milestonesOf(a.project_id)) m.rev_limit = n;
      }
      db.save();
      db.activity(a.project_id, 'free', `Gap fixed: ${gap.fix_label}`);
    }
    res.json({ agreement: agreementView(a), milestones: milestonesOf(a.project_id).map(milestoneView) });
  });

  r.patch('/milestones/:id', need('milestone', 'freelancer'), (req, res) => {
    const m = getMilestone(req.params.id);
    const a = agreementOf(m.project_id);
    if (isFrozen(a) || m.status !== 'draft') throw E('AGREEMENT_FROZEN', 'Milestones cannot change after the freelancer approves.', 409);
    const raw = req.body || {};
    if (raw.amount_minor !== undefined && (!Number.isSafeInteger(raw.amount_minor) || raw.amount_minor < 0)) {
      throw E('BAD_AMOUNT', 'amount_minor must be a non-negative integer (cents).');
    }
    const parsed = MilestoneBody.safeParse(raw);
    if (!parsed.success || !Object.keys(parsed.data).length) {
      const f = parsed.success ? null : parsed.error.issues[0]?.path?.[0];
      throw E('BAD_MILESTONE', f === 'title' ? 'Give the milestone a title (up to 120 characters).'
        : f === 'criteria' ? 'Use up to 12 lines, each up to 200 characters.' : 'Send a title, criteria or amount_minor to change.');
    }
    const b = parsed.data;
    if (b.amount_minor !== undefined) m.amount_minor = b.amount_minor;
    if (b.title !== undefined) m.title = b.title;
    if (b.criteria !== undefined) m.criteria = b.criteria;
    db.save();
    const sum = milestonesOf(m.project_id).reduce((s, x) => s + x.amount_minor, 0);
    const total = a?.body.total_minor ?? sum;
    res.json({ milestone: milestoneView(m), sum_minor: sum, agreed_total_minor: total, mismatch: sum !== total });
  });

  // Add or remove a milestone while the agreement is still a draft. Labels stay M1..Mn in order.
  const relabel = (pid) => milestonesOf(pid).forEach((m, i) => { m.seq = i + 1; m.label = `M${i + 1}`; });

  r.post('/agreements/:id/milestones', need('agreement', 'freelancer'), (req, res) => {
    const a = getAgreement(req.params.id);
    if (isFrozen(a)) throw E('AGREEMENT_FROZEN', 'Milestones cannot change after the freelancer approves.', 409);
    const ms = milestonesOf(a.project_id);
    if (ms.length >= MAX_MILESTONES) throw E('TOO_MANY_MILESTONES', `An agreement can have up to ${MAX_MILESTONES} milestones.`, 409);
    const last = ms[ms.length - 1];
    const title = (typeof req.body?.title === 'string' ? req.body.title : '').trim().slice(0, 120) || 'New milestone';
    const start = last?.end_day ?? 0;
    D().milestones.push({
      id: db.id('ms'), project_id: a.project_id, agreement_id: a.id, label: `M${ms.length + 1}`, seq: (last?.seq ?? 0) + 1,
      title, amount_minor: 0, currency: last?.currency || a.body.currency, status: 'draft', criteria: [],
      rev_count: 0, rev_limit: last?.rev_limit ?? null, rev_note: null, start_day: start, end_day: start + 3,
    });
    relabel(a.project_id);
    db.save();
    res.status(201).json({ milestones: milestonesOf(a.project_id).map(milestoneView) });
  });

  r.delete('/milestones/:id', need('milestone', 'freelancer'), (req, res) => {
    const m = getMilestone(req.params.id);
    const a = agreementOf(m.project_id);
    if (isFrozen(a) || m.status !== 'draft') throw E('AGREEMENT_FROZEN', 'Milestones cannot change after the freelancer approves.', 409);
    if (milestonesOf(m.project_id).length <= 1) throw E('LAST_MILESTONE', 'An agreement needs at least one milestone.', 409);
    const d = D();
    d.milestones = d.milestones.filter((x) => x.id !== m.id);
    relabel(m.project_id);
    db.save();
    res.json({ milestones: milestonesOf(m.project_id).map(milestoneView) });
  });

  // ---- Project title, archive, delete --------------------------------------
  // The title is a display name. While the agreement is a draft it is also the agreement's title;
  // once version 1 is locked the agreement text stays as approved and only the project name changes.
  r.patch('/projects/:id', need('project', 'freelancer'), (req, res) => {
    const p = getProject(req.params.id);
    const title = (typeof req.body?.title === 'string' ? req.body.title : '').trim();
    if (!title || title.length > 80) throw E('BAD_TITLE', 'Give the project a title (up to 80 characters).');
    p.title = title;
    const a = agreementOf(p.id);
    if (a && !isFrozen(a)) a.body.title = title;
    db.save();
    res.json({ project: projectView(p) });
  });

  // Archiving hides a project from the member's own list; the other person still sees it.
  r.post('/projects/:id/archive', need('project'), (req, res) => {
    if (typeof req.body?.archived !== 'boolean') throw E('BAD_REQUEST', 'archived must be true or false.');
    const row = D().project_members.find((m) => m.project_id === req.projectId && m.user_id === req.user.id);
    if (!row) throw E('NOT_FOUND', 'Project not found', 404);
    if (req.body.archived) row.archived_at = row.archived_at || now(); else delete row.archived_at;
    db.save();
    res.json({ id: req.projectId, archived: !!row.archived_at });
  });

  // Deleted projects the freelancer can still restore (15 days). Registered before the /projects/:id routes.
  const deletedView = (p) => ({ id: p.id, title: p.title ?? null, client: memberName(p.id, 'client') ?? p.client ?? null, deleted_at: p.deleted_at, restore_until: p.delete_after });
  const myDeleted = (uid) => {
    const mine = new Set(D().project_members.filter((m) => m.user_id === uid && m.role === 'freelancer').map((m) => m.project_id));
    return D().projects.filter((p) => p.deleted_at && mine.has(p.id) && Date.parse(p.delete_after) > Date.now());
  };
  r.get('/projects/deleted', (req, res) => {
    res.json({ projects: myDeleted(req.user.id).map(deletedView).reverse(), days: DELETE_AFTER_DAYS });
  });
  r.post('/projects/:id/restore', (req, res) => {
    const p = myDeleted(req.user.id).find((x) => x.id === req.params.id);
    if (!p) throw E('NOT_FOUND', 'Project not found', 404);
    delete p.deleted_at; delete p.delete_after; delete p.deleted_by;
    db.save();
    db.activity(p.id, 'free', 'Project restored');
    res.json({ project: projectView(p) });
  });

  // Deleting hides the project from both people at once and erases it after 15 days (purgeDueProjects); until then
  // the freelancer can restore it. Refused once money is on hold or has been paid.
  r.delete('/projects/:id', need('project', 'freelancer'), (req, res) => {
    const p = getProject(req.params.id);
    const ms = milestonesOf(p.id);
    if (ms.some((m) => VOIDABLE_STATES.includes(m.status))) {
      throw E('ACTIVE_HOLDS', 'Money is on hold in this project. Finish that milestone or agree a refund first.', 409);
    }
    if (ms.some((m) => m.status === 'paid' || m.status === 'refunded')) {
      throw E('HAS_PAYMENTS', 'This project has payments, so its record is kept. Archive it instead.', 409);
    }
    Object.assign(p, { deleted_at: now(), delete_after: new Date(Date.now() + DELETE_AFTER_DAYS * 864e5).toISOString(), deleted_by: req.user.id });
    db.save();
    res.json({ ok: true, restore_until: p.delete_after, days: DELETE_AFTER_DAYS });
  });

  // ---- Step 4: approve agreement ------------------------------------------
  r.post('/agreements/:id/approve', need('agreement'), (req, res) => {
    const a = getAgreement(req.params.id);
    const party = req.role; // from membership, never from the body
    const { content_hash } = req.body || {};
    const d = D();
    const ms = milestonesOf(a.project_id);
    const project = d.projects.find((p) => p.id === a.project_id);
    if (party === 'freelancer') {
      if (a.status === 'draft') {
        const sum = ms.reduce((t, m) => t + m.amount_minor, 0);
        const total = a.body.total_minor;
        if (sum !== total) {
          throw E('AMOUNT_MISMATCH', `The parts add up to ${money(sum, a.body.currency)} but the agreed total is ${money(total, a.body.currency)}. Fix the amounts first.`, 409);
        }
        if (ms.some((m) => !(m.amount_minor >= 100))) {
          throw E('AMOUNT_MISMATCH', `Every part must be at least ${money(100, a.body.currency)}. Fix the amounts first.`, 409);
        }
        a.content_hash = agreementHash(a, ms);
        a.status = 'sent';
        d.approvals.push({ agreement_id: a.id, party: 'freelancer', user_id: req.actorUserId, content_hash: a.content_hash, at: now() });
        db.save();
        db.activity(a.project_id, 'free', `${project.freelancer || 'Freelancer'} approved the agreement and sent it to the client`);
      }
      return res.json({ agreement: agreementView(a) });
    }
    if (party === 'client') {
      if (a.status === 'draft') throw E('NOT_SENT', 'The freelancer has not approved the agreement yet.', 409);
      if (content_hash !== a.content_hash) {
        throw E('HASH_MISMATCH', 'The agreement changed or does not match what you were shown. Reload and review again.', 409);
      }
      if (a.status === 'sent') {
        a.status = 'approved';
        d.approvals.push({ agreement_id: a.id, party: 'client', user_id: req.actorUserId, content_hash: a.content_hash, at: now() });
        for (const m of ms) if (m.status === 'draft') db.transition(m, 'agreed');
        db.save();
        db.activity(a.project_id, 'client', `${project.client || 'Client'} approved the agreement. Nothing was charged.`);
      }
      return res.json({ agreement: agreementView(a), milestones: ms.map(milestoneView) });
    }
  });

  // ---- Demo ----------------------------------------------------------------
  r.post('/demo', async (req, res) => {
    const text = fs.readFileSync(path.join(fixturesDir, 'baan-kafe.txt'), 'utf8');
    const cache = path.join(fixturesDir, 'baan-kafe.extract.json');
    const messages = ai.parseChatText(text, { freelancerName: 'Ploy' });
    let out;
    if (fs.existsSync(cache)) {
      out = JSON.parse(fs.readFileSync(cache, 'utf8'));
    } else {
      out = await ai.extractAgreement(messages);
      fs.writeFileSync(cache, JSON.stringify({ body: out.body, milestones: out.milestones, usage: out.usage }, null, 2));
    }
    const d = D();
    const project = {
      id: db.id('prj'), title: null, status: 'draft', freelancer_name: 'Ploy', created_at: now(),
      owner_id: req.user.id, is_demo: true, payee_merchant_id: null,
    };
    for (const m of messages) d.messages.push({ ...m, project_id: project.id });
    d.projects.push(project);
    try {
      applyExtraction(project, out);
    } catch (err) {
      d.projects = d.projects.filter((p) => p.id !== project.id);
      d.messages = d.messages.filter((m) => m.project_id !== project.id);
      db.save();
      throw err;
    }
    // The demo client is a placeholder user that can never log in; Judge mode acts as it (X-Act-As: client).
    let demoClient = d.users.find((u) => u.id === DEMO_CLIENT_ID);
    if (!demoClient) {
      demoClient = { id: DEMO_CLIENT_ID, paypal_user_id: null, email: null, name: 'Nok (demo)', display_name: 'Nok', roles: ['client'], active_role: 'client', client_type: 'business', onboarded_at: now(), created_at: now(), last_login_at: null };
      d.users.push(demoClient);
    }
    d.project_members.push({ project_id: project.id, user_id: req.user.id, role: 'freelancer', at: now() });
    if (demoClient.id !== req.user.id) d.project_members.push({ project_id: project.id, user_id: demoClient.id, role: 'client', at: now() });
    db.save();
    res.status(201).json({ project_id: project.id });
  });

  // ---- Step 5: fund --------------------------------------------------------
  function fundable(m) {
    const cur = db.currentMilestone(m.project_id);
    if (cur?.id !== m.id) throw E('NOT_CURRENT', 'Pay for the milestones in order: finish the earlier one first.', 409);
    if (agreementOf(m.project_id)?.status !== 'approved') {
      throw E('AGREEMENT_NOT_APPROVED', 'Both sides must approve the agreement before any payment.', 409);
    }
    if (m.status !== 'agreed') throw E('NOT_CURRENT', 'This milestone is not waiting for payment.', 409);
  }

  r.post('/milestones/:id/order', need('milestone', 'client'), async (req, res) => {
    const m = getMilestone(req.params.id); // request body is ignored on purpose
    const out = await once(`order:${m.id}`, async () => {
      fundable(m);
      const d = D();
      const existing = d.payments.find((p) => p.milestone_id === m.id && p.status === 'CREATED');
      if (existing) return { order_id: existing.order_id, status: 'CREATED' };
      const attempt = d.payments.filter((p) => p.milestone_id === m.id).length + 1;
      const order = await pp(() => paypal.createCaptureOrder(m, attempt));
      d.payments.push({
        id: db.id('pay'), project_id: m.project_id, milestone_id: m.id, order_id: order.id, attempt,
        authorization_id: null, expires_at: null, capture_id: null, status: 'CREATED', created_at: now(),
      });
      db.save();
      return { order_id: order.id, status: 'CREATED' };
    });
    res.json(out);
  });

  r.post('/milestones/:id/authorize', need('milestone', 'client'), async (req, res) => {
    const m = getMilestone(req.params.id);
    const orderId = req.body?.order_id;
    const pay = typeof orderId === 'string'
      ? D().payments.find((p) => p.milestone_id === m.id && p.order_id === orderId) : null;
    if (!pay) throw E('ORDER_MISMATCH', 'That PayPal order does not belong to this milestone.', 409);
    const payload = await once(`auth:${pay.order_id}`, async () => {
      if (pay.status !== 'CREATED') return { milestone: milestoneView(m), payment: paymentView(pay) }; // repeat call
      fundable(m);
      // The client is charged here. The captured money stays on the Milestone Pay account, with no expiry, until
      // the client approves the work (payout) or both sides agree a refund.
      const c = await pp(() => paypal.captureOrder(pay.order_id));
      if (!['COMPLETED', 'PENDING'].includes(c.status)) throw E('PAYPAL_ERROR', 'PayPal did not complete the payment. Nothing was charged; please try again.', 502);
      db.transition(m, 'authorized');
      Object.assign(pay, { status: 'HELD', capture_id: c.capture_id, expires_at: null, payer_user_id: req.actorUserId });
      db.save();
      db.ledgerAdd({
        project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'HELD',
        paypal_id: c.capture_id, amount_minor: m.amount_minor,
      });
      db.activity(m.project_id, 'pp', `${m.label} ${money(m.amount_minor, m.currency)} is held by Milestone Pay (PayPal capture ${c.capture_id})`);
      db.notify(m.project_id, 'freelancer', `${m.label} is funded. ${money(m.amount_minor, m.currency)} is held by Milestone Pay, so you can start "${m.title}".`);
      return { milestone: milestoneView(m), payment: paymentView(pay) };
    });
    res.json(payload);
  });

  // ---- Step 6: submit work -------------------------------------------------
  const SUBMITTABLE = ['authorized', 'revision_requested'];

  r.post('/milestones/:id/deliverables', need('milestone', 'freelancer'), async (req, res) => {
    await parseUpload(req, res, deliverableUploader);
    const m = getMilestone(req.params.id);
    if (db.currentMilestone(m.project_id)?.id !== m.id || !SUBMITTABLE.includes(m.status)) {
      throw E('NOT_SUBMITTABLE', 'Files can only be uploaded for the current milestone once it is funded (or after a revision request).', 409);
    }
    const files = req.files || [];
    if (!files.length) throw E('BAD_FILE', 'Choose at least one file to upload.');
    const checked = files.map((f) => ({ f, mime: checkDeliverable(f) }));
    const version = m.rev_count + 1;
    const rel = path.join(m.project_id, m.id, `v${version}`);
    const dir = path.join(uploadsRoot(), rel);
    fs.mkdirSync(dir, { recursive: true });
    const d = D();
    for (const { f, mime } of checked) {
      const did = db.id('dlv');
      const stored = path.join(rel, `${did}-${safeName(f.originalname)}`);
      fs.writeFileSync(path.join(uploadsRoot(), stored), f.buffer);
      d.deliverables.push({
        id: did, project_id: m.project_id, milestone_id: m.id, version, filename: f.originalname,
        size: f.buffer.length, mime, sha256: crypto.createHash('sha256').update(f.buffer).digest('hex'),
        path: stored, created_at: now(),
      });
    }
    db.save();
    db.activity(m.project_id, 'free', `${m.label}: uploaded ${checked.length} file${checked.length === 1 ? '' : 's'} (version ${version})`);
    res.status(201).json({ deliverables: milestoneView(m).deliverables, version });
  });

  r.post('/milestones/:id/submit', need('milestone', 'freelancer'), async (req, res) => {
    const m = getMilestone(req.params.id);
    const out = await once(`submit:${m.id}`, async () => {
      if (db.currentMilestone(m.project_id)?.id !== m.id) {
        throw E('NOT_CURRENT', 'Only the current milestone can be submitted.', 409);
      }
      if (!SUBMITTABLE.includes(m.status)) db.transition({ ...m }, 'submitted'); // throws ILLEGAL_TRANSITION
      const version = m.rev_count + 1;
      if (!D().deliverables.some((x) => x.milestone_id === m.id && x.version === version)) {
        throw E('NO_FILES', 'Upload at least one file before submitting.', 409);
      }
      db.transition(m, 'submitted');
      db.activity(m.project_id, 'free', `${m.label} submitted for review (version ${version})`);
      db.notify(m.project_id, 'client', `${m.label} was delivered. Review the files and approve to pay ${money(m.amount_minor, m.currency)}.`);
      // The milestone is already `submitted`; an agent failure must never turn that into a 500.
      let agent_run = null;
      try { agent_run = await runAgent('milestone.submitted', m.id); } catch (err) {
        console.error('agent failed after submit:', err?.message);
        try { agent_run = await runAgent('milestone.submitted', m.id, { forceFallback: true }); } catch (e2) { console.error('agent fallback failed:', e2?.message); }
      }
      const proposal = [...D().proposals].reverse().find((p) => p.milestone_id === m.id && p.action === 'release' && p.status === 'pending') ?? null;
      return { milestone: milestoneView(m), proposal: proposalView(proposal), agent_run };
    });
    res.json(out);
  });

  // ---- Step 7: client reviews ---------------------------------------------
  const DLV_ID = /^dlv_[a-f0-9]+$/;
  r.get('/deliverables/:id/download', need('deliverable'), (req, res) => {
    const id = req.params.id;
    const row = DLV_ID.test(id) ? D().deliverables.find((x) => x.id === id) : null;
    if (!row || !row.path) throw E('NOT_FOUND', 'File not found', 404);
    const root = path.resolve(uploadsRoot());
    const file = path.resolve(root, row.path); // row.path comes from the db, never from the request
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw E('NOT_FOUND', 'File not found', 404);
    const disp = req.query.inline === '1' ? 'inline' : 'attachment';
    const ascii = row.filename.replace(/[^\x20-\x7e]|["\;%]/g, '_');
    res.set({
      'Content-Type': row.mime,
      'Content-Length': String(fs.statSync(file).size),
      'Content-Disposition': `${disp}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });

  r.post('/milestones/:id/revision', need('milestone', 'client'), (req, res) => {
    const m = getMilestone(req.params.id);
    const note = (typeof req.body?.note === 'string' ? req.body.note : '').trim().slice(0, 1000);
    if (note.length < 5) throw E('NOTE_TOO_SHORT', 'Tell the freelancer what to change (at least 5 characters).');
    if (db.currentMilestone(m.project_id)?.id !== m.id) throw E('NOT_CURRENT', 'Only the current milestone can be reviewed.', 409);
    db.transition({ ...m }, 'revision_requested'); // throws ILLEGAL_TRANSITION unless submitted
    if (m.rev_limit != null && m.rev_count >= m.rev_limit) {
      throw E('REVISION_LIMIT', `All ${m.rev_limit} revision rounds for ${m.label} are used.`, 409);
    }
    const items = Array.isArray(req.body?.items)
      ? req.body.items.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 10) : [];
    db.transition(m, 'revision_requested', { rev_count: m.rev_count + 1, rev_note: note, rev_items: items });
    for (const p of D().proposals) {
      if (p.milestone_id === m.id && p.action === 'release' && p.status === 'pending') p.status = 'withdrawn';
    }
    db.save();
    const round = m.rev_limit != null ? `round ${m.rev_count} of ${m.rev_limit}` : `round ${m.rev_count}`;
    db.activity(m.project_id, 'client', `${m.label}: revision requested (${round})`);
    db.notify(m.project_id, 'freelancer', `Revision requested on ${m.label} (${round})`);
    // The request opens the project chat (or adds to it) so the two can talk the changes through.
    const proj = D().projects.find((x) => x.id === m.project_id);
    (proj.chat ||= []).push({ id: db.id('msg'), from: 'client', kind: 'revision', milestone_id: m.id, label: m.label, text: note, at: now() });
    db.save();
    res.json({ milestone: milestoneView(m) });
  });

  // ---- Project chat (opens with the first revision request) ---------------
  // Untrusted text between the two people. Never sent to the agent or any model.
  r.post('/projects/:id/chat', need('project'), (req, res) => {
    const p = getProject(req.params.id);
    const text = (typeof req.body?.text === 'string' ? req.body.text : '').trim().slice(0, 1000);
    if (!text) throw E('MESSAGE_TOO_SHORT', 'Write a message first.');
    if (!Array.isArray(p.chat)) throw E('CHAT_NOT_OPEN', 'The chat opens when the client asks for a revision.', 409);
    if (p.chat.length >= 500) throw E('CHAT_FULL', 'This chat is full.', 409);
    const message = { id: db.id('msg'), from: req.role, kind: 'message', text, at: now() };
    p.chat.push(message);
    db.save();
    res.status(201).json({ message, chat: p.chat });
  });

  // ---- Step 7 (cont.): proposals, agent ------------------------------------
  const getProposal = (id) => {
    const p = D().proposals.find((x) => x.id === id);
    if (!p) throw E('NOT_FOUND', 'Proposal not found', 404);
    return p;
  };
  const runById = (id) => D().agent_runs.find((x) => x.id === id) ?? null;
  const nextView = (m) => {
    const n = db.currentMilestone(m.project_id);
    return n ? { milestone_id: n.id, label: n.label, title: n.title, amount_minor: n.amount_minor } : null;
  };
  const lastPayment = (m) => [...D().payments].reverse().find((p) => p.milestone_id === m.id) ?? null;
  /** A money step failed in the agent run: surface it as PAYPAL_ERROR (nothing changed) with the debug id. */
  function moneyFailure(run, tool) {
    const s = [...(run?.steps || [])].reverse().find((x) => x.tool === tool && !x.ok);
    const e = E('PAYPAL_ERROR', 'PayPal could not complete this step. Nothing was changed; please try again.', 502);
    e.paypal_debug_id = s?.result?.paypal_debug_id ?? null;
    return e;
  }

  r.post('/proposals/:id/approve', need('proposal', 'client'), async (req, res) => {
    const prop = getProposal(req.params.id);
    const m = getMilestone(prop.milestone_id);
    // One lock per milestone for approve and refund: a double click or a racing refund cannot move the money twice.
    const out = await once(`approve:${m.id}`, () => serial(`money:${m.id}`, async () => {
      if (prop.action !== 'release') throw E('PROPOSAL_NOT_PENDING', 'This proposal is not a release proposal.', 409);
      if (prop.status === 'pending') {
        if (m.status !== 'submitted') throw E('PROPOSAL_NOT_PENDING', 'This milestone is not waiting for review.', 409);
        prop.status = 'approved';
        prop.approved_by = 'client';
        prop.approved_by_user = req.actorUserId;
        db.save();
        db.activity(m.project_id, 'client', `${m.label}: client approved the work and the release of ${money(m.amount_minor, m.currency)}`);
      } else if (prop.status === 'approved' && m.status === 'submitted') {
        // an earlier attempt failed at PayPal: retry (the payout batch id is fixed, so PayPal cannot pay twice)
      } else if (prop.status === 'executed' || prop.status === 'approved') {
        // already done: return the first result
      } else {
        throw E('PROPOSAL_NOT_PENDING', 'This proposal is no longer pending.', 409);
      }
      let run = runById(prop.run_id);
      if (m.status === 'submitted') {
        run = await runAgent('proposal.approved', m.id);
        prop.run_id = run.id;
        db.save();
        if (m.status !== 'paid') throw moneyFailure(run, 'release_payment');
      }
      const pay = lastPayment(m);
      return {
        proposal: proposalView(prop), milestone: milestoneView(m),
        payment: { capture_id: pay?.capture_id ?? null, status: pay?.status ?? null },
        agent_run: run, next: nextView(m),
      };
    }));
    res.json(out);
  });

  // ---- Refund: the money leaves the hold early only when the client asks and the freelancer accepts ----------
  const refundProposal = (id) => {
    const prop = getProposal(id);
    if (prop.action !== 'refund') throw E('PROPOSAL_NOT_PENDING', 'This is not a refund request.', 409);
    return prop;
  };

  r.post('/milestones/:id/refund-request', need('milestone', 'client'), async (req, res) => {
    const m = getMilestone(req.params.id); // request body is ignored on purpose
    const out = await once(`refundreq:${m.id}`, () => serial(`money:${m.id}`, async () => {
      if (!VOIDABLE_STATES.includes(m.status)) throw E('NOT_HELD', 'There is no held payment to refund on this milestone.', 409);
      const d = D();
      let prop = d.proposals.find((p) => p.milestone_id === m.id && p.action === 'refund' && ['pending', 'approved'].includes(p.status));
      if (!prop) {
        prop = {
          id: db.id('prop'), project_id: m.project_id, milestone_id: m.id, action: 'refund', status: 'pending',
          reason: 'Client asked for a refund of the held payment', requested_by: 'client', requested_by_user: req.actorUserId,
          approved_by: null, created_at: now(),
        };
        d.proposals.push(prop);
        db.save();
        db.activity(m.project_id, 'client', `${m.label}: client asked for a refund of ${money(m.amount_minor, m.currency)}. The money stays held until the freelancer answers.`);
        db.notify(m.project_id, 'freelancer', `The client asked for a refund of ${m.label} (${money(m.amount_minor, m.currency)}). Accept to cancel ${m.label} and send the money back, or decline to keep working.`);
      }
      return { milestone: milestoneView(m), refund_request: proposalView(prop) };
    }));
    res.status(201).json(out);
  });

  r.post('/proposals/:id/withdraw-refund', need('proposal', 'client'), async (req, res) => {
    const prop = refundProposal(req.params.id);
    const m = getMilestone(prop.milestone_id);
    const out = await serial(`money:${m.id}`, async () => {
      if (prop.status !== 'pending') throw E('PROPOSAL_NOT_PENDING', 'This refund request is no longer waiting for an answer.', 409);
      prop.status = 'withdrawn';
      db.save();
      db.activity(m.project_id, 'client', `${m.label}: client withdrew the refund request. The money stays held.`);
      db.notify(m.project_id, 'freelancer', `The client withdrew the refund request for ${m.label}. The money stays held.`);
      return { milestone: milestoneView(m), refund_request: proposalView(prop) };
    });
    res.json(out);
  });

  r.post('/proposals/:id/decline-refund', need('proposal', 'freelancer'), async (req, res) => {
    const prop = refundProposal(req.params.id);
    const m = getMilestone(prop.milestone_id);
    const out = await serial(`money:${m.id}`, async () => {
      if (prop.status !== 'pending') throw E('PROPOSAL_NOT_PENDING', 'This refund request is no longer waiting for an answer.', 409);
      Object.assign(prop, { status: 'declined', declined_by_user: req.actorUserId });
      db.save();
      db.activity(m.project_id, 'free', `${m.label}: freelancer declined the refund request. The money stays held.`);
      db.notify(m.project_id, 'client', `Your refund request for ${m.label} was declined. ${money(m.amount_minor, m.currency)} stays held by Milestone Pay.`);
      return { milestone: milestoneView(m), refund_request: proposalView(prop) };
    });
    res.json(out);
  });

  r.post('/proposals/:id/accept-refund', need('proposal', 'freelancer'), async (req, res) => {
    const prop = refundProposal(req.params.id);
    const m = getMilestone(prop.milestone_id);
    const out = await once(`refund:${m.id}`, () => serial(`money:${m.id}`, async () => {
      const pay = () => paymentView(lastPayment(m));
      if (prop.status === 'executed' && m.status === 'voided') { // already done: return the first result
        return { milestone: milestoneView(m), payment: pay(), agent_run: runById(prop.run_id) };
      }
      if (!VOIDABLE_STATES.includes(m.status)) throw E('NOT_HELD', 'There is no held payment to refund on this milestone.', 409);
      if (prop.status === 'pending') {
        Object.assign(prop, { status: 'approved', approved_by: 'freelancer', approved_by_user: req.actorUserId });
        db.save();
        db.activity(m.project_id, 'free', `${m.label}: freelancer accepted the refund request`);
      } else if (prop.status !== 'approved') { // approved = an earlier attempt failed at PayPal: retry (same PayPal-Request-Id)
        throw E('PROPOSAL_NOT_PENDING', 'This refund request is no longer waiting for an answer.', 409);
      }
      const run = await runAgent('proposal.refund_accepted', m.id);
      prop.run_id = run.id;
      db.save();
      if (m.status !== 'voided') throw moneyFailure(run, 'refund_payment');
      return { milestone: milestoneView(m), payment: pay(), agent_run: run };
    }));
    res.json(out);
  });

  r.post('/agent/run', need('milestone', null, bodyMilestone), async (req, res) => {
    const { event, milestone_id } = req.body || {};
    if (!['milestone.submitted', 'proposal.approved', 'proposal.refund_accepted'].includes(event)) throw E('BAD_EVENT', 'Unknown agent event.');
    const m = getMilestone(String(milestone_id ?? ''));
    const agent_run = await serial(`money:${m.id}`, () => runAgent(event, m.id, req.body?.forceFallback === true ? { forceFallback: true } : {}));
    res.json({ agent_run });
  });

  r.post('/agent/guardrail-test', need('milestone', null, bodyMilestone), async (req, res) => {
    const m = getMilestone(String(req.body?.milestone_id ?? ''));
    res.json(await agent.guardrailTest(m.id, { paypal }));
  });

  // ---- Step 8: scope creep -------------------------------------------------
  const getCr = (id) => {
    const c = D().change_requests.find((x) => x.id === id);
    if (!c) throw E('NOT_FOUND', 'Change request not found', 404);
    return c;
  };
  const crOpen = (c) => c.status === 'open' || c.status === 'sent';
  const trim120 = (s) => String(s ?? '').trim().slice(0, 120);

  /** The classifier sees the FROZEN agreement and milestones only, never the chat. */
  function agreementSummary(p) {
    const a = agreementOf(p.id);
    const ms = milestonesOf(p.id);
    return {
      title: a.body.title, currency: a.body.currency, total_minor: ms.reduce((s, m) => s + m.amount_minor, 0),
      terms: a.body.terms.map((t) => ({ key: t.key, value: t.value ?? null, source_message_ids: t.source_message_ids || [] })),
      milestones: ms.map((m) => ({ label: m.label, title: m.title, amount_minor: m.amount_minor, criteria: m.criteria, status: m.status })),
      rev_limit: ms.find((m) => m.rev_limit != null)?.rev_limit ?? null,
    };
  }

  r.post('/projects/:id/change-requests', need('project'), async (req, res) => {
    const p = getProject(req.params.id);
    const from = req.role;
    const text = (typeof req.body?.message === 'string' ? req.body.message : '').trim().slice(0, 1000);
    if (text.length < 5) throw E('MESSAGE_TOO_SHORT', 'Describe the change in at least 5 characters.');
    const cr = await once(`cr:${p.id}`, async () => {
      if (agreementOf(p.id)?.status !== 'approved') throw E('AGREEMENT_NOT_APPROVED', 'Change requests are only possible after both sides approved the agreement.', 409);
      if (D().milestones.some((m) => m.project_id === p.id && m.status === 'voided')) {
        throw E('PROJECT_STOPPED', 'This project was cancelled, so it cannot take change requests.', 409);
      }
      if (D().change_requests.some((c) => c.project_id === p.id && crOpen(c))) {
        throw E('OPEN_REQUEST_EXISTS', 'Finish or close the open change request first.', 409);
      }
      let out;
      try { out = await ai.classifyChange(agreementSummary(p), text); } catch (err) {
        if (err?.code === 'BUDGET_EXCEEDED') throw err;
        console.error('classify failed:', err?.message);
        throw E('AI_FAILED', 'The AI could not assess this request. Please try again.', 502);
      }
      const row = {
        id: db.id('cr'), project_id: p.id, from, text, status: 'open',
        classification: out.classification, reason: out.reason, reason_source_ids: out.reason_source_ids || [],
        ai_draft: out.ai_draft ?? null, draft: out.ai_draft ? structuredClone(out.ai_draft) : null,
        sent_version: null, milestone_id: null, created_at: now(),
      };
      D().change_requests.push(row);
      db.save();
      db.activity(p.id, 'ai', `Change request from the ${from} assessed as ${out.classification.replace('_', ' ')}`);
      if (from === 'client') db.notify(p.id, 'freelancer', 'The client sent a change request. Review it and, if it is new work, send a quote.');
      else db.notify(p.id, 'client', 'The freelancer opened a change request on this project.');
      return row;
    });
    res.status(201).json({ change_request: cr });
  });

  r.patch('/change-requests/:id', need('change_request', 'freelancer'), (req, res) => {
    const c = getCr(req.params.id);
    if (c.status !== 'open') throw E('FROZEN', 'This request was already sent or closed.', 409);
    if (!c.draft) throw E('NOT_NEW_WORK', 'Only new work has a price to edit.', 409);
    const b = req.body || {};
    if (b.title !== undefined) c.draft.title = trim120(b.title);
    if (b.deliverables !== undefined) {
      if (!Array.isArray(b.deliverables)) throw E('BAD_DELIVERABLES', 'deliverables must be a list of strings.');
      c.draft.deliverables = b.deliverables.filter((x) => typeof x === 'string').map(trim120).filter(Boolean).slice(0, 20);
    }
    if (b.amount_minor !== undefined) {
      if (!Number.isSafeInteger(b.amount_minor) || b.amount_minor < 0) throw E('BAD_AMOUNT', 'amount_minor must be a non-negative integer (cents).');
      c.draft.amount_minor = b.amount_minor;
    }
    db.save();
    res.json({ change_request: c });
  });

  r.post('/change-requests/:id/send', need('change_request', 'freelancer'), (req, res) => {
    const c = getCr(req.params.id);
    if (c.status === 'sent') return res.json({ change_request: c }); // repeat call
    if (c.status !== 'open') throw E('FROZEN', 'This request was already decided or closed.', 409);
    if (c.classification !== 'new_work' || !c.draft) throw E('NOT_NEW_WORK', 'Only new work can be quoted. Close this request instead.', 409);
    if (!c.draft.title?.trim()) throw E('TITLE_REQUIRED', 'Give the new milestone a title.');
    if (!c.draft.deliverables?.length) throw E('DELIVERABLE_REQUIRED', 'List at least one deliverable.');
    if (!(c.draft.amount_minor >= 100)) throw E('BAD_AMOUNT', 'The price must be at least 1.00.');
    c.sent_version = structuredClone(c.draft);
    c.status = 'sent';
    db.save();
    db.activity(c.project_id, 'free', `Quote sent: ${c.sent_version.title} for ${money(c.sent_version.amount_minor, agreementOf(c.project_id).body.currency)}`);
    db.notify(c.project_id, 'client', `A quote for new work is waiting for you: ${c.sent_version.title}, ${money(c.sent_version.amount_minor, agreementOf(c.project_id).body.currency)}.`);
    res.json({ change_request: c });
  });

  r.post('/change-requests/:id/close', need('change_request', 'freelancer'), (req, res) => {
    const c = getCr(req.params.id);
    if (c.status === 'closed') return res.json({ change_request: c });
    if (!crOpen(c)) throw E('FROZEN', 'This request was already decided.', 409);
    c.status = 'closed';
    db.save();
    db.activity(c.project_id, 'sys', 'Change request closed');
    res.json({ change_request: c });
  });

  r.post('/change-requests/:id/decide', need('change_request', 'client'), async (req, res) => {
    const c = getCr(req.params.id);
    if (typeof req.body?.accept !== 'boolean') throw E('BAD_REQUEST', 'accept must be true or false.');
    const accept = req.body.accept;
    const out = await once(`cr-decide:${c.id}`, async () => {
      const want = accept ? 'accepted' : 'declined';
      if (c.status === want) { // repeat call
        return { change_request: c, milestone: c.milestone_id ? milestoneView(getMilestone(c.milestone_id)) : null };
      }
      if (c.status !== 'sent' || !c.sent_version) throw E('NOT_SENT', 'The freelancer has not sent a quote for this request.', 409);
      let milestone = null;
      if (accept) {
        const ms = milestonesOf(c.project_id);
        const last = ms[ms.length - 1];
        const n = ms.reduce((mx, m) => Math.max(mx, parseInt(String(m.label).replace(/\D/g, ''), 10) || 0), 0);
        const sv = c.sent_version;
        const row = {
          id: db.id('ms'), project_id: c.project_id, agreement_id: last.agreement_id, label: `M${n + 1}`, seq: last.seq + 1,
          title: sv.title, amount_minor: sv.amount_minor, currency: last.currency, status: 'agreed',
          criteria: [...sv.deliverables], rev_count: 0, rev_limit: last.rev_limit ?? null, rev_note: null,
          start_day: last.end_day ?? 0, end_day: (last.end_day ?? 0) + 3, change_request_id: c.id,
        };
        D().milestones.push(row);
        c.milestone_id = row.id;
        milestone = row;
      }
      c.status = want;
      db.save();
      const cur = agreementOf(c.project_id).body.currency;
      db.activity(c.project_id, 'client', accept
        ? `Client accepted the quote: ${milestone.label} ${milestone.title} (${money(milestone.amount_minor, cur)}) added`
        : 'Client declined the quote');
      db.notify(c.project_id, 'freelancer', accept
        ? `The client accepted your quote. ${milestone.label} ${milestone.title} is added and waits for funding.`
        : 'The client declined your quote. The agreement is unchanged.');
      return { change_request: c, milestone: milestone ? milestoneView(milestone) : null };
    });
    res.json(out);
  });

  // ---- Step 9: refresh from PayPal -----------------------------------------
  r.post('/projects/:id/refresh', need('project'), async (req, res) => {
    const p = getProject(req.params.id);
    const payments = [];
    for (const pay of D().payments.filter((x) => x.project_id === p.id && x.order_id)) {
      const m = D().milestones.find((x) => x.id === pay.milestone_id);
      if (!m) continue;
      const o = await pp(() => paypal.getOrder(pay.order_id));
      const pu = o?.purchase_units?.[0]?.payments;
      const auth = pu?.authorizations?.[0];
      const cap = pu?.captures?.[0];
      payments.push({ milestone_id: m.id, order_status: o?.status ?? null, authorization_status: auth?.status ?? null, capture_status: cap?.status ?? null });
      if (lastPaymentOf(m.id)?.id !== pay.id) continue; // only the latest attempt drives the milestone
      if (pay.payout_status === 'FAILED') await agent.payoutFor?.(m.id, { paypal }); // retry sending a captured payment on
      try {
        if (pay.status === 'AUTHORIZED' && cap?.status === 'COMPLETED' && m.status === 'submitted') { // older authorization, captured
          db.transition(m, 'paid');
          Object.assign(pay, { capture_id: cap.id, status: 'CAPTURED', authorization_id: pay.authorization_id || auth?.id || null });
          db.save();
          db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'CAPTURED', paypal_id: cap.id, amount_minor: m.amount_minor });
          db.activity(m.project_id, 'pp', `${m.label}: PayPal shows the funds were captured (refresh)`);
        } else if (pay.status === 'AUTHORIZED' && !cap && ['VOIDED', 'EXPIRED'].includes(auth?.status) && VOIDABLE_STATES.includes(m.status)) {
          // Only an authorization made before capture-at-funding can lapse at PayPal. A captured payment never does.
          db.transition(m, 'voided');
          pay.status = 'VOIDED';
          db.save();
          db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'VOIDED', paypal_id: auth.id, amount_minor: m.amount_minor });
          db.activity(m.project_id, 'pp', `${m.label}: PayPal shows the authorization is ${auth.status.toLowerCase()} (refresh)`);
        } else if (pay.status === 'CREATED' && cap?.id && ['COMPLETED', 'PENDING'].includes(cap.status) && m.status === 'agreed') {
          // The capture went through at PayPal but our answer to the browser was lost.
          db.transition(m, 'authorized');
          Object.assign(pay, { status: 'HELD', capture_id: cap.id, expires_at: null });
          db.save();
          db.ledgerAdd({ project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'HELD', paypal_id: cap.id, amount_minor: m.amount_minor });
          db.activity(m.project_id, 'pp', `${m.label}: PayPal shows the funds are held (refresh)`);
        }
      } catch (err) {
        if (!(err instanceof db.AppError)) throw err; // an illegal move means the db already differs on purpose; leave it
      }
    }
    res.json({ payments });
  });

  // ---- Client invites ------------------------------------------------------
  // One lasting link per project. The freelancer can copy it again at any time and the client can open it
  // as often as they like; the first person to accept it becomes the client, and after that it only opens for them.
  const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const appBase = (req) => config.appUrl || `${req.protocol}://${req.get('host')}`;

  r.post('/projects/:id/invites', need('project', 'freelancer'), (req, res) => {
    const d = D();
    let inv = d.invites.find((i) => i.project_id === req.projectId && !i.revoked && i.token);
    const created = !inv;
    if (!inv) {
      // Older single-use links stored only a hash, so they cannot be shown again: replace them.
      for (const i of d.invites) if (i.project_id === req.projectId && !i.revoked) i.revoked = true;
      const token = crypto.randomBytes(32).toString('base64url');
      inv = {
        id: db.id('inv'), project_id: req.projectId, token, token_hash: sha256(token), created_by: req.user.id, created_at: now(),
        expires_at: null, used_by: null, used_at: null, revoked: false,
      };
      d.invites.push(inv);
      db.save();
    }
    res.status(created ? 201 : 200).json({ url: `${appBase(req)}/invite/${inv.token}` });
  });

  /** The invite for a raw token, or 404. A replaced link is INVITE_USED; an old dated link can be INVITE_EXPIRED. */
  function usableInvite(token) {
    const i = typeof token === 'string' ? D().invites.find((x) => x.token_hash === sha256(token)) : null;
    if (!i || !D().projects.some((p) => p.id === i.project_id && !p.deleted_at)) throw E('NOT_FOUND', 'This invite link is not valid.', 404);
    if (i.revoked) throw E('INVITE_USED', 'This invite link was replaced. Ask the freelancer for the current one.', 409);
    if (i.expires_at && Date.parse(i.expires_at) <= Date.now()) throw E('INVITE_EXPIRED', 'This invite link has expired. Ask the freelancer for a new one.', 410);
    return i;
  }

  r.get('/invites/:token', (req, res) => {
    const i = usableInvite(req.params.token);
    const p = D().projects.find((x) => x.id === i.project_id);
    const f = memberWithRole(p.id, 'freelancer');
    const fname = displayName(D().users.find((u) => u.id === f?.user_id)) ?? p.freelancer_name ?? null;
    const a = agreementOf(p.id);
    const ms = milestonesOf(p.id);
    res.json({ project: { id: p.id, title: p.title ?? a?.body?.title ?? null }, freelancer: { name: fname },
      total_minor: ms.reduce((t, m) => t + m.amount_minor, 0), currency: a?.body?.currency ?? ms[0]?.currency ?? null, parts: ms.length });
  });

  r.post('/invites/:token/accept', (req, res) => {
    const i = usableInvite(req.params.token);
    const role = roleOf(req.user.id, i.project_id);
    if (role === 'client') return res.json({ project_id: i.project_id });
    if (role === 'freelancer') throw E('SELF_INVITE', 'This is your own project. Send the link to your client instead.', 409);
    if (memberWithRole(i.project_id, 'client')) throw E('CLIENT_TAKEN', 'This project already has a client. The link only opens for them now.', 409);
    D().project_members.push({ project_id: i.project_id, user_id: req.user.id, role: 'client', at: now() });
    Object.assign(i, { used_by: i.used_by || req.user.id, used_at: i.used_at || now() });
    db.save();
    db.activity(i.project_id, 'client', `${req.user.name || 'The client'} joined the project`);
    res.json({ project_id: i.project_id });
  });

  // ---- Profile and onboarding ----------------------------------------------
  // One PayPal sign-in, then one role choice and one setup step. Roles here are the user's home view
  // (Your projects / Your jobs); who may act on a project is still decided per project by project_members.
  r.patch('/me', (req, res) => {
    const parsed = ProfileBody.safeParse(req.body || {});
    if (!parsed.success) {
      const f = parsed.error.issues[0]?.path?.[0];
      const msg = f === 'display_name' ? 'Add the name people will see (up to 60 characters).'
        : f === 'bio' ? 'Keep the bio to 160 characters.' : 'Some of these details are not valid.';
      throw E('BAD_PROFILE', msg);
    }
    const b = parsed.data;
    const u = D().users.find((x) => x.id === req.user.id);
    const roles = new Set(Array.isArray(u.roles) ? u.roles : []);
    if (b.role) { roles.add(b.role); u.active_role = b.role; }
    if (b.add_role) { roles.add(b.add_role); u.active_role = b.add_role; }
    u.roles = [...roles];
    for (const k of ['display_name', 'bio', 'client_type']) if (b[k] !== undefined) u[k] = b[k] || null;
    for (const k of ['skills', 'hire_for']) if (b[k] !== undefined) u[k] = [...new Set(b[k])];
    if (b.finish) {
      if (!u.active_role) throw E('ROLE_REQUIRED', 'Choose how you will use Milestone Pay first.');
      if (!(u.display_name || u.name)) throw E('BAD_PROFILE', 'Add the name people will see.');
      if (u.active_role === 'freelancer' && !(u.skills || []).length) throw E('SKILL_REQUIRED', 'Pick at least one skill so clients know what you do.');
      u.onboarded_at ||= now();
    }
    db.save();
    res.json({ user: userView(u) });
  });

  // ---- Notes on a sent agreement (before the client approves) -------------
  // Untrusted text between the two people. Never sent to the agent or any model.
  r.post('/agreements/:id/notes', need('agreement'), (req, res) => {
    const a = getAgreement(req.params.id);
    const text = (typeof req.body?.text === 'string' ? req.body.text : '').trim().slice(0, 500);
    if (text.length < 2) throw E('NOTE_TOO_SHORT', 'Write a short note first.');
    if (a.status !== 'sent') throw E('NOT_SENT', 'Notes are for an agreement waiting for the client\'s approval.', 409);
    const note = { id: db.id('note'), from: req.role, text, at: now() };
    (a.notes ||= []).push(note);
    db.save();
    const p = D().projects.find((x) => x.id === a.project_id);
    if (req.role === 'client') {
      db.activity(a.project_id, 'client', `${p.client || 'The client'} sent a note about the agreement`);
      db.notify(a.project_id, 'freelancer', `${p.client || 'Your client'} sent a note about the agreement. Reply on the agreement page.`);
    } else {
      db.activity(a.project_id, 'free', `${p.freelancer || 'The freelancer'} replied to the client's note`);
      db.notify(a.project_id, 'client', `${p.freelancer || 'The freelancer'} replied to your note.`);
    }
    res.status(201).json({ note, notes: a.notes });
  });

  // ---- Download all files of a milestone's current version as one zip ----
  // ---- Invoice for a milestone ---------------------------------------------
  // Exists only once the milestone was funded, approved by the client, captured and paid out to the freelancer.
  // Both members can open it (inline) or download it (?download=1) as one self-contained HTML file.
  r.get('/milestones/:id/invoice', need('milestone'), (req, res) => {
    const m = getMilestone(req.params.id);
    issueInvoice(m.id); // catches a payout that completed before invoices existed
    const v = invoiceData(m.id);
    if (!v) throw E('INVOICE_NOT_READY', 'The invoice is ready once this milestone is funded, approved by the client and paid out to the freelancer.', 409);
    res.set({
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${v.number}.html"`,
    });
    res.send(renderInvoiceHtml(v, { nonce: res.locals.cspNonce }));
  });

  r.get('/milestones/:id/download-all', need('milestone'), (req, res) => {
    const m = getMilestone(req.params.id);
    const version = m.rev_count + 1;
    const root = path.resolve(uploadsRoot());
    const rows = D().deliverables.filter((x) => x.milestone_id === m.id && x.version === version && x.path)
      .map((x) => ({ x, file: path.resolve(root, x.path) }))
      .filter(({ file }) => file.startsWith(root + path.sep) && fs.existsSync(file));
    if (!rows.length) throw E('NOT_FOUND', 'No files to download yet.', 404);
    const name = `${m.label}-files-v${version}.zip`;
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' });
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.on('error', () => res.destroy());
    zip.pipe(res);
    const seen = new Set();
    for (const { x, file } of rows) {
      let n = x.filename.replace(/[\\/]/g, '_'); let k = 1;
      while (seen.has(n)) n = `${k++}-${x.filename}`;
      seen.add(n);
      zip.file(file, { name: n });
    }
    zip.finalize();
  });

  // ---- Profile picture and public profile ----------------------------------
  // The picture is a small JPEG/PNG (the browser shrinks it first) kept on the user row, so it survives restarts.
  const AVATAR_BYTES = 400 * 1024;
  const avatarUploader = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: AVATAR_BYTES, fields: 2 } }).single('avatar');
  const sharesProject = (a, b) => {
    if (a === b) return true;
    const mine = new Set(D().project_members.filter((m) => m.user_id === a).map((m) => m.project_id));
    return D().project_members.some((m) => m.user_id === b && mine.has(m.project_id));
  };
  const knownUser = (req) => {
    const u = D().users.find((x) => x.id === req.params.id && !x.deleted_at);
    if (!u || !sharesProject(req.user.id, u.id)) throw E('NOT_FOUND', 'Not found', 404);
    return u;
  };

  r.post('/me/avatar', async (req, res) => {
    await new Promise((resolve, reject) => avatarUploader(req, res, (err) => {
      if (!err) return resolve();
      reject(err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? E('FILE_TOO_LARGE', 'That picture is too large. Use one under 400 KB.', 413) : E('BAD_FILE', 'Upload one picture as a .jpg or .png file.'));
    }));
    const b = req.file?.buffer;
    const mime = b && startsWith(b, [0x89, 0x50, 0x4e, 0x47]) ? 'image/png' : b && startsWith(b, [0xff, 0xd8, 0xff]) ? 'image/jpeg' : null;
    if (!mime) throw E('BAD_FILE', 'Upload one picture as a .jpg or .png file.');
    const u = D().users.find((x) => x.id === req.user.id);
    u.avatar = { mime, data: b.toString('base64'), at: now() };
    db.save();
    res.json({ user: userView(u) });
  });

  r.delete('/me/avatar', (req, res) => {
    const u = D().users.find((x) => x.id === req.user.id);
    delete u.avatar;
    db.save();
    res.json({ user: userView(u) });
  });

  r.get('/users/:id/avatar', (req, res) => {
    const u = knownUser(req);
    if (!u.avatar?.data) throw E('NOT_FOUND', 'Not found', 404);
    res.set({ 'Content-Type': u.avatar.mime === 'image/png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(u.avatar.data, 'base64'));
  });

  // What the other person on a shared project may see. Never the email or PayPal id.
  r.get('/users/:id', (req, res) => {
    const u = knownUser(req);
    const v = userView(u);
    res.json({ profile: {
      id: v.id, display_name: v.display_name || v.name, roles: v.roles, skills: v.skills, bio: v.bio,
      client_type: v.client_type, hire_for: v.hire_for, avatar_url: v.avatar_url, member_since: v.created_at,
    } });
  });

  // ---- Account deletion ----------------------------------------------------
  // Deleting is a 15-day wait: the user is logged out everywhere and the data is erased when the wait ends
  // (purgeDueAccounts). Logging in again before then cancels it. Refused while money is on hold.
  r.delete('/me', (req, res) => {
    const d = D();
    const uid = req.user.id;
    if (hasHolds(uid)) {
      throw E('ACTIVE_HOLDS', 'Money is on hold in one of your projects. Approve those milestones or agree a refund first.', 409);
    }
    const u = d.users.find((x) => x.id === uid);
    u.delete_requested_at = now();
    u.delete_after = new Date(Date.now() + DELETE_AFTER_DAYS * 864e5).toISOString();
    d.sessions = d.sessions.filter((x) => x.user_id !== uid);
    db.save();
    res.json({ ok: true, scheduled_for: u.delete_after, days: DELETE_AFTER_DAYS });
  });

  // ---- Step 9: project page ------------------------------------------------
  r.get('/projects/:id', need('project'), (req, res) => {
    const p = getProject(req.params.id);
    const d = D();
    const names = new Map(d.users.map((u) => [u.id, displayName(u)]));
    const a = agreementOf(p.id);
    const mine = (rows) => rows.filter((x) => x.project_id === p.id);
    res.json({
      project: { ...projectView(p), open_change_request: (() => { const c = d.change_requests.find((x) => x.project_id === p.id && (x.status === 'open' || x.status === 'sent')); return c ? { id: c.id, from: c.from, status: c.status } : null; })() },
      agreement: agreementView(a),
      approvals: a ? d.approvals.filter((x) => x.agreement_id === a.id) : [],
      notes: a?.notes ?? [],
      chat: Array.isArray(p.chat) ? p.chat : null,
      messages: projectMessages(p.id),
      milestones: milestonesOf(p.id).map(milestoneView),
      ledger: mine(d.ledger).filter((l) => l.event),
      activity: mine(d.activity),
      notifications: mine(d.notifications),
      agent_runs: mine(d.agent_runs),
      change_requests: mine(d.change_requests),
      ai_cost: (() => {
        const who = new Set(membersOf(p.id).map((m) => m.user_id));
        const runs = d.ai_runs.filter((x) => who.has(x.user_id));
        return { calls: runs.length, cost_usd: runs.reduce((s, x) => s + (x.cost_usd || 0), 0) };
      })(),
      my_role: req.role,
      members: membersOf(p.id).map((m) => ({ role: m.role, name: names.get(m.user_id) ?? null, user_id: m.user_id, avatar_url: avatarUrl(d.users.find((u) => u.id === m.user_id)) })),
    });
  });

  return r;
}
