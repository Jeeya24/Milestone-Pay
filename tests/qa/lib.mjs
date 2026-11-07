// CDP helpers for the browser bug bash.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function launch(port = 9444, profile) {
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50; i++) { try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); break; } catch { await sleep(200); } }
  if (!ws) throw new Error('chrome did not start');
  let seq = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result); } else handlers.forEach((h) => h(m)); };
  const send = (method, params = {}, sessionId) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => pending.set(id, { res, rej, method })); };
  const errors = [];
  async function page(label, { width = 1280, height = 900 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId); await send('Log.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
    handlers.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`[${label}] console.error ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') errors.push(`[${label}] EXCEPTION ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`[${label}] log ${m.params.entry.text} ${m.params.entry.url || ''}`);
      if (m.method === 'Page.javascriptDialogOpening') { errors.push(`[${label}] DIALOG OPENED (XSS?): ${m.params.message}`); send('Page.handleJavaScriptDialog', { accept: true }, sessionId); }
    });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`); return r.result.value; };
    const P = {
      ev, sessionId, label,
      goto: async (url) => { await send('Page.navigate', { url }, sessionId); await sleep(700); },
      waitFor: async (expr, ms = 10000) => { const t = Date.now(); for (;;) { try { if (await ev(expr)) return true; } catch {} if (Date.now() - t > ms) return false; await sleep(150); } },
      text: () => ev('document.body.innerText'),
      buttons: () => ev(`[...document.querySelectorAll('button,a.btn,[role=button]')].filter(b=>b.offsetParent!==null).map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean)`),
      click: async (text, { scope = 'document', exact = false, nth = 0 } = {}) => {
        const ok = await ev(`(()=>{const q=${JSON.stringify(text)};const els=[...${scope}.querySelectorAll('button,a,[role=button],.chip')].filter(b=>b.offsetParent!==null&&!b.disabled&&(${exact}?b.innerText.trim()===q:b.innerText.trim().includes(q)));const b=els[${nth}];if(!b)return false;b.click();return true})()`);
        await sleep(450); return ok;
      },
      setFiles: async (selector, files) => { const o = await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false }, sessionId); await send('DOM.setFileInputFiles', { files, objectId: o.result.objectId }, sessionId); await ev(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`); await sleep(300); },
      overflow: () => ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})`),
      shot: async (file) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(file, Buffer.from(data, 'base64')); },
      close: () => send('Target.closeTarget', { targetId }),
    };
    return P;
  }
  return { page, errors, send, close: () => { try { ws.close(); } catch {} chrome.kill(); } };
}
