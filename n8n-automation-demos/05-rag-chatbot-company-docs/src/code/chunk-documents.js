// Chunk Documents
// Splits every document into overlapping chunks (paragraph > sentence > word boundaries)
// and gives each chunk a deterministic UUID, so re-ingesting a document overwrites it.

const MAX_CHUNKS = 2000; // one embeddings request; OpenAI accepts up to 2048 inputs

const cfg = $input.first().json;
const size = cfg.chunkSize;
const overlap = cfg.chunkOverlap;

function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text) {
  const clean = normalize(text);
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Cut at the "nicest" boundary found in the second half of the window.
      const windowText = clean.slice(start, end);
      const minCut = Math.floor(size * 0.5);
      for (const sep of ['\n\n', '\n', '. ', '? ', '! ', ' ']) {
        const idx = windowText.lastIndexOf(sep);
        if (idx >= minCut) { end = start + idx + sep.length; break; }
      }
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // Step back by `overlap` chars, snapped forward to the next word start.
    let next = end - overlap;
    if (overlap > 0) {
      const space = clean.indexOf(' ', next);
      if (space !== -1 && space < end) next = space + 1;
    }
    start = Math.max(next, start + 1);
  }
  return chunks;
}

// FNV-1a 32-bit hash; four seeded rounds give 128 bits formatted as a UUID (Qdrant point id).
function fnv1a(str, seed) {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function uuidFrom(str) {
  const hex = [1, 2, 3, 4].map((s) => fnv1a(str, s * 0x9e3779b1).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const chunks = [];
for (const doc of cfg.documents) {
  chunkText(doc.text).forEach((text, chunkIndex) => {
    chunks.push({
      id: uuidFrom(`${doc.id}#${chunkIndex}`),
      docId: doc.id,
      title: doc.title,
      source: doc.source,
      metadata: doc.metadata,
      chunkIndex,
      text,
    });
  });
}

if (chunks.length === 0) throw new Error('No text to index after normalisation');
if (chunks.length > MAX_CHUNKS) {
  throw new Error(`Too many chunks (${chunks.length} > ${MAX_CHUNKS}). Send fewer documents per request or raise chunkSize.`);
}

return [{
  json: {
    qdrantUrl: cfg.qdrantUrl,
    collection: cfg.collection,
    embeddingModel: cfg.embeddingModel,
    docIds: [...new Set(chunks.map((c) => c.docId))],
    documentCount: cfg.documents.length,
    chunkCount: chunks.length,
    chunks,
  },
}];
