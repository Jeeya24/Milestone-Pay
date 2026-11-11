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

## Multi-user beta (2026-11-09), plan docs/superpowers/plans/2026-11-09-multi-user-beta.md
- [x] T1 Postgres write-through store (`npm run test:pg` 9/9 on Render DB, throwaway schema)
- [x] T2 Log in with PayPal + sessions + config
- [x] T3 per-project roles on every route · [x] T4 client invites, demo users, Judge act-as
- [x] T5 CSP, origin check, rate limits, per-user AI budget, /healthz, DELETE /api/me
- [x] T6 UI: login, invites, roles, sandbox note (headless Chrome click-through 24/24)
- [x] T7 e2e as 3 users 88/88, seed on Postgres verified, README
- [ ] T8 deploy to https://milestone-pay-knv4.onrender.com + live sandbox run (owner present). Closes Gate 2.

## Design-system frontend (2026-11-09)
- [x] Backend: profile/onboarding (`PATCH /api/me`), `/api/session`, invite preview, agreement notes, zip download, richer dashboard rows, CSP for Geist (`npm test` 172/172)
- [x] Frontend rebuilt on the design system (`public/ds/` tokens, components, icons): O1 welcome → O2 Continue with PayPal → O3 role → O4a/O4b setup → O5 all set; 01 projects, 01b Your jobs, 02 paste chat, 03 review + lock + link + notes, 04 approve, 05 payments/fund, 06 submit, 07 review & pay + activity, 08 change requests, 09 project page, 10 settings + logout; phone layout by media query
- [x] `tests/qa/journey-ui.cjs`: freelancer desktop + client phone, invite → approve → fund → deliver → pay → change order → logout, 13/13, no console errors. `node scripts/e2e.js` 88/88.

## Fix list 2026-11-10 (owner PDF, 17 items)
- [x] 1 archive + delete on project rows · 2 "Something else" opens a text box · 3 delete account (15 days, login cancels)
- [x] 4/5 reading copy · 6 role chip removed · 7 long buttons wrap inside cards · 8 project title editable · 9 fingerprint hidden
- [x] 10 one lasting, reusable client link · 11 project chat from a revision request · 12 "held by Milestone Pay" copy
- [x] 13 client payments two-column desktop layout · 15 add/remove milestones (up to 12) · 16 milestone title + description editable · 17 profile pictures + profiles
- [ ] 14 payout to the freelancer's PayPal after capture: built and unit-tested with a stub. **Not run against the sandbox** (no credentials in the build session). Needs Payouts enabled on the REST app and one real run.
- [x] Invoices: issued per milestone once funded, client-approved, captured and paid out; view + download for both people (`invoice.js`).
- Ran: `npm test`, `scripts/e2e.js` (PayPal stubbed), `tests/qa/journey-ui.cjs` and `tests/qa/fixes-ui.cjs` in headless Chromium, no console errors.

## Fix list 2, 2026-11-11 (owner PDF, items 18-24)
- [x] 18 client sees past requests + outcomes · 19 freelancer change-requests page: earlier requests first, paste box in the corner · 20 "Your jobs" → "Hired projects"
- [x] 21 no LINE/WhatsApp wording · 22 long email wraps in the account menu · 23 archived + deleted projects in Settings, 15-day restore
- [x] 24 project page redesign (header links, copy-invite icon, slim next step, files inside milestone rows, timeline toggle, "you" wording)
- Ran: `npm test`, `scripts/e2e.js`, `tests/qa/journey-ui.cjs`, `tests/qa/fixes-ui.cjs` (headless Chromium, no console errors). PayPal stubbed.

## Phone pass, 2026-11-11
- [x] `tests/qa/phone-ui.cjs`: 58 screens (both roles, every project state, dialogs, onboarding, invoice, landing) at 390px and 360px. Fails on sideways scroll, anything past the screen edge, tap targets under 36px, or a console error. 116/116.
- Fixed: status badge overflow at 360px, small tap targets, three tall total cards (now two across), client payments (action before summary), timeline labels, request tables as cards, settings rows, invoice header, home link in the account menu, stray "null" in the skills picker.

## Status 2026-11-08
All slices built and committed on branch `build/full-app`. `npm test` 110/110, `node scripts/e2e.js` 85/85 (PayPal stubbed), browser bug bash clean after fixes (reports/final.md).
**Still needs a human:** one real sandbox run through the PayPal popup (authorize → submit → approve & pay → capture id; cancel → void) and a look at the ids in the sandbox dashboard. Gate 2 and the "ledger ids match PayPal" DoD item stay open until then.

## Notes
- API currency: **USD** (owner decision 2026-11-07). `API_CURRENCY` env overrides. Demo fixture and eval priced in USD.
- 2026-11-07: dependencies were never installed (`npm ci` fixed the failing test). Test Lab (`/lab.html`, `/api/lab`) and `Start Milestone Pay.command` launcher added (86321a6).
- 2026-11-07: owner asked for the full app per SPEC, built with the builder agents. Round 1 = S3-api+S4 (backend) ∥ S3-ui+fund UI (frontend).
