<#
.SYNOPSIS
    Поднимает игру одной командой: сервер + публичный туннель + готовая ссылка.

.DESCRIPTION
    Заменяет связку из двух окон (`npm start` и `npm run tunnel`). Скрипт:
    (1) гасит туннель прошлого запуска, если тот остался висеть в фоне;
    (2) поднимает сервер, а если порт уже занят — использует работающий сервер и
        не трогает его (идущую партию запуск скрипта не обрывает);
    (3) поднимает туннель выбранного провайдера и вытаскивает публичный адрес;
    (4) печатает домен и ссылку с ?room=;
    (5) держит туннель живым, пока открыто окно, и гасит за собой процессы.

    Гашение навешено на три события: блок finally, событие выхода PowerShell
    (Ctrl+C, exit) и очистка pid-файлов при следующем запуске — последнее
    страхует случай, когда окно закрыли крестиком и штатное завершение не
    отработало. Сервер гасится только если его поднял сам скрипт.

.PARAMETER Port
    Локальный порт сервера. По умолчанию 3000.

.PARAMETER Room
    Код комнаты (4 символа из шапки «Комната»). Если задан — подставляется
    в готовую ссылку вместо плейсхолдера КОД.

.PARAMETER Provider
    Провайдер туннеля: 'cf' — Cloudflare (нужен cloudflared, задержка ниже),
    'lhr' — localhost.run (нужен только штатный ssh). По умолчанию 'cf'.

.EXAMPLE
    npm run play
    # сервер на 3000 + туннель Cloudflare + ссылка

.EXAMPLE
    npm run play -- -Room ABCD
    # сразу готовая ссылка с кодом комнаты

.EXAMPLE
    npm run play:lhr
    # то же самое, но через localhost.run (без установки cloudflared)
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [string]$Room,
    [ValidateSet('cf', 'lhr')][string]$Provider = 'cf'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\tunnel.common.ps1')
Set-ConsoleUtf8

$root = Split-Path $PSScriptRoot -Parent

# ---------- Хвосты прошлого запуска ----------

# Туннель прошлого запуска бесполезен (адрес всё равно будет новый), а висящий
# процесс мешает разобраться, что происходит. Сервер тут намеренно не трогаем.
if (Stop-TrackedProcess -Name 'tunnel' -Port $Port) {
    Write-Host "Погашен туннель прошлого запуска." -ForegroundColor DarkGray
}

# ---------- Сервер ----------

$startedServer = $false

if (Test-PortListening -Port $Port) {
    Write-Host "Сервер уже слушает порт $Port — использую его." -ForegroundColor DarkGray
}
else {
    # Порт свободен, значит записанный ранее сервер мёртв — чистим его pid-файл.
    Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null

    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Write-Host "Не найден node. Установи Node.js: https://nodejs.org/" -ForegroundColor Red
        exit 1
    }

    $serverOut = Join-Path $env:TEMP "codenames_server_$Port.log"
    $serverErr = Join-Path $env:TEMP "codenames_server_$Port.err"
    Remove-Item $serverOut, $serverErr -ErrorAction SilentlyContinue

    Write-Host "Поднимаю сервер на localhost:$Port ..." -ForegroundColor Cyan

    # Порт сервер читает из переменной окружения (см. src/config.js), дочерний
    # процесс наследует её от нас.
    $env:PORT = "$Port"
    $serverProc = Start-Process -FilePath $node -PassThru -WindowStyle Hidden `
        -WorkingDirectory $root -ArgumentList 'server.js' `
        -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
    Save-TrackedProcess -Name 'server' -Port $Port -Process $serverProc -Marker 'server.js'
    $startedServer = $true

    # Готовность определяем по занятому порту, а не по строке в логе: так не
    # зависим от текста приветствия сервера.
    $up = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if ($serverProc.HasExited) { break }
        if (Test-PortListening -Port $Port) { $up = $true; break }
    }

    if (-not $up) {
        Write-Host "Сервер не поднялся на порту $Port." -ForegroundColor Red
        foreach ($f in @($serverErr, $serverOut)) {
            if (Test-Path $f) { Get-Content $f | Write-Host -ForegroundColor DarkGray }
        }
        Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null
        exit 1
    }
}

# Занятый порт ещё не значит рабочий сайт: до туннеля убеждаемся, что сервер
# реально отдаёт страницу. Иначе друг получит «не удаётся получить доступ», а
# причина будет выглядеть как проблема туннеля.
Write-Host "Проверяю сервер на localhost:$Port ..." -ForegroundColor Cyan
if (-not (Wait-HttpOk -Url "http://localhost:$Port/" -TimeoutSec 20)) {
    Write-Host "Сервер на порту $Port не отдаёт страницу." -ForegroundColor Red
    if ($startedServer) {
        foreach ($f in @($serverErr, $serverOut)) {
            if (Test-Path $f) { Get-Content $f | Write-Host -ForegroundColor DarkGray }
        }
        Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null
    }
    else {
        Write-Host "Порт занят посторонним процессом — освободи его или запусти с другим -Port." -ForegroundColor DarkGray
    }
    exit 1
}
Write-Host "  Сервер отвечает: http://localhost:$Port" -ForegroundColor Green

# ---------- Туннель ----------

if ($Provider -eq 'cf') {
    # cloudflared ищем в PATH, затем по стандартному пути установки winget —
    # после установки PATH в текущем окне мог ещё не обновиться.
    $exe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $exe) {
        $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
        if (Test-Path $fallback) { $exe = $fallback }
    }
    if (-not $exe) {
        Write-Host "Не найден cloudflared. Установи его один раз:" -ForegroundColor Red
        Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor DarkGray
        Write-Host "Или подними туннель без установки: npm run play:lhr" -ForegroundColor DarkGray
        if ($startedServer) { Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null }
        exit 1
    }
    $tunnelArgs = @('tunnel', '--url', "http://localhost:$Port")
    $pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
    $marker = "http://localhost:$Port"
    $logBase = "cf_tunnel_$Port"
    $providerName = 'Cloudflare'
}
else {
    # localhost.run работает поверх ssh; в Windows 10/11 он штатный, но компонент
    # OpenSSH Client мог быть не установлен.
    $exe = (Get-Command ssh -ErrorAction SilentlyContinue).Source
    if (-not $exe) {
        Write-Host "Не найден ssh. Установи OpenSSH Client:" -ForegroundColor Red
        Write-Host "  Параметры → Приложения → Дополнительные компоненты → Добавить → OpenSSH Client" -ForegroundColor DarkGray
        if ($startedServer) { Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null }
        exit 1
    }
    # -R 80:localhost:Port      — пробросить публичный 80 на наш локальный порт
    # StrictHostKeyChecking=accept-new — не зависать на вопросе про ключ хоста
    # ServerAliveInterval=30    — keep-alive, чтобы простой туннель не отвалился
    # ExitOnForwardFailure=yes  — если проброс не удался, ssh падает сразу
    $tunnelArgs = @(
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ExitOnForwardFailure=yes',
        '-R', "80:localhost:$Port",
        'nokey@localhost.run'
    )
    $pattern = 'https://[a-z0-9-]+\.lhr\.life'
    $marker = "80:localhost:$Port"
    $logBase = "lhr_tunnel_$Port"
    $providerName = 'localhost.run'
}

# Вывод туннеля пишем в файлы, чтобы распарсить адрес: cloudflared логирует в
# stderr, ssh — в stdout, а Start-Process не умеет писать оба потока в один файл.
$tunnelOut = Join-Path $env:TEMP "$logBase.log"
$tunnelErr = Join-Path $env:TEMP "$logBase.err"
Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

Write-Host "Поднимаю туннель $providerName для localhost:$Port ..." -ForegroundColor Cyan

$tunnelProc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden `
    -ArgumentList $tunnelArgs `
    -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr
Save-TrackedProcess -Name 'tunnel' -Port $Port -Process $tunnelProc -Marker $marker

$url = Wait-TunnelUrl -Process $tunnelProc -LogPaths @($tunnelErr, $tunnelOut) -Pattern $pattern

if (-not $url) {
    Write-Host "Не удалось получить адрес туннеля." -ForegroundColor Red
    foreach ($f in @($tunnelErr, $tunnelOut)) {
        if (Test-Path $f) { Get-Content $f | Write-Host -ForegroundColor DarkGray }
    }
    Stop-TrackedProcess -Name 'tunnel' -Port $Port | Out-Null
    if ($startedServer) { Stop-TrackedProcess -Name 'server' -Port $Port | Out-Null }
    exit 1
}

# ---------- Готово ----------

# Гасим только то, что подняли сами: чужой (уже работавший) сервер не трогаем.
$tracked = @{ tunnel = $tunnelProc.Id }
if ($startedServer) { $tracked['server'] = $serverProc.Id }
Register-TrackedCleanup -Tracked $tracked -Port $Port

# Свежий адрес туннеля первые секунды отдаёт ошибку, пока маршрут не разошёлся
# по узлам провайдера. Проверяем его сами, чтобы не отправить другу ссылку,
# которая у него откроется как «не удаётся получить доступ к сайту».
Write-Host "Проверяю публичную ссылку ..." -ForegroundColor Cyan
$publicOk = Wait-HttpOk -Url $url -TimeoutSec 45

Write-TunnelLinks -Url $url -Room $Room

if ($publicOk) {
    Write-Host "  Ссылка проверена: отвечает игрой (HTTP 200)." -ForegroundColor Green
}
else {
    Write-Host "  ВНИМАНИЕ: ссылка пока не отвечает." -ForegroundColor Yellow
    Write-Host "  Подожди полминуты и обнови страницу. Если не поднялась — Ctrl+C и запусти заново" -ForegroundColor DarkGray
    Write-Host "  (другим провайдером: npm run play:lhr вместо npm run play)." -ForegroundColor DarkGray
}
Write-Host ""

Write-Host "Сервер: http://localhost:$Port" -ForegroundColor DarkGray
Write-Host "Всё поднято. НЕ закрывай это окно. Ctrl+C — остановить." -ForegroundColor Cyan

try {
    Wait-Process -Id $tunnelProc.Id
}
finally {
    Stop-TrackedProcess -Name 'tunnel' -Port $Port -ExpectedId $tunnelProc.Id | Out-Null
    if ($startedServer) {
        Stop-TrackedProcess -Name 'server' -Port $Port -ExpectedId $serverProc.Id | Out-Null
        Write-Host "Туннель и сервер остановлены." -ForegroundColor Yellow
    }
    else {
        Write-Host "Туннель остановлен. Сервер оставлен работать (его поднял не этот скрипт)." -ForegroundColor Yellow
    }
}
