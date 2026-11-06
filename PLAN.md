# Milestone Pay MVP: Implementation Plan

> **For agentic workers:** this plan runs as orchestrator-driven, subagent-based development (superpowers:subagent-driven-development). Each slice goes to its owning agent with a self-contained brief. QA verifies the slice, the orchestrator reviews the diff against `docs/api.md` and `CLAUDE.md`, then commits (`slice S4: fund milestone`) and ticks `PROGRESS.md`.

**Goal:** a minimal, fully working nine-step journey on the PayPal sandbox. Paste a chat, get an agreement, both parties approve, then for each milestone fund → submit → review → pay. Includes the revision loop, void, scope creep (M4) and the project page, at wireframe fidelity.

**Architecture:** one Express 5 server with a `db.json` store, where `transition()` owns every milestone status. `paypal.js` makes our own REST calls (authorize, capture, void) plus `@paypal/agent-toolkit` for `get_order` and refunds. `ai.js` and `models.js` make the Vercel AI SDK calls. `agent.js` is an event-driven tool-calling agent whose money tools are gated in code. `public/` is vanilla JS grown from the wireframe.

**Tech stack:** Node 22+ (local is v24.18), Express 5, multer, dotenv, zod, archiver (installed, unused in the MVP), ai@4, @ai-sdk/google@1, @paypal/agent-toolkit. Tests use the built-in `node:test` (no new dependency).

**Spec:** `SPEC.md` (money, security, models), `milestone-pay-wireframe_final.html` (screens, flow), `docs/api.md` (the contract derived from both), `CLAUDE.md` (hard rules).

## Global constraints

- Money is integer satang in every `_minor` field. `paypal.js` `toMoney()` is the only place that makes a decimal string.
- PayPal is called from the server only. Amounts are read from `db.json`, and any amount in a request body is ignored.
- Every PayPal write sends `PayPal-Request-Id` with an `order-`, `auth-`, `cap-`, `void-` or `ref-` prefix. Keys are built from **unique ids**, never from `M1`-style labels.
- Every status change goes through `transition()`. Only the current milestone (lowest `seq` not `paid`) can be funded.
- `capture_authorization` and `void_authorization` check for an approved proposal row in code, else they return `NO_APPROVAL`.
- Chat, revision notes and change requests are untrusted. They are wrapped in `<untrusted_chat>` / `<untrusted_request>` and never reach the agent.
- Models come from `models.js` only. Google Gemini only: `gemini-3.1-flash-lite` handles extract, vision, agent, scope, translate and fallback (fallback = one retry on the same model). Free tier is for demo data only. Cost is computed at Gemini paid rates ($0.25 / $1.50 per 1M) so the budget guard stays meaningful. Every call is logged to `ai_runs`, and calls stop at $1/day.
- `MAX_OUT`: extract 3500, vision 600, scope 800, translate 1200, agentStep 400. Temperature 0. Agent `maxSteps: 4`, fallback after 8 s.
- Escape all user text on render. Secrets only via `process.env`; never printed, logged or committed.
- Uploads: chat import is `.txt .jpg .jpeg .png`, ≤10 files, ≤20 MB. Deliverables are `.pdf .png .jpg .jpeg .zip .mp4`, ≤20 MB. Extension **and** magic bytes are checked.
- Run commands: `npm install`, `npm run seed`, `npm start`, `npm test`, `node scripts/smoke.js`, `node scripts/e2e.js`.

## Review focus (inputs no slice test covers on its own; each now has a test in its owning slice)

1. **Double clicks and retries on money endpoints.** A second `/authorize`, `/proposals/:id/approve` or `/cancel` must return the first result and never authorize or capture twice. Tests are in S4 and S6.
2. **The browser tampering with money.** An `amount_minor` sent to `/order`, or a `PATCH` after the freelancer approved, must have no effect: `409 AGREEMENT_FROZEN`, and the order amount equals the db amount. Tests are in S3-api and S4.
3. **HTML or script in Thai/emoji chat, revision notes and change-order titles.** `<img src=x onerror=alert(1)>` must render as text on every screen. Tests are in S3, S5-ui and S7-ui.
4. **The buyer closes the PayPal popup or the authorize call fails.** The milestone stays `agreed`, an error shows, and the retry reuses the same order. Tests are in S4 and S5-ui.
5. **A crash or restart mid-write.** `db.json` is written atomically (temp file plus rename) and reloads cleanly. The S0 test kills the process mid-save.

## Spec ↔ wireframe conflicts resolved

| # | Conflict | Resolution | Rule applied |
| --- | --- | --- | --- |
| C1 | The wireframe's HOOD and code use Sonnet 5.5 and Sonnet cost numbers | Gemini 3.1 Flash-Lite for every task, through `models.js` (owner decision 2026-11-06: no Anthropic API) | Owner decision overrides SPEC |
| C2 | The wireframe accepts HEIC and PDF chat imports; SPEC adds `heic-convert` | MVP takes TXT, JPG and PNG only. No `heic-convert`, which isn't in CLAUDE.md's allowed deps anyway | Kickoff scope |
| C3 | The wireframe and SPEC have a zip download and an "Under the hood" panel | Both cut from the MVP (kickoff). Single-file view and download stay | Kickoff scope |
| C4 | The wireframe offers 55 translation languages | English only, returned by the extract call. The language picker shows English / Off | Kickoff scope |
| C5 | The wireframe's "Cancel & release hold" voids directly; SPEC requires an approved proposal for void | Cancel creates a client-approved `void` proposal, then the agent's gated `void_authorization` runs. The button stays in the review card, as in the wireframe | SPEC wins on money |
| C6 | The wireframe uses `M1` as the milestone id and `custom_id` | Unique `ms_…` ids; `M1` is a display `label` | SPEC wins (idempotency keys must not collide across projects or reseeds) |
| C7 | The wireframe's dashboard totals include a `verified` status | No such status. Totals come from ledger rows per SPEC | SPEC wins on money |
| C8 | Gap fixes, the guardrail button, cancel, change-order send/decide and the refresh endpoint are missing from HOOD | Added to `docs/api.md` as small endpoints matching the wireframe's actions | Wireframe flow, new routes |
| C9 | The wireframe's revision clears the file list | Old versions are kept in `deliverables`; the UI shows only the current version as empty until re-upload | SPEC (versioned) + wireframe (screen) |
| C10 | The wireframe's "verify" prompt and AI deliverable check | Cut per SPEC; the client judges the work | SPEC |
| C11 | Change-request verdicts `in_scope` / `revision` have no screen in the wireframe | Show the verdict and reason with a "Close" button; only `new_work` gets a priced draft | Wireframe flow, extended minimally |

## Proposed changes to the kickoff (need your OK)

- **P1 · Builder unit tests.** TDD needs builders to write tests, but `tests/` belongs to QA. Proposal: builders write `tests/unit/<slice>.test.js` for their own modules, and QA owns `tests/qa/`, `scripts/e2e.js` and `reports/`.
- **P2 · `fixtures/`.** A new folder owned by `backend-builder` for the Baan Kafe chat and the cached extraction, used by `POST /api/demo`, `seed.js` and the evals. `ai-builder` reads it.
- **P3 · Chat parsing in `ai.js`.** The text and `.txt` parser and the dedupe step are plain code, but they belong with the import pipeline, so `ai-builder` owns them.

## File ownership

| Agent | Files |
| --- | --- |
| backend-builder | `package.json`, `server.js`, `db.js`, `paypal.js`, `agent.js`, `seed.js`, `fixtures/`, `scripts/` (not `e2e.js`), `.gitignore`, `.env.example`, `README.md`, `tests/unit/{s0,s1,s4,s5,s6}*` |
| ai-builder | `ai.js`, `models.js`, `prompts/`, `evals/`, `tests/unit/{s2,s7}*` |
| frontend-builder | `public/` |
| qa-tester | `tests/qa/`, `scripts/e2e.js`, `reports/` |
| orchestrator | `PLAN.md`, `PROGRESS.md`, `docs/api.md`, `CLAUDE.md`, integration fixes under ~20 lines |

## Order and parallel pairs

```
Phase 1:  S0 (backend) ─┬─ S1 PayPal spike (backend)        ┐ gate: smoke.js THB passes + 3-chat eval passes
                        └─ S2 extractor + eval (ai)         ┘ → report to you
Phase 2:  S3-api (backend: projects/extract/gaps/PATCH/approve/demo) ─┬─ S3-ui (frontend: dash, paste, review, client approve)
          S4 fund (backend) ── S5-api submit/review (backend)        ─┬─ S7-ai classifier (ai)
          S6 agent (backend)                                          ─┬─ S5-ui submit/review screens (frontend)
          S7-api change requests (backend)                            ─┬─ S7-ui scope screens (frontend)
          gate: one milestone Agreed → Authorized → Submitted → Paid in the browser, real capture id
Phase 3:  S8 seed + README (backend) ┬ Judge mode + polish pass (frontend) ┬ e2e.js + bug bash (QA)
          gate: Definition of done → report to you
```

At most two builders run at once, plus QA. Pairs never share files.

## Slices

Each slice brief to a subagent includes: the goal, owned files, the copied `docs/api.md` sections, the tests below, the verify command, and "report: files, endpoints, commands run with output, sandbox ids, open questions".

### S0 · Scaffold (backend)
**Files:** `package.json` (`"type":"module"`, scripts start/seed/test/smoke/e2e, engines `>=22`), `server.js`, `db.js`, `.env.example`, `fixtures/baan-kafe.txt` (the 9 wireframe messages in `Name: text` form), `tests/unit/s0.db.test.js`.
**Produces:** the `db.js` interface in `docs/api.md`, `GET /api/config`, static `public/`, the JSON error middleware, `GET /api/ai-runs`.
**Tests:**
- `transition` allows every row of the state table and throws `ILLEGAL_TRANSITION` on `draft→paid`, `agreed→submitted`, `paid→voided`.
- `currentMilestone` returns the lowest `seq` that isn't `paid`.
- `save` is atomic: after a simulated crash between the temp-file write and the rename, `load()` returns the previous valid state.
- `todayCostUsd` sums only today's `ai_runs`.
- `GET /api/config` never contains the secret.

**Verify:** `npm test` passes; `npm start`, then `curl localhost:$PORT/api/config` returns 200.

### S1 · PayPal spike (backend), parallel with S2
**Files:** `paypal.js`, `scripts/smoke.js`, `tests/unit/s1.money.test.js`.
**Produces:** the `paypal.js` interface. If the toolkit's `client.getHeaders()` isn't usable, fetch the OAuth token directly from `/v1/oauth2/token` (no new dependency) and record that.
**Tests:**
- `toMoney(240000,'THB')` gives `{currency_code:'THB', value:'2400.00'}`.
- `toMoney(1,'THB')` gives `'0.01'`.
- `toMoney(2.5)` throws.

**Smoke test:** three flows, each printing the approval URL and waiting for Enter (or Playwright if it is installed and the buyer login is in `.env`):
1. order → approve → authorize → capture
2. order → authorize → void
3. capture → refund

All in THB, each printing real ids. If THB fails, rerun in USD, set `api_currency`, and record it in `PROGRESS.md`.
**Verify:** `node scripts/smoke.js` ends with `SMOKE PASS` and lists the order, authorization, capture, void and refund ids.

### S2 · Extractor + vision + eval (ai), parallel with S1
**Files:** `models.js` (MODELS, MAX_OUT, PRICES, `withFallback`), `ai.js`, `prompts/extract.md`, `prompts/vision.md`, `evals/` (Baan Kafe text, one plain English chat, one from 2 overlapping PNG screenshots), `evals/run.js`, `tests/unit/s2.parse.test.js`.
**Consumes:** `db.logAiRun`, `db.todayCostUsd`.
**Produces:** `parseChatText`, `transcribeImages`, `dedupeMessages`, `extractAgreement`, matching the `agreement.body` shape in `docs/api.md`.
**Tests:**
- `parseChatText` on `fixtures/baan-kafe.txt` returns 9 messages, `m1..m9`, with Ploy marked `me`.
- It handles LINE (`21:02\tNok\ttext`) and WhatsApp (`[06/11/26, 21:02] Nok: text`) lines.
- `dedupeMessages` removes the repeated overlap lines.
- `withFallback` retries once on a 429, a timeout or a zod failure.
- The budget guard throws `BUDGET_EXCEEDED` when stubbed at $1.

**Eval (live, Gemini 3.1 Flash-Lite):**
- Baan Kafe: price 800000 cited to m5; deadline cited to m6; scope cited to m3; revisions null with gap g1; 3 milestones summing to 800000; m9 flagged; every Thai message has an English translation.
- The other chats: price and deadline correct.

**Verify:** `node evals/run.js` prints PASS per field, plus tokens and cost per call.

### S3 · Agreement pages
**S3-api (backend):**
- `POST /api/projects` (multer, magic bytes), `POST /api/projects/:id/extract`, `GET /api/projects`, `GET /api/projects/:id`, gaps fix, `PATCH /api/milestones/:id`, `POST /api/agreements/:id/approve`, `POST /api/demo`.
- Tests:
  - the hash is stable for an identical body and changes when any amount changes;
  - client approval with a wrong hash returns `409 HASH_MISMATCH`;
  - `PATCH` after the freelancer approves returns `409 AGREEMENT_FROZEN`;
  - fixing g1 sets `rev_limit:2`;
  - a `.png`-named text file returns `400 BAD_FILE`.

**S3-ui (frontend):**
- Screens: `vDash`, `vNew` (Back confirm modal), `vReview` (citation chips highlight messages, English translation toggle, gap one-tap fixes, editable amounts with mismatch warning, m9 flag) and the client's `vClient` approve section.
- Routing: `?as=client&p=`.
- Check: the chat line `<img src=x onerror=alert(1)>` renders as text.

### S4 · Fund (backend)
**Files:** `server.js` (`/order`, `/authorize`), `scripts/smoke.js` (fund step via the API), `tests/unit/s4.fund.test.js` (PayPal stubbed).
**Tests:**
- `/order` on M2 while M1 isn't paid returns `409 NOT_CURRENT`.
- An `amount_minor` in the body is ignored, so the order amount equals the db amount.
- A second `/order` returns the same `order_id`.
- A second `/authorize` returns the same `authorization_id` and makes no second PayPal call.
- A PayPal error leaves the status `agreed`.

**Verify:** a live run through `smoke.js --fund` against `npm start` shows a real authorization id stored and ledger `AUTHORIZED`.
**UI part (frontend, alongside S5-ui):** the JS SDK button loaded from `/api/config` with `intent=authorize&currency=THB`. It calls only our two endpoints, shows the error on `onError`/`onCancel`, and the "after the previous part is paid" lock works.

### S5 · Submit + review (backend, then frontend)
**S5-api:**
- Endpoints: deliverables upload, submit, download (`?inline=1`), revision.
- Submit calls `agent.runAgent('milestone.submitted', id)`; it is a stub until S6 lands.
- Tests:
  - a revision with fewer than 5 characters returns `400 NOTE_TOO_SHORT`;
  - the third revision with `rev_limit` 2 returns `409 REVISION_LIMIT`;
  - a re-upload after a revision is `version 2` and v1 rows still exist;
  - `../` in a download id returns 404;
  - an `.exe` renamed `.pdf` returns `400 BAD_FILE`;
  - submit with no files returns `409 NO_FILES`.

**S5-ui:**
- Screens: `vSubmit`, client proposal card (view/download files, Approve & pay, Request revision with rounds left, Cancel & release hold), `vRelease` trace.
- Checks:
  - a revision note containing HTML renders as text;
  - after the payment, the "Fund M2" prompt appears from notifications.

### S6 · Agent (backend; plan mode, money moves)
**Files:** `agent.js`, `prompts/agent.md` (ai-builder writes it in S7-ai, which runs before S6), proposal endpoints, guardrail endpoint, `tests/unit/s6.agent.test.js`.
**Tools:** `get_order` (toolkit), `propose_release`, `capture_authorization`, `void_authorization`, `notify`. The model input is the event plus state JSON only.
**Tests:**
- A forged proposal returns `NO_APPROVAL` and makes zero PayPal calls.
- A `pending` (not approved) proposal also returns `NO_APPROVAL`.
- With `forceFallback`, the same tool sequence runs and the run is marked `mode:'fallback'`.
- With a model stub that sleeps 9 s, the fallback runs.
- Approving twice captures once.
- The state passed to the model contains no `rev_note`, chat text or change-request text (asserted by serializing the prompt).
- After a capture, a client notification names the next milestone.

**Verify:** a live sandbox run: submit → proposal → approve → real capture id in the ledger. Cancel on another milestone shows `VOIDED`.

### S7 · Scope creep
**S7-ai:**
- Files: `classifyChange`, `prompts/scope.md`, `prompts/agent.md`, eval case.
- The Thai ordering-page request returns `new_work`, `amount_minor 200000`, cites m3.
- "Make the menu photos brighter" returns `revision`.
- A Gemini failure (429, timeout, zod) retries once on `MODELS.fallback` (same model).

**S7-api (backend):**
- Endpoints: create, PATCH, send, close, decide.
- Tests:
  - a second open request returns `409 OPEN_REQUEST_EXISTS`;
  - PATCH after send returns `409 FROZEN`;
  - accept creates `M4 agreed` funded separately, and M4 is current only after M3 is paid;
  - both `ai_draft` and `sent_version` are stored.

**S7-ui:**
- Screens: `vScope` editable draft (title, deliverables, price, "edited" pill, reset), dashboard badge, client "Request a change" form and accept/decline card.
- Check: a title containing HTML renders as text.

### S8 · Harden
- **Backend:** `seed.js` resets `db.json` with the Baan Kafe project (cached extraction, so seeding needs no AI call); README with run steps, sandbox logins placeholder, the statement that PayPal holds funds, and the AI tools; `npm run seed`.
- **Frontend:** Judge mode (freelancer desktop + client phone, both live, polling `GET /api/projects/:id` every 2 s), `vProject` timeline with blocked bars, ledger, deliverables, "Refresh from PayPal", the guardrail button, and empty, loading and error states everywhere.
- **QA:** `scripts/e2e.js` runs the full journey from the kickoff (M1, M2 with a revision, M3, M4 change order, void project, forged capture, forced fallback) and prints the `ai_runs` total.
- **Gate:** the Definition of done in `PROGRESS.md`, verified by the orchestrator in the browser.

## Risks to watch

- `gemini-3.1-flash-lite` model id, prices and free-tier rate limits are taken from SPEC (a demo burst may hit free-tier 429s); S2 confirms them live. `models.js` holds a `PRICES` table, so cost is computed from real usage.
- PayPal THB authorizations may be refused in the sandbox; S1 decides THB vs USD before any UI work.
- `@paypal/agent-toolkit` 1.11's AI SDK adapter shape (`getTools()`, `client.getHeaders()`) is unverified; S1 confirms it and falls back to a direct OAuth fetch.
- Sandbox buyer approval needs a human (you) in S1, S4, S6 and S8 unless Playwright and the buyer login are present.
