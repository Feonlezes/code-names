'use strict';

/**
 * @module transport/wsServer
 * Поднимает WebSocket-сервер поверх HTTP-сервера, направляет новые соединения
 * в messageRouter и поддерживает heartbeat (ping/pong) для отсева мёртвых
 * соединений. Экспорт: attachWebSocket.
 */

const { WebSocketServer } = require('ws');
const { PING_INTERVAL } = require('../config');
const router = require('./messageRouter');

/**
 * Привязывает WebSocket-сервер к HTTP-серверу и запускает heartbeat.
 *
 * @param {import('http').Server} httpServer - базовый HTTP-сервер
 * @returns {WebSocketServer} активный WebSocket-сервер
 */
function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    // Отключаем алгоритм Нейгла на сокете соединения: игра интерактивная и шлёт
    // мелкие сообщения-намерения, а Nagle + delayed-ACK копят их и добавляют
    // десятки–сотни мс задержки на каждое действие — особенно заметно через
    // туннель (publicный round-trip). Для игры важнее мгновенная доставка, чем
    // экономия на размере пакета. _socket — нижележащий TCP-сокет ws.
    try { ws._socket.setNoDelay(true); } catch (e) {}
    router.handleConnection(ws);
  });

  // Периодический ping: соединение, не ответившее pong с прошлого цикла,
  // считается мёртвым и закрывается.
  const ping = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, PING_INTERVAL);
  wss.on('close', () => clearInterval(ping));

  return wss;
}

module.exports = { attachWebSocket };
