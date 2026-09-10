'use strict';

/**
 * Точка входа сервера Codenames. Собирает HTTP-сервер статики, навешивает на
 * него WebSocket-слой и начинает слушать порт. Вся логика вынесена в модули
 * src/ (см. docs/architecture.md и docs/server.md).
 */

const { PORT, HOST } = require('./src/config');
const { createHttpServer } = require('./src/transport/httpStatic');
const { attachWebSocket } = require('./src/transport/wsServer');

const server = createHttpServer();
attachWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`\n  🎮 Codenames запущен:  http://localhost:${PORT}  (интерфейс ${HOST})\n`);
});
