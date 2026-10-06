# Web Scraping → Cleaned Data → Google Sheets / Postgres, with Slack Alerts (n8n)

An n8n workflow you can import and reuse. On a schedule it scrapes a listing page, extracts every item, cleans and validates the fields, and upserts the good rows into **Google Sheets** (and optionally **Postgres**). When something goes wrong, it posts to **Slack**.

It ships pointed at [books.toscrape.com](https://books.toscrape.com), a public sandbox site built for scraping practice, so you can see it work before changing anything. To use it on another site, edit one node (**Config**).

## What it does

- **Scheduled scraping**: runs every 6 hours. You can change the interval in the trigger.
- **Robust extraction**: splits the page into product cards first, then reads the fields from each card. A card with a missing field can't push values out of line with other cards.
- **Data cleaning**:
  - collapses whitespace and strips junk characters
  - parses prices in US format (`$1,299.50`) and EU format (`1.299,00 €`), and detects the currency
  - turns relative links into absolute URLs
  - removes duplicates
- **Validation**: rows it can't use (no title, price can't be parsed, bad URL) are kept but marked `status=invalid`, with the reason in `issues`.
- **Idempotent storage**: upserts on `id` (the canonical product URL). Re-running updates prices; it doesn't create duplicates.
- **Smart alerts**: Slack is notified only when:
  - the fetch fails after 3 retries,
  - the page returns 0 listings (usually a layout or selector change), or
  - the share of invalid rows is above `max_invalid_ratio` (20% by default).

  Healthy runs send nothing.
- **No secrets in the file**: credentials are attached inside n8n after import.

## Flow

```
Every 6 Hours ─► Config ─► Fetch Page ──(ok)──► Extract Cards ─► Split Cards ─► Extract Fields ─► Clean & Normalize
                               │                                                                   │
                               │                                                   ┌───────────────┴──────────────┐
                               │                                                   ▼                              ▼
                               │                                           Keep Valid Rows                 Build Data Alert
                               │                                           │            │                         │
                               │                                           ▼            ▼                         │
                               │                             Upsert to Google Sheets  Upsert to Postgres          │
                               │                                                      (disabled by default)       │
                               └──(error)──► Format Fetch Error ─────────────────────────────────► Send Slack Alert ◄┘
```

| Node | Type | Purpose |
|---|---|---|
| Every 6 Hours | Schedule Trigger | Starts the run |
| Config | Edit Fields (Set) | Every site-specific setting lives here |
| Fetch Page | HTTP Request | GET with a User-Agent, 30 s timeout, 3 retries, separate error output |
| Extract Cards / Extract Fields | HTML | CSS-selector extraction |
| Split Cards | Code | Creates one item per card and marks empty pages |
| Clean & Normalize | Code | Cleans, normalizes, de-duplicates and validates rows |
| Keep Valid Rows | Filter | Passes only `status = ok` |
| Upsert to Google Sheets / Postgres | Google Sheets / Postgres | Append-or-update on `id` |
| Build Data Alert / Format Fetch Error | Code | Builds the alert message, or outputs nothing |
| Send Slack Alert | Slack | Posts the alert |

## Import & setup

1. In n8n (self-hosted or Cloud, version 1.x), go to **Workflows → Import from File** and choose `workflow.json`.
2. Open **Config** and set:
   - `target_url`: the page to scrape
   - `sel_card`, `sel_title`, `sel_price`, `sel_link`, `sel_availability`: CSS selectors. Card first; the other selectors are relative to the card.
   - `default_currency`: used when the price text has no currency symbol
   - `max_invalid_ratio`: share of invalid rows that triggers an alert. Default `0.2`.
   - `sheet_id`: the ID from your Google Sheet URL (`/spreadsheets/d/<ID>/edit`)
   - `slack_channel`: the Slack channel ID, for example `C0123ABCDEF` (in Slack, open the channel details; the ID is at the bottom)
3. **Google Sheets**: create a tab called `listings` with this header row:
   `id | title | price | currency | url | availability | source | scraped_at | status | issues`
   Then attach a *Google Sheets OAuth2* credential to **Upsert to Google Sheets**.
4. **Slack**: attach a Slack credential (a bot token with `chat:write`) to **Send Slack Alert**, and invite the bot to the channel.
5. *(Optional)* **Postgres**: run `schema.sql`, enable **Upsert to Postgres**, and attach a Postgres credential. You can disable the Sheets node if you only want the database.
6. Click **Execute workflow** and check the sheet. When it looks right, toggle **Active**.

The sticky notes on the canvas repeat these steps next to the nodes they apply to.

## Developing / testing locally

The Code-node logic lives in readable files under `src/`. `build.js` puts it into `workflow.json`.

```bash
node build.js      # regenerate workflow.json after editing src/*.js
node validate.js   # structure checks + Code-node unit tests (no network, no deps)
```

`validate.js` checks:

- node names and IDs are unique
- every connection points to a node that exists, and no node is left unconnected
- there is exactly one trigger
- `executionOrder = v1`
- no credentials or secrets are in the export

It then runs every Code node in a mocked n8n sandbox (`$input`, `$('Config')`) against the fixtures in `test/fixtures/`.

## Ideas for extending it

1. **Price-change and new-item alerts**: read the previous snapshot from Sheets or Postgres. Alert when a price moves more than X%, or when new items appear or old ones disappear. A Merge node in "compare datasets" mode makes this a few clicks.
2. **Pagination and many sources**: loop over "next page" links, or keep a list of sources in a sheet and process them with *Loop Over Items*. The same cleaning code covers all of them.
3. **JavaScript-heavy sites and anti-bot**: replace **Fetch Page** with a headless-browser or scraping API (Browserless, ScrapingBee, Apify), and add rotating proxies. Nothing downstream needs to change.

> Please scrape responsibly: respect each site's robots.txt and Terms of Service, and keep request rates low.
