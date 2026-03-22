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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let items;
  try {
    ({ items } = JSON.parse(event.body));
    if (!Array.isArray(items) || items.length === 0) throw new Error('No items');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const feedText = items
    .map((item, i) =>
      `[${i + 1}] Source: ${item.source}\nTitle: ${item.title}${item.description ? `\nSummary: ${item.description}` : ''}`
    )
    .join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Here are today's news items:\n\n${feedText}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }),
      };
    }

    const text = data.content[0].text.trim();

    let stories;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      stories = JSON.parse(cleaned);
      if (!Array.isArray(stories)) throw new Error('Not an array');
    } catch {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Invalid response format from AI' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ stories }),
    };
  } catch {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to reach Anthropic API' }),
    };
  }
};
