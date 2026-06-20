'use strict';

/**
 * @module ui/board.view
 * Рендер игрового поля: слова, открытые/известные капитану цвета, голосование
 * агентов (кружки проголосовавших + 2-сек лоадер перед открытием карты, task 1)
 * и подсветка карт капитану в начале игры. Для капитана уже открытые карты
 * гасятся в серый (task 3), чтобы внимание было на оставшихся.
 */

import { $ } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';
import { avatarColor } from '../util/color.js';

/**
 * Перерисовывает поле по текущему состоянию.
 * @param {boolean} gameJustStarted - игра только что началась (для подсветки
 *   капитану его карт)
 * @returns {void}
 */
export function renderBoard(gameJustStarted) {
  const state = getState();
  const board = $('#board');
  board.className = 'board size-' + (state.settings.boardSize);
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
    return;
  }
  state.board.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = c.word;
    if (c.revealed) {
      cell.classList.add('revealed', 'c-' + c.color);
      if (dimGuessed) cell.classList.add('dim-guessed');
    } else if (c.color) {
      cell.classList.add('know-' + c.color); // капитан видит цвета
    }
    // При старте игры подсвечиваем капитану его карты.
    if (gameJustStarted && my && my.role === 'spymaster' && !c.revealed && c.color === my.team) {
      cell.classList.add('spotlight');
    }
    if (canGuess && !c.revealed) {
      cell.classList.add('clickable');
      // Клик — это ГОЛОС за карту (повторный клик его снимает). Открытие — только
      // после 2-сек единогласия команды (логика на сервере, task 1).
      cell.addEventListener('click', () => send({ type: IN.GUESS, index: i }));
    }
    // Кружки агентов, проголосовавших за эту карту.
    const voters = votes.cards[i] || [];
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
    // 2-сек лоадер снизу карты, по которой идёт единогласный отсчёт.
    if (pending && pending.kind === 'guess' && pending.index === i) {
      const loader = document.createElement('div');
      loader.className = 'cell-loader';
      loader.innerHTML = '<div class="cell-loader-bar"></div>';
      cell.appendChild(loader);
    }
    board.appendChild(cell);
  });
}
