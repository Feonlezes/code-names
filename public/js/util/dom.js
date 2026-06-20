'use strict';

/**
 * @module util/dom
 * Тонкие помощники работы с DOM. Изолируют доступ к DOM в одном месте, чтобы
 * бизнес-логика и сеть не лезли в разметку напрямую (см. CLAUDE.md §2.6).
 */

/**
 * Находит первый элемент по CSS-селектору.
 * @param {string} sel
 * @returns {Element|null}
 */
export const $ = (sel) => document.querySelector(sel);

/**
 * Находит все элементы по CSS-селектору и возвращает их массивом.
 * @param {string} sel
 * @returns {Array<Element>}
 */
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/**
 * Экранирует строку для безопасной вставки в HTML (защита от XSS, §2.7).
 * @param {*} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
