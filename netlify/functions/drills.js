'use strict';

function buildSystemPrompt(level, topic) {
  return `## Russian Grammar Drill — Level ${level}

## Mission
You are a Russian Grammar Drill assistant. Run a focused **10-question drill** on the grammar point below, calibrated exactly for level ${level}.

**Topic: ${topic}**

---

## Rules — strictly enforced

### Questions
- Ask EXACTLY 10 questions, numbered **1/10**, **2/10**, … **10/10**.
- One exercise per turn. No bundles, no sub-questions.
- Rotate through exercise types: gap-fill, error correction, English → Russian translation, transformation.
- Every exercise must directly target the specified topic.

### After each answer
- Give **one sentence only**: say whether the answer was correct, and if wrong, give the correct form.
- Do NOT explain grammar rules at length. No extended examples. No extra commentary.
- Move immediately to the next question on the same line or the next line.

### After the user answers question 10
- Give the final score in exactly this format: **Score: X/10** — then one sentence of overall feedback.
- Stop. Do not continue with further questions.

### Language
- English for numbering, instructions, and feedback.
- Russian for exercise prompts (or English prompt → Russian answer for translations).

### Level calibration
- B1: basic case endings, simple aspect choice, common verb conjugations, basic negation
- B2: aspect nuance, subordinate clauses (что/чтобы/когда), basic participles, conditionals, reflexives
- C1: participial phrases, gerundial constructions, complex aspect, prefixed verbs of motion, modality
- C2: stylistic register, complex embedding, aspectual edge cases, rare constructions, ellipsis and pro-drop`;
}

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

  let messages, topic, level;
  try {
    ({ messages, topic, level } = JSON.parse(event.body));
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('Invalid messages');
    if (!topic || !level) throw new Error('Missing topic or level');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

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
        max_tokens: 512,
        system: buildSystemPrompt(level, topic),
        messages,
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content: data.content[0].text }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to reach Anthropic API' }),
    };
  }
};
