import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../../db.js';
import { createApp } from '../../server.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-s0-'));
  db.init(path.join(dir, 'db.json'));
});

const ms = (seq, status, project_id = 'prj_a') => ({ id: db.id('ms'), project_id, seq, status });

test('transition allows every row of the state table', () => {
  const rows = [
    ['draft', 'agreed'], ['agreed', 'authorized'], ['authorized', 'submitted'],
    ['revision_requested', 'submitted'], ['submitted', 'revision_requested'], ['submitted', 'paid'],
    ['authorized', 'voided'], ['submitted', 'voided'], ['revision_requested', 'voided'], ['paid', 'refunded'],
  ];
  for (const [from, to] of rows) {
    const m = ms(1, from);
    assert.equal(db.transition(m, to, { note: 'x' }).status, to, `${from}->${to}`);
    assert.equal(m.note, 'x');
  }
});

test('transition throws ILLEGAL_TRANSITION (409) on illegal moves', () => {
  for (const [from, to] of [['draft', 'paid'], ['agreed', 'submitted'], ['paid', 'voided']]) {
    const m = ms(1, from);
    assert.throws(() => db.transition(m, to), (e) => e.code === 'ILLEGAL_TRANSITION' && e.status === 409);
    assert.equal(m.status, from);
  }
});

test('currentMilestone returns lowest seq that is not paid', () => {
  const d = db.load();
  d.milestones.push(ms(3, 'agreed'), ms(1, 'paid'), ms(2, 'authorized'), ms(1, 'agreed', 'prj_b'));
  assert.equal(db.currentMilestone('prj_a').seq, 2);
  assert.equal(db.currentMilestone('prj_b').seq, 1);
  assert.equal(db.currentMilestone('prj_none'), null);
});

test('save is atomic: crash between tmp write and rename keeps previous state', () => {
  const d = db.load();
  d.projects.push({ id: 'prj_ok' });
  db.save();
  d.projects.push({ id: 'prj_lost' });
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated crash'); };
  try {
    assert.throws(() => db.save(), /simulated crash/);
  } finally {
    fs.renameSync = realRename;
  }
  assert.ok(fs.existsSync(path.join(dir, 'db.json.tmp')));
  db.init(path.join(dir, 'db.json')); // fresh process view
  assert.deepEqual(db.load().projects.map((p) => p.id), ['prj_ok']);
});

test('todayCostUsd sums only today ai_runs', () => {
  const d = db.load();
  const old = new Date(Date.now() - 3 * 86400e3).toISOString();
  d.ai_runs.push({ at: old, task: 'extract', model: 'm', cost_usd: 0.5 });
  db.logAiRun({ task: 'extract', model: 'm', cost_usd: 0.25 });
  db.logAiRun({ task: 'agent', model: 'm', cost_usd: 0.125 });
  assert.equal(db.todayCostUsd(), 0.375);
});

test('budget guard throws BUDGET_EXCEEDED (429) at $1', () => {
  db.logAiRun({ task: 'x', model: 'm', cost_usd: 1 });
  assert.throws(() => db.assertBudget(), (e) => e.code === 'BUDGET_EXCEEDED' && e.status === 429);
});

async function withServer(fn) {
  const server = createApp().listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('GET /api/config has the right shape and never contains the secret', async () => {
  process.env.PAYPAL_CLIENT_SECRET = 'SECRET-SENTINEL-123';
  process.env.PAYPAL_CLIENT_ID = 'pub-client-id';
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/config`);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!text.includes('SECRET-SENTINEL-123'));
    assert.ok(!/secret/i.test(text));
    const j = JSON.parse(text);
    assert.equal(j.paypal_client_id, 'pub-client-id');
    assert.equal(j.currency, process.env.API_CURRENCY || 'USD');
    assert.equal(j.env, 'sandbox');
    assert.deepEqual(j.budget, { today_cost_usd: 0, limit_usd: 1, blocked: false });
  });
});

test('GET /api/ai-runs and JSON errors', async () => {
  db.logAiRun({ task: 'extract', model: 'm', input_tokens: 1, output_tokens: 2, cost_usd: 0.1, latency_ms: 5 });
  await withServer(async (base) => {
    const j = await (await fetch(`${base}/api/ai-runs`)).json();
    assert.equal(j.runs.length, 1);
    assert.equal(j.total_cost_usd, 0.1);
    const nf = await fetch(`${base}/api/nope`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).error, 'NOT_FOUND');
  });
});
