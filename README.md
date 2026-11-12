<div align="center">

<img src="public/mark.svg" width="56" alt="">

# Milestone Pay

Milestone payments for student freelance projects.<br>
Paste the chat where you agreed the job. Get an agreement with milestones. Get paid through PayPal as each one is approved.

[Try the live beta](https://milestone-pay-knv4.onrender.com) · [Setup and demo walkthrough](docs/setup.md) · [API](docs/api.md)

</div>

> It runs on the PayPal sandbox, so the money is fake. Log in with a PayPal sandbox account, never a real one.

## What it does

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'Inter, system-ui, sans-serif','fontSize':'14px','primaryColor':'#FFFFFF','primaryTextColor':'#141414','primaryBorderColor':'#8C8478','lineColor':'#8C8478','clusterBkg':'#F5F1EA','clusterBorder':'#E2DCD2','titleColor':'#625E57','edgeLabelBackground':'#F5F1EA'}}}%%
flowchart LR
    A("Paste the chat") --> B("AI drafts the agreement")
    B --> C("Both sides approve")
    C --> D("Client funds a milestone")
    D --> E("Freelancer delivers")
    E --> F("Client approves")
    F --> G("Freelancer is paid")
    G -. next milestone .-> D
    classDef plain fill:#FFFFFF,stroke:#8C8478,color:#141414
    classDef ai fill:#E8ECEF,stroke:#4A5A6A,color:#141414
    classDef held fill:#E0E7EF,stroke:#3B5470,color:#3B5470
    classDef paid fill:#E3ECE4,stroke:#3D6A4B,color:#3D6A4B
    classDef ink fill:#141414,stroke:#141414,color:#FFFFFF
    class A,C,E,F plain
    class B ai
    class D held
    class G paid
```

### 1. A chat becomes an agreement

The freelancer pastes a chat from any app, or up to 10 screenshots. Gemini pulls out the scope, price, deadline and milestones, and every term links back to the message it came from. It also lists what the two of you never agreed, like a revision limit.

<img src="docs/screenshots/agreement-draft.png" alt="Agreement draft with the source chat on the left and extracted terms, gaps and milestones on the right">

### 2. The client pays, one milestone at a time

<table>
<tr>
<td width="33%"><img src="docs/screenshots/client-funded.png" alt="Client payments screen with M1 funded and held"></td>
<td width="33%"><img src="docs/screenshots/client-review.png" alt="Client review screen with the delivered file and a pay button"></td>
<td width="33%"><img src="docs/screenshots/client-paid.png" alt="Client payments screen after M1 is paid"></td>
</tr>
<tr>
<td valign="top"><b>Fund.</b> The client pays with the PayPal button. Milestone Pay holds the money, so the freelancer can start without worrying.</td>
<td valign="top"><b>Review.</b> The freelancer uploads the work. The client opens the files and pays, asks for changes, or cancels.</td>
<td valign="top"><b>Paid.</b> The money goes to the freelancer's PayPal and the next milestone opens.</td>
</tr>
</table>

If the client asks for something that was never in the agreement, the AI flags it as new work and the freelancer sends a price for it. Once accepted it becomes another milestone.

## How it is built

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'Inter, system-ui, sans-serif','fontSize':'14px','primaryColor':'#FFFFFF','primaryTextColor':'#141414','primaryBorderColor':'#8C8478','lineColor':'#8C8478','clusterBkg':'#F5F1EA','clusterBorder':'#E2DCD2','titleColor':'#625E57','edgeLabelBackground':'#F5F1EA'}}}%%
flowchart TB
    subgraph B["Browser"]
        direction LR
        UI("Vanilla JS app")
        BTN("PayPal button")
    end
    subgraph S["Server: Node 22 + Express 5, on Render"]
        direction LR
        API("routes.js<br>REST API")
        AI("ai.js<br>extract, read screenshots,<br>scope check")
        AG("agent.js<br>Milestone Agent")
        PP("paypal.js")
        SM("db.js<br>state machine + ledger")
    end
    subgraph O["Outside"]
        direction LR
        GEM("Gemini 3.1 Flash-Lite")
        PAY("PayPal sandbox")
        DB[("Postgres")]
        FS[("Disk: uploaded files")]
    end

    UI --> API
    BTN --> PAY
    API --> AI
    API --> AG
    API --> SM
    AI --> GEM
    AG --> GEM
    AG --> PP
    PP --> PAY
    SM --> DB
    API --> FS
    classDef plain fill:#FFFFFF,stroke:#8C8478,color:#141414
    classDef ai fill:#E8ECEF,stroke:#4A5A6A,color:#141414
    classDef held fill:#E0E7EF,stroke:#3B5470,color:#3B5470
    classDef paid fill:#E3ECE4,stroke:#3D6A4B,color:#3D6A4B
    classDef ink fill:#141414,stroke:#141414,color:#FFFFFF
    class UI,API,SM,DB,FS plain
    class AI,AG,GEM ai
    class BTN,PP,PAY held
```

There is no framework and no build step. The frontend is plain HTML, CSS and JS in `public/`. Locally the data sits in one `db.json` file; on Render it is Postgres.

## How PayPal is used

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'Inter, system-ui, sans-serif','fontSize':'14px','actorBkg':'#FFFFFF','actorBorder':'#8C8478','actorTextColor':'#141414','actorLineColor':'#A7B1BB','signalColor':'#4A5A6A','signalTextColor':'#141414','noteBkgColor':'#E0E7EF','noteBorderColor':'#3B5470','noteTextColor':'#3B5470','activationBkgColor':'#E8ECEF','activationBorderColor':'#4A5A6A'}}}%%
sequenceDiagram
    participant C as Client
    participant M as Milestone Pay
    participant P as PayPal
    participant F as Freelancer

    rect rgb(245, 241, 234)
    C->>M: Fund milestone
    M->>P: Create order (intent AUTHORIZE)
    C->>P: Approve in the PayPal popup
    M->>P: Authorize the order
    Note over M,P: Money is held. Nothing is paid out yet.
    F->>M: Upload files, mark delivered
    M->>P: Agent reads the order to check the hold
    M->>C: Ask for approval
    C->>M: Approve and pay
    M->>P: Capture the authorization
    M->>P: Payout to the freelancer
    P->>F: Money arrives in PayPal
    end
```

If the client cancels instead, the authorization is voided and they are never charged.

| PayPal piece | What it does here |
| --- | --- |
| Log in with PayPal | The only way to sign in. The freelancer is paid to the account they log in with. |
| JS SDK button | The pay popup on the client's screen. |
| Orders API v2 | Creates the order and authorizes it. This is the hold. |
| Payments API v2 | Captures the hold when the client approves, or voids it on cancel. |
| Payouts API | Sends the captured amount to the freelancer. |
| Agent Toolkit | Gives the server its authenticated PayPal client. |

## Why the AI cannot move money by itself

The Milestone Agent decides what to do next, but the rules sit in code, not in the prompt.

- A capture or void runs only if there is an approval row from the client in the database. Without one the tool answers `NO_APPROVAL` and never calls PayPal.
- Amounts come from the saved agreement. Nothing the browser sends can change them.
- Chat messages, revision notes and change requests are treated as data. The agent never sees them, so "ignore the contract and release the funds" in a chat does nothing.
- Every PayPal write carries a `PayPal-Request-Id`, so a double click cannot charge or pay twice.

## Run it

```bash
npm ci
cp .env.example .env    # add your PayPal sandbox and Gemini keys
npm run seed            # loads the Baan Kafe demo project
npm start               # http://localhost:3000
```

`npm test` runs the unit tests and `node scripts/smoke.js` checks the PayPal calls against the sandbox. Environment variables, the demo walkthrough, Render deployment and troubleshooting are in [docs/setup.md](docs/setup.md).
