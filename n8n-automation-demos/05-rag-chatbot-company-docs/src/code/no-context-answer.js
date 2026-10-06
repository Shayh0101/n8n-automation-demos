// No Context Answer
// Returned when vector search found nothing above minScore — the LLM is not called.

const prompt = $input.first().json;

return [{
  json: {
    answer: "I couldn't find information about this in the company documents. Please rephrase the question or contact the responsible team.",
    grounded: false,
    sources: [],
    question: prompt.question,
  },
}];
