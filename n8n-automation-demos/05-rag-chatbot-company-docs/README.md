# RAG Chatbot over Company Docs — n8n template (OpenAI + Qdrant)

A ready-to-import n8n workflow that turns your internal documents (policies, wiki pages, handbooks, FAQs) into a chatbot that **answers only from those documents and cites its sources**.

- **One webhook, two actions:** `ingest` (add or update documents) and `ask` (ask a question).
- **Grounded answers:** the model may only use the retrieved context. Every answer says which documents it used (`[1]`, `[2]`…).
- **No made-up answers:** if no document is relevant enough, the workflow says "not found" and **does not call the LLM**, so it can't invent an answer and you don't pay for the tokens.
- **Re-ingesting is safe:** sending the same document again replaces its old chunks, so nothing is duplicated.
- **Production basics:** input validation with clear HTTP 400 errors, retries on every API call, batched embeddings, and no credentials stored in the file.

## How it works

```
                                   ┌─ ingest ─► Chunk Documents ─► Embed Chunks ─► Build Qdrant Points ─► Delete Old Chunks ─► Upsert to Qdrant ─► Respond: Ingested
                                   │                                (OpenAI)                                 (Qdrant)            (Qdrant)
Webhook ─► Config ─► Validate ─► Route by Action
 (POST)     (Set)    Request       │                                                        ┌─ true ─► Call LLM ─► Format Answer ─┐
                                   ├─ ask ────► Embed Question ─► Search Qdrant ─► Build Prompt ─► Has Context?                      ├─► Respond: Answer
                                   │            (OpenAI)          (Qdrant top-K)                └─ false ► No Context Answer ─────────┘
                                   │
                                   └─ invalid ► Respond: Error (HTTP 400)
```

| Step | Node | What it does |
|---|---|---|
| 1 | **Webhook** | `POST /webhook/rag-chatbot`. The reply is sent by the *Respond* nodes. |
| 2 | **Config** | All settings in one place: Qdrant URL, collection, models, top-K, min score, chunk size and overlap. |
| 3 | **Validate Request** (Code) | Checks the payload and settings. Bad requests get a readable error message. |
| 4 | **Chunk Documents** (Code) | Splits text into ~1000-character chunks with overlap, cutting at paragraph, sentence, or word boundaries. Chunk IDs are deterministic. |
| 5 | **Embed Chunks → Delete Old Chunks → Upsert** | Embeds all chunks in **one** OpenAI call, then removes the document's previous version (only after embedding succeeded, so a failed OpenAI call never wipes existing data) and writes the new chunks to Qdrant with title, source URL, and metadata. |
| 6 | **Embed Question → Search Qdrant** | Finds the top-K most similar chunks. |
| 7 | **Build Prompt** (Code) | Drops hits below `minScore`, removes duplicate chunks, limits the context size, and builds a strict "answer only from context, cite [n]" prompt. |
| 8 | **Has Context?** | If nothing is relevant, returns "not found" without calling the LLM. |
| 9 | **Call LLM → Format Answer** | Gets the chat completion and returns the answer, only the sources it cited (with snippets), and token usage. |

## Requirements

- n8n **1.30+** (self-hosted or n8n Cloud)
- An **OpenAI API key** (embeddings and chat)
- **Qdrant**: Qdrant Cloud (free tier is enough) or self-hosted. To try it locally, use the `docker-compose.yml` in this folder.

## Import & connect (about 10 minutes)

1. **Import:** in n8n, go to *Workflows → Import from File* and choose `workflow.json`.
2. **Config node:** set `qdrantUrl` (e.g. `https://xxxx.cloud.qdrant.io:6333`, or `http://qdrant:6333` with the bundled docker-compose) and `collection`.
3. **Create the collection** once. The vector size must match the embedding model: 1536 for `text-embedding-3-small`, 3072 for `-large`.
   ```bash
   curl -X PUT "$QDRANT_URL/collections/company_docs" \
     -H "api-key: $QDRANT_API_KEY" -H "Content-Type: application/json" \
     -d '{"vectors":{"size":1536,"distance":"Cosine"}}'
   # optional, faster re-ingest on large collections:
   curl -X PUT "$QDRANT_URL/collections/company_docs/index" \
     -H "api-key: $QDRANT_API_KEY" -H "Content-Type: application/json" \
     -d '{"field_name":"docId","field_schema":"keyword"}'
   ```
4. **Credentials.** None are included in the file, so you need to add them:
   - **OpenAI** credential → nodes *Embed Chunks*, *Embed Question*, *Call LLM*.
   - **Header Auth** credential (Name `api-key`, Value = your Qdrant API key) → nodes *Delete Old Chunks*, *Upsert to Qdrant*, *Search Qdrant*.
     If your local Qdrant has no API key, set *Authentication* to **None** in those three nodes.
5. **Activate** the workflow and use the production URL: `https://<your-n8n>/webhook/rag-chatbot`.

### Local sandbox (optional)

```bash
cp .env.example .env        # set N8N_ENCRYPTION_KEY
docker compose up -d        # n8n on :5678, Qdrant on :6333
```

## Usage

**Add or update documents**

```bash
curl -X POST https://<your-n8n>/webhook/rag-chatbot -H "Content-Type: application/json" -d '{
  "action": "ingest",
  "documents": [
    { "title": "Leave Policy", "source": "https://wiki.example.com/hr/leave",
      "metadata": { "department": "HR" },
      "text": "Every full-time employee receives 25 paid vacation days..." }
  ]
}'
# → {"status":"ok","documents":1,"chunks":4,"docIds":["leave-policy"],"qdrant":"completed"}
```

`id` is optional. By default it is created from the title, and documents with the same `id` replace each other. You can send up to 100 documents per request.

**Ask a question**

```bash
curl -X POST https://<your-n8n>/webhook/rag-chatbot -H "Content-Type: application/json" \
  -d '{"action":"ask","question":"Can I carry over unused vacation days?"}'
```

```json
{
  "answer": "You can carry over up to 5 unused vacation days; they expire on March 31st [1].",
  "grounded": true,
  "sources": [
    { "n": 1, "title": "Leave Policy", "source": "https://wiki.example.com/hr/leave",
      "docId": "leave-policy", "chunkIndex": 1, "score": 0.82, "snippet": "Carry-over. Up to 5 unused…" }
  ],
  "model": "gpt-4o-mini-2024-07-18",
  "usage": { "prompt_tokens": 312, "completion_tokens": 28, "total_tokens": 340 }
}
```

An invalid request returns HTTP 400: `{"status":"error","error":"\"question\" must be a non-empty string"}`.

## Tuning (Config node)

| Field | Default | Notes |
|---|---|---|
| `embeddingModel` | `text-embedding-3-small` | If you change it, recreate the collection with the matching vector size. |
| `chatModel` | `gpt-4o-mini` | Any OpenAI chat model. |
| `topK` | 5 | Number of chunks retrieved per question. A request can override it with `"topK"` (1–20). |
| `minScore` | 0.3 | Minimum cosine similarity. Raise it to make "not found" answers stricter. |
| `chunkSize` / `chunkOverlap` | 1000 / 150 | Measured in characters. Use smaller chunks for FAQ-style documents and larger ones for long policies. |
| `maxContextChars` | 12000 | Maximum context size sent to the LLM, which controls cost per answer. |

## Developer notes and tests

The Code-node logic is kept in `src/code/*.js`, and `scripts/build-workflow.js` builds `workflow.json` from those files.

```bash
npm run build   # regenerate workflow.json after editing src/code/*.js
npm test        # node validate.js
```

`validate.js` checks the exported workflow (valid JSON, `executionOrder: v1`, unique node names and IDs, exactly one trigger, valid connections, every branch ends in a Respond node, no credentials or API keys, sticky notes present). It also runs each **Code node exactly as stored in `workflow.json`**, using sample data from `test/fixtures/`. OpenAI and Qdrant are mocked, so no keys are needed.

## Ideas for next steps

1. **Automatic sync from your sources:** a scheduled workflow that pulls new or changed files from Google Drive, Notion, Confluence, or SharePoint, extracts the text (PDF/DOCX), and sends it to the `ingest` action. Your knowledge base then stays up to date without manual uploads.
2. **Chat UI and conversation memory:** connect the `ask` branch to a Slack or Teams bot, a website widget, or n8n's Chat Trigger. Use the last few messages to rewrite follow-up questions ("and for part-time staff?") before searching.
3. **Access control and quality:** filter by `metadata.department` or user role during the Qdrant search, so people only see documents they are allowed to read. Add hybrid search (keywords + vectors) or a re-ranking model, and log questions with "not found" answers to see which documents are missing.
