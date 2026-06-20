'use strict';

/**
 * @module config
 * Клиентские константы: настройки игры по умолчанию и словарь. Словарь приходит
 * из words.js (классический скрипт, выполняется до ES-модулей), здесь только
 * убираем дубликаты.
 */

export const DEFAULTS = { boardSize: 5, firstMoveTime: 120, answerTime: 60, extraTime: 15 };

// window.WORDS определяется в public/words.js (подключается раньше main.js).
export const WORDS = [...new Set(window.WORDS || [])];
