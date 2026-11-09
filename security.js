// HTTP hardening: security headers + CSP, same-origin check for writes, in-memory rate limits, request log.
// In-memory state is fine because the app runs as a single instance (see the spec's persistence model).
import * as db from './db.js';

const PAYPAL = 'https://www.paypal.com https://www.sandbox.paypal.com https://*.paypal.com https://*.paypalobjects.com';

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${PAYPAL}`,
  `frame-src 'self' ${PAYPAL}`,
  `img-src 'self' data: blob: ${PAYPAL}`,
  `connect-src 'self' ${PAYPAL}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'", // Judge mode embeds the client view in the app itself
].join('; ');

export function securityHeaders({ https = false } = {}) {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

/** Non-GET/HEAD requests must come from this site: Origin host === Host. Missing Origin is refused too. */
export function originCheck() {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    let host = null;
    try { host = new URL(req.get('origin')).host; } catch { /* missing or malformed */ }
    if (!host || host !== req.get('host')) return next(new db.AppError('BAD_ORIGIN', 'Request refused: wrong origin.', 403));
    next();
  };
}

/** Fixed window per key. key(req) -> string|null (null = not limited). */
export function rateLimit({ key, limit, windowMs = 60_000 }) {
  const hits = new Map();
  let sweep = Date.now();
  return (req, _res, next) => {
    const k = key(req);
    if (k == null) return next();
    const now = Date.now();
    if (now - sweep > windowMs) {
      for (const [kk, v] of hits) if (now - v.start >= windowMs) hits.delete(kk);
      sweep = now;
    }
    let h = hits.get(k);
    if (!h || now - h.start >= windowMs) { h = { start: now, n: 0 }; hits.set(k, h); }
    h.n += 1;
    if (h.n > limit) return next(new db.AppError('RATE_LIMITED', 'Too many requests. Wait a minute and try again.', 429));
    next();
  };
}

/** One JSON line per request: never the query string, headers or cookies. */
export function requestLog(sink = (line) => console.log(line)) {
  return (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const routePath = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
      sink(JSON.stringify({
        t: new Date(started).toISOString(), method: req.method, path: routePath,
        status: res.statusCode, ms: Date.now() - started, user: req.user?.id ?? null,
      }));
    });
    next();
  };
}
