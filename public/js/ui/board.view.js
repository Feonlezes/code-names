'use strict';

/**
 * @module ui/board.view
 * Рендер игрового поля: слова, открытые/известные капитану цвета, голосование
 * агентов (кружки проголосовавших + 2-сек лоадер перед открытием карты, task 1)
 * и подсветка карт капитану при заходе за лидера (пульсирующее свечение в цвет
 * карты). Для капитана уже открытые карты гасятся в серый (task 3), чтобы
 * внимание было на оставшихся.
 */

import { $ } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';
import { avatarColor } from '../util/color.js';
import { soundCardClick, soundReveal } from '../audio/sound.js';

// Подписи прошлого кадра — чтобы отличить «голос только что изменился» (играем
// эффект клика по карте у всех в команде) и «карта только что открылась» (звук
// выбора). null до первого рендера, чтобы не звучать/мигать при входе в комнату.
let prevVoteSig = null;   // Map<number,string> — кто голосовал за карту i
let prevRevealed = null;  // Set<number> — какие карты были открыты

/**
 * Перерисовывает поле по текущему состоянию.
 * @param {boolean} spotlightSpymaster - игрок только что зашёл за лидера в
 *   активной игре (старт партии или смена роли на паузе) — подсвечиваем
 *   капитану его карты миганием в цвет карточки
 * @returns {void}
 */
export function renderBoard(spotlightSpymaster) {
  const state = getState();
  const board = $('#board');
  // Число колонок берём из РЕАЛЬНОГО размера доски (она всегда квадратная: 25 или
  // 36 карт), а не из настроек. Иначе после партии 5×5 смена настройки на 6×6
  // (доска ещё старая, 25 карт) рисовала бы 6 колонок поверх 25 карт — «битую»
  // сетку 4 ряда по 6 + 1. Новая доска нужного размера появится при старте партии.
  const cols = state.board.length ? Math.round(Math.sqrt(state.board.length)) : state.settings.boardSize;
  board.className = 'board size-' + cols;
  // Пометка текущей команды на поле — задаёт цвет лоадера выбора карты (см.
  // .board.turn-red/blue .cell-loader-bar в CSS).
  if (state.currentTeam) board.classList.add('turn-' + state.currentTeam);
  board.innerHTML = '';
  const my = me();
  const canGuess = my && state.phase === 'guess' && my.team === state.currentTeam &&
                   my.role === 'operative' && !state.paused;
  // Капитан видит цвета; уже открытые карты для него гасим в серый (task 3),
  // но не в конце игры — там поле остаётся цветным для всех.
  const dimGuessed = my && my.role === 'spymaster' && state.phase !== 'over';
  const votes = state.votes || { cards: {}, skip: [] };
  const pending = state.pendingVote;

  if (!state.board.length) {
    board.innerHTML = '<p class="muted board-waiting" style="grid-column:1/-1;align-self:center;text-align:center">Ожидание начала игры…</p>';
    prevVoteSig = null; prevRevealed = null; // сброс между партиями (лобби)
    return;
  }

  // Текущие подписи голосов/открытых карт и флаг «появилась новая открытая карта».
  const curVoteSig = new Map();
  const curRevealed = new Set();
  let revealedNew = false;

  state.board.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = c.word;
    const voters = votes.cards[i] || [];
    const sig = voters.join(',');
    curVoteSig.set(i, sig);
    if (c.revealed) {
      cell.classList.add('revealed', 'c-' + c.color);
      if (dimGuessed) cell.classList.add('dim-guessed');
      curRevealed.add(i);
      if (prevRevealed && !prevRevealed.has(i)) revealedNew = true;
    } else if (c.color) {
      cell.classList.add('know-' + c.color); // капитан видит цвета
    }
    // Эффект клика, видимый всей команде: если набор проголосовавших за эту
    // (ещё закрытую) карту изменился с прошлого кадра — кто-то только что
    // кликнул, кратко «пульсируем» картой у всех (см. .vote-pulse в CSS).
    if (!c.revealed && prevVoteSig && (prevVoteSig.get(i) || '') !== sig) {
      cell.classList.add('vote-pulse');
    }
    // При заходе за лидера подсвечиваем капитану его карты (мигание в цвет карты).
    if (spotlightSpymaster && my && my.role === 'spymaster' && !c.revealed && c.color === my.team) {
      cell.classList.add('spotlight');
    }
    if (canGuess && !c.revealed) {
      cell.classList.add('clickable');
      // Клик — это ГОЛОС за карту (повторный клик его снимает). Открытие — только
      // после единогласия команды (логика на сервере, task 1). Звук клика — из файла.
      cell.addEventListener('click', () => { soundCardClick(); send({ type: IN.GUESS, index: i }); });
    }
    // Кружки агентов, проголосовавших за эту карту.
    if (voters.length) {
      const wrap = document.createElement('div');
      wrap.className = 'vote-dots';
      for (const id of voters) {
        const dot = document.createElement('span');
        dot.className = 'vote-dot';
        if (id === state.you) dot.classList.add('mine');
        dot.style.background = avatarColor(id);
        wrap.appendChild(dot);
      }
      cell.appendChild(wrap);
    }
    // Лоадер единогласия снизу карты, по которой идёт отсчёт (1.5 с, task 1).
    if (pending && pending.kind === 'guess' && pending.index === i) {
      const loader = document.createElement('div');
      loader.className = 'cell-loader';
      loader.innerHTML = '<div class="cell-loader-bar"></div>';
      cell.appendChild(loader);
    }
    board.appendChild(cell);
  });

  // Звук выбора карты: команда открыла новую карту (по единогласию) — звучит у
  // всех. На первом кадре (prevRevealed === null) молчим, чтобы не звучать при
  // входе/переподключении посреди партии с уже открытыми картами.
  if (revealedNew) soundReveal();
  prevVoteSig = curVoteSig;
  prevRevealed = curRevealed;
}
