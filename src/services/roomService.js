'use strict';

/**
 * @module services/roomService
 * Реестр комнат и доменные операции над участниками: создание/поиск комнаты,
 * вход/выход игроков, передача лидерства, перемешивание команд, настройки,
 * очистка пустых комнат. Не выполняет сетевой I/O (только мутирует состояние
 * и журнал). Экспорт перечислен внизу.
 */

const { randomCode, shuffle } = require('../core/rng');
const { createRoomObject, addLog } = require('../core/model');
const timer = require('./timerService');

/** @type {Map<string, import('../core/model').Room>} code -> room */
const rooms = new Map();

/**
 * Создаёт новую комнату с уникальным кодом и регистрирует её в реестре.
 *
 * @param {string} hostId - id игрока-хоста
 * @param {Object} [settings] - переопределения настроек
 * @returns {import('../core/model').Room} созданная комната
 */
function createRoom(hostId, settings) {
  const code = randomCode(c => rooms.has(c));
  const room = createRoomObject(code, hostId, settings);
  rooms.set(code, room);
  return room;
}

/**
 * Возвращает комнату по коду или undefined.
 *
 * @param {string} code
 * @returns {import('../core/model').Room|undefined}
 */
function getRoom(code) {
  return rooms.get(code);
}

/**
 * Добавляет игрока в комнату либо помечает существующего как снова
 * подключённого. Новичок входит как наблюдатель (`team: null`) — мы НЕ
 * раскидываем его по командам автоматически, сторону он выбирает сам
 * («Стать капитаном» / «Войти в команду»). Мутирует комнату и журнал.
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @param {string} [nickname]
 * @returns {void}
 */
function addPlayer(room, playerId, nickname) {
  if (!room.players[playerId]) {
    room.players[playerId] = {
      id: playerId,
      nickname: nickname || 'Игрок',
      team: null,       // наблюдатель: команда не назначена, выбирает сам игрок
      role: 'operative',
      connected: true
    };
    addLog(room, `➕ ${nickname || 'Игрок'} присоединился.`);
  } else {
    room.players[playerId].connected = true;
    if (nickname) room.players[playerId].nickname = nickname;
  }
}

/**
 * Помечает игрока отключившимся (но не удаляет — он может переподключиться).
 * Если ушёл хост, передаёт лидерство. Мутирует комнату и журнал.
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @returns {void}
 */
function disconnectPlayer(room, playerId) {
  const player = room.players[playerId];
  if (!player) return;
  player.connected = false;
  addLog(room, `➖ ${player.nickname} отключился.`);
  if (room.hostId === playerId) reassignHost(room);
}

/**
 * Полностью удаляет игрока из комнаты (явный выход/logout). При уходе хоста
 * передаёт лидерство.
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @returns {void}
 */
function removePlayer(room, playerId) {
  const wasHost = room.hostId === playerId;
  delete room.players[playerId];
  if (wasHost) reassignHost(room);
}

/**
 * Передаёт лидерство другому игроку: предпочитаем подключённого, иначе любого.
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function reassignHost(room) {
  const next = Object.values(room.players).find(p => p.connected && p.id !== room.hostId)
            || Object.values(room.players).find(p => p.id !== room.hostId)
            || Object.values(room.players)[0];
  room.hostId = next ? next.id : null;
  if (next) addLog(room, `👑 ${next.nickname} стал лидером комнаты.`);
}

/**
 * Удаляет комнату, если в ней не осталось подключённых игроков. Освобождает
 * таймер-ресурс (см. CLAUDE.md §2.5).
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function maybeCleanup(room) {
  const anyConnected = Object.values(room.players).some(p => p.connected);
  if (!anyConnected) {
    timer.clearTimer(room);
    rooms.delete(room.code);
  }
}

/**
 * Случайно раскидывает игроков по командам поровну и назначает по одному
 * капитану в каждой. Применяется только вне игры (проверку фазы делает роутер).
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function shuffleTeams(room) {
  const ids = Object.keys(room.players);
  shuffle(ids);
  ids.forEach((id, i) => {
    room.players[id].team = i % 2 === 0 ? 'red' : 'blue';
    room.players[id].role = 'operative';
  });
  const reds = ids.filter(id => room.players[id].team === 'red');
  const blues = ids.filter(id => room.players[id].team === 'blue');
  if (reds.length) room.players[reds[0]].role = 'spymaster';
  if (blues.length) room.players[blues[0]].role = 'spymaster';
  addLog(room, `🔀 Команды перемешаны.`);
}

/**
 * Меняет команду/роль игрока. Допустимо в лобби и на паузе (проверку фазы делает
 * вызывающий). Принимает только валидные значения.
 *
 * Правило одного капитана: в команде может быть только один spymaster. Если в
 * целевой команде уже есть другой капитан, запрос на роль spymaster
 * понижается до operative — нельзя «выбрать двух капитанов» (task 1). Смена
 * самой команды при этом всё равно применяется.
 *
 * @param {import('../core/model').Room} room - комната (нужна для проверки чужих ролей)
 * @param {import('../core/model').Player} player
 * @param {('red'|'blue')} team
 * @param {('spymaster'|'operative')} role
 * @returns {void}
 */
function setTeamRole(room, player, team, role) {
  if (team === 'red' || team === 'blue') player.team = team;
  if (role !== 'spymaster' && role !== 'operative') return;
  // Целевая команда — только что выбранная (если валидна) или текущая игрока.
  const targetTeam = player.team;
  if (role === 'spymaster' && teamHasOtherSpymaster(room, targetTeam, player.id)) {
    player.role = 'operative'; // в команде уже есть капитан — становимся агентом
    return;
  }
  player.role = role;
}

/**
 * Проверяет, есть ли в команде капитан, отличный от указанного игрока.
 *
 * @param {import('../core/model').Room} room
 * @param {('red'|'blue')} team
 * @param {string} exceptId - id игрока, которого не учитываем
 * @returns {boolean} true, если у команды уже есть другой капитан
 */
function teamHasOtherSpymaster(room, team, exceptId) {
  return Object.values(room.players).some(
    p => p.id !== exceptId && p.team === team && p.role === 'spymaster'
  );
}

/**
 * Меняет ник игрока (обрезка до 20 символов) и пишет событие в журнал.
 *
 * @param {import('../core/model').Room} room
 * @param {import('../core/model').Player} player
 * @param {string} nickname
 * @returns {void}
 */
function changeNickname(room, player, nickname) {
  const old = player.nickname;
  player.nickname = String(nickname).slice(0, 20);
  addLog(room, `✏️ ${old} теперь ${player.nickname}`);
}

/**
 * Применяет валидированные настройки комнаты. Размер поля — только 5 или 6;
 * тайминги — целые в диапазоне [0, 999].
 *
 * @param {import('../core/model').Room} room
 * @param {Object} settings - сырые настройки от клиента
 * @returns {void}
 */
function updateSettings(room, settings) {
  const s = settings || {};
  if (s.boardSize === 5 || s.boardSize === 6) room.settings.boardSize = s.boardSize;
  ['firstMoveTime', 'answerTime', 'extraTime'].forEach(k => {
    const v = parseInt(s[k], 10);
    if (!isNaN(v) && v >= 0 && v <= 999) room.settings[k] = v;
  });
}

module.exports = {
  createRoom, getRoom, addPlayer, disconnectPlayer, removePlayer,
  reassignHost, maybeCleanup, shuffleTeams, setTeamRole, changeNickname, updateSettings
};
