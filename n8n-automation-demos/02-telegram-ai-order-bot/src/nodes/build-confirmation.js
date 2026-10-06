// Build Confirmation
// Runs after the order row is saved to Google Sheets and builds the
// customer-facing confirmation message. If the Sheets append failed (the node
// runs with "continue on error"), the draft is restored so the customer can retry.

const orders = $('Parse AI Response').all().filter((it) => it.json.isCompleteOrder);
const staticData = $getWorkflowStaticData('global');
staticData.drafts = staticData.drafts || {};

return $input.all().map((item, i) => {
  const src = (orders[i] || orders[0]).json;
  const o = src.order;

  if (item.json.error) {
    staticData.drafts[String(src.chatId)] = {
      items: o.items, customerName: o.customerName, phone: o.phone, address: o.address, notes: o.notes || '',
    };
    return { json: { chatId: src.chatId, orderId: o.orderId, saveError: true,
      reply: 'Sorry, we could not save your order right now. Your details are kept, so please send "confirm" in a minute to try again.' } };
  }
  const lines = o.items.map((it) => `• ${it.quantity} x ${it.product} — ${it.lineTotal.toFixed(2)} ${o.currency}`);
  const reply = [
    `✅ Order ${o.orderId} received!`,
    '',
    ...lines,
    `Total: ${o.total.toFixed(2)} ${o.currency}`,
    '',
    `Name: ${o.customerName}`,
    `Phone: ${o.phone}`,
    `Address: ${o.address}`,
    o.notes ? `Notes: ${o.notes}` : null,
    '',
    'We will contact you shortly to confirm delivery time.',
  ].filter((l) => l !== null).join('\n');

  return { json: { chatId: src.chatId, orderId: o.orderId, reply } };
});
