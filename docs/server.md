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
| `core/model.js` | Фабрика `createRoomObject`, типы (JSDoc), `addLog`, `teamName`, `teamCounts`. Комната хранит голосование агентов (task 1): `votes` (`{cards, skip}`), `pendingVote` (идущий отсчёт) и внутренний `_voteTimeout` (не сериализуется). Поле `stopped` — общая F9-«стоп-пауза» (task 3). Игрок может иметь флаги `admin` (вход по `/admin`, права админ-панели), `xray` (личный X-ray) и `bot` (фейковый игрок без сокета, добавленный админом). |

## `src/services/` — доменная логика

| Модуль | Содержимое |
|---|---|
| `services/gameEngine.js` | Партия: `startGame`, `giveClue`, `voteCard`, `voteSkip`, `handleVoterGone`, `endTurn`, `checkWin`, `finishGame`, `pauseGame`, `resumeGame`, `returnToLobby`. Чистый — рассылку получает через `ctx.broadcast`. `giveClue` пишет подсказку в `room.clueHistory`. **Редактирование подсказок (task 1):** `editClue` позволяет капитану во время партии (фазы `clue`/`guess`) исправить уже данную СВОЕЙ командой подсказку по индексу в `clueHistory[team]`; если правится активная подсказка (последняя у ходящей команды в `guess`), синхронно обновляется `room.clue`. Валидация слова/числа — как в `giveClue`; фазу и таймер не трогает. **Время хода лидера (task 3):** удлинённое `firstMoveTime` (120с) даётся ТОЛЬКО на самый первый ход партии — его выставляет `startGame`; все последующие ходы лидера через `endTurn` получают `answerTime` (60с) и никогда не превышают первый. Фаза угадывания (`giveClue`) — тоже `answerTime`. **Голосование агентов (task 1):** `voteCard`/`voteSkip` переключают голос игрока (эксклюзивно), пересчитывают единогласие и при согласии всех подключённых агентов команды запускают 1.5-сек отсчёт (`VOTE_COUNTDOWN_MS`) через `timerService.startCountdown`; по завершении внутренний `applyVote` открывает карту (`revealCard`) или передаёт ход (`endTurn`). Верная карта ход НЕ передаёт. `handleVoterGone` снимает голос ушедшего и пересчитывает согласие. `returnToLobby` (кнопка «Завершить игру» в настройках) достижима в т. ч. из паузы, поэтому снимает флаг `paused` (и `stopped`). **F9-«стоп-пауза» (task 3):** `toggleStop` переключает общий `room.stopped`; при включении замораживает таймер хода и отсчёт голосования, при выключении заново вооружает таймер активной фазы (если не на ручной паузе) и пересчитывает единогласие. **Кворум голосования** (`currentOperatives`) исключает ботов — у них нет сокета, иначе их «зависший» голос навсегда блокировал бы единогласие (task 2). `startGame`/`returnToLobby` сбрасывают `stopped`. **Админ-панель:** `adminAddClue` дописывает сгенерированную подсказку в историю команды (кнопка «Добавить ответ»), не меняя фазу/таймер/активную подсказку. |
| `services/roomService.js` | Реестр комнат и участники: `createRoom`, `getRoom`, `addPlayer` (новичок входит наблюдателем — `team: null`, команду выбирает сам; необязательный `isAdmin` ставит флаг `admin`), `disconnectPlayer`, `removePlayer`, `reassignHost`, `maybeCleanup`, `shuffleTeams`, `setTeamRole` (правило одного капитана: запрос на второго `spymaster` понижается до `operative`), `changeNickname`, `updateSettings`. **Модерация/админ (task 1, 2):** `setHost` (передать корону лидера; бота лидером не делает), `moveToObservers` (перевести игрока в наблюдатели), `addBot` (добавить фейкового игрока-агента за команду/наблюдателем). `reassignHost` и `maybeCleanup` игнорируют ботов: бот не может стать лидером, и комната с одними ботами очищается после ухода всех людей. |
| `services/timerService.js` | Механизм таймеров комнаты: пофазный `startTimer(room, onTick, onExpire)` / `clearTimer` (поле `_interval`) и одноразовый отсчёт голосования `startCountdown(room, ms, onDone)` / `clearCountdown` (поле `_voteTimeout`, task 1). Не знает про игровые правила. |
| `services/serializer.js` | `stateFor` — снимок состояния для конкретного игрока; единственная точка, где скрываются цвета карт. Цвета невскрытых карт видны капитану, в фазе `over` и агенту с личным X-ray (task 2: `me.xray` → раскрытие только в его снимке). Отдаёт также `votes`/`pendingVote` (task 1), `stopped` (F9-пауза, task 3) и `xray` (состояние личного флага) — секретов в них нет. |

## `src/transport/` — ввод-вывод

| Модуль | Содержимое |
|---|---|
| `transport/httpStatic.js` | `createHttpServer` — отдача статики из `public/` + защита от path traversal. По префиксу `/admin` (например, `/admin/?room=JSXA`) отдаёт ту же статику, что и из корня (срезает префикс) — так включается админ-режим клиента, а относительные пути ассетов продолжают работать. |
| `transport/wsServer.js` | `attachWebSocket` — WebSocket-сервер поверх HTTP и heartbeat (ping/pong). На каждом соединении выключает алгоритм Нейгла (`ws._socket.setNoDelay(true)`): игра шлёт мелкие сообщения-намерения, а Nagle + delayed-ACK добавляют десятки–сотни мс задержки на действие (особенно заметно через туннель). |
| `transport/messageRouter.js` | `handleConnection` — разбор входящих сообщений, проверка прав, вызов сервисов и рассылка. **Права (task 1, 2):** модерацию (`setHost`/`moveObserver`) выполняет лидер комнаты ИЛИ игрок с флагом `admin`; админ-действия (`adminAddPlayer`/`adminWin`/`adminXray`) — только `admin`; `toggleStop` (F9) — любой игрок. Флаг `admin` приходит в `createRoom`/`joinRoom` (`msg.admin`) и ставится на игрока (`addPlayer`). `startGame`/`newGame` (только хост) могут нести необязательные `settings`: тогда роутер сперва зовёт `roomService.updateSettings`, затем `gameEngine.startGame` — так кнопка «Сохранить и начать игру» применяет настройки и (пере)запускает партию одним сообщением в любой фазе. При входе заменяет устаревшие сокеты того же игрока, а `close` не помечает игрока offline, если у него остался живой сокет — иначе гонка «переподключение → запоздалый close» обрывала игроку рассылку (таймер/подсказки/события «зависали»). |

## `src/shared/`

| Модуль | Содержимое |
|---|---|
| `shared/messages.js` | Константы типов сообщений `IN`/`OUT`. Детали — в [protocol.md](protocol.md). |
