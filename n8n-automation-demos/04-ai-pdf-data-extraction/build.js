#!/usr/bin/env node
// Generates workflow.json from the Code-node sources in src/.
// Edit src/*.js, then run: node build.js && node validate.js
'use strict';
const fs = require('fs');
const path = require('path');

const code = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const SPREADSHEET_PLACEHOLDER = 'PASTE_YOUR_GOOGLE_SHEET_URL_HERE';
const SHEET_TAB = 'Extracted';

const nodes = [
  // ---------------- Sticky notes ----------------
  {
    id: 'a1f0c001-0000-4000-8000-000000000001',
    name: 'Sticky - Overview',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-260, -400],
    parameters: {
      width: 520,
      height: 380,
      color: 4,
      content:
        '## AI PDF Data Extraction -> Google Sheets\n\n' +
        'Drop a PDF (invoice, receipt, PO, quote) into a Google Drive folder.\n' +
        'The workflow downloads it, extracts the text, asks Claude to return structured JSON, ' +
        'validates numbers & dates, and appends one row per document to Google Sheets.\n\n' +
        '**Statuses written to the sheet**\n' +
        '- `OK` - extracted and checks passed\n' +
        '- `NEEDS_REVIEW` - extracted, but totals mismatch / low confidence / missing fields\n' +
        '- `NEEDS_OCR` - scanned PDF without selectable text\n' +
        '- `ERROR` - AI call or JSON parsing failed (see Notes column)\n\n' +
        'No credentials are stored in this file.',
    },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000002',
    name: 'Sticky - Setup',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [300, -400],
    parameters: {
      width: 620,
      height: 380,
      color: 6,
      content:
        '## How to set up (5 min)\n\n' +
        '1. **Google Drive Trigger** - add a *Google Drive OAuth2* credential, pick the folder to watch.\n' +
        '2. **Download PDF** - select the same Google Drive credential.\n' +
        '3. **Claude - Extract Data** - create a *Header Auth* credential:\n' +
        '   Name: `x-api-key`, Value: your Anthropic API key.\n' +
        '4. **Append to Sheet** (both nodes) - add a *Google Sheets OAuth2* credential, ' +
        'paste your spreadsheet URL and make sure a tab named `' + SHEET_TAB + '` exists ' +
        '(headers are created automatically from the first row).\n' +
        '5. Optional: change the model / max text length in **Build AI Request**.\n' +
        '6. Click **Test workflow** with a sample PDF, then **Activate**.',
    },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000003',
    name: 'Sticky - Error handling',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [960, -400],
    parameters: {
      width: 440,
      height: 380,
      color: 3,
      content:
        '## Error handling\n\n' +
        '- The Claude call retries 3x (5 s apart) and then *continues* with the error, ' +
        'so a failed document becomes an `ERROR` row instead of stopping the batch.\n' +
        '- Model output is parsed defensively (code fences / stray text tolerated).\n' +
        '- Amounts like `$1,234.56` or `1.234,56` are normalised to numbers, dates to `YYYY-MM-DD`.\n' +
        '- `subtotal + tax` is cross-checked against `total`.',
    },
  },

  // ---------------- Pipeline ----------------
  {
    id: 'a1f0c001-0000-4000-8000-000000000010',
    name: 'Google Drive Trigger',
    type: 'n8n-nodes-base.googleDriveTrigger',
    typeVersion: 1,
    position: [-200, 100],
    parameters: {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      triggerOn: 'specificFolder',
      folderToWatch: { __rl: true, value: '', mode: 'list', cachedResultName: '' },
      event: 'fileCreated',
      options: { fileType: 'application/pdf' },
    },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000011',
    name: 'Download PDF',
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: [20, 100],
    parameters: {
      operation: 'download',
      fileId: { __rl: true, value: '={{ $json.id }}', mode: 'id' },
      options: {},
    },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000012',
    name: 'Extract PDF Text',
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: [240, 100],
    parameters: { operation: 'pdf', binaryPropertyName: 'data', options: {} },
    onError: 'continueRegularOutput',
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000013',
    name: 'Build AI Request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [460, 100],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code('build-ai-request.js') },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000014',
    name: 'Has Text?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [680, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'b7d2e5a0-1c3f-4e8a-9d11-2f6b0c4a7e01',
            leftValue: '={{ $json.hasText }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000015',
    name: 'Claude - Extract Data',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [920, 0],
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody) }}',
      options: { timeout: 120000 },
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000016',
    name: 'Parse & Validate',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1140, 0],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code('parse-ai-response.js') },
  },
  {
    id: 'a1f0c001-0000-4000-8000-000000000017',
    name: 'Flag Unreadable PDF',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [920, 220],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code('flag-unreadable.js') },
  },
];

const sheetsNode = (id, name, position) => ({
  id,
  name,
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position,
  parameters: {
    operation: 'append',
    documentId: { __rl: true, value: SPREADSHEET_PLACEHOLDER, mode: 'url' },
    sheetName: { __rl: true, value: SHEET_TAB, mode: 'name' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
    options: {},
  },
});

nodes.push(
  sheetsNode('a1f0c001-0000-4000-8000-000000000018', 'Append to Sheet', [1360, 0]),
  sheetsNode('a1f0c001-0000-4000-8000-000000000019', 'Append NEEDS_OCR Row', [1140, 220])
);

const link = (node) => [{ node, type: 'main', index: 0 }];
const connections = {
  'Google Drive Trigger': { main: [link('Download PDF')] },
  'Download PDF': { main: [link('Extract PDF Text')] },
  'Extract PDF Text': { main: [link('Build AI Request')] },
  'Build AI Request': { main: [link('Has Text?')] },
  'Has Text?': { main: [link('Claude - Extract Data'), link('Flag Unreadable PDF')] },
  'Claude - Extract Data': { main: [link('Parse & Validate')] },
  'Parse & Validate': { main: [link('Append to Sheet')] },
  'Flag Unreadable PDF': { main: [link('Append NEEDS_OCR Row')] },
};

const workflow = {
  name: 'AI PDF Data Extraction -> Google Sheets',
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
