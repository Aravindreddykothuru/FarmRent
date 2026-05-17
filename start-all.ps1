# start-all.ps1 - FarmRent: Start all 3 services in separate windows
# Run from: c:\Users\aravind reddy\OneDrive\Desktop\farmers\

$root = $PSScriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   FarmRent - Starting All Services" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Prereq: Redis on :6379 — run: docker run -d -p 6379:6379 redis:7-alpine

# 1. Kill anything on ports 3000, 5000, 5001
Write-Host "[1/4] Clearing ports 3000, 5000, 5001..." -ForegroundColor Yellow
foreach ($port in @(3000, 5000, 5001)) {
    $pids2 = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    foreach ($p in $pids2) {
        try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host "  Killed PID $p on :$port" -ForegroundColor DarkGray } catch {}
    }
}
Start-Sleep -Seconds 2

# 2. Backend - Node.js on port 5000
Write-Host "[2/4] Starting Backend  (Node.js) => http://localhost:5000" -ForegroundColor Green
$backendDir = Join-Path $root "Backend"
Start-Process "cmd.exe" -ArgumentList @("/k", "title FarmRent-Backend && cd /d `"$backendDir`" && npm run dev") -WindowStyle Normal

# 3. Flask - Python on port 5001
Write-Host "[3/4] Starting Flask    (Python)  => http://localhost:5001" -ForegroundColor Green
$flaskDir = Join-Path $root "FutureEnhancement"
Start-Process "cmd.exe" -ArgumentList @("/k", "title FarmRent-Flask && cd /d `"$flaskDir`" && python app.py") -WindowStyle Normal

# 4. Frontend - Next.js on port 3000
Write-Host "[4/4] Starting Frontend (Next.js) => http://localhost:3000" -ForegroundColor Green
$frontendDir = Join-Path $root "nextfrontend"
Start-Process "cmd.exe" -ArgumentList @("/k", "title FarmRent-Frontend && cd /d `"$frontendDir`" && npm run dev") -WindowStyle Normal

# Wait for services to boot
Write-Host ""
Write-Host "  Waiting 14 seconds for services to boot..." -ForegroundColor DarkGray
Start-Sleep -Seconds 14

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Health Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Backend
try {
    $b = Invoke-RestMethod http://localhost:5000/health -TimeoutSec 5
    Write-Host "  Backend  [:5000] : $($b.status)" -ForegroundColor Green
}
catch {
    Write-Host "  Backend  [:5000] : still starting..." -ForegroundColor Yellow
}

# Flask
try {
    $f = Invoke-RestMethod http://localhost:5001/api/health -TimeoutSec 4
    Write-Host "  Flask    [:5001] : $($f.status)" -ForegroundColor Green
}
catch {
    Write-Host "  Flask    [:5001] : still starting..." -ForegroundColor Yellow
}

# Frontend
try {
    $fe = Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 5
    Write-Host "  Frontend [:3000] : HTTP $($fe.StatusCode)" -ForegroundColor Green
}
catch {
    Write-Host "  Frontend [:3000] : still starting..." -ForegroundColor Yellow
}

# API routes
try {
    $m = Invoke-RestMethod "http://localhost:5000/api/v1/machines" -TimeoutSec 3
    Write-Host "  /machines       : $($m.data.Count) machine(s) in MongoDB" -ForegroundColor Green
}
catch {}

try {
    $bk = Invoke-RestMethod "http://localhost:5000/api/v1/bookings" -TimeoutSec 3
    Write-Host "  /bookings       : live" -ForegroundColor Green
}
catch {}

try {
    $adm = Invoke-RestMethod "http://localhost:5000/api/v1/admin/dashboard" -TimeoutSec 3
    Write-Host "  /admin/dashboard: live" -ForegroundColor Green
}
catch {}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OPEN IN BROWSER: http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "  All API Endpoints:" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/machines    - Equipment CRUD + GPS" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/bookings    - Uber-style booking flow" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/payments    - Payment initiate/confirm/refund" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/admin       - Dashboard + Machine approvals" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/ml          - Demand prediction + Pricing AI" -ForegroundColor DarkGray
Write-Host "    :5000/api/v1/search      - GPS-aware smart search" -ForegroundColor DarkGray
Write-Host "    :5000/api/v2/*          - Flask proxy (GPS, payments, insurance, LLM)" -ForegroundColor DarkGray
Write-Host "    :5001/api/health         - Flask health check" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
