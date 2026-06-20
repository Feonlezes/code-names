'use strict';

/**
 * @module services/gameEngine
 * Доменная логика партии Codenames: старт, подсказки, угадывание, смена хода,
 * проверка победы, пауза/возврат в лобби. Не знает про WebSocket и HTTP —
 * работает только с объектом Room. Рассылку состояния выполняет вышележащий
 * слой через ctx.broadcast (инверсия зависимостей, см. §4 плана).
 *
 * Контекст выполнения:
 * @typedef {Object} EngineCtx
 * @property {(room: import('../core/model').Room) => void} broadcast - разослать состояние
 *
 * Экспорт: startGame, giveClue, voteCard, voteSkip, handleVoterGone, endTurn,
 * checkWin, finishGame, pauseGame, resumeGame, returnToLobby.
 */

const { shuffle } = require('../core/rng');
const { layoutFor } = require('../core/board');
const { addLog, teamName, teamCounts } = require('../core/model');
const timer = require('./timerService');

// task 1: пауза перед применением единогласного решения агентов, мс. Это же
// число задаёт длительность лоадера на клиенте (public/styles.css: @keyframes
// voteLoad / skipLoad) — держим их синхронными.
const VOTE_COUNTDOWN_MS = 2000;

/**
 * Перезапускает таймер под текущую фазу комнаты: на каждый тик — рассылка
 * состояния, на истечение — переход хода (onTimeout). Единая точка «вооружения»
 * таймера, чтобы движок не дублировал связку с timerService.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function armTimer(room, ctx) {
  timer.startTimer(room, () => ctx.broadcast(room), () => onTimeout(room, ctx));
}

/**
 * Обрабатывает истечение времени фазы: и в подсказке, и в угадывании ход
 * переходит другой команде.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function onTimeout(room, ctx) {
  if (room.phase === 'clue') {
    addLog(room, `⏱ Капитан команды ${teamName(room.currentTeam)} не успел дать подсказку — ход переходит.`);
    endTurn(room, ctx);
  } else if (room.phase === 'guess') {
    addLog(room, `⏱ Время угадывания вышло — ход переходит.`);
    endTurn(room, ctx);
  }
}

/**
 * Начинает партию: выбирает слова, раскладывает цвета, назначает стартовую
 * команду и запускает фазу подсказки. Мутирует комнату и запускает таймер.
 *
 * @param {import('../core/model').Room} room
 * @param {Array<string>} words - словарь от клиента (может быть неполным)
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function startGame(room, words, ctx) {
  const size = room.settings.boardSize;
  const total = size * size;
  // Берём уникальные слова; если их меньше, чем клеток, — подставляем заглушки.
  let pool = Array.isArray(words) ? [...new Set(words)] : [];
  let chosen = pool.length >= total ? shuffle(pool.slice()).slice(0, total) : null;
  if (!chosen) {
    chosen = [];
    for (let i = 0; i < total; i++) chosen.push('СЛОВО ' + (i + 1));
  }
  const startingTeam = Math.random() < 0.5 ? 'red' : 'blue';
  const colors = layoutFor(size, startingTeam);
  room.board = chosen.map((w, i) => ({ word: w, color: colors[i], revealed: false }));
  room.startingTeam = startingTeam;
  room.currentTeam = startingTeam;
  room.phase = 'clue';
  room.clue = null;
  room.clueHistory = { red: [], blue: [] };
  resetVotes(room);
  room.timer = room.settings.firstMoveTime;
  room.paused = false;
  room.winner = null;
  room.log = [];
  addLog(room, `🎮 Игра началась! Первыми ходят ${teamName(startingTeam)}.`);
  armTimer(room, ctx);
}

/**
 * Передаёт ход другой команде и возвращает фазу к подсказке. Перезапускает
 * таймер на время первого хода.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function endTurn(room, ctx) {
  room.currentTeam = room.currentTeam === 'red' ? 'blue' : 'red';
  room.phase = 'clue';
  room.clue = null;
  resetVotes(room); // новый ход — голоса прошлой команды сбрасываем
  room.timer = room.settings.firstMoveTime;
  armTimer(room, ctx);
}

/**
 * Проверяет, открыла ли какая-то команда все свои карты, и при необходимости
 * завершает игру.
 *
 * @param {import('../core/model').Room} room
 * @returns {boolean} true, если игра завершена этим вызовом
 */
function checkWin(room) {
  const remaining = teamCounts(room);
  if (remaining.red === 0) return finishGame(room, 'red');
  if (remaining.blue === 0) return finishGame(room, 'blue');
  return false;
}

/**
 * Завершает игру победой указанной команды: фиксирует победителя, переводит
 * фазу в over и останавливает таймер.
 *
 * @param {import('../core/model').Room} room
 * @param {('red'|'blue')} winner
 * @returns {boolean} всегда true (удобно для `return finishGame(...)`)
 */
function finishGame(room, winner) {
  room.winner = winner;
  room.phase = 'over';
  timer.clearTimer(room);
  resetVotes(room);
  addLog(room, `🏆 Победа команды ${teamName(winner)}!`);
  return true;
}

/**
 * Капитан текущей команды даёт подсказку «слово + число» и переводит игру в
 * фазу угадывания. Подсказка обязана быть ровно одним словом (без пробелов);
 * число — необязательная цифра-ориентир 0–9 (валидацию формата делает и клиент,
 * см. teams.view → parseClue). Подсказка дописывается в историю команды (room.clueHistory),
 * которая показывается в карточке команды. Молча игнорирует невалидные вызовы
 * (не та фаза/роль/команда, пустое или многословное слово) — сервер не доверяет
 * клиенту (§2.1).
 *
 * @param {import('../core/model').Room} room
 * @param {import('../core/model').Player} player - отправитель
 * @param {string} word - слово-подсказка (ровно одно слово)
 * @param {(number|string)} number - цифра-ориентир 0–9 (необязательна)
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function giveClue(room, player, word, number, ctx) {
  if (room.phase !== 'clue') return;
  if (player.team !== room.currentTeam || player.role !== 'spymaster') return;
  word = String(word || '').trim();
  // Подсказка — строго одно слово: пробел внутри означает попытку ввести два
  // слова, такое отклоняем (валидация дублируется на клиенте для текста ошибки).
  if (!word || /\s/.test(word)) return;
  let num = parseInt(number, 10);
  if (isNaN(num) || num < 0 || num > 9) num = 0; // число — необязательный ориентир
  room.clue = { word, number: num };
  room.clueHistory[room.currentTeam].push({ word, number: num });
  room.phase = 'guess';
  room.timer = room.settings.answerTime;
  addLog(room, `💡 Капитан ${teamName(room.currentTeam)}: «${word}» — ${num === 0 ? '∞' : num}`);
  armTimer(room, ctx);
}

// ---------- Голосование агентов (task 1) ----------

/**
 * Возвращает подключённых агентов текущей команды. Именно их единогласие нужно
 * для открытия карты или пропуска хода — капитан не голосует (он видит цвета).
 *
 * @param {import('../core/model').Room} room
 * @returns {Array<import('../core/model').Player>}
 */
function currentOperatives(room) {
  return Object.values(room.players).filter(
    p => p.team === room.currentTeam && p.role === 'operative' && p.connected
  );
}

/**
 * Полностью сбрасывает голосование и гасит отсчёт. Вызывается при смене хода,
 * старте/конце партии и возврате в лобби. Мутирует комнату.
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function resetVotes(room) {
  room.votes = { cards: {}, skip: [] };
  room.pendingVote = null;
  timer.clearCountdown(room);
}

/**
 * Снимает голос игрока со всех карт и с пропуска (его выбор эксклюзивен —
 * одновременно нельзя голосовать за две вещи). Мутирует room.votes.
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @returns {void}
 */
function clearPlayerVote(room, playerId) {
  for (const idx of Object.keys(room.votes.cards)) {
    const left = room.votes.cards[idx].filter(id => id !== playerId);
    if (left.length) room.votes.cards[idx] = left;
    else delete room.votes.cards[idx];
  }
  room.votes.skip = room.votes.skip.filter(id => id !== playerId);
}

/**
 * Агент текущей команды голосует за карту (или снимает голос повторным кликом).
 * Голос эксклюзивен: новый выбор снимает прежний с другой карты/пропуска. После
 * изменения пересчитывает единогласие. Молча игнорирует невалидные вызовы
 * (не та фаза/роль/команда, пауза, открытая/несуществующая карта).
 *
 * @param {import('../core/model').Room} room
 * @param {import('../core/model').Player} player - отправитель
 * @param {number} index - индекс карты на поле
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function voteCard(room, player, index, ctx) {
  if (room.phase !== 'guess' || room.paused) return;
  if (player.team !== room.currentTeam || player.role !== 'operative') return;
  const card = room.board[index];
  if (!card || card.revealed) return;
  const had = (room.votes.cards[index] || []).includes(player.id);
  clearPlayerVote(room, player.id);
  // Повторный клик по той же карте только снимает голос (had → не добавляем).
  if (!had) (room.votes.cards[index] = room.votes.cards[index] || []).push(player.id);
  reevaluateVotes(room, ctx);
}

/**
 * Агент текущей команды голосует за пропуск хода (или снимает голос повторным
 * кликом). Аналогично voteCard — выбор эксклюзивен. Невалидные вызовы
 * игнорируются.
 *
 * @param {import('../core/model').Room} room
 * @param {import('../core/model').Player} player - отправитель
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function voteSkip(room, player, ctx) {
  if (room.phase !== 'guess' || room.paused) return;
  if (player.team !== room.currentTeam || player.role !== 'operative') return;
  const had = room.votes.skip.includes(player.id);
  clearPlayerVote(room, player.id);
  if (!had) room.votes.skip.push(player.id);
  reevaluateVotes(room, ctx);
}

/**
 * Убирает голос ушедшего/отключившегося игрока и пересчитывает единогласие —
 * иначе его «зависший» голос мешал бы остальным договориться. Применяется только
 * в фазе угадывания; рассылку выполняет вызывающий (см. messageRouter).
 *
 * @param {import('../core/model').Room} room
 * @param {string} playerId
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function handleVoterGone(room, playerId, ctx) {
  if (room.phase !== 'guess') return;
  clearPlayerVote(room, playerId);
  reevaluateVotes(room, ctx);
}

/**
 * Пересчитывает единогласие агентов: если все проголосовали за одну карту или за
 * пропуск — запускает 2-сек отсчёт; иначе отменяет уже идущий. Любое изменение
 * голосов сбрасывает прежний отсчёт (его условие могло перестать выполняться).
 * Рассылку НЕ выполняет: при обработке сообщения это делает messageRouter, а при
 * завершении отсчёта — applyVote.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function reevaluateVotes(room, ctx) {
  timer.clearCountdown(room);
  room.pendingVote = null;
  const ids = currentOperatives(room).map(p => p.id);
  if (!ids.length) return;
  // Единогласие за конкретную карту.
  for (const idx of Object.keys(room.votes.cards)) {
    const voters = room.votes.cards[idx];
    if (voters.length === ids.length && ids.every(id => voters.includes(id))) {
      startVoteCountdown(room, { kind: 'guess', index: +idx }, ctx);
      return;
    }
  }
  // Единогласие за пропуск хода.
  if (room.votes.skip.length === ids.length && ids.every(id => room.votes.skip.includes(id))) {
    startVoteCountdown(room, { kind: 'skip', index: null }, ctx);
  }
}

/**
 * Запускает 2-сек отсчёт перед применением единогласного решения и помечает его
 * в pendingVote (по нему клиент рисует лоадер). Рассылку не делает — состояние с
 * pendingVote уйдёт обычной рассылкой обработчика сообщения.
 *
 * @param {import('../core/model').Room} room
 * @param {{kind:('guess'|'skip'), index:(number|null)}} action
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function startVoteCountdown(room, action, ctx) {
  room.pendingVote = { kind: action.kind, index: action.index };
  timer.startCountdown(room, VOTE_COUNTDOWN_MS, () => applyVote(room, ctx));
}

/**
 * Применяет назревшее единогласное решение по завершении отсчёта: открывает
 * карту или передаёт ход. Вызывается из таймера (асинхронно), поэтому сам
 * рассылает состояние. Голоса сбрасываются ДО действия, чтобы при продолжении
 * хода команда голосовала заново.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function applyVote(room, ctx) {
  const pending = room.pendingVote;
  resetVotes(room);
  if (!pending) return;
  if (pending.kind === 'guess') {
    revealCard(room, pending.index, ctx);
  } else {
    addLog(room, `⏭ Команда ${teamName(room.currentTeam)} пропускает ход.`);
    endTurn(room, ctx);
  }
  ctx.broadcast(room);
}

/**
 * Открывает карту по индексу и применяет последствия по правилам: убийца —
 * мгновенное поражение; своя карта — команда продолжает угадывать (с бонусом
 * времени) и заново голосует; нейтральная/чужая — ход переходит. Счётчика попыток
 * нет: при верном слове ход НЕ передаётся автоматически. Решение коллективное,
 * поэтому в журнал пишется команда, а не отдельный игрок.
 *
 * @param {import('../core/model').Room} room
 * @param {number} index - индекс карты на поле
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function revealCard(room, index, ctx) {
  const card = room.board[index];
  if (!card || card.revealed) return;
  card.revealed = true;
  addLog(room, `👉 Команда ${teamName(room.currentTeam)} открыла «${card.word}»`);

  if (card.color === 'assassin') {
    addLog(room, `💀 Это убийца!`);
    const winner = room.currentTeam === 'red' ? 'blue' : 'red';
    finishGame(room, winner);
    return;
  }
  if (card.color === room.currentTeam) {
    // Верно: команда НЕ теряет ход. Продолжает открывать карты, пока сама не
    // проголосует за пропуск, не ошибётся или не выйдет время. Даём бонус.
    if (checkWin(room)) return;
    room.timer += room.settings.extraTime; // бонус за верный ответ
  } else if (card.color === 'neutral') {
    addLog(room, `Нейтральная карта — ход переходит.`);
    endTurn(room, ctx);
  } else {
    // карта соперника
    addLog(room, `Карта соперника! Ход переходит.`);
    if (checkWin(room)) return;
    endTurn(room, ctx);
  }
}

/**
 * Ставит игру на паузу: останавливает таймер. Лог пишет вызывающий (там есть
 * ник игрока). Применимо только в активных фазах.
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function pauseGame(room) {
  room.paused = true;
  timer.clearTimer(room);
  // Отсчёт голосования тоже замораживаем; голоса (кружки) остаются.
  timer.clearCountdown(room);
  room.pendingVote = null;
}

/**
 * Снимает паузу и заново запускает таймер текущей фазы.
 *
 * @param {import('../core/model').Room} room
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function resumeGame(room, ctx) {
  room.paused = false;
  armTimer(room, ctx);
  // Вдруг единогласие ещё держится (никто не менял голос на паузе) — перезапустим
  // 2-сек отсчёт. reevaluateVotes сам разошлёт через обычную рассылку resume.
  reevaluateVotes(room, ctx);
}

/**
 * Возвращает комнату из завершённой игры в лобби: останавливает таймер и
 * очищает игровое состояние, сохраняя список игроков и настройки.
 *
 * @param {import('../core/model').Room} room
 * @returns {void}
 */
function returnToLobby(room) {
  timer.clearTimer(room);
  resetVotes(room);
  room.phase = 'lobby';
  room.board = [];
  room.clue = null;
  room.winner = null;
  addLog(room, '↩️ Возврат в лобби.');
}

module.exports = {
  startGame, giveClue, voteCard, voteSkip, handleVoterGone, endTurn,
  checkWin, finishGame, pauseGame, resumeGame, returnToLobby
};
