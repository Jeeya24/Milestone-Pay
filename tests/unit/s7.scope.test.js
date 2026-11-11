import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV1 } from 'ai/test';
import * as db from '../../db.js';
import { MODELS } from '../../models.js';
import { classifyChange, loadPrompt } from '../../ai.js';

const SUMMARY = {
  title: 'Baan Kafe website', currency: 'USD', total_minor: 80000, rev_limit: 2,
  terms: [{ key: 'scope', value: '4-page website', source_message_ids: ['m3', 'm5'] }, { key: 'revisions', value: null, source_message_ids: [] }],
  milestones: [
    { label: 'M1', title: 'Design', amount_minor: 24000, criteria: ['x'], status: 'paid' },
    { label: 'M2', title: 'Build', amount_minor: 32000, criteria: ['y'], status: 'agreed' },
    { label: 'M3', title: 'Launch', amount_minor: 24000, criteria: ['z'], status: 'agreed' },
  ],
};

const mock = (obj, usage = { promptTokens: 1000, completionTokens: 100 }) => new MockLanguageModelV1({
  defaultObjectGenerationMode: 'json',
  doGenerate: async () => ({ rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: 'stop', usage, text: JSON.stringify(obj) }),
});

const saved = { ...MODELS };
beforeEach(() => {
  Object.assign(MODELS, saved);
  db.init(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-s7-')), 'db.json'));
});

const draft = (amount) => ({ title: 'Online ordering page', deliverables: ['Order page'], amount_minor: amount, price_basis: '$800 ÷ 4 pages = $200 per page' });

test('reason_source_ids keeps only ids present in the summary', async () => {
  MODELS.scope = mock({ classification: 'in_scope', reason: 'r', reason_source_ids: ['m3', 'm99', 'm3'], draft: null });
  const r = await classifyChange(SUMMARY, 'Contact page phone number please');
  assert.deepEqual(r.reason_source_ids, ['m3']);
  assert.equal(r.usage.input_tokens, 1000);
});

test('ai_draft is null unless new_work', async () => {
  MODELS.scope = mock({ classification: 'revision', reason: 'r', reason_source_ids: [], draft: draft(20000) });
  const r = await classifyChange(SUMMARY, 'Make the photos brighter');
  assert.equal(r.ai_draft, null);
});

test('new_work draft: next label, integer cents, floor at 100', async () => {
  MODELS.scope = mock({ classification: 'new_work', reason: 'r', reason_source_ids: ['m3'], draft: draft(20000.6) });
  let r = await classifyChange(SUMMARY, 'Add an online ordering page');
  assert.equal(r.ai_draft.label, 'M4');
  assert.equal(r.ai_draft.amount_minor, 20001);
  assert.ok(Number.isInteger(r.ai_draft.amount_minor));
  MODELS.scope = mock({ classification: 'new_work', reason: 'r', reason_source_ids: [], draft: draft(0) });
  r = await classifyChange(SUMMARY, 'Add an online ordering page');
  assert.equal(r.ai_draft.amount_minor, 100);
});

test('a 429 then success retries once on the fallback model', async () => {
  let n = 0;
  MODELS.scope = new MockLanguageModelV1({ defaultObjectGenerationMode: 'json', doGenerate: async () => { n++; throw Object.assign(new Error('rate'), { status: 429 }); } });
  MODELS.fallback = mock({ classification: 'in_scope', reason: 'ok', reason_source_ids: [], draft: null });
  const r = await classifyChange(SUMMARY, 'Contact page phone number please');
  assert.equal(n, 1);
  assert.equal(r.classification, 'in_scope');
  assert.equal(r.usage.fallback, true);
  assert.equal(db.load().ai_runs.at(-1).task, 'scope');
});

test('budget guard throws BUDGET_EXCEEDED before the model is called', async () => {
  db.logAiRun({ task: 'extract', model: 'm', input_tokens: 1, output_tokens: 1, cost_usd: 1.5, latency_ms: 1, fallback: false });
  let called = false;
  MODELS.scope = new MockLanguageModelV1({ defaultObjectGenerationMode: 'json', doGenerate: async () => { called = true; throw new Error('no'); } });
  await assert.rejects(classifyChange(SUMMARY, 'anything at all'), (e) => e.code === 'BUDGET_EXCEEDED');
  assert.equal(called, false);
});

test('agent prompt loads and states the gating rules', () => {
  const p = loadPrompt('agent');
  for (const w of ['milestone.submitted', 'proposal.approved', 'proposal.refund_accepted', 'release_payment', 'refund_payment']) assert.ok(p.includes(w));
});
