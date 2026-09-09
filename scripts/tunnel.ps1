<#
.SYNOPSIS
    Поднимает публичный туннель к локальному серверу игры через localhost.run
    и печатает готовый домен/ссылку для друга.

.DESCRIPTION
    Сервер игры authoritative и слушает localhost:<Port> (по умолчанию 3000).
    localhost.run пробрасывает его в интернет по SSH (ничего ставить не нужно —
    штатный ssh есть в Windows 10/11) и выдаёт временный https://*.lhr.life.
    Туннель поддерживает WebSocket (wss), который нужен игре.

    Скрипт: (1) гасит туннель прошлого запуска, если тот остался висеть;
    (2) проверяет, что сервер слушает порт; (3) запускает ssh-туннель;
    (4) вытаскивает из его вывода адрес *.lhr.life; (5) печатает домен и ссылку
    с ?room=; (6) держит туннель живым, пока окно открыто (Ctrl+C — остановить).

    Поднимает только туннель — сервер должен работать отдельно (`npm start`).
    Одной командой сразу и сервер, и туннель поднимает `npm run play:lhr`.

.PARAMETER Port
    Локальный порт сервера. По умолчанию 3000 (как в `npm start`).

.PARAMETER Room
    Код комнаты (4 символа из шапки «Комната»). Если задан — в готовой ссылке
    вместо плейсхолдера КОД будет подставлен он.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1
    # печатает https://<rand>.lhr.life и ссылку https://<rand>.lhr.life/?room=КОД

.EXAMPLE
    npm run tunnel -- -Room ABCD
    # сразу собирает ссылку https://<rand>.lhr.life/?room=ABCD
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [string]$Room
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\tunnel.common.ps1')
Set-ConsoleUtf8

# Туннель прошлого запуска мог остаться в фоне (окно закрыли крестиком) — его
# адрес всё равно уже не нужен, а живой процесс только путает картину.
if (Stop-TrackedProcess -Name 'tunnel' -Port $Port) {
    Write-Host "Погашен туннель прошлого запуска." -ForegroundColor DarkGray
}

# ssh обязателен: localhost.run работает поверх него. В Windows 10/11 он штатный,
# но мог быть не установлен (OpenSSH Client) — проверяем заранее с понятной ошибкой.
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "Не найден ssh. Установи OpenSSH Client:" -ForegroundColor Red
    Write-Host "  Settings → Apps → Optional Features → Add → OpenSSH Client" -ForegroundColor DarkGray
    exit 1
}

# Туннель проброса не имеет смысла, если сервер не запущен: друг увидит пустоту.
# Это не блокирующая ошибка (сервер можно поднять параллельно), а предупреждение.
if (-not (Test-PortListening -Port $Port)) {
    Write-Host "ВНИМАНИЕ: на порту $Port никто не слушает." -ForegroundColor Yellow
    Write-Host "Запусти сервер в другом окне: npm start (или сразу всё: npm run play:lhr)" -ForegroundColor Yellow
    Write-Host ""
}

# Вывод ssh пишем в файлы, чтобы распарсить адрес. stdout и stderr — разные файлы
# (Start-Process не умеет писать оба в один). Чистим прошлый запуск того же порта.
$log = Join-Path $env:TEMP "lhr_tunnel_$Port.log"
$err = Join-Path $env:TEMP "lhr_tunnel_$Port.err"
Remove-Item $log, $err -ErrorAction SilentlyContinue

Write-Host "Поднимаю туннель localhost.run для localhost:$Port ..." -ForegroundColor Cyan

# -R 80:localhost:Port      — пробросить публичный 80 на наш локальный порт
# StrictHostKeyChecking=accept-new — не зависать на вопросе про ключ хоста при 1-м входе
# ServerAliveInterval=30    — keep-alive, чтобы простой туннель не отвалился
# ExitOnForwardFailure=yes  — если проброс не удался, ssh падает сразу (не висит молча)
$sshArgs = @(
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', "80:localhost:$Port",
    'nokey@localhost.run'
)
$proc = Start-Process -FilePath ssh -PassThru -WindowStyle Hidden `
    -ArgumentList $sshArgs -RedirectStandardOutput $log -RedirectStandardError $err
Save-TrackedProcess -Name 'tunnel' -Port $Port -Process $proc -Marker "80:localhost:$Port"

# Адрес появляется в первой строке stdout вида
# "<rand>.lhr.life tunneled with tls termination, https://<rand>.lhr.life".
$url = Wait-TunnelUrl -Process $proc -LogPaths @($log, $err) -Pattern 'https://[a-z0-9-]+\.lhr\.life'

if (-not $url) {
    Write-Host "Не удалось получить адрес туннеля." -ForegroundColor Red
    if (Test-Path $err) { Get-Content $err | Write-Host -ForegroundColor DarkGray }
    Stop-TrackedProcess -Name 'tunnel' -Port $Port | Out-Null
    exit 1
}

# Свежий адрес первые секунды отдаёт ошибку, пока маршрут не разошёлся по узлам
# localhost.run. Проверяем сами, чтобы не отправить другу нерабочую ссылку.
Write-Host "Проверяю публичную ссылку ..." -ForegroundColor Cyan
$publicOk = Wait-HttpOk -Url $url -TimeoutSec 45

Write-TunnelLinks -Url $url -Room $Room

if ($publicOk) {
    Write-Host "  Ссылка проверена: отвечает игрой (HTTP 200)." -ForegroundColor Green
}
else {
    Write-Host "  ВНИМАНИЕ: ссылка пока не отвечает — проверь, что сервер запущен (npm start)." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Туннель работает. НЕ закрывай это окно. Ctrl+C — остановить." -ForegroundColor Cyan

# Гашение ssh продублировано на событие выхода PowerShell: при Ctrl+C блок
# finally отработать не успевает. Закрытие окна крестиком не покрывает ни то,
# ни другое — там висяк снимет очистка при следующем запуске (или tunnel:stop).
Register-TrackedCleanup -Tracked @{ tunnel = $proc.Id } -Port $Port

try {
    Wait-Process -Id $proc.Id
}
finally {
    Stop-TrackedProcess -Name 'tunnel' -Port $Port -ExpectedId $proc.Id | Out-Null
    Write-Host "Туннель остановлен." -ForegroundColor Yellow
}

