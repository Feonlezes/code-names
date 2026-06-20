'use strict';

/**
 * @module ui/settings.view
 * Рендер формы настроек комнаты и чтение её значений. Редактировать может
 * только хост и только вне игры; активное поле не затирается при перерисовке.
 */

import { $ } from '../util/dom.js';
import { getState } from '../state/store.js';

/**
 * Заполняет и блокирует/разблокирует поля настроек по правам и фазе.
 * @returns {void}
 */
export function renderSettings() {
  const state = getState();
  const s = state.settings;
  const isHost = state.you === state.hostId;
  const editable = isHost && (state.phase === 'lobby' || state.phase === 'over');
  // Не затираем поле, если пользователь сейчас его редактирует.
  const active = document.activeElement;
  ['#set-size', '#set-first', '#set-answer', '#set-extra'].forEach(sel => {
    const elx = $(sel);
    if (elx !== active) {
      if (sel === '#set-size') elx.value = s.boardSize;
      if (sel === '#set-first') elx.value = s.firstMoveTime;
      if (sel === '#set-answer') elx.value = s.answerTime;
      if (sel === '#set-extra') elx.value = s.extraTime;
    }
    elx.disabled = !editable;
  });
  $('#save-settings').disabled = !editable;
  // Перезапуск партии — действие хоста; доступно в любой фазе (сервер тоже проверяет).
  $('#restart-game').disabled = !isHost;
  $('#settings-host-note').textContent = isHost ? '' : '(меняет лидер комнаты)';
}

/**
 * Считывает значения формы настроек с подстановкой дефолтов на пустые поля.
 * @returns {{boardSize:number, firstMoveTime:number, answerTime:number, extraTime:number}}
 */
export function readSettingsForm() {
  return {
    boardSize: parseInt($('#set-size').value, 10) || 5,
    firstMoveTime: parseInt($('#set-first').value, 10) || 120,
    answerTime: parseInt($('#set-answer').value, 10) || 60,
    extraTime: parseInt($('#set-extra').value, 10) || 0
  };
}
