# Milestone Pay — Hackathon Build Spec

Nov 6, 2026 · @Jeeya Dugar

## TL;DR

Build one loop and make it repeat: **paste a LINE/WhatsApp chat or upload screenshots → AI agreement with citations, gaps and an English translation → freelancer adjusts milestone prices → both approve a hashed version → client authorizes M1 with PayPal (a hold) → freelancer uploads files → the agent asks the client to review → client approves and the agent captures the payment.** M2, M3 and any accepted change order run the same loop, one at a time. The client judges the work; there is no AI review of deliverables.

| Decision | Locked choice |
| --- | --- |
| Deadline | Nov 12, 12:00 PST = **Nov 13, 03:00 Bangkok**. Submit by Nov 12, 18:00 Bangkok |
| Source of truth | The wireframe (`milestone-pay-wireframe_final.html`). Its "Under the hood" panel is the API contract |
| MVP stack | Node 22 + Express 5, vanilla HTML/JS grown from the wireframe, one `db.json` file |
| Upgrade path | Render deploy, Bryntum, webhooks, Postgres, React: only after the loop works |
| AI | Claude Haiku 5.5 for extract, vision and the agent; Gemini 3.1 Flash-Lite free tier for scope and extra translations; all via the Vercel AI SDK. Details in Cheapest model plan |
| PayPal | `@paypal/agent-toolkit` (TypeScript, AI SDK adapter) for `get_order` and refunds; our own REST calls for authorize, capture and void |
| Money model | Client authorizes each milestone, PayPal holds it, capture pays the freelancer's own account. We never hold funds |
| Who judges the work | The client. The AI deliverable check is cut |
| Sponsor prize target | Bryntum (Gantt replaces the CSS timeline after day 1) |
| Honorable mention target | Best Use of Agentic Commerce, then Best Use of PayPal + AI |

**Still open:** eligibility. See the next section.

## Rules check

Judging is two stages: a pass/fail viability check (fits the theme, really uses PayPal APIs), then five **equally weighted** criteria. Ties break on the first criterion, Technological Implementation, so depth of PayPal + AI integration is the tiebreaker. ([rules](https://paypalaihackathon.devpost.com/rules))

| Criterion | What it means for us |
| --- | --- |
| Technological Implementation | Several PayPal APIs working together (orders, authorize, capture, void, refunds, webhooks) plus a real tool-calling agent. Not a chatbot wrapper. |
| Design | A complete product: landing, freelancer view, client view, empty states, errors. Not a dev console. |
| Potential Impact | Name the audience precisely: student and gig freelancers in Thailand/SEA who get work via LINE. Show the pain with a real-looking chat. |
| Innovation | Chat-to-contract with citations, Thai support, and AI-proposed money movement are the novel parts. |
| Presentation | A sub-3-minute video that runs the whole loop end to end. |

**Must submit:** text description, a working build (hosted URL or full run instructions), list of AI tools used and how, a **public repo with an open-source license visible in the About section**, and a public YouTube video under 3 minutes with no copyrighted music. Include sandbox test logins in the README so judges can try it.

**Prize limits:** one Grand Prize or one Honorable Mention, plus one Sponsor Prize. So target one sponsor, not five.

### Eligibility flag (act on this tonight)

The rules require every entrant to be at least the **age of majority where they live**. In Thailand that is 20 under the Civil and Commercial Code, and you're 19. Your brother (25) clears it.

- [ ] Email the hackathon manager (link on the [overview page](https://paypalaihackathon.devpost.com/)) and ask whether a 19-year-old Thai resident can be listed on a team.
- [ ] Until you hear back, register the submission under your brother as the Representative.

Don't skip this. Prizes are paid only after identity and role verification, so an ineligible team member could void a win.

## Resources: what we use

The TypeScript toolkit already in your project decides the stack: one language, no LangChain. Its `create_order` is hard-coded to `intent: CAPTURE` and it has no authorize, capture-authorization or void tools, so those are about 40 lines of our own REST calls.

| Resource | Verdict | Why / how |
| --- | --- | --- |
| [PayPal REST API](https://developer.paypal.com/api/rest/): Orders v2 + Authorizations | **Use, core** | Our REST calls: create order (AUTHORIZE), authorize, capture, void, each with a `PayPal-Request-Id` |
| [PayPal JS SDK](https://developer.paypal.com/sdk/js/) | **Use, core** | Button script with `intent=authorize` and `currency=THB` (the wireframe uses the v5 script) |
| [PayPal Agent Toolkit](https://docs.paypal.ai/developer/tools/ai/agent-toolkit-quickstart) (`@paypal/agent-toolkit` 1.11.0, installed) | **Use, core** | AI SDK adapter. Whitelist only `orders.get` and `payments.createRefund/getRefunds`. Its `client.getHeaders()` gives our REST calls the OAuth token |
| [PayPal AI Toolkit plugin](https://github.com/paypal/AI-Toolkit) | **Use, dev only** | Claude Code plugin: best-practices skill, sandbox MCP, `/paypal:explain-error` |
| [Sandbox starter](https://github.com/paypaldev/getting-started-with-paypal-sandbox) + [Dashboard](https://developer.paypal.com/dashboard/) | **Use, day 1** | 1 business account (Ploy, the freelancer, owns the REST app) + 1 personal account (Nok, the client) |
| [Webhooks](https://developer.paypal.com/api/webhooks/overview) | Later | Day 1 reads the capture response and `get_order`; verified webhooks come with the worker |
| [Bryntum](https://paypalaihackathon.devpost.com/details/bryntum) | **Sponsor target**, after day 1 | Gantt replaces the CSS bars; an unfunded milestone shows as blocked |
| [Render](https://paypalaihackathon.devpost.com/details/render) | Later | $50 credits; live URL for judges |
| [APIMatic Context Plugin](https://paypalaihackathon.devpost.com/details/apimatic) | Light | Extra PayPal API context in Claude Code |
| [Postman PayPal collection](https://www.postman.com/paypal) | Light | Hand-test sandbox calls during the S1 spike |
| [Payouts](https://developer.paypal.com/docs/payouts/) | Use (2026-11-10) | After a capture, the amount is sent to the freelancer's PayPal email. See docs/api.md, Fix list |
| [Invoicing](https://developer.paypal.com/invoicing/about) | Stretch | Receipt per paid milestone |
| [Disputes](https://developer.paypal.com/platforms/disputes/overview) | Mention only | Revisions and cancel-and-release happen before a PayPal dispute |
| AG Grid, Elastic, KERNEL, Channel3, Astropods, Zapier | Skip | Don't fit the core loop |
| Pay Later, Subscriptions, Donations | Skip | Wrong payment shape for milestone jobs |
| Webinars | Watch 1 | The Oct 6 "Start building with PayPal" recording at 1.5x |

Questions go to the [PayPal Discord](https://discord.gg/sJ2G6DyvSK); the sponsor teams answer there.

## Prize strategy

Aim for a Grand Prize by building for the five criteria, and position for **Best Use of Agentic Commerce** plus the **Bryntum** sponsor prize. With \~27,000 registrants, a polished, narrow product beats a broad, shaky one.

| Prize | Amount | Fit | What wins it for us |
| --- | --- | --- | --- |
| 1st / 2nd / 3rd | $12k / $8k / $5k | Possible | Clean end-to-end demo, real PayPal depth, credible audience |
| Best Use of Agentic Commerce | $5k | **Strong** | The resources page literally lists "pays contractors automatically when a job is marked complete". The agent confirms the hold, proposes the release, captures after the client approves, then asks the client to fund the next milestone |
| Best Use of PayPal + AI | $5k | Strong | AI turns a chat into terms and decides when to ask for money; PayPal holds and moves it |
| Most Impactful | $5k | Medium | Needs a sharp story about informal gig work in SEA |
| Best Demo Delivery | $5k | Medium | Comes free if the video is tight |
| Best Use of Bryntum | $1k (x3) | **Strong** | Gantt with payment tranches; late payment visibly blocks the next phase |
| Best Use of Render | Credits | Free bonus | We host there anyway, and the worker counts as real use |

The Bryntum prize is small money but a low-competition, high-odds win, and the Gantt also lifts our Design score.

## Feature scope

The day-1 MVP is the twelve items below. Nothing in "After the MVP" starts until the loop runs end to end in sandbox.

### MVP (day 1)

1. **Dashboard:** totals for held by PayPal, paid, and not funded yet; projects list; "Load demo project"; a badge when the client has sent a change request.
2. **Chat import:** paste text, or upload screenshots, a PDF or a LINE/WhatsApp `.txt` (JPG, PNG, HEIC, PDF, TXT; up to 10 files, 20 MB each). Claude vision transcribes images, HEIC is converted to JPEG, and overlapping screenshots are deduped. Back asks before discarding a draft.
3. **Agreement draft:** one extract call returns terms with citation chips, gaps with one-tap fixes, milestones, injection flags and an English translation of every message.
4. **Translate:** English by default; about 55 languages on demand, translated once and cached; right-to-left languages handled; a "Translated by AI" note.
5. **Editable prices:** the freelancer can change milestone amounts before approving, with a warning when they no longer add up to the agreed price.
6. **Two-party approval:** the freelancer approves and freezes version 1 with a hash; the client approves on the phone (no charge). Both must match the same hash.
7. **Fund:** the client authorizes the current milestone with PayPal. Milestones go one at a time; the next unlocks only after the previous is paid.
8. **Submit work:** the freelancer uploads files and marks the milestone delivered. No AI review; revisions bump the file version.
9. **Review and pay:** the agent confirms the hold and proposes the release. The client views or downloads the files (single or zip) and picks **Approve & pay**, **Request revision** (typed note, limited rounds once the revision gap is fixed) or **Cancel & release hold** (void). Approval triggers the capture, then the agent asks the client to fund the next milestone.
10. **Change requests:** from the client's phone, or pasted by the freelancer. AI classifies in-scope, revision or new work and drafts a milestone priced from the original rate. The freelancer can edit the title, deliverables and price before sending; the client accepts or declines; an accepted one becomes the next milestone (M4, M5…). One open request at a time.
11. **Project page:** CSS timeline, payment ledger with PayPal ids, deliverables per milestone, "Refresh from PayPal".
12. **Demo tooling:** Judge mode, the Under-the-hood panel, the activity log and the guardrail test.

### After the MVP (in order)

1. Render deploy, so judges get a live URL
2. Bryntum Gantt in place of the CSS bars
3. Reauthorize and expiry warnings for holds past 3 days
4. Verified webhooks + background worker
5. Hashed magic links for the client
6. Postgres and Cloudflare R2 with signed URLs
7. React, only if there's spare time

### Cut

AI deliverable check (the client judges the work), auto-capture timer, AI mediation, PDF export, Thai UI toggle, marketplace, LINE/WhatsApp bots, voice, tutoring and session jobs, multi-currency.

## User journey

Nine steps, each a screen in the wireframe. Ploy (freelancer) works on a desktop; Nok (client) uses a phone link with no signup.

| # | Step | Who | What happens | API |
| --- | --- | --- | --- | --- |
| 1 | Dashboard | Freelancer | Totals, projects, change-request badge, "Load demo project" | `GET /api/projects` |
| 2 | Paste chat | Freelancer | Paste text or upload files; progress steps while it reads | `POST /api/projects` (multipart) |
| 3 | Agreement review | Freelancer | Chat with translation and citation chips, terms, gaps, editable milestones, "Approve & send to client" | `POST /api/projects/:id/extract` |
| 4 | Approve agreement | Client (phone) | Plain-language summary, fingerprint, approve (no charge) | `POST /api/agreements/:id/approve` |
| 5 | Fund milestone | Client (phone) | PayPal popup places a hold on the current milestone | `POST /api/milestones/:id/order` → `/authorize` |
| 6 | Submit work | Freelancer | Upload files, mark delivered | `POST /api/milestones/:id/deliverables` → `/submit` |
| 7 | Client reviews + pays | Agent → Client | Agent proposes; client approves, requests a revision, or cancels the hold | `POST /api/agent/run`, `/api/proposals/:id/approve`, `/api/milestones/:id/revision` |
| 8 | Scope creep | Freelancer + Client | Request → AI verdict and draft → freelancer edits → client accepts or declines | `POST /api/projects/:id/change-requests` |
| 9 | Project page | Both | Timeline, payment ledger, deliverables | `GET /api/projects/:id` |

Steps 5 to 7 repeat for every milestone, including accepted change orders. **Judge mode** shows both sides at once. The **Under the hood** panel lists each step's API, AI call, PayPal call, DB writes and token cost, and it is the contract Claude Code builds against.

## Who does the work

Most of the journey is plain code. Four steps call a model, and only step 7 runs the agent, so the expensive part of the app is small and easy to control.

&#91;embedded content: agent, LLM call or plain code · 9 steps\]

**How the agent runs:**

- It's event-driven, not a chat. Three events wake it: `milestone.submitted` (check the hold, propose the release), `proposal.approved` (capture, then ask the client to fund the next milestone) and `proposal.voided` (void the hold).
- Each run gets only the milestone, proposal and payment state as JSON (under 2k tokens), never the raw chat.
- Money tools are gated in code: no approved proposal row, no capture.
- **Deterministic fallback:** if the model call fails, returns no tool call, or takes longer than 8 seconds, code runs the same tool sequence for that event. The demo can't stall on a model hiccup, and the trace marks the run as `fallback`.

**What never calls a model:** `.txt` parsing, HEIC conversion, dedupe, hashing, price totals, every status transition, PayPal order/authorize, uploads, downloads and notification text (fixed templates with the amount and milestone filled in).

## Cheapest model plan

> **Decision update 2026-11-06 (owner):** the app uses the Google Gemini API only, with no Anthropic API. Every task in the model plan below (extract, vision, agent, scope, translate, fallback) runs on `gemini-3.1-flash-lite`. The Haiku rows are superseded. The free tier stays demo-data only (see the training caveat below); real users need a paid Gemini key.

Use **Claude Haiku 5.5** for the calls that need to be right, and **Gemini 3.1 Flash-Lite on Google's free tier** for the two simple ones. A full M1 demo loop then costs **under a cent**, against about $0.15 on Sonnet in the wireframe. Haiku 5.5 is $0.10 per million input and $0.50 per million output tokens for prompts up to 100k tokens ([Haiku 5.5 pricing](https://apidog.com/blog/claude-haiku-5-5-pricing/)). Gemini 3.1 Flash-Lite is free on the free tier and $0.25 / $1.50 on paid ([Gemini pricing, Oct 25](https://www.morphllm.com/gemini-api-pricing)).

| Call | Model | Why this one | Tokens in / out | Cost per call | Fallback |
| --- | --- | --- | --- | --- | --- |
| Extract (terms, citations, gaps, milestones, flags, English) | `claude-haiku-5-5` | Must be right, handles Thai, no training on your data | ≈ 4k / 2.9k | ≈ $0.002 | Sonnet 5.5 only if the eval fails |
| Screenshot / PDF transcription | `claude-haiku-5-5` (vision) | Same provider, same schema | ≈ 1.5k / 0.3k per image | ≈ $0.0003 per image | Ask the user to paste the text |
| Milestone Agent | `claude-haiku-5-5` (tool calling) | Cheap enough to run every event | ≈ 15k / 1k per run | ≈ $0.002 per run | Deterministic code path |
| Scope classifier | `gemini-3.1-flash-lite`, free tier | Three labels plus a small draft | ≈ 3k / 0.6k | $0 | Haiku 5.5 (≈ $0.0006) |
| Extra translation languages | `gemini-3.1-flash-lite`, free tier | Simple, cached after first use | ≈ 1k / 0.6k | $0 | Haiku 5.5 (≈ $0.0004) |
| Notifications, parsing, totals, hashing | No model | Templates and code | 0 | $0 | — |

**Per demo:** an M1 loop is about $0.006 (extract + one agent pair), or $0.007 with screenshots. A 3-milestone demo is about $0.015, so 100 rehearsals cost roughly $1.50. These are estimates from the wireframe's token counts at list prices; check the real `usage` numbers after S2.

### Why not make everything free

- **Gemini's free tier uses your prompts to improve Google's products** ([source](https://www.morphllm.com/gemini-api-pricing)). That's fine for the Baan Kafe sample chat, but not for real users' chats, which contain names and prices. Use free-tier models only on demo data, and switch them to paid before anyone real uses the app.
- **Free-tier rate limits are low and vary by model.** Check your project's limits in AI Studio before the demo, and keep the fallback in place.
- **Groq's free tier** is an option that doesn't train on your data, but its sample limit for `gpt-oss-120b` is 8,000 tokens a minute and 1,000 requests a day ([Groq free tier](https://www.developersdigest.tech/models/free-api/groq)). That's enough for the classifier, too tight for extraction.

### How it's wired

One `models.js` file maps each task to a model, so switching models is a one-line change:

```
import { anthropic } from '@ai-sdk/anthropic';   // npm i @ai-sdk/anthropic@1
import { google } from '@ai-sdk/google';         // npm i @ai-sdk/google@1  (v1 pairs with ai@4)

export const MODELS = {
  extract:   anthropic('claude-haiku-5-5'),
  vision:    anthropic('claude-haiku-5-5'),
  agent:     anthropic('claude-haiku-5-5'),
  scope:     google('gemini-3.1-flash-lite'),   // free tier, demo data only
  translate: google('gemini-3.1-flash-lite'),   // free tier, demo data only
  fallback:  anthropic('claude-haiku-5-5'),
};
export const MAX_OUT = { extract: 3500, vision: 600, scope: 800, translate: 1200, agentStep: 400 };
```

1. **`withFallback(task, call)`** tries the primary model once. On a 429, a timeout or a zod validation failure, it retries once on `MODELS.fallback`. The agent's fallback is the deterministic code path.
2. **Every call logs to `ai_runs`**: task, model, input and output tokens, cost and latency. The Under-the-hood panel reads from it, so judges see real numbers.
3. **Budget guard:** if today's logged cost passes $1, model calls stop and the app shows a notice. That protects you from a runaway loop during rehearsals.
4. **Small outputs:** structured output with zod, short enum labels, `MAX_OUT` caps and temperature 0. Output tokens are the expensive part.
5. **Small inputs:** the agent sees only state JSON; the classifier sees the frozen agreement summary, not the chat; every prompt stays far under Haiku's 100k-token price step.
6. **Caching:** once a system prompt passes the model's minimum cacheable length, mark it for prompt caching. Before that it isn't worth it.
7. **Eval gate on day 1 (S2):** run the 3-chat eval on Haiku 5.5. Move extract to Sonnet 5.5 only if citations or the Thai messages fail; that one change costs about $0.04 per extract.

**Keys in `.env`:** `ANTHROPIC_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` (from Google AI Studio). In the Devpost "Tools" field, list Claude Haiku 5.5 and Gemini 3.1 Flash-Lite and what each does.

## Architecture

Day 1 is one Express server, a static frontend, a JSON file and two external services. The agent sits beside `paypal.js`, so money only moves through functions that check for an approved proposal.

&#91;embedded content: system architecture · 3 layers, 2 external services\]

| File | Job |
| --- | --- |
| `public/` (index.html, app.js, styles.css) | Freelancer and client views grown from the wireframe; PayPal JS SDK button |
| `server.js` | Express routes, about 250 lines; `transition()` owns every status change |
| `paypal.js` | Toolkit instance + `ppPost()` helper: `createAuthOrder`, `authorizeOrder`, `captureAuth`, `voidAuth` |
| `ai.js` | Extract (generateObject + zod), scope classifier, screenshot transcription, translation; task-to-model map in models.js |
| `agent.js` | `generateText` with tools, `maxSteps: 4`, gated capture and void |
| `db.js` | `db.json` read/write, about 40 lines |
| `prompts/*.md` | extract, scope, agent |
| `scripts/smoke.js` | authorize → capture, authorize → void, refund |

New packages: `npm i @ai-sdk/anthropic@1 @ai-sdk/google@1 multer dotenv heic-convert archiver` (the v1 providers pair with `ai@4`). Everything else is already installed; the whole app is about 1,100 lines.

**Python alternative:** `paypal-agent-toolkit` + LangChain + FastAPI also works, but it means a second toolchain on build day. Switch only if the track-A person is much faster in Python.

## Money flow

Milestone Pay **never holds money**. The client authorizes the current milestone, PayPal holds it, and the agent captures it to the freelancer only after the client approves the work. Milestones go one at a time, so each hold stays short.

&#91;embedded content: milestone money flow · 6 states\]

**Who the merchant is:** the freelancer. Milestone Pay is software acting on the freelancer's own PayPal account, like an invoicing tool. In the demo the REST app belongs to Ploy's sandbox business account, and Nok uses a sandbox personal account.

**Update 2026-11-10 (owner decision):** in the multi-user beta the REST app is the Milestone Pay merchant account, so the product says the money is *held by Milestone Pay*. After the client approves, the capture lands on that account and a PayPal Payout sends the amount to the freelancer's PayPal.

1. **Fund:** the server creates an order with `intent: AUTHORIZE` (amount from `db.json`, `custom_id` = milestone id, `PayPal-Request-Id`). Nok approves in the PayPal popup; the server calls `/authorize` and stores `authorization_id` and its expiry → `authorized`.
2. **Submit:** Ploy uploads files and marks the milestone delivered → `submitted`. This event wakes the agent.
3. **Propose:** the agent calls `get_order` to confirm the hold is live, then `propose_release` writes a pending proposal. No money moves.
4. **Client decides:**
   - **Approve & pay** → proposal approved → `capture_authorization` → `paid`. The agent tells Ploy she's paid and asks Nok to fund the next milestone.
   - **Request revision** → proposal withdrawn, hold stays → `revision_requested`. Ploy re-uploads as v2 and submits again.
   - **Cancel & release hold** → `void_authorization` → `voided`. Nok is never charged and later milestones don't start.
5. **Refund after payment:** toolkit `create_refund`, gated the same way and only with both parties' agreement.
6. **Change order:** an accepted request becomes a new milestone at the end with its own authorization. Authorized amounts never change.

**Hold window:** PayPal honors an authorization for 3 days and it can last up to 29 days with reauthorization (which issues a new authorization id). Capture depends on the funds still being available. The day-1 demo captures within minutes; add reauthorize and expiry warnings before real use.

**S1 spike first:** authorize → capture, authorize → void and a refund, all in THB. If THB fails, use USD in the API and keep showing THB in the UI. If authorize itself misbehaves, fall back to toolkit `create_order` (CAPTURE) at fund time and `pay_order` after approval, but that loses the "PayPal holds it" story.

**Production note for the pitch:** to support many freelancers, each one would connect their PayPal account through PayPal's partner onboarding so Milestone Pay can act on their behalf. The platform still never holds funds.

## AI layer

Four model calls and one agent. The calls return strict JSON via zod; only the agent can touch money, and only through gated tools. Models and costs follow the Cheapest model plan above.

| Component | Input | Output | Model and cost |
| --- | --- | --- | --- |
| Extract | Chat messages with ids | Terms with `source_message_ids`, gaps, milestones, injection flags, English translation per message | Haiku 5.5, `generateObject`, temperature 0 · ≈ $0.002 |
| Chat transcription | Screenshots or PDF pages, up to 5 images per call | Ordered `{sender, time, text}` lines with source file and page | Haiku 5.5 vision · ≈ $0.0003 per image |
| Translation | Stored messages | One extra language, cached | Gemini 3.1 Flash-Lite, free tier · $0 |
| Scope classifier | Frozen agreement summary + change request | `in_scope` / `revision` / `new_work` + draft milestone priced from the original rate | Gemini 3.1 Flash-Lite, free tier · $0 (Haiku fallback) |
| Milestone Agent | Event + milestone, proposal and payment state, never the raw chat | Tool calls | Haiku 5.5, `generateText`, `maxSteps: 4` · ≈ $0.002 per run |

### Agent tools

- `get_order` (toolkit, unchanged): confirms the hold is live.
- `propose_release` (ours): writes a pending proposal. Moves no money.
- `capture_authorization` and `void_authorization` (ours): run only if an approved proposal row exists, otherwise return `NO_APPROVAL`.
- `create_refund` / `get_refund` (toolkit): gated the same way.
- `notify`: tells Ploy she's been paid, or asks Nok to fund the next milestone.

Whitelist only `orders.get` and `payments.createRefund/getRefunds` in the toolkit config. Enabling all \~45 tools puts every schema into every agent step.

### Prompting rules

- Chat text, revision notes and change requests are untrusted: wrapped in `<untrusted_chat>` / `<untrusted_request>` tags and never passed to the agent as instructions.
- Tell the vision call which bubble side is the freelancer (right = me). Dedupe overlapping screenshots on sender + text + time, and keep the source file so misreads can be traced.
- Keep prompts in `prompts/*.md`; re-run a 3-chat eval set (one from screenshots) after every prompt change.
- A full M1 loop costs under a cent at runtime with this model plan, so rehearse as often as you like.

## Database

Day 1 is one `db.json` file, with money as integer satang. Each collection maps one-to-one onto a Postgres table for later.

| Collection | Key fields | Notes |
| --- | --- | --- |
| `projects` | id, title, freelancer, client, status | One seeded freelancer, no login |
| `chat_messages` | id, project\_id, seq, sender, time, text, lang, source\_file, page, translations{} | Translations cached per language |
| `agreements` | id, project\_id, version, body\_json, content\_hash | Frozen once both approve |
| `agreement_approvals` | agreement\_id, party, content\_hash, at | Approved when both parties match the same hash |
| `milestones` | id, project\_id, seq, title, amount\_minor, status, criteria\[\], rev\_count | Amount editable only before approval |
| `payments` | milestone\_id, order\_id, authorization\_id, expires\_at, capture\_id, status | One authorization per milestone |
| `deliverables` | milestone\_id, version, filename, sha256, path | Older versions kept |
| `proposals` | id, milestone\_id, action (release / void), status: pending → approved → executed, or withdrawn | The approval gate |
| `change_requests` | id, project\_id, from (client / freelancer), text, classification, ai\_draft, sent\_version, status | AI draft and sent version both stored |
| `ledger` / `activity` | time, milestone, event, paypal\_id, amount | Totals computed from rows, never stored |

**Milestone statuses:** `draft → agreed → authorized → submitted → paid`, plus `revision_requested` (back to `submitted` on re-upload), `voided` and `refunded`. `transition()` owns every change, and the API never sets status directly.

## Security

Day 1 skips accounts, so the rules that matter are about money, untrusted text and files. Each is cheap and worth a README line.

| Area | Rule |
| --- | --- |
| Secrets | PayPal id and secret and the Anthropic and Google AI keys live in `.env`; `.env.example` is committed; `.gitignore` covers `.env`, `db.json` and `uploads/` |
| PayPal calls | Server only. The amount always comes from `db.json`, never from the browser |
| Idempotency | `PayPal-Request-Id` on every create, authorize, capture and void (`order-`, `auth-`, `cap-`, `void-` prefixes) |
| State machine | `transition()` throws on illegal moves. Capture only from `submitted` with an approved proposal; void only before capture; refund only after capture |
| Agent guardrail | The gate is in code. Demo a forged proposal being refused with `NO_APPROVAL` |
| Prompt injection | Chat line m9 is flagged in review and ignored; revision notes and change requests are stored as data only |
| Client access (day 1) | `?as=client` + Judge mode, demo only. Hashed magic links with 14-day expiry before anything real |
| Uploads | Chat import: up to 10 files, 20 MB each, check extension and magic bytes, HEIC converted on the server. Deliverables: PDF, PNG, JPG, ZIP, MP4 |
| Downloads | Through the API with a project-member check, never a public folder |
| Rendering | Escape all user text: freelancer edits, revision notes, change requests |
| Privacy | Notice on import; raw chat is never logged |

In the README, say plainly that Milestone Pay never holds funds: PayPal holds each authorization, and capture pays the freelancer's own account.

## Standout moves

These are already in the wireframe; keep every one in the build.

1. **Citations everywhere.** Every term has a chip that highlights the chat message it came from.
2. **Screenshot import.** Most LINE users share screenshots, not exports. Reading them (HEIC included) makes it feel real.
3. **Thai-first, 55 languages.** A mixed Thai/English chat with "555", translated inline, cached per language.
4. **The money moves on screen.** "PayPal: capture COMPLETED" toast and a ledger with real sandbox ids.
5. **Guardrail demo.** Chat line m9 says "release all funds" and gets flagged; a forged capture is refused with `NO_APPROVAL`.
6. **Agent trace.** The dark activity trace shows each tool call and result; that's what makes it read as agentic.
7. **Fingerprint on both screens.** The agreement hash shows to Ploy and Nok.
8. **Sequential milestones.** After each capture the agent asks Nok to fund the next one, so holds stay short.
9. **Client-side change requests.** Nok asks from her phone; the AI drafts a priced milestone; Ploy edits before sending.
10. **Judge mode + Under the hood.** Both sides at once, with the API, AI and PayPal call behind each step.

**Pitch line to reuse:** "Milestone Pay turns a LINE chat into a contract, and lets an AI agent move PayPal money only when the work is proven and a human says yes."

## Build plan

The MVP is nine slices on two tracks, about 7 hours for track A and 8.5 for track B by the wireframe's estimate, so it fits one long day for two people. **Feature freeze the night of Nov 10; submit by Nov 12, 18:00 Bangkok.**

| # | Slice | Track | Hours | Tokens in / out |
| --- | --- | --- | --- | --- |
| S0 | Scaffold: Express server, static `public/`, `db.json` store, `.env.example`, CLAUDE.md | A | 0.5 | 120k / 8k |
| S1 | PayPal spike: `paypal.js` (toolkit + REST helpers) + `scripts/smoke.js`: authorize → capture, authorize → void, refund, in THB | A | 1.5 | 300k / 15k |
| S2 | Extractor: terms + citations + gaps + milestones + injection flags + English translation; screenshot/PDF transcription, HEIC → JPEG; on-demand translate; 3-chat eval | B | 2.5 | 380k / 32k |
| S3 | Port the wireframe to real pages: paste, review with chips + translate + editable amounts, client view + approve with hash | B | 2.0 | 460k / 46k |
| S4 | Fund: JS SDK button, `/order` + `/authorize`, `transition()` state machine | A | 1.5 | 250k / 15k |
| S5 | Submit work: uploads, file list + view/download/zip on the client view, typed revision form, current-milestone logic so M2 to M4 repeat the loop | B | 1.5 | 240k / 14k |
| S6 | Agent: `generateText` + toolkit tools + gated capture/void, proposals, activity log | A | 2.0 | 400k / 25k |
| S7 | Scope-creep classifier + change order with freelancer-editable title, deliverables and price | B | 1.0 | 210k / 13k |
| S8 | Seed demo, Judge mode, end-to-end bug bash on sandbox | A + B | 1.5 | 400k / 25k |

**Build cost:** about 2.8M input and 190k output tokens, roughly $3 on Sonnet 5.5 if most input is cache reads; budget about $8 for retries. These are planning estimates; re-check after S1 and S2.

### After the MVP

Work down the "After the MVP" list in Feature scope, starting with the Render deploy and Bryntum.

- Nov 11: bug bash, README, repo public, record a video draft.
- Nov 12: final video cut, YouTube upload, Devpost text, submit by 18:00 Bangkok.

If you're behind, cut from the bottom of that list. Never cut citations, the approval gate or the live capture.

## Demo video and submission

The video follows the wireframe's nine steps with the Baan Kafe chat, runs 2:45 at most, and shows real sandbox money moving.

| Time | Shot | Point |
| --- | --- | --- |
| 0:00–0:20 | LINE screenshots between Nok and Ploy; a "payment never came" line | The problem, one freelancer, one café owner |
| 0:20–0:50 | Upload screenshots → agreement with citation chips, gaps and English translation; m9 flagged | Every term traces back to the chat |
| 0:50–1:05 | Ploy tweaks a milestone price and approves; Nok approves on her phone | Same fingerprint on both screens |
| 1:05–1:20 | Nok authorizes M1 with PayPal | "PayPal holds it, not us" |
| 1:20–1:45 | Ploy uploads and marks delivered; agent trace proposes release; Nok asks for a revision; v2 uploaded | The client judges the work |
| 1:45–2:05 | Nok approves → capture COMPLETED toast → agent asks her to fund M2 | The agentic commerce moment |
| 2:05–2:25 | Nok requests an ordering page from her phone → AI says new work, 2,000 THB → Ploy edits and sends → Nok accepts as M4 | Scope creep caught |
| 2:25–2:35 | Forged capture refused `NO_APPROVAL`; ledger with PayPal ids | Safety + trust |
| 2:35–2:45 | Architecture diagram, pitch line | Close |

Use royalty-free or no music, and blur any real names.

### Submission checklist

- [ ] Public GitHub repo, MIT license showing in the About section
- [ ] README: what it is, screenshots, architecture diagram, setup steps, `.env.example`, sandbox test logins, the AI tools used and how
- [ ] Live URL on Render (warm it up before judging starts Dec 1; free instances sleep)
- [ ] YouTube video, public, under 3:00
- [ ] Devpost text: problem, who it's for, how it works, PayPal APIs used, AI used, what's next
- [ ] Tools list: Claude (model), PayPal Agent Toolkit, Bryntum, Render, Claude Code + PayPal AI Toolkit for building
- [ ] Submitted on Devpost by Nov 12, 18:00 Bangkok, eligibility settled

## Claude Code setup

Treat the wireframe as the contract: its `HOOD{}` data lists every endpoint, AI call, PayPal call and DB write, so each Sonnet session builds one slice against it.

1. Install the PayPal plugin: `/plugin install paypal@claude-plugins-official`, then `/reload-plugins` and `/paypal:setup` with a sandbox access token ([AI Toolkit](https://github.com/paypal/AI-Toolkit)). Run `/paypal:setup refresh` on a 401.
2. Keep CLAUDE.md under 60 lines: stack, folder layout, money in integer satang, never call PayPal from the browser, every status change through `transition()`, run the smoke test before finishing.
3. One slice per session with `/clear` in between. Point the agent at CLAUDE.md, the wireframe and the slice prompt, not this whole spec.
4. Use plan mode only for S4 and S6, the slices that move money.
5. Keep slice prompts short and specific: output tokens are about 60% of the build cost.
6. Commit after each slice; tracks A and B on separate branches, merged daily.
7. Keep `scripts/smoke.js` current and run it before every merge.

**Kick-off prompt (one per slice):**

```
Read CLAUDE.md and milestone-pay-wireframe.html (the "Under the hood" data in HOOD{} is the API contract).
Implement slice S4 only: fund milestone, from PayPal button to milestone status "authorized".
- Use paypal.js helpers; never call PayPal from the browser; amount comes from db, never the client.
- All status changes go through transition() in db.js; illegal transitions throw.
- Add/extend scripts/smoke.js for this slice and run it against sandbox before finishing.
Stop when the smoke test passes. Don't touch files outside server.js, paypal.js, public/app.js.
```

**Folder layout:** `public/`, `server.js`, `paypal.js`, `ai.js`, `agent.js`, `db.js`, `prompts/`, `scripts/smoke.js`, `uploads/` (gitignored).

**Before you start (30 minutes):** create the two sandbox accounts, put the PayPal id and secret and the Anthropic key in `.env`, add the `.gitignore`, then run S1 first.

## Sources

- [Hackathon overview, prizes, judging](https://paypalaihackathon.devpost.com/)
- [Official rules](https://paypalaihackathon.devpost.com/rules)
- [Resources page](https://paypalaihackathon.devpost.com/resources)
- [PayPal Agent Toolkit quickstart](https://docs.paypal.ai/developer/tools/ai/agent-toolkit-quickstart)
- [PayPal AI Toolkit for Claude Code](https://github.com/paypal/AI-Toolkit)
- Sponsor pages: [Bryntum](https://paypalaihackathon.devpost.com/details/bryntum), [Render](https://paypalaihackathon.devpost.com/details/render), [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic), [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid), [Channel3](https://paypalaihackathon.devpost.com/details/channel3), [Elastic](https://paypalaihackathon.devpost.com/details/elastic), [KERNEL](https://paypalaihackathon.devpost.com/details/kernel), [Postman](https://paypalaihackathon.devpost.com/details/postman), [Astropods](https://paypalaihackathon.devpost.com/details/astropods), [Zapier](https://paypalaihackathon.devpost.com/details/zapier)
- Wireframe: `milestone-pay-wireframe_final.html` (shared in chat, Nov 6)
- [Claude Haiku 5.5 pricing](https://apidog.com/blog/claude-haiku-5-5-pricing/)
- [Gemini API pricing and free tier, checked Oct 25, 2026](https://www.morphllm.com/gemini-api-pricing)
- [Groq free tier limits](https://www.developersdigest.tech/models/free-api/groq)
