# generate-certs.ps1
# Generates self-signed certificates in the certs directory using Docker's alpine image containing openssl

$certDir = Join-Path $PSScriptRoot "certs"
if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir | Out-Null
}

Write-Host "Generating self-signed SSL certificates using a temporary Docker container..." -ForegroundColor Cyan

# Resolve-Path requires the path to exist, so we do it after creation
$absoluteCertDir = (Resolve-Path $certDir).Path

# Run Docker container to generate key and cert
docker run --rm -v "${absoluteCertDir}:/certs" alpine sh -c "apk add --no-cache openssl && openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /certs/server.key -out /certs/server.crt -subj '/CN=localhost'"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Certificates generated successfully in $certDir" -ForegroundColor Green
} else {
    Write-Error "Failed to generate certificates using Docker. Please ensure Docker is running."
}
