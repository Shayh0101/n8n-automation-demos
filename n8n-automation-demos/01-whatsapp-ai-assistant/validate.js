#!/usr/bin/env node
// Validates workflow.json and unit-tests the Code-node logic against the
// fixtures in test/. No n8n instance and no network access are needed:
// AI and WhatsApp HTTP calls are replaced by fixture responses (mocks).
//
//   node validate.js            -> exit code 0 on success, 1 on any failure
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = __dirname;
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflow.json'), 'utf8'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', name), 'utf8'));

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err.message });
    console.log(`  ✘ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

// ------------------------------------------------------------------ helpers
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const STICKY = 'n8n-nodes-base.stickyNote';
const KNOWN_VERSIONS = {
  'n8n-nodes-base.webhook': [1, 1.1, 2, 2.1],
  'n8n-nodes-base.set': [3, 3.1, 3.2, 3.3, 3.4],
  'n8n-nodes-base.if': [2, 2.1, 2.2],
  'n8n-nodes-base.code': [1, 2],
  'n8n-nodes-base.respondToWebhook': [1, 1.1, 1.2],
  'n8n-nodes-base.switch': [3, 3.1, 3.2],
  'n8n-nodes-base.httpRequest': [4, 4.1, 4.2],
  'n8n-nodes-base.stickyNote': [1],
};
const isTrigger = (n) => /trigger$/i.test(n.type) || n.type === 'n8n-nodes-base.webhook';

// Emulates the "Config" Set node: dot-notation assignments -> nested object.
function runConfigNode(inputJson, overrides = {}) {
  const out = JSON.parse(JSON.stringify(inputJson));
  for (const a of byName.Config.parameters.assignments.assignments) {
    const keys = a.name.split('.');
    let obj = out;
    keys.slice(0, -1).forEach((k) => (obj = obj[k] = obj[k] || {}));
    obj[keys[keys.length - 1]] = a.type === 'number' ? Number(a.value) : a.value;
  }
  Object.assign(out.config, overrides);
  return out;
}

// Runs a Code node ("Run Once for All Items" mode) with a minimal n8n sandbox.
// `refs` maps node names to the items those nodes produced (for $('Node')).
async function runCode(nodeName, inputItems, refs = {}) {
  const node = byName[nodeName];
  assert.ok(node, `node "${nodeName}" not found`);
  const items = inputItems.map((json) => ({ json }));
  const $input = { all: () => items, first: () => items[0], item: items[0] };
  const $ = (name) => {
    const ref = (refs[name] || []).map((json) => ({ json }));
    if (!refs[name]) throw new Error(`Code node referenced $('${name}') which was not provided`);
    return { all: () => ref, first: () => ref[0], last: () => ref[ref.length - 1], itemMatching: (i) => ref[i] };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('$input', '$', '$json', node.parameters.jsCode);
  const out = await fn($input, $, items[0] && items[0].json);
  assert.ok(Array.isArray(out), `${nodeName} must return an array`);
  out.forEach((o, i) => assert.ok(o && typeof o.json === 'object', `${nodeName} item ${i} has no .json`));
  return out.map((o) => o.json);
}

// Emulates the "Is Verification Request?" IF node.
const isVerification = (json) => json.query && json.query['hub.mode'] !== undefined;

// ------------------------------------------------------------------ tests
(async () => {
  console.log('\nStructure');

  await test('workflow structure: unique names, valid connections, single trigger, no secrets', () => {
    assert.equal(typeof wf.name, 'string');
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0, 'nodes[] missing');
    assert.equal(wf.settings?.executionOrder, 'v1', 'settings.executionOrder must be "v1"');

    const names = wf.nodes.map((n) => n.name);
    const ids = wf.nodes.map((n) => n.id);
    assert.equal(new Set(names).size, names.length, 'duplicate node names');
    assert.equal(new Set(ids).size, ids.length, 'duplicate node ids');

    for (const n of wf.nodes) {
      assert.ok(n.type && n.parameters && Array.isArray(n.position), `node "${n.name}" is malformed`);
      const versions = KNOWN_VERSIONS[n.type];
      assert.ok(versions, `node "${n.name}" uses unexpected type ${n.type}`);
      assert.ok(versions.includes(n.typeVersion), `node "${n.name}" has unknown typeVersion ${n.typeVersion}`);
      assert.equal(n.credentials, undefined, `node "${n.name}" must not ship credentials`);
    }

    const triggers = wf.nodes.filter(isTrigger);
    assert.equal(triggers.length, 1, `expected exactly 1 trigger, found ${triggers.length}`);

    const incoming = new Set();
    for (const [from, conn] of Object.entries(wf.connections)) {
      assert.ok(byName[from], `connection from unknown node "${from}"`);
      for (const output of conn.main) {
        for (const c of output) {
          assert.ok(byName[c.node], `"${from}" connects to unknown node "${c.node}"`);
          assert.notEqual(byName[c.node].type, STICKY, 'sticky notes cannot be connected');
          incoming.add(c.node);
        }
      }
    }
    for (const n of wf.nodes) {
      if (n.type === STICKY || isTrigger(n)) continue;
      assert.ok(incoming.has(n.name), `node "${n.name}" is not connected (no input)`);
    }

    // Every Code node must at least compile.
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      new AsyncFunction('$input', '$', '$json', n.parameters.jsCode);
    }

    const raw = JSON.stringify(wf);
    const secretPatterns = [/sk-ant-[A-Za-z0-9_-]{10,}/, /sk-[A-Za-z0-9]{20,}/, /EAA[A-Za-z0-9]{30,}/, /Bearer [A-Za-z0-9._-]{20,}/];
    for (const p of secretPatterns) assert.ok(!p.test(raw), `possible secret found matching ${p}`);
    assert.ok(byName['WhatsApp Webhook'].parameters.responseMode === 'responseNode', 'webhook must respond via node');
  });

  console.log('\nLogic (Code nodes, external APIs mocked with test/ fixtures)');

  await test('webhook verification: correct token echoes challenge, wrong token gets 403', async () => {
    const req = runConfigNode(fixture('webhook-verify.json'), { verifyToken: 'test-verify-token' });
    assert.ok(isVerification(req), 'IF node should route GET handshake to verification branch');
    const [ok] = await runCode('Handle Verification', [req]);
    assert.deepEqual(ok, { statusCode: 200, body: '1158201444' });

    const bad = runConfigNode(fixture('webhook-verify.json'), { verifyToken: 'something-else' });
    const [denied] = await runCode('Handle Verification', [bad]);
    assert.equal(denied.statusCode, 403);

    const empty = runConfigNode(fixture('webhook-verify.json'), { verifyToken: '' });
    assert.equal((await runCode('Handle Verification', [empty]))[0].statusCode, 403, 'empty token must never verify');
  });

  await test('message parsing: text/button/image are extracted, reactions and status updates ignored', async () => {
    const req = runConfigNode(fixture('webhook-text-message.json'));
    assert.ok(!isVerification(req), 'POST message must go to the message branch');
    const msgs = await runCode('Parse WhatsApp Message', [req]);
    assert.equal(msgs.length, 3, 'reaction should be skipped');
    assert.deepEqual(msgs.map((m) => m.messageId), ['wamid.TEXT1', 'wamid.BTN1', 'wamid.IMG1']);
    assert.equal(msgs[0].text, 'Hi! Where is my order #1042?');
    assert.equal(msgs[0].from, '15551234567');
    assert.equal(msgs[0].name, 'Jane Doe');
    assert.equal(msgs[0].phoneNumberId, 'PHONE_NUMBER_ID_TEST');
    assert.equal(msgs[1].text, 'Track order');
    assert.match(msgs[2].text, /image.*Caption: Broken item/);
    assert.equal(msgs[0].config.aiProvider, 'anthropic', 'config must be carried along');

    const statuses = await runCode('Parse WhatsApp Message', [runConfigNode(fixture('webhook-status-update.json'))]);
    assert.equal(statuses.length, 0, 'delivery status updates must not trigger an AI reply');

    const junk = await runCode('Parse WhatsApp Message', [runConfigNode({ query: {}, body: { foo: 1 } })]);
    assert.equal(junk.length, 0, 'non-WhatsApp payloads are ignored');
  });

  await test('AI request + reply (mocked Claude and OpenAI): correct bodies and WhatsApp payload', async () => {
    for (const [provider, responseFile, expected] of [
      ['anthropic', 'anthropic-response.json', 'Hi Jane! Order #1042 shipped yesterday and should arrive in 2–3 days.'],
      ['openai', 'openai-response.json', 'Hi Jane! Your order #1042 is on its way.'],
    ]) {
      const req = runConfigNode(fixture('webhook-text-message.json'), { aiProvider: provider });
      const [msg] = await runCode('Parse WhatsApp Message', [req]);
      const [aiReq] = await runCode('Build AI Request', [msg]);

      assert.equal(aiReq.provider, provider);
      if (provider === 'anthropic') {
        assert.equal(aiReq.body.model, 'claude-sonnet-5');
        assert.equal(typeof aiReq.body.system, 'string');
        assert.deepEqual(aiReq.body.messages, [{ role: 'user', content: msg.text }]);
      } else {
        assert.equal(aiReq.body.model, 'gpt-4o-mini');
        assert.equal(aiReq.body.messages[0].role, 'system');
        assert.deepEqual(aiReq.body.messages[1], { role: 'user', content: msg.text });
      }
      assert.match(aiReq.body.messages.at(-1).content, /order #1042/);
      assert.ok(aiReq.body.max_tokens > 0);

      // Switch node routing must match the provider value.
      const rule = byName['Choose AI Provider'].parameters.rules.values.find(
        (r) => r.conditions.conditions[0].rightValue === aiReq.provider,
      );
      assert.ok(rule, `Switch has no route for provider "${aiReq.provider}"`);

      // Mocked HTTP response from the AI provider:
      const [reply] = await runCode('Extract AI Reply', [fixture(responseFile)], { 'Build AI Request': [aiReq] });
      assert.equal(reply.replyText, expected);
      assert.equal(reply.usedFallback, false);
      assert.deepEqual(reply.whatsappPayload, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '15551234567',
        type: 'text',
        context: { message_id: 'wamid.TEXT1' },
        text: { preview_url: false, body: expected },
      });
      assert.equal(reply.phoneNumberId, 'PHONE_NUMBER_ID_TEST');
      assert.equal(reply.graphApiVersion, 'v21.0');
    }

    const bad = runConfigNode(fixture('webhook-text-message.json'), { aiProvider: 'gemini' });
    const [msg] = await runCode('Parse WhatsApp Message', [bad]);
    await assert.rejects(runCode('Build AI Request', [msg]), /Unknown aiProvider/);
  });

  await test('error handling: failed/empty AI call sends fallback reply, long replies are truncated', async () => {
    const req = runConfigNode(fixture('webhook-text-message.json'));
    const [msg] = await runCode('Parse WhatsApp Message', [req]);
    const [aiReq] = await runCode('Build AI Request', [msg]);
    const refs = { 'Build AI Request': [aiReq] };

    const [failed] = await runCode('Extract AI Reply', [fixture('ai-error-response.json')], refs);
    assert.equal(failed.usedFallback, true);
    assert.equal(failed.replyText, req.config.fallbackReply);
    assert.match(failed.aiError, /invalid x-api-key/);

    const [empty] = await runCode('Extract AI Reply', [{ content: [] }], refs);
    assert.equal(empty.usedFallback, true);
    assert.equal(empty.aiError, 'Empty AI response');

    const [long] = await runCode('Extract AI Reply', [{ content: [{ type: 'text', text: 'x'.repeat(5000) }] }], refs);
    assert.equal(long.replyText.length, 4096, 'WhatsApp text limit is 4096 chars');
    assert.equal(long.whatsappPayload.text.body, long.replyText);
  });

  // ------------------------------------------------------------------ summary
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(ROOT, 'test-results.json'), JSON.stringify(results, null, 2) + '\n');
  process.exit(failed.length ? 1 : 0);
})();
