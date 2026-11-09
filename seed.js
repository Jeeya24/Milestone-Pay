// Create the Baan Kafe demo project, ready to fund (no AI call), owned by the demo freelancer "Ploy (demo)".
// Usage: npm run seed [-- --clean-uploads]     Respects DATABASE_URL (Postgres), else DB_PATH; UPLOAD_DIR, PORT.
// File backend: resets db.json. Postgres: replaces only the demo freelancer's projects; real users are untouched.
// Drives the real routes in-process (demo, gap fix, both approvals) so it cannot drift from the app.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { createApp } from './server.js';
import { issueSessionToken } from './auth.js';
import { loadConfig } from './config.js';

export const DEMO_FREELANCER_ID = 'usr_demo_freelancer';

/** Postgres: drop the demo freelancer's projects and every row that belongs to them. */
function dropDemoProjects() {
  const d = db.load();
  const ids = new Set(d.projects.filter((p) => p.owner_id === DEMO_FREELANCER_ID).map((p) => p.id));
  if (!ids.size) return;
  const ms = new Set(d.milestones.filter((m) => ids.has(m.project_id)).map((m) => m.id));
  const ags = new Set(d.agreements.filter((a) => ids.has(a.project_id)).map((a) => a.id));
  for (const c of db.COLLECTIONS) {
    if (c === 'users' || c === 'sessions' || c === 'ai_runs') continue;
    d[c] = d[c].filter((row) => !ids.has(row.id) && !ids.has(row.project_id) && !ms.has(row.milestone_id) && !ags.has(row.agreement_id));
  }
  db.save();
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function seed({ dbPath, cleanUploads = false } = {}) {
  if (!dbPath && process.env.DATABASE_URL) {
    await db.connect();
    dropDemoProjects();
  } else {
    const file = dbPath || db.getPath();
    fs.rmSync(file, { force: true });
    fs.rmSync(file + '.tmp', { force: true });
    db.init(file);
  }
  const d = db.load();
  if (!d.users.some((u) => u.id === DEMO_FREELANCER_ID)) {
    d.users.push({ id: DEMO_FREELANCER_ID, paypal_user_id: null, email: null, name: 'Ploy (demo)', created_at: new Date().toISOString(), last_login_at: null });
    db.save();
  }
  const sid = issueSessionToken(DEMO_FREELANCER_ID, { userAgent: 'seed' });

  // The agent is never reached by these routes, and the cached extraction means no AI call.
  const app = createApp({ agentOpts: { forceFallback: true }, logSink: () => {}, config: loadConfig({ ...process.env, NODE_ENV: 'seed', TEST_AUTH: '' }) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { origin: base, cookie: `mp_sid=${sid}`, ...extra, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`seed: ${method} ${url} failed (${res.status} ${json?.error || ''}) ${json?.message || ''}`);
    return json;
  };
  try {
    const { project_id: pid } = await call('POST', '/api/demo');
    const view = await call('GET', `/api/projects/${pid}`);
    const a = view.agreement;
    for (const g of a.body.gaps) await call('POST', `/api/agreements/${a.id}/gaps/${g.id}/fix`);
    const f = await call('POST', `/api/agreements/${a.id}/approve`, {});
    // The demo client cannot log in; the demo freelancer acts as it (Judge mode, demo projects only).
    await call('POST', `/api/agreements/${a.id}/approve`, { content_hash: f.agreement.content_hash }, { 'x-act-as': 'client' });

    if (cleanUploads) {
      const dir = process.env.UPLOAD_DIR || path.join(HERE, 'uploads');
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { projectId: pid };
  } finally {
    const dd = db.load();
    dd.sessions = dd.sessions.filter((x) => x.user_agent !== 'seed');
    db.save();
    await db.flush();
    await new Promise((r) => server.close(r));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const cleanUploads = process.argv.includes('--clean-uploads');
  seed({ cleanUploads }).then(({ projectId }) => {
    console.log(`Demo project ready: ${projectId}`);
    console.log(`  Freelancer: http://localhost:${port}/#/p/${projectId}`);
    console.log(`  Judge:      http://localhost:${port}/?judge=1&p=${projectId}`);
    if (cleanUploads) console.log('  Uploaded files cleared.');
    process.exit(0); // the Postgres pool would keep the process alive
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
