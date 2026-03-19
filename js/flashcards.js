/* ============================================================
   Russian Language App — Flashcard SRS Engine
   Algorithm : SM-2
   Data       : data/flashcards.csv  (english, russian, sentence)
   Storage    : localStorage key 'russian_srs_v1'
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const DATA_URL         = 'data/flashcards.csv';
const SRS_KEY          = 'russian_srs_v1';
const DIAGNOSTIC_COUNT = 100;   // cards sampled for placement test
const NEW_PER_DAY      = 20;    // new cards introduced per calendar day

// ── Module state ──────────────────────────────────────────────
let allCards     = [];   // [{id, en, ru, sentence}, ...]
let srs          = null; // persisted SRS data
let diagSample   = [];   // array of card indices for diagnostic
let diagIndex    = 0;
let diagKnown    = 0;
let sessionQueue = [];   // [{idx, isNew, showCount}, ...]
let sessionPos   = 0;
let isFlipped    = false;
let sessionStats = { reviewed: 0, newShown: 0, again: 0 };

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

function today() {
  return new Date().toISOString().split('T')[0];
}

function showScreen(id) {
  document.querySelectorAll('.fc-screen').forEach(s => {
    s.classList.toggle('fc-screen--active', s.id === id);
  });
}

// ── SRS persistence ───────────────────────────────────────────
function loadSRS() {
  try {
    const raw = localStorage.getItem(SRS_KEY);
    return raw ? JSON.parse(raw) : defaultSRS();
  } catch {
    return defaultSRS();
  }
}

function defaultSRS() {
  return {
    diagnosticDone: false,
    cards: {},       // keyed by card id (number as string)
    newToday: 0,
    newDate: today()
  };
}

function saveSRS() {
  localStorage.setItem(SRS_KEY, JSON.stringify(srs));
}

function refreshNewCount() {
  const t = today();
  if (srs.newDate !== t) {
    srs.newToday = 0;
    srs.newDate  = t;
  }
}

// ── SM-2 algorithm ────────────────────────────────────────────
// quality: 1 = Again  |  4 = Good  |  5 = Easy
function sm2(prev, quality) {
  let { interval = 1, reps = 0, ef = 2.5, lapses = 0 } = prev;

  if (quality >= 3) {
    if      (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else                 interval = Math.round(interval * ef);
    reps += 1;
  } else {
    lapses  += 1;
    interval = 1;
    reps     = 0;
  }

  ef = ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  if (ef < 1.3) ef = 1.3;

  const due = new Date();
  due.setDate(due.getDate() + interval);

  return {
    interval,
    reps,
    ef:     parseFloat(ef.toFixed(3)),
    due:    due.toISOString().split('T')[0],
    lapses,
    seen:   true
  };
}

// ── CSV parser ────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase().trim());

  // Flexible column detection
  const find = (candidates) =>
    candidates.map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;

  const enCol  = find(['en', 'english', 'translation', 'meaning', 'definition']);
  const ruCol  = find(['ru', 'russian', 'word', 'term', 'russian_word']);
  const senCol = find(['sentence', 'example', 'context', 'phrase', 'example_sentence']);

  // Fallback: use first two columns if named columns not found
  const col0 = enCol  >= 0 ? enCol  : 0;
  const col1 = ruCol  >= 0 ? ruCol  : 1;

  const cards = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]);
    const en = (cols[col0] || '').trim();
    const ru = (cols[col1] || '').trim();
    if (!en && !ru) continue;
    cards.push({
      id:       i - 1,
      en,
      ru,
      sentence: senCol >= 0 ? (cols[senCol] || '').trim() : ''
    });
  }
  return cards;
}

function splitCSVRow(line) {
  const result = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped double-quotes ("")
      if (inQuotes && line[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  result.push(cell);
  return result;
}

// ── Diagnostic ────────────────────────────────────────────────
function buildDiagnosticSample() {
  const n    = Math.min(DIAGNOSTIC_COUNT, allCards.length);
  const step = Math.max(1, Math.floor(allCards.length / n));
  const sample = [];
  for (let i = 0; i < allCards.length && sample.length < n; i += step) {
    sample.push(i);
  }
  // Fisher-Yates shuffle
  for (let i = sample.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sample[i], sample[j]] = [sample[j], sample[i]];
  }
  return sample;
}

function startDiagnostic() {
  diagSample = buildDiagnosticSample();
  diagIndex  = 0;
  diagKnown  = 0;
  $('diagTotal').textContent = diagSample.length;
  renderDiagCard();
  showScreen('screenDiagnostic');
}

function renderDiagCard() {
  const card = allCards[diagSample[diagIndex]];
  $('diagRussian').textContent  = card.ru;
  $('diagCurrent').textContent  = diagIndex + 1;
  $('diagProgressFill').style.width =
    ((diagIndex / diagSample.length) * 100) + '%';
}

function handleDiagAnswer(knows) {
  const idx = diagSample[diagIndex];
  if (knows) {
    diagKnown++;
    // Seed known cards: already "seen once", due today so they enter review promptly
    srs.cards[idx] = { interval: 3, reps: 1, ef: 2.5, due: today(), lapses: 0, seen: true };
  }
  // Unknown cards are left absent from srs.cards → treated as new

  diagIndex++;
  if (diagIndex >= diagSample.length) {
    finishDiagnostic();
  } else {
    renderDiagCard();
  }
}

function finishDiagnostic() {
  srs.diagnosticDone = true;
  saveSRS();

  const known   = diagKnown;
  const total   = diagSample.length;
  const unknown = total - known;
  $('diagSummary').textContent =
    `You recognised ${known} of ${total} sampled words. ` +
    `${unknown} unknown word${unknown !== 1 ? 's' : ''} will appear first in your review queue. ` +
    `Words you knew are seeded into spaced review.`;

  showScreen('screenDiagnosticComplete');
}

// ── Session builder ───────────────────────────────────────────
function buildSessionQueue() {
  refreshNewCount();
  const t = today();

  const due      = [];
  const newCards = [];

  for (let i = 0; i < allCards.length; i++) {
    const state = srs.cards[i];
    if (state && state.seen) {
      if (state.due <= t) due.push(i);
    } else {
      newCards.push(i);
    }
  }

  // Shuffle due cards
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }

  // Cap new cards by daily allowance
  const newSlots = Math.max(0, NEW_PER_DAY - srs.newToday);
  const newBatch = newCards.slice(0, newSlots);

  const queue = [
    ...due.map(i    => ({ idx: i, isNew: false, showCount: 0 })),
    ...newBatch.map(i => ({ idx: i, isNew: true,  showCount: 0 }))
  ];

  return { queue, dueCount: due.length, newCount: newBatch.length };
}

function showSessionIntro() {
  const { queue, dueCount, newCount } = buildSessionQueue();

  $('statDue').textContent = dueCount;
  $('statNew').textContent = newCount;

  const btnStart      = $('btnStartSession');
  const caughtUpNote  = $('allCaughtUp');

  if (queue.length === 0) {
    btnStart.hidden     = true;
    caughtUpNote.hidden = false;
  } else {
    btnStart.hidden     = false;
    caughtUpNote.hidden = true;
    btnStart.onclick    = () => startSession(queue);
  }

  showScreen('screenSessionIntro');
}

// ── Review session ────────────────────────────────────────────
function startSession(queue) {
  sessionQueue = queue;
  sessionPos   = 0;
  sessionStats = { reviewed: 0, newShown: 0, again: 0 };
  renderReviewCard();
  showScreen('screenReview');
}

function renderReviewCard() {
  if (sessionPos >= sessionQueue.length) {
    showSessionComplete();
    return;
  }

  const { idx } = sessionQueue[sessionPos];
  const card     = allCards[idx];
  const total    = sessionQueue.length;
  const done     = sessionPos;

  isFlipped = false;
  $('reviewCard').classList.remove('flipped');
  $('reviewEnglish').textContent  = card.en;
  $('reviewRussian').textContent  = card.ru;
  $('reviewSentence').textContent = card.sentence || '';
  $('tapHint').hidden             = false;
  $('ratingBtns').hidden          = true;
  $('reviewCurrent').textContent  = done + 1;
  $('reviewTotal').textContent    = total;
  $('reviewProgressFill').style.width = ((done / total) * 100) + '%';
}

function flipCard() {
  if (isFlipped) return;
  isFlipped = true;
  $('reviewCard').classList.add('flipped');
  $('tapHint').hidden    = true;
  $('ratingBtns').hidden = false;
}

function rateCard(quality) {
  const item = sessionQueue[sessionPos];
  const { idx, isNew, showCount } = item;

  // Apply SM-2
  const prev    = srs.cards[idx] || { interval: 1, reps: 0, ef: 2.5, lapses: 0, seen: false };
  srs.cards[idx] = sm2(prev, quality);

  // Count new cards introduced
  if (isNew && showCount === 0) {
    sessionStats.newShown++;
    srs.newToday++;
  }

  if (quality < 3) {
    sessionStats.again++;
    // Re-queue once at end of session so user sees it again today
    if (showCount < 1) {
      sessionQueue.push({ idx, isNew: false, showCount: showCount + 1 });
    }
  } else {
    sessionStats.reviewed++;
  }

  saveSRS();
  sessionPos++;
  renderReviewCard();
}

function showSessionComplete() {
  $('completedReviewed').textContent = sessionStats.reviewed;
  $('completedNew').textContent      = sessionStats.newShown;
  $('completedAgain').textContent    = sessionStats.again;
  $('reviewProgressFill').style.width = '100%';

  // Mark today as studied in the main progress store
  try {
    const KEY  = 'russian_app_progress';
    const raw  = localStorage.getItem(KEY);
    const prog = raw ? JSON.parse(raw) : { studiedDates: [], totalMinutes: 0, totalSessions: 0 };
    const t    = today();
    if (!prog.studiedDates.includes(t)) prog.studiedDates.push(t);
    prog.totalSessions = (prog.totalSessions || 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(prog));
  } catch { /* non-fatal */ }

  showScreen('screenSessionComplete');
}

// ── Error screen ──────────────────────────────────────────────
function showError(message) {
  const main = document.querySelector('.fc-main');
  main.innerHTML = `
    <div class="fc-intro" style="padding-top:60px">
      <i class="fc-intro-icon">⚠</i>
      <h1 class="fc-intro-title">Data not found</h1>
      <p class="fc-intro-desc">${message}</p>
      <a href="index.html" class="fc-btn fc-btn--ghost" style="margin-top:8px">← Back to home</a>
    </div>`;
}

// ── Init ──────────────────────────────────────────────────────
async function initFlashcards() {
  showScreen('screenLoading');
  srs = loadSRS();

  // Load CSV
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    allCards = parseCSV(text);
    if (allCards.length === 0) throw new Error('No cards could be parsed from the CSV.');
  } catch (err) {
    console.error('Flashcard load error:', err);
    showError(
      `Could not load <code>data/flashcards.csv</code>. ` +
      `Place your CSV file in the <code>data/</code> folder with columns: ` +
      `<code>english, russian, sentence</code> and redeploy.`
    );
    return;
  }

  // Wire up events
  $('btnStartDiagnostic').addEventListener('click', startDiagnostic);
  $('btnDontKnow').addEventListener('click', () => handleDiagAnswer(false));
  $('btnKnow').addEventListener('click',    () => handleDiagAnswer(true));
  $('btnStartReview').addEventListener('click', showSessionIntro);

  const cardEl = $('reviewCard');
  cardEl.addEventListener('click', flipCard);
  cardEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  document.querySelectorAll('.fc-rating-btn').forEach(btn => {
    btn.addEventListener('click', () => rateCard(parseInt(btn.dataset.q, 10)));
  });

  // Route to the correct starting screen
  if (!srs.diagnosticDone) {
    showScreen('screenDiagnosticIntro');
  } else {
    showSessionIntro();
  }
}

document.addEventListener('DOMContentLoaded', initFlashcards);
