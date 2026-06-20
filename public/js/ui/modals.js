'use strict';

/**
 * @module ui/modals
 * Вспомогательные элементы поверх экрана: баннер победы, копирование в буфер
 * с обратной связью и открытие модалки смены ника.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';
import { LS } from '../storage/localStore.js';

// Последний показанный победитель — чтобы не показывать баннер повторно.
let lastWinner = null;

/**
 * Показывает баннер победы один раз при завершении игры; сбрасывается, когда
 * игра больше не в фазе over.
 * @returns {void}
 */
export function renderWin() {
  const state = getState();
  if (state.phase === 'over' && state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    $('#win-text').textContent = state.winner === 'red' ? '🔴 Победили красные!' : '🔵 Победили синие!';
    $('#win-banner').classList.remove('hidden');
  }
  if (state.phase !== 'over') lastWinner = null;
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
