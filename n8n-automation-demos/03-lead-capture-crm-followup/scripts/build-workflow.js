#!/usr/bin/env node
// Builds workflow.json from the Code-node sources in src/.
// Edit the JS in src/, then run: node scripts/build-workflow.js
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const NORMALIZE = 'Normalize & Validate Lead';
const BUILD_EMAIL = 'Build Follow-up Email';

const condBase = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const crmRule = (id, value, outputKey) => ({
  conditions: {
    options: condBase,
    conditions: [{
      id,
      leftValue: '={{ $json.crmProvider }}',
      rightValue: value,
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey,
});

const httpCommon = {
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.crmBody) }}',
  options: { timeout: 15000 },
};
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

const sticky = (id, name, content, position, width, height, color) => ({
  parameters: { content, height, width, color },
  id, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position,
});

const nodes = [
  sticky('a0000000-0000-4000-8000-000000000001', 'Sticky: How to set up',
    '## Lead capture → CRM → follow-up email\n\n' +
    '**Setup (5 min):**\n' +
    '1. Open **Config** and set `crmProvider` (`hubspot` | `gohighlevel` | `airtable`), `companyName`, `fromEmail`, `bookingUrl`.\n' +
    '2. Attach credentials to the CRM node you use (see note above the CRM nodes).\n' +
    '3. Attach an **SMTP** credential to *Send Follow-up Email*.\n' +
    '4. Activate the workflow and point your form to the **Production URL** of *Lead Webhook* (POST, JSON or form-urlencoded).\n\n' +
    'Responses: `200 {ok:true}` on success, `422 {ok:false, errors:[...]}` for invalid/spam leads.',
    [-460, 80], 420, 420, 4),
  sticky('a0000000-0000-4000-8000-000000000002', 'Sticky: CRM credentials',
    '### CRM credentials (attach only the one you use)\n' +
    '- **HubSpot:** credential type *HubSpot App Token* (Private App token with `crm.objects.contacts.write`).\n' +
    '- **GoHighLevel:** *Header Auth* → Name `Authorization`, Value `Bearer <Private Integration token>`; set `ghlLocationId` in Config.\n' +
    '- **Airtable:** *Airtable Personal Access Token*; set `airtableBaseId` / `airtableTable` in Config. Table needs an `Email` column (+ First Name, Last Name, Phone, Company, Message, Source, UTM Source/Medium/Campaign, Submitted At).\n\n' +
    'All three calls are **upserts by email** — re-submits update the contact instead of duplicating it.',
    [1060, -360], 460, 320, 6),
  sticky('a0000000-0000-4000-8000-000000000003', 'Sticky: Email',
    '### Follow-up email\nText/HTML is built in *Build Follow-up Email* (edit the copy there). ' +
    'Email errors do **not** fail the run — the lead is already saved in the CRM.',
    [1500, 420], 340, 160, 5),
  {
    parameters: {
      httpMethod: 'POST',
      path: 'lead-capture',
      responseMode: 'responseNode',
      options: {},
    },
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Lead Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 300],
    webhookId: 'b7f3c2a1-5d4e-4f6a-9b8c-1d2e3f4a5b6c',
  },
  {
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          ['c1', 'config.crmProvider', 'hubspot'],
          ['c2', 'config.companyName', 'Acme Inc.'],
          ['c3', 'config.fromEmail', 'hello@example.com'],
          ['c4', 'config.bookingUrl', 'https://calendly.com/your-team/intro'],
          ['c5', 'config.ghlLocationId', 'YOUR_GHL_LOCATION_ID'],
          ['c6', 'config.airtableBaseId', 'appXXXXXXXXXXXXXX'],
          ['c7', 'config.airtableTable', 'Leads'],
        ].map(([id, name, value]) => ({ id, name, value, type: 'string' })),
      },
      includeOtherFields: true,
      options: {},
    },
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Config',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [220, 300],
  },
  {
    parameters: { jsCode: read('normalize-lead.js') },
    id: 'b0000000-0000-4000-8000-000000000003',
    name: NORMALIZE,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [440, 300],
  },
  {
    parameters: {
      conditions: {
        options: condBase,
        conditions: [{
          id: 'v1',
          leftValue: '={{ $json.valid }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'b0000000-0000-4000-8000-000000000004',
    name: 'Lead Valid?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [660, 300],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify({ ok: false, errors: $json.errors }) }}',
      options: { responseCode: 422 },
    },
    id: 'b0000000-0000-4000-8000-000000000005',
    name: 'Respond 422 Invalid',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [880, 480],
  },
  {
    parameters: {
      rules: {
        values: [
          crmRule('r1', 'hubspot', 'HubSpot'),
          crmRule('r2', 'gohighlevel', 'GoHighLevel'),
          crmRule('r3', 'airtable', 'Airtable'),
        ],
      },
      options: {},
    },
    id: 'b0000000-0000-4000-8000-000000000006',
    name: 'Route to CRM',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position: [880, 160],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'hubspotAppToken',
      ...httpCommon,
    },
    id: 'b0000000-0000-4000-8000-000000000007',
    name: 'HubSpot: Upsert Contact',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1100, 0],
    ...retry,
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://services.leadconnectorhq.com/contacts/upsert',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Version', value: '2021-07-28' }] },
      ...httpCommon,
    },
    id: 'b0000000-0000-4000-8000-000000000008',
    name: 'GoHighLevel: Upsert Contact',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1100, 160],
    ...retry,
  },
  {
    parameters: {
      method: 'PATCH',
      url: "={{ 'https://api.airtable.com/v0/' + $json.config.airtableBaseId + '/' + encodeURIComponent($json.config.airtableTable || 'Leads') }}",
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'airtableTokenApi',
      ...httpCommon,
    },
    id: 'b0000000-0000-4000-8000-000000000009',
    name: 'Airtable: Upsert Record',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1100, 320],
    ...retry,
  },
  {
    parameters: { jsCode: read('build-followup-email.js') },
    id: 'b0000000-0000-4000-8000-000000000010',
    name: BUILD_EMAIL,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1320, 160],
  },
  {
    parameters: {
      fromEmail: '={{ $json.from }}',
      toEmail: '={{ $json.to }}',
      subject: '={{ $json.subject }}',
      emailFormat: 'both',
      text: '={{ $json.text }}',
      html: '={{ $json.html }}',
      options: { appendAttribution: false },
    },
    id: 'b0000000-0000-4000-8000-000000000011',
    name: 'Send Follow-up Email',
    type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1,
    position: [1540, 160],
    onError: 'continueRegularOutput',
    ...retry,
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: `={{ JSON.stringify({ ok: true, crm: $('${BUILD_EMAIL}').first().json.crmProvider, crmRecordId: $('${BUILD_EMAIL}').first().json.crmRecordId }) }}`,
      options: { responseCode: 200 },
    },
    id: 'b0000000-0000-4000-8000-000000000012',
    name: 'Respond 200 OK',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [1760, 160],
  },
];

const link = (...targets) => targets.map((t) => (t ? [{ node: t, type: 'main', index: 0 }] : []));

const connections = {
  'Lead Webhook': { main: link('Config') },
  Config: { main: link(NORMALIZE) },
  [NORMALIZE]: { main: link('Lead Valid?') },
  'Lead Valid?': { main: link('Route to CRM', 'Respond 422 Invalid') },
  'Route to CRM': { main: link('HubSpot: Upsert Contact', 'GoHighLevel: Upsert Contact', 'Airtable: Upsert Record') },
  'HubSpot: Upsert Contact': { main: link(BUILD_EMAIL) },
  'GoHighLevel: Upsert Contact': { main: link(BUILD_EMAIL) },
  'Airtable: Upsert Record': { main: link(BUILD_EMAIL) },
  [BUILD_EMAIL]: { main: link('Send Follow-up Email') },
  'Send Follow-up Email': { main: link('Respond 200 OK') },
};

const workflow = {
  name: 'Lead Capture → CRM (HubSpot / GoHighLevel / Airtable) + Email Follow-up',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

fs.writeFileSync(path.join(root, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
