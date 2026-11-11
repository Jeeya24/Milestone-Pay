# Milestone Pay API contract (MVP)

Source: the wireframe's `HOOD{}` plus its action functions, with SPEC.md taking priority on money handling, security and models. Builders follow this exactly. A change goes through the orchestrator, who edits this file first.

## Conventions

- JSON in and out. Errors always use the shape `{ "error": "CODE", "message": "human text" }` with the HTTP status listed.
- Money is an **integer number of minor units** in every field ending `_minor`. **The app currency is USD** (owner decision 2026-11-07; `API_CURRENCY` env, default `USD`), so $240.00 is `24000` cents. Never use floats. The conversion to a PayPal string (`"240.00"`) happens only inside `paypal.js`. The frontend formats with `Intl.NumberFormat` using the currency in the data. An extracted agreement whose currency differs from `API_CURRENCY` is rejected with `422 CURRENCY_MISMATCH` (message tells the user to write the price in USD). Older examples below that say THB/satang read as USD/cents.
- **Ids are globally unique random strings** (`prj_…`, `ms_…`, `agr_…`, `pay_…`, `dlv_…`, `prop_…`, `cr_…`). The display labels `M1`, `M2`… live in `label`. A label is never used as an id, a PayPal `custom_id` or part of a `PayPal-Request-Id`, because labels repeat across projects and seed runs.
- Chat message ids inside a project are `m1`, `m2`… (`msg_id`). They are what citation chips point to.
- Day 1 has no auth. The browser sends `party: "freelancer" | "client"` where an action depends on the role. The client view is `?as=client&p=<project_id>`.
- `transition()` failures return **409** `ILLEGAL_TRANSITION`.
- Times are ISO 8601 strings.
- Every user-supplied string (chat, notes, change requests, edited titles) is returned raw and **escaped by the frontend on render**.

## Milestone state machine (owned by `db.js` `transition()`)

| From | To | Triggered by |
| --- | --- | --- |
| `draft` | `agreed` | both parties approve the same agreement hash |
| `agreed` | `authorized` | `POST /milestones/:id/authorize` succeeds (current milestone only). The client is charged here; `authorized` means funded and held by Milestone Pay |
| `authorized` | `submitted` | `POST /milestones/:id/submit` |
| `revision_requested` | `submitted` | `POST /milestones/:id/submit` after a re-upload |
| `submitted` | `revision_requested` | `POST /milestones/:id/revision` |
| `submitted` | `paid` | `release_payment` with a `release` proposal approved by the client |
| `authorized`, `submitted`, `revision_requested` | `voided` | `refund_payment` with a `refund` proposal the client asked for and the freelancer approved. `voided` means cancelled |
| `paid` | `refunded` | `create_refund` (gated; not in the UI for the MVP) |

Every other move throws. An accepted change order inserts a new milestone directly in `agreed`; that is a creation, not a transition.

**Current milestone** = the lowest-`seq` milestone whose status is not `paid`. Only the current milestone can be funded, submitted or reviewed. If the current milestone is `voided`, the project is stopped and nothing later can be funded.

**Hold (2026-11-11, owner decision):** funding captures the payment straight away, so the money sits on the Milestone Pay PayPal account with no expiry. It leaves the hold in two ways only: the client approves the work (payout to the freelancer), or the client asks for a refund and the freelancer accepts it (refund to the client). Nothing ends a hold automatically and the client cannot cancel alone. Payments funded before this change are PayPal authorizations (`payment.status: AUTHORIZED`, with `expires_at`); they are still captured on approval, voided on an accepted refund, and are the only payments `refresh` can move to `voided` when PayPal reports them expired.

## Objects

```jsonc
// Milestone (API shape)
{ "id":"ms_x", "project_id":"prj_x", "label":"M1", "seq":1, "title":"Design mockups",
  "amount_minor":240000, "currency":"THB", "status":"agreed",
  "criteria":["Mockup for each of the 4 pages"], "rev_count":0, "rev_limit":2 /* null until gap g1 is fixed */,
  "rev_note":null, "is_current":true, "fundable":true,
  "start_day":0, "end_day":3,                      // timeline bars, days from project start
  "payment": { "order_id":"5O…", "capture_id":"3C6…", "refund_id":null, "authorization_id":null, "expires_at":null,
               "status":"HELD" /* CREATED | HELD (charged at funding, held by Milestone Pay) | CAPTURED (released to the
                                  freelancer) | REFUNDED | older payments only: AUTHORIZED, VOIDED */ } | null,
  "refund_request": { "id":"prop_x", "action":"refund", "status":"pending|approved|declined", "requested_by":"client" } | null,
  "deliverables":[ /* current version only */
    { "id":"dlv_x", "version":1, "filename":"mockup-home.png", "size":123, "mime":"image/png",
      "sha256":"…", "download_url":"/api/deliverables/dlv_x/download" } ],
  "versions":1 }

// Activity row
{ "id":"act_x", "at":"…", "project_id":"prj_x", "who":"ai|pp|agent|client|free|sys", "text":"…" }
// Ledger row (totals are computed from these, never stored)
{ "id":"led_x", "at":"…", "project_id":"prj_x", "milestone_id":"ms_x", "label":"M1",
  "event":"HELD|CAPTURED|PAID_OUT|REFUNDED (older payments: AUTHORIZED|VOIDED)", "paypal_id":"…", "amount_minor":240000 }
// Notification (fixed templates, no model)
{ "id":"ntf_x", "at":"…", "project_id":"prj_x", "to":"client|freelancer", "text":"M1 is paid. Fund M2 Build website (3,200 THB) so Ploy can start." }
// Agent run
{ "id":"run_x", "event":"milestone.submitted|proposal.approved|proposal.refund_accepted", "milestone_id":"ms_x",
  "mode":"model|fallback", "steps":[ { "tool":"get_order", "args":{…}, "result":{…}, "ok":true } ], "at":"…" }
// Proposal
{ "id":"prop_x", "milestone_id":"ms_x", "action":"release|refund", "status":"pending|approved|executed|withdrawn|declined",
  "reason":"…", "approved_by":"client"|null, "created_at":"…" }
```

## Endpoints

### Config and demo
- `GET /api/config` → `200 { paypal_client_id, currency:"USD", api_currency:"USD", env:"sandbox", budget:{ today_cost_usd, limit_usd:1, blocked:boolean } }`. The client id is public by design; no secret is ever returned.
- `GET /api/sandbox-login` → `200 { email, password }` of the **fake sandbox buyer** from `.env`, only when the request comes from localhost (else `403 FORBIDDEN`). The client's fund screen shows it next to the PayPal button so a tester knows what to type in the popup. Already implemented in `lab.js` as `/api/lab/test-login`; S4 adds this alias in `server.js`.
- `/api/lab/*` and `public/lab.html` are the older single-page Test Lab. Leave them working; do not build on them.
- `POST /api/demo` → `201 { project_id }`. Creates the Baan Kafe project from `fixtures/baan-kafe.txt` and runs extract. It uses a cached extraction from `fixtures/baan-kafe.extract.json` if that file exists, otherwise a live call.

### Step 1: Dashboard
- Project `status` (computed, never stored): `draft` (no freelancer approval) · `sent` (freelancer approved, client not yet) · `active` · `completed` (every milestone paid/refunded) · `stopped` (current milestone voided). Test Lab projects are hidden.
- `GET /api/projects` → `200 { projects:[ { id, title, freelancer, client, total_minor, status, milestones:[{id,label,status}], open_change_request:{ id, from, status }|null } ], totals:{ held_minor, paid_minor, not_funded_minor } }`
  - `held_minor` = the amount of every milestone whose latest ledger event is `HELD` (or `AUTHORIZED` for older payments).
  - `paid_minor` = `CAPTURED` minus any `REFUNDED` of a payment that had been released. Refunding a payment that was only held changes `held_minor`, not `paid_minor`.
  - `not_funded_minor` = the amount of milestones in `draft` or `agreed`.
  - The badge shows when `open_change_request.from === "client"` and `status === "open"`.

### Step 2: Paste chat
- `POST /api/projects` multipart: `chatText?` (string), `freelancer_name?` (string ≤60, the freelancer's name as it appears in the chat; default `"Ploy"`; text chats need it to mark `me`), `files[]?` (up to 10 files, 20 MB each, `.txt .jpg .jpeg .png`, checked by extension **and** magic bytes)
  → `201 { project:{ id, title:null, status:"draft" }, messages:[ { msg_id:"m1", seq, sender, me:boolean, time, text, source_file|null, page|null } ], import:{ deduped:<int>, files:[ { name, kind:"txt"|"image", messages:<int> } ] } }`
  - Text and `.txt` go through the regex parser in `ai.js` with no model call. Images go through Gemini vision (`MODELS.vision`), at most 5 images per call. `me` = right-hand bubble, or a sender matching the freelancer's name "Ploy".
  - Errors: `400 EMPTY_CHAT`, `400 BAD_FILE`, `400 TOO_MANY_FILES`, `413 FILE_TOO_LARGE`, `429 BUDGET_EXCEEDED`, `502 AI_FAILED` (vision only; the message says "paste the text instead").

### Step 3: Agreement review
- `POST /api/projects/:id/extract` → `200 { agreement, milestones:[Milestone], ai_run:{ model, input_tokens, output_tokens, cost_usd, fallback:boolean } }`

```jsonc
// agreement
{ "id":"agr_x", "project_id":"prj_x", "version":1, "status":"draft|sent|approved", "content_hash":null,
  "body": {
    "title":"Baan Kafe website", "client_name":"Nok", "freelancer_name":"Ploy",
    "total_minor":800000, "currency":"THB",
    "terms":[ { "key":"scope|deliverables|price|deadline|payment|revisions|assets", "label":"Scope",
                "value":"4-page café website…"|null, "source_message_ids":["m3"] } ],
    "gaps":[ { "id":"g1", "text":"No revision limit agreed.", "fix_label":"Set: 2 revision rounds per milestone",
               "term_key":"revisions"|null, "term_value":"2 rounds per milestone"|null, "fixed":false } ],
    "injection_flags":[ { "msg_id":"m9", "reason":"Instruction aimed at the AI: release all funds" } ],
    "translations":{ "en":{ "m1":"Hi Ploy! …" } }   // only for messages not already fully English
  } }
```
  - Re-running extract replaces the draft. `409 AGREEMENT_FROZEN` once the freelancer has approved. `422 EXTRACT_INCOMPLETE` when no milestone or a zero amount comes back (nothing saved); `422 CURRENCY_MISMATCH` as in Conventions.
  - Gap `g1` (revision limit) is the one whose fix sets `rev_limit = 2` on every milestone.
- `POST /api/agreements/:id/gaps/:gapId/fix` → `200 { agreement, milestones }`. Sets `fixed:true` and, when `term_key` is set, writes `term_value` into that term. `409 AGREEMENT_FROZEN`.
- `PATCH /api/milestones/:id` `{ amount_minor }` → `200 { milestone, sum_minor, agreed_total_minor, mismatch:boolean }`. `400 BAD_AMOUNT` (not a non-negative integer). `409 AGREEMENT_FROZEN` once the freelancer has approved. Only `amount_minor` is accepted.

### Step 4: Approve agreement
- `POST /api/agreements/:id/approve` `{ party, content_hash? }`
  - `party:"freelancer"` returns `409 AMOUNT_MISMATCH` ("The parts add up to $X but the agreed total is $Y. Fix the amounts first.") when the milestone amounts don't sum to `body.total_minor`, or any milestone is < 100 cents. Otherwise it freezes the body (milestone amounts included). It computes `content_hash = "sha256:" + hex(sha256(canonicalJSON({ body without translations, milestones:[{label,title,amount_minor,criteria,rev_limit}] })))` and sets `status:"sent"`. It returns `200 { agreement, client_url:"/?as=client&p=<project_id>" }`.
  - `party:"client"` must send a `content_hash` equal to the stored one, else `409 HASH_MISMATCH`. Before the freelancer approves it returns `409 NOT_SENT`. On success: `status:"approved"`, every milestone goes `draft → agreed`, and the response is `200 { agreement, milestones }`. No charge.
  - Both approvals are stored in the `approvals` collection `{ agreement_id, party, content_hash, at }`. Unknown `party` → `400 BAD_PARTY`.

### Step 5: Fund milestone
- `POST /api/milestones/:id/order` (any request body is ignored) → `200 { order_id, status:"CREATED" }`.
  - Creates a PayPal order with `intent: "AUTHORIZE"`, `custom_id = milestone id`, the amount from the db, and `PayPal-Request-Id: order-<milestone id>-<attempt>`.
  - Idempotent: if a CREATED order already exists for this milestone, it returns that order.
  - Errors: `409 NOT_CURRENT` (not the current milestone, or status ≠ `agreed`), `409 AGREEMENT_NOT_APPROVED`, `502 PAYPAL_ERROR { paypal_debug_id }`.
- `POST /api/milestones/:id/authorize` `{ order_id }` → `200 { milestone, payment:{ order_id, capture_id, status:"HELD", expires_at:null } }`.
  - The order is created with `intent: CAPTURE`; this call captures it (`POST /v2/checkout/orders/:id/capture`, `PayPal-Request-Id: ordcap-<order_id>`), so the client is charged now. Stores the capture id, runs `transition(→authorized)`, and writes ledger row `HELD` and an activity row. (The path keeps its old name.)
  - Errors: `409 ORDER_MISMATCH`, `409 NOT_CURRENT`, `502 PAYPAL_ERROR`. A repeat call after success returns the same payment (no second capture).

### Step 6: Submit work
- `POST /api/milestones/:id/deliverables` multipart `files[]` (`.pdf .png .jpg .jpeg .zip .mp4`, 20 MB each, extension + magic bytes) → `201 { deliverables:[…], version }`.
  - `version = rev_count + 1`. Older versions are kept.
  - Allowed only in `authorized` or `revision_requested`, else `409 NOT_SUBMITTABLE`. File errors: `400 BAD_FILE`, `413 FILE_TOO_LARGE`.
- `POST /api/milestones/:id/submit` → `200 { milestone, proposal, agent_run }`.
  - Runs `transition(→submitted)` and emits `milestone.submitted`. The agent runs synchronously: `get_order`, then `propose_release`, with the 8-second fallback.
  - Errors: `409 NO_FILES` (no deliverable at the current version), `409 ILLEGAL_TRANSITION`.

### Step 7: Client reviews and pays
- `GET /api/deliverables/:id/download` (`?inline=1` to view in the browser) streams the file from `./uploads`. It sets `Content-Disposition` and the stored mime type, and refuses path traversal. Never a static folder.
- `POST /api/agent/run` `{ event, milestone_id }` → `200 { agent_run }`. Manual re-run and debugging. The event is one of the three names above.
- `POST /api/proposals/:id/approve` `{ party:"client" }` → `200 { proposal, milestone, payment:{ capture_id, status:"CAPTURED" }, agent_run, next:{ milestone_id, label, title, amount_minor }|null }`.
  - Sets proposal `approved`, then fires `proposal.approved`. The agent runs `release_payment` (gated) and `notify` (freelancer: paid; client: fund the next milestone).
  - `release_payment` makes no capture call (the money was captured at funding): it marks the payment `CAPTURED`, adds ledger row `CAPTURED` with the capture id, withdraws any pending refund request and sends the payout. Older `AUTHORIZED` payments are captured first (`PayPal-Request-Id: cap-<authorization_id>`).
  - Errors: `409 PROPOSAL_NOT_PENDING`; repeat approvals never release or pay out twice.
- `POST /api/milestones/:id/revision` `{ note, items?:string[] }` → `200 { milestone }`.
  - Status becomes `revision_requested`, `rev_count+1`, `rev_note` stored (≤1000 chars). The pending proposal becomes `withdrawn`; the hold stays.
  - Errors: `400 NOTE_TOO_SHORT` (<5 chars after trim), `409 REVISION_LIMIT` (`rev_limit` set and `rev_count >= rev_limit`).
  - **The note is never passed to the agent.**
- Refund of a held payment. The money leaves the hold early only when the client asks **and** the freelancer accepts. (`POST /api/proposals/:id/cancel` is removed: the client cannot cancel alone.)
  - `POST /api/milestones/:id/refund-request` (client; body ignored) → `201 { milestone, refund_request }`. Allowed in `authorized`, `submitted`, `revision_requested`, else `409 NOT_HELD`. Inserts a `refund` proposal `pending` (`requested_by:"client"`); a repeat returns the open one. No money moves and the status does not change.
  - `POST /api/proposals/:id/withdraw-refund` (client) → `200 { milestone, refund_request }` (`withdrawn`).
  - `POST /api/proposals/:id/decline-refund` (freelancer) → `200 { milestone, refund_request }` (`declined`). The money stays held; the client may ask again.
  - `POST /api/proposals/:id/accept-refund` (freelancer) → `200 { milestone, payment:{ status:"REFUNDED", refund_id, … }, agent_run }`. Sets the proposal `approved` (`approved_by:"freelancer"`), then fires `proposal.refund_accepted`; the agent runs `refund_payment` (gated: client request + freelancer approval, else `NO_APPROVAL`) with `PayPal-Request-Id: ref-<capture_id>`, moves the milestone to `voided`, adds ledger row `REFUNDED` with the refund id and notifies both. An older `AUTHORIZED` payment is voided instead (`VOIDED`). `502 PAYPAL_ERROR` changes nothing and the same call retries.
  - Errors: `409 PROPOSAL_NOT_PENDING` (not a refund request, or already answered), `403 WRONG_ROLE`.
- `POST /api/agent/guardrail-test` `{ milestone_id }` → `200 { result:{ error:"NO_APPROVAL" }, proposal_id:"prop_forged_…", trace:"…" }`. Calls the real `release_payment` executor with a forged proposal id. It never calls PayPal.

### Step 8: Scope creep (one open request per project)
- `POST /api/projects/:id/change-requests` `{ message, from:"client"|"freelancer" }` → `201 { change_request }`.
  - Runs the classifier on the frozen agreement summary plus the request (in `<untrusted_request>`), never the chat.
  - Errors: `400 MESSAGE_TOO_SHORT` (<5), message capped at 1000 chars, `409 OPEN_REQUEST_EXISTS`, `409 AGREEMENT_NOT_APPROVED`.

```jsonc
{ "id":"cr_x", "project_id":"prj_x", "from":"client", "text":"…", "status":"open|sent|accepted|declined|closed",
  "classification":"in_scope|revision|new_work", "reason":"…", "reason_source_ids":["m3"],
  "ai_draft":{ "label":"M4", "title":"Online ordering page", "deliverables":["…"], "amount_minor":200000, "price_basis":"8,000 THB ÷ 4 pages" } | null,
  "draft": { /* same shape, freelancer-editable */ } | null,
  "sent_version": { /* frozen copy */ } | null, "milestone_id":null, "created_at":"…" }
```
- `PATCH /api/change-requests/:id` `{ title?, deliverables?, amount_minor? }` → `200 { change_request }`. Only when `status:"open"`, else `409 FROZEN`. Title and each deliverable are trimmed to ≤120 chars.
- `POST /api/change-requests/:id/send` → `200 { change_request }`. Freezes `sent_version`. Errors: `400 TITLE_REQUIRED`, `400 DELIVERABLE_REQUIRED`, `409 NOT_NEW_WORK`.
- `POST /api/change-requests/:id/close` → `200 { change_request }`. For `in_scope` or `revision` verdicts, where there is nothing to price.
- `POST /api/change-requests/:id/decide` `{ accept:boolean }` → `200 { change_request, milestone|null }`. Accept creates milestone `M<n+1>` in `agreed`, with the amount, title and criteria from `sent_version`. `409 NOT_SENT`.

### Step 9: Project page
- `GET /api/projects/:id` → `200 { project, agreement, approvals, messages, milestones, ledger, activity, notifications, agent_runs, change_requests, ai_cost:{ calls, cost_usd } }`
- `POST /api/projects/:id/refresh` → `200 { payments:[ { milestone_id, order_status, authorization_status, capture_status } ] }`. Uses toolkit `get_order` per payment; the db is updated only to match PayPal and goes through `transition()`. It never ends a hold on a payment captured at funding; it can mark a funding capture the db missed as `HELD`, and retries a failed payout.

### AI accounting
- `GET /api/ai-runs?date=YYYY-MM-DD` → `200 { runs:[ { at, task, model, input_tokens, output_tokens, cost_usd, latency_ms, fallback } ], total_cost_usd }`
- `db.js` exports `logAiRun(row)` and `todayCostUsd()`. The budget guard throws `BUDGET_EXCEEDED` (HTTP 429) when `todayCostUsd() >= 1`.

## Extra error codes (added during build)
`400 BAD_PARTY` (party not allowed for that action), `400 BAD_EVENT` (agent/run), `400 BAD_AMOUNT` (PATCH milestone / change request, send), `400 BAD_DELIVERABLES`, `400 BAD_REQUEST` (`accept` not boolean), `409 NOT_NEW_WORK` (PATCH/send on a non-new-work request), `409 NOT_CURRENT` (submit/revision on a non-current milestone), `422 EXTRACT_INCOMPLETE`, `422 CURRENCY_MISMATCH`, `409 AMOUNT_MISMATCH`, `409 PROJECT_STOPPED` (change request on a project whose current milestone was voided).

## Agent notes (S6 as built)
- The model gets one response (`MAX_STEPS = 1` in agent.js) and emits all tool calls at once, executed in order; code completes any skipped notify/money step. Multi-step fails on `@ai-sdk/google@1` ("Function call is missing a thought_signature").
- Agent run rows also carry `model, input_tokens, output_tokens, cost_usd, summary, fallback_reason`.
- `get_order` uses `paypal.getOrder` (REST, same auth as the toolkit).
- Notifications are fixed templates chosen by name (`paid_freelancer`, `fund_next_client`, `refunded_both`, `review_client`, `problem_freelancer`) and refused unless the state matches.

## Internal module interfaces

```js
// db.js
load(): DB; save(): void                                        // atomic: write db.json.tmp then rename
id(prefix): string
transition(milestone, to, patch?): Milestone                     // throws {code:'ILLEGAL_TRANSITION'}
currentMilestone(projectId): Milestone|null
logAiRun({task, model, input_tokens, output_tokens, cost_usd, latency_ms, fallback}): void
todayCostUsd(): number
activity(projectId, who, text): void; ledgerAdd(row): void; notify(projectId, to, text): void

// paypal.js
toolkit                                                          // PayPalAgentToolkit, whitelist orders.get + payments.createRefund/getRefunds
toMoney(amount_minor, currency): {currency_code, value}          // the only satang → string conversion
createAuthOrder(milestone, attempt): Promise<{id,status,links}>
createCaptureOrder(milestone, attempt): Promise<{id, status}>   // intent CAPTURE
captureOrder(orderId): Promise<{capture_id, status}>           // charges the client at funding
authorizeOrder(orderId): Promise<{authorization_id, status, expires_at}>   // older flow, Test Lab only
captureAuth(authId): Promise<{id, status}>
voidAuth(authId): Promise<{status}>
refundCapture(captureId, amount_minor?): Promise<{id, status}>
getOrder(orderId): Promise<object>

// ai.js
parseChatText(text, {freelancerName}): Message[]
transcribeImages(files:[{path, name, mime}]): Promise<{messages, usage}> // Gemini vision, ≤5 per call; messages unnumbered, caller runs dedupeMessages then numbers m1..mN
dedupeMessages(messages): {messages, removed}                   // key: sender + text + time
extractAgreement(messages): Promise<{body, milestones, usage}>
classifyChange(agreementSummary, request): Promise<{classification, reason, reason_source_ids, ai_draft}>
withFallback(task, fn): Promise<any>                            // in models.js or ai.js

// agent.js
runAgent(event, milestoneId, {forceFallback?}): Promise<AgentRun>
tools: { get_order, propose_release, release_payment, refund_payment, notify }
```

## Design-system journey (2026-11-09)
The frontend follows the Milestone Pay design system (boards O1–O5 onboarding, 01–10 app). PayPal is the only sign-in; every client has an account.

- `GET /api/session` → `200 { user|null }`. Public. The app shell asks it on load (no 401 for a logged-out visit).
- `GET /api/me` / `PATCH /api/me` → `{ user }`. The user now carries the profile: `display_name, roles[], active_role, skills[], bio, client_type, hire_for[], onboarded`.
  PATCH body (strict, zod): `{ role?, add_role?, display_name? (1–60), skills? (≤12), bio? (≤160), client_type? ("individual"|"business"), hire_for? (≤12), finish? }`.
  `finish:true` sets `onboarded`; needs a role (`ROLE_REQUIRED`), a name, and for freelancers one skill (`SKILL_REQUIRED`). Bad input → `400 BAD_PROFILE`.
  Roles here only pick the home screen (Your projects / Your jobs); who may act on a project is still `project_members`.
- `GET /api/invite-preview/:token` → `200 { project:{id,title}, freelancer:{name}, total_minor, currency, parts }`. Public: the agreement link’s sign-in screen. Same errors as the invite (`404`, `409 INVITE_USED`, `410 INVITE_EXPIRED`). `GET /api/invites/:token` returns the same extra fields.
- `POST /api/agreements/:id/notes` `{ text }` (2–500 chars) → `201 { note:{id,from,text,at}, notes }`. Either member, only while the agreement is `sent` (`409 NOT_SENT`). Untrusted text: never sent to the agent or a model. `GET /api/projects/:id` returns `notes`.
- `GET /api/milestones/:id/download-all` → the current version’s files as one zip (members only; `404` when there are none).
- `GET /api/projects` rows add `currency, deadline, agreement_status, held_minor, paid_minor, paid_count, current:{id,label,title,status,amount_minor,fundable}|null, updated_at`; names come from display names. The response adds `client_totals:{held_minor, paid_minor}` for projects where the user is the client.

## Fix list (2026-11-10)
Owner decision: the copy says the money is **held by Milestone Pay** (PayPal is how it is paid in and paid out).

- `GET /api/projects` rows add `archived` (this member archived it). `POST /api/projects/:id/archive` `{ archived: boolean }` → `{ id, archived }`. Either member; hides it from their own list only.
- `DELETE /api/projects/:id` → `{ ok }`. Freelancer only. Erases every row and file of the project. `409 ACTIVE_HOLDS` while a milestone is funded; `409 HAS_PAYMENTS` once any milestone was paid (archive instead).
- `PATCH /api/projects/:id` `{ title }` (1–80) → `{ project }`. Freelancer only. While the agreement is a draft it also sets `agreement.body.title`; after version 1 is locked only the project name changes (the hash stays valid). The UI shows `project.title` first.
- `PATCH /api/milestones/:id` now takes any of `{ amount_minor?, title? (1–120), criteria? (≤12 strings ≤200) }`, draft only. Other keys are ignored. `400 BAD_MILESTONE` / `BAD_AMOUNT`.
- `POST /api/agreements/:id/milestones` `{ title? }` → `201 { milestones }` (new draft milestone, amount 0, appended; up to 12, `409 TOO_MANY_MILESTONES`). `DELETE /api/milestones/:id` → `{ milestones }` (relabelled M1..Mn; `409 LAST_MILESTONE`). Both draft only (`409 AGREEMENT_FROZEN`).
- Invites: one lasting link per project. `POST /api/projects/:id/invites` returns the same `{ url }` every time (`201` when first made, `200` after), before and after the client joins. It has no expiry and is not single-use: preview, `GET /api/invites/:token` and `accept` keep working. The first person to accept becomes the client; anyone else then gets `409 CLIENT_TAKEN`. `INVITE_USED` now means the link was replaced (old hash-only links).
- Project chat: opens when the client asks for a revision (the note becomes the first message). `POST /api/projects/:id/chat` `{ text }` (1–1000) → `201 { message:{id,from,kind,text,at}, chat }`; `409 CHAT_NOT_OPEN` before that. `GET /api/projects/:id` returns `chat: [...] | null`. Untrusted text: never sent to the agent or a model.
- Profiles: `user.avatar_url` on `/api/me` and `/api/session`. `POST /api/me/avatar` (multipart field `avatar`, .jpg/.png checked by magic bytes, ≤ 400 KB; the browser shrinks it to 256 px) → `{ user }`; `DELETE /api/me/avatar`. `GET /api/users/:id/avatar` and `GET /api/users/:id` → `{ profile:{id, display_name, roles, skills, bio, client_type, hire_for, avatar_url, member_since} }`, only for yourself or someone you share a project with (else `404`). Never the email. `members[]` on the project adds `user_id, avatar_url`. Clients can set `bio` too.
- Account deletion: `DELETE /api/me` → `{ ok, scheduled_for, days: 15 }`. Logs the user out everywhere and erases the data after 15 days (`purgeDueAccounts`, run at start and hourly). Logging in before then cancels it (`/auth/paypal/callback` redirects with `?login=restored`; test-login returns `restored: true`). Still `409 ACTIVE_HOLDS` with money on hold; an account that gains a hold during the wait is erased once it settles.
- Payout: after a release the agent calls `paypal.createPayout` (Payouts API, `sender_batch_id = payout-<capture_id>`) to send the amount to the freelancer's PayPal email. Same gate as the release (paid milestone + executed release proposal). `milestone.payment` adds `payout_status` (`SENT` | `FAILED` | null) and `payout_batch_id`; the ledger adds a `PAID_OUT` row. A failed payout never undoes the capture and is retried by `POST /api/projects/:id/refresh`.

## Invoices (2026-11-10)
One invoice per milestone, issued automatically when its payment has gone the whole way: funded by the client, approved by the client **and** paid out to the freelancer (`payout_status: SENT`). Not before, and never for a cancelled milestone.

- `milestone.invoice` → `{ number, issued_at, url } | null` on every milestone view. `number` is `INV-<yyyymmdd>-<last 8 of the capture id>`.
- `GET /api/milestones/:id/invoice` → the invoice as one self-contained HTML page (prints to a single page; "Print or save as PDF" button). `?download=1` sends it as a file (`<number>.html`). Either member of the project; others get `404`. `409 INVOICE_NOT_READY` until it is issued.
- The record is stored on the payment row (`payment.invoice`) with the names, title, description and amount as they were when it was issued, so later renames do not change it. It shows names and PayPal order / capture / payout references, never emails. All text is escaped.

## Fix list 2 (2026-11-11, items 18-24)
- Deleting a project is now a 15-day restorable delete. `DELETE /api/projects/:id` → `{ ok, restore_until, days: 15 }`: the project disappears for both members at once (every route answers `404`, the invite link stops working) and is erased by `purgeDueProjects` (start-up and hourly) when the window ends. Same refusals as before (`ACTIVE_HOLDS`, `HAS_PAYMENTS`).
- `GET /api/projects/deleted` → `{ projects:[{ id, title, client, deleted_at, restore_until }], days }`: the caller's own deleted freelance projects still inside the window. `POST /api/projects/:id/restore` → `{ project }` (freelancer who owns it; `404` otherwise or once erased).
- No other API change. UI only: the client list is called "Hired projects" (route still `#/jobs`); the client's `#/p/:id/change` page lists every request and its outcome; the freelancer's change-requests page puts earlier requests before a corner "Check a request from chat" box; the project page merges files into expandable milestone rows; Settings has "Archived and deleted projects"; wording says "chat" / "messaging app" instead of naming LINE or WhatsApp.
