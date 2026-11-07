import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../../db.js';
import { seed } from '../../seed.js';

test('seed: one ready Baan Kafe project, no AI call, idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-s8-'));
  const file = path.join(dir, 'db.json');
  for (let i = 0; i < 2; i++) await seed({ dbPath: file });
  db.init(file);
  const d = db.load();
  assert.equal(d.projects.length, 1);
  assert.equal(d.agreements.length, 1);
  assert.equal(d.agreements[0].status, 'approved');
  assert.equal(d.approvals.length, 2);
  assert.equal(d.ai_runs.length, 0);
  const ms = d.milestones.filter((m) => m.project_id === d.projects[0].id).sort((a, b) => a.seq - b.seq);
  assert.equal(ms[0].status, 'agreed');
  assert.ok(ms.every((m) => m.rev_limit === 2));
  assert.ok(d.agreements[0].body.gaps.every((g) => g.fixed));
});
