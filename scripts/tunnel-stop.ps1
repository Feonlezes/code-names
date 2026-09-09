<#
.SYNOPSIS
    Гасит сервер и туннель, поднятые скриптами проекта, и чистит их pid-файлы.

.DESCRIPTION
    Нужен, когда окно с `npm run play` (или `npm run tunnel`) закрыли крестиком и
    фоновые процессы остались жить. Трогает только процессы, записанные нашими
    скриптами: перед завершением сверяется командная строка процесса, поэтому
    посторонний node или ssh не пострадает.

.PARAMETER Port
    Порт, под который поднимались процессы. По умолчанию 3000.

.PARAMETER TunnelOnly
    Погасить только туннель, сервер оставить работать.

.EXAMPLE
    npm run tunnel:stop

.EXAMPLE
    npm run tunnel:stop -- -Port 3100 -TunnelOnly
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$TunnelOnly
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\tunnel.common.ps1')
Set-ConsoleUtf8

$stopped = $false

if (Stop-TrackedProcess -Name 'tunnel' -Port $Port) {
    Write-Host "Туннель остановлен." -ForegroundColor Yellow
    $stopped = $true
}

if (-not $TunnelOnly) {
    if (Stop-TrackedProcess -Name 'server' -Port $Port) {
        Write-Host "Сервер остановлен." -ForegroundColor Yellow
        $stopped = $true
    }
}

if (-not $stopped) {
    Write-Host "Нечего останавливать: процессов, поднятых скриптами на порту $Port, не найдено." -ForegroundColor DarkGray
}
