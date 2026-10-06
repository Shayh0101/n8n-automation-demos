#!/usr/bin/env node
// Validates workflow.json structure and runs Code-node logic against the
// fixtures in test/*.json (n8n globals like $input, $() and
// $getWorkflowStaticData are mocked). No dependencies. Run: node validate.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const results = [];
const record = (name, fn) => {
  try { fn(); results.push({ name, passed: true }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ name, passed: false, error: e.message }); console.log(`  ✘ ${name}\n      ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------------------------------------------------------------- structure
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflow.json'), 'utf8'));
console.log('Structure checks');

record('structure: settings, unique names/ids, required fields', () => {
  assert(wf.settings && wf.settings.executionOrder === 'v1', 'settings.executionOrder must be "v1"');
  assert(Array.isArray(wf.nodes) && wf.nodes.length, 'nodes[] missing');
  const names = new Set(); const ids = new Set();
  for (const n of wf.nodes) {
    assert(n.name && n.id && n.type && typeof n.typeVersion === 'number', `node missing name/id/type/typeVersion: ${JSON.stringify(n.name)}`);
    assert(Array.isArray(n.position) && n.position.length === 2, `bad position on ${n.name}`);
    assert(!names.has(n.name), `duplicate node name: ${n.name}`); names.add(n.name);
    assert(!ids.has(n.id), `duplicate node id: ${n.id}`); ids.add(n.id);
  }
});

record('structure: connections valid, single trigger, all nodes reachable', () => {
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const triggers = wf.nodes.filter((n) => /Trigger$/i.test(n.type));
  assert(triggers.length === 1, `expected exactly 1 trigger, found ${triggers.length}`);
  const edges = new Map();
  for (const [src, conn] of Object.entries(wf.connections)) {
    assert(byName.has(src), `connection from unknown node "${src}"`);
    assert(byName.get(src).type !== 'n8n-nodes-base.stickyNote', `sticky note "${src}" has connections`);
    for (const outputs of conn.main || []) for (const c of outputs || []) {
      assert(byName.has(c.node), `"${src}" connects to unknown node "${c.node}"`);
      assert(c.type === 'main' && Number.isInteger(c.index), `bad connection ${src} -> ${c.node}`);
      if (!edges.has(src)) edges.set(src, []); edges.get(src).push(c.node);
    }
  }
  const seen = new Set([triggers[0].name]); const queue = [triggers[0].name];
  while (queue.length) for (const next of edges.get(queue.shift()) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  const orphans = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !seen.has(n.name)).map((n) => n.name);
  assert(!orphans.length, `unreachable nodes: ${orphans.join(', ')}`);
  for (const ifName of ['Needs AI?', 'Order Complete?']) {
    const outs = (wf.connections[ifName] || {}).main || [];
    assert(outs.length === 2 && outs.every((o) => o.length), `IF node "${ifName}" must wire both true and false branches`);
  }
});

record('structure: no credentials or secrets, sticky setup notes present', () => {
  const raw = JSON.stringify(wf);
  assert(wf.nodes.every((n) => !n.credentials), 'nodes must not contain credentials');
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(raw), 'looks like an OpenAI key is embedded');
  assert(!/\d{8,10}:[A-Za-z0-9_-]{35}/.test(raw), 'looks like a Telegram bot token is embedded');
  assert(!/ya29\.|AIza[0-9A-Za-z_-]{35}/.test(raw), 'looks like a Google token is embedded');
  const notes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
  assert(notes.length >= 1 && notes.some((n) => /setup/i.test(n.parameters.content)), 'missing setup sticky note');
});

record('structure: Code nodes compile', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    try { new AsyncFunction('$input', '$', '$getWorkflowStaticData', n.parameters.jsCode); }
    catch (e) { throw new Error(`${n.name}: ${e.message}`); }
  }
});

// ------------------------------------------------------------ logic (mocks)
async function runCodeNode(nodeName, { input = [], nodes = {}, staticData = {} }) {
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`Code node "${nodeName}" not found`);
  const wrap = (arr) => (arr || []).map((json) => ({ json }));
  const $input = { all: () => wrap(input), first: () => wrap(input)[0] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`test fixture does not mock node "${name}"`);
    return { all: () => wrap(nodes[name]), first: () => wrap(nodes[name])[0] };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('$input', '$', '$getWorkflowStaticData', node.parameters.jsCode);
  const out = await fn($input, $, () => staticData);
  if (!Array.isArray(out)) throw new Error('Code node must return an array');
  return out.map((it) => it.json);
}

// Partial deep match. Strings "re:<regex>" match by regex, "$absent" means key must be missing.
function match(actual, expected, where = '$') {
  if (expected === '$absent') { if (actual !== undefined) throw new Error(`${where}: expected absent, got ${JSON.stringify(actual)}`); return; }
  if (typeof expected === 'string' && expected.startsWith('re:')) {
    if (typeof actual !== 'string' || !new RegExp(expected.slice(3), 's').test(actual)) throw new Error(`${where}: ${JSON.stringify(actual)} !~ /${expected.slice(3)}/`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(`${where}: expected array(${expected.length}), got ${JSON.stringify(actual)}`);
    expected.forEach((e, i) => match(actual[i], e, `${where}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') throw new Error(`${where}: expected object, got ${JSON.stringify(actual)}`);
    for (const k of Object.keys(expected)) match(actual[k], expected[k], `${where}.${k}`);
    return;
  }
  if (actual !== expected) throw new Error(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

(async () => {
  const testDir = path.join(ROOT, 'test');
  const fixtures = fs.readdirSync(testDir).filter((f) => f.endsWith('.json')).sort();
  const shared = fs.existsSync(path.join(testDir, '_shared.json')) ? JSON.parse(fs.readFileSync(path.join(testDir, '_shared.json'), 'utf8')) : {};
  for (const file of fixtures.filter((f) => !f.startsWith('_'))) {
    const suite = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf8'));
    console.log(`\n${suite.name} (${file})`);
    for (const c of suite.cases) {
      const name = `${suite.node}: ${c.name}`;
      try {
        const staticData = JSON.parse(JSON.stringify(c.staticData || {}));
        const out = await runCodeNode(suite.node, { input: c.input, nodes: { ...(shared.nodes || {}), ...(c.nodes || {}) }, staticData });
        match(out, c.expect, 'output');
        if (c.expectStaticData) match(staticData, c.expectStaticData, 'staticData');
        results.push({ name, passed: true }); console.log(`  ✔ ${c.name}`);
      } catch (e) {
        results.push({ name, passed: false, error: e.message }); console.log(`  ✘ ${c.name}\n      ${e.message}`);
      }
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(ROOT, 'test-results.json'), JSON.stringify(results, null, 2) + '\n');
  process.exit(failed.length ? 1 : 0);
})();
