/* ============================================================
   Reading — passage generation, explain-on-select, Q&A check
   API: /.netlify/functions/reading
   ============================================================ */

'use strict';

const READING_API = '/.netlify/functions/reading';

const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────────
let selectedLevel    = 'C1';
let selectedTopic    = '';
let currentPassage   = '';
let currentQuestions = [];
let pendingSelection = '';
let pendingContext   = '';
let qsVisible        = false;
let checked          = false;

// ── Topics ─────────────────────────────────────────────────────
const READING_TOPICS = [
  // Existing topics
  'Climate change and international policy',
  'Artificial intelligence and the future of work',
  'Global migration and refugee crises',
  'Energy security in Europe',
  'Cybersecurity and digital sovereignty',
  'Urban development and housing shortages',
  'Public health and pandemic preparedness',
  'Press freedom and media censorship',
  'Space exploration and scientific ambition',
  'Economic inequality and social mobility',
  'Arctic development and geopolitics',
  'International trade disputes and sanctions',
  'Social media, algorithms, and democracy',
  'Nuclear energy and the climate debate',
  'Food security and agricultural technology',
  'Water scarcity and resource conflicts',
  'Cultural preservation in a globalised world',
  'Demographic change and ageing societies',
  'Sports diplomacy and national identity',
  'Disinformation and information warfare',
  // User-requested additions
  'Immigration policy and border control',
  'Social welfare systems and state support',
  'Healthcare access and medical reform',
  'Military service, conscription, and the draft',
  'Taxation policy and fiscal reform',
  // Additional topics
  'Judicial independence and the rule of law',
  'Housing affordability and homelessness',
  'Drug policy and legalisation debates',
  'Religious freedom and secularism in public life',
];

function renderTopics() {
  const shuffled = [...READING_TOPICS].sort(() => Math.random() - 0.5);
  const topics   = shuffled.slice(0, 3);
  const container = $('rdTopics');
  container.innerHTML = '';
  topics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className   = 'gr-topic-btn';
    btn.textContent = topic;
    btn.addEventListener('click', () => generate(topic));
    container.appendChild(btn);
  });
}

renderTopics();
$('rdShuffleBtn').addEventListener('click', renderTopics);

// ── Level selector ─────────────────────────────────────────────
document.querySelectorAll('.dr-level-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dr-level-btn').forEach(b => b.classList.remove('dr-level-btn--active'));
    btn.classList.add('dr-level-btn--active');
    selectedLevel = btn.dataset.level;
  });
});

// ── Screen management ──────────────────────────────────────────
function showScreen(id) {
  ['rdWelcome', 'rdLoading', 'rdReading'].forEach(s => {
    $(s).hidden = (s !== id);
  });
  $('rdNewBtn').hidden = (id === 'rdWelcome');
}

// ── Generate passage ───────────────────────────────────────────
async function generate(topic) {
  selectedTopic    = topic;
  currentPassage   = '';
  currentQuestions = [];
  qsVisible        = false;
  checked          = false;
  hideExplainBar();
  hideExplainPanel();
  showScreen('rdLoading');

  try {
    const res = await fetch(READING_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'generate', level: selectedLevel, topic }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const parsed = parsePassage(data.content);
    currentPassage   = parsed.passage;
    currentQuestions = parsed.questions;

    renderReading();
    showScreen('rdReading');
  } catch (err) {
    console.error('Reading generate error:', err);
    showScreen('rdWelcome');
    alert(`Could not generate passage: ${err.message}`);
  }
}

// ── Parse Claude's response ────────────────────────────────────
function parsePassage(raw) {
  const pMatch = raw.match(/---PASSAGE---\s*([\s\S]*?)\s*---QUESTIONS---/);
  const qMatch = raw.match(/---QUESTIONS---\s*([\s\S]*?)\s*---END---/);
  if (!pMatch || !qMatch) throw new Error('Unexpected response format — please try again.');

  const passage   = pMatch[1].trim();
  const questions = qMatch[1].trim()
    .split('\n')
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  if (questions.length === 0) throw new Error('No questions found in response.');
  return { passage, questions };
}

// ── Render reading screen ──────────────────────────────────────
function renderReading() {
  // Meta
  $('rdLevelBadge').textContent = selectedLevel;
  $('rdTopicLabel').textContent = selectedTopic;

  // Passage — split on double newlines → paragraphs
  const passageEl = $('rdPassage');
  passageEl.innerHTML = currentPassage
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(p => `<p>${escHtml(p.trim())}</p>`)
    .join('');

  // Questions — reset state
  $('rdQs').hidden        = true;
  $('rdQsList').innerHTML = '';
  $('rdCheckBtn').hidden  = false;
  $('rdQsToggleLabel').textContent = 'Show comprehension questions';
  $('rdQsToggle').classList.remove('rd-qs-toggle--open');

  currentQuestions.forEach((q, i) => {
    const li = document.createElement('li');
    li.className = 'rd-q-item';
    li.innerHTML = `
      <p class="rd-q-text">${escHtml(q)}</p>
      <textarea class="rd-q-input" rows="2" placeholder="Your answer…" aria-label="Answer to question ${i + 1}"></textarea>
      <div class="rd-q-feedback" hidden></div>`;
    $('rdQsList').appendChild(li);
  });
}

// ── Questions toggle ───────────────────────────────────────────
$('rdQsToggle').addEventListener('click', () => {
  qsVisible = !qsVisible;
  $('rdQs').hidden = !qsVisible;
  $('rdQsToggleLabel').textContent = qsVisible
    ? 'Hide comprehension questions'
    : 'Show comprehension questions';
  $('rdQsToggle').classList.toggle('rd-qs-toggle--open', qsVisible);
});

// ── Check answers ──────────────────────────────────────────────
$('rdCheckBtn').addEventListener('click', async () => {
  if (checked) return;

  const inputs  = document.querySelectorAll('.rd-q-input');
  const answers = [...inputs].map(t => t.value.trim());

  $('rdCheckBtn').disabled    = true;
  $('rdCheckBtn').textContent = 'Checking…';

  try {
    const res = await fetch(READING_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mode:      'check',
        passage:   currentPassage,
        questions: currentQuestions,
        answers,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const feedback = parseFeedback(data.content, currentQuestions.length);
    renderFeedback(feedback, inputs);
    checked = true;
    $('rdCheckBtn').hidden = true;

  } catch (err) {
    console.error('Check error:', err);
    $('rdCheckBtn').disabled    = false;
    $('rdCheckBtn').textContent = 'Check answers →';
    alert(`Could not check answers: ${err.message}`);
  }
});

// ── Parse feedback ─────────────────────────────────────────────
function parseFeedback(raw, count) {
  const results = [];
  for (let i = 1; i <= count; i++) {
    // Match "1. ✓ …" or "1) ✓ …" style
    const re = new RegExp(`${i}[.)\\s]+\\s*([✓~✗][^\\n]*)`, 'u');
    const m  = raw.match(re);
    if (m) {
      const mark    = m[1][0];                              // ✓ ~ ✗
      const comment = m[1].slice(1).trim().replace(/^[-–—]\s*/, '');
      results.push({ mark, comment });
    } else {
      // Fallback: just show the raw line for this number
      const fallbackRe = new RegExp(`${i}[.)\\s]+(.+)`, 'u');
      const fm = raw.match(fallbackRe);
      results.push({ mark: '·', comment: fm ? fm[1].trim() : '' });
    }
  }
  return results;
}

function renderFeedback(items, inputs) {
  items.forEach((item, i) => {
    const fbEl = inputs[i].closest('.rd-q-item').querySelector('.rd-q-feedback');
    const cls  = { '✓': 'rd-q-feedback--correct', '~': 'rd-q-feedback--partial', '✗': 'rd-q-feedback--wrong' }[item.mark] || '';
    fbEl.className = `rd-q-feedback ${cls}`;
    fbEl.innerHTML = `<span class="rd-q-mark">${item.mark}</span> ${escHtml(item.comment)}`;
    fbEl.hidden    = false;
    inputs[i].disabled = true;
  });
}

// ── New passage / reset ────────────────────────────────────────
function resetToWelcome() {
  showScreen('rdWelcome');
  hideExplainBar();
  hideExplainPanel();
  renderTopics();
}

$('rdNewBtn').addEventListener('click',   resetToWelcome);
$('rdRetryBtn').addEventListener('click', resetToWelcome);

// ── Text selection → explain bar ──────────────────────────────
const passageContainer = $('rdPassage');

document.addEventListener('selectionchange', () => {
  // Only trigger when reading screen is visible
  if ($('rdReading').hidden) return;

  const sel  = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text.length > 1 && sel.anchorNode && passageContainer.contains(sel.anchorNode)) {
    pendingSelection = text;
    pendingContext   = getSelectionContext(sel);
    showExplainBar(text);
  } else if ($('rdExplainPanel').getAttribute('aria-hidden') === 'true') {
    hideExplainBar();
  }
});

function getSelectionContext(sel) {
  try {
    const full  = passageContainer.textContent;
    const text  = sel.toString();
    const idx   = full.indexOf(text);
    if (idx === -1) return text;
    const start = Math.max(0, idx - 120);
    const end   = Math.min(full.length, idx + text.length + 120);
    return full.slice(start, end);
  } catch {
    return pendingSelection;
  }
}

function showExplainBar(text) {
  const preview = text.length > 38 ? text.slice(0, 38) + '…' : text;
  $('rdExplainPreview').textContent = `"${preview}"`;
  $('rdExplainBar').setAttribute('aria-hidden', 'false');
  $('rdExplainBar').classList.add('rd-explain-bar--visible');
}

function hideExplainBar() {
  $('rdExplainBar').setAttribute('aria-hidden', 'true');
  $('rdExplainBar').classList.remove('rd-explain-bar--visible');
}

$('rdExplainBarDismiss').addEventListener('click', () => {
  window.getSelection()?.removeAllRanges();
  hideExplainBar();
});

// ── Explain trigger ────────────────────────────────────────────
$('rdExplainTrigger').addEventListener('click', async () => {
  if (!pendingSelection) return;

  const word = pendingSelection;
  const ctx  = pendingContext;

  hideExplainBar();
  window.getSelection()?.removeAllRanges();

  // Show panel in loading state
  $('rdExplainWord').textContent  = word.length > 50 ? word.slice(0, 50) + '…' : word;
  $('rdExplainBody').innerHTML    = '<span class="gr-dots"><span></span><span></span><span></span></span>';
  $('rdExplainPanel').setAttribute('aria-hidden', 'false');
  $('rdExplainPanel').classList.add('rd-explain-panel--visible');

  try {
    const res = await fetch(READING_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'explain', selection: word, context: ctx }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    $('rdExplainBody').innerHTML = formatMarkdown(data.content);
  } catch (err) {
    $('rdExplainBody').innerHTML = `<p style="color:#e08888">Error: ${escHtml(err.message)}</p>`;
  }
});

// ── Explain panel close ────────────────────────────────────────
function hideExplainPanel() {
  $('rdExplainPanel').setAttribute('aria-hidden', 'true');
  $('rdExplainPanel').classList.remove('rd-explain-panel--visible');
}

$('rdExplainClose').addEventListener('click', hideExplainPanel);

// ── Markdown formatter (shared) ────────────────────────────────
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

    if (/^(#{1,3}) (.+)/.test(first)) {
      const m = first.match(/^#{1,3} (.+)/);
      return `<p><strong>${inlineFmt(m[1])}</strong></p>`;
    }

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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
