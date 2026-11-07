// Repro for BUG-1: "Generate agreement" in the browser never reaches the server.
// Usage: node tests/qa/repro-generate-bug.mjs <chrome-profile-dir> [baseUrl]   (server must be running)
import { launch, sleep } from './lib.mjs';
const [, , profile, base = 'http://localhost:3000'] = process.argv;
const b = await launch(9445, profile);
try {
  const p = await b.page('repro');
  await p.goto(`${base}/#/new`);
  await p.waitFor(`document.querySelector('textarea')`);
  await p.ev(`(()=>{const t=document.querySelector('textarea');t.value='Nok: hi\\nPloy: I will do it for $800';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await p.ev(`window.__f=window.fetch;window.fetch=async(...a)=>{try{return await window.__f(...a)}catch(e){window.__err=a[0]+' '+(a[1]?.method)+' -> '+e.message;throw e}}`);
  await p.click('Generate agreement'); await sleep(1500);
  console.log('page says:', (await p.text()).match(/Could not reach[^\n]*/)?.[0] || '(no error: bug fixed)');
  console.log('fetch threw:', await p.ev('window.__err'));
} finally { b.close(); }
