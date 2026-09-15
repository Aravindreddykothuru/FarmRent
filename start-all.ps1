# start-all.ps1 - FarmRent: Start all services in separate windows
# Run from: c:\Users\aravind reddy\OneDrive\Desktop\farmers\

$root = $PSScriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   FarmRent - Starting All Services" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# -- 0. Redis - ensure Redis 7+ is running via Docker --------------------------
Write-Host "[0/3] Checking Redis..." -ForegroundColor Yellow


# Check Docker
$dockerAvailable = $null
try { $dockerAvailable = docker info 2>&1; $dockerAvailable = ($LASTEXITCODE -eq 0) } catch { $dockerAvailable = $false }

if ($dockerAvailable) {
    # Is redis container already running?
    $redisContainer = docker ps --filter "name=farmrent-redis" --filter "status=running" -q 2>$null
    if ($redisContainer) {
        Write-Host "  Redis [:6379] : running (Docker)" -ForegroundColor Green
    } else {
        # Remove stopped container if exists
        docker rm -f farmrent-redis 2>$null | Out-Null
        Write-Host "  Starting Redis 7 via Docker..." -ForegroundColor DarkGray
        docker run -d --name farmrent-redis -p 6379:6379 redis:7-alpine 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Redis [:6379] : started (Docker redis:7-alpine)" -ForegroundColor Green
        } else {
            Write-Host "  Redis [:6379] : Docker start FAILED - GPS tracking will be degraded" -ForegroundColor Red
        }
    }
} else {
    # No Docker - check if something is listening on 6379
    $port6379 = (Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue)
    if ($port6379) {
        Write-Host "  Redis [:6379] : running (unknown version - GEO commands may fail)" -ForegroundColor DarkYellow
        Write-Host "  TIP: Install Docker Desktop and re-run to get Redis 7 with full GEO support." -ForegroundColor DarkGray
    } else {
        Write-Host "  Redis [:6379] : NOT running. Install Docker Desktop, then re-run." -ForegroundColor Red
        Write-Host "  GPS tracking and real-time features will be unavailable." -ForegroundColor DarkGray
    }
}
Start-Sleep -Seconds 1

# -- 1. Kill anything on ports 3000, 3001, 3002, 5000, 5001 -------------------
Write-Host "[1/3] Clearing ports 3000, 3001, 3002, 5000, 5001..." -ForegroundColor Yellow
foreach ($port in @(3000, 3001, 3002, 5000, 5001)) {
    $pids2 = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    foreach ($p in $pids2) {
        try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host "  Killed PID $p on :$port" -ForegroundColor DarkGray } catch {}
    }
}
Start-Sleep -Seconds 2

# -- 2. Flask - Python on port 5001 -------------------------------------------
Write-Host "[2/3] Starting Flask    (Python)  => http://localhost:5001" -ForegroundColor Green
$flaskDir = Join-Path $root "FutureEnhancement"
Start-Process "cmd.exe" -ArgumentList @("/k", "title FarmRent-Flask && cd /d `"$flaskDir`" && ..\.venv\Scripts\python.exe run.py") -WindowStyle Normal

# -- 3. Frontend/Backend - Unified Next.js on port 3002 -----------------------
Write-Host "[3/3] Starting Unified Server (Next.js + Express API) => http://localhost:3002" -ForegroundColor Green
$frontendDir = Join-Path $root "nextfrontend"
Start-Process "cmd.exe" -ArgumentList @("/k", "title FarmRent-Frontend && cd /d `"$frontendDir`" && npm run dev") -WindowStyle Normal

# -- Wait for services to boot -------------------------------------------------
Write-Host ""
Write-Host "  Waiting 16 seconds for services to boot..." -ForegroundColor DarkGray
Start-Sleep -Seconds 16

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Health Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Unified Server
try {
    $b = Invoke-RestMethod http://localhost:3002/health -TimeoutSec 5
    Write-Host "  Unified API [:3002] : $($b.status)" -ForegroundColor Green
}
catch {
    Write-Host "  Unified API [:3002] : still starting..." -ForegroundColor Yellow
}

# Flask
try {
    $f = Invoke-RestMethod http://localhost:5001/api/health -TimeoutSec 4
    Write-Host "  Flask Server [:5001] : $($f.status)" -ForegroundColor Green
}
catch {
    Write-Host "  Flask Server [:5001] : still starting..." -ForegroundColor Yellow
}

# Frontend UI
try {
    $fe = Invoke-WebRequest http://localhost:3002 -UseBasicParsing -TimeoutSec 5
    Write-Host "  Frontend UI [:3002]  : HTTP $($fe.StatusCode)" -ForegroundColor Green
}
catch {
    Write-Host "  Frontend UI [:3002]  : still starting..." -ForegroundColor Yellow
}

# API routes
try {
    $m = Invoke-RestMethod "http://localhost:3002/api/v1/machines" -TimeoutSec 3
    Write-Host "  /machines        : $($m.data.Count) machine(s)" -ForegroundColor Green
}
catch {}

try {
    $null = Invoke-RestMethod "http://localhost:3002/api/v1/bookings" -TimeoutSec 3
    Write-Host "  /bookings        : live" -ForegroundColor Green
}
catch {}

# Redis GEO check
try {
    $r = Invoke-RestMethod http://localhost:3002/health/full -TimeoutSec 5
    $redisReady = $r.dependencies.redis.isReady
    Write-Host "  Redis            : $(if ($redisReady) { 'connected' } else { 'degraded' })" -ForegroundColor $(if ($redisReady) { 'Green' } else { 'Yellow' })
}
catch {}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OPEN IN BROWSER: http://localhost:3002" -ForegroundColor Yellow
Write-Host ""
Write-Host "  All API Endpoints (served on port 3002):" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/machines    - Equipment CRUD + GPS" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/bookings    - Uber-style booking flow" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/payments    - Payment initiate/confirm/refund" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/admin       - Dashboard + Machine approvals" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/ml          - Demand prediction + Pricing AI" -ForegroundColor DarkGray
Write-Host "    :3002/api/v1/search      - GPS-aware smart search" -ForegroundColor DarkGray
Write-Host "    :3002/api/v2/*           - Flask proxy (GPS, payments, insurance, LLM)" -ForegroundColor DarkGray
Write-Host "    :5001/api/health         - Flask health check" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [INFO] PENDING DB MIGRATIONS (run once in Supabase SQL Editor):" -ForegroundColor Yellow
Write-Host "    1. Backend\supabase\schema.sql               - core tables (notifications, etc.)" -ForegroundColor DarkGray
Write-Host "    2. Backend\supabase\migrations\003_marketplace_features.sql - favorites, offers" -ForegroundColor DarkGray
Write-Host "    3. Backend\supabase\equipment_location_schema.sql           - GPS columns + RPC" -ForegroundColor DarkGray
Write-Host "     Dashboard: https://supabase.com/dashboard/project/lulgifjlhvnwsgvrzzym/sql" -ForegroundColor DarkGray
Write-Host ""
