# Milestone Pay

Milestone Pay turns a freelance chat (LINE, WhatsApp) into a clear agreement with milestones. For each milestone, the client pays with PayPal and Milestone Pay holds the money until the work is delivered. When the client approves the work, an AI agent checks that approval, releases the payment and sends it on to the freelancer's PayPal.

Everything here runs on the PayPal **sandbox**. The money is fake.

**Live beta:** https://milestone-pay-knv4.onrender.com. Log in with a PayPal **sandbox** account (see below).

---

## Beta onboarding (sandbox)

Everyone logs in with **Log in with PayPal** using a PayPal *sandbox personal* account, never a real PayPal login. Create sandbox accounts at [developer.paypal.com](https://developer.paypal.com) under **Testing Tools > Sandbox Accounts**.

- **Freelancer:** log in, press **+ New project**, paste the chat, review the agreement and press **Approve & send to client**. Then press **Copy link** and send the link to your client on LINE or WhatsApp. It is the same link every time, it does not expire, and your client can open it as often as they need.
- **Client:** open the invite link, log in with PayPal, press **Join as the client**, approve the agreement (no charge) and fund each milestone with the PayPal button.
- **Privacy:** each project is visible only to its freelancer and the client who joined it. Anyone else gets "Project not found".
- **Getting paid:** the client's payment is held on the Milestone Pay merchant account. When the client approves, it is captured and then sent to the freelancer's PayPal (the account they log in with) through PayPal Payouts. The REST app needs **Payouts** switched on in the developer dashboard and enough sandbox balance to cover the amount plus PayPal's fee; if a payout fails, the milestone stays paid and **Check with PayPal** on the project page retries it.
- **Leaving:** **Settings > Delete account** logs you out everywhere and deletes your data after 15 days. Log in again before then and the deletion stops. It is refused while money is on hold.

---

## Try it in 2 minutes (no coding)

1. **Install Node.js once.** Go to [nodejs.org](https://nodejs.org), download the **LTS** version and install it like any app.
2. **Put your keys in a file called `.env`.** In this folder, copy `.env.example` and rename the copy to `.env`. Open it in TextEdit and fill in:
   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: at [developer.paypal.com](https://developer.paypal.com) go to **Apps & Credentials**, choose **Sandbox**, open your app and copy both.
   - `GOOGLE_GENERATIVE_AI_API_KEY`: create a key at [aistudio.google.com](https://aistudio.google.com) (**Get API key**).
   - Optional but handy: `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD`, the fake buyer from **Testing Tools > Sandbox Accounts** (a *Personal* account). The app shows these on the pay page so you can copy them.
3. **Double-click `Start Milestone Pay.command`.**
   - The first time, macOS may say it "can't be opened". Right-click the file, choose **Open**, then **Open** again.
   - The first launch installs a few parts and sets up a ready-made demo project. Wait about a minute.
4. Your browser opens on Milestone Pay. Leave the black window open while you test. Close it to stop the app.

---

## The demo walkthrough

The demo project is a website for a cafe called **Baan Kafe**: freelancer Ploy, client Nok, four parts (M1 to M3 agreed up front, M4 added later).

1. **Freelancer review.** On the first screen open the Baan Kafe project (or press **Try the demo project**). Read the agreement. The demo is already set up with a revision limit and both sides' approval, so M1 is ready to pay. (A fresh project would use **Approve & send to client** here.)
2. **Invite the client.** Press **Create invite link** and send it to the client, who opens it in another browser (or a private window) and logs in with their own PayPal sandbox account.
3. **Client pays M1.** In the client view, under **Pay $240.00 with PayPal**, click the yellow **PayPal** button. A PayPal window opens. Log in with the **fake test buyer** shown in the blue box on the page (never your own PayPal) and approve. PayPal now *holds* the money; nothing is paid out yet.
4. **Freelancer delivers.** Back in the freelancer tab, under **Add files** click **Choose Files** and pick any PDF, PNG, JPG, ZIP or MP4. Press **Upload 1 file**, then **Submit for review**.
5. **Client approves and pays.** In the client tab review the files and press **Approve & pay**. The agent checks the order with PayPal, asks for the client's approval, and the money is released. The release trace shows each step.
6. **M2 with a revision.** Fund M2 as in step 3 and submit work as in step 4. This time the client presses **Request revision**, writes what to change and presses **Send revision request**. The freelancer uploads again and submits again; the client then presses **Approve & pay**.
7. **Client requests a change.** In the client view press **Request a change**, type something new (for example "Can you add an online ordering page?") and press **Send request**. The AI checks it against the agreement.
8. **Freelancer sends M4.** On the freelancer's project page press **Review request**. The AI's verdict and a draft quote are shown; edit the title, deliverables or price if you like, then press **Send $200.00 change order to client** (the amount matches the draft).
9. **Client accepts.** The client presses **Accept** (or **Decline**). M4 appears as a new milestone and becomes payable after M3 is paid.
10. **Project page.** Open the project to see milestones, the payment ledger, activity and the **Milestone Agent runs**. Press **Refresh from PayPal** to re-check every payment directly with PayPal.
11. **Guardrail test.** Press **Test the guardrail**. It tries to make the agent release money without the client's approval. It must be refused.

**Seeing the money moves in PayPal.** Go to [sandbox.paypal.com](https://www.sandbox.paypal.com) and log in as the sandbox **business** account (the seller; see Testing Tools > Sandbox Accounts). Open **Activity** to see authorizations, payments and refunds.

---

## Safety

- Sandbox only. The money is fake. No real PayPal account is ever used.
- The AI never moves money. It can only ask for a release; the server code checks that the client approved first. Capture and void are refused without that approval, whatever the AI says.
- Chat text is data, not instructions. Messages inside a chat cannot make the app do anything.
- Amounts always come from the saved agreement, never from what a browser sends.

---

## For developers

```
npm ci              # install
npm run seed        # Baan Kafe demo, ready to fund (no AI call). File store: resets db.json. Postgres: replaces only the demo freelancer's projects
npm start           # http://localhost:3000 (Postgres if DATABASE_URL is set, else db.json)
TEST_AUTH=1 npm start   # local only: adds a "Test login" form so you can be several users without PayPal
npm test            # unit tests (no network, file store)
npm run test:pg     # Postgres store tests: TEST_DATABASE_URL, else DATABASE_URL from .env, in a throwaway mp_test_* schema
node scripts/e2e.js # whole journey as freelancer + invited client + a stranger probing for leaks (PayPal stubbed)
node tests/qa/multi-user-ui.mjs http://localhost:3100 "$PWD"   # headless Chrome click-through (server started with TEST_AUTH=1)
node evals/run.js   # AI evals (live model calls)
node scripts/smoke.js          # PayPal sandbox order -> authorize -> capture / void / refund
node scripts/smoke.js --fund   # against a running server: funds the current milestone; prints the approval URL for a human
```

Environment variables. **Required in production** (the app refuses to start without them and names the missing ones): `NODE_ENV=production`, `DATABASE_URL`, `APP_URL`, `SESSION_SECRET` (32+ chars), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`.

| Variable | Meaning |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials (also used for Log in with PayPal) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key. Use a **paid** key before real users: the free tier may train on prompts |
| `GEMINI_TIER` | `paid` or `free` (warns at boot in production unless `paid`) |
| `DATABASE_URL` | Postgres. Unset = `db.json` file store |
| `DB_SCHEMA` | Postgres schema (default `public`) |
| `APP_URL` | Public base URL, e.g. `https://milestone-pay-knv4.onrender.com` (login callback, invite links, Secure cookies, HSTS) |
| `SESSION_SECRET` | Signs the short-lived login state cookie |
| `AI_USER_DAILY_USD` | Per-user daily AI budget (default `0.25`; the global cap stays $1/day) |
| `TEST_AUTH` | `1` adds `/auth/test-login` (ignored in production) |
| `RATE_LIMITS` | `off` disables rate limits (ignored in production) |
| `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD` | Fake buyer shown on the pay page; used by QA |
| `API_CURRENCY` | Currency charged (default `USD`) |
| `PORT` | Port (default `3000`) |
| `DB_PATH` | Data file (default `db.json`) |
| `UPLOAD_DIR` | Uploaded deliverables (default `uploads/`) |
| `FIXTURES_DIR` | Demo chat and cached extraction (default `fixtures/`) |
| `BASE_URL` | Server `smoke.js --fund` talks to (default `http://localhost:3000`) |

Layout:

- `server.js` Express app, middleware order, static files
- `routes.js` the `/api` endpoints (see `docs/api.md`), invites, account deletion
- `auth.js` Log in with PayPal, sessions · `access.js` per-project roles · `security.js` CSP, origin check, rate limits, request log · `config.js` env validation
- `db.js` in-memory store with a JSON-file or Postgres (`pgstore.js`, `migrations/`) backend, `transition()` state machine, ledger
- `paypal.js` PayPal REST calls and the toolkit (get order, refunds)
- `agent.js` the Milestone Agent and its deterministic fallback
- `ai.js`, `models.js`, `prompts/` model calls, model map, prompts
- `seed.js` demo reset
- `lab.js` Test Lab (guardrail test)
- `public/` the browser UI
- `fixtures/` demo chat and cached extraction
- `tests/`, `evals/`, `scripts/` tests, AI evals, smoke and e2e scripts

AI cost on Gemini 3.1 Flash-Lite: about $0.002 per chat extraction, $0.0005 per scope check, $0.0003 per agent run. A $1 per day guard blocks further AI calls.

---

## Deploy on Render

Two services, both in **Singapore**: a **Web Service** (`srv-dbotba95efls73euopsg`, Node, build `npm ci`, start `node server.js`, Starter plan or higher) and a **Postgres** database. Run one instance only: uploads live on the service's disk and the store keeps a working copy in memory.

1. Web service **Disks**: mount path `/var/data`, 1 GB. Set `UPLOAD_DIR=/var/data/uploads`.
2. Web service **Environment**: the production variables above. `DATABASE_URL` is the database's **Internal** URL. `APP_URL=https://milestone-pay-knv4.onrender.com`. Do not set `PORT`.
3. **Health check path:** `/healthz` (returns `{"ok":true,"db":"pg"}`).
4. Tables are created on first boot (migrations run automatically). `npm run seed` is optional.

**PayPal app settings** (developer dashboard → Apps & Credentials → Sandbox → your app): turn on **Log in with PayPal**, tick **email** and **profile** (openid is always on), and add both return URLs: `https://milestone-pay-knv4.onrender.com/auth/paypal/callback` and `http://localhost:3000/auth/paypal/callback`.

---

## Troubleshooting

- **"Login cancelled" or "PayPal could not log you in".** Check that Log in with PayPal is enabled on the sandbox app and that the return URL matches `APP_URL` exactly.

- **The PayPal popup shows an error or "system can't work right now".** Close it and try again, ideally in a normal browser window (not private or with strict blockers). Use the fake buyer login shown on the page, never your real PayPal.
- **A red error message appears.** It names what to fix (for example a missing key in `.env`). Fix that and try again.
- **"Port already in use".** Milestone Pay is probably already running. Close the other black window, or change `PORT` in `.env`.
- **Start over.** Stop the app, then run `npm run seed` in this folder (or delete `db.json` and double-click the launcher). Add `-- --clean-uploads` to also delete uploaded files.
