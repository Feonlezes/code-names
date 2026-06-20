'use strict';

/**
 * @module storage/localStore
 * Обёртка над localStorage: идентификатор игрока (создаётся при первом
 * обращении), никнейм и код последней комнаты для авто-переподключения.
 */

const KEYS = { id: 'cn_player_id', nick: 'cn_nick', room: 'cn_room' };

export const LS = {
  /** Постоянный id игрока; генерируется и сохраняется при первом чтении. */
  get id() {
    let id = localStorage.getItem(KEYS.id);
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEYS.id, id);
    }
    return id;
  },
  get nick() { return localStorage.getItem(KEYS.nick) || ''; },
  set nick(v) { v ? localStorage.setItem(KEYS.nick, v) : localStorage.removeItem(KEYS.nick); },
  get room() { return localStorage.getItem(KEYS.room) || ''; },
  set room(v) { v ? localStorage.setItem(KEYS.room, v) : localStorage.removeItem(KEYS.room); }
};
