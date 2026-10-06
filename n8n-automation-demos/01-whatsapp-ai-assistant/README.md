# WhatsApp Business API → AI Assistant (n8n + Claude / OpenAI)

A ready-to-import n8n workflow that answers your customers on WhatsApp with AI, around the clock.
A customer writes to your WhatsApp Business number. Claude (Anthropic) or OpenAI writes the answer, and the workflow sends it back as a quoted reply in the same chat, usually within a few seconds.

- **No custom server.** It uses the official WhatsApp Cloud API (Meta) and standard n8n nodes.
- **Switch AI providers in one field.** Set `aiProvider` to `anthropic` or `openai`.
- **Handles errors.** It acknowledges Meta right away, retries failed API calls, and if the AI is down the customer gets a polite fallback message instead of no reply.
- **No secrets in the file.** API keys are stored only in n8n Credentials.

## How it works

```
                         ┌─ GET  (Meta verification) ─► Handle Verification ─► Respond (challenge / 403)
WhatsApp Webhook ─► Config ─► Is Verification Request?
                         └─ POST (incoming message) ─► Acknowledge 200
                                                         │
                                                         ▼
                                                 Parse WhatsApp Message   (text, buttons, captions;
                                                         │                 status updates & reactions ignored)
                                                         ▼
                                                 Build AI Request         (system prompt + customer text)
                                                         │
                                                         ▼
                                                 Choose AI Provider ──► Ask Claude  ─┐
                                                                    └─► Ask OpenAI ─┤
                                                                                     ▼
                                                                          Extract AI Reply   (fallback on error,
                                                                                     │        4096-char limit)
                                                                                     ▼
                                                                          Send WhatsApp Reply (Graph API)
```

| Step | Node | What it does |
|---|---|---|
| 1 | **WhatsApp Webhook** | One public URL for both GET (verification) and POST (messages) |
| 2 | **Config** | All settings in one place: verify token, provider, models, prompt, fallback text |
| 3 | **Handle / Respond Verification** | Completes Meta's `hub.challenge` handshake (403 for a wrong token) |
| 4 | **Acknowledge 200** | Responds to Meta immediately, so Meta doesn't retry and send duplicates |
| 5 | **Parse WhatsApp Message** | Turns each incoming message into one item. Supports text, button and list replies, and media with captions |
| 6 | **Build AI Request** | Builds the Claude or OpenAI request body, including the customer's name and a language instruction |
| 7 | **Ask Claude / Ask OpenAI** | HTTP calls with 1 retry (2 attempts total) and a 60 s timeout. If a call still fails, the error is passed on instead of stopping the workflow |
| 8 | **Extract AI Reply** | Reads the response from either provider and switches to `fallbackReply` on error |
| 9 | **Send WhatsApp Reply** | `POST /{phone-number-id}/messages`, quoting the customer's message, with up to 3 attempts |

## Requirements

- n8n 1.x (self-hosted or n8n Cloud) reachable over **public HTTPS**
- A Meta developer app with the **WhatsApp** product, a phone number and a permanent access token (System User token with `whatsapp_business_messaging`)
- An API key from **Anthropic** or **OpenAI**

## Installation

1. In n8n: **Workflows → Import from File** → select `workflow.json`.
2. Open the **Config** node and set:
   - `config.verifyToken`: any long random string (you will paste it into Meta as well)
   - `config.aiProvider`: `anthropic` or `openai`
   - `config.anthropicModel` / `config.openaiModel`: defaults are `claude-sonnet-5` / `gpt-4o-mini`
   - `config.systemPrompt`: your business persona, FAQ and rules
   - `config.fallbackReply`, `config.maxTokens`, `config.graphApiVersion`
3. Create the credentials. All three are of type **Header Auth**:

   | Node | Header name | Header value |
   |---|---|---|
   | Ask Claude | `x-api-key` | `<ANTHROPIC_API_KEY>` |
   | Ask OpenAI | `Authorization` | `Bearer <OPENAI_API_KEY>` |
   | Send WhatsApp Reply | `Authorization` | `Bearer <WHATSAPP_ACCESS_TOKEN>` |

   You only need the AI credential that matches your `aiProvider`. The list of values is also in `.env.example`.
4. **Activate** the workflow and copy the **Production URL** of the *WhatsApp Webhook* node.
5. In the Meta App Dashboard → **WhatsApp → Configuration → Webhook**: paste the URL and your verify token, click **Verify and save**, then subscribe to the **messages** field.
6. Send a WhatsApp message to your business number. The AI reply should arrive within a few seconds.
   Check **Executions** in n8n to see every step.

## Validation & tests (optional, for developers)

Requires Node.js 18+. No dependencies or network access needed.

```bash
npm test          # = node validate.js
```

`validate.js` checks the workflow structure: unique names and IDs, valid connections, exactly one trigger, known node versions, `executionOrder: v1`, no credentials or secrets in the export.
It also runs the real JavaScript from the Code nodes against sample Meta, Claude and OpenAI payloads in `test/`, with the HTTP calls mocked:

- webhook verification (correct, wrong and empty token)
- message parsing (text, buttons, captions; reactions and status updates ignored)
- request and reply for both Claude and OpenAI, and the exact WhatsApp send payload
- error handling: fallback reply when the AI fails, 4096-character truncation

The Code node source lives in `src/code-nodes/`. After editing it, run `npm run build` to regenerate `workflow.json`.

## Project structure

```
workflow.json          n8n export: import this
build-workflow.js      regenerates workflow.json from src/code-nodes/*
src/code-nodes/        JavaScript of the 4 Code nodes
validate.js            structure checks + logic tests
test/                  sample webhook / AI payloads
.env.example           list of the secrets you need (goes into n8n Credentials)
```

## Ideas for next steps

1. **Conversation memory:** store the last N messages per phone number (n8n Data Table, Postgres or Redis) so the assistant keeps context across messages. You could also switch to the n8n AI Agent node with a Window Buffer Memory.
2. **Knowledge base and human handoff:** answer from your own FAQ or product catalog (RAG with a vector store). When the AI isn't confident or the customer asks for a person, notify your team in Slack or Telegram, or create a ticket in your CRM.
3. **Security and richer media:** verify Meta's `X-Hub-Signature-256` header with your App Secret, skip duplicate deliveries by message ID, and add voice-note transcription (Whisper) and image understanding so the assistant can handle audio and photos as well as text.
