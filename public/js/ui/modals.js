'use strict';

/**
 * @module ui/modals
 * Вспомогательные элементы поверх экрана: заливка цветом победителя, копирование
 * в буфер с обратной связью и открытие модалки смены ника.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';
import { LS } from '../storage/localStore.js';

// Последний показанный победитель — чтобы не запускать заливку повторно.
let lastWinner = null;

/**
 * При завершении игры один раз запускает заливку экрана цветом команды-
 * победителя (task 2): горизонтальный градиент от края команды-победителя к
 * противоположному, где цвет затухает в фон. Слой остаётся видимым, пока игра в
 * фазе over, и скрывается (вместе со сбросом lastWinner), когда фаза меняется.
 * @returns {void}
 */
export function renderWin() {
  const state = getState();
  if (state.phase === 'over' && state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    floodWin(state.winner);
  }
  if (state.phase !== 'over') {
    lastWinner = null;
    $('#win-flood').classList.add('hidden');
  }
}

/**
 * Включает заливку позади UI цветом команды-победителя. Задаёт цвет команды
 * (--win-color) и сторону линейного градиента (--win-dir: «to left» для красных
 * слева, «to right» для синих справа — насыщенный цвет у края команды, затухание
 * к другому концу) и перезапускает fade-in принудительным reflow (на случай
 * повторной победы за сессию). Слой не прячет — он живёт до смены фазы.
 * @param {('red'|'blue')} winner - команда-победитель (задаёт цвет и сторону)
 * @returns {void}
 */
function floodWin(winner) {
  const flood = $('#win-flood');
  const wash = flood.querySelector('.win-flood-wash');
  // Глубокие цвета победы: синие — #043a5d (образец из ТЗ), красные — зеркальный
  // глубокий красный #5d1410. Затухание задаётся прозрачным стопом в CSS.
  flood.style.setProperty('--win-color', winner === 'red' ? '#5d1410' : '#043a5d');
  flood.style.setProperty('--win-dir', winner === 'red' ? 'to left' : 'to right');
  flood.classList.remove('hidden');
  // Снять анимацию и форсировать reflow, чтобы fade-in проигрался заново.
  wash.style.animation = 'none';
  void wash.offsetWidth;
  wash.style.animation = '';
}

/**
 * Копирует текст в буфер обмена и кратко показывает «✓» на кнопке.
 * @param {string} sel - селектор кнопки
 * @param {string} original - исходный значок кнопки (вернуть после)
 * @param {string} text - что копировать
 * @returns {void}
 */
export function copyFeedback(sel, original, text) {
  navigator.clipboard?.writeText(text);
  const b = $(sel);
  b.textContent = '✓';
  setTimeout(() => b.textContent = original, 1200);
}

/**
 * Открывает модалку смены ника, подставляя текущий ник.
 * @returns {void}
 */
export function openNickModal() {
  $('#nick-input').value = LS.nick;
  $('#nick-modal').classList.remove('hidden');
  $('#nick-input').focus();
}
