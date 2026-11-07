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

export function proposalView(p) {
  return p && {
    id: p.id, milestone_id: p.milestone_id, action: p.action, status: p.status,
    reason: p.reason, approved_by: p.approved_by ?? null, created_at: p.created_at,
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
    proposal: proposalView([...d.proposals].reverse().find((p) => p.milestone_id === m.id && (p.status === 'pending' || p.status === 'approved'))) ?? null,
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

export function createRoutes({ paypal, ai, agent, fixturesDir = process.env.FIXTURES_DIR || FIXTURES }) {
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

  // ---- Step 6: submit work -------------------------------------------------
  const SUBMITTABLE = ['authorized', 'revision_requested'];

  r.post('/milestones/:id/deliverables', async (req, res) => {
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

  r.post('/milestones/:id/submit', async (req, res) => {
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
      const agent_run = await agent.runAgent('milestone.submitted', m.id);
      const proposal = [...D().proposals].reverse().find((p) => p.milestone_id === m.id && p.action === 'release' && p.status === 'pending') ?? null;
      return { milestone: milestoneView(m), proposal: proposalView(proposal), agent_run };
    });
    res.json(out);
  });

  // ---- Step 7: client reviews ---------------------------------------------
  const DLV_ID = /^dlv_[a-f0-9]+$/;
  r.get('/deliverables/:id/download', (req, res) => {
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

  r.post('/milestones/:id/revision', (req, res) => {
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
    res.json({ milestone: milestoneView(m) });
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
