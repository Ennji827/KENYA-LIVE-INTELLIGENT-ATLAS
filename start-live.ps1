$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "Building AEIS-K frontend..." -ForegroundColor Cyan
npm --prefix frontend run build

$LanIp = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $LanIp) {
  $LanIp = "127.0.0.1"
}

Write-Host ""
Write-Host "AEIS-K live mode is starting..." -ForegroundColor Green
Write-Host "Local URL: http://127.0.0.1:5000" -ForegroundColor Green
Write-Host "LAN URL:   http://$LanIp:5000" -ForegroundColor Green
Write-Host ""
Write-Host "Use county demo password: county123" -ForegroundColor Yellow
Write-Host "For public internet access, put this backend behind a secure tunnel, reverse proxy, or cloud host." -ForegroundColor Yellow
Write-Host ""

python backend\app.py
