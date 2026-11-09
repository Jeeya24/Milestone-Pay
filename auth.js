// Log in with PayPal (OAuth code flow, sandbox) and cookie sessions.
// The PayPal access token from login is used once for userinfo and never stored.
// Sessions: 32 random bytes in the mp_sid cookie; only sha256(token) is stored.
import crypto from 'node:crypto';
import express from 'express';
import * as db from './db.js';
import { runWithUser } from './context.js';

const AUTHORIZE_URL = 'https://www.sandbox.paypal.com/signin/authorize';
const API = 'https://api-m.sandbox.paypal.com';
const SESSION_DAYS = 14;
const OAUTH_COOKIE_MS = 10 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

/** Real PayPal identity calls. Injectable via createApp({ identity }). */
export const identity = {
  async exchangeCode(code, redirectUri, config) {
    const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
    const res = await fetch(`${API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!res.ok) throw new Error(`PayPal token exchange ${res.status}`);
    return res.json();
  },
  async userInfo(accessToken) {
    const res = await fetch(`${API}/v1/identity/openidconnect/userinfo?schema=openid`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`PayPal userinfo ${res.status}`);
    return res.json();
  },
};

// ---------------------------------------------------------------------------
// Cookies

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAgeMs, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(maxAgeMs > 0 ? `Max-Age=${Math.floor(maxAgeMs / 1000)}` : 'Max-Age=0');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
const addCookie = (res, c) => res.append('Set-Cookie', c);

const sign = (secret, v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
function signed(secret, obj) {
  const v = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${v}.${sign(secret, v)}`;
}
function unsign(secret, s) {
  if (typeof s !== 'string' || !s.includes('.')) return null;
  const [v, mac] = s.split('.');
  const good = Buffer.from(sign(secret, v));
  const got = Buffer.from(mac || '');
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try { return JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); } catch { return null; }
}

/** Only same-site absolute paths ("/x", "/#/p/1"); anything else becomes "/". */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) && !/[\r\n]/.test(next) ? next : '/';
}

// ---------------------------------------------------------------------------
// Sessions

const userView = (u) => ({ id: u.id, name: u.name || null, email: u.email || null });

/** Store a new session (hashed) and return its raw token. Also used by seed.js for its in-process calls. */
export function issueSessionToken(userId, { ip = null, userAgent = '' } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.load().sessions.push({
    id: db.id('ses'), id_hash: sha256(token), user_id: userId, created_at: now(),
    expires_at: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(),
    ip, user_agent: String(userAgent).slice(0, 200),
  });
  db.save();
  return token;
}

export function createSession(req, res, userId, config) {
  const token = issueSessionToken(userId, { ip: req.ip || null, userAgent: req.get('user-agent') || '' });
  addCookie(res, cookie('mp_sid', token, { maxAgeMs: SESSION_DAYS * 864e5, secure: isHttps(config) }));
}

const isHttps = (config) => !!config.appUrl && config.appUrl.startsWith('https://');

function sessionFor(token) {
  if (!token) return null;
  const d = db.load();
  const s = d.sessions.find((x) => x.id_hash === sha256(token));
  if (!s) return null;
  if (Date.parse(s.expires_at) <= Date.now()) {
    d.sessions = d.sessions.filter((x) => x !== s);
    db.save();
    return null;
  }
  return s;
}

/** Sets req.user ({id,name,email} | null) and runs the rest of the request with that user in context. */
export function loadSession() {
  return (req, _res, next) => {
    const s = sessionFor(parseCookies(req.get('cookie')).mp_sid);
    const u = s && db.load().users.find((x) => x.id === s.user_id && !x.deleted_at);
    req.user = u ? userView(u) : null;
    req.session = u ? s : null;
    runWithUser(req.user?.id, next);
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new db.AppError('UNAUTHENTICATED', 'Please log in.', 401));
  next();
}

function upsertUser({ paypal_user_id, email, name }) {
  const d = db.load();
  let u = d.users.find((x) => x.paypal_user_id === paypal_user_id);
  if (!u) {
    u = { id: db.id('usr'), paypal_user_id, email: email || null, name: name || null, created_at: now(), last_login_at: now() };
    d.users.push(u);
  } else {
    Object.assign(u, { email: email || u.email, name: name || u.name, last_login_at: now(), deleted_at: undefined });
  }
  db.save();
  return u;
}

// ---------------------------------------------------------------------------
// Routes (mounted at /auth)

export function authRouter({ identity: id = identity, config }) {
  const r = express.Router();
  const redirectUri = (req) => `${config.appUrl || `${req.protocol}://${req.get('host')}`}/auth/paypal/callback`;

  r.get('/paypal/start', (req, res) => {
    const state = crypto.randomBytes(24).toString('base64url');
    addCookie(res, cookie('mp_oauth', signed(config.sessionSecret, { state, next: safeNext(req.query.next), at: Date.now() }),
      { maxAgeMs: OAUTH_COOKIE_MS, secure: isHttps(config) }));
    const q = new URLSearchParams({
      flowEntry: 'static', client_id: config.paypalClientId, response_type: 'code',
      scope: 'openid email profile', redirect_uri: redirectUri(req), state,
    });
    res.redirect(302, `${AUTHORIZE_URL}?${q.toString().replace(/\+/g, '%20')}`);
  });

  r.get('/paypal/callback', async (req, res) => {
    const st = unsign(config.sessionSecret, parseCookies(req.get('cookie')).mp_oauth);
    addCookie(res, cookie('mp_oauth', '', { maxAgeMs: 0, secure: isHttps(config) }));
    if (req.query.error) return res.redirect(302, '/?login=cancelled');
    if (!st || typeof req.query.state !== 'string' || st.state !== req.query.state || Date.now() - st.at > OAUTH_COOKIE_MS) {
      throw new db.AppError('BAD_STATE', 'Login link expired or was tampered with. Please log in again.', 400);
    }
    if (typeof req.query.code !== 'string' || !req.query.code) return res.redirect(302, '/?login=failed');
    let info;
    try {
      const tok = await id.exchangeCode(req.query.code, redirectUri(req), config);
      info = await id.userInfo(tok.access_token);
    } catch (err) {
      console.error('login failed:', err.message);
      return res.redirect(302, '/?login=failed');
    }
    if (!info?.user_id) return res.redirect(302, '/?login=failed');
    const email = info.email || info.emails?.find((e) => e.primary)?.value || null;
    const u = upsertUser({ paypal_user_id: String(info.user_id), email, name: info.name ? String(info.name).slice(0, 80) : null });
    createSession(req, res, u.id, config);
    res.redirect(302, safeNext(st.next));
  });

  r.post('/logout', (req, res) => {
    if (req.session) {
      const d = db.load();
      d.sessions = d.sessions.filter((s) => s.id !== req.session.id);
      db.save();
    }
    addCookie(res, cookie('mp_sid', '', { maxAgeMs: 0, secure: isHttps(config) }));
    res.json({ ok: true });
  });

  if (config.testAuth) {
    // Tests and local click-throughs only (TEST_AUTH=1, never in production).
    r.post('/test-login', (req, res) => {
      const name = String(req.body?.name || '').trim().slice(0, 60);
      if (!name) throw new db.AppError('NAME_REQUIRED', 'name is required');
      const u = upsertUser({ paypal_user_id: `test:${name.toLowerCase()}`, email: `${name.toLowerCase().replace(/\W+/g, '.')}@test.local`, name });
      createSession(req, res, u.id, config);
      res.json({ user: userView(u) });
    });
  }
  return r;
}
