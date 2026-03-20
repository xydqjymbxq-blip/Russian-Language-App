'use strict';

// ── Config ─────────────────────────────────────────────────────
const DATA_URL      = 'data/flashcards.csv';
const TASK_API      = '/.netlify/functions/vocabulary-task';
const VC_KEY        = 'vocab_v1';
const QUIZ_SIZE     = 10;
const ACTIVATE_SIZE = 5;

// ── State ──────────────────────────────────────────────────────
let allCards  = [];
let vcData    = null;

let quizWords = [];
let quizIdx   = 0;
let quizScore = 0;

let actWords   = [];
let actIdx     = 0;
let actScore   = 0;
let actTask    = '';
let actRetryFn = null;

let browseIdx     = 0;
let browseFlipped = false;

let ruVoice    = null;
let lastMode   = 'quiz'; // track which mode finished for "Again →"

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Screens ────────────────────────────────────────────────────
function show(id) {
  ['vcWelcome','vcQuiz','vcActivate','vcSummary','vcBrowse'].forEach(s => $(s).hidden = s !== id);
}

// ── Persistence ────────────────────────────────────────────────
function load() {
  try { return JSON.parse(localStorage.getItem(VC_KEY)) || { practiced:{} }; }
  catch { return { practiced:{} }; }
}
function save() { localStorage.setItem(VC_KEY, JSON.stringify(vcData)); }
function today() { return new Date().toISOString().split('T')[0]; }

// ── CSV ────────────────────────────────────────────────────────
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

function pickWords(n) {
  const t = today();
  const fresh  = shuffle(allCards.filter(c => !vcData.practiced[c.id]));
  const review = shuffle(allCards.filter(c => vcData.practiced[c.id] && vcData.practiced[c.id] !== t));
  return [...fresh, ...review].slice(0, n);
}

// ── Stats ──────────────────────────────────────────────────────
function renderStats() {
  const total     = allCards.length;
  const practiced = Object.keys(vcData.practiced).length;
  const doneToday = Object.values(vcData.practiced).filter(d => d === today()).length;
  $('vcStats').innerHTML = `
    <div class="vc-stat"><span class="vc-stat-n">${practiced}</span><span class="vc-stat-l">practiced</span></div>
    <div class="vc-stat"><span class="vc-stat-n">${total - practiced}</span><span class="vc-stat-l">remaining</span></div>
    <div class="vc-stat"><span class="vc-stat-n">${doneToday}</span><span class="vc-stat-l">today</span></div>
  `;
}

// ── TTS ────────────────────────────────────────────────────────
function initVoice() {
  if (!('speechSynthesis' in window)) return;
  const find = () => { ruVoice = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru')) || null; };
  find();
  speechSynthesis.addEventListener('voiceschanged', find);
}

function speak(text) {
  if (!ruVoice || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = ruVoice; u.lang = 'ru-RU'; u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ── Quiz ───────────────────────────────────────────────────────
function startQuiz() {
  quizWords = pickWords(QUIZ_SIZE);
  if (!quizWords.length) { endSession('quiz', 0, 0); return; }
  quizIdx = 0; quizScore = 0;
  lastMode = 'quiz';
  show('vcQuiz');
  renderQuizCard();
}

function renderQuizCard() {
  const card = quizWords[quizIdx];
  const pos  = quizIdx + 1;
  const tot  = quizWords.length;
  $('vcFill').style.width         = `${((pos - 1) / tot) * 100}%`;
  $('vcProgressText').textContent  = `${pos} / ${tot}`;
  $('vcCardEn').textContent        = card.en;
  $('vcInput').value               = '';
  $('vcInputPhase').hidden         = false;
  $('vcResultPhase').hidden        = true;
  $('vcSelfAssess').hidden         = true;
  $('vcNextBtn').hidden            = true;
  $('vcSpeakBtn').onclick          = () => speak(card.ru);
  setTimeout(() => $('vcInput').focus(), 50);
}

function normalise(s) {
  return s.trim().toLowerCase().replace(/\s+/g,' ').replace(/[.,!?;:—–]/g,'');
}

function checkAnswer() {
  const card   = quizWords[quizIdx];
  const answer = $('vcInput').value.trim();

  $('vcInputPhase').hidden  = true;
  $('vcResultPhase').hidden = false;

  $('vcCardEn2').textContent    = card.en;
  $('vcAnswerRu').textContent   = card.ru;
  if (card.sentence) {
    $('vcAnswerSentence').textContent = card.sentence;
    $('vcAnswerSentence').hidden = false;
  } else {
    $('vcAnswerSentence').hidden = true;
  }

  if (!answer) {
    $('vcResultMsg').textContent = ''; $('vcResultMsg').className = 'vc-result-msg';
    $('vcSelfAssess').hidden = false;
  } else if (normalise(answer) === normalise(card.ru)) {
    $('vcResultMsg').textContent = '✓ Correct!'; $('vcResultMsg').className = 'vc-result-msg vc-result--correct';
    quizScore++;
    markPracticed(card);
    $('vcNextBtn').hidden = false;
  } else {
    $('vcResultMsg').textContent = `You wrote: ${answer}`; $('vcResultMsg').className = 'vc-result-msg vc-result--wrong';
    $('vcSelfAssess').hidden = false;
  }
  speak(card.ru);
}

function handleGotIt()  { quizScore++; markPracticed(quizWords[quizIdx]); $('vcSelfAssess').hidden = true; $('vcNextBtn').hidden = false; }
function handleMissed() { markPracticed(quizWords[quizIdx]);               $('vcSelfAssess').hidden = true; $('vcNextBtn').hidden = false; }

function nextQuizCard() {
  quizIdx++;
  if (quizIdx >= quizWords.length) endSession('quiz', quizScore, quizWords.length);
  else renderQuizCard();
}

// ── Activate ───────────────────────────────────────────────────
function startActivate() {
  actWords = pickWords(ACTIVATE_SIZE);
  if (!actWords.length) { endSession('activate', 0, 0); return; }
  actIdx = 0; actScore = 0;
  lastMode = 'activate';
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
  $('vcActLoading').hidden            = false;
  $('vcActTask').hidden               = true;
  $('vcActInputPhase').hidden         = true;
  $('vcActEvaluating').hidden         = true;
  $('vcActFeedback').hidden           = true;
  $('vcActError').hidden              = true;
  $('vcActInput').value               = '';
  actTask = '';
  fetchTask(card);
}

async function fetchTask(card) {
  actRetryFn = () => fetchTask(card);
  try {
    const res  = await fetch(TASK_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'generate', word: { en: card.en, ru: card.ru, sentence: card.sentence } }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    actTask = data.task;
    $('vcActTaskText').textContent = data.task;
    $('vcActHint').textContent     = data.hint || '';
    $('vcActHint').hidden          = !data.hint;
    $('vcActLoading').hidden       = true;
    $('vcActTask').hidden          = false;
    $('vcActInputPhase').hidden    = false;
    setTimeout(() => $('vcActInput').focus(), 50);
  } catch (err) { showActError(err.message); }
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'evaluate', word: { en: card.en, ru: card.ru }, task: actTask, response }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    $('vcActEvaluating').hidden = true;
    showActFeedback(data, card);
    markPracticed(card);
    actScore += data.score ?? 0;
  } catch (err) {
    $('vcActEvaluating').hidden  = true;
    $('vcActInputPhase').hidden  = false;
    showActError(err.message);
  }
}

function showActFeedback(data, card) {
  const score = data.score ?? 0;
  const badge = $('vcActBadge');
  if (score === 2)      { badge.textContent = '✓ Correct'; badge.className = 'vc-act-badge vc-act-badge--ok'; }
  else if (score === 1) { badge.textContent = '≈ Close';   badge.className = 'vc-act-badge vc-act-badge--partial'; }
  else                  { badge.textContent = '✗ Missed';  badge.className = 'vc-act-badge vc-act-badge--miss'; }
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
  $('vcActErrorMsg').textContent = msg || 'Something went wrong.';
  $('vcActError').hidden = false;
}

function skipActWord() { markPracticed(actWords[actIdx]); nextActWord(); }

function nextActWord() {
  actIdx++;
  if (actIdx >= actWords.length) endSession('activate', actScore, actWords.length * 2);
  else renderActCard();
}

// ── Shared session end ─────────────────────────────────────────
function markPracticed(card) {
  vcData.practiced[card.id] = today();
  save();
}

function endSession(mode, score, maxScore) {
  $('vcFill') && ($('vcFill').style.width = '100%');
  $('vcActFill') && ($('vcActFill').style.width = '100%');
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  $('vcScoreCircle').textContent = maxScore > 0 ? `${score}/${maxScore}` : '—';
  $('vcSummaryMsg').textContent = maxScore === 0
    ? 'No words available right now.'
    : pct >= 80 ? `${pct}% — excellent work!`
    : pct >= 50 ? `${pct}% — keep going!`
    : `${pct}% — these need more practice.`;
  renderStats();
  show('vcSummary');
}

// ── Browse ─────────────────────────────────────────────────────
function startBrowse() {
  browseIdx = 0; browseFlipped = false;
  renderBrowseCard();
  show('vcBrowse');
}

function renderBrowseCard() {
  const card = allCards[browseIdx];
  $('vcBrowseCounter').textContent = `${browseIdx + 1} / ${allCards.length}`;
  $('vcFlipEn').textContent = card.en;
  $('vcFlipRu').textContent = card.ru;
  if (card.sentence) { $('vcFlipSentence').textContent = card.sentence; $('vcFlipSentence').hidden = false; }
  else               { $('vcFlipSentence').hidden = true; }
  browseFlipped = false;
  $('vcFlipCard').classList.remove('vc-flipped');
  $('vcFlipSpeakBtn').onclick = e => { e.stopPropagation(); speak(card.ru); };
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  vcData = load();
  initVoice();
  try {
    const res  = await fetch(DATA_URL);
    const text = await res.text();
    allCards   = parseCSV(text);
  } catch { allCards = []; }
  renderStats();
  show('vcWelcome');

  // Welcome
  $('vcStartBtn').addEventListener('click', startQuiz);
  $('vcActivateBtn').addEventListener('click', startActivate);
  $('vcBrowseBtn').addEventListener('click', startBrowse);

  // Quiz
  $('vcQuizBack').addEventListener('click', () => { renderStats(); show('vcWelcome'); });
  $('vcCheckBtn').addEventListener('click', checkAnswer);
  $('vcSkipBtn').addEventListener('click',  () => { $('vcInput').value = ''; checkAnswer(); });
  $('vcInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkAnswer(); } });
  $('vcGotItBtn').addEventListener('click', handleGotIt);
  $('vcMissedBtn').addEventListener('click', handleMissed);
  $('vcNextBtn').addEventListener('click',   nextQuizCard);

  // Activate
  $('vcActBack').addEventListener('click', () => { renderStats(); show('vcWelcome'); });
  $('vcActSubmitBtn').addEventListener('click', submitActivate);
  $('vcActSkipBtn').addEventListener('click',   skipActWord);
  $('vcActNextBtn').addEventListener('click',   nextActWord);
  $('vcActRetryBtn').addEventListener('click',  () => { $('vcActError').hidden = true; actRetryFn?.(); });
  $('vcActSkipErrBtn').addEventListener('click',() => { $('vcActError').hidden = true; skipActWord(); });
  $('vcActInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitActivate(); } });

  // Summary — "Again" repeats whichever mode just ran
  $('vcAgainBtn').addEventListener('click', () => {
    renderStats();
    lastMode === 'activate' ? startActivate() : startQuiz();
  });

  // Browse
  $('vcBrowseBack').addEventListener('click', () => { renderStats(); show('vcWelcome'); });
  $('vcFlipCard').addEventListener('click', () => {
    browseFlipped = !browseFlipped;
    $('vcFlipCard').classList.toggle('vc-flipped', browseFlipped);
  });
  $('vcBrowsePrev').addEventListener('click', () => { if (browseIdx > 0) { browseIdx--; renderBrowseCard(); } });
  $('vcBrowseNext').addEventListener('click', () => { if (browseIdx < allCards.length - 1) { browseIdx++; renderBrowseCard(); } });
  document.addEventListener('keydown', e => {
    if ($('vcBrowse').hidden) return;
    if (e.key === 'ArrowLeft'  && browseIdx > 0)                   { browseIdx--; renderBrowseCard(); }
    if (e.key === 'ArrowRight' && browseIdx < allCards.length - 1) { browseIdx++; renderBrowseCard(); }
    if (e.key === ' ') { e.preventDefault(); $('vcFlipCard').click(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
