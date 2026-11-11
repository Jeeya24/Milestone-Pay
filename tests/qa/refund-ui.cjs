// Browser click-through of the hold and refund rule as two people: Ploy (freelancer, desktop) and Nok (client, phone).
// A funded milestone shows no expiry date; the client can only ask for a refund; the money goes back only when the
// freelancer accepts. Fails on any console error.
// Start a fresh stub server (no PayPal or Gemini calls):
//   DATABASE_URL= DB_PATH=/tmp/mp/db.json UPLOAD_DIR=/tmp/mp/up TEST_AUTH=1 RATE_LIMITS=off PORT=3056 PAYPAL_CLIENT_ID=test node tests/qa/serve-stub.mjs
// Run:  node tests/qa/refund-ui.cjs <screenshot-dir> "$PWD" [base=http://localhost:3056]
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
  await F.click('#generate'); await F.waitForSelector('.mp-terms', { timeout: 20000 });
  const pid = F.url().match(/#\/p\/([\w-]+)/)[1];
  for (let i = 0; i < 6; i++) { const g = F.locator('.mp-gap .mp-btn--secondary').first(); if (!(await g.count())) break; await g.click(); await F.waitForTimeout(300); }
  await F.click('#approveSend'); await F.getByRole('button', { name: /Lock and send/ }).click();
  await F.waitForSelector('#inviteUrl'); const invite = await F.inputValue('#inviteUrl');
  const Cx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const C = await Cx.newPage(); watch(C, 'C');
  await C.goto(invite); await C.waitForSelector('.mp-sender'); await login(C, 'Nok');
  await C.waitForSelector('#displayName'); await C.fill('#displayName', 'Baan Kafe'); await C.click('#finishSetup');
  await C.waitForSelector('#doneNext'); await C.click('#doneNext'); await C.waitForSelector('#approveAgreement');
  await C.click('#approveAgreement'); await C.getByRole('button', { name: 'Approve agreement' }).last().click();
  await C.waitForSelector('text=Payments');
  ok('fund note says the client is charged now', (await txt(C)).includes('You’re charged now'));
  // fund via API (PayPal SDK can't load offline)
  const m1 = await C.evaluate(async (pid) => { const d = await (await fetch('/api/projects/' + pid)).json(); const m = d.milestones[0];
    const h = { 'content-type': 'application/json' };
    const o = await (await fetch(`/api/milestones/${m.id}/order`, { method: 'POST', headers: h, body: '{}' })).json();
    await fetch(`/api/milestones/${m.id}/authorize`, { method: 'POST', headers: h, body: JSON.stringify({ order_id: o.order_id }) }); return m.id; }, pid);
  await C.reload(); await C.waitForSelector('text=Milestone Pay is holding this'); await shot(C, 'client-funded');
  let t = await txt(C);
  ok('funded card: held, with no expiry date', t.includes('Milestone Pay is holding this until you approve the work.') && !/Held until|hold ends|not charged yet/i.test(t));
  // client asks for a refund: nothing moves
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.waitForSelector('#refundAsk'); await shot(C, 'client-milestone');
  ok('client has no cancel button, only "Ask for a refund"', !/Cancel M1/.test(await txt(C)));
  await C.click('#refundAsk'); await C.waitForSelector('.mp-dialog'); await shot(C, 'client-refund-confirm');
  ok('dialog says the money stays held until the freelancer accepts', (await txt(C)).includes('Until Ploy Design accepts, the money stays held by Milestone Pay.'));
  await C.locator('.mp-dialog .mp-btn--primary').click(); await C.waitForSelector('text=Refund request sent to Ploy Design'); await shot(C, 'client-refund-asked');
  t = await txt(C);
  ok('client: request pending, money still held', t.includes('You asked for a refund. Waiting for Ploy Design to answer.') && t.includes('Held by Milestone Pay'));
  // freelancer declines
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('text=Baan Kafe asked for a refund of M1'); await shot(F, 'freelancer-project-refund-asked');
  await btn(F, 'Answer the request').click(); await F.waitForSelector('#refundDecline'); await shot(F, 'freelancer-refund-request');
  await F.click('#refundDecline'); await F.waitForSelector('#refundBox', { state: 'detached', timeout: 8000 });
  ok('freelancer declined: money still held', (await txt(F)).includes('held by Milestone Pay'));
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.reload(); await C.waitForSelector('text=declined your refund request'); await shot(C, 'client-refund-declined');
  ok('client sees the decline and can ask again', await C.locator('#refundAsk').count() === 1);
  // client asks again, then withdraws, then asks a third time
  await C.click('#refundAsk'); await C.locator('.mp-dialog .mp-btn--primary').click(); await C.waitForSelector('text=Refund request sent to Ploy Design');
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.reload(); await C.waitForSelector('#refundWithdraw'); await shot(C, 'client-refund-pending');
  await C.click('#refundWithdraw'); await C.waitForSelector('#refundAsk'); ok('client withdrew the request', true);
  await C.click('#refundAsk'); await C.locator('.mp-dialog .mp-btn--primary').click(); await C.waitForSelector('text=Refund request sent to Ploy Design');
  // freelancer accepts: refunded and cancelled
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('#refundAccept'); await F.click('#refundAccept');
  await F.waitForSelector('.mp-dialog'); await shot(F, 'freelancer-refund-confirm');
  await F.locator('.mp-dialog .mp-btn--danger').click(); await F.waitForSelector('text=M1 was cancelled.', { timeout: 8000 }); await shot(F, 'freelancer-refunded');
  ok('freelancer: cancelled, money went back to the client', (await txt(F)).includes('went back to Baan Kafe'));
  await F.goto(`${base}/#/p/${pid}/project`); await F.waitForSelector('text=Payment history'); await shot(F, 'freelancer-project-refunded');
  t = await txt(F);
  ok('history: held, then refunded; never "not charged"', t.includes('Held by Milestone Pay') && t.includes('Refunded to the client') && !/not charged|wasn’t charged/i.test(t));
  await C.goto(`${base}/#/p/${pid}`); await C.waitForSelector('text=Cancelled · refunded'); await shot(C, 'client-refunded');
  t = await txt(C);
  ok('client: cancelled and refunded, never "not charged"', t.includes('was refunded to your PayPal') && !/not charged|weren’t charged/i.test(t));
  fs.writeFileSync(out + '/results.txt', results.join('\n'));
  console.log(results.join('\n')); console.log('ERRORS', JSON.stringify(errors, null, 1));
  await b.close();
  if (errors.length || results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})().catch(async (e) => { console.log(results.join('\n')); console.error('FAILED', e.message.split('\n')[0]); console.log('ERRORS', JSON.stringify(errors, null, 1)); process.exit(1); });
