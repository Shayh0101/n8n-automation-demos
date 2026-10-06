#!/usr/bin/env node
// Validates workflow.json and tests the Code-node logic against fixtures in test/.
// No n8n instance or network needed: CRM APIs are mocked with canned responses.
// Usage: node validate.js   (exit code 0 = all tests passed)
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WF_PATH = path.join(__dirname, process.argv[2] || 'workflow.json');
const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'test', f), 'utf8'));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

// ---------------------------------------------------------------------------
// Minimal n8n Code-node sandbox: exposes $input and $('Node Name').
// ---------------------------------------------------------------------------
function runCodeNode(nodeName, inputItems, nodeOutputs = {}) {
  const node = byName[nodeName];
  assert.ok(node, `node "${nodeName}" not found`);
  const $input = { all: () => inputItems, first: () => inputItems[0], item: inputItems[0] };
  const $ = (name) => {
    const items = nodeOutputs[name];
    if (!items) throw new Error(`$('${name}') referenced but no mocked output provided`);
    return { all: () => items, first: () => items[0], item: items[0] };
  };
  const fn = new Function('$input', '$', `"use strict";\n${node.parameters.jsCode}`);
  const out = fn($input, $);
  assert.ok(Array.isArray(out), `${nodeName} must return an array of items`);
  out.forEach((it) => assert.ok(it && typeof it.json === 'object', `${nodeName} items must have .json`));
  return out;
}

const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Workflow structure (unique names, valid connections, one trigger, no credentials)', () => {
  assert.strictEqual(wf.settings && wf.settings.executionOrder, 'v1', 'settings.executionOrder must be "v1"');
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0, 'nodes[] missing');

  const names = wf.nodes.map((n) => n.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepStrictEqual(dupes, [], `duplicate node names: ${dupes}`);
  const ids = wf.nodes.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate node ids');

  for (const n of wf.nodes) {
    assert.ok(n.type && n.type.startsWith('n8n-nodes-base.'), `${n.name}: non-standard node type ${n.type}`);
    assert.ok(typeof n.typeVersion === 'number', `${n.name}: typeVersion missing`);
    assert.ok(Array.isArray(n.position) && n.position.length === 2, `${n.name}: bad position`);
    assert.ok(!n.credentials, `${n.name}: credentials must not be exported`);
  }

  const triggers = wf.nodes.filter((n) => /trigger$/i.test(n.type) || n.type === 'n8n-nodes-base.webhook');
  assert.strictEqual(triggers.length, 1, `expected exactly 1 trigger, got ${triggers.map((t) => t.name)}`);

  // Every connection must point to existing nodes; every non-sticky node must be reachable from the trigger.
  const reachable = new Set([triggers[0].name]);
  const queue = [triggers[0].name];
  for (const [from, conn] of Object.entries(wf.connections)) {
    assert.ok(byName[from], `connection from unknown node "${from}"`);
    for (const outputs of conn.main || []) {
      for (const c of outputs || []) assert.ok(byName[c.node], `"${from}" connects to unknown node "${c.node}"`);
    }
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const outputs of (wf.connections[cur] || {}).main || []) {
      for (const c of outputs || []) if (!reachable.has(c.node)) { reachable.add(c.node); queue.push(c.node); }
    }
  }
  const orphans = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !reachable.has(n.name));
  assert.deepStrictEqual(orphans.map((n) => n.name), [], 'unreachable nodes');

  // No secrets in the export (tokens, api keys, bearer values).
  const raw = JSON.stringify(wf);
  assert.ok(!/(pat[A-Za-z0-9]{14}\.|pk_[a-z]{2,}-|Bearer\s+[A-Za-z0-9_\-.]{20,}|eyJ[A-Za-z0-9_-]{20,})/.test(raw), 'possible secret in workflow.json');
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.stickyNote'), 'setup sticky note missing');

  // Code nodes must be valid JavaScript.
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function('$input', '$', n.parameters.jsCode), `${n.name}: syntax error`);
  }
});

test('Normalize & Validate Lead: normalization, validation, CRM payloads (test/leads.json)', () => {
  for (const tc of fixture('leads.json')) {
    const [out] = runCodeNode('Normalize & Validate Lead', [{ json: { ...tc.input, config: tc.config } }]);
    const j = out.json;
    const ctx = `[${tc.name}]`;
    assert.strictEqual(j.valid, tc.expect.valid, `${ctx} valid; errors=${JSON.stringify(j.errors)}`);
    if (tc.expect.errors) assert.deepStrictEqual(j.errors, tc.expect.errors, `${ctx} errors`);
    if (tc.expect.lead) {
      for (const [k, v] of Object.entries(tc.expect.lead)) assert.deepStrictEqual(j.lead[k], v, `${ctx} lead.${k}`);
    }
    if ('crmBody' in tc.expect) assert.deepStrictEqual(j.crmBody, tc.expect.crmBody, `${ctx} crmBody`);
    for (const [p, v] of Object.entries(tc.expect.crmBodyPath || {})) {
      assert.deepStrictEqual(getPath(j.crmBody, p), v, `${ctx} crmBody.${p}`);
    }
  }
});

test('Build Follow-up Email: CRM id extraction + safe HTML (test/emails.json, mocked CRM responses)', () => {
  for (const tc of fixture('emails.json')) {
    const [out] = runCodeNode('Build Follow-up Email', [{ json: tc.crmResponse }], {
      'Normalize & Validate Lead': [{ json: tc.context }],
    });
    const j = out.json;
    const ctx = `[${tc.name}]`;
    for (const k of ['to', 'from', 'subject', 'crmRecordId']) {
      if (k in tc.expect) assert.strictEqual(j[k], tc.expect[k], `${ctx} ${k}`);
    }
    for (const s of tc.expect.htmlContains || []) assert.ok(j.html.includes(s), `${ctx} html should contain ${s}`);
    for (const s of tc.expect.htmlNotContains || []) assert.ok(!j.html.includes(s), `${ctx} html must not contain ${s}`);
    // Plain-text part may echo user input verbatim, but must not contain our HTML template tags.
    assert.ok(j.text && !/<(p|br|a|blockquote)\b/.test(j.text), `${ctx} plain-text version must not contain template HTML`);
  }
});

test('End-to-end path simulation (webhook -> Switch routing -> mocked CRM -> email -> response)', () => {
  // Mocked CRM API responses, keyed by HTTP node name.
  const mockCrm = {
    'HubSpot: Upsert Contact': { status: 'COMPLETE', results: [{ id: '901' }] },
    'GoHighLevel: Upsert Contact': { contact: { id: 'ghl_901' } },
    'Airtable: Upsert Record': { records: [{ id: 'rec901' }] },
  };
  const switchNode = byName['Route to CRM'];
  const rules = switchNode.parameters.rules.values;
  const next = (name, outputIndex = 0) => {
    const outs = ((wf.connections[name] || {}).main || [])[outputIndex] || [];
    return outs.map((c) => c.node);
  };

  for (const provider of ['hubspot', 'gohighlevel', 'airtable']) {
    const webhookItem = { json: { body: { name: 'Test Lead', email: 'lead@test.com' }, query: {} } };
    assert.deepStrictEqual(next('Lead Webhook'), ['Config']);
    // Config node: emulate Set with includeOtherFields + dot notation.
    const cfg = Object.fromEntries(byName.Config.parameters.assignments.assignments
      .map((a) => [a.name.replace(/^config\./, ''), a.value]));
    cfg.crmProvider = provider;
    const normalized = runCodeNode('Normalize & Validate Lead', [{ json: { ...webhookItem.json, config: cfg } }]);
    assert.strictEqual(normalized[0].json.valid, true);

    // IF true branch -> Switch
    assert.deepStrictEqual(next('Lead Valid?', 0), ['Route to CRM']);
    const idx = rules.findIndex((r) => r.conditions.conditions[0].rightValue === normalized[0].json.crmProvider);
    assert.ok(idx >= 0, `no Switch rule for ${provider}`);
    const [crmNode] = next('Route to CRM', idx);
    assert.ok(mockCrm[crmNode], `${provider} routed to unexpected node ${crmNode}`);
    assert.strictEqual(byName[crmNode].parameters.jsonBody, '={{ JSON.stringify($json.crmBody) }}');

    assert.deepStrictEqual(next(crmNode), ['Build Follow-up Email']);
    const [email] = runCodeNode('Build Follow-up Email', [{ json: mockCrm[crmNode] }], {
      'Normalize & Validate Lead': normalized,
    });
    assert.strictEqual(email.json.to, 'lead@test.com');
    assert.ok(email.json.crmRecordId && String(email.json.crmRecordId).includes('901'), `${provider} record id`);
    assert.deepStrictEqual(next('Build Follow-up Email'), ['Send Follow-up Email']);
    assert.deepStrictEqual(next('Send Follow-up Email'), ['Respond 200 OK']);
  }

  // IF false branch -> 422 response
  assert.deepStrictEqual(next('Lead Valid?', 1), ['Respond 422 Invalid']);
  assert.strictEqual(byName['Respond 422 Invalid'].parameters.options.responseCode, 422);
});

// ---------------------------------------------------------------------------
let failed = 0;
const results = [];
for (const t of tests) {
  try {
    t.fn();
    results.push({ name: t.name, passed: true });
    console.log(`PASS  ${t.name}`);
  } catch (err) {
    failed++;
    results.push({ name: t.name, passed: false, error: err.message });
    console.log(`FAIL  ${t.name}\n      ${err.message}`);
  }
}
fs.writeFileSync(path.join(__dirname, 'test', 'last-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
