# Как создать туннель Cloudflare и узнать его ссылку

Короткая пошаговая инструкция: поднять туннель к локальному серверу и получить
публичный `https://…trycloudflare.com`-адрес, чтобы друг из другой сети зашёл в
комнату. Общий обзор способов доступа — в [hosting.md](hosting.md).

> Аккаунт Cloudflare и открытие портов не нужны: туннель идёт исходящим
> соединением и сам пробрасывает публичный адрес на твой `localhost:3000`.

## 0. Предусловия

- Сервер игры запущен (в отдельном окне): `npm start` → `http://localhost:3000`.
- Установлен `cloudflared` (один раз):

  ```powershell
  winget install --id Cloudflare.cloudflared
  ```

## 1. Создать туннель

В **новом** окне PowerShell (сервер при этом работает в другом):

```powershell
cloudflared tunnel --url http://localhost:3000
```

Если окно не находит команду (только что установили — PATH мог не обновиться),
запусти по полному пути:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
```

## 2. Узнать ссылку туннеля

Сразу после запуска `cloudflared` печатает рамку с адресом — он **в первых
строках** вывода:

```
+--------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:            |
|  https://случайные-слова-1234.trycloudflare.com              |
+--------------------------------------------------------------+
```

Нужен этот `https://…trycloudflare.com`. Дальше идут строки `INF …`
(`Registered tunnel connection` и т. п.) — это нормально, адрес выше них.
Если рамку «увело» вверх — прокрути окно к началу вывода.

### Надёжный способ — записать адрес в файл

Чтобы не искать в логе, запусти туннель с выводом в файл и прочитай адрес
оттуда:

```powershell
# запуск в фоне с записью лога
$log = "$env:TEMP\cf_tunnel.log"
Start-Process -FilePath "C:\Program Files (x86)\cloudflared\cloudflared.exe" `
  -ArgumentList 'tunnel','--url','http://localhost:3000' `
  -RedirectStandardError $log -RedirectStandardOutput "$env:TEMP\cf_tunnel.out" `
  -WindowStyle Hidden

# через 3–5 секунд — вытащить адрес
Start-Sleep -Seconds 5
(Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com').Matches[0].Value
```

Последняя команда выведет готовый адрес, например
`https://случайные-слова-1234.trycloudflare.com`.

### Самый простой способ — скрипт `npm run tunnel:cf`

Чтобы не возиться с фоновым запуском и парсингом лога вручную, есть готовый
скрипт ([scripts/tunnel-cf.ps1](../scripts/tunnel-cf.ps1)): он сам находит
`cloudflared` (в `PATH` или по стандартному пути установки), поднимает туннель,
вытаскивает адрес `*.trycloudflare.com` и печатает кликабельную ссылку.

```powershell
npm run tunnel:cf
# сразу с кодом комнаты:
npm run tunnel:cf -- -Room ABCD
# другой порт, если сервер не на 3000:
npm run tunnel:cf -- -Port 4000
```

Скрипт выведет:

```
  Домен туннеля: https://случайные-слова-1234.trycloudflare.com
  Ссылка другу:  https://случайные-слова-1234.trycloudflare.com/?room=КОД
  Открыть/скопировать: https://случайные-слова-1234.trycloudflare.com   ← кликабельно
```

Окно со скриптом держим открытым (закрыл — туннель умер); `Ctrl+C` — остановить.
Аналог на localhost.run без установки — `npm run tunnel` (см.
[hosting.md](hosting.md) §4), но задержка там обычно выше.

## 3. Собрать ссылку для друга

Возьми адрес туннеля и добавь код комнаты (4 символа из шапки «Комната»):

```
https://случайные-слова-1234.trycloudflare.com/?room=КОД
```

Друг вставляет её **в адресную строку браузера** (не в поиск) → попадает в твою
комнату. Сначала проверь сам: открой этот адрес у себя — должна загрузиться игра.

## 4. Остановить / нюансы

- Остановить туннель: `Ctrl+C` в его окне. Запущенный в фоне через
  `Start-Process` — `Get-Process cloudflared | Stop-Process`.
- Должны работать **оба** процесса: `npm start` и `cloudflared`. Остановишь
  сервер — комната пропадёт; остановишь туннель — ссылка перестанет открываться.
- Адрес `trycloudflare` **временный**: при каждом перезапуске туннеля он новый —
  просто отправь другу обновлённую ссылку.
