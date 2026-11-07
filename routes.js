// REST routes for projects, agreements and funding (docs/api.md steps 1-5 and 9).
// createRoutes({ paypal, ai }) takes the PayPal and AI modules as arguments so tests can pass stubs.
// Amounts always come from db.json; nothing from a request body ever reaches PayPal.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';

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

function parseUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
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

// ---------------------------------------------------------------------------
// Shapes

const D = () => db.load();
const bySeq = (a, b) => a.seq - b.seq;

function getProject(id) {
  const p = D().projects.find((x) => x.id === id && x.source !== 'lab');
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
    capture_id: p.capture_id || null, status: p.status,
  } : null;
}

export function milestoneView(m) {
  const d = D();
  const current = db.currentMilestone(m.project_id);
  const agreement = agreementOf(m.project_id);
  const is_current = current?.id === m.id;
  const pays = d.payments.filter((p) => p.milestone_id === m.id);
  const dels = d.deliverables.filter((x) => x.milestone_id === m.id);
  const version = dels.reduce((v, x) => Math.max(v, x.version), 0);
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
    versions: version,
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
    client: p.client ?? null, freelancer_name: p.freelancer_name, created_at: p.created_at,
  };
}

const money = (minor, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100);

// ---------------------------------------------------------------------------

export function createRoutes({ paypal, ai }) {
  const r = express.Router();

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
  r.get('/projects', (_req, res) => {
    const d = D();
    const projects = d.projects.filter((p) => p.source !== 'lab');
    const ids = new Set(projects.map((p) => p.id));
    const latest = new Map(); // milestone_id -> latest ledger event
    let paid = 0;
    for (const l of d.ledger) {
      if (!ids.has(l.project_id) || !l.event) continue;
      latest.set(l.milestone_id, l.event);
      if (l.event === 'CAPTURED') paid += l.amount_minor;
      if (l.event === 'REFUNDED') paid -= l.amount_minor;
    }
    let held = 0, notFunded = 0;
    for (const m of d.milestones) {
      if (!ids.has(m.project_id)) continue;
      if (latest.get(m.id) === 'AUTHORIZED') held += m.amount_minor;
      if (m.status === 'draft' || m.status === 'agreed') notFunded += m.amount_minor;
    }
    res.json({
      projects: projects.map((p) => {
        const ms = milestonesOf(p.id);
        const cr = d.change_requests.find((c) => c.project_id === p.id && c.status === 'open');
        const v = projectView(p);
        return {
          id: p.id, title: v.title, freelancer: v.freelancer, client: v.client,
          total_minor: ms.reduce((s, m) => s + m.amount_minor, 0), status: v.status,
          milestones: ms.map((m) => ({ id: m.id, label: m.label, status: m.status })),
          open_change_request: cr ? { id: cr.id, from: cr.from, status: cr.status } : null,
        };
      }).reverse(),
      totals: { held_minor: held, paid_minor: paid, not_funded_minor: notFunded },
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
      const project = { id: pid, title: null, status: 'draft', freelancer_name: freelancer, created_at: now() };
      d.projects.push(project);
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
  r.post('/projects/:id/extract', async (req, res) => {
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

  r.post('/agreements/:id/gaps/:gapId/fix', (req, res) => {
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

  r.patch('/milestones/:id', (req, res) => {
    const m = getMilestone(req.params.id);
    const a = agreementOf(m.project_id);
    if (isFrozen(a) || m.status !== 'draft') throw E('AGREEMENT_FROZEN', 'Amounts cannot change after the freelancer approves.', 409);
    const v = req.body?.amount_minor;
    if (!Number.isSafeInteger(v) || v < 0) throw E('BAD_AMOUNT', 'amount_minor must be a non-negative integer (cents).');
    m.amount_minor = v;
    db.save();
    const sum = milestonesOf(m.project_id).reduce((s, x) => s + x.amount_minor, 0);
    const total = a?.body.total_minor ?? sum;
    res.json({ milestone: milestoneView(m), sum_minor: sum, agreed_total_minor: total, mismatch: sum !== total });
  });

  // ---- Step 4: approve agreement ------------------------------------------
  r.post('/agreements/:id/approve', (req, res) => {
    const a = getAgreement(req.params.id);
    const { party, content_hash } = req.body || {};
    const d = D();
    const ms = milestonesOf(a.project_id);
    const project = d.projects.find((p) => p.id === a.project_id);
    if (party === 'freelancer') {
      if (a.status === 'draft') {
        a.content_hash = agreementHash(a, ms);
        a.status = 'sent';
        d.approvals.push({ agreement_id: a.id, party: 'freelancer', content_hash: a.content_hash, at: now() });
        db.save();
        db.activity(a.project_id, 'free', `${project.freelancer || 'Freelancer'} approved the agreement and sent it to the client`);
      }
      return res.json({ agreement: agreementView(a), client_url: `/?as=client&p=${a.project_id}` });
    }
    if (party === 'client') {
      if (a.status === 'draft') throw E('NOT_SENT', 'The freelancer has not approved the agreement yet.', 409);
      if (content_hash !== a.content_hash) {
        throw E('HASH_MISMATCH', 'The agreement changed or does not match what you were shown. Reload and review again.', 409);
      }
      if (a.status === 'sent') {
        a.status = 'approved';
        d.approvals.push({ agreement_id: a.id, party: 'client', content_hash: a.content_hash, at: now() });
        for (const m of ms) if (m.status === 'draft') db.transition(m, 'agreed');
        db.save();
        db.activity(a.project_id, 'client', `${project.client || 'Client'} approved the agreement. Nothing was charged.`);
      }
      return res.json({ agreement: agreementView(a), milestones: ms.map(milestoneView) });
    }
    throw E('BAD_PARTY', 'party must be "freelancer" or "client".');
  });

  // ---- Demo ----------------------------------------------------------------
  r.post('/demo', async (_req, res) => {
    const text = fs.readFileSync(path.join(FIXTURES, 'baan-kafe.txt'), 'utf8');
    const cache = path.join(FIXTURES, 'baan-kafe.extract.json');
    const messages = ai.parseChatText(text, { freelancerName: 'Ploy' });
    let out;
    if (fs.existsSync(cache)) {
      out = JSON.parse(fs.readFileSync(cache, 'utf8'));
    } else {
      out = await ai.extractAgreement(messages);
      fs.writeFileSync(cache, JSON.stringify({ body: out.body, milestones: out.milestones, usage: out.usage }, null, 2));
    }
    const d = D();
    const project = { id: db.id('prj'), title: null, status: 'draft', freelancer_name: 'Ploy', created_at: now() };
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

  r.post('/milestones/:id/order', async (req, res) => {
    const m = getMilestone(req.params.id); // request body is ignored on purpose
    const out = await once(`order:${m.id}`, async () => {
      fundable(m);
      const d = D();
      const existing = d.payments.find((p) => p.milestone_id === m.id && p.status === 'CREATED');
      if (existing) return { order_id: existing.order_id, status: 'CREATED' };
      const attempt = d.payments.filter((p) => p.milestone_id === m.id).length + 1;
      const order = await pp(() => paypal.createAuthOrder(m, attempt));
      d.payments.push({
        id: db.id('pay'), project_id: m.project_id, milestone_id: m.id, order_id: order.id, attempt,
        authorization_id: null, expires_at: null, capture_id: null, status: 'CREATED', created_at: now(),
      });
      db.save();
      return { order_id: order.id, status: 'CREATED' };
    });
    res.json(out);
  });

  r.post('/milestones/:id/authorize', async (req, res) => {
    const m = getMilestone(req.params.id);
    const orderId = req.body?.order_id;
    const pay = typeof orderId === 'string'
      ? D().payments.find((p) => p.milestone_id === m.id && p.order_id === orderId) : null;
    if (!pay) throw E('ORDER_MISMATCH', 'That PayPal order does not belong to this milestone.', 409);
    const payload = await once(`auth:${pay.order_id}`, async () => {
      if (pay.status !== 'CREATED') return { milestone: milestoneView(m), payment: paymentView(pay) }; // repeat call
      fundable(m);
      const a = await pp(() => paypal.authorizeOrder(pay.order_id));
      db.transition(m, 'authorized');
      Object.assign(pay, { status: 'AUTHORIZED', authorization_id: a.authorization_id, expires_at: a.expires_at || null });
      db.save();
      db.ledgerAdd({
        project_id: m.project_id, milestone_id: m.id, label: m.label, event: 'AUTHORIZED',
        paypal_id: a.authorization_id, amount_minor: m.amount_minor,
      });
      db.activity(m.project_id, 'pp', `${m.label} ${money(m.amount_minor, m.currency)} is held by PayPal (authorization ${a.authorization_id})`);
      db.notify(m.project_id, 'freelancer', `${m.label} is funded. ${money(m.amount_minor, m.currency)} is held by PayPal, so you can start "${m.title}".`);
      return { milestone: milestoneView(m), payment: paymentView(pay) };
    });
    res.json(payload);
  });

  // ---- Step 9: project page ------------------------------------------------
  r.get('/projects/:id', (req, res) => {
    const p = getProject(req.params.id);
    const d = D();
    const a = agreementOf(p.id);
    const mine = (rows) => rows.filter((x) => x.project_id === p.id);
    res.json({
      project: projectView(p),
      agreement: agreementView(a),
      approvals: a ? d.approvals.filter((x) => x.agreement_id === a.id) : [],
      messages: projectMessages(p.id),
      milestones: milestonesOf(p.id).map(milestoneView),
      ledger: mine(d.ledger).filter((l) => l.event),
      activity: mine(d.activity),
      notifications: mine(d.notifications),
      agent_runs: mine(d.agent_runs),
      change_requests: mine(d.change_requests),
      ai_cost: { calls: d.ai_runs.length, cost_usd: d.ai_runs.reduce((s, x) => s + (x.cost_usd || 0), 0) },
    });
  });

  return r;
}
