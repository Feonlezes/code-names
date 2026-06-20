'use strict';

/**
 * @module ui/clue.view
 * Рендер ЦЕНТРАЛЬНОЙ панели подсказки: показывает текущую активную подсказку
 * (фаза guess) или ожидание подсказки капитана (фаза clue). Ввод подсказки,
 * история и кнопка пропуска хода вынесены в карточки команд (см. teams.view,
 * task 4/5/7) — здесь только индикатор.
 */

import { $, escapeHtml } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Перерисовывает центральную панель подсказки в зависимости от фазы.
 * @returns {void}
 */
export function renderClueBar() {
  const state = getState();
  const bar = $('#clue-bar');
  const teamRu = state.currentTeam === 'red' ? 'красных' : 'синих';

  if (state.clue && state.phase === 'guess') {
    // Активная подсказка видна всем; счётчик попыток убран (task 5).
    bar.classList.remove('hidden');
    bar.innerHTML = `<div class="clue-display">💡 ${escapeHtml(state.clue.word)} ` +
      `<span class="num">${state.clue.number === 0 ? '∞' : state.clue.number}</span></div>`;
  } else if (state.phase === 'clue') {
    bar.classList.remove('hidden');
    bar.innerHTML = `<span class="muted">Капитан команды ${teamRu} придумывает подсказку…</span>`;
  } else {
    bar.classList.add('hidden');
  }
}
