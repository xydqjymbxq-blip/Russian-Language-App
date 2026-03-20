'use strict';

// ── Config ─────────────────────────────────────────────────────
const DATA_URL      = 'data/flashcards.csv';
const TASK_API      = '/.netlify/functions/vocabulary-task';
const VC_KEY        = 'vocab_v1';
const QUIZ_SIZE     = 10;
const ACTIVATE_SIZE = 5;

// ── State ──────────────────────────────────────────────────────
let allCards  = [];          // [{id, en, ru, sentence}]
let vcData    = null;        // {practiced: {id: dateStr}, scores: {id: 0|1}}

let quizWords = [];          // current 10-word session
let quizIdx   = 0;
let quizScore = 0;           // correct this session

let browseIdx    = 0;
let browseFlipped = false;

// Activate mode state
let actWords   = [];   // words for this activate session
let actIdx     = 0;
let actScore   = 0;    // total points (0-2 per word)
let actTask    = '';   // current task text
let actRetryFn = null; // function to retry on error

let ruVoice   = null;

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Screens ────────────────────────────────────────────────────
function show(id) {
  ['vcWelcome','vcQuiz','vcSummary','vcBrowse','vcActivate'].forEach(s => $(s).hidden = s !== id);
}

// ── Persistence ────────────────────────────────────────────────
function load() {
  try { return JSON.parse(localStorage.getItem(VC_KEY)) || { practiced:{}, scores:{} }; }
  catch { return { practiced:{}, scores:{} }; }
}
function save() { localStorage.setItem(VC_KEY, JSON.stringify(vcData)); }
function today() { return new Date().toISOString().split('T')[0]; }

// ── CSV parser ─────────────────────────────────────────────────
function splitRow(line) {
  const out = []; let cell = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i+1] === '"') { cell += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdr = splitRow(lines[0]).map(h => h.toLowerCase().trim());
  const find = ks => ks.map(k => hdr.indexOf(k)).find(i => i >= 0) ?? -1;
  const ec = find(['en','english','translation','meaning']);
  const rc = find(['ru','russian','word','term']);
  const sc = find(['sentence','example','context','phrase']);
  const cards = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const en = (cols[ec >= 0 ? ec : 0] || '').trim();
    const ru = (cols[rc >= 0 ? rc : 1] || '').trim();
    if (!en && !ru) continue;
    cards.push({ id: i - 1, en, ru, sentence: sc >= 0 ? (cols[sc] || '').trim() : '' });
  }
  return cards;
}

// ── Word selection ─────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickWords() {
  const t = today();
  // Priority 1: never practiced
  const fresh = shuffle(allCards.filter(c => !vcData.practiced[c.id]));
  // Priority 2: practiced on a previous day (review candidates)
  const review = shuffle(allCards.filter(c => vcData.practiced[c.id] && vcData.practiced[c.id] !== t));
  return [...fresh, ...review].slice(0, QUIZ_SIZE);
}

// ── Stats ──────────────────────────────────────────────────────
function renderStats() {
  const total     = allCards.length;
  const practiced = Object.keys(vcData.practiced).length;
  const t         = today();
  const doneToday = Object.values(vcData.practiced).filter(d => d === t).length;
  $('vcStats').innerHTML = `
    <div class="vc-stat"><span class="vc-stat-n">${practiced}</span><span class="vc-stat-l">practiced</span></div>
    <div class="vc-stat"><span class="vc-stat-n">${total - practiced}</span><span class="vc-stat-l">remaining</span></div>
    <div class="vc-stat"><span class="vc-stat-n">${doneToday}</span><span class="vc-stat-l">today</span></div>
  `;
}

// ── Answer checking ────────────────────────────────────────────
function normalise(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:—–]/g, '');
}

function isCorrect(userAnswer, target) {
  return normalise(userAnswer) === normalise(target);
}

// ── TTS ────────────────────────────────────────────────────────
function initVoice() {
  if (!('speechSynthesis' in window)) return;
  const find = () => {
    const voices = speechSynthesis.getVoices();
    ruVoice = voices.find(v => v.lang.startsWith('ru')) || null;
  };
  find();
  speechSynthesis.addEventListener('voiceschanged', find);
}

function speak(text) {
  if (!ruVoice || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = ruVoice;
  u.lang  = 'ru-RU';
  u.rate  = 0.9;
  speechSynthesis.speak(u);
}

// ── Quiz ───────────────────────────────────────────────────────
function startQuiz() {
  quizWords = pickWords();
  if (quizWords.length === 0) {
    $('vcSummaryMsg').textContent = 'No words to practice. Come back tomorrow or reset progress.';
    $('vcScoreCircle').textContent = '—';
    show('vcSummary');
    return;
  }
  quizIdx   = 0;
  quizScore = 0;
  show('vcQuiz');
  renderQuizCard();
}

function renderQuizCard() {
  const card = quizWords[quizIdx];

  // Progress
  const pos = quizIdx + 1;
  const tot = quizWords.length;
  $('vcFill').style.width        = `${((pos - 1) / tot) * 100}%`;
  $('vcProgressText').textContent = `${pos} / ${tot}`;

  // Card content
  $('vcCardEn').textContent = card.en;

  // Show sentence as a contextual hint (in English if possible, else hide)
  // We intentionally don't show the Russian sentence — it gives away the answer
  $('vcCardHint').hidden = true;

  // Reset phases
  $('vcInput').value = '';
  $('vcInputPhase').hidden  = false;
  $('vcResultPhase').hidden = true;
  $('vcSelfAssess').hidden  = true;
  $('vcNextBtn').hidden     = true;

  // Update speak button target
  $('vcSpeakBtn').onclick = () => speak(card.ru);

  setTimeout(() => $('vcInput').focus(), 50);
}

function checkAnswer() {
  const card   = quizWords[quizIdx];
  const answer = $('vcInput').value.trim();

  $('vcInputPhase').hidden  = true;
  $('vcResultPhase').hidden = false;

  // Always reveal the answer
  $('vcAnswerRu').textContent = card.ru;
  if (card.sentence) {
    $('vcAnswerSentence').textContent = card.sentence;
    $('vcAnswerSentence').hidden = false;
  } else {
    $('vcAnswerSentence').hidden = true;
  }

  if (!answer) {
    // Skipped — show self-assess
    $('vcResultMsg').textContent = '';
    $('vcResultMsg').className   = 'vc-result-msg';
    showSelfAssess();
    return;
  }

  if (isCorrect(answer, card.ru)) {
    $('vcResultMsg').textContent = '✓ Correct!';
    $('vcResultMsg').className   = 'vc-result-msg vc-result--correct';
    quizScore++;
    markPracticed(card, true);
    $('vcNextBtn').hidden = false;
  } else {
    $('vcResultMsg').textContent = `You wrote: ${answer}`;
    $('vcResultMsg').className   = 'vc-result-msg vc-result--wrong';
    showSelfAssess();
  }

  // Auto-speak
  speak(card.ru);
}

function showSelfAssess() {
  $('vcSelfAssess').hidden = false;
  $('vcNextBtn').hidden    = true;
}

function markPracticed(card, correct) {
  vcData.practiced[card.id] = today();
  save();
}

function handleGotIt() {
  quizScore++;
  markPracticed(quizWords[quizIdx], true);
  $('vcSelfAssess').hidden = true;
  $('vcNextBtn').hidden    = false;
}

function handleMissed() {
  markPracticed(quizWords[quizIdx], false);
  $('vcSelfAssess').hidden = true;
  $('vcNextBtn').hidden    = false;
}

function nextCard() {
  quizIdx++;
  if (quizIdx >= quizWords.length) {
    endQuiz();
  } else {
    renderQuizCard();
  }
}

function endQuiz() {
  $('vcFill').style.width = '100%';
  const tot = quizWords.length;
  $('vcScoreCircle').textContent = `${quizScore}/${tot}`;
  const pct = Math.round((quizScore / tot) * 100);
  $('vcSummaryMsg').textContent = pct >= 80
    ? `Great session — ${pct}% correct!`
    : pct >= 50
    ? `${pct}% correct. Keep practising!`
    : `${pct}% correct — these words need more work.`;
  renderStats();
  show('vcSummary');
}

// ── Browse ─────────────────────────────────────────────────────
function startBrowse() {
  browseIdx     = 0;
  browseFlipped = false;
  renderBrowseCard();
  show('vcBrowse');
}

function renderBrowseCard() {
  const card = allCards[browseIdx];
  $('vcBrowseCounter').textContent = `${browseIdx + 1} / ${allCards.length}`;
  $('vcFlipEn').textContent = card.en;
  $('vcFlipRu').textContent = card.ru;
  if (card.sentence) {
    $('vcFlipSentence').textContent = card.sentence;
    $('vcFlipSentence').hidden = false;
  } else {
    $('vcFlipSentence').hidden = true;
  }
  // Reset flip
  browseFlipped = false;
  $('vcFlipCard').classList.remove('vc-flipped');
  $('vcFlipSpeakBtn').onclick = (e) => { e.stopPropagation(); speak(card.ru); };
}

// ── Activate mode ──────────────────────────────────────────────
function startActivate() {
  // Pick from the same pool as quiz (new words first)
  const t = today();
  const fresh  = shuffle(allCards.filter(c => !vcData.practiced[c.id]));
  const review = shuffle(allCards.filter(c => vcData.practiced[c.id] && vcData.practiced[c.id] !== t));
  actWords = [...fresh, ...review].slice(0, ACTIVATE_SIZE);
  if (actWords.length === 0) {
    $('vcSummaryMsg').textContent = 'No words to activate. Come back tomorrow!';
    $('vcScoreCircle').textContent = '—';
    show('vcSummary');
    return;
  }
  actIdx   = 0;
  actScore = 0;
  show('vcActivate');
  renderActCard();
}

function renderActCard() {
  const card = actWords[actIdx];
  const pos  = actIdx + 1;
  const tot  = actWords.length;

  $('vcActFill').style.width         = `${((pos - 1) / tot) * 100}%`;
  $('vcActProgressText').textContent  = `${pos} / ${tot}`;
  $('vcActWordEn').textContent        = card.en;
  $('vcActWordRu').textContent        = card.ru;

  // Reset UI
  $('vcActLoading').hidden     = false;
  $('vcActTask').hidden        = true;
  $('vcActInputPhase').hidden  = true;
  $('vcActEvaluating').hidden  = true;
  $('vcActFeedback').hidden    = true;
  $('vcActError').hidden       = true;
  $('vcActInput').value        = '';

  actTask = '';
  fetchTask(card);
}

async function fetchTask(card) {
  actRetryFn = () => fetchTask(card);
  try {
    const res  = await fetch(TASK_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'generate', word: { en: card.en, ru: card.ru, sentence: card.sentence } }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    actTask = data.task;
    $('vcActTaskText').textContent  = data.task;
    $('vcActHint').textContent      = data.hint || '';
    $('vcActHint').hidden           = !data.hint;

    $('vcActLoading').hidden    = true;
    $('vcActTask').hidden       = false;
    $('vcActInputPhase').hidden = false;
    setTimeout(() => $('vcActInput').focus(), 50);

  } catch (err) {
    showActError(err.message);
  }
}

async function submitActivate() {
  const card     = actWords[actIdx];
  const response = $('vcActInput').value.trim();

  if (!response) { skipActWord(); return; }

  $('vcActInputPhase').hidden  = true;
  $('vcActEvaluating').hidden  = false;
  actRetryFn = () => submitActivate();

  try {
    const res  = await fetch(TASK_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mode:     'evaluate',
        word:     { en: card.en, ru: card.ru },
        task:     actTask,
        response,
      }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    $('vcActEvaluating').hidden = true;
    showActFeedback(data, card);

    // Mark practiced + accumulate score
    markPracticed(card, data.score >= 1);
    actScore += data.score;

  } catch (err) {
    $('vcActEvaluating').hidden = true;
    $('vcActInputPhase').hidden = false;
    showActError(err.message);
  }
}

function skipActWord() {
  markPracticed(actWords[actIdx], false);
  nextActWord();
}

function showActFeedback(data, card) {
  const score = data.score ?? 0;

  // Badge
  const badge = $('vcActBadge');
  if (score === 2) { badge.textContent = '✓ Correct'; badge.className = 'vc-act-badge vc-act-badge--ok'; }
  else if (score === 1) { badge.textContent = '≈ Close'; badge.className = 'vc-act-badge vc-act-badge--partial'; }
  else { badge.textContent = '✗ Missed'; badge.className = 'vc-act-badge vc-act-badge--miss'; }

  $('vcActFeedbackText').textContent = data.feedback || '';

  if (data.correction) {
    $('vcActCorrectionText').textContent = data.correction;
    $('vcActCorrectionWrap').hidden = false;
  } else {
    $('vcActCorrectionWrap').hidden = true;
  }

  $('vcActSpeakBtn').onclick = () => speak(card.ru);
  $('vcActFeedback').hidden  = false;
}

function showActError(msg) {
  $('vcActLoading').hidden    = true;
  $('vcActEvaluating').hidden = true;
  $('vcActErrorMsg').textContent = msg || 'Something went wrong. Check your connection.';
  $('vcActError').hidden = false;
}

function nextActWord() {
  actIdx++;
  if (actIdx >= actWords.length) {
    endActivate();
  } else {
    renderActCard();
  }
}

function endActivate() {
  $('vcActFill').style.width = '100%';
  const maxScore = actWords.length * 2;
  const pct      = maxScore > 0 ? Math.round((actScore / maxScore) * 100) : 0;
  $('vcScoreCircle').textContent = `${actScore}/${maxScore}`;
  $('vcSummaryMsg').textContent  = pct >= 80
    ? `Excellent activation — ${pct}%!`
    : pct >= 50
    ? `${pct}% — good effort, keep writing!`
    : `${pct}% — these words need more active practice.`;
  renderStats();
  show('vcSummary');
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  vcData = load();
  initVoice();

  try {
    const res  = await fetch(DATA_URL);
    const text = await res.text();
    allCards   = parseCSV(text);
  } catch {
    allCards = [];
  }

  renderStats();
  show('vcWelcome');

  // Welcome
  $('vcStartBtn').addEventListener('click', startQuiz);
  $('vcActivateBtn').addEventListener('click', startActivate);
  $('vcBrowseBtn').addEventListener('click', startBrowse);

  // Quiz input
  $('vcCheckBtn').addEventListener('click', checkAnswer);
  $('vcSkipBtn').addEventListener('click', () => {
    $('vcInput').value = '';
    checkAnswer();
  });
  $('vcInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkAnswer(); }
  });

  // Quiz result
  $('vcGotItBtn').addEventListener('click', handleGotIt);
  $('vcMissedBtn').addEventListener('click', handleMissed);
  $('vcNextBtn').addEventListener('click', nextCard);

  // Summary
  $('vcAgainBtn').addEventListener('click', () => { renderStats(); startQuiz(); });
  $('vcActivateAgainBtn').addEventListener('click', () => { renderStats(); startActivate(); });
  $('vcBrowseBtn2').addEventListener('click', startBrowse);

  // Browse
  $('vcBrowseBack').addEventListener('click', () => { renderStats(); show('vcWelcome'); });
  $('vcFlipCard').addEventListener('click', () => {
    browseFlipped = !browseFlipped;
    $('vcFlipCard').classList.toggle('vc-flipped', browseFlipped);
  });
  $('vcBrowsePrev').addEventListener('click', () => {
    if (browseIdx > 0) { browseIdx--; renderBrowseCard(); }
  });
  $('vcBrowseNext').addEventListener('click', () => {
    if (browseIdx < allCards.length - 1) { browseIdx++; renderBrowseCard(); }
  });

  // Activate
  $('vcActSubmitBtn').addEventListener('click', submitActivate);
  $('vcActSkipBtn').addEventListener('click', skipActWord);
  $('vcActNextBtn').addEventListener('click', nextActWord);
  $('vcActRetryBtn').addEventListener('click', () => {
    $('vcActError').hidden = true;
    if (actRetryFn) actRetryFn();
  });
  $('vcActSkipErrBtn').addEventListener('click', () => {
    $('vcActError').hidden = true;
    skipActWord();
  });
  $('vcActInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitActivate(); }
  });

  // Browse keyboard nav
  document.addEventListener('keydown', e => {
    if ($('vcBrowse').hidden) return;
    if (e.key === 'ArrowLeft'  && browseIdx > 0)                   { browseIdx--; renderBrowseCard(); }
    if (e.key === 'ArrowRight' && browseIdx < allCards.length - 1) { browseIdx++; renderBrowseCard(); }
    if (e.key === ' ') { e.preventDefault(); $('vcFlipCard').click(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
