// Fix list of 2026-11-10: archive and delete projects, project chat on revisions, profile pictures and
// public profiles, and sending a released payment on to the freelancer's PayPal.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../../db.js';
import { payoutFor } from '../../agent.js';
import { purgeDueProjects } from '../../routes.js';
import { tmpEnv, startApp, paypalStub, aiStub, login, makeProject, PNG } from './helpers.js';

let app; let pp; let F; let C; let S;
async function boot(overrides = {}) {
  tmpEnv('mp-fix-');
  pp = paypalStub(overrides);
  app = await startApp({ paypal: pp, ai: await aiStub(), raw: true });
  F = await login(app.call, 'Ploy');
  C = await login(app.call, 'Nok');
  S = await login(app.call, 'Sam');
}
beforeEach(() => boot());
afterEach(() => app.close());

/** Project with both approvals and the client joined. */
async function approved() {
  const p = await makeProject(F.call);
  const inv = await F.call('POST', `/api/projects/${p.pid}/invites`);
  await C.call('POST', `/api/invites/${new URL(inv.body.url).pathname.split('/').pop()}/accept`);
  for (const g of p.agreement.body.gaps) await F.call('POST', `/api/agreements/${p.agreement.id}/gaps/${g.id}/fix`);
  const fa = await F.call('POST', `/api/agreements/${p.agreement.id}/approve`);
  await C.call('POST', `/api/agreements/${p.agreement.id}/approve`, { content_hash: fa.body.agreement.content_hash });
  return p;
}
async function fund(m) {
  const o = await C.call('POST', `/api/milestones/${m.id}/order`);
  return C.call('POST', `/api/milestones/${m.id}/authorize`, { order_id: o.body.order_id });
}
async function deliver(m) {
  const fd = new FormData();
  fd.append('files[]', new Blob([PNG], { type: 'image/png' }), 'home.png');
  await F.call('POST', `/api/milestones/${m.id}/deliverables`, fd);
  return F.call('POST', `/api/milestones/${m.id}/submit`);
}

test('archive hides a project for that member only and can be undone', async () => {
  const { pid } = await approved();
  const row = async (who) => (await who.call('GET', '/api/projects')).body.projects.find((p) => p.id === pid);
  assert.equal((await row(F)).archived, false);
  assert.equal((await F.call('POST', `/api/projects/${pid}/archive`, { archived: 'yes' })).body.error, 'BAD_REQUEST');
  const a = await F.call('POST', `/api/projects/${pid}/archive`, { archived: true });
  assert.deepEqual(a.body, { id: pid, archived: true });
  assert.equal((await row(F)).archived, true);
  assert.equal((await row(C)).archived, false);
  assert.equal((await C.call('POST', `/api/projects/${pid}/archive`, { archived: true })).body.archived, true);
  assert.equal((await F.call('POST', `/api/projects/${pid}/archive`, { archived: false })).body.archived, false);
  assert.equal((await row(F)).archived, false);
  assert.equal((await F.call('GET', `/api/projects/${pid}`)).status, 200);
  assert.equal((await S.call('POST', `/api/projects/${pid}/archive`, { archived: true })).status, 404);
});

test('delete project: hidden at once, restorable for 15 days, then erased; refused with a hold or payments', async () => {
  const draft = await makeProject(F.call);
  const inv = await F.call('POST', `/api/projects/${draft.pid}/invites`);
  const token = new URL(inv.body.url).pathname.split('/').pop();
  await C.call('POST', `/api/invites/${token}/accept`);
  const dir = path.join(process.env.UPLOAD_DIR, draft.pid);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  assert.equal((await S.call('DELETE', `/api/projects/${draft.pid}`)).status, 404);
  const del = await F.call('DELETE', `/api/projects/${draft.pid}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.days, 15);
  // gone for both people and from every route, but nothing is erased yet
  for (const who of [F, C]) {
    assert.equal((await who.call('GET', `/api/projects/${draft.pid}`)).status, 404);
    assert.equal((await who.call('GET', '/api/projects')).body.projects.some((x) => x.id === draft.pid), false);
  }
  assert.equal((await F.call('PATCH', `/api/milestones/${draft.milestones[0].id}`, { amount_minor: 5 })).status, 404);
  assert.equal((await F.call('POST', `/api/projects/${draft.pid}/invites`)).status, 404);
  assert.equal((await app.call('GET', `/api/invite-preview/${token}`)).status, 404);
  assert.equal(fs.existsSync(dir), true);
  // only the freelancer sees it under deleted projects, and can restore it
  const list = await F.call('GET', '/api/projects/deleted');
  assert.deepEqual(list.body.projects.map((x) => x.id), [draft.pid]);
  assert.equal(list.body.projects[0].restore_until, del.body.restore_until);
  assert.deepEqual((await C.call('GET', '/api/projects/deleted')).body.projects, []);
  assert.equal((await C.call('POST', `/api/projects/${draft.pid}/restore`)).status, 404);
  assert.equal(purgeDueProjects(Date.now() + 14 * 864e5), 0);
  const back = await F.call('POST', `/api/projects/${draft.pid}/restore`);
  assert.equal(back.status, 200);
  for (const who of [F, C]) assert.equal((await who.call('GET', `/api/projects/${draft.pid}`)).status, 200);
  assert.equal((await F.call('GET', `/api/projects/${draft.pid}`)).body.milestones.length, 3);
  assert.deepEqual((await F.call('GET', '/api/projects/deleted')).body.projects, []);
  assert.equal(purgeDueProjects(Date.now() + 30 * 864e5), 0);
  // deleted again and left for 15 days: erased for good, rows and files
  await F.call('DELETE', `/api/projects/${draft.pid}`);
  assert.equal(purgeDueProjects(Date.now() + 15 * 864e5 + 1000), 1);
  const d = db.load();
  for (const c of ['projects', 'agreements', 'milestones', 'messages', 'project_members', 'activity', 'invites']) {
    assert.equal(d[c].some((r) => r.id === draft.pid || r.project_id === draft.pid), false, c);
  }
  assert.equal(fs.existsSync(dir), false);
  assert.equal((await F.call('POST', `/api/projects/${draft.pid}/restore`)).status, 404);

  const p = await approved();
  assert.equal((await C.call('DELETE', `/api/projects/${p.pid}`)).body.error, 'WRONG_ROLE');
  await fund(p.milestones[0]);
  assert.equal((await F.call('DELETE', `/api/projects/${p.pid}`)).body.error, 'ACTIVE_HOLDS');
  const sub = await deliver(p.milestones[0]);
  await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);
  const kept = await F.call('DELETE', `/api/projects/${p.pid}`);
  assert.equal(kept.status, 409);
  assert.equal(kept.body.error, 'HAS_PAYMENTS');
  assert.equal(db.load().projects.some((x) => x.id === p.pid), true);
});

test('project chat opens with a revision request and both sides can write', async () => {
  const p = await approved();
  const m = p.milestones[0];
  assert.equal((await F.call('GET', `/api/projects/${p.pid}`)).body.chat, null);
  assert.equal((await F.call('POST', `/api/projects/${p.pid}/chat`, { text: 'hello' })).body.error, 'CHAT_NOT_OPEN');
  await fund(m);
  await deliver(m);
  const rev = await C.call('POST', `/api/milestones/${m.id}/revision`, { note: 'Please make the logo bigger' });
  assert.equal(rev.status, 200);
  let chat = (await F.call('GET', `/api/projects/${p.pid}`)).body.chat;
  assert.equal(chat.length, 1);
  assert.deepEqual([chat[0].from, chat[0].kind, chat[0].label, chat[0].text], ['client', 'revision', 'M1', 'Please make the logo bigger']);
  const f = await F.call('POST', `/api/projects/${p.pid}/chat`, { text: '  How much bigger? ' });
  assert.equal(f.status, 201);
  assert.deepEqual([f.body.message.from, f.body.message.text], ['freelancer', 'How much bigger?']);
  const c = await C.call('POST', `/api/projects/${p.pid}/chat`, { text: 'About double' });
  assert.equal(c.body.message.from, 'client');
  assert.equal((await C.call('POST', `/api/projects/${p.pid}/chat`, { text: '   ' })).body.error, 'MESSAGE_TOO_SHORT');
  assert.equal((await S.call('POST', `/api/projects/${p.pid}/chat`, { text: 'let me in' })).status, 404);
  chat = (await C.call('GET', `/api/projects/${p.pid}`)).body.chat;
  assert.deepEqual(chat.map((x) => x.from), ['client', 'freelancer', 'client']);
});

test('profile picture: upload, serve to project members only, remove', async () => {
  const p = await approved();
  const up = (who, buf, name = 'me.png') => { const fd = new FormData(); fd.append('avatar', new Blob([buf]), name); return who.call('POST', '/api/me/avatar', fd); };
  assert.equal((await up(F, Buffer.from('not an image'))).body.error, 'BAD_FILE');
  assert.equal((await up(F, Buffer.concat([PNG, Buffer.alloc(500 * 1024)]))).body.error, 'FILE_TOO_LARGE');
  const ok = await up(F, PNG);
  assert.equal(ok.status, 200);
  assert.match(ok.body.user.avatar_url, new RegExp(`^/api/users/${F.user.id}/avatar\\?v=\\d+$`));
  assert.ok(!JSON.stringify(ok.body).includes(PNG.toString('base64')));
  const get = (who) => fetch(app.base + ok.body.user.avatar_url, { headers: { cookie: who.cookie } });
  const img = await get(C);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  assert.equal((await get(S)).status, 404);
  const members = (await C.call('GET', `/api/projects/${p.pid}`)).body.members;
  assert.equal(members.find((m) => m.role === 'freelancer').avatar_url, ok.body.user.avatar_url);
  assert.equal(members.find((m) => m.role === 'client').avatar_url, null);
  const rm = await F.call('DELETE', '/api/me/avatar');
  assert.equal(rm.body.user.avatar_url, null);
  assert.equal((await get(C)).status, 404);
});

test('public profile: bio and skills for the other person on a shared project, never the email', async () => {
  const p = await approved();
  await F.call('PATCH', '/api/me', { role: 'freelancer', display_name: 'Ploy Design', skills: ['Web design'], bio: 'Sites for cafés' });
  await C.call('PATCH', '/api/me', { role: 'client', display_name: 'Baan Kafe', client_type: 'business', hire_for: ['Website'], bio: 'A small café' });
  const fid = (await C.call('GET', `/api/projects/${p.pid}`)).body.members.find((m) => m.role === 'freelancer').user_id;
  const seen = await C.call('GET', `/api/users/${fid}`);
  assert.equal(seen.status, 200);
  assert.deepEqual([seen.body.profile.display_name, seen.body.profile.skills, seen.body.profile.bio], ['Ploy Design', ['Web design'], 'Sites for cafés']);
  assert.ok(!('email' in seen.body.profile) && !JSON.stringify(seen.body).includes('test.local'));
  const client = await F.call('GET', `/api/users/${C.user.id}`);
  assert.deepEqual([client.body.profile.display_name, client.body.profile.client_type, client.body.profile.hire_for, client.body.profile.bio], ['Baan Kafe', 'business', ['Website'], 'A small café']);
  assert.equal((await S.call('GET', `/api/users/${fid}`)).status, 404);
  assert.equal((await C.call('GET', '/api/users/usr_nope')).status, 404);
});

test('after the client approves, the held payment is sent on to the freelancer once', async () => {
  await app.close();
  const payouts = [];
  await boot({ createPayout: async (a) => { payouts.push(a); return { batch_id: `BATCH-${payouts.length}`, status: 'PENDING' }; } });
  const p = await approved();
  const m = p.milestones[0];
  await fund(m);
  const sub = await deliver(m);
  // nothing is paid out before the client approves
  assert.equal((await payoutFor(m.id, { paypal: pp })).status, 'NO_APPROVAL');
  assert.equal(payouts.length, 0);
  const ok = await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(payouts.length, 1);
  const cap = ok.body.payment.capture_id;
  assert.deepEqual(payouts[0], { batchId: `payout-${cap}`, email: 'ploy@test.local', amount_minor: m.amount_minor, cur: 'USD', note: `${m.label} ${m.title}` });
  const d = (await F.call('GET', `/api/projects/${p.pid}`)).body;
  assert.deepEqual(d.ledger.map((l) => l.event), ['HELD', 'CAPTURED', 'PAID_OUT']);
  assert.equal(d.ledger[2].paypal_id, 'BATCH-1');
  assert.equal(d.milestones[0].payment.payout_status, 'SENT');
  // repeat approve, refresh and a direct call never pay twice
  await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);
  await F.call('POST', `/api/projects/${p.pid}/refresh`);
  assert.equal((await payoutFor(m.id, { paypal: pp })).already, true);
  assert.equal(payouts.length, 1);
});

test('a failed payout keeps the milestone paid and is retried from refresh', async () => {
  await app.close();
  let fail = true; const sent = [];
  await boot({ createPayout: async (a) => { if (fail) throw Object.assign(new Error('nope'), { paypal_name: 'AUTHORIZATION_ERROR' }); sent.push(a); return { batch_id: 'BATCH-OK', status: 'PENDING' }; } });
  const p = await approved();
  const m = p.milestones[0];
  await fund(m);
  const sub = await deliver(m);
  const ok = await C.call('POST', `/api/proposals/${sub.body.proposal.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.milestone.status, 'paid');
  assert.equal(ok.body.milestone.payment.payout_status, 'FAILED');
  assert.deepEqual(db.load().ledger.map((l) => l.event), ['HELD', 'CAPTURED']);
  fail = false;
  await F.call('POST', `/api/projects/${p.pid}/refresh`);
  assert.equal(sent.length, 1);
  assert.equal((await F.call('GET', `/api/projects/${p.pid}`)).body.milestones[0].payment.payout_status, 'SENT');
  await F.call('POST', `/api/projects/${p.pid}/refresh`);
  assert.equal(sent.length, 1);
});
