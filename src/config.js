'use strict';

/**
 * @module config
 * Единая точка конфигурации сервера: сетевой порт, путь к статике, MIME-типы,
 * интервал ping и дефолтные настройки игры. Любой изменяемый параметр держим
 * здесь, а не «зашитым» по месту использования (см. CLAUDE.md §2.8).
 */

const path = require('path');

// Каталог со статикой клиента. __dirname указывает на src/, поэтому
// поднимаемся на уровень выше к корню проекта и входим в public/.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Сопоставление расширений с Content-Type для статической отдачи.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Настройки игры по умолчанию (значения взяты из правил Codenames).
const DEFAULT_SETTINGS = {
  boardSize: 5,        // размер поля: 5 или 6
  firstMoveTime: 120,  // время фазы подсказки капитана, сек
  answerTime: 60,      // время фазы угадывания команды, сек
  extraTime: 15        // бонус секунд за каждый верный ответ
};

module.exports = {
  PORT: process.env.PORT || 3000,
  PING_INTERVAL: 30000, // период проверки «живости» WebSocket-соединений, мс
  PUBLIC_DIR,
  MIME,
  DEFAULT_SETTINGS
};
