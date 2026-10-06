#!/usr/bin/env node
// Generates ../workflow.json from the Code-node sources in ../src/code.
// Edit the JS files (they are linted/tested as normal files), then run: npm run build
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const code = (file) => fs.readFileSync(path.join(ROOT, 'src', 'code', file), 'utf8').trimEnd() + '\n';
// Stable ids so rebuilding does not produce noisy diffs.
const id = (name) => {
  const h = crypto.createHash('sha1').update('rag-chatbot:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };
const OPENAI_AUTH = { authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi' };
const QDRANT_AUTH = { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' };
const QDRANT_BASE = "={{ $json.qdrantUrl }}/collections/{{ $json.collection }}";

const nodes = [];
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, id: id(name), name, type, typeVersion, position, ...extra });
};
const sticky = (key, position, width, height, color, content) => {
  node(key, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
};
const httpJson = (method, url, jsonBody, auth, timeout = 30000) => ({
  method,
  url,
  ...auth,
  sendBody: true,
  specifyBody: 'json',
  jsonBody,
  options: { timeout },
});
const stringEquals = (value) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{
      id: id('cond-' + value),
      leftValue: '={{ $json.action }}',
      rightValue: value,
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: value,
});

// ---------- Sticky notes ("how to set up") ----------
sticky('Note: Overview', [-80, -400], 620, 520, 7,
  '## RAG chatbot over company docs\n' +
  'One webhook, two actions:\n\n' +
  '**Ingest** – `POST /webhook/rag-chatbot`\n' +
  '```json\n{"action":"ingest","documents":[{"title":"Leave policy","source":"https://wiki/hr","text":"..."}]}\n```\n' +
  '**Ask** – `POST /webhook/rag-chatbot`\n' +
  '```json\n{"action":"ask","question":"How many vacation days do I get?"}\n```\n' +
  'Answer = text + cited sources. Re-ingesting a document with the same `title`/`id` replaces its old chunks.\n\n' +
  'Stack: OpenAI (embeddings + chat) · Qdrant (vector store).');
sticky('Note: Setup', [560, -400], 560, 520, 4,
  '## ⚙️ Setup (5 min)\n' +
  '1. **Config** node → set `qdrantUrl` and `collection` (and models / chunk size if needed).\n' +
  '2. Create the Qdrant collection once (size 1536 for `text-embedding-3-small`):\n' +
  '```\ncurl -X PUT $QDRANT_URL/collections/company_docs \\\n  -H "api-key: $QDRANT_API_KEY" -H "Content-Type: application/json" \\\n  -d \'{"vectors":{"size":1536,"distance":"Cosine"}}\'\n```\n' +
  '3. Credentials (none are shipped in this file):\n' +
  '   - **OpenAI** credential → nodes *Embed Chunks*, *Embed Question*, *Call LLM*.\n' +
  '   - **Header Auth** (`api-key: <QDRANT_API_KEY>`) → the 3 Qdrant nodes. Local Qdrant without key: set *Authentication* = None.\n' +
  '4. Activate the workflow and call the production webhook URL.');
sticky('Note: Ingest', [860, -60], 1340, 300, 5,
  '### 📥 Ingest branch\nChunk text (paragraph/sentence aware, overlap) → embed in one batch → delete old chunks of the same docs → upsert to Qdrant with deterministic ids.');
sticky('Note: Ask', [860, 280], 1560, 420, 6,
  '### 💬 Ask branch\nEmbed question → top-K search → drop hits below `minScore` → if nothing relevant: answer "not found" **without** calling the LLM, else answer strictly from context with [n] citations.');
sticky('Note: Errors', [860, 720], 380, 220, 3,
  '### ⚠️ Validation errors\nBad payloads (unknown action, empty question, missing text, wrong Config) return **HTTP 400** with a readable `error` message.');

// ---------- Main flow ----------
node('Webhook', 'n8n-nodes-base.webhook', 2, [0, 300], {
  httpMethod: 'POST',
  path: 'rag-chatbot',
  responseMode: 'responseNode',
  options: {},
}, { webhookId: id('webhook') });

const cfg = [
  ['qdrantUrl', 'http://localhost:6333', 'string'],
  ['collection', 'company_docs', 'string'],
  ['embeddingModel', 'text-embedding-3-small', 'string'],
  ['chatModel', 'gpt-4o-mini', 'string'],
  ['topK', 5, 'number'],
  ['minScore', 0.3, 'number'],
  ['chunkSize', 1000, 'number'],
  ['chunkOverlap', 150, 'number'],
  ['maxContextChars', 12000, 'number'],
];
node('Config', 'n8n-nodes-base.set', 3.4, [220, 300], {
  mode: 'manual',
  assignments: { assignments: cfg.map(([name, value, type]) => ({ id: id('cfg-' + name), name, value, type })) },
  includeOtherFields: true,
  options: {},
});

node('Validate Request', 'n8n-nodes-base.code', 2, [440, 300], { jsCode: code('validate-request.js') });

node('Route by Action', 'n8n-nodes-base.switch', 3, [660, 300], {
  rules: { values: [stringEquals('ingest'), stringEquals('ask')] },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'invalid' },
});

// ---------- Ingest ----------
node('Chunk Documents', 'n8n-nodes-base.code', 2, [900, 80], { jsCode: code('chunk-documents.js') });
// Embed first, delete second: if OpenAI fails, the previous version of the documents stays searchable.
node('Embed Chunks', 'n8n-nodes-base.httpRequest', 4.2, [1120, 80], httpJson(
  'POST', 'https://api.openai.com/v1/embeddings',
  "={{ JSON.stringify({ model: $('Chunk Documents').first().json.embeddingModel, input: $('Chunk Documents').first().json.chunks.map(c => c.text) }) }}",
  OPENAI_AUTH, 120000), RETRY);
node('Build Qdrant Points', 'n8n-nodes-base.code', 2, [1340, 80], { jsCode: code('build-points.js') });
node('Delete Old Chunks', 'n8n-nodes-base.httpRequest', 4.2, [1560, 80], httpJson(
  'POST', QDRANT_BASE + '/points/delete?wait=true',
  "={{ JSON.stringify({ filter: { must: [{ key: 'docId', match: { any: $('Chunk Documents').first().json.docIds } }] } }) }}",
  QDRANT_AUTH), RETRY);
const POINTS = "$('Build Qdrant Points').first().json";
node('Upsert to Qdrant', 'n8n-nodes-base.httpRequest', 4.2, [1780, 80], {
  ...httpJson('PUT', `={{ ${POINTS}.qdrantUrl }}/collections/{{ ${POINTS}.collection }}/points?wait=true`,
    `={{ JSON.stringify({ points: ${POINTS}.points }) }}`, QDRANT_AUTH, 120000),
}, RETRY);
node('Respond: Ingested', 'n8n-nodes-base.respondToWebhook', 1.1, [2000, 80], {
  respondWith: 'json',
  responseBody: "={{ { status: 'ok', documents: $('Build Qdrant Points').first().json.documentCount, chunks: $('Build Qdrant Points').first().json.chunkCount, docIds: $('Chunk Documents').first().json.docIds, qdrant: $json.result ? $json.result.status : null } }}",
  options: { responseCode: 200 },
});

// ---------- Ask ----------
node('Embed Question', 'n8n-nodes-base.httpRequest', 4.2, [900, 440], httpJson(
  'POST', 'https://api.openai.com/v1/embeddings',
  '={{ JSON.stringify({ model: $json.embeddingModel, input: $json.question }) }}',
  OPENAI_AUTH), RETRY);
node('Search Qdrant', 'n8n-nodes-base.httpRequest', 4.2, [1120, 440], httpJson(
  'POST',
  "={{ $('Validate Request').first().json.qdrantUrl }}/collections/{{ $('Validate Request').first().json.collection }}/points/search",
  "={{ JSON.stringify({ vector: $json.data[0].embedding, limit: $('Validate Request').first().json.topK, with_payload: true }) }}",
  QDRANT_AUTH), RETRY);
node('Build Prompt', 'n8n-nodes-base.code', 2, [1340, 440], { jsCode: code('build-prompt.js') });
node('Has Context?', 'n8n-nodes-base.if', 2, [1560, 440], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{
      id: id('cond-has-context'),
      leftValue: '={{ $json.hasContext }}',
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
});
node('Call LLM', 'n8n-nodes-base.httpRequest', 4.2, [1780, 360], httpJson(
  'POST', 'https://api.openai.com/v1/chat/completions',
  '={{ JSON.stringify({ model: $json.chatModel, temperature: 0.1, messages: $json.messages }) }}',
  OPENAI_AUTH, 120000), RETRY);
node('Format Answer', 'n8n-nodes-base.code', 2, [2000, 360], { jsCode: code('format-answer.js') });
node('No Context Answer', 'n8n-nodes-base.code', 2, [1780, 560], { jsCode: code('no-context-answer.js') });
node('Respond: Answer', 'n8n-nodes-base.respondToWebhook', 1.1, [2220, 440], {
  respondWith: 'json',
  responseBody: '={{ $json }}',
  options: { responseCode: 200 },
});

// ---------- Errors ----------
node('Respond: Error', 'n8n-nodes-base.respondToWebhook', 1.1, [900, 800], {
  respondWith: 'json',
  responseBody: "={{ { status: 'error', error: $json.error } }}",
  options: { responseCode: 400 },
});

// ---------- Connections ----------
const to = (...names) => names.map((n) => ({ node: n, type: 'main', index: 0 }));
const connections = {
  'Webhook': { main: [to('Config')] },
  'Config': { main: [to('Validate Request')] },
  'Validate Request': { main: [to('Route by Action')] },
  'Route by Action': { main: [to('Chunk Documents'), to('Embed Question'), to('Respond: Error')] },
  'Chunk Documents': { main: [to('Embed Chunks')] },
  'Embed Chunks': { main: [to('Build Qdrant Points')] },
  'Build Qdrant Points': { main: [to('Delete Old Chunks')] },
  'Delete Old Chunks': { main: [to('Upsert to Qdrant')] },
  'Upsert to Qdrant': { main: [to('Respond: Ingested')] },
  'Embed Question': { main: [to('Search Qdrant')] },
  'Search Qdrant': { main: [to('Build Prompt')] },
  'Build Prompt': { main: [to('Has Context?')] },
  'Has Context?': { main: [to('Call LLM'), to('No Context Answer')] },
  'Call LLM': { main: [to('Format Answer')] },
  'Format Answer': { main: [to('Respond: Answer')] },
  'No Context Answer': { main: [to('Respond: Answer')] },
};

const workflow = {
  name: 'RAG Chatbot over Company Docs (OpenAI + Qdrant)',
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  versionId: id('version'),
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

fs.writeFileSync(path.join(ROOT, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written: ${nodes.length} nodes`);
