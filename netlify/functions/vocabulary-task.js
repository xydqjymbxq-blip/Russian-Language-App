'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-opus-4-6';

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ── Task generation ──────────────────────────────────────────────────────────
const GENERATE_SYSTEM = `You are a Russian language teacher setting vocabulary activation tasks.
Your job is to create a short, focused task that requires the student to actively USE a specific
Russian word or phrase in a new context — not just recall its meaning.

You will be given an English meaning and the Russian word/phrase. Return a JSON object with:
- "task": a clear English instruction telling the student what to write in Russian
- "type": one of "sentence", "gapfill", "translate", "dialogue"
- "hint": one short English hint (grammar note, usage tip, or example context) — max 12 words

Task variety rules (vary the type based on the word):
- "sentence": Ask them to write an original Russian sentence using the word (most common)
- "gapfill": Give a Russian sentence with ___ where the word should go
- "translate": Give an English sentence that naturally uses the concept
- "dialogue": Give an incomplete Russian exchange and ask them to complete a line using the word

Keep tasks brief and achievable. Do not reveal the Russian word or its direct translation in the task.
Return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

// ── Evaluation ───────────────────────────────────────────────────────────────
const EVALUATE_SYSTEM = `You are a Russian language teacher evaluating a student's attempt to use
a specific Russian word or phrase in their own writing.

You will receive: the Russian target word/phrase, the task set, and the student's response.

Evaluate and return a JSON object with:
- "score": 2 = correct and natural use, 1 = attempted but has an error, 0 = word missing or completely wrong
- "used": true if the target word (or an inflected/conjugated form of it) appears in the response
- "feedback": 1–2 English sentences of honest, encouraging feedback. If there are errors, name them briefly.
- "correction": if score < 2, provide the corrected Russian sentence; if score is 2, set to ""

Be encouraging but accurate. Accept normal inflection as correct (e.g. взял напрокат for взять напрокат).
Return ONLY valid JSON. No markdown, no explanation.`;

// ── Claude call ──────────────────────────────────────────────────────────────
async function callClaude(system, userMessage) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':          process.env.ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Anthropic error');
  return data.content[0].text;
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { mode, word, task, response: userResponse } = body;

  try {
    if (mode === 'generate') {
      if (!word?.en || !word?.ru) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing word fields' }) };
      }

      const prompt = `English meaning: "${word.en}"\nRussian word/phrase: "${word.ru}"${
        word.sentence ? `\nExample sentence: "${word.sentence}"` : ''
      }`;

      const raw  = await callClaude(GENERATE_SYSTEM, prompt);
      const json = JSON.parse(raw.trim());

      return {
        statusCode: 200,
        headers:    HEADERS,
        body:       JSON.stringify({ task: json.task, type: json.type, hint: json.hint }),
      };
    }

    if (mode === 'evaluate') {
      if (!word?.ru || !task || !userResponse) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing fields' }) };
      }

      const prompt = [
        `Target Russian word/phrase: "${word.ru}" (means "${word.en}")`,
        `Task set: ${task}`,
        `Student's response: "${userResponse}"`,
      ].join('\n');

      const raw  = await callClaude(EVALUATE_SYSTEM, prompt);
      const json = JSON.parse(raw.trim());

      return {
        statusCode: 200,
        headers:    HEADERS,
        body:       JSON.stringify({
          score:      json.score,
          used:       json.used,
          feedback:   json.feedback,
          correction: json.correction,
        }),
      };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Unknown mode' }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers:    HEADERS,
      body:       JSON.stringify({ error: err.message || 'Internal error' }),
    };
  }
};
