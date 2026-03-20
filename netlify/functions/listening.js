'use strict';

function generatePrompt(level) {
  return `Generate a Russian listening exercise for ${level}-level learners.

Write a spoken-style monologue (news bulletin or documentary style) on the given topic.
Target length: 200–250 words — approximately 2 minutes at a measured speaking pace.

Format your response EXACTLY as follows — no extra text outside the delimiters:

---SCRIPT---
[Russian text, 200–250 words. Written for the ear: shorter sentences, natural spoken rhythm, no deeply nested clauses. No title, no speaker labels, no headers.]
---QUESTIONS---
1. [English comprehension question]
2. [English comprehension question]
3. [English comprehension question]
4. [English comprehension question]
5. [English comprehension question]
---END---

Requirements:
- Script in Russian only. Sentences should flow naturally when spoken aloud.
- ${level} vocabulary. Sentence structure may be somewhat simpler than written ${level} to suit listening comprehension.
- Questions test genuine comprehension — mix factual recall and inference. All in English.
- Nothing outside the delimiters.`;
}

const CHECK_PROMPT = `You are checking comprehension answers for a Russian listening exercise.

For each numbered answer, respond with one of:
✓ Correct.
~ Partially correct — [one-sentence note]
✗ Incorrect — [one-sentence correction]

Output a numbered list only. Match the numbering to the questions. Be concise and constructive.`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

  let body;
  try {
    body = JSON.parse(event.body);
    if (!body.mode) throw new Error('Missing mode');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  let systemPrompt, userMessage, maxTokens;

  if (body.mode === 'generate') {
    const { level, topic } = body;
    if (!level || !topic) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing level or topic' }) };
    systemPrompt = generatePrompt(level);
    userMessage  = `Topic: ${topic}`;
    maxTokens    = 1024;

  } else if (body.mode === 'check') {
    const { script, questions, answers } = body;
    if (!script || !questions || !answers) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing script, questions, or answers' }) };
    const qaList = questions.map((q, i) =>
      `${i + 1}. Q: ${q}\n   A: ${answers[i] || '(no answer given)'}`
    ).join('\n\n');
    systemPrompt = CHECK_PROMPT;
    userMessage  = `Listening script:\n${script}\n\nAnswers to check:\n${qaList}`;
    maxTokens    = 600;

  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown mode' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          process.env.ANTHROPIC_API_KEY,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-opus-4-6',
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ content: data.content[0].text }) };

  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to reach Anthropic API' }) };
  }
};
