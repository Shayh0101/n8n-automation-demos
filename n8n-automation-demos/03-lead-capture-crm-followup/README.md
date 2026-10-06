# Lead Capture → CRM (HubSpot / GoHighLevel / Airtable) + Email Follow-up — n8n template

A ready-to-import n8n workflow that takes leads from any website form, cleans and validates them, **upserts** the contact into your CRM (HubSpot, GoHighLevel or Airtable — switch with one setting) and sends a personalised follow-up email right away.

## What it does

- **Accepts any form that can POST flat fields (JSON or form-urlencoded):** Webflow, WordPress/Elementor, Contact Form 7 (via a webhook plugin), Framer, custom HTML. Forms with nested payloads (e.g. Typeform) need a small mapping tweak in the Normalize node. Common field names are recognised automatically (`name` / `first_name` / `firstName`, `email` / `your-email`, `phone` / `tel`, …).
- **Cleans the data:** trims spaces, lowercases emails, splits full names, capitalises names, normalises phone numbers, captures UTM tags from the body or the URL query.
- **Rejects bad leads:** missing/invalid email, invalid phone, overly long messages and bots (honeypot field) get a `422` response with the reasons and never reach your CRM.
- **No duplicates:** all three CRM calls are upserts keyed on email, so a repeat submission updates the existing contact.
- **Instant follow-up:** sends an HTML + plain-text email with the lead's name, their message and your booking link. User input is HTML-escaped.
- **Handles errors:** CRM calls retry 3 times. If the email fails, the run still finishes because the lead is already saved. Valid and invalid leads get a clear JSON response (`200` / `422`). If the CRM is still unreachable after the retries, n8n returns its standard error response and the failed run is visible under **Executions** (see idea 3 below for alerts).

## Flow

```
Lead Webhook (POST /lead-capture)
   └─ Config (CRM choice, company name, sender, booking link)
       └─ Normalize & Validate Lead (Code)
           └─ Lead Valid?
               ├─ false → Respond 422 { ok:false, errors:[...] }
               └─ true  → Route to CRM (Switch)
                           ├─ HubSpot: Upsert Contact      ┐
                           ├─ GoHighLevel: Upsert Contact  ├─→ Build Follow-up Email (Code)
                           └─ Airtable: Upsert Record      ┘        └─ Send Follow-up Email (SMTP)
                                                                         └─ Respond 200 { ok:true, crmRecordId }
```

## Import and setup (about 5 minutes)

1. In n8n, go to **Workflows → Import from File** and pick `workflow.json`.
2. Open the **Config** node and set:
   | Field | Example |
   |---|---|
   | `config.crmProvider` | `hubspot`, `gohighlevel` or `airtable` |
   | `config.companyName` | `Acme Inc.` |
   | `config.fromEmail` | `hello@acme.com` (must be allowed by your SMTP) |
   | `config.bookingUrl` | your Calendly/Cal.com link (leave empty to hide it) |
   | `config.ghlLocationId` | GoHighLevel only |
   | `config.airtableBaseId`, `config.airtableTable` | Airtable only |
3. Add credentials. You only need the one for the CRM you picked:
   - **HubSpot:** create a Private App with the `crm.objects.contacts.write` and `crm.objects.contacts.read` scopes. In n8n, create a *HubSpot App Token* credential and select it in **HubSpot: Upsert Contact**.
   - **GoHighLevel:** create a *Header Auth* credential with name `Authorization` and value `Bearer <Private Integration token>`. Select it in **GoHighLevel: Upsert Contact**.
   - **Airtable:** create an *Airtable Personal Access Token* credential with the `data.records:write` scope. Your table needs an `Email` column plus `First Name, Last Name, Phone, Company, Message, Source, UTM Source, UTM Medium, UTM Campaign, Submitted At`.
   - **Email:** add an *SMTP* credential (Gmail, SendGrid, Postmark, Mailgun, etc.) to **Send Follow-up Email**.
4. **Activate** the workflow, copy the **Production URL** from *Lead Webhook* and set it as your form's webhook/action URL.

The **sticky notes** inside the workflow repeat these steps. `.env.example` lists every value you need to collect.

### Try it

```bash
curl -X POST https://YOUR-N8N/webhook/lead-capture \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe","email":"jane@example.com","phone":"+1 415 555 0134","company":"Doe Studio","message":"Need a quote","utm_source":"google"}'
# → {"ok":true,"crm":"hubspot","crmRecordId":"51"}
```

## Customising

- **Email copy:** edit the texts in the **Build Follow-up Email** Code node.
- **Field mapping and extra CRM properties:** edit **Normalize & Validate Lead**.
- For maintainers: the Code-node sources live in `src/`. Run `npm run build` to regenerate `workflow.json`, then `npm test`.

## Tests

```bash
npm test        # or: node validate.js
```

`validate.js` doesn't need n8n or network access. It checks that:
1. The workflow structure is sound: unique node names and IDs, all connections valid, exactly one trigger, every node reachable, `executionOrder: v1`, no exported credentials or secrets.
2. Lead normalisation and validation work on 7 sample leads (`test/leads.json`).
3. Email building pulls the CRM record ID out of mocked HubSpot, GoHighLevel and Airtable responses and escapes HTML correctly (`test/emails.json`).
4. A simulated end-to-end run for each CRM routes through the Switch, the mocked CRM call, the email node and the 200 response.

## Ideas for next steps

1. **Multi-step nurture:** add a Wait node and a CRM check so a second email goes out after 2 days, or a Slack/SMS alert, but only if the lead hasn't replied or booked a call.
2. **AI lead scoring and routing:** classify the message with an LLM (budget, urgency, service type), write the score to the CRM and assign hot leads to a sales rep straight away.
3. **Monitoring and enrichment:** add an Error Trigger workflow that sends failed leads to Slack or a Google Sheet so nothing gets lost, and enrich contacts (company size, LinkedIn) through Clearbit or Apollo before the upsert.
