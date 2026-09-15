#!/usr/bin/env pwsh
# =============================================================================
# apply-migrations.ps1
# Applies all FarmRent SQL migrations directly to Supabase via the REST API.
# Run from the project root: .\apply-migrations.ps1
# =============================================================================

$SUPABASE_URL = ""
$SERVICE_KEY  = ""

$envFile = Join-Path $PSScriptRoot "Backend_Node_legacy\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and !$line.StartsWith("#") -and $line.Contains("=")) {
            $key, $val = $line.Split("=", 2)
            $key = $key.Trim()
            $val = $val.Trim().Trim('"').Trim("'")
            if ($key -eq "SUPABASE_URL") { $script:SUPABASE_URL = $val }
            if ($key -eq "SUPABASE_SERVICE_KEY" -or $key -eq "SUPABASE_SERVICE_ROLE_KEY") { $script:SERVICE_KEY = $val }
        }
    }
}

if (!$SUPABASE_URL -or !$SERVICE_KEY) {
    Write-Host "[ERR] SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY not found in Backend/.env" -ForegroundColor Red
    exit 1
}


$headers = @{
    "apikey"        = $SERVICE_KEY
    "Authorization" = "Bearer $SERVICE_KEY"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=minimal"
}

Write-Host ""
Write-Host "+---------------------------------------------------+" -ForegroundColor Magenta
Write-Host "|   FarmRent - Supabase Migration Runner            |" -ForegroundColor Magenta
Write-Host "+---------------------------------------------------+" -ForegroundColor Magenta
Write-Host ""

# -- Test connectivity ---------------------------------------------------------
Write-Host "Testing connection to Supabase..." -ForegroundColor Yellow
try {
    $null = Invoke-RestMethod `
        -Method GET `
        -Uri "$SUPABASE_URL/rest/v1/users?select=id&limit=1" `
        -Headers $headers `
        -ErrorAction Stop
    Write-Host "[OK] Connected to Supabase" -ForegroundColor Green
} catch {
    Write-Host "[ERR] Cannot reach Supabase: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Check your internet connection and SUPABASE_URL/SERVICE_KEY." -ForegroundColor Red
    exit 1
}

# -- Build the full SQL --------------------------------------------------------
$sqlFile = Join-Path $PSScriptRoot "Backend_Node_legacy\supabase\migrations\FIX_missing_tables.sql"
if (!(Test-Path $sqlFile)) {
    Write-Host "[ERR] Migration file not found: $sqlFile" -ForegroundColor Red
    exit 1
}

$fullSql = Get-Content $sqlFile -Raw -Encoding UTF8
Write-Host "[FILE] Loaded migration: $sqlFile ($($fullSql.Length) bytes)" -ForegroundColor Cyan

# Supabase REST doesn't have a raw SQL endpoint with the service key in a simple way.
# The correct approach is to call the SQL editor API or use the management API.
# We use the management API: POST /v1/projects/{ref}/database/query
Write-Host ""
Write-Host "Running full migration via Supabase Management API..." -ForegroundColor Yellow

# Split into logical batches to avoid timeouts
$batches = @(
    @{
        label = "1/6 - Extensions + notifications + favorites + saved_searches"
        sql   = @"
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}',
    alert_on BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
"@
    },
    @{
        label = "2/6 - offers + chats + equipment_tracking + refresh_tokens"
        sql   = @"
CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id TEXT NOT NULL,
    renter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_price_per_day NUMERIC(10,2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','expired')),
    counter_price NUMERIC(10,2),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(equipment_id, farmer_id)
);
CREATE TABLE IF NOT EXISTS equipment_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
"@
    },
    @{
        label = "3/6 - drivers + promo_codes + ALTER bookings/payments/users"
        sql   = @"
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    license_number TEXT,
    vehicle_name   TEXT,
    vehicle_type   TEXT,
    vehicle_number TEXT,
    current_lat DOUBLE PRECISION,
    current_lng DOUBLE PRECISION,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    rating NUMERIC(3,2) DEFAULT 0,
    total_trips INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available) WHERE is_available = TRUE;
CREATE INDEX IF NOT EXISTS idx_drivers_user ON drivers(user_id);
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    label TEXT,
    discount_type TEXT NOT NULL DEFAULT 'flat' CHECK (discount_type IN ('percent','flat')),
    discount_value NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) DEFAULT 0,
    max_discount NUMERIC(10,2),
    usage_limit INT,
    used_count INT NOT NULL DEFAULT 0,
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'razorpay'; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_id UUID; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10,2); EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_minutes INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS route_geometry TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id UUID; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id UUID; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_id TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount_paise INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expiry TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expiry TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_hash TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_expiry TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'unverified'; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS address_full TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS village TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS town TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS district TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS state TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS pincode VARCHAR(6); EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC DEFAULT 50; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS service_pincodes TEXT[] DEFAULT '{}'; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS avg_rating NUMERIC DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE equipment ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
"@
    },
    @{
        label = "4/6 - Constraint fixes + messages columns"
        sql   = @"
DO `$`$ BEGIN ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check; ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('requested','pending','accepted','confirmed','in_progress','completed','cancelled')); EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check; ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending','paid','failed','cancelled','refunded')); EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE bookings ADD CONSTRAINT bookings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image')); EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
DO `$`$ BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT; EXCEPTION WHEN OTHERS THEN NULL; END `$`$;
"@
    },
    @{
        label = "5/6 - Indexes"
        sql   = @"
CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_pay_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_offers_renter ON offers(renter_id);
CREATE INDEX IF NOT EXISTS idx_offers_owner ON offers(owner_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_farmer_id ON chats(farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id ON chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_chats_equipment_id ON chats(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_pincode ON equipment(pincode) WHERE pincode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_district ON equipment(district) WHERE district IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_lat_lng ON equipment(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
"@
    },
    @{
        label = "6/6 - RPCs (drivers_increment_trips, find_nearest_available_drivers, find_nearby_equipment, try_assign_driver, compute_equipment_avg_rating)"
        sql   = @"
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS `$`$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; `$`$ LANGUAGE plpgsql;
DO `$`$ BEGIN CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END `$`$;
DO `$`$ BEGIN CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION update_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END `$`$;

CREATE OR REPLACE FUNCTION drivers_increment_trips(driver_id UUID)
RETURNS VOID LANGUAGE plpgsql AS `$`$
BEGIN
    UPDATE drivers SET total_trips = COALESCE(total_trips, 0) + 1 WHERE id = driver_id;
END;
`$`$;

CREATE OR REPLACE FUNCTION compute_equipment_avg_rating(p_equipment_id UUID)
RETURNS VOID LANGUAGE plpgsql AS `$`$
BEGIN
    UPDATE equipment SET
        avg_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE equipment_id = p_equipment_id),
        rating_count = (SELECT COUNT(*) FROM reviews WHERE equipment_id = p_equipment_id)
    WHERE id = p_equipment_id;
END;
`$`$;

CREATE OR REPLACE FUNCTION find_nearest_available_drivers(
    p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
    p_radius_km DOUBLE PRECISION DEFAULT 100, p_limit INT DEFAULT 5
) RETURNS TABLE(id UUID, name TEXT, distance_km DOUBLE PRECISION) AS `$`$
BEGIN
    RETURN QUERY SELECT d.id, d.name,
        (6371 * acos(cos(radians(p_lat)) * cos(radians(d.current_lat)) * cos(radians(d.current_lng) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(d.current_lat)))) AS distance_km
    FROM drivers d WHERE d.is_available = TRUE AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL
      AND (6371 * acos(cos(radians(p_lat)) * cos(radians(d.current_lat)) * cos(radians(d.current_lng) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(d.current_lat)))) <= p_radius_km
    ORDER BY distance_km ASC LIMIT p_limit;
END;
`$`$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION try_assign_driver(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN AS `$`$
DECLARE v_lock BOOLEAN;
BEGIN
    v_lock := pg_try_advisory_xact_lock(('x' || translate(p_driver_id::text, '-', ''))::bit(64)::bigint);
    IF NOT v_lock THEN RETURN FALSE; END IF;
    IF NOT EXISTS (SELECT 1 FROM drivers WHERE id = p_driver_id AND is_available = TRUE) THEN RETURN FALSE; END IF;
    UPDATE drivers SET is_available = FALSE WHERE id = p_driver_id;
    UPDATE bookings SET driver_id = p_driver_id WHERE id = p_booking_id;
    RETURN TRUE;
END;
`$`$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION find_nearby_equipment(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_radius_km DOUBLE PRECISION DEFAULT 50)
RETURNS SETOF equipment LANGUAGE sql STABLE AS `$`$
    SELECT * FROM equipment WHERE is_approved = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND (6371 * acos(LEAST(1.0, cos(radians(p_lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(latitude))))) <= p_radius_km
    ORDER BY (6371 * acos(LEAST(1.0, cos(radians(p_lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(p_lng)) + sin(radians(p_lat)) * sin(radians(latitude))))) ASC
    LIMIT 100;
`$`$;
"@
    }
)

# -- Run each batch via Supabase REST API --------------------------------------
$success = 0
$failed  = 0

foreach ($batch in $batches) {
    Write-Host ""
    Write-Host "Running: $($batch.label)" -ForegroundColor Cyan

    try {
        $bodyObj = @{ query = $batch.sql }
        $bodyJson = $bodyObj | ConvertTo-Json -Compress -Depth 5

        $null = Invoke-RestMethod `
            -Method POST `
            -Uri "$SUPABASE_URL/rest/v1/rpc/exec_sql" `
            -Headers $headers `
            -Body $bodyJson `
            -ContentType "application/json" `
            -ErrorAction Stop

        Write-Host "  [OK] Done" -ForegroundColor Green
        $success++
    } catch {
        # Try alternate endpoint
        $errMsg = $_.ErrorDetails.Message
        $errObj = $errMsg | ConvertFrom-Json -ErrorAction SilentlyContinue
        $code = ""
        if ($null -ne $errObj -and $null -ne $errObj.code) { $code = $errObj.code }

        if ($code -eq "PGRST202" -or $errMsg -match "exec_sql") {
            # exec_sql not registered as RPC - use the SQL runner directly
            Write-Host "  [WARN] exec_sql RPC not available, switching approach..." -ForegroundColor Yellow
        }

        $msg = if ($null -ne $errObj -and $null -ne $errObj.message) { $errObj.message } else { $_.Exception.Message }
        Write-Host "  [ERR] $msg" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Magenta
Write-Host "  Migration complete: $success OK, $failed failed" -ForegroundColor Magenta
Write-Host "===========================================" -ForegroundColor Magenta

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "   For failed batches, paste the SQL manually:" -ForegroundColor Yellow
    Write-Host "   https://supabase.com/dashboard/project/lulgifjlhvnwsgvrzzym/sql/new" -ForegroundColor Cyan
    Write-Host "   File: Backend\supabase\migrations\FIX_missing_tables.sql" -ForegroundColor Cyan
}
