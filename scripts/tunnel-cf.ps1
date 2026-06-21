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

    Скрипт: (1) находит cloudflared (PATH или стандартный путь установки);
    (2) проверяет, что сервер слушает порт; (3) запускает quick-туннель;
    (4) вытаскивает из его вывода адрес *.trycloudflare.com; (5) печатает домен и
    ссылку с ?room=; (6) держит туннель живым, пока окно открыто (Ctrl+C — стоп).

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
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Host "ВНИМАНИЕ: на порту $Port никто не слушает." -ForegroundColor Yellow
    Write-Host "Запусти сервер в другом окне: npm start" -ForegroundColor Yellow
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

# Опрашиваем оба лога до 30 сек: адрес появляется в рамке вида
# "Your quick Tunnel has been created! ... https://<rand>.trycloudflare.com".
$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    $m = Select-String -Path $err, $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
}

if (-not $url) {
    Write-Host "Не удалось получить адрес туннеля." -ForegroundColor Red
    if (Test-Path $err) { Get-Content $err | Write-Host -ForegroundColor DarkGray }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    exit 1
}

# Готовая ссылка: домен + /?room=. С -Room подставляем код, иначе плейсхолдер.
$link = if ($Room) { "$url/?room=$Room" } else { "$url/?room=КОД" }

# Кликабельная ссылка в терминале через OSC 8 hyperlink:
#   ESC ]8;;<URL> ESC \  <текст>  ESC ]8;; ESC \
# Поддерживают Windows Terminal и встроенный терминал VS Code. В терминалах без
# поддержки последовательность не печатается как мусор — показывается просто текст.
# Кликом открываем именно домен (без КОД-плейсхолдера, иначе ведёт в битую комнату);
# при заданном -Room кликабельна полная ссылка с кодом.
$esc = [char]27
function Format-Link([string]$text, [string]$target) {
    "$esc]8;;$target$esc\$text$esc]8;;$esc\"
}
$clickTarget = if ($Room) { $link } else { $url }
$clickable = Format-Link $clickTarget $clickTarget

Write-Host ""
Write-Host "  Домен туннеля: " -ForegroundColor Green -NoNewline
Write-Host (Format-Link $url $url) -ForegroundColor Green
Write-Host "  Ссылка другу:  $link" -ForegroundColor Green
Write-Host "  Открыть/скопировать: " -ForegroundColor Green -NoNewline
Write-Host $clickable -ForegroundColor Green
if (-not $Room) {
    Write-Host "  (подставь вместо КОД 4 символа из шапки «Комната»)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "Туннель работает. НЕ закрывай это окно. Ctrl+C — остановить." -ForegroundColor Cyan

# Держим скрипт живым, пока жив cloudflared. Закрытие окна/Ctrl+C — глушим
# туннель, чтобы не оставлять висящий процесс.
try {
    Wait-Process -Id $proc.Id
}
finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Write-Host "Туннель остановлен." -ForegroundColor Yellow
}
