/* ============================================================
   Grammar — Chat interface
   Proxies to Anthropic API via /.netlify/functions/chat
   ============================================================ */

'use strict';

const API_ENDPOINT = '/.netlify/functions/chat';

let conversationHistory = [];
let isWaiting = false;

const $ = id => document.getElementById(id);

// ── Grammar topics ─────────────────────────────────────────────
const GRAMMAR_TOPICS = [
  'Verbal aspect — perfective vs imperfective',
  'Participles and participial phrases',
  'Gerunds and gerundial constructions',
  'Subordinate clauses and conjunctions',
  'Prefixed verbs of motion',
  'Unprefixed verbs of motion',
  'Impersonal constructions',
  'Modality and necessity',
  'Word order for emphasis and pragmatics',
  'Case government and alternations',
  'Concessive constructions',
  'Conditional and hypothetical mood',
  'Short-form adjectives and predicates',
  'Reflexive constructions',
  'Double negation and negative concord',
];

function renderTopics() {
  const shuffled = [...GRAMMAR_TOPICS].sort(() => Math.random() - 0.5);
  const topics = shuffled.slice(0, 3);
  const container = $('grTopics');
  container.innerHTML = '';
  topics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className = 'gr-topic-btn';
    btn.textContent = topic;
    btn.addEventListener('click', () => startSession(topic));
    container.appendChild(btn);
  });
}

renderTopics();

// ── Start session ──────────────────────────────────────────────
$('grStartBtn').addEventListener('click', () => startSession());

async function startSession(topic = null) {
  $('grWelcome').hidden = true;
  $('grChat').hidden = false;
  const opener = topic
    ? `Begin the session. Focus on: ${topic}.`
    : 'Begin the session.';
  // Send a hidden opener — not shown in the UI — to trigger
  // Claude's introduction and first exercise immediately.
  await callApi(opener, false);
}

// ── Send ───────────────────────────────────────────────────────
$('grSend').addEventListener('click', handleSend);

$('grInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

function handleSend() {
  if (isWaiting) return;
  const text = $('grInput').value.trim();
  if (!text) return;
  $('grInput').value = '';
  autoResize($('grInput'));
  callApi(text, true);
}

// ── Auto-resize textarea ───────────────────────────────────────
$('grInput').addEventListener('input', () => autoResize($('grInput')));

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ── Reset session ──────────────────────────────────────────────
$('grResetBtn').addEventListener('click', () => {
  if (conversationHistory.length === 0) return;
  if (!confirm('Start a new session? The current conversation will be cleared.')) return;
  conversationHistory = [];
  $('grMessages').innerHTML = '';
  renderTopics();
  $('grWelcome').hidden = false;
  $('grChat').hidden = true;
  setInputEnabled(false);
});

// ── API call ───────────────────────────────────────────────────
async function callApi(userText, showInUi) {
  if (showInUi) appendMessage('user', userText);

  conversationHistory.push({ role: 'user', content: userText });

  setInputEnabled(false);
  isWaiting = true;
  const loadingEl = appendLoading();

  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    const data = await res.json();
    loadingEl.remove();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const reply = data.content;
    conversationHistory.push({ role: 'assistant', content: reply });
    appendMessage('assistant', reply);
  } catch (err) {
    loadingEl.remove();
    conversationHistory.pop(); // remove the failed user turn
    const msg = err.message && err.message !== '[object Object]'
      ? `Error: ${err.message}`
      : 'Could not reach the server. Please check your connection and try again.';
    appendMessage('error', msg);
    console.error('Grammar API error:', err);
  }

  isWaiting = false;
  setInputEnabled(true);
}

// ── DOM helpers ────────────────────────────────────────────────
function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `gr-msg gr-msg--${role}`;
  el.innerHTML = role === 'assistant' ? formatMarkdown(text) : escHtml(text);
  $('grMessages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}

function appendLoading() {
  const el = document.createElement('div');
  el.className = 'gr-msg gr-msg--assistant gr-msg--loading';
  el.innerHTML = '<span class="gr-dots"><span></span><span></span><span></span></span>';
  $('grMessages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}

function setInputEnabled(enabled) {
  $('grInput').disabled = !enabled;
  $('grSend').disabled  = !enabled;
  if (enabled) $('grInput').focus();
}

// ── Markdown formatter ─────────────────────────────────────────
// Handles the subset Claude uses: bold, italic, code, blockquotes,
// bullet lists, numbered lists, headings, paragraphs.
function formatMarkdown(raw) {
  const blocks = raw.split(/\n{2,}/);

  return blocks.map(block => {
    const lines = block.split('\n');
    const first = lines[0];

    // Bullet list
    if (/^[*\-] /.test(first)) {
      const items = lines
        .filter(l => /^[*\-] /.test(l))
        .map(l => `<li>${inlineFmt(l.replace(/^[*\-] /, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    // Numbered list
    if (/^\d+\. /.test(first)) {
      const items = lines
        .filter(l => /^\d+\. /.test(l))
        .map(l => `<li>${inlineFmt(l.replace(/^\d+\. /, ''))}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    // Blockquote
    if (/^> /.test(first)) {
      const content = lines
        .map(l => inlineFmt(l.replace(/^> ?/, '')))
        .join('<br>');
      return `<blockquote>${content}</blockquote>`;
    }

    // Heading (# / ## / ###)
    const headingMatch = first.match(/^(#{1,3}) (.+)/);
    if (headingMatch) {
      return `<p><strong>${inlineFmt(headingMatch[2])}</strong></p>`;
    }

    // Horizontal rule
    if (/^---+$/.test(first.trim())) return '';

    // Regular paragraph — join lines with <br>
    const content = lines.map(l => inlineFmt(l)).join('<br>');
    return `<p>${content}</p>`;
  }).filter(Boolean).join('');
}

function inlineFmt(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    .replace(/`(.*?)`/g,       '<code>$1</code>');
}

function escHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
