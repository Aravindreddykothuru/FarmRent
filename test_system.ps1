# test_system.ps1
# Run from: c:\Users\aravind reddy\OneDrive\Desktop\farmers\

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   FarmRent - System Health Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$results = @()

# 1. Unified Server API Health
try {
    $b = Invoke-RestMethod http://localhost:3002/health -TimeoutSec 3
    Write-Host "[OK] Unified API (:3002) Status: $($b.status)" -ForegroundColor Green
    $results += @{ service = "Unified API"; ok = $true }
} catch {
    Write-Host "[FAIL] Unified API (:3002) is unreachable" -ForegroundColor Red
    $results += @{ service = "Unified API"; ok = $false }
}

# 2. Flask Health
try {
    $f = Invoke-RestMethod http://localhost:5001/api/health -TimeoutSec 3
    Write-Host "[OK] Flask       (:5001) Status: $($f.status)" -ForegroundColor Green
    $results += @{ service = "Flask"; ok = $true }
} catch {
    Write-Host "[FAIL] Flask      (:5001) is unreachable" -ForegroundColor Red
    $results += @{ service = "Flask"; ok = $false }
}

# 3. Frontend UI Health
try {
    $fe = Invoke-WebRequest http://localhost:3002 -UseBasicParsing -TimeoutSec 3
    Write-Host "[OK] Frontend UI (:3002) Status: HTTP $($fe.StatusCode)" -ForegroundColor Green
    $results += @{ service = "Frontend UI"; ok = $true }
} catch {
    Write-Host "[FAIL] Frontend UI (:3002) is unreachable" -ForegroundColor Red
    $results += @{ service = "Frontend UI"; ok = $false }
}

# 4. Redis Check (via Unified Server)
try {
    $br = Invoke-RestMethod http://localhost:3002/health/full -TimeoutSec 3
    if ($br.dependencies.redis.isReady) {
        Write-Host "[OK] Redis Check: Connected" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Redis Check: Not Ready" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Redis Check failed (Unified Server unreachable)" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
$failed = ($results | Where-Object { $_.ok -eq $false }).Count
if ($failed -eq 0) {
    Write-Host "   ALL SERVICES HEALTHY" -ForegroundColor Green
} else {
    Write-Host "   $failed SERVICE(S) DOWN" -ForegroundColor Red
}
Write-Host "============================================" -ForegroundColor Cyan
