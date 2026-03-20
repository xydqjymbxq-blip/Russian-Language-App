/* ============================================================
   Grammar Drills — 10-question drill interface
   Proxies to Anthropic API via /.netlify/functions/drills
   ============================================================ */

'use strict';

const DRILL_API = '/.netlify/functions/drills';

let conversationHistory = [];
let isWaiting          = false;
let questionCount      = 0;   // number of user answers sent
let selectedLevel      = 'B2';
let selectedTopic      = null;

const $ = id => document.getElementById(id);

// ── Topic pool ─────────────────────────────────────────────────
const DRILL_TOPICS = {
  B1: [
    'Accusative case',
    'Genitive case',
    'Dative case',
    'Instrumental case',
    'Prepositional case',
    'Basic aspect choice',
    'Basic verbs of motion',
    'Gender and adjective agreement',
    'Present tense conjugation',
    'Basic negation',
  ],
  B2: [
    'Aspect in past and future tense',
    'Subordinate clauses with что and чтобы',
    'Basic active participles',
    'Reflexive verbs and -ся',
    'Short-form adjectives',
    'Comparative constructions',
    'Impersonal constructions',
    'Basic gerunds',
    'Conditional sentences',
    'Indirect speech',
  ],
  C1: [
    'Verbal aspect — nuance and register',
    'Participial phrases',
    'Gerundial constructions',
    'Complex subordination',
    'Prefixed verbs of motion',
    'Modality and necessity',
    'Word order for emphasis',
    'Case government and alternations',
    'Concessive constructions',
    'Double negation',
  ],
  C2: [
    'Stylistic register in grammar',
    'Complex clause embedding',
    'Aspectual edge cases',
    'Rare impersonal constructions',
    'Nominative vs genitive subjects',
    'Hypothetical and irrealis mood',
    'Syntactic compression',
    'Contrastive focus particles',
    'Complex modality',
    'Ellipsis and pro-drop',
  ],
};

// ── Topic rendering ────────────────────────────────────────────
function renderTopics() {
  const pool     = DRILL_TOPICS[selectedLevel] || DRILL_TOPICS.B2;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const topics   = shuffled.slice(0, 3);
  const container = $('drTopics');
  container.innerHTML = '';
  topics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className   = 'gr-topic-btn';
    btn.textContent = topic;
    btn.addEventListener('click', () => startDrill(topic));
    container.appendChild(btn);
  });
}

renderTopics();

// ── Level selector ─────────────────────────────────────────────
document.querySelectorAll('.dr-level-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dr-level-btn').forEach(b => b.classList.remove('dr-level-btn--active'));
    btn.classList.add('dr-level-btn--active');
    selectedLevel = btn.dataset.level;
    renderTopics();
  });
});

$('drShuffleBtn').addEventListener('click', renderTopics);

// ── Start drill ────────────────────────────────────────────────
async function startDrill(topic) {
  selectedTopic       = topic;
  conversationHistory = [];
  questionCount       = 0;

  $('drWelcome').hidden     = false; // keep hidden below
  $('drWelcome').hidden     = true;
  $('drDrill').hidden       = false;
  $('drCompleteBar').hidden = true;
  $('drInputBar').hidden    = false;
  $('drMessages').innerHTML = '';
  updateProgress();

  await callApi(`Begin the drill. Level: ${selectedLevel}. Topic: ${topic}.`, false);
}

// ── Reset button ───────────────────────────────────────────────
$('drResetBtn').addEventListener('click', () => {
  if (conversationHistory.length === 0 && $('drWelcome').hidden === false) return;
  if (conversationHistory.length > 0 && questionCount < 10) {
    if (!confirm('Abandon this drill and start a new one?')) return;
  }
  returnToWelcome();
});

function returnToWelcome() {
  conversationHistory = [];
  questionCount       = 0;
  $('drMessages').innerHTML = '';
  $('drDrill').hidden       = true;
  $('drCompleteBar').hidden = true;
  $('drInputBar').hidden    = false;
  $('drWelcome').hidden     = false;
  renderTopics();
}

$('drNewDrillBtn').addEventListener('click', returnToWelcome);

// ── Progress ───────────────────────────────────────────────────
function updateProgress() {
  const q = Math.min(questionCount, 10);
  $('drProgressText').textContent          = `Question ${q} / 10`;
  $('drProgressFill').style.width          = `${(q / 10) * 100}%`;
}

// ── Send ───────────────────────────────────────────────────────
$('drSend').addEventListener('click', handleSend);

$('drInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

function handleSend() {
  if (isWaiting || questionCount >= 10) return;
  const text = $('drInput').value.trim();
  if (!text) return;
  $('drInput').value = '';
  autoResize($('drInput'));
  questionCount++;
  updateProgress();
  callApi(text, true);
}

$('drInput').addEventListener('input', () => autoResize($('drInput')));

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ── API call ───────────────────────────────────────────────────
async function callApi(userText, showInUi) {
  if (showInUi) appendMessage('user', userText);

  conversationHistory.push({ role: 'user', content: userText });

  setInputEnabled(false);
  isWaiting = true;
  const loadingEl = appendLoading();

  try {
    const res = await fetch(DRILL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversationHistory,
        topic:    selectedTopic,
        level:    selectedLevel,
      }),
    });

    const data = await res.json();
    loadingEl.remove();

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const reply = data.content;
    conversationHistory.push({ role: 'assistant', content: reply });
    appendMessage('assistant', reply);

    if (questionCount >= 10) {
      // Drill complete — swap input bar for complete bar
      $('drInputBar').hidden    = true;
      $('drCompleteBar').hidden = false;
      return;
    }
  } catch (err) {
    loadingEl.remove();
    conversationHistory.pop();
    questionCount = Math.max(0, questionCount - 1);
    updateProgress();
    const msg = err.message && err.message !== '[object Object]'
      ? `Error: ${err.message}`
      : 'Could not reach the server. Please check your connection and try again.';
    appendMessage('error', msg);
    console.error('Drill API error:', err);
  }

  isWaiting = false;
  if (questionCount < 10) setInputEnabled(true);
}

// ── DOM helpers ────────────────────────────────────────────────
function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `gr-msg gr-msg--${role}`;
  el.innerHTML = role === 'assistant' ? formatMarkdown(text) : escHtml(text);
  $('drMessages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}

function appendLoading() {
  const el = document.createElement('div');
  el.className = 'gr-msg gr-msg--assistant gr-msg--loading';
  el.innerHTML = '<span class="gr-dots"><span></span><span></span><span></span></span>';
  $('drMessages').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}

function setInputEnabled(enabled) {
  $('drInput').disabled = !enabled;
  $('drSend').disabled  = !enabled;
  if (enabled) $('drInput').focus();
}

// ── Markdown formatter ─────────────────────────────────────────
function formatMarkdown(raw) {
  const blocks = raw.split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split('\n');
    const first = lines[0];

    if (/^[*\-] /.test(first)) {
      const items = lines
        .filter(l => /^[*\-] /.test(l))
        .map(l => `<li>${inlineFmt(l.replace(/^[*\-] /, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    if (/^\d+\. /.test(first)) {
      const items = lines
        .filter(l => /^\d+\. /.test(l))
        .map(l => `<li>${inlineFmt(l.replace(/^\d+\. /, ''))}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    if (/^> /.test(first)) {
      const content = lines.map(l => inlineFmt(l.replace(/^> ?/, ''))).join('<br>');
      return `<blockquote>${content}</blockquote>`;
    }

    const headingMatch = first.match(/^(#{1,3}) (.+)/);
    if (headingMatch) return `<p><strong>${inlineFmt(headingMatch[2])}</strong></p>`;

    if (/^---+$/.test(first.trim())) return '';

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
