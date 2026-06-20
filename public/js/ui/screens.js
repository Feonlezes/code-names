'use strict';

/**
 * @module ui/screens
 * Навигация между экранами (login/home/room): показывает один экран, скрывая
 * остальные.
 */

import { $, $$ } from '../util/dom.js';

/**
 * Делает активным экран с указанным id, остальные скрывает.
 * @param {string} screenId - id элемента экрана без '#'
 * @returns {void}
 */
export function show(screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + screenId).classList.add('active');
}
