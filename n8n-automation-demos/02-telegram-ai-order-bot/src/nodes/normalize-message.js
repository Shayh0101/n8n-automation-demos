// Normalize Message
// Turns a raw Telegram update into a flat object and handles bot commands
// (/start, /help, /menu, /cancel) without spending an AI call.
// Output: { chatId, userId, username, firstName, text, needsAi, reply? }

const config = $('Shop Config').first().json;
const staticData = $getWorkflowStaticData('global');
staticData.drafts = staticData.drafts || {};

function parseCatalog(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.filter((p) => p && p.name && Number(p.price) >= 0) : [];
  } catch (e) {
    return [];
  }
}

function menuText(catalog, currency) {
  if (!catalog.length) return 'The menu is not configured yet.';
  return catalog.map((p) => `• ${p.name} — ${Number(p.price).toFixed(2)} ${currency}`).join('\n');
}

const catalog = parseCatalog(config.catalogJson);
const currency = config.currency || 'USD';
const shopName = config.shopName || 'our shop';
const out = [];

for (const item of $input.all()) {
  const msg = item.json.message || item.json.edited_message || {};
  const chatId = msg.chat && msg.chat.id != null ? msg.chat.id : null;
  if (chatId == null) continue; // not a chat message (e.g. channel post) — nothing to answer

  const from = msg.from || {};
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const base = {
    chatId,
    userId: from.id != null ? from.id : null,
    username: from.username || '',
    firstName: from.first_name || '',
    text,
  };

  if (!text) {
    out.push({ json: { ...base, needsAi: false, reply: 'Sorry, I can only read text messages. Please type your order or question.' } });
    continue;
  }

  const command = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  if (command === 'start' || command === 'help') {
    const hello = base.firstName ? `Hi ${base.firstName}! ` : 'Hi! ';
    out.push({ json: { ...base, needsAi: false, reply:
      `${hello}Welcome to ${shopName}.\n\n` +
      'Just tell me what you would like to order in your own words, e.g. "2 Margherita pizzas to 5 Main St, I am John, +1 555 123 4567".\n\n' +
      `Menu:\n${menuText(catalog, currency)}\n\n/menu — show menu\n/cancel — clear your current order` } });
  } else if (command === 'menu') {
    out.push({ json: { ...base, needsAi: false, reply: `Menu:\n${menuText(catalog, currency)}` } });
  } else if (command === 'cancel') {
    delete staticData.drafts[String(chatId)];
    out.push({ json: { ...base, needsAi: false, reply: 'Your current order has been cleared. Send a new message whenever you are ready.' } });
  } else if (command) {
    out.push({ json: { ...base, needsAi: false, reply: 'Unknown command. Use /menu, /cancel or just type your order.' } });
  } else {
    // Telegram allows 4096 chars; cap input to keep AI costs predictable.
    out.push({ json: { ...base, text: text.slice(0, 2000), needsAi: true } });
  }
}

return out;
