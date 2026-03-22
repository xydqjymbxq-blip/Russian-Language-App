'use strict';

const SYSTEM_PROMPT = `You are a Russian language learning assistant. You will receive a list of news headlines and summaries from sources covering Russia, the Caucasus, and Central Asia.

Select the five most geopolitically significant stories. For each story, write a graded Russian-language summary of 80–120 words, targeted at C1 level. The Russian must be natural and idiomatic but accessible — avoid overly bureaucratic or journalistic register. Do not translate mechanically.

After each summary, include a vocabulary panel of five difficult or interesting words from your summary, each with its English translation and one example sentence in Russian.

Return ONLY a valid JSON array — no markdown, no code fences, no explanation text. Use this exact structure:
[
  {
    "title": "English story title",
    "source": "Source name",
    "summary": "Russian summary text (80–120 words)",
    "vocab": [
      { "word": "слово", "translation": "English translation", "example": "Example sentence in Russian." }
    ]
  }
]`;

async function generateSummaries(items) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('API key not configured');
  }

  const capped = items.slice(0, 25);

  const feedText = capped
    .map((item, i) =>
      `[${i + 1}] Source: ${item.source}\nTitle: ${item.title}${item.description ? `\nSummary: ${item.description}` : ''}`
    )
    .join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Here are today's news items:\n\n${feedText}` }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Anthropic API error');
  }

  const text = data.content[0].text.trim();
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
  const stories = JSON.parse(cleaned);

  if (!Array.isArray(stories)) throw new Error('Response was not a JSON array');
  return stories;
}

module.exports = { generateSummaries };
