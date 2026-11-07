# Final QA report (2026-11-08)

Branch build/full-app. Nothing committed. New QA files: `scripts/e2e.js`, `tests/qa/{lib.mjs,serve-stub.mjs,repro-generate-bug.mjs}`, this report.

## Verdict

**Not ready to hand over.** One blocker: the first screen of the main flow ("Generate agreement" on a pasted chat) never works in the browser (BUG-1). Everything else that can be checked without a human PayPal login passes. Steps that need a real PayPal buyer approval are marked NEEDS HUMAN.

## Bugs

| # | Severity | Where | Summary |
| --- | --- | --- | --- |
| BUG-1 | **blocker** | `public/app.js` line 35 (`api()`), caller line 200 | "Generate agreement" always fails with "Could not reach the server" |
| BUG-2 | minor | `README.md` step 7 (and 2, 3, 6) | Button names/steps in README don't match the UI (list below) |
| BUG-3 | minor | `public/app.js` `releaseTrace()` ~line 943 | Release trace shows "Told both sides" twice in a row |
| BUG-4 | minor | `public/app.js` Judge mode / `public/styles.css` | `?judge=1` at 390px wide overflows horizontally (402 > 390) |
| BUG-5 | minor | `public/app.js` `viewDash()` / `routes.js` POST `/projects` | Failed or abandoned pastes leave "Untitled project · client · $0.00" rows on the dashboard (follows from BUG-1, but also from any later extract failure) |
| BUG-6 | minor | `routes.js` `POST /projects/:id/change-requests` | A change request can be raised on a `stopped` (voided) project; nothing can ever be funded there |

### BUG-1 (blocker): Generate agreement never reaches the server
- Repro: start the app, open `/#/new`, paste any chat (e.g. `Nok: hi` / `Ploy: I will do it for $800`), press **Generate agreement**. Or run `node tests/qa/repro-generate-bug.mjs <profile-dir> http://localhost:3000`.
- Expected: `POST /api/projects` then `POST /api/projects/:id/extract`, then the agreement review screen.
- Actual: red box "Could not reach the server. Check that it is running and try again." No request is sent. In the page, `fetch` throws `TypeError: Request with GET/HEAD method cannot have body`.
- Cause: `api()` picks `method: opts.method || (opts.body !== undefined ? 'POST' : 'GET')`. The upload call passes `{ form: fd }` (no `body`, no `method`), so it becomes a GET with a body. Fix: default to POST when `opts.form` is set (or pass `method: 'POST'` at line 200).
- Impact: step 2 (Paste chat) is dead in the UI for every user, including the screenshot-upload path. The "Try the demo project" path, the seed and all API calls are unaffected. The server side is fine (curl multipart works; the e2e covers it).
- Evidence the rest works once past it: I patched `window.fetch` in the test page to turn GET+body into POST and the full flow ran (chat with `<img src=x onerror=alert(1)>`, Thai and emoji rendered as text, m9 flagged, three gaps fixed, mismatch blocked, approve sent).

### BUG-2: README vs UI
| README says | UI actually has |
| --- | --- |
| Step 2: "Use **Client link** (or **Open client view**)" | "CLIENT LINK" is a section heading plus a read-only text box. Buttons are **Copy link** and **Open client view** (and **View agreement**). No button named "Client link". |
| Step 3: "press **Pay** on M1" | A heading "Pay $240.00 with PayPal" and the PayPal-rendered button inside an iframe. No button named "Pay". (The PayPal button label itself is cross-origin; I did not click it.) |
| Step 4: "press **Add files**" | "Add files" is a file-picker label, not a button. After choosing a file the button reads **Upload 1 file** (or "Upload"). |
| Step 6: "client presses **Request revision** and writes what to change" | Correct, but an extra button **Send revision request** must be pressed. Not mentioned. |
| Step 7: client does "**Request a change**" ... "(**Check against agreement**, then **Send request**)" | On the client there is only **Request a change** then **Send request**. **Check against agreement** exists only on the freelancer's "Raise a change request" form. |
| Step 8: "freelancer reviews the draft quote and sends it" | Entry button is **Review request** (project page); final button is **Send $200.00 change order to client**. Not named. |
| Step 12: "**Open in Judge mode**" | Exists only as a link on each dashboard project card (hidden while the agreement is draft/sent). The project page has a header checkbox "Judge mode (both sides)" instead. |
Matches: Try the demo project, Approve & send to client, Open client view, Submit for review, Approve & pay, Request revision, Request a change, Send request, Accept, Refresh from PayPal, Test the guardrail, "Milestone Agent runs" (section heading), Cancel & release hold.

### BUG-3 / 4 / 5 / 6 details
- BUG-3: after Approve & pay the client trace reads "Captured the held payment / Told both sides / Told both sides" (and the agent run card repeats it). The two `notify` steps (freelancer paid, client fund-next) have the same label. Cosmetic.
- BUG-4: `/?judge=1&p=<id>` at width 390: `scrollWidth` 402 vs `clientWidth` 390. All other routes at 390 and 1280 have no overflow. Judge mode is a desktop feature, so low priority.
- BUG-5: after the BUG-1 failures, drafts with no extraction appear as "Untitled project · client · $0.00" with an Open button.
- BUG-6: on the voided Baan Kafe project the client still sees **Request a change**.

## Definition of done

| Item | Result |
| --- | --- |
| Fresh clone, npm ci, npm run seed, npm start works with only .env filled | PASS for clone + `npm ci` + `npm run seed` + `npm start` (project listed, config OK; clone had no .env so `paypal_client_id` was empty, which is expected). The `.env`-filled path was exercised in the main folder. |
| All nine steps in Judge mode and with `?as=client` | **FAIL**: step 2 (BUG-1). Steps 1, 3-9 PASS as freelancer, `?as=client` and Judge mode (money steps driven with a PayPal stub; see below) |
| M1, M2, M3 authorized and captured one at a time; one revision on M2; M4 funded and paid | PASS with stub PayPal (e2e + browser). **NEEDS HUMAN** for real sandbox authorization/capture ids |
| Void path on a separate project (client never charged) | PASS with stub (e2e + browser: Cancel & release hold gives 1 void call, 0 captures, ledger VOIDED, project "Stopped"). **NEEDS HUMAN** for a real void id |
| Forged capture refused with NO_APPROVAL; m9 flagged and ignored | PASS (e2e: 0 PayPal calls; browser Test the guardrail shows "NO_APPROVAL ... PayPal calls made: 0"; m9 flag shown on review, nothing changed) |
| Ledger ids match the PayPal sandbox dashboard | NEEDS HUMAN |
| Agent fallback works when the model call is forced to fail | PASS (e2e: throwing model gives `mode: fallback, fallback_reason: model_error:...`, proposal still created, capture exactly once on approve; also `forceFallback` on `/agent/run`). The real 8 s timeout path was not exercised live |
| ai_runs shows model, tokens, cost per call; one full demo < $0.05 | PASS. Scripted e2e: 11 agent calls, $0.00231. Live e2e (`--live-ai`): 13 calls (12 agent, 1 scope), $0.004569, plus about $0.002 for one live chat extract (README figure) |
| No secrets in git history; .env.example present; README has run steps and sandbox logins | PASS: `.env` never in history (only `.env.example`, all values empty); grep of `git log -p` for `AIza`, `PAYPAL_CLIENT_SECRET=<value>`, `GOOGLE_GENERATIVE_AI_API_KEY=<value>`, `client_secret: "..."`, `BUYER_PASSWORD=<value>` found nothing (two npm integrity hashes matched a loose `EP...` pattern, false positives). `.gitignore` covers `.env*`, `db.json`, `uploads/`. README has run steps and tells the owner how to get the sandbox logins. I did not read `.env` (a value-level search was declined by the permission system, so history was checked by pattern only) |

## Journey steps (browser, freelancer / `?as=client` / Judge)

| Step | Result |
| --- | --- |
| 1 Dashboard | PASS (empty state with "Paste a chat" / "Try the demo project", totals, badge "Nok requested a change", Open in Judge mode) |
| 2 Paste chat | **FAIL** BUG-1. With a fetch shim: PASS (XSS and Thai/emoji as text, m9 flagged) |
| 3 Agreement review | PASS (3 gaps, fix chips, mismatch shows "parts add up to $810.00 but agreed total is $800.00" and disables Approve) |
| 4 Approve agreement | PASS (freelancer sent; client page shows fingerprint, Approve agreement, "Approving doesn't charge you") |
| 5 Fund milestone | PASS up to the popup: PayPal button iframes render (3), fake buyer login shown, later parts "Unlocks after M1 is paid". Never clicked. Real authorize **NEEDS HUMAN**. States after funding were created through the stub server |
| 6 Submit work | PASS (Submit disabled until upload; versions 1 and 2) |
| 7 Client reviews + pays | PASS (Approve & pay, Request revision with `<img onerror>` note rendered as text on both sides, Cancel & release hold with confirm modal; double-click gave one capture / one void) |
| 8 Scope creep | PASS (client request with `<script>` text, freelancer edits title with `<img onerror>`, price below $1.00 shows "The price must be at least 1.00", client Accept/Decline, M4 "Unlocks after M3 is paid") |
| 9 Project page | PASS (timeline, ledger, deliverables, activity, agent runs, Refresh from PayPal, Test the guardrail) |

Browser checks: no console errors on any walk apart from the expected 404/400 from deliberately bad ids and one 409 when two Submit clicks land in one JS tick (second submit is rejected ILLEGAL_TRANSITION, UI shows success). No dialogs opened (no XSS). No horizontal overflow at 390 and 1280 on dashboard, new, project, scope, client and unknown routes (only BUG-4). Error states: unknown project shows "Project not found (NOT_FOUND)" with Try again; `?as=client` without `p` shows "Ask the freelancer for the link". `/db.json`, `/.env`, `/server.js`, `/package.json`, `/.git/config`, `/uploads/` all 404; path traversal on download 404.

## e2e (`node scripts/e2e.js`): 85 passed, 0 failed
In-process `createApp({ paypal: stub, ai, agentOpts })` on a temp DB/uploads, PayPal stub records every call. Covers: Baan Kafe demo, m9 flag, fix g1, PATCH to mismatch and freelancer approve = 409 AMOUNT_MISMATCH, fix, freelancer approve, HASH_MISMATCH, client approve, M1 order (body amount ignored, db amount used) + authorize (repeat = 1 call, ORDER_MISMATCH), PNG upload (fake PNG rejected), submit, approve & pay (1 capture, ledger CAPTURED, next = M2, client notification names M2), repeat and concurrent approve = still 1 capture, M2 revision with `<img onerror>` note, withdrawn proposal can't be approved, v2 upload, re-submit, pay, client change request, freelancer edit + send, accept as M4, M4 order = 409 NOT_CURRENT until M3 paid, pay M3, fund and pay M4, dashboard paid = $1000 / held = 0 / completed, second project authorize + cancel (VOIDED, 1 void, repeat cancel = still 1, 0 client captures, project stopped), forged capture = NO_APPROVAL with 0 PayPal calls, third project with a throwing model (fallback, still captures once), prompt spy: revision note, change request text, chat text (m9, names) and file names never in any of 12 agent prompts. Final stub counts: 6 orders, 6 authorizes, 5 captures, 1 void, 0 refunds.
`node scripts/e2e.js --live-ai`: 80 passed, 0 failed (real Gemini for scope classifier and agent; prompt spy skipped), ai_runs 13 calls $0.004569.

## Real sandbox pieces (no human needed)
Real server on a temp DB, port 3055: OAuth works (order creation succeeded). `POST /api/milestones/:id/order` created sandbox order **1WL99635X5837744N** (status CREATED, amount from db = $240.00, body `amount_minor: 1` ignored; second call returned the same id). `POST /refresh` on it returned `order_status: PAYER_ACTION_REQUIRED` from PayPal. `/api/sandbox-login` returns email/password only to the local socket (by design; it is the fake buyer, shown on the pay page).
Sandbox ids seen: order 1WL99635X5837744N only. No authorization, capture or void id exists yet because buyer approval needs a human.

## Commands run
- `npm test`: 110 tests, 110 pass, 0 fail.
- `node scripts/e2e.js`: 85 pass. `node scripts/e2e.js --live-ai`: 80 pass.
- `git clone . <scratch> && npm ci && npm run seed && node server.js`: works.
- Chrome-driven walks via `tests/qa/lib.mjs` against `tests/qa/serve-stub.mjs` (real server and routes, stub PayPal, forced-fallback agent, stub scope classifier) on temp DBs.
- `git log --all -p` pattern greps, `git ls-files` check, static-file probes.

## Human steps still needed (NEEDS HUMAN)
1. Real buyer approval for M1, M2, M3, M4 (authorization ids), captures, and one real void on a separate project.
2. Compare ledger ids with the sandbox dashboard.
3. Close the PayPal popup mid-way and confirm milestone stays "Waiting for payment" and retry reuses the order (server side covered by unit tests; browser path not exercised).
4. Fix BUG-1 first, then re-run the paste-chat step in the browser.
