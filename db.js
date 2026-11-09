import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pgstore from './pgstore.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let dbPath = null;
let cache = null;
let mode = 'file'; // 'file' (db.json, tests and quick local runs) | 'pg' (DATABASE_URL: Postgres write-through)

export const COLLECTIONS = [
  'projects', 'agreements', 'approvals', 'messages', 'milestones', 'payments',
  'deliverables', 'proposals', 'ledger', 'activity', 'notifications',
  'agent_runs', 'change_requests', 'ai_runs',
  'users', 'sessions', 'project_members', 'invites',
];

export const backend = () => mode;

export function getPath() {
  return dbPath || process.env.DB_PATH || path.join(HERE, 'db.json');
}

/** Point the store at a file (tests use a temp path) and drop the in-memory cache. */
export function init(p) {
  dbPath = p || null;
  cache = null;
  mode = 'file';
}

// ---------------------------------------------------------------------------
// Postgres write-through. Memory is the working copy; save() diffs it against what was last committed and
// queues one transaction. flush() resolves once every queued write has committed (server.js holds each
// response on it). Single instance only: this process is the only writer.

const ridOf = new WeakMap();     // row object -> rid (row.id, or a generated rid for rows without an id)
const lastJson = new WeakMap();  // row object -> JSON last committed
let lastRids = new Map();        // coll -> Set(rid) last committed
let chain = Promise.resolve();
let failed = null;

function rid(row) {
  if (typeof row.id === 'string' && row.id) return row.id;
  let r = ridOf.get(row);
  if (!r) { r = id('rid'); ridOf.set(row, r); }
  return r;
}

/** Load from DATABASE_URL (pg) when set, else the JSON file. Replaces the in-memory cache. */
export async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) { mode = 'file'; cache = null; load(); return; }
  await chain.catch(() => {});
  await pgstore.connect({ url, schema: process.env.DB_SCHEMA || 'public' });
  const rows = await pgstore.loadAll(COLLECTIONS);
  const data = empty();
  lastRids = new Map();
  for (const coll of COLLECTIONS) {
    const set = new Set();
    for (const { rid: r, data: row } of rows[coll] || []) {
      if (!(typeof row.id === 'string' && row.id)) ridOf.set(row, r);
      lastJson.set(row, JSON.stringify(row));
      set.add(r);
      data[coll].push(row);
    }
    lastRids.set(coll, set);
  }
  cache = data;
  mode = 'pg';
  failed = null;
}

function diff() {
  const d = load();
  const upserts = []; const deletes = []; const seen = new Map(); const json = [];
  for (const coll of COLLECTIONS) {
    const set = new Set();
    for (const row of d[coll] || []) {
      const r = rid(row);
      set.add(r);
      const j = JSON.stringify(row);
      if (lastJson.get(row) !== j) {
        // data is a snapshot, so later in-memory edits are not mistaken for committed ones.
        upserts.push({ coll, rid: r, project_id: typeof row.project_id === 'string' ? row.project_id : null, data: JSON.parse(j) });
        json.push([row, j]);
      }
    }
    for (const r of lastRids.get(coll) || []) if (!set.has(r)) deletes.push({ coll, rid: r });
    seen.set(coll, set);
  }
  return { upserts, deletes, seen, json };
}

function queuePg() {
  const { upserts, deletes, seen, json } = diff();
  if (!upserts.length && !deletes.length) return;
  chain = chain.then(() => pgstore.flush({ upserts, deletes })).then(() => {
    for (const [row, j] of json) lastJson.set(row, j);
    lastRids = seen;
  }, (e) => {
    console.error('persist failed:', e.message);
    failed = e;
  });
}

/** Wait for every queued write. Rejects PERSIST_FAILED (500) if any failed since the last flush(). */
export async function flush() {
  await chain;
  if (failed) {
    failed = null;
    throw new AppError('PERSIST_FAILED', 'Could not save. Please retry.', 500);
  }
}

function empty() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
}

export function load() {
  if (cache) return cache;
  const p = getPath();
  let data = empty();
  if (fs.existsSync(p)) {
    data = { ...data, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  cache = data;
  return cache;
}

/** Atomic: write <path>.tmp then rename over <path>. */
export function save() {
  if (mode === 'pg') return queuePg();
  const p = getPath();
  const tmp = p + '.tmp';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
  fs.renameSync(tmp, p);
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

const ALLOWED = {
  draft: ['agreed'],
  agreed: ['authorized'],
  authorized: ['submitted', 'voided'],
  submitted: ['revision_requested', 'paid', 'voided'],
  revision_requested: ['submitted', 'voided'],
  paid: ['refunded'],
  voided: [],
  refunded: [],
};

/** The only way a milestone status changes. Throws ILLEGAL_TRANSITION (409). */
export function transition(milestone, to, patch = {}) {
  const from = milestone.status;
  if (!(ALLOWED[from] || []).includes(to)) {
    throw new AppError('ILLEGAL_TRANSITION', `Cannot move milestone from ${from} to ${to}`, 409);
  }
  Object.assign(milestone, patch, { status: to });
  save();
  return milestone;
}

/** Lowest-seq milestone of the project whose status is not paid. */
export function currentMilestone(projectId) {
  const open = load().milestones
    .filter((m) => m.project_id === projectId && m.status !== 'paid')
    .sort((a, b) => a.seq - b.seq);
  return open[0] || null;
}

export function logAiRun({ task, model, input_tokens = 0, output_tokens = 0, cost_usd = 0, latency_ms = 0, fallback = false }) {
  load().ai_runs.push({
    at: new Date().toISOString(), task, model, input_tokens, output_tokens, cost_usd, latency_ms, fallback: !!fallback,
  });
  save();
}

export function aiRunsOn(date) {
  return load().ai_runs.filter((r) => r.at.slice(0, 10) === date);
}

export function todayCostUsd() {
  const today = new Date().toISOString().slice(0, 10);
  return aiRunsOn(today).reduce((s, r) => s + (r.cost_usd || 0), 0);
}

export const BUDGET_LIMIT_USD = 1;

export function assertBudget() {
  if (todayCostUsd() >= BUDGET_LIMIT_USD) {
    throw new AppError('BUDGET_EXCEEDED', 'Daily AI budget reached', 429);
  }
}

export function activity(projectId, who, text) {
  load().activity.push({ id: id('act'), at: new Date().toISOString(), project_id: projectId, who, text });
  save();
}

export function ledgerAdd(row) {
  load().ledger.push({ id: id('led'), at: new Date().toISOString(), ...row });
  save();
}

export function notify(projectId, to, text) {
  load().notifications.push({ id: id('ntf'), at: new Date().toISOString(), project_id: projectId, to, text });
  save();
}
