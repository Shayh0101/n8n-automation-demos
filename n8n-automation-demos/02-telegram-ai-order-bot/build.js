#!/usr/bin/env node
// Assembles workflow.json from src/nodes/*.js so Code-node logic can be edited
// and tested as normal JS files. Run: node build.js
'use strict';
const fs = require('fs');
const path = require('path');

const code = (file) => fs.readFileSync(path.join(__dirname, 'src', 'nodes', file), 'utf8');

const DEFAULT_CATALOG = [
  { name: 'Margherita Pizza', price: 9.5, description: 'Tomato, mozzarella, basil' },
  { name: 'Pepperoni Pizza', price: 11, description: 'Tomato, mozzarella, pepperoni' },
  { name: 'Caesar Salad', price: 7.25, description: 'Romaine, parmesan, croutons' },
  { name: 'Lemonade', price: 3, description: '0.5 L, homemade' },
];

const SHEET_COLUMNS = [
  'Order ID', 'Created At', 'Status', 'Telegram Chat ID', 'Telegram Username', 'Customer Name',
  'Phone', 'Address', 'Items', 'Total', 'Currency', 'Notes',
];

const sticky = (id, name, content, position, width, height, color) => ({
  parameters: { content, height, width, color },
  id, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position,
});

const nodes = [
  sticky('a1f0c001-0000-4000-8000-000000000001', 'Setup Guide',
    '## 🛒 Telegram AI Order Bot → Google Sheets\n\n' +
    'Customers chat with the bot in natural language; AI extracts the order, the bot asks for missing details, and complete orders land in Google Sheets.\n\n' +
    '### Setup (5 min)\n' +
    '1. **Telegram Trigger** + **Send Telegram Reply** → create a *Telegram API* credential with the token from @BotFather.\n' +
    '2. **Call LLM** → create an *OpenAI API* credential (or point the URL to any OpenAI-compatible API).\n' +
    '3. **Save Order to Sheet** → *Google Sheets OAuth2* credential, paste your Spreadsheet ID, tab name `Orders`.\n' +
    '4. Edit products, currency and model in **Shop Config**.\n' +
    '5. Activate the workflow (Telegram needs a public HTTPS URL for n8n).',
    [-80, -420], 520, 400, 4),
  sticky('a1f0c001-0000-4000-8000-000000000002', 'Note: Sheet Columns',
    '### 📄 Google Sheet header row (tab `Orders`)\n' +
    SHEET_COLUMNS.map((c) => `\`${c}\``).join(' · ') +
    '\n\nCreate these headers in row 1 before the first run.',
    [1480, -260], 380, 220, 6),
  sticky('a1f0c001-0000-4000-8000-000000000003', 'Note: AI & Drafts',
    '### 🤖 How the AI step works\n' +
    'The LLM only **extracts** data (items, name, phone, address) as JSON. Prices and totals are computed in code from **Shop Config** — the AI can\'t change them.\n\n' +
    'Partial orders are stored per chat in workflow static data, so customers can send details in several messages. `/cancel` clears the draft.\n\n' +
    '_Static data persists only for the activated (production) workflow._',
    [700, -340], 440, 300, 5),
  {
    parameters: { updates: ['message'], additionalFields: {} },
    id: 'b2e1d002-0000-4000-8000-000000000001', name: 'Telegram Trigger',
    type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.1, position: [0, 200],
    webhookId: 'c3a2b1d0-1111-4222-8333-944455566677',
  },
  {
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'cfg-1', name: 'shopName', value: 'Demo Pizza', type: 'string' },
          { id: 'cfg-2', name: 'currency', value: 'USD', type: 'string' },
          { id: 'cfg-3', name: 'aiModel', value: 'gpt-4o-mini', type: 'string' },
          { id: 'cfg-4', name: 'catalogJson', value: JSON.stringify(DEFAULT_CATALOG, null, 2), type: 'string' },
        ],
      },
      includeOtherFields: true,
      options: {},
    },
    id: 'b2e1d002-0000-4000-8000-000000000002', name: 'Shop Config',
    type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 200],
  },
  {
    parameters: { jsCode: code('normalize-message.js') },
    id: 'b2e1d002-0000-4000-8000-000000000003', name: 'Normalize Message',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 200],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{
          id: 'if-needs-ai', leftValue: '={{ $json.needsAi }}', rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'b2e1d002-0000-4000-8000-000000000004', name: 'Needs AI?',
    type: 'n8n-nodes-base.if', typeVersion: 2, position: [660, 200],
  },
  {
    parameters: { jsCode: code('build-ai-request.js') },
    id: 'b2e1d002-0000-4000-8000-000000000005', name: 'Build AI Request',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 80],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody) }}',
      options: { timeout: 30000 },
    },
    id: 'b2e1d002-0000-4000-8000-000000000006', name: 'Call LLM',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1100, 80],
    retryOnFail: true, maxTries: 2, waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: code('parse-ai-response.js') },
    id: 'b2e1d002-0000-4000-8000-000000000007', name: 'Parse AI Response',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 80],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{
          id: 'if-complete', leftValue: '={{ $json.isCompleteOrder }}', rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'b2e1d002-0000-4000-8000-000000000008', name: 'Order Complete?',
    type: 'n8n-nodes-base.if', typeVersion: 2, position: [1540, 80],
  },
  {
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: 'PASTE_YOUR_SPREADSHEET_ID', mode: 'id' },
      sheetName: { __rl: true, value: 'Orders', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: Object.fromEntries(SHEET_COLUMNS.map((c) => [c, `={{ $json.sheetRow[${JSON.stringify(c)}] }}`])),
        matchingColumns: [],
        schema: SHEET_COLUMNS.map((c) => ({
          id: c, displayName: c, required: false, defaultMatch: false,
          display: true, type: 'string', canBeUsedToMatch: true,
        })),
      },
      options: {},
    },
    id: 'b2e1d002-0000-4000-8000-000000000009', name: 'Save Order to Sheet',
    type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [1760, -20],
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: code('build-confirmation.js') },
    id: 'b2e1d002-0000-4000-8000-000000000010', name: 'Build Confirmation',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, -20],
  },
  {
    parameters: {
      chatId: '={{ $json.chatId }}',
      text: '={{ $json.reply }}',
      additionalFields: { appendAttribution: false },
    },
    id: 'b2e1d002-0000-4000-8000-000000000011', name: 'Send Telegram Reply',
    type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [2200, 200],
  },
];

const main = (...targets) => ({ main: targets.map((t) => (t ? [{ node: t, type: 'main', index: 0 }] : [])) });

const workflow = {
  name: 'Telegram AI Order Bot → Google Sheets',
  nodes,
  connections: {
    'Telegram Trigger': main('Shop Config'),
    'Shop Config': main('Normalize Message'),
    'Normalize Message': main('Needs AI?'),
    'Needs AI?': main('Build AI Request', 'Send Telegram Reply'),
    'Build AI Request': main('Call LLM'),
    'Call LLM': main('Parse AI Response'),
    'Parse AI Response': main('Order Complete?'),
    'Order Complete?': main('Save Order to Sheet', 'Send Telegram Reply'),
    'Save Order to Sheet': main('Build Confirmation'),
    'Build Confirmation': main('Send Telegram Reply'),
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
  active: false,
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
