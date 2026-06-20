'use strict';

/**
 * @module ui/board.view
 * Рендер игрового поля: слова, открытые/известные капитану цвета, кликабельность
 * карт для текущего угадывающего и подсветка карт капитану в начале игры.
 */

import { $ } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';

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

  if (!state.board.length) {
    board.innerHTML = '<p class="muted board-waiting" style="grid-column:1/-1;align-self:center;text-align:center">Ожидание начала игры…</p>';
    return;
  }
  state.board.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = c.word;
    if (c.revealed) cell.classList.add('revealed', 'c-' + c.color);
    else if (c.color) cell.classList.add('know-' + c.color); // капитан видит цвета
    // При старте игры подсвечиваем капитану его карты.
    if (gameJustStarted && my && my.role === 'spymaster' && !c.revealed && c.color === my.team) {
      cell.classList.add('spotlight');
    }
    if (canGuess && !c.revealed) {
      cell.classList.add('clickable');
      cell.addEventListener('click', () => send({ type: IN.GUESS, index: i }));
    }
    board.appendChild(cell);
  });
}
