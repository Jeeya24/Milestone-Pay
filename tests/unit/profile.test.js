// Onboarding profile, invite preview, agreement notes, download-all zip (design-system journey).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../db.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject, PNG } from './helpers.js';

let app; let F; let C;
beforeEach(async () => {
  tmpEnv('mp-prof-');
  app = await startApp({ paypal: paypalStub(), ai: await aiStub(), raw: true });
  F = await login(app.call, 'Ploy');
  C = await login(app.call, 'Nok');
});
afterEach(() => app.close());

test('new user is not onboarded; role + setup step finishes onboarding', async () => {
  const me = await F.call('GET', '/api/me');
  assert.equal(me.body.user.onboarded, false);
  assert.deepEqual(me.body.user.roles, []);
  const r1 = await F.call('PATCH', '/api/me', { role: 'freelancer' });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.user.active_role, 'freelancer');
  const noSkill = await F.call('PATCH', '/api/me', { display_name: 'Ploy Design', finish: true });
  assert.equal(noSkill.status, 400);
  assert.equal(noSkill.body.error, 'SKILL_REQUIRED');
  const done = await F.call('PATCH', '/api/me', { display_name: 'Ploy Design', skills: ['Web design', 'Branding'], bio: 'Cafés', finish: true });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.onboarded, true);
  assert.equal(done.body.user.display_name, 'Ploy Design');
  assert.deepEqual(done.body.user.skills, ['Web design', 'Branding']);
});

test('PATCH /api/me rejects unknown fields and bad values', async () => {
  assert.equal((await F.call('PATCH', '/api/me', { is_admin: true })).body.error, 'BAD_PROFILE');
  assert.equal((await F.call('PATCH', '/api/me', { role: 'boss' })).body.error, 'BAD_PROFILE');
  assert.equal((await F.call('PATCH', '/api/me', { bio: 'x'.repeat(161) })).body.error, 'BAD_PROFILE');
  assert.equal((await F.call('PATCH', '/api/me', { finish: true })).body.error, 'ROLE_REQUIRED');
});

test('client onboarding needs no skill; add_role adds the other role', async () => {
  const r = await C.call('PATCH', '/api/me', { role: 'client', client_type: 'business', display_name: 'Baan Kafe', hire_for: ['Website'], finish: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.onboarded, true);
  const a = await C.call('PATCH', '/api/me', { add_role: 'freelancer' });
  assert.deepEqual(a.body.user.roles.sort(), ['client', 'freelancer']);
  assert.equal(a.body.user.active_role, 'freelancer');
});

test('invite preview is public and shows sender, total and parts; display name is used', async () => {
  await F.call('PATCH', '/api/me', { display_name: 'Ploy Design' });
  const { pid } = await makeProject(F.call);
  const inv = await F.call('POST', `/api/projects/${pid}/invites`);
  const token = new URL(inv.body.url).pathname.split('/').pop();
  const pub = await app.call('GET', `/api/invite-preview/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.freelancer.name, 'Ploy Design');
  assert.equal(pub.body.parts, 3);
  assert.equal(pub.body.total_minor, 800000);
  assert.equal((await app.call('GET', '/api/invite-preview/nope')).status, 404);
});

test('notes: client and freelancer exchange notes while the agreement is sent', async () => {
  const { pid, agreement } = await makeProject(F.call);
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const early = await F.call('POST', `/api/agreements/${agreement.id}/notes`, { text: 'hello' });
  assert.equal(early.body.error, 'NOT_SENT');
  await F.call('POST', `/api/agreements/${agreement.id}/approve`);
  db.load().project_members.push({ project_id: pid, user_id: C.user.id, role: 'client', at: new Date().toISOString() });
  db.save();
  const n = await C.call('POST', `/api/agreements/${agreement.id}/notes`, { text: 'Does this include menu photos?' });
  assert.equal(n.status, 201);
  assert.equal(n.body.note.from, 'client');
  await F.call('POST', `/api/agreements/${agreement.id}/notes`, { text: 'Yes, it does.' });
  const v = await C.call('GET', `/api/projects/${pid}`);
  assert.deepEqual(v.body.notes.map((x) => x.from), ['client', 'freelancer']);
  assert.equal((await C.call('POST', `/api/agreements/${agreement.id}/notes`, { text: ' ' })).body.error, 'NOTE_TOO_SHORT');
});

test('download-all zips the current version and is members-only', async () => {
  const { pid, agreement, milestones } = await makeProject(F.call);
  for (const g of agreement.body.gaps) await F.call('POST', `/api/agreements/${agreement.id}/gaps/${g.id}/fix`);
  const f = await F.call('POST', `/api/agreements/${agreement.id}/approve`);
  db.load().project_members.push({ project_id: pid, user_id: C.user.id, role: 'client', at: new Date().toISOString() });
  db.save();
  await C.call('POST', `/api/agreements/${agreement.id}/approve`, { content_hash: f.body.agreement.content_hash });
  const m = milestones[0];
  const o = await C.call('POST', `/api/milestones/${m.id}/order`);
  await C.call('POST', `/api/milestones/${m.id}/authorize`, { order_id: o.body.order_id });
  assert.equal((await F.call('GET', `/api/milestones/${m.id}/download-all`)).status, 404);
  const fd = new FormData();
  fd.append('files[]', new Blob([PNG]), 'a.png');
  fd.append('files[]', new Blob([PNG]), 'b.png');
  assert.equal((await F.call('POST', `/api/milestones/${m.id}/deliverables`, fd)).status, 201);
  const res = await fetch(`${app.base}/api/milestones/${m.id}/download-all`, { headers: { cookie: C.cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const S = await login(app.call, 'Sam');
  assert.equal((await S.call('GET', `/api/milestones/${m.id}/download-all`)).status, 404);
});

test('project list carries deadline, held/paid and client totals', async () => {
  const { pid } = await makeProject(F.call);
  const l = await F.call('GET', '/api/projects');
  const p = l.body.projects.find((x) => x.id === pid);
  assert.equal(p.deadline, 'deadline value');
  assert.equal(p.paid_count, 0);
  assert.equal(p.current.label, 'M1');
  assert.deepEqual(l.body.client_totals, { held_minor: 0, paid_minor: 0 });
});
