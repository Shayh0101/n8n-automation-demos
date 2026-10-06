#!/usr/bin/env node
// Validates workflow.json structure and unit-tests the Code-node logic
// embedded in it, using fixtures from test/fixtures. No dependencies, no network.
// Usage: node validate.js   (exit code 1 on any failure)
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = __dirname;
const wf = JSON.parse(fs.readFileSync(path.join(root, 'workflow.json'), 'utf8'));
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', f), 'utf8'));
const CONFIG = fixture('config.json');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.log(`  FAIL  ${name}\n        ${e.message.split('\n').join('\n        ')}`);
  }
}

// ---- Code-node runner: emulates n8n's "Run once for all items" sandbox ----
function codeOf(name) {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `Code node "${name}" not found`);
  assert.equal(n.type, 'n8n-nodes-base.code');
  return n.parameters.jsCode;
}
async function runCode(name, inputJson, nodeData = { Config: [CONFIG] }) {
  const items = inputJson.map((json) => ({ json }));
  const $input = { all: () => items, first: () => items[0], last: () => items[items.length - 1] };
  const $ = (ref) => {
    const data = nodeData[ref];
    if (!data) throw new Error(`Referenced node "${ref}" is not mocked`);
    const wrapped = data.map((json) => ({ json }));
    return { first: () => wrapped[0], all: () => wrapped };
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$', `return (async () => {\n${codeOf(name)}\n})();`);
  const out = await fn($input, $);
  assert.ok(Array.isArray(out), `${name} must return an array`);
  out.forEach((o) => assert.ok(o && typeof o.json === 'object', `${name} must return [{json}] items`));
  return out.map((o) => o.json);
}

(async () => {
  console.log('Structure');

  await test('structure: valid n8n export (unique names, valid links, one trigger, no credentials)', () => {
    assert.equal(wf.settings?.executionOrder, 'v1', 'settings.executionOrder must be v1');
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0, 'nodes missing');

    const names = wf.nodes.map((n) => n.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `duplicate node names: ${dupes}`);
    const ids = wf.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate node ids');

    for (const n of wf.nodes) {
      assert.ok(n.type?.startsWith('n8n-nodes-base.'), `${n.name}: non-standard node type ${n.type}`);
      assert.ok(typeof n.typeVersion === 'number', `${n.name}: missing typeVersion`);
      assert.ok(Array.isArray(n.position) && n.position.length === 2, `${n.name}: bad position`);
      assert.equal(n.credentials, undefined, `${n.name}: credentials must not be exported`);
    }

    const triggers = wf.nodes.filter((n) => /trigger/i.test(n.type));
    assert.equal(triggers.length, 1, `expected exactly 1 trigger, got ${triggers.length}`);

    const set = new Set(names);
    const targeted = new Set();
    for (const [from, conn] of Object.entries(wf.connections)) {
      assert.ok(set.has(from), `connection from unknown node "${from}"`);
      for (const out of conn.main || []) {
        for (const c of out || []) {
          assert.ok(set.has(c.node), `connection ${from} -> unknown node "${c.node}"`);
          targeted.add(c.node);
        }
      }
    }
    // Every non-sticky, non-trigger node must be reachable.
    const orphans = wf.nodes
      .filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !/trigger/i.test(n.type))
      .filter((n) => !targeted.has(n.name))
      .map((n) => n.name);
    assert.deepEqual(orphans, [], `unconnected nodes: ${orphans}`);
    assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.stickyNote'), 'setup sticky notes missing');

    // No secrets in the export.
    const raw = JSON.stringify(wf);
    assert.ok(!/(xox[bpa]-|sk-[A-Za-z0-9]{20}|AIza[0-9A-Za-z_-]{20}|-----BEGIN)/.test(raw), 'export looks like it contains a secret');

    // All Code nodes must at least compile.
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      // eslint-disable-next-line no-new-func
      new Function('$input', '$', `return (async () => {\n${n.parameters.jsCode}\n})();`);
    }
  });

  console.log('Code-node logic');

  await test('Clean & Normalize: trims text, parses US/EU prices, absolute URLs, dedupes, flags invalid', async () => {
    const rows = await runCode('Clean & Normalize', fixture('extracted-fields.json'));
    assert.equal(rows.length, 4, 'expected 4 rows (1 duplicate + 1 blank dropped)');

    const [light, velvet, soum, sharp] = rows;
    assert.equal(light.title, 'A Light in the Attic');
    assert.equal(light.price, 51.77);
    assert.equal(light.currency, 'GBP');
    assert.equal(light.url, 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html');
    assert.equal(light.availability, 'In stock');
    assert.equal(light.status, 'ok');

    assert.equal(velvet.title, 'Tipping the Velvet', 'falls back to title_text');
    assert.equal(velvet.price, 1299);
    assert.equal(velvet.currency, 'EUR');
    assert.equal(velvet.url, 'https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html', 'hash stripped');

    assert.equal(soum.price, 1299.5);
    assert.equal(soum.currency, 'USD');
    assert.equal(soum.id, soum.url);

    assert.equal(sharp.status, 'invalid');
    assert.match(sharp.issues, /unparseable price/);
    assert.equal(sharp.currency, 'USD', 'default currency applied');
    for (const r of rows) {
      assert.equal(r.source, 'books.toscrape.com');
      assert.ok(!Number.isNaN(Date.parse(r.scraped_at)));
    }
  });

  await test('Split Cards + Clean & Normalize: empty page produces an "empty" marker row', async () => {
    const split = await runCode('Split Cards', fixture('extract-cards-output.json'));
    assert.equal(split.length, 2);
    assert.match(split[0].cards, /title="A"/);

    const none = await runCode('Split Cards', [{ cards: [] }]);
    assert.deepEqual(none, [{ cards: '', empty_page: true }]);

    // HTML node on an empty string yields empty fields -> Clean emits the marker.
    const cleaned = await runCode('Clean & Normalize', [{ title_attr: '', title_text: '', price: '', url: '', availability: '' }]);
    assert.equal(cleaned.length, 1);
    assert.equal(cleaned[0].status, 'empty');
  });

  await test('Alerts: silent when healthy, warns on invalid ratio, critical on empty page / fetch error', async () => {
    const ok = { status: 'ok', title: 'x', url: 'u', issues: '' };
    const bad = { status: 'invalid', title: 'Bad', url: 'u2', issues: 'unparseable price' };

    const healthy = await runCode('Build Data Alert', [ok, ok, ok, ok, ok, bad]); // 16.7% <= 20%
    assert.deepEqual(healthy, [], 'healthy run must not alert');

    const warn = await runCode('Build Data Alert', [ok, ok, bad, bad]); // 50%
    assert.equal(warn.length, 1);
    assert.equal(warn[0].severity, 'warning');
    assert.equal(warn[0].invalid_rows, 2);
    assert.match(warn[0].message, /2\/4 rows failed validation/);
    assert.match(warn[0].message, /Bad: unparseable price/);

    const empty = await runCode('Build Data Alert', [{ status: 'empty', issues: 'No listings' }]);
    assert.equal(empty[0].severity, 'critical');
    assert.match(empty[0].message, /No listings were extracted/);

    const fetchErr = await runCode('Format Fetch Error', fixture('http-error.json'));
    assert.equal(fetchErr[0].severity, 'critical');
    assert.match(fetchErr[0].message, /503/);
    assert.match(fetchErr[0].message, /books\.toscrape\.com/);
  });

  const failed = results.filter((r) => !r.passed);
  fs.writeFileSync(path.join(root, 'test', 'last-run.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
