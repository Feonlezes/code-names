'use strict';

/**
 * @module audio/sound
 * Звук через WebAudio без аудиофайлов: короткие сигналы таймера и уведомлений.
 * Экспорт: ensureAudio, soundNotify, handleSound.
 */

let audioCtx = null;
// Последнее значение таймера, на которое уже играли звук — чтобы не дублировать
// звук в пределах одной секунды (см. handleSound).
let lastSoundTimer = null;

/**
 * Лениво создаёт/возобновляет AudioContext. Браузеры требуют пользовательского
 * жеста, поэтому вызывается по первому клику/нажатию.
 * @returns {void}
 */
export function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/**
 * Проигрывает короткий тон.
 * @param {number} freq - частота, Гц
 * @param {number} dur - длительность, сек
 * @param {number} vol - громкость 0..1
 * @param {string} [type] - тип осциллятора
 * @returns {void}
 */
function beep(freq, dur, vol, type) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  o.connect(g); g.connect(audioCtx.destination);
  const t = audioCtx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur);
}

/** Тревожный двойной сигнал (на отметках 30/20 сек). */
function soundAlarm() { beep(1046, 0.18, 0.16, 'square'); setTimeout(() => beep(1318, 0.18, 0.14, 'square'), 140); }
/** Мелкое тиканье (последние 10 секунд). */
function soundTick() { beep(760, 0.07, 0.10, 'triangle'); }
/** Звук уведомления (тосты). */
export function soundNotify() { beep(660, 0.12, 0.14, 'sine'); setTimeout(() => beep(990, 0.18, 0.14, 'sine'), 120); }

/**
 * Озвучивает ход времени по текущему состоянию: тиканье на 1..10 сек и сигнал
 * на 30/20 сек. Звук издаётся только при смене секунды.
 * @param {Object} state - последнее состояние от сервера
 * @returns {void}
 */
export function handleSound(state) {
  const inGame = state.phase === 'clue' || state.phase === 'guess';
  if (!inGame || state.paused) { lastSoundTimer = null; return; }
  const t = state.timer;
  if (t === lastSoundTimer) return; // звук только при смене секунды
  lastSoundTimer = t;
  if (t >= 1 && t <= 10) soundTick();
  else if (t > 10 && t <= 30 && t % 10 === 0) soundAlarm();
}
