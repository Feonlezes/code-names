'use strict';

/**
 * @module ui/log.view
 * Рендер журнала событий комнаты (новые события сверху).
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Перерисовывает список событий, показывая последние сверху.
 * @returns {void}
 */
export function renderLog() {
  const state = getState();
  const ul = $('#log');
  ul.innerHTML = '';
  for (const entry of [...state.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = entry.text;
    ul.appendChild(li);
  }
}
