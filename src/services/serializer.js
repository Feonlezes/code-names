'use strict';

/**
 * @module services/serializer
 * Единственная точка формирования внешнего контракта: превращает комнату в
 * снимок состояния для КОНКРЕТНОГО игрока. Здесь скрываются секреты —
 * цвета невскрытых карт видит только капитан или показываются в конце игры
 * (см. CLAUDE.md §2.1, §2.3). Внутренние поля (_sockets, _interval) не уходят.
 * Экспорт: stateFor.
 */

const { teamCounts } = require('../core/model');
const { OUT } = require('../shared/messages');

/**
 * Строит состояние комнаты с точки зрения игрока playerId. Обычному агенту
 * цвета невскрытых карт отдаются как null.
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId - кому предназначен снимок
 * @returns {Object} сообщение типа OUT.STATE
 */
function stateFor(room, playerId) {
  const me = room.players[playerId];
  const isSpymaster = me && me.role === 'spymaster';
  const reveal = room.phase === 'over' || isSpymaster;
  const board = room.board.map(c => ({
    word: c.word,
    revealed: c.revealed,
    color: (c.revealed || reveal) ? c.color : null
  }));
  return {
    type: OUT.STATE,
    code: room.code,
    hostId: room.hostId,
    you: playerId,
    players: Object.values(room.players).map(p => ({
      id: p.id, nickname: p.nickname, team: p.team, role: p.role, connected: p.connected
    })),
    settings: room.settings,
    phase: room.phase,
    board,
    startingTeam: room.startingTeam,
    currentTeam: room.currentTeam,
    clue: room.clue,
    clueHistory: room.clueHistory,
    timer: room.timer,
    paused: room.paused,
    winner: room.winner,
    remaining: teamCounts(room),
    log: room.log
  };
}

module.exports = { stateFor };
