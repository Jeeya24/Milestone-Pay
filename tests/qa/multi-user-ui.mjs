// Multi-user browser click-through. Start: DATABASE_URL= DB_PATH=/tmp/x/db.json TEST_AUTH=1 PORT=3100 node server.js
// Run: node tests/qa/multi-user-ui.mjs http://localhost:3100 "$PWD"   (one real Gemini extract on the demo chat)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const [base, repo] = process.argv.slice(2);
const { launch, sleep } = await import(path.join(repo, 'tests/qa/lib.mjs'));
const chat = fs.readFileSync(path.join(repo, 'fixtures/baan-kafe.txt'), 'utf8');
const results = []; const ok = (n, c, d) => { results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 300) : ''}`); return c; };
const prof = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `mp-ui-${n}-`));
const A = await launch(9461, prof('a')); const B = await launch(9462, prof('b')); const S = await launch(9463, prof('s'));
const errors = () => [...A.errors, ...B.errors, ...S.errors];
async function testLogin(P, name) {
  await P.goto(base + '/');
  ok(`${name}: login screen shown`, await P.waitFor(`document.body.innerText.includes('Log in to Milestone Pay')`));
  ok(`${name}: PayPal login button`, (await P.buttons()).includes('Log in with PayPal'));
  await P.ev(`document.querySelector('#testName').value=${JSON.stringify(name)}`);
  await P.click('Log in', { exact: true });
  ok(`${name}: logged in`, await P.waitFor(`document.querySelector('#userName')?.innerText===${JSON.stringify(name)}`));
}
try {
  const a = await A.page('A');
  await testLogin(a, 'Ploy');
  ok('A: dashboard + sandbox note', await a.waitFor(`document.body.innerText.includes('Your projects') && document.body.innerText.includes('Sandbox beta: payments go to the Milestone Pay demo merchant')`));
  // project via the same endpoints the New screen uses (real extract on the fixture chat)
  const pid = await a.ev(`(async()=>{const fd=new FormData();fd.set('chatText',${JSON.stringify(chat)});fd.set('freelancer_name','Ploy');
    const p=await (await fetch('/api/projects',{method:'POST',body:fd})).json();
    const x=await fetch('/api/projects/'+p.project.id+'/extract',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!x.ok) return 'EXTRACT '+x.status+' '+(await x.text());
    const v=await (await fetch('/api/projects/'+p.project.id)).json();
    for (const g of v.agreement.body.gaps) await fetch('/api/agreements/'+v.agreement.id+'/gaps/'+g.id+'/fix',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const ap=await fetch('/api/agreements/'+v.agreement.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!ap.ok) return 'APPROVE '+ap.status+' '+(await ap.text());
    return p.project.id})()`);
  ok('A: project created, extracted, approved by freelancer', /^prj_/.test(pid), pid);
  await a.goto(`${base}/#/p/${pid}`);
  ok('A: invite button on frozen agreement', await a.waitFor(`[...document.querySelectorAll('button')].some(b=>b.innerText==='Create invite link')`));
  await a.click('Create invite link', { exact: true });
  ok('A: invite link shown', await a.waitFor(`document.querySelector('input[aria-label="Invite link"]')?.value.includes('/invite/')`));
  const url = await a.ev(`document.querySelector('input[aria-label="Invite link"]').value`);

  const b = await B.page('B', { width: 390, height: 844 });
  await b.goto(url);
  ok('B: invite redirects to login (next kept)', await b.waitFor(`document.body.innerText.includes('Log in to Milestone Pay') && location.hash.startsWith('#/invite/')`), await b.ev('location.href'));
  await b.ev(`document.querySelector('#testName').value='Nok'`);
  await b.click('Log in', { exact: true });
  ok('B: invite screen after login', await b.waitFor(`document.body.innerText.includes('invited you')`), await b.text());
  await b.click('Join as the client', { exact: true });
  ok('B: client view after join', await b.waitFor(`document.body.innerText.includes('Approve agreement')`, 12000), await b.text());
  await b.click('Approve agreement', { exact: true });
  ok('B: fund screen with sandbox note', await b.waitFor(`document.body.innerText.includes('with PayPal') && document.body.innerText.includes('Sandbox beta')`, 12000), await b.text());
  ok('B: PayPal button renders (CSP ok)', await b.waitFor(`!!document.querySelector('.pp-wrap iframe')`, 20000), await b.ev(`document.querySelector('.pp-wrap')?.innerText`));
  await a.goto(`${base}/#/p/${pid}`);
  ok('A: shows client joined', await a.waitFor(`document.body.innerText.includes('Nok joined as the client')`), await a.text());

  const s = await S.page('S');
  await testLogin(s, 'Sam');
  await s.goto(`${base}/#/p/${pid}`);
  ok('S: stranger sees Project not found', await s.waitFor(`document.body.innerText.includes('Project not found')`), await s.text());
  const dash = await s.ev(`(async()=>(await (await fetch('/api/projects')).json()).projects.length)()`);
  ok('S: empty dashboard', dash === 0, dash);

  // session expiry mid-flow: B loses the cookie, next call sends them to PayPal login with next = same screen
  await B.send('Network.enable', {}, b.sessionId);
  await B.send('Network.deleteCookies', { name: 'mp_sid', url: base }, b.sessionId);
  const before = await b.ev('location.pathname+location.search+location.hash');
  // no reload: the client view's next background poll gets 401 and must send B to PayPal login
  let href = '';
  for (let i = 0; i < 40 && !href.startsWith('https://www.sandbox.paypal.com/'); i++) { await sleep(300); try { href = await b.ev('location.href'); } catch { /* navigating */ } }
  ok('B: expired session goes to PayPal sandbox login', href.startsWith('https://www.sandbox.paypal.com/'), href);
  const cookies = (await B.send('Network.getCookies', { urls: [base] }, b.sessionId)).cookies;
  const oauth = cookies.find((c) => c.name === 'mp_oauth');
  const nextIn = oauth ? JSON.parse(Buffer.from(decodeURIComponent(oauth.value).split('.')[0], 'base64url').toString()).next : null;
  ok('B: login will return to the same screen', nextIn === before, { nextIn, before });

  // Judge mode on a demo project
  const demo = await a.ev(`(async()=>(await (await fetch('/api/demo',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()).project_id)()`);
  await a.goto(`${base}/?judge=1&p=${demo}#/p/${demo}`);
  ok('A: judge phone frame loads demo client', await a.waitFor(`(()=>{const f=document.querySelector('#phoneFrame');return f&&!f.hidden&&f.contentDocument&&/Baan Kafe|shared an agreement with you/i.test(f.contentDocument.body.innerText)})()`, 15000), await a.ev(`document.querySelector('#phoneFrame')?.contentDocument?.body?.innerText?.slice(0,300)`));
  await a.goto(`${base}/#/`);
  ok('A: judge link only on demo project', await a.waitFor(`document.querySelectorAll('a[href*="judge=1"]').length===0 || [...document.querySelectorAll('a[href*="judge=1"]')].every(x=>x.href.includes(${JSON.stringify(demo)}))`));
  await a.click('Log out', { exact: true }); await sleep(800);
  ok('A: logout returns to login', await a.waitFor(`document.body.innerText.includes('Log in to Milestone Pay')`));
} catch (e) {
  ok('script', false, e.message);
} finally {
  const errs = errors().filter((e) => !/401 \(Unauthorized\)|\[S\] log Failed to load resource: the server responded with a status of 404/.test(e));
  ok('no console errors', errs.length === 0, errs);
  console.log(results.join('\n'));
  console.log('ALL console errors (incl. PayPal):\n' + errors().join('\n'));
  A.close(); B.close(); S.close();
}
