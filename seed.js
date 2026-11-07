// Reset db.json to a clean state with the Baan Kafe demo project ready to fund (no AI call).
// Usage: npm run seed [-- --clean-uploads]     Respects DB_PATH, UPLOAD_DIR, PORT.
// Drives the real routes in-process (demo, gap fix, both approvals) so it cannot drift from the app.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { createApp } from './server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function seed({ dbPath, cleanUploads = false } = {}) {
  const file = dbPath || db.getPath();
  fs.rmSync(file, { force: true });
  fs.rmSync(file + '.tmp', { force: true });
  db.init(file);

  // The agent is never reached by these routes, and the cached extraction means no AI call.
  const app = createApp({ agentOpts: { forceFallback: true } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
    const f = await call('POST', `/api/agreements/${a.id}/approve`, { party: 'freelancer' });
    await call('POST', `/api/agreements/${a.id}/approve`, { party: 'client', content_hash: f.agreement.content_hash });

    if (cleanUploads) {
      const dir = process.env.UPLOAD_DIR || path.join(HERE, 'uploads');
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { projectId: pid };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const cleanUploads = process.argv.includes('--clean-uploads');
  seed({ cleanUploads }).then(({ projectId }) => {
    console.log(`Demo project ready: ${projectId}`);
    console.log(`  Freelancer: http://localhost:${port}/#/p/${projectId}`);
    console.log(`  Client:     http://localhost:${port}/?as=client&p=${projectId}`);
    console.log(`  Judge:      http://localhost:${port}/?judge=1&p=${projectId}`);
    if (cleanUploads) console.log('  Uploaded files cleared.');
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
