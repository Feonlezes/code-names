<#
.SYNOPSIS
    Поднимает публичный туннель к локальному серверу игры через Cloudflare
    (cloudflared quick tunnel) и печатает готовый домен/ссылку для друга.

.DESCRIPTION
    Сервер игры authoritative и слушает localhost:<Port> (по умолчанию 3000).
    cloudflared пробрасывает его в интернет через глобальный edge Cloudflare и
    выдаёт временный https://*.trycloudflare.com. В отличие от localhost.run
    (scripts/tunnel.ps1) задержка round-trip заметно ниже — поэтому это
    предпочтительный туннель для игры. WebSocket (wss), нужный игре, работает
    штатно: клиент сам поднимает wss поверх https (см. public/js/net/socket.js).

    Скрипт: (1) гасит туннель прошлого запуска, если тот остался висеть;
    (2) находит cloudflared (PATH или стандартный путь установки); (3) проверяет,
    что сервер слушает порт; (4) запускает quick-туннель; (5) вытаскивает из его
    вывода адрес *.trycloudflare.com; (6) печатает домен и ссылку с ?room=;
    (7) держит туннель живым, пока окно открыто (Ctrl+C — стоп).

    Поднимает только туннель — сервер должен работать отдельно (`npm start`).
    Одной командой сразу и сервер, и туннель поднимает `npm run play`.

.PARAMETER Port
    Локальный порт сервера. По умолчанию 3000 (как в `npm start`).

.PARAMETER Room
    Код комнаты (4 символа из шапки «Комната»). Если задан — в готовой ссылке
    вместо плейсхолдера КОД будет подставлен он.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/tunnel-cf.ps1
    # печатает https://<rand>.trycloudflare.com и ссылку с ?room=КОД

.EXAMPLE
    npm run tunnel:cf -- -Room ABCD
    # сразу собирает ссылку https://<rand>.trycloudflare.com/?room=ABCD
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

# cloudflared обязателен. Ищем его сначала в PATH, затем по стандартному пути
# установки winget (PATH мог не обновиться сразу после установки) — даём
# понятную ошибку с командой установки, если не нашли.
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $fallback) { $cf = $fallback }
}
if (-not $cf) {
    Write-Host "Не найден cloudflared. Установи его один раз:" -ForegroundColor Red
    Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor DarkGray
    Write-Host "Или используй туннель без установки: npm run tunnel (localhost.run)." -ForegroundColor DarkGray
    exit 1
}

# Туннель проброса не имеет смысла, если сервер не запущен: друг увидит пустоту.
# Это не блокирующая ошибка (сервер можно поднять параллельно), а предупреждение.
if (-not (Test-PortListening -Port $Port)) {
    Write-Host "ВНИМАНИЕ: на порту $Port никто не слушает." -ForegroundColor Yellow
    Write-Host "Запусти сервер в другом окне: npm start (или сразу всё: npm run play)" -ForegroundColor Yellow
    Write-Host ""
}

# Вывод cloudflared пишем в файлы, чтобы распарсить адрес. cloudflared логирует в
# stderr, но stdout пишем тоже (Start-Process не умеет писать оба в один файл).
# Чистим прошлый запуск того же порта.
$log = Join-Path $env:TEMP "cf_tunnel_$Port.log"
$err = Join-Path $env:TEMP "cf_tunnel_$Port.err"
Remove-Item $log, $err -ErrorAction SilentlyContinue

Write-Host "Поднимаю туннель Cloudflare для localhost:$Port ..." -ForegroundColor Cyan

# tunnel --url http://localhost:Port — quick tunnel без аккаунта (временный адрес)
$cfArgs = @('tunnel', '--url', "http://localhost:$Port")
$proc = Start-Process -FilePath $cf -PassThru -WindowStyle Hidden `
    -ArgumentList $cfArgs -RedirectStandardOutput $log -RedirectStandardError $err
Save-TrackedProcess -Name 'tunnel' -Port $Port -Process $proc -Marker "http://localhost:$Port"

# Адрес появляется в рамке вида
# "Your quick Tunnel has been created! ... https://<rand>.trycloudflare.com".
$url = Wait-TunnelUrl -Process $proc -LogPaths @($err, $log) -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com'

if (-not $url) {
    Write-Host "Не удалось получить адрес туннеля." -ForegroundColor Red
    if (Test-Path $err) { Get-Content $err | Write-Host -ForegroundColor DarkGray }
    Stop-TrackedProcess -Name 'tunnel' -Port $Port | Out-Null
    exit 1
}

# Свежий адрес первые секунды отдаёт ошибку, пока маршрут не разошёлся по edge
# Cloudflare. Проверяем сами, чтобы не отправить другу нерабочую ссылку.
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

# Гашение cloudflared продублировано на событие выхода PowerShell: при Ctrl+C
# блок finally отработать не успевает. Закрытие окна крестиком не покрывает ни
# то, ни другое — там висяк снимет очистка при следующем запуске (или tunnel:stop).
Register-TrackedCleanup -Tracked @{ tunnel = $proc.Id } -Port $Port

try {
    Wait-Process -Id $proc.Id
}
finally {
    Stop-TrackedProcess -Name 'tunnel' -Port $Port -ExpectedId $proc.Id | Out-Null
    Write-Host "Туннель остановлен." -ForegroundColor Yellow
}
