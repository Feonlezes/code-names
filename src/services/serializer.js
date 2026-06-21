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
  // X-ray (task 2): админ с включённым X-ray видит все цвета карт, даже будучи
  // агентом. Решение персональное — раскрытие применяется только в ЕГО снимке.
  const xray = !!(me && me.xray);
  const reveal = room.phase === 'over' || isSpymaster || xray;
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
    // Голоса агентов и идущий 2-сек отсчёт (task 1) — видны всем, чтобы рисовать
    // кружки проголосовавших и лоадер. Секретов не раскрывают (только id игроков).
    votes: room.votes,
    pendingVote: room.pendingVote,
    timer: room.timer,
    paused: room.paused,
    // F9-«стоп-пауза»: общий оверлей с картинкой (task 3). Видят все — по нему
    // клиент рисует затемнение и картинку.
    stopped: room.stopped,
    // Личный X-ray-флаг — чтобы клиент-админ знал состояние кнопки. Чужие цвета
    // в board уже раскрыты выше (reveal); сам флаг секретов не несёт.
    xray,
    winner: room.winner,
    remaining: teamCounts(room),
    log: room.log
  };
}

module.exports = { stateFor };
