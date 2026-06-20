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
 * Экспорт: startGame, giveClue, makeGuess, endTurn, checkWin, finishGame,
 * pauseGame, resumeGame, returnToLobby.
 */

const { shuffle } = require('../core/rng');
const { layoutFor } = require('../core/board');
const { addLog, teamName, teamCounts } = require('../core/model');
const timer = require('./timerService');

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
  addLog(room, `🏆 Победа команды ${teamName(winner)}!`);
  return true;
}

/**
 * Капитан текущей команды даёт подсказку «слово + число» и переводит игру в
 * фазу угадывания. Подсказка обязана быть ровно одним словом (без пробелов);
 * число — необязательная цифра-ориентир 0–9 (валидацию формата делает и клиент,
 * см. clue.view). Подсказка дописывается в историю команды (room.clueHistory),
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

/**
 * Агент текущей команды открывает карту и применяет последствия по правилам:
 * убийца — мгновенное поражение; своя карта — команда продолжает угадывать (с
 * бонусом времени) и сама решает, когда остановиться (кнопка «Пропустить ход»);
 * нейтральная/чужая — ход переходит. Счётчика попыток нет: при верном слове ход
 * НЕ передаётся автоматически (см. task 5 / client.md). Невалидные вызовы
 * игнорируются.
 *
 * @param {import('../core/model').Room} room
 * @param {import('../core/model').Player} player - отправитель
 * @param {number} index - индекс карты на поле
 * @param {EngineCtx} ctx
 * @returns {void}
 */
function makeGuess(room, player, index, ctx) {
  if (room.phase !== 'guess') return;
  if (player.team !== room.currentTeam || player.role !== 'operative') return;
  const card = room.board[index];
  if (!card || card.revealed) return;
  card.revealed = true;
  addLog(room, `👉 ${player.nickname} открыл «${card.word}»`);

  if (card.color === 'assassin') {
    addLog(room, `💀 Это убийца!`);
    const winner = room.currentTeam === 'red' ? 'blue' : 'red';
    finishGame(room, winner);
    return;
  }
  if (card.color === room.currentTeam) {
    // Верно: команда НЕ теряет ход. Продолжает открывать карты, пока сама не
    // нажмёт «Пропустить ход», не ошибётся или не выйдет время. Даём бонус.
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
  room.phase = 'lobby';
  room.board = [];
  room.clue = null;
  room.winner = null;
  addLog(room, '↩️ Возврат в лобби.');
}

module.exports = {
  startGame, giveClue, makeGuess, endTurn,
  checkWin, finishGame, pauseGame, resumeGame, returnToLobby
};
