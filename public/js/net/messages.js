'use strict';

/**
 * @module net/messages
 * Зеркало серверного контракта типов сообщений (src/shared/messages.js).
 * Держим списки синхронными, чтобы не было «магических строк» (CLAUDE.md §2.4).
 */

// Исходящие от клиента: клиент → сервер.
export const IN = {
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  SET_TEAM_ROLE: 'setTeamRole',
  CHANGE_NICKNAME: 'changeNickname',
  UPDATE_SETTINGS: 'updateSettings',
  START_GAME: 'startGame',
  NEW_GAME: 'newGame',
  BACK_TO_LOBBY: 'backToLobby',
  GIVE_CLUE: 'giveClue',
  EDIT_CLUE: 'editClue',
  GUESS: 'guess',
  END_TURN: 'endTurn',
  PAUSE: 'pause',
  RESUME: 'resume',
  SHUFFLE_TEAMS: 'shuffleTeams',
  LEAVE: 'leave',
  // Модерация (лидер комнаты или /admin): меню при наведении на игрока.
  SET_HOST: 'setHost',           // передать корону лидера игроку {playerId}
  MOVE_OBSERVER: 'moveObserver', // переместить игрока в наблюдатели {playerId}
  // F9-«стоп-пауза» с картинкой — общая для всех (любой игрок переключает).
  TOGGLE_STOP: 'toggleStop',
  // Админ-панель (только игрок с правами /admin): отладочные действия.
  ADMIN_ADD_PLAYER: 'adminAddPlayer', // добавить бота в команду/наблюдатели {team}
  ADMIN_ADD_CLUE: 'adminAddClue',     // добавить подсказку в историю команды {team}
  ADMIN_WIN: 'adminWin',              // имитировать победу команды {team}
  ADMIN_XRAY: 'adminXray'             // переключить X-ray (видеть все цвета лично)
};

// Приходящие клиенту: сервер → клиент.
export const OUT = {
  STATE: 'state',
  JOINED: 'joined',
  ERROR: 'error'
};
