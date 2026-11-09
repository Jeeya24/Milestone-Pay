// Environment, validated once. Errors name missing keys only, never values.
import crypto from 'node:crypto';
import { z } from 'zod';

const REQUIRED_IN_PROD = ['DATABASE_URL', 'APP_URL', 'SESSION_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'GOOGLE_GENERATIVE_AI_API_KEY'];

const schema = z.object({
  NODE_ENV: z.string().optional(),
  APP_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  DATABASE_URL: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GEMINI_TIER: z.enum(['free', 'paid']).optional(),
  AI_USER_DAILY_USD: z.coerce.number().positive().optional(),
  UPLOAD_DIR: z.string().optional(),
  TEST_AUTH: z.string().optional(),
  RATE_LIMITS: z.enum(['on', 'off']).optional(),
});

let warned = false;

export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const blank = (k) => !env[k] || !String(env[k]).trim();
  const missing = prod ? REQUIRED_IN_PROD.filter(blank) : [];
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
  const picked = Object.fromEntries(Object.keys(schema.shape).filter((k) => !blank(k)).map((k) => [k, env[k]]));
  const r = schema.safeParse(picked);
  if (!r.success) throw new Error(`Invalid env: ${[...new Set(r.error.issues.map((i) => i.path.join('.')))].join(', ')}`);
  const e = r.data;
  if (prod && e.GEMINI_TIER !== 'paid' && !warned) {
    warned = true;
    console.warn('warning: GEMINI_TIER is not "paid". The free tier may train on prompts; use demo data only.');
  }
  return {
    nodeEnv: e.NODE_ENV || 'development',
    prod,
    appUrl: e.APP_URL ? e.APP_URL.replace(/\/+$/, '') : null,
    sessionSecret: e.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    databaseUrl: e.DATABASE_URL || null,
    paypalClientId: e.PAYPAL_CLIENT_ID || '',
    paypalClientSecret: e.PAYPAL_CLIENT_SECRET || '',
    geminiKey: e.GOOGLE_GENERATIVE_AI_API_KEY || '',
    geminiTier: e.GEMINI_TIER || 'free',
    aiUserDailyUsd: e.AI_USER_DAILY_USD ?? 0.25,
    uploadDir: e.UPLOAD_DIR || null,
    testAuth: !prod && e.TEST_AUTH === '1',
    // RATE_LIMITS=off only outside production (long scripted runs such as scripts/e2e.js).
    rateLimits: !prod && e.RATE_LIMITS === 'off' ? null : { auth: 20, ai: 10, api: 120 },
  };
}
