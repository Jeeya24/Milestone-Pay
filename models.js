// Task -> model map, output caps, prices and the one-retry fallback wrapper.
// Models come from here only. Keys are read by the providers from process.env
// (ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY) and are never printed.
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { NoObjectGeneratedError, TypeValidationError, JSONParseError, RetryError } from 'ai';
import { ZodError } from 'zod';

export const MODELS = {
  extract: anthropic('claude-haiku-5-5'),
  vision: anthropic('claude-haiku-5-5'),
  agent: anthropic('claude-haiku-5-5'),
  scope: google('gemini-3.1-flash-lite'), // free tier, demo data only
  translate: google('gemini-3.1-flash-lite'), // free tier, demo data only
  fallback: anthropic('claude-haiku-5-5'),
};

export const MAX_OUT = { extract: 3500, vision: 600, scope: 800, translate: 1200, agentStep: 400 };

/** Temperature for every call (SPEC). See TEMPERATURE_MODELS for models that reject it. */
export const TEMPERATURE = 0;

/** Models that accept a non-default temperature. Others get no temperature param. */
export const TEMPERATURE_MODELS = new Set(['gemini-3.1-flash-lite']);

/**
 * USD per 1M tokens, [input, output].
 * Haiku 5.5: $0.10 / $0.50 for prompts up to 100k tokens (SPEC.md "Cheapest model plan",
 * and the claude-api skill model table). Prompts here stay far below the 100k step.
 * Gemini 3.1 Flash-Lite: $0 on Google's free tier (SPEC.md); paid would be $0.25 / $1.50.
 */
export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'gemini-3.1-flash-lite': { input: 0, output: 0 },
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
