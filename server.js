import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { labRouter } from './lab.js';
import * as realPaypal from './paypal.js';
import * as realAi from './ai.js';
import * as realAgent from './agent.js';
import { createRoutes } from './routes.js';
import { loadConfig } from './config.js';
import { identity as realIdentity, authRouter, loadSession, requireUser } from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hold every response until the store's queued writes have committed (pg backend). If they fail, the client
 * gets 500 PERSIST_FAILED instead of a success that would vanish on restart, then onPersistFail runs
 * (default: exit so Render restarts the process from Postgres).
 */
export function persistBeforeResponse(onPersistFail) {
  return (_req, res, next) => {
    if (db.backend() !== 'pg') return next();
    const end = res.end;
    res.end = function (...args) {
      res.end = end;
      db.flush().then(() => end.apply(res, args), (err) => {
        if (res.headersSent) { end.apply(res, args); } else {
          res.statusCode = 500;
          res.removeHeader('Content-Length');
          res.removeHeader('ETag');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          end.call(res, JSON.stringify({ error: err.code || 'PERSIST_FAILED', message: 'Could not save. Please retry.' }));
        }
        onPersistFail(err);
      });
      return res;
    };
    next();
  };
}

const exitOnPersistFail = () => setTimeout(() => process.exit(1), 100);

export function createApp({
  paypal = realPaypal, ai = realAi, agent = realAgent, identity = realIdentity, config = loadConfig(),
  agentOpts, fixturesDir, onPersistFail = exitOnPersistFail,
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(persistBeforeResponse(onPersistFail));
  app.use(express.json({ limit: '1mb' }));
  app.use(loadSession());
  app.use('/auth', authRouter({ identity, config }));
  app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user }));

  app.get('/api/config', (_req, res) => {
    res.json({
      paypal_client_id: process.env.PAYPAL_CLIENT_ID || '',
      currency: process.env.API_CURRENCY || 'USD',
      api_currency: process.env.API_CURRENCY || 'USD',
      env: 'sandbox',
      budget: {
        today_cost_usd: db.todayCostUsd(),
        limit_usd: db.BUDGET_LIMIT_USD,
        blocked: db.todayCostUsd() >= db.BUDGET_LIMIT_USD,
      },
    });
  });

  app.use('/api', requireUser); // everything below needs a session; /api/config above stays public
  app.get('/api/ai-runs', (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    const runs = db.aiRunsOn(date);
    res.json({ runs, total_cost_usd: runs.reduce((s, r) => s + (r.cost_usd || 0), 0) });
  });

  app.use('/api/lab', labRouter());
  app.use('/api', createRoutes({ paypal, ai, agent, ...(agentOpts ? { agentOpts } : {}), ...(fixturesDir ? { fixturesDir } : {}) }));

  app.use(express.static(path.join(HERE, 'public')));

  app.use('/api', (_req, _res, next) => {
    next(new db.AppError('NOT_FOUND', 'No such endpoint', 404));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    const code = err.code && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code)
      ? err.code
      : status === 500 ? 'INTERNAL' : 'BAD_REQUEST';
    if (status === 500) console.error('server error:', err.message);
    res.status(status).json({
      error: code,
      message: status === 500 ? 'Internal error' : err.message,
      ...(err.paypal_debug_id !== undefined ? { paypal_debug_id: err.paypal_debug_id } : {}),
    });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  await db.connect();
  createApp().listen(port, () => console.log(`Milestone Pay on http://localhost:${port} (store: ${db.backend()})`));
  process.on('SIGTERM', async () => {
    await db.flush().catch(() => {});
    process.exit(0);
  });
}
