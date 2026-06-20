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
 * победителя (task 2): круг расходится из центра на полэкрана и в конце гаснет.
 * Цвет передаётся в CSS через переменную --win-color; по окончании анимации слой
 * скрывается. Сбрасывается, когда игра больше не в фазе over.
 * @returns {void}
 */
export function renderWin() {
  const state = getState();
  if (state.phase === 'over' && state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    floodWin(state.winner);
  }
  if (state.phase !== 'over') lastWinner = null;
}

/**
 * Проигрывает анимацию заливки цветом победителя поверх поля. Перезапускает
 * анимацию принудительным reflow (на случай повторной победы за сессию) и прячет
 * слой по её завершении.
 * @param {('red'|'blue')} winner - команда-победитель (задаёт цвет)
 * @returns {void}
 */
function floodWin(winner) {
  const flood = $('#win-flood');
  const burst = flood.querySelector('.win-flood-burst');
  flood.style.setProperty('--win-color', winner === 'red' ? '#ff6450' : '#50bbff');
  flood.classList.remove('hidden');
  // Снять класс и форсировать reflow, чтобы CSS-анимация запустилась заново.
  burst.style.animation = 'none';
  void burst.offsetWidth;
  burst.style.animation = '';
  burst.addEventListener('animationend', () => flood.classList.add('hidden'), { once: true });
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
