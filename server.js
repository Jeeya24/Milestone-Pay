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

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ paypal = realPaypal, ai = realAi, agent = realAgent, agentOpts, fixturesDir } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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
  createApp().listen(port, () => console.log(`Milestone Pay on http://localhost:${port}`));
}
