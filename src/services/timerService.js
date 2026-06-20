'use strict';

/**
 * @module services/timerService
 * Чистый механизм пофазного таймера комнаты. Знает только про setInterval и
 * поле room.timer; НЕ знает про игровые правила и рассылку — что делать на тик
 * и на истечение, решает вызывающий через колбэки (см. CLAUDE.md §2.2, §4 плана).
 * Помимо посекундного пофазного таймера (_interval) умеет вести одноразовый
 * обратный отсчёт голосования (_voteTimeout, task 1) — он не связан с фазой и
 * нужен для 2-сек паузы перед применением единогласного решения агентов.
 * Экспорт: startTimer, clearTimer, startCountdown, clearCountdown.
 */

/**
 * Останавливает и обнуляет таймер комнаты, если он запущен.
 *
 * @param {import('../core/model').Room} room - комната (мутируется)
 * @returns {void}
 */
function clearTimer(room) {
  if (room._interval) {
    clearInterval(room._interval);
    room._interval = null;
  }
}

/**
 * Запускает посекундный таймер для активной фазы (clue/guess). Каждую секунду
 * уменьшает room.timer; при достижении нуля вызывает onExpire, затем всегда
 * вызывает onTick. На паузе и вне игровых фаз таймер не идёт.
 *
 * @param {import('../core/model').Room} room - комната (мутируется)
 * @param {() => void} onTick - вызывается каждую секунду (обычно рассылка состояния)
 * @param {() => void} onExpire - вызывается при истечении времени
 * @returns {void}
 */
function startTimer(room, onTick, onExpire) {
  clearTimer(room);
  if (room.paused) return;
  if (room.phase !== 'clue' && room.phase !== 'guess') return;
  room._interval = setInterval(() => {
    if (room.paused) return;
    room.timer--;
    if (room.timer <= 0) onExpire();
    onTick();
  }, 1000);
}

/**
 * Останавливает одноразовый отсчёт голосования, если он запущен (task 1).
 *
 * @param {import('../core/model').Room} room - комната (мутируется)
 * @returns {void}
 */
function clearCountdown(room) {
  if (room._voteTimeout) {
    clearTimeout(room._voteTimeout);
    room._voteTimeout = null;
  }
}

/**
 * Запускает одноразовый обратный отсчёт голосования: через ms миллисекунд
 * вызывает onDone. Предыдущий отсчёт (если был) отменяется. Не связан с фазой и
 * паузой — управлением занимается вызывающий (gameEngine).
 *
 * @param {import('../core/model').Room} room - комната (мутируется)
 * @param {number} ms - длительность отсчёта, мс
 * @param {() => void} onDone - вызывается по завершении отсчёта
 * @returns {void}
 */
function startCountdown(room, ms, onDone) {
  clearCountdown(room);
  room._voteTimeout = setTimeout(() => {
    room._voteTimeout = null;
    onDone();
  }, ms);
}

module.exports = { startTimer, clearTimer, startCountdown, clearCountdown };
