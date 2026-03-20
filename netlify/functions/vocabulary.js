'use strict';

const SYSTEM_STAGE1 = `You are checking a learner's comprehension of a Russian sentence.
The learner was shown a Russian sentence and asked a comprehension question in English.
Reply with one short sentence of feedback, then on a new line write exactly [PASS] if their answer shows understanding, or [RETRY] if it does not.`;

const SYSTEM_STAGE2 = `You are checking whether a Russian language learner correctly completed a gapped Russian sentence.
The target word or phrase is provided. Accept minor spelling/accent errors but not wrong words.
Reply with one short sentence of feedback, then on a new line write exactly [PASS] or [RETRY].`;

const SYSTEM_STAGE3_GEN = `You are a Russian language tutor. Given an English word or phrase and its Russian equivalent, write one simple English sentence (8–14 words) that a learner could translate into Russian. The sentence should naturally prompt use of the target Russian word or phrase. Output only the English sentence, nothing else.`;

const SYSTEM_STAGE3_CHECK = `You are checking a Russian language learner's translation.
The target Russian word or phrase is provided. Accept natural variation but the target word/phrase must appear (allow minor inflection).
Reply with one short sentence of feedback, then on a new line write exactly [PASS] or [RETRY].`;

const SYSTEM_STAGE4 = `You are checking a Russian language learner's original sentence.
The target Russian word or phrase is provided. The learner should have used it in a grammatically correct, meaningful Russian sentence.
Reply with one short sentence of feedback (correct any errors gently), then on a new line write exactly [PASS] or [RETRY].`;

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

  switch (body.mode) {

    case 'stage1-check': {
      const { sentence, question, answer } = body;
      if (!sentence || !question || !answer)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      systemPrompt = SYSTEM_STAGE1;
      userMessage  = `Russian sentence: ${sentence}\nComprehension question: ${question}\nLearner answer: ${answer}`;
      maxTokens    = 150;
      break;
    }

    case 'stage2-check': {
      const { gappedSentence, target, answer } = body;
      if (!gappedSentence || !target || !answer)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      systemPrompt = SYSTEM_STAGE2;
      userMessage  = `Gapped sentence: ${gappedSentence}\nTarget word/phrase: ${target}\nLearner answer: ${answer}`;
      maxTokens    = 150;
      break;
    }

    case 'stage3-generate': {
      const { en, ru } = body;
      if (!en || !ru)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      systemPrompt = SYSTEM_STAGE3_GEN;
      userMessage  = `English word/phrase: ${en}\nRussian equivalent: ${ru}`;
      maxTokens    = 80;
      break;
    }

    case 'stage3-check': {
      const { promptSentence, target, answer } = body;
      if (!promptSentence || !target || !answer)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      systemPrompt = SYSTEM_STAGE3_CHECK;
      userMessage  = `English prompt: ${promptSentence}\nTarget Russian word/phrase: ${target}\nLearner translation: ${answer}`;
      maxTokens    = 150;
      break;
    }

    case 'stage4-check': {
      const { en, ru, answer } = body;
      if (!en || !ru || !answer)
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
      systemPrompt = SYSTEM_STAGE4;
      userMessage  = `English meaning: ${en}\nTarget Russian word/phrase: ${ru}\nLearner sentence: ${answer}`;
      maxTokens    = 150;
      break;
    }

    default:
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown mode' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-opus-4-6',
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    if (!response.ok)
      return { statusCode: response.status, headers, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ content: data.content[0].text }) };

  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to reach Anthropic API' }) };
  }
};
