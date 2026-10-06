// Build Qdrant Points
// Pairs the OpenAI embeddings response with the chunks from "Chunk Documents"
// and produces the body for Qdrant's PUT /collections/{name}/points.

const chunkData = $('Chunk Documents').first().json;
const response = $input.first().json;

if (!response || !Array.isArray(response.data)) {
  throw new Error('Embeddings response has no "data" array: ' + JSON.stringify(response).slice(0, 300));
}
const chunks = chunkData.chunks;
if (response.data.length !== chunks.length) {
  throw new Error(`Got ${response.data.length} embeddings for ${chunks.length} chunks`);
}

// OpenAI returns an `index` per embedding — never rely on array order alone.
const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
const dim = vectors[0] && vectors[0].length;
if (!dim || vectors.some((v) => !Array.isArray(v) || v.length !== dim)) {
  throw new Error('Embeddings have missing or inconsistent dimensions');
}

const ingestedAt = new Date().toISOString();
const points = chunks.map((chunk, i) => ({
  id: chunk.id,
  vector: vectors[i],
  payload: {
    text: chunk.text,
    docId: chunk.docId,
    title: chunk.title,
    source: chunk.source,
    chunkIndex: chunk.chunkIndex,
    metadata: chunk.metadata,
    ingestedAt,
  },
}));

return [{
  json: {
    qdrantUrl: chunkData.qdrantUrl,
    collection: chunkData.collection,
    documentCount: chunkData.documentCount,
    chunkCount: chunkData.chunkCount,
    vectorSize: dim,
    points,
  },
}];
