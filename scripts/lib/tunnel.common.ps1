<#
.SYNOPSIS
    Общие помощники скриптов запуска игры и туннелей.

.DESCRIPTION
    Подключается через dot-source из scripts/play.ps1, scripts/tunnel.ps1,
    scripts/tunnel-cf.ps1 и scripts/tunnel-stop.ps1. Собственных действий при
    загрузке не выполняет — только объявляет функции.

    Экспорт: Set-ConsoleUtf8, Get-TrackedPidPath, Save-TrackedProcess,
    Stop-TrackedProcess, Register-TrackedCleanup, Test-PortListening,
    Wait-HttpOk, Wait-TunnelUrl, Format-TerminalLink, Write-TunnelLinks.

    Модель «отслеживаемого процесса»: каждый фоновый процесс (сервер, туннель)
    записывается в pid-файл `%TEMP%\codenames_<имя>_<порт>.pid` двумя строками —
    PID и маркер командной строки. Маркер нужен, чтобы при остановке убедиться,
    что под этим PID до сих пор наш процесс, а не чужой после переиспользования
    номера системой.
#>

function Set-ConsoleUtf8 {
    <#
    .SYNOPSIS
        Переводит вывод консоли в UTF-8, чтобы русский текст не превращался в
        мусор при запуске через `npm run` (npm стартует скрипт из cmd, где
        активна кодовая страница 866).
    .OUTPUTS
        Нет. Меняет кодировку вывода текущего процесса.
    #>
    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $global:OutputEncoding = [System.Text.Encoding]::UTF8
    }
    catch {
        # Вывод перенаправлен в файл/пайп — консоли нет, менять нечего.
    }
}

function Get-TrackedPidPath {
    <#
    .SYNOPSIS
        Возвращает путь к pid-файлу отслеживаемого процесса.
    .PARAMETER Name
        Логическое имя процесса: 'server' или 'tunnel'.
    .PARAMETER Port
        Порт локального сервера — разные порты не мешают друг другу.
    .OUTPUTS
        [string] полный путь к файлу в %TEMP%.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Port
    )
    Join-Path $env:TEMP "codenames_${Name}_$Port.pid"
}

function Save-TrackedProcess {
    <#
    .SYNOPSIS
        Записывает PID запущенного процесса в pid-файл вместе с маркером.
    .PARAMETER Name
        Логическое имя процесса: 'server' или 'tunnel'.
    .PARAMETER Port
        Порт локального сервера.
    .PARAMETER Process
        Объект процесса, полученный от Start-Process -PassThru.
    .PARAMETER Marker
        Фрагмент командной строки процесса для последующей сверки
        (например '80:localhost:3000').
    .OUTPUTS
        Нет. Создаёт файл в %TEMP%.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [string]$Marker = ''
    )
    $path = Get-TrackedPidPath -Name $Name -Port $Port
    Set-Content -Path $path -Value @("$($Process.Id)", $Marker) -Encoding UTF8
}

function Stop-TrackedProcess {
    <#
    .SYNOPSIS
        Гасит процесс из pid-файла и удаляет сам файл.
    .DESCRIPTION
        Перед завершением сверяет командную строку процесса с сохранённым
        маркером: если PID уже занят посторонним процессом, тот не трогается.
        Файл удаляется в любом случае — он больше не описывает живой процесс.
    .PARAMETER Name
        Логическое имя процесса: 'server' или 'tunnel'.
    .PARAMETER Port
        Порт локального сервера.
    .PARAMETER ExpectedId
        Если задан — гасить только процесс с этим PID. Защищает от случая, когда
        pid-файл уже перехватил другой запуск на тот же порт: чужую запись такой
        вызов не трогает и файл не удаляет.
    .OUTPUTS
        [bool] $true, если процесс был найден и остановлен.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$ExpectedId = 0
    )
    $path = Get-TrackedPidPath -Name $Name -Port $Port
    if (-not (Test-Path $path)) { return $false }

    $lines = @(Get-Content -Path $path -ErrorAction SilentlyContinue)
    if ($lines.Count -lt 1) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return $false
    }

    $procId = 0
    if (-not [int]::TryParse($lines[0].Trim(), [ref]$procId)) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return $false
    }
    if ($ExpectedId -and $procId -ne $ExpectedId) { return $false }

    Remove-Item $path -Force -ErrorAction SilentlyContinue
    $marker = if ($lines.Count -gt 1) { $lines[1] } else { '' }

    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $info) { return $false }
    if ($marker -and ($info.CommandLine -notlike "*$marker*")) { return $false }

    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    return $true
}

function Register-TrackedCleanup {
    <#
    .SYNOPSIS
        Вешает гашение фоновых процессов на завершение сеанса PowerShell.
    .DESCRIPTION
        Покрывает Ctrl+C и `exit`, при которых блок finally скрипта может не
        отработать. Обработчик намеренно самодостаточен (только встроенные
        командлеты и захваченный список путей): в момент выхода функции этого
        файла ему уже могут быть недоступны.
    .PARAMETER Tracked
        Хеш-таблица «логическое имя процесса → его PID». Гасятся только процессы
        с этими PID: если pid-файл успел перехватить другой запуск на тот же
        порт, его процесс не трогается.
    .PARAMETER Port
        Порт локального сервера.
    .OUTPUTS
        Нет. Регистрирует подписку на событие PowerShell.Exiting.
    #>
    param(
        [Parameter(Mandatory = $true)][hashtable]$Tracked,
        [Parameter(Mandatory = $true)][int]$Port
    )
    $items = @()
    foreach ($name in $Tracked.Keys) {
        $items += , @((Get-TrackedPidPath -Name $name -Port $Port), [int]$Tracked[$name])
    }
    $action = {
        foreach ($item in $items) {
            $path = $item[0]
            $expected = $item[1]
            if (-not (Test-Path $path)) { continue }
            $lines = @(Get-Content -Path $path -ErrorAction SilentlyContinue)
            if ($lines.Count -lt 1) { continue }
            $procId = 0
            if (-not [int]::TryParse($lines[0].Trim(), [ref]$procId)) { continue }
            if ($procId -ne $expected) { continue }
            Remove-Item $path -Force -ErrorAction SilentlyContinue
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }.GetNewClosure()
    Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $action | Out-Null
}

function Test-PortListening {
    <#
    .SYNOPSIS
        Проверяет, слушает ли кто-нибудь локальный TCP-порт.
    .PARAMETER Port
        Номер порта.
    .OUTPUTS
        [bool] $true, если порт занят слушателем.
    #>
    param([Parameter(Mandatory = $true)][int]$Port)
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-HttpOk {
    <#
    .SYNOPSIS
        Ждёт, пока адрес не начнёт отвечать кодом 200.
    .DESCRIPTION
        Занятый порт ещё не значит рабочий сайт, а свежий адрес туннеля первые
        секунды отдаёт ошибку, пока провайдер не разнёс маршрут по своим узлам.
        Поэтому готовность проверяется настоящим запросом с повторами.
    .PARAMETER Url
        Проверяемый адрес.
    .PARAMETER TimeoutSec
        Общий бюджет ожидания в секундах.
    .PARAMETER RequestTimeoutSec
        Таймаут одного запроса в секундах.
    .OUTPUTS
        [bool] $true, если адрес ответил кодом 200 в отведённое время.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSec = 30,
        [int]$RequestTimeoutSec = 10
    )
    # Полоса прогресса Invoke-WebRequest в консоли только мешает и замедляет.
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        $deadline = (Get-Date).AddSeconds($TimeoutSec)
        do {
            try {
                $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $RequestTimeoutSec -ErrorAction Stop
                if ($response.StatusCode -eq 200) { return $true }
            }
            catch {
                # Ещё не поднялось: сервер не слушает, туннель не разошёлся, 502 от edge.
            }
            Start-Sleep -Seconds 2
        } while ((Get-Date) -lt $deadline)
        return $false
    }
    finally {
        $ProgressPreference = $prevProgress
    }
}

function Wait-TunnelUrl {
    <#
    .SYNOPSIS
        Ждёт появления публичного адреса туннеля в логах запущенного процесса.
    .DESCRIPTION
        Опрашивает файлы логов раз в секунду. Прерывается досрочно, если процесс
        туннеля успел завершиться (значит, адреса уже не будет).
    .PARAMETER Process
        Процесс туннеля (ssh или cloudflared).
    .PARAMETER LogPaths
        Файлы, куда перенаправлены stdout и stderr процесса.
    .PARAMETER Pattern
        Регулярное выражение адреса, например 'https://[a-z0-9-]+\.lhr\.life'.
    .PARAMETER TimeoutSec
        Сколько секунд ждать адрес.
    .OUTPUTS
        [string] найденный адрес либо $null.
    #>
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string[]]$LogPaths,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [int]$TimeoutSec = 30
    )
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        Start-Sleep -Seconds 1
        if ($Process.HasExited) { break }
        $existing = @($LogPaths | Where-Object { Test-Path $_ })
        if ($existing.Count -gt 0) {
            $m = Select-String -Path $existing -Pattern $Pattern -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($m) { return $m.Matches[0].Value }
        }
    }
    return $null
}

function Format-TerminalLink {
    <#
    .SYNOPSIS
        Оборачивает текст в кликабельную ссылку терминала (OSC 8).
    .DESCRIPTION
        Последовательность: ESC ]8;;<URL> ESC \ <текст> ESC ]8;; ESC \.
        Поддерживают Windows Terminal и встроенный терминал VS Code; терминалы
        без поддержки показывают просто текст, а не мусор.
    .PARAMETER Text
        Видимый текст ссылки.
    .PARAMETER Target
        Адрес перехода.
    .OUTPUTS
        [string] строка с управляющими последовательностями.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Target
    )
    $esc = [char]27
    "$esc]8;;$Target$esc\$Text$esc]8;;$esc\"
}

function Write-TunnelLinks {
    <#
    .SYNOPSIS
        Печатает домен туннеля и готовую ссылку для друга.
    .DESCRIPTION
        Кликом открывается домен без кода комнаты: плейсхолдер КОД в адресе увёл
        бы в несуществующую комнату. Если код передан — кликабельна полная ссылка.
    .PARAMETER Url
        Публичный адрес туннеля.
    .PARAMETER Room
        Код комнаты (4 символа) либо пустая строка.
    .OUTPUTS
        Нет. Пишет в консоль.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [string]$Room = ''
    )
    $link = if ($Room) { "$Url/?room=$Room" } else { "$Url/?room=КОД" }
    $clickTarget = if ($Room) { $link } else { $Url }

    Write-Host ""
    Write-Host "  Домен туннеля: " -ForegroundColor Green -NoNewline
    Write-Host (Format-TerminalLink -Text $Url -Target $Url) -ForegroundColor Green
    Write-Host "  Ссылка другу:  $link" -ForegroundColor Green
    Write-Host "  Открыть/скопировать: " -ForegroundColor Green -NoNewline
    Write-Host (Format-TerminalLink -Text $clickTarget -Target $clickTarget) -ForegroundColor Green
    if (-not $Room) {
        Write-Host "  (подставь вместо КОД 4 символа из шапки «Комната»)" -ForegroundColor DarkGray
    }
    Write-Host ""
}
