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
 * Звук новой подсказки лидера: восходящее трезвучие — заметный «сигнал хода»,
 * чтобы команда услышала, что капитан отправил слово.
 * @returns {void}
 */
export function soundClue() {
  beep(523, 0.18, 0.42, 'sine');
  setTimeout(() => beep(659, 0.18, 0.42, 'sine'), 160);
  setTimeout(() => beep(784, 0.34, 0.42, 'sine'), 320);
}
/**
 * Короткий щелчок: клик по карте-слову (голос) и по «Пропустить ход».
 * @returns {void}
 */
export function soundClick() { beep(420, 0.05, 0.30, 'square'); }

// Звук клика по карте — из аудиофайла (см. public/assets/sounds/). Один
// предзагруженный элемент; на каждый клик клонируем его, чтобы быстрые клики
// проигрывались внахлёст, а не обрывали друг друга.
const CARD_CLICK_SRC = '/assets/sounds/card-click-sound.mp3';
let cardClickAudio = null;
try {
  cardClickAudio = new Audio(CARD_CLICK_SRC);
  cardClickAudio.preload = 'auto';
  cardClickAudio.volume = 0.7;
} catch (_) {}

/**
 * Проигрывает звук клика по карте из файла; при сбое (файл не загрузился или
 * воспроизведение отклонено) откатывается на синтезированный щелчок soundClick.
 * @returns {void}
 */
export function soundCardClick() {
  if (cardClickAudio) {
    try {
      const a = cardClickAudio.cloneNode();
      a.volume = cardClickAudio.volume;
      const p = a.play();
      if (p && p.catch) p.catch(() => soundClick());
      return;
    } catch (_) { /* падаем в фолбэк ниже */ }
  }
  soundClick();
}
/**
 * Звук выбора карты командой: карта открывается по единогласному голосованию —
 * короткое восходящее «дзынь».
 * @returns {void}
 */
export function soundReveal() {
  beep(587, 0.10, 0.30, 'triangle');
  setTimeout(() => beep(880, 0.16, 0.28, 'triangle'), 90);
}

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
