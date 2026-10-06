# AI PDF Data Extraction → Google Sheets (n8n template)

Drop a PDF into a Google Drive folder and get a clean, structured row in Google Sheets a minute later.
The workflow reads invoices, receipts, purchase orders and quotes, uses **Claude (Anthropic)** to extract
the key fields, validates the numbers and dates, and flags anything that needs a human look.

**Fields extracted:** document type, vendor, customer, document number, document date, due date,
currency, subtotal, tax, total, line items, model confidence, plus the file name, ID and Drive link.

## How it works

```
Google Drive Trigger (new PDF in folder)
        │
   Download PDF
        │
 Extract PDF Text  (n8n built-in, no OCR service needed for text PDFs)
        │
 Build AI Request  (Code: clean text, truncate, build prompt + JSON schema)
        │
    Has Text? ──── no ──► Flag Unreadable PDF ──► Append NEEDS_OCR Row
        │ yes
 Claude - Extract Data  (HTTP → Anthropic Messages API, 3 retries)
        │
 Parse & Validate  (Code: parse JSON, normalise amounts/dates, cross-check totals)
        │
 Append to Sheet  (Google Sheets, columns auto-mapped)
```

Every document produces exactly one row, with a **Status** column:

| Status | Meaning |
|---|---|
| `OK` | Extracted, all checks passed |
| `NEEDS_REVIEW` | Extracted, but subtotal + tax ≠ total, low confidence, or vendor/total missing (reason in **Notes**) |
| `NEEDS_OCR` | Scanned/image-only PDF with no selectable text |
| `ERROR` | AI call failed or the answer wasn't valid JSON (reason in **Notes**). The batch keeps running. |

The validation layer handles real-world formats: `$1,234.56`, `1.234,56`, `(12.00)`, `03/15/2026`, `5.3.2026`,
`March 5, 2026`, and model answers wrapped in ```` ```json ```` fences.

## Setup (about 5 minutes)

1. In n8n: **Workflows → Import from File** → select `workflow.json`.
2. **Google Drive Trigger** – create/select a *Google Drive OAuth2* credential and choose the folder to watch.
3. **Download PDF** – select the same Google Drive credential.
4. **Claude - Extract Data** – create a *Header Auth* credential:
   - Name: `x-api-key`
   - Value: your Anthropic API key (from console.anthropic.com)
5. **Append to Sheet** and **Append NEEDS_OCR Row** – select a *Google Sheets OAuth2* credential,
   paste your spreadsheet URL, and make sure the spreadsheet has a tab named **`Extracted`**
   (headers are created automatically from the first row).
6. Upload a sample PDF to the folder, click **Test workflow**, check the sheet, then **Activate**.

The workflow file contains **no credentials or API keys** – everything is connected inside your n8n instance.
Setup instructions are also on sticky notes in the canvas.

### Optional settings
In the **Build AI Request** node (top of the code):
- `MODEL` – Claude model id (default `claude-sonnet-5`; use a Haiku model for cheaper bulk runs)
- `MAX_CHARS` – maximum text length sent to the model (cost control for very long PDFs)

In **Parse & Validate**: `LOW_CONFIDENCE` threshold and `TOTAL_TOLERANCE` for the totals cross-check.
To extract different fields (e.g. contracts, bank statements, CVs), edit the JSON schema in the system prompt
and the column mapping in **Parse & Validate**.

## Project files

| File | Purpose |
|---|---|
| `workflow.json` | Ready-to-import n8n workflow |
| `src/*.js` | Source of the three Code nodes (readable and testable) |
| `build.js` | Regenerates `workflow.json` from `src/` |
| `validate.js` | Structure checks + logic tests with mocked n8n and Claude API |
| `test/fixtures/` | Sample PDF text and sample Claude responses |

Run the checks (Node.js 18+, no dependencies):

```bash
npm test        # = node build.js && node validate.js
```

It verifies unique node names/IDs, valid connections, exactly one trigger, no orphan nodes, no exported
credentials, `executionOrder: v1`, and runs every Code node against the fixtures
(clean invoice, European number format with wrong totals, API error, non-JSON answer, scanned PDF).

## Ideas for extension

1. **OCR for scanned PDFs** – send `NEEDS_OCR` files to Claude as a PDF/image document block
   (vision) or to Google Document AI, so scanned receipts are processed too.
2. **Line-item sheet + duplicate detection** – write each line item to a second tab and skip documents whose
   vendor + document number already exist (Google Sheets lookup before append).
3. **Review & notifications** – post `NEEDS_REVIEW` / `ERROR` rows to Slack or email with the Drive link,
   and move processed files to `Processed/` or `Failed/` folders; add Gmail/Outlook attachments as a second input.
