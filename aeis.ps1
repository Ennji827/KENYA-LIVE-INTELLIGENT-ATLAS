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
$TaskName = "K-L-I-A Always On"
$BackendUrl = "http://127.0.0.1:8000"
$FrontendUrl = "http://localhost:5173"

function Get-AeisDefaultDbPath {
  $localDataRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "K-L-I-A"
  }
  else {
    Join-Path $Runtime "local-data"
  }
  New-Item -ItemType Directory -Force $localDataRoot | Out-Null
  $newPath = Join-Path $localDataRoot "klia-live.sqlite3"
  if (-not (Test-Path -LiteralPath $newPath) -and $env:LOCALAPPDATA) {
    $legacyPath = Join-Path (Join-Path $env:LOCALAPPDATA "AEIS-K") "aeis-live.sqlite3"
    if (Test-Path -LiteralPath $legacyPath) {
      Copy-Item -LiteralPath $legacyPath -Destination $newPath -Force
    }
  }
  return $newPath
}

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
  $env:PYTHONDONTWRITEBYTECODE = "1"
  $env:AEIS_CACHE_BACKEND = "locmem"
  if (-not $env:AEIS_DB_PATH) {
    $env:AEIS_DB_PATH = Get-AeisDefaultDbPath
  }
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
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 30
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
  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction Stop
  }
  catch {
    return [pscustomobject]@{
      ProcessId = $connection.OwningProcess
      Name = "PID $($connection.OwningProcess)"
      CommandLine = ""
    }
  }
}

function Get-FreePort {
  param(
    [int]$Start = 5173,
    [int]$End = 5199
  )
  for ($port = $Start; $port -le $End; $port++) {
    if (-not (Get-PortOwner $port)) { return $port }
  }
  throw "No free frontend development port found between $Start and $End."
}

function Test-AeisProcess {
  param($Process)
  if (-not $Process -or -not $Process.CommandLine) { return $false }
  return (
    $Process.CommandLine -like "*aeis_django.wsgi*" -or
    $Process.CommandLine -like "*django_backend*manage.py*process_aeis_jobs*" -or
    $Process.CommandLine -like "*manage.py*process_aeis_jobs*" -or
    ($Process.CommandLine -like "*vite*" -and $Process.CommandLine -like "*$Frontend*")
  )
}

function Get-AeisProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
        $_.CommandLine -and
      (
        $_.CommandLine -like "*aeis_django.wsgi*" -or
        $_.CommandLine -like "*manage.py*process_aeis_jobs*" -or
        ($_.CommandLine -like "*vite*" -and $_.CommandLine -like "*$Frontend*") -or
        $_.CommandLine -like "*aeis.ps1*serve*"
      )
    }
}

function Test-WorkerHeartbeat {
  $heartbeat = Join-Path $Runtime "worker.heartbeat"
  if (-not (Test-Path -LiteralPath $heartbeat)) { return $false }
  try {
    $state = Get-Content -LiteralPath $heartbeat -Raw | ConvertFrom-Json
    if ($state.status -ne "running") { return $false }
  }
  catch {
    return $false
  }
  $age = (Get-Date) - (Get-Item -LiteralPath $heartbeat).LastWriteTime
  return $age.TotalSeconds -lt 10
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
  if (Test-WorkerHeartbeat) { return }

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
  if (Test-HttpHealth "$BackendUrl/health") { return }

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
      "--ident=K-L-I-A",
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
    Initialize-Aeis -BuildFrontend $false
  }
  else {
    Set-AeisEnvironment
  }
  Start-Backend
  Start-Worker
}

function Start-FrontendDevelopment {
  $port = 5173
  $owner = Get-PortOwner $port
  if ($owner) {
    if (Test-AeisProcess $owner) {
      Write-Host "K-L-I-A development frontend is already running." -ForegroundColor Yellow
      Write-Host "http://localhost:$port" -ForegroundColor Green
      return
    }
    $port = Get-FreePort -Start 5174 -End 5199
    Write-Host "Port 5173 is already used by $($owner.Name) (PID $($owner.ProcessId))." -ForegroundColor Yellow
    Write-Host "Starting K-L-I-A development frontend on http://localhost:$port instead." -ForegroundColor Yellow
  }

  Push-Location $Frontend
  try {
    & npm.cmd run dev:raw -- --port $port
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
  Write-Host "K-L-I-A status" -ForegroundColor Cyan
  Write-Host "-------------"
  Write-Host "Production dashboard: $(if (Test-HttpHealth "$BackendUrl/health") { "HEALTHY  $BackendUrl" } else { "STOPPED" })"
  Write-Host "Development frontend: $(if ($frontendOwner -and (Test-AeisProcess $frontendOwner)) { "RUNNING  $FrontendUrl" } else { "STOPPED" })"
  Write-Host "Background worker:    $(if ($workerCount -gt 0 -or (Test-WorkerHeartbeat)) { "RUNNING" } else { "STOPPED" })"
  Write-Host "Automatic startup:    $(if ($task) { "$($task.State) ($TaskName)" } else { "NOT INSTALLED" })"
  Write-Host "Runtime database:     $(if ($env:AEIS_DB_PATH) { $env:AEIS_DB_PATH } else { Get-AeisDefaultDbPath })"
  if ($backendOwner) {
    Write-Host "Port 8000 PID:         $($backendOwner.ProcessId)"
  }
  if ($frontendOwner) {
    Write-Host "Port 5173 PID:         $($frontendOwner.ProcessId)"
  }
  Write-Host ""
}

function Install-AeisStartup {
  Initialize-Aeis -BuildFrontend $false
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
    -Description "Keeps the local K-L-I-A Django server and processing worker available after Windows logon." `
    -Force | Out-Null

  Stop-AeisProcesses
  Start-ScheduledTask -TaskName $TaskName
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-HttpHealth "$BackendUrl/health") { break }
  }
  Write-Host "K-L-I-A automatic startup installed." -ForegroundColor Green
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
    Write-Host "K-L-I-A is ready: $BackendUrl" -ForegroundColor Green
  }
  "stop" {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AeisProcesses
    Write-Host "K-L-I-A servers stopped." -ForegroundColor Yellow
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
    Write-Host "K-L-I-A restarted: $BackendUrl" -ForegroundColor Green
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
    Write-Host "K-L-I-A automatic startup removed." -ForegroundColor Yellow
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
        Start-Backend
        Start-Worker
      }
      catch {
        Add-Content -LiteralPath (Join-Path $Runtime "supervisor.log") -Value "$(Get-Date -Format o) $($_.Exception.Message)"
      }
      Start-Sleep -Seconds 5
    }
  }
}
