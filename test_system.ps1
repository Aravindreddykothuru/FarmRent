# test_system.ps1
# Run from: c:\Users\aravind reddy\OneDrive\Desktop\farmers\

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   FarmRent - System Health Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$results = @()

# 1. Backend Health
try {
    $b = Invoke-RestMethod http://localhost:5000/health -TimeoutSec 3
    Write-Host "[OK] Backend  (:5000) Status: $($b.status)" -ForegroundColor Green
    $results += @{ service = "Backend"; ok = $true }
} catch {
    Write-Host "[FAIL] Backend (:5000) is unreachable" -ForegroundColor Red
    $results += @{ service = "Backend"; ok = $false }
}

# 2. Flask Health
try {
    $f = Invoke-RestMethod http://localhost:5001/api/health -TimeoutSec 3
    Write-Host "[OK] Flask    (:5001) Status: $($f.status)" -ForegroundColor Green
    $results += @{ service = "Flask"; ok = $true }
} catch {
    Write-Host "[FAIL] Flask   (:5001) is unreachable" -ForegroundColor Red
    $results += @{ service = "Flask"; ok = $false }
}

# 3. Frontend Health
try {
    $fe = Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 3
    Write-Host "[OK] Frontend (:3000) Status: HTTP $($fe.StatusCode)" -ForegroundColor Green
    $results += @{ service = "Frontend"; ok = $true }
} catch {
    Write-Host "[FAIL] Frontend (:3000) is unreachable" -ForegroundColor Red
    $results += @{ service = "Frontend"; ok = $false }
}

# 4. Redis Check (via Backend)
try {
    $br = Invoke-RestMethod http://localhost:5000/health/full -TimeoutSec 3
    if ($br.dependencies.redis.isReady) {
        Write-Host "[OK] Redis Check: Connected" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Redis Check: Not Ready" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Redis Check failed (Backend unreachable)" -ForegroundColor Red
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
