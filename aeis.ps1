param(
  [ValidateSet(
    "start",
    "stop",
    "restart",
    "status",
    "dev",
    "dev-frontend",
    "install",
    "uninstall",
    "logs",
    "serve"
  )]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$Frontend = Join-Path $Root "frontend"
$Backend = Join-Path $Root "django_backend"
$TaskName = "AEIS-K Always On"
$BackendUrl = "http://127.0.0.1:8000"
$FrontendUrl = "http://localhost:5173"

function Get-AeisPython {
  $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $venvPython) {
    return (Resolve-Path -LiteralPath $venvPython).Path
  }
  return "python"
}

function Get-LanIp {
  $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($address) { return $address }
  return "127.0.0.1"
}

function Set-AeisEnvironment {
  New-Item -ItemType Directory -Force $Runtime | Out-Null
  $secretPath = Join-Path $Runtime "django-secret-key"
  if (-not $env:AEIS_DJANGO_SECRET_KEY) {
    if (-not (Test-Path -LiteralPath $secretPath)) {
      $python = Get-AeisPython
      & $python -c "import secrets, pathlib; pathlib.Path(r'$secretPath').write_text(secrets.token_urlsafe(64), encoding='utf-8')"
    }
    $env:AEIS_DJANGO_SECRET_KEY = (Get-Content -LiteralPath $secretPath -Raw).Trim()
  }
  if (-not $env:AEIS_DJANGO_DEBUG) {
    $env:AEIS_DJANGO_DEBUG = "0"
  }
  if (-not $env:AEIS_ALLOWED_HOSTS) {
    $env:AEIS_ALLOWED_HOSTS = "localhost,127.0.0.1,[::1],$(Get-LanIp)"
  }
}

function Test-HttpHealth {
  param([string]$Url)
  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 4
    return $response.status -eq "healthy"
  }
  catch {
    return $false
  }
}

function Get-PortOwner {
  param([int]$Port)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
}

function Test-AeisProcess {
  param($Process)
  if (-not $Process -or -not $Process.CommandLine) { return $false }
  return (
    $Process.CommandLine -like "*$Root*" -and (
      $Process.CommandLine -like "*aeis_django.wsgi*" -or
      $Process.CommandLine -like "*manage.py*process_aeis_jobs*" -or
      $Process.CommandLine -like "*vite*"
    )
  )
}

function Get-AeisProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -like "*$Root*" -and (
        $_.CommandLine -like "*aeis_django.wsgi*" -or
        $_.CommandLine -like "*manage.py*process_aeis_jobs*" -or
        $_.CommandLine -like "*vite*" -or
        $_.CommandLine -like "*aeis.ps1*serve*"
      )
    }
}

function Stop-AeisProcesses {
  $processes = @(Get-AeisProcesses)
  $childrenFirst = $processes | Sort-Object ProcessId -Descending
  foreach ($process in $childrenFirst) {
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Initialize-Aeis {
  param([bool]$BuildFrontend = $true)

  Set-AeisEnvironment
  $python = Get-AeisPython

  & $python -c "import django, waitress, openpyxl, reportlab, psycopg" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Django dependencies..." -ForegroundColor Cyan
    & $python -m pip install -r (Join-Path $Backend "requirements.txt")
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    & npm.cmd --prefix $Frontend install
  }

  Write-Host "Preparing database and accounts..." -ForegroundColor Cyan
  & $python (Join-Path $Backend "manage.py") migrate --noinput
  & $python (Join-Path $Backend "manage.py") import_legacy_runtime
  & $python (Join-Path $Backend "manage.py") seed_aeis

  $distIndex = Join-Path $Frontend "dist\index.html"
  if ($BuildFrontend -or -not (Test-Path -LiteralPath $distIndex)) {
    Write-Host "Building the production dashboard..." -ForegroundColor Cyan
    & npm.cmd --prefix $Frontend run build
  }
}

function Start-Worker {
  $existing = @(Get-AeisProcesses | Where-Object { $_.CommandLine -like "*manage.py*process_aeis_jobs*" })
  if ($existing.Count -gt 0) { return }

  $python = Get-AeisPython
  Start-Process `
    -FilePath $python `
    -ArgumentList @("django_backend\manage.py", "process_aeis_jobs", "--sleep", "1") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Runtime "worker.stdout.log") `
    -RedirectStandardError (Join-Path $Runtime "worker.stderr.log") | Out-Null
}

function Start-Backend {
  $owner = Get-PortOwner 8000
  if ($owner) {
    if (Test-AeisProcess $owner) { return }
    throw "Port 8000 is used by $($owner.Name) (PID $($owner.ProcessId)). Stop that application first."
  }

  $python = Get-AeisPython
  Start-Process `
    -FilePath $python `
    -ArgumentList @(
      "-m", "waitress",
      "--listen=0.0.0.0:8000",
      "--threads=12",
      "--connection-limit=500",
      "--channel-timeout=120",
      "--max-request-body-size=115343360",
      "--ident=AEIS-K",
      "aeis_django.wsgi:application"
    ) `
    -WorkingDirectory $Backend `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Runtime "waitress.stdout.log") `
    -RedirectStandardError (Join-Path $Runtime "waitress.stderr.log") | Out-Null

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-HttpHealth "$BackendUrl/health") { return }
  }
  throw "Django did not become healthy. Check .runtime\waitress.stderr.log."
}

function Start-ManagedRuntime {
  param([bool]$Prepare = $true)
  if ($Prepare) {
    Initialize-Aeis -BuildFrontend $true
  }
  else {
    Set-AeisEnvironment
  }
  Start-Worker
  Start-Backend
}

function Start-FrontendDevelopment {
  $owner = Get-PortOwner 5173
  if ($owner) {
    if (Test-AeisProcess $owner) {
      Write-Host "AEIS-K development frontend is already running." -ForegroundColor Yellow
      Write-Host $FrontendUrl -ForegroundColor Green
      return
    }
    throw "Port 5173 is used by $($owner.Name) (PID $($owner.ProcessId)). Stop that application first."
  }

  Push-Location $Frontend
  try {
    & npm.cmd run dev:raw
  }
  finally {
    Pop-Location
  }
}

function Show-AeisStatus {
  $backendOwner = Get-PortOwner 8000
  $frontendOwner = Get-PortOwner 5173
  $workerCount = @(
    Get-AeisProcesses |
      Where-Object { $_.CommandLine -like "*manage.py*process_aeis_jobs*" } |
      Select-Object -ExpandProperty ParentProcessId -Unique
  ).Count
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "AEIS-K status" -ForegroundColor Cyan
  Write-Host "-------------"
  Write-Host "Production dashboard: $(if (Test-HttpHealth "$BackendUrl/health") { "HEALTHY  $BackendUrl" } else { "STOPPED" })"
  Write-Host "Development frontend: $(if ($frontendOwner -and (Test-AeisProcess $frontendOwner)) { "RUNNING  $FrontendUrl" } else { "STOPPED" })"
  Write-Host "Background worker:    $(if ($workerCount -gt 0) { "RUNNING" } else { "STOPPED" })"
  Write-Host "Automatic startup:    $(if ($task) { "$($task.State) ($TaskName)" } else { "NOT INSTALLED" })"
  if ($backendOwner) {
    Write-Host "Port 8000 PID:         $($backendOwner.ProcessId)"
  }
  if ($frontendOwner) {
    Write-Host "Port 5173 PID:         $($frontendOwner.ProcessId)"
  }
  Write-Host ""
}

function Install-AeisStartup {
  Initialize-Aeis -BuildFrontend $true
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

  $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\aeis.ps1`" serve"
  $taskAction = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $Root
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Keeps the local AEIS-K Django server and processing worker available after Windows logon." `
    -Force | Out-Null

  Stop-AeisProcesses
  Start-ScheduledTask -TaskName $TaskName
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-HttpHealth "$BackendUrl/health") { break }
  }
  Write-Host "AEIS-K automatic startup installed." -ForegroundColor Green
  Write-Host "Use $BackendUrl for normal operation." -ForegroundColor Green
}

switch ($Action) {
  "start" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      Start-ScheduledTask -TaskName $TaskName
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-HttpHealth "$BackendUrl/health") { break }
      }
    }
    else {
      Start-ManagedRuntime -Prepare $true
    }
    Write-Host "AEIS-K is ready: $BackendUrl" -ForegroundColor Green
  }
  "stop" {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AeisProcesses
    Write-Host "AEIS-K servers stopped." -ForegroundColor Yellow
  }
  "restart" {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AeisProcesses
    Start-Sleep -Seconds 1
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      Start-ScheduledTask -TaskName $TaskName
    }
    else {
      Start-ManagedRuntime -Prepare $true
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Milliseconds 500
      if (Test-HttpHealth "$BackendUrl/health") { break }
    }
    Write-Host "AEIS-K restarted: $BackendUrl" -ForegroundColor Green
  }
  "status" {
    Show-AeisStatus
  }
  "dev" {
    Start-ManagedRuntime -Prepare $false
    Write-Host "Backend ready at $BackendUrl" -ForegroundColor Green
    Start-FrontendDevelopment
  }
  "dev-frontend" {
    Start-ManagedRuntime -Prepare $false
    Start-FrontendDevelopment
  }
  "install" {
    Install-AeisStartup
  }
  "uninstall" {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AeisProcesses
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "AEIS-K automatic startup removed." -ForegroundColor Yellow
  }
  "logs" {
    Get-Content `
      (Join-Path $Runtime "waitress.stderr.log"), `
      (Join-Path $Runtime "worker.stderr.log"), `
      (Join-Path $Runtime "vite.stderr.log") `
      -Tail 80 `
      -ErrorAction SilentlyContinue
  }
  "serve" {
    Set-AeisEnvironment
    while ($true) {
      try {
        Start-Worker
        Start-Backend
      }
      catch {
        Add-Content -LiteralPath (Join-Path $Runtime "supervisor.log") -Value "$(Get-Date -Format o) $($_.Exception.Message)"
      }
      Start-Sleep -Seconds 5
    }
  }
}
