// Browser click-through of the 2026-11-10 fix list (17 items) as Ploy (freelancer), Nok (client) and Sam (leaves).
// Fails on any console error. Start a fresh stub server first (see journey-ui.cjs), then:
//   node tests/qa/fixes-ui.cjs <screenshot-dir> "$PWD" [base=http://localhost:3056]
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2], repo = process.argv[3], base = process.argv[4] || 'http://localhost:3056';
fs.mkdirSync(out, { recursive: true });
const errors = [], results = [];
const ok = (name, c) => { results.push(`${c ? 'PASS' : 'FAIL'} ${name}`); };
let n = 0;
async function shot(p, name, full = true) { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); }
function watch(p, who) {
  p.on('console', (m) => { if (m.type() === 'error' && !/paypal\.com|sdk\/js|fonts\.g/i.test(m.text() + (m.location()?.url || ''))) errors.push(`${who}: ${m.text()} @ ${m.location()?.url}`); });
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
}
const btn = (p, t) => p.getByRole('button', { name: t }).or(p.getByRole('link', { name: t })).first();
async function login(p, name) { await p.click('.mp-testlogin summary'); await p.fill('#testName', name); await p.getByRole('button', { name: 'Log in', exact: true }).click(); }
const txt = (p) => p.evaluate(() => document.body.innerText);
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR42mP8z8Dwn4EIwDiqkL4KAV6SEAGNQ1mWAAAAAElFTkSuQmCC', 'base64');
const overflows = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
(async () => {
  const b = await chromium.launch();
  const F = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); watch(F, 'F');
  await F.goto(base + '/#/login'); await login(F, 'Ploy');
  await F.waitForSelector('[data-role="freelancer"]'); await F.click('[data-role="freelancer"]'); await F.click('#roleContinue');
  await F.waitForSelector('#displayName'); await F.fill('#displayName', 'Ploy Design'); await F.getByRole('button', { name: 'Web design' }).click();
  await F.fill('#bio', 'Bangkok designer for cafés.'); await F.click('#finishSetup');
  await F.waitForSelector('#doneNext'); await F.click('#doneNext');

  // 4/5: reading copy. Hold the extract call so the reading screen can be read.
  await F.waitForSelector('#chatText'); await F.fill('#chatText', fs.readFileSync(repo + '/fixtures/baan-kafe.txt', 'utf8'));
  let release; const held = new Promise((r) => { release = r; });
  await F.route('**/extract', async (route) => { await held; route.continue(); });
  await F.click('#generate'); await F.waitForSelector('.mp-reading');
  const reading = await txt(F);
  ok('04 reading copy says "This will take about 10 to 20 seconds"', reading.includes('This will take about 10 to 20 seconds.'));
  ok('04 "You can stay on this page" is gone', !reading.includes('You can stay on this page'));
  await shot(F, 'reading');
  release(); await F.waitForSelector('.mp-terms', { timeout: 20000 }); await F.unroute('**/extract');
  const pid = F.url().match(/#\/p\/([\w-]+)/)[1];

  // 6: no "Freelancer view" chip
  ok('06 no "Freelancer view" chip', !(await F.$('#roleChip')) && !(await txt(F)).includes('Freelancer view'));

  // 7: gaps card. A long fix label must stay inside the card.
  await F.evaluate(() => { const b = document.querySelector('.mp-gap .mp-btn'); if (b) b.lastChild.textContent = 'Add: Freelancer to provide a style guide or mood board for approval before full development starts on any page.'; });
  const inside = await F.evaluate(() => { const b = document.querySelector('.mp-gap .mp-btn'); const c = b.closest('.mp-card'); return b.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5; });
  ok('07 long gap button stays inside its card', inside);
  await shot(F, 'agreement-draft');

  // 8: rename the project
  await F.click('#renameProject'); await F.fill('#projectTitle', 'Baan Kafe site 2026'); await F.keyboard.press('Enter');
  await F.waitForSelector('h1:has-text("Baan Kafe site 2026")'); ok('08 freelancer renamed the project', true);

  // 16: edit a milestone's AI title and description
  const firstTitle = F.locator('.mp-ms--draft input[id^="msTitle-"]').first();
  await firstTitle.fill('Homepage and menu design'); await firstTitle.blur();
  const firstDesc = F.locator('.mp-ms--draft textarea').first();
  await firstDesc.fill('Figma mockups for 3 pages\nMenu layout with photos'); await firstDesc.blur();
  await F.waitForFunction(() => [...document.querySelectorAll('.mp-ms--draft .mp-label-row span')].some((x) => x.textContent === 'Saved'));
  // 15: more than three milestones
  await F.click('#addMilestone'); await F.waitForFunction(() => document.querySelectorAll('.mp-ms--draft').length === 4);
  const t4 = F.locator('.mp-ms--draft input[id^="msTitle-"]').nth(3);
  await t4.fill('Handover and training'); await t4.blur();
  await F.click('#addMilestone'); await F.waitForFunction(() => document.querySelectorAll('.mp-ms--draft').length === 5);
  ok('15 five milestones on the draft', (await txt(F)).includes('Milestones · 5'));
  await F.getByRole('button', { name: 'Remove M5' }).click(); await F.getByRole('button', { name: 'Remove M5' }).last().click();
  await F.waitForFunction(() => document.querySelectorAll('.mp-ms--draft').length === 4);
  // move 100.00 from M2 to the new M4 so the parts still add up to the agreed total
  const amts = F.locator('.mp-ms--draft .mp-input--amount');
  const m2 = Number(await amts.nth(1).inputValue());
  await amts.nth(1).fill(String(m2 - 100)); await amts.nth(1).blur(); await F.waitForTimeout(300);
  await amts.nth(3).fill('100'); await amts.nth(3).blur(); await F.waitForTimeout(400);
  await shot(F, 'agreement-edited');
  for (let i = 0; i < 6; i++) { const g = F.locator('.mp-gap .mp-btn--secondary').first(); if (!(await g.count())) break; await g.click(); await F.waitForTimeout(300); }
  await F.reload(); await F.waitForSelector('.mp-terms');
  ok('16 edited title and description were saved', (await firstTitle.inputValue()) === 'Homepage and menu design' && (await firstDesc.inputValue()).includes('Menu layout with photos'));
  ok('15 fourth milestone kept after reload', (await F.locator('.mp-ms--draft').count()) === 4);
  await F.click('#approveSend'); await F.getByRole('button', { name: /Lock and send/ }).click();

  // 9: no SHA-256 fingerprint on screen. 10: the link is there to copy.
  await F.waitForSelector('#inviteUrl'); const invite = await F.inputValue('#inviteUrl');
  ok('09 no sha256 fingerprint shown', !/sha256/i.test(await txt(F)) && !(await F.content()).includes('sha256:'));
  ok('10 link shown after sending', /\/invite\//.test(invite)); await shot(F, 'sent-invite');

  // client joins on a desktop. 2: "Something else" opens a box to type in.
  const C = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); watch(C, 'C');
  await C.goto(invite); await C.waitForSelector('.mp-sender'); await login(C, 'Nok');
  await C.waitForSelector('#displayName'); await C.fill('#displayName', 'Baan Kafe');
  ok('02 no box before "Something else" is picked', !(await C.locator('.mp-addtag').isVisible()));
  await C.getByRole('button', { name: 'Something else' }).click();
  await C.fill('.mp-addtag input', 'Menu photography'); await shot(C, 'client-setup-something-else');
  await C.click('#finishSetup');
  await C.waitForSelector('#doneNext'); await C.click('#doneNext'); await C.waitForSelector('#approveAgreement');
  ok('16 client sees the edited milestone', (await txt(C)).includes('Homepage and menu design'));
  await C.click('#approveAgreement'); await C.getByRole('button', { name: 'Approve agreement' }).last().click();
  await C.waitForSelector('.mp-paypage');

  // 13: desktop payments layout: two columns, wide.
  const lay = await C.evaluate(() => { const m = document.querySelector('.mp-paypage__main').getBoundingClientRect(); const s = document.querySelector('.mp-paypage__side').getBoundingClientRect(); return { mw: m.width, sideRight: s.left >= m.right, top: Math.abs(s.top - m.top) < 4 }; });
  ok('13 payments is two columns on desktop', lay.sideRight && lay.top && lay.mw >= 600);
  ok('12 says "Held by Milestone Pay", not PayPal', (await txt(C)).includes('Held by Milestone Pay') && !/held by paypal|paypal holds|paypal is holding/i.test(await txt(C)));
  ok('06 no "Client view" chip', !(await C.$('#roleChip')) && !(await txt(C)).includes('Client view'));
  await shot(C, 'client-payments-desktop');

  // 10: the same link again after the client joined, and it still opens for the client.
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('#inviteUrl');
  ok('10 same link on the project page after approval', (await F.inputValue('#inviteUrl')) === invite);
  await C.goto(invite); await C.waitForSelector('.mp-paypage'); await C.goto(invite); await C.waitForSelector('.mp-paypage');
  ok('10 the client opened the link twice more', C.url().includes(`/p/${pid}`));

  // fund M1 through the API (the PayPal SDK can't load offline), deliver, then ask for a revision
  const fund = (i) => C.evaluate(async ([pid, i]) => { const d = await (await fetch('/api/projects/' + pid)).json(); const m = d.milestones[i]; const h = { 'content-type': 'application/json' };
    const o = await (await fetch(`/api/milestones/${m.id}/order`, { method: 'POST', headers: h, body: '{}' })).json();
    await fetch(`/api/milestones/${m.id}/authorize`, { method: 'POST', headers: h, body: JSON.stringify({ order_id: o.order_id }) }); return m.id; }, [pid, i]);
  const m1 = await fund(0);
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('#markDelivered');
  ok('11 no chat before a revision is requested', !(await F.$('#chat')));
  await F.setInputFiles('#fileIn', [{ name: 'mockup-home.png', mimeType: 'image/png', buffer: PNG1 }]);
  await F.waitForSelector('text=mockup-home.png'); await F.click('#markDelivered'); await F.waitForSelector('text=Waiting for Baan Kafe to review', { timeout: 8000 });
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.waitForSelector('#payBtn');
  await btn(C, /Request changes/).click(); await C.fill('#revNote', 'Please make the menu photos brighter.'); await btn(C, /Send to/).click();
  await C.waitForSelector('#chat'); ok('11 chat opens for the client with their request in it', (await C.locator('#projectChat').innerText()).includes('Please make the menu photos brighter.'));

  // 11: both sides write in the chat on the project page
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('#chat');
  ok('11 freelancer sees the chat on the project page', (await F.locator('#projectChat').innerText()).includes('Asked for changes on M1'));
  await F.fill('#chatInput', 'Sure. All of them, or just the drinks?'); await F.click('#chatSend');
  await F.waitForSelector('#projectChat >> text=Sure. All of them, or just the drinks?');
  await C.waitForSelector('#projectChat >> text=Sure. All of them, or just the drinks?', { timeout: 8000 }); ok('11 client gets the reply without reloading', true);
  await C.fill('#chatInput', 'Just the drinks, thanks!'); await C.click('#chatSend');
  await F.waitForSelector('#projectChat >> text=Just the drinks, thanks!', { timeout: 8000 }); ok('11 freelancer gets the answer without reloading', true);
  await shot(F, 'project-page-chat'); await shot(C, 'client-payments-chat');

  // 17: profile pictures and profiles
  await F.goto(`${base}/#/settings`); await F.waitForSelector('#avatarChoose');
  await F.setInputFiles('#avatarFile', { name: 'me.png', mimeType: 'image/png', buffer: PNG1 });
  await F.waitForSelector('.mp-avatarfield .mp-avatar--img img'); ok('17 freelancer uploaded a profile picture', !!(await F.$('#avatarBtn img')));
  await shot(F, 'settings-freelancer');
  await C.goto(`${base}/#/p/${pid}`); await C.waitForSelector('[data-profile="freelancer"] img'); await C.click('[data-profile="freelancer"]');
  await C.waitForSelector('.mp-dialog #profileName');
  const prof = await C.locator('.mp-dialog').innerText();
  ok('17 client sees the freelancer’s bio, skills and picture', prof.includes('Ploy Design') && prof.includes('Bangkok designer for cafés.') && prof.includes('Web design') && !!(await C.$('.mp-dialog .mp-avatar--img img')));
  ok('17 the profile shows no email', !/@/.test(prof));
  await shot(C, 'client-views-freelancer-profile', false); await C.getByRole('button', { name: 'Close' }).click();
  await C.goto(`${base}/#/settings`); await C.waitForSelector('#setBio'); await C.fill('#setBio', 'A small café in Ari.'); await C.click('#saveProfile'); await C.waitForSelector('text=Details saved');
  await C.setInputFiles('#avatarFile', { name: 'cafe.png', mimeType: 'image/png', buffer: PNG1 }); await C.waitForSelector('.mp-avatarfield .mp-avatar--img img');
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('[data-profile="client"] img'); await F.click('[data-profile="client"]'); await F.waitForSelector('.mp-dialog #profileName');
  const cprof = await F.locator('.mp-dialog').innerText();
  ok('17 freelancer sees the client’s profile', cprof.includes('Baan Kafe') && cprof.includes('A small café in Ari.') && cprof.includes('Business'));
  ok('02 the typed "something else" was saved', cprof.includes('Menu photography') && !cprof.includes('Something else'));
  await shot(F, 'freelancer-views-client-profile', false); await F.getByRole('button', { name: 'Close' }).click();

  // deliver the revision, client pays. 14: the payment is sent on to the freelancer's PayPal.
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('#markDelivered');
  await F.setInputFiles('#fileIn', [{ name: 'mockup-home-v2.png', mimeType: 'image/png', buffer: PNG1 }]);
  await F.waitForSelector('text=mockup-home-v2.png'); await F.click('#markDelivered'); await F.waitForSelector('text=Waiting for Baan Kafe to review', { timeout: 8000 });
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.waitForSelector('#payBtn'); await C.waitForFunction(() => !document.querySelector('#payBtn').disabled, null, { timeout: 8000 });
  await C.click('#payBtn'); await C.waitForSelector('.mp-dialog'); await C.locator('.mp-dialog .mp-btn--primary').click();
  await C.waitForSelector('text=paid to Ploy Design for M1', { timeout: 8000 });
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('text=Payment history');
  const hist = await txt(F);
  ok('14 history shows the payout to the freelancer’s PayPal', hist.includes('Sent to Ploy Design’s PayPal') && hist.includes('STUBPAYOUT-'));
  ok('12 history says held by Milestone Pay', hist.includes('Held by Milestone Pay') && !/held by paypal/i.test(hist));
  await shot(F, 'project-page-paid');
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('text=sent to your PayPal'); ok('14 milestone page says it was sent to your PayPal', true);

  // invoice: only on the paid-out milestone, for both people, viewable and downloadable
  await F.goto(`${base}/#/p/${pid}`); await F.waitForSelector('[data-invoice="M1"]');
  ok('invoice shown on the paid milestone only (freelancer)', (await F.locator('[data-invoice]').count()) === 1);
  await C.goto(`${base}/#/p/${pid}`); await C.waitForSelector('[data-invoice="M1"]'); await shot(C, 'client-payments-invoice');
  ok('invoice shown on the paid milestone only (client)', (await C.locator('[data-invoice]').count()) === 1);
  const [dl] = await Promise.all([C.waitForEvent('download'), C.getByRole('link', { name: 'Download the M1 invoice' }).click()]);
  ok('client downloads the invoice file', /^INV-\d{8}-\w+\.html$/.test(dl.suggestedFilename()));
  const invUrl = await F.getAttribute('[data-invoice="M1"] a[target="_blank"]', 'href');
  const I = await F.context().newPage(); watch(I, 'I'); await I.goto(base + invUrl); await I.waitForSelector('h1:has-text("Invoice")');
  const it = await txt(I);
  ok('invoice names both people, the milestone, the amount and the PayPal references', ['Ploy Design', 'Baan Kafe', 'M1 · Homepage and menu design', '240.00 USD', 'Paid in full', 'STUBPAYOUT-'].every((x) => it.includes(x)));
  await shot(I, 'invoice'); await I.close();
  await C.goto(`${base}/#/p/${pid}/m/${m1}`); await C.waitForSelector('[data-invoice="M1"]'); ok('invoice on the client’s milestone page', true);
  await F.goto(`${base}/#/p/${pid}/m/${m1}`); await F.waitForSelector('[data-invoice="M1"]'); ok('invoice on the freelancer’s milestone page', true);

  // 1: archive and delete on the projects list
  await F.goto(`${base}/#/new`); await F.waitForSelector('#chatText'); await F.fill('#chatText', fs.readFileSync(repo + '/fixtures/baan-kafe.txt', 'utf8'));
  await F.click('#generate'); await F.waitForSelector('.mp-terms', { timeout: 20000 });
  const pid2 = F.url().match(/#\/p\/([\w-]+)/)[1];
  await F.goto(`${base}/#/projects`); await F.waitForSelector(`[data-project="${pid2}"]`); await shot(F, 'dashboard-actions');
  ok('01 every row has archive and delete', (await F.locator('.mp-jobrow [data-action="archive"]').count()) === 2 && (await F.locator('.mp-jobrow [data-action="delete"]').count()) === 2);
  await F.click(`[data-project="${pid2}"] [data-action="archive"]`); await F.waitForSelector('#archived');
  ok('01 archived project leaves the list', !(await F.locator(`[data-project="${pid2}"]:not(#archived *)`).count()) && (await txt(F)).includes('Archived · 1'));
  await F.click('#archived summary'); await shot(F, 'dashboard-archived');
  await F.click(`#archived [data-project="${pid2}"] [data-action="unarchive"]`); await F.waitForFunction(() => !document.querySelector('#archived'));
  ok('01 unarchive brings it back', (await F.locator(`[data-project="${pid2}"]`).count()) === 1);
  await F.click(`[data-project="${pid}"] [data-action="delete"]`); await F.waitForSelector('.mp-dialog');
  ok('01 a paid project can’t be deleted, only archived', (await F.locator('.mp-dialog').innerText()).includes('can’t be deleted'));
  await F.getByRole('button', { name: 'Go back' }).click();
  await F.click(`[data-project="${pid2}"] [data-action="delete"]`); await F.waitForSelector('.mp-dialog'); await shot(F, 'delete-confirm', false);
  await F.getByRole('button', { name: 'Delete project' }).click(); await F.waitForFunction((id) => !document.querySelector(`[data-project="${id}"]`), pid2);
  ok('01 deleted project is gone', (await F.locator('.mp-jobrow').count()) === 1);
  await C.goto(`${base}/#/jobs`); await C.waitForSelector('.mp-jobrow'); ok('01 the client can archive but not delete', (await C.locator('[data-action="archive"]').count()) >= 1 && !(await C.locator('[data-action="delete"]').count()));
  await shot(C, 'client-jobs');

  // 3: delete account: 15 days, logging in again cancels it
  const S = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); watch(S, 'S');
  await S.goto(base + '/#/login'); await login(S, 'Sam');
  await S.waitForSelector('[data-role="freelancer"]'); await S.click('[data-role="freelancer"]'); await S.click('#roleContinue');
  await S.waitForSelector('#displayName'); await S.getByRole('button', { name: 'Branding' }).click(); await S.click('#finishSetup');
  await S.waitForSelector('#doneNext'); await S.goto(`${base}/#/settings`); await S.waitForSelector('#deleteAccount'); await shot(S, 'settings-account');
  await S.click('#deleteAccount'); await S.waitForSelector('.mp-dialog'); await shot(S, 'delete-account-confirm', false);
  ok('03 the dialog explains the 15 days', (await S.locator('.mp-dialog').innerText()).includes('After 15 days'));
  await S.getByRole('button', { name: 'Delete my account' }).click();
  await S.waitForSelector('text=Your account will be deleted'); await shot(S, 'account-deletion-scheduled');
  ok('03 logged out and told how to cancel', (await txt(S)).includes('Log in with PayPal before') && (await S.evaluate(async () => (await (await fetch('/api/session')).json()).user)) === null);
  await S.goto(base + '/#/login'); await login(S, 'Sam');
  await S.waitForSelector('text=Your account won’t be deleted', { timeout: 8000 }); ok('03 logging in again stops the deletion', true);
  await S.waitForSelector('h1:has-text("Your projects")'); ok('03 the account still works', true);

  // phone widths: no sideways scroll on the reworked screens
  const P = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await C.context().storageState() })).newPage(); watch(P, 'P');
  await P.goto(`${base}/#/p/${pid}`); await P.waitForSelector('.mp-paypage'); ok('13 payments fits a 390px phone', !(await overflows(P))); await shot(P, 'client-payments-phone');
  await P.goto(`${base}/#/settings`); await P.waitForSelector('#saveProfile'); ok('settings fits a 390px phone', !(await overflows(P)));
  const P2 = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await F.context().storageState() })).newPage(); watch(P2, 'P2');
  await P2.goto(`${base}/#/projects`); await P2.waitForSelector('.mp-jobrow'); ok('dashboard fits a 390px phone', !(await overflows(P2))); await shot(P2, 'dashboard-phone');
  await P2.goto(`${base}/#/p/${pid}`); await P2.waitForSelector('#chat'); ok('project page fits a 390px phone', !(await overflows(P2)));

  fs.writeFileSync(out + '/results.txt', results.join('\n'));
  console.log(results.join('\n')); console.log('ERRORS', JSON.stringify(errors, null, 1));
  await b.close();
  if (errors.length || results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})().catch(async (e) => { console.log(results.join('\n')); console.error('FAILED', e.message.split('\n').slice(0, 3).join(' | ')); console.log('ERRORS', JSON.stringify(errors, null, 1)); process.exit(1); });
