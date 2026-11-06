// Dev-time only: renders the two overlapping chat screenshots in evals/screens/ with headless Chrome.
// Run: node evals/make-screenshots.js   (macOS, Google Chrome installed). No npm dependency.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'screens');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Right-hand bubbles (me:true) are the freelancer, Ploy.
const CHAT = [
  { who: 'Mali', me: false, t: '10:02', text: 'สวัสดีค่ะ อยากได้โลโก้ใหม่สำหรับร้านเบเกอรี่ Mali Bakes ค่ะ' },
  { who: 'Ploy', me: true, t: '10:03', text: 'Hi Mali! Sure. How many logo concepts would you like?' },
  { who: 'Mali', me: false, t: '10:05', text: '3 concepts please, and a one-page brand guide' },
  { who: 'Ploy', me: true, t: '10:06', text: 'Great. The price is 6,000 THB for logo + brand guide.' },
  { who: 'Mali', me: false, t: '10:08', text: 'ตกลงค่ะ ต้องการภายใน 30 พ.ย. นะคะ' },
  { who: 'Ploy', me: true, t: '10:09', text: 'Deal. I will send the 3 concepts first.' },
  { who: 'Mali', me: false, t: '10:10', text: 'โอเคค่ะ 👍' },
  { who: 'Ploy', me: true, t: '10:11', text: 'Files as PNG and SVG, ok?' },
  { who: 'Mali', me: false, t: '10:12', text: 'ได้ค่ะ' },
];
// Screenshot A shows messages 1-6, screenshot B shows 4-9: lines 4-6 overlap.
const PARTS = { 'chat-a': [0, 6], 'chat-b': [3, 9] };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (rows) => `<!doctype html>
<html><head><meta charset="utf-8"><title>chat</title><style>
body{margin:0;background:#8fa7c2;font-family:-apple-system,"Helvetica Neue","Thonburi",sans-serif;width:390px}
.bar{background:#1f2937;color:#fff;padding:14px 16px;font-size:16px;font-weight:600}
.chat{padding:12px 10px;display:flex;flex-direction:column;gap:10px}
.row{display:flex;align-items:flex-end;gap:6px}.row.me{justify-content:flex-end}
.name{font-size:11px;color:#1f2937;margin:0 0 2px 4px}
.bubble{max-width:240px;padding:8px 11px;border-radius:16px;font-size:14px;line-height:1.35;background:#fff;color:#111}
.me .bubble{background:#7be08a}.time{font-size:10px;color:#2c3a4b;padding-bottom:2px}
</style></head><body>
<div class="bar">Mali (Mali Bakes)</div><div class="chat">
${rows.map((r) => r.me
    ? `<div class="row me"><span class="time">${r.t}</span><div class="bubble">${esc(r.text)}</div></div>`
    : `<div><div class="name">${r.who}</div><div class="row"><div class="bubble">${esc(r.text)}</div><span class="time">${r.t}</span></div></div>`).join('\n')}
</div></body></html>`;

for (const [name, [a, b]] of Object.entries(PARTS)) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html(CHAT.slice(a, b)));
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${path.join(OUT, `${name}.png`)}`,
    '--window-size=390,520', pathToFileURL(file).href,
  ], { stdio: 'ignore' });
  console.log('wrote', `evals/screens/${name}.png`);
}
