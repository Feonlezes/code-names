'use strict';

/**
 * @module core/model
 * Фабрики и чистые помощники для доменной модели комнаты. Не выполняет I/O,
 * не знает про WebSocket. Экспорт: createRoomObject, addLog, teamName, teamCounts.
 *
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} nickname
 * @property {('red'|'blue'|null)} team - null = наблюдатель (не выбрал команду)
 * @property {('spymaster'|'operative')} role
 * @property {boolean} connected
 * @property {boolean} [admin] - зашёл по ссылке /admin: видит меню модерации и
 *   админ-панель (добавление ботов, имитация победы, X-ray). Не сериализуется
 *   как право, но влияет на проверку прав в роутере.
 * @property {boolean} [xray] - личный X-ray: серилизатор отдаёт ему все цвета
 *   карт (как капитану), даже если он агент. Виден только ему.
 * @property {boolean} [bot] - «фейковый» игрок, добавленный админом для теста.
 *   Не имеет сокета, не учитывается в кворуме голосования, передаче лидерства и
 *   очистке пустой комнаты.
 *
 * @typedef {Object} Card
 * @property {string} word
 * @property {('red'|'blue'|'neutral'|'assassin')} color
 * @property {boolean} revealed
 *
 * @typedef {Object} Votes
 * @property {Object<number, Array<string>>} cards - индекс карты → id проголосовавших агентов
 * @property {Array<string>} skip - id агентов, проголосовавших за пропуск хода
 *
 * @typedef {Object} PendingVote
 * @property {('guess'|'skip')} kind - что назрело: открыть карту или пропустить ход
 * @property {(number|null)} index - индекс карты для kind==='guess' (иначе null)
 *
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostId
 * @property {Object<string, Player>} players
 * @property {Object} settings
 * @property {('lobby'|'clue'|'guess'|'over')} phase
 * @property {Array<Card>} board
 * @property {Votes} votes - текущие голоса агентов в фазе угадывания (task 1)
 * @property {(PendingVote|null)} pendingVote - идёт ли 2-сек отсчёт единогласия
 * @property {boolean} stopped - включена ли F9-«стоп-пауза» (оверлей с картинкой)
 * @property {Set<*>} _sockets   - внутреннее: активные сокеты (не сериализуется)
 * @property {*} _interval        - внутреннее: дескриптор таймера (не сериализуется)
 * @property {*} _voteTimeout     - внутреннее: дескриптор отсчёта голосования (не сериализуется)
 */

const { DEFAULT_SETTINGS } = require('../config');

/**
 * Создаёт чистый объект комнаты со стартовым (лобби) состоянием.
 * Поля с префиксом `_` — внутренние ресурсы и никогда не уходят клиенту
 * (см. CLAUDE.md §2.3).
 *
 * @param {string} code - уникальный код комнаты
 * @param {string} hostId - id игрока-хоста
 * @param {Object} [settings] - переопределения настроек поверх DEFAULT_SETTINGS
 * @returns {Room} новая комната
 */
function createRoomObject(code, hostId, settings) {
  return {
    code,
    hostId,
    players: {}, // id -> Player
    settings: Object.assign({}, DEFAULT_SETTINGS, settings || {}),
    phase: 'lobby', // lobby | clue | guess | over
    board: [],
    startingTeam: null,
    currentTeam: null,
    clue: null, // {word, number} — текущая активная подсказка
    // История всех подсказок по командам: { red: [{word, number}], blue: [...] }.
    // Показывается в карточке команды (см. client.md). Накапливается за партию.
    clueHistory: { red: [], blue: [] },
    // Голосование агентов в фазе угадывания (task 1): каждый агент текущей команды
    // может выбрать ровно одну карту ИЛИ пропуск хода — его кружок виден всем.
    // Когда ВСЕ подключённые агенты выбрали одно и то же, запускается 2-сек отсчёт
    // (pendingVote), по завершении которого действие применяется.
    votes: { cards: {}, skip: [] }, // cards: { индекс -> [id агентов] }
    pendingVote: null,              // { kind:'guess'|'skip', index } во время отсчёта
    timer: 0,
    paused: false,
    // F9-«стоп-пауза»: полноэкранный затемняющий оверлей с картинкой, общий для
    // всех в комнате (переключает любой игрок). Замораживает таймер хода, пока
    // включён. Отдельная логика от ручной паузы (paused) — см. gameEngine.toggleStop.
    stopped: false,
    winner: null,
    log: [],
    _sockets: new Set(),
    _interval: null,
    _voteTimeout: null
  };
}

/**
 * Добавляет запись в журнал событий комнаты. Журнал ограничен 60 записями:
 * старые отбрасываются, чтобы память комнаты не росла бесконечно.
 *
 * @param {Room} room - комната (мутируется)
 * @param {string} text - текст события
 * @returns {void}
 */
function addLog(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 60) room.log.shift();
}

/**
 * Возвращает название команды в родительном падеже для сообщений журнала.
 *
 * @param {('red'|'blue')} t - команда
 * @returns {string} «красных» | «синих»
 */
function teamName(t) {
  return t === 'red' ? 'красных' : 'синих';
}

/**
 * Считает, сколько неоткрытых карт осталось у каждой команды. Используется
 * для счёта и проверки победы.
 *
 * @param {Room} room - комната
 * @returns {{red: number, blue: number}} число неоткрытых карт по командам
 */
function teamCounts(room) {
  const remaining = { red: 0, blue: 0 };
  for (const c of room.board) {
    if ((c.color === 'red' || c.color === 'blue') && !c.revealed) remaining[c.color]++;
  }
  return remaining;
}

module.exports = { createRoomObject, addLog, teamName, teamCounts };
