'use strict';

// GET /.netlify/functions/news-get
//
// 1. Check Netlify Blobs for today's pre-generated stories (fast path —
//    populated by the news-daily scheduled function at 06:00 UTC).
// 2. If not found, generate on-demand as a fallback (slow path, used only
//    before the scheduled job has run or if it failed).

const { getStore }          = require('@netlify/blobs');
const { fetchAllFeeds }     = require('./lib/rss');
const { generateSummaries } = require('./lib/summarise');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function todayKey() {
  return `stories-${new Date().toISOString().split('T')[0]}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Fast path: read from Blobs ─────────────────────────────────
  try {
    const store = getStore('news');
    const stories = await store.get(todayKey(), { type: 'json' });
    if (Array.isArray(stories) && stories.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ stories, source: 'scheduled' }),
      };
    }
  } catch {
    // Blobs unavailable (e.g. local dev without netlify dev) — fall through
  }

  // ── Slow path: generate on-demand ─────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let items;
  try {
    items = await fetchAllFeeds();
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch news feeds' }) };
  }

  if (items.length === 0) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'All news feeds failed to load' }) };
  }

  let stories;
  try {
    stories = await generateSummaries(items);
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message || 'Failed to generate summaries' }),
    };
  }

  // Cache so subsequent users today also get the fast path
  try {
    const store = getStore('news');
    await store.setJSON(todayKey(), stories);
  } catch {
    // Storage write failed — still return the result to this user
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ stories, source: 'generated' }),
  };
};
