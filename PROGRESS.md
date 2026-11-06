# Progress

## Phase 0: plan
- [x] `docs/api.md`, `PLAN.md`, `PROGRESS.md` written
- [ ] `.env` present with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
- [ ] Custom agents loaded (backend-builder, ai-builder, frontend-builder, qa-tester on Sonnet)
- [x] PLAN.md approved (2026-11-06, incl. P1–P3)

## Slices
- [ ] S0 Scaffold (backend)
- [ ] S1 PayPal spike: smoke.js authorize→capture, authorize→void, capture→refund (THB / USD: _tbd_)
- [ ] S2 Extractor + vision + 3-chat eval on Haiku 5.5
- [ ] **Gate 1** reported
- [ ] S3-api agreement endpoints · [ ] S3-ui dash/paste/review/client approve
- [ ] S4 Fund (+ PayPal button UI)
- [ ] S5-api submit/review · [ ] S5-ui submit/review screens
- [ ] S6 Agent (gated tools, fallback, guardrail)
- [ ] S7-ai classifier · [ ] S7-api change requests · [ ] S7-ui scope screens
- [ ] **Gate 2**: one milestone Agreed → Authorized → Submitted → Paid in the browser (capture id: _tbd_)
- [ ] S8 seed + README · [ ] Judge mode + project page · [ ] e2e.js + bug bash

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

## Notes
- API currency: _tbd after S1_
