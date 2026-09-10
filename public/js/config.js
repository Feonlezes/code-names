'use strict';

/**
 * @module config
 * Клиентские константы: настройки игры по умолчанию. Словарь клиенту не нужен —
 * слова выбирает сервер при сборке поля (src/core/dictionary.js).
 */

export const DEFAULTS = { boardSize: 5, firstMoveTime: 120, answerTime: 60, extraTime: 15 };
