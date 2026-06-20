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
  GUESS: 'guess',
  END_TURN: 'endTurn',
  MARK_CARD: 'markCard',
  PAUSE: 'pause',
  RESUME: 'resume',
  SHUFFLE_TEAMS: 'shuffleTeams',
  LEAVE: 'leave'
};

// Приходящие клиенту: сервер → клиент.
export const OUT = {
  STATE: 'state',
  JOINED: 'joined',
  ERROR: 'error'
};
