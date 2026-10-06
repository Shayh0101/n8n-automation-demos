// n8n Code node: "Parse & Validate" (mode: Run Once for All Items)
// Input : Claude Messages API responses (or error items, because the HTTP node uses "Continue on error")
// Output: one flat row per document, ready for Google Sheets.
// Status: OK | NEEDS_REVIEW (parsed, but something looks off) | ERROR (no usable data)

const LOW_CONFIDENCE = 0.7;     // below this the row is flagged for review
const TOTAL_TOLERANCE = 0.02;   // allowed rounding gap for subtotal + tax vs total

function meta(index) {
  try {
    return $('Build AI Request').itemMatching(index).json || {};
  } catch (e) {
    return {};
  }
}

// "$1,234.56", "1.234,56 EUR", 1234.56, "(12.00)" -> number | null
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const commaIsThousands = lastDot === -1 && /^\d{1,3}(,\d{3})+$/.test(s);
  if (lastComma > lastDot && !commaIsThousands) {
    // European format: 1.234,56 (or 12,5)
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Accepts ISO, "2026-3-5", "03/05/2026" (US), "5.3.2026" (EU), "March 5, 2026" -> YYYY-MM-DD | null
function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const pad = (n) => String(n).padStart(2, '0');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(s + ' UTC');
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Pull the JSON object out of the model text (tolerates ```json fences or stray prose).
function extractJson(text) {
  if (typeof text !== 'string') throw new Error('Empty model response');
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function baseRow(m) {
  return {
    'Processed At': new Date().toISOString(),
    'File Name': m.fileName || '',
    'File ID': m.fileId || '',
    'File URL': m.fileUrl || '',
  };
}

const out = [];
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const r = items[i].json || {};
  const m = meta(i);
  const row = baseRow(m);
  const notes = [];

  try {
    if (r.error) {
      const msg = typeof r.error === 'string' ? r.error : r.error.message || JSON.stringify(r.error);
      throw new Error(`AI request failed: ${msg}`);
    }
    const textBlock = Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'text') : null;
    const data = extractJson(textBlock && textBlock.text);
    if (r.stop_reason === 'max_tokens') notes.push('Model output was cut off (max_tokens)');

    const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
    const subtotal = toNumber(data.subtotal);
    const tax = toNumber(data.tax);
    const total = toNumber(data.total);
    const confidence = toNumber(data.confidence);

    if (total === null) notes.push('Total not found');
    if (!data.vendor_name) notes.push('Vendor not found');
    if (subtotal !== null && total !== null && Math.abs(subtotal + (tax || 0) - total) > TOTAL_TOLERANCE) {
      notes.push(`Subtotal + tax (${(subtotal + (tax || 0)).toFixed(2)}) != total (${total.toFixed(2)})`);
    }
    if (confidence !== null && confidence < LOW_CONFIDENCE) notes.push(`Low confidence (${confidence})`);
    if (m.truncated) notes.push('Document text was truncated');

    out.push({
      json: {
        ...row,
        'Document Type': data.document_type || 'other',
        Vendor: data.vendor_name || '',
        Customer: data.customer_name || '',
        'Document Number': data.document_number || '',
        'Document Date': toIsoDate(data.document_date) || '',
        'Due Date': toIsoDate(data.due_date) || '',
        Currency: (data.currency || '').toString().toUpperCase(),
        Subtotal: subtotal === null ? '' : subtotal,
        Tax: tax === null ? '' : tax,
        Total: total === null ? '' : total,
        'Line Items Count': lineItems.length,
        'Line Items': lineItems
          .map((li) => `${li.quantity ?? ''} x ${li.description ?? ''} = ${toNumber(li.amount) ?? ''}`.trim())
          .join(' | '),
        Confidence: confidence === null ? '' : confidence,
        Status: notes.length ? 'NEEDS_REVIEW' : 'OK',
        Notes: notes.join('; '),
      },
      pairedItem: { item: i },
    });
  } catch (err) {
    out.push({
      json: { ...row, Status: 'ERROR', Notes: String(err.message || err) },
      pairedItem: { item: i },
    });
  }
}

return out;
