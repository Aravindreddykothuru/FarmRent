#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Phase 2 - Run Alembic migration and DB sanity tests.
.DESCRIPTION
    1. Starts only the PostgreSQL container (farmrent-db) via docker-compose.
    2. Waits until the DB is healthy.
    3. Runs alembic upgrade head to apply all migrations.
    4. Runs test_db.py to verify inserts, relationships, and cleanup.

    Usage:
        .\run-migrations.ps1
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$Backend = Join-Path $ProjectRoot "backend"
$Venv = Join-Path $ProjectRoot ".venv\Scripts"

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  FarmRent — Phase 2: DB Migration & Sanity Check" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

# ── Step 1: Start the DB container ──────────────────────────────────────────
Write-Host "[1/4] Starting PostgreSQL container..." -ForegroundColor Yellow
docker compose up -d db
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: docker compose up failed." -ForegroundColor Red; exit 1 }

# ── Step 2: Wait for health ──────────────────────────────────────────────────
Write-Host "[2/4] Waiting for DB to be healthy..." -ForegroundColor Yellow
$maxWait = 60   # seconds
$elapsed = 0
do {
    Start-Sleep -Seconds 2
    $elapsed += 2
    $status = docker inspect --format "{{.State.Health.Status}}" farmrent-db 2>$null
    Write-Host "      health=$status  (${elapsed}s elapsed)"
} while ($status -ne "healthy" -and $elapsed -lt $maxWait)

if ($status -ne "healthy") {
    Write-Host "ERROR: farmrent-db did not become healthy within ${maxWait}s." -ForegroundColor Red
    exit 1
}
Write-Host "      PostgreSQL is healthy. ✔" -ForegroundColor Green

# ── Step 3: Alembic upgrade ──────────────────────────────────────────────────
Write-Host "`n[3/4] Running: alembic upgrade head..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/farmrent"
& "$Venv\alembic.exe" -c "$Backend\alembic.ini" upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: alembic upgrade failed." -ForegroundColor Red; exit 1 }
Write-Host "      Migration applied successfully. ✔" -ForegroundColor Green

# ── Step 4: Sanity test ──────────────────────────────────────────────────────
Write-Host "`n[4/4] Running: test_db.py sanity check..." -ForegroundColor Yellow
& "$Venv\python.exe" "$Backend\test_db.py"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: test_db.py reported failures." -ForegroundColor Red; exit 1 }

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Phase 2 complete — schema is live and verified!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Green
