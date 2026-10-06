// Normalises the Claude / OpenAI response into a WhatsApp text message.
// If the AI call failed (the HTTP nodes continue on error), a friendly
// fallback reply is sent instead, and the error is kept in `aiError`.
const WHATSAPP_MAX_CHARS = 4096;

return $input.all().map((item, i) => {
  const res = item.json || {};
  const ctx = $('Build AI Request').itemMatching(i).json.context;

  let reply = '';
  let aiError = null;

  if (res.error) {
    aiError = typeof res.error === 'string' ? res.error : res.error.message || JSON.stringify(res.error);
  } else if (Array.isArray(res.content)) {
    // Anthropic Messages API
    reply = res.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  } else if (Array.isArray(res.choices)) {
    // OpenAI Chat Completions API
    reply = String(res.choices[0]?.message?.content || '').trim();
  }

  if (!reply && !aiError) aiError = 'Empty AI response';
  const usedFallback = !reply;
  if (usedFallback) reply = ctx.fallbackReply;
  if (reply.length > WHATSAPP_MAX_CHARS) reply = reply.slice(0, WHATSAPP_MAX_CHARS - 1) + '…';

  return {
    json: {
      to: ctx.from,
      phoneNumberId: ctx.phoneNumberId,
      graphApiVersion: ctx.graphApiVersion,
      replyText: reply,
      usedFallback,
      aiError,
      whatsappPayload: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: ctx.from,
        type: 'text',
        context: { message_id: ctx.messageId },
        text: { preview_url: false, body: reply },
      },
    },
  };
});
