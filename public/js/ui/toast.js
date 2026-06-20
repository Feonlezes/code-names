'use strict';

/**
 * @module ui/toast
 * Всплывающие уведомления в углу экрана с авто-исчезновением и звуком.
 */

import { $, escapeHtml } from '../util/dom.js';
import { soundNotify } from '../audio/sound.js';

/**
 * Показывает уведомление-тост: появляется, проигрывает звук и сам убирается
 * через несколько секунд.
 * @param {string} text - текст уведомления
 * @returns {void}
 */
export function showToast(text) {
  const cont = $('#toasts');
  if (!cont) return;
  const card = document.createElement('div');
  card.className = 'toast';
  card.innerHTML = `<div class="toast-body">${escapeHtml(text)}</div>` +
                   `<div class="toast-loader"><div class="toast-loader-bar"></div></div>`;
  cont.appendChild(card);
  soundNotify();
  setTimeout(() => {
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), 420);
  }, 4000);
}
