#!/usr/bin/env node
// Generates workflow.json from the readable Code-node sources in src/.
// Edit src/*.js or the node definitions below, then run: node build.js
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const cfg = (key) => `={{ $('Config').first().json.${key} }}`;

let n = 0;
const id = () => `a1b2c3d4-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: id(), name, type, typeVersion, position, ...extra,
});

const sticky = (name, position, width, height, color, content) =>
  node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });

const assignment = (name, value, type = 'string') => ({ id: id(), name, value, type });

const nodes = [
  // ---------- Setup notes ----------
  sticky('Note: Overview', [-660, -420], 520, 560, 7,
    '## Web scraping -> cleaned data -> Sheets/DB + alerts\n\n' +
    'Every 6 h this workflow fetches a listing page, extracts each product card, ' +
    'cleans & validates the fields, upserts valid rows into Google Sheets ' +
    '(and optionally Postgres) and posts a Slack alert when something looks wrong.\n\n' +
    '### Setup (5 min)\n' +
    '1. Open **Config** and set `target_url`, CSS selectors, `sheet_id`, `slack_channel`.\n' +
    '2. **Upsert to Google Sheets** -> add a Google Sheets OAuth2 credential. ' +
    'Sheet tab `listings` with header row:\n' +
    '`id | title | price | currency | url | availability | source | scraped_at | status | issues`\n' +
    '3. **Send Slack Alert** -> add a Slack credential (bot token, `chat:write`).\n' +
    '4. (Optional) Enable **Upsert to Postgres** and add a Postgres credential (see `schema.sql`).\n' +
    '5. Click *Execute workflow* once, check the sheet, then Activate.\n\n' +
    'Default target is the public scraping sandbox books.toscrape.com, so it works out of the box.'),
  sticky('Note: Config', [-120, -260], 300, 220, 5,
    '### 1. Config\nAll site-specific settings live here: URL, CSS selectors, ' +
    'Sheet ID, Slack channel, alert threshold. No other node needs editing to point ' +
    'the template at a new site.'),
  sticky('Note: Fetch', [220, -260], 300, 220, 5,
    '### 2. Fetch\nGET with a browser User-Agent, 30 s timeout, 3 retries. ' +
    'If it still fails, the **error output** goes to the alert branch instead of ' +
    'crashing the run.\nRespect robots.txt and the site ToS.'),
  sticky('Note: Clean', [700, -260], 420, 220, 5,
    '### 3. Extract & clean\nCards are split into items, fields extracted per card ' +
    '(robust to missing fields), then **Clean & Normalize** trims text, parses US/EU ' +
    'prices + currency, makes URLs absolute, dedupes, and marks bad rows ' +
    '`status=invalid` with a reason.'),
  sticky('Note: Store', [1340, -420], 320, 200, 4,
    '### 4. Store\nOnly `status=ok` rows are upserted, keyed by `id` (canonical URL), ' +
    'so re-runs update prices instead of creating duplicates.'),
  sticky('Note: Alerts', [1340, 360], 320, 200, 3,
    '### 5. Alerts\nSlack is pinged only when: the fetch failed, the page returned ' +
    'no listings (selectors broke), or the invalid-row ratio exceeds ' +
    '`max_invalid_ratio`. Healthy runs stay silent.'),

  // ---------- Pipeline ----------
  node('Every 6 Hours', 'n8n-nodes-base.scheduleTrigger', 1.2, [-100, 0], {
    rule: { interval: [{ field: 'hours', hoursInterval: 6 }] },
  }),
  node('Config', 'n8n-nodes-base.set', 3.4, [120, 0], {
    mode: 'manual',
    assignments: {
      assignments: [
        assignment('target_url', 'https://books.toscrape.com/catalogue/page-1.html'),
        assignment('source_name', 'books.toscrape.com'),
        assignment('sel_card', 'article.product_pod'),
        assignment('sel_title', 'h3 a'),
        assignment('sel_price', '.price_color'),
        assignment('sel_link', 'h3 a'),
        assignment('sel_availability', '.availability'),
        assignment('default_currency', 'USD'),
        assignment('max_invalid_ratio', 0.2, 'number'),
        assignment('sheet_id', 'YOUR_GOOGLE_SHEET_ID'),
        assignment('slack_channel', 'YOUR_SLACK_CHANNEL_ID'),
      ],
    },
    options: {},
  }),
  node('Fetch Page', 'n8n-nodes-base.httpRequest', 4.2, [340, 0], {
    url: '={{ $json.target_url }}',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (compatible; n8n-scraper/1.0)' },
        { name: 'Accept', value: 'text/html,application/xhtml+xml' },
      ],
    },
    options: {
      response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
      timeout: 30000,
    },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueErrorOutput' }),
  node('Extract Cards', 'n8n-nodes-base.html', 1.2, [580, -80], {
    operation: 'extractHtmlContent',
    dataPropertyName: 'data',
    extractionValues: {
      values: [{ key: 'cards', cssSelector: cfg('sel_card'), returnValue: 'html', returnArray: true }],
    },
    options: { trimValues: true },
  }),
  node('Split Cards', 'n8n-nodes-base.code', 2, [800, -80], { jsCode: src('split-cards.js') }),
  node('Extract Fields', 'n8n-nodes-base.html', 1.2, [1020, -80], {
    operation: 'extractHtmlContent',
    dataPropertyName: 'cards',
    extractionValues: {
      values: [
        { key: 'title_attr', cssSelector: cfg('sel_title'), returnValue: 'attribute', attribute: 'title' },
        { key: 'title_text', cssSelector: cfg('sel_title'), returnValue: 'text' },
        { key: 'price', cssSelector: cfg('sel_price'), returnValue: 'text' },
        { key: 'url', cssSelector: cfg('sel_link'), returnValue: 'attribute', attribute: 'href' },
        { key: 'availability', cssSelector: cfg('sel_availability'), returnValue: 'text' },
      ],
    },
    options: { trimValues: true, cleanUpText: true },
  }),
  node('Clean & Normalize', 'n8n-nodes-base.code', 2, [1240, -80], { jsCode: src('clean-normalize.js') }),
  node('Keep Valid Rows', 'n8n-nodes-base.filter', 2.2, [1460, -180], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: id(),
        leftValue: '={{ $json.status }}',
        rightValue: 'ok',
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  }),
  node('Upsert to Google Sheets', 'n8n-nodes-base.googleSheets', 4.5, [1700, -260], {
    operation: 'appendOrUpdate',
    documentId: { __rl: true, value: cfg('sheet_id'), mode: 'id' },
    sheetName: { __rl: true, value: 'listings', mode: 'name' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['id'], schema: [] },
    options: {},
  }),
  node('Upsert to Postgres', 'n8n-nodes-base.postgres', 2.5, [1700, -80], {
    operation: 'upsert',
    schema: { __rl: true, value: 'public', mode: 'list', cachedResultName: 'public' },
    table: { __rl: true, value: 'listings', mode: 'name' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['id'], schema: [] },
    options: {},
  }, { disabled: true }),
  node('Build Data Alert', 'n8n-nodes-base.code', 2, [1460, 120], { jsCode: src('build-data-alert.js') }),
  node('Format Fetch Error', 'n8n-nodes-base.code', 2, [580, 200], { jsCode: src('format-fetch-error.js') }),
  node('Send Slack Alert', 'n8n-nodes-base.slack', 2.3, [1700, 160], {
    select: 'channel',
    channelId: { __rl: true, value: cfg('slack_channel'), mode: 'id' },
    text: '={{ $json.message }}',
    otherOptions: {},
  }),
];

const link = (...targets) => ({ main: targets.map((t) => (t ? [].concat(t).map((node) => ({ node, type: 'main', index: 0 })) : [])) });

const connections = {
  'Every 6 Hours': link('Config'),
  Config: link('Fetch Page'),
  'Fetch Page': link('Extract Cards', 'Format Fetch Error'), // output 0 = success, 1 = error
  'Extract Cards': link('Split Cards'),
  'Split Cards': link('Extract Fields'),
  'Extract Fields': link('Clean & Normalize'),
  'Clean & Normalize': link(['Keep Valid Rows', 'Build Data Alert']),
  'Keep Valid Rows': link(['Upsert to Google Sheets', 'Upsert to Postgres']),
  'Build Data Alert': link('Send Slack Alert'),
  'Format Fetch Error': link('Send Slack Alert'),
};

const workflow = {
  name: 'Web Scraping -> Cleaned Data -> Sheets/DB with Alerts',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'UTC' },
  tags: [],
  meta: { templateCredsSetupCompleted: false },
};

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
