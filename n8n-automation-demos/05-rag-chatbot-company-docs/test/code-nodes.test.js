// Unit tests for the Code nodes in workflow.json. Run with: node validate.js
// OpenAI and Qdrant are mocked with the JSON responses in test/fixtures.
'use strict';

// What the "Config" (Set, includeOtherFields) node outputs: webhook fields + config fields.
const webhookItem = (fixture, body) => ({
  headers: { 'content-type': 'application/json' },
  params: {},
  query: {},
  body,
  ...fixture('config.json'),
});

module.exports.tests = [
  {
    name: 'Validate Request: accepts ingest/ask, rejects bad payloads with HTTP 400',
    run({ runCodeNode, fixture, assert }) {
      const [ingest] = runCodeNode('Validate Request', [webhookItem(fixture, fixture('ingest-request.json'))]);
      assert.strictEqual(ingest.action, 'ingest');
      assert.strictEqual(ingest.qdrantUrl, 'http://localhost:6333', 'trailing slash removed');
      assert.strictEqual(ingest.documents.length, 2);
      assert.strictEqual(ingest.documents[0].id, 'leave-policy', 'id derived from title');
      assert.strictEqual(ingest.documents[1].id, 'it-security-101', 'explicit id kept');

      const [ask] = runCodeNode('Validate Request', [webhookItem(fixture, { action: 'ASK', question: '  How many vacation days?  ', topK: 99 })]);
      assert.strictEqual(ask.action, 'ask');
      assert.strictEqual(ask.question, 'How many vacation days?');
      assert.strictEqual(ask.topK, 20, 'topK clamped to 20');

      const bad = [
        [{ action: 'ask', question: '' }, /question/],
        [{ action: 'delete' }, /action/],
        [{ action: 'ingest', documents: [{ title: 'x', text: '  ' }] }, /documents\[0\]\.text/],
        [undefined, /action/],
      ];
      for (const [body, re] of bad) {
        const [out] = runCodeNode('Validate Request', [webhookItem(fixture, body)]);
        assert.strictEqual(out.action, 'invalid', JSON.stringify(body));
        assert.strictEqual(out.statusCode, 400);
        assert.match(out.error, re);
      }

      const [badCfg] = runCodeNode('Validate Request', [{ ...webhookItem(fixture, { action: 'ask', question: 'hi' }), qdrantUrl: 'localhost' }]);
      assert.match(badCfg.error, /qdrantUrl/);
    },
  },
  {
    name: 'Chunk Documents: bounded, overlapping chunks with deterministic UUIDs',
    run({ runCodeNode, fixture, assert }) {
      const [validated] = runCodeNode('Validate Request', [webhookItem(fixture, fixture('ingest-request.json'))]);
      const [a] = runCodeNode('Chunk Documents', [validated]);
      const [b] = runCodeNode('Chunk Documents', [validated]);

      assert.strictEqual(a.documentCount, 2);
      assert.deepStrictEqual(a.docIds, ['leave-policy', 'it-security-101']);
      const leave = a.chunks.filter((c) => c.docId === 'leave-policy');
      assert.ok(leave.length >= 3, `long doc should be split, got ${leave.length} chunks`);
      assert.strictEqual(a.chunks.filter((c) => c.docId === 'it-security-101').length, 1, 'short doc = 1 chunk');

      for (const c of a.chunks) {
        assert.ok(c.text.length <= validated.chunkSize, `chunk too long: ${c.text.length}`);
        assert.match(c.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
      assert.strictEqual(new Set(a.chunks.map((c) => c.id)).size, a.chunks.length, 'ids are unique');
      assert.deepStrictEqual(a.chunks.map((c) => c.id), b.chunks.map((c) => c.id), 'ids are deterministic');

      // Consecutive chunks overlap and no word is cut in half at the start of a chunk.
      for (let i = 1; i < leave.length; i++) {
        const firstWords = leave[i].text.split(/\s+/).slice(0, 3).join(' ');
        assert.ok(leave[i - 1].text.includes(firstWords), `chunk ${i} should start inside chunk ${i - 1}`);
      }
      // Nothing is lost: every sentence of the source appears in some chunk.
      const source = validated.documents[0].text.replace(/\s+/g, ' ');
      for (const sentence of source.split(/(?<=\.) /)) {
        assert.ok(leave.some((c) => c.text.replace(/\s+/g, ' ').includes(sentence.trim())), `lost: "${sentence}"`);
      }
    },
  },
  {
    name: 'Build Qdrant Points: maps embeddings by index (mocked OpenAI) and rejects mismatches',
    run({ runCodeNode, fixture, assert }) {
      const [validated] = runCodeNode('Validate Request', [webhookItem(fixture, fixture('ingest-request.json'))]);
      const [chunked] = runCodeNode('Chunk Documents', [validated]);
      const n = chunked.chunks.length;
      // Mocked /v1/embeddings response, deliberately returned in reverse order.
      const embeddings = {
        object: 'list',
        model: 'text-embedding-3-small',
        data: chunked.chunks.map((_, i) => ({ object: 'embedding', index: i, embedding: [i, i + 0.5, 1] })).reverse(),
      };
      const [out] = runCodeNode('Build Qdrant Points', [embeddings], { 'Chunk Documents': [chunked] });
      assert.strictEqual(out.points.length, n);
      assert.strictEqual(out.vectorSize, 3);
      out.points.forEach((p, i) => {
        assert.strictEqual(p.id, chunked.chunks[i].id);
        assert.deepStrictEqual(p.vector, [i, i + 0.5, 1], `point ${i} got the wrong vector`);
        assert.strictEqual(p.payload.text, chunked.chunks[i].text);
        assert.ok(p.payload.ingestedAt);
      });
      assert.deepStrictEqual(out.points[0].payload.metadata, { department: 'HR' });

      const short = { data: embeddings.data.slice(1) };
      assert.throws(() => runCodeNode('Build Qdrant Points', [short], { 'Chunk Documents': [chunked] }), /embeddings for/);
      assert.throws(() => runCodeNode('Build Qdrant Points', [{ error: { message: 'Invalid API key' } }], { 'Chunk Documents': [chunked] }), /no "data"/);
    },
  },
  {
    name: 'Ask flow: prompt from Qdrant hits (mocked) → cited answer; no-context path skips LLM',
    run({ runCodeNode, fixture, assert }) {
      const [request] = runCodeNode('Validate Request', [webhookItem(fixture, { action: 'ask', question: 'Can I carry over vacation days?' })]);
      const refs = { 'Validate Request': [request] };

      const [prompt] = runCodeNode('Build Prompt', [fixture('qdrant-search-response.json')], refs);
      assert.strictEqual(prompt.hasContext, true);
      assert.strictEqual(prompt.sources.length, 2, 'low-score hit dropped and duplicate text removed');
      assert.deepStrictEqual(prompt.sources.map((s) => s.n), [1, 2]);
      assert.strictEqual(prompt.sources[0].score, 0.82, 'sorted by score');
      assert.strictEqual(prompt.messages[0].role, 'system');
      assert.match(prompt.messages[1].content, /\[1\] Leave Policy/);
      assert.match(prompt.messages[1].content, /Question: Can I carry over vacation days\?/);
      assert.ok(!prompt.messages[1].content.includes('Passwords'), 'irrelevant chunk not in context');

      const [answer] = runCodeNode('Format Answer', [fixture('openai-chat-response.json')], { 'Build Prompt': [prompt] });
      assert.match(answer.answer, /5 unused vacation days/);
      assert.strictEqual(answer.grounded, true);
      assert.strictEqual(answer.sources.length, 1, 'only cited source returned');
      assert.strictEqual(answer.sources[0].source, 'https://wiki.example.com/hr/leave-policy');
      assert.ok(!('text' in answer.sources[0]) && answer.sources[0].snippet, 'full text replaced by snippet');
      assert.strictEqual(answer.usage.total_tokens, 340);

      assert.throws(
        () => runCodeNode('Format Answer', [{ choices: [] }], { 'Build Prompt': [prompt] }),
        /empty answer/,
      );

      // Nothing relevant in the vector store → hasContext=false → canned answer, no LLM call.
      const [empty] = runCodeNode('Build Prompt', [{ result: [{ score: 0.05, payload: { text: 'noise' } }], status: 'ok' }], refs);
      assert.strictEqual(empty.hasContext, false);
      const [fallback] = runCodeNode('No Context Answer', [empty]);
      assert.strictEqual(fallback.grounded, false);
      assert.deepStrictEqual(fallback.sources, []);
      assert.match(fallback.answer, /couldn't find/);
    },
  },
];
