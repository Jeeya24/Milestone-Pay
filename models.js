// Task -> model map, output caps, prices and the one-retry fallback wrapper.
// Gemini only. Models come from here only. The provider reads GOOGLE_GENERATIVE_AI_API_KEY from
// process.env; it is never printed.
import { google } from '@ai-sdk/google';
import { NoObjectGeneratedError, TypeValidationError, JSONParseError, RetryError } from 'ai';
import { ZodError } from 'zod';

const gemini = () => google('gemini-3.1-flash-lite');

export const MODELS = {
  extract: gemini(),
  vision: gemini(),
  agent: gemini(),
  scope: gemini(),
  translate: gemini(),
  fallback: gemini(), // one retry on the same model
};

export const MAX_OUT = { extract: 3500, vision: 600, scope: 800, translate: 1200, agentStep: 400 };

/** Temperature for every call. */
export const TEMPERATURE = 0;

/**
 * USD per 1M tokens. Gemini 3.1 Flash-Lite paid rates ($0.25 in / $1.50 out, SPEC.md), applied even on the
 * free tier (which actually bills $0) so ai_runs cost and the $1/day budget guard stay meaningful.
 */
export const PRICES = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
};

export function costUsd(modelId, usage = {}) {
  const p = PRICES[modelId];
  if (!p) return 0;
  const inTok = usage.promptTokens ?? usage.input_tokens ?? 0;
  const outTok = usage.completionTokens ?? usage.output_tokens ?? 0;
  const c = (inTok * p.input + outTok * p.output) / 1e6;
  return Number.isFinite(c) ? c : 0;
}

/** True for the failures the plan retries once on MODELS.fallback: 429, timeout, zod failure. */
export function isRetriable(err) {
  if (!err || err.code === 'BUDGET_EXCEEDED') return false;
  if (RetryError.isInstance?.(err) && err.lastError) return isRetriable(err.lastError);
  if (err.status === 429 || err.statusCode === 429) return true;
  const code = err.status ?? err.statusCode;
  if (code === 408 || code === 529 || code === 500 || code === 502 || code === 503 || code === 504) return true; // timeout / overloaded
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 'ETIMEDOUT') return true;
  if (err instanceof ZodError || err.name === 'ZodError') return true;
  if (NoObjectGeneratedError.isInstance?.(err) || TypeValidationError.isInstance?.(err) || JSONParseError.isInstance?.(err)) return true;
  return false;
}

/**
 * Run fn(model, { fallback }) on MODELS[task]; on a 429, a timeout or a zod failure,
 * run it once more on MODELS.fallback. Anything else (including BUDGET_EXCEEDED) is thrown as is.
 */
export async function withFallback(task, fn, models = MODELS) {
  try {
    return await fn(models[task], { fallback: false });
  } catch (err) {
    if (!isRetriable(err)) throw err;
    return await fn(models.fallback, { fallback: true });
  }
}
