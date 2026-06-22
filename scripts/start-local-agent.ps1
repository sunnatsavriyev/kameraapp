# Local Agent — stansiya PC da kamera proxy
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
. "$Root\scripts\config.ps1"

if (-not $env:SERVER_API_URL) {
    $env:SERVER_API_URL = $script:DEFAULT_SERVER_API_URL
}

Write-Host "Local Agent: http://127.0.0.1:8765" -ForegroundColor Cyan
Write-Host "Server sync: $env:SERVER_API_URL" -ForegroundColor Gray
python -m local_agent.main
