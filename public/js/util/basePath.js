'use strict';

/**
 * @module util/basePath
 * Базовый путь приложения. Игра работает и в корне домена
 * (http://localhost:3000/), и под префиксом обратного прокси
 * (https://site/code-names/). Префикс вычисляется из URL самого модуля, поэтому
 * нигде в коде его не приходится задавать константой, а сервер продолжает
 * считать, что живёт в корне (префикс срезает прокси, см. docs/hosting.md).
 * Экспорт: BASE, asset, wsUrl.
 */

// Известный хвост пути этого модуля: URL файла всегда «<база>js/util/basePath.js».
// Отрезав хвост, получаем базу приложения.
const MODULE_TAIL = 'js/util/basePath.js';

/** @type {string} базовый путь приложения с завершающим слэшем: '/' или '/code-names/' */
export const BASE = (() => {
  const p = new URL(import.meta.url).pathname;
  return p.endsWith(MODULE_TAIL) ? p.slice(0, -MODULE_TAIL.length) : '/';
})();

/**
 * Собирает путь к статическому файлу относительно базы приложения.
 *
 * @param {string} rel - путь внутри public/ без ведущего слэша, 'assets/...'
 * @returns {string} путь, пригодный для src/href
 */
export function asset(rel) {
  return BASE + String(rel).replace(/^\/+/, '');
}

/**
 * Собирает адрес WebSocket-соединения: схема — по протоколу страницы, путь —
 * база приложения (по ней прокси маршрутизирует Upgrade в нужный процесс).
 *
 * @returns {string} например 'wss://site/code-names/' или 'ws://localhost:3000/'
 */
export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${BASE}`;
}
