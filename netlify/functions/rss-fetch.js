'use strict';

const FEEDS = [
  { url: 'https://meduza.io/rss/all',                   name: 'Meduza' },
  { url: 'https://www.themoscowtimes.com/rss/news',      name: 'Moscow Times' },
  { url: 'https://www.rferl.org/api/epiqq',              name: 'RFE/RL Russia' },
  { url: 'https://eurasianet.org/rss.xml',               name: 'Eurasianet' },
  { url: 'https://www.rferl.org/api/z-oqvu-ihqp',       name: 'RFE/RL Central Asia' },
];

function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractText(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    'i'
  );
  const m = block.match(re);
  if (!m) return '';
  return stripHtml((m[1] || m[2] || '').trim());
}

function parseItems(xml, sourceName) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null && items.length < 12) {
    const block = match[1];
    const title = extractText(block, 'title');
    let description = extractText(block, 'description');
    if (!description) description = extractText(block, 'summary');
    if (title) {
      items.push({
        title,
        description: description.substring(0, 400),
        source: sourceName,
      });
    }
  }
  return items;
}

async function fetchFeed({ url, name }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RussianLangApp/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseItems(xml, name);
  } catch {
    return [];
  }
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

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const items = results.flat();

  if (items.length === 0) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'All feeds failed to load' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ items }),
  };
};
