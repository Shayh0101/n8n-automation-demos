// Builds the request body for the selected AI provider (Claude or OpenAI).
// All settings come from the "Config" node, carried along in item.json.config.
const SUPPORTED = ['anthropic', 'openai'];
const MAX_INPUT_CHARS = 4000;

return $input.all().map((item) => {
  const msg = item.json;
  const cfg = msg.config || {};
  const provider = String(cfg.aiProvider || 'anthropic').toLowerCase().trim();

  if (!SUPPORTED.includes(provider)) {
    throw new Error(`Unknown aiProvider "${cfg.aiProvider}". Use "anthropic" or "openai" in the Config node.`);
  }

  const maxTokens = Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : 500;
  const system =
    String(cfg.systemPrompt || 'You are a helpful customer support assistant.') +
    (msg.name ? `\nThe customer's WhatsApp name is "${msg.name}".` : '') +
    '\nReply in the same language as the customer. Keep answers short and suitable for WhatsApp.';
  const userText = String(msg.text || '').slice(0, MAX_INPUT_CHARS);

  const body =
    provider === 'anthropic'
      ? {
          model: cfg.anthropicModel || 'claude-sonnet-5',
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userText }],
        }
      : {
          model: cfg.openaiModel || 'gpt-4o-mini',
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userText },
          ],
        };

  return {
    json: {
      provider,
      body,
      // Context needed after the AI call to send the reply back.
      context: {
        from: msg.from,
        messageId: msg.messageId,
        phoneNumberId: msg.phoneNumberId,
        graphApiVersion: cfg.graphApiVersion || 'v21.0',
        fallbackReply:
          cfg.fallbackReply || 'Sorry, I could not process your message right now. A team member will get back to you soon.',
      },
    },
  };
});
