# Milestone Pay

Milestone Pay turns a freelance chat (LINE, WhatsApp) into a clear agreement with milestones. For each milestone, PayPal holds the client's money until the work is delivered. When the client approves the work, an AI agent asks for that approval, checks it, and releases the payment. PayPal holds the funds; this app never does.

Everything here runs on the PayPal **sandbox**. The money is fake.

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
2. **Open the client view.** Use **Client link** (or **Open client view**) to get the link Nok would receive. Open it in a second browser tab.
3. **Client pays M1.** In the client view press **Pay** on M1. A PayPal window opens. Log in with the **fake test buyer** shown on the page (never your own PayPal). Approve. PayPal now *holds* the money; nothing is paid out yet.
4. **Freelancer delivers.** Back in the freelancer tab press **Add files**, choose any file, press **Upload**, then **Submit for review**.
5. **Client approves and pays.** In the client tab review the files and press **Approve & pay**. The agent checks the order with PayPal, asks for the client's approval, and the money is released. The release trace shows each step.
6. **M2 with a revision.** Fund M2 as in step 3 and submit work as in step 4. This time the client presses **Request revision** and writes what to change. The freelancer uploads again and submits again; the client then approves.
7. **Client requests a change.** In the client view press **Request a change** and ask for something new, for example "Can you add an online ordering page?". The app checks it against the agreement and drafts a quote for the freelancer (**Check against agreement**, then **Send request**).
8. **Freelancer sends M4.** The freelancer reviews the draft quote and sends it to the client.
9. **Client accepts.** The client presses **Accept**. M4 appears as a new milestone waiting for payment.
10. **Project page.** Open the project to see milestones, the payment ledger, activity and the **Milestone Agent runs**. Press **Refresh from PayPal** to re-check every payment directly with PayPal.
11. **Guardrail test.** Press **Test the guardrail**. It tries to make the agent release money without the client's approval. It must be refused.
12. **Judge mode.** Press **Open in Judge mode** (or add `?judge=1&p=<project id>` to the address) to see freelancer and client side by side.

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
npm run seed        # reset db.json to the Baan Kafe demo, ready to fund (no AI call); --clean-uploads also clears uploads/
npm start           # http://localhost:3000
npm test            # unit tests (no network)
node evals/run.js   # AI evals (live model calls)
node scripts/smoke.js          # PayPal sandbox order -> authorize -> capture / void / refund
node scripts/smoke.js --fund   # against a running server: funds the current milestone; prints the approval URL for a human
```

Environment variables (see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key |
| `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD` | Fake buyer shown on the pay page; used by QA |
| `API_CURRENCY` | Currency charged (default `USD`) |
| `PORT` | Port (default `3000`) |
| `DB_PATH` | Data file (default `db.json`) |
| `UPLOAD_DIR` | Uploaded deliverables (default `uploads/`) |
| `FIXTURES_DIR` | Demo chat and cached extraction (default `fixtures/`) |
| `BASE_URL` | Server `smoke.js --fund` talks to (default `http://localhost:3000`) |

Layout:

- `server.js` Express app and static files
- `routes.js` the `/api` endpoints (see `docs/api.md`)
- `db.js` JSON store, `transition()` state machine, ledger
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

## Troubleshooting

- **The PayPal popup shows an error or "system can't work right now".** Close it and try again, ideally in a normal browser window (not private or with strict blockers). Use the fake buyer login shown on the page, never your real PayPal.
- **A red error message appears.** It names what to fix (for example a missing key in `.env`). Fix that and try again.
- **"Port already in use".** Milestone Pay is probably already running. Close the other black window, or change `PORT` in `.env`.
- **Start over.** Stop the app, then run `npm run seed` in this folder (or delete `db.json` and double-click the launcher). Add `-- --clean-uploads` to also delete uploaded files.
