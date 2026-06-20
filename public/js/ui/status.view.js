'use strict';

/**
 * @module ui/status.view
 * Рендер строки статуса (фаза/чей ход), таймера и кнопок паузы/продолжения.
 * Чей сейчас ход в игре показывает не текстовая «плашка», а неоновая подсветка
 * карточки команды (task 4) — поэтому в активных фазах строка фазы скрыта.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Перерисовывает статус-бар: текст фазы (только в лобби/после игры), таймер и
 * кнопки паузы. В активных фазах текст хода убран — его роль играет неоновая
 * подсветка карточки активной команды (task 4). Таймер обновляется каждую
 * секунду (этот рендер вызывается на каждый тик).
 * @returns {void}
 */
export function renderStatus() {
  const state = getState();
  const el = $('#status-text');
  let txt = '';
  if (state.phase === 'lobby') txt = '🛋 Лобби — распределите команды и начните игру';
  else if (state.phase === 'over') txt = state.winner ? `🏆 Победили ${state.winner === 'red' ? 'красные' : 'синие'}!` : 'Игра окончена';
  else if (state.paused) txt = '⏸ Пауза';
  // В активных фазах (clue/guess без паузы) строка пустая — чей ход видно по
  // неоновой подсветке карточки команды.
  el.textContent = txt;
  el.classList.toggle('hidden', txt === '');

  const timerEl = $('#timer');
  const inGame = state.phase === 'clue' || state.phase === 'guess';
  timerEl.classList.toggle('hidden', !inGame);
  if (inGame) {
    $('#timer-val').textContent = state.paused ? '⏸' : state.timer;
    timerEl.classList.toggle('low', !state.paused && state.timer <= 10);
  }
  $('#pause-btn').classList.toggle('hidden', !(inGame && !state.paused));
  $('#resume-btn').classList.toggle('hidden', !(inGame && state.paused));
}
