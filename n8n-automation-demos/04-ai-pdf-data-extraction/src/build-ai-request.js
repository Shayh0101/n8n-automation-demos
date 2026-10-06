// n8n Code node: "Build AI Request" (mode: Run Once for All Items)
// Input : items from "Extract PDF Text" ({ text, numpages, info })
// Output: one item per document with file metadata + a ready-to-send Claude Messages API body.

// ---- Configuration (edit here) -------------------------------------------
const MODEL = 'claude-sonnet-5';      // any Claude model id
const MAX_CHARS = 60000;              // truncate very long PDFs to control cost
const MIN_TEXT_CHARS = 20;            // below this the PDF is treated as scanned/empty
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a precise document data extraction engine.',
  'Extract data from the business document (invoice, receipt, purchase order, quote or similar).',
  'Return ONLY a single JSON object, no prose, no markdown fences, with exactly these keys:',
  '{',
  '  "document_type": "invoice | receipt | purchase_order | quote | other",',
  '  "vendor_name": string | null,',
  '  "customer_name": string | null,',
  '  "document_number": string | null,',
  '  "document_date": "YYYY-MM-DD" | null,',
  '  "due_date": "YYYY-MM-DD" | null,',
  '  "currency": "ISO 4217 code, e.g. USD" | null,',
  '  "subtotal": number | null,',
  '  "tax": number | null,',
  '  "total": number | null,',
  '  "line_items": [{ "description": string, "quantity": number | null, "unit_price": number | null, "amount": number | null }],',
  '  "confidence": number between 0 and 1',
  '}',
  'Use null for anything not present in the document. Never invent values.',
].join('\n');

// Safely read file metadata from the "Download PDF" node (paired item).
function fileMeta(index) {
  try {
    const src = $('Download PDF').itemMatching(index).json || {};
    return { fileId: src.id || '', fileName: src.name || '', fileUrl: src.webViewLink || '' };
  } catch (e) {
    return { fileId: '', fileName: '', fileUrl: '' };
  }
}

const out = [];
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const json = items[i].json || {};
  const meta = fileMeta(i);
  const raw = typeof json.text === 'string' ? json.text : '';
  // Collapse whitespace noise produced by PDF text extraction.
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const hasText = text.length >= MIN_TEXT_CHARS;
  const truncated = text.length > MAX_CHARS;

  out.push({
    json: {
      ...meta,
      pages: json.numpages || null,
      hasText,
      truncated,
      textLength: text.length,
      requestBody: hasText
        ? {
            model: MODEL,
            max_tokens: 2048,
            temperature: 0,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: `File name: ${meta.fileName || 'unknown'}\n\nDocument text:\n"""\n${text.slice(0, MAX_CHARS)}\n"""`,
              },
            ],
          }
        : null,
    },
    pairedItem: { item: i },
  });
}

return out;
