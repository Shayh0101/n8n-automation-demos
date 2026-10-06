// Build Prompt
// Turns Qdrant search hits into a numbered context block and the chat messages for the LLM.
// Hits below `minScore` are dropped; if nothing relevant is left, hasContext = false and the
// workflow answers "not found" without calling the LLM (saves tokens, avoids hallucinations).

const req = $('Validate Request').first().json;
const hits = Array.isArray($input.first().json.result) ? $input.first().json.result : [];

const seen = new Set();
const sources = [];
let used = 0;
for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
  const p = hit.payload || {};
  const text = typeof p.text === 'string' ? p.text.trim() : '';
  if (!text || hit.score < req.minScore || seen.has(text)) continue;
  if (used + text.length > req.maxContextChars && sources.length > 0) break;
  seen.add(text);
  used += text.length;
  sources.push({
    n: sources.length + 1,
    title: p.title || 'Untitled',
    source: p.source || null,
    docId: p.docId || null,
    chunkIndex: p.chunkIndex ?? null,
    score: Math.round(hit.score * 1000) / 1000,
    text,
  });
}

const systemPrompt = [
  'You are a helpful assistant that answers questions about the company using ONLY the provided context.',
  'Rules:',
  '- If the answer is not in the context, say you could not find it in the company documents. Do not guess.',
  '- Cite the sources you used with their number in square brackets, e.g. [1] or [2][3].',
  '- Be concise and answer in the same language as the question.',
].join('\n');

const context = sources.map((s) => `[${s.n}] ${s.title}${s.source ? ` (${s.source})` : ''}\n${s.text}`).join('\n\n---\n\n');

return [{
  json: {
    hasContext: sources.length > 0,
    question: req.question,
    chatModel: req.chatModel,
    sources,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${req.question}` },
    ],
  },
}];
