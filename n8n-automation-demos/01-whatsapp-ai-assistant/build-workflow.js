#!/usr/bin/env node
// Generates workflow.json from the Code-node sources in src/code-nodes/.
// Edit the JS files there (they are unit-tested by validate.js), then run:
//   node build-workflow.js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const code = (file) => fs.readFileSync(path.join(__dirname, 'src/code-nodes', file), 'utf8').trimEnd();

// Deterministic UUID per node name, so rebuilding produces stable diffs.
const id = (name) => {
  const h = crypto.createHash('sha1').update('wa-ai:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters,
  id: id(name),
  name,
  type,
  typeVersion,
  position,
  ...extra,
});

const sticky = (name, position, width, height, color, content) =>
  node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });

const assignment = (name, value, type = 'string') => ({ id: id('cfg:' + name), name, value, type });

const condition = (name, leftValue, operator, rightValue = '') => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: id('cond:' + name), leftValue, rightValue, operator }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: name,
});

const AI_HTTP_OPTIONS = { timeout: 60000 };
const RETRY = { retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 };

const nodes = [
  // ---------------------------------------------------------------- notes
  sticky('Note: Overview', [-560, -420], 520, 640, 7,
    '## WhatsApp Business API → AI Assistant\n\n' +
    'Answers incoming WhatsApp messages with Claude (Anthropic) or OpenAI.\n\n' +
    '**Flow**\n1. Meta calls the webhook (GET = verification, POST = messages)\n' +
    '2. POST is acknowledged with `200` immediately (Meta retries slow webhooks)\n' +
    '3. Message is parsed (text, buttons, captions; status updates ignored)\n' +
    '4. AI generates a reply (provider chosen in **Config**)\n' +
    '5. Reply is sent back via the WhatsApp Cloud API\n\n' +
    'If the AI call fails, the customer gets the `fallbackReply` instead of silence.\n\n' +
    '**Setup:** see the Step 1–4 notes ➜ and README.md'),
  sticky('Note: Step 1 Config', [0, -420], 420, 300, 6,
    '### Step 1 – Edit the Config node\n\n' +
    '- `verifyToken` – any secret string; paste the same value in Meta → WhatsApp → Configuration → Webhook\n' +
    '- `aiProvider` – `anthropic` or `openai`\n' +
    '- model names, `systemPrompt`, `maxTokens`, `fallbackReply`\n\n' +
    'No API keys go here – keys live in n8n Credentials.'),
  sticky('Note: Step 2 Meta', [-560, 260], 520, 300, 6,
    '### Step 2 – Connect Meta webhook\n\n' +
    '1. Activate the workflow and copy the **Production URL** of *WhatsApp Webhook*\n' +
    '2. Meta App → WhatsApp → Configuration → Webhook: paste URL + `verifyToken`, click *Verify and save*\n' +
    '3. Subscribe to the **messages** field\n\n' +
    'The URL must be public HTTPS (n8n Cloud or a tunnel / reverse proxy).'),
  sticky('Note: Step 3 AI', [1080, -460], 440, 300, 6,
    '### Step 3 – AI credentials (Header Auth)\n\n' +
    '**Ask Claude** → new *Header Auth* credential:\n`Name: x-api-key`, `Value: <ANTHROPIC_API_KEY>`\n\n' +
    '**Ask OpenAI** → new *Header Auth* credential:\n`Name: Authorization`, `Value: Bearer <OPENAI_API_KEY>`\n\n' +
    'You only need the one matching `aiProvider`.'),
  sticky('Note: Step 4 WhatsApp', [1760, -460], 420, 300, 6,
    '### Step 4 – WhatsApp send credential\n\n' +
    '**Send WhatsApp Reply** → new *Header Auth* credential:\n`Name: Authorization`, `Value: Bearer <WHATSAPP_ACCESS_TOKEN>`\n\n' +
    'Use a permanent System User token with `whatsapp_business_messaging` permission.\n' +
    'The phone number ID is taken from the incoming webhook automatically.'),

  // ---------------------------------------------------------------- trigger
  node('WhatsApp Webhook', 'n8n-nodes-base.webhook', 2, [-200, 0], {
    multipleMethods: true,
    httpMethod: ['GET', 'POST'],
    path: 'whatsapp-ai',
    responseMode: 'responseNode',
    options: {},
  }, { webhookId: id('webhook') }),

  node('Config', 'n8n-nodes-base.set', 3.4, [40, 0], {
    mode: 'manual',
    assignments: {
      assignments: [
        assignment('config.verifyToken', 'CHANGE_ME_verify_token'),
        assignment('config.aiProvider', 'anthropic'),
        assignment('config.anthropicModel', 'claude-sonnet-5'),
        assignment('config.openaiModel', 'gpt-4o-mini'),
        assignment('config.maxTokens', 500, 'number'),
        assignment('config.systemPrompt',
          'You are the friendly WhatsApp assistant of ACME Store. Answer questions about products, orders, ' +
          'shipping and returns. If you do not know the answer, say so and offer to connect the customer with a human.'),
        assignment('config.fallbackReply',
          'Sorry, I could not process your message right now. A team member will get back to you soon.'),
        assignment('config.graphApiVersion', 'v21.0'),
      ],
    },
    includeOtherFields: true,
    options: {},
  }),

  node('Is Verification Request?', 'n8n-nodes-base.if', 2.2, [260, 0], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: id('cond:verify'),
        leftValue: "={{ $json.query['hub.mode'] }}",
        rightValue: '',
        operator: { type: 'string', operation: 'exists', singleValue: true },
      }],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  }),

  // ---------------------------------------------------------------- GET branch
  node('Handle Verification', 'n8n-nodes-base.code', 2, [500, -160], { jsCode: code('handle-verification.js') }),
  node('Respond Verification', 'n8n-nodes-base.respondToWebhook', 1.1, [720, -160], {
    respondWith: 'text',
    responseBody: '={{ $json.body }}',
    options: { responseCode: '={{ $json.statusCode }}' },
  }),

  // ---------------------------------------------------------------- POST branch
  node('Acknowledge 200', 'n8n-nodes-base.respondToWebhook', 1.1, [500, 120], {
    respondWith: 'noData',
    options: {},
  }),
  node('Parse WhatsApp Message', 'n8n-nodes-base.code', 2, [720, 120], { jsCode: code('parse-message.js') }),
  node('Build AI Request', 'n8n-nodes-base.code', 2, [940, 120], { jsCode: code('build-ai-request.js') }),
  node('Choose AI Provider', 'n8n-nodes-base.switch', 3.2, [1160, 120], {
    rules: {
      values: [
        condition('Claude', '={{ $json.provider }}', { type: 'string', operation: 'equals' }, 'anthropic'),
        condition('OpenAI', '={{ $json.provider }}', { type: 'string', operation: 'equals' }, 'openai'),
      ],
    },
    options: {},
  }),
  node('Ask Claude', 'n8n-nodes-base.httpRequest', 4.2, [1380, 20], {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}',
    options: AI_HTTP_OPTIONS,
  }, { ...RETRY, onError: 'continueRegularOutput' }),
  node('Ask OpenAI', 'n8n-nodes-base.httpRequest', 4.2, [1380, 220], {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}',
    options: AI_HTTP_OPTIONS,
  }, { ...RETRY, onError: 'continueRegularOutput' }),
  node('Extract AI Reply', 'n8n-nodes-base.code', 2, [1600, 120], { jsCode: code('extract-reply.js') }),
  node('Send WhatsApp Reply', 'n8n-nodes-base.httpRequest', 4.2, [1820, 120], {
    method: 'POST',
    url: '=https://graph.facebook.com/{{ $json.graphApiVersion }}/{{ $json.phoneNumberId }}/messages',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.whatsappPayload) }}',
    options: { timeout: 30000 },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }),
];

const link = (to, index = 0) => ({ node: to, type: 'main', index });

const connections = {
  'WhatsApp Webhook': { main: [[link('Config')], [link('Config')]] },
  Config: { main: [[link('Is Verification Request?')]] },
  'Is Verification Request?': { main: [[link('Handle Verification')], [link('Acknowledge 200')]] },
  'Handle Verification': { main: [[link('Respond Verification')]] },
  'Acknowledge 200': { main: [[link('Parse WhatsApp Message')]] },
  'Parse WhatsApp Message': { main: [[link('Build AI Request')]] },
  'Build AI Request': { main: [[link('Choose AI Provider')]] },
  'Choose AI Provider': { main: [[link('Ask Claude')], [link('Ask OpenAI')]] },
  'Ask Claude': { main: [[link('Extract AI Reply')]] },
  'Ask OpenAI': { main: [[link('Extract AI Reply')]] },
  'Extract AI Reply': { main: [[link('Send WhatsApp Reply')]] },
};

const workflow = {
  name: 'WhatsApp Business API → AI Assistant (Claude / OpenAI)',
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  tags: [],
};

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
