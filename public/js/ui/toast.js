'use strict';

/**
 * @module ui/toast
 * Всплывающие уведомления в углу экрана с авто-исчезновением и звуком.
 * Экспорт: showToast.
 */

import { $, escapeHtml } from '../util/dom.js';
import { soundNotify } from '../audio/sound.js';

// Сколько живёт обычный тост; та же длительность зашита в анимацию полосы
// (toastLoad в styles.css), поэтому полоса кончается ровно к исчезновению.
const TOAST_LIFE_MS = 4000;

// Длительность анимации ухода (toastOut в styles.css) — после неё узел удаляем.
const TOAST_OUT_MS = 420;

/**
 * Показывает уведомление-тост: появляется, проигрывает звук и сам убирается
 * через несколько секунд. Липкий тост (`sticky`) не гаснет сам — его закрывает
 * вызывающий код через возвращённый хендл (используется для «идёт проверка
 * обновлений», где неизвестно, сколько ждать).
 *
 * @param {string} text - текст уведомления
 * @param {{variant?: 'info'|'warning', sticky?: boolean}} [opts] - вид и режим:
 *   `variant` задаёт цвет полосы ('warning' — жёлтый), `sticky` отключает
 *   авто-исчезновение
 * @returns {{setText: (text: string) => void, close: () => void}} хендл для
 *   обновления текста и закрытия
 */
export function showToast(text, opts = {}) {
  const cont = $('#toasts');
  // Хендл-заглушка, если контейнера нет: вызывающий код не должен проверять null.
  if (!cont) return { setText() {}, close() {} };

  const card = document.createElement('div');
  card.className = 'toast';
  if (opts.variant === 'warning') card.classList.add('toast-warning');
  if (opts.sticky) card.classList.add('toast-sticky');
  card.innerHTML = `<div class="toast-body">${escapeHtml(text)}</div>` +
                   `<div class="toast-loader"><div class="toast-loader-bar"></div></div>`;
  cont.appendChild(card);
  soundNotify();

  let closed = false;
  /** Убирает тост с анимацией ухода. @returns {void} */
  const close = () => {
    if (closed) return;
    closed = true;
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), TOAST_OUT_MS);
  };

  if (!opts.sticky) setTimeout(close, TOAST_LIFE_MS);

  return {
    setText(next) { card.querySelector('.toast-body').textContent = next; },
    close
  };
}
