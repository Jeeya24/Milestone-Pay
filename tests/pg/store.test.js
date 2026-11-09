// Postgres write-through store. Runs only with TEST_DATABASE_URL; uses a throwaway schema it drops afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// npm run test:pg uses TEST_DATABASE_URL, else DATABASE_URL from .env (isolated mp_test_* schema).
const URL = process.env.TEST_DATABASE_URL || (process.env.PG_TESTS === '1' && process.env.DATABASE_URL) || '';
const opts = { skip: !URL && 'TEST_DATABASE_URL not set', concurrency: false };
const SCHEMA = `mp_test_${crypto.randomBytes(4).toString('hex')}`;

let db; let pgstore;
before(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL;
  process.env.DB_SCHEMA = SCHEMA;
  db = await import('../../db.js');
  pgstore = (await import('../../pgstore.js')).default;
  await db.connect();
});
after(async () => {
  if (!URL) return;
  await pgstore.dropSchema(SCHEMA);
  await pgstore.close();
});

const reload = async () => { await db.connect(); return db.load(); };

test('pg store', opts, async (t) => {
  await t.test('backend is pg', () => assert.equal(db.backend(), 'pg'));

  await t.test('round trip', async () => {
    const d = db.load();
    d.projects.push({ id: 'prj_a', title: 'T' });
    d.milestones.push({ id: 'ms_a', project_id: 'prj_a', amount_minor: 240000 });
    db.save();
    await db.flush();
    const r = await reload();
    assert.deepEqual(r.projects, [{ id: 'prj_a', title: 'T' }]);
    assert.deepEqual(r.milestones, [{ id: 'ms_a', project_id: 'prj_a', amount_minor: 240000 }]);
    assert.equal(typeof r.milestones[0].amount_minor, 'number');
  });

  await t.test('update', async () => {
    db.load().projects[0].title = 'New';
    db.save();
    await db.flush();
    assert.equal((await reload()).projects[0].title, 'New');
  });

  await t.test('delete via filter', async () => {
    const d = db.load();
    d.milestones = d.milestones.filter(() => false);
    db.save();
    await db.flush();
    assert.equal((await reload()).milestones.length, 0);
  });

  await t.test('row without id is stored once', async () => {
    db.load().approvals.push({ agreement_id: 'agr_a', party: 'client' });
    db.save(); await db.flush();
    db.save(); await db.flush();
    const n = await pgstore.count('approvals');
    assert.equal(n, 1);
    const r = await reload();
    assert.deepEqual(r.approvals, [{ agreement_id: 'agr_a', party: 'client' }]);
    r.approvals[0].party = 'freelancer';
    db.save(); await db.flush();
    assert.equal(await pgstore.count('approvals'), 1);
  });

  await t.test('queued saves coalesce', async () => {
    const d = db.load();
    for (let i = 0; i < 5; i++) { d.activity.push({ id: `act_${i}`, project_id: 'prj_a', text: String(i) }); db.save(); }
    await db.flush();
    assert.equal((await reload()).activity.length, 5);
  });

  await t.test('flush failure rejects with PERSIST_FAILED', async () => {
    const real = pgstore.flush;
    pgstore.flush = async () => { throw new Error('boom'); };
    try {
      db.load().projects.push({ id: 'prj_fail' });
      db.save();
      await assert.rejects(db.flush(), (e) => e.code === 'PERSIST_FAILED' && e.status === 500);
    } finally {
      pgstore.flush = real;
    }
    // A later successful flush still writes the pending row.
    db.save();
    await db.flush();
    assert.ok((await reload()).projects.some((p) => p.id === 'prj_fail'));
  });

  await t.test('a request whose save fails returns 500 PERSIST_FAILED, not success', async () => {
    const { createApp } = await import('../../server.js');
    let exited = 0;
    const { loadConfig } = await import('../../config.js');
    const app = createApp({ onPersistFail: () => { exited++; }, config: loadConfig({ NODE_ENV: 'test', TEST_AUTH: '1' }) });
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const lr = await fetch(base + '/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name: 'Ploy' }) });
    assert.equal(lr.status, 200);
    const cookie = lr.headers.getSetCookie()[0].split(';')[0];
    const real = pgstore.flush;
    pgstore.flush = async () => { throw new Error('network blip'); };
    try {
      const fd = new FormData();
      fd.append('chatText', 'Nok: hi\nPloy: hello');
      const res = await fetch(base + '/api/projects', { method: 'POST', body: fd, headers: { origin: base, cookie } });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.error, 'PERSIST_FAILED');
      assert.equal(exited, 1);
      pgstore.flush = real;
      // until the restart, nobody reads the unsaved in-memory state
      const after = await fetch(base + '/api/me', { headers: { cookie } });
      assert.equal(after.status, 503);
      assert.equal((await after.json()).error, 'RESTARTING');
    } finally {
      pgstore.flush = real;
      await new Promise((r) => server.close(r));
    }
  });
});
