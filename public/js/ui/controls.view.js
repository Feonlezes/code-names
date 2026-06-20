'use strict';

/**
 * @module ui/controls.view
 * Видимость кнопок управления игрой (старт/новая игра/в лобби/перемешать) —
 * зависит от того, хост ли игрок, и от фазы. Кнопки живут в нижней карточке
 * #game-controls (того же вида, что таймер); сама карточка скрыта, когда ни одна
 * кнопка не активна (иначе в активной игре висела бы пустая карточка).
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Показывает/скрывает кнопки управления по правам и фазе и саму нижнюю карточку
 * #game-controls (если в ней нет ни одной видимой кнопки — прячем).
 * @returns {void}
 */
export function renderControls() {
  const state = getState();
  const isHost = state.you === state.hostId;
  const lobbyOrOver = state.phase === 'lobby' || state.phase === 'over';
  const showStart = isHost && state.phase === 'lobby';
  const showNew = isHost && state.phase === 'over';
  const showLobby = isHost && state.phase === 'over';
  const showShuffle = isHost && lobbyOrOver;
  $('#start-btn').classList.toggle('hidden', !showStart);
  $('#newgame-btn').classList.toggle('hidden', !showNew);
  $('#lobby-btn').classList.toggle('hidden', !showLobby);
  $('#shuffle-btn').classList.toggle('hidden', !showShuffle);
  $('#game-controls').classList.toggle('hidden', !(showStart || showNew || showLobby || showShuffle));
}
