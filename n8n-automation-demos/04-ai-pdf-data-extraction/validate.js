#!/usr/bin/env node
// Validates workflow.json structure and runs the Code-node logic against fixtures in test/.
// No dependencies, no network: n8n globals ($input, $) and the Claude API are mocked.
// Usage: node validate.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = __dirname;
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflow.json'), 'utf8'));
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', f), 'utf8'));
const nodeByName = (name) => wf.nodes.find((n) => n.name === name);

// Known-good typeVersions for the node types used in this template.
const KNOWN_VERSIONS = {
  'n8n-nodes-base.stickyNote': [1],
  'n8n-nodes-base.googleDriveTrigger': [1],
  'n8n-nodes-base.googleDrive': [3],
  'n8n-nodes-base.extractFromFile': [1],
  'n8n-nodes-base.code': [2],
  'n8n-nodes-base.if': [2, 2.1, 2.2],
  'n8n-nodes-base.httpRequest': [4.2],
  'n8n-nodes-base.googleSheets': [4.5],
};

// Run a Code node's jsCode the way n8n does ("Run Once for All Items").
// `refs` maps node names to arrays of item json for $('Node').itemMatching(i).
function runCodeNode(nodeName, inputJson, refs = {}) {
  const node = nodeByName(nodeName);
  assert(node, `Code node "${nodeName}" not found`);
  const items = inputJson.map((json) => ({ json }));
  const $ = (name) => {
    if (!refs[name]) throw new Error(`No mock data for node "${name}"`);
    return { itemMatching: (i) => ({ json: refs[name][i] }) };
  };
  const ctx = vm.createContext({ $input: { all: () => items }, $, console, Date, JSON, Math, Number, String, Array, Object, Error, isNaN, parseFloat });
  const result = vm.runInContext(`(function () {\n${node.parameters.jsCode}\n})()`, ctx, { timeout: 2000 });
  assert(Array.isArray(result), `${nodeName} must return an array`);
  result.forEach((r) => assert(r && typeof r.json === 'object', `${nodeName} returned an item without json`));
  return result.map((r) => r.json);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------
test('Workflow structure: unique names/ids, valid connections, single trigger, v1 order', () => {
  assert.strictEqual(wf.settings && wf.settings.executionOrder, 'v1', 'settings.executionOrder must be v1');
  const names = wf.nodes.map((n) => n.name);
  const ids = wf.nodes.map((n) => n.id);
  assert.strictEqual(new Set(names).size, names.length, 'node names must be unique');
  assert.strictEqual(new Set(ids).size, ids.length, 'node ids must be unique');

  for (const n of wf.nodes) {
    const allowed = KNOWN_VERSIONS[n.type];
    assert(allowed, `unexpected node type ${n.type}`);
    assert(allowed.includes(n.typeVersion), `${n.name}: typeVersion ${n.typeVersion} not in ${allowed}`);
    assert(Array.isArray(n.position) && n.position.length === 2, `${n.name}: bad position`);
    assert(!n.credentials, `${n.name}: credentials must not be exported`);
  }

  for (const [src, conn] of Object.entries(wf.connections)) {
    assert(nodeByName(src), `connection from unknown node "${src}"`);
    for (const outputs of conn.main) for (const c of outputs) assert(nodeByName(c.node), `connection to unknown node "${c.node}"`);
  }

  const triggers = wf.nodes.filter((n) => /trigger/i.test(n.type));
  assert.strictEqual(triggers.length, 1, `expected exactly one trigger, found ${triggers.length}`);

  // Every functional node must be reachable from the trigger.
  const seen = new Set([triggers[0].name]);
  const queue = [triggers[0].name];
  while (queue.length) {
    const cur = queue.shift();
    for (const outputs of (wf.connections[cur] || { main: [] }).main)
      for (const c of outputs) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); }
  }
  const orphans = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !seen.has(n.name));
  assert.strictEqual(orphans.length, 0, `unreachable nodes: ${orphans.map((n) => n.name)}`);

  // No secrets in the export.
  const raw = JSON.stringify(wf);
  assert(!/sk-ant-[A-Za-z0-9]/.test(raw) && !/"x-api-key"\s*,\s*"value"/.test(raw), 'API key found in workflow.json');
  assert(wf.nodes.some((n) => n.type === 'n8n-nodes-base.stickyNote'), 'setup sticky notes missing');
});

// ---------------------------------------------------------------------------
test('Build AI Request: builds Claude request for text PDF, flags scanned PDF', () => {
  const fx = fixture('extract_invoice.json');
  const out = runCodeNode('Build AI Request', fx.input, { 'Download PDF': fx.download });
  assert.strictEqual(out.length, 2);

  const [inv, scan] = out;
  assert.strictEqual(inv.hasText, true);
  assert.strictEqual(inv.fileName, 'ACME-INV-2041.pdf');
  assert.strictEqual(inv.fileId, '1AbCdEfG');
  assert.strictEqual(inv.requestBody.messages[0].role, 'user');
  assert.match(inv.requestBody.model, /^claude-/);
  assert(inv.requestBody.max_tokens > 0);
  const content = inv.requestBody.messages[0].content;
  assert(content.includes('INVOICE #INV-2041'), 'whitespace should be collapsed');
  assert(!content.includes('\r') && !/\n{3,}/.test(content), 'noise should be removed');
  assert(inv.requestBody.system.includes('"total"'), 'system prompt must define the schema');

  assert.strictEqual(scan.hasText, false);
  assert.strictEqual(scan.requestBody, null);
  assert.strictEqual(scan.pages, 2);
});

// ---------------------------------------------------------------------------
test('Parse & Validate: normalises values and assigns OK / NEEDS_REVIEW / ERROR', () => {
  const fx = fixture('claude_responses.json');
  const out = runCodeNode('Parse & Validate', fx.input, { 'Build AI Request': fx.meta });
  assert.strictEqual(out.length, 4);
  const [ok, review, httpErr, garbage] = out;

  // Clean US invoice
  assert.strictEqual(ok.Status, 'OK', ok.Notes);
  assert.strictEqual(ok.Vendor, 'ACME Supplies Ltd.');
  assert.strictEqual(ok['Document Date'], '2026-03-15');
  assert.strictEqual(ok['Due Date'], '2026-04-14');
  assert.strictEqual(ok.Currency, 'USD');
  assert.strictEqual(ok.Subtotal, 625);
  assert.strictEqual(ok.Total, 675);
  assert.strictEqual(ok['Line Items Count'], 2);
  assert.strictEqual(ok['File Name'], 'ACME-INV-2041.pdf');

  // Fenced EU-format JSON with wrong total and low confidence
  assert.strictEqual(review.Status, 'NEEDS_REVIEW');
  assert.strictEqual(review.Subtotal, 1000);
  assert.strictEqual(review.Tax, 190);
  assert.strictEqual(review.Total, 1250);
  assert.strictEqual(review['Document Date'], '2026-03-05');
  assert.match(review.Notes, /!= total/);
  assert.match(review.Notes, /Low confidence/);

  // HTTP error and non-JSON answer must not crash the batch
  assert.strictEqual(httpErr.Status, 'ERROR');
  assert.match(httpErr.Notes, /rate_limit_error/);
  assert.strictEqual(garbage.Status, 'ERROR');
  assert.match(garbage.Notes, /No JSON/);
  assert.strictEqual(garbage['File ID'], '4Bad');

  // Number formats as returned in string fields
  const fmt = (v) => runCodeNode('Parse & Validate', [{ type: 'message', content: [{ type: 'text', text: JSON.stringify({ vendor_name: 'X', subtotal: v, total: v, confidence: 1 }) }] }], { 'Build AI Request': [{}] })[0].Total;
  assert.strictEqual(fmt('$1,234.56'), 1234.56);
  assert.strictEqual(fmt('1.234,56 EUR'), 1234.56);
  assert.strictEqual(fmt('1,234'), 1234);
  assert.strictEqual(fmt('$1,234,567'), 1234567);
  assert.strictEqual(fmt('12,5'), 12.5);
  assert.strictEqual(fmt('(12.00)'), -12);
});

// ---------------------------------------------------------------------------
test('End-to-end (mocked Claude): Build -> IF -> Claude mock -> Parse / Flag Unreadable', () => {
  const fx = fixture('extract_invoice.json');
  const built = runCodeNode('Build AI Request', fx.input, { 'Download PDF': fx.download });
  const withText = built.filter((b) => b.hasText);   // IF true branch
  const noText = built.filter((b) => !b.hasText);    // IF false branch

  // Mock of the Claude HTTP node: answer based on the prompt it received.
  const mockClaude = (req) => {
    assert(req.messages[0].content.includes('TOTAL USD $675.00'));
    return {
      type: 'message', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ document_type: 'invoice', vendor_name: 'ACME Supplies Ltd.', document_number: 'INV-2041', document_date: '2026-03-15', currency: 'USD', subtotal: 625, tax: 50, total: 675, line_items: [], confidence: 0.9 }) }],
    };
  };
  const responses = withText.map((b) => mockClaude(b.requestBody));
  const rows = runCodeNode('Parse & Validate', responses, { 'Build AI Request': withText });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].Status, 'OK', rows[0].Notes);
  assert.strictEqual(rows[0]['File URL'], fx.download[0].webViewLink);

  const ocr = runCodeNode('Flag Unreadable PDF', noText);
  assert.strictEqual(ocr.length, 1);
  assert.strictEqual(ocr[0].Status, 'NEEDS_OCR');
  assert.strictEqual(ocr[0]['File Name'], 'scan_receipt.pdf');
});

// ---------------------------------------------------------------------------
const results = [];
for (const t of tests) {
  try {
    t.fn();
    results.push({ name: t.name, passed: true });
    console.log(`PASS  ${t.name}`);
  } catch (e) {
    results.push({ name: t.name, passed: false, error: e.message });
    console.log(`FAIL  ${t.name}\n      ${e.message}`);
  }
}
fs.writeFileSync(path.join(ROOT, 'test', 'results.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
