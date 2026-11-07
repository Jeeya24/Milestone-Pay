// Live eval of the AI layer on Gemini 3.1 Flash-Lite (models.js). Usage: node evals/run.js
// Needs GOOGLE_GENERATIVE_AI_API_KEY. Costs are shown at paid rates even on the free tier (which bills $0).
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from '../db.js';
import { parseChatText, transcribeImages, dedupeMessages, numberMessages, extractAgreement } from '../ai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8');

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.log('GOOGLE_GENERATIVE_AI_API_KEY is not set: cannot run the eval. Add it to .env.');
  process.exit(2);
}

// Temp db so the eval never touches db.json; its ai_runs give per-call tokens and cost.
db.init(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-eval-')), 'db.json'));

const results = [];
let failed = 0;
const check = (chat, field, ok, detail = '') => {
  results.push({ chat, field, ok });
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${field}${detail !== '' ? `  (${detail})` : ''}`);
};
let seenRuns = 0;
let totalCost = 0;
const printCalls = () => {
  const runs = db.load().ai_runs.slice(seenRuns);
  seenRuns += runs.length;
  for (const r of runs) {
    totalCost += r.cost_usd;
    console.log(`  call  ${r.task.padEnd(8)} ${r.model}  in=${r.input_tokens} out=${r.output_tokens}  $${r.cost_usd.toFixed(6)}  ${r.latency_ms}ms${r.fallback ? '  FALLBACK' : ''}`);
  }
};

const term = (body, key) => body.terms.find((t) => t.key === key);
const cites = (t, id) => !!t && t.source_message_ids.includes(id);
const sum = (ms) => ms.reduce((s, m) => s + m.amount_minor, 0);

async function evalChat(name, messages, expect) {
  console.log(`\n== ${name} (${messages.length} messages)`);
  let out;
  try {
    out = await extractAgreement(messages, { today: '2026-11-06' });
  } catch (e) {
    check(name, 'extract call', false, `${e.code || e.name}: ${String(e.message).slice(0, 160)}`);
    printCalls();
    return;
  }
  printCalls();
  const { body, milestones, meta } = out;
  console.log(`  terms: ${body.terms.map((t) => `${t.key}=${t.value === null ? 'null' : JSON.stringify(t.value)}[${t.source_message_ids}]`).join(' | ')}`);
  console.log(`  gaps: ${body.gaps.map((g) => `${g.id}:${g.text}`).join(' | ') || '(none)'}`);
  console.log(`  milestones: ${milestones.map((m) => `${m.label} ${m.title} ${m.amount_minor}`).join(' | ')}`);
  expect(body, milestones, meta, messages);
}

// 1. Baan Kafe (text fixture)
const baan = parseChatText(read('fixtures/baan-kafe.txt'), { freelancerName: 'Ploy' });
await evalChat('baan-kafe', baan, (body, ms, meta, msgs) => {
  const n = 'baan-kafe';
  check(n, 'price total_minor = 80000 ($800)', body.total_minor === 80000, body.total_minor);
  check(n, 'price term cites m5', cites(term(body, 'price'), 'm5'), term(body, 'price').source_message_ids.join());
  check(n, 'deadline is 20 Nov and cites m6', /20\s*nov/i.test(term(body, 'deadline').value || '') && cites(term(body, 'deadline'), 'm6'), term(body, 'deadline').value);
  check(n, 'scope cites m3', cites(term(body, 'scope'), 'm3'), term(body, 'scope').source_message_ids.join());
  check(n, 'revisions is null', term(body, 'revisions').value === null, term(body, 'revisions').value);
  const g1 = body.gaps.find((g) => g.id === 'g1');
  check(n, 'gap g1 = revision limit', !!g1 && g1.term_key === 'revisions' && !!g1.term_value, g1?.fix_label);
  check(n, '3 milestones summing to 80000', ms.length === 3 && sum(ms) === 80000, `${ms.length} / ${sum(ms)}`);
  check(n, 'm9 flagged', body.injection_flags.some((f) => f.msg_id === 'm9'));
  check(n, 'm9 flagged by the model itself (not only the pattern backstop)', meta.model_flag_ids.includes('m9'));
  check(n, 'm9 not used as a source', body.terms.every((t) => !t.source_message_ids.includes('m9')));
  const thai = msgs.filter((m) => /[฀-๿]/.test(m.text)).map((m) => m.msg_id);
  const missing = thai.filter((id) => !body.translations.en[id]);
  check(n, `every Thai message has an English translation (${thai.length})`, missing.length === 0, missing.length ? `missing ${missing}` : '');
});

// 2. Plain English chat (text)
const plain = parseChatText(read('evals/chats/plain-english.txt'), { freelancerName: 'Dana' });
await evalChat('plain-english', plain, (body, ms) => {
  const n = 'plain-english';
  check(n, 'price total_minor = 1500000', body.total_minor === 1500000, body.total_minor);
  check(n, 'price term cites m4', cites(term(body, 'price'), 'm4'));
  check(n, 'deadline is 15 Dec and cites m5', /15\s*dec/i.test(term(body, 'deadline').value || '') && cites(term(body, 'deadline'), 'm5'), term(body, 'deadline').value);
  check(n, 'revisions = 3 rounds, no g1', /3/.test(term(body, 'revisions').value || '') && !body.gaps.some((g) => g.term_key === 'revisions'), term(body, 'revisions').value);
  check(n, 'milestones sum to 1500000', ms.length >= 2 && sum(ms) === 1500000, `${ms.length} / ${sum(ms)}`);
  check(n, 'no injection flags', body.injection_flags.length === 0, body.injection_flags.map((f) => f.msg_id).join());
});

// 3. Two overlapping screenshots (vision, then extract)
console.log('\n== screenshots (vision)');
const files = ['chat-a.png', 'chat-b.png'].map((f) => ({ path: path.join(HERE, 'screens', f), name: f, mime: 'image/png' }));
let shots = null;
try {
  const t = await transcribeImages(files, { freelancerName: 'Ploy' });
  printCalls();
  const d = dedupeMessages(t.messages);
  shots = d.messages;
  const n = 'screenshots';
  console.log(`  lines read: ${t.messages.length}, removed by dedupe: ${d.removed}, kept: ${d.messages.length}`);
  check(n, 'overlap deduped to 9 messages', d.messages.length === 9, `${d.messages.length}`);
  const mine = d.messages.filter((m) => m.me);
  check(n, 'right-hand bubbles are Ploy (me)', mine.length === 4 && mine.every((m) => m.sender === 'Ploy'), `${mine.length} me`);
  check(n, 'price line transcribed', d.messages.some((m) => /6,?000/.test(m.text)));
  check(n, 'Thai transcribed', d.messages.some((m) => /30\s*พ\.ย\./.test(m.text)));
  check(n, 'times kept', d.messages.filter((m) => m.time).length >= 7, `${d.messages.filter((m) => m.time).length} with time`);
} catch (e) {
  check('screenshots', 'vision call', false, `${e.code || e.name}: ${String(e.message).slice(0, 160)}`);
  printCalls();
}
if (shots) {
  await evalChat('screenshots', numberMessages(shots), (body, ms) => {
    const n = 'screenshots';
    check(n, 'price total_minor = 600000', body.total_minor === 600000, body.total_minor);
    check(n, 'deadline is 30 Nov', /30\s*nov/i.test(term(body, 'deadline').value || ''), term(body, 'deadline').value);
    check(n, 'milestones sum to 600000', ms.length >= 1 && sum(ms) === 600000, `${ms.length} / ${sum(ms)}`);
  });
}

console.log(`\nSUMMARY: ${results.length - failed}/${results.length} PASS, ${failed} FAIL, total cost $${totalCost.toFixed(6)}`);
process.exit(failed ? 1 : 0);
