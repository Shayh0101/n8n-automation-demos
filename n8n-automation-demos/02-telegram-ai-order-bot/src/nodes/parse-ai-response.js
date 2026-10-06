// Parse AI Response
// Validates the model's JSON, merges it into the per-chat draft order,
// prices items from the catalog (never trusts AI prices) and decides whether
// the order is complete. Complete orders get a ready-to-append `sheetRow`.

const config = $('Shop Config').first().json;
const contexts = $('Build AI Request').all();
const staticData = $getWorkflowStaticData('global');
staticData.drafts = staticData.drafts || {};

let catalog = [];
try { catalog = JSON.parse(config.catalogJson || '[]'); } catch (e) { catalog = []; }
const currency = config.currency || 'USD';
const byName = new Map(catalog.map((p) => [String(p.name).toLowerCase().trim(), p]));

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function normalizeItems(rawItems) {
  const items = [];
  const unknown = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const name = str(raw && raw.product);
    const qty = Math.floor(Number(raw && raw.quantity));
    if (!name) continue;
    const product = byName.get(name.toLowerCase());
    if (!product) { unknown.push(name); continue; }
    if (!Number.isFinite(qty) || qty < 1 || qty > 100) continue;
    const unitPrice = Number(product.price);
    const existing = items.find((i) => i.product === product.name);
    if (existing) {
      existing.quantity += qty;
      existing.lineTotal = Math.round(existing.quantity * unitPrice * 100) / 100;
    } else {
      items.push({ product: product.name, quantity: qty, unitPrice, lineTotal: Math.round(qty * unitPrice * 100) / 100 });
    }
  }
  return { items, unknown };
}

function normalizePhone(v) {
  const s = str(v);
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return (s.startsWith('+') ? '+' : '') + digits;
}

function makeOrderId(now) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${d}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

const out = [];
$input.all().forEach((item, i) => {
  const ctx = (contexts[i] || contexts[0]).json;
  const base = { chatId: ctx.chatId, username: ctx.username, firstName: ctx.firstName };
  const key = String(ctx.chatId);

  // 1) Read the model output (HTTP node runs with "continue on error").
  let ai = null;
  try {
    if (item.json.error) throw new Error('AI request failed');
    const content = item.json.choices && item.json.choices[0] && item.json.choices[0].message && item.json.choices[0].message.content;
    ai = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!ai || typeof ai !== 'object') throw new Error('AI returned non-object');
  } catch (e) {
    out.push({ json: { ...base, isCompleteOrder: false, aiError: true,
      reply: 'Sorry, I could not process your message right now. Please try again in a moment.' } });
    return;
  }

  // 2) Merge into the draft.
  const draft = staticData.drafts[key] || { items: [], customerName: '', phone: '', address: '', notes: '' };
  const o = ai.order && typeof ai.order === 'object' ? ai.order : {};
  const { items, unknown } = normalizeItems(o.items);
  if (items.length) draft.items = items;
  if (str(o.customer_name)) draft.customerName = str(o.customer_name);
  if (normalizePhone(o.phone)) draft.phone = normalizePhone(o.phone);
  if (str(o.address)) draft.address = str(o.address);
  if (str(o.notes)) draft.notes = str(o.notes);

  const aiReply = str(ai.reply);
  const inOrderFlow = ai.intent === 'order' || draft.items.length > 0;
  if (!inOrderFlow) {
    out.push({ json: { ...base, isCompleteOrder: false, reply: aiReply || 'How can I help you? Send /menu to see what we offer.' } });
    return;
  }

  const missing = [];
  if (!draft.items.length) missing.push('items');
  if (!draft.customerName) missing.push('name');
  if (!draft.phone) missing.push('phone number');
  if (!draft.address) missing.push('delivery address');

  if (missing.length) {
    staticData.drafts[key] = draft;
    let reply = aiReply || `Thanks! To complete your order please send your ${missing.join(', ')}.`;
    if (unknown.length) reply += `\n\n(Not on our menu: ${unknown.join(', ')})`;
    out.push({ json: { ...base, isCompleteOrder: false, missing, draft, reply } });
    return;
  }

  // 3) Complete order — clear the draft and build the sheet row.
  delete staticData.drafts[key];
  const now = new Date();
  const total = Math.round(draft.items.reduce((s, it) => s + it.lineTotal, 0) * 100) / 100;
  const order = { orderId: makeOrderId(now), createdAt: now.toISOString(), ...draft, total, currency };
  out.push({
    json: {
      ...base,
      isCompleteOrder: true,
      order,
      sheetRow: {
        'Order ID': order.orderId,
        'Created At': order.createdAt,
        'Status': 'New',
        'Telegram Chat ID': String(ctx.chatId),
        'Telegram Username': ctx.username ? `@${ctx.username}` : '',
        'Customer Name': order.customerName,
        'Phone': order.phone,
        'Address': order.address,
        'Items': order.items.map((it) => `${it.quantity} x ${it.product}`).join('; '),
        'Total': total,
        'Currency': currency,
        'Notes': order.notes,
      },
    },
  });
});

return out;
