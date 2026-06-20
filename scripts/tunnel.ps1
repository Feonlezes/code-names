<#
.SYNOPSIS
    Поднимает публичный туннель к локальному серверу игры через localhost.run
    и печатает готовый домен/ссылку для друга.

.DESCRIPTION
    Сервер игры authoritative и слушает localhost:<Port> (по умолчанию 3000).
    localhost.run пробрасывает его в интернет по SSH (ничего ставить не нужно —
    штатный ssh есть в Windows 10/11) и выдаёт временный https://*.lhr.life.
    Туннель поддерживает WebSocket (wss), который нужен игре.

    Скрипт: (1) проверяет, что сервер слушает порт; (2) запускает ssh-туннель;
    (3) вытаскивает из его вывода адрес *.lhr.life; (4) печатает домен и ссылку
    с ?room=; (5) держит туннель живым, пока окно открыто (Ctrl+C — остановить).

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

# ssh обязателен: localhost.run работает поверх него. В Windows 10/11 он штатный,
# но мог быть не установлен (OpenSSH Client) — проверяем заранее с понятной ошибкой.
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "Не найден ssh. Установи OpenSSH Client:" -ForegroundColor Red
    Write-Host "  Settings → Apps → Optional Features → Add → OpenSSH Client" -ForegroundColor DarkGray
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

# Опрашиваем лог до 30 сек: адрес появляется в первой строке stdout вида
# "<rand>.lhr.life tunneled with tls termination, https://<rand>.lhr.life".
$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.lhr\.life' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
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

# Держим скрипт живым, пока жив ssh. Закрытие окна/Ctrl+C — глушим туннель,
# чтобы не оставлять висящий процесс.
try {
    Wait-Process -Id $proc.Id
}
finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Write-Host "Туннель остановлен." -ForegroundColor Yellow
}

