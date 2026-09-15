-- =============================================================================
-- Migration: Comprehensive Backend Modules (5.1 - 5.10)
-- Target: Supabase PostgreSQL Database
-- =============================================================================

-- 1. Alter Users table to track email verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

-- 2. Alter Equipment table for soft delete and weekly/monthly rental pricing
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price_weekly NUMERIC(10, 2);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10, 2);

-- 3. Create UserSession table for active session tracking and remote logouts
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_id TEXT UNIQUE NOT NULL, -- encodes JWT jti / sid
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_id ON user_sessions(token_id);

-- 4. Create UserAddress table for address management
CREATE TABLE IF NOT EXISTS user_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- e.g., 'Home', 'Work'
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id);

-- 5. Create NotificationPreference table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    email BOOLEAN DEFAULT true,
    sms BOOLEAN DEFAULT true,
    push BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create BookingExtensionRequest table for rental duration extensions
CREATE TABLE IF NOT EXISTS booking_extension_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    new_end_date DATE NOT NULL,
    extra_amount NUMERIC(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_extensions_booking ON booking_extension_requests(booking_id);

-- 7. Add invoice_url to bookings (for invoice storage linkage)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS invoice_url TEXT;
