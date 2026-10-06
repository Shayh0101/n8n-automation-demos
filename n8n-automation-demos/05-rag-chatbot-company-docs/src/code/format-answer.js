// Format Answer
// Extracts the LLM answer and keeps only the sources it actually cited ([n]).

const prompt = $('Build Prompt').first().json;
const completion = $input.first().json;

const content = completion && completion.choices && completion.choices[0] && completion.choices[0].message
  ? String(completion.choices[0].message.content || '').trim()
  : '';
if (!content) {
  throw new Error('LLM returned an empty answer: ' + JSON.stringify(completion).slice(0, 300));
}

const cited = new Set();
for (const m of content.matchAll(/\[(\d{1,3})\]/g)) cited.add(Number(m[1]));
const citedSources = prompt.sources.filter((s) => cited.has(s.n));

return [{
  json: {
    answer: content,
    grounded: citedSources.length > 0,
    // Fall back to all retrieved sources when the model forgot to cite.
    sources: (citedSources.length ? citedSources : prompt.sources).map(({ text, ...meta }) => ({
      ...meta,
      snippet: text.length > 240 ? text.slice(0, 240) + '…' : text,
    })),
    model: completion.model || prompt.chatModel,
    usage: completion.usage || null,
  },
}];
