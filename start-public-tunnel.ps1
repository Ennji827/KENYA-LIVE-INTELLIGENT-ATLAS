param(
  [int]$Port = 5000
)

$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  Write-Host "cloudflared is not installed or not on PATH."
  Write-Host "Install Cloudflare Tunnel, then run this script again:"
  Write-Host "  winget install --id Cloudflare.cloudflared"
  Write-Host "  .\start-public-tunnel.ps1"
  exit 1
}

Write-Host "Starting AEIS-K public HTTPS tunnel to http://127.0.0.1:$Port"
Write-Host "Keep this window open while testers use the generated trycloudflare.com URL."
Write-Host "Use the Ministry Admin panel lock button before sharing the public URL."

& $cloudflared.Source tunnel --url "http://127.0.0.1:$Port"
