'use strict';

const NEWS_API = '/.netlify/functions/news-get';
const CACHE_PREFIX = 'nw_stories_';

const $ = id => document.getElementById(id);

// ── State ─────────────────────────────────────────────────────
let currentSpeakBtn = null;

// ── Cache helpers ─────────────────────────────────────────────
function todayKey() {
  return CACHE_PREFIX + new Date().toISOString().split('T')[0];
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToCache(stories) {
  try {
    localStorage.setItem(todayKey(), JSON.stringify(stories));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

// ── API call ──────────────────────────────────────────────────
async function fetchStories() {
  const res = await fetch(NEWS_API);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load stories');
  }
  const { stories } = await res.json();
  return stories;
}

// ── Rendering ─────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderVocabItem(v) {
  return `
    <li class="nw-vocab-item">
      <div class="nw-vocab-row">
        <span class="nw-vocab-word">${escapeHtml(v.word)}</span>
        <span class="nw-vocab-translation">${escapeHtml(v.translation)}</span>
      </div>
      <p class="nw-vocab-example">${escapeHtml(v.example)}</p>
    </li>`;
}

function renderCard(story, index) {
  const vocabItems = Array.isArray(story.vocab) ? story.vocab.map(renderVocabItem).join('') : '';
  return `
    <article class="nw-card" data-index="${index}">
      <div class="nw-card-header">
        <span class="nw-source">${escapeHtml(story.source || 'News')}</span>
        <button class="nw-speak-btn" aria-label="Read aloud in Russian" data-text="${escapeHtml(story.summary)}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </button>
      </div>
      <h2 class="nw-card-title">${escapeHtml(story.title)}</h2>
      <p class="nw-card-body">${escapeHtml(story.summary)}</p>
      ${vocabItems ? `
      <details class="nw-vocab">
        <summary class="nw-vocab-toggle">
          <span>Vocabulary</span>
          <svg class="nw-vocab-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </summary>
        <ul class="nw-vocab-list">${vocabItems}</ul>
      </details>` : ''}
    </article>`;
}

function renderFeed(stories) {
  const list = $('nwCardsList');
  const dateLabel = $('nwDateLabel');
  const storyCount = $('nwStoryCount');

  const now = new Date();
  dateLabel.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  storyCount.textContent = `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`;

  list.innerHTML = stories.map((s, i) => renderCard(s, i)).join('');

  // Attach speak button listeners
  list.querySelectorAll('.nw-speak-btn').forEach(btn => {
    btn.addEventListener('click', () => handleSpeak(btn));
  });
}

// ── Speech synthesis ──────────────────────────────────────────
function handleSpeak(btn) {
  const text = btn.dataset.text;

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    if (currentSpeakBtn === btn) {
      setSpeak(btn, false);
      currentSpeakBtn = null;
      return;
    }
  }

  if (currentSpeakBtn) {
    setSpeak(currentSpeakBtn, false);
  }

  setSpeak(btn, true);
  currentSpeakBtn = btn;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  utterance.rate = 0.9;

  // Try to use a Russian voice if available
  const trySpeak = () => {
    const voices = speechSynthesis.getVoices();
    const ruVoice = voices.find(v => v.lang.startsWith('ru'));
    if (ruVoice) utterance.voice = ruVoice;
    utterance.onend = () => {
      setSpeak(btn, false);
      currentSpeakBtn = null;
    };
    utterance.onerror = () => {
      setSpeak(btn, false);
      currentSpeakBtn = null;
    };
    speechSynthesis.speak(utterance);
  };

  // Voices may not be loaded yet on first call
  if (speechSynthesis.getVoices().length > 0) {
    trySpeak();
  } else {
    speechSynthesis.addEventListener('voiceschanged', trySpeak, { once: true });
    // Fallback if voiceschanged never fires
    setTimeout(trySpeak, 500);
  }
}

function setSpeak(btn, active) {
  btn.classList.toggle('nw-speak-btn--active', active);
  btn.setAttribute('aria-label', active ? 'Stop reading' : 'Read aloud in Russian');

  // Swap icon: speaker→stop when active
  btn.innerHTML = active
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <rect x="6" y="6" width="12" height="12" rx="1"/>
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
         <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
         <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
       </svg>`;
}

// ── UI state helpers ──────────────────────────────────────────
function showScreen(id) {
  ['nwLoading', 'nwError', 'nwCards'].forEach(s => {
    const el = $(s);
    if (el) el.hidden = (s !== id);
  });
}

function showError(msg) {
  const el = $('nwErrorText');
  if (el) el.textContent = msg || 'Failed to load stories. Check your connection and try again.';
  showScreen('nwError');
}

// ── Load flow ─────────────────────────────────────────────────
async function loadStories(bypassCache = false) {
  if (!bypassCache) {
    const cached = loadFromCache();
    if (cached) {
      renderFeed(cached);
      showScreen('nwCards');
      return;
    }
  }

  showScreen('nwLoading');
  setRefreshSpinning(true);

  try {
    const stories = await fetchStories();
    saveToCache(stories);
    renderFeed(stories);
    showScreen('nwCards');
  } catch (err) {
    showError(err.message);
  } finally {
    setRefreshSpinning(false);
  }
}

function setRefreshSpinning(spinning) {
  const btn = $('nwRefreshBtn');
  if (btn) btn.classList.toggle('nw-refresh-btn--spinning', spinning);
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStories();

  $('nwRefreshBtn').addEventListener('click', () => {
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    loadStories(true);
  });

  $('nwRetryBtn').addEventListener('click', () => {
    loadStories(true);
  });
});
