# Telegram AI Order Bot → Google Sheets (n8n template)

A ready-to-import n8n workflow that turns a Telegram bot into an AI order assistant.
Customers write in plain language ("2 margherita and a lemonade to 5 Main St, I'm John, +1 555 123 4567"),
the AI extracts the order, the bot asks for anything missing, and every completed order is appended
as a row to Google Sheets, followed by a confirmation message to the customer.

## What it does

- **Natural-language ordering** – any language; the AI only extracts structured data (items, name, phone, address, notes).
- **Multi-message conversations** – partial orders are kept per chat, so customers can send details step by step.
- **Safe pricing** – prices and totals are calculated from your catalog in code; the AI cannot change them. Unknown products are flagged.
- **Answers questions** – "Do you have vegan options?" gets an AI answer based on the catalog.
- **Commands** – `/start`, `/help`, `/menu`, `/cancel` are handled without an AI call (no cost).
- **Error handling** – LLM timeouts/errors or malformed AI output produce a polite fallback reply instead of a failed run; the LLM and Google Sheets calls retry automatically. If saving to Sheets still fails, the customer is told and their order details are kept so they can retry.
- **No secrets inside** – the JSON contains no credentials or keys; you connect your own after import.

## Flow

```
Telegram Trigger
   └─ Shop Config (catalog, currency, model)
        └─ Normalize Message (commands, non-text, input cleanup)
             └─ Needs AI? ──no──────────────────────────────────────────────┐
                  └─yes─ Build AI Request ─ Call LLM ─ Parse AI Response     │
                                                         └─ Order Complete?  │
                                                              ├─no (ask for missing info) ─┤
                                                              └─yes─ Save Order to Sheet   │
                                                                      └─ Build Confirmation┤
                                                                                           └─ Send Telegram Reply
```

## Setup

### 1. Prepare the Google Sheet
Create a spreadsheet with a tab named **`Orders`** and this header row:

| Order ID | Created At | Status | Telegram Chat ID | Telegram Username | Customer Name | Phone | Address | Items | Total | Currency | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

Copy the spreadsheet ID from its URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### 2. Import the workflow
In n8n: **Workflows → Import from File** → choose `workflow.json` (or copy its contents and paste onto the canvas).

### 3. Connect credentials
| Node | Credential type | Where to get it |
|---|---|---|
| Telegram Trigger, Send Telegram Reply | Telegram API | Bot token from [@BotFather](https://t.me/BotFather) |
| Call LLM | OpenAI API | API key from platform.openai.com |
| Save Order to Sheet | Google Sheets OAuth2 API | Google Cloud OAuth client (see n8n docs) |

Then open **Save Order to Sheet** and replace `PASTE_YOUR_SPREADSHEET_ID` with your ID.

### 4. Configure the shop
Open **Shop Config** and edit:
- `shopName`, `currency`
- `aiModel` (default `gpt-4o-mini`)
- `catalogJson` – a JSON array: `[{"name": "Margherita Pizza", "price": 9.5, "description": "..."}]`

> Want a different LLM provider? Any OpenAI-compatible API works – just change the URL in **Call LLM** and use a Header Auth credential.

### 5. Activate
Telegram webhooks need n8n to be reachable over public HTTPS (n8n Cloud, or self-hosted with `WEBHOOK_URL` set).
Activate the workflow and send `/start` to your bot.

Note: draft orders are stored in workflow static data, which n8n persists only for **active** (production) executions, not for manual test runs.

## Development & tests

The Code-node logic lives in `src/nodes/*.js`; `build.js` assembles `workflow.json`.
`validate.js` checks the workflow structure (unique names, valid connections, exactly one trigger,
no orphan nodes, no embedded credentials/secrets) and runs every Code node against fixtures in `test/`
with mocked n8n globals – Telegram, OpenAI and Google Sheets are mocked, no network required.

```bash
npm test          # = node build.js && node validate.js  (Node 18+, no dependencies)
```

## Ideas for extension

1. **Order status updates** – a second workflow watches the `Status` column (e.g. "Out for delivery") and notifies the customer in Telegram.
2. **Admin notifications & approvals** – post each new order to a staff Telegram group/Slack with inline "Accept / Reject" buttons.
3. **Payments & catalog from Sheets** – load the catalog from a `Products` tab (stock, photos) and send Stripe / Telegram Payments invoices before confirming.
