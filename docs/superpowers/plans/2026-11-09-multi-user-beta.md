# Multi-user Sandbox Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Milestone Pay a hosted, multi-user sandbox beta. Users log in with PayPal, data lives in Render Postgres, every project is visible only to its freelancer and invited client, and the app is deployed at https://milestone-pay-knv4.onrender.com.

**Architecture:** The in-memory store stays the synchronous working copy. A new Postgres backend loads it at boot, and every `db.save()` writes the diff through to Postgres before the response is sent. Auth is Log in with PayPal (an OAuth code flow over `fetch`), with sessions kept in the store. Roles come from `project_members`, checked by one access middleware on every route. Request bodies no longer carry `party`.

**Tech Stack:** Node 22, Express 5, `pg` (the only new dependency), vanilla JS frontend, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-multi-user-beta-design.md`. Read the "Persistence model (revised)" section; it overrides the original row-lock plan.

## Global Constraints

- New dependency allowed: `pg` only. Nothing else without asking the owner.
- Money is integer minor units (`amount_minor`). Never floats. PayPal calls are server-side only, amounts come from the store, and every PayPal write sends `PayPal-Request-Id`.
- Every milestone status change goes through `db.transition()`. Capture, void and refund require an approved proposal (`NO_APPROVAL`).
- Chat, revision notes and change-request text are never sent to the agent. Escape all user text on render.
- Secrets only via `process.env`. Never log cookies, `Authorization` headers, OAuth codes or tokens, or env values.
- Non-members get **404 NOT_FOUND**. Members with the wrong role get **403 WRONG_ROLE**.
- Sessions: cookie `mp_sid`, `HttpOnly; SameSite=Lax; Path=/`, `Secure` only when `APP_URL` starts with `https`, 14-day expiry. Only `sha256(token)` is stored.
- OAuth state cookie `mp_oauth`, 10 minutes, HMAC-SHA256 signed with `SESSION_SECRET`.
- PayPal sandbox endpoints: authorize at `https://www.sandbox.paypal.com/signin/authorize`, token at `https://api-m.sandbox.paypal.com/v1/oauth2/token`, userinfo at `https://api-m.sandbox.paypal.com/v1/identity/openidconnect/userinfo?schema=openid`. Scopes: `openid email profile`.
- Invites: 32 random bytes, `sha256` stored, 7-day expiry, one live invite per project.
- Rate limits: `/auth/*` 20/min per IP; AI routes 10/min per user; everything else 120/min per user. `429 RATE_LIMITED`.
- AI budget: global $1/day (unchanged), plus per user `AI_USER_DAILY_USD` (default `0.25`).
- `TEST_AUTH=1` enables `POST /auth/test-login`. It's refused when `NODE_ENV=production`.
- Lab (`/api/lab`, `/lab.html`) is mounted only when `NODE_ENV !== 'production'`.
- Commit after each task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Pushing to GitHub deploys to Render**, so push only in Task 8, after the owner says go.

## Review Focus

1. **A Postgres write fails mid-request** (network blip to Render). The user must see an error, not a success that disappears on restart. Pinned in Task 1 (`flush failure returns 500 PERSIST_FAILED`).
2. **The user cancels at PayPal's login screen**, so the callback arrives with `error=access_denied` and no `code`. They should land back on the login screen with "Login cancelled", not a 500. Pinned in Task 2.
3. **An invite link is opened by the freelancer themselves, or by a third person after the client claimed it.** The app should refuse clearly (`SELF_INVITE`, `CLIENT_TAKEN` / `INVITE_USED`) and not swap the client. Pinned in Task 4.
4. **An old browser tab still sends `{party:"client"}` while logged in as the freelancer.** The server must act on the session's role and ignore the body. Pinned in Task 3 (`party in body is ignored`).
5. **The session expires mid-journey.** The next API call returns 401, and the frontend must send the user to login and back to the same `#/p/<id>` screen. Pinned in Task 6.

---

## File structure

| File | Responsibility |
| --- | --- |
| `migrations/001_init.sql` | One table per collection: `(rid text primary key, project_id text, data jsonb not null, updated_at timestamptz default now())`, plus an index on `project_id`. Also `schema_migrations(version text pk, applied_at timestamptz)` |
| `pgstore.js` | `connect({ url, schema })`, `loadAll()`, `flush(snapshot)`, `migrate()`, `close()`. Knows nothing about the app |
| `db.js` | Unchanged sync API. Adds `connect()`, `flush()`, `pendingFlush()`, a backend switch, the new collections, and per-user budget |
| `config.js` | zod env schema, `loadConfig()` |
| `context.js` | `AsyncLocalStorage`: `runWithUser(userId, fn)`, `currentUserId()` |
| `auth.js` | `authRouter({ identity, config })`, `loadSession`, `requireUser`, `createSession`, `identity` default (PayPal OAuth calls) |
| `access.js` | `projectIdFor(kind, id)`, `need(kind, role?)` middleware, `membersOf(projectId)`, `roleOf(userId, projectId)` |
| `security.js` | `securityHeaders()`, `originCheck()`, `rateLimit({ key, limit, windowMs })`, `requestLog()` |
| `routes.js` | Each route gets `need(...)`. `party`/`from` come from `req.role`. Invite routes. Dashboard filtered by membership |
| `server.js` | Middleware order, `/auth`, `/healthz`, `GET /invite/:token`, async boot (`db.connect()` before `listen`), SIGTERM flush |
| `seed.js`, `scripts/e2e.js`, `tests/unit/helpers.js` | Log in via test-login. Two-user journey |
| `public/app.js`, `public/index.html`, `public/styles.css` | Login screen, user menu, role-driven views, invite flow, sandbox payee note |
| `README.md` | Beta onboarding, Render services, env list, PayPal app settings |

---

### Task 1: Postgres write-through store

**Files:**
- Create: `migrations/001_init.sql`, `pgstore.js`, `tests/pg/store.test.js`
- Modify: `db.js`, `server.js`, `package.json` (add `pg`; add the script `"test:pg": "node --test tests/pg/"`)

**Interfaces:**
- Produces, in `pgstore.js`:
  - `connect({ url: string, schema?: string }) -> Promise<void>`. `schema` defaults to `public`. It sets `search_path`, creates the schema if missing, uses `ssl: { rejectUnauthorized: false }` when the host isn't localhost, and runs `migrate()` under `pg_advisory_xact_lock(4242)`.
  - `loadAll(collections: string[]) -> Promise<Record<string, Array<{ rid, data }>>>`
  - `flush(changes: { upserts: Array<{ coll, rid, project_id, data }>, deletes: Array<{ coll, rid }> }) -> Promise<void>`: one transaction, using `INSERT … ON CONFLICT (rid) DO UPDATE`.
  - `dropSchema(schema) -> Promise<void>`: tests only.
  - `close() -> Promise<void>`
- Produces, in `db.js` (existing exports unchanged):
  - `connect() -> Promise<void>`: pg backend when `process.env.DATABASE_URL` is set (schema from `DB_SCHEMA`, default `public`), else the file backend as today.
  - `flush() -> Promise<void>`: resolves when every queued write has committed. It rejects with `AppError('PERSIST_FAILED', …, 500)` on failure.
  - `backend() -> 'file' | 'pg'`
  - `COLLECTIONS` exported, now also including `users`, `sessions`, `project_members`, `invites`.
- Row identity: each row's `rid` is `row.id` when present, else a generated `rid_<hex>` held in a module `WeakMap<object, string>`. The last persisted JSON is held in a `WeakMap<object, string>`. A deleted row is a rid present last flush but absent now. `project_id` column = `data.project_id ?? null`.

- [ ] **Step 1: Write the failing tests** in `tests/pg/store.test.js`. The whole file is skipped with `{ skip: !process.env.TEST_DATABASE_URL }`. Each run uses schema `mp_test_<8 hex>` and drops it in `after()`. Tests:
  - `round trip`: push a project `{id:'prj_a', title:'T'}` and a milestone `{id:'ms_a', project_id:'prj_a', amount_minor: 240000}`, call `save()` then `await flush()`, re-`connect()` with a cleared cache, and assert both rows are deep-equal and `typeof amount_minor === 'number'`.
  - `update`: change the title, flush, reload, and assert the new title is there.
  - `delete via filter`: `d.milestones = d.milestones.filter(() => false)`, flush, reload, and assert `milestones.length === 0`.
  - `row without id`: push an approval `{agreement_id:'agr_a', party:'client'}`, flush twice with no change, and assert there's exactly 1 row in the `approvals` table (`SELECT count(*)`).
  - `queued saves coalesce`: call `save()` 5× synchronously, then `await flush()`, and assert the data is persisted.
  - `flush failure`: stub `pgstore.flush` to reject once, and assert `await db.flush()` rejects with `code === 'PERSIST_FAILED'`.
- [ ] **Step 2: Run** `TEST_DATABASE_URL=$DATABASE_URL npm run test:pg` (export the URL from `.env` without printing it). Expected: FAIL, because `pgstore.js` doesn't exist.
- [ ] **Step 3: Implement** `migrations/001_init.sql` and `pgstore.js`, then add the backend to `db.js`.
  - `save()` in pg mode: compute the diff synchronously, then chain `pgstore.flush(diff)` onto one module-level promise. Update the `lastJson` WeakMap only after a successful commit.
  - `init(path)` keeps forcing the file backend, which the existing tests rely on.
- [ ] **Step 4: Hold responses until data is persisted** in `server.js`. Add a middleware before the routes that wraps `res.json` and `res.end` so they `await db.flush()` first. On rejection it sends `500 { error:'PERSIST_FAILED', message:'Could not save. Please retry.' }`, logs it, and calls `process.exit(1)` after the response.
- [ ] **Step 5: Async boot.** `createApp` stays sync. The `listen` block becomes `await db.connect()` then `listen`. Add `process.on('SIGTERM', async () => { await db.flush().catch(()=>{}); process.exit(0); })`.
- [ ] **Step 6: Run** `npm run test:pg`, then `npm test`. Expected: the pg tests PASS, and all 110 existing tests PASS on the file backend.
- [ ] **Step 7: Commit:** `feat(db): postgres write-through backend`

### Task 2: Config, request context and Log in with PayPal

**Files:**
- Create: `config.js`, `context.js`, `auth.js`, `tests/unit/auth.test.js`
- Modify: `server.js`, `tests/unit/helpers.js`

**Interfaces:**
- `loadConfig(env = process.env) -> { nodeEnv, appUrl, sessionSecret, databaseUrl, paypalClientId, paypalClientSecret, geminiKey, geminiTier, aiUserDailyUsd, uploadDir, testAuth }`.
  - In production, `DATABASE_URL`, `APP_URL`, `SESSION_SECRET` (≥32 chars), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `GOOGLE_GENERATIVE_AI_API_KEY` are required. If any are missing it throws `Error('Missing env: A, B')` (names only).
  - Outside production, `SESSION_SECRET` defaults to a random value generated per boot.
  - `testAuth` is true only when `TEST_AUTH=1` and not in production.
  - In production with `geminiTier !== 'paid'`, it warns once.
- `runWithUser(userId: string|null, fn) -> any`, `currentUserId() -> string|null` (AsyncLocalStorage).
- `identity` (the default export object of `auth.js`, injectable through `createApp({ identity })`):
  - `exchangeCode(code, redirectUri) -> Promise<{ access_token }>`
  - `userInfo(accessToken) -> Promise<{ user_id, email?, name? }>`
- `authRouter({ identity, config }) -> express.Router`, mounted at `/auth`:
  - `GET /paypal/start?next=`: `next` must match `^/(?!/)`, else `/`.
  - `GET /paypal/callback`
  - `POST /logout`
  - `POST /test-login {name}`: only when `testAuth`.
- `loadSession` sets `req.user = { id, name, email } | null` and wraps the rest of the request in `runWithUser`. `requireUser` returns `401 UNAUTHENTICATED`.
- `GET /api/me` returns `{ user }`.
- Store rows:
  - `users`: `{ id:'usr_…', paypal_user_id, email, name, created_at, last_login_at }`
  - `sessions`: `{ id:'ses_…', id_hash, user_id, created_at, expires_at, ip, user_agent }`. Expired rows are pruned on lookup.
- `tests/unit/helpers.js` gets `login(call, name) -> Promise<{ cookie, user }>`. `startApp` sets `TEST_AUTH=1`. The `call()` helper accepts `{ cookie }` and always sends `Origin: base`.

- [ ] **Step 1: Write failing tests** in `auth.test.js`, using an `identity` stub:
  - `start sets signed state and redirects`: the `Location` starts with the sandbox authorize URL and contains `scope=openid%20email%20profile` and the `state`.
  - `callback rejects bad state`: returns 400 `BAD_STATE`, and no session is created.
  - `callback with error=access_denied` redirects to `/?login=cancelled`, not a 500 (Review Focus 2).
  - `callback happy path`: upserts the user on `paypal_user_id`, sets `mp_sid` with `HttpOnly` and `SameSite=Lax`, and redirects to `next`. Logging in a second time doesn't create a second user row and gives a different session token.
  - `open redirect`: `next=//evil.com` redirects to `/`.
  - `session stored hashed`: no `sessions` row contains the raw cookie value.
  - `expired session` returns 401.
  - `logout` deletes the session row, and the next `/api/me` returns 401.
  - `test-login refused in production`: with `NODE_ENV=production`, the route returns 404.
  - `loadConfig` lists every missing var name in production and never includes values.
- [ ] **Step 2: Run** `node --test tests/unit/auth.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `config.js`, `context.js` and `auth.js`, then wire them into `server.js`:
  - Order: `loadSession` runs before `/api`.
  - `/auth` gets its router.
  - `/api/config` stays public.
  - Every other `/api` route needs `requireUser`. The routes haven't been changed yet, so for this task `requireUser` is applied only to `/api/me`. Task 3 extends it to everything.
  - The callback redirect URI is `${appUrl}/auth/paypal/callback`. Outside production, when `APP_URL` is unset, it's derived from `req.protocol` and `req.get('host')`.
  - Set `app.set('trust proxy', 1)`.
- [ ] **Step 4: Run** `npm test`. Expected: all tests PASS.
- [ ] **Step 5: Commit:** `feat(auth): log in with paypal, sessions, config`

### Task 3: Membership and access control on every route

**Files:**
- Create: `access.js`, `tests/unit/access.test.js`
- Modify: `routes.js`, `agent.js` (approver check), `tests/unit/helpers.js`, all `tests/unit/s*.test.js` (drop `party`, call as the right user)

**Interfaces:**
- Store rows:
  - `project_members`: `{ project_id, user_id, role: 'freelancer'|'client', at }`. At most one per `(project_id, role)`.
  - `projects` gains `owner_id`, `is_demo: false` and `payee_merchant_id: null`.
- `projectIdFor(kind: 'project'|'agreement'|'milestone'|'proposal'|'change_request'|'deliverable', id) -> string|null`
- `roleOf(userId, projectId) -> 'freelancer'|'client'|null`
- `need(kind, role?) -> middleware`. It reads `req.params.id`, sets `req.projectId` and `req.role`, and returns 404 for non-members and `403 WRONG_ROLE` for the wrong role.
  - **Judge act-as:** when the header `X-Act-As: client` is present, the project `is_demo`, and the user is its freelancer, `req.role = 'client'` and `req.actorUserId` = the project's client member. Otherwise the header is ignored.
- Route roles (from the spec table):
  - `POST /projects`: any logged-in user. It creates the freelancer membership and sets `owner_id`.
  - Freelancer only: extract, gap fix, deliverables, submit, CR send, CR close.
  - Client only: order, authorize, proposal approve, proposal cancel, revision, CR decide.
  - Either role: project view, download, refresh, `agent/run`, `guardrail-test`, CR create (`from = req.role`).
  - `POST /agreements/:id/approve`: branches on `req.role`. `party` is ignored. The approval row gains `user_id`.
  - `POST /demo`: see Task 4.
- `GET /projects`: only projects where the user is a member, each with `my_role`. Totals are computed over projects where `my_role === 'freelancer'`.
- `GET /projects/:id`: adds `my_role` and `members: [{ role, name }]`. User emails are never exposed to the other party.
- `authorize`: before saving, `paypal.getOrder(order_id)` must have `purchase_units[0].custom_id === milestone.id`, else `409 ORDER_MISMATCH`. The payment row gains `payer_user_id`.
- `agent.js`: `executeCapture` / `executeVoid` additionally require `proposal.approved_by` to be the project's client member's user id (or the demo client for act-as). `routes.js` sets `approved_by` from `req.actorUserId ?? req.user.id`.

- [ ] **Step 1: Write failing tests** in `access.test.js`. Set up freelancer F, client C (joined directly through `project_members` in the test setup), and stranger S.
  - `stranger gets 404 on every route family`: loop over GET project, extract, approve, order, authorize, deliverables, submit, download, revision, proposal approve/cancel, CR create/send/decide, and refresh.
  - `role matrix`: C calling submit → 403 `WRONG_ROLE`; F calling proposal approve → 403; F calling order → 403; C calling extract → 403.
  - `party in body is ignored`: F posts approve with `{party:'client'}`, and the result is a freelancer approval (Review Focus 4).
  - `dashboard lists only member projects` with `my_role`, and the totals exclude projects where the user is the client.
  - `act-as ignored on non-demo`: F sends `X-Act-As: client` to proposal approve on a non-demo project → 403.
  - `authorize with order for another milestone` → 409 `ORDER_MISMATCH`.
  - `capture refused when approved_by is not the client` → `NO_APPROVAL`, with zero PayPal capture calls.
- [ ] **Step 2: Run** `node --test tests/unit/access.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `access.js` and wire `need()` into every route in `routes.js`. Apply `requireUser` to all of `/api` except `/config`. Remove the `BAD_PARTY` checks.
- [ ] **Step 4: Port the existing tests.**
  - The helper gets `asFreelancer`/`asClient` callers. A `joinClient(projectId, user)` helper writes the membership directly.
  - Remove `party` and `from` from request bodies.
  - Keep every existing assertion. Only the caller changes.
- [ ] **Step 5: Run** `npm test`. Expected: all tests PASS (110 existing + new).
- [ ] **Step 6: Commit:** `feat(access): per-project roles on every route`

### Task 4: Invites, demo project and Judge mode

**Files:**
- Create: `tests/unit/invites.test.js`
- Modify: `routes.js`, `server.js`, `seed.js`

**Interfaces:**
- Store row `invites`: `{ id:'inv_…', project_id, token_hash, created_by, created_at, expires_at, used_by:null, used_at:null, revoked:false }`
- Routes:
  - `POST /api/projects/:id/invites` (freelancer) returns `201 { url: `${appUrl}/invite/${token}` }`. It revokes earlier unused invites.
  - `GET /api/invites/:token` (logged in) returns `200 { project:{ id, title }, freelancer:{ name } }`. It returns `404` for an unknown token, `410 INVITE_EXPIRED`, or `409 INVITE_USED`.
  - `POST /api/invites/:token/accept` returns `200 { project_id }`. Errors: `409 SELF_INVITE`, `409 CLIENT_TAKEN`, `409 INVITE_USED`, `410 INVITE_EXPIRED`.
  - `GET /invite/:token` (server.js, not under /api) redirects to `/#/invite/<token>`. The frontend handles login if needed.
- `POST /api/demo`: creates the Baan Kafe project with the current user as freelancer and `is_demo: true`, plus a client membership for a demo client user. That user is `usr_demo_client`, name "Nok (demo)", with no `paypal_user_id`. It's created on first use, and it can never log in, because test-login and PayPal login never return it.
- `seed.js`: works on whichever backend `db.connect()` picks. It creates a demo freelancer user `usr_demo_freelancer` ("Ploy (demo)") and runs the existing seed flow as that user through test-login (it sets `TEST_AUTH=1` for its in-process app). It doesn't delete real users' data in pg mode; it only replaces rows where `is_demo`.

- [ ] **Step 1: Write failing tests** in `invites.test.js`:
  - `invite then accept`: C becomes the client, and `GET /projects/:id` as C returns `my_role:'client'`.
  - `self invite`: F accepts → 409 `SELF_INVITE` (Review Focus 3).
  - `second person after claim`: S accepts the used link → 409 `INVITE_USED`, and the client stays C (Review Focus 3).
  - `new invite revokes old`: the old token → 409 `INVITE_USED`.
  - `expired`: set `expires_at` in the past → 410 `INVITE_EXPIRED`.
  - `token stored hashed`: the raw token doesn't appear in the `invites` rows.
  - `demo: judge act-as works`: on a demo project, F with `X-Act-As: client` can run the client approve → order → authorize steps (PayPal stubbed).
- [ ] **Step 2: Run** `node --test tests/unit/invites.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes, the `/invite/:token` redirect and the demo changes. Update `tests/unit/s8.seed.test.js` for the demo users.
- [ ] **Step 4: Run** `npm test`. Expected: all tests PASS.
- [ ] **Step 5: Commit:** `feat(invites): client invite links, demo users, judge act-as`

### Task 5: Hardening: headers, origin check, rate limits, logs, health, budgets

**Files:**
- Create: `security.js`, `tests/unit/security.test.js`
- Modify: `server.js`, `db.js` (`logAiRun` adds `user_id: currentUserId()`; `assertBudget` also checks the user's total for today), `routes.js` (`DELETE /api/me`)

**Interfaces:**
- `securityHeaders({ https: boolean })`:
  - CSP: `default-src 'self'; script-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://*.paypalobjects.com; frame-src https://www.paypal.com https://www.sandbox.paypal.com 'self'; img-src 'self' data: https://*.paypalobjects.com https://www.paypal.com; connect-src 'self' https://www.paypal.com https://www.sandbox.paypal.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'`
  - Plus `nosniff`, `Referrer-Policy: same-origin`, and HSTS (`max-age=15552000`) when `https`.
  - Use `frame-ancestors 'self'` rather than `X-Frame-Options: DENY`, because Judge mode embeds the app in itself.
- `originCheck()`: for non-GET/HEAD requests to `/api` and `/auth`, `new URL(req.get('origin')).host` must equal `req.get('host')`, else `403 BAD_ORIGIN`. A missing Origin also gets 403.
- `rateLimit({ key: (req) => string, limit: number, windowMs: 60000 })`: an in-memory fixed window that returns `429 RATE_LIMITED`. Applied with the limits from Global Constraints. The AI routes are `POST /api/projects`, `/api/projects/:id/extract`, `/api/projects/:id/change-requests` and `/api/demo`.
- `requestLog()`: on `finish`, prints one JSON line `{ t, method, path: req.route?.path ?? req.path, status, ms, user }`. It never includes the query string, cookies or headers.
- `GET /healthz`: `200 { ok:true, db: backend() }` once `db.connect()` has finished. Before that, `503`.
- `DELETE /api/me`:
  - Deletes the user's sessions.
  - Deletes the projects where they're the freelancer, along with all of each project's rows and its upload directory, but only if none of that project's milestones is `authorized`, `submitted` or `revision_requested`. Otherwise it returns `409 ACTIVE_HOLDS`.
  - Removes their client memberships and marks the user row `{ deleted_at }` with `email` and `name` nulled.
- Lab: `server.js` mounts `labRouter` and serves `lab.html` only when not in production.
- `/api/ai-runs`: filtered to the current user's projects plus their own `user_id` runs.

- [ ] **Step 1: Write failing tests** in `security.test.js`:
  - CSP header present, and it contains `https://www.sandbox.paypal.com`.
  - POST with `Origin: https://evil.example` → 403 `BAD_ORIGIN`. The same POST with no Origin → 403.
  - The 21st `/auth/test-login` within a minute from one IP → 429.
  - The 11th extract call by one user → 429, while another user is still allowed.
  - Per-user budget: with `AI_USER_DAILY_USD=0.001` and one logged run costing 0.002 for user A, A gets `429 BUDGET_EXCEEDED` and B doesn't.
  - `ai_runs` rows carry `user_id`.
  - `/healthz` → 200.
  - `/api/lab` → 404 when `NODE_ENV=production` (build the app with `config` overridden).
  - The request log line for `/auth/paypal/callback?code=SECRET` doesn't contain `SECRET`.
  - `DELETE /api/me` with an authorized milestone → 409 `ACTIVE_HOLDS`. Without one, the project and its sessions are gone, and `/api/me` → 401.
- [ ] **Step 2: Run** `node --test tests/unit/security.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `security.js`. Middleware order in `server.js`:
  1. `requestLog`
  2. `securityHeaders`
  3. `express.json`
  4. `originCheck`
  5. `loadSession`
  6. rate limits
  7. persist-wrap
  8. routes
  9. static files
  10. 404
  11. error handler
- [ ] **Step 4: Run** `npm test`. Expected: all tests PASS.
- [ ] **Step 5: Commit:** `feat(security): headers, origin check, rate limits, budgets, healthz`

### Task 6: Frontend: login, roles, invites, sandbox note

**Files:**
- Modify: `public/app.js`, `public/index.html`, `public/styles.css`

**Interfaces:**
- Consumes:
  - `GET /api/me`, `POST /auth/logout`, `/auth/paypal/start?next=`
  - `my_role` and `members` on project views
  - `POST /api/projects/:id/invites`, `GET/POST /api/invites/:token[/accept]`
  - `X-Act-As: client` on demo projects
- Behaviour:
  - **Boot:** `GET /api/me`. On 401, render the login screen: "Log in with PayPal" button → `/auth/paypal/start?next=<current path+hash>`. Show "Login cancelled" when `?login=cancelled`.
  - **Header:** the user's name plus a "Log out" button (POST, then reload).
  - **Expired session:** `api()` on 401 sends the browser to `/auth/paypal/start?next=` with the current `location.pathname + location.hash` (Review Focus 5).
  - **Views:** `#/p/<id>` renders the freelancer view or the client view from `my_role`. `IS_CLIENT` is used only for the Judge embed (`?as=client&embed=1`), which sends `X-Act-As: client`.
  - **Client link:** the client-link boxes (now at `app.js:328` and `app.js:455`) become an "Invite client" button that posts to the invite route, shows the url with a Copy button, and shows "Nok has joined" once the `members` list has a client.
  - **Invite screen:** `#/invite/<token>` shows "<freelancer> invited you to <project> as the client", with a "Join" button that posts accept and goes to `#/p/<id>`. Error codes map to plain messages.
  - **Party fields:** remove `party` from every request body (`app.js:299, 828, 976, 983`) and `from` from change requests.
  - **Sandbox note:** a fixed note on the freelancer dashboard and the client fund screen with the exact text: "Sandbox beta: payments go to the Milestone Pay demo merchant, not your own PayPal yet."
  - **Dashboard:** two sections, "Your projects" (freelancer) and "Projects you're paying for" (client).
  - Escape every user string, as the existing `el()` helper already does.

- [ ] **Step 1: Make the changes listed above.**
- [ ] **Step 2: Run** `npm test` (the API is unchanged by this task). Expected: PASS.
- [ ] **Step 3: Browser click-through locally** with `TEST_AUTH=1 npm start`. Use the test-login form, which is shown only when `/api/config` reports `test_auth: true`; add that field to the config response. Check that:
  - User A creates a project and invites.
  - In a private window, user B accepts, approves and sees the fund screen.
  - A stranger C gets "Project not found".
  - Deleting the `mp_sid` cookie mid-flow brings you back to the same screen after logging in again.
  - Judge mode on the demo project works.
  - There are no console errors.
- [ ] **Step 4: Commit:** `feat(ui): login, roles, client invites, sandbox note`

### Task 7: Seed, e2e journey and README

**Files:**
- Modify: `scripts/e2e.js`, `README.md`, `.env.example`, `PROGRESS.md`

**Interfaces:**
- Consumes the test-login and invite routes.
- `scripts/e2e.js`:
  - Runs with `TEST_AUTH=1`.
  - Users F and C, with C joining through the invite route.
  - Stranger S runs a leak probe on every id the journey produced (expects 404 on each).
  - All existing journey checks are kept, with only the caller changed.
- `.env.example` lists every key from `loadConfig()`, with empty values.
- `README.md` sections:
  - "Beta onboarding (sandbox)": a PayPal sandbox personal account is needed for login. Freelancer flow, client flow.
  - "Deploy on Render": the two services created by hand (web `srv-dbotba95efls73euopsg` in Singapore, plus Postgres), the env table, health check path `/healthz`, disk at `/var/data`, `UPLOAD_DIR=/var/data/uploads`.
  - "PayPal app settings": enable Log in with PayPal, the scopes, both return URLs.
  - Local Postgres tests via `TEST_DATABASE_URL`.

- [ ] **Step 1: Update `scripts/e2e.js`** and run `node scripts/e2e.js`. Expected: all checks PASS, including the new leak probes and the invite flow.
- [ ] **Step 2: Run the seed on Postgres:** `npm run seed` with `DATABASE_URL` set. Check that the demo project exists after a restart (start the server and `GET /api/projects` as the demo freelancer).
- [ ] **Step 3: Update README, `.env.example` and PROGRESS.md.**
- [ ] **Step 4: Commit:** `chore: e2e as multi-user, seed on postgres, beta README`

### Task 8: Deploy and the live sandbox run (owner present)

**Files:** none, unless fixes are needed.

- [ ] **Step 1: Confirm the owner's settings** (they already set the Render env vars; ask for the names only, never the values): `NODE_ENV=production`, `APP_URL=https://milestone-pay-knv4.onrender.com`, `DATABASE_URL` (internal), `SESSION_SECRET`, PayPal ×2, the Gemini key, `GEMINI_TIER`, `API_CURRENCY=USD`, `UPLOAD_DIR=/var/data/uploads`. Also confirm the disk is mounted at `/var/data`, and that the PayPal app has Log in with PayPal on, with both return URLs.
- [ ] **Step 2: Ask the owner before pushing.** Then push `build/full-app`, point the Render service at that branch, and set the health check path to `/healthz`.
- [ ] **Step 3: Check the deploy:**
  - `curl -s https://milestone-pay-knv4.onrender.com/healthz` returns `{"ok":true,"db":"pg"}`.
  - `curl -sI` on `/` shows the CSP and HSTS headers.
  - `curl -s -X POST …/auth/test-login` returns 404.
- [ ] **Step 4: Owner-run live journey.** Two sandbox personal accounts log in. Then: create project, invite, client joins, both approve, fund through the PayPal popup, submit, Approve & pay. Copy the capture id from the project page and match it in the sandbox dashboard. On a second project: fund, then cancel, which should void. This closes Gate 2 and the "ledger ids match" DoD item. Record both ids in PROGRESS.md.
- [ ] **Step 5: Restart test:** trigger a manual redeploy in Render, and check that both projects and the session survive.
- [ ] **Step 6: Commit** the PROGRESS.md update.
