'use strict';

/**
 * @module ui/status.view
 * Рендер строки статуса (фаза/чей ход), таймера и кнопок паузы/продолжения,
 * а также «мигание» заголовка при смене хода.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Перерисовывает статус-бар: текст фазы, таймер и кнопки паузы. Таймер
 * обновляется каждую секунду (этот рендер вызывается на каждый тик).
 * @returns {void}
 */
export function renderStatus() {
  const state = getState();
  const el = $('#status-text');
  el.classList.remove('turn-red', 'turn-blue');
  let txt = '';
  if (state.phase === 'lobby') txt = '🛋 Лобби — распределите команды и начните игру';
  else if (state.phase === 'over') txt = state.winner ? `🏆 Победили ${state.winner === 'red' ? 'красные' : 'синие'}!` : 'Игра окончена';
  else {
    const team = state.currentTeam === 'red' ? 'красных' : 'синих';
    el.classList.add('turn-' + state.currentTeam);
    txt = state.phase === 'clue' ? `Ход ${team}: капитан даёт подсказку` : `Ход ${team}: команда угадывает`;
    if (state.paused) txt += ' (пауза)';
  }
  el.textContent = txt;

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

/**
 * Двойное мигание заголовка хода цветом команды (перезапуск CSS-анимации).
 * @param {('red'|'blue')} team
 * @returns {void}
 */
export function flashStatus(team) {
  const el = $('#status-text');
  el.classList.remove('flash-red', 'flash-blue');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add('flash-' + team);
}
