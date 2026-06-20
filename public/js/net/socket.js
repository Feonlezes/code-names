'use strict';

/**
 * @module net/socket
 * WebSocket-клиент: подключение, отправка, авто-переподключение к последней
 * комнате. Разбор сообщений делегируется через setMessageHandler, чтобы модуль
 * не зависел от UI (инверсия зависимостей).
 * Экспорт: connect, send, setMessageHandler, isOpen, closeSocket.
 */

import { LS } from '../storage/localStore.js';
import { IN } from './messages.js';

let ws = null;
let reconnectTimer = null;
let messageHandler = () => {};

/**
 * Устанавливает обработчик входящих сообщений (обычно из main.js).
 * @param {(msg: Object) => void} fn
 * @returns {void}
 */
export function setMessageHandler(fn) { messageHandler = fn; }

/**
 * Открывает соединение с сервером. При обрыве, если известна комната,
 * переподключается через 1.5 с и снова входит в неё.
 * @param {() => void} [onOpen] - колбэк после успешного открытия
 * @returns {void}
 */
export function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { if (onOpen) onOpen(); };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
    messageHandler(msg);
  };
  ws.onclose = () => {
    if (LS.room) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connect(() => send({ type: IN.JOIN_ROOM, code: LS.room, playerId: LS.id, nickname: LS.nick }));
      }, 1500);
    }
  };
  ws.onerror = () => {};
}

/**
 * Отправляет объект на сервер, если соединение открыто.
 * @param {Object} obj
 * @returns {void}
 */
export function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/** @returns {boolean} открыто ли соединение */
export function isOpen() { return !!ws && ws.readyState === WebSocket.OPEN; }

/**
 * Закрывает соединение без авто-переподключения (для logout).
 * @returns {void}
 */
export function closeSocket() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}
