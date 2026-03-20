'use strict';

// ── System prompts ────────────────────────────────────────────

function generatePrompt(level) {
  return `You generate Russian reading exercises for ${level}-level learners.

Generate a reading passage on the given topic, followed by five comprehension questions.

Format your response EXACTLY as follows — do not deviate, add no extra text:

---PASSAGE---
[Russian prose, 2–3 paragraphs, 150–220 words total. Journalistic or analytical register. No title. No sub-headings.]
---QUESTIONS---
1. [Comprehension question in English]
2. [Comprehension question in English]
3. [Comprehension question in English]
4. [Comprehension question in English]
5. [Comprehension question in English]
---END---

Requirements:
- Passage: authentic ${level} Russian. Complex syntax, varied vocabulary, sophisticated register — as found in quality newspaper or magazine writing.
- Questions: mix factual recall, inference, and interpretation. All questions in English.
- Do not include anything outside the delimiters.`;
}

const EXPLAIN_PROMPT = `You are a concise Russian language assistant helping a C1–C2 reader understand a text.

The user has selected a word or phrase from a Russian reading passage. Provide:

1. **Translation**: one line
2. **Note**: one sentence only — grammar point, idiomatic use, or collocation worth flagging at this level. Omit if the item is straightforward.

Be brief. Do not over-explain.`;

const CHECK_PROMPT = `You are checking comprehension answers for a Russian reading exercise.

For each numbered answer, respond with one of:
✓ Correct.
~ Partially correct — [one-sentence note]
✗ Incorrect — [one-sentence correction]

Output a numbered list only. Match the numbering to the questions. Be concise and constructive.`;

// ── Handler ───────────────────────────────────────────────────

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
    maxTokens    = 2048;

  } else if (body.mode === 'explain') {
    const { selection, context } = body;
    if (!selection) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing selection' }) };
    systemPrompt = EXPLAIN_PROMPT;
    userMessage  = `Selected text: "${selection}"\n\nContext from passage:\n"${context || selection}"`;
    maxTokens    = 300;

  } else if (body.mode === 'check') {
    const { passage, questions, answers } = body;
    if (!passage || !questions || !answers) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing passage, questions, or answers' }) };
    const qaList = questions.map((q, i) =>
      `${i + 1}. Q: ${q}\n   A: ${answers[i] || '(no answer given)'}`
    ).join('\n\n');
    systemPrompt = CHECK_PROMPT;
    userMessage  = `Passage:\n${passage}\n\nAnswers to check:\n${qaList}`;
    maxTokens    = 600;

  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown mode' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':           process.env.ANTHROPIC_API_KEY,
        'anthropic-version':   '2023-06-01',
        'content-type':        'application/json',
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
