#!/usr/bin/env node
// validate.js — static checks for workflow.json + unit tests for every Code node.
//
//   node validate.js            # structure checks + all tests in test/*.test.js
//   node validate.js --no-tests # structure checks only
//
// Code nodes are executed exactly as they are stored in workflow.json, inside a small
// sandbox that mimics n8n's `$input`, `$json` and `$('Node Name')` helpers.
// External APIs (OpenAI, Qdrant) are never called: their responses come from test/fixtures.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = __dirname;
const WORKFLOW_PATH = path.join(ROOT, 'workflow.json');

const results = [];
const record = (group, name, fn) => {
  try {
    fn();
    results.push({ group, name, passed: true });
  } catch (err) {
    results.push({ group, name, passed: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// 1. Structure checks
// ---------------------------------------------------------------------------
// Matches *Trigger nodes and the Webhook node, but not "respondToWebhook".
const TRIGGER_RE = /(Trigger|\.webhook)$/;
const isSticky = (n) => n.type === 'n8n-nodes-base.stickyNote';
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/, // OpenAI-style keys
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

let workflow;
record('structure', 'workflow.json is valid JSON', () => {
  workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  assert.ok(Array.isArray(workflow.nodes), 'nodes must be an array');
  assert.ok(workflow.connections && typeof workflow.connections === 'object', 'connections must be an object');
});

if (workflow) {
  const nodes = workflow.nodes;
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const logic = nodes.filter((n) => !isSticky(n));

  record('structure', 'settings.executionOrder = v1', () => {
    assert.strictEqual(workflow.settings && workflow.settings.executionOrder, 'v1');
  });

  record('structure', 'every node has name/type/typeVersion/position/parameters', () => {
    for (const n of nodes) {
      assert.ok(typeof n.name === 'string' && n.name, `node without name: ${JSON.stringify(n).slice(0, 80)}`);
      assert.ok(/^(n8n-nodes-base|@n8n\/n8n-nodes-langchain)\./.test(n.type), `${n.name}: non-standard type ${n.type}`);
      assert.ok(typeof n.typeVersion === 'number' && n.typeVersion >= 1, `${n.name}: bad typeVersion`);
      assert.ok(Array.isArray(n.position) && n.position.length === 2, `${n.name}: bad position`);
      assert.ok(n.parameters && typeof n.parameters === 'object', `${n.name}: missing parameters`);
    }
  });

  record('structure', 'node names and ids are unique', () => {
    const dup = (arr) => arr.filter((v, i) => arr.indexOf(v) !== i);
    assert.deepStrictEqual(dup(nodes.map((n) => n.name)), [], 'duplicate names');
    assert.deepStrictEqual(dup(nodes.map((n) => n.id)), [], 'duplicate ids');
  });

  record('structure', 'exactly one trigger', () => {
    const triggers = logic.filter((n) => TRIGGER_RE.test(n.type));
    assert.strictEqual(triggers.length, 1, `found ${triggers.length}: ${triggers.map((t) => t.name).join(', ')}`);
  });

  record('structure', 'connections reference existing nodes', () => {
    for (const [src, outputs] of Object.entries(workflow.connections)) {
      assert.ok(byName.has(src), `unknown source node "${src}"`);
      assert.ok(!isSticky(byName.get(src)), `sticky note "${src}" has connections`);
      for (const branch of outputs.main || []) {
        for (const c of branch || []) {
          assert.ok(byName.has(c.node), `"${src}" → unknown node "${c.node}"`);
          assert.strictEqual(c.type, 'main');
        }
      }
    }
  });

  record('structure', 'all nodes reachable from the trigger, no dead ends', () => {
    const trigger = logic.find((n) => TRIGGER_RE.test(n.type));
    const seen = new Set([trigger.name]);
    const queue = [trigger.name];
    while (queue.length) {
      const name = queue.shift();
      for (const branch of (workflow.connections[name] || {}).main || []) {
        for (const c of branch || []) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); }
      }
    }
    const unreachable = logic.filter((n) => !seen.has(n.name)).map((n) => n.name);
    assert.deepStrictEqual(unreachable, [], 'unreachable nodes');
    // Every branch must end in a Respond to Webhook node (responseMode = responseNode).
    const deadEnds = logic.filter((n) => !workflow.connections[n.name] && n.type !== 'n8n-nodes-base.respondToWebhook');
    assert.deepStrictEqual(deadEnds.map((n) => n.name), [], 'branches that never respond');
  });

  record('structure', 'no credentials or secrets in the export', () => {
    for (const n of nodes) assert.ok(!n.credentials, `${n.name} has credentials attached`);
    const raw = JSON.stringify(workflow);
    for (const re of SECRET_PATTERNS) assert.ok(!re.test(raw), `secret-like string matches ${re}`);
  });

  record('structure', 'has "how to set up" sticky notes', () => {
    const notes = nodes.filter(isSticky);
    assert.ok(notes.length >= 2, 'expected at least 2 sticky notes');
    assert.ok(notes.some((n) => /setup/i.test(n.parameters.content || '')), 'no setup note');
  });

  record('structure', 'Code nodes compile', () => {
    for (const n of nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      try { compile(n.parameters.jsCode); } catch (e) { throw new Error(`${n.name}: ${e.message}`); }
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Code-node sandbox (mimics the n8n Code node, "Run Once for All Items")
// ---------------------------------------------------------------------------
function compile(jsCode) {
  // eslint-disable-next-line no-new-func
  return new Function('$input', '$', '$json', 'console', `"use strict";\n${jsCode}`);
}

const wrap = (items) => (items || []).map((i) => (i && i.json ? i : { json: i }));
const accessor = (items, label) => {
  if (!items.length) throw new Error(`No items available for ${label}`);
  return { first: () => items[0], last: () => items[items.length - 1], all: () => items, item: items[0] };
};

/**
 * Run a Code node from workflow.json.
 * @param {string} nodeName  name of the Code node
 * @param {object[]} input   items coming into the node (plain objects or {json})
 * @param {object} refs      { 'Other Node': [items] } for $('Other Node') lookups
 * @returns {object[]} output `json` objects
 */
function runCodeNode(nodeName, input, refs = {}) {
  const n = workflow.nodes.find((x) => x.name === nodeName);
  if (!n || n.type !== 'n8n-nodes-base.code') throw new Error(`Code node "${nodeName}" not found`);
  const items = wrap(input);
  const $ = (name) => {
    if (!(name in refs)) throw new Error(`$('${name}') was not mocked in the test`);
    return accessor(wrap(refs[name]), `$('${name}')`);
  };
  const out = compile(n.parameters.jsCode)(accessor(items, '$input'), $, items[0] && items[0].json, { log() {} });
  assert.ok(Array.isArray(out), `${nodeName} must return an array of items`);
  for (const it of out) assert.ok(it && typeof it.json === 'object', `${nodeName} returned an item without json`);
  return out.map((it) => it.json);
}

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8'));

// ---------------------------------------------------------------------------
// 3. Load and run tests from test/*.test.js
// ---------------------------------------------------------------------------
if (workflow && !process.argv.includes('--no-tests')) {
  const testDir = path.join(ROOT, 'test');
  for (const file of fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).sort()) {
    const suite = require(path.join(testDir, file));
    for (const t of suite.tests) {
      record(file, t.name, () => t.run({ runCodeNode, fixture, assert, workflow }));
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let group = null;
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.passed ? '✔' : '✘'} ${r.name}${r.passed ? '' : `\n      → ${r.error}`}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, 'test-results.json'), JSON.stringify(results, null, 2));
}
process.exit(failed.length ? 1 : 0);
