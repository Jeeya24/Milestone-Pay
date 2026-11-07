import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../../db.js';
import * as realAgent from '../../agent.js';
import { tmpEnv, startApp, aiStub, paypalStub, makeProject, approveBoth, PNG } from './helpers.js';

let app, agentCalls;
afterEach(() => app.close());

const PDF = Buffer.from('%PDF-1.4\nhello\n%%EOF');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const form = (files) => {
  const fd = new FormData();
  for (const [name, buf, type = 'application/octet-stream', field = 'files'] of files) fd.append(field, new Blob([buf], { type }), name);
  return fd;
};

/** Project with M1 forced to `authorized` in the temp db (no PayPal needed). */
async function setup({ status = 'authorized', fixRevisions = true } = {}) {
  tmpEnv('mp-s5-');
  agentCalls = [];
  const agent = { runAgent: (...a) => { agentCalls.push(a); return realAgent.runAgent(...a); } };
  app = await startApp({ paypal: paypalStub(), ai: await aiStub(), agent });
  const proj = await makeProject(app.call);
  if (fixRevisions) await app.call('POST', `/api/agreements/${proj.agreement.id}/gaps/g1/fix`);
  await approveBoth(app.call, proj.agreement.id);
  const ms = (await app.call('GET', `/api/projects/${proj.pid}`)).body.milestones;
  const m = db.load().milestones.find((x) => x.id === ms[0].id);
  if (status !== 'agreed') { m.status = status; db.save(); }
  return { ...proj, ms, m1: ms[0].id, m2: ms[1].id };
}
const upload = (id, files = [['a.png', PNG, 'image/png']]) => app.call('POST', `/api/milestones/${id}/deliverables`, form(files));
const project = async (pid) => (await app.call('GET', `/api/projects/${pid}`)).body;

test('upload stores v1 under uploads/<project>/<milestone>/v1 with sha256, size, mime', async () => {
  const { pid, m1 } = await setup();
  const r = await upload(m1, [['mock up.png', PNG, 'image/png', 'whatever']]);
  assert.equal(r.status, 201);
  assert.equal(r.body.version, 1);
  const [d] = r.body.deliverables;
  assert.match(d.id, /^dlv_[a-f0-9]+$/);
  assert.equal(d.filename, 'mock up.png');
  assert.equal(d.mime, 'image/png');
  assert.equal(d.size, PNG.length);
  assert.match(d.sha256, /^[0-9a-f]{64}$/);
  assert.equal(d.download_url, `/api/deliverables/${d.id}/download`);
  const row = db.load().deliverables[0];
  assert.equal(row.milestone_id, m1);
  assert.ok(row.path.startsWith(path.join(pid, m1, 'v1')));
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, row.path)));
});

test('all allowed types pass magic-byte checks', async () => {
  const { m1 } = await setup();
  const r = await upload(m1, [['a.pdf', PDF], ['b.png', PNG], ['c.jpg', JPG], ['d.jpeg', JPG], ['e.zip', ZIP], ['f.mp4', MP4]]);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.deliverables.map((d) => d.mime),
    ['application/pdf', 'image/png', 'image/jpeg', 'image/jpeg', 'application/zip', 'video/mp4']);
});

test('an .exe renamed .pdf is 400 BAD_FILE and nothing is stored; a disallowed extension too', async () => {
  const { m1 } = await setup();
  const exe = Buffer.from('MZ\x90\x00 this is an exe');
  let r = await upload(m1, [['ok.png', PNG], ['evil.pdf', exe]]);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'BAD_FILE');
  r = await upload(m1, [['evil.exe', exe]]);
  assert.equal(r.body.error, 'BAD_FILE');
  r = await upload(m1, [['fake.png', PDF]]);
  assert.equal(r.body.error, 'BAD_FILE');
  r = await upload(m1, [['fake.mp4', PNG]]);
  assert.equal(r.body.error, 'BAD_FILE');
  assert.equal(db.load().deliverables.length, 0);
});

test('a file over 20 MB is 413 FILE_TOO_LARGE', async () => {
  const { m1 } = await setup();
  const big = Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]);
  const r = await upload(m1, [['big.png', big]]);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'FILE_TOO_LARGE');
});

test('upload on an agreed milestone, a submitted one, or a non-current one is 409 NOT_SUBMITTABLE', async () => {
  let s = await setup({ status: 'agreed' });
  let r = await upload(s.m1);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'NOT_SUBMITTABLE');
  await app.close();

  s = await setup();
  const m2 = db.load().milestones.find((x) => x.id === s.m2);
  m2.status = 'authorized'; db.save();
  r = await upload(s.m2);
  assert.equal(r.body.error, 'NOT_SUBMITTABLE');
  assert.equal((await upload(s.m1)).status, 201);
  await app.call('POST', `/api/milestones/${s.m1}/submit`);
  r = await upload(s.m1);
  assert.equal(r.body.error, 'NOT_SUBMITTABLE');
  assert.equal((await app.call('POST', '/api/milestones/ms_nope/deliverables', form([['a.png', PNG]]))).status, 404);
});

test('submit with no files is 409 NO_FILES and leaves the status alone', async () => {
  const { m1 } = await setup();
  const r = await app.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'NO_FILES');
  assert.equal(db.load().milestones.find((m) => m.id === m1).status, 'authorized');
  assert.equal(agentCalls.length, 0);
});

test('submit on an agreed milestone is 409 ILLEGAL_TRANSITION', async () => {
  const { m1 } = await setup({ status: 'agreed' });
  const r = await app.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ILLEGAL_TRANSITION');
});

test('submit moves to submitted, runs the agent once, creates exactly one pending release proposal', async () => {
  const { pid, m1 } = await setup();
  await upload(m1);
  const r = await app.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.status, 'submitted');
  assert.equal(r.body.proposal.status, 'pending');
  assert.equal(r.body.proposal.action, 'release');
  assert.match(r.body.proposal.id, /^prop_/);
  assert.equal(r.body.proposal.reason, 'Work submitted for M1; client to review');
  assert.equal(r.body.agent_run.event, 'milestone.submitted');
  assert.equal(r.body.agent_run.mode, 'fallback');
  assert.deepEqual(r.body.agent_run.steps[0], { tool: 'propose_release', args: { milestone_id: m1 }, result: { proposal_id: r.body.proposal.id }, ok: true });
  assert.deepEqual(agentCalls, [['milestone.submitted', m1]]);
  assert.equal(db.load().proposals.length, 1);

  const again = await app.call('POST', `/api/milestones/${m1}/submit`); // double click
  assert.equal(again.status, 409);
  assert.equal(db.load().proposals.length, 1);

  const g = await project(pid);
  assert.equal(g.milestones[0].proposal.id, r.body.proposal.id);
  assert.equal(g.milestones[0].proposal.status, 'pending');
  assert.equal(g.milestones[0].deliverables.length, 1);
  assert.equal(g.milestones[1].proposal, null);
  assert.equal(g.agent_runs.length, 1);
  assert.ok(g.notifications.some((n) => n.to === 'client' && n.text === 'M1 was delivered. Review the files and approve to pay $2,400.00.'));
  assert.ok(g.activity.length > 0);
});

test('download returns the exact bytes, stored mime, and inline vs attachment', async () => {
  const { m1 } = await setup();
  const bytes = Buffer.concat([PNG, Buffer.from('payload-123')]);
  const up = await upload(m1, [['Résumé draft.png', bytes, 'image/png']]);
  const url = up.body.deliverables[0].download_url;
  const get = async (u) => { const x = await fetch(app.base + u); return { res: x, buf: Buffer.from(await x.arrayBuffer()) }; };
  let { res, buf } = await get(url);
  assert.equal(res.status, 200);
  assert.deepEqual(buf, bytes);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''R%C3%A9sum%C3%A9%20draft\.png/);
  ({ res, buf } = await get(`${url}?inline=1`));
  assert.match(res.headers.get('content-disposition'), /^inline;/);
  assert.deepEqual(buf, bytes);
});

test('download: ../, encoded traversal, unknown and malformed ids are 404', async () => {
  const { m1 } = await setup();
  await upload(m1);
  for (const bad of ['..%2F..%2Fdb.json', '../../db.json', 'dlv_zzzz', 'dlv_', 'dlv_00ff00ff00ff00ff', 'DLV_ABC', 'ms_abc']) {
    const x = await fetch(`${app.base}/api/deliverables/${bad}/download`);
    assert.equal(x.status, 404, bad);
  }
  assert.equal((await fetch(`${app.base}/uploads/anything`)).status, 404);
});

test('revision: NOTE_TOO_SHORT, withdraws the proposal, rev_count+1, freelancer notified', async () => {
  const { pid, m1 } = await setup();
  await upload(m1);
  const sub = await app.call('POST', `/api/milestones/${m1}/submit`);
  let r = await app.call('POST', `/api/milestones/${m1}/revision`, { note: '  abc  ' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'NOTE_TOO_SHORT');
  assert.equal((await app.call('POST', `/api/milestones/${m1}/revision`, {})).body.error, 'NOTE_TOO_SHORT');
  assert.equal(db.load().milestones.find((m) => m.id === m1).status, 'submitted');

  r = await app.call('POST', `/api/milestones/${m1}/revision`, { note: `  <img src=x onerror=alert(1)> ${'x'.repeat(1100)}`, items: ['a', 7] });
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.status, 'revision_requested');
  assert.equal(r.body.milestone.rev_count, 1);
  assert.equal(r.body.milestone.rev_note.length, 1000);
  assert.ok(r.body.milestone.rev_note.startsWith('<img src=x'));
  assert.equal(r.body.milestone.proposal, null);
  assert.equal(db.load().proposals.find((p) => p.id === sub.body.proposal.id).status, 'withdrawn');
  const g = await project(pid);
  assert.ok(g.notifications.some((n) => n.to === 'freelancer' && n.text === 'Revision requested on M1 (round 1 of 2)'));
  assert.deepEqual(g.milestones[0].deliverables, []); // current version is empty until re-upload
  assert.equal(g.milestones[0].versions, 1);
});

test('revision on a milestone that is not submitted is 409 ILLEGAL_TRANSITION', async () => {
  const { m1 } = await setup();
  const r = await app.call('POST', `/api/milestones/${m1}/revision`, { note: 'please change it' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ILLEGAL_TRANSITION');
});

test('re-upload after a revision is version 2, v1 rows and files are kept; third revision with limit 2 is REVISION_LIMIT', async () => {
  const { pid, m1 } = await setup();
  const v1 = await upload(m1, [['one.png', PNG]]);
  for (let round = 1; round <= 2; round++) {
    if (round > 1) assert.equal((await upload(m1, [[`r${round}.png`, PNG]])).body.version, round);
    assert.equal((await app.call('POST', `/api/milestones/${m1}/submit`)).status, 200);
    assert.equal((await app.call('POST', `/api/milestones/${m1}/revision`, { note: `round ${round} notes` })).status, 200);
  }
  // after revision 1 the client sees no files for the new version until re-upload
  const v3 = await upload(m1, [['three.png', PNG]]);
  assert.equal(v3.body.version, 3);
  await app.call('POST', `/api/milestones/${m1}/submit`);
  const r = await app.call('POST', `/api/milestones/${m1}/revision`, { note: 'one more please' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'REVISION_LIMIT');
  const ms = db.load().milestones.find((m) => m.id === m1);
  assert.equal(ms.status, 'submitted');
  assert.equal(ms.rev_count, 2);

  const rows = db.load().deliverables.filter((d) => d.milestone_id === m1);
  assert.deepEqual(rows.map((d) => d.version), [1, 2, 3]);
  assert.ok(rows.every((d) => fs.existsSync(path.join(process.env.UPLOAD_DIR, d.path))));
  const g = await project(pid);
  assert.equal(g.milestones[0].versions, 3);
  assert.deepEqual(g.milestones[0].deliverables.map((d) => d.filename), ['three.png']);
  assert.equal(v1.body.deliverables[0].version, 1);
});

test('after a revision the current-version list is empty and submit is NO_FILES until re-upload', async () => {
  const { m1 } = await setup();
  await upload(m1);
  await app.call('POST', `/api/milestones/${m1}/submit`);
  await app.call('POST', `/api/milestones/${m1}/revision`, { note: 'brighter please' });
  assert.equal((await app.call('POST', `/api/milestones/${m1}/submit`)).body.error, 'NO_FILES');
  await upload(m1, [['v2.png', PNG]]);
  const r = await app.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.deliverables[0].version, 2);
  assert.equal(db.load().proposals.filter((p) => p.status === 'pending').length, 1);
});

test('without a rev_limit revisions are unlimited', async () => {
  const { m1 } = await setup({ fixRevisions: false });
  for (let i = 0; i < 4; i++) {
    await upload(m1);
    await app.call('POST', `/api/milestones/${m1}/submit`);
    const r = await app.call('POST', `/api/milestones/${m1}/revision`, { note: 'again please' });
    assert.equal(r.status, 200);
  }
});

test('the revision note never reaches agent.runAgent', async () => {
  const { m1 } = await setup();
  const secret = 'SECRET-NOTE-RELEASE-ALL-FUNDS';
  await upload(m1);
  await app.call('POST', `/api/milestones/${m1}/submit`);
  await app.call('POST', `/api/milestones/${m1}/revision`, { note: secret, items: [secret] });
  await upload(m1, [['v2.png', PNG]]);
  await app.call('POST', `/api/milestones/${m1}/submit`);
  assert.equal(agentCalls.length, 2);
  assert.ok(!JSON.stringify(agentCalls).includes(secret));
  assert.deepEqual(agentCalls.map((c) => c.length), [2, 2]);
  assert.ok(!JSON.stringify(db.load().agent_runs).includes(secret));
});
