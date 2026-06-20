'use strict';

/**
 * @module ui/controls.view
 * Видимость кнопок управления игрой (старт/новая игра/в лобби/перемешать) —
 * зависит от того, хост ли игрок, и от фазы.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Показывает/скрывает кнопки управления по правам и фазе.
 * @returns {void}
 */
export function renderControls() {
  const state = getState();
  const isHost = state.you === state.hostId;
  const lobbyOrOver = state.phase === 'lobby' || state.phase === 'over';
  $('#start-btn').classList.toggle('hidden', !(isHost && state.phase === 'lobby'));
  $('#newgame-btn').classList.toggle('hidden', !(isHost && state.phase === 'over'));
  $('#lobby-btn').classList.toggle('hidden', !(isHost && state.phase === 'over'));
  $('#shuffle-btn').classList.toggle('hidden', !(isHost && lobbyOrOver));
}
