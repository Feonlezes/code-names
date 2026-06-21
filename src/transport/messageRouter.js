'use strict';

/**
 * @module transport/messageRouter
 * Тонкий слой ввода-вывода: разбирает входящие WebSocket-сообщения, проверяет
 * права (хост/фаза/команда) и вызывает доменные сервисы, после чего рассылает
 * обновлённое состояние. Игровых правил здесь нет — только маршрутизация
 * (см. CLAUDE.md §2.2). Экспорт: handleConnection.
 */

const { IN, OUT } = require('../shared/messages');
const roomService = require('../services/roomService');
const gameEngine = require('../services/gameEngine');
const { stateFor } = require('../services/serializer');
const { addLog } = require('../core/model');

/**
 * Отправляет объект одному сокету, если он открыт.
 *
 * @param {import('ws')} ws
 * @param {Object} obj
 * @returns {void}
 */
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/**
 * Рассылает каждому сокету комнаты персональный снимок состояния (у капитана и
 * агента он разный — см. serializer).
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function broadcast(room) {
  for (const ws of room._sockets) {
    if (ws.readyState === ws.OPEN) send(ws, stateFor(room, ws.playerId));
  }
}

// Контекст для движка: единственная зависимость — способ разослать состояние.
const ctx = { broadcast };

/**
 * Привязывает сокет к комнате и игроку, регистрирует участника и подтверждает
 * вход. Совмещает транспортную привязку (сокет ↔ комната) с доменным
 * addPlayer.
 *
 * @param {import('ws')} ws
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @param {string} [nickname]
 * @returns {void}
 */
function joinRoom(ws, room, playerId, nickname) {
  ws.roomCode = room.code;
  ws.playerId = playerId;
  room._sockets.add(ws);
  roomService.addPlayer(room, playerId, nickname);
  // Заменяем устаревшие сокеты этого же игрока (переподключение/обновление
  // вкладки). Без этого старый «полумёртвый» сокет оставался в _sockets, а его
  // запоздалый close помечал игрока отключённым — игрок «зависал»: не получал
  // тики таймера, подсказки и события (task 3). Закрываем их ПОСЛЕ добавления
  // нового, чтобы guard в handleClose увидел живой сокет и не сбросил connected.
  for (const old of [...room._sockets]) {
    if (old !== ws && old.playerId === playerId) {
      room._sockets.delete(old);
      try { old.close(); } catch (_) {}
    }
  }
  send(ws, { type: OUT.JOINED, code: room.code, playerId });
  broadcast(room);
}

/**
 * Настраивает обработчики для нового WebSocket-соединения.
 *
 * @param {import('ws')} ws
 * @returns {void}
 */
function handleConnection(ws) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('close', () => handleClose(ws));
}

/**
 * Разбирает и маршрутизирует входящее сообщение. Сначала обрабатывает вход
 * (create/join), затем действия, требующие уже привязанных комнаты и игрока.
 *
 * @param {import('ws')} ws
 * @param {*} data - сырое сообщение WebSocket
 * @returns {void}
 */
function handleMessage(ws, data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (e) { return; }
  const t = msg.type;

  if (t === IN.CREATE_ROOM) {
    const room = roomService.createRoom(msg.playerId, msg.settings);
    joinRoom(ws, room, msg.playerId, msg.nickname);
    return;
  }

  if (t === IN.JOIN_ROOM) {
    const room = roomService.getRoom((msg.code || '').toUpperCase());
    if (!room) { send(ws, { type: OUT.ERROR, message: 'Комната не найдена' }); return; }
    joinRoom(ws, room, msg.playerId, msg.nickname);
    return;
  }

  // Дальше нужны привязанные комната и игрок.
  const room = roomService.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players[ws.playerId];
  if (!player) return;
  const isHost = ws.playerId === room.hostId;
  const lobbyOrOver = room.phase === 'lobby' || room.phase === 'over';

  switch (t) {
    case IN.SET_TEAM_ROLE:
      // Менять команду/роль можно в лобби, а также во время игры на паузе
      // (task 2): пока партия заморожена, состав можно поправить.
      if (room.phase === 'lobby' || room.paused) {
        roomService.setTeamRole(room, player, msg.team, msg.role);
      }
      break;
    case IN.CHANGE_NICKNAME:
      if (msg.nickname) roomService.changeNickname(room, player, msg.nickname);
      break;
    case IN.UPDATE_SETTINGS:
      if (lobbyOrOver) roomService.updateSettings(room, msg.settings);
      break;
    case IN.START_GAME:
    case IN.NEW_GAME:
      // Хост может приложить к старту настройки (кнопка «Сохранить и начать игру»):
      // тогда сперва применяем их (с валидацией), а затем стартуем партию уже по
      // новым настройкам — даже если игра шла (startGame собирает поле заново).
      if (isHost) {
        if (msg.settings) roomService.updateSettings(room, msg.settings);
        gameEngine.startGame(room, msg.words, ctx);
      }
      break;
    case IN.BACK_TO_LOBBY:
      if (isHost) gameEngine.returnToLobby(room);
      break;
    case IN.GIVE_CLUE:
      gameEngine.giveClue(room, player, msg.word, msg.number, ctx);
      break;
    case IN.EDIT_CLUE:
      // Капитан правит уже данную своей командой подсказку во время игры (task 1).
      gameEngine.editClue(room, player, msg.index, msg.word, msg.number, ctx);
      break;
    case IN.GUESS:
      // task 1: клик по карте — это ГОЛОС агента, а не мгновенное открытие.
      // Карта откроется только после 2-сек единогласия (см. gameEngine.voteCard).
      gameEngine.voteCard(room, player, msg.index, ctx);
      break;
    case IN.END_TURN:
      // task 1: «Пропустить ход» — тоже голос; ход перейдёт по единогласию агентов.
      gameEngine.voteSkip(room, player, ctx);
      break;
    case IN.PAUSE:
      if (room.phase === 'clue' || room.phase === 'guess') {
        gameEngine.pauseGame(room);
        addLog(room, `⏸ Пауза (${player.nickname}).`);
      }
      break;
    case IN.RESUME:
      if (room.paused) {
        gameEngine.resumeGame(room, ctx);
        addLog(room, `▶️ Игра возобновлена (${player.nickname}).`);
      }
      break;
    case IN.SHUFFLE_TEAMS:
      // перемешивать может только лидер комнаты и только вне игры
      if (isHost && lobbyOrOver) roomService.shuffleTeams(room);
      break;
    case IN.LEAVE:
      handleLeave(ws, room);
      return;
  }
  broadcast(room);
}

/**
 * Явный выход игрока (logout): отвязывает сокет, удаляет игрока, при
 * необходимости передаёт лидерство и подчищает пустую комнату.
 *
 * @param {import('ws')} ws
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function handleLeave(ws, room) {
  room._sockets.delete(ws);
  roomService.removePlayer(room, ws.playerId);
  // Снять «зависший» голос ушедшего и пересчитать единогласие (task 1).
  gameEngine.handleVoterGone(room, ws.playerId, ctx);
  ws.roomCode = null;
  broadcast(room);
  roomService.maybeCleanup(room);
}

/**
 * Обработка разрыва соединения: помечает игрока отключённым (с возможностью
 * переподключиться), рассылает состояние и подчищает пустую комнату.
 *
 * @param {import('ws')} ws
 * @returns {void}
 */
function handleClose(ws) {
  const room = roomService.getRoom(ws.roomCode);
  if (!room || !room.players[ws.playerId]) return;
  room._sockets.delete(ws);
  // Если у игрока остался другой живой сокет (переподключение или вторая
  // вкладка), НЕ помечаем его отключённым — иначе гонка «новый join → запоздалый
  // close старого» выбивала только что вернувшегося игрока в offline и обрывала
  // ему рассылку состояния (task 3).
  const stillConnected = [...room._sockets].some(
    s => s.playerId === ws.playerId && s.readyState === s.OPEN
  );
  if (stillConnected) { broadcast(room); return; }
  roomService.disconnectPlayer(room, ws.playerId);
  // Отключившийся больше не «голосует» — убираем его голос и пересчитываем (task 1).
  gameEngine.handleVoterGone(room, ws.playerId, ctx);
  broadcast(room);
  roomService.maybeCleanup(room);
}

module.exports = { handleConnection };
