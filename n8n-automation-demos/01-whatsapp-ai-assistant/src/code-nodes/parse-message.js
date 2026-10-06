// Turns a raw WhatsApp Cloud API webhook payload into one item per incoming
// customer message. Status updates (sent/delivered/read), reactions and
// unknown events produce no items, so the workflow simply stops for them.

// Returns the text the AI should answer, or null to ignore the message.
function extractText(msg) {
  switch (msg.type) {
    case 'text':
      return msg.text?.body?.trim() || null;
    case 'interactive':
      return (
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        null
      );
    case 'button':
      return msg.button?.text || null;
    case 'image':
    case 'video':
    case 'document': {
      const caption = msg[msg.type]?.caption?.trim();
      const note = `[The customer sent a ${msg.type}. You cannot view attachments.]`;
      return caption ? `${note} Caption: ${caption}` : note;
    }
    case 'audio':
    case 'sticker':
    case 'location':
    case 'contacts':
      return `[The customer sent a ${msg.type} message. You can only read text.]`;
    default:
      // reaction, system, unsupported, ...
      return null;
  }
}

const results = [];

for (const item of $input.all()) {
  const body = item.json.body || {};
  if (body.object !== 'whatsapp_business_account') continue;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const contacts = value.contacts || [];

      for (const msg of value.messages || []) {
        const text = extractText(msg);
        if (!text) continue;

        const contact = contacts.find((c) => c.wa_id === msg.from) || contacts[0] || {};
        results.push({
          json: {
            messageId: msg.id,
            from: msg.from,
            name: contact.profile?.name || '',
            type: msg.type,
            text,
            timestamp: Number(msg.timestamp) || null,
            phoneNumberId: value.metadata?.phone_number_id || '',
            config: item.json.config || {},
          },
        });
      }
    }
  }
}

return results;
