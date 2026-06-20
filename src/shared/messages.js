'use strict';

/**
 * @module shared/messages
 * Единый список типов WebSocket-сообщений. Используется и роутером, и (зеркально)
 * клиентом, чтобы не было «магических строк» и рассинхрона контракта
 * (см. CLAUDE.md §2.4). Зеркало для браузера: public/js/net/messages.js.
 */

// Входящие сообщения: клиент → сервер.
const IN = {
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  SET_TEAM_ROLE: 'setTeamRole',
  CHANGE_NICKNAME: 'changeNickname',
  UPDATE_SETTINGS: 'updateSettings',
  START_GAME: 'startGame',
  NEW_GAME: 'newGame',
  BACK_TO_LOBBY: 'backToLobby',
  GIVE_CLUE: 'giveClue',
  GUESS: 'guess',
  END_TURN: 'endTurn',
  PAUSE: 'pause',
  RESUME: 'resume',
  SHUFFLE_TEAMS: 'shuffleTeams',
  LEAVE: 'leave'
};

// Исходящие сообщения: сервер → клиент.
const OUT = {
  STATE: 'state',   // полный снимок состояния для конкретного игрока
  JOINED: 'joined', // подтверждение входа в комнату
  ERROR: 'error'    // ошибка (например, комната не найдена)
};

module.exports = { IN, OUT };
