# Desktop rejim — Local Agent + Frontend
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
. "$Root\scripts\config.ps1"

if (-not $env:SERVER_API_URL) {
    $env:SERVER_API_URL = $script:DEFAULT_SERVER_API_URL
}

function Stop-PortListener([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
}

Write-Host "Eski jarayonlar tozalanmoqda (8765, 5173)..." -ForegroundColor Gray
Stop-PortListener 8765
Stop-PortListener 5173
Start-Sleep -Seconds 1

Write-Host "Starting Local Agent..." -ForegroundColor Cyan
$env:SERVER_API_URL = $env:SERVER_API_URL
Start-Process -FilePath "python" -ArgumentList "-m", "local_agent.main" -WorkingDirectory $Root -WindowStyle Minimized

$agentReady = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8765/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) {
            $agentReady = $true
            Write-Host "Local Agent tayyor (8765)" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "  Agent kutilmoqda... ($i/20)" -ForegroundColor Gray
    }
}

if (-not $agentReady) {
    Write-Host ""
    Write-Host "XATOLIK: Local Agent ishga tushmadi!" -ForegroundColor Red
    Write-Host "Alohida oyna ochib tekshiring:" -ForegroundColor Yellow
    Write-Host "  cd $Root" -ForegroundColor Yellow
    Write-Host "  python -m local_agent.main" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Starting Frontend (desktop mode)..." -ForegroundColor Cyan
Write-Host "Brauzer: http://localhost:5173" -ForegroundColor Green
Write-Host "Server (proxy): $env:SERVER_API_URL" -ForegroundColor Gray

Set-Location "$Root\frontend"
$env:VITE_APP_MODE = "desktop"
$env:VITE_LOCAL_AGENT_URL = "http://127.0.0.1:8765"
$env:VITE_DEV_PORT = "5173"
$env:VITE_USE_API_PROXY = "true"
if (-not $env:VITE_API_BASE_URL) {
    $env:VITE_API_BASE_URL = $env:SERVER_API_URL
}
npm run dev
