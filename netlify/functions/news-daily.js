'use strict';

// Runs every day at 06:00 UTC. Pre-generates the day's news summaries and
// stores them in Netlify Blobs so that the first user to open the news page
// gets an instant response instead of waiting for the AI to generate content.

const { getStore }         = require('@netlify/blobs');
const { fetchAllFeeds }    = require('./lib/rss');
const { generateSummaries } = require('./lib/summarise');

exports.config = {
  schedule: '0 6 * * *',
};

exports.handler = async () => {
  console.log('[news-daily] Starting scheduled news generation');

  let items;
  try {
    items = await fetchAllFeeds();
  } catch (err) {
    console.error('[news-daily] RSS fetch failed:', err.message);
    return { statusCode: 200 };
  }

  if (items.length === 0) {
    console.error('[news-daily] No items retrieved from any feed');
    return { statusCode: 200 };
  }

  console.log(`[news-daily] Fetched ${items.length} items — generating summaries`);

  let stories;
  try {
    stories = await generateSummaries(items);
  } catch (err) {
    console.error('[news-daily] Summary generation failed:', err.message);
    return { statusCode: 200 };
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const store = getStore('news');
    await store.setJSON(`stories-${today}`, stories);
    console.log(`[news-daily] Stored ${stories.length} stories for ${today}`);
  } catch (err) {
    console.error('[news-daily] Failed to write to Blobs:', err.message);
  }

  return { statusCode: 200 };
};
