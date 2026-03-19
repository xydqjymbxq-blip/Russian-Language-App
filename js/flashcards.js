/* ============================================================
   Russian Language App — Flashcard SRS Engine
   Algorithm : FSRS-5
   Data       : data/flashcards.csv  (english, russian, sentence)
   Storage    : localStorage key 'russian_srs_v1'
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const DATA_URL         = 'data/flashcards.csv';
const SRS_KEY          = 'russian_srs_v1';
const DIAGNOSTIC_COUNT = 100;   // cards sampled for placement test
const NEW_PER_DAY      = 20;    // new cards introduced per calendar day
const BLOCK_SIZE       = 20;    // cards per study block

// ── FSRS-5 parameters ─────────────────────────────────────────
// w[0-3]: initial stability for ratings Again/Hard/Good/Easy
// w[4-6]: difficulty initialisation and decay
// w[7-10]: stability-after-recall growth
// w[11-14]: stability-after-forgetting
// w[15]: hard penalty, w[16]: easy bonus
const FSRS_W = [
  0.40255, 1.18385, 3.173,   15.69105,
  7.1949,  0.5345,  1.4604,
  0.0046,  1.54575, 0.1192,  1.01925,
  1.9395,  0.11,    0.29605, 2.2700,
  0.15,    2.9898
];
const FSRS_DECAY  = -0.5;
const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1; // ≈ 0.2346
const TARGET_R    = 0.9;

// ── Module state ──────────────────────────────────────────────
let allCards          = [];   // [{id, en, ru, sentence}, ...]
let srs               = null; // persisted SRS data

// Diagnostic
let diagSample  = [];
let diagIndex   = 0;
let diagKnown   = 0;

// Session (persists across blocks)
let remainingQueue    = [];   // cards not yet started this session
let sessionStats      = { reviewed: 0, newShown: 0, again: 0 };

// Current block (study phase)
let blockQueue        = [];   // cards for current block (including re-queued)
let blockPos          = 0;
let blockStudied      = [];   // original card indices studied (for recall check)
let isFlipped         = false;

// Current block (recall-check phase)
let blockCheckQueue   = [];
let blockCheckPos     = 0;
let blockCheckRecalled = 0;

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

function today() {
  return new Date().toISOString().split('T')[0];
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
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
    cards: {},       // keyed by card index
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

// ── FSRS-5 algorithm ──────────────────────────────────────────
// rating: 1=Again  2=Hard  3=Good  4=Easy

function retrievability(t, S) {
  return Math.pow(1 + FSRS_FACTOR * t / S, FSRS_DECAY);
}

function initDifficulty(rating) {
  return Math.min(10, Math.max(1, FSRS_W[4] - (rating - 3) * FSRS_W[5]));
}

function nextDifficulty(D, rating) {
  const meanD0 = initDifficulty(3);
  return Math.min(10, Math.max(1,
    FSRS_W[6] * meanD0 + (1 - FSRS_W[6]) * (D - FSRS_W[7] * (rating - 3))
  ));
}

function nextInterval(S) {
  return Math.max(1, Math.round(
    S / FSRS_FACTOR * (Math.pow(TARGET_R, 1 / FSRS_DECAY) - 1)
  ));
}

function fsrs(prev, rating) {
  const t = today();

  if (!prev.seen) {
    // First encounter — initialise from rating
    const S = FSRS_W[rating - 1];
    const D = parseFloat(initDifficulty(rating).toFixed(3));
    if (rating === 1) {
      return { stability: parseFloat(S.toFixed(3)), difficulty: D,
               reps: 1, lapses: 0, due: offsetDate(1), seen: true, lastReview: t };
    }
    return { stability: parseFloat(S.toFixed(3)), difficulty: D,
             reps: 1, lapses: 0, due: offsetDate(nextInterval(S)), seen: true, lastReview: t };
  }

  // Existing card — may come from old SM-2 data; be tolerant
  const S       = prev.stability || prev.interval || 1;
  const D       = parseFloat(nextDifficulty(prev.difficulty || 5, rating).toFixed(3));
  const elapsed = prev.lastReview
    ? daysBetween(prev.lastReview, t)
    : (prev.interval || 1);
  const R = retrievability(Math.max(0, elapsed), S);

  if (rating === 1) {
    // Forgot — stability after failure
    const Snew = Math.max(0.1,
      FSRS_W[11] * Math.pow(D, -FSRS_W[12]) *
      (Math.pow(S + 1, FSRS_W[13]) - 1) *
      Math.exp(FSRS_W[14] * (1 - R))
    );
    return { stability: parseFloat(Snew.toFixed(3)), difficulty: D,
             reps: (prev.reps || 0) + 1, lapses: (prev.lapses || 0) + 1,
             due: offsetDate(1), seen: true, lastReview: t };
  }

  // Recalled — stability after recall
  const hardPenalty = rating === 2 ? FSRS_W[15] : 1;
  const easyBonus   = rating === 4 ? FSRS_W[16] : 1;
  const Snew = Math.max(S * 0.1,
    S * (
      Math.exp(FSRS_W[8]) *
      (11 - D) *
      Math.pow(S, -FSRS_W[9]) *
      (Math.exp(FSRS_W[10] * (1 - R)) - 1) *
      hardPenalty * easyBonus + 1
    )
  );
  return { stability: parseFloat(Snew.toFixed(3)), difficulty: D,
           reps: (prev.reps || 0) + 1, lapses: prev.lapses || 0,
           due: offsetDate(nextInterval(Snew)), seen: true, lastReview: t };
}

// ── CSV parser ────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase().trim());

  const find = (candidates) =>
    candidates.map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;

  const enCol  = find(['en', 'english', 'translation', 'meaning', 'definition']);
  const ruCol  = find(['ru', 'russian', 'word', 'term', 'russian_word']);
  const senCol = find(['sentence', 'example', 'context', 'phrase', 'example_sentence']);

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
  $('diagEnglish').textContent  = card.en;
  $('diagRussian').textContent  = card.ru;
  $('diagCurrent').textContent  = diagIndex + 1;
  $('diagProgressFill').style.width =
    ((diagIndex / diagSample.length) * 100) + '%';
  $('diagCard').classList.remove('flipped');
  $('diagBtns').hidden      = true;
  $('diagTapHint').hidden   = false;
  $('diagQueueHint').hidden = true;
}

function flipDiagCard() {
  if ($('diagCard').classList.contains('flipped')) return;
  $('diagCard').classList.add('flipped');
  $('diagBtns').hidden      = false;
  $('diagTapHint').hidden   = true;
  $('diagQueueHint').hidden = false;
}

function handleDiagAnswer(knows) {
  const idx = diagSample[diagIndex];
  if (knows) {
    diagKnown++;
    // Seed as known in FSRS format — Good rating, due today so it enters review promptly
    srs.cards[idx] = {
      stability:  FSRS_W[2],
      difficulty: parseFloat(initDifficulty(3).toFixed(3)),
      reps: 1, lapses: 0, due: today(), seen: true, lastReview: today()
    };
  }
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

  const btnStart     = $('btnStartSession');
  const caughtUpNote = $('allCaughtUp');

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

// ── Review session — block-based ──────────────────────────────
function startSession(queue) {
  remainingQueue = [...queue];
  sessionStats   = { reviewed: 0, newShown: 0, again: 0 };
  startNextBlock();
}

function startNextBlock() {
  const slice  = remainingQueue.splice(0, BLOCK_SIZE);
  blockQueue   = [...slice];
  blockPos     = 0;
  blockStudied = slice.map(item => item.idx);
  showScreen('screenReview');
  renderReviewCard();
}

function renderReviewCard() {
  if (blockPos >= blockQueue.length) {
    showBlockSummary();
    return;
  }

  const { idx } = blockQueue[blockPos];
  const card     = allCards[idx];
  const done     = blockPos;
  const total    = blockQueue.length;

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

function rateCard(rating) {
  const item = blockQueue[blockPos];
  const { idx, isNew, showCount } = item;

  // Apply FSRS
  const prev     = srs.cards[idx] || { seen: false };
  srs.cards[idx] = fsrs(prev, rating);

  if (isNew && showCount === 0) {
    sessionStats.newShown++;
    srs.newToday++;
  }

  if (rating === 1) {
    sessionStats.again++;
    // Re-queue once within the block so the user sees it again
    if (showCount < 1) {
      blockQueue.push({ idx, isNew: false, showCount: showCount + 1 });
    }
  } else {
    sessionStats.reviewed++;
  }

  saveSRS();
  blockPos++;
  renderReviewCard();
}

// ── Block summary & recall check ─────────────────────────────
function showBlockSummary() {
  const n = blockStudied.length;
  $('blockSummaryDesc').textContent =
    `You just studied ${n} card${n !== 1 ? 's' : ''}. ` +
    `Now let's see how many you can recall without hints.`;
  showScreen('screenBlockSummary');
}

function startBlockCheck() {
  // Deduplicate and shuffle the studied card indices
  const unique = [...new Set(blockStudied)];
  blockCheckQueue = [...unique];
  for (let i = blockCheckQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blockCheckQueue[i], blockCheckQueue[j]] = [blockCheckQueue[j], blockCheckQueue[i]];
  }
  blockCheckPos      = 0;
  blockCheckRecalled = 0;
  $('checkTotal').textContent = blockCheckQueue.length;
  renderCheckCard();
  showScreen('screenBlockCheck');
}

function renderCheckCard() {
  const idx  = blockCheckQueue[blockCheckPos];
  const card = allCards[idx];
  $('checkEnglish').textContent = card.en;
  $('checkRussian').textContent = card.ru;
  $('checkCurrent').textContent = blockCheckPos + 1;
  $('checkProgressFill').style.width =
    ((blockCheckPos / blockCheckQueue.length) * 100) + '%';
  $('checkCard').classList.remove('flipped');
  $('checkBtns').hidden    = true;
  $('checkTapHint').hidden = false;
}

function flipCheckCard() {
  if ($('checkCard').classList.contains('flipped')) return;
  $('checkCard').classList.add('flipped');
  $('checkBtns').hidden    = false;
  $('checkTapHint').hidden = true;
}

function handleCheckAnswer(recalled) {
  if (recalled) blockCheckRecalled++;
  blockCheckPos++;
  if (blockCheckPos >= blockCheckQueue.length) {
    showBlockResults();
  } else {
    renderCheckCard();
  }
}

function showBlockResults() {
  const total    = blockCheckQueue.length;
  const recalled = blockCheckRecalled;
  const pct      = total > 0 ? Math.round((recalled / total) * 100) : 0;

  $('blockResultsTitle').textContent = `${recalled} / ${total} recalled`;

  let icon, feedback;
  if (pct >= 80) {
    icon     = '✓';
    feedback = `${pct}% recall — excellent! Those words are sticking well.`;
  } else if (pct >= 50) {
    icon     = '◈';
    feedback = `${pct}% recall — solid progress. Keep reviewing and they'll solidify.`;
  } else {
    icon     = '↻';
    feedback = `${pct}% recall — these words need more practice. They'll reappear in your queue.`;
  }
  $('blockResultsIcon').textContent = icon;
  $('blockResultsDesc').textContent = feedback;

  const hasMore = remainingQueue.length > 0;
  $('btnNextBlock').hidden    = !hasMore;
  $('btnEndSession').textContent = hasMore ? 'End session' : 'Finish →';

  showScreen('screenBlockResults');
}

// ── Session complete ──────────────────────────────────────────
function showSessionComplete() {
  $('completedReviewed').textContent = sessionStats.reviewed;
  $('completedNew').textContent      = sessionStats.newShown;
  $('completedAgain').textContent    = sessionStats.again;

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

  // ── Diagnostic events ─────────────────────────────────────
  $('btnStartDiagnostic').addEventListener('click', startDiagnostic);
  $('btnDontKnow').addEventListener('click', () => handleDiagAnswer(false));
  $('btnKnow').addEventListener('click',    () => handleDiagAnswer(true));

  const diagCardEl = $('diagCard');
  diagCardEl.addEventListener('click', flipDiagCard);
  diagCardEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipDiagCard(); }
  });

  // ── Session events ────────────────────────────────────────
  $('btnStartReview').addEventListener('click', showSessionIntro);

  const cardEl = $('reviewCard');
  cardEl.addEventListener('click', flipCard);
  cardEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  document.querySelectorAll('.fc-rating-btn').forEach(btn => {
    btn.addEventListener('click', () => rateCard(parseInt(btn.dataset.q, 10)));
  });

  // ── Block check events ────────────────────────────────────
  $('btnStartCheck').addEventListener('click', startBlockCheck);

  const checkCardEl = $('checkCard');
  checkCardEl.addEventListener('click', flipCheckCard);
  checkCardEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCheckCard(); }
  });

  $('btnCheckDontKnow').addEventListener('click', () => handleCheckAnswer(false));
  $('btnCheckKnow').addEventListener('click',     () => handleCheckAnswer(true));

  // ── Block results events ──────────────────────────────────
  $('btnNextBlock').addEventListener('click', startNextBlock);
  $('btnEndSession').addEventListener('click', showSessionComplete);

  // ── Route to correct starting screen ─────────────────────
  if (!srs.diagnosticDone) {
    showScreen('screenDiagnosticIntro');
  } else {
    showSessionIntro();
  }
}

document.addEventListener('DOMContentLoaded', initFlashcards);
