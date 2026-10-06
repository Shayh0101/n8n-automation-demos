// Validate Request
// Validates the webhook payload and merges it with the values from the "Config" node.
// Output: one item with { action: 'ingest' | 'ask' | 'invalid', ...config, ...payload }.
// Invalid requests are NOT thrown — they are routed to the "Respond: Error" node (HTTP 400).

const MAX_DOCUMENTS = 100;
const MAX_DOC_CHARS = 200000;
const MAX_QUESTION_CHARS = 2000;

const item = $input.first().json;
const body = item.body && typeof item.body === 'object' && !Array.isArray(item.body) ? item.body : {};

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const config = {
  qdrantUrl: String(item.qdrantUrl || '').trim().replace(/\/+$/, ''),
  collection: String(item.collection || '').trim(),
  embeddingModel: String(item.embeddingModel || 'text-embedding-3-small'),
  chatModel: String(item.chatModel || 'gpt-4o-mini'),
  topK: clamp(Math.round(toNumber(item.topK, 5)), 1, 20),
  minScore: clamp(toNumber(item.minScore, 0.3), 0, 1),
  chunkSize: clamp(Math.round(toNumber(item.chunkSize, 1000)), 200, 8000),
  chunkOverlap: Math.max(0, Math.round(toNumber(item.chunkOverlap, 150))),
  maxContextChars: clamp(Math.round(toNumber(item.maxContextChars, 12000)), 1000, 100000),
};
// Overlap must be clearly smaller than the chunk, otherwise chunking would not progress.
config.chunkOverlap = Math.min(config.chunkOverlap, Math.floor(config.chunkSize / 2));

const errors = [];
if (!/^https?:\/\//.test(config.qdrantUrl)) errors.push('Config: qdrantUrl must start with http:// or https://');
if (!/^[A-Za-z0-9_-]+$/.test(config.collection)) errors.push('Config: collection must contain only letters, digits, "_" or "-"');

const action = String(body.action || '').trim().toLowerCase();
const out = { ...config, action };

if (action === 'ingest') {
  const docs = body.documents;
  if (!Array.isArray(docs) || docs.length === 0) {
    errors.push('"documents" must be a non-empty array');
  } else if (docs.length > MAX_DOCUMENTS) {
    errors.push(`Too many documents in one request (max ${MAX_DOCUMENTS})`);
  } else {
    out.documents = [];
    docs.forEach((doc, i) => {
      if (!doc || typeof doc !== 'object') return errors.push(`documents[${i}] must be an object`);
      const text = typeof doc.text === 'string' ? doc.text.trim() : '';
      if (!text) return errors.push(`documents[${i}].text must be a non-empty string`);
      if (text.length > MAX_DOC_CHARS) return errors.push(`documents[${i}].text is longer than ${MAX_DOC_CHARS} chars`);
      const title = String(doc.title || `Document ${i + 1}`).trim();
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `doc-${i + 1}`;
      out.documents.push({
        id: String(doc.id || slug),
        title,
        source: doc.source ? String(doc.source) : null,
        metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
        text,
      });
    });
  }
} else if (action === 'ask') {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) errors.push('"question" must be a non-empty string');
  else if (question.length > MAX_QUESTION_CHARS) errors.push(`"question" is longer than ${MAX_QUESTION_CHARS} chars`);
  out.question = question;
  if (body.topK !== undefined) out.topK = clamp(Math.round(toNumber(body.topK, config.topK)), 1, 20);
} else {
  errors.push('"action" must be "ingest" or "ask"');
}

if (errors.length) {
  return [{ json: { action: 'invalid', statusCode: 400, error: errors.join('; ') } }];
}
return [{ json: out }];
