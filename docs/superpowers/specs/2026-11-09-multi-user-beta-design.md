# Multi-user sandbox beta: auth, Postgres, Render

Date: 2026-11-09 · Status: draft for owner review · Deadline: Nov 12, 18:00 Bangkok

## Goal

Turn the single-tenant hackathon MVP into a hosted app that real beta freelancers and their clients can sign up for and use against the PayPal **sandbox**, with each user seeing only their own projects.

Success means:
1. A stranger opens the Render URL, logs in with a PayPal sandbox account, pastes a chat and gets an agreement.
2. They invite their client; the client logs in with a different PayPal sandbox account and runs approve → fund → review → pay.
3. A third user can't see, read or act on either user's project (404).
4. Every existing journey step and money rule still holds; `npm test`, `scripts/e2e.js` and `scripts/smoke.js` pass against Postgres.

## Decisions (owner, 2026-11-09)

| Topic | Decision |
| --- | --- |
| Users | Real beta freelancers and clients, sandbox only, with live payments in mind for later |
| Login | **Log in with PayPal** for everyone (freelancers and clients) |
| Client access | Full signup: the client logs in before seeing or approving anything |
| Hosting | Render web service + Render Postgres + Render persistent disk for uploads |
| Payouts | **Scope cut for Nov 12:** single payee. Every capture still lands in the platform's sandbox merchant account (the REST app owner). Multiparty seller onboarding is the next project |
| New dependencies | `pg` only. Auth, sessions, rate limiting and headers are written by hand |

## Out of scope

- Per-freelancer payouts (Partner Referrals, `payee.merchant_id`, `PayPal-Auth-Assertion`). The `projects.payee_merchant_id` column exists but is always null; `paypal.js` ignores it until that project.
- Live PayPal, KYC, tax, compliance.
- Email sending. Invites are links the freelancer copies and shares (LINE/WhatsApp, same as today).
- Webhooks. The "Refresh from PayPal" button stays the way to sync.
- Object storage (R2). Uploads stay on disk.
- React or other frontend frameworks.

Because of the single payee, the UI shows a fixed sandbox note on the freelancer dashboard and fund screen: "Sandbox beta: payments go to the Milestone Pay demo merchant, not your own PayPal yet."

## Architecture

```
browser ──cookie mp_sid──▶ Express 5 (server.js)
                              ├─ middleware: securityHeaders, originCheck, rateLimit, loadSession
                              ├─ /auth/*            auth.js   (Log in with PayPal, logout)
                              ├─ /api/*             routes.js (requireUser + requireRole on every route)
                              ├─ /healthz
                              └─ static public/
                         db.js (async repo over pg Pool, transition() in a transaction)
                         paypal.js (unchanged REST, sandbox)  ai.js / agent.js (unchanged logic)
Render Postgres ◀─ migrations/*.sql applied on boot
Render disk /var/data/uploads
```

### New and changed files

| File | Change |
| --- | --- |
| `config.js` (new) | zod schema for env, parsed once at boot; process exits with the list of missing keys. Never logs values |
| `pg.js` (new) | `Pool` from `DATABASE_URL` (SSL on Render), `tx(fn)` helper, `migrate()` that applies `migrations/NNN_*.sql` in order and records them in `schema_migrations` |
| `migrations/001_init.sql` (new) | All tables below |
| `db.js` | Same exported names, now `async`. `transition()` takes a client from `tx()` and locks the milestone row with `SELECT … FOR UPDATE` |
| `auth.js` (new) | Log in with PayPal routes, session create/lookup/destroy, `requireUser`, `requireRole` |
| `security.js` (new) | headers + CSP, Origin check for non-GET, in-memory token-bucket rate limiter |
| `routes.js` | Every handler awaits db calls, takes the actor from `req.user` + project membership, and drops `party` / `from` from request bodies |
| `server.js` | Wires middleware, `/auth`, `/healthz`; runs `migrate()` before `listen` |
| `seed.js` | Creates demo users and the Baan Kafe project in Postgres; flags it `is_demo` |
| `render.yaml` (new) | Web service, Postgres, disk, env var placeholders |
| `public/app.js`, `index.html` | Login screen, session-aware nav, invite accept, "Invite client" copy-link, sandbox payee note |
| `lab.js` | Mounted only when `NODE_ENV !== 'production'` |

## Persistence model (revised 2026-11-09 during planning)

The current code reads and writes a synchronous in-memory store: about 30 `db.load()` call sites, with arrays reassigned through `filter`. Rewriting every handler to use async SQL before Nov 12 is the highest-risk part of the original plan. Instead:

- **Postgres is the durable store, and memory is the working copy.** At boot, `db.connect()` runs the migrations and loads every table into the same in-memory shape the code uses today. `db.save()` keeps its synchronous signature and queues a flush. The flush diffs each collection against what was last persisted and upserts changed rows, deletes removed ones, and runs in a single transaction.
- **Nothing is reported as done before it's stored.** The response is held until the pending flush commits. If the flush fails, the request returns `500 PERSIST_FAILED` and the process exits so Render restarts it from Postgres. `SIGTERM` flushes before exit.
- **Single instance.** The Render disk already forces this. Money concurrency keeps the existing in-process `serial()` locks plus the idempotent `PayPal-Request-Id`. A row lock (`FOR UPDATE`) isn't needed with one writer, so the async-`transition()` rewrite is dropped.
- **With no `DATABASE_URL` (unit tests, local quick runs), the JSON file backend stays as it is.** `NODE_ENV=production` requires `DATABASE_URL`.
- **Moving off a single instance later** (multiparty, R2) means replacing this layer with per-request SQL. That's out of scope here.
- **`render.yaml` is dropped.** The owner created the services by hand, so the README documents them instead.

## Data model

All money columns are `bigint` minor units. *(Under the persistence model above, each existing collection is a table `(rid text pk, project_id text, data jsonb, updated_at)`. Money stays an integer inside `data`, and the uniqueness rules are enforced in code as they are today. The column lists below describe the logical shape.)* Ids keep the current prefixed random strings (`prj_…`) as `text` primary keys, so API shapes don't change. JSON-ish fields (citations, criteria, steps) are `jsonb`.

New tables:

```sql
users(id text pk, paypal_user_id text unique not null, email text, name text,
      created_at timestamptz, last_login_at timestamptz)
sessions(id_hash text pk, user_id text fk users, created_at, expires_at, ip text, user_agent text)
project_members(project_id text fk, user_id text fk, role text check (role in ('freelancer','client')),
                primary key (project_id, role))          -- one freelancer, one client per project
invites(id text pk, project_id text fk, token_hash text unique, created_by text fk users,
        expires_at timestamptz, used_by text fk users null, used_at timestamptz null)
schema_migrations(version text pk, applied_at timestamptz)
```

The existing 14 collections become tables with the same field names: `projects`, `agreements`, `approvals`, `messages`, `milestones`, `payments`, `deliverables`, `proposals`, `ledger`, `activity`, `notifications`, `agent_runs`, `change_requests`, `ai_runs`.

Additions to existing tables:
- `projects.owner_id` (the freelancer user), `projects.is_demo boolean`, `projects.payee_merchant_id text null` (unused until multiparty)
- `approvals.user_id`, `payments.payer_user_id`, `ai_runs.user_id`
- Unique `(project_id, seq)` on milestones; unique `payments.order_id`; unique `(milestone_id, version, filename)` on deliverables

## Auth: Log in with PayPal

Sandbox setup (owner, once): in the developer dashboard, enable **Log in with PayPal** on the REST app, choose scopes `openid email profile`, and set the return URL to `${APP_URL}/auth/paypal/callback`. These are the same `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` as today.

Flow:
1. `GET /auth/paypal/start?next=/path` sets a 10-minute `mp_oauth` cookie holding a random `state` plus `next` (an internal path only; anything else becomes `/`). The cookie is HMAC-signed with `SESSION_SECRET`, which is that variable's only use. It then redirects to `https://www.sandbox.paypal.com/signin/authorize?flowEntry=static&client_id=…&response_type=code&scope=openid email profile&redirect_uri=…&state=…`.
2. `GET /auth/paypal/callback?code&state` checks `state` against the cookie, then posts to `/v1/oauth2/token` (`grant_type=authorization_code`, Basic auth with the client credentials). Next it calls `/v1/identity/openidconnect/userinfo?schema=openid` with the returned access token. The PayPal access token is used once and discarded, never stored.
3. Upsert `users` on `user_id` from userinfo, then create a session: 32 random bytes, of which we store only the sha256. The browser gets `mp_sid` as `HttpOnly; Secure; SameSite=Lax; Path=/`, with a 14-day expiry. The session id is rotated on every login, and the user is redirected to `next`.
4. `POST /auth/logout` deletes the session row and clears the cookie. `GET /api/me` returns `{ user:{ id, name, email } }`, or `401 UNAUTHENTICATED`.

Local dev uses the same flow with the return URL `http://localhost:3000/auth/paypal/callback`, which is added as a second return URL in the sandbox app. `Secure` is set only when `APP_URL` starts with `https`.

Tests and e2e use `TEST_AUTH=1` (refused when `NODE_ENV=production`), which adds `POST /auth/test-login { name }`. It creates or reuses a user and sets the cookie, so the suites don't need PayPal for login.

## Authorization

- `requireUser` sends `401 UNAUTHENTICATED` without a valid session. Every `/api/*` route uses it except `/api/config`.
- `requireRole(role?)` resolves the project from `:id`, or from the milestone, agreement, proposal, change request or deliverable's `project_id`. It loads `project_members` for `req.user`. If the user isn't a member, the response is **404 NOT_FOUND**, never 403, so ids don't leak. If they're a member with the wrong role, the response is `403 WRONG_ROLE`.
- The role comes from membership. Request bodies no longer carry `party` or `from`, and old clients that still send them are ignored.

| Action | Role |
| --- | --- |
| create project, extract, edit milestones, fix gaps, freelancer approve, upload, submit, edit/send change request, create invite | freelancer |
| client approve, order, authorize, approve proposal (capture), cancel (void), request revision, decide change request | client |
| view project, download deliverables, raise change request, refresh from PayPal | either |
| `GET /api/projects` | lists projects where the user is a member, each tagged with `my_role`. Totals are computed per role: held/paid/not funded as the freelancer, plus a separate client section |

The agent and proposal gates are unchanged. `capture_authorization` still requires an approved proposal row, and on top of that the approving `user_id` must be the project's client member.

### Invites

- `POST /api/projects/:id/invites` (freelancer) returns `201 { url }`. The url is `${APP_URL}/invite/<token>`, where the token is 32 random bytes stored as a hash with a 7-day expiry. Calling it again revokes the previous unused invite.
- `GET /invite/:token` sends the visitor to log in if needed, then calls `POST /api/invites/:token/accept`. That makes the user the project's client if the client slot is empty, the user isn't the freelancer, and the invite is unused and unexpired.
- Errors: `410 INVITE_EXPIRED`, `409 INVITE_USED`, `409 CLIENT_TAKEN`, and `409 SELF_INVITE` when the freelancer tries to be their own client.

### Demo and Judge mode

The seeded Baan Kafe project (`is_demo`) belongs to a seeded demo freelancer and demo client. "Load demo project" makes the **current user** a freelancer on a fresh copy, with a demo client user attached. Judge mode is allowed only on `is_demo` projects; there, the client-side actions run as the demo client member. That keeps the judge walkthrough working without letting it leak into real projects.

## Money (single payee)

Unchanged:
- Amounts come only from the database.
- Every write sends `PayPal-Request-Id`.
- Only the current milestone can be funded.
- Every status change goes through `transition()`.
- Capture, void and refund need an approved proposal (`NO_APPROVAL`).

New:
- `transition()` runs inside `tx()` with a row lock. Two concurrent "Approve & pay" clicks serialize: the second one sees `paid` and throws `ILLEGAL_TRANSITION`, and the idempotent `PayPal-Request-Id` keeps PayPal from capturing twice.
- `payments.payer_user_id` records who authorized the payment.
- `authorize` checks that the PayPal order's `custom_id` matches the milestone id before saving it, so one milestone can't be funded with an order made for a different milestone.

## AI

- `ai_runs.user_id` is set on every call.
- Budgets: the global daily cap of $1 stays, and there's a new per-user daily cap (`AI_USER_DAILY_USD`, default $0.25). Hitting either returns `429 BUDGET_EXCEEDED`.
- **Before inviting real beta users, set `GOOGLE_GENERATIVE_AI_API_KEY` to a paid-tier key.** The free tier may train on prompts, and real chats contain names and prices. `config.js` warns at boot when `GEMINI_TIER` isn't `paid` and `NODE_ENV=production`.
- Unchanged: chat, revision notes and change requests are never sent to the agent.

## Production hardening

- **Config:** zod-validated env. Required: `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`. Optional: `UPLOAD_DIR` (default `./uploads`, `/var/data/uploads` on Render), `AI_USER_DAILY_USD`, `GEMINI_TIER`.
- **Headers:**
  - `Content-Security-Policy` allows `self`, plus `https://www.paypal.com`, `https://www.sandbox.paypal.com` and `*.paypalobjects.com` for the button script and frames.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, and HSTS when on https.
- **CSRF:** non-GET requests to `/api` or `/auth` must send an `Origin` that equals `APP_URL`, or get `403 BAD_ORIGIN`. SameSite=Lax cookies are the second layer.
- **Rate limits** (in memory; fine for a single Render instance):
  - `/auth/*`: 20 per minute per IP.
  - AI routes (create project, extract, change-request classify): 10 per minute per user.
  - Everything else: 120 per minute per user.
  - Over the limit returns `429 RATE_LIMITED`.
- **Uploads:** existing extension, magic-byte and size checks stay. Files go under `UPLOAD_DIR/<project_id>/`, and downloads check membership.
- **Logging:** one JSON line per request with method, route, status, ms and user id. Never log cookies, auth headers, OAuth codes or env values. 500s log the error message and stack only.
- **Ops:**
  - `/healthz` returns 200 after a `SELECT 1`.
  - `render.yaml`: a starter web plan (needed for a disk), Postgres basic, a 1 GB disk at `/var/data`, `npm ci` build, `node server.js` start.
  - Render handles daily Postgres backups.
  - Migrations run on boot inside a transaction with an advisory lock.
- **Data deletion:** `DELETE /api/me` removes the user's sessions and memberships, and deletes their freelancer projects that have no `authorized` or `submitted` milestones. This is a basic beta courtesy, not GDPR tooling.

## Testing

- **Unit tests** (`npm test`):
  - Run against a real Postgres via `TEST_DATABASE_URL`, with each test file in its own schema that's dropped afterwards.
  - Local runs use `docker run postgres:16`. The README gives the one-liner.
  - All 110 existing tests are ported to async.
- **New tests:**
  - **Auth:** sessions, the callback state check, open-redirect protection on `next`, expiry, logout.
  - **Access control:**
    - Cross-tenant access gets 404 on every route family.
    - Role matrix: each freelancer-only and client-only action returns 403 for the wrong role.
    - Invites: expired, used, client slot taken, self-invite.
    - Judge mode refused on non-demo projects.
  - **Concurrency:** a concurrent double-capture produces exactly one PayPal call.
  - **Request checks:** wrong `Origin` is refused, and the rate limiter returns 429.
- **Scripts:**
  - `scripts/e2e.js` runs the full journey as two test-login users with PayPal stubbed, plus a third user who probes for leaks.
  - `scripts/smoke.js` runs against the real sandbox, unchanged.
- **Manual:** on the deployed Render URL, log in with two sandbox personal accounts, then run invite → fund via the popup → submit → approve & pay → see the capture id in the sandbox dashboard. **This also closes Gate 2.**

## Delivery order (deadline-safe)

1. **Postgres + async db.** All tests green on Postgres, with the app still behaving as single-user. Nothing is deployed until this step.
2. **Auth + membership + invites,** plus the access-control tests.
3. **Hardening + `render.yaml` + deploy.** Includes the sandbox return URL setup and the real popup run (Gate 2).
4. **UI polish** for login, invite and the sandbox payee note, and a README update with beta onboarding steps.

If time runs out after step 2, the submission can still run locally with auth. If it runs out after step 1, the current branch's demo is unaffected because nothing is merged to `main` until a step is green.

## Open risks

- **Log in with PayPal sandbox approval.** Sandbox apps can usually enable it right away. If the dashboard requires a review, we fall back to the `TEST_AUTH` login, behind an invite-only flag on the hosted beta, until it's approved.
- **Render disk means a single instance.** Fine for a beta. R2 comes with the multiparty project.
- **Single payee confuses beta freelancers.** Handled with the fixed UI note. Multiparty onboarding is the first follow-up.
