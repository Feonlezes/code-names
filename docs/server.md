# Серверные модули

Серверный код — CommonJS, лежит в `src/`. Слои и принципы — в
[architecture.md](architecture.md).

## Точка входа

| Файл | Назначение |
|---|---|
| `server.js` | Собирает HTTP-сервер статики, навешивает WebSocket-слой, слушает порт. |

## `src/config.js`

Единая конфигурация: `PORT`, `PUBLIC_DIR`, `MIME`, `PING_INTERVAL`,
`DEFAULT_SETTINGS`. Изменяемые параметры держим здесь, а не по месту
использования.

## `src/core/` — чистое ядро (без I/O)

| Модуль | Содержимое |
|---|---|
| `core/rng.js` | `shuffle`, `randomInt`, `randomCode` — генераторы случайности. |
| `core/board.js` | `layoutFor` — раскладка цветов карт по правилам Codenames. |
| `core/model.js` | Фабрика `createRoomObject`, типы (JSDoc), `addLog`, `teamName`, `teamCounts`. |

## `src/services/` — доменная логика

| Модуль | Содержимое |
|---|---|
| `services/gameEngine.js` | Партия: `startGame`, `giveClue`, `makeGuess`, `endTurn`, `checkWin`, `finishGame`, `pauseGame`, `resumeGame`, `returnToLobby`. Чистый — рассылку получает через `ctx.broadcast`. `giveClue` пишет подсказку в `room.clueHistory`; `makeGuess` при верной карте ход НЕ передаёт (счётчика попыток нет — команда жмёт «Пропустить ход»). |
| `services/roomService.js` | Реестр комнат и участники: `createRoom`, `getRoom`, `addPlayer` (новичок входит наблюдателем — `team: null`, команду выбирает сам), `disconnectPlayer`, `removePlayer`, `reassignHost`, `maybeCleanup`, `shuffleTeams`, `setTeamRole` (правило одного капитана: запрос на второго `spymaster` понижается до `operative`), `changeNickname`, `updateSettings`. |
| `services/timerService.js` | Механизм пофазного таймера: `startTimer(room, onTick, onExpire)`, `clearTimer`. Не знает про игровые правила. |
| `services/serializer.js` | `stateFor` — снимок состояния для конкретного игрока; единственная точка, где скрываются цвета карт. |

## `src/transport/` — ввод-вывод

| Модуль | Содержимое |
|---|---|
| `transport/httpStatic.js` | `createHttpServer` — отдача статики из `public/` + защита от path traversal. |
| `transport/wsServer.js` | `attachWebSocket` — WebSocket-сервер поверх HTTP и heartbeat (ping/pong). |
| `transport/messageRouter.js` | `handleConnection` — разбор входящих сообщений, проверка прав, вызов сервисов и рассылка. При входе заменяет устаревшие сокеты того же игрока, а `close` не помечает игрока offline, если у него остался живой сокет — иначе гонка «переподключение → запоздалый close» обрывала игроку рассылку (таймер/подсказки/события «зависали»). |

## `src/shared/`

| Модуль | Содержимое |
|---|---|
| `shared/messages.js` | Константы типов сообщений `IN`/`OUT`. Детали — в [protocol.md](protocol.md). |
