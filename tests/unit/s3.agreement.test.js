import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as db from '../../db.js';
import { canonicalJson, agreementHash } from '../../routes.js';
import { tmpEnv, startApp, aiStub, paypalStub, makeProject, approveBoth, fakeExtraction, PNG } from './helpers.js';

let app, ai;
beforeEach(async () => {
  tmpEnv('mp-s3-');
  ai = await aiStub();
  app = await startApp({ paypal: paypalStub(), ai });
});
afterEach(() => app.close());

const form = (fields = {}, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [name, buf, type] of files) fd.append('files', new Blob([buf], { type }), name);
  return fd;
};

test('hash is stable for identical content and changes when an amount changes', () => {
  const ex = fakeExtraction();
  const a = { body: ex.body };
  const ms = ex.milestones.map((m) => ({ ...m, rev_limit: null }));
  const h1 = agreementHash(a, ms);
  assert.equal(h1, agreementHash({ body: { ...ex.body, translations: { en: { m1: 'changed' } } } }, ms.map((m) => ({ ...m }))));
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  const changed = ms.map((m, i) => (i === 0 ? { ...m, amount_minor: m.amount_minor + 1 } : m));
  assert.notEqual(h1, agreementHash(a, changed));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test('POST /projects stores raw messages (HTML is not escaped server-side)', async () => {
  const line = '<img src=x onerror=alert(1)>';
  const r = await app.call('POST', '/api/projects', form({ chatText: `Nok: ${line}\nPloy: ok`, freelancer_name: 'Ploy' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.messages[0].text, line);
  assert.equal(r.body.messages[1].me, true);
  assert.equal(r.body.project.status, 'draft');
  const g = await app.call('GET', `/api/projects/${r.body.project.id}`);
  assert.equal(g.body.messages[0].text, line);
});

test('empty chat, bad files, too many files', async () => {
  assert.equal((await app.call('POST', '/api/projects', form({ chatText: '  ' }))).body.error, 'EMPTY_CHAT');
  // text file renamed .png
  let r = await app.call('POST', '/api/projects', form({}, [['fake.png', Buffer.from('Nok: hello'), 'image/png']]));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'BAD_FILE');
  // wrong extension
  r = await app.call('POST', '/api/projects', form({}, [['x.exe', Buffer.from('MZ'), 'application/octet-stream']]));
  assert.equal(r.body.error, 'BAD_FILE');
  // NUL byte in .txt
  r = await app.call('POST', '/api/projects', form({}, [['a.txt', Buffer.from([0x4e, 0, 0x41]), 'text/plain']]));
  assert.equal(r.body.error, 'BAD_FILE');
  // 11 files
  const many = Array.from({ length: 11 }, (_, i) => [`${i}.txt`, Buffer.from('Nok: hi'), 'text/plain']);
  r = await app.call('POST', '/api/projects', form({}, many));
  assert.equal(r.body.error, 'TOO_MANY_FILES');
  assert.equal(db.load().projects.length, 0);
});

test('file over 20 MB returns 413 FILE_TOO_LARGE', async () => {
  const big = Buffer.alloc(20 * 1024 * 1024 + 10, 0x61);
  const r = await app.call('POST', '/api/projects', form({}, [['big.txt', big, 'text/plain']]));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'FILE_TOO_LARGE');
});

test('txt upload and png upload (vision) with dedupe', async () => {
  const r = await app.call('POST', '/api/projects', form({}, [
    ['chat.txt', Buffer.from('Nok: hi\nPloy: hello'), 'text/plain'],
    ['a.png', PNG, 'image/png'],
    ['b.png', PNG, 'image/png'],
  ]));
  assert.equal(r.status, 201);
  assert.equal(ai.calls.transcribe, 1);
  assert.deepEqual(r.body.import.files.map((f) => [f.name, f.kind]), [['chat.txt', 'txt'], ['a.png', 'image'], ['b.png', 'image']]);
  assert.equal(r.body.messages.length, 4);
  assert.deepEqual(r.body.messages.map((m) => m.msg_id), ['m1', 'm2', 'm3', 'm4']);
  assert.ok(fs.readdirSync(`${process.env.UPLOAD_DIR}/${r.body.project.id}`).length === 3);
});

test('vision failure is 502 AI_FAILED and budget error is 429, and no project is saved', async () => {
  let bad = await aiStub({ transcribeImages: async () => { throw new Error('boom'); } });
  await app.close();
  app = await startApp({ paypal: paypalStub(), ai: bad });
  let r = await app.call('POST', '/api/projects', form({}, [['a.png', PNG, 'image/png']]));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'AI_FAILED');
  bad = await aiStub({ transcribeImages: async () => { throw new db.AppError('BUDGET_EXCEEDED', 'Daily AI budget reached', 429); } });
  await app.close();
  app = await startApp({ paypal: paypalStub(), ai: bad });
  r = await app.call('POST', '/api/projects', form({}, [['a.png', PNG, 'image/png']]));
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'BUDGET_EXCEEDED');
  assert.equal(db.load().projects.length, 0);
});

test('extract creates draft agreement + draft milestones; re-run replaces them', async () => {
  const { pid, agreement, milestones } = await makeProject(app.call);
  assert.equal(agreement.status, 'draft');
  assert.equal(milestones.length, 3);
  assert.deepEqual(milestones.map((m) => m.label), ['M1', 'M2', 'M3']);
  assert.ok(milestones.every((m) => m.id.startsWith('ms_') && m.status === 'draft' && m.rev_limit === null && m.rev_count === 0));
  assert.equal(milestones[0].is_current, true);
  assert.equal(milestones[0].fundable, false);
  const again = await app.call('POST', `/api/projects/${pid}/extract`);
  assert.equal(again.status, 200);
  assert.equal(db.load().agreements.length, 1);
  assert.equal(db.load().milestones.length, 3);
  assert.equal(again.body.ai_run.model, 'stub');
});

test('CURRENCY_MISMATCH returns 422 and saves nothing', async () => {
  const a = await aiStub({ extractAgreement: async () => fakeExtraction({ currency: 'THB' }) });
  await app.close();
  app = await startApp({ paypal: paypalStub(), ai: a });
  const p = await app.call('POST', '/api/projects', form({ chatText: 'Nok: hi\nPloy: yo' }));
  const r = await app.call('POST', `/api/projects/${p.body.project.id}/extract`);
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'CURRENCY_MISMATCH');
  assert.match(r.body.message, /USD/);
  assert.equal(db.load().agreements.length, 0);
});

test('fixing g1 sets rev_limit 2 on every milestone and writes the term', async () => {
  const { agreement, milestones } = await makeProject(app.call);
  const r = await app.call('POST', `/api/agreements/${agreement.id}/gaps/g1/fix`);
  assert.equal(r.status, 200);
  assert.ok(r.body.milestones.every((m) => m.rev_limit === 2));
  assert.equal(r.body.milestones.length, milestones.length);
  assert.equal(r.body.agreement.body.gaps[0].fixed, true);
  assert.equal(r.body.agreement.body.terms.find((t) => t.key === 'revisions').value, '2 rounds per milestone');
  assert.equal((await app.call('POST', `/api/agreements/${agreement.id}/gaps/g9/fix`)).status, 404);
});

test('PATCH amount: validation, mismatch flag, only amount_minor', async () => {
  const { milestones } = await makeProject(app.call);
  const id = milestones[0].id;
  assert.equal((await app.call('PATCH', `/api/milestones/${id}`, { amount_minor: 12.5 })).body.error, 'BAD_AMOUNT');
  assert.equal((await app.call('PATCH', `/api/milestones/${id}`, { amount_minor: -1 })).body.error, 'BAD_AMOUNT');
  assert.equal((await app.call('PATCH', `/api/milestones/${id}`, { amount_minor: '5' })).body.error, 'BAD_AMOUNT');
  const r = await app.call('PATCH', `/api/milestones/${id}`, { amount_minor: 250000, title: 'hacked', status: 'paid' });
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.amount_minor, 250000);
  assert.equal(r.body.milestone.title, 'Part 1');
  assert.equal(r.body.milestone.status, 'draft');
  assert.equal(r.body.sum_minor, 810000);
  assert.equal(r.body.agreed_total_minor, 800000);
  assert.equal(r.body.mismatch, true);
});

test('approval flow: NOT_SENT, HASH_MISMATCH, frozen PATCH, milestones draft -> agreed', async () => {
  const { pid, agreement, milestones } = await makeProject(app.call);
  const early = await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'client', content_hash: 'x' });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'NOT_SENT');

  const f = await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'freelancer' });
  assert.equal(f.status, 200);
  assert.equal(f.body.agreement.status, 'sent');
  assert.equal(f.body.client_url, `/?as=client&p=${pid}`);
  const hash = f.body.agreement.content_hash;
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  // second freelancer approve does not add another approval or change the hash
  const f2 = await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'freelancer' });
  assert.equal(f2.body.agreement.content_hash, hash);
  assert.equal(db.load().approvals.length, 1);

  const patch = await app.call('PATCH', `/api/milestones/${milestones[0].id}`, { amount_minor: 1 });
  assert.equal(patch.status, 409);
  assert.equal(patch.body.error, 'AGREEMENT_FROZEN');
  assert.equal((await app.call('POST', `/api/agreements/${agreement.id}/gaps/g1/fix`)).body.error, 'AGREEMENT_FROZEN');
  assert.equal((await app.call('POST', `/api/projects/${pid}/extract`)).body.error, 'AGREEMENT_FROZEN');

  const bad = await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'client', content_hash: 'sha256:00' });
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error, 'HASH_MISMATCH');
  assert.ok(db.load().milestones.every((m) => m.status === 'draft'));

  const c = await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'client', content_hash: hash });
  assert.equal(c.status, 200);
  assert.equal(c.body.agreement.status, 'approved');
  assert.ok(c.body.milestones.every((m) => m.status === 'agreed'));
  assert.equal(c.body.milestones[0].fundable, true);
  assert.equal(c.body.milestones[1].fundable, false);
  assert.equal(db.load().approvals.length, 2);
  assert.equal((await app.call('POST', `/api/agreements/${agreement.id}/approve`, { party: 'nobody' })).body.error, 'BAD_PARTY');
});

test('GET /projects totals come from the ledger; GET /projects/:id has the full shape', async () => {
  const { pid, agreement, milestones } = await makeProject(app.call);
  let list = await app.call('GET', '/api/projects');
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].total_minor, 800000);
  assert.deepEqual(list.body.projects[0].open_change_request, null);
  assert.deepEqual(list.body.totals, { held_minor: 0, paid_minor: 0, not_funded_minor: 800000 });

  await approveBoth(app.call, agreement.id);
  // simulate ledger: M1 captured, M2 held, M3 stays agreed
  const d = db.load();
  const [m1, m2] = d.milestones.filter((m) => m.project_id === pid).sort((a, b) => a.seq - b.seq);
  db.transition(m1, 'authorized'); db.transition(m1, 'submitted'); db.transition(m1, 'paid');
  db.ledgerAdd({ project_id: pid, milestone_id: m1.id, label: 'M1', event: 'AUTHORIZED', amount_minor: m1.amount_minor });
  db.ledgerAdd({ project_id: pid, milestone_id: m1.id, label: 'M1', event: 'CAPTURED', amount_minor: m1.amount_minor });
  db.transition(m2, 'authorized');
  db.ledgerAdd({ project_id: pid, milestone_id: m2.id, label: 'M2', event: 'AUTHORIZED', amount_minor: m2.amount_minor });
  list = await app.call('GET', '/api/projects');
  assert.deepEqual(list.body.totals, { held_minor: 320000, paid_minor: 240000, not_funded_minor: 240000 });

  const g = await app.call('GET', `/api/projects/${pid}`);
  assert.equal(g.status, 200);
  for (const k of ['project', 'agreement', 'approvals', 'messages', 'milestones', 'ledger', 'activity', 'notifications', 'agent_runs', 'change_requests', 'ai_cost']) {
    assert.ok(k in g.body, k);
  }
  const ms = g.body.milestones;
  assert.equal(ms[0].is_current, false);
  assert.equal(ms[1].is_current, true);
  assert.equal(ms[1].fundable, false);
  assert.deepEqual(ms[1].deliverables, []);
  assert.equal(ms[1].payment, null);
  assert.equal((await app.call('GET', '/api/projects/prj_nope')).status, 404);
  void milestones;
});

test('POST /demo builds Baan Kafe from the cached extraction without calling the model', async () => {
  const r = await app.call('POST', '/api/demo');
  assert.equal(r.status, 201);
  assert.equal(ai.calls.extract, 0);
  const g = await app.call('GET', `/api/projects/${r.body.project_id}`);
  assert.equal(g.body.agreement.body.currency, 'USD');
  assert.equal(g.body.milestones.reduce((s, m) => s + m.amount_minor, 0), 80000);
  assert.equal(g.body.messages.length, 9);
});

test('sandbox-login works from localhost', async () => {
  const r = await app.call('GET', '/api/sandbox-login');
  assert.equal(r.status, 200);
  assert.ok('email' in r.body && 'password' in r.body);
});
