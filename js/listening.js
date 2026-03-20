/* ============================================================
   Listening — script generation + Web Speech API playback
   API: /.netlify/functions/listening
   ============================================================ */

'use strict';

const LISTENING_API = '/.netlify/functions/listening';
const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────────
let selectedLevel    = 'C1';
let selectedTopic    = '';
let currentScript    = '';
let currentQuestions = [];

// Playback
let fullSegments  = [];   // script split into ~4-sentence segments (full mode)
let chunkSegments = [];   // script split into 2-sentence chunks (chunk mode)
let segIdx        = 0;    // current segment index (full mode)
let chunkIdx      = 0;    // current chunk index (chunk mode)
let playRate      = 1.0;
let isPlaying     = false;
let chunkMode     = false;
let russianVoice  = null;
let hasVoice      = false;

// Progress (full mode)
let totalDuration = 0;    // estimated seconds
let playStartTime = null; // Date.now() when current play began
let elapsedSecs   = 0;    // accumulated seconds before last pause
let timerID       = null;

// UI state
let qsVisible          = false;
let transcriptVisible  = false;
let checked            = false;

// ── Topics ─────────────────────────────────────────────────────
const TOPICS = [
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
];

function renderTopics() {
  const shuffled  = [...TOPICS].sort(() => Math.random() - 0.5);
  const container = $('lsTopics');
  container.innerHTML = '';
  shuffled.slice(0, 3).forEach(topic => {
    const btn = document.createElement('button');
    btn.className   = 'gr-topic-btn';
    btn.textContent = topic;
    btn.addEventListener('click', () => generate(topic));
    container.appendChild(btn);
  });
}

renderTopics();
$('lsShuffleBtn').addEventListener('click', renderTopics);

// ── Level selector ─────────────────────────────────────────────
document.querySelectorAll('.dr-level-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dr-level-btn').forEach(b => b.classList.remove('dr-level-btn--active'));
    btn.classList.add('dr-level-btn--active');
    selectedLevel = btn.dataset.level;
  });
});

// ── Voice init ─────────────────────────────────────────────────
function initVoice() {
  if (!window.speechSynthesis) return;

  function pick(voices) {
    russianVoice = voices.find(v => v.lang === 'ru-RU' && v.name.includes('Google'))
                || voices.find(v => v.lang === 'ru-RU')
                || voices.find(v => v.lang.startsWith('ru'))
                || null;
    hasVoice = !!russianVoice;
  }

  const v = speechSynthesis.getVoices();
  if (v.length) pick(v);
  // Voices may load async (Chrome pattern)
  speechSynthesis.addEventListener('voiceschanged', () => pick(speechSynthesis.getVoices()));
}

initVoice();

// ── Screen management ──────────────────────────────────────────
function showScreen(id) {
  ['lsWelcome', 'lsLoading', 'lsPlayer'].forEach(s => $(s).hidden = (s !== id));
  $('lsNewBtn').hidden = (id === 'lsWelcome');
  if (id !== 'lsPlayer') stopAll();
}

// ── Generate ───────────────────────────────────────────────────
async function generate(topic) {
  selectedTopic    = topic;
  currentScript    = '';
  currentQuestions = [];
  checked          = false;
  qsVisible        = false;
  transcriptVisible = false;
  showScreen('lsLoading');

  try {
    const res  = await fetch(LISTENING_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'generate', level: selectedLevel, topic }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const parsed     = parseResponse(data.content);
    currentScript    = parsed.script;
    currentQuestions = parsed.questions;

    // Split into segments
    const sentences  = splitSentences(currentScript);
    fullSegments     = groupSentences(sentences, 4);   // ~4 per segment for full mode
    chunkSegments    = groupSentences(sentences, 2);   // 2 per chunk for chunk mode

    // Estimate duration: ~130 words/min
    const wordCount  = currentScript.trim().split(/\s+/).length;
    totalDuration    = Math.round(wordCount / 130 * 60);

    renderPlayer();
    showScreen('lsPlayer');
  } catch (err) {
    console.error('Listening generate error:', err);
    showScreen('lsWelcome');
    alert(`Could not generate passage: ${err.message}`);
  }
}

function parseResponse(raw) {
  const sMatch = raw.match(/---SCRIPT---\s*([\s\S]*?)\s*---QUESTIONS---/);
  const qMatch = raw.match(/---QUESTIONS---\s*([\s\S]*?)\s*---END---/);
  if (!sMatch || !qMatch) throw new Error('Unexpected response format — please try again.');

  const script    = sMatch[1].trim();
  const questions = qMatch[1].trim()
    .split('\n')
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  return { script, questions };
}

function splitSentences(text) {
  return (text.match(/[^.!?…]+[.!?…]+\s*/g) || [text]).map(s => s.trim()).filter(Boolean);
}

function groupSentences(sentences, perGroup) {
  const groups = [];
  for (let i = 0; i < sentences.length; i += perGroup) {
    groups.push(sentences.slice(i, i + perGroup).join(' ').trim());
  }
  return groups;
}

// ── Render player ──────────────────────────────────────────────
function renderPlayer() {
  $('lsLevelBadge').textContent = selectedLevel;
  $('lsTopicLabel').textContent  = selectedTopic;

  // No-voice warning
  const noVoice = !window.speechSynthesis || !hasVoice;
  $('lsNoVoice').hidden = !noVoice;
  if (noVoice) showTranscript();

  // Transcript
  $('lsTranscript').innerHTML = currentScript
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(p => `<p>${escHtml(p.trim())}</p>`)
    .join('') || `<p>${escHtml(currentScript)}</p>`;

  $('lsTranscriptToggle').hidden = noVoice; // already visible if no voice
  $('lsTranscriptLabel').textContent = 'Show transcript';
  $('lsTranscriptToggle').classList.remove('ls-transcript-toggle--open');

  // Reset time display
  setProgress(0);
  updateTime(0, totalDuration);

  // Questions
  $('lsQs').hidden        = true;
  $('lsQsList').innerHTML = '';
  $('lsCheckBtn').hidden  = false;
  $('lsQsLabel').textContent = 'Show comprehension questions';
  $('lsQsToggle').classList.remove('rd-qs-toggle--open');

  currentQuestions.forEach((q, i) => {
    const li = document.createElement('li');
    li.className = 'rd-q-item';
    li.innerHTML = `
      <p class="rd-q-text">${escHtml(q)}</p>
      <textarea class="rd-q-input" rows="2" placeholder="Your answer…" aria-label="Answer ${i + 1}"></textarea>
      <div class="rd-q-feedback" hidden></div>`;
    $('lsQsList').appendChild(li);
  });

  // Reset mode to full
  setChunkMode(false);
  updateChunkUI();
  updatePlayBtn(false);
}

// ── Mode toggle ────────────────────────────────────────────────
$('lsModeFullBtn').addEventListener('click',  () => { stopAll(); setChunkMode(false); });
$('lsModeChunkBtn').addEventListener('click', () => { stopAll(); setChunkMode(true);  });

function setChunkMode(enabled) {
  chunkMode = enabled;
  chunkIdx  = 0;
  segIdx    = 0;

  $('lsModeFullBtn').classList.toggle('ls-mode-btn--active',  !enabled);
  $('lsModeChunkBtn').classList.toggle('ls-mode-btn--active', enabled);
  $('lsFullControls').hidden  = enabled;
  $('lsChunkControls').hidden = !enabled;

  if (enabled) updateChunkUI();
}

// ── Full mode playback ─────────────────────────────────────────
$('lsPlayBtn').addEventListener('click', toggleFullPlay);

function toggleFullPlay() {
  if (!hasVoice || !window.speechSynthesis) return;

  if (isPlaying) {
    pauseFull();
  } else {
    playFull();
  }
}

function playFull() {
  isPlaying = true;
  updatePlayBtn(true);

  if (speechSynthesis.paused) {
    // Resume paused utterance
    speechSynthesis.resume();
    playStartTime = Date.now();
    startTimer();
    return;
  }

  // Start (or restart) from segIdx
  playStartTime = Date.now();
  elapsedSecs   = (segIdx / fullSegments.length) * totalDuration;
  startTimer();
  playSegment(segIdx);
}

function pauseFull() {
  isPlaying = false;
  speechSynthesis.pause();
  elapsedSecs += (Date.now() - playStartTime) / 1000;
  stopTimer();
  updatePlayBtn(false);
}

function playSegment(idx) {
  if (idx >= fullSegments.length) {
    // Finished
    isPlaying = false;
    segIdx    = 0;
    elapsedSecs = 0;
    stopTimer();
    setProgress(1);
    updateTime(totalDuration, totalDuration);
    updatePlayBtn(false);
    return;
  }

  segIdx = idx;
  const utt = makeUtterance(fullSegments[idx]);

  utt.onend = () => {
    if (!isPlaying) return;
    playSegment(idx + 1);
  };

  utt.onerror = e => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    console.error('Speech error:', e.error);
    isPlaying = false;
    stopTimer();
    updatePlayBtn(false);
  };

  speechSynthesis.speak(utt);
}

// ── Chunk mode playback ────────────────────────────────────────
$('lsChunkPlayBtn').addEventListener('click', toggleChunkPlay);
$('lsPrevBtn').addEventListener('click', () => { stopAll(); chunkIdx = Math.max(0, chunkIdx - 1); updateChunkUI(); });
$('lsNextBtn').addEventListener('click', () => { stopAll(); chunkIdx = Math.min(chunkSegments.length - 1, chunkIdx + 1); updateChunkUI(); });

function toggleChunkPlay() {
  if (!hasVoice || !window.speechSynthesis) return;

  if (isPlaying) {
    stopAll();
  } else {
    playChunk(chunkIdx);
  }
}

function playChunk(idx) {
  chunkIdx  = idx;
  isPlaying = true;
  updateChunkUI();

  const utt = makeUtterance(chunkSegments[idx]);

  utt.onend = () => {
    isPlaying = false;
    updateChunkUI();
  };

  utt.onerror = e => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    isPlaying = false;
    updateChunkUI();
  };

  speechSynthesis.speak(utt);
}

function updateChunkUI() {
  const total = chunkSegments.length;
  $('lsChunkLabel').textContent = `Part ${chunkIdx + 1} / ${total}`;
  $('lsPrevBtn').disabled       = chunkIdx === 0;
  $('lsNextBtn').disabled       = chunkIdx === total - 1;

  const playIcon  = `<polygon points="5 3 19 12 5 21 5 3"/>`;
  const pauseIcon = `<line x1="6" y1="4" x2="6" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/>`;

  $('lsChunkPlayIcon').innerHTML = isPlaying ? pauseIcon : playIcon;
  $('lsChunkPlayLabel').textContent = isPlaying ? 'Pause' : 'Play';
}

// ── Speed control ──────────────────────────────────────────────
document.querySelectorAll('.ls-speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ls-speed-btn').forEach(b => b.classList.remove('ls-speed-btn--active'));
    btn.classList.add('ls-speed-btn--active');
    playRate = parseFloat(btn.dataset.rate);
    // If playing, restart current position at new rate
    if (isPlaying) {
      stopAll();
      if (!chunkMode) playFull();
      else playChunk(chunkIdx);
    }
  });
});

// ── Shared playback helpers ────────────────────────────────────
function makeUtterance(text) {
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'ru-RU';
  utt.rate   = playRate;
  if (russianVoice) utt.voice = russianVoice;
  return utt;
}

function stopAll() {
  isPlaying = false;
  speechSynthesis.cancel();
  stopTimer();
  updatePlayBtn(false);
  if (chunkMode) updateChunkUI();
}

// ── Progress bar + timer (full mode) ──────────────────────────
function startTimer() {
  stopTimer();
  timerID = setInterval(() => {
    const elapsed = elapsedSecs + (Date.now() - playStartTime) / 1000;
    const clamped = Math.min(elapsed, totalDuration);
    setProgress(clamped / totalDuration);
    updateTime(Math.round(clamped), totalDuration);
  }, 250);
}

function stopTimer() {
  clearInterval(timerID);
  timerID = null;
}

function setProgress(fraction) {
  $('lsProgressFill').style.width = `${Math.min(fraction * 100, 100)}%`;
}

function updateTime(elapsed, total) {
  $('lsTime').textContent = `${fmt(elapsed)} / ${fmt(total)}`;
}

function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updatePlayBtn(playing) {
  const playPath  = '<polygon points="5 3 19 12 5 21 5 3"/>';
  const pausePath = '<line x1="6" y1="4" x2="6" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/>';
  $('lsPlayIcon').innerHTML = playing ? pausePath : playPath;
  $('lsPlayIcon').setAttribute('fill', playing ? 'none' : 'currentColor');
  $('lsPlayIcon').setAttribute('stroke', playing ? 'currentColor' : 'none');
  $('lsPlayIcon').setAttribute('stroke-width', playing ? '2.5' : '0');
  $('lsPlayIcon').setAttribute('stroke-linecap', 'round');
}

// ── Transcript toggle ──────────────────────────────────────────
$('lsTranscriptToggle').addEventListener('click', () => {
  transcriptVisible = !transcriptVisible;
  $('lsTranscript').hidden = !transcriptVisible;
  $('lsTranscriptLabel').textContent = transcriptVisible ? 'Hide transcript' : 'Show transcript';
  $('lsTranscriptToggle').classList.toggle('ls-transcript-toggle--open', transcriptVisible);
});

function showTranscript() {
  transcriptVisible = true;
  $('lsTranscript').hidden = false;
}

// ── Questions toggle ───────────────────────────────────────────
$('lsQsToggle').addEventListener('click', () => {
  qsVisible = !qsVisible;
  $('lsQs').hidden = !qsVisible;
  $('lsQsLabel').textContent = qsVisible ? 'Hide comprehension questions' : 'Show comprehension questions';
  $('lsQsToggle').classList.toggle('rd-qs-toggle--open', qsVisible);
});

// ── Check answers ──────────────────────────────────────────────
$('lsCheckBtn').addEventListener('click', async () => {
  if (checked) return;

  const inputs  = document.querySelectorAll('.rd-q-input');
  const answers = [...inputs].map(t => t.value.trim());

  $('lsCheckBtn').disabled    = true;
  $('lsCheckBtn').textContent = 'Checking…';

  try {
    const res  = await fetch(LISTENING_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mode:      'check',
        script:    currentScript,
        questions: currentQuestions,
        answers,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    renderFeedback(parseFeedback(data.content, currentQuestions.length), inputs);
    checked = true;
    $('lsCheckBtn').hidden = true;

  } catch (err) {
    console.error('Check error:', err);
    $('lsCheckBtn').disabled    = false;
    $('lsCheckBtn').textContent = 'Check answers →';
    alert(`Could not check answers: ${err.message}`);
  }
});

function parseFeedback(raw, count) {
  const results = [];
  for (let i = 1; i <= count; i++) {
    const re = new RegExp(`${i}[.)\\s]+\\s*([✓~✗][^\\n]*)`, 'u');
    const m  = raw.match(re);
    if (m) {
      const mark    = m[1][0];
      const comment = m[1].slice(1).trim().replace(/^[-–—]\s*/, '');
      results.push({ mark, comment });
    } else {
      const fallback = raw.match(new RegExp(`${i}[.)\\s]+(.+)`, 'u'));
      results.push({ mark: '·', comment: fallback ? fallback[1].trim() : '' });
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

// ── Reset ──────────────────────────────────────────────────────
function resetToWelcome() {
  showScreen('lsWelcome');
  renderTopics();
}

$('lsNewBtn').addEventListener('click',   resetToWelcome);
$('lsRetryBtn').addEventListener('click', resetToWelcome);

// ── Utilities ──────────────────────────────────────────────────
function escHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
