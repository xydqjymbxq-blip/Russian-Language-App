/* ============================================================
   Russian Language App — Main JS
   Handles: PWA install prompt, service worker registration,
            streak calendar, and localStorage-based progress.
   ============================================================ */

// ── Service Worker ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ── PWA Install prompt ────────────────────────────────────────
let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.hidden = true;
    deferredPrompt = null;
  });
}

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.hidden = true;
  deferredPrompt = null;
});

// ── Progress / Streak data ────────────────────────────────────
const STORAGE_KEY = 'russian_app_progress';

function getProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : getDefaultProgress();
  } catch {
    return getDefaultProgress();
  }
}

function getDefaultProgress() {
  return {
    studiedDates: [],   // ISO date strings e.g. "2024-03-15"
    totalMinutes: 0,
    totalSessions: 0,
    bestStreak: 0
  };
}

function saveProgress(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Date helpers ──────────────────────────────────────────────
function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon ...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(mondayDate) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayDate);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function computeCurrentStreak(studiedDates) {
  if (!studiedDates.length) return 0;
  const sorted = [...new Set(studiedDates)].sort().reverse();
  const today = toISODate(new Date());
  const yesterday = toISODate(new Date(Date.now() - 864e5));

  // streak must include today or yesterday to be "live"
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (prev - curr) / 864e5;
    if (Math.round(diff) === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ── Render streak calendar ────────────────────────────────────
function renderStreakCalendar(progress) {
  const daysContainer = document.getElementById('streakDays');
  if (!daysContainer) return;

  const studied = new Set(progress.studiedDates);
  const today = toISODate(new Date());
  const monday = getMondayOfWeek(new Date());
  const days = getWeekDays(monday);

  daysContainer.innerHTML = days.map(d => {
    const iso = toISODate(d);
    const isStudied = studied.has(iso);
    const isToday = iso === today;
    const isFuture = iso > today;

    let cls = 'streak-day';
    if (isStudied) cls += ' streak-day--done';
    else if (isToday) cls += ' streak-day--today';
    else if (isFuture) cls += ' streak-day--future';

    const label = isStudied ? '✓' : (isToday ? '·' : '');
    return `<div class="${cls}" aria-label="${iso}${isStudied ? ' studied' : ''}">${label}</div>`;
  }).join('');
}

// ── Render stats ──────────────────────────────────────────────
function renderStats(progress) {
  const streak = computeCurrentStreak(progress.studiedDates);

  // Update best streak if needed
  if (streak > (progress.bestStreak || 0)) {
    progress.bestStreak = streak;
    saveProgress(progress);
  }

  const el = id => document.getElementById(id);

  if (el('streakCount')) el('streakCount').textContent = streak;

  // Sessions this week
  const monday = toISODate(getMondayOfWeek(new Date()));
  const sunday = toISODate(new Date(getMondayOfWeek(new Date()).getTime() + 6 * 864e5));
  const weekStudied = progress.studiedDates.filter(d => d >= monday && d <= sunday);
  if (el('statSessions')) el('statSessions').textContent = weekStudied.length;
  if (el('statMinutes')) el('statMinutes').textContent = progress.totalMinutes || 0;
  if (el('statBestStreak')) el('statBestStreak').textContent = progress.bestStreak || 0;

  // Update CTA
  const cta = document.querySelector('.dashboard-cta');
  if (cta) {
    const todayStudied = progress.studiedDates.includes(toISODate(new Date()));
    cta.textContent = todayStudied
      ? `Great work today! Come back tomorrow to keep your streak going.`
      : `Start a session today to keep your streak alive!`;
  }
}

// ── Demo: seed some data so the dashboard looks alive ─────────
function seedDemoDataIfEmpty(progress) {
  if (progress.studiedDates.length > 0) return progress;

  // Seed last 5 days including today
  const today = new Date();
  for (let i = 4; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    progress.studiedDates.push(toISODate(d));
  }
  progress.totalMinutes = 42;
  progress.totalSessions = 5;
  saveProgress(progress);
  return progress;
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  let progress = getProgress();
  progress = seedDemoDataIfEmpty(progress);

  renderStreakCalendar(progress);
  renderStats(progress);
});
