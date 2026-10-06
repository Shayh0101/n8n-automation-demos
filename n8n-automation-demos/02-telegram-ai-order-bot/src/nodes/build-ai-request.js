// Build AI Request
// Builds an OpenAI-compatible Chat Completions body. The model receives the
// product catalog and the customer's current draft order (kept per chat in
// workflow static data), so multi-message conversations work.

const config = $('Shop Config').first().json;
const staticData = $getWorkflowStaticData('global');
staticData.drafts = staticData.drafts || {};

let catalog = [];
try { catalog = JSON.parse(config.catalogJson || '[]'); } catch (e) { catalog = []; }
const currency = config.currency || 'USD';

const systemPrompt = [
  `You are the order assistant of "${config.shopName || 'the shop'}" in Telegram.`,
  'Your job: answer questions about the products and collect orders.',
  `Catalog (only these products can be ordered, prices in ${currency}):`,
  JSON.stringify(catalog.map((p) => ({ name: p.name, price: p.price, description: p.description || '' }))),
  'An order needs: at least one item, customer_name, phone, address.',
  'Rules:',
  '- Respond with a single JSON object only, no markdown.',
  '- Extract ONLY information the customer actually provided. Never invent names, phones or addresses.',
  '- Use exact product names from the catalog. If the customer asks for something not in the catalog, say so in "reply".',
  '- "order.items" must contain the FULL list of items the customer wants now (merge with the draft unless they change it); leave it empty if no change.',
  '- In "reply", answer in the customer\'s language, briefly, and ask for whatever is still missing.',
  'JSON schema:',
  '{"intent":"order|question|other","reply":"string","order":{"items":[{"product":"string","quantity":1}],"customer_name":"string","phone":"string","address":"string","notes":"string"}}',
].join('\n');

const out = [];
for (const item of $input.all()) {
  const ctx = item.json;
  const draft = staticData.drafts[String(ctx.chatId)] || null;
  const userContent = [
    `Current draft order: ${draft ? JSON.stringify(draft) : 'none'}`,
    `Customer (${ctx.firstName || 'unknown'}) says: ${ctx.text}`,
  ].join('\n');

  out.push({
    json: {
      ...ctx,
      requestBody: {
        model: config.aiModel || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      },
    },
  });
}

return out;
