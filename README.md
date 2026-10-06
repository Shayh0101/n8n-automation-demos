# n8n Automation Demos

Six ready-to-import **n8n** workflow templates for common business automations. Each one comes with a README, sticky notes on the canvas, Code-node logic in readable source files, and automated tests.

Built by **Umar N.** — n8n & AI automation developer ([Upwork](https://www.upwork.com/freelancers/~0128600f3a85d2d403)).

| # | Demo | What it does | Main tools | Tests |
|---|---|---|---|---|
| 01 | [WhatsApp AI Assistant](n8n-automation-demos/01-whatsapp-ai-assistant) | Answers WhatsApp Business messages with Claude or OpenAI, handles webhook verification and status updates | WhatsApp Cloud API, Claude / OpenAI | 5 / 5 ✅ |
| 02 | [Telegram AI Order Bot](n8n-automation-demos/02-telegram-ai-order-bot) | Takes orders in Telegram in free text, extracts the order with AI, saves it to Google Sheets and confirms to the customer | Telegram, OpenAI, Google Sheets | 15 / 15 ✅ |
| 03 | [Lead Capture → CRM + Follow-up](n8n-automation-demos/03-lead-capture-crm-followup) | Receives leads from a form or webhook, normalizes them, creates the contact in HubSpot / GoHighLevel / Airtable and sends a follow-up email | HubSpot, GoHighLevel, Airtable, Email | 4 / 4 ✅ |
| 04 | [AI PDF Data Extraction](n8n-automation-demos/04-ai-pdf-data-extraction) | Watches a Google Drive folder, extracts structured data from new PDFs with AI and writes rows to Google Sheets; flags unreadable files | Google Drive, OpenAI, Google Sheets | 4 / 4 ✅ |
| 05 | [RAG Chatbot over Company Docs](n8n-automation-demos/05-rag-chatbot-company-docs) | Indexes company documents into a vector database and answers questions with sources; says "I don't know" when the docs don't cover it | OpenAI, Qdrant | 14 / 14 ✅ |
| 06 | [Web Scraping → Clean Data](n8n-automation-demos/06-web-scraping-clean-data) | Scrapes a listing page on a schedule, cleans and validates the data, upserts it to Google Sheets / Postgres and alerts Slack only when something breaks | HTTP, HTML, Google Sheets, Postgres, Slack | 4 / 4 ✅ |

## How to use a demo

1. Open the demo folder and read its `README.md`.
2. In n8n go to **Workflows → Import from File** and choose `workflow.json`.
3. Attach your own credentials inside n8n (no keys or tokens are stored in these files) and follow the setup steps in the README and the sticky notes.

## Running the tests

Each demo has a `validate.js` that checks the workflow structure and runs the Code-node logic against test fixtures — no network and no external dependencies:

```bash
cd n8n-automation-demos/06-web-scraping-clean-data
node validate.js
```

## Need something similar?

These are starting points. If you need one adapted to your tools and process — or a different automation — message me on [Upwork](https://www.upwork.com/freelancers/~0128600f3a85d2d403).

## License

MIT — see [LICENSE](n8n-automation-demos/LICENSE).
