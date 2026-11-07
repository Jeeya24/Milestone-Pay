# Progress

## Phase 0: plan
- [x] `docs/api.md`, `PLAN.md`, `PROGRESS.md` written
- [x] `.env` present with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GOOGLE_GENERATIVE_AI_API_KEY (no Anthropic key: Gemini only, 2026-11-06); sandbox OAuth verified 2026-11-07
- [x] Custom agents loaded (backend-builder, ai-builder, frontend-builder, qa-tester on Sonnet)
- [x] PLAN.md approved (2026-11-06, incl. P1–P3)

## Slices
- [x] S0 Scaffold (backend): 2061cfb, review clean
- [ ] S1 PayPal spike: code reviewed (4b1af86); OAuth + order create verified live; authorize/capture/void needs a human buyer approval (headless login is blocked by PayPal's bot check). Card path refused: PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING
- [x] S2 Extractor + vision + 3-chat eval on Gemini 3.1 Flash-Lite: 25/25 PASS live, $0.0069 at paid rates (9dea971)
- [ ] **Gate 1** reported
- [x] S3-api agreement endpoints · [x] S3-ui dash/paste/review/client approve
- [x] S4 Fund (+ PayPal button UI)
- [x] S5-api submit/review · [x] S5-ui submit/review screens
- [x] S6 Agent (gated tools, fallback, guardrail)
- [x] S7-ai classifier · [x] S7-api change requests · [x] S7-ui scope screens
- [ ] **Gate 2**: one milestone Agreed → Authorized → Submitted → Paid in the browser (capture id: _tbd_)
- [x] S8 seed + README · [x] Judge mode + project page · [x] e2e.js + bug bash

## Journey steps (browser, Judge mode and ?as=client)
- [ ] 1 Dashboard
- [ ] 2 Paste chat
- [ ] 3 Agreement review
- [ ] 4 Approve agreement
- [ ] 5 Fund milestone
- [ ] 6 Submit work
- [ ] 7 Client reviews + pays
- [ ] 8 Scope creep
- [ ] 9 Project page

## Definition of done
- [ ] Fresh clone → npm install → npm run seed → npm start works with only .env filled
- [ ] All nine steps work in Judge mode and with ?as=client
- [ ] M1, M2, M3 authorized and captured one at a time; one revision on M2; change order M4 funded and paid
- [ ] Void path on a separate project (client never charged)
- [ ] Forged capture refused with NO_APPROVAL; m9 flagged and ignored
- [ ] Ledger ids match the PayPal sandbox dashboard
- [ ] Agent fallback works when the model call is forced to fail
- [ ] ai_runs shows model, tokens, cost per call; one full demo < $0.05
- [ ] No secrets in git history; .env.example present; README has run steps and sandbox logins

## Status 2026-11-08
All slices built and committed on branch `build/full-app`. `npm test` 110/110, `node scripts/e2e.js` 85/85 (PayPal stubbed), browser bug bash clean after fixes (reports/final.md).
**Still needs a human:** one real sandbox run through the PayPal popup (authorize → submit → approve & pay → capture id; cancel → void) and a look at the ids in the sandbox dashboard. Gate 2 and the "ledger ids match PayPal" DoD item stay open until then.

## Notes
- API currency: **USD** (owner decision 2026-11-07). `API_CURRENCY` env overrides. Demo fixture and eval priced in USD.
- 2026-11-07: dependencies were never installed (`npm ci` fixed the failing test). Test Lab (`/lab.html`, `/api/lab`) and `Start Milestone Pay.command` launcher added (86321a6).
- 2026-11-07: owner asked for the full app per SPEC, built with the builder agents. Round 1 = S3-api+S4 (backend) ∥ S3-ui+fund UI (frontend).
