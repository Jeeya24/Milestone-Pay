// Browser click-through of the design-system journey (boards O1–O5, 01–10) as two people: Ploy (freelancer, desktop)
// and Nok (client, phone 390px, joins from the agreement link). Fails on any console error.
// Start a fresh stub server (no PayPal or Gemini calls):
//   DATABASE_URL= DB_PATH=/tmp/mp/db.json UPLOAD_DIR=/tmp/mp/up TEST_AUTH=1 RATE_LIMITS=off PORT=3056 PAYPAL_CLIENT_ID=test node tests/qa/serve-stub.mjs
// Run:  node tests/qa/journey-ui.cjs <screenshot-dir> "$PWD" [base=http://localhost:3056]
// Funding goes through the order/authorize endpoints directly, because the PayPal SDK can't load offline.
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2], repo = process.argv[3], base = process.argv[4] || 'http://localhost:3056';
fs.mkdirSync(out, { recursive: true });
const errors = [], results = [];
const ok = (name, c) => { results.push(`${c ? 'PASS' : 'FAIL'} ${name}`); };
let n = 0;
async function shot(p, name) { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); }
function watch(p, who) {
  p.on('console', (m) => { if (m.type() === 'error' && !/paypal\.com|sdk\/js|fonts\.g/i.test(m.text() + (m.location()?.url || ''))) errors.push(`${who}: ${m.text()} @ ${m.location()?.url}`); });
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
}
const btn = (p, t) => p.getByRole('button', { name: t }).or(p.getByRole('link', { name: t })).first();
async function login(p, name) { await p.click('.mp-testlogin summary'); await p.fill('#testName', name); await p.getByRole('button', { name: 'Log in', exact: true }).click(); }
const txt = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  const b = await chromium.launch();
  const F = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); watch(F, 'F');
  await F.goto(base + '/#/login'); await login(F, 'Ploy');
  await F.waitForSelector('[data-role="freelancer"]'); await F.click('[data-role="freelancer"]'); await F.click('#roleContinue');
  await F.waitForSelector('#displayName'); await F.fill('#displayName', 'Ploy Design'); await F.getByRole('button', { name: 'Web design' }).click(); await F.click('#finishSetup');
  await F.waitForSelector('#doneNext'); await F.click('#doneNext');
  // 02 paste chat → extract (stubbed)
  await F.waitForSelector('#chatText'); await F.fill('#chatText', fs.readFileSync(repo + '/fixtures/baan-kafe.txt', 'utf8'));
  await F.setInputFiles('input[type=file]', { name: 'voice-note.m4a', mimeType: 'audio/mp4', buffer: Buffer.from('x') });
  ok('02 rejected file shown inline', (await txt(F)).includes('voice-note.m4a'));
  await shot(F, 'paste-chat-error');
  await F.click('#generate'); await F.waitForSelector('.mp-terms', { timeout: 20000 });
  const pid = F.url().match(/#\/p\/([\w-]+)/)[1];
  ok('03 review shows approve disabled with gaps', await F.isDisabled('#approveSend'));
  for (let i = 0; i < 6; i++) { const g = F.locator('.mp-gap .mp-btn--secondary').first(); if (!(await g.count())) break; await g.click(); await F.waitForTimeout(300); }
  await F.click('#approveSend'); await F.getByRole('button', { name: /Lock and send/ }).click();
  await F.waitForSelector('#inviteUrl'); const invite = await F.inputValue('#inviteUrl');
  ok('03 invite link created', /\/invite\//.test(invite)); await shot(F, 'sent-invite');
  // client (phone) via link
  const Cx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const C = await Cx.newPage(); watch(C, 'C');
  await C.goto(invite); await C.waitForSelector('.mp-sender'); ok('O2 link banner names sender', (await txt(C)).includes('Ploy Design sent you an agreement')); await shot(C, 'client-link');
  await login(C, 'Nok'); await C.waitForSelector('#displayName'); ok('O4b client setup after link', (await txt(C)).includes('Who’s hiring?'));
  await C.fill('#displayName', ''); await C.click('#finishSetup'); ok('O4b name error', (await txt(C)).includes('Add a name freelancers will see')); 
  await C.fill('#displayName', 'Baan Kafe'); await shot(C, 'client-setup'); await C.click('#finishSetup');
  await C.waitForSelector('#doneNext'); ok('O5 review the agreement', (await txt(C)).includes('Review the agreement')); await shot(C, 'client-done');
  await C.click('#doneNext'); await C.waitForSelector('#approveAgreement'); await shot(C, 'client-approve');
  // note to freelancer
  await btn(C, /Something’s wrong/).click(); await C.fill('#noteText', 'Does this include menu photos?'); await C.getByRole('button', { name: 'Send note' }).click();
  await C.waitForSelector('text=Note sent to'); 
  await F.waitForSelector('text=Does this include menu photos?', { timeout: 8000 }); ok('03 freelancer sees client note', true);
  await F.fill('#noteReply', 'Yes, all drinks.'); await btn(F, /Reply to/).click(); await F.waitForTimeout(500); await shot(F, 'note-reply');
  await C.waitForSelector('text=Yes, all drinks.', { timeout: 8000 }); ok('04 client sees reply', true);
  await C.click('#approveAgreement'); await C.getByRole('button', { name: 'Approve agreement' }).last().click();
  await C.waitForSelector('text=Payments'); ok('05 payments after approve', (await txt(C)).includes('Agreement approved by you and')); await shot(C, 'client-payments');
  // fund via API (PayPal SDK can't load offline)
  const m1 = await C.evaluate(async (pid) => { const d = await (await fetch('/api/projects/' + pid)).json(); const m = d.milestones[0];
    const h = { 'content-type': 'application/json' };
    const o = await (await fetch(`/api/milestones/${m.id}/order`, { method: 'POST', headers: h, body: '{}' })).json();
    await fetch(`/api/milestones/${m.id}/authorize`, { method: 'POST', headers: h, body: JSON.stringify({ order_id: o.order_id }) }); return m.id; }, pid);
  await C.reload(); await C.waitForSelector('text=Milestone Pay is holding this'); await shot(C, 'client-funded');
  // freelancer: project page → milestone page → upload → deliver
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('text=Payment history'); await shot(F, 'project-page');
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('#markDelivered');
  await F.setInputFiles('#fileIn', [{ name: 'mockup-home.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) }]);
  await F.waitForSelector('text=mockup-home.png'); await shot(F, 'submit-work');
  await F.click('#markDelivered'); await F.waitForSelector('text=Waiting for Baan Kafe to review', { timeout: 8000 });
  // client: review → pay
  await C.goto(`${base}/#/p/${pid}`); await C.waitForSelector('text=Review M1'); await btn(C, 'Review M1').click();
  await C.waitForSelector('#payBtn'); await C.waitForFunction(() => !document.querySelector('#payBtn').disabled, null, { timeout: 8000 }); await shot(C, 'client-review');
  await C.click('#payBtn'); await C.waitForSelector('.mp-dialog'); await shot(C, 'client-pay-confirm');
  await C.locator('.mp-dialog .mp-btn--primary').click(); await C.waitForSelector('text=paid to Ploy Design for M1', { timeout: 8000 }); ok('07 paid banner', true); await shot(C, 'client-paid');
  // client: request a change
  await btn(C, 'Request a change').click(); await C.fill('#crText', 'Can you add an online ordering page?'); await btn(C, /Send to/).click();
  await C.waitForSelector('text=Request sent to'); 
  await F.goto(`${base}/#/p/${pid}/changes`); await F.waitForSelector('#sendQuote'); await shot(F, 'changes');
  await F.click('#sendQuote'); await F.waitForSelector('text=Waiting for Baan Kafe to accept');
  await C.reload(); await C.waitForSelector('text=Not in agreement'); await btn(C, /^Accept/).click(); await C.waitForSelector('.mp-dialog'); await shot(C, 'client-accept-confirm');
  await C.locator('.mp-dialog .mp-btn--primary').click(); await C.waitForSelector('text=M4 added'); ok('08 M4 added', true);
  // jobs dashboard + settings + logout
  await C.goto(`${base}/#/jobs`); await C.waitForSelector('h1:has-text("Hired projects")'); await shot(C, 'client-jobs');
  await F.goto(`${base}/#/projects`); await F.waitForSelector('.mp-jobrow'); await shot(F, 'freelancer-dashboard');
  await F.goto(`${base}/#/p/${pid}/project`); await F.waitForSelector('text=Payment history'); await shot(F, 'project-page-2');
  await F.goto(`${base}/#/p/${pid}/activity`); await F.waitForSelector('text=Activity'); await shot(F, 'activity');
  await F.goto(`${base}/#/settings`); await F.waitForSelector('#saveProfile'); await F.click('#avatarBtn'); await shot(F, 'settings-menu');
  await F.keyboard.press('Escape'); await F.click('#logoutBtn'); await F.waitForSelector('text=You’re logged out'); ok('10 logout', true);
  fs.writeFileSync(out + '/results.txt', results.join('\n'));
  console.log(results.join('\n')); console.log('ERRORS', JSON.stringify(errors, null, 1));
  await b.close();
  if (errors.length || results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})().catch(async (e) => { console.log(results.join('\n')); console.error('FAILED', e.message.split('\n')[0]); console.log('ERRORS', JSON.stringify(errors, null, 1)); process.exit(1); });
