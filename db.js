import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let dbPath = null;
let cache = null;

const COLLECTIONS = [
  'projects', 'agreements', 'approvals', 'messages', 'milestones', 'payments',
  'deliverables', 'proposals', 'ledger', 'activity', 'notifications',
  'agent_runs', 'change_requests', 'ai_runs',
];

export function getPath() {
  return dbPath || process.env.DB_PATH || path.join(HERE, 'db.json');
}

/** Point the store at a file (tests use a temp path) and drop the in-memory cache. */
export function init(p) {
  dbPath = p || null;
  cache = null;
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
