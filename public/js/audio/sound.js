'use strict';

/**
 * @module audio/sound
 * Звук через WebAudio без аудиофайлов: короткие сигналы таймера и уведомлений.
 * Экспорт: ensureAudio, soundNotify, handleSound.
 */

import { asset } from '../util/basePath.js';

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
  // Контекст появился — можно декодировать звук клика (если байты уже пришли).
  decodeCardClick();
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

// Звук клика по карте — из аудиофайла (см. public/assets/sounds/). Байты
// тянутся ОДИН раз за страницу и декодируются в AudioBuffer, дальше каждый клик
// играет из памяти: клонирование элемента Audio (как было раньше) создаёт новый
// медиа-ресурс и грузит файл заново — то есть сетевой запрос на каждый клик.
const CARD_CLICK_SRC = asset('assets/sounds/card-click-sound.mp3');
const CARD_CLICK_VOLUME = 0.7;

let cardClickBytes = null;   // сырые байты файла (одна загрузка)
let cardClickBuffer = null;  // декодированный звук, из него идёт воспроизведение
let cardClickAudio = null;   // резервный элемент Audio, создаётся по необходимости

// Байты грузим сразу: ArrayBuffer не требует AudioContext, поэтому загрузка не
// ждёт пользовательского жеста. Декодирование — уже при появлении контекста.
fetch(CARD_CLICK_SRC)
  .then(r => (r.ok ? r.arrayBuffer() : null))
  .then(bytes => { cardClickBytes = bytes; decodeCardClick(); })
  .catch(() => {});

/**
 * Декодирует загруженные байты звука клика в AudioBuffer. Зовётся и после
 * загрузки, и из ensureAudio, потому что готовы эти две вещи в произвольном
 * порядке: контекст появляется только после жеста пользователя.
 * @returns {void}
 */
function decodeCardClick() {
  if (cardClickBuffer || !cardClickBytes || !audioCtx) return;
  try {
    // decodeAudioData забирает переданный ArrayBuffer себе, поэтому отдаём
    // копию — исходные байты нужны для повторной попытки.
    audioCtx.decodeAudioData(cardClickBytes.slice(0), buf => { cardClickBuffer = buf; }, () => {});
  } catch (_) {}
}

/**
 * Резервное воспроизведение через элемент Audio — на случай, если буфер ещё не
 * готов или WebAudio недоступен. Элемент создаётся один раз, на клик идёт клон,
 * чтобы частые клики не обрывали друг друга.
 * @returns {boolean} удалось ли запустить воспроизведение
 */
function playCardClickElement() {
  try {
    if (!cardClickAudio) {
      cardClickAudio = new Audio(CARD_CLICK_SRC);
      cardClickAudio.preload = 'auto';
      cardClickAudio.volume = CARD_CLICK_VOLUME;
    }
    const a = cardClickAudio.cloneNode();
    a.volume = CARD_CLICK_VOLUME;
    const p = a.play();
    if (p && p.catch) p.catch(() => soundClick());
    return true;
  } catch (_) { return false; }
}

/**
 * Проигрывает звук клика по карте. Основной путь — из декодированного буфера,
 * без обращения к сети; у каждого клика свой source-node, поэтому быстрые клики
 * накладываются. Фолбэки по порядку: элемент Audio, затем синтезированный
 * щелчок soundClick.
 * @returns {void}
 */
export function soundCardClick() {
  if (audioCtx && cardClickBuffer) {
    try {
      const src = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      src.buffer = cardClickBuffer;
      gain.gain.value = CARD_CLICK_VOLUME;
      src.connect(gain); gain.connect(audioCtx.destination);
      src.start();
      return;
    } catch (_) { /* падаем в фолбэк ниже */ }
  }
  if (playCardClickElement()) return;
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
 * Озвучивает ход времени по текущему состоянию: тиканье на последних 1..10 сек.
 * Сигналов на 30/20 сек больше нет — только финальный отсчёт. Звук издаётся
 * только при смене секунды.
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
}
