// Phone audit: every screen at 390px and 360px, as freelancer and client, in the states that matter.
// For each screen it fails on: sideways page scroll, anything sticking out past the screen edge, a tap target under
// 36px, or a console error; and saves a screenshot. Start a fresh stub server first (see journey-ui.cjs), then:
//   node tests/qa/phone-ui.cjs <screenshot-dir> "$PWD" [base=http://localhost:3056]
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2], repo = process.argv[3], base = process.argv[4] || 'http://localhost:3056';
fs.mkdirSync(out, { recursive: true });
const errors = [], results = []; let n = 0;
const chat = fs.readFileSync(repo + '/fixtures/baan-kafe.txt', 'utf8');
const PNG = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR42mP8z8Dwn4EIwDiqkL4KAV6SEAGNQ1mWAAAAAElFTkSuQmCC', 'base64')];
function watch(p, who) {
  p.on('console', (m) => { if (m.type() === 'error' && !/paypal\.com|sdk\/js|fonts\.g/i.test(m.text() + (m.location()?.url || ''))) errors.push(`${who}: ${m.text()} @ ${m.location()?.url}`); });
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
}
async function login(p, name) { await p.goto(base + '/#/login'); await p.click('.mp-testlogin summary'); await p.fill('#testName', name); await p.getByRole('button', { name: 'Log in', exact: true }).click(); await p.waitForFunction(() => !location.search); await p.waitForTimeout(600); }
/** fetch from inside the page (uses its session cookie) */
const call = (p, method, url, body) => p.evaluate(async ([method, url, body]) => { const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})); }, [method, url, body]);
const audit = () => {
  const w = document.documentElement.clientWidth; const bad = []; const small = [];
  const clipped = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== 'visible' || s.position === 'fixed' && a.classList.contains('mp-toasts')) return true; } return false; };
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || e.closest('#mp-sprite,[hidden]')) continue;
    const name = () => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).split(' ').slice(0, 2).join('.')}${e.id ? '#' + e.id : ''} "${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
    if ((r.right > w + 1 || r.left < -1) && !clipped(e)) bad.push(`${name()} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    if (e.matches('button, a.mp-btn, a.mp-iconbtn, select, input:not([type=hidden]):not([type=file]), textarea') && !e.disabled && (r.height < 36 || r.width < 36) && !e.closest('.mp-pp-host, .ui-win, .mo-pc__visual, .hero__art') && !e.matches('.ui-switch')) small.push(`${name()} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { sw: document.documentElement.scrollWidth, w, bad: bad.slice(0, 6), small: [...new Set(small)].slice(0, 8) };
};
(async () => {
  const b = await chromium.launch();
  const ctx = (w, h) => b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const F = await (await ctx(390, 844)).newPage(); watch(F, 'F');
  const C = await (await ctx(390, 844)).newPage(); watch(C, 'C');
  const check = async (p, who, name, { full = true } = {}) => {
    await p.waitForTimeout(450);
    for (const width of [390, 360]) {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 740 }); await p.waitForTimeout(150);
      const a = await p.evaluate(audit);
      const okay = a.sw <= a.w + 1 && !a.bad.length && !a.small.length;
      results.push(`${okay ? 'PASS' : 'FAIL'} ${who} ${name} @${width}${okay ? '' : `  scroll ${a.sw}/${a.w}${a.bad.length ? '  OUT: ' + a.bad.join(' | ') : ''}${a.small.length ? '  SMALL: ' + a.small.join(' | ') : ''}`}`);
      if (width === 390) await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${who}-${name}.png`, fullPage: full });
    }
    await p.setViewportSize({ width: 390, height: 844 });
  };
  const visit = async (p, who, name, hash, sel, opts) => { await p.goto(base + '/#' + hash); if (sel) await p.waitForSelector(sel, { timeout: 15000 }); await check(p, who, name, opts); };

  // ---- logged out
  await F.goto(base + '/welcome.html'); await F.waitForTimeout(1500); await check(F, 'out', 'welcome');
  await visit(F, 'out', 'start', '/start', '#ppLogin'); await visit(F, 'out', 'login', '/login', '#ppLogin');

  // ---- onboarding, both roles
  await login(F, 'Ploy'); await F.waitForSelector('[data-role="freelancer"]'); await check(F, 'F', 'onboard-role');
  await F.click('[data-role="freelancer"]'); await F.click('#roleContinue'); await F.waitForSelector('#displayName'); await F.fill('#displayName', 'Ploy Design Studio'); await F.getByRole('button', { name: 'Web design' }).click();
  await F.fill('#bio', 'Bangkok designer for cafés and small shops.'); await check(F, 'F', 'onboard-setup');
  await F.click('#finishSetup'); await F.waitForSelector('#doneNext'); await check(F, 'F', 'onboard-done');
  await visit(F, 'F', 'dashboard-empty', '/projects', '.mp-empty');
  await visit(F, 'F', 'new-project', '/new', '#chatText');

  // ---- build the states through the API
  const mk = async () => {
    const pid = await F.evaluate(async (chat) => { const fd = new FormData(); fd.append('chatText', chat); fd.append('freelancer_name', 'Ploy'); return (await (await fetch('/api/projects', { method: 'POST', body: fd })).json()).project.id; }, chat);
    const ex = await call(F, 'POST', `/api/projects/${pid}/extract`, {});
    return { pid, aid: ex.agreement.id, gaps: ex.agreement.body.gaps, ms: ex.milestones };
  };
  const send = async (p) => { for (const g of p.gaps) await call(F, 'POST', `/api/agreements/${p.aid}/gaps/${g.id}/fix`, {}); p.hash = (await call(F, 'POST', `/api/agreements/${p.aid}/approve`, {})).agreement.content_hash; p.invite = (await call(F, 'POST', `/api/projects/${p.pid}/invites`, {})).url; };
  const join = (p) => call(C, 'POST', `/api/invites/${p.invite.split('/').pop()}/accept`, {});
  const approve = (p) => call(C, 'POST', `/api/agreements/${p.aid}/approve`, { content_hash: p.hash });
  const fund = async (m) => { const o = await call(C, 'POST', `/api/milestones/${m.id}/order`, {}); await call(C, 'POST', `/api/milestones/${m.id}/authorize`, { order_id: o.order_id }); };
  const deliver = (m, name = 'homepage-mockup-final-version.png', bytes = PNG) => F.evaluate(async ([mid, bytes, name]) => { const fd = new FormData(); fd.append('files[]', new Blob([new Uint8Array(bytes)]), name); await fetch(`/api/milestones/${mid}/deliverables`, { method: 'POST', body: fd });
    return (await (await fetch(`/api/milestones/${mid}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).proposal.id; }, [m.id, bytes, name]);
  const pay = (prop) => call(C, 'POST', `/api/proposals/${prop}/approve`, {});

  const draft = await mk();
  const sent = await mk(); await send(sent);
  // the client arrives from the link (logged out), then onboards
  await C.goto(sent.invite); await C.waitForSelector('.mp-sender'); await check(C, 'out', 'invite-landing');
  await login(C, 'Nok'); await C.goto(sent.invite); await C.waitForSelector('#displayName'); await C.fill('#displayName', 'Baan Kafe Coffee Roasters');
  await C.getByRole('button', { name: 'Something else' }).click(); await C.fill('.mp-addtag input', 'Menu photography'); await check(C, 'C', 'onboard-setup');
  await C.click('#finishSetup'); await C.waitForSelector('#doneNext'); await check(C, 'C', 'onboard-done'); await C.click('#doneNext'); await C.waitForSelector('#approveAgreement');
  await call(C, 'POST', `/api/agreements/${sent.aid}/notes`, { text: 'Does this price include photographing the whole menu?' });
  await call(F, 'POST', `/api/agreements/${sent.aid}/notes`, { text: 'Yes, every drink on the menu.' });

  const fundable = await mk(); await send(fundable); await join(fundable); await approve(fundable);
  const review = await mk(); await send(review); await join(review); await approve(review); await fund(review.ms[0]); await deliver(review.ms[0]);
  const revise = await mk(); await send(revise); await join(revise); await approve(revise); await fund(revise.ms[0]); await deliver(revise.ms[0]);
  await call(C, 'POST', `/api/milestones/${revise.ms[0].id}/revision`, { note: 'Please make the menu photos brighter and use our green from the logo on the buttons.' });
  await call(F, 'POST', `/api/projects/${revise.pid}/chat`, { text: 'Sure. All of the photos, or just the drinks? I can have it back to you tomorrow.' });
  const paid1 = await mk(); await send(paid1); await join(paid1); await approve(paid1); await fund(paid1.ms[0]); await pay(await deliver(paid1.ms[0]));
  await call(C, 'POST', `/api/projects/${paid1.pid}/change-requests`, { message: 'Can you add an online ordering page with a basket and a checkout?' });
  const quoted = await mk(); await send(quoted); await join(quoted); await approve(quoted);
  const cr = (await call(C, 'POST', `/api/projects/${quoted.pid}/change-requests`, { message: 'Please add a loyalty card page.' })).change_request; await call(F, 'POST', `/api/change-requests/${cr.id}/send`, {});
  const done = await mk(); await send(done); await join(done); await approve(done);
  for (const [i, m] of done.ms.entries()) { await fund(m); await pay(await deliver(m, i === 1 ? 'site-export.zip' : 'page.png', i === 1 ? [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0] : PNG)); }
  const old = (await call(C, 'POST', `/api/projects/${done.pid}/change-requests`, { message: 'Add a blog section please.' })).change_request;
  await call(F, 'POST', `/api/change-requests/${old.id}/send`, {}); await call(C, 'POST', `/api/change-requests/${old.id}/decide`, { accept: false });
  await call(F, 'POST', `/api/projects/${draft.pid}/archive`, { archived: false });
  const gone = await mk(); await call(F, 'DELETE', `/api/projects/${gone.pid}`); const arch = await mk(); await call(F, 'POST', `/api/projects/${arch.pid}/archive`, { archived: true });

  // ---- freelancer
  await visit(F, 'F', 'dashboard', '/projects', '.mp-jobrow');
  await F.click('#archived summary'); await check(F, 'F', 'dashboard-archived-open');
  await F.locator('.mp-jobrow [data-action="delete"]').first().click(); await F.waitForSelector('.mp-dialog'); await check(F, 'F', 'dialog-delete', { full: false }); await F.keyboard.press('Escape');
  await F.click('#avatarBtn'); await F.waitForSelector('.mp-menu'); await check(F, 'F', 'account-menu', { full: false }); await F.click('#avatarBtn');
  await visit(F, 'F', 'agreement-draft', `/p/${draft.pid}`, '.mp-terms');
  await F.click('#renameProject'); await F.waitForSelector('#projectTitle'); await check(F, 'F', 'agreement-rename', { full: false }); await F.keyboard.press('Escape');
  await visit(F, 'F', 'agreement-sent', `/p/${sent.pid}`, '#inviteUrl');
  await visit(F, 'F', 'project-waiting-funding', `/p/${fundable.pid}`, '#milestones');
  await visit(F, 'F', 'milestone-not-funded', `/p/${fundable.pid}/m/${fundable.ms[0].id}`, '.mp-strip');
  await visit(F, 'F', 'project-delivered', `/p/${review.pid}`, '#milestones');
  await visit(F, 'F', 'milestone-delivered', `/p/${review.pid}/m/${review.ms[0].id}`, '.mp-strip');
  await visit(F, 'F', 'project-revision-chat', `/p/${revise.pid}`, '#chat');
  await visit(F, 'F', 'milestone-revising', `/p/${revise.pid}/m/${revise.ms[0].id}`, '#markDelivered');
  await visit(F, 'F', 'project-one-paid', `/p/${paid1.pid}`, '[data-invoice]');
  await F.click('[data-profile="client"]'); await F.waitForSelector('.mp-dialog #profileName'); await check(F, 'F', 'dialog-profile', { full: false }); await F.getByRole('button', { name: 'Close' }).click();
  await visit(F, 'F', 'changes-open-draft', `/p/${paid1.pid}/changes`, '#sendQuote');
  await visit(F, 'F', 'changes-quote-sent', `/p/${quoted.pid}/changes`, 'text=Waiting for');
  await visit(F, 'F', 'changes-idle', `/p/${done.pid}/changes`, '#scopeOpen');
  await F.click('#scopeOpen'); await F.waitForSelector('#scopeBox'); await check(F, 'F', 'changes-corner-open', { full: false });
  await visit(F, 'F', 'project-fully-paid', `/p/${done.pid}`, '#nextSlim');
  await F.click('#timelineToggle'); await F.waitForSelector('#timeline'); await F.click('[data-files="M2"]'); await check(F, 'F', 'project-fully-paid-expanded');
  await visit(F, 'F', 'agreement-approved', `/p/${done.pid}/agreement`, '.mp-terms');
  await visit(F, 'F', 'activity', `/p/${done.pid}/activity`, '.mp-event');
  await visit(F, 'F', 'settings', '/settings', '#set-deleted [data-action="restore"]');
  await F.click('#deleteAccount'); await F.waitForSelector('.mp-dialog'); await check(F, 'F', 'dialog-delete-account', { full: false }); await F.keyboard.press('Escape');
  const inv = (await call(F, 'GET', `/api/projects/${done.pid}`)).milestones[0].invoice.url;
  await F.goto(base + inv); await F.waitForSelector('h1'); await check(F, 'F', 'invoice');

  // ---- client
  await visit(C, 'C', 'hired-projects', '/jobs', '.mp-jobrow');
  await visit(C, 'C', 'approve-agreement', `/p/${sent.pid}`, '#approveAgreement');
  await C.click('#approveAgreement'); await C.waitForSelector('.mp-dialog'); await check(C, 'C', 'dialog-approve', { full: false }); await C.keyboard.press('Escape');
  await visit(C, 'C', 'payments-fund', `/p/${fundable.pid}`, '.mp-paypage');
  await visit(C, 'C', 'payments-delivered', `/p/${review.pid}`, '.mp-paypage');
  await visit(C, 'C', 'review-and-pay', `/p/${review.pid}/m/${review.ms[0].id}`, '#payBtn');
  await C.waitForFunction(() => !document.querySelector('#payBtn').disabled, null, { timeout: 8000 }); await C.click('#payBtn'); await C.waitForSelector('.mp-dialog'); await check(C, 'C', 'dialog-pay', { full: false }); await C.keyboard.press('Escape');
  await visit(C, 'C', 'request-revision', `/p/${review.pid}/m/${review.ms[0].id}/changes`, '#revNote');
  await visit(C, 'C', 'payments-revision-chat', `/p/${revise.pid}`, '#chat');
  await visit(C, 'C', 'milestone-revising', `/p/${revise.pid}/m/${revise.ms[0].id}`, '#chat');
  await visit(C, 'C', 'payments-one-paid-request-open', `/p/${paid1.pid}`, '[data-invoice]');
  await visit(C, 'C', 'requests-open', `/p/${paid1.pid}/change`, '#openRequest');
  await visit(C, 'C', 'payments-quote', `/p/${quoted.pid}`, 'text=Not in agreement');
  await visit(C, 'C', 'requests-new-with-history', `/p/${done.pid}/change`, '#requestHistory .mp-reqitem');
  await visit(C, 'C', 'payments-fully-paid', `/p/${done.pid}`, '.mp-paypage');
  await visit(C, 'C', 'project-fully-paid', `/p/${done.pid}/project`, '#nextSlim');
  await visit(C, 'C', 'project-in-progress', `/p/${revise.pid}/project`, '#milestones');
  await C.click('[data-profile="freelancer"]'); await C.waitForSelector('.mp-dialog #profileName'); await check(C, 'C', 'dialog-profile', { full: false }); await C.getByRole('button', { name: 'Close' }).click();
  await visit(C, 'C', 'paid-milestone', `/p/${done.pid}/m/${done.ms[0].id}`, '[data-invoice]');
  await visit(C, 'C', 'settings', '/settings', '#set-deleted');
  await C.click('#logoutBtn'); await C.waitForSelector('text=You’re logged out'); await check(C, 'out', 'logged-out');

  fs.writeFileSync(out + '/results.txt', results.join('\n'));
  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n')); console.log(`${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed`); console.log('ERRORS', JSON.stringify(errors, null, 1));
  await b.close();
  if (errors.length || results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})().catch(async (e) => { console.log(results.filter((r) => r.startsWith('FAIL')).join('\n')); console.error('STOPPED after', results.length, 'checks:', e.message.split('\n').slice(0, 3).join(' | ')); console.log('ERRORS', JSON.stringify(errors, null, 1)); process.exit(1); });
